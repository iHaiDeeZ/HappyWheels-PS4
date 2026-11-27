// h5: the JavaScript world (one JavaScriptCore context at a time), its core natives and the calls into it.
#include "engine.h"
#include "h5.h"

#include <algorithm>
#include <cstring>
#include <map>
#include <memory>
#include <random>
#include <sstream>

#include <dirent.h>
#include <sys/stat.h>
#include <unistd.h>

namespace h5::engine {

namespace {

struct Module {
    const char *name;
    Installer installer;
};
std::vector<Module> &modules()
{
    static std::vector<Module> list;
    return list;
}

JSContextGroupRef g_group = nullptr;
JSGlobalContextRef g_ctx = nullptr;
JSObjectRef g_h5 = nullptr;
std::map<std::string, JSObjectRef> g_hooks;   // protected while the context lives
unsigned g_generation = 0;
bool g_reload = false;
bool g_exit = false;
int g_exit_code = 0;

// ---------------------------------------------------------------- core natives

H5_NATIVE(n_log)
{
    const int level = H5_INT(0);
    const std::string text = H5_STR(1);
    log(level <= 0 ? Level::Debug : level == 1 ? Level::Info : level == 2 ? Level::Warn : Level::Error, "%s", text.c_str());
    return H5_UNDEFINED;
}

H5_NATIVE(n_now)
{
    return JSValueMakeNumber(ctx, now_ms());
}

H5_NATIVE(n_wall_now)
{
    return JSValueMakeNumber(ctx, wall_ms());
}

H5_NATIVE(n_read_bytes)
{
    const std::string path = H5_STR(0);
    if (!path_allowed(path, false))
        return JSValueMakeNull(ctx);
    std::vector<uint8_t> data;
    if (!read_file(path, data))
        return JSValueMakeNull(ctx);
    return js::make_array_buffer(ctx, std::move(data));
}

H5_NATIVE(n_read_text)
{
    const std::string path = H5_STR(0);
    if (!path_allowed(path, false))
        return JSValueMakeNull(ctx);
    std::vector<uint8_t> data;
    if (!read_file(path, data))
        return JSValueMakeNull(ctx);
    return js::make_string(ctx, std::string(data.begin(), data.end()));
}

// readAsync(id, path): hooks.complete(id, ArrayBuffer | null) later
H5_NATIVE(n_read_async)
{
    const double id = H5_NUM(0);
    const std::string path = H5_STR(1);
    const unsigned gen = g_generation;
    if (!path_allowed(path, false)) {
        post_main([id, gen] {
            if (gen != g_generation || !g_ctx)
                return;
            call_hook("complete", { JSValueMakeNumber(g_ctx, id), JSValueMakeNull(g_ctx) });
        });
        return H5_UNDEFINED;
    }
    auto data = std::make_shared<std::vector<uint8_t>>();
    auto ok = std::make_shared<bool>(false);
    post_job([path, data, ok] { *ok = read_file(path, *data); },
        [id, gen, data, ok] {
            if (gen != g_generation || !g_ctx)
                return;
            JSValueRef result = *ok ? static_cast<JSValueRef>(js::make_array_buffer(g_ctx, std::move(*data))) : JSValueMakeNull(g_ctx);
            call_hook("complete", { JSValueMakeNumber(g_ctx, id), result });
        });
    return H5_UNDEFINED;
}

H5_NATIVE(n_write_file)
{
    const std::string path = H5_STR(0);
    if (!path_allowed(path, true))
        return JSValueMakeBoolean(ctx, false);
    JSValueRef data = H5_ARG(1);
    bool ok;
    if (JSValueIsString(ctx, data)) {
        const std::string text = js::to_string(ctx, data);
        ok = write_file_atomic(path, text.data(), text.size());
    } else {
        const js::Bytes b = js::bytes_of(ctx, data);
        ok = b.data ? write_file_atomic(path, b.data, b.size) : false;
    }
    return JSValueMakeBoolean(ctx, ok);
}

int remove_tree(const std::string &path)
{
    struct stat st {};
    if (lstat(path.c_str(), &st))
        return -1;
    if (S_ISDIR(st.st_mode)) {
        if (DIR *d = opendir(path.c_str())) {
            while (dirent *e = readdir(d)) {
                if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, ".."))
                    continue;
                remove_tree(path + "/" + e->d_name);
            }
            closedir(d);
        }
        return rmdir(path.c_str());
    }
    return unlink(path.c_str());
}

H5_NATIVE(n_remove)
{
    const std::string path = H5_STR(0);
    if (!path_allowed(path, true) || path.size() <= paths.data.size())
        return JSValueMakeBoolean(ctx, false);
    return JSValueMakeBoolean(ctx, remove_tree(path) == 0);
}

H5_NATIVE(n_list_dir)
{
    const std::string path = H5_STR(0);
    if (!path_allowed(path, false))
        return JSValueMakeNull(ctx);
    DIR *d = opendir(path.c_str());
    if (!d)
        return JSValueMakeNull(ctx);
    std::vector<JSValueRef> names;
    while (dirent *e = readdir(d)) {
        if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, ".."))
            continue;
        names.push_back(js::make_string(ctx, e->d_name));
    }
    closedir(d);
    return JSObjectMakeArray(ctx, names.size(), names.data(), nullptr);
}

H5_NATIVE(n_mkdirs)
{
    const std::string path = H5_STR(0);
    return JSValueMakeBoolean(ctx, path_allowed(path, true) && make_dirs(path));
}

H5_NATIVE(n_exists)
{
    const std::string path = H5_STR(0);
    return JSValueMakeBoolean(ctx, path_allowed(path, false) && file_exists(path));
}

H5_NATIVE(n_random)
{
    static std::mt19937_64 rng(std::random_device {}() ^ static_cast<uint64_t>(wall_ms()));
    const js::Bytes b = js::bytes_of(ctx, H5_ARG(0));
    auto *p = static_cast<uint8_t *>(b.data);
    for (size_t i = 0; i < b.size; i += 8) {
        const uint64_t r = rng();
        memcpy(p + i, &r, std::min<size_t>(8, b.size - i));
    }
    return H5_ARG(0);
}

H5_NATIVE(n_exit)
{
    request_exit(H5_INT(0));
    return H5_UNDEFINED;
}

H5_NATIVE(n_reload)
{
    request_reload();
    return H5_UNDEFINED;
}

H5_NATIVE(n_gc)
{
    JSGarbageCollect(ctx);
    return H5_UNDEFINED;
}

// evaluate(source, url): runs a script in the global scope (a <script> element the page added)
H5_NATIVE(n_evaluate)
{
    const std::string source = H5_STR(0);
    const std::string url = H5_STR(1);
    js::Str s(source), u(url);
    return JSEvaluateScript(ctx, s, nullptr, u, 1, exception);
}

// loadScript(path, url): reads and runs a file in the global scope; false if it could not be read
H5_NATIVE(n_load_script)
{
    const std::string path = H5_STR(0);
    const std::string url = argc > 1 ? H5_STR(1) : path;
    std::vector<uint8_t> data;
    if (!path_allowed(path, false) || !read_file(path, data)) {
        H5_ERROR("script %s: cannot read %s", url.c_str(), path.c_str());
        return JSValueMakeBoolean(ctx, false);
    }
    data.push_back(0);
    const double t0 = now_ms();
    JSStringRef s = JSStringCreateWithUTF8CString(reinterpret_cast<const char *>(data.data()));
    std::vector<uint8_t>().swap(data);
    js::Str u(url);
    JSValueRef exc = nullptr;
    JSEvaluateScript(ctx, s, nullptr, u, 1, &exc);
    JSStringRelease(s);
    if (exc) {
        report(url.c_str(), exc);
        return JSValueMakeBoolean(ctx, false);
    }
    H5_INFO("script %s ran (%.0f ms)", url.c_str(), now_ms() - t0);
    return JSValueMakeBoolean(ctx, true);
}

H5_NATIVE(n_unhandled_rejection)
{
    // (promise, reason)
    JSValueRef reason = H5_ARG(1);
    H5_ERROR("unhandled promise rejection: %s", js::describe(ctx, reason).c_str());
    return H5_UNDEFINED;
}

void install_core(JSContextRef ctx, JSObjectRef h5)
{
    js::def(ctx, h5, "log", n_log);
    js::def(ctx, h5, "now", n_now);
    js::def(ctx, h5, "wallNow", n_wall_now);
    js::def(ctx, h5, "readBytes", n_read_bytes);
    js::def(ctx, h5, "readText", n_read_text);
    js::def(ctx, h5, "readAsync", n_read_async);
    js::def(ctx, h5, "writeFile", n_write_file);
    js::def(ctx, h5, "remove", n_remove);
    js::def(ctx, h5, "listDir", n_list_dir);
    js::def(ctx, h5, "mkdirs", n_mkdirs);
    js::def(ctx, h5, "exists", n_exists);
    js::def(ctx, h5, "random", n_random);
    js::def(ctx, h5, "exit", n_exit);
    js::def(ctx, h5, "reload", n_reload);
    js::def(ctx, h5, "gc", n_gc);
    js::def(ctx, h5, "evaluate", n_evaluate);
    js::def(ctx, h5, "loadScript", n_load_script);

    JSObjectRef p = JSObjectMake(ctx, nullptr, nullptr);
    js::set(ctx, p, "game", js::make_string(ctx, paths.game));
    js::set(ctx, p, "runtime", js::make_string(ctx, paths.runtime));
    js::set(ctx, p, "app", js::make_string(ctx, paths.app));
    js::set(ctx, p, "data", js::make_string(ctx, paths.data));
    js::set(ctx, h5, "paths", p);
#if defined(__ORBIS__)
    js::set(ctx, h5, "platform", js::make_string(ctx, "ps4"));
#else
    js::set(ctx, h5, "platform", js::make_string(ctx, "host"));
#endif
    js::set(ctx, h5, "hooks", JSObjectMake(ctx, nullptr, nullptr));
}

bool run_file(const std::string &path, const std::string &url)
{
    std::vector<uint8_t> data;
    if (!read_file(path, data)) {
        H5_ERROR("cannot read %s", path.c_str());
        return false;
    }
    data.push_back(0);
    js::Str s(reinterpret_cast<const char *>(data.data()));
    js::Str u(url);
    JSValueRef exc = nullptr;
    JSEvaluateScript(g_ctx, s, nullptr, u, 1, &exc);
    if (exc) {
        report(url.c_str(), exc);
        return false;
    }
    return true;
}

} // namespace

void register_natives(const char *module, Installer installer)
{
    modules().push_back({ module, installer });
}

bool start()
{
    stop();
    g_generation++;
    g_group = JSContextGroupCreate();
    g_ctx = JSGlobalContextCreateInGroup(g_group, nullptr);
    {
        js::Str name("h5");
        JSGlobalContextSetName(g_ctx, name);
    }
    JSObjectRef global = JSContextGetGlobalObject(g_ctx);
    g_h5 = JSObjectMake(g_ctx, nullptr, nullptr);
    JSValueProtect(g_ctx, g_h5);
    js::set(g_ctx, global, "__h5", g_h5, false);
    install_core(g_ctx, g_h5);
    for (const Module &m : modules())
        m.installer(g_ctx, g_h5);
    {
        js::Str name("unhandledRejection");
        JSObjectRef f = JSObjectMakeFunctionWithCallback(g_ctx, name, n_unhandled_rejection);
        JSGlobalContextSetUnhandledRejectionCallback(g_ctx, f, nullptr);
    }

    // the prelude: runtime/js/order.txt lists its files
    std::vector<uint8_t> order;
    if (!read_file(paths.runtime + "/js/order.txt", order)) {
        H5_ERROR("no %s/js/order.txt", paths.runtime.c_str());
        return false;
    }
    std::istringstream list(std::string(order.begin(), order.end()));
    std::string line;
    const double t0 = now_ms();
    while (std::getline(list, line)) {
        while (!line.empty() && (line.back() == '\r' || line.back() == ' '))
            line.pop_back();
        if (line.empty() || line[0] == '#')
            continue;
        if (!run_file(paths.runtime + "/js/" + line, "h5://runtime/js/" + line))
            return false;
    }
    H5_INFO("prelude ran (%.0f ms)", now_ms() - t0);
    // the app: its entry script loads the rest (the game's scripts) through __h5.loadScript
    if (!run_file(paths.app + "/main.js", "h5://app/main.js"))
        return false;
    return true;
}

void stop()
{
    if (!g_ctx)
        return;
    for (auto &[name, f] : g_hooks)
        JSValueUnprotect(g_ctx, f);
    g_hooks.clear();
    JSValueUnprotect(g_ctx, g_h5);
    g_h5 = nullptr;
    JSGlobalContextRelease(g_ctx);
    g_ctx = nullptr;
    JSContextGroupRelease(g_group);
    g_group = nullptr;
}

bool running()
{
    return g_ctx != nullptr;
}

JSGlobalContextRef context()
{
    return g_ctx;
}

unsigned generation()
{
    return g_generation;
}

JSObjectRef hook(const char *name)
{
    if (!g_ctx)
        return nullptr;
    auto it = g_hooks.find(name);
    if (it != g_hooks.end())
        return it->second;
    JSObjectRef hooks = js::object_of(g_ctx, js::get(g_ctx, g_h5, "hooks"));
    if (!hooks)
        return nullptr;
    JSObjectRef f = js::object_of(g_ctx, js::get(g_ctx, hooks, name));
    if (!f || !JSObjectIsFunction(g_ctx, f))
        return nullptr;
    JSValueProtect(g_ctx, f);
    g_hooks[name] = f;
    return f;
}

JSValueRef call_hook(const char *name, std::initializer_list<JSValueRef> args)
{
    JSObjectRef f = hook(name);
    if (!f)
        return g_ctx ? JSValueMakeUndefined(g_ctx) : nullptr;
    JSValueRef exc = nullptr;
    std::vector<JSValueRef> argv(args);
    JSValueRef result = JSObjectCallAsFunction(g_ctx, f, nullptr, argv.size(), argv.data(), &exc);
    if (exc) {
        report(name, exc);
        return JSValueMakeUndefined(g_ctx);
    }
    return result;
}

double tick(double now)
{
    if (!g_ctx)
        return -1;
    JSValueRef r = call_hook("tick", { JSValueMakeNumber(g_ctx, now) });
    const double next = js::to_number(g_ctx, r);
    return std::isfinite(next) ? next : -1;
}

void frame(double now)
{
    if (g_ctx)
        call_hook("frame", { JSValueMakeNumber(g_ctx, now) });
}

void request_reload() { g_reload = true; }
void request_exit(int code)
{
    g_exit = true;
    g_exit_code = code;
}
bool reload_requested() { return g_reload; }
bool exit_requested(int *code)
{
    if (code)
        *code = g_exit_code;
    return g_exit;
}
void clear_requests()
{
    g_reload = false;
    g_exit = false;
}

void report(const char *where, JSValueRef exception)
{
    if (!g_ctx)
        return;
    H5_ERROR("%s: %s", where, js::describe(g_ctx, exception).c_str());
}

bool path_allowed(const std::string &path, bool for_writing)
{
    if (path.find("..") != std::string::npos)
        return false;
    auto inside = [&](const std::string &root) {
        return !root.empty() && path.compare(0, root.size(), root) == 0 && (path.size() == root.size() || path[root.size()] == '/');
    };
    if (inside(paths.data))
        return true;
    if (for_writing)
        return false;
    return inside(paths.game) || inside(paths.runtime) || inside(paths.app);
}

} // namespace h5::engine
