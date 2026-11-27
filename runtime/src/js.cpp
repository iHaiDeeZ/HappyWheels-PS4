// h5: helpers over JavaScriptCore's C API.
#include "js.h"

#include <cstdlib>
#include <cstring>

namespace h5::js {

std::string to_utf8(JSStringRef s)
{
    const size_t max = JSStringGetMaximumUTF8CStringSize(s);
    std::string out(max, '\0');
    const size_t n = JSStringGetUTF8CString(s, out.data(), max);   // n counts the terminating zero
    out.resize(n ? n - 1 : 0);
    return out;
}

std::string to_string(JSContextRef ctx, JSValueRef v)
{
    JSValueRef exception = nullptr;
    JSStringRef s = JSValueToStringCopy(ctx, v, &exception);
    if (!s)
        return {};
    std::string out = to_utf8(s);
    JSStringRelease(s);
    return out;
}

double to_number(JSContextRef ctx, JSValueRef v)
{
    if (JSValueIsNumber(ctx, v))
        return JSValueToNumber(ctx, v, nullptr);
    JSValueRef exception = nullptr;
    const double d = JSValueToNumber(ctx, v, &exception);
    return exception ? NAN : d;
}

JSValueRef make_string(JSContextRef ctx, const std::string &utf8)
{
    Str s(utf8);
    return JSValueMakeString(ctx, s);
}

JSValueRef get(JSContextRef ctx, JSObjectRef obj, const char *name)
{
    Str s(name);
    return JSObjectGetProperty(ctx, obj, s, nullptr);
}

void set(JSContextRef ctx, JSObjectRef obj, const char *name, JSValueRef value, bool enumerable)
{
    Str s(name);
    JSObjectSetProperty(ctx, obj, s, value, enumerable ? kJSPropertyAttributeNone : kJSPropertyAttributeDontEnum, nullptr);
}

void def(JSContextRef ctx, JSObjectRef obj, const char *name, JSObjectCallAsFunctionCallback fn)
{
    Str s(name);
    JSObjectRef f = JSObjectMakeFunctionWithCallback(ctx, s, fn);
    JSObjectSetProperty(ctx, obj, s, f, kJSPropertyAttributeDontEnum, nullptr);
}

JSObjectRef object_of(JSContextRef ctx, JSValueRef v)
{
    if (!v || !JSValueIsObject(ctx, v))
        return nullptr;
    return JSValueToObject(ctx, v, nullptr);
}

JSValueRef throw_error(JSContextRef ctx, JSValueRef *exception, const std::string &message, bool type)
{
    if (exception) {
        JSValueRef arg = make_string(ctx, message);
        if (type) {
            JSObjectRef global = JSContextGetGlobalObject(ctx);
            JSObjectRef ctor = object_of(ctx, get(ctx, global, "TypeError"));
            *exception = ctor ? JSObjectCallAsConstructor(ctx, ctor, 1, &arg, nullptr) : JSObjectMakeError(ctx, 1, &arg, nullptr);
        } else {
            *exception = JSObjectMakeError(ctx, 1, &arg, nullptr);
        }
    }
    return JSValueMakeUndefined(ctx);
}

std::string describe(JSContextRef ctx, JSValueRef exception)
{
    if (!exception)
        return "(no exception)";
    std::string text = to_string(ctx, exception);
    if (JSObjectRef obj = object_of(ctx, exception)) {
        JSValueRef stack = get(ctx, obj, "stack");
        if (stack && JSValueIsString(ctx, stack)) {
            std::string s = to_string(ctx, stack);
            if (!s.empty())
                text += "\n" + s;
        }
        JSValueRef url = get(ctx, obj, "sourceURL");
        JSValueRef line = get(ctx, obj, "line");
        JSValueRef column = get(ctx, obj, "column");
        if (line && JSValueIsNumber(ctx, line))
            text += "\n  at " + (url && JSValueIsString(ctx, url) ? to_string(ctx, url) : std::string("(no url)")) + ":" +
                to_string(ctx, line) + ":" + to_string(ctx, column);
    }
    return text;
}

Bytes bytes_of(JSContextRef ctx, JSValueRef v)
{
    Bytes b;
    JSObjectRef obj = object_of(ctx, v);
    if (!obj)
        return b;
    const JSTypedArrayType type = JSValueGetTypedArrayType(ctx, v, nullptr);
    b.type = type;
    if (type == kJSTypedArrayTypeArrayBuffer) {
        b.data = JSObjectGetArrayBufferBytesPtr(ctx, obj, nullptr);
        b.size = JSObjectGetArrayBufferByteLength(ctx, obj, nullptr);
    } else if (type != kJSTypedArrayTypeNone) {
        b.data = JSObjectGetTypedArrayBytesPtr(ctx, obj, nullptr);
        b.size = JSObjectGetTypedArrayByteLength(ctx, obj, nullptr);
    } else {
        // a DataView: {buffer, byteOffset, byteLength}
        JSValueRef buffer = get(ctx, obj, "buffer");
        if (JSValueGetTypedArrayType(ctx, buffer, nullptr) == kJSTypedArrayTypeArrayBuffer) {
            JSObjectRef bo = object_of(ctx, buffer);
            auto *base = static_cast<uint8_t *>(JSObjectGetArrayBufferBytesPtr(ctx, bo, nullptr));
            const double offset = to_number(ctx, get(ctx, obj, "byteOffset"));
            const double length = to_number(ctx, get(ctx, obj, "byteLength"));
            if (base && std::isfinite(offset) && std::isfinite(length)) {
                b.data = base + static_cast<size_t>(offset);
                b.size = static_cast<size_t>(length);
                b.type = kJSTypedArrayTypeUint8Array;
            }
        }
    }
    return b;
}

static void free_bytes(void *bytes, void *)
{
    free(bytes);
}

JSObjectRef make_array_buffer(JSContextRef ctx, std::vector<uint8_t> &&data)
{
    const size_t size = data.size();
    void *copy = malloc(size ? size : 1);
    if (size)
        memcpy(copy, data.data(), size);
    std::vector<uint8_t>().swap(data);
    if (size > (1u << 20))
        JSReportExtraMemoryCost(ctx, size);
    return JSObjectMakeArrayBufferWithBytesNoCopy(ctx, copy, size, free_bytes, nullptr, nullptr);
}

JSObjectRef make_typed_array(JSContextRef ctx, JSTypedArrayType type, const void *data, size_t size)
{
    void *copy = malloc(size ? size : 1);
    if (size)
        memcpy(copy, data, size);
    return JSObjectMakeTypedArrayWithBytesNoCopy(ctx, type, copy, size, free_bytes, nullptr, nullptr);
}

} // namespace h5::js
