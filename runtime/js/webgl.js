// h5 browser layer: WebGL 1 over __h5.gl (OpenGL ES 3). Objects, bindings and WebGL's own rules live here;
// the GL calls are native. All contexts share one GL context: each call first makes its canvas current.
(function (H5) {
'use strict';
const G = globalThis;
const J = H5.js;
const def = J.def;
const N = H5.gl;
if (!N || !N.available) { H5.log(2, 'webgl: no GL here: getContext("webgl") gives null'); return; }

const K = {
    DEPTH_BUFFER_BIT: 0x100, STENCIL_BUFFER_BIT: 0x400, COLOR_BUFFER_BIT: 0x4000, POINTS: 0, LINES: 1, LINE_LOOP: 2, LINE_STRIP: 3, TRIANGLES: 4,
    TRIANGLE_STRIP: 5, TRIANGLE_FAN: 6, ZERO: 0, ONE: 1, SRC_COLOR: 0x300, ONE_MINUS_SRC_COLOR: 0x301, SRC_ALPHA: 0x302, ONE_MINUS_SRC_ALPHA: 0x303,
    DST_ALPHA: 0x304, ONE_MINUS_DST_ALPHA: 0x305, DST_COLOR: 0x306, ONE_MINUS_DST_COLOR: 0x307, SRC_ALPHA_SATURATE: 0x308, FUNC_ADD: 0x8006,
    BLEND_EQUATION: 0x8009, BLEND_EQUATION_RGB: 0x8009, BLEND_EQUATION_ALPHA: 0x883D, FUNC_SUBTRACT: 0x800A, FUNC_REVERSE_SUBTRACT: 0x800B,
    BLEND_DST_RGB: 0x80C8, BLEND_SRC_RGB: 0x80C9, BLEND_DST_ALPHA: 0x80CA, BLEND_SRC_ALPHA: 0x80CB, CONSTANT_COLOR: 0x8001,
    ONE_MINUS_CONSTANT_COLOR: 0x8002, CONSTANT_ALPHA: 0x8003, ONE_MINUS_CONSTANT_ALPHA: 0x8004, BLEND_COLOR: 0x8005, ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893, ARRAY_BUFFER_BINDING: 0x8894, ELEMENT_ARRAY_BUFFER_BINDING: 0x8895, STREAM_DRAW: 0x88E0, STATIC_DRAW: 0x88E4,
    DYNAMIC_DRAW: 0x88E8, BUFFER_SIZE: 0x8764, BUFFER_USAGE: 0x8765, CURRENT_VERTEX_ATTRIB: 0x8626, FRONT: 0x404, BACK: 0x405, FRONT_AND_BACK: 0x408,
    CULL_FACE: 0xB44, BLEND: 0xBE2, DITHER: 0xBD0, STENCIL_TEST: 0xB90, DEPTH_TEST: 0xB71, SCISSOR_TEST: 0xC11, POLYGON_OFFSET_FILL: 0x8037,
    SAMPLE_ALPHA_TO_COVERAGE: 0x809E, SAMPLE_COVERAGE: 0x80A0, NO_ERROR: 0, INVALID_ENUM: 0x500, INVALID_VALUE: 0x501, INVALID_OPERATION: 0x502,
    OUT_OF_MEMORY: 0x505, CW: 0x900, CCW: 0x901, LINE_WIDTH: 0xB21, ALIASED_POINT_SIZE_RANGE: 0x846D, ALIASED_LINE_WIDTH_RANGE: 0x846E,
    CULL_FACE_MODE: 0xB45, FRONT_FACE: 0xB46, DEPTH_RANGE: 0xB70, DEPTH_WRITEMASK: 0xB72, DEPTH_CLEAR_VALUE: 0xB73, DEPTH_FUNC: 0xB74,
    STENCIL_CLEAR_VALUE: 0xB91, STENCIL_FUNC: 0xB92, STENCIL_FAIL: 0xB94, STENCIL_PASS_DEPTH_FAIL: 0xB95, STENCIL_PASS_DEPTH_PASS: 0xB96,
    STENCIL_REF: 0xB97, STENCIL_VALUE_MASK: 0xB93, STENCIL_WRITEMASK: 0xB98, STENCIL_BACK_FUNC: 0x8800, STENCIL_BACK_FAIL: 0x8801,
    STENCIL_BACK_PASS_DEPTH_FAIL: 0x8802, STENCIL_BACK_PASS_DEPTH_PASS: 0x8803, STENCIL_BACK_REF: 0x8CA3, STENCIL_BACK_VALUE_MASK: 0x8CA4,
    STENCIL_BACK_WRITEMASK: 0x8CA5, VIEWPORT: 0xBA2, SCISSOR_BOX: 0xC10, COLOR_CLEAR_VALUE: 0xC22, COLOR_WRITEMASK: 0xC23, UNPACK_ALIGNMENT: 0xCF5,
    PACK_ALIGNMENT: 0xD05, MAX_TEXTURE_SIZE: 0xD33, MAX_VIEWPORT_DIMS: 0xD3A, SUBPIXEL_BITS: 0xD50, RED_BITS: 0xD52, GREEN_BITS: 0xD53,
    BLUE_BITS: 0xD54, ALPHA_BITS: 0xD55, DEPTH_BITS: 0xD56, STENCIL_BITS: 0xD57, POLYGON_OFFSET_UNITS: 0x2A00, POLYGON_OFFSET_FACTOR: 0x8038,
    TEXTURE_BINDING_2D: 0x8069, SAMPLE_BUFFERS: 0x80A8, SAMPLES: 0x80A9, SAMPLE_COVERAGE_VALUE: 0x80AA, SAMPLE_COVERAGE_INVERT: 0x80AB,
    COMPRESSED_TEXTURE_FORMATS: 0x86A3, DONT_CARE: 0x1100, FASTEST: 0x1101, NICEST: 0x1102, GENERATE_MIPMAP_HINT: 0x8192, BYTE: 0x1400,
    UNSIGNED_BYTE: 0x1401, SHORT: 0x1402, UNSIGNED_SHORT: 0x1403, INT: 0x1404, UNSIGNED_INT: 0x1405, FLOAT: 0x1406, DEPTH_COMPONENT: 0x1902,
    ALPHA: 0x1906, RGB: 0x1907, RGBA: 0x1908, LUMINANCE: 0x1909, LUMINANCE_ALPHA: 0x190A, UNSIGNED_SHORT_4_4_4_4: 0x8033,
    UNSIGNED_SHORT_5_5_5_1: 0x8034, UNSIGNED_SHORT_5_6_5: 0x8363, FRAGMENT_SHADER: 0x8B30, VERTEX_SHADER: 0x8B31, MAX_VERTEX_ATTRIBS: 0x8869,
    MAX_VERTEX_UNIFORM_VECTORS: 0x8DFB, MAX_VARYING_VECTORS: 0x8DFC, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8B4D, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8B4C,
    MAX_TEXTURE_IMAGE_UNITS: 0x8872, MAX_FRAGMENT_UNIFORM_VECTORS: 0x8DFD, SHADER_TYPE: 0x8B4F, DELETE_STATUS: 0x8B80, LINK_STATUS: 0x8B82,
    VALIDATE_STATUS: 0x8B83, ATTACHED_SHADERS: 0x8B85, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B89, SHADING_LANGUAGE_VERSION: 0x8B8C,
    CURRENT_PROGRAM: 0x8B8D, NEVER: 0x200, LESS: 0x201, EQUAL: 0x202, LEQUAL: 0x203, GREATER: 0x204, NOTEQUAL: 0x205, GEQUAL: 0x206, ALWAYS: 0x207,
    KEEP: 0x1E00, REPLACE: 0x1E01, INCR: 0x1E02, DECR: 0x1E03, INVERT: 0x150A, INCR_WRAP: 0x8507, DECR_WRAP: 0x8508, VENDOR: 0x1F00,
    RENDERER: 0x1F01, VERSION: 0x1F02, NEAREST: 0x2600, LINEAR: 0x2601, NEAREST_MIPMAP_NEAREST: 0x2700, LINEAR_MIPMAP_NEAREST: 0x2701,
    NEAREST_MIPMAP_LINEAR: 0x2702, LINEAR_MIPMAP_LINEAR: 0x2703, TEXTURE_MAG_FILTER: 0x2800, TEXTURE_MIN_FILTER: 0x2801, TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803, TEXTURE_2D: 0xDE1, TEXTURE: 0x1702, TEXTURE_CUBE_MAP: 0x8513, TEXTURE_BINDING_CUBE_MAP: 0x8514,
    TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515, TEXTURE_CUBE_MAP_NEGATIVE_X: 0x8516, TEXTURE_CUBE_MAP_POSITIVE_Y: 0x8517, TEXTURE_CUBE_MAP_NEGATIVE_Y: 0x8518,
    TEXTURE_CUBE_MAP_POSITIVE_Z: 0x8519, TEXTURE_CUBE_MAP_NEGATIVE_Z: 0x851A, MAX_CUBE_MAP_TEXTURE_SIZE: 0x851C, TEXTURE0: 0x84C0,
    ACTIVE_TEXTURE: 0x84E0, REPEAT: 0x2901, CLAMP_TO_EDGE: 0x812F, MIRRORED_REPEAT: 0x8370, FLOAT_VEC2: 0x8B50, FLOAT_VEC3: 0x8B51,
    FLOAT_VEC4: 0x8B52, INT_VEC2: 0x8B53, INT_VEC3: 0x8B54, INT_VEC4: 0x8B55, BOOL: 0x8B56, BOOL_VEC2: 0x8B57, BOOL_VEC3: 0x8B58,
    BOOL_VEC4: 0x8B59, FLOAT_MAT2: 0x8B5A, FLOAT_MAT3: 0x8B5B, FLOAT_MAT4: 0x8B5C, SAMPLER_2D: 0x8B5E, SAMPLER_CUBE: 0x8B60,
    VERTEX_ATTRIB_ARRAY_ENABLED: 0x8622, VERTEX_ATTRIB_ARRAY_SIZE: 0x8623, VERTEX_ATTRIB_ARRAY_STRIDE: 0x8624, VERTEX_ATTRIB_ARRAY_TYPE: 0x8625,
    VERTEX_ATTRIB_ARRAY_NORMALIZED: 0x886A, VERTEX_ATTRIB_ARRAY_POINTER: 0x8645, VERTEX_ATTRIB_ARRAY_BUFFER_BINDING: 0x889F,
    IMPLEMENTATION_COLOR_READ_TYPE: 0x8B9A, IMPLEMENTATION_COLOR_READ_FORMAT: 0x8B9B, COMPILE_STATUS: 0x8B81, LOW_FLOAT: 0x8DF0,
    MEDIUM_FLOAT: 0x8DF1, HIGH_FLOAT: 0x8DF2, LOW_INT: 0x8DF3, MEDIUM_INT: 0x8DF4, HIGH_INT: 0x8DF5, FRAMEBUFFER: 0x8D40, RENDERBUFFER: 0x8D41,
    RGBA4: 0x8056, RGB5_A1: 0x8057, RGB565: 0x8D62, DEPTH_COMPONENT16: 0x81A5, STENCIL_INDEX8: 0x8D48, DEPTH_STENCIL: 0x84F9,
    RENDERBUFFER_WIDTH: 0x8D42, RENDERBUFFER_HEIGHT: 0x8D43, RENDERBUFFER_INTERNAL_FORMAT: 0x8D44, RENDERBUFFER_RED_SIZE: 0x8D50,
    RENDERBUFFER_GREEN_SIZE: 0x8D51, RENDERBUFFER_BLUE_SIZE: 0x8D52, RENDERBUFFER_ALPHA_SIZE: 0x8D53, RENDERBUFFER_DEPTH_SIZE: 0x8D54,
    RENDERBUFFER_STENCIL_SIZE: 0x8D55, FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE: 0x8CD0, FRAMEBUFFER_ATTACHMENT_OBJECT_NAME: 0x8CD1,
    FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL: 0x8CD2, FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE: 0x8CD3, COLOR_ATTACHMENT0: 0x8CE0,
    DEPTH_ATTACHMENT: 0x8D00, STENCIL_ATTACHMENT: 0x8D20, DEPTH_STENCIL_ATTACHMENT: 0x821A, NONE: 0, FRAMEBUFFER_COMPLETE: 0x8CD5,
    FRAMEBUFFER_INCOMPLETE_ATTACHMENT: 0x8CD6, FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT: 0x8CD7, FRAMEBUFFER_INCOMPLETE_DIMENSIONS: 0x8CD9,
    FRAMEBUFFER_UNSUPPORTED: 0x8CDD, FRAMEBUFFER_BINDING: 0x8CA6, RENDERBUFFER_BINDING: 0x8CA7, MAX_RENDERBUFFER_SIZE: 0x84E8,
    INVALID_FRAMEBUFFER_OPERATION: 0x506, UNPACK_FLIP_Y_WEBGL: 0x9240, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241, CONTEXT_LOST_WEBGL: 0x9242,
    UNPACK_COLORSPACE_CONVERSION_WEBGL: 0x9243, BROWSER_DEFAULT_WEBGL: 0x9244,
};
for (let i = 1; i < 32; i++) K['TEXTURE' + i] = 0x84C0 + i;
const BOOL_PARAMS = new Set([K.DELETE_STATUS, K.LINK_STATUS, K.VALIDATE_STATUS, K.COMPILE_STATUS]);

class WebGLObject { constructor(ctx, name) { this._ctx = ctx; this._n = name; this._deleted = false; } }
class WebGLBuffer extends WebGLObject {}
class WebGLFramebuffer extends WebGLObject {}
class WebGLRenderbuffer extends WebGLObject {}
class WebGLTexture extends WebGLObject {}
class WebGLProgram extends WebGLObject { constructor(c, n) { super(c, n); this._shaders = []; this._linked = false; } }
class WebGLShader extends WebGLObject { constructor(c, n, type) { super(c, n); this._type = type; this._source = ''; } }
class WebGLVertexArrayObjectOES extends WebGLObject { constructor(c, n) { super(c, n); this._element = null; } }
class WebGLUniformLocation { constructor(prog, loc, name) { this._prog = prog; this._loc = loc; this._name = name; } }
class WebGLActiveInfo { constructor(o) { this.size = o.size; this.type = o.type; this.name = o.name; } }
class WebGLShaderPrecisionFormat { constructor(a) { this.rangeMin = a[0]; this.rangeMax = a[1]; this.precision = a[2]; } }
for (const c of [WebGLBuffer, WebGLFramebuffer, WebGLRenderbuffer, WebGLTexture, WebGLProgram, WebGLShader, WebGLUniformLocation, WebGLActiveInfo, WebGLShaderPrecisionFormat])
    def(G, c.name, c);
def(G, 'WebGLVertexArrayObject', WebGLVertexArrayObjectOES);
def(G, 'WebGLContextEvent', class WebGLContextEvent extends G.Event { constructor(t, i = {}) { super(t, i); this.statusMessage = i.statusMessage || ''; } });

const info = N.info();
H5.log(1, 'webgl: ' + info.vendor + ' / ' + info.renderer + ' / ' + info.version);
let current = null;   // the context whose canvas is current
const contexts = new Set();

function name(o) { return o && !o._deleted ? o._n : 0; }
function toF32(v) { return v instanceof Float32Array ? v : new Float32Array(v); }
function toI32(v) { return v instanceof Int32Array ? v : new Int32Array(v); }

class WebGLRenderingContext {
    constructor(canvas, attrs) {
        this._canvas = canvas;
        this._attrs = {
            alpha: attrs.alpha !== false, depth: attrs.depth !== false, stencil: !!attrs.stencil, antialias: false,
            premultipliedAlpha: attrs.premultipliedAlpha !== false, preserveDrawingBuffer: !!attrs.preserveDrawingBuffer,
            powerPreference: attrs.powerPreference || 'default', failIfMajorPerformanceCaveat: !!attrs.failIfMajorPerformanceCaveat, desynchronized: false,
        };
        this._id = N.canvasCreate(canvas.width || 1, canvas.height || 1, this._attrs.alpha, this._attrs.depth, this._attrs.stencil || true);
        this._lost = false;
        this._error = 0;
        this._buffers = { array: null };
        this._defaultVAO = new WebGLVertexArrayObjectOES(this, 0);
        this._vao = this._defaultVAO;
        this._program = null;
        this._framebuffer = null;
        this._renderbuffer = null;
        this._activeUnit = 0;
        this._units = [];
        for (let i = 0; i < 32; i++) this._units.push({ t2d: null, cube: null });
        this._unpack = { flip: false, premultiply: false, colorspace: K.BROWSER_DEFAULT_WEBGL };
        this._ext = new Map();
        contexts.add(this);
        this._use();
        N.viewport(0, 0, canvas.width || 1, canvas.height || 1);
    }
    _use() { if (current !== this) { current = this; N.canvasUse(this._id); } }
    _resized() { N.canvasResize(this._id, this._canvas.width || 1, this._canvas.height || 1); }
    _synth(e) { if (!this._error) this._error = e; }
    get canvas() { return this._canvas; }
    get drawingBufferWidth() { return this._canvas.width || 1; }
    get drawingBufferHeight() { return this._canvas.height || 1; }
    get drawingBufferColorSpace() { return 'srgb'; }
    getContextAttributes() { return this._lost ? null : Object.assign({}, this._attrs); }
    isContextLost() { return this._lost; }
    getSupportedExtensions() { return Object.keys(EXTENSIONS); }
    getExtension(n) {
        n = String(n);
        if (this._ext.has(n)) return this._ext.get(n);
        const make = EXTENSIONS[n] || EXTENSIONS[n.replace(/^(WEBKIT_|MOZ_)/, '')];
        const e = make ? make(this) : null;
        this._ext.set(n, e);
        return e;
    }
    getError() { this._use(); const e = this._error || N.getError(); this._error = 0; return e; }

    activeTexture(t) { this._use(); this._activeUnit = Math.max(0, Math.min(31, t - K.TEXTURE0)); N.activeTexture(t); }
    attachShader(p, s) { this._use(); if (p && s) { p._shaders.push(s); N.attachShader(name(p), name(s)); } }
    bindAttribLocation(p, i, n) { this._use(); N.bindAttribLocation(name(p), i, String(n)); }
    bindBuffer(t, b) {
        this._use();
        if (b && b._deleted) { this._synth(K.INVALID_OPERATION); return; }
        if (t === K.ARRAY_BUFFER) this._buffers.array = b; else if (t === K.ELEMENT_ARRAY_BUFFER) this._vao._element = b;
        N.bindBuffer(t, name(b));
    }
    bindFramebuffer(t, f) { this._use(); this._framebuffer = f || null; N.bindFramebuffer(t, name(f)); }
    bindRenderbuffer(t, r) { this._use(); this._renderbuffer = r || null; N.bindRenderbuffer(t, name(r)); }
    bindTexture(t, x) {
        this._use();
        const u = this._units[this._activeUnit];
        if (t === K.TEXTURE_2D) u.t2d = x || null; else if (t === K.TEXTURE_CUBE_MAP) u.cube = x || null;
        N.bindTexture(t, name(x));
    }
    blendColor(r, g, b, a) { this._use(); N.blendColor(r, g, b, a); }
    blendEquation(m) { this._use(); N.blendEquation(m); }
    blendEquationSeparate(a, b) { this._use(); N.blendEquationSeparate(a, b); }
    blendFunc(a, b) { this._use(); N.blendFunc(a, b); }
    blendFuncSeparate(a, b, c, d) { this._use(); N.blendFuncSeparate(a, b, c, d); }
    bufferData(t, data, usage) {
        this._use();
        if (data === null || data === undefined) { this._synth(K.INVALID_VALUE); return; }
        N.bufferData(t, typeof data === 'number' ? data : data, usage);
    }
    bufferSubData(t, off, data) { this._use(); if (data) N.bufferSubData(t, off, data); }
    checkFramebufferStatus(t) { this._use(); return N.checkFramebufferStatus(t); }
    clear(m) { this._use(); N.clear(m); }
    clearColor(r, g, b, a) { this._use(); N.clearColor(r, g, b, a); }
    clearDepth(d) { this._use(); N.clearDepth(d); }
    clearStencil(s) { this._use(); N.clearStencil(s); }
    colorMask(r, g, b, a) { this._use(); N.colorMask(!!r, !!g, !!b, !!a); }
    compileShader(s) {
        this._use();
        N.compileShader(name(s));
        if (!N.getShaderParameter(name(s), K.COMPILE_STATUS)) H5.log(2, 'webgl: shader did not compile: ' + N.getShaderInfoLog(name(s)));
    }
    compressedTexImage2D(t, l, f, w, h, b, data) { this._use(); N.compressedTexImage2D(t, l, f, w, h, b, data); }
    compressedTexSubImage2D(t, l, x, y, w, h, f, data) { this._use(); N.compressedTexSubImage2D(t, l, x, y, w, h, f, data); }
    copyTexImage2D(t, l, f, x, y, w, h, b) { this._use(); N.copyTexImage2D(t, l, f, x, y, w, h, b); }
    copyTexSubImage2D(t, l, xo, yo, x, y, w, h) { this._use(); N.copyTexSubImage2D(t, l, xo, yo, x, y, w, h); }
    createBuffer() { this._use(); return new WebGLBuffer(this, N.createBuffer()); }
    createFramebuffer() { this._use(); return new WebGLFramebuffer(this, N.createFramebuffer()); }
    createProgram() { this._use(); return new WebGLProgram(this, N.createProgram()); }
    createRenderbuffer() { this._use(); return new WebGLRenderbuffer(this, N.createRenderbuffer()); }
    createShader(t) { this._use(); return new WebGLShader(this, N.createShader(t), t); }
    createTexture() { this._use(); return new WebGLTexture(this, N.createTexture()); }
    cullFace(m) { this._use(); N.cullFace(m); }
    deleteBuffer(b) {
        this._use();
        if (!b || b._deleted) return;
        if (this._buffers.array === b) this._buffers.array = null;
        if (this._vao._element === b) this._vao._element = null;
        b._deleted = true; N.deleteBuffer(b._n);
    }
    deleteFramebuffer(f) { this._use(); if (!f || f._deleted) return; if (this._framebuffer === f) this._framebuffer = null; f._deleted = true; N.deleteFramebuffer(f._n); }
    deleteProgram(p) { this._use(); if (!p || p._deleted) return; if (this._program === p) this._program = null; p._deleted = true; N.deleteProgram(p._n); }
    deleteRenderbuffer(r) { this._use(); if (!r || r._deleted) return; if (this._renderbuffer === r) this._renderbuffer = null; r._deleted = true; N.deleteRenderbuffer(r._n); }
    deleteShader(s) { this._use(); if (!s || s._deleted) return; s._deleted = true; N.deleteShader(s._n); }
    deleteTexture(x) {
        this._use();
        if (!x || x._deleted) return;
        for (const u of this._units) { if (u.t2d === x) u.t2d = null; if (u.cube === x) u.cube = null; }
        x._deleted = true; N.deleteTexture(x._n);
    }
    depthFunc(f) { this._use(); N.depthFunc(f); }
    depthMask(f) { this._use(); N.depthMask(!!f); }
    depthRange(n, f) { this._use(); N.depthRange(n, f); }
    detachShader(p, s) { this._use(); if (p && s) { p._shaders = p._shaders.filter(x => x !== s); N.detachShader(name(p), name(s)); } }
    disable(c) { this._use(); N.disable(c); }
    disableVertexAttribArray(i) { this._use(); N.disableVertexAttribArray(i); }
    drawArrays(m, f, c) { this._use(); N.drawArrays(m, f, c); }
    drawElements(m, c, t, o) { this._use(); N.drawElements(m, c, t, o); }
    enable(c) { this._use(); N.enable(c); }
    enableVertexAttribArray(i) { this._use(); N.enableVertexAttribArray(i); }
    finish() { this._use(); N.finish(); }
    flush() { this._use(); N.flush(); }
    framebufferRenderbuffer(t, a, rt, r) { this._use(); N.framebufferRenderbuffer(t, a, rt, name(r)); }
    framebufferTexture2D(t, a, tt, x, l) { this._use(); N.framebufferTexture2D(t, a, tt, name(x), l); }
    frontFace(m) { this._use(); N.frontFace(m); }
    generateMipmap(t) { this._use(); N.generateMipmap(t); }
    getActiveAttrib(p, i) { this._use(); const o = N.getActiveAttrib(name(p), i); return o ? new WebGLActiveInfo(o) : null; }
    getActiveUniform(p, i) { this._use(); const o = N.getActiveUniform(name(p), i); return o ? new WebGLActiveInfo(o) : null; }
    getAttachedShaders(p) { return p ? p._shaders.slice() : null; }
    getAttribLocation(p, n) { this._use(); return N.getAttribLocation(name(p), String(n)); }
    getBufferParameter(t, p) { this._use(); return N.getBufferParameter(t, p); }
    getFramebufferAttachmentParameter(t, a, p) { this._use(); return N.getFramebufferAttachmentParameter(t, a, p); }
    getParameter(p) {
        this._use();
        const u = this._units[this._activeUnit];
        switch (p) {
        case K.ARRAY_BUFFER_BINDING: return this._buffers.array;
        case K.ELEMENT_ARRAY_BUFFER_BINDING: return this._vao._element;
        case K.CURRENT_PROGRAM: return this._program;
        case K.FRAMEBUFFER_BINDING: return this._framebuffer;
        case K.RENDERBUFFER_BINDING: return this._renderbuffer;
        case K.TEXTURE_BINDING_2D: return u.t2d;
        case K.TEXTURE_BINDING_CUBE_MAP: return u.cube;
        case 0x85B5: return this._vao === this._defaultVAO ? null : this._vao;   // VERTEX_ARRAY_BINDING_OES
        case K.UNPACK_FLIP_Y_WEBGL: return this._unpack.flip;
        case K.UNPACK_PREMULTIPLY_ALPHA_WEBGL: return this._unpack.premultiply;
        case K.UNPACK_COLORSPACE_CONVERSION_WEBGL: return this._unpack.colorspace;
        case K.VENDOR: return 'WebKit';
        case K.RENDERER: return 'WebKit WebGL';
        case K.VERSION: return 'WebGL 1.0 (OpenGL ES 2.0 h5)';
        case K.SHADING_LANGUAGE_VERSION: return 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 h5)';
        case 0x9245: return info.vendor;     // UNMASKED_VENDOR_WEBGL
        case 0x9246: return info.renderer;   // UNMASKED_RENDERER_WEBGL
        case K.COMPRESSED_TEXTURE_FORMATS: return new Uint32Array(0);
        case K.MAX_TEXTURE_IMAGE_UNITS: return Math.min(16, N.getParameter(p));
        case K.MAX_COMBINED_TEXTURE_IMAGE_UNITS: return Math.min(32, N.getParameter(p));
        case K.MAX_VERTEX_UNIFORM_VECTORS: case K.MAX_FRAGMENT_UNIFORM_VECTORS: case K.MAX_VARYING_VECTORS: return Math.min(1024, N.getParameter(p));
        case K.SAMPLES: return 0;
        case K.SAMPLE_BUFFERS: return 0;
        default: return N.getParameter(p);
        }
    }
    getProgramInfoLog(p) { this._use(); return N.getProgramInfoLog(name(p)); }
    getProgramParameter(p, n) { this._use(); const v = N.getProgramParameter(name(p), n); return BOOL_PARAMS.has(n) ? !!v : v; }
    getRenderbufferParameter(t, p) { this._use(); return N.getRenderbufferParameter(t, p); }
    getShaderInfoLog(s) { this._use(); return N.getShaderInfoLog(name(s)); }
    getShaderParameter(s, n) { this._use(); const v = N.getShaderParameter(name(s), n); return BOOL_PARAMS.has(n) ? !!v : v; }
    getShaderPrecisionFormat(st, pt) { this._use(); return new WebGLShaderPrecisionFormat(N.getShaderPrecisionFormat(st, pt)); }
    getShaderSource(s) { return s ? s._source : null; }
    getTexParameter(t, p) { this._use(); return N.getTexParameter(t, p); }
    getUniform(p, l) { this._use(); return N.getUniform(name(p), l ? l._loc : -1, 1, false); }
    getUniformLocation(p, n) { this._use(); const l = N.getUniformLocation(name(p), String(n)); return l < 0 ? null : new WebGLUniformLocation(p, l, String(n)); }
    getVertexAttrib(i, p) { this._use(); return N.getVertexAttrib(i, p); }
    getVertexAttribOffset(i, p) { return 0; }
    hint(t, m) { this._use(); N.hint(t, m); }
    isBuffer(b) { return !!b && b instanceof WebGLBuffer && !b._deleted; }
    isEnabled(c) { this._use(); return N.isEnabled(c); }
    isFramebuffer(f) { return !!f && f instanceof WebGLFramebuffer && !f._deleted; }
    isProgram(p) { return !!p && p instanceof WebGLProgram && !p._deleted; }
    isRenderbuffer(r) { return !!r && r instanceof WebGLRenderbuffer && !r._deleted; }
    isShader(s) { return !!s && s instanceof WebGLShader && !s._deleted; }
    isTexture(x) { return !!x && x instanceof WebGLTexture && !x._deleted; }
    lineWidth(w) { this._use(); N.lineWidth(w); }
    linkProgram(p) {
        this._use();
        N.linkProgram(name(p));
        p._linked = !!N.getProgramParameter(name(p), K.LINK_STATUS);
        if (!p._linked) H5.log(2, 'webgl: program did not link: ' + N.getProgramInfoLog(name(p)));
    }
    pixelStorei(p, v) {
        this._use();
        if (p === K.UNPACK_FLIP_Y_WEBGL) this._unpack.flip = !!v;
        else if (p === K.UNPACK_PREMULTIPLY_ALPHA_WEBGL) this._unpack.premultiply = !!v;
        else if (p === K.UNPACK_COLORSPACE_CONVERSION_WEBGL) this._unpack.colorspace = v;
        N.pixelStorei(p, typeof v === 'boolean' ? (v ? 1 : 0) : v);
    }
    polygonOffset(f, u) { this._use(); N.polygonOffset(f, u); }
    readPixels(x, y, w, h, f, t, dst) { this._use(); if (dst) N.readPixels(x, y, w, h, f, t, dst); }
    renderbufferStorage(t, f, w, h) { this._use(); N.renderbufferStorage(t, f, w, h); }
    sampleCoverage(v, i) { this._use(); N.sampleCoverage(v, !!i); }
    scissor(x, y, w, h) { this._use(); N.scissor(x, y, w, h); }
    shaderSource(s, src) { this._use(); if (!s) return; s._source = String(src); N.shaderSource(name(s), s._source); }
    stencilFunc(f, r, m) { this._use(); N.stencilFunc(f, r, m >>> 0); }
    stencilFuncSeparate(fa, f, r, m) { this._use(); N.stencilFuncSeparate(fa, f, r, m >>> 0); }
    stencilMask(m) { this._use(); N.stencilMask(m >>> 0); }
    stencilMaskSeparate(f, m) { this._use(); N.stencilMaskSeparate(f, m >>> 0); }
    stencilOp(a, b, c) { this._use(); N.stencilOp(a, b, c); }
    stencilOpSeparate(f, a, b, c) { this._use(); N.stencilOpSeparate(f, a, b, c); }
    texImage2D(t, l, internal, a, b, c, d, e, f) {
        this._use();
        if (d === undefined && e === undefined) {
            // (target, level, internalformat, format, type, source)
            const format = a, type = b, src = c;
            if (src instanceof G.ImageData) { N.texImage2D(t, l, internal, src.width, src.height, 0, format, type, src.data); return; }
            const handle = J.sourceHandle(src);
            if (!handle) {
                if (src && src._kind === 'webgl') H5.log(2, 'webgl: texImage2D from a WebGL canvas is not supported');
                else if (src && src.localName === 'video') { N.texImage2D(t, l, internal, 1, 1, 0, format, type, new Uint8Array(4)); return; }
                this._synth(K.INVALID_VALUE);
                return;
            }
            N.texImageSource(t, l, internal, format, type, handle);
            return;
        }
        // (target, level, internalformat, width, height, border, format, type, pixels)
        N.texImage2D(t, l, internal, a, b, c, d, e, f === undefined ? null : f);
    }
    texSubImage2D(t, l, x, y, a, b, c, d, e) {
        this._use();
        if (d === undefined && e === undefined) {
            // (target, level, x, y, format, type, source)
            const format = a, type = b, src = c;
            if (src instanceof G.ImageData) { N.texSubImage2D(t, l, x, y, src.width, src.height, format, type, src.data); return; }
            const handle = J.sourceHandle(src);
            if (!handle) { this._synth(K.INVALID_VALUE); return; }
            N.texSubImageSource(t, l, x, y, format, type, handle);
            return;
        }
        N.texSubImage2D(t, l, x, y, a, b, c, d, e);
    }
    texParameterf(t, p, v) { this._use(); N.texParameterf(t, p, v); }
    texParameteri(t, p, v) { this._use(); N.texParameteri(t, p, v); }
    uniform1f(l, a) { this._use(); if (l) N.uniform1f(l._loc, a); }
    uniform2f(l, a, b) { this._use(); if (l) N.uniform2f(l._loc, a, b); }
    uniform3f(l, a, b, c) { this._use(); if (l) N.uniform3f(l._loc, a, b, c); }
    uniform4f(l, a, b, c, d) { this._use(); if (l) N.uniform4f(l._loc, a, b, c, d); }
    uniform1i(l, a) { this._use(); if (l) N.uniform1i(l._loc, a); }
    uniform2i(l, a, b) { this._use(); if (l) N.uniform2i(l._loc, a, b); }
    uniform3i(l, a, b, c) { this._use(); if (l) N.uniform3i(l._loc, a, b, c); }
    uniform4i(l, a, b, c, d) { this._use(); if (l) N.uniform4i(l._loc, a, b, c, d); }
    uniform1fv(l, v) { this._use(); if (l) N.uniform1fv(l._loc, toF32(v)); }
    uniform2fv(l, v) { this._use(); if (l) N.uniform2fv(l._loc, toF32(v)); }
    uniform3fv(l, v) { this._use(); if (l) N.uniform3fv(l._loc, toF32(v)); }
    uniform4fv(l, v) { this._use(); if (l) N.uniform4fv(l._loc, toF32(v)); }
    uniform1iv(l, v) { this._use(); if (l) N.uniform1iv(l._loc, toI32(v)); }
    uniform2iv(l, v) { this._use(); if (l) N.uniform2iv(l._loc, toI32(v)); }
    uniform3iv(l, v) { this._use(); if (l) N.uniform3iv(l._loc, toI32(v)); }
    uniform4iv(l, v) { this._use(); if (l) N.uniform4iv(l._loc, toI32(v)); }
    uniformMatrix2fv(l, t, v) { this._use(); if (l) N.uniformMatrix2fv(l._loc, !!t, toF32(v)); }
    uniformMatrix3fv(l, t, v) { this._use(); if (l) N.uniformMatrix3fv(l._loc, !!t, toF32(v)); }
    uniformMatrix4fv(l, t, v) { this._use(); if (l) N.uniformMatrix4fv(l._loc, !!t, toF32(v)); }
    useProgram(p) { this._use(); this._program = p || null; N.useProgram(name(p)); }
    validateProgram(p) { this._use(); N.validateProgram(name(p)); }
    vertexAttrib1f(i, x) { this._use(); N.vertexAttrib1f(i, x); }
    vertexAttrib2f(i, x, y) { this._use(); N.vertexAttrib2f(i, x, y); }
    vertexAttrib3f(i, x, y, z) { this._use(); N.vertexAttrib3f(i, x, y, z); }
    vertexAttrib4f(i, x, y, z, w) { this._use(); N.vertexAttrib4f(i, x, y, z, w); }
    vertexAttrib1fv(i, v) { this.vertexAttrib1f(i, v[0]); }
    vertexAttrib2fv(i, v) { this.vertexAttrib2f(i, v[0], v[1]); }
    vertexAttrib3fv(i, v) { this.vertexAttrib3f(i, v[0], v[1], v[2]); }
    vertexAttrib4fv(i, v) { this.vertexAttrib4f(i, v[0], v[1], v[2], v[3]); }
    vertexAttribPointer(i, s, t, n, st, o) { this._use(); N.vertexAttribPointer(i, s, t, !!n, st, o); }
    viewport(x, y, w, h) { this._use(); N.viewport(x, y, w, h); }
    makeXRCompatible() { return Promise.resolve(); }
}
for (const k of Object.keys(K)) { WebGLRenderingContext[k] = K[k]; WebGLRenderingContext.prototype[k] = K[k]; }
def(G, 'WebGLRenderingContext', WebGLRenderingContext);

const EXTENSIONS = {
    OES_vertex_array_object: gl => ({
        VERTEX_ARRAY_BINDING_OES: 0x85B5,
        createVertexArrayOES() { gl._use(); return new WebGLVertexArrayObjectOES(gl, N.createVertexArray()); },
        deleteVertexArrayOES(v) { gl._use(); if (!v || v._deleted) return; if (gl._vao === v) { gl._vao = gl._defaultVAO; N.bindVertexArray(0); } v._deleted = true; N.deleteVertexArray(v._n); },
        isVertexArrayOES(v) { return !!v && v instanceof WebGLVertexArrayObjectOES && !v._deleted && v._n !== 0; },
        bindVertexArrayOES(v) { gl._use(); gl._vao = v || gl._defaultVAO; N.bindVertexArray(name(v)); },
    }),
    ANGLE_instanced_arrays: gl => ({
        VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE: 0x88FE,
        drawArraysInstancedANGLE(m, f, c, n) { gl._use(); N.drawArraysInstanced(m, f, c, n); },
        drawElementsInstancedANGLE(m, c, t, o, n) { gl._use(); N.drawElementsInstanced(m, c, t, o, n); },
        vertexAttribDivisorANGLE(i, d) { gl._use(); N.vertexAttribDivisor(i, d); },
    }),
    OES_element_index_uint: () => ({}),
    OES_standard_derivatives: () => ({ FRAGMENT_SHADER_DERIVATIVE_HINT_OES: 0x8B8B }),
    OES_texture_float: () => ({}),
    OES_texture_float_linear: () => ({}),
    OES_texture_half_float: () => ({ HALF_FLOAT_OES: 0x8D61 }),
    OES_texture_half_float_linear: () => ({}),
    EXT_blend_minmax: () => ({ MIN_EXT: 0x8007, MAX_EXT: 0x8008 }),
    EXT_texture_filter_anisotropic: () => ({ TEXTURE_MAX_ANISOTROPY_EXT: 0x84FE, MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84FF }),
    WEBGL_depth_texture: () => ({ UNSIGNED_INT_24_8_WEBGL: 0x84FA }),
    WEBGL_debug_renderer_info: () => ({ UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 }),
    WEBGL_lose_context: gl => ({
        loseContext() { if (gl._lost) return; gl._lost = true; setTimeout(() => J.fire(gl._canvas, new G.WebGLContextEvent('webglcontextlost', { cancelable: true })), 0); },
        restoreContext() { if (!gl._lost) return; gl._lost = false; setTimeout(() => J.fire(gl._canvas, new G.WebGLContextEvent('webglcontextrestored')), 0); },
    }),
    WEBGL_draw_buffers: gl => {
        const e = {
            MAX_COLOR_ATTACHMENTS_WEBGL: 0x8CDF, MAX_DRAW_BUFFERS_WEBGL: 0x8824,
            drawBuffersWEBGL(list) { gl._use(); N.drawBuffers(list, list.length); },
        };
        for (let i = 0; i < 16; i++) { e['COLOR_ATTACHMENT' + i + '_WEBGL'] = 0x8CE0 + i; e['DRAW_BUFFER' + i + '_WEBGL'] = 0x8825 + i; }
        return e;
    },
};

J.createWebGL = function (canvas, attrs) {
    try { return new WebGLRenderingContext(canvas, attrs); }
    catch (e) { J.reportError(e, 'webgl context'); return null; }
};

// the canvas on the screen: the largest WebGL canvas in the document (J.mainCanvas)
let mainId = 0;
J.mainCanvas = null;
J.afterFrame.push(() => {
    let best = null, bestArea = -1;
    for (const ctx of contexts) {
        const c = ctx._canvas;
        if (ctx._lost || !c.isConnected) continue;
        const b = J.box(c);
        const area = b.w * b.h;
        if (area > bestArea) { best = ctx; bestArea = area; }
    }
    const id = best ? best._id : 0;
    J.mainCanvas = best ? best._canvas : null;
    if (id !== mainId) {
        mainId = id;
        N.canvasSetMain(id);
        if (best) H5.log(1, 'webgl: showing canvas ' + best._canvas.width + 'x' + best._canvas.height);
    }
});

})(globalThis.__h5);
