// h5 browser layer: <canvas> and its 2D context. Colours and fonts are parsed here; drawing is native
// (__h5.c2d: Skia on the PS4). The WebGL context is webgl.js's.
(function (H5) {
'use strict';
const G = globalThis;
const J = H5.js;
const def = J.def;
const C = H5.c2d;

// ---------------------------------------------------------------- CSS colours -> 0xAARRGGBB (cached)
const NAMED = { transparent: 0x00000000, black: 0xff000000, white: 0xffffffff, red: 0xffff0000, green: 0xff008000, blue: 0xff0000ff, yellow: 0xffffff00,
    cyan: 0xff00ffff, aqua: 0xff00ffff, magenta: 0xffff00ff, fuchsia: 0xffff00ff, gray: 0xff808080, grey: 0xff808080, silver: 0xffc0c0c0, maroon: 0xff800000,
    olive: 0xff808000, lime: 0xff00ff00, teal: 0xff008080, navy: 0xff000080, purple: 0xff800080, orange: 0xffffa500, pink: 0xffffc0cb, brown: 0xffa52a2a,
    gold: 0xffffd700, darkgray: 0xffa9a9a9, darkgrey: 0xffa9a9a9, lightgray: 0xffd3d3d3, lightgrey: 0xffd3d3d3, dimgray: 0xff696969, darkred: 0xff8b0000,
    darkgreen: 0xff006400, darkblue: 0xff00008b, lightblue: 0xffadd8e6, skyblue: 0xff87ceeb, crimson: 0xffdc143c, coral: 0xffff7f50, tomato: 0xffff6347,
    orangered: 0xffff4500, violet: 0xffee82ee, indigo: 0xff4b0082, beige: 0xfff5f5dc, ivory: 0xfffffff0, khaki: 0xfff0e68c, salmon: 0xfffa8072, tan: 0xffd2b48c,
    turquoise: 0xff40e0d0, whitesmoke: 0xfff5f5f5, gainsboro: 0xffdcdcdc, snow: 0xfffffafa, chocolate: 0xffd2691e, firebrick: 0xffb22222, steelblue: 0xff4682b4,
    slategray: 0xff708090, darkorange: 0xffff8c00, lightgreen: 0xff90ee90, forestgreen: 0xff228b22, seagreen: 0xff2e8b57, royalblue: 0xff4169e1 };
const colorCache = new Map();
function clamp255(v) { return Math.max(0, Math.min(255, Math.round(v))); }
function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
J.parseColor = function (s) {
    if (typeof s !== 'string') return null;
    const key = s;
    if (colorCache.has(key)) return colorCache.get(key);
    let v = null;
    const t = s.trim().toLowerCase();
    if (t[0] === '#') {
        const h = t.slice(1);
        if (/^[0-9a-f]{3,4}$/.test(h)) {
            const r = parseInt(h[0] + h[0], 16), g = parseInt(h[1] + h[1], 16), b = parseInt(h[2] + h[2], 16), a = h.length === 4 ? parseInt(h[3] + h[3], 16) : 255;
            v = ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
        } else if (/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) {
            const a = h.length === 8 ? parseInt(h.slice(6), 16) : 255;
            v = ((a << 24) | parseInt(h.slice(0, 6), 16)) >>> 0;
        }
    } else if (NAMED[t] !== undefined) v = NAMED[t];
    else {
        const m = /^(rgba?|hsla?)\(\s*([^)]*)\)$/.exec(t);
        if (m) {
            const parts = m[2].split(/\s*[,/]\s*|\s+/).filter(Boolean);
            const num = (x, scale) => x.endsWith('%') ? parseFloat(x) * scale / 100 : parseFloat(x);
            let r, g, b, a = parts.length > 3 ? num(parts[3], 1) : 1;
            if (m[1].startsWith('rgb')) { r = num(parts[0], 255); g = num(parts[1], 255); b = num(parts[2], 255); }
            else [r, g, b] = hsl2rgb(parseFloat(parts[0]), num(parts[1], 1) / (parts[1].endsWith('%') ? 1 : 100), num(parts[2], 1) / (parts[2].endsWith('%') ? 1 : 100));
            if ([r, g, b, a].every(x => !isNaN(x))) v = ((clamp255(a * 255) << 24) | (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b)) >>> 0;
        }
    }
    if (colorCache.size > 2000) colorCache.clear();
    colorCache.set(key, v);
    return v;
};

// ---------------------------------------------------------------- CSS font shorthand
const fontCache = new Map();
J.parseFont = function (s) {
    if (fontCache.has(s)) return fontCache.get(s);
    const m = /^\s*((?:(?:normal|italic|oblique|bold|bolder|lighter|small-caps|[1-9]00|ultra-condensed|condensed|semi-condensed|expanded)\s+)*)(\d*\.?\d+)(px|pt|em|rem|%)\s*(?:\/\s*[^\s]+\s*)?(.+)$/i.exec(String(s));
    if (!m) { fontCache.set(s, null); return null; }
    const pre = m[1].toLowerCase();
    let size = parseFloat(m[2]);
    if (m[3] === 'pt') size = size * 4 / 3; else if (m[3] === 'em' || m[3] === 'rem') size *= 16; else if (m[3] === '%') size = size * 16 / 100;
    let weight = 400;
    const w = /\b([1-9]00|bold|bolder|lighter)\b/.exec(pre);
    if (w) weight = w[1] === 'bold' || w[1] === 'bolder' ? 700 : w[1] === 'lighter' ? 300 : parseInt(w[1], 10);
    const families = m[4].split(',').map(f => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    const f = { size, weight, italic: /italic|oblique/.test(pre), families, css: String(s) };
    fontCache.set(s, f);
    return f;
};

// ---------------------------------------------------------------- ImageData, gradients, patterns, paths
class ImageData {
    constructor(a, b, c) {
        if (a instanceof Uint8ClampedArray) { this._data = a; this._w = b; this._h = c !== undefined ? c : a.length / 4 / b; }
        else { this._w = a | 0; this._h = b | 0; this._data = new Uint8ClampedArray(this._w * this._h * 4); }
    }
    get width() { return this._w; }
    get height() { return this._h; }
    get data() { return this._data; }
    get colorSpace() { return 'srgb'; }
    _h5Source() { return H5.imageCreate(this._w, this._h, this._data); }
}
def(G, 'ImageData', ImageData);

class CanvasGradient {
    constructor(kind, coords) { this._kind = kind; this._coords = coords; this._stops = []; this._native = null; }
    addColorStop(offset, color) {
        const c = J.parseColor(String(color));
        if (c === null) throw new SyntaxError("Failed to execute 'addColorStop' on 'CanvasGradient': The value provided ('" + color + "') could not be parsed as a color.");
        this._stops.push([Math.max(0, Math.min(1, Number(offset))), c]);
        this._native = null;
    }
    _make() {
        if (!this._native) {
            this._native = C.gradient(this._kind, ...this._coords);
            if (this._native) for (const [o, c] of this._stops) C.gradientStop(this._native, o, c);
        }
        return this._native;
    }
}
def(G, 'CanvasGradient', CanvasGradient);
class CanvasPattern {
    constructor(handle, repetition) { this._handle = handle; this._rep = repetition || 'repeat'; this._native = null; }
    setTransform() {}
    _make() { if (!this._native) this._native = C.pattern(this._handle, this._rep); return this._native; }
}
def(G, 'CanvasPattern', CanvasPattern);

// path commands: 0 moveTo x y | 1 lineTo x y | 2 quad cx cy x y | 3 cubic c1x c1y c2x c2y x y | 4 arc x y r a0 a1 ccw
// | 5 arcTo x1 y1 x2 y2 r | 6 rect x y w h | 7 close | 8 ellipse x y rx ry rot a0 a1 ccw | 9 roundRect x y w h r
class Path2D {
    constructor(src) {
        this._c = [];
        if (src instanceof Path2D) this._c = src._c.slice();
        else if (typeof src === 'string') this._c.push(10, src);   // SVG path data (native parses)
    }
    moveTo(x, y) { this._c.push(0, +x, +y); }
    lineTo(x, y) { this._c.push(1, +x, +y); }
    quadraticCurveTo(cx, cy, x, y) { this._c.push(2, +cx, +cy, +x, +y); }
    bezierCurveTo(a, b, c, d, x, y) { this._c.push(3, +a, +b, +c, +d, +x, +y); }
    arc(x, y, r, a0, a1, ccw) { this._c.push(4, +x, +y, +r, +a0, +a1, ccw ? 1 : 0); }
    arcTo(x1, y1, x2, y2, r) { this._c.push(5, +x1, +y1, +x2, +y2, +r); }
    rect(x, y, w, h) { this._c.push(6, +x, +y, +w, +h); }
    closePath() { this._c.push(7); }
    ellipse(x, y, rx, ry, rot, a0, a1, ccw) { this._c.push(8, +x, +y, +rx, +ry, +rot, +a0, +a1, ccw ? 1 : 0); }
    roundRect(x, y, w, h, r = 0) { const rr = Array.isArray(r) ? (r[0] && r[0].x !== undefined ? r[0].x : +r[0] || 0) : (r && r.x !== undefined ? r.x : +r); this._c.push(9, +x, +y, +w, +h, rr); }
    addPath(p) { this._c.push(...p._c); }
}
def(G, 'Path2D', Path2D);

class TextMetrics {
    constructor(m) {
        this.width = m[0];
        this.actualBoundingBoxLeft = m[1]; this.actualBoundingBoxRight = m[2];
        this.actualBoundingBoxAscent = m[3]; this.actualBoundingBoxDescent = m[4];
        this.fontBoundingBoxAscent = m[5]; this.fontBoundingBoxDescent = m[6];
        this.emHeightAscent = m[5]; this.emHeightDescent = m[6];
        this.hangingBaseline = m[5] * 0.8; this.alphabeticBaseline = 0; this.ideographicBaseline = -m[6];
    }
}
def(G, 'TextMetrics', TextMetrics);

// ---------------------------------------------------------------- the 2D context
const COMPOSITE = ['source-over', 'source-in', 'source-out', 'source-atop', 'destination-over', 'destination-in', 'destination-out', 'destination-atop',
    'lighter', 'copy', 'xor', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light',
    'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
const CAP = { butt: 0, round: 1, square: 2 }, JOIN = { miter: 0, round: 1, bevel: 2 };
const ALIGN = { start: 0, left: 1, center: 2, right: 3, end: 4 }, BASELINE = { alphabetic: 0, top: 1, hanging: 2, middle: 3, ideographic: 4, bottom: 5 };

function defaultState() {
    return { fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1, globalCompositeOperation: 'source-over', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
        miterLimit: 10, lineDash: [], lineDashOffset: 0, shadowColor: 'rgba(0, 0, 0, 0)', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
        font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', direction: 'ltr', letterSpacing: '0px', imageSmoothingEnabled: true,
        imageSmoothingQuality: 'low', filter: 'none', fontKerning: 'auto', wordSpacing: '0px' };
}

class CanvasRenderingContext2D {
    constructor(canvas, attrs = {}) {
        this._canvas = canvas;
        this._h = C.create(canvas.width, canvas.height);
        this._s = defaultState();
        this._stack = [];
        this._path = new Path2D();
        this._attrs = { alpha: attrs.alpha !== false, desynchronized: false, colorSpace: 'srgb', willReadFrequently: !!attrs.willReadFrequently };
    }
    get canvas() { return this._canvas; }
    getContextAttributes() { return Object.assign({}, this._attrs); }
    _resized() { C.resize(this._h, this._canvas.width, this._canvas.height); this._s = defaultState(); this._stack = []; this._path = new Path2D(); }
    // state
    save() { this._stack.push(Object.assign({}, this._s, { lineDash: this._s.lineDash.slice() })); C.save(this._h); }
    restore() { if (!this._stack.length) return; this._s = this._stack.pop(); C.restore(this._h); }
    reset() { this._resized(); }
    isContextLost() { return false; }
    // transforms
    scale(x, y) { C.transform(this._h, +x, 0, 0, +y, 0, 0, false); }
    rotate(a) { const c = Math.cos(a), s = Math.sin(a); C.transform(this._h, c, s, -s, c, 0, 0, false); }
    translate(x, y) { C.transform(this._h, 1, 0, 0, 1, +x, +y, false); }
    transform(a, b, c, d, e, f) { C.transform(this._h, +a, +b, +c, +d, +e, +f, false); }
    setTransform(a, b, c, d, e, f) {
        if (a === undefined) { C.transform(this._h, 1, 0, 0, 1, 0, 0, true); return; }
        if (typeof a === 'object') { const m = a; C.transform(this._h, m.a, m.b, m.c, m.d, m.e, m.f, true); return; }
        C.transform(this._h, +a, +b, +c, +d, +e, +f, true);
    }
    resetTransform() { C.transform(this._h, 1, 0, 0, 1, 0, 0, true); }
    getTransform() { const m = C.getTransform ? C.getTransform(this._h) : [1, 0, 0, 1, 0, 0]; return G.DOMMatrix ? new G.DOMMatrix(m) : { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }; }
    // styles
    get fillStyle() { return this._s.fillStyle; }
    set fillStyle(v) { this._s.fillStyle = this._setPaint(v, true) ? v : this._s.fillStyle; }
    get strokeStyle() { return this._s.strokeStyle; }
    set strokeStyle(v) { this._s.strokeStyle = this._setPaint(v, false) ? v : this._s.strokeStyle; }
    _setPaint(v, fill) {
        if (v instanceof CanvasGradient) { const n = v._make(); fill ? C.setFillGradient(this._h, n) : C.setStrokeGradient(this._h, n); return true; }
        if (v instanceof CanvasPattern) { const n = v._make(); fill ? C.setFillPattern(this._h, n) : C.setFillPattern(this._h, n, true); return true; }
        const c = J.parseColor(String(v));
        if (c === null) return false;
        fill ? C.setFillColor(this._h, c) : C.setStrokeColor(this._h, c);
        return true;
    }
    get globalAlpha() { return this._s.globalAlpha; }
    set globalAlpha(v) { v = +v; if (v >= 0 && v <= 1) { this._s.globalAlpha = v; C.setGlobalAlpha(this._h, v); } }
    get globalCompositeOperation() { return this._s.globalCompositeOperation; }
    set globalCompositeOperation(v) { const i = COMPOSITE.indexOf(String(v)); if (i >= 0) { this._s.globalCompositeOperation = String(v); C.setComposite(this._h, i); } }
    _line() { const s = this._s; C.setLine(this._h, s.lineWidth, CAP[s.lineCap], JOIN[s.lineJoin], s.miterLimit); }
    get lineWidth() { return this._s.lineWidth; }
    set lineWidth(v) { v = +v; if (v > 0 && isFinite(v)) { this._s.lineWidth = v; this._line(); } }
    get lineCap() { return this._s.lineCap; }
    set lineCap(v) { if (v in CAP) { this._s.lineCap = v; this._line(); } }
    get lineJoin() { return this._s.lineJoin; }
    set lineJoin(v) { if (v in JOIN) { this._s.lineJoin = v; this._line(); } }
    get miterLimit() { return this._s.miterLimit; }
    set miterLimit(v) { v = +v; if (v > 0 && isFinite(v)) { this._s.miterLimit = v; this._line(); } }
    setLineDash(list) { this._s.lineDash = Array.from(list, Number); C.setLineDash(this._h, new Float32Array(this._s.lineDash.length % 2 ? this._s.lineDash.concat(this._s.lineDash) : this._s.lineDash), this._s.lineDashOffset); }
    getLineDash() { return this._s.lineDash.slice(); }
    get lineDashOffset() { return this._s.lineDashOffset; }
    set lineDashOffset(v) { this._s.lineDashOffset = +v; C.setLineDash(this._h, new Float32Array(this._s.lineDash), this._s.lineDashOffset); }
    _shadow() { const s = this._s; C.setShadow(this._h, J.parseColor(s.shadowColor) || 0, s.shadowBlur, s.shadowOffsetX, s.shadowOffsetY); }
    get shadowColor() { return this._s.shadowColor; }
    set shadowColor(v) { if (J.parseColor(String(v)) !== null) { this._s.shadowColor = String(v); this._shadow(); } }
    get shadowBlur() { return this._s.shadowBlur; }
    set shadowBlur(v) { v = +v; if (v >= 0 && isFinite(v)) { this._s.shadowBlur = v; this._shadow(); } }
    get shadowOffsetX() { return this._s.shadowOffsetX; }
    set shadowOffsetX(v) { v = +v; if (isFinite(v)) { this._s.shadowOffsetX = v; this._shadow(); } }
    get shadowOffsetY() { return this._s.shadowOffsetY; }
    set shadowOffsetY(v) { v = +v; if (isFinite(v)) { this._s.shadowOffsetY = v; this._shadow(); } }
    get font() { return this._s.font; }
    set font(v) {
        const f = J.parseFont(String(v));
        if (!f) return;
        this._s.font = String(v);
        C.setFont(this._h, f.families.join(','), f.size, f.weight, f.italic);
    }
    _text() { const s = this._s; C.setText(this._h, ALIGN[s.textAlign], BASELINE[s.textBaseline], parseFloat(s.letterSpacing) || 0, s.direction === 'rtl'); }
    get textAlign() { return this._s.textAlign; }
    set textAlign(v) { if (v in ALIGN) { this._s.textAlign = v; this._text(); } }
    get textBaseline() { return this._s.textBaseline; }
    set textBaseline(v) { if (v in BASELINE) { this._s.textBaseline = v; this._text(); } }
    get direction() { return this._s.direction; }
    set direction(v) { if (v === 'ltr' || v === 'rtl' || v === 'inherit') { this._s.direction = v; this._text(); } }
    get letterSpacing() { return this._s.letterSpacing; }
    set letterSpacing(v) { this._s.letterSpacing = String(v); this._text(); }
    get wordSpacing() { return this._s.wordSpacing; }
    set wordSpacing(v) { this._s.wordSpacing = String(v); }
    get fontKerning() { return this._s.fontKerning; }
    set fontKerning(v) { this._s.fontKerning = String(v); }
    get fontStretch() { return 'normal'; }
    set fontStretch(v) {}
    get fontVariantCaps() { return 'normal'; }
    set fontVariantCaps(v) {}
    get textRendering() { return 'auto'; }
    set textRendering(v) {}
    get imageSmoothingEnabled() { return this._s.imageSmoothingEnabled; }
    set imageSmoothingEnabled(v) { this._s.imageSmoothingEnabled = !!v; C.setSmoothing(this._h, !!v); }
    get imageSmoothingQuality() { return this._s.imageSmoothingQuality; }
    set imageSmoothingQuality(v) { this._s.imageSmoothingQuality = String(v); }
    get webkitImageSmoothingEnabled() { return this._s.imageSmoothingEnabled; }
    set webkitImageSmoothingEnabled(v) { this.imageSmoothingEnabled = v; }
    get filter() { return this._s.filter; }
    set filter(v) { this._s.filter = String(v); }
    createLinearGradient(x0, y0, x1, y1) { return new CanvasGradient(0, [+x0, +y0, 0, +x1, +y1, 0]); }
    createRadialGradient(x0, y0, r0, x1, y1, r1) { return new CanvasGradient(1, [+x0, +y0, +r0, +x1, +y1, +r1]); }
    createConicGradient(a, x, y) { return new CanvasGradient(2, [+x, +y, +a, 0, 0, 0]); }
    createPattern(src, rep) { const h = J.sourceHandle(src); return h ? new CanvasPattern(h, rep) : null; }
    // rectangles
    fillRect(x, y, w, h) { C.fillRect(this._h, +x, +y, +w, +h); J.canvasDirty(this._canvas); }
    strokeRect(x, y, w, h) { C.strokeRect(this._h, +x, +y, +w, +h); J.canvasDirty(this._canvas); }
    clearRect(x, y, w, h) { C.clearRect(this._h, +x, +y, +w, +h); J.canvasDirty(this._canvas); }
    // paths
    beginPath() { this._path = new Path2D(); }
    closePath() { this._path.closePath(); }
    moveTo(x, y) { this._path.moveTo(x, y); }
    lineTo(x, y) { this._path.lineTo(x, y); }
    quadraticCurveTo(a, b, x, y) { this._path.quadraticCurveTo(a, b, x, y); }
    bezierCurveTo(a, b, c, d, x, y) { this._path.bezierCurveTo(a, b, c, d, x, y); }
    arc(x, y, r, a0, a1, ccw) { if (r < 0) throw new G.DOMException('The radius provided (' + r + ') is negative.', 'IndexSizeError'); this._path.arc(x, y, r, a0, a1, ccw); }
    arcTo(x1, y1, x2, y2, r) { this._path.arcTo(x1, y1, x2, y2, r); }
    rect(x, y, w, h) { this._path.rect(x, y, w, h); }
    roundRect(x, y, w, h, r) { this._path.roundRect(x, y, w, h, r); }
    ellipse(x, y, rx, ry, rot, a0, a1, ccw) { this._path.ellipse(x, y, rx, ry, rot, a0, a1, ccw); }
    _cmds(p) { const c = p._c; return c.length && c[0] === 10 ? c : new Float64Array(c); }
    fill(a, b) { const p = a instanceof Path2D ? a : this._path; const rule = (a instanceof Path2D ? b : a) === 'evenodd' ? 1 : 0; C.fillPath(this._h, this._cmds(p), rule); J.canvasDirty(this._canvas); }
    stroke(p) { C.strokePath(this._h, this._cmds(p instanceof Path2D ? p : this._path)); J.canvasDirty(this._canvas); }
    clip(a, b) { const p = a instanceof Path2D ? a : this._path; const rule = (a instanceof Path2D ? b : a) === 'evenodd' ? 1 : 0; C.clipPath(this._h, this._cmds(p), rule); }
    isPointInPath() { return false; }
    isPointInStroke() { return false; }
    drawFocusIfNeeded() {}
    // text
    fillText(text, x, y, maxWidth) { C.fillText(this._h, String(text), +x, +y, maxWidth === undefined ? -1 : +maxWidth); J.canvasDirty(this._canvas); }
    strokeText(text, x, y, maxWidth) { C.strokeText(this._h, String(text), +x, +y, maxWidth === undefined ? -1 : +maxWidth); J.canvasDirty(this._canvas); }
    measureText(text) { return new TextMetrics(C.measureText(this._h, String(text))); }
    // images
    drawImage(src, a, b, c, d, e, f, g, h) {
        const handle = J.sourceHandle(src);
        if (!handle) return;
        const sw0 = src.naturalWidth || src.videoWidth || src.width, sh0 = src.naturalHeight || src.videoHeight || src.height;
        let sx = 0, sy = 0, sw = sw0, sh = sh0, dx, dy, dw, dh;
        if (c === undefined) { dx = a; dy = b; dw = sw0; dh = sh0; }
        else if (e === undefined) { dx = a; dy = b; dw = c; dh = d; }
        else { sx = a; sy = b; sw = c; sh = d; dx = e; dy = f; dw = g; dh = h; }
        C.drawImage(this._h, handle, +sx, +sy, +sw, +sh, +dx, +dy, +dw, +dh);
        J.canvasDirty(this._canvas);
    }
    // pixels
    createImageData(w, h) { if (w instanceof ImageData) return new ImageData(w.width, w.height); return new ImageData(Math.abs(w | 0), Math.abs(h | 0)); }
    getImageData(x, y, w, h) { return new ImageData(C.getImageData(this._h, x | 0, y | 0, w | 0, h | 0), w | 0, h | 0); }
    putImageData(img, dx, dy, dirtyX, dirtyY, dirtyW, dirtyH) {
        if (dirtyX !== undefined) {
            const x0 = Math.max(0, dirtyX | 0), y0 = Math.max(0, dirtyY | 0), x1 = Math.min(img.width, (dirtyX + dirtyW) | 0), y1 = Math.min(img.height, (dirtyY + dirtyH) | 0);
            if (x1 <= x0 || y1 <= y0) return;
            const w = x1 - x0, part = new Uint8ClampedArray(w * (y1 - y0) * 4);
            for (let y = y0; y < y1; y++) part.set(img.data.subarray((y * img.width + x0) * 4, (y * img.width + x1) * 4), (y - y0) * w * 4);
            C.putImageData(this._h, part, w, y1 - y0, (dx | 0) + x0, (dy | 0) + y0);
        } else C.putImageData(this._h, img.data, img.width, img.height, dx | 0, dy | 0);
        J.canvasDirty(this._canvas);
    }
}
def(G, 'CanvasRenderingContext2D', CanvasRenderingContext2D);

// ---------------------------------------------------------------- <canvas>
let canvasSeq = 0;
class HTMLCanvasElement extends G.HTMLElement {
    constructor(tag) {
        super(tag || 'canvas');
        this._w = 300; this._h = 150;
        this._ctx = null;
        this._kind = null;
        this._seq = ++canvasSeq;
        this._version = 0;   // bumps on every 2D draw (texture caches can check it)
    }
    get width() { return this._w; }
    set width(v) { v = Math.max(0, v | 0); this._w = v; this._sizeChanged(); }
    get height() { return this._h; }
    set height(v) { v = Math.max(0, v | 0); this._h = v; this._sizeChanged(); }
    _attributeChanged(name, value) {
        if (name === 'width') { this._w = value === null ? 300 : Math.max(0, parseInt(value, 10) || 0); this._sizeChanged(); }
        if (name === 'height') { this._h = value === null ? 150 : Math.max(0, parseInt(value, 10) || 0); this._sizeChanged(); }
    }
    _sizeChanged() {
        J.layoutChanged();
        if (this._ctx && this._ctx._resized) this._ctx._resized();
    }
    _intrinsicSize() { return { w: this._w, h: this._h }; }
    getContext(type, attrs) {
        type = String(type);
        if (this._ctx) return (type === this._kind || (type === 'experimental-webgl' && this._kind === 'webgl')) ? this._ctx : null;
        if (type === '2d') { this._ctx = new CanvasRenderingContext2D(this, attrs || {}); this._kind = '2d'; }
        else if (type === 'webgl' || type === 'experimental-webgl') { this._ctx = J.createWebGL ? J.createWebGL(this, attrs || {}) : null; this._kind = this._ctx ? 'webgl' : null; }
        else return null;   // webgl2, bitmaprenderer, webgpu
        return this._ctx;
    }
    _h5Source() { return this._kind === '2d' ? this._ctx._h : null; }
    toDataURL(type) {
        H5.log(2, 'canvas.toDataURL: not supported, a blank PNG instead');
        return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    }
    toBlob(cb, type) { setTimeout(() => cb(J.blobFromBytes(J.base64ToBytes(this.toDataURL().split(',')[1]), 'image/png')), 0); }
    captureStream() { return null; }
    transferControlToOffscreen() { throw new G.DOMException('not supported', 'NotSupportedError'); }
    _connected() { J.layoutChanged(); }
}
J.defineTag(['canvas'], HTMLCanvasElement, 'HTMLCanvasElement');
J.canvasDirty = function (canvas) { canvas._version++; };
def(G, 'OffscreenCanvas', undefined);
def(G, 'DOMMatrix', class DOMMatrix {
    constructor(m) { const a = Array.isArray(m) ? m : [1, 0, 0, 1, 0, 0]; [this.a, this.b, this.c, this.d, this.e, this.f] = a; this.is2D = true; }
    get m11() { return this.a; } get m12() { return this.b; } get m21() { return this.c; } get m22() { return this.d; } get m41() { return this.e; } get m42() { return this.f; }
    get isIdentity() { return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0; }
    multiply(o) { return new DOMMatrix([this.a * o.a + this.c * o.b, this.b * o.a + this.d * o.b, this.a * o.c + this.c * o.d, this.b * o.c + this.d * o.d, this.a * o.e + this.c * o.f + this.e, this.b * o.e + this.d * o.f + this.f]); }
    translate(x = 0, y = 0) { return this.multiply(new DOMMatrix([1, 0, 0, 1, x, y])); }
    scale(x = 1, y = x) { return this.multiply(new DOMMatrix([x, 0, 0, y, 0, 0])); }
    rotate(deg = 0) { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return this.multiply(new DOMMatrix([c, s, -s, c, 0, 0])); }
    inverse() { const det = this.a * this.d - this.b * this.c; if (!det) return new DOMMatrix([NaN, NaN, NaN, NaN, NaN, NaN]); return new DOMMatrix([this.d / det, -this.b / det, -this.c / det, this.a / det, (this.c * this.f - this.d * this.e) / det, (this.b * this.e - this.a * this.f) / det]); }
    transformPoint(p = {}) { return { x: this.a * (p.x || 0) + this.c * (p.y || 0) + this.e, y: this.b * (p.x || 0) + this.d * (p.y || 0) + this.f, z: 0, w: 1 }; }
});

})(globalThis.__h5);
