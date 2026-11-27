// h5: WebGL 1 on OpenGL ES 3. The JavaScript side (js/webgl.js) keeps WebGL's objects and checks; these
// natives are the GL calls, taking GL names and plain numbers. Each WebGL canvas's drawing buffer is an FBO;
// "framebuffer null" means that FBO. present_main_canvas() scales the page's main canvas onto the screen.
#include "gles.h"

#include "engine.h"
#include "h5.h"
#include "handles.h"
#include "platform.h"

#include <algorithm>
#include <cstring>
#include <set>
#include <unordered_map>

namespace h5::gl {

#define H5_GL_DEFINE(ret, name, params, args) ret(*name) params = nullptr;
H5_GL_FUNCTIONS(H5_GL_DEFINE)
#undef H5_GL_DEFINE

bool load()
{
    bool ok = true;
#define H5_GL_LOAD(ret, name, params, args)                                                                       \
    name = reinterpret_cast<ret(*) params>(platform::gl_proc(#name));                                             \
    if (!name) {                                                                                                  \
        H5_ERROR("GL: no %s", #name);                                                                             \
        ok = false;                                                                                               \
    }
    H5_GL_FUNCTIONS(H5_GL_LOAD)
#undef H5_GL_LOAD
    return ok;
}

namespace {

// WebGL's own pixelStorei names
constexpr GLenum UNPACK_FLIP_Y_WEBGL = 0x9240;
constexpr GLenum UNPACK_PREMULTIPLY_ALPHA_WEBGL = 0x9241;
constexpr GLenum UNPACK_COLORSPACE_CONVERSION_WEBGL = 0x9243;
constexpr GLenum HALF_FLOAT_OES = 0x8D61;

struct Canvas {
    GLuint fbo = 0, color = 0, depth_stencil = 0;
    int width = 0, height = 0;
    bool alpha = true, depth = true, stencil = false;
    bool drawn = false;
};

std::unordered_map<int, Canvas> g_canvases;
int g_next_canvas = 1;
int g_current = 0;            // the canvas whose FBO stands for framebuffer null
int g_main = 0;               // the canvas shown on the screen
bool g_default_bound = true;  // framebuffer null is bound
bool g_unpack_flip = false, g_unpack_premultiply = false;
int g_unpack_alignment = 4;
bool g_drawn_since_present = false;

// every object the page made, deleted on reload
std::set<GLuint> g_buffers, g_textures, g_framebuffers, g_renderbuffers, g_programs, g_shaders, g_vertex_arrays;

void allocate(Canvas &c)
{
    if (!c.fbo)
        glGenFramebuffers(1, &c.fbo);
    if (!c.color)
        glGenRenderbuffers(1, &c.color);
    glBindRenderbuffer(GL_RENDERBUFFER, c.color);
    glRenderbufferStorage(GL_RENDERBUFFER, c.alpha ? GL_RGBA8 : GL_RGB8, std::max(1, c.width), std::max(1, c.height));
    if (c.depth || c.stencil) {
        if (!c.depth_stencil)
            glGenRenderbuffers(1, &c.depth_stencil);
        glBindRenderbuffer(GL_RENDERBUFFER, c.depth_stencil);
        glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH24_STENCIL8, std::max(1, c.width), std::max(1, c.height));
    }
    glBindRenderbuffer(GL_RENDERBUFFER, 0);
    glBindFramebuffer(GL_FRAMEBUFFER, c.fbo);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, c.color);
    if (c.depth_stencil)
        glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_STENCIL_ATTACHMENT, GL_RENDERBUFFER, c.depth_stencil);
    const GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
    if (status != GL_FRAMEBUFFER_COMPLETE)
        H5_ERROR("GL: canvas framebuffer %dx%d incomplete (0x%x)", c.width, c.height, status);
    // a new drawing buffer starts transparent black
    GLboolean mask[4];
    glGetBooleanv(GL_COLOR_WRITEMASK, mask);
    GLfloat clear[4];
    glGetFloatv(GL_COLOR_CLEAR_VALUE, clear);
    const GLboolean scissor = glIsEnabled(GL_SCISSOR_TEST);
    glDisable(GL_SCISSOR_TEST);
    glColorMask(1, 1, 1, 1);
    glClearColor(0, 0, 0, 0);
    glClear(GL_COLOR_BUFFER_BIT | (c.depth_stencil ? GL_DEPTH_BUFFER_BIT | GL_STENCIL_BUFFER_BIT : 0));
    glColorMask(mask[0], mask[1], mask[2], mask[3]);
    glClearColor(clear[0], clear[1], clear[2], clear[3]);
    if (scissor)
        glEnable(GL_SCISSOR_TEST);
}

GLuint current_default_fbo()
{
    auto it = g_canvases.find(g_current);
    return it == g_canvases.end() ? 0 : it->second.fbo;
}

void mark_drawn()
{
    if (!g_default_bound)
        return;
    auto it = g_canvases.find(g_current);
    if (it != g_canvases.end())
        it->second.drawn = true;
    if (g_current == g_main)
        g_drawn_since_present = true;
}

// ---------------------------------------------------------------- pixel conversion for uploads
// Copies `rows` x `row_bytes` from src (stride src_stride) into a tight buffer, flipped if asked, and
// premultiplies or un-premultiplies RGBA8 to match what WebGL's unpack flags ask for.
std::vector<uint8_t> convert_rgba(const uint8_t *src, int width, int height, int src_stride, bool src_premultiplied,
    bool want_premultiplied, bool flip)
{
    const int row = width * 4;
    std::vector<uint8_t> out(static_cast<size_t>(row) * height);
    for (int y = 0; y < height; y++) {
        const uint8_t *s = src + static_cast<size_t>(flip ? height - 1 - y : y) * src_stride;
        uint8_t *d = out.data() + static_cast<size_t>(y) * row;
        if (src_premultiplied == want_premultiplied) {
            memcpy(d, s, row);
        } else if (want_premultiplied) {
            for (int x = 0; x < width; x++, s += 4, d += 4) {
                const unsigned a = s[3];
                d[0] = static_cast<uint8_t>((s[0] * a + 127) / 255);
                d[1] = static_cast<uint8_t>((s[1] * a + 127) / 255);
                d[2] = static_cast<uint8_t>((s[2] * a + 127) / 255);
                d[3] = static_cast<uint8_t>(a);
            }
        } else {
            for (int x = 0; x < width; x++, s += 4, d += 4) {
                const unsigned a = s[3];
                if (a == 0) {
                    d[0] = d[1] = d[2] = d[3] = 0;
                } else {
                    d[0] = static_cast<uint8_t>(std::min(255u, (s[0] * 255 + a / 2) / a));
                    d[1] = static_cast<uint8_t>(std::min(255u, (s[1] * 255 + a / 2) / a));
                    d[2] = static_cast<uint8_t>(std::min(255u, (s[2] * 255 + a / 2) / a));
                    d[3] = static_cast<uint8_t>(a);
                }
            }
        }
    }
    return out;
}

// RGBA8 pixels in the format/type WebGL asked for (only RGBA/UNSIGNED_BYTE goes through as is)
std::vector<uint8_t> to_format(const std::vector<uint8_t> &rgba, int width, int height, GLenum format, GLenum type)
{
    if (type != GL_UNSIGNED_BYTE)
        return rgba;   // (float/packed formats from an element source are rare: uploaded as RGBA8 bytes)
    const size_t n = static_cast<size_t>(width) * height;
    std::vector<uint8_t> out;
    switch (format) {
    case GL_RGB:
        out.resize(n * 3);
        for (size_t i = 0; i < n; i++)
            memcpy(&out[i * 3], &rgba[i * 4], 3);
        return out;
    case GL_ALPHA:
        out.resize(n);
        for (size_t i = 0; i < n; i++)
            out[i] = rgba[i * 4 + 3];
        return out;
    case GL_LUMINANCE:
        out.resize(n);
        for (size_t i = 0; i < n; i++)
            out[i] = rgba[i * 4];
        return out;
    case GL_LUMINANCE_ALPHA:
        out.resize(n * 2);
        for (size_t i = 0; i < n; i++) {
            out[i * 2] = rgba[i * 4];
            out[i * 2 + 1] = rgba[i * 4 + 3];
        }
        return out;
    default:
        return rgba;
    }
}

// GLES 3 wants sized internal formats for float textures (WebGL 1 passes the unsized format)
void fix_formats(GLint &internal, GLenum format, GLenum &type)
{
    if (type == HALF_FLOAT_OES)
        type = GL_HALF_FLOAT;
    if (type == GL_FLOAT) {
        if (format == GL_RGBA)
            internal = GL_RGBA32F;
        else if (format == GL_RGB)
            internal = GL_RGB32F;
    } else if (type == GL_HALF_FLOAT) {
        if (format == GL_RGBA)
            internal = GL_RGBA16F;
        else if (format == GL_RGB)
            internal = GL_RGB16F;
    }
}

int bytes_per_pixel(GLenum format, GLenum type)
{
    int channels = 4;
    switch (format) {
    case GL_ALPHA:
    case GL_LUMINANCE:
    case GL_DEPTH_COMPONENT:
        channels = 1;
        break;
    case GL_LUMINANCE_ALPHA:
        channels = 2;
        break;
    case GL_RGB:
        channels = 3;
        break;
    default:
        break;
    }
    switch (type) {
    case GL_UNSIGNED_SHORT_5_6_5:
    case GL_UNSIGNED_SHORT_4_4_4_4:
    case GL_UNSIGNED_SHORT_5_5_5_1:
        return 2;
    case GL_FLOAT:
        return channels * 4;
    case GL_HALF_FLOAT:
    case HALF_FLOAT_OES:
    case GL_UNSIGNED_SHORT:
        return channels * 2;
    case GL_UNSIGNED_INT:
        return channels * 4;
    default:
        return channels;
    }
}

// An ArrayBufferView upload with UNPACK_FLIP_Y / PREMULTIPLY applied (RGBA8 only premultiplies)
const void *prepare_view_upload(const js::Bytes &b, int width, int height, GLenum format, GLenum type, std::vector<uint8_t> &temp)
{
    if (!b.data || (!g_unpack_flip && !(g_unpack_premultiply && format == GL_RGBA && type == GL_UNSIGNED_BYTE)))
        return b.data;
    const int bpp = bytes_per_pixel(format, type);
    const int row = width * bpp;
    const int stride = (row + g_unpack_alignment - 1) / g_unpack_alignment * g_unpack_alignment;
    if (format == GL_RGBA && type == GL_UNSIGNED_BYTE) {
        temp = convert_rgba(static_cast<const uint8_t *>(b.data), width, height, stride, false, g_unpack_premultiply, g_unpack_flip);
        glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
        return temp.data();
    }
    temp.resize(static_cast<size_t>(stride) * height);
    for (int y = 0; y < height; y++)
        memcpy(&temp[static_cast<size_t>(y) * stride], static_cast<const uint8_t *>(b.data) + static_cast<size_t>(height - 1 - y) * stride, row);
    return temp.data();
}

// WebGL: a texture given no pixels is transparent black. GLES leaves it as the memory was: on the PS4 that is
// other textures' old pixels, which a game's never-drawn tiles then show (Happy Wheels' level backgrounds).
// Zeros, in strips from one buffer of at most 4 MiB.
void zero_texture(GLenum target, GLint level, int width, int height, GLenum format, GLenum type)
{
    const size_t row = static_cast<size_t>(std::max(0, width)) * static_cast<size_t>(bytes_per_pixel(format, type));
    if (!row || height <= 0)
        return;
    static std::vector<uint8_t> zeros;
    const size_t want = std::min(row * static_cast<size_t>(height), std::max(row, static_cast<size_t>(4) << 20));
    if (zeros.size() < want)
        zeros.assign(want, 0);
    const int rows = static_cast<int>(std::min(zeros.size() / row, static_cast<size_t>(height)));
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    for (int y = 0; y < height; y += rows)
        glTexSubImage2D(target, level, 0, y, width, std::min(rows, height - y), format, type, zeros.data());
    glPixelStorei(GL_UNPACK_ALIGNMENT, g_unpack_alignment);
}

JSValueRef typed(JSContextRef ctx, JSTypedArrayType t, const void *data, size_t bytes)
{
    return js::make_typed_array(ctx, t, data, bytes);
}

// ---------------------------------------------------------------- natives

// canvasCreate(width, height, alpha, depth, stencil) -> id
H5_NATIVE(n_canvas_create)
{
    Canvas c;
    c.width = std::max(1, H5_INT(0));
    c.height = std::max(1, H5_INT(1));
    c.alpha = H5_BOOL(2);
    c.depth = H5_BOOL(3);
    c.stencil = H5_BOOL(4);
    GLint previous = 0;
    glGetIntegerv(GL_FRAMEBUFFER_BINDING, &previous);
    allocate(c);
    glBindFramebuffer(GL_FRAMEBUFFER, static_cast<GLuint>(previous));
    const int id = g_next_canvas++;
    g_canvases[id] = c;
    if (!g_current)
        g_current = id;
    return JSValueMakeNumber(ctx, id);
}

// canvasResize(id, width, height)
H5_NATIVE(n_canvas_resize)
{
    auto it = g_canvases.find(H5_INT(0));
    if (it == g_canvases.end())
        return H5_UNDEFINED;
    Canvas &c = it->second;
    const int w = std::max(1, H5_INT(1)), h = std::max(1, H5_INT(2));
    if (w == c.width && h == c.height)
        return H5_UNDEFINED;
    c.width = w;
    c.height = h;
    GLint previous = 0;
    glGetIntegerv(GL_FRAMEBUFFER_BINDING, &previous);
    allocate(c);
    // framebuffer null keeps meaning this canvas
    glBindFramebuffer(GL_FRAMEBUFFER, (g_default_bound && it->first == g_current) ? c.fbo : static_cast<GLuint>(previous));
    return H5_UNDEFINED;
}

H5_NATIVE(n_canvas_delete)
{
    auto it = g_canvases.find(H5_INT(0));
    if (it == g_canvases.end())
        return H5_UNDEFINED;
    Canvas &c = it->second;
    glDeleteFramebuffers(1, &c.fbo);
    glDeleteRenderbuffers(1, &c.color);
    if (c.depth_stencil)
        glDeleteRenderbuffers(1, &c.depth_stencil);
    if (g_current == it->first)
        g_current = 0;
    if (g_main == it->first)
        g_main = 0;
    g_canvases.erase(it);
    return H5_UNDEFINED;
}

// canvasUse(id): the context of canvas id makes the next calls (framebuffer null = its FBO)
H5_NATIVE(n_canvas_use)
{
    const int id = H5_INT(0);
    if (id == g_current)
        return H5_UNDEFINED;
    g_current = id;
    if (g_default_bound)
        glBindFramebuffer(GL_FRAMEBUFFER, current_default_fbo());
    return H5_UNDEFINED;
}

H5_NATIVE(n_canvas_set_main)
{
    g_main = H5_INT(0);
    return H5_UNDEFINED;
}

H5_NATIVE(n_bind_framebuffer)
{
    const GLenum target = H5_UINT(0);
    const GLuint fb = H5_UINT(1);
    g_default_bound = fb == 0;
    glBindFramebuffer(target, fb ? fb : current_default_fbo());
    return H5_UNDEFINED;
}

#define SIMPLE_V(js, call) H5_NATIVE(js) { call; return H5_UNDEFINED; }

SIMPLE_V(n_active_texture, glActiveTexture(H5_UINT(0)))
SIMPLE_V(n_attach_shader, glAttachShader(H5_UINT(0), H5_UINT(1)))
SIMPLE_V(n_bind_buffer, glBindBuffer(H5_UINT(0), H5_UINT(1)))
SIMPLE_V(n_bind_renderbuffer, glBindRenderbuffer(H5_UINT(0), H5_UINT(1)))
SIMPLE_V(n_bind_texture, glBindTexture(H5_UINT(0), H5_UINT(1)))
SIMPLE_V(n_bind_vertex_array, glBindVertexArray(H5_UINT(0)))
SIMPLE_V(n_blend_color, glBlendColor(H5_NUM(0), H5_NUM(1), H5_NUM(2), H5_NUM(3)))
SIMPLE_V(n_blend_equation, glBlendEquation(H5_UINT(0)))
SIMPLE_V(n_blend_equation_separate, glBlendEquationSeparate(H5_UINT(0), H5_UINT(1)))
SIMPLE_V(n_blend_func, glBlendFunc(H5_UINT(0), H5_UINT(1)))
SIMPLE_V(n_blend_func_separate, glBlendFuncSeparate(H5_UINT(0), H5_UINT(1), H5_UINT(2), H5_UINT(3)))
SIMPLE_V(n_clear_color, glClearColor(H5_NUM(0), H5_NUM(1), H5_NUM(2), H5_NUM(3)))
SIMPLE_V(n_clear_depth, glClearDepthf(H5_NUM(0)))
SIMPLE_V(n_clear_stencil, glClearStencil(H5_INT(0)))
SIMPLE_V(n_color_mask, glColorMask(H5_BOOL(0), H5_BOOL(1), H5_BOOL(2), H5_BOOL(3)))
SIMPLE_V(n_compile_shader, glCompileShader(H5_UINT(0)))
SIMPLE_V(n_cull_face, glCullFace(H5_UINT(0)))
SIMPLE_V(n_depth_func, glDepthFunc(H5_UINT(0)))
SIMPLE_V(n_depth_mask, glDepthMask(H5_BOOL(0)))
SIMPLE_V(n_depth_range, glDepthRangef(H5_NUM(0), H5_NUM(1)))
SIMPLE_V(n_detach_shader, glDetachShader(H5_UINT(0), H5_UINT(1)))
SIMPLE_V(n_disable, glDisable(H5_UINT(0)))
SIMPLE_V(n_disable_vertex_attrib_array, glDisableVertexAttribArray(H5_UINT(0)))
SIMPLE_V(n_enable, glEnable(H5_UINT(0)))
SIMPLE_V(n_enable_vertex_attrib_array, glEnableVertexAttribArray(H5_UINT(0)))
SIMPLE_V(n_finish, glFinish())
SIMPLE_V(n_flush, glFlush())
SIMPLE_V(n_framebuffer_renderbuffer, glFramebufferRenderbuffer(H5_UINT(0), H5_UINT(1), H5_UINT(2), H5_UINT(3)))
SIMPLE_V(n_framebuffer_texture_2d, glFramebufferTexture2D(H5_UINT(0), H5_UINT(1), H5_UINT(2), H5_UINT(3), H5_INT(4)))
SIMPLE_V(n_front_face, glFrontFace(H5_UINT(0)))
SIMPLE_V(n_generate_mipmap, glGenerateMipmap(H5_UINT(0)))
SIMPLE_V(n_hint, glHint(H5_UINT(0), H5_UINT(1)))
SIMPLE_V(n_line_width, glLineWidth(H5_NUM(0)))
SIMPLE_V(n_link_program, glLinkProgram(H5_UINT(0)))
SIMPLE_V(n_polygon_offset, glPolygonOffset(H5_NUM(0), H5_NUM(1)))
SIMPLE_V(n_renderbuffer_storage, glRenderbufferStorage(H5_UINT(0), H5_UINT(1) == 0x84F9 /* DEPTH_STENCIL */ ? GL_DEPTH24_STENCIL8 : H5_UINT(1), H5_INT(2), H5_INT(3)))
SIMPLE_V(n_sample_coverage, glSampleCoverage(H5_NUM(0), H5_BOOL(1)))
SIMPLE_V(n_scissor, glScissor(H5_INT(0), H5_INT(1), H5_INT(2), H5_INT(3)))
SIMPLE_V(n_stencil_func, glStencilFunc(H5_UINT(0), H5_INT(1), H5_UINT(2)))
SIMPLE_V(n_stencil_func_separate, glStencilFuncSeparate(H5_UINT(0), H5_UINT(1), H5_INT(2), H5_UINT(3)))
SIMPLE_V(n_stencil_mask, glStencilMask(H5_UINT(0)))
SIMPLE_V(n_stencil_mask_separate, glStencilMaskSeparate(H5_UINT(0), H5_UINT(1)))
SIMPLE_V(n_stencil_op, glStencilOp(H5_UINT(0), H5_UINT(1), H5_UINT(2)))
SIMPLE_V(n_stencil_op_separate, glStencilOpSeparate(H5_UINT(0), H5_UINT(1), H5_UINT(2), H5_UINT(3)))
SIMPLE_V(n_tex_parameterf, glTexParameterf(H5_UINT(0), H5_UINT(1), H5_NUM(2)))
SIMPLE_V(n_tex_parameteri, glTexParameteri(H5_UINT(0), H5_UINT(1), H5_INT(2)))
SIMPLE_V(n_uniform1f, glUniform1f(H5_INT(0), H5_NUM(1)))
SIMPLE_V(n_uniform2f, glUniform2f(H5_INT(0), H5_NUM(1), H5_NUM(2)))
SIMPLE_V(n_uniform3f, glUniform3f(H5_INT(0), H5_NUM(1), H5_NUM(2), H5_NUM(3)))
SIMPLE_V(n_uniform4f, glUniform4f(H5_INT(0), H5_NUM(1), H5_NUM(2), H5_NUM(3), H5_NUM(4)))
SIMPLE_V(n_uniform1i, glUniform1i(H5_INT(0), H5_INT(1)))
SIMPLE_V(n_uniform2i, glUniform2i(H5_INT(0), H5_INT(1), H5_INT(2)))
SIMPLE_V(n_uniform3i, glUniform3i(H5_INT(0), H5_INT(1), H5_INT(2), H5_INT(3)))
SIMPLE_V(n_uniform4i, glUniform4i(H5_INT(0), H5_INT(1), H5_INT(2), H5_INT(3), H5_INT(4)))
SIMPLE_V(n_use_program, glUseProgram(H5_UINT(0)))
SIMPLE_V(n_validate_program, glValidateProgram(H5_UINT(0)))
SIMPLE_V(n_vertex_attrib1f, glVertexAttrib1f(H5_UINT(0), H5_NUM(1)))
SIMPLE_V(n_vertex_attrib2f, glVertexAttrib2f(H5_UINT(0), H5_NUM(1), H5_NUM(2)))
SIMPLE_V(n_vertex_attrib3f, glVertexAttrib3f(H5_UINT(0), H5_NUM(1), H5_NUM(2), H5_NUM(3)))
SIMPLE_V(n_vertex_attrib4f, glVertexAttrib4f(H5_UINT(0), H5_NUM(1), H5_NUM(2), H5_NUM(3), H5_NUM(4)))
SIMPLE_V(n_vertex_attrib_divisor, glVertexAttribDivisor(H5_UINT(0), H5_UINT(1)))
SIMPLE_V(n_vertex_attrib_pointer, glVertexAttribPointer(H5_UINT(0), H5_INT(1), H5_UINT(2), H5_BOOL(3), H5_INT(4), reinterpret_cast<const void *>(static_cast<intptr_t>(H5_NUM(5)))))
SIMPLE_V(n_viewport, glViewport(H5_INT(0), H5_INT(1), H5_INT(2), H5_INT(3)))

H5_NATIVE(n_bind_attrib_location)
{
    const std::string name = H5_STR(2);
    glBindAttribLocation(H5_UINT(0), H5_UINT(1), name.c_str());
    return H5_UNDEFINED;
}

// bufferData(target, sizeOrData, usage)
H5_NATIVE(n_buffer_data)
{
    const GLenum target = H5_UINT(0);
    JSValueRef v = H5_ARG(1);
    const GLenum usage = H5_UINT(2);
    if (JSValueIsNumber(ctx, v)) {
        glBufferData(target, static_cast<GLsizeiptr>(js::to_number(ctx, v)), nullptr, usage);
    } else {
        const js::Bytes b = js::bytes_of(ctx, v);
        glBufferData(target, static_cast<GLsizeiptr>(b.size), b.data, usage);
    }
    return H5_UNDEFINED;
}

// bufferSubData(target, offset, data)
H5_NATIVE(n_buffer_sub_data)
{
    const js::Bytes b = js::bytes_of(ctx, H5_ARG(2));
    if (b.data)
        glBufferSubData(H5_UINT(0), static_cast<GLintptr>(H5_NUM(1)), static_cast<GLsizeiptr>(b.size), b.data);
    return H5_UNDEFINED;
}

H5_NATIVE(n_check_framebuffer_status)
{
    return JSValueMakeNumber(ctx, glCheckFramebufferStatus(H5_UINT(0)));
}

H5_NATIVE(n_clear)
{
    glClear(H5_UINT(0));
    mark_drawn();
    return H5_UNDEFINED;
}

// compressedTexImage2D(target, level, internalformat, width, height, border, data)
H5_NATIVE(n_compressed_tex_image_2d)
{
    const js::Bytes b = js::bytes_of(ctx, H5_ARG(6));
    glCompressedTexImage2D(H5_UINT(0), H5_INT(1), H5_UINT(2), H5_INT(3), H5_INT(4), H5_INT(5), static_cast<GLsizei>(b.size), b.data);
    return H5_UNDEFINED;
}

// compressedTexSubImage2D(target, level, x, y, width, height, format, data)
H5_NATIVE(n_compressed_tex_sub_image_2d)
{
    const js::Bytes b = js::bytes_of(ctx, H5_ARG(7));
    glCompressedTexSubImage2D(H5_UINT(0), H5_INT(1), H5_INT(2), H5_INT(3), H5_INT(4), H5_INT(5), H5_UINT(6), static_cast<GLsizei>(b.size), b.data);
    return H5_UNDEFINED;
}

SIMPLE_V(n_copy_tex_image_2d, glCopyTexImage2D(H5_UINT(0), H5_INT(1), H5_UINT(2), H5_INT(3), H5_INT(4), H5_INT(5), H5_INT(6), H5_INT(7)))
SIMPLE_V(n_copy_tex_sub_image_2d, glCopyTexSubImage2D(H5_UINT(0), H5_INT(1), H5_INT(2), H5_INT(3), H5_INT(4), H5_INT(5), H5_INT(6), H5_INT(7)))

#define CREATE(js, gen, set)                                                                                     \
    H5_NATIVE(js)                                                                                                \
    {                                                                                                            \
        GLuint name = 0;                                                                                         \
        gen(1, &name);                                                                                           \
        if (name)                                                                                                \
            set.insert(name);                                                                                    \
        return JSValueMakeNumber(ctx, name);                                                                     \
    }
CREATE(n_create_buffer, glGenBuffers, g_buffers)
CREATE(n_create_framebuffer, glGenFramebuffers, g_framebuffers)
CREATE(n_create_renderbuffer, glGenRenderbuffers, g_renderbuffers)
CREATE(n_create_texture, glGenTextures, g_textures)
CREATE(n_create_vertex_array, glGenVertexArrays, g_vertex_arrays)

#define DELETE(js, del, set)                                                                                     \
    H5_NATIVE(js)                                                                                                \
    {                                                                                                            \
        GLuint name = H5_UINT(0);                                                                                \
        if (name && set.erase(name))                                                                             \
            del(1, &name);                                                                                       \
        return H5_UNDEFINED;                                                                                     \
    }
DELETE(n_delete_buffer, glDeleteBuffers, g_buffers)
DELETE(n_delete_renderbuffer, glDeleteRenderbuffers, g_renderbuffers)
DELETE(n_delete_texture, glDeleteTextures, g_textures)
DELETE(n_delete_vertex_array, glDeleteVertexArrays, g_vertex_arrays)

H5_NATIVE(n_delete_framebuffer)
{
    GLuint name = H5_UINT(0);
    if (name && g_framebuffers.erase(name)) {
        GLint bound = 0;
        glGetIntegerv(GL_FRAMEBUFFER_BINDING, &bound);
        glDeleteFramebuffers(1, &name);
        if (static_cast<GLuint>(bound) == name) {   // deleting the bound one binds "null"
            g_default_bound = true;
            glBindFramebuffer(GL_FRAMEBUFFER, current_default_fbo());
        }
    }
    return H5_UNDEFINED;
}

H5_NATIVE(n_create_program)
{
    const GLuint p = glCreateProgram();
    if (p)
        g_programs.insert(p);
    return JSValueMakeNumber(ctx, p);
}

H5_NATIVE(n_create_shader)
{
    const GLuint s = glCreateShader(H5_UINT(0));
    if (s)
        g_shaders.insert(s);
    return JSValueMakeNumber(ctx, s);
}

H5_NATIVE(n_delete_program)
{
    const GLuint p = H5_UINT(0);
    if (p && g_programs.erase(p))
        glDeleteProgram(p);
    return H5_UNDEFINED;
}

H5_NATIVE(n_delete_shader)
{
    const GLuint s = H5_UINT(0);
    if (s && g_shaders.erase(s))
        glDeleteShader(s);
    return H5_UNDEFINED;
}

H5_NATIVE(n_draw_arrays)
{
    glDrawArrays(H5_UINT(0), H5_INT(1), H5_INT(2));
    mark_drawn();
    return H5_UNDEFINED;
}

H5_NATIVE(n_draw_elements)
{
    glDrawElements(H5_UINT(0), H5_INT(1), H5_UINT(2), reinterpret_cast<const void *>(static_cast<intptr_t>(H5_NUM(3))));
    mark_drawn();
    return H5_UNDEFINED;
}

H5_NATIVE(n_draw_arrays_instanced)
{
    glDrawArraysInstanced(H5_UINT(0), H5_INT(1), H5_INT(2), H5_INT(3));
    mark_drawn();
    return H5_UNDEFINED;
}

H5_NATIVE(n_draw_elements_instanced)
{
    glDrawElementsInstanced(H5_UINT(0), H5_INT(1), H5_UINT(2), reinterpret_cast<const void *>(static_cast<intptr_t>(H5_NUM(3))), H5_INT(4));
    mark_drawn();
    return H5_UNDEFINED;
}

// drawBuffers([attachments]) (WEBGL_draw_buffers): BACK means the canvas's color attachment
H5_NATIVE(n_draw_buffers)
{
    JSObjectRef list = js::object_of(ctx, H5_ARG(0));
    if (!list)
        return H5_UNDEFINED;
    const int n = std::min(8, H5_INT(1));
    GLenum bufs[8];
    for (int i = 0; i < n; i++) {
        const GLenum b = js::to_uint(ctx, JSObjectGetPropertyAtIndex(ctx, list, i, nullptr));
        bufs[i] = (b == GL_BACK && g_default_bound) ? GL_COLOR_ATTACHMENT0 : b;
    }
    glDrawBuffers(n, bufs);
    return H5_UNDEFINED;
}

// getActiveAttrib / getActiveUniform(program, index) -> {size, type, name} | null
template <bool Uniform>
JSValueRef active_info(JSContextRef ctx, size_t argc, const JSValueRef argv[])
{
    GLchar name[256];
    GLsizei length = 0;
    GLint size = 0;
    GLenum type = 0;
    if (Uniform)
        glGetActiveUniform(H5_UINT(0), H5_UINT(1), sizeof name, &length, &size, &type, name);
    else
        glGetActiveAttrib(H5_UINT(0), H5_UINT(1), sizeof name, &length, &size, &type, name);
    if (length <= 0)
        return JSValueMakeNull(ctx);
    JSObjectRef o = JSObjectMake(ctx, nullptr, nullptr);
    js::set(ctx, o, "size", JSValueMakeNumber(ctx, size));
    js::set(ctx, o, "type", JSValueMakeNumber(ctx, type));
    js::set(ctx, o, "name", js::make_string(ctx, std::string(name, static_cast<size_t>(length))));
    return o;
}

H5_NATIVE(n_get_active_attrib) { return active_info<false>(ctx, argc, argv); }
H5_NATIVE(n_get_active_uniform) { return active_info<true>(ctx, argc, argv); }

H5_NATIVE(n_get_attrib_location)
{
    const std::string name = H5_STR(1);
    return JSValueMakeNumber(ctx, glGetAttribLocation(H5_UINT(0), name.c_str()));
}

H5_NATIVE(n_get_uniform_location)
{
    const std::string name = H5_STR(1);
    return JSValueMakeNumber(ctx, glGetUniformLocation(H5_UINT(0), name.c_str()));
}

H5_NATIVE(n_get_buffer_parameter)
{
    GLint v = 0;
    glGetBufferParameteriv(H5_UINT(0), H5_UINT(1), &v);
    return JSValueMakeNumber(ctx, v);
}

H5_NATIVE(n_get_error)
{
    return JSValueMakeNumber(ctx, glGetError());
}

H5_NATIVE(n_get_framebuffer_attachment_parameter)
{
    GLint v = 0;
    glGetFramebufferAttachmentParameteriv(H5_UINT(0), H5_UINT(1), H5_UINT(2), &v);
    return JSValueMakeNumber(ctx, v);
}

// getParameter(pname) for the plain values (numbers, booleans, typed arrays, strings); the JS side
// answers the object-valued ones (bindings) and WebGL's own
H5_NATIVE(n_get_parameter)
{
    const GLenum p = H5_UINT(0);
    switch (p) {
    case GL_BLEND:
    case GL_CULL_FACE:
    case GL_DEPTH_TEST:
    case GL_DITHER:
    case GL_POLYGON_OFFSET_FILL:
    case GL_SAMPLE_ALPHA_TO_COVERAGE:
    case GL_SAMPLE_COVERAGE:
    case GL_SCISSOR_TEST:
    case GL_STENCIL_TEST:
    case GL_DEPTH_WRITEMASK:
    case GL_SAMPLE_COVERAGE_INVERT: {
        GLboolean b = 0;
        glGetBooleanv(p, &b);
        return JSValueMakeBoolean(ctx, b);
    }
    case GL_COLOR_WRITEMASK: {
        GLboolean b[4] = {};
        glGetBooleanv(p, b);
        JSValueRef items[4];
        for (int i = 0; i < 4; i++)
            items[i] = JSValueMakeBoolean(ctx, b[i]);
        return JSObjectMakeArray(ctx, 4, items, nullptr);
    }
    case GL_DEPTH_CLEAR_VALUE:
    case GL_LINE_WIDTH:
    case GL_POLYGON_OFFSET_FACTOR:
    case GL_POLYGON_OFFSET_UNITS:
    case GL_SAMPLE_COVERAGE_VALUE:
    case 0x84FF: /* MAX_TEXTURE_MAX_ANISOTROPY_EXT */ {
        GLfloat f = 0;
        glGetFloatv(p, &f);
        return JSValueMakeNumber(ctx, f);
    }
    case GL_ALIASED_LINE_WIDTH_RANGE:
    case GL_ALIASED_POINT_SIZE_RANGE:
    case GL_DEPTH_RANGE: {
        GLfloat f[2] = {};
        glGetFloatv(p, f);
        return typed(ctx, kJSTypedArrayTypeFloat32Array, f, sizeof f);
    }
    case GL_BLEND_COLOR:
    case GL_COLOR_CLEAR_VALUE: {
        GLfloat f[4] = {};
        glGetFloatv(p, f);
        return typed(ctx, kJSTypedArrayTypeFloat32Array, f, sizeof f);
    }
    case GL_MAX_VIEWPORT_DIMS: {
        GLint v[2] = {};
        glGetIntegerv(p, v);
        return typed(ctx, kJSTypedArrayTypeInt32Array, v, sizeof v);
    }
    case GL_SCISSOR_BOX:
    case GL_VIEWPORT: {
        GLint v[4] = {};
        glGetIntegerv(p, v);
        return typed(ctx, kJSTypedArrayTypeInt32Array, v, sizeof v);
    }
    case GL_VENDOR:
    case GL_RENDERER:
    case GL_VERSION:
    case GL_SHADING_LANGUAGE_VERSION: {
        const GLubyte *s = glGetString(p);
        return js::make_string(ctx, s ? reinterpret_cast<const char *>(s) : "");
    }
    case GL_UNPACK_ALIGNMENT:
        return JSValueMakeNumber(ctx, g_unpack_alignment);
    default: {
        GLint v = 0;
        glGetIntegerv(p, &v);
        return JSValueMakeNumber(ctx, v);
    }
    }
}

H5_NATIVE(n_get_program_info_log)
{
    GLint len = 0;
    glGetProgramiv(H5_UINT(0), GL_INFO_LOG_LENGTH, &len);
    std::string s(static_cast<size_t>(std::max(len, 1)), '\0');
    GLsizei got = 0;
    glGetProgramInfoLog(H5_UINT(0), static_cast<GLsizei>(s.size()), &got, s.data());
    s.resize(static_cast<size_t>(std::max(got, 0)));
    return js::make_string(ctx, s);
}

H5_NATIVE(n_get_program_parameter)
{
    GLint v = 0;
    glGetProgramiv(H5_UINT(0), H5_UINT(1), &v);
    return JSValueMakeNumber(ctx, v);
}

H5_NATIVE(n_get_renderbuffer_parameter)
{
    GLint v = 0;
    glGetRenderbufferParameteriv(H5_UINT(0), H5_UINT(1), &v);
    return JSValueMakeNumber(ctx, v);
}

H5_NATIVE(n_get_shader_info_log)
{
    GLint len = 0;
    glGetShaderiv(H5_UINT(0), GL_INFO_LOG_LENGTH, &len);
    std::string s(static_cast<size_t>(std::max(len, 1)), '\0');
    GLsizei got = 0;
    glGetShaderInfoLog(H5_UINT(0), static_cast<GLsizei>(s.size()), &got, s.data());
    s.resize(static_cast<size_t>(std::max(got, 0)));
    return js::make_string(ctx, s);
}

H5_NATIVE(n_get_shader_parameter)
{
    GLint v = 0;
    glGetShaderiv(H5_UINT(0), H5_UINT(1), &v);
    return JSValueMakeNumber(ctx, v);
}

// getShaderPrecisionFormat(shadertype, precisiontype) -> [rangeMin, rangeMax, precision]
H5_NATIVE(n_get_shader_precision_format)
{
    GLint range[2] = { 127, 127 }, precision = 23;
    glGetShaderPrecisionFormat(H5_UINT(0), H5_UINT(1), range, &precision);
    JSValueRef items[3] = { JSValueMakeNumber(ctx, range[0]), JSValueMakeNumber(ctx, range[1]), JSValueMakeNumber(ctx, precision) };
    return JSObjectMakeArray(ctx, 3, items, nullptr);
}

H5_NATIVE(n_get_tex_parameter)
{
    GLint v = 0;
    glGetTexParameteriv(H5_UINT(0), H5_UINT(1), &v);
    return JSValueMakeNumber(ctx, v);
}

// getUniform(program, location, count, isInt) -> number | typed array
H5_NATIVE(n_get_uniform)
{
    const int count = std::clamp(H5_INT(2), 1, 16);
    if (H5_BOOL(3)) {
        GLint v[16] = {};
        glGetUniformiv(H5_UINT(0), H5_INT(1), v);
        return count == 1 ? JSValueMakeNumber(ctx, v[0]) : typed(ctx, kJSTypedArrayTypeInt32Array, v, count * 4);
    }
    GLfloat v[16] = {};
    glGetUniformfv(H5_UINT(0), H5_INT(1), v);
    return count == 1 ? JSValueMakeNumber(ctx, v[0]) : typed(ctx, kJSTypedArrayTypeFloat32Array, v, count * 4);
}

// getVertexAttrib(index, pname) -> number | Float32Array(4) for CURRENT_VERTEX_ATTRIB
H5_NATIVE(n_get_vertex_attrib)
{
    const GLenum p = H5_UINT(1);
    if (p == GL_CURRENT_VERTEX_ATTRIB) {
        GLfloat v[4] = {};
        glGetVertexAttribfv(H5_UINT(0), p, v);
        return typed(ctx, kJSTypedArrayTypeFloat32Array, v, sizeof v);
    }
    GLint v = 0;
    glGetVertexAttribiv(H5_UINT(0), p, &v);
    return JSValueMakeNumber(ctx, v);
}

H5_NATIVE(n_is_enabled)
{
    return JSValueMakeBoolean(ctx, glIsEnabled(H5_UINT(0)));
}

H5_NATIVE(n_pixel_storei)
{
    const GLenum p = H5_UINT(0);
    const int v = H5_INT(1);
    switch (p) {
    case UNPACK_FLIP_Y_WEBGL:
        g_unpack_flip = v != 0;
        break;
    case UNPACK_PREMULTIPLY_ALPHA_WEBGL:
        g_unpack_premultiply = v != 0;
        break;
    case UNPACK_COLORSPACE_CONVERSION_WEBGL:
        break;
    case GL_UNPACK_ALIGNMENT:
        g_unpack_alignment = v;
        glPixelStorei(p, v);
        break;
    default:
        glPixelStorei(p, v);
        break;
    }
    return H5_UNDEFINED;
}

// readPixels(x, y, width, height, format, type, dst)
H5_NATIVE(n_read_pixels)
{
    const js::Bytes b = js::bytes_of(ctx, H5_ARG(6));
    if (!b.data)
        return H5_UNDEFINED;
    const int w = H5_INT(2), h = H5_INT(3);
    const GLenum format = H5_UINT(4), type = H5_UINT(5);
    const size_t need = static_cast<size_t>(w) * h * bytes_per_pixel(format, type);
    if (b.size < need)
        return js::throw_error(ctx, exception, "readPixels: the array is too small", true);
    glPixelStorei(GL_PACK_ALIGNMENT, 1);
    glReadPixels(H5_INT(0), H5_INT(1), w, h, format, type, b.data);
    glPixelStorei(GL_PACK_ALIGNMENT, 4);
    return H5_UNDEFINED;
}

H5_NATIVE(n_shader_source)
{
    const std::string source = H5_STR(1);
    const GLchar *s = source.c_str();
    const GLint len = static_cast<GLint>(source.size());
    glShaderSource(H5_UINT(0), 1, &s, &len);
    return H5_UNDEFINED;
}

// texImage2D(target, level, internalformat, width, height, border, format, type, pixels|null)
H5_NATIVE(n_tex_image_2d)
{
    GLint internal = H5_INT(2);
    const int w = H5_INT(3), h = H5_INT(4);
    const GLenum format = H5_UINT(6);
    GLenum type = H5_UINT(7);
    const js::Bytes b = js::bytes_of(ctx, H5_ARG(8));
    std::vector<uint8_t> temp;
    const void *data = prepare_view_upload(b, w, h, format, type, temp);
    fix_formats(internal, format, type);
    glTexImage2D(H5_UINT(0), H5_INT(1), internal, w, h, H5_INT(5), format, type, data);
    if (data == temp.data() && !temp.empty())
        glPixelStorei(GL_UNPACK_ALIGNMENT, g_unpack_alignment);
    if (!data)
        zero_texture(H5_UINT(0), H5_INT(1), w, h, format, type);
    return H5_UNDEFINED;
}

// texSubImage2D(target, level, x, y, width, height, format, type, pixels)
H5_NATIVE(n_tex_sub_image_2d)
{
    const int w = H5_INT(4), h = H5_INT(5);
    const GLenum format = H5_UINT(6);
    GLenum type = H5_UINT(7);
    const js::Bytes b = js::bytes_of(ctx, H5_ARG(8));
    if (!b.data)
        return H5_UNDEFINED;
    std::vector<uint8_t> temp;
    const void *data = prepare_view_upload(b, w, h, format, type, temp);
    if (type == HALF_FLOAT_OES)
        type = GL_HALF_FLOAT;
    glTexSubImage2D(H5_UINT(0), H5_INT(1), H5_INT(2), H5_INT(3), w, h, format, type, data);
    if (data == temp.data() && !temp.empty())
        glPixelStorei(GL_UNPACK_ALIGNMENT, g_unpack_alignment);
    return H5_UNDEFINED;
}

// texImageSource(target, level, internalformat, format, type, handle) and
// texSubImageSource(target, level, x, y, format, type, handle): an image or a 2D canvas
bool source_pixels(JSContextRef ctx, JSValueRef v, PixelView &view)
{
    Handle *h = handle_of(ctx, v);
    return h && h->pixels(view) && view.data;
}

H5_NATIVE(n_tex_image_source)
{
    PixelView view;
    if (!source_pixels(ctx, H5_ARG(5), view))
        return js::throw_error(ctx, exception, "texImage2D: the source has no pixels", true);
    GLint internal = H5_INT(2);
    const GLenum format = H5_UINT(3);
    GLenum type = H5_UINT(4);
    std::vector<uint8_t> rgba = convert_rgba(view.data, view.width, view.height, view.stride, view.premultiplied, g_unpack_premultiply, g_unpack_flip);
    std::vector<uint8_t> px = to_format(rgba, view.width, view.height, format, type);
    if (type != GL_UNSIGNED_BYTE) {   // (a float texture from an image: RGBA8 bytes)
        type = GL_UNSIGNED_BYTE;
        internal = format;
    }
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glTexImage2D(H5_UINT(0), H5_INT(1), internal, view.width, view.height, 0, format, type, px.data());
    glPixelStorei(GL_UNPACK_ALIGNMENT, g_unpack_alignment);
    return H5_UNDEFINED;
}

H5_NATIVE(n_tex_sub_image_source)
{
    PixelView view;
    if (!source_pixels(ctx, H5_ARG(6), view))
        return js::throw_error(ctx, exception, "texSubImage2D: the source has no pixels", true);
    const GLenum format = H5_UINT(4);
    std::vector<uint8_t> rgba = convert_rgba(view.data, view.width, view.height, view.stride, view.premultiplied, g_unpack_premultiply, g_unpack_flip);
    std::vector<uint8_t> px = to_format(rgba, view.width, view.height, format, GL_UNSIGNED_BYTE);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glTexSubImage2D(H5_UINT(0), H5_INT(1), H5_INT(2), H5_INT(3), view.width, view.height, format, GL_UNSIGNED_BYTE, px.data());
    glPixelStorei(GL_UNPACK_ALIGNMENT, g_unpack_alignment);
    return H5_UNDEFINED;
}

// uniform[1234][fi]v(location, data) and uniformMatrix[234]fv(location, transpose, data)
template <int Kind>
JSValueRef uniform_v(JSContextRef ctx, size_t argc, const JSValueRef argv[], JSValueRef *exception)
{
    const GLint loc = H5_INT(0);
    const js::Bytes b = js::bytes_of(ctx, H5_ARG(Kind >= 20 ? 2 : 1));
    if (!b.data)
        return js::throw_error(ctx, exception, "uniform: needs a typed array", true);
    const GLsizei floats = static_cast<GLsizei>(b.size / 4);
    const auto *f = static_cast<const GLfloat *>(b.data);
    const auto *i = static_cast<const GLint *>(b.data);
    switch (Kind) {
    case 1: glUniform1fv(loc, floats, f); break;
    case 2: glUniform2fv(loc, floats / 2, f); break;
    case 3: glUniform3fv(loc, floats / 3, f); break;
    case 4: glUniform4fv(loc, floats / 4, f); break;
    case 11: glUniform1iv(loc, floats, i); break;
    case 12: glUniform2iv(loc, floats / 2, i); break;
    case 13: glUniform3iv(loc, floats / 3, i); break;
    case 14: glUniform4iv(loc, floats / 4, i); break;
    case 22: glUniformMatrix2fv(loc, floats / 4, H5_BOOL(1), f); break;
    case 23: glUniformMatrix3fv(loc, floats / 9, H5_BOOL(1), f); break;
    case 24: glUniformMatrix4fv(loc, floats / 16, H5_BOOL(1), f); break;
    }
    return JSValueMakeUndefined(ctx);
}
H5_NATIVE(n_uniform1fv) { return uniform_v<1>(ctx, argc, argv, exception); }
H5_NATIVE(n_uniform2fv) { return uniform_v<2>(ctx, argc, argv, exception); }
H5_NATIVE(n_uniform3fv) { return uniform_v<3>(ctx, argc, argv, exception); }
H5_NATIVE(n_uniform4fv) { return uniform_v<4>(ctx, argc, argv, exception); }
H5_NATIVE(n_uniform1iv) { return uniform_v<11>(ctx, argc, argv, exception); }
H5_NATIVE(n_uniform2iv) { return uniform_v<12>(ctx, argc, argv, exception); }
H5_NATIVE(n_uniform3iv) { return uniform_v<13>(ctx, argc, argv, exception); }
H5_NATIVE(n_uniform4iv) { return uniform_v<14>(ctx, argc, argv, exception); }
H5_NATIVE(n_uniform_matrix2fv) { return uniform_v<22>(ctx, argc, argv, exception); }
H5_NATIVE(n_uniform_matrix3fv) { return uniform_v<23>(ctx, argc, argv, exception); }
H5_NATIVE(n_uniform_matrix4fv) { return uniform_v<24>(ctx, argc, argv, exception); }

H5_NATIVE(n_info)
{
    JSObjectRef o = JSObjectMake(ctx, nullptr, nullptr);
    auto str = [&](const char *key, GLenum e) {
        const GLubyte *s = glGetString(e);
        js::set(ctx, o, key, js::make_string(ctx, s ? reinterpret_cast<const char *>(s) : ""));
    };
    str("vendor", GL_VENDOR);
    str("renderer", GL_RENDERER);
    str("version", GL_VERSION);
    str("glsl", GL_SHADING_LANGUAGE_VERSION);
    GLint n = 0;
    glGetIntegerv(GL_NUM_EXTENSIONS, &n);
    js::set(ctx, o, "extensionCount", JSValueMakeNumber(ctx, n));
    js::set(ctx, o, "screenWidth", JSValueMakeNumber(ctx, platform::screen_width()));
    js::set(ctx, o, "screenHeight", JSValueMakeNumber(ctx, platform::screen_height()));
    return o;
}

// ---------------------------------------------------------------- the runtime's overlay
// js/overlay.js draws the pointer, the quick menu and the frame counter into 2D canvases; these natives put
// them over the presented frame in screen pixels (top-left origin), after the page's canvas is blitted.
//   overlayTexture(id, handle)        copies a 2D canvas's (or an image's) pixels as texture id (> 0)
//   overlayDeleteTexture(id)
//   overlayBegin()                    starts a new list of quads (a list stays on the screen until then)
//   overlayDraw(id, x, y, w, h, r, g, b, a [, sx, sy, sw, sh])   a quad of texture id (0: plain colour) times
//                                     (r, g, b), alpha a; sx.. the part of the texture (its pixels) to stretch
//   presentRect() -> [screen w, screen h, x, y, w, h]   where the main canvas is shown
namespace overlay {

struct Texture {
    GLuint name = 0;
    int width = 0, height = 0;   // of the GL texture
    std::vector<uint8_t> pending;   // premultiplied RGBA8, uploaded at the next present
    int pending_width = 0, pending_height = 0;
    bool dirty = false;
};
struct Quad {
    int texture;
    float x, y, w, h, r, g, b, a;
    float sx = 0, sy = 0, sw = -1, sh = -1;   // the part of the texture, in its pixels (sw < 0: all of it)
};

std::unordered_map<int, Texture> g_textures;
std::vector<Quad> g_quads;
GLuint g_program = 0, g_vao = 0, g_white = 0;
GLint g_u_rect = -1, g_u_screen = -1, g_u_color = -1, g_u_uv = -1;
bool g_failed = false;

const char *VERTEX_SHADER = R"(#version 300 es
uniform vec4 u_rect;
uniform vec4 u_uv;
uniform vec2 u_screen;
out vec2 v_uv;
void main() {
    vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
    v_uv = u_uv.xy + c * u_uv.zw;
    vec2 p = u_rect.xy + c * u_rect.zw;
    gl_Position = vec4(p.x / u_screen.x * 2.0 - 1.0, 1.0 - p.y / u_screen.y * 2.0, 0.0, 1.0);
}
)";
const char *FRAGMENT_SHADER = R"(#version 300 es
precision mediump float;
uniform sampler2D u_texture;
uniform vec4 u_color;
in vec2 v_uv;
out vec4 o_color;
void main() {
    o_color = texture(u_texture, v_uv) * u_color;
}
)";

GLuint compile(GLenum type, const char *source)
{
    const GLuint s = glCreateShader(type);
    glShaderSource(s, 1, &source, nullptr);
    glCompileShader(s);
    GLint ok = 0;
    glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[1024] = {};
        glGetShaderInfoLog(s, sizeof log, nullptr, log);
        H5_ERROR("overlay: a shader did not compile: %s", log);
        glDeleteShader(s);
        return 0;
    }
    return s;
}

void set_texture_parameters(GLenum filter)
{
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, static_cast<GLint>(filter));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, static_cast<GLint>(filter));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
}

// the program, its empty vertex array (the quad comes from gl_VertexID) and a white texel for plain colours;
// called with the page's GL state saved
bool setup()
{
    if (g_program)
        return true;
    if (g_failed)
        return false;
    g_failed = true;
    const GLuint vs = compile(GL_VERTEX_SHADER, VERTEX_SHADER);
    const GLuint fs = compile(GL_FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) {
        if (vs)
            glDeleteShader(vs);
        if (fs)
            glDeleteShader(fs);
        return false;
    }
    const GLuint p = glCreateProgram();
    glAttachShader(p, vs);
    glAttachShader(p, fs);
    glLinkProgram(p);
    glDeleteShader(vs);
    glDeleteShader(fs);
    GLint ok = 0;
    glGetProgramiv(p, GL_LINK_STATUS, &ok);
    if (!ok) {
        char log[1024] = {};
        glGetProgramInfoLog(p, sizeof log, nullptr, log);
        H5_ERROR("overlay: the program did not link: %s", log);
        glDeleteProgram(p);
        return false;
    }
    g_program = p;
    g_u_rect = glGetUniformLocation(p, "u_rect");
    g_u_screen = glGetUniformLocation(p, "u_screen");
    g_u_color = glGetUniformLocation(p, "u_color");
    g_u_uv = glGetUniformLocation(p, "u_uv");
    glUseProgram(p);
    glUniform1i(glGetUniformLocation(p, "u_texture"), 0);
    glGenVertexArrays(1, &g_vao);
    glGenTextures(1, &g_white);
    glBindTexture(GL_TEXTURE_2D, g_white);
    const uint8_t white[4] = { 255, 255, 255, 255 };
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 1, 1, 0, GL_RGBA, GL_UNSIGNED_BYTE, white);
    set_texture_parameters(GL_NEAREST);
    g_failed = false;
    return true;
}

void upload(Texture &t)
{
    if (!t.name) {
        glGenTextures(1, &t.name);
        glBindTexture(GL_TEXTURE_2D, t.name);
        set_texture_parameters(GL_LINEAR);
    } else {
        glBindTexture(GL_TEXTURE_2D, t.name);
    }
    if (t.pending_width != t.width || t.pending_height != t.height) {
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, t.pending_width, t.pending_height, 0, GL_RGBA, GL_UNSIGNED_BYTE,
            t.pending.data());
        t.width = t.pending_width;
        t.height = t.pending_height;
    } else {
        glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, t.width, t.height, GL_RGBA, GL_UNSIGNED_BYTE, t.pending.data());
    }
    t.pending = std::vector<uint8_t>();
    t.dirty = false;
}

// draws the quads onto the bound draw framebuffer (the screen), leaving the page's GL state as it was
void draw(int sw, int sh)
{
    bool dirty = false;
    for (const auto &[id, t] : g_textures)
        dirty = dirty || t.dirty;
    if (g_quads.empty() && !dirty)
        return;
    GLint program = 0, vao = 0, active = 0, texture = 0, viewport[4] = {};
    GLint src_rgb = 0, dst_rgb = 0, src_alpha = 0, dst_alpha = 0, eq_rgb = 0, eq_alpha = 0;
    glGetIntegerv(GL_CURRENT_PROGRAM, &program);
    glGetIntegerv(GL_VERTEX_ARRAY_BINDING, &vao);
    glGetIntegerv(GL_ACTIVE_TEXTURE, &active);
    glActiveTexture(GL_TEXTURE0);
    glGetIntegerv(GL_TEXTURE_BINDING_2D, &texture);
    glGetIntegerv(GL_VIEWPORT, viewport);
    glGetIntegerv(GL_BLEND_SRC_RGB, &src_rgb);
    glGetIntegerv(GL_BLEND_DST_RGB, &dst_rgb);
    glGetIntegerv(GL_BLEND_SRC_ALPHA, &src_alpha);
    glGetIntegerv(GL_BLEND_DST_ALPHA, &dst_alpha);
    glGetIntegerv(GL_BLEND_EQUATION_RGB, &eq_rgb);
    glGetIntegerv(GL_BLEND_EQUATION_ALPHA, &eq_alpha);
    GLboolean mask[4];
    glGetBooleanv(GL_COLOR_WRITEMASK, mask);
    const GLenum caps[] = { GL_BLEND, GL_DEPTH_TEST, GL_STENCIL_TEST, GL_CULL_FACE, GL_SAMPLE_ALPHA_TO_COVERAGE,
        GL_SAMPLE_COVERAGE, GL_POLYGON_OFFSET_FILL };
    GLboolean enabled[sizeof caps / sizeof caps[0]];
    for (size_t i = 0; i < sizeof caps / sizeof caps[0]; i++) {
        enabled[i] = glIsEnabled(caps[i]);
        glDisable(caps[i]);
    }
    if (setup()) {
        glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
        for (auto &[id, t] : g_textures)
            if (t.dirty && !t.pending.empty())
                upload(t);
        glEnable(GL_BLEND);
        glBlendEquationSeparate(GL_FUNC_ADD, GL_FUNC_ADD);
        glBlendFuncSeparate(GL_ONE, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
        glColorMask(1, 1, 1, 1);
        glViewport(0, 0, sw, sh);
        glUseProgram(g_program);
        glBindVertexArray(g_vao);
        glUniform2f(g_u_screen, static_cast<GLfloat>(sw), static_cast<GLfloat>(sh));
        for (const Quad &q : g_quads) {
            GLuint name = g_white;
            float u0 = 0, v0 = 0, u1 = 1, v1 = 1;
            if (q.texture) {
                auto it = g_textures.find(q.texture);
                if (it == g_textures.end() || !it->second.name)
                    continue;
                name = it->second.name;
                if (q.sw >= 0 && it->second.width > 0 && it->second.height > 0) {
                    u0 = q.sx / it->second.width;
                    v0 = q.sy / it->second.height;
                    u1 = q.sw / it->second.width;
                    v1 = q.sh / it->second.height;
                }
            }
            glBindTexture(GL_TEXTURE_2D, name);
            glUniform4f(g_u_uv, u0, v0, u1, v1);
            glUniform4f(g_u_rect, q.x, q.y, q.w, q.h);
            glUniform4f(g_u_color, q.r * q.a, q.g * q.a, q.b * q.a, q.a);   // premultiplied
            glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
        }
    }
    glUseProgram(static_cast<GLuint>(program));
    glBindVertexArray(static_cast<GLuint>(vao));
    glBindTexture(GL_TEXTURE_2D, static_cast<GLuint>(texture));
    glActiveTexture(static_cast<GLenum>(active));
    glViewport(viewport[0], viewport[1], viewport[2], viewport[3]);
    glBlendEquationSeparate(static_cast<GLenum>(eq_rgb), static_cast<GLenum>(eq_alpha));
    glBlendFuncSeparate(static_cast<GLenum>(src_rgb), static_cast<GLenum>(dst_rgb), static_cast<GLenum>(src_alpha),
        static_cast<GLenum>(dst_alpha));
    glColorMask(mask[0], mask[1], mask[2], mask[3]);
    for (size_t i = 0; i < sizeof caps / sizeof caps[0]; i++)
        if (enabled[i])
            glEnable(caps[i]);
        else
            glDisable(caps[i]);
    glPixelStorei(GL_UNPACK_ALIGNMENT, g_unpack_alignment);
}

void release()
{
    for (auto &[id, t] : g_textures)
        if (t.name)
            glDeleteTextures(1, &t.name);
    g_textures.clear();
    g_quads.clear();
}

} // namespace overlay

// where a canvas of cw x ch shows on the screen: the largest rectangle of its shape that fits, centred
void fit(int cw, int ch, int sw, int sh, int &dx, int &dy, int &dw, int &dh)
{
    dw = sw;
    dh = cw > 0 ? static_cast<int>(static_cast<long long>(sw) * ch / cw) : sh;
    if (dh > sh || cw <= 0 || ch <= 0) {
        dh = sh;
        dw = ch > 0 ? static_cast<int>(static_cast<long long>(sh) * cw / ch) : sw;
    }
    dx = (sw - dw) / 2;
    dy = (sh - dh) / 2;
}

H5_NATIVE(n_overlay_texture)
{
    const int id = H5_INT(0);
    PixelView view;
    if (id <= 0 || !source_pixels(ctx, H5_ARG(1), view) || view.width <= 0 || view.height <= 0)
        return JSValueMakeBoolean(ctx, false);
    overlay::Texture &t = overlay::g_textures[id];
    t.pending = convert_rgba(view.data, view.width, view.height, view.stride, view.premultiplied, true, false);
    t.pending_width = view.width;
    t.pending_height = view.height;
    t.dirty = true;
    return JSValueMakeBoolean(ctx, true);
}

H5_NATIVE(n_overlay_delete_texture)
{
    auto it = overlay::g_textures.find(H5_INT(0));
    if (it != overlay::g_textures.end()) {
        if (it->second.name)
            glDeleteTextures(1, &it->second.name);
        overlay::g_textures.erase(it);
    }
    return H5_UNDEFINED;
}

H5_NATIVE(n_overlay_begin)
{
    overlay::g_quads.clear();
    return H5_UNDEFINED;
}

H5_NATIVE(n_overlay_draw)
{
    overlay::Quad q;
    q.texture = H5_INT(0);
    q.x = static_cast<float>(H5_NUM(1));
    q.y = static_cast<float>(H5_NUM(2));
    q.w = static_cast<float>(H5_NUM(3));
    q.h = static_cast<float>(H5_NUM(4));
    q.r = static_cast<float>(H5_NUM(5));
    q.g = static_cast<float>(H5_NUM(6));
    q.b = static_cast<float>(H5_NUM(7));
    q.a = static_cast<float>(H5_NUM(8));
    if (argc > 12) {   // (sx, sy, sw, sh): a part of the texture
        q.sx = static_cast<float>(H5_NUM(9));
        q.sy = static_cast<float>(H5_NUM(10));
        q.sw = static_cast<float>(H5_NUM(11));
        q.sh = static_cast<float>(H5_NUM(12));
    }
    if (q.w > 0 && q.h > 0 && q.a > 0)
        overlay::g_quads.push_back(q);
    return H5_UNDEFINED;
}

H5_NATIVE(n_present_rect)
{
    const int sw = platform::screen_width(), sh = platform::screen_height();
    int dx = 0, dy = 0, dw = sw, dh = sh;
    auto it = g_canvases.find(g_main);
    if (it != g_canvases.end())
        fit(it->second.width, it->second.height, sw, sh, dx, dy, dw, dh);
    JSValueRef v[6] = { JSValueMakeNumber(ctx, sw), JSValueMakeNumber(ctx, sh), JSValueMakeNumber(ctx, dx),
        JSValueMakeNumber(ctx, dy), JSValueMakeNumber(ctx, dw), JSValueMakeNumber(ctx, dh) };
    return JSObjectMakeArray(ctx, 6, v, nullptr);
}

void install(JSContextRef ctx, JSObjectRef h5)
{
    JSObjectRef gl = JSObjectMake(ctx, nullptr, nullptr);
    js::set(ctx, h5, "gl", gl, false);
    js::set(ctx, gl, "available", JSValueMakeBoolean(ctx, platform::has_gl()));
    if (!platform::has_gl())
        return;
    struct { const char *name; JSObjectCallAsFunctionCallback fn; } table[] = {
        { "canvasCreate", n_canvas_create }, { "canvasResize", n_canvas_resize }, { "canvasDelete", n_canvas_delete },
        { "canvasUse", n_canvas_use }, { "canvasSetMain", n_canvas_set_main }, { "info", n_info },
        { "activeTexture", n_active_texture }, { "attachShader", n_attach_shader }, { "bindAttribLocation", n_bind_attrib_location },
        { "bindBuffer", n_bind_buffer }, { "bindFramebuffer", n_bind_framebuffer }, { "bindRenderbuffer", n_bind_renderbuffer },
        { "bindTexture", n_bind_texture }, { "bindVertexArray", n_bind_vertex_array }, { "blendColor", n_blend_color },
        { "blendEquation", n_blend_equation }, { "blendEquationSeparate", n_blend_equation_separate }, { "blendFunc", n_blend_func },
        { "blendFuncSeparate", n_blend_func_separate }, { "bufferData", n_buffer_data }, { "bufferSubData", n_buffer_sub_data },
        { "checkFramebufferStatus", n_check_framebuffer_status }, { "clear", n_clear }, { "clearColor", n_clear_color },
        { "clearDepth", n_clear_depth }, { "clearStencil", n_clear_stencil }, { "colorMask", n_color_mask },
        { "compileShader", n_compile_shader }, { "compressedTexImage2D", n_compressed_tex_image_2d },
        { "compressedTexSubImage2D", n_compressed_tex_sub_image_2d }, { "copyTexImage2D", n_copy_tex_image_2d },
        { "copyTexSubImage2D", n_copy_tex_sub_image_2d }, { "createBuffer", n_create_buffer }, { "createFramebuffer", n_create_framebuffer },
        { "createProgram", n_create_program }, { "createRenderbuffer", n_create_renderbuffer }, { "createShader", n_create_shader },
        { "createTexture", n_create_texture }, { "createVertexArray", n_create_vertex_array }, { "cullFace", n_cull_face },
        { "deleteBuffer", n_delete_buffer }, { "deleteFramebuffer", n_delete_framebuffer }, { "deleteProgram", n_delete_program },
        { "deleteRenderbuffer", n_delete_renderbuffer }, { "deleteShader", n_delete_shader }, { "deleteTexture", n_delete_texture },
        { "deleteVertexArray", n_delete_vertex_array }, { "depthFunc", n_depth_func }, { "depthMask", n_depth_mask },
        { "depthRange", n_depth_range }, { "detachShader", n_detach_shader }, { "disable", n_disable },
        { "disableVertexAttribArray", n_disable_vertex_attrib_array }, { "drawArrays", n_draw_arrays },
        { "drawElements", n_draw_elements }, { "drawArraysInstanced", n_draw_arrays_instanced },
        { "drawElementsInstanced", n_draw_elements_instanced }, { "drawBuffers", n_draw_buffers }, { "enable", n_enable },
        { "enableVertexAttribArray", n_enable_vertex_attrib_array }, { "finish", n_finish }, { "flush", n_flush },
        { "framebufferRenderbuffer", n_framebuffer_renderbuffer }, { "framebufferTexture2D", n_framebuffer_texture_2d },
        { "frontFace", n_front_face }, { "generateMipmap", n_generate_mipmap }, { "getActiveAttrib", n_get_active_attrib },
        { "getActiveUniform", n_get_active_uniform }, { "getAttribLocation", n_get_attrib_location },
        { "getBufferParameter", n_get_buffer_parameter }, { "getError", n_get_error },
        { "getFramebufferAttachmentParameter", n_get_framebuffer_attachment_parameter }, { "getParameter", n_get_parameter },
        { "getProgramInfoLog", n_get_program_info_log }, { "getProgramParameter", n_get_program_parameter },
        { "getRenderbufferParameter", n_get_renderbuffer_parameter }, { "getShaderInfoLog", n_get_shader_info_log },
        { "getShaderParameter", n_get_shader_parameter }, { "getShaderPrecisionFormat", n_get_shader_precision_format },
        { "getTexParameter", n_get_tex_parameter }, { "getUniform", n_get_uniform }, { "getUniformLocation", n_get_uniform_location },
        { "getVertexAttrib", n_get_vertex_attrib }, { "hint", n_hint }, { "isEnabled", n_is_enabled }, { "lineWidth", n_line_width },
        { "linkProgram", n_link_program }, { "pixelStorei", n_pixel_storei }, { "polygonOffset", n_polygon_offset },
        { "readPixels", n_read_pixels }, { "renderbufferStorage", n_renderbuffer_storage }, { "sampleCoverage", n_sample_coverage },
        { "scissor", n_scissor }, { "shaderSource", n_shader_source }, { "stencilFunc", n_stencil_func },
        { "stencilFuncSeparate", n_stencil_func_separate }, { "stencilMask", n_stencil_mask },
        { "stencilMaskSeparate", n_stencil_mask_separate }, { "stencilOp", n_stencil_op }, { "stencilOpSeparate", n_stencil_op_separate },
        { "texImage2D", n_tex_image_2d }, { "texSubImage2D", n_tex_sub_image_2d }, { "texImageSource", n_tex_image_source },
        { "texSubImageSource", n_tex_sub_image_source }, { "texParameterf", n_tex_parameterf }, { "texParameteri", n_tex_parameteri },
        { "uniform1f", n_uniform1f }, { "uniform2f", n_uniform2f }, { "uniform3f", n_uniform3f }, { "uniform4f", n_uniform4f },
        { "uniform1i", n_uniform1i }, { "uniform2i", n_uniform2i }, { "uniform3i", n_uniform3i }, { "uniform4i", n_uniform4i },
        { "uniform1fv", n_uniform1fv }, { "uniform2fv", n_uniform2fv }, { "uniform3fv", n_uniform3fv }, { "uniform4fv", n_uniform4fv },
        { "uniform1iv", n_uniform1iv }, { "uniform2iv", n_uniform2iv }, { "uniform3iv", n_uniform3iv }, { "uniform4iv", n_uniform4iv },
        { "uniformMatrix2fv", n_uniform_matrix2fv }, { "uniformMatrix3fv", n_uniform_matrix3fv },
        { "uniformMatrix4fv", n_uniform_matrix4fv }, { "useProgram", n_use_program }, { "validateProgram", n_validate_program },
        { "vertexAttrib1f", n_vertex_attrib1f }, { "vertexAttrib2f", n_vertex_attrib2f }, { "vertexAttrib3f", n_vertex_attrib3f },
        { "vertexAttrib4f", n_vertex_attrib4f }, { "vertexAttribDivisor", n_vertex_attrib_divisor },
        { "vertexAttribPointer", n_vertex_attrib_pointer }, { "viewport", n_viewport },
        { "overlayTexture", n_overlay_texture }, { "overlayDeleteTexture", n_overlay_delete_texture },
        { "overlayBegin", n_overlay_begin }, { "overlayDraw", n_overlay_draw }, { "presentRect", n_present_rect },
    };
    for (const auto &t : table)
        js::def(ctx, gl, t.name, t.fn);
}

struct Registration {
    Registration() { engine::register_natives("gl", install); }
} g_registration;

} // namespace

// the bound draw framebuffer to opaque black, the page's clear state kept
static void clear_black()
{
    GLfloat clear[4];
    glGetFloatv(GL_COLOR_CLEAR_VALUE, clear);
    GLboolean mask[4];
    glGetBooleanv(GL_COLOR_WRITEMASK, mask);
    glColorMask(1, 1, 1, 1);
    glClearColor(0, 0, 0, 1);
    glClear(GL_COLOR_BUFFER_BIT);
    glClearColor(clear[0], clear[1], clear[2], clear[3]);
    glColorMask(mask[0], mask[1], mask[2], mask[3]);
}

void present_main_canvas()
{
    auto it = g_canvases.find(g_main);
    const Canvas *c = it == g_canvases.end() ? nullptr : &it->second;
    if (!c && overlay::g_quads.empty())
        return;
    GLint read_fb = 0, draw_fb = 0;
    glGetIntegerv(GL_READ_FRAMEBUFFER_BINDING, &read_fb);
    glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &draw_fb);
    const GLboolean scissor = glIsEnabled(GL_SCISSOR_TEST);
    const GLboolean discard = glIsEnabled(GL_RASTERIZER_DISCARD);
    glDisable(GL_SCISSOR_TEST);
    glDisable(GL_RASTERIZER_DISCARD);
    glBindFramebuffer(GL_DRAW_FRAMEBUFFER, platform::screen_framebuffer());
    const int sw = platform::screen_width(), sh = platform::screen_height();
    if (c) {
        glBindFramebuffer(GL_READ_FRAMEBUFFER, c->fbo);
        // keep the canvas's shape: the largest rectangle of its aspect that fits, centred
        int dx, dy, dw, dh;
        fit(c->width, c->height, sw, sh, dx, dy, dw, dh);
        if (dw != sw || dh != sh)
            clear_black();
        glBlitFramebuffer(0, 0, c->width, c->height, dx, dy, dx + dw, dy + dh, GL_COLOR_BUFFER_BIT,
            (dw == c->width && dh == c->height) ? GL_NEAREST : GL_LINEAR);
    } else {
        clear_black();   // (no page canvas yet: only the overlay)
    }
    overlay::draw(sw, sh);
    glBindFramebuffer(GL_READ_FRAMEBUFFER, static_cast<GLuint>(read_fb));
    glBindFramebuffer(GL_DRAW_FRAMEBUFFER, static_cast<GLuint>(draw_fb));
    if (scissor)
        glEnable(GL_SCISSOR_TEST);
    if (discard)
        glEnable(GL_RASTERIZER_DISCARD);
    g_drawn_since_present = false;
}

bool canvas_drawn_since_present()
{
    return g_drawn_since_present;
}

void release_all()
{
    if (!platform::has_gl())
        return;
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glUseProgram(0);
    glBindVertexArray(0);
    for (GLuint n : g_buffers) glDeleteBuffers(1, &n);
    for (GLuint n : g_textures) glDeleteTextures(1, &n);
    for (GLuint n : g_framebuffers) glDeleteFramebuffers(1, &n);
    for (GLuint n : g_renderbuffers) glDeleteRenderbuffers(1, &n);
    for (GLuint n : g_vertex_arrays) glDeleteVertexArrays(1, &n);
    for (GLuint n : g_programs) glDeleteProgram(n);
    for (GLuint n : g_shaders) glDeleteShader(n);
    g_buffers.clear();
    g_textures.clear();
    g_framebuffers.clear();
    g_renderbuffers.clear();
    g_vertex_arrays.clear();
    g_programs.clear();
    g_shaders.clear();
    for (auto &[id, c] : g_canvases) {
        glDeleteFramebuffers(1, &c.fbo);
        glDeleteRenderbuffers(1, &c.color);
        if (c.depth_stencil)
            glDeleteRenderbuffers(1, &c.depth_stencil);
    }
    g_canvases.clear();
    overlay::release();   // (the runtime's own program stays: it is not the page's)
    g_current = g_main = 0;
    g_default_bound = true;
    g_unpack_flip = g_unpack_premultiply = false;
    g_unpack_alignment = 4;
    glPixelStorei(GL_UNPACK_ALIGNMENT, 4);
    // WebGL's state defaults, as a fresh context has them
    glDisable(GL_BLEND);
    glDisable(GL_CULL_FACE);
    glDisable(GL_DEPTH_TEST);
    glDisable(GL_SCISSOR_TEST);
    glDisable(GL_STENCIL_TEST);
    glColorMask(1, 1, 1, 1);
    glDepthMask(1);
    glStencilMask(0xffffffff);
}

} // namespace h5::gl
