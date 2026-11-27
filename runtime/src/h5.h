// h5: a small HTML5 game runtime (JavaScriptCore + a browser layer in JavaScript + native GL, canvas,
// images, audio, input). Shared declarations.
#pragma once

#include <cstdarg>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace h5 {

// ---- logging (log.cpp): one line per call, to the log file and stdout
enum class Level { Debug = 0, Info = 1, Warn = 2, Error = 3 };
void log(Level level, const char *fmt, ...) __attribute__((format(printf, 2, 3)));
void vlog(Level level, const char *fmt, va_list args);
void log_open(const std::string &path);   // also keeps the previous run's file as <path>.prev
#define H5_INFO(...) ::h5::log(::h5::Level::Info, __VA_ARGS__)
#define H5_WARN(...) ::h5::log(::h5::Level::Warn, __VA_ARGS__)
#define H5_ERROR(...) ::h5::log(::h5::Level::Error, __VA_ARGS__)

// ---- time
double now_ms();          // monotonic, milliseconds since the runtime started
double wall_ms();         // Unix time in milliseconds

// ---- files (files.cpp)
bool read_file(const std::string &path, std::vector<uint8_t> &out);
bool write_file_atomic(const std::string &path, const void *data, size_t size);
bool make_dirs(const std::string &path);
bool file_exists(const std::string &path);

// ---- the main loop (loop.cpp)
// Work for a worker thread; its result goes back to the main thread as `done`, run between tasks.
void post_job(std::function<void()> work, std::function<void()> done);
// Runs `task` on the main thread at the next turn of the loop (any thread may call it).
void post_main(std::function<void()> task);
void run_posted();        // main thread: runs what the workers finished
void start_workers(int count);
void stop_workers();

// ---- where things are (set by the platform layer)
struct Paths {
    std::string game;      // the game's files: /app0/webroot (PS4)
    std::string runtime;   // the runtime's own files: js/ (the browser layer)
    std::string app;       // the app's scripts: main.js and what it loads
    std::string data;      // writable: /data/HappyWheels (PS4)
};
extern Paths paths;

} // namespace h5
