// h5: images. Decoding runs on the worker threads; the page gets a handle (RGBA8, not premultiplied).
//   imageDecodeFile(id, path) / imageDecodeBytes(id, bytes)  -> hooks.complete(id, handle | null, width, height)
// SVG goes to svg.cpp's rasterizer (svg_rasterize), the rest to stb_image.
#include "engine.h"
#include "h5.h"
#include "handles.h"

#include <algorithm>
#include <cstring>
#include <memory>

#define STB_IMAGE_IMPLEMENTATION
#define STBI_NO_HDR
#define STBI_NO_PIC
#define STBI_NO_PNM
#define STBI_NO_PSD
#define STBI_NO_TGA
#include "stb_image.h"

namespace h5 {

// svg.cpp (Skia): RGBA8 pixels of an SVG document at its own size (or w x h when given); false if not SVG
bool svg_rasterize(const uint8_t *data, size_t size, int want_w, int want_h, std::vector<uint8_t> &rgba, int &w, int &h);

namespace {

class ImageHandle final : public Handle {
public:
    ImageHandle(std::vector<uint8_t> &&px, int w, int h) : Handle(Kind::Image), m_px(std::move(px)), m_w(w), m_h(h) { }
    bool pixels(PixelView &v) override
    {
        v.data = m_px.data();
        v.width = m_w;
        v.height = m_h;
        v.stride = m_w * 4;
        v.premultiplied = false;
        return true;
    }
    size_t memory_cost() const override { return m_px.size(); }

private:
    std::vector<uint8_t> m_px;
    int m_w, m_h;
};

struct Decoded {
    std::vector<uint8_t> px;
    int w = 0, h = 0;
    std::string error;
};

bool looks_like_svg(const uint8_t *d, size_t n)
{
    const size_t look = std::min<size_t>(n, 512);
    for (size_t i = 0; i + 4 <= look; i++)
        if (d[i] == '<' && d[i + 1] == 's' && d[i + 2] == 'v' && d[i + 3] == 'g')
            return true;
    return false;
}

void decode(const std::vector<uint8_t> &bytes, Decoded &out)
{
    if (bytes.empty()) {
        out.error = "empty";
        return;
    }
    if (looks_like_svg(bytes.data(), bytes.size())) {
        if (!svg_rasterize(bytes.data(), bytes.size(), 0, 0, out.px, out.w, out.h))
            out.error = "SVG not drawn";
        return;
    }
    int w = 0, h = 0, n = 0;
    stbi_uc *px = stbi_load_from_memory(bytes.data(), static_cast<int>(bytes.size()), &w, &h, &n, 4);
    if (!px) {
        out.error = stbi_failure_reason() ? stbi_failure_reason() : "unknown format";
        return;
    }
    out.px.assign(px, px + static_cast<size_t>(w) * h * 4);
    stbi_image_free(px);
    out.w = w;
    out.h = h;
}

void finish(double id, unsigned gen, const std::shared_ptr<Decoded> &d, const std::string &what)
{
    if (gen != engine::generation() || !engine::running())
        return;
    JSGlobalContextRef ctx = engine::context();
    if (!d->error.empty() || d->w <= 0) {
        H5_WARN("image %s: %s", what.c_str(), d->error.c_str());
        engine::call_hook("complete", { JSValueMakeNumber(ctx, id), JSValueMakeNull(ctx) });
        return;
    }
    const int w = d->w, h = d->h;
    Handle *handle = new ImageHandle(std::move(d->px), w, h);
    JSObjectRef obj = make_handle(ctx, handle);
    engine::call_hook("complete", { JSValueMakeNumber(ctx, id), obj, JSValueMakeNumber(ctx, w), JSValueMakeNumber(ctx, h) });
}

H5_NATIVE(n_image_decode_file)
{
    const double id = H5_NUM(0);
    const std::string path = H5_STR(1);
    const unsigned gen = engine::generation();
    auto d = std::make_shared<Decoded>();
    if (!engine::path_allowed(path, false)) {
        d->error = "not allowed";
        post_main([id, gen, d, path] { finish(id, gen, d, path); });
        return H5_UNDEFINED;
    }
    post_job(
        [d, path] {
            std::vector<uint8_t> bytes;
            if (!read_file(path, bytes)) {
                d->error = "cannot read";
                return;
            }
            decode(bytes, *d);
        },
        [id, gen, d, path] { finish(id, gen, d, path); });
    return H5_UNDEFINED;
}

H5_NATIVE(n_image_decode_bytes)
{
    const double id = H5_NUM(0);
    const js::Bytes b = js::bytes_of(ctx, H5_ARG(1));
    const std::string what = argc > 2 ? H5_STR(2) : "(bytes)";
    const unsigned gen = engine::generation();
    auto bytes = std::make_shared<std::vector<uint8_t>>(static_cast<const uint8_t *>(b.data), static_cast<const uint8_t *>(b.data) + b.size);
    auto d = std::make_shared<Decoded>();
    post_job([bytes, d] { decode(*bytes, *d); }, [id, gen, d, what] { finish(id, gen, d, what); });
    return H5_UNDEFINED;
}

// imageCreate(width, height, rgbaBytes?) -> handle (ImageData -> a source for drawImage/texImage2D)
H5_NATIVE(n_image_create)
{
    const int w = std::max(1, H5_INT(0)), h = std::max(1, H5_INT(1));
    std::vector<uint8_t> px(static_cast<size_t>(w) * h * 4);
    const js::Bytes b = js::bytes_of(ctx, H5_ARG(2));
    if (b.data)
        memcpy(px.data(), b.data, std::min(px.size(), b.size));
    return make_handle(ctx, new ImageHandle(std::move(px), w, h));
}

// imageOpaqueBounds(handle, x, y, w, h) -> [x0, y0, x1, y1]: where the pixels of that region of an image or 2D
// canvas are not (nearly) transparent, relative to the region; null when none are (the runtime's selector
// frames what a button shows, not its transparent margins)
H5_NATIVE(n_image_opaque_bounds)
{
    Handle *handle = handle_of(ctx, H5_ARG(0));
    PixelView v;
    if (!handle || !handle->pixels(v) || !v.data)
        return JSValueMakeNull(ctx);
    const int x = std::max(0, H5_INT(1)), y = std::max(0, H5_INT(2));
    const int x1 = std::min(v.width, x + H5_INT(3)), y1 = std::min(v.height, y + H5_INT(4));
    int left = x1, right = -1, top = -1, bottom = -1;
    for (int row = y; row < y1; row++) {
        const uint8_t *p = v.data + static_cast<size_t>(row) * v.stride;
        int first = -1, last = -1;
        for (int col = x; col < x1; col++)
            if (p[col * 4 + 3] > 12) {
                first = col;
                break;
            }
        if (first < 0)
            continue;
        for (int col = x1 - 1; col >= first; col--)
            if (p[col * 4 + 3] > 12) {
                last = col;
                break;
            }
        left = std::min(left, first);
        right = std::max(right, last);
        if (top < 0)
            top = row;
        bottom = row;
    }
    if (right < 0)
        return JSValueMakeNull(ctx);
    JSValueRef r[4] = { JSValueMakeNumber(ctx, left - x), JSValueMakeNumber(ctx, top - y),
        JSValueMakeNumber(ctx, right + 1 - x), JSValueMakeNumber(ctx, bottom + 1 - y) };
    return JSObjectMakeArray(ctx, 4, r, nullptr);
}

void install(JSContextRef ctx, JSObjectRef h5)
{
    js::def(ctx, h5, "imageOpaqueBounds", n_image_opaque_bounds);
    js::def(ctx, h5, "imageDecodeFile", n_image_decode_file);
    js::def(ctx, h5, "imageDecodeBytes", n_image_decode_bytes);
    js::def(ctx, h5, "imageCreate", n_image_create);
}

struct Registration {
    Registration() { engine::register_natives("image", install); }
} g_registration;

} // namespace

// ---------------------------------------------------------------- handles
namespace {
JSClassRef handle_class()
{
    static JSClassRef cls = [] {
        JSClassDefinition def = kJSClassDefinitionEmpty;
        def.className = "NativeHandle";
        def.finalize = [](JSObjectRef obj) { delete static_cast<Handle *>(JSObjectGetPrivate(obj)); };
        return JSClassCreate(&def);
    }();
    return cls;
}
} // namespace

JSObjectRef make_handle(JSContextRef ctx, Handle *handle)
{
    if (const size_t cost = handle->memory_cost(); cost > 65536)
        JSReportExtraMemoryCost(ctx, cost);
    return JSObjectMake(ctx, handle_class(), handle);
}

Handle *handle_of(JSContextRef ctx, JSValueRef value)
{
    JSObjectRef obj = js::object_of(ctx, value);
    if (!obj || !JSValueIsObjectOfClass(ctx, value, handle_class()))
        return nullptr;
    return static_cast<Handle *>(JSObjectGetPrivate(obj));
}

} // namespace h5
