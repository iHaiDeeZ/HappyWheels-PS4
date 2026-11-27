// h5: what the runtime needs from the machine it runs on (platform_ps4.cpp, platform_host.cpp).
#pragma once

#include <cstdint>
#include <string>

namespace h5::platform {

// Sets h5::paths, opens the log, makes the GL context current on this thread (when there is one).
bool init(int argc, char **argv);
void shutdown();

// ---- graphics: an OpenGL ES 3 context, current on the main thread
bool has_gl();
int screen_width();
int screen_height();
void *gl_proc(const char *name);   // a GL function by name
// Makes the screen's framebuffer the draw target (the window's default framebuffer, 0 on the PS4).
unsigned screen_framebuffer();
// Shows what was drawn to screen_framebuffer() (swap; on the PC test build: maybe a PNG).
void present();

// ---- time: sleeps until `until_ms` (h5::now_ms() clock) or less; the loop calls it between frames
void sleep_until(double until_ms);
// the display's frame period in ms (16.67 at 60 Hz)
double frame_period_ms();
// true when present() waits for the display itself (then the loop does not pace frames)
bool present_paces();

// ---- the controller, W3C standard order (as OrbisWeb sends it)
struct PadState {
    bool connected = false;
    float buttons[17] = {};   // 0..1 (L2/R2 analog)
    float axes[4] = {};       // LX LY RX RY, -1..1
    int touches = 0;          // fingers on the touch pad
    float touch_x = 0, touch_y = 0;   // the first finger, 0..1 from the top left
    int touch_id = -1;        // the first finger's id: a new one for each new touch
};
void read_pad(PadState &state);

// ---- the system keyboard for text entry
// opens it with `text`; false if it could not open
bool ime_open(const std::string &title, const std::string &text, int max_length, bool multiline);
// 0: still open, 1: accepted (text set), -1: cancelled, -2: not open
int ime_poll(std::string &text);

// ---- sound: the callback fills `frames` stereo S16 frames at `rate` Hz (called on the sound thread)
using AudioFill = void (*)(int16_t *out, int frames, void *user);
bool audio_start(int rate, int frames_per_block, AudioFill fill, void *user);
void audio_stop();

// ---- the app is being closed (PS button > Close, a window close on the PC)
bool quit_requested();
// ends the process the way the platform wants (PS4: back to the home screen)
[[noreturn]] void exit_app(int code);

} // namespace h5::platform
