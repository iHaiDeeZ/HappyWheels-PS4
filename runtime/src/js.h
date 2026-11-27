// h5: helpers over JavaScriptCore's C API.
#pragma once

#include <JavaScriptCore/JavaScript.h>
#include <JavaScriptCore/JSBasePrivate.h>
#include <JavaScriptCore/JSContextRefPrivate.h>

#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

namespace h5::js {

// A JSStringRef that releases itself.
class Str {
public:
    explicit Str(const char *utf8) : m_s(JSStringCreateWithUTF8CString(utf8)) { }
    explicit Str(const std::string &utf8) : m_s(JSStringCreateWithUTF8CString(utf8.c_str())) { }
    ~Str() { JSStringRelease(m_s); }
    Str(const Str &) = delete;
    Str &operator=(const Str &) = delete;
    operator JSStringRef() const { return m_s; }

private:
    JSStringRef m_s;
};

std::string to_utf8(JSStringRef s);
std::string to_string(JSContextRef ctx, JSValueRef v);           // String(v); "" on failure
double to_number(JSContextRef ctx, JSValueRef v);                // Number(v); NaN on failure
inline int32_t to_int(JSContextRef ctx, JSValueRef v)
{
    const double d = to_number(ctx, v);
    if (!std::isfinite(d))
        return 0;
    return static_cast<int32_t>(static_cast<int64_t>(d));        // ToInt32 for the values WebGL sees
}
inline uint32_t to_uint(JSContextRef ctx, JSValueRef v) { return static_cast<uint32_t>(to_int(ctx, v)); }
inline bool to_bool(JSContextRef ctx, JSValueRef v) { return JSValueToBoolean(ctx, v); }

JSValueRef make_string(JSContextRef ctx, const std::string &utf8);
inline JSValueRef make_number(JSContextRef ctx, double d) { return JSValueMakeNumber(ctx, d); }

JSValueRef get(JSContextRef ctx, JSObjectRef obj, const char *name);
void set(JSContextRef ctx, JSObjectRef obj, const char *name, JSValueRef value, bool enumerable = true);
void def(JSContextRef ctx, JSObjectRef obj, const char *name, JSObjectCallAsFunctionCallback fn);
JSObjectRef object_of(JSContextRef ctx, JSValueRef v);           // nullptr if not an object

// sets *exception to a new Error(message) (TypeError if type) and returns undefined
JSValueRef throw_error(JSContextRef ctx, JSValueRef *exception, const std::string &message, bool type = false);

// "message\n  at stack" for a thrown value
std::string describe(JSContextRef ctx, JSValueRef exception);

// bytes of a typed array, a DataView or an ArrayBuffer (nullptr/0 when v is none of them)
struct Bytes {
    void *data = nullptr;
    size_t size = 0;
    JSTypedArrayType type = kJSTypedArrayTypeNone;
};
Bytes bytes_of(JSContextRef ctx, JSValueRef v);

// a new ArrayBuffer that owns `data` (moved)
JSObjectRef make_array_buffer(JSContextRef ctx, std::vector<uint8_t> &&data);
// a new typed array over a copy of `size` bytes
JSObjectRef make_typed_array(JSContextRef ctx, JSTypedArrayType type, const void *data, size_t size);

} // namespace h5::js

// A native function's signature and its arguments.
#define H5_NATIVE(name)                                                                                          \
    static JSValueRef name([[maybe_unused]] JSContextRef ctx, [[maybe_unused]] JSObjectRef function,             \
        [[maybe_unused]] JSObjectRef self, [[maybe_unused]] size_t argc, [[maybe_unused]] const JSValueRef argv[], \
        [[maybe_unused]] JSValueRef *exception)
#define H5_ARG(i) ((i) < argc ? argv[i] : JSValueMakeUndefined(ctx))
#define H5_NUM(i) ::h5::js::to_number(ctx, H5_ARG(i))
#define H5_INT(i) ::h5::js::to_int(ctx, H5_ARG(i))
#define H5_UINT(i) ::h5::js::to_uint(ctx, H5_ARG(i))
#define H5_BOOL(i) ::h5::js::to_bool(ctx, H5_ARG(i))
#define H5_STR(i) ::h5::js::to_string(ctx, H5_ARG(i))
#define H5_UNDEFINED JSValueMakeUndefined(ctx)
