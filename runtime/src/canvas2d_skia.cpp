// h5: canvas 2D on Skia (raster, CPU): OrbisWeb's libSkia.a on the PS4. Same natives as canvas2d_soft.cpp;
// js/canvas2d.js parses colours (0xAARRGGBB) and fonts and keeps the page-visible state.
// Pixels are RGBA8 premultiplied (texImage2D uploads them as they are). Also svg_rasterize (SkSVGDOM).
#include "engine.h"
#include "h5.h"
#include "handles.h"

#include "include/core/SkCanvas.h"
#include "include/core/SkData.h"
#include "include/core/SkFont.h"
#include "include/core/SkFontMetrics.h"
#include "include/core/SkFontMgr.h"
#include "include/core/SkImage.h"
#include "include/core/SkPaint.h"
#include "include/core/SkPath.h"
#include "include/core/SkPathBuilder.h"
#include "include/core/SkPixmap.h"
#include "include/core/SkRRect.h"
#include "include/core/SkStream.h"
#include "include/core/SkSurface.h"
#include "include/core/SkTextBlob.h"
#include "include/core/SkTypeface.h"
#include "include/effects/SkDashPathEffect.h"
#include "include/effects/SkGradient.h"
#include "include/effects/SkImageFilters.h"
#include "include/utils/SkParsePath.h"
#include "modules/svg/include/SkSVGDOM.h"
#include "modules/svg/include/SkSVGRenderContext.h"
#include "modules/svg/include/SkSVGSVG.h"
#include "src/ports/SkTypeface_FreeType.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstring>
#include <mutex>

namespace h5 {
namespace {

// ---------------------------------------------------------------- fonts
struct Face {
    std::string family;   // lower case
    int weight;
    bool italic;
    sk_sp<SkTypeface> typeface;
};
std::mutex g_faces_mutex;
std::vector<Face> g_faces;
sk_sp<SkTypeface> g_fallback;
bool g_fallback_tried = false;
unsigned g_faces_generation = 1;   // bumps when a font registers: canvases look their family up again

std::string lower(std::string s)
{
    for (char &c : s)
        c = static_cast<char>(tolower(static_cast<unsigned char>(c)));
    return s;
}

sk_sp<SkTypeface> typeface_from(const void *data, size_t size)
{
    auto stream = std::make_unique<SkMemoryStream>(SkData::MakeWithCopy(data, size));
    return SkTypeface_FreeType::MakeFromStream(std::move(stream), SkFontArguments());
}

sk_sp<SkTypeface> fallback()
{
    if (!g_fallback_tried) {
        g_fallback_tried = true;
        std::vector<uint8_t> bytes;
        const std::string path = paths.runtime + "/fonts/fallback.ttf";
        if (read_file(path, bytes))
            g_fallback = typeface_from(bytes.data(), bytes.size());
        if (!g_fallback)
            H5_WARN("canvas: no fallback font (%s): text in unknown families is not drawn", path.c_str());
    }
    return g_fallback;
}

// The runtime's sans-serif: Liberation Sans (runtime/fonts, Arial's metrics), for Arial, Helvetica and the
// generic sans-serif, as Chrome on Windows draws them with Arial. Index 0 regular, 1 bold. (Called with
// g_faces_mutex held.)
sk_sp<SkTypeface> g_sans[2];
bool g_sans_tried = false;

sk_sp<SkTypeface> sans(int weight)
{
    if (!g_sans_tried) {
        g_sans_tried = true;
        const char *files[2] = { "LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf" };
        for (int i = 0; i < 2; i++) {
            std::vector<uint8_t> bytes;
            if (read_file(paths.runtime + "/fonts/" + files[i], bytes))
                g_sans[i] = typeface_from(bytes.data(), bytes.size());
        }
    }
    const int i = weight >= 600 ? 1 : 0;
    return g_sans[i] ? g_sans[i] : g_sans[1 - i];
}

bool sans_family(const std::string &fam)
{
    return fam == "arial" || fam == "helvetica" || fam == "sans-serif" || fam == "liberation sans" || fam == "arimo" ||
        fam == "system-ui" || fam == "-apple-system";
}

std::string trim_family(std::string fam)
{
    fam.erase(std::remove(fam.begin(), fam.end(), '"'), fam.end());
    fam.erase(std::remove(fam.begin(), fam.end(), '\''), fam.end());
    while (!fam.empty() && fam.front() == ' ')
        fam.erase(fam.begin());
    while (!fam.empty() && fam.back() == ' ')
        fam.pop_back();
    return lower(fam);
}

// the face for a CSS family list: the first registered family, nearest weight, matching style
sk_sp<SkTypeface> find_face(const std::string &families, int weight, bool italic)
{
    std::lock_guard<std::mutex> lock(g_faces_mutex);
    size_t start = 0;
    while (start <= families.size()) {
        size_t comma = families.find(',', start);
        if (comma == std::string::npos)
            comma = families.size();
        const std::string fam = trim_family(families.substr(start, comma - start));
        const Face *best = nullptr;
        int best_score = 1 << 30;
        for (const Face &f : g_faces) {
            if (f.family != fam)
                continue;
            const int score = std::abs(f.weight - weight) + (f.italic != italic ? 1000 : 0);
            if (score < best_score) {
                best = &f;
                best_score = score;
            }
        }
        if (best)
            return best->typeface;
        if (sans_family(fam)) {   // (a page's own face of that name came first)
            if (sk_sp<SkTypeface> t = sans(weight))
                return t;
        }
        start = comma + 1;
    }
    return fallback();
}

// ---------------------------------------------------------------- state
struct State {
    SkColor fill = SK_ColorBLACK, stroke = SK_ColorBLACK;
    sk_sp<SkShader> fill_shader, stroke_shader;
    float alpha = 1;
    SkBlendMode blend = SkBlendMode::kSrcOver;
    float line_width = 1, miter = 10;
    SkPaint::Cap cap = SkPaint::kButt_Cap;
    SkPaint::Join join = SkPaint::kMiter_Join;
    std::vector<float> dash;
    float dash_offset = 0;
    SkColor shadow = 0;
    float shadow_blur = 0, shadow_x = 0, shadow_y = 0;
    std::string families = "sans-serif";
    float font_size = 10;
    int weight = 400;
    bool italic = false;
    sk_sp<SkTypeface> typeface;
    unsigned typeface_generation = 0;
    int align = 0, baseline = 0;   // js/canvas2d.js ALIGN (start left center right end) / BASELINE
    float letter_spacing = 0;
    bool rtl = false;
    bool smoothing = true;
};

class Canvas final : public Handle {
public:
    Canvas(int w, int h) : Handle(Kind::Canvas2D) { resize(w, h); }
    void resize(int w, int h)
    {
        m_w = std::max(1, w);
        m_h = std::max(1, h);
        m_surface = SkSurfaces::Raster(SkImageInfo::Make(m_w, m_h, kRGBA_8888_SkColorType, kPremul_SkAlphaType));
        if (m_surface)
            m_surface->getCanvas()->clear(SK_ColorTRANSPARENT);
        m_state = State();
        m_stack.clear();
    }
    bool pixels(PixelView &v) override
    {
        SkPixmap pm;
        if (!m_surface || !m_surface->peekPixels(&pm))
            return false;
        v.data = static_cast<const uint8_t *>(pm.addr());
        v.width = pm.width();
        v.height = pm.height();
        v.stride = static_cast<int>(pm.rowBytes());
        v.premultiplied = true;
        return true;
    }
    size_t memory_cost() const override { return static_cast<size_t>(m_w) * m_h * 4; }
    SkCanvas *canvas() { return m_surface ? m_surface->getCanvas() : nullptr; }

    int m_w = 1, m_h = 1;
    sk_sp<SkSurface> m_surface;
    State m_state;
    std::vector<State> m_stack;

    SkPaint paint(bool fill) const
    {
        const State &s = m_state;
        SkPaint p;
        p.setAntiAlias(true);
        p.setBlendMode(s.blend);
        if (fill) {
            p.setStyle(SkPaint::kFill_Style);
        } else {
            p.setStyle(SkPaint::kStroke_Style);
            p.setStrokeWidth(s.line_width);
            p.setStrokeCap(s.cap);
            p.setStrokeJoin(s.join);
            p.setStrokeMiter(s.miter);
            if (!s.dash.empty())
                p.setPathEffect(SkDashPathEffect::Make(SkSpan<const SkScalar>(s.dash.data(), s.dash.size()), s.dash_offset));
        }
        const sk_sp<SkShader> &shader = fill ? s.fill_shader : s.stroke_shader;
        const SkColor color = fill ? s.fill : s.stroke;
        if (shader) {
            p.setShader(shader);
            p.setAlphaf(s.alpha);
        } else {
            p.setColor(color);
            p.setAlphaf(SkColorGetA(color) / 255.0f * s.alpha);
        }
        if (SkColorGetA(s.shadow) && (s.shadow_blur > 0 || s.shadow_x != 0 || s.shadow_y != 0))
            p.setImageFilter(SkImageFilters::DropShadow(s.shadow_x, s.shadow_y, s.shadow_blur / 2, s.shadow_blur / 2, s.shadow, nullptr));
        return p;
    }
    SkSamplingOptions sampling() const
    {
        return m_state.smoothing ? SkSamplingOptions(SkFilterMode::kLinear, SkMipmapMode::kNone) : SkSamplingOptions(SkFilterMode::kNearest);
    }
    SkFont font()
    {
        State &s = m_state;
        if (!s.typeface || s.typeface_generation != g_faces_generation) {
            s.typeface = find_face(s.families, s.weight, s.italic);
            s.typeface_generation = g_faces_generation;
        }
        SkFont f(s.typeface, s.font_size);
        f.setSubpixel(true);
        f.setEdging(SkFont::Edging::kAntiAlias);
        return f;
    }
};

Canvas *canvas_of(JSContextRef ctx, JSValueRef v)
{
    Handle *h = handle_of(ctx, v);
    return h && h->kind() == Handle::Kind::Canvas2D ? static_cast<Canvas *>(h) : nullptr;
}

// gradients and patterns
class Paintable final : public Handle {
public:
    Paintable() : Handle(Kind::Paint) { }
    int kind = 0;   // 0 linear, 1 radial, 2 conic, 3 pattern
    float coords[6] = {};
    std::vector<std::pair<float, SkColor4f>> stops;
    sk_sp<SkShader> pattern;
    sk_sp<SkShader> shader() const
    {
        if (kind == 3)
            return pattern;
        if (stops.empty())
            return nullptr;
        auto sorted = stops;
        std::stable_sort(sorted.begin(), sorted.end(), [](const auto &a, const auto &b) { return a.first < b.first; });
        std::vector<SkColor4f> colors;
        std::vector<float> pos;
        for (const auto &[o, c] : sorted) {
            colors.push_back(c);
            pos.push_back(o);
        }
        if (colors.size() == 1) {
            colors.push_back(colors[0]);
            pos.push_back(1);
        }
        SkGradient grad(SkGradient::Colors(SkSpan<const SkColor4f>(colors), SkSpan<const float>(pos), SkTileMode::kClamp),
            SkGradient::Interpolation());
        if (kind == 0) {
            const SkPoint pts[2] = { { coords[0], coords[1] }, { coords[3], coords[4] } };
            return SkShaders::LinearGradient(pts, grad);
        }
        if (kind == 1)
            return SkShaders::TwoPointConicalGradient({ coords[0], coords[1] }, coords[2], { coords[3], coords[4] }, coords[5], grad);
        const float start = coords[2] * 180 / static_cast<float>(M_PI);
        return SkShaders::SweepGradient({ coords[0], coords[1] }, start, start + 360, grad);
    }
};

Paintable *paintable_of(JSContextRef ctx, JSValueRef v)
{
    Handle *h = handle_of(ctx, v);
    return h && h->kind() == Handle::Kind::Paint ? static_cast<Paintable *>(h) : nullptr;
}

SkColor argb(uint32_t v)
{
    return static_cast<SkColor>(v);   // 0xAARRGGBB, as SkColor is
}

struct CachedImage {
    sk_sp<SkImage> image;
};

// an SkImage for a drawable handle: 2D canvases snapshot, images are converted once and kept
sk_sp<SkImage> image_of(Handle *h)
{
    if (!h)
        return nullptr;
    if (h->kind() == Handle::Kind::Canvas2D) {
        auto *c = static_cast<Canvas *>(h);
        return c->m_surface ? c->m_surface->makeImageSnapshot() : nullptr;
    }
    if (h->backend_cache)
        return static_cast<CachedImage *>(h->backend_cache.get())->image;
    PixelView v;
    if (!h->pixels(v) || !v.data)
        return nullptr;
    const SkImageInfo info = SkImageInfo::Make(v.width, v.height, kRGBA_8888_SkColorType, v.premultiplied ? kPremul_SkAlphaType : kUnpremul_SkAlphaType);
    sk_sp<SkImage> img = SkImages::RasterFromPixmapCopy(SkPixmap(info, v.data, static_cast<size_t>(v.stride)));
    auto cached = std::make_shared<CachedImage>();
    cached->image = img;
    h->backend_cache = cached;
    return img;
}

// ---------------------------------------------------------------- paths from js/canvas2d.js's commands
void add_arc(SkPathBuilder &b, double x, double y, double rx, double ry, double rot, double a0, double a1, bool ccw, bool has_points)
{
    double sweep = a1 - a0;
    const double tau = 2 * M_PI;
    if (!ccw) {
        if (sweep >= tau)
            sweep = tau;
        else {
            sweep = std::fmod(sweep, tau);
            if (sweep < 0)
                sweep += tau;
        }
    } else {
        if (-sweep >= tau)
            sweep = -tau;
        else {
            sweep = std::fmod(sweep, tau);
            if (sweep > 0)
                sweep -= tau;
        }
    }
    const SkRect oval = SkRect::MakeLTRB(static_cast<float>(-rx), static_cast<float>(-ry), static_cast<float>(rx), static_cast<float>(ry));
    const float start = static_cast<float>(a0 * 180 / M_PI), deg = static_cast<float>(sweep * 180 / M_PI);
    SkPathBuilder arc;
    if (std::fabs(deg) >= 359.999f) {
        arc.arcTo(oval, start, deg / 2, true);
        arc.arcTo(oval, start + deg / 2, deg / 2, false);
    } else {
        arc.arcTo(oval, start, deg, true);
    }
    SkMatrix m = SkMatrix::Translate(static_cast<float>(x), static_cast<float>(y));
    if (rot != 0)
        m.preRotate(static_cast<float>(rot * 180 / M_PI));
    b.addPath(arc.detach(), m, has_points ? SkPath::kExtend_AddPathMode : SkPath::kAppend_AddPathMode);
}

SkPath build_path(JSContextRef ctx, JSValueRef v, int fill_rule)
{
    SkPathBuilder b;
    b.setFillType(fill_rule == 1 ? SkPathFillType::kEvenOdd : SkPathFillType::kWinding);
    JSObjectRef arr = js::object_of(ctx, v);
    if (!arr)
        return b.detach();
    // ['10', svg path data] (new Path2D(string))
    if (JSValueGetTypedArrayType(ctx, v, nullptr) == kJSTypedArrayTypeNone) {
        JSValueRef first = JSObjectGetPropertyAtIndex(ctx, arr, 0, nullptr);
        if (js::to_int(ctx, first) == 10) {
            const std::string d = js::to_string(ctx, JSObjectGetPropertyAtIndex(ctx, arr, 1, nullptr));
            if (auto p = SkParsePath::FromSVGString(d.c_str())) {
                SkPath path = *p;
                path.setFillType(fill_rule == 1 ? SkPathFillType::kEvenOdd : SkPathFillType::kWinding);
                return path;
            }
            return b.detach();
        }
        return b.detach();
    }
    const js::Bytes bytes = js::bytes_of(ctx, v);
    const auto *c = static_cast<const double *>(bytes.data);
    const size_t n = bytes.size / 8;
    bool has_points = false;
    SkPoint last { 0, 0 };
    auto f = [](double d) { return static_cast<float>(d); };
    for (size_t i = 0; i < n;) {
        const int op = static_cast<int>(c[i++]);
        switch (op) {
        case 0:
            if (i + 2 > n) return b.detach();
            b.moveTo(f(c[i]), f(c[i + 1]));
            last = { f(c[i]), f(c[i + 1]) };
            i += 2;
            has_points = true;
            break;
        case 1:
            if (i + 2 > n) return b.detach();
            if (!has_points) b.moveTo(f(c[i]), f(c[i + 1])); else b.lineTo(f(c[i]), f(c[i + 1]));
            last = { f(c[i]), f(c[i + 1]) };
            i += 2;
            has_points = true;
            break;
        case 2:
            if (i + 4 > n) return b.detach();
            if (!has_points) b.moveTo(f(c[i]), f(c[i + 1]));
            b.quadTo(f(c[i]), f(c[i + 1]), f(c[i + 2]), f(c[i + 3]));
            last = { f(c[i + 2]), f(c[i + 3]) };
            i += 4;
            has_points = true;
            break;
        case 3:
            if (i + 6 > n) return b.detach();
            if (!has_points) b.moveTo(f(c[i]), f(c[i + 1]));
            b.cubicTo(f(c[i]), f(c[i + 1]), f(c[i + 2]), f(c[i + 3]), f(c[i + 4]), f(c[i + 5]));
            last = { f(c[i + 4]), f(c[i + 5]) };
            i += 6;
            has_points = true;
            break;
        case 4:   // arc x y r a0 a1 ccw
            if (i + 6 > n) return b.detach();
            add_arc(b, c[i], c[i + 1], c[i + 2], c[i + 2], 0, c[i + 3], c[i + 4], c[i + 5] != 0, has_points);
            i += 6;
            has_points = true;
            break;
        case 5:   // arcTo x1 y1 x2 y2 r
            if (i + 5 > n) return b.detach();
            if (!has_points) { b.moveTo(f(c[i]), f(c[i + 1])); has_points = true; }
            b.arcTo({ f(c[i]), f(c[i + 1]) }, { f(c[i + 2]), f(c[i + 3]) }, f(c[i + 4]));
            i += 5;
            break;
        case 6:   // rect
            if (i + 4 > n) return b.detach();
            b.addRect(SkRect::MakeXYWH(f(c[i]), f(c[i + 1]), f(c[i + 2]), f(c[i + 3])));
            b.moveTo(f(c[i]), f(c[i + 1]));
            i += 4;
            has_points = true;
            break;
        case 7:
            b.close();
            break;
        case 8:   // ellipse x y rx ry rot a0 a1 ccw
            if (i + 8 > n) return b.detach();
            add_arc(b, c[i], c[i + 1], c[i + 2], c[i + 3], c[i + 4], c[i + 5], c[i + 6], c[i + 7] != 0, has_points);
            i += 8;
            has_points = true;
            break;
        case 9:   // roundRect x y w h r
            if (i + 5 > n) return b.detach();
            b.addRRect(SkRRect::MakeRectXY(SkRect::MakeXYWH(f(c[i]), f(c[i + 1]), f(c[i + 2]), f(c[i + 3])), f(c[i + 4]), f(c[i + 4])));
            i += 5;
            has_points = true;
            break;
        default:
            return b.detach();
        }
    }
    (void)last;
    return b.detach();
}

// ---------------------------------------------------------------- text
struct Shaped {
    sk_sp<SkTextBlob> blob;
    float width = 0;
};
Shaped shape(Canvas *c, const std::string &text, const SkFont &font)
{
    Shaped out;
    const size_t count = font.countText(text.data(), text.size(), SkTextEncoding::kUTF8);
    if (!count)
        return out;
    std::vector<SkGlyphID> glyphs(count);
    font.textToGlyphs(text.data(), text.size(), SkTextEncoding::kUTF8, SkSpan<SkGlyphID>(glyphs));
    std::vector<SkScalar> widths(count);
    font.getWidths(SkSpan<const SkGlyphID>(glyphs), SkSpan<SkScalar>(widths));
    SkTextBlobBuilder builder;
    const auto &run = builder.allocRunPosH(font, static_cast<int>(count), 0);
    float x = 0;
    const float spacing = c->m_state.letter_spacing;
    for (size_t i = 0; i < count; i++) {
        run.glyphs[i] = glyphs[i];
        run.pos[i] = x;
        x += widths[i] + spacing;
    }
    out.width = x;
    out.blob = builder.make();
    return out;
}

// the baseline position for textBaseline (y is where the page put the text)
float baseline_y(const State &s, const SkFontMetrics &m, float y)
{
    switch (s.baseline) {
    case 1: return y - m.fAscent;                         // top
    case 2: return y - m.fAscent * 0.8f;                  // hanging
    case 3: return y - (m.fAscent + m.fDescent) / 2;      // middle
    case 5: return y - m.fDescent;                        // bottom
    case 4: return y - m.fDescent * 0.5f;                 // ideographic
    default: return y;                                    // alphabetic
    }
}

float aligned_x(const State &s, float x, float width)
{
    int a = s.align;   // 0 start 1 left 2 center 3 right 4 end
    if (a == 0) a = s.rtl ? 3 : 1;
    if (a == 4) a = s.rtl ? 1 : 3;
    return a == 2 ? x - width / 2 : a == 3 ? x - width : x;
}

void draw_text(Canvas *c, const std::string &text, float x, float y, float max_width, bool fill)
{
    SkCanvas *canvas = c->canvas();
    if (!canvas || text.empty())
        return;
    const SkFont font = c->font();
    if (!font.getTypeface())
        return;
    const Shaped s = shape(c, text, font);
    if (!s.blob)
        return;
    SkFontMetrics m;
    font.getMetrics(&m);
    const float by = baseline_y(c->m_state, m, y);
    float width = s.width;
    const bool squeeze = max_width >= 0 && width > max_width && width > 0;
    const float scale = squeeze ? max_width / width : 1;
    if (squeeze)
        width = max_width;
    const float bx = aligned_x(c->m_state, x, width);
    canvas->save();
    canvas->translate(bx, by);
    if (squeeze)
        canvas->scale(scale, 1);
    canvas->drawTextBlob(s.blob, 0, 0, c->paint(fill));
    canvas->restore();
}

// ---------------------------------------------------------------- natives
#define CANVAS(i)                                                                                                \
    Canvas *c = canvas_of(ctx, H5_ARG(i));                                                                       \
    if (!c || !c->canvas())                                                                                      \
        return H5_UNDEFINED;

H5_NATIVE(n_create)
{
    return make_handle(ctx, new Canvas(H5_INT(0), H5_INT(1)));
}

H5_NATIVE(n_resize)
{
    Canvas *c = canvas_of(ctx, H5_ARG(0));
    if (c)
        c->resize(H5_INT(1), H5_INT(2));
    return H5_UNDEFINED;
}

H5_NATIVE(n_save)
{
    CANVAS(0);
    c->m_stack.push_back(c->m_state);
    c->canvas()->save();
    return H5_UNDEFINED;
}

H5_NATIVE(n_restore)
{
    CANVAS(0);
    if (c->m_stack.empty())
        return H5_UNDEFINED;
    c->m_state = c->m_stack.back();
    c->m_stack.pop_back();
    c->canvas()->restore();
    return H5_UNDEFINED;
}

// transform(h, a, b, c, d, e, f, reset)
H5_NATIVE(n_transform)
{
    CANVAS(0);
    const float a = static_cast<float>(H5_NUM(1)), b = static_cast<float>(H5_NUM(2)), cc = static_cast<float>(H5_NUM(3)),
                d = static_cast<float>(H5_NUM(4)), e = static_cast<float>(H5_NUM(5)), f = static_cast<float>(H5_NUM(6));
    if (![&] { for (float v : { a, b, cc, d, e, f }) if (!std::isfinite(v)) return false; return true; }())
        return H5_UNDEFINED;
    const SkMatrix m = SkMatrix::MakeAll(a, cc, e, b, d, f, 0, 0, 1);
    if (H5_BOOL(7))
        c->canvas()->setMatrix(m);
    else
        c->canvas()->concat(m);
    return H5_UNDEFINED;
}

H5_NATIVE(n_get_transform)
{
    CANVAS(0);
    const SkMatrix m = c->canvas()->getTotalMatrix();
    JSValueRef items[6] = { JSValueMakeNumber(ctx, m.getScaleX()), JSValueMakeNumber(ctx, m.getSkewY()), JSValueMakeNumber(ctx, m.getSkewX()),
        JSValueMakeNumber(ctx, m.getScaleY()), JSValueMakeNumber(ctx, m.getTranslateX()), JSValueMakeNumber(ctx, m.getTranslateY()) };
    return JSObjectMakeArray(ctx, 6, items, nullptr);
}

H5_NATIVE(n_set_fill_color)
{
    CANVAS(0);
    c->m_state.fill = argb(H5_UINT(1));
    c->m_state.fill_shader = nullptr;
    return H5_UNDEFINED;
}

H5_NATIVE(n_set_stroke_color)
{
    CANVAS(0);
    c->m_state.stroke = argb(H5_UINT(1));
    c->m_state.stroke_shader = nullptr;
    return H5_UNDEFINED;
}

H5_NATIVE(n_set_fill_gradient)
{
    CANVAS(0);
    Paintable *p = paintable_of(ctx, H5_ARG(1));
    c->m_state.fill_shader = p ? p->shader() : nullptr;
    return H5_UNDEFINED;
}

H5_NATIVE(n_set_stroke_gradient)
{
    CANVAS(0);
    Paintable *p = paintable_of(ctx, H5_ARG(1));
    c->m_state.stroke_shader = p ? p->shader() : nullptr;
    return H5_UNDEFINED;
}

// setFillPattern(h, pattern, forStroke)
H5_NATIVE(n_set_fill_pattern)
{
    CANVAS(0);
    Paintable *p = paintable_of(ctx, H5_ARG(1));
    (H5_BOOL(2) ? c->m_state.stroke_shader : c->m_state.fill_shader) = p ? p->shader() : nullptr;
    return H5_UNDEFINED;
}

H5_NATIVE(n_set_global_alpha)
{
    CANVAS(0);
    c->m_state.alpha = std::clamp(static_cast<float>(H5_NUM(1)), 0.0f, 1.0f);
    return H5_UNDEFINED;
}

H5_NATIVE(n_set_composite)
{
    CANVAS(0);
    static const SkBlendMode modes[] = { SkBlendMode::kSrcOver, SkBlendMode::kSrcIn, SkBlendMode::kSrcOut, SkBlendMode::kSrcATop,
        SkBlendMode::kDstOver, SkBlendMode::kDstIn, SkBlendMode::kDstOut, SkBlendMode::kDstATop, SkBlendMode::kPlus, SkBlendMode::kSrc,
        SkBlendMode::kXor, SkBlendMode::kMultiply, SkBlendMode::kScreen, SkBlendMode::kOverlay, SkBlendMode::kDarken, SkBlendMode::kLighten,
        SkBlendMode::kColorDodge, SkBlendMode::kColorBurn, SkBlendMode::kHardLight, SkBlendMode::kSoftLight, SkBlendMode::kDifference,
        SkBlendMode::kExclusion, SkBlendMode::kHue, SkBlendMode::kSaturation, SkBlendMode::kColor, SkBlendMode::kLuminosity };
    const int i = H5_INT(1);
    if (i >= 0 && i < static_cast<int>(sizeof modes / sizeof modes[0]))
        c->m_state.blend = modes[i];
    return H5_UNDEFINED;
}

// setLine(h, width, cap, join, miter)
H5_NATIVE(n_set_line)
{
    CANVAS(0);
    static const SkPaint::Cap caps[] = { SkPaint::kButt_Cap, SkPaint::kRound_Cap, SkPaint::kSquare_Cap };
    static const SkPaint::Join joins[] = { SkPaint::kMiter_Join, SkPaint::kRound_Join, SkPaint::kBevel_Join };
    c->m_state.line_width = static_cast<float>(H5_NUM(1));
    c->m_state.cap = caps[std::clamp(H5_INT(2), 0, 2)];
    c->m_state.join = joins[std::clamp(H5_INT(3), 0, 2)];
    c->m_state.miter = static_cast<float>(H5_NUM(4));
    return H5_UNDEFINED;
}

// setLineDash(h, Float32Array, offset)
H5_NATIVE(n_set_line_dash)
{
    CANVAS(0);
    const js::Bytes b = js::bytes_of(ctx, H5_ARG(1));
    const auto *f = static_cast<const float *>(b.data);
    c->m_state.dash.assign(f, f + b.size / 4);
    if (c->m_state.dash.size() % 2)
        c->m_state.dash.insert(c->m_state.dash.end(), c->m_state.dash.begin(), c->m_state.dash.end());
    bool all_zero = true;
    for (float v : c->m_state.dash)
        if (v > 0)
            all_zero = false;
    if (all_zero)
        c->m_state.dash.clear();
    c->m_state.dash_offset = static_cast<float>(H5_NUM(2));
    return H5_UNDEFINED;
}

// setShadow(h, argb, blur, x, y)
H5_NATIVE(n_set_shadow)
{
    CANVAS(0);
    c->m_state.shadow = argb(H5_UINT(1));
    c->m_state.shadow_blur = static_cast<float>(H5_NUM(2));
    c->m_state.shadow_x = static_cast<float>(H5_NUM(3));
    c->m_state.shadow_y = static_cast<float>(H5_NUM(4));
    return H5_UNDEFINED;
}

// setFont(h, families, px, weight, italic)
H5_NATIVE(n_set_font)
{
    CANVAS(0);
    State &s = c->m_state;
    s.families = H5_STR(1);
    s.font_size = std::max(0.1f, static_cast<float>(H5_NUM(2)));
    s.weight = H5_INT(3);
    s.italic = H5_BOOL(4);
    s.typeface = nullptr;
    return H5_UNDEFINED;
}

// setText(h, align, baseline, letterSpacing, rtl)
H5_NATIVE(n_set_text)
{
    CANVAS(0);
    c->m_state.align = H5_INT(1);
    c->m_state.baseline = H5_INT(2);
    c->m_state.letter_spacing = static_cast<float>(H5_NUM(3));
    c->m_state.rtl = H5_BOOL(4);
    return H5_UNDEFINED;
}

H5_NATIVE(n_set_smoothing)
{
    CANVAS(0);
    c->m_state.smoothing = H5_BOOL(1);
    return H5_UNDEFINED;
}

H5_NATIVE(n_fill_rect)
{
    CANVAS(0);
    c->canvas()->drawRect(SkRect::MakeXYWH(static_cast<float>(H5_NUM(1)), static_cast<float>(H5_NUM(2)), static_cast<float>(H5_NUM(3)),
        static_cast<float>(H5_NUM(4))), c->paint(true));
    return H5_UNDEFINED;
}

H5_NATIVE(n_stroke_rect)
{
    CANVAS(0);
    c->canvas()->drawRect(SkRect::MakeXYWH(static_cast<float>(H5_NUM(1)), static_cast<float>(H5_NUM(2)), static_cast<float>(H5_NUM(3)),
        static_cast<float>(H5_NUM(4))), c->paint(false));
    return H5_UNDEFINED;
}

H5_NATIVE(n_clear_rect)
{
    CANVAS(0);
    SkPaint p;
    p.setBlendMode(SkBlendMode::kClear);
    c->canvas()->drawRect(SkRect::MakeXYWH(static_cast<float>(H5_NUM(1)), static_cast<float>(H5_NUM(2)), static_cast<float>(H5_NUM(3)),
        static_cast<float>(H5_NUM(4))), p);
    return H5_UNDEFINED;
}

// fillPath(h, commands, rule) / strokePath(h, commands) / clipPath(h, commands, rule)
H5_NATIVE(n_fill_path)
{
    CANVAS(0);
    c->canvas()->drawPath(build_path(ctx, H5_ARG(1), H5_INT(2)), c->paint(true));
    return H5_UNDEFINED;
}

H5_NATIVE(n_stroke_path)
{
    CANVAS(0);
    c->canvas()->drawPath(build_path(ctx, H5_ARG(1), 0), c->paint(false));
    return H5_UNDEFINED;
}

H5_NATIVE(n_clip_path)
{
    CANVAS(0);
    c->canvas()->clipPath(build_path(ctx, H5_ARG(1), H5_INT(2)), SkClipOp::kIntersect, true);
    return H5_UNDEFINED;
}

// fillText / strokeText(h, text, x, y, maxWidth (-1: none))
H5_NATIVE(n_fill_text)
{
    CANVAS(0);
    draw_text(c, H5_STR(1), static_cast<float>(H5_NUM(2)), static_cast<float>(H5_NUM(3)), static_cast<float>(H5_NUM(4)), true);
    return H5_UNDEFINED;
}

H5_NATIVE(n_stroke_text)
{
    CANVAS(0);
    draw_text(c, H5_STR(1), static_cast<float>(H5_NUM(2)), static_cast<float>(H5_NUM(3)), static_cast<float>(H5_NUM(4)), false);
    return H5_UNDEFINED;
}

// measureText(h, text) -> [width, actualLeft, actualRight, actualAscent, actualDescent, fontAscent, fontDescent]
H5_NATIVE(n_measure_text)
{
    Canvas *c = canvas_of(ctx, H5_ARG(0));
    if (!c)
        return JSValueMakeNull(ctx);
    const std::string text = H5_STR(1);
    const SkFont font = c->font();
    SkFontMetrics m {};
    font.getMetrics(&m);
    float width = 0;
    SkRect bounds = SkRect::MakeEmpty();
    if (!text.empty() && font.getTypeface()) {
        width = shape(c, text, font).width;
        font.measureText(text.data(), text.size(), SkTextEncoding::kUTF8, &bounds);
    }
    const float by = baseline_y(c->m_state, m, 0);   // where the alphabetic baseline sits for y = 0
    const float x0 = aligned_x(c->m_state, 0, width);
    JSValueRef items[7] = {
        JSValueMakeNumber(ctx, width),
        JSValueMakeNumber(ctx, -(x0 + bounds.left())),
        JSValueMakeNumber(ctx, x0 + bounds.right()),
        JSValueMakeNumber(ctx, -(by + bounds.top())),
        JSValueMakeNumber(ctx, by + bounds.bottom()),
        JSValueMakeNumber(ctx, -(by + m.fAscent)),
        JSValueMakeNumber(ctx, by + m.fDescent),
    };
    return JSObjectMakeArray(ctx, 7, items, nullptr);
}

// drawImage(h, source, sx, sy, sw, sh, dx, dy, dw, dh)
H5_NATIVE(n_draw_image)
{
    CANVAS(0);
    sk_sp<SkImage> img = image_of(handle_of(ctx, H5_ARG(1)));
    if (!img)
        return H5_UNDEFINED;
    auto f = [&](int i) { return static_cast<float>(H5_NUM(i)); };
    const SkRect src = SkRect::MakeXYWH(f(2), f(3), f(4), f(5));
    const SkRect dst = SkRect::MakeXYWH(f(6), f(7), f(8), f(9));
    if (src.isEmpty() || dst.isEmpty())
        return H5_UNDEFINED;
    SkPaint p = c->paint(true);
    p.setShader(nullptr);
    p.setColor(SK_ColorBLACK);
    p.setAlphaf(c->m_state.alpha);
    c->canvas()->drawImageRect(img, src, dst, c->sampling(), &p, SkCanvas::kFast_SrcRectConstraint);
    return H5_UNDEFINED;
}

// getImageData(h, x, y, w, h) -> Uint8ClampedArray (straight alpha)
H5_NATIVE(n_get_image_data)
{
    Canvas *c = canvas_of(ctx, H5_ARG(0));
    const int w = std::max(0, H5_INT(3)), h = std::max(0, H5_INT(4));
    std::vector<uint8_t> out(static_cast<size_t>(w) * h * 4, 0);
    if (c && c->m_surface && w && h) {
        const SkImageInfo info = SkImageInfo::Make(w, h, kRGBA_8888_SkColorType, kUnpremul_SkAlphaType);
        c->m_surface->readPixels(info, out.data(), static_cast<size_t>(w) * 4, H5_INT(1), H5_INT(2));
    }
    return js::make_typed_array(ctx, kJSTypedArrayTypeUint8ClampedArray, out.data(), out.size());
}

// putImageData(h, data, width, height, dx, dy): replaces pixels (no compositing)
H5_NATIVE(n_put_image_data)
{
    CANVAS(0);
    const js::Bytes b = js::bytes_of(ctx, H5_ARG(1));
    const int w = H5_INT(2), h = H5_INT(3);
    if (!b.data || w <= 0 || h <= 0 || b.size < static_cast<size_t>(w) * h * 4)
        return H5_UNDEFINED;
    const SkImageInfo info = SkImageInfo::Make(w, h, kRGBA_8888_SkColorType, kUnpremul_SkAlphaType);
    c->m_surface->writePixels(SkPixmap(info, b.data, static_cast<size_t>(w) * 4), H5_INT(4), H5_INT(5));
    return H5_UNDEFINED;
}

// registerFont(family, bytes, weight, italic) -> bool
H5_NATIVE(n_register_font)
{
    const std::string family = trim_family(H5_STR(0));
    const js::Bytes b = js::bytes_of(ctx, H5_ARG(1));
    if (!b.data || !b.size)
        return JSValueMakeBoolean(ctx, false);
    sk_sp<SkTypeface> tf = typeface_from(b.data, b.size);
    if (!tf) {
        H5_WARN("canvas: font \"%s\" (%zu bytes) is not a font FreeType reads", family.c_str(), b.size);
        return JSValueMakeBoolean(ctx, false);
    }
    {
        std::lock_guard<std::mutex> lock(g_faces_mutex);
        g_faces.push_back({ family, H5_INT(2), H5_BOOL(3), tf });
        g_faces_generation++;
    }
    return JSValueMakeBoolean(ctx, true);
}

// gradient(kind, x0, y0, r0, x1, y1, r1) -> handle; gradientStop(handle, offset, argb)
H5_NATIVE(n_gradient)
{
    auto *p = new Paintable();
    p->kind = std::clamp(H5_INT(0), 0, 2);
    for (int i = 0; i < 6; i++)
        p->coords[i] = static_cast<float>(H5_NUM(i + 1));
    return make_handle(ctx, p);
}

H5_NATIVE(n_gradient_stop)
{
    Paintable *p = paintable_of(ctx, H5_ARG(0));
    if (p)
        p->stops.emplace_back(static_cast<float>(H5_NUM(1)), SkColor4f::FromColor(argb(H5_UINT(2))));
    return H5_UNDEFINED;
}

// pattern(source, repetition) -> handle
H5_NATIVE(n_pattern)
{
    sk_sp<SkImage> img = image_of(handle_of(ctx, H5_ARG(0)));
    if (!img)
        return JSValueMakeNull(ctx);
    const std::string rep = H5_STR(1);
    const SkTileMode tx = (rep == "repeat" || rep == "repeat-x" || rep.empty() || rep == "undefined") ? SkTileMode::kRepeat : SkTileMode::kDecal;
    const SkTileMode ty = (rep == "repeat" || rep == "repeat-y" || rep.empty() || rep == "undefined") ? SkTileMode::kRepeat : SkTileMode::kDecal;
    auto *p = new Paintable();
    p->kind = 3;
    p->pattern = img->makeShader(tx, ty, SkSamplingOptions(SkFilterMode::kLinear));
    return make_handle(ctx, p);
}

void install(JSContextRef ctx, JSObjectRef h5)
{
    JSObjectRef o = JSObjectMake(ctx, nullptr, nullptr);
    js::set(ctx, h5, "c2d", o, false);
    js::set(ctx, o, "backend", js::make_string(ctx, "skia"));
    struct { const char *name; JSObjectCallAsFunctionCallback fn; } table[] = {
        { "create", n_create }, { "resize", n_resize }, { "save", n_save }, { "restore", n_restore },
        { "transform", n_transform }, { "getTransform", n_get_transform }, { "setFillColor", n_set_fill_color },
        { "setStrokeColor", n_set_stroke_color }, { "setFillGradient", n_set_fill_gradient }, { "setStrokeGradient", n_set_stroke_gradient },
        { "setFillPattern", n_set_fill_pattern }, { "setGlobalAlpha", n_set_global_alpha }, { "setComposite", n_set_composite },
        { "setLine", n_set_line }, { "setLineDash", n_set_line_dash }, { "setShadow", n_set_shadow }, { "setFont", n_set_font },
        { "setText", n_set_text }, { "setSmoothing", n_set_smoothing }, { "fillRect", n_fill_rect }, { "strokeRect", n_stroke_rect },
        { "clearRect", n_clear_rect }, { "fillPath", n_fill_path }, { "strokePath", n_stroke_path }, { "clipPath", n_clip_path },
        { "fillText", n_fill_text }, { "strokeText", n_stroke_text }, { "measureText", n_measure_text }, { "drawImage", n_draw_image },
        { "getImageData", n_get_image_data }, { "putImageData", n_put_image_data }, { "registerFont", n_register_font },
        { "gradient", n_gradient }, { "gradientStop", n_gradient_stop }, { "pattern", n_pattern },
    };
    for (const auto &t : table)
        js::def(ctx, o, t.name, t.fn);
}

struct Registration {
    Registration() { engine::register_natives("canvas2d", install); }
} g_registration;

} // namespace

// ---------------------------------------------------------------- SVG documents as pixels (image.cpp)
bool svg_rasterize(const uint8_t *data, size_t size, int want_w, int want_h, std::vector<uint8_t> &rgba, int &w, int &h)
{
    SkMemoryStream stream(data, size, false);
    sk_sp<SkSVGDOM> dom = SkSVGDOM::Builder().setFontManager(SkFontMgr::RefEmpty()).make(stream);
    if (!dom || !dom->getRoot())
        return false;
    SkSize size_px = dom->getRoot()->intrinsicSize(SkSVGLengthContext(SkSize::Make(300, 150)));
    if (want_w > 0 && want_h > 0)
        size_px = SkSize::Make(static_cast<float>(want_w), static_cast<float>(want_h));
    if (size_px.isEmpty())
        size_px = SkSize::Make(300, 150);
    w = std::clamp(static_cast<int>(std::ceil(size_px.width())), 1, 8192);
    h = std::clamp(static_cast<int>(std::ceil(size_px.height())), 1, 8192);
    dom->setContainerSize(SkSize::Make(static_cast<float>(w), static_cast<float>(h)));
    const SkImageInfo info = SkImageInfo::Make(w, h, kRGBA_8888_SkColorType, kPremul_SkAlphaType);
    sk_sp<SkSurface> surface = SkSurfaces::Raster(info);
    if (!surface)
        return false;
    surface->getCanvas()->clear(SK_ColorTRANSPARENT);
    dom->render(surface->getCanvas());
    rgba.resize(static_cast<size_t>(w) * h * 4);
    return surface->readPixels(SkImageInfo::Make(w, h, kRGBA_8888_SkColorType, kUnpremul_SkAlphaType), rgba.data(), static_cast<size_t>(w) * 4, 0, 0);
}

} // namespace h5
