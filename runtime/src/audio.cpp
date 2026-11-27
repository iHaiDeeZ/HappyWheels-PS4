// h5: a small Web Audio for js/webaudio.js (Howler's use of it): buffer sources, gains, stereo panners, an
// equal-power panner, AudioParam automation, mixed on a sound thread into stereo S16 at 48 kHz.
// The graph is native and owns its nodes; the page's node objects hold handles (released by the collector).
#include "engine.h"
#include "h5.h"
#include "handles.h"
#include "platform.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <thread>

#if defined(H5_HAVE_VORBIS)
#include <vorbis/vorbisfile.h>
#endif

namespace h5::audio {

namespace {
constexpr int RATE = 48000;
constexpr int BLOCK = 256;

// ---------------------------------------------------------------- buffers
struct Buffer {
    int channels = 1, frames = 0, rate = RATE;
    std::vector<float> data;   // channel-major: [ch][frame]
    const float *channel(int c) const { return data.data() + static_cast<size_t>(std::min(c, channels - 1)) * frames; }
};

class BufferHandle final : public Handle {
public:
    explicit BufferHandle(std::shared_ptr<Buffer> b) : Handle(Kind::AudioBuffer), buffer(std::move(b)) { }
    size_t memory_cost() const override { return buffer->data.size() * sizeof(float); }
    std::shared_ptr<Buffer> buffer;
};

std::shared_ptr<Buffer> buffer_of(JSContextRef ctx, JSValueRef v)
{
    Handle *h = handle_of(ctx, v);
    return h && h->kind() == Handle::Kind::AudioBuffer ? static_cast<BufferHandle *>(h)->buffer : nullptr;
}

// ---------------------------------------------------------------- params
struct Event {
    int type;        // 1 set at time, 2 linear ramp to, 3 exponential ramp to, 4 target
    double time, value, constant;
};

struct Param {
    double value = 0;
    std::vector<Event> events;   // sorted by time
    double at(double t)
    {
        // drop events fully in the past, keeping the last one that set the value
        double v = value;
        double prev_t = 0, prev_v = value;
        size_t keep_from = 0;
        for (size_t i = 0; i < events.size(); i++) {
            const Event &e = events[i];
            if (e.time > t) {
                if (e.type == 2)
                    v = prev_v + (e.value - prev_v) * std::clamp((t - prev_t) / std::max(1e-9, e.time - prev_t), 0.0, 1.0);
                else if (e.type == 3 && prev_v > 0 && e.value > 0)
                    v = prev_v * std::pow(e.value / prev_v, std::clamp((t - prev_t) / std::max(1e-9, e.time - prev_t), 0.0, 1.0));
                break;
            }
            if (e.type == 4)
                v = e.value + (prev_v - e.value) * std::exp(-(t - e.time) / std::max(1e-6, e.constant));
            else
                v = e.value;
            if (e.type != 4) {
                prev_t = e.time;
                prev_v = e.value;
                keep_from = i;
            }
        }
        if (keep_from > 0 && keep_from < events.size() && events[keep_from].time <= t) {
            value = events[keep_from].value;
            events.erase(events.begin(), events.begin() + static_cast<long>(keep_from));
            events.front().type = 1;
        }
        if (events.empty())
            value = v;
        return v;
    }
};

// ---------------------------------------------------------------- nodes
enum Type { Destination = 0, Gain = 1, Source = 2, StereoPanner = 3, Panner = 4, PassThrough = 5 };
enum ParamId { P_GAIN = 0, P_PAN = 1, P_RATE = 2, P_DETUNE = 3, P_X = 4, P_Y = 5, P_Z = 6, P_COUNT = 7 };

struct Node {
    int id = 0;
    Type type = PassThrough;
    std::vector<int> inputs;
    Param params[P_COUNT];
    bool released = false;
    // sources
    std::shared_ptr<Buffer> buffer;
    bool loop = false;
    double loop_start = 0, loop_end = 0;
    double start_at = -1, stop_at = -1, offset = 0, duration = -1;
    double position = -1;          // frames into the buffer; < 0 before start
    double played = 0;             // seconds played (for duration)
    bool ended = false, ended_told = false;
    // a block's output (memo)
    unsigned block = ~0u;
    float out[2][BLOCK];
};

std::mutex g_mutex;
std::map<int, std::unique_ptr<Node>> g_nodes;
int g_next_id = 1;
std::atomic<uint64_t> g_frames_done { 0 };
std::atomic<bool> g_running { false };
std::thread g_null_thread;
std::atomic<bool> g_null_stop { false };
bool g_device = false;
unsigned g_block_no = 0;
std::vector<int> g_ended_queue;    // sources that ended, told to the page on the main thread
double g_start_ms = 0;

double now_seconds()
{
    return static_cast<double>(g_frames_done.load()) / RATE;
}

Node *node(int id)
{
    auto it = g_nodes.find(id);
    return it == g_nodes.end() ? nullptr : it->second.get();
}

void render_node(Node *n, double t);

void sum_inputs(Node *n, double t, float (&acc)[2][BLOCK])
{
    memset(acc, 0, sizeof acc);
    for (int in : n->inputs) {
        Node *src = node(in);
        if (!src)
            continue;
        render_node(src, t);
        for (int c = 0; c < 2; c++)
            for (int i = 0; i < BLOCK; i++)
                acc[c][i] += src->out[c][i];
    }
}

void render_source(Node *n, double t)
{
    memset(n->out, 0, sizeof n->out);
    if (!n->buffer || n->ended || n->start_at < 0)
        return;
    const double block_end = t + static_cast<double>(BLOCK) / RATE;
    if (n->start_at >= block_end)
        return;
    const Buffer &b = *n->buffer;
    if (b.frames <= 0) {
        n->ended = true;
        return;
    }
    int first = 0;
    if (n->position < 0) {
        first = std::clamp(static_cast<int>((n->start_at - t) * RATE), 0, BLOCK - 1);
        n->position = std::clamp(n->offset, 0.0, static_cast<double>(b.frames) / b.rate) * b.rate;
    }
    const double rate = std::max(0.0, n->params[P_RATE].at(t)) * std::pow(2.0, n->params[P_DETUNE].at(t) / 1200.0);
    const double step = rate * b.rate / RATE;
    const double loop_start = n->loop_end > n->loop_start ? n->loop_start * b.rate : 0;
    const double loop_end = n->loop_end > n->loop_start ? std::min<double>(n->loop_end * b.rate, b.frames) : b.frames;
    const float *l = b.channel(0);
    const float *r = b.channel(1);
    for (int i = first; i < BLOCK; i++) {
        const double now = t + static_cast<double>(i) / RATE;
        if (n->stop_at >= 0 && now >= n->stop_at) {
            n->ended = true;
            break;
        }
        if (n->duration >= 0 && n->played >= n->duration) {
            n->ended = true;
            break;
        }
        double p = n->position;
        if (n->loop && p >= loop_end && loop_end > loop_start) {
            p = loop_start + std::fmod(p - loop_start, loop_end - loop_start);
            n->position = p;
        }
        if (p >= b.frames) {
            n->ended = true;
            break;
        }
        const int i0 = static_cast<int>(p);
        const int i1 = std::min(i0 + 1, b.frames - 1);
        const float f = static_cast<float>(p - i0);
        n->out[0][i] = l[i0] + (l[i1] - l[i0]) * f;
        n->out[1][i] = r[i0] + (r[i1] - r[i0]) * f;
        n->position += step;
        n->played += step / b.rate;
    }
    if (n->ended && !n->ended_told) {
        n->ended_told = true;
        g_ended_queue.push_back(n->id);
    }
}

void render_node(Node *n, double t)
{
    if (n->block == g_block_no)
        return;
    n->block = g_block_no;
    switch (n->type) {
    case Source:
        render_source(n, t);
        return;
    case Gain: {
        float acc[2][BLOCK];
        sum_inputs(n, t, acc);
        const float g = static_cast<float>(n->params[P_GAIN].at(t));
        for (int c = 0; c < 2; c++)
            for (int i = 0; i < BLOCK; i++)
                n->out[c][i] = acc[c][i] * g;
        return;
    }
    case StereoPanner:
    case Panner: {
        float acc[2][BLOCK];
        sum_inputs(n, t, acc);
        double pan;
        if (n->type == StereoPanner) {
            pan = std::clamp(n->params[P_PAN].at(t), -1.0, 1.0);
        } else {
            const double x = n->params[P_X].at(t), z = n->params[P_Z].at(t);
            pan = std::clamp(std::atan2(x, std::max(1e-6, std::fabs(z) + 1e-6)) / (M_PI / 2), -1.0, 1.0);
        }
        // equal power: x in [0, 1]
        const double x = (pan + 1) / 2;
        const float gl = static_cast<float>(std::cos(x * M_PI / 2)), gr = static_cast<float>(std::sin(x * M_PI / 2));
        for (int i = 0; i < BLOCK; i++) {
            const float m = (acc[0][i] + acc[1][i]) * 0.5f;
            n->out[0][i] = m * gl * 1.41421356f;
            n->out[1][i] = m * gr * 1.41421356f;
        }
        return;
    }
    default: {
        float acc[2][BLOCK];
        sum_inputs(n, t, acc);
        memcpy(n->out, acc, sizeof acc);
        return;
    }
    }
}

// nodes the page let go of, that nothing plays through any more
void collect()
{
    for (auto it = g_nodes.begin(); it != g_nodes.end();) {
        Node *n = it->second.get();
        const bool playing = n->type == Source && n->start_at >= 0 && !n->ended;
        bool feeds_live = false;
        if (n->type != Source && n->type != Destination)
            for (int in : n->inputs)
                if (node(in))
                    feeds_live = true;
        if (n->released && !playing && !feeds_live && n->type != Destination) {
            const int id = n->id;
            for (auto &[_, other] : g_nodes)
                other->inputs.erase(std::remove(other->inputs.begin(), other->inputs.end(), id), other->inputs.end());
            it = g_nodes.erase(it);
        } else {
            ++it;
        }
    }
}

void mix(int16_t *out, int frames, void *)
{
    int done = 0;
    while (done < frames) {
        const int n = std::min(BLOCK, frames - done);
        float block[2][BLOCK] = {};
        {
            std::lock_guard<std::mutex> lock(g_mutex);
            const double t = now_seconds();
            g_block_no++;
            if (Node *dest = node(1)) {
                render_node(dest, t);
                memcpy(block, dest->out, sizeof block);
            }
            if ((g_block_no & 63) == 0)
                collect();
        }
        for (int i = 0; i < n; i++)
            for (int c = 0; c < 2; c++) {
                const float v = std::clamp(block[c][i], -1.0f, 1.0f);
                out[(done + i) * 2 + c] = static_cast<int16_t>(std::lrint(v * 32767.0f));
            }
        done += n;
        g_frames_done += static_cast<uint64_t>(n);
    }
    // ended sources: their onended runs on the main thread
    std::vector<int> ended;
    {
        std::lock_guard<std::mutex> lock(g_mutex);
        ended.swap(g_ended_queue);
    }
    if (!ended.empty()) {
        const unsigned gen = engine::generation();
        post_main([ended, gen] {
            if (gen != engine::generation() || !engine::running())
                return;
            JSGlobalContextRef ctx = engine::context();
            for (int id : ended)
                engine::call_hook("audioEnded", { JSValueMakeNumber(ctx, id) });
        });
    }
}

void null_device()
{
    std::vector<int16_t> scratch(BLOCK * 2);
    double next = now_ms();
    while (!g_null_stop.load()) {
        mix(scratch.data(), BLOCK, nullptr);
        next += 1000.0 * BLOCK / RATE;
        const double wait = next - now_ms();
        if (wait > 0)
            std::this_thread::sleep_for(std::chrono::microseconds(static_cast<long long>(wait * 1000)));
    }
}

// ---------------------------------------------------------------- decoding
struct Decoded {
    std::shared_ptr<Buffer> buffer;
    std::string error;
};

#if defined(H5_HAVE_VORBIS)
struct MemFile {
    const uint8_t *data;
    size_t size, pos;
};
size_t mem_read(void *ptr, size_t size, size_t n, void *src)
{
    auto *f = static_cast<MemFile *>(src);
    const size_t want = size * n, left = f->size - f->pos, take = std::min(want, left);
    memcpy(ptr, f->data + f->pos, take);
    f->pos += take;
    return size ? take / size : 0;
}
int mem_seek(void *src, ogg_int64_t off, int whence)
{
    auto *f = static_cast<MemFile *>(src);
    ogg_int64_t p = whence == SEEK_SET ? off : whence == SEEK_CUR ? static_cast<ogg_int64_t>(f->pos) + off : static_cast<ogg_int64_t>(f->size) + off;
    if (p < 0 || p > static_cast<ogg_int64_t>(f->size))
        return -1;
    f->pos = static_cast<size_t>(p);
    return 0;
}
long mem_tell(void *src)
{
    return static_cast<long>(static_cast<MemFile *>(src)->pos);
}

bool decode_vorbis(const std::vector<uint8_t> &bytes, Decoded &out)
{
    MemFile mf { bytes.data(), bytes.size(), 0 };
    OggVorbis_File vf;
    ov_callbacks cb { mem_read, mem_seek, nullptr, mem_tell };
    if (ov_open_callbacks(&mf, &vf, nullptr, 0, cb) != 0)
        return false;
    vorbis_info *info = ov_info(&vf, -1);
    auto b = std::make_shared<Buffer>();
    b->channels = std::clamp(info->channels, 1, 2);
    b->rate = static_cast<int>(info->rate);
    const ogg_int64_t total = ov_pcm_total(&vf, -1);
    std::vector<float> planar[2];
    if (total > 0)
        for (int c = 0; c < b->channels; c++)
            planar[c].reserve(static_cast<size_t>(total));
    for (;;) {
        float **pcm = nullptr;
        int section = 0;
        const long n = ov_read_float(&vf, &pcm, 4096, &section);
        if (n <= 0)
            break;
        for (int c = 0; c < b->channels; c++)
            planar[c].insert(planar[c].end(), pcm[c], pcm[c] + n);
    }
    ov_clear(&vf);
    b->frames = static_cast<int>(planar[0].size());
    b->data.resize(static_cast<size_t>(b->frames) * b->channels);
    for (int c = 0; c < b->channels; c++)
        std::copy(planar[c].begin(), planar[c].end(), b->data.begin() + static_cast<long>(c) * b->frames);
    out.buffer = b;
    return true;
}
#endif

// Without a decoder: silence of the right length (Ogg: the last page's granule position).
bool silent_ogg(const std::vector<uint8_t> &bytes, Decoded &out)
{
    if (bytes.size() < 64 || memcmp(bytes.data(), "OggS", 4))
        return false;
    int rate = 44100, channels = 2;
    for (size_t i = 0; i + 16 < std::min<size_t>(bytes.size(), 512); i++)
        if (bytes[i] == 1 && !memcmp(&bytes[i + 1], "vorbis", 6)) {
            channels = bytes[i + 11];
            rate = static_cast<int>(bytes[i + 12] | bytes[i + 13] << 8 | bytes[i + 14] << 16 | static_cast<uint32_t>(bytes[i + 15]) << 24);
            break;
        }
    uint64_t granule = 0;
    for (size_t i = bytes.size() - 27; i > 0; i--)
        if (!memcmp(&bytes[i], "OggS", 4)) {
            memcpy(&granule, &bytes[i + 6], 8);
            break;
        }
    auto b = std::make_shared<Buffer>();
    b->channels = std::clamp(channels, 1, 2);
    b->rate = rate > 0 ? rate : 44100;
    b->frames = static_cast<int>(std::min<uint64_t>(granule, 60ull * 60 * 48000));
    b->data.assign(static_cast<size_t>(b->frames) * b->channels, 0.0f);
    out.buffer = b;
    return true;
}

void decode(const std::vector<uint8_t> &bytes, Decoded &out)
{
#if defined(H5_HAVE_VORBIS)
    if (decode_vorbis(bytes, out))
        return;
#endif
    if (silent_ogg(bytes, out)) {
#if !defined(H5_HAVE_VORBIS)
        H5_WARN("audio: no Vorbis decoder in this build: %d frames of silence", out.buffer->frames);
#endif
        return;
    }
    out.error = "not an Ogg Vorbis stream";
}

// ---------------------------------------------------------------- natives
class NodeHandle final : public Handle {
public:
    explicit NodeHandle(int id) : Handle(Kind::Other), m_id(id) { }
    ~NodeHandle() override
    {
        std::lock_guard<std::mutex> lock(g_mutex);
        if (Node *n = node(m_id))
            n->released = true;
    }
    int m_id;
};

int node_id(JSContextRef ctx, JSValueRef v)
{
    if (JSValueIsNumber(ctx, v))
        return js::to_int(ctx, v);
    Handle *h = handle_of(ctx, v);
    return h && h->kind() == Handle::Kind::Other ? static_cast<NodeHandle *>(h)->m_id : 0;
}

H5_NATIVE(n_info)
{
    JSObjectRef o = JSObjectMake(ctx, nullptr, nullptr);
    js::set(ctx, o, "sampleRate", JSValueMakeNumber(ctx, RATE));
    js::set(ctx, o, "device", JSValueMakeBoolean(ctx, g_device));
    return o;
}

H5_NATIVE(n_time)
{
    return JSValueMakeNumber(ctx, now_seconds());
}

// node(type) -> [id, handle]
// (no JS allocation while g_mutex is held: a collection could finalize a NodeHandle, which takes it too)
H5_NATIVE(n_node)
{
    const Type type = static_cast<Type>(std::clamp(H5_INT(0), 0, 5));
    int id;
    {
        std::lock_guard<std::mutex> lock(g_mutex);
        auto n = std::make_unique<Node>();
        n->type = type;
        n->id = g_next_id++;
        n->params[P_GAIN].value = 1;
        n->params[P_RATE].value = 1;
        id = n->id;
        g_nodes[id] = std::move(n);
    }
    JSValueRef items[2] = { JSValueMakeNumber(ctx, id), make_handle(ctx, new NodeHandle(id)) };
    return JSObjectMakeArray(ctx, 2, items, nullptr);
}

H5_NATIVE(n_connect)
{
    std::lock_guard<std::mutex> lock(g_mutex);
    const int from = node_id(ctx, H5_ARG(0)), to = node_id(ctx, H5_ARG(1));
    Node *dst = node(to);
    if (dst && node(from) && std::find(dst->inputs.begin(), dst->inputs.end(), from) == dst->inputs.end())
        dst->inputs.push_back(from);
    return H5_UNDEFINED;
}

// disconnect(from, to | 0 for all)
H5_NATIVE(n_disconnect)
{
    std::lock_guard<std::mutex> lock(g_mutex);
    const int from = node_id(ctx, H5_ARG(0)), to = node_id(ctx, H5_ARG(1));
    for (auto &[id, n] : g_nodes)
        if (!to || id == to)
            n->inputs.erase(std::remove(n->inputs.begin(), n->inputs.end(), from), n->inputs.end());
    return H5_UNDEFINED;
}

// param(node, param, op, value, time, constant): op 0 value now (and cancel), 1 setValueAtTime,
// 2 linearRamp, 3 exponentialRamp, 4 setTargetAtTime, 5 cancelScheduledValues(time), 6 read -> value
H5_NATIVE(n_param)
{
    std::lock_guard<std::mutex> lock(g_mutex);
    Node *n = node(node_id(ctx, H5_ARG(0)));
    const int p = H5_INT(1), op = H5_INT(2);
    if (!n || p < 0 || p >= P_COUNT)
        return JSValueMakeNumber(ctx, 0);
    Param &param = n->params[p];
    const double v = H5_NUM(3), t = H5_NUM(4), k = H5_NUM(5);
    const double now = now_seconds();
    switch (op) {
    case 0:
        param.events.clear();
        param.value = v;
        break;
    case 1:
    case 2:
    case 3:
    case 4: {
        if ((op == 2 || op == 3) && param.events.empty())
            param.events.push_back({ 1, now, param.at(now), 0 });
        Event e { op, std::max(0.0, t), v, k };
        auto pos = std::upper_bound(param.events.begin(), param.events.end(), e.time, [](double tt, const Event &x) { return tt < x.time; });
        param.events.insert(pos, e);
        break;
    }
    case 5: {
        const double cur = param.at(now);
        param.events.erase(std::remove_if(param.events.begin(), param.events.end(), [&](const Event &x) { return x.time >= t; }), param.events.end());
        if (param.events.empty())
            param.value = cur;
        break;
    }
    case 6:
        return JSValueMakeNumber(ctx, param.at(now));
    }
    return H5_UNDEFINED;
}

// sourceSet(node, buffer|null, loop, loopStart, loopEnd)
H5_NATIVE(n_source_set)
{
    auto buffer = buffer_of(ctx, H5_ARG(1));
    std::lock_guard<std::mutex> lock(g_mutex);
    Node *n = node(node_id(ctx, H5_ARG(0)));
    if (!n)
        return H5_UNDEFINED;
    n->buffer = buffer;
    n->loop = H5_BOOL(2);
    n->loop_start = H5_NUM(3);
    n->loop_end = H5_NUM(4);
    return H5_UNDEFINED;
}

// sourceStart(node, when, offset, duration (-1 none))
H5_NATIVE(n_source_start)
{
    std::lock_guard<std::mutex> lock(g_mutex);
    Node *n = node(node_id(ctx, H5_ARG(0)));
    if (!n)
        return H5_UNDEFINED;
    n->start_at = std::max(H5_NUM(1), now_seconds());
    n->offset = std::max(0.0, H5_NUM(2));
    const double d = H5_NUM(3);
    n->duration = std::isfinite(d) && d >= 0 ? d : -1;
    n->position = -1;
    n->played = 0;
    n->ended = n->ended_told = false;
    return H5_UNDEFINED;
}

H5_NATIVE(n_source_stop)
{
    std::lock_guard<std::mutex> lock(g_mutex);
    Node *n = node(node_id(ctx, H5_ARG(0)));
    if (n)
        n->stop_at = std::max(H5_NUM(1), now_seconds());
    return H5_UNDEFINED;
}

// decode(id, bytes) -> hooks.complete(id, buffer | null, channels, frames, rate)
H5_NATIVE(n_decode)
{
    const double id = H5_NUM(0);
    const js::Bytes b = js::bytes_of(ctx, H5_ARG(1));
    auto bytes = std::make_shared<std::vector<uint8_t>>(static_cast<const uint8_t *>(b.data), static_cast<const uint8_t *>(b.data) + b.size);
    auto d = std::make_shared<Decoded>();
    const unsigned gen = engine::generation();
    const double t0 = now_ms();
    post_job([bytes, d] { decode(*bytes, *d); },
        [id, gen, d, t0, size = bytes->size()] {
            if (gen != engine::generation() || !engine::running())
                return;
            JSGlobalContextRef ctx = engine::context();
            if (!d->buffer) {
                H5_WARN("audio: decode failed: %s", d->error.c_str());
                engine::call_hook("complete", { JSValueMakeNumber(ctx, id), JSValueMakeNull(ctx) });
                return;
            }
            const Buffer &b = *d->buffer;
            H5_INFO("audio: decoded %zu bytes: %d ch, %d Hz, %.1f s (%.0f ms)", size, b.channels, b.rate,
                static_cast<double>(b.frames) / b.rate, now_ms() - t0);
            engine::call_hook("complete", { JSValueMakeNumber(ctx, id), make_handle(ctx, new BufferHandle(d->buffer)),
                JSValueMakeNumber(ctx, b.channels), JSValueMakeNumber(ctx, b.frames), JSValueMakeNumber(ctx, b.rate) });
        });
    return H5_UNDEFINED;
}

// createBuffer(channels, frames, rate) -> handle
H5_NATIVE(n_create_buffer)
{
    auto b = std::make_shared<Buffer>();
    b->channels = std::clamp(H5_INT(0), 1, 2);
    b->frames = std::max(0, H5_INT(1));
    b->rate = std::max(1, H5_INT(2));
    b->data.assign(static_cast<size_t>(b->frames) * b->channels, 0.0f);
    return make_handle(ctx, new BufferHandle(b));
}

// bufferChannel(handle, channel) -> Float32Array (a copy); bufferSetChannel(handle, channel, Float32Array)
H5_NATIVE(n_buffer_channel)
{
    auto b = buffer_of(ctx, H5_ARG(0));
    if (!b)
        return JSValueMakeNull(ctx);
    return js::make_typed_array(ctx, kJSTypedArrayTypeFloat32Array, b->channel(H5_INT(1)), static_cast<size_t>(b->frames) * 4);
}

H5_NATIVE(n_buffer_set_channel)
{
    auto b = buffer_of(ctx, H5_ARG(0));
    const js::Bytes src = js::bytes_of(ctx, H5_ARG(2));
    const int c = H5_INT(1);
    if (b && src.data && c >= 0 && c < b->channels) {
        std::lock_guard<std::mutex> lock(g_mutex);
        memcpy(b->data.data() + static_cast<size_t>(c) * b->frames, src.data, std::min(src.size, static_cast<size_t>(b->frames) * 4));
    }
    return H5_UNDEFINED;
}

void install(JSContextRef ctx, JSObjectRef h5)
{
    JSObjectRef o = JSObjectMake(ctx, nullptr, nullptr);
    js::set(ctx, h5, "audio", o, false);
    struct { const char *name; JSObjectCallAsFunctionCallback fn; } table[] = {
        { "info", n_info }, { "time", n_time }, { "node", n_node }, { "connect", n_connect }, { "disconnect", n_disconnect },
        { "param", n_param }, { "sourceSet", n_source_set }, { "sourceStart", n_source_start }, { "sourceStop", n_source_stop },
        { "decode", n_decode }, { "createBuffer", n_create_buffer }, { "bufferChannel", n_buffer_channel },
        { "bufferSetChannel", n_buffer_set_channel },
    };
    for (const auto &t : table)
        js::def(ctx, o, t.name, t.fn);
}

struct Registration {
    Registration() { engine::register_natives("audio", install); }
} g_registration;

void make_destination()
{
    auto d = std::make_unique<Node>();
    d->id = 1;
    d->type = Destination;
    g_nodes[1] = std::move(d);
    g_next_id = std::max(g_next_id, 2);
}

} // namespace

void start()
{
    {
        std::lock_guard<std::mutex> lock(g_mutex);
        make_destination();
    }
    g_start_ms = now_ms();
    g_device = platform::audio_start(RATE, BLOCK, mix, nullptr);
    if (!g_device) {
        g_null_stop = false;
        g_null_thread = std::thread(null_device);
        H5_INFO("audio: no sound device: the graph runs on a silent clock");
    } else {
        H5_INFO("audio: %d Hz stereo", RATE);
    }
    g_running = true;
}

void stop()
{
    if (!g_running)
        return;
    if (g_device)
        platform::audio_stop();
    else {
        g_null_stop = true;
        if (g_null_thread.joinable())
            g_null_thread.join();
    }
    g_running = false;
}

void reset()
{
    std::lock_guard<std::mutex> lock(g_mutex);
    g_nodes.clear();
    g_ended_queue.clear();
    make_destination();
}

} // namespace h5::audio
