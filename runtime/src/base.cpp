// h5 base: logging, time, files, the worker pool and the main thread's queue.
#include "h5.h"

#include <cerrno>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstring>
#include <deque>
#include <mutex>
#include <thread>

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

namespace h5 {

Paths paths;

// ---------------------------------------------------------------- time
static const auto g_start = std::chrono::steady_clock::now();

double now_ms()
{
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - g_start).count();
}

double wall_ms()
{
    return std::chrono::duration<double, std::milli>(std::chrono::system_clock::now().time_since_epoch()).count();
}

// ---------------------------------------------------------------- logging
static std::mutex g_log_mutex;
static FILE *g_log_file = nullptr;

void log_open(const std::string &path)
{
    std::lock_guard<std::mutex> lock(g_log_mutex);
    if (g_log_file)
        fclose(g_log_file);
    rename(path.c_str(), (path + ".prev").c_str());
    g_log_file = fopen(path.c_str(), "w");
}

void vlog(Level level, const char *fmt, va_list args)
{
    static const char *const names[] = { "debug", "info", "WARN", "ERROR" };
    char text[8192];
    const int n = vsnprintf(text, sizeof text, fmt, args);
    if (n < 0)
        return;
    char line[8300];
    const double t = now_ms() / 1000.0;
    snprintf(line, sizeof line, "[%9.3f] %s%s%s\n", t, level == Level::Info ? "" : names[static_cast<int>(level)],
        level == Level::Info ? "" : ": ", text);
    std::lock_guard<std::mutex> lock(g_log_mutex);
    fputs(line, stdout);
    fflush(stdout);
    if (g_log_file) {
        fputs(line, g_log_file);
        fflush(g_log_file);
    }
}

void log(Level level, const char *fmt, ...)
{
    va_list args;
    va_start(args, fmt);
    vlog(level, fmt, args);
    va_end(args);
}

// ---------------------------------------------------------------- files
bool read_file(const std::string &path, std::vector<uint8_t> &out)
{
    out.clear();
    const int fd = open(path.c_str(), O_RDONLY);
    if (fd < 0)
        return false;
    struct stat st {};
    if (fstat(fd, &st) || !S_ISREG(st.st_mode)) {
        close(fd);
        return false;
    }
    out.resize(static_cast<size_t>(st.st_size));
    size_t done = 0;
    while (done < out.size()) {
        const ssize_t got = read(fd, out.data() + done, out.size() - done);
        if (got < 0 && errno == EINTR)
            continue;
        if (got <= 0)
            break;
        done += static_cast<size_t>(got);
    }
    close(fd);
    out.resize(done);
    return done == static_cast<size_t>(st.st_size);
}

bool write_file_atomic(const std::string &path, const void *data, size_t size)
{
    const std::string temp = path + ".tmp";
    const int fd = open(temp.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0666);
    if (fd < 0)
        return false;
    const auto *bytes = static_cast<const uint8_t *>(data);
    size_t done = 0;
    while (done < size) {
        const ssize_t put = write(fd, bytes + done, size - done);
        if (put < 0 && errno == EINTR)
            continue;
        if (put <= 0)
            break;
        done += static_cast<size_t>(put);
    }
    const bool ok = done == size && fsync(fd) == 0;
    close(fd);
    if (!ok || rename(temp.c_str(), path.c_str())) {
        unlink(temp.c_str());
        return false;
    }
    return true;
}

bool make_dirs(const std::string &path)
{
    std::string partial;
    for (size_t i = 0; i <= path.size(); i++) {
        if (i == path.size() || path[i] == '/') {
            if (!partial.empty() && mkdir(partial.c_str(), 0777) && errno != EEXIST)
                return false;
        }
        if (i < path.size())
            partial += path[i];
    }
    return true;
}

bool file_exists(const std::string &path)
{
    struct stat st {};
    return stat(path.c_str(), &st) == 0;
}

// ---------------------------------------------------------------- workers and the main thread's queue
namespace {
struct Job {
    std::function<void()> work, done;
};
std::mutex g_jobs_mutex;
std::condition_variable g_jobs_cv;
std::deque<Job> g_jobs;
std::vector<std::thread> g_workers;
bool g_stopping = false;

std::mutex g_main_mutex;
std::vector<std::function<void()>> g_main_tasks;

void worker()
{
    for (;;) {
        Job job;
        {
            std::unique_lock<std::mutex> lock(g_jobs_mutex);
            g_jobs_cv.wait(lock, [] { return g_stopping || !g_jobs.empty(); });
            if (g_stopping && g_jobs.empty())
                return;
            job = std::move(g_jobs.front());
            g_jobs.pop_front();
        }
        if (job.work)
            job.work();
        if (job.done)
            post_main(std::move(job.done));
    }
}
} // namespace

void post_job(std::function<void()> work, std::function<void()> done)
{
    {
        std::lock_guard<std::mutex> lock(g_jobs_mutex);
        g_jobs.push_back({ std::move(work), std::move(done) });
    }
    g_jobs_cv.notify_one();
}

void post_main(std::function<void()> task)
{
    std::lock_guard<std::mutex> lock(g_main_mutex);
    g_main_tasks.push_back(std::move(task));
}

void run_posted()
{
    std::vector<std::function<void()>> tasks;
    {
        std::lock_guard<std::mutex> lock(g_main_mutex);
        tasks.swap(g_main_tasks);
    }
    for (auto &task : tasks)
        task();
}

void start_workers(int count)
{
    g_stopping = false;
    for (int i = 0; i < count; i++)
        g_workers.emplace_back(worker);
}

void stop_workers()
{
    {
        std::lock_guard<std::mutex> lock(g_jobs_mutex);
        g_stopping = true;
    }
    g_jobs_cv.notify_all();
    for (auto &t : g_workers)
        t.join();
    g_workers.clear();
}

} // namespace h5
