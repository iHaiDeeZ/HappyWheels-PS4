// h5 platform: the PS4 (ps4-kit). OpenGL ES 3 on Zink/RADV through Mesa's ps4gl frontend (a 1920x1080 window
// on VideoOut), the DualShock 4 (scePad) in W3C standard order, sceAudioOut, sceImeDialog.
// JavaScriptCore gets the environment OrbisWeb's web process gives it (JIT memory, polling traps, GC signal).
#include "platform.h"

#include "h5.h"

#include <ps4_gl.h>
#include <ps4_kit.h>
#include <ps4_vk_wsi.h>

#include <orbis/AudioOut.h>
#include <orbis/CommonDialog.h>
#include <orbis/ImeDialog.h>
#include <orbis/Pad.h>
#include <orbis/Sysmodule.h>
#include <orbis/UserService.h>

#include <unicode/putil.h>
#include <unicode/ucal.h>
#include <unicode/udata.h>

#include <algorithm>
#include <atomic>
#include <cerrno>
#include <cmath>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <fcntl.h>
#include <pthread.h>
#include <semaphore.h>
#include <sys/stat.h>
#include <thread>
#include <unistd.h>

extern "C" int32_t sceSystemServiceParamGetInt(int32_t id, int32_t *value);

// Zink's Vulkan entry (ps4_gl.h): the kit's RADV with its VideoOut surface and swapchain
extern "C" void *zink_ps4_vk_get_instance_proc_addr(void)
{
    return ps4kit_vk_get_instance_proc_addr();
}

// Weak references nothing defines become imports, and create-fself refuses the eboot ("missing module for
// symbol"): Mesa's TLS-init symbol for its GL context pointer (Etterna), WTF's LeakSanitizer hooks (OrbisWeb)
extern "C" void _ZTH23_mesa_glapi_tls_Context() { }
extern "C" void __lsan_disable() { }
extern "C" void __lsan_enable() { }
extern "C" void __lsan_ignore_object(const void *) { }

namespace h5::platform {

namespace {
constexpr int W = 1920, H = 1080;
const char *DATA = "/data/HappyWheels";

ps4gl_window *g_window = nullptr;
ps4gl_context *g_context = nullptr;
bool g_gl = false;
int g_frames = 0;

// ---------------------------------------------------------------- ICU's data (31 MiB) read into the heap
void icu_setup()
{
    const std::string path = paths.runtime + "/icudt77l.dat";
    std::vector<uint8_t> bytes;
    const double t0 = now_ms();
    if (!read_file(path, bytes)) {
        H5_ERROR("ICU: cannot read %s: JavaScript's Intl and dates fall back", path.c_str());
        return;
    }
    void *data = malloc(bytes.size());
    memcpy(data, bytes.data(), bytes.size());
    std::vector<uint8_t>().swap(bytes);
    UErrorCode status = U_ZERO_ERROR;
    udata_setCommonData(data, &status);
    if (U_SUCCESS(status)) {
        u_setDataDirectory("/app0/h5/icu-data-is-in-memory");
        UErrorCode access = U_ZERO_ERROR;
        udata_setFileAccess(UDATA_ONLY_PACKAGES, &access);
    }
    H5_INFO("ICU: data read (%.0f ms): %s", now_ms() - t0, u_errorName(status));
    // the console's time zone for Date and Intl (OrbisWeb's wisp_platform_setup)
    int32_t zone = 0, summer = 0;
    if (sceSystemServiceParamGetInt(4, &zone) == 0) {
        if (sceSystemServiceParamGetInt(5, &summer) == 0 && summer)
            zone += 60;
        if (zone >= -14 * 60 && zone <= 14 * 60) {
            char id[24];
            const int hours = (zone >= 0 ? zone + 30 : zone - 30) / 60;
            if (zone % 60 == 0 && hours)
                snprintf(id, sizeof id, "Etc/GMT%+d", -hours);
            else
                snprintf(id, sizeof id, "Etc/UTC");
            UChar uid[24];
            int n = 0;
            for (; id[n] && n < 23; n++)
                uid[n] = static_cast<UChar>(id[n]);
            uid[n] = 0;
            UErrorCode zs = U_ZERO_ERROR;
            ucal_setDefaultTimeZone(uid, &zs);
            char tz[24];
            const int a = std::abs(zone);
            snprintf(tz, sizeof tz, "<%c%02d%02d>%c%d:%02d", zone >= 0 ? '+' : '-', a / 60, a % 60, zone >= 0 ? '-' : '+', a / 60, a % 60);
            setenv("TZ", tz, 1);
            tzset();
            H5_INFO("time zone: UTC%+d:%02d (%s)", zone / 60, a % 60, id);
        }
    }
}

// ---------------------------------------------------------------- JavaScriptCore's environment
// The JIT's code goes to executable memory the kit finds on this console (ps4_exec_probe); traps are
// polled (signal ones would reach the kit's crash handler); the collector stops threads with signal 29
// (the kit's thread dumps use SIGUSR1). Concurrent marking only when a thread really stops and resumes
// on that signal here (OrbisWeb's check).
namespace gc_check {
constexpr int SIGNAL = 29;
sem_t posted;
std::atomic<int> stage { 0 };
std::atomic<unsigned long> spins { 0 };
std::atomic<bool> finished { false };
void handler(int, siginfo_t *, void *)
{
    if (stage.load() != 1)
        return;
    stage.store(2);
    sem_post(&posted);
    sigset_t allowed;
    sigfillset(&allowed);
    sigdelset(&allowed, SIGNAL);
    sigsuspend(&allowed);
    stage.store(4);
    sem_post(&posted);
}
void *spinner(void *)
{
    while (!finished.load(std::memory_order_relaxed))
        spins.fetch_add(1, std::memory_order_relaxed);
    return nullptr;
}
bool posted_within(int ms)
{
    const double until = now_ms() + ms;
    do {
        if (!sem_trywait(&posted))
            return true;
        usleep(100);
    } while (now_ms() < until);
    return false;
}
bool spinning_within(int ms)
{
    const unsigned long before = spins.load();
    const double until = now_ms() + ms;
    do {
        usleep(200);
        if (spins.load() != before)
            return true;
    } while (now_ms() < until);
    return false;
}
const char *run()
{
    if (sem_init(&posted, 0, 0))
        return "no semaphore";
    struct sigaction action {}, previous {};
    sigemptyset(&action.sa_mask);
    sigaddset(&action.sa_mask, SIGNAL);
    action.sa_sigaction = handler;
    action.sa_flags = SA_RESTART | SA_SIGINFO;
    if (sigaction(SIGNAL, &action, &previous))
        return "no signal handler";
    pthread_t thread;
    if (pthread_create(&thread, nullptr, spinner, nullptr)) {
        sigaction(SIGNAL, &previous, nullptr);
        return "no thread";
    }
    const char *failure = nullptr;
    if (!spinning_within(500))
        failure = "the test thread did not run";
    else {
        stage.store(1);
        if (pthread_kill(thread, SIGNAL) || !posted_within(500) || stage.load() != 2)
            failure = "a thread did not stop on the signal";
        else {
            const unsigned long held = spins.load();
            usleep(3000);
            if (spins.load() != held)
                failure = "a stopped thread kept running";
            stage.store(3);
            if (pthread_kill(thread, SIGNAL) || !posted_within(500) || stage.load() != 4)
                failure = "a stopped thread did not resume on the signal";
            else if (!failure && !spinning_within(500))
                failure = "a resumed thread did not run again";
        }
    }
    finished.store(true);
    if (failure) {
        pthread_detach(thread);
        return failure;
    }
    pthread_join(thread, nullptr);
    sigaction(SIGNAL, &previous, nullptr);
    sem_destroy(&posted);
    return nullptr;
}
} // namespace gc_check

void jsc_environment()
{
    setenv("JSC_SIGNAL_FOR_GC", "29", 1);
    setenv("WTF_numberOfProcessorCores", "7", 0);
    signal(SIGPIPE, SIG_IGN);
    const int source = ps4_exec_probe();
    if (source < 0) {
        setenv("JSC_useJIT", "false", 1);
        H5_WARN("JavaScriptCore: this console runs no generated code: the LLInt interpreter (slow)");
    } else {
        const bool shared_pool = source >= 1 && source <= 3;
        const unsigned mib = shared_pool ? 32 : 128;
        char bytes[32];
        snprintf(bytes, sizeof bytes, "%llu", static_cast<unsigned long long>(mib) << 20);
        setenv("JSC_jitMemoryReservationSize", bytes, 1);
        setenv("JSC_usePollingTraps", "true", 1);
        setenv("JSC_maximumFTLCandidateBytecodeCost", "20000", 1);
        // compiler threads a step below the main thread: the PS4 gives equal priorities no turns
        ps4_kit_set_thread_priority_by_name("JIT Worklist Helper Thread", 720);
        H5_INFO("JavaScriptCore: JIT (Baseline, DFG, FTL), code in %u MiB of %s", mib, ps4_kit_exec_source());
    }
    setenv("JSC_useWasmFaultSignalHandler", "false", 1);
    setenv("JSC_useWasmFastMemory", "false", 1);
    const double t0 = now_ms();
    const char *failure = gc_check::run();
    setenv("JSC_useConcurrentGC", failure ? "false" : "true", 1);
    if (failure)
        H5_WARN("JavaScriptCore: the plain collector: %s (signal %d)", failure, gc_check::SIGNAL);
    else
        H5_INFO("JavaScriptCore: concurrent collector (signal %d checked in %.1f ms)", gc_check::SIGNAL, now_ms() - t0);
}

// ---------------------------------------------------------------- the controller
int32_t g_pad = -1;
double g_pad_scan = -1e9;

float stick(uint8_t v)
{
    const float f = (static_cast<float>(v) - 128.0f) / 127.0f;
    const float a = std::fabs(f), dead = 0.12f;
    if (a < dead)
        return 0;
    const float s = std::min(1.0f, (a - dead) / (1.0f - dead));
    return f < 0 ? -s : s;
}

void open_pad()
{
    int32_t user = -1;
    if (sceUserServiceGetInitialUser(&user) != 0 || user == -1)
        return;
    const int32_t handle = scePadOpen(user, 0, 0, nullptr);
    if (handle >= 0) {
        g_pad = handle;
        H5_INFO("pad: user %x, handle %d", static_cast<unsigned>(user), handle);
    }
}

// ---------------------------------------------------------------- sound
std::thread g_audio_thread;
std::atomic<bool> g_audio_stop { false };
int32_t g_audio_port = -1;

// ---------------------------------------------------------------- the system keyboard
constexpr uint32_t IME_MAX = 255;
char16_t g_ime_text[IME_MAX + 2];
char16_t g_ime_title[128];
bool g_ime_open = false;

void to_utf16(const std::string &in, char16_t *out, size_t size)
{
    size_t n = 0;
    for (size_t i = 0; i < in.size() && n + 2 < size;) {
        const unsigned char c = in[i];
        uint32_t cp = c;
        int extra = c >= 0xf0 ? 3 : c >= 0xe0 ? 2 : c >= 0xc0 ? 1 : 0;
        if (extra)
            cp = c & (0x3f >> extra);
        i++;
        for (; extra > 0 && i < in.size(); extra--, i++)
            cp = (cp << 6) | (in[i] & 0x3f);
        if (cp >= 0x10000) {
            cp -= 0x10000;
            out[n++] = static_cast<char16_t>(0xd800 + (cp >> 10));
            out[n++] = static_cast<char16_t>(0xdc00 + (cp & 0x3ff));
        } else {
            out[n++] = static_cast<char16_t>(cp);
        }
    }
    out[n] = 0;
}

std::string from_utf16(const char16_t *in)
{
    std::string out;
    for (size_t i = 0; in[i]; i++) {
        uint32_t cp = in[i];
        if (cp >= 0xd800 && cp < 0xdc00 && in[i + 1] >= 0xdc00 && in[i + 1] < 0xe000)
            cp = 0x10000 + ((cp - 0xd800) << 10) + (in[++i] - 0xdc00);
        if (cp < 0x80)
            out += static_cast<char>(cp);
        else if (cp < 0x800) {
            out += static_cast<char>(0xc0 | (cp >> 6));
            out += static_cast<char>(0x80 | (cp & 0x3f));
        } else if (cp < 0x10000) {
            out += static_cast<char>(0xe0 | (cp >> 12));
            out += static_cast<char>(0x80 | ((cp >> 6) & 0x3f));
            out += static_cast<char>(0x80 | (cp & 0x3f));
        } else {
            out += static_cast<char>(0xf0 | (cp >> 18));
            out += static_cast<char>(0x80 | ((cp >> 12) & 0x3f));
            out += static_cast<char>(0x80 | ((cp >> 6) & 0x3f));
            out += static_cast<char>(0x80 | (cp & 0x3f));
        }
    }
    return out;
}
} // namespace

bool init(int, char **)
{
    paths.game = "/app0/webroot";
    paths.runtime = "/app0/h5";
    paths.app = "/app0/app";
    paths.data = DATA;
    make_dirs(paths.data);
    log_open(paths.data + "/h5.log");
    H5_INFO("Happy Wheels (h5) for PS4: game %s, data %s", paths.game.c_str(), paths.data.c_str());
    sceUserServiceInitialize(nullptr);
    icu_setup();
    jsc_environment();
    setenv("MESA_SHADER_CACHE_DIR", (paths.data + "/cache/mesa").c_str(), 1);
    make_dirs(paths.data + "/cache/mesa");

    const double t0 = now_ms();
    if (!ps4gl_initialize()) {
        H5_ERROR("GL: Zink did not start: %s", ps4gl_error());
    } else {
        g_window = ps4gl_create_window(W, H, 24, 8);
        g_context = g_window ? ps4gl_create_context(g_window, true, 3, 0, false) : nullptr;
        if (g_context && ps4gl_make_current(g_context)) {
            ps4gl_set_swap_interval(g_context, 1);
            g_gl = true;
            auto get_string = reinterpret_cast<const unsigned char *(*)(unsigned)>(ps4gl_get_proc_address("glGetString"));
            H5_INFO("GL: %s / %s (%.0f ms)", get_string ? reinterpret_cast<const char *>(get_string(0x1F01)) : "?",
                get_string ? reinterpret_cast<const char *>(get_string(0x1F02)) : "?", now_ms() - t0);
        } else {
            H5_ERROR("GL: no window or context: %s", ps4gl_error());
        }
    }
    scePadInit();
    open_pad();
    return true;
}

void shutdown()
{
    audio_stop();
}

bool has_gl() { return g_gl; }
int screen_width() { return W; }
int screen_height() { return H; }
unsigned screen_framebuffer() { return 0; }
void *gl_proc(const char *name) { return ps4gl_get_proc_address(name); }

void present()
{
    if (g_context)
        ps4gl_swap_buffers(g_context);
    g_frames++;
}

void sleep_until(double until_ms)
{
    const double wait = until_ms - now_ms();
    if (wait > 0.2)
        usleep(static_cast<useconds_t>(wait * 1000));
}

double frame_period_ms() { return 1000.0 / 60.0; }
bool present_paces() { return g_gl; }

void read_pad(PadState &s)
{
    s = PadState();
    if (g_pad < 0) {
        if (now_ms() - g_pad_scan > 2000) {
            g_pad_scan = now_ms();
            open_pad();
        }
        if (g_pad < 0)
            return;
    }
    OrbisPadData d {};
    if (scePadReadState(g_pad, &d) != 0 || !d.connected)
        return;
    s.connected = true;
    const uint32_t b = d.buttons;
    auto bit = [&](uint32_t m) { return (b & m) ? 1.0f : 0.0f; };
    s.buttons[0] = bit(ORBIS_PAD_BUTTON_CROSS);
    s.buttons[1] = bit(ORBIS_PAD_BUTTON_CIRCLE);
    s.buttons[2] = bit(ORBIS_PAD_BUTTON_SQUARE);
    s.buttons[3] = bit(ORBIS_PAD_BUTTON_TRIANGLE);
    s.buttons[4] = bit(ORBIS_PAD_BUTTON_L1);
    s.buttons[5] = bit(ORBIS_PAD_BUTTON_R1);
    s.buttons[6] = d.analogButtons.l2 / 255.0f;
    s.buttons[7] = d.analogButtons.r2 / 255.0f;
    s.buttons[8] = bit(ORBIS_PAD_BUTTON_TOUCH_PAD);   // (Select: Share is the system's)
    s.buttons[9] = bit(ORBIS_PAD_BUTTON_OPTIONS);
    s.buttons[10] = bit(ORBIS_PAD_BUTTON_L3);
    s.buttons[11] = bit(ORBIS_PAD_BUTTON_R3);
    s.buttons[12] = bit(ORBIS_PAD_BUTTON_UP);
    s.buttons[13] = bit(ORBIS_PAD_BUTTON_DOWN);
    s.buttons[14] = bit(ORBIS_PAD_BUTTON_LEFT);
    s.buttons[15] = bit(ORBIS_PAD_BUTTON_RIGHT);
    s.axes[0] = stick(d.leftStick.x);
    s.axes[1] = stick(d.leftStick.y);
    s.axes[2] = stick(d.rightStick.x);
    s.axes[3] = stick(d.rightStick.y);
    // the touch pad (DualShock 4: x 0..1919, y 0..941)
    s.touches = std::min<int>(d.touch.fingers, ORBIS_PAD_MAX_TOUCH_NUM);
    if (s.touches > 0) {
        s.touch_x = std::clamp(d.touch.touch[0].x / 1919.0f, 0.0f, 1.0f);
        s.touch_y = std::clamp(d.touch.touch[0].y / 941.0f, 0.0f, 1.0f);
        s.touch_id = d.touch.touch[0].finger;
    }
}

bool ime_open(const std::string &title, const std::string &text, int max_length, bool multiline)
{
    if (g_ime_open)
        return false;
    static bool loaded = false;
    if (!loaded) {
        sceSysmoduleLoadModule(ORBIS_SYSMODULE_IME_DIALOG);
        sceSysmoduleLoadModuleInternal(ORBIS_SYSMODULE_INTERNAL_COMMON_DIALOG);
        sceCommonDialogInitialize();
        loaded = true;
    }
    to_utf16(text, g_ime_text, IME_MAX + 1);
    to_utf16(title, g_ime_title, sizeof g_ime_title / sizeof g_ime_title[0]);
    int32_t user = -1;
    sceUserServiceGetInitialUser(&user);
    OrbisImeDialogSetting setting {};
    setting.userId = static_cast<uint32_t>(user);
    setting.type = ORBIS_TYPE_DEFAULT;
    setting.option = multiline ? 0x1 : 0;
    setting.maxTextLength = max_length > 0 ? std::min<uint32_t>(IME_MAX, static_cast<uint32_t>(max_length)) : IME_MAX;
    setting.inputTextBuffer = reinterpret_cast<wchar_t *>(g_ime_text);
    setting.posx = W / 2.0f;
    setting.posy = H / 2.0f;
    setting.horizontalAlignment = ORBIS_H_CENTER;
    setting.verticalAlignment = ORBIS_V_CENTER;
    setting.title = reinterpret_cast<const wchar_t *>(g_ime_title);
    int32_t result = sceImeDialogInit(&setting, nullptr);
    if (result < 0 && setting.option) {
        setting.option = 0;
        result = sceImeDialogInit(&setting, nullptr);
    }
    H5_INFO("keyboard: open (%08x)", static_cast<unsigned>(result));
    g_ime_open = result >= 0;
    return g_ime_open;
}

int ime_poll(std::string &text)
{
    if (!g_ime_open)
        return -2;
    const OrbisDialogStatus status = sceImeDialogGetStatus();
    if (status == ORBIS_DIALOG_STATUS_RUNNING)
        return 0;
    OrbisDialogResult result {};
    if (status == ORBIS_DIALOG_STATUS_STOPPED)
        sceImeDialogGetResult(&result);
    sceImeDialogTerm();
    g_ime_open = false;
    if (status == ORBIS_DIALOG_STATUS_STOPPED && result.endstatus == ORBIS_DIALOG_OK) {
        text = from_utf16(g_ime_text);
        return 1;
    }
    return -1;
}

bool audio_start(int rate, int frames_per_block, AudioFill fill, void *user)
{
    sceAudioOutInit();
    g_audio_port = sceAudioOutOpen(255, ORBIS_AUDIO_OUT_PORT_TYPE_MAIN, 0, frames_per_block, rate, ORBIS_AUDIO_OUT_PARAM_FORMAT_S16_STEREO);
    if (g_audio_port < 0) {
        int32_t player = -1;
        sceUserServiceGetInitialUser(&player);
        g_audio_port = sceAudioOutOpen(player, ORBIS_AUDIO_OUT_PORT_TYPE_MAIN, 0, frames_per_block, rate, ORBIS_AUDIO_OUT_PARAM_FORMAT_S16_STEREO);
    }
    if (g_audio_port < 0) {
        H5_ERROR("audio: sceAudioOutOpen failed (%08x)", static_cast<unsigned>(g_audio_port));
        return false;
    }
    g_audio_stop = false;
    g_audio_thread = std::thread([fill, user, frames_per_block] {
        ps4_kit_set_thread_priority(400);   // above the game's threads: a late block is a click
        std::vector<int16_t> block(static_cast<size_t>(frames_per_block) * 2);
        while (!g_audio_stop.load()) {
            fill(block.data(), frames_per_block, user);
            sceAudioOutOutput(g_audio_port, block.data());   // waits for the previous block
        }
        sceAudioOutOutput(g_audio_port, nullptr);
    });
    return true;
}

void audio_stop()
{
    if (g_audio_port < 0)
        return;
    g_audio_stop = true;
    if (g_audio_thread.joinable())
        g_audio_thread.join();
    sceAudioOutClose(g_audio_port);
    g_audio_port = -1;
}

bool quit_requested()
{
    return false;
}

void exit_app(int code)
{
    H5_INFO("exit %d after %d frames", code, g_frames);
    ps4_kit_exit(code);
}

} // namespace h5::platform
