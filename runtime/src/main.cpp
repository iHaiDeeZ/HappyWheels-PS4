// h5: start, the loop, reload, exit.
#include "engine.h"
#include "gles.h"
#include "h5.h"
#include "js.h"
#include "platform.h"

#include <algorithm>
#include <cmath>

namespace h5::input {
void update();
}
namespace h5::audio {
void start();
void stop();
void reset();   // a reload: every node and buffer of the old page goes
}

namespace {

enum class End { Reload, Exit, Quit };

// __h5.frameStats() -> [frames shown, frames the page drew its main canvas in, ms of script+draw]: running
// totals since start, for js/overlay.js's frame counter
double g_shown = 0, g_drawn = 0, g_work_ms = 0;

H5_NATIVE(n_frame_stats)
{
    JSValueRef v[3] = { JSValueMakeNumber(ctx, g_shown), JSValueMakeNumber(ctx, g_drawn), JSValueMakeNumber(ctx, g_work_ms) };
    return JSObjectMakeArray(ctx, 3, v, nullptr);
}

void install(JSContextRef ctx, JSObjectRef h5)
{
    h5::js::def(ctx, h5, "frameStats", n_frame_stats);
}

struct Registration {
    Registration() { h5::engine::register_natives("loop", install); }
} g_registration;

// One page's life: timers, finished async work, frames. Returns why it ended.
End run_page()
{
    using namespace h5;
    const double period = platform::frame_period_ms();
    double next_frame = now_ms();
    double last_report = now_ms();
    int frames = 0;
    double frame_time = 0;
    for (;;) {
        run_posted();
        if (platform::quit_requested())
            return End::Quit;
        int code = 0;
        if (engine::exit_requested(&code))
            return End::Exit;
        if (engine::reload_requested())
            return End::Reload;
        double now = now_ms();
        const double next_timer = engine::tick(now);
        run_posted();
        now = now_ms();
        if (platform::present_paces() || now >= next_frame) {
            const double t0 = now_ms();
            input::update();
            engine::frame(now);
            if (platform::has_gl()) {
                if (gl::canvas_drawn_since_present())
                    g_drawn++;
                gl::present_main_canvas();
            }
            const double work = now_ms() - t0;
            frame_time += work;
            g_work_ms += work;
            g_shown++;
            platform::present();
            frames++;
            next_frame += period;
            if (next_frame < now)
                next_frame = now + period;
        }
        if (now - last_report >= 10000) {
            H5_INFO("loop: %d frames in %.1f s, %.1f ms of script+draw per frame", frames, (now - last_report) / 1000,
                frames ? frame_time / frames : 0);
            frames = 0;
            frame_time = 0;
            last_report = now;
        }
        if (!platform::present_paces()) {
            double until = next_frame;
            if (next_timer >= 0)
                until = std::min(until, std::max(next_timer, now_ms()));
            platform::sleep_until(until);
        }
    }
}

} // namespace

int main(int argc, char **argv)
{
    using namespace h5;
    if (!platform::init(argc, argv))
        return 1;
    if (platform::has_gl() && !gl::load()) {
        H5_ERROR("GL functions missing: no WebGL");
    }
    start_workers(4);
    audio::start();
    int code = 0;
    for (;;) {
        engine::clear_requests();
        const double t0 = now_ms();
        if (!engine::start())
            H5_ERROR("the page did not start (see above); the loop keeps running its timers");
        else
            H5_INFO("page started in %.0f ms", now_ms() - t0);
        const End end = run_page();
        if (end == End::Reload) {
            H5_INFO("reload");
            engine::stop();
            audio::reset();
            gl::release_all();
            continue;
        }
        engine::exit_requested(&code);
        H5_INFO(end == End::Quit ? "closed by the system" : "the page asked to exit (%d)", code);
        break;
    }
    engine::stop();
    audio::stop();
    stop_workers();
    platform::shutdown();
    platform::exit_app(code);
}
