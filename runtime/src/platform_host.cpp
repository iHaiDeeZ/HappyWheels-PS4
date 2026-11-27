// h5 platform: the PC test build (Linux/WSL). Headless: an EGL surfaceless GLES 3 context, the "screen" is a
// 1920x1080 framebuffer written out as PNG when asked. Environment:
//   H5_GAME, H5_RUNTIME, H5_APP, H5_DATA   folders (defaults from the build tree)
//   H5_RUN_SECONDS=n     quit after n seconds
//   H5_SHOT_AT=3,8.5     write <data>/shots/frame-<seconds>.png at those times
//   H5_SHOT_EVERY=s      ... and every s seconds
//   H5_PAD="2000:b0=1;2100:b0=0;3000:a0=-1"   the controller's script (ms since start : button/axis = value)
//   H5_IME_TEXT=text     what the system keyboard answers
#include "platform.h"

#include "h5.h"

#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES3/gl3.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <dlfcn.h>
#include <sstream>
#include <thread>
#include <time.h>

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

namespace h5::platform {

namespace {
EGLDisplay g_display = EGL_NO_DISPLAY;
EGLContext g_context = EGL_NO_CONTEXT;
bool g_gl = false;
GLuint g_screen_fbo = 0, g_screen_rb = 0;
constexpr int W = 1920, H = 1080;
double g_quit_at = -1;
std::vector<double> g_shots;
double g_shot_every = 0, g_next_periodic = 0;
int g_frames = 0;

struct PadEvent {
    double t;
    bool axis;
    int index;
    float value;
};
std::vector<PadEvent> g_pad_script;
size_t g_pad_next = 0;
PadState g_pad;

std::string g_ime_text;
bool g_ime_open = false;
double g_ime_since = 0;

void *g_libgles = nullptr;

std::string env(const char *name, const std::string &fallback)
{
    const char *v = getenv(name);
    return v && *v ? v : fallback;
}

bool init_gl()
{
    auto get_platform_display = reinterpret_cast<PFNEGLGETPLATFORMDISPLAYEXTPROC>(eglGetProcAddress("eglGetPlatformDisplayEXT"));
    if (!get_platform_display) {
        H5_ERROR("EGL: no eglGetPlatformDisplayEXT");
        return false;
    }
    g_display = get_platform_display(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, nullptr);
    EGLint major = 0, minor = 0;
    if (g_display == EGL_NO_DISPLAY || !eglInitialize(g_display, &major, &minor)) {
        H5_ERROR("EGL: no surfaceless display (0x%x)", eglGetError());
        return false;
    }
    eglBindAPI(EGL_OPENGL_ES_API);
    const EGLint cfg_attrs[] = { EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT, EGL_NONE };
    EGLConfig cfg = nullptr;
    EGLint n = 0;
    eglChooseConfig(g_display, cfg_attrs, &cfg, 1, &n);
    const EGLint ctx_attrs[] = { EGL_CONTEXT_MAJOR_VERSION, 3, EGL_CONTEXT_MINOR_VERSION, 0, EGL_NONE };
    g_context = eglCreateContext(g_display, n ? cfg : EGL_NO_CONFIG_KHR, EGL_NO_CONTEXT, ctx_attrs);
    if (g_context == EGL_NO_CONTEXT || !eglMakeCurrent(g_display, EGL_NO_SURFACE, EGL_NO_SURFACE, g_context)) {
        H5_ERROR("EGL: no GLES 3 context (0x%x)", eglGetError());
        return false;
    }
    g_libgles = dlopen("libGLESv2.so.2", RTLD_NOW | RTLD_GLOBAL);
    auto gen_fb = reinterpret_cast<void (*)(GLsizei, GLuint *)>(gl_proc("glGenFramebuffers"));
    auto gen_rb = reinterpret_cast<void (*)(GLsizei, GLuint *)>(gl_proc("glGenRenderbuffers"));
    auto bind_rb = reinterpret_cast<void (*)(GLenum, GLuint)>(gl_proc("glBindRenderbuffer"));
    auto storage = reinterpret_cast<void (*)(GLenum, GLenum, GLsizei, GLsizei)>(gl_proc("glRenderbufferStorage"));
    auto bind_fb = reinterpret_cast<void (*)(GLenum, GLuint)>(gl_proc("glBindFramebuffer"));
    auto attach = reinterpret_cast<void (*)(GLenum, GLenum, GLenum, GLuint)>(gl_proc("glFramebufferRenderbuffer"));
    auto get_string = reinterpret_cast<const GLubyte *(*)(GLenum)>(gl_proc("glGetString"));
    gen_fb(1, &g_screen_fbo);
    gen_rb(1, &g_screen_rb);
    bind_rb(GL_RENDERBUFFER, g_screen_rb);
    storage(GL_RENDERBUFFER, GL_RGBA8, W, H);
    bind_fb(GL_FRAMEBUFFER, g_screen_fbo);
    attach(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, g_screen_rb);
    bind_fb(GL_FRAMEBUFFER, 0);
    H5_INFO("GL: EGL %d.%d surfaceless; %s / %s / %s", major, minor, get_string(GL_VENDOR), get_string(GL_RENDERER),
        get_string(GL_VERSION));
    return true;
}

void parse_pad_script(const std::string &s)
{
    std::istringstream in(s);
    std::string item;
    while (std::getline(in, item, ';')) {
        const size_t colon = item.find(':'), eq = item.find('=');
        if (colon == std::string::npos || eq == std::string::npos || eq < colon + 2)
            continue;
        PadEvent e;
        e.t = atof(item.substr(0, colon).c_str());
        e.axis = item[colon + 1] == 'a';
        e.index = atoi(item.substr(colon + 2, eq - colon - 2).c_str());
        e.value = static_cast<float>(atof(item.substr(eq + 1).c_str()));
        g_pad_script.push_back(e);
    }
    std::sort(g_pad_script.begin(), g_pad_script.end(), [](const PadEvent &a, const PadEvent &b) { return a.t < b.t; });
}

void write_shot(const char *why)
{
    if (!g_gl)
        return;
    auto read = reinterpret_cast<void (*)(GLint, GLint, GLsizei, GLsizei, GLenum, GLenum, void *)>(gl_proc("glReadPixels"));
    auto bind_fb = reinterpret_cast<void (*)(GLenum, GLuint)>(gl_proc("glBindFramebuffer"));
    auto get_int = reinterpret_cast<void (*)(GLenum, GLint *)>(gl_proc("glGetIntegerv"));
    GLint previous = 0;
    get_int(GL_READ_FRAMEBUFFER_BINDING, &previous);
    bind_fb(GL_READ_FRAMEBUFFER, g_screen_fbo);
    std::vector<uint8_t> px(static_cast<size_t>(W) * H * 4);
    read(0, 0, W, H, GL_RGBA, GL_UNSIGNED_BYTE, px.data());
    bind_fb(GL_READ_FRAMEBUFFER, static_cast<GLuint>(previous));
    // half size, flipped (GL rows are bottom-up), opaque
    const int w = W / 2, h = H / 2;
    std::vector<uint8_t> out(static_cast<size_t>(w) * h * 3);
    for (int y = 0; y < h; y++)
        for (int x = 0; x < w; x++)
            for (int c = 0; c < 3; c++) {
                const uint8_t *s = &px[(static_cast<size_t>(H - 1 - y * 2) * W + x * 2) * 4];
                out[(static_cast<size_t>(y) * w + x) * 3 + c] = s[c];
            }
    make_dirs(paths.data + "/shots");
    char name[512];
    snprintf(name, sizeof name, "%s/shots/frame-%07.2f.png", paths.data.c_str(), now_ms() / 1000.0);
    stbi_write_png(name, w, h, 3, out.data(), w * 3);
    H5_INFO("shot (%s): %s", why, name);
}
} // namespace

bool init(int, char **)
{
    const std::string hb = env("HB", std::string(getenv("HOME") ? getenv("HOME") : ".") + "/hw-build");
    paths.game = env("H5_GAME", "/mnt/e/PS4 Projects/Happy Wheels/resources/webroot");
    paths.runtime = env("H5_RUNTIME", "/mnt/e/PS4 Projects/HappyWheels-PS4/runtime");
    paths.app = env("H5_APP", "/mnt/e/PS4 Projects/HappyWheels-PS4/app");
    paths.data = env("H5_DATA", hb + "/run/data");
    make_dirs(paths.data);
    log_open(paths.data + "/h5.log");
    H5_INFO("h5 (PC test build): game %s, data %s", paths.game.c_str(), paths.data.c_str());
    if (const char *s = getenv("H5_RUN_SECONDS"))
        g_quit_at = atof(s) * 1000.0;
    if (const char *s = getenv("H5_SHOT_AT")) {
        std::istringstream in(s);
        std::string item;
        while (std::getline(in, item, ','))
            g_shots.push_back(atof(item.c_str()) * 1000.0);
        std::sort(g_shots.begin(), g_shots.end());
    }
    if (const char *s = getenv("H5_SHOT_EVERY"))
        g_shot_every = atof(s) * 1000.0;
    g_next_periodic = g_shot_every;
    parse_pad_script(env("H5_PAD", ""));
    g_pad.connected = !g_pad_script.empty() || getenv("H5_PAD_CONNECTED");
    g_ime_text = env("H5_IME_TEXT", "test");
    g_gl = getenv("H5_NO_GL") ? false : init_gl();
    return true;
}

void shutdown()
{
    if (g_display != EGL_NO_DISPLAY) {
        eglMakeCurrent(g_display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
        eglDestroyContext(g_display, g_context);
        eglTerminate(g_display);
    }
}

bool has_gl() { return g_gl; }
int screen_width() { return W; }
int screen_height() { return H; }
unsigned screen_framebuffer() { return g_screen_fbo; }

void *gl_proc(const char *name)
{
    void *p = reinterpret_cast<void *>(eglGetProcAddress(name));
    if (!p && g_libgles)
        p = dlsym(g_libgles, name);
    return p;
}

void present()
{
    g_frames++;
    const double now = now_ms();
    while (!g_shots.empty() && now >= g_shots.front()) {
        g_shots.erase(g_shots.begin());
        write_shot("asked");
    }
    if (g_shot_every > 0 && now >= g_next_periodic) {
        g_next_periodic += g_shot_every;
        write_shot("periodic");
    }
}

void sleep_until(double until_ms)
{
    const double wait = until_ms - now_ms();
    if (wait > 0.2)
        std::this_thread::sleep_for(std::chrono::microseconds(static_cast<long long>(wait * 1000)));
}

double frame_period_ms() { return 1000.0 / 60.0; }
bool present_paces() { return false; }

void read_pad(PadState &state)
{
    const double now = now_ms();
    while (g_pad_next < g_pad_script.size() && g_pad_script[g_pad_next].t <= now) {
        const PadEvent &e = g_pad_script[g_pad_next++];
        if (e.axis && e.index >= 0 && e.index < 4) {
            g_pad.axes[e.index] = e.value;
        } else if (e.axis && e.index == 4) {   // a4/a5: the touch pad's finger (0..1); a6: fingers down
            g_pad.touch_x = e.value;
        } else if (e.axis && e.index == 5) {
            g_pad.touch_y = e.value;
        } else if (e.axis && e.index == 6) {
            const int n = static_cast<int>(e.value);
            if (n > 0 && g_pad.touches == 0)
                g_pad.touch_id++;
            g_pad.touches = n;
        }
        else if (!e.axis && e.index >= 0 && e.index < 17)
            g_pad.buttons[e.index] = e.value;
        H5_INFO("pad script: %s%d = %.2f", e.axis ? "a" : "b", e.index, e.value);
    }
    state = g_pad;
}

bool ime_open(const std::string &title, const std::string &text, int, bool)
{
    H5_INFO("keyboard opened: \"%s\" (\"%s\"); answering \"%s\"", title.c_str(), text.c_str(), g_ime_text.c_str());
    g_ime_open = true;
    g_ime_since = now_ms();
    return true;
}

int ime_poll(std::string &text)
{
    if (!g_ime_open)
        return -2;
    if (now_ms() - g_ime_since < 300)
        return 0;
    g_ime_open = false;
    text = g_ime_text;
    return 1;
}

bool audio_start(int, int, AudioFill, void *) { return false; }
void audio_stop() { }

bool quit_requested()
{
    return g_quit_at >= 0 && now_ms() >= g_quit_at;
}

void exit_app(int code)
{
    H5_INFO("exit %d after %d frames", code, g_frames);
    exit(code);
}

} // namespace h5::platform
