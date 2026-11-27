// h5: HTTP(S) for fetch / XMLHttpRequest (js/net.js J.netRequest): libcurl (OpenSSL) on threads of its own,
// one cookie jar for the app (<data>/cookies.txt), connections, DNS answers and TLS sessions shared between
// requests, certificates checked against <runtime>/ca-certificates.crt. On the PS4 host names go through the
// system's resolver (ps4-kit's getaddrinfo wrapper).
//   __h5.netRequest(id, method, url, headers [[name, value], ...], body Uint8Array | null, timeout ms, save path)
//   completes id with {status, statusText, url, headers [[name, value], ...], body ArrayBuffer} or {error};
//   with a save path, a 200 answer's body goes to that file instead (written whole or not at all) and the
//   result has {saved: bytes} in place of the body
#include "engine.h"
#include "h5.h"

#include <curl/curl.h>

#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <functional>
#include <mutex>
#include <pthread.h>
#include <string>
#include <utility>
#include <vector>

namespace h5::net {
namespace {

constexpr int THREADS = 6;   // (a browser's connections per site)

struct Request {
    double id = 0;
    unsigned generation = 0;
    std::string method, url;
    std::vector<std::pair<std::string, std::string>> headers;
    std::vector<uint8_t> body;
    bool has_body = false;
    long timeout_ms = 0;
    std::string save;   // the body to this file, not to the page
};

struct Response {
    long status = 0;
    std::string status_text, url, error;
    std::vector<std::pair<std::string, std::string>> headers;
    std::vector<uint8_t> body;
    FILE *file = nullptr;   // a download to a file: its .part, while it comes
    size_t saved = 0;
};

// (never destroyed: the workers wait on these until the process ends, and glibc's condition variable
// destructor blocks while anyone waits, so exit() would hang)
std::mutex &g_queue_mutex = *new std::mutex;
std::condition_variable &g_queue_cv = *new std::condition_variable;
std::deque<Request> &g_queue = *new std::deque<Request>;
bool g_started = false;
CURLSH *g_share = nullptr;
std::mutex g_share_locks[CURL_LOCK_DATA_LAST];
std::mutex g_jar_mutex;
std::string g_jar, g_ca;

void share_lock(CURL *, curl_lock_data data, curl_lock_access, void *) { g_share_locks[data].lock(); }
void share_unlock(CURL *, curl_lock_data data, void *) { g_share_locks[data].unlock(); }

size_t on_body(char *data, size_t size, size_t n, void *user)
{
    auto *r = static_cast<Response *>(user);
    if (r->file) {
        if (fwrite(data, 1, size * n, r->file) != size * n)
            return 0;   // (disk full: curl ends the transfer with a write error)
        r->saved += size * n;
        return size * n;
    }
    r->body.insert(r->body.end(), data, data + size * n);
    return size * n;
}

// header lines; a status line starts a new response (each redirect has its own)
size_t on_header(char *data, size_t size, size_t n, void *user)
{
    auto *r = static_cast<Response *>(user);
    std::string line(data, size * n);
    while (!line.empty() && (line.back() == '\r' || line.back() == '\n'))
        line.pop_back();
    if (line.compare(0, 5, "HTTP/") == 0) {
        r->headers.clear();
        if (r->file) {   // (a redirect's body came first: start over)
            fflush(r->file);
            rewind(r->file);
            r->saved = 0;
        }
        const size_t a = line.find(' ');
        const size_t b = a == std::string::npos ? std::string::npos : line.find(' ', a + 1);
        r->status_text = b == std::string::npos ? "" : line.substr(b + 1);
        return size * n;
    }
    const size_t colon = line.find(':');
    if (colon != std::string::npos && colon > 0) {
        size_t v = colon + 1;
        while (v < line.size() && (line[v] == ' ' || line[v] == '\t'))
            v++;
        r->headers.emplace_back(line.substr(0, colon), line.substr(v));
    }
    return size * n;
}

#if defined(__ORBIS__)
const std::string &mapped(const std::string &url) { return url; }
#else
// the PC test build: H5_NET_MAP="https://site/=http://127.0.0.1:port/" sends a site's requests to a local
// stand-in (scripts/net-mock.py), for runs without the internet
std::string mapped(const std::string &url)
{
    static const std::string map = getenv("H5_NET_MAP") ? getenv("H5_NET_MAP") : "";
    const size_t eq = map.find('=');
    if (eq == std::string::npos)
        return url;
    const std::string from = map.substr(0, eq), to = map.substr(eq + 1);
    return url.compare(0, from.size(), from) == 0 ? to + url.substr(from.size()) : url;
}
#endif

void perform(CURL *h, const Request &q, Response &r)
{
    curl_easy_reset(h);
    const std::string target = mapped(q.url);
    char error[CURL_ERROR_SIZE] = {};
    curl_easy_setopt(h, CURLOPT_ERRORBUFFER, error);
    curl_easy_setopt(h, CURLOPT_SHARE, g_share);
    curl_easy_setopt(h, CURLOPT_URL, target.c_str());
    curl_easy_setopt(h, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(h, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(h, CURLOPT_MAXREDIRS, 10L);
    curl_easy_setopt(h, CURLOPT_ACCEPT_ENCODING, "");
    curl_easy_setopt(h, CURLOPT_CONNECTTIMEOUT_MS, 15000L);
    curl_easy_setopt(h, CURLOPT_TIMEOUT_MS, q.timeout_ms > 0 ? q.timeout_ms : 60000L);
    if (!g_ca.empty())
        curl_easy_setopt(h, CURLOPT_CAINFO, g_ca.c_str());
    curl_easy_setopt(h, CURLOPT_COOKIEFILE, "");   // the cookie engine (the jar is loaded into the share)
    curl_easy_setopt(h, CURLOPT_WRITEFUNCTION, on_body);
    curl_easy_setopt(h, CURLOPT_WRITEDATA, &r);
    curl_easy_setopt(h, CURLOPT_HEADERFUNCTION, on_header);
    curl_easy_setopt(h, CURLOPT_HEADERDATA, &r);
    if (q.method == "HEAD") {
        curl_easy_setopt(h, CURLOPT_NOBODY, 1L);
    } else if (q.method == "POST") {
        curl_easy_setopt(h, CURLOPT_POST, 1L);
    } else if (q.method != "GET") {
        curl_easy_setopt(h, CURLOPT_CUSTOMREQUEST, q.method.c_str());
    }
    if (q.has_body || q.method == "POST") {
        curl_easy_setopt(h, CURLOPT_POSTFIELDSIZE_LARGE, static_cast<curl_off_t>(q.body.size()));
        curl_easy_setopt(h, CURLOPT_POSTFIELDS, q.body.empty() ? "" : reinterpret_cast<const char *>(q.body.data()));
    }
    const std::string part = q.save + ".part";
    if (!q.save.empty()) {
        const size_t slash = q.save.rfind('/');
        if (slash != std::string::npos)
            make_dirs(q.save.substr(0, slash));
        r.file = fopen(part.c_str(), "wb");
        if (!r.file) {
            r.error = "cannot write " + part;
            return;
        }
    }
    curl_slist *list = nullptr;
    for (const auto &[k, v] : q.headers)
        list = curl_slist_append(list, (k + ": " + v).c_str());
    list = curl_slist_append(list, "Expect:");
    curl_easy_setopt(h, CURLOPT_HTTPHEADER, list);
    const CURLcode code = curl_easy_perform(h);
    curl_slist_free_all(list);
    if (code == CURLE_OK)
        curl_easy_getinfo(h, CURLINFO_RESPONSE_CODE, &r.status);
    if (r.file) {
        // kept only whole and only a 200's: a page of an error or half a file never takes the name
        const bool ok = fclose(r.file) == 0 && code == CURLE_OK && r.status == 200;
        r.file = nullptr;
        if (!ok || rename(part.c_str(), q.save.c_str()) != 0) {
            remove(part.c_str());
            if (code == CURLE_OK && r.status == 200)
                r.error = "cannot write " + q.save;
        }
    }
    if (code != CURLE_OK) {
        r.error = error[0] ? error : curl_easy_strerror(code);
        return;
    }
    char *effective = nullptr;
    curl_easy_getinfo(h, CURLINFO_EFFECTIVE_URL, &effective);
    r.url = effective && target == q.url ? effective : q.url;
    // the jar, after each response (cookies may have changed)
    std::lock_guard<std::mutex> lock(g_jar_mutex);
    curl_easy_setopt(h, CURLOPT_COOKIEJAR, g_jar.c_str());
    curl_easy_setopt(h, CURLOPT_COOKIELIST, "FLUSH");
    curl_easy_setopt(h, CURLOPT_COOKIEJAR, nullptr);
}

void deliver(const Request &q, std::shared_ptr<Response> r)
{
    post_main([q_id = q.id, gen = q.generation, q_save = !q.save.empty(), r] {
        if (gen != engine::generation() || !engine::running())
            return;
        JSContextRef ctx = engine::context();
        JSObjectRef o = JSObjectMake(ctx, nullptr, nullptr);
        if (!r->error.empty()) {
            js::set(ctx, o, "error", js::make_string(ctx, r->error));
        } else {
            js::set(ctx, o, "status", JSValueMakeNumber(ctx, static_cast<double>(r->status)));
            js::set(ctx, o, "statusText", js::make_string(ctx, r->status_text));
            js::set(ctx, o, "url", js::make_string(ctx, r->url));
            std::vector<JSValueRef> pairs;
            for (const auto &[k, v] : r->headers) {
                JSValueRef kv[2] = { js::make_string(ctx, k), js::make_string(ctx, v) };
                pairs.push_back(JSObjectMakeArray(ctx, 2, kv, nullptr));
            }
            js::set(ctx, o, "headers", JSObjectMakeArray(ctx, pairs.size(), pairs.data(), nullptr));
            if (!q_save)
                js::set(ctx, o, "body", js::make_array_buffer(ctx, std::move(r->body)));
            else
                js::set(ctx, o, "saved", JSValueMakeNumber(ctx, static_cast<double>(r->saved)));
        }
        engine::call_hook("complete", { JSValueMakeNumber(ctx, q_id), o });
    });
}

void worker()
{
    CURL *h = curl_easy_init();
    for (;;) {
        Request q;
        {
            std::unique_lock<std::mutex> lock(g_queue_mutex);
            g_queue_cv.wait(lock, [] { return !g_queue.empty(); });
            q = std::move(g_queue.front());
            g_queue.pop_front();
        }
        auto r = std::make_shared<Response>();
        const double t0 = now_ms();
        if (h)
            perform(h, q, *r);
        else
            r->error = "no curl handle";
        if (r->error.empty())
            H5_INFO("net: %s %s -> %ld (%zu bytes%s, %.0f ms)", q.method.c_str(), q.url.c_str(), r->status,
                q.save.empty() ? r->body.size() : r->saved, q.save.empty() ? "" : " saved", now_ms() - t0);
        else
            H5_WARN("net: %s %s failed: %s", q.method.c_str(), q.url.c_str(), r->error.c_str());
        deliver(q, r);
    }
}

void start()
{
    if (g_started)
        return;
    g_started = true;
    curl_global_init(CURL_GLOBAL_DEFAULT);
    g_jar = paths.data + "/cookies.txt";
    g_ca = paths.runtime + "/ca-certificates.crt";
    if (!file_exists(g_ca)) {
        H5_WARN("net: no %s: the system's certificates", g_ca.c_str());
        g_ca.clear();
    }
    g_share = curl_share_init();
    curl_share_setopt(g_share, CURLSHOPT_LOCKFUNC, share_lock);
    curl_share_setopt(g_share, CURLSHOPT_UNLOCKFUNC, share_unlock);
    curl_share_setopt(g_share, CURLSHOPT_SHARE, CURL_LOCK_DATA_COOKIE);
    curl_share_setopt(g_share, CURLSHOPT_SHARE, CURL_LOCK_DATA_DNS);
    curl_share_setopt(g_share, CURLSHOPT_SHARE, CURL_LOCK_DATA_SSL_SESSION);
    curl_share_setopt(g_share, CURLSHOPT_SHARE, CURL_LOCK_DATA_CONNECT);
    // the saved cookies into the share
    if (file_exists(g_jar)) {
        if (CURL *h = curl_easy_init()) {
            curl_easy_setopt(h, CURLOPT_SHARE, g_share);
            curl_easy_setopt(h, CURLOPT_COOKIEFILE, g_jar.c_str());
            curl_easy_setopt(h, CURLOPT_COOKIELIST, "RELOAD");
            curl_easy_cleanup(h);
        }
    }
    const curl_version_info_data *v = curl_version_info(CURLVERSION_NOW);
    H5_INFO("net: libcurl %s, %s", v ? v->version : "?", v && v->ssl_version ? v->ssl_version : "no TLS");
    // (threads with room for OpenSSL's handshakes: the PS4's default stack is small)
    for (int i = 0; i < THREADS; i++) {
        pthread_attr_t attr;
        pthread_attr_init(&attr);
        pthread_attr_setstacksize(&attr, 1 << 20);
        pthread_t t;
        if (pthread_create(&t, &attr, [](void *) -> void * { worker(); return nullptr; }, nullptr) == 0)
            pthread_detach(t);
        pthread_attr_destroy(&attr);
    }
}

H5_NATIVE(n_net_request)
{
    Request q;
    q.id = H5_NUM(0);
    q.generation = engine::generation();
    q.method = H5_STR(1);
    q.url = H5_STR(2);
    JSValueRef hv = H5_ARG(3);
    if (JSValueIsObject(ctx, hv)) {
        JSObjectRef arr = JSValueToObject(ctx, hv, nullptr);
        const int n = js::to_int(ctx, js::get(ctx, arr, "length"));
        for (int i = 0; i < n; i++) {
            JSValueRef pv = JSObjectGetPropertyAtIndex(ctx, arr, static_cast<unsigned>(i), nullptr);
            if (!JSValueIsObject(ctx, pv))
                continue;
            JSObjectRef p = JSValueToObject(ctx, pv, nullptr);
            std::string k = js::to_string(ctx, JSObjectGetPropertyAtIndex(ctx, p, 0, nullptr));
            std::string v = js::to_string(ctx, JSObjectGetPropertyAtIndex(ctx, p, 1, nullptr));
            if (k.find_first_of("\r\n:") != std::string::npos || v.find_first_of("\r\n") != std::string::npos)
                continue;
            q.headers.emplace_back(std::move(k), std::move(v));
        }
    }
    const js::Bytes b = js::bytes_of(ctx, H5_ARG(4));
    if (b.data) {
        const auto *d = static_cast<const uint8_t *>(b.data);
        q.body.assign(d, d + b.size);
        q.has_body = true;
    }
    q.timeout_ms = static_cast<long>(H5_NUM(5));
    if (argc > 6 && JSValueIsString(ctx, H5_ARG(6))) {
        q.save = H5_STR(6);
        // (downloads land in the app's data folder only)
        if (q.save.compare(0, paths.data.size() + 1, paths.data + "/") != 0 || q.save.find("/../") != std::string::npos) {
            H5_WARN("net: not saving to %s", q.save.c_str());
            return JSValueMakeBoolean(ctx, false);
        }
    }
    start();
    {
        std::lock_guard<std::mutex> lock(g_queue_mutex);
        g_queue.push_back(std::move(q));
    }
    g_queue_cv.notify_one();
    return H5_UNDEFINED;
}

void install(JSContextRef ctx, JSObjectRef h5)
{
    js::def(ctx, h5, "netRequest", n_net_request);
}

struct Registration {
    Registration() { engine::register_natives("net", install); }
} g_registration;

} // namespace
} // namespace h5::net
