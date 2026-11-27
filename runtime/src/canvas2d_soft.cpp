// h5: canvas 2D, software fallback (PC test build until its Skia is built): rectangles, images and pixel
// access with an affine transform's scale and offset; paths and text draw nothing (measureText estimates).
// Same natives as canvas2d_skia.cpp: js/canvas2d.js parses colours and fonts and calls these.
#include "engine.h"
#include "h5.h"
#include "handles.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstring>
#include <set>
#include <string>

namespace h5 {
namespace {

struct State {
    double m[6] = { 1, 0, 0, 1, 0, 0 };   // a b c d e f
    uint32_t fill = 0xff000000;           // AARRGGBB (straight alpha)
    double alpha = 1;
    double font_px = 10;
    bool font_registered = false;         // the first family is a registered web font (measures differently)
};

// families given to registerFont (lower case); text in them measures wider than in the fallback
std::set<std::string> g_families;
std::string lower_first_family(const std::string &list)
{
    std::string f = list.substr(0, list.find(','));
    std::string out;
    for (char ch : f)
        if (ch != '"' && ch != '\'')
            out += static_cast<char>(tolower(static_cast<unsigned char>(ch)));
    while (!out.empty() && out.back() == ' ')
        out.pop_back();
    while (!out.empty() && out.front() == ' ')
        out.erase(out.begin());
    return out;
}

class Canvas final : public Handle {
public:
    Canvas(int w, int h) : Handle(Kind::Canvas2D) { resize(w, h); }
    void resize(int w, int h)
    {
        m_w = std::max(1, w);
        m_h = std::max(1, h);
        m_px.assign(static_cast<size_t>(m_w) * m_h * 4, 0);
        m_stack.clear();
        m_state = State();
    }
    bool pixels(PixelView &v) override
    {
        v.data = m_px.data();
        v.width = m_w;
        v.height = m_h;
        v.stride = m_w * 4;
        v.premultiplied = true;
        return true;
    }
    size_t memory_cost() const override { return m_px.size(); }

    int m_w = 1, m_h = 1;
    std::vector<uint8_t> m_px;   // premultiplied RGBA
    State m_state;
    std::vector<State> m_stack;

    // the device rectangle of a user rectangle (scale + offset of the transform; rotation ignored)
    void device_rect(double x, double y, double w, double h, int &x0, int &y0, int &x1, int &y1) const
    {
        const double *m = m_state.m;
        double ax = m[0] * x + m[2] * y + m[4], ay = m[1] * x + m[3] * y + m[5];
        double bx = m[0] * (x + w) + m[2] * (y + h) + m[4], by = m[1] * (x + w) + m[3] * (y + h) + m[5];
        x0 = std::clamp(static_cast<int>(std::floor(std::min(ax, bx) + 0.5)), 0, m_w);
        x1 = std::clamp(static_cast<int>(std::floor(std::max(ax, bx) + 0.5)), 0, m_w);
        y0 = std::clamp(static_cast<int>(std::floor(std::min(ay, by) + 0.5)), 0, m_h);
        y1 = std::clamp(static_cast<int>(std::floor(std::max(ay, by) + 0.5)), 0, m_h);
    }
    void blend(uint8_t *d, unsigned r, unsigned g, unsigned b, unsigned a)   // premultiplied source over
    {
        const unsigned ia = 255 - a;
        d[0] = static_cast<uint8_t>(r + (d[0] * ia + 127) / 255);
        d[1] = static_cast<uint8_t>(g + (d[1] * ia + 127) / 255);
        d[2] = static_cast<uint8_t>(b + (d[2] * ia + 127) / 255);
        d[3] = static_cast<uint8_t>(a + (d[3] * ia + 127) / 255);
    }
};

Canvas *canvas_of(JSContextRef ctx, JSValueRef v)
{
    Handle *h = handle_of(ctx, v);
    return h && h->kind() == Handle::Kind::Canvas2D ? static_cast<Canvas *>(h) : nullptr;
}

#define CANVAS(i)                                                                                                \
    Canvas *c = canvas_of(ctx, H5_ARG(i));                                                                       \
    if (!c)                                                                                                      \
        return H5_UNDEFINED;

H5_NATIVE(n_create)
{
    return make_handle(ctx, new Canvas(H5_INT(0), H5_INT(1)));
}

H5_NATIVE(n_resize)
{
    CANVAS(0);
    c->resize(H5_INT(1), H5_INT(2));
    return H5_UNDEFINED;
}

H5_NATIVE(n_save)
{
    CANVAS(0);
    c->m_stack.push_back(c->m_state);
    return H5_UNDEFINED;
}

H5_NATIVE(n_restore)
{
    CANVAS(0);
    if (!c->m_stack.empty()) {
        c->m_state = c->m_stack.back();
        c->m_stack.pop_back();
    }
    return H5_UNDEFINED;
}

// transform(h, a, b, c, d, e, f, reset)
H5_NATIVE(n_transform)
{
    CANVAS(0);
    double n[6];
    for (int i = 0; i < 6; i++)
        n[i] = H5_NUM(i + 1);
    double *m = c->m_state.m;
    if (H5_BOOL(7)) {
        memcpy(m, n, sizeof n);
    } else {
        const double r[6] = { m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3],
            m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5] };
        memcpy(m, r, sizeof r);
    }
    return H5_UNDEFINED;
}

// setFill(h, argb) / setStrokeColor / setGlobalAlpha(h, a) / setFont(h, family, px, weight, italic)
H5_NATIVE(n_set_fill_color)
{
    CANVAS(0);
    c->m_state.fill = H5_UINT(1);
    return H5_UNDEFINED;
}
H5_NATIVE(n_set_global_alpha)
{
    CANVAS(0);
    c->m_state.alpha = std::clamp(H5_NUM(1), 0.0, 1.0);
    return H5_UNDEFINED;
}
H5_NATIVE(n_set_font)
{
    CANVAS(0);
    c->m_state.font_px = std::max(1.0, H5_NUM(2));
    c->m_state.font_registered = g_families.count(lower_first_family(H5_STR(1))) > 0;
    return H5_UNDEFINED;
}
H5_NATIVE(n_ignore)
{
    return H5_UNDEFINED;
}

H5_NATIVE(n_fill_rect)
{
    CANVAS(0);
    int x0, y0, x1, y1;
    c->device_rect(H5_NUM(1), H5_NUM(2), H5_NUM(3), H5_NUM(4), x0, y0, x1, y1);
    const uint32_t col = c->m_state.fill;
    const unsigned a = static_cast<unsigned>(((col >> 24) & 255) * c->m_state.alpha + 0.5);
    const unsigned r = ((col >> 16) & 255) * a / 255, g = ((col >> 8) & 255) * a / 255, b = (col & 255) * a / 255;
    for (int y = y0; y < y1; y++)
        for (int x = x0; x < x1; x++)
            c->blend(&c->m_px[(static_cast<size_t>(y) * c->m_w + x) * 4], r, g, b, a);
    return H5_UNDEFINED;
}

H5_NATIVE(n_clear_rect)
{
    CANVAS(0);
    int x0, y0, x1, y1;
    c->device_rect(H5_NUM(1), H5_NUM(2), H5_NUM(3), H5_NUM(4), x0, y0, x1, y1);
    for (int y = y0; y < y1; y++)
        memset(&c->m_px[(static_cast<size_t>(y) * c->m_w + x0) * 4], 0, static_cast<size_t>(x1 - x0) * 4);
    return H5_UNDEFINED;
}

// drawImage(h, source, sx, sy, sw, sh, dx, dy, dw, dh): nearest sampling, scale + offset
H5_NATIVE(n_draw_image)
{
    CANVAS(0);
    Handle *src = handle_of(ctx, H5_ARG(1));
    PixelView v;
    if (!src || !src->pixels(v) || !v.data)
        return H5_UNDEFINED;
    const double sx = H5_NUM(2), sy = H5_NUM(3), sw = H5_NUM(4), sh = H5_NUM(5);
    int x0, y0, x1, y1;
    c->device_rect(H5_NUM(6), H5_NUM(7), H5_NUM(8), H5_NUM(9), x0, y0, x1, y1);
    if (x1 <= x0 || y1 <= y0 || sw <= 0 || sh <= 0)
        return H5_UNDEFINED;
    const double ga = c->m_state.alpha;
    for (int y = y0; y < y1; y++) {
        const int syy = std::clamp(static_cast<int>(sy + (y - y0 + 0.5) * sh / (y1 - y0)), 0, v.height - 1);
        for (int x = x0; x < x1; x++) {
            const int sxx = std::clamp(static_cast<int>(sx + (x - x0 + 0.5) * sw / (x1 - x0)), 0, v.width - 1);
            const uint8_t *s = v.data + static_cast<size_t>(syy) * v.stride + sxx * 4;
            unsigned a = s[3], r = s[0], g = s[1], b = s[2];
            if (!v.premultiplied) {
                r = r * a / 255;
                g = g * a / 255;
                b = b * a / 255;
            }
            if (ga < 1) {
                r = static_cast<unsigned>(r * ga);
                g = static_cast<unsigned>(g * ga);
                b = static_cast<unsigned>(b * ga);
                a = static_cast<unsigned>(a * ga);
            }
            c->blend(&c->m_px[(static_cast<size_t>(y) * c->m_w + x) * 4], r, g, b, a);
        }
    }
    return H5_UNDEFINED;
}

// getImageData(h, x, y, w, h) -> Uint8ClampedArray (straight alpha)
H5_NATIVE(n_get_image_data)
{
    CANVAS(0);
    const int x = H5_INT(1), y = H5_INT(2), w = std::max(0, H5_INT(3)), h = std::max(0, H5_INT(4));
    std::vector<uint8_t> out(static_cast<size_t>(w) * h * 4, 0);
    for (int j = 0; j < h; j++) {
        const int yy = y + j;
        if (yy < 0 || yy >= c->m_h)
            continue;
        for (int i = 0; i < w; i++) {
            const int xx = x + i;
            if (xx < 0 || xx >= c->m_w)
                continue;
            const uint8_t *s = &c->m_px[(static_cast<size_t>(yy) * c->m_w + xx) * 4];
            uint8_t *d = &out[(static_cast<size_t>(j) * w + i) * 4];
            const unsigned a = s[3];
            d[3] = static_cast<uint8_t>(a);
            if (a) {
                d[0] = static_cast<uint8_t>(std::min(255u, s[0] * 255u / a));
                d[1] = static_cast<uint8_t>(std::min(255u, s[1] * 255u / a));
                d[2] = static_cast<uint8_t>(std::min(255u, s[2] * 255u / a));
            }
        }
    }
    return js::make_typed_array(ctx, kJSTypedArrayTypeUint8ClampedArray, out.data(), out.size());
}

// putImageData(h, data, width, height, dx, dy)
H5_NATIVE(n_put_image_data)
{
    CANVAS(0);
    const js::Bytes b = js::bytes_of(ctx, H5_ARG(1));
    const int w = H5_INT(2), h = H5_INT(3), dx = H5_INT(4), dy = H5_INT(5);
    if (!b.data || b.size < static_cast<size_t>(w) * h * 4)
        return H5_UNDEFINED;
    const auto *s0 = static_cast<const uint8_t *>(b.data);
    for (int j = 0; j < h; j++) {
        const int yy = dy + j;
        if (yy < 0 || yy >= c->m_h)
            continue;
        for (int i = 0; i < w; i++) {
            const int xx = dx + i;
            if (xx < 0 || xx >= c->m_w)
                continue;
            const uint8_t *s = s0 + (static_cast<size_t>(j) * w + i) * 4;
            uint8_t *d = &c->m_px[(static_cast<size_t>(yy) * c->m_w + xx) * 4];
            const unsigned a = s[3];
            d[0] = static_cast<uint8_t>(s[0] * a / 255);
            d[1] = static_cast<uint8_t>(s[1] * a / 255);
            d[2] = static_cast<uint8_t>(s[2] * a / 255);
            d[3] = static_cast<uint8_t>(a);
        }
    }
    return H5_UNDEFINED;
}

// measureText(h, text) -> [width, actualLeft, actualRight, actualAscent, actualDescent, fontAscent, fontDescent]
H5_NATIVE(n_measure_text)
{
    CANVAS(0);
    const std::string text = H5_STR(1);
    size_t chars = 0;
    for (unsigned char ch : text)
        if ((ch & 0xc0) != 0x80)
            chars++;
    const double px = c->m_state.font_px;
    const double width = chars * px * (c->m_state.font_registered ? 0.6 : 0.55);
    JSValueRef items[7] = { JSValueMakeNumber(ctx, width), JSValueMakeNumber(ctx, 0), JSValueMakeNumber(ctx, width),
        JSValueMakeNumber(ctx, px * 0.75), JSValueMakeNumber(ctx, px * 0.2), JSValueMakeNumber(ctx, px * 0.8),
        JSValueMakeNumber(ctx, px * 0.2) };
    return JSObjectMakeArray(ctx, 7, items, nullptr);
}

// registerFont(family, bytes, weight, italic)
H5_NATIVE(n_register_font)
{
    g_families.insert(lower_first_family(H5_STR(0)));
    return JSValueMakeBoolean(ctx, true);
}

H5_NATIVE(n_gradient)
{
    return JSValueMakeNull(ctx);
}

void install(JSContextRef ctx, JSObjectRef h5)
{
    JSObjectRef o = JSObjectMake(ctx, nullptr, nullptr);
    js::set(ctx, h5, "c2d", o, false);
    js::set(ctx, o, "backend", js::make_string(ctx, "soft"));
    struct { const char *name; JSObjectCallAsFunctionCallback fn; } table[] = {
        { "create", n_create }, { "resize", n_resize }, { "save", n_save }, { "restore", n_restore },
        { "transform", n_transform }, { "setFillColor", n_set_fill_color }, { "setStrokeColor", n_ignore },
        { "setFillGradient", n_ignore }, { "setStrokeGradient", n_ignore }, { "setFillPattern", n_ignore },
        { "setGlobalAlpha", n_set_global_alpha }, { "setComposite", n_ignore }, { "setLine", n_ignore },
        { "setLineDash", n_ignore }, { "setShadow", n_ignore }, { "setFont", n_set_font }, { "setText", n_ignore },
        { "setSmoothing", n_ignore }, { "fillRect", n_fill_rect }, { "strokeRect", n_ignore }, { "clearRect", n_clear_rect },
        { "fillPath", n_ignore }, { "strokePath", n_ignore }, { "clipPath", n_ignore }, { "fillText", n_ignore },
        { "strokeText", n_ignore }, { "measureText", n_measure_text }, { "drawImage", n_draw_image },
        { "getImageData", n_get_image_data }, { "putImageData", n_put_image_data }, { "registerFont", n_register_font },
        { "gradient", n_gradient }, { "gradientStop", n_ignore }, { "pattern", n_gradient },
    };
    for (const auto &t : table)
        js::def(ctx, o, t.name, t.fn);
}

struct Registration {
    Registration() { engine::register_natives("canvas2d", install); }
} g_registration;

} // namespace

// (svg.cpp is Skia's; the software build draws no SVG)
bool svg_rasterize(const uint8_t *, size_t, int, int, std::vector<uint8_t> &, int &, int &)
{
    return false;
}

} // namespace h5
