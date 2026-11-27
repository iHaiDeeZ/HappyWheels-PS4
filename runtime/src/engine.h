// h5: the JavaScript world (one JavaScriptCore context at a time) and the calls between it and C++.
#pragma once

#include "js.h"

#include <initializer_list>

namespace h5::engine {

// Natives are installed on the hidden `__h5` object by modules that register an installer before
// start(). Each start() (first run and every reload) installs them all again.
using Installer = void (*)(JSContextRef ctx, JSObjectRef h5);
void register_natives(const char *module, Installer installer);

// Creates the context, installs the natives, runs the prelude (runtime/js, in js/order.txt's order) and
// the app's entry script. False when the prelude or the entry failed to run.
bool start();
void stop();
bool running();
JSGlobalContextRef context();

// A JavaScript function the prelude put in __h5.hooks (cached per context); null if missing.
JSObjectRef hook(const char *name);
// Calls __h5.hooks[name](args...); exceptions are logged. Returns the result or undefined.
JSValueRef call_hook(const char *name, std::initializer_list<JSValueRef> args);

// The loop's calls into the page.
double tick(double now_ms);   // due timers; returns when the next one is due (ms) or -1
void frame(double now_ms);    // requestAnimationFrame callbacks

// Requests made by the page, acted on by the loop between turns.
void request_reload();
void request_exit(int code);
bool reload_requested();
bool exit_requested(int *code = nullptr);
void clear_requests();

// Increases each start(): async work started under an older one is dropped when it finishes.
unsigned generation();

// Reports a thrown value with its stack.
void report(const char *where, JSValueRef exception);

// Path checks for natives that touch files: true when `path` is inside the game's, the runtime's or the
// data folder (no "..").
bool path_allowed(const std::string &path, bool for_writing);

} // namespace h5::engine
