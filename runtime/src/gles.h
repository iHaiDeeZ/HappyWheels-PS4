// h5: the OpenGL ES 3 functions the runtime calls, loaded by name at start (platform::gl_proc), so the
// same code runs on Zink's dispatch (PS4) and on a desktop EGL (PC test build).
#pragma once

#include <GLES3/gl3.h>
#include <GLES2/gl2ext.h>

// X(return type, name, (parameters), (arguments))
#define H5_GL_FUNCTIONS(X)                                                                                        \
    X(void, glActiveTexture, (GLenum t), (t))                                                                     \
    X(void, glAttachShader, (GLuint p, GLuint s), (p, s))                                                         \
    X(void, glBindAttribLocation, (GLuint p, GLuint i, const GLchar *n), (p, i, n))                               \
    X(void, glBindBuffer, (GLenum t, GLuint b), (t, b))                                                           \
    X(void, glBindFramebuffer, (GLenum t, GLuint f), (t, f))                                                      \
    X(void, glBindRenderbuffer, (GLenum t, GLuint r), (t, r))                                                     \
    X(void, glBindTexture, (GLenum t, GLuint x), (t, x))                                                          \
    X(void, glBindVertexArray, (GLuint a), (a))                                                                   \
    X(void, glBlendColor, (GLfloat r, GLfloat g, GLfloat b, GLfloat a), (r, g, b, a))                             \
    X(void, glBlendEquation, (GLenum m), (m))                                                                     \
    X(void, glBlendEquationSeparate, (GLenum c, GLenum a), (c, a))                                                \
    X(void, glBlendFunc, (GLenum s, GLenum d), (s, d))                                                            \
    X(void, glBlendFuncSeparate, (GLenum sc, GLenum dc, GLenum sa, GLenum da), (sc, dc, sa, da))                  \
    X(void, glBlitFramebuffer, (GLint a, GLint b, GLint c, GLint d, GLint e, GLint f, GLint g, GLint h, GLbitfield m, GLenum fl), (a, b, c, d, e, f, g, h, m, fl)) \
    X(void, glBufferData, (GLenum t, GLsizeiptr s, const void *d, GLenum u), (t, s, d, u))                        \
    X(void, glBufferSubData, (GLenum t, GLintptr o, GLsizeiptr s, const void *d), (t, o, s, d))                   \
    X(GLenum, glCheckFramebufferStatus, (GLenum t), (t))                                                          \
    X(void, glClear, (GLbitfield m), (m))                                                                         \
    X(void, glClearColor, (GLfloat r, GLfloat g, GLfloat b, GLfloat a), (r, g, b, a))                             \
    X(void, glClearDepthf, (GLfloat d), (d))                                                                      \
    X(void, glClearStencil, (GLint s), (s))                                                                       \
    X(void, glColorMask, (GLboolean r, GLboolean g, GLboolean b, GLboolean a), (r, g, b, a))                      \
    X(void, glCompileShader, (GLuint s), (s))                                                                     \
    X(void, glCompressedTexImage2D, (GLenum t, GLint l, GLenum f, GLsizei w, GLsizei h, GLint b, GLsizei s, const void *d), (t, l, f, w, h, b, s, d)) \
    X(void, glCompressedTexSubImage2D, (GLenum t, GLint l, GLint x, GLint y, GLsizei w, GLsizei h, GLenum f, GLsizei s, const void *d), (t, l, x, y, w, h, f, s, d)) \
    X(void, glCopyTexImage2D, (GLenum t, GLint l, GLenum f, GLint x, GLint y, GLsizei w, GLsizei h, GLint b), (t, l, f, x, y, w, h, b)) \
    X(void, glCopyTexSubImage2D, (GLenum t, GLint l, GLint xo, GLint yo, GLint x, GLint y, GLsizei w, GLsizei h), (t, l, xo, yo, x, y, w, h)) \
    X(GLuint, glCreateProgram, (void), ())                                                                        \
    X(GLuint, glCreateShader, (GLenum t), (t))                                                                    \
    X(void, glCullFace, (GLenum m), (m))                                                                          \
    X(void, glDeleteBuffers, (GLsizei n, const GLuint *b), (n, b))                                                \
    X(void, glDeleteFramebuffers, (GLsizei n, const GLuint *f), (n, f))                                           \
    X(void, glDeleteProgram, (GLuint p), (p))                                                                     \
    X(void, glDeleteRenderbuffers, (GLsizei n, const GLuint *r), (n, r))                                          \
    X(void, glDeleteShader, (GLuint s), (s))                                                                      \
    X(void, glDeleteTextures, (GLsizei n, const GLuint *t), (n, t))                                               \
    X(void, glDeleteVertexArrays, (GLsizei n, const GLuint *a), (n, a))                                           \
    X(void, glDepthFunc, (GLenum f), (f))                                                                         \
    X(void, glDepthMask, (GLboolean f), (f))                                                                      \
    X(void, glDepthRangef, (GLfloat n, GLfloat f), (n, f))                                                        \
    X(void, glDetachShader, (GLuint p, GLuint s), (p, s))                                                         \
    X(void, glDisable, (GLenum c), (c))                                                                           \
    X(void, glDisableVertexAttribArray, (GLuint i), (i))                                                          \
    X(void, glDrawArrays, (GLenum m, GLint f, GLsizei c), (m, f, c))                                              \
    X(void, glDrawArraysInstanced, (GLenum m, GLint f, GLsizei c, GLsizei n), (m, f, c, n))                       \
    X(void, glDrawBuffers, (GLsizei n, const GLenum *b), (n, b))                                                  \
    X(void, glDrawElements, (GLenum m, GLsizei c, GLenum t, const void *i), (m, c, t, i))                         \
    X(void, glDrawElementsInstanced, (GLenum m, GLsizei c, GLenum t, const void *i, GLsizei n), (m, c, t, i, n))  \
    X(void, glEnable, (GLenum c), (c))                                                                            \
    X(void, glEnableVertexAttribArray, (GLuint i), (i))                                                           \
    X(void, glFinish, (void), ())                                                                                 \
    X(void, glFlush, (void), ())                                                                                  \
    X(void, glFramebufferRenderbuffer, (GLenum t, GLenum a, GLenum rt, GLuint r), (t, a, rt, r))                  \
    X(void, glFramebufferTexture2D, (GLenum t, GLenum a, GLenum tt, GLuint x, GLint l), (t, a, tt, x, l))         \
    X(void, glFrontFace, (GLenum m), (m))                                                                         \
    X(void, glGenBuffers, (GLsizei n, GLuint *b), (n, b))                                                         \
    X(void, glGenFramebuffers, (GLsizei n, GLuint *f), (n, f))                                                    \
    X(void, glGenRenderbuffers, (GLsizei n, GLuint *r), (n, r))                                                   \
    X(void, glGenTextures, (GLsizei n, GLuint *t), (n, t))                                                        \
    X(void, glGenVertexArrays, (GLsizei n, GLuint *a), (n, a))                                                    \
    X(void, glGenerateMipmap, (GLenum t), (t))                                                                    \
    X(void, glGetActiveAttrib, (GLuint p, GLuint i, GLsizei b, GLsizei *l, GLint *s, GLenum *t, GLchar *n), (p, i, b, l, s, t, n)) \
    X(void, glGetActiveUniform, (GLuint p, GLuint i, GLsizei b, GLsizei *l, GLint *s, GLenum *t, GLchar *n), (p, i, b, l, s, t, n)) \
    X(GLint, glGetAttribLocation, (GLuint p, const GLchar *n), (p, n))                                            \
    X(void, glGetBooleanv, (GLenum p, GLboolean *d), (p, d))                                                      \
    X(void, glGetBufferParameteriv, (GLenum t, GLenum p, GLint *d), (t, p, d))                                    \
    X(GLenum, glGetError, (void), ())                                                                             \
    X(void, glGetFloatv, (GLenum p, GLfloat *d), (p, d))                                                          \
    X(void, glGetFramebufferAttachmentParameteriv, (GLenum t, GLenum a, GLenum p, GLint *d), (t, a, p, d))        \
    X(void, glGetIntegerv, (GLenum p, GLint *d), (p, d))                                                          \
    X(void, glGetProgramInfoLog, (GLuint p, GLsizei b, GLsizei *l, GLchar *s), (p, b, l, s))                      \
    X(void, glGetProgramiv, (GLuint p, GLenum n, GLint *d), (p, n, d))                                            \
    X(void, glGetRenderbufferParameteriv, (GLenum t, GLenum p, GLint *d), (t, p, d))                              \
    X(void, glGetShaderInfoLog, (GLuint s, GLsizei b, GLsizei *l, GLchar *i), (s, b, l, i))                       \
    X(void, glGetShaderPrecisionFormat, (GLenum s, GLenum p, GLint *r, GLint *q), (s, p, r, q))                   \
    X(void, glGetShaderiv, (GLuint s, GLenum p, GLint *d), (s, p, d))                                             \
    X(const GLubyte *, glGetString, (GLenum n), (n))                                                              \
    X(void, glGetTexParameteriv, (GLenum t, GLenum p, GLint *d), (t, p, d))                                       \
    X(void, glGetUniformfv, (GLuint p, GLint l, GLfloat *d), (p, l, d))                                           \
    X(void, glGetUniformiv, (GLuint p, GLint l, GLint *d), (p, l, d))                                             \
    X(GLint, glGetUniformLocation, (GLuint p, const GLchar *n), (p, n))                                           \
    X(void, glGetVertexAttribfv, (GLuint i, GLenum p, GLfloat *d), (i, p, d))                                     \
    X(void, glGetVertexAttribiv, (GLuint i, GLenum p, GLint *d), (i, p, d))                                       \
    X(void, glHint, (GLenum t, GLenum m), (t, m))                                                                 \
    X(GLboolean, glIsEnabled, (GLenum c), (c))                                                                    \
    X(void, glLineWidth, (GLfloat w), (w))                                                                        \
    X(void, glLinkProgram, (GLuint p), (p))                                                                       \
    X(void, glPixelStorei, (GLenum p, GLint v), (p, v))                                                           \
    X(void, glPolygonOffset, (GLfloat f, GLfloat u), (f, u))                                                      \
    X(void, glReadBuffer, (GLenum s), (s))                                                                        \
    X(void, glReadPixels, (GLint x, GLint y, GLsizei w, GLsizei h, GLenum f, GLenum t, void *d), (x, y, w, h, f, t, d)) \
    X(void, glRenderbufferStorage, (GLenum t, GLenum f, GLsizei w, GLsizei h), (t, f, w, h))                      \
    X(void, glRenderbufferStorageMultisample, (GLenum t, GLsizei s, GLenum f, GLsizei w, GLsizei h), (t, s, f, w, h)) \
    X(void, glSampleCoverage, (GLfloat v, GLboolean i), (v, i))                                                   \
    X(void, glScissor, (GLint x, GLint y, GLsizei w, GLsizei h), (x, y, w, h))                                    \
    X(void, glShaderSource, (GLuint s, GLsizei c, const GLchar *const *str, const GLint *l), (s, c, str, l))      \
    X(void, glStencilFunc, (GLenum f, GLint r, GLuint m), (f, r, m))                                              \
    X(void, glStencilFuncSeparate, (GLenum fa, GLenum f, GLint r, GLuint m), (fa, f, r, m))                       \
    X(void, glStencilMask, (GLuint m), (m))                                                                       \
    X(void, glStencilMaskSeparate, (GLenum f, GLuint m), (f, m))                                                  \
    X(void, glStencilOp, (GLenum a, GLenum b, GLenum c), (a, b, c))                                               \
    X(void, glStencilOpSeparate, (GLenum f, GLenum a, GLenum b, GLenum c), (f, a, b, c))                          \
    X(void, glTexImage2D, (GLenum t, GLint l, GLint i, GLsizei w, GLsizei h, GLint b, GLenum f, GLenum ty, const void *d), (t, l, i, w, h, b, f, ty, d)) \
    X(void, glTexParameterf, (GLenum t, GLenum p, GLfloat v), (t, p, v))                                          \
    X(void, glTexParameteri, (GLenum t, GLenum p, GLint v), (t, p, v))                                            \
    X(void, glTexSubImage2D, (GLenum t, GLint l, GLint x, GLint y, GLsizei w, GLsizei h, GLenum f, GLenum ty, const void *d), (t, l, x, y, w, h, f, ty, d)) \
    X(void, glUniform1f, (GLint l, GLfloat a), (l, a))                                                            \
    X(void, glUniform1fv, (GLint l, GLsizei c, const GLfloat *v), (l, c, v))                                      \
    X(void, glUniform1i, (GLint l, GLint a), (l, a))                                                              \
    X(void, glUniform1iv, (GLint l, GLsizei c, const GLint *v), (l, c, v))                                        \
    X(void, glUniform2f, (GLint l, GLfloat a, GLfloat b), (l, a, b))                                              \
    X(void, glUniform2fv, (GLint l, GLsizei c, const GLfloat *v), (l, c, v))                                      \
    X(void, glUniform2i, (GLint l, GLint a, GLint b), (l, a, b))                                                  \
    X(void, glUniform2iv, (GLint l, GLsizei c, const GLint *v), (l, c, v))                                        \
    X(void, glUniform3f, (GLint l, GLfloat a, GLfloat b, GLfloat c), (l, a, b, c))                                \
    X(void, glUniform3fv, (GLint l, GLsizei c, const GLfloat *v), (l, c, v))                                      \
    X(void, glUniform3i, (GLint l, GLint a, GLint b, GLint c), (l, a, b, c))                                      \
    X(void, glUniform3iv, (GLint l, GLsizei c, const GLint *v), (l, c, v))                                        \
    X(void, glUniform4f, (GLint l, GLfloat a, GLfloat b, GLfloat c, GLfloat d), (l, a, b, c, d))                  \
    X(void, glUniform4fv, (GLint l, GLsizei c, const GLfloat *v), (l, c, v))                                      \
    X(void, glUniform4i, (GLint l, GLint a, GLint b, GLint c, GLint d), (l, a, b, c, d))                          \
    X(void, glUniform4iv, (GLint l, GLsizei c, const GLint *v), (l, c, v))                                        \
    X(void, glUniformMatrix2fv, (GLint l, GLsizei c, GLboolean t, const GLfloat *v), (l, c, t, v))                \
    X(void, glUniformMatrix3fv, (GLint l, GLsizei c, GLboolean t, const GLfloat *v), (l, c, t, v))                \
    X(void, glUniformMatrix4fv, (GLint l, GLsizei c, GLboolean t, const GLfloat *v), (l, c, t, v))                \
    X(void, glUseProgram, (GLuint p), (p))                                                                        \
    X(void, glValidateProgram, (GLuint p), (p))                                                                   \
    X(void, glVertexAttrib1f, (GLuint i, GLfloat x), (i, x))                                                      \
    X(void, glVertexAttrib2f, (GLuint i, GLfloat x, GLfloat y), (i, x, y))                                        \
    X(void, glVertexAttrib3f, (GLuint i, GLfloat x, GLfloat y, GLfloat z), (i, x, y, z))                          \
    X(void, glVertexAttrib4f, (GLuint i, GLfloat x, GLfloat y, GLfloat z, GLfloat w), (i, x, y, z, w))            \
    X(void, glVertexAttribDivisor, (GLuint i, GLuint d), (i, d))                                                  \
    X(void, glVertexAttribPointer, (GLuint i, GLint s, GLenum t, GLboolean n, GLsizei st, const void *p), (i, s, t, n, st, p)) \
    X(void, glViewport, (GLint x, GLint y, GLsizei w, GLsizei h), (x, y, w, h))

namespace h5::gl {

#define H5_GL_DECLARE(ret, name, params, args) extern ret(*name) params;
H5_GL_FUNCTIONS(H5_GL_DECLARE)
#undef H5_GL_DECLARE

// loads every function; false (and the missing names logged) if one is absent
bool load();

// WebGL's canvases: each is an FBO standing in for the canvas's drawing buffer
void present_main_canvas();      // blits the page's main WebGL canvas to the screen
void release_all();              // deletes every GL object the page made (reload)
bool canvas_drawn_since_present();

} // namespace h5::gl
