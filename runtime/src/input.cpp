// h5: the controller and the system keyboard, for js/input.js.
//   __h5.padState: Float32Array [connected, timestamp, buttons x17, axes x4, touches, touch x, touch y, touch id],
//   refreshed before each frame (the touch pad's first finger, 0..1)
//   __h5.imeOpen(title, text, maxLength, multiline) -> bool;  __h5.imePoll() -> null | [status, text]
#include "engine.h"
#include "h5.h"
#include "platform.h"

#include <cstring>

namespace h5::input {

namespace {
constexpr int PAD_FLOATS = 2 + 17 + 4 + 4;
float g_pad[PAD_FLOATS] = {};
platform::PadState g_last;

H5_NATIVE(n_ime_open)
{
    const std::string title = H5_STR(0), text = H5_STR(1);
    const int max = H5_INT(2);
    return JSValueMakeBoolean(ctx, platform::ime_open(title, text, max > 0 ? max : 256, H5_BOOL(3)));
}

H5_NATIVE(n_ime_poll)
{
    std::string text;
    const int status = platform::ime_poll(text);
    if (status == -2 || status == 0)
        return status == 0 ? JSValueMakeNumber(ctx, 0) : JSValueMakeNull(ctx);
    JSValueRef items[2] = { JSValueMakeNumber(ctx, status), js::make_string(ctx, text) };
    return JSObjectMakeArray(ctx, 2, items, nullptr);
}

void install(JSContextRef ctx, JSObjectRef h5)
{
    JSObjectRef pad = JSObjectMakeTypedArrayWithBytesNoCopy(ctx, kJSTypedArrayTypeFloat32Array, g_pad, sizeof g_pad,
        nullptr, nullptr, nullptr);
    js::set(ctx, h5, "padState", pad, false);
    js::def(ctx, h5, "imeOpen", n_ime_open);
    js::def(ctx, h5, "imePoll", n_ime_poll);
}

struct Registration {
    Registration() { engine::register_natives("input", install); }
} g_registration;
} // namespace

// before each frame: the controller's state into padState (timestamp moves only when something changed)
void update()
{
    platform::PadState s;
    platform::read_pad(s);
    const bool changed = s.connected != g_last.connected || memcmp(s.buttons, g_last.buttons, sizeof s.buttons) ||
        memcmp(s.axes, g_last.axes, sizeof s.axes) || s.touches != g_last.touches || s.touch_x != g_last.touch_x ||
        s.touch_y != g_last.touch_y;
    g_pad[0] = s.connected ? 1.0f : 0.0f;
    if (changed)
        g_pad[1] = static_cast<float>(now_ms());
    memcpy(&g_pad[2], s.buttons, sizeof s.buttons);
    memcpy(&g_pad[19], s.axes, sizeof s.axes);
    g_pad[23] = static_cast<float>(s.touches);
    g_pad[24] = s.touch_x;
    g_pad[25] = s.touch_y;
    g_pad[26] = static_cast<float>(s.touch_id);
    g_last = s;
}

} // namespace h5::input
