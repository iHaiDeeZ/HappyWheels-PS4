// h5: native objects held by JavaScript (decoded images, 2D canvases, audio buffers). A handle is a JS
// object of one private class; its C++ object is deleted when the JS object is collected.
#pragma once

#include "js.h"

#include <cstdint>
#include <memory>

namespace h5 {

// RGBA8 pixels, rows top to bottom
struct PixelView {
    const uint8_t *data = nullptr;
    int width = 0;
    int height = 0;
    int stride = 0;            // bytes per row
    bool premultiplied = false;
};

class Handle {
public:
    enum class Kind { Image, Canvas2D, AudioBuffer, Paint, Other };
    explicit Handle(Kind kind) : m_kind(kind) { }
    virtual ~Handle() = default;
    Kind kind() const { return m_kind; }
    // the pixels, if this handle has any (images, canvases)
    virtual bool pixels(PixelView &) { return false; }
    // bytes it holds outside the JS heap (reported to the collector)
    virtual size_t memory_cost() const { return 0; }
    // a drawing backend's cached form of these pixels (canvas2d_skia.cpp: an SkImage); images never change
    std::shared_ptr<void> backend_cache;

private:
    Kind m_kind;
};

// a JS object owning `handle`
JSObjectRef make_handle(JSContextRef ctx, Handle *handle);
// the handle of a JS value made by make_handle, or nullptr
Handle *handle_of(JSContextRef ctx, JSValueRef value);

} // namespace h5
