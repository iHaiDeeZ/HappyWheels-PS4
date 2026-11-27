# h5 runtime. PC test build (default) or the PS4 eboot (-DH5_PS4=ON with the ps4-kit toolchain).
cmake_minimum_required(VERSION 3.20)
project(h5 C CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(H5_PS4 "Build the PS4 eboot" OFF)
set(HB "$ENV{HB}" CACHE PATH "the build tree (~/hw-build)")
set(WISP_BUILD "$ENV{WISP_BUILD}" CACHE PATH "OrbisWeb's build tree (~/wisp-build)")

set(H5_SOURCES
    src/audio.cpp
    src/base.cpp
    src/engine.cpp
    src/gl.cpp
    src/image.cpp
    src/input.cpp
    src/js.cpp
    src/main.cpp
    src/net.cpp
)
set(H5_INCLUDES
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party/jsc-api
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party/stb
    ${WISP_BUILD}/src/mesa/include        # EGL / GLES / KHR headers
)

if (H5_PS4)
    # --- the PS4 eboot -------------------------------------------------------------------------------
    set(MESA_BUILD ${HB}/build/mesa)
    set(MESA_SRC ${HB}/src/mesa)
    set(PS4_MESA_BUILD ${MESA_BUILD} CACHE PATH "Mesa with ps4gl (scripts/build-mesa.sh)")
    set(PS4_MESA_SRC ${MESA_SRC} CACHE PATH "its source")
    include($ENV{HOME}/ps4-kit/ps4-kit.cmake)
    set(WSYS ${WISP_BUILD}/sysroot)
    set(SKIA_SRC ${HB}/src/WebKit/Source/ThirdParty/skia)
    set(VORBIS ${HB}/build/vorbis-host)   # libogg / libvorbis sources (scripts/build-host-deps.sh vorbis)

    # libogg + libvorbis (+ vorbisfile), compiled here for the PS4
    file(GLOB VORBIS_SOURCES ${VORBIS}/libvorbis-1.3.7/lib/*.c)
    list(FILTER VORBIS_SOURCES EXCLUDE REGEX "(psytune|tone|barkmel|misc)\\.c$")
    add_library(h5vorbis STATIC ${VORBIS}/libogg-1.3.6/src/bitwise.c ${VORBIS}/libogg-1.3.6/src/framing.c ${VORBIS_SOURCES})
    target_include_directories(h5vorbis PUBLIC ${VORBIS}/libogg-1.3.6/include ${VORBIS}/libvorbis-1.3.7/include
        PRIVATE ${VORBIS}/libvorbis-1.3.7/lib)
    target_compile_options(h5vorbis PRIVATE -O2 -w -U__FreeBSD__)

    add_executable(h5 ${H5_SOURCES} src/platform_ps4.cpp src/canvas2d_skia.cpp ${PS4_KIT_DIR}/gpu/ps4_vk_wsi.cpp)
    target_include_directories(h5 PRIVATE ${H5_INCLUDES} ${PS4_KIT_DIR}/runtime ${PS4_KIT_DIR}/gpu ${MESA_SRC}/include
        ${MESA_SRC}/src/gallium/frontends/ps4)
    target_include_directories(h5 SYSTEM PRIVATE ${WSYS}/include ${PS4_SYSROOT}/include)
    target_compile_definitions(h5 PRIVATE GL_GLES_PROTOTYPES=0 H5_HAVE_VORBIS)
    target_compile_options(h5 PRIVATE $<$<COMPILE_LANGUAGE:CXX>:-std=c++20> -O2)
    # Skia's headers with the flags OrbisWeb's libSkia.a was built with (they shape its classes)
    set_source_files_properties(src/canvas2d_skia.cpp PROPERTIES
        INCLUDE_DIRECTORIES "${SKIA_SRC}"
        COMPILE_OPTIONS "-std=c++23;-fno-rtti;-fno-exceptions;-mprefer-vector-width=128;-Wno-deprecated-declarations"
        COMPILE_DEFINITIONS "SK_ASSUME_GL=0;SK_ASSUME_GL_ES=1;SK_ASSUME_WEBGL=0;SK_CODEC_DECODES_PNG;SK_DISABLE_LEGACY_GL_MAKE_NATIVE_INTERFACE;SK_DISABLE_LEGACY_IMAGE_READBUFFER;SK_DISABLE_LEGACY_INIT_DECODERS;SK_DISABLE_LEGACY_PNG_WRITEBUFFER;SK_DISABLE_LEGACY_SKSHAPER_FUNCTIONS;SK_DISABLE_TRACING;SK_DISABLE_WEBGL_INTERFACE;SK_ENABLE_PRECOMPILE;SK_ENABLE_SVG;SK_GAMMA_APPLY_TO_A8;SK_GANESH;SK_GL;SK_R32_SHIFT=16;SK_RELEASE;SK_SHAPER_HARFBUZZ_AVAILABLE;SK_SHAPER_PRIMITIVE_AVAILABLE;SK_TRIVIAL_ABI=[[clang::trivial_abi]];SK_TYPEFACE_FACTORY_FREETYPE;SK_USER_CONFIG_HEADER=\"./WebKitSkiaConfig.h\";_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_EXTENSIVE")

    # Mesa: OpenGL ES on Zink through ps4gl, and RADV, as OrbisWeb's GPU web process links them (whole
    # archives: the GL dispatch reaches entry points through weak symbols; libvulkan_util and the lite
    # runtime plain, as libzink.a carries some of their objects)
    set(MESA_WHOLE src/gallium/frontends/ps4/libps4gl.a src/gallium/drivers/zink/libzink.a src/gallium/auxiliary/libgallium.a
        src/mesa/libmesa.a src/mesa/libmesa_sse41.a src/mesa/glapi/glapi/libglapi_bridge.a src/mesa/glapi/shared-glapi/libglapi.a
        src/compiler/glsl/libglsl.a src/compiler/glsl/glcpp/libglcpp.a
        src/amd/vulkan/libvulkan_radeon.a src/amd/common/libamd_common.a src/amd/compiler/libaco.a src/amd/addrlib/libaddrlib.a
        src/compiler/spirv/libvtn.a src/compiler/nir/libnir.a src/compiler/libcompiler.a src/util/libxmlconfig.a
        src/util/libmesa_util.a src/util/libmesa_util_simd.a src/util/libmesa_util_clflush.a src/util/libmesa_util_clflushopt.a
        src/util/libparson.a src/util/blake3/libblake3.a src/c11/impl/libmesa_util_c11.a)
    list(TRANSFORM MESA_WHOLE PREPEND "${MESA_BUILD}/")
    target_link_libraries(h5 PRIVATE --whole-archive ${MESA_WHOLE} --no-whole-archive
        ${MESA_BUILD}/src/vulkan/util/libvulkan_util.a ${MESA_BUILD}/src/vulkan/runtime/libvulkan_lite_runtime.a)

    # JavaScriptCore (scripts/pack-jsc.sh), Skia, and what they need, by full path (the toolchain's -L to
    # PacBrew's usr/lib comes first and has older copies of some)
    set(_deps)
    foreach (lib glib-2.0 gio-2.0 gobject-2.0 gmodule-2.0 ffi pcre2-8 icui18n icuuc icudata freetype harfbuzz expat jpeg brotlidec brotlicommon bz2)
        if (EXISTS ${WSYS}/lib/lib${lib}.a)
            list(APPEND _deps ${WSYS}/lib/lib${lib}.a)
        elseif (EXISTS ${PS4_SYSROOT}/lib/lib${lib}.a)
            list(APPEND _deps ${PS4_SYSROOT}/lib/lib${lib}.a)
        endif ()
    endforeach ()
    target_link_libraries(h5 PRIVATE ${HB}/ps4/lib/libh5jsc.a ${WISP_BUILD}/build/webkit-jit/lib/libSkia.a h5vorbis ${_deps}
        ${PS4_SYSROOT}/lib/libpng16.a ${PS4_SYSROOT}/lib/libcurl.a ${PS4_SYSROOT}/lib/libssl.a
        ${PS4_SYSROOT}/lib/libcrypto.a ${PS4_SYSROOT}/lib/libz.a
        -lSceVideoOut -lSceSystemService -lScePad -lSceUserService -lSceAudioOut -lSceImeDialog -lSceCommonDialog -lSceSysmodule)
    target_link_options(h5 PRIVATE --gc-sections)
    ps4_kit_app(h5)
elseif (NOT H5_PS4)
    set(JSC "${HB}/build/jsc-host/lib")
    set(HOST "${HB}/host")
    add_executable(h5-host ${H5_SOURCES} src/platform_host.cpp src/canvas2d_soft.cpp)
    # (curl: the PS4 kit's headers, third_party/curl; the system's libcurl.so.4)
    target_include_directories(h5-host PRIVATE ${H5_INCLUDES} ${HOST}/include ${CMAKE_CURRENT_SOURCE_DIR}/third_party/curl)
    target_compile_definitions(h5-host PRIVATE GL_GLES_PROTOTYPES=0 EGL_NO_X11 H5_HAVE_VORBIS)
    target_compile_options(h5-host PRIVATE -O2 -g -Wall -Wno-unused-function -fno-strict-aliasing)
    target_link_libraries(h5-host PRIVATE
        -Wl,--start-group
        ${JSC}/libJavaScriptCore.a ${JSC}/libJavaScriptCoreJIT.a ${JSC}/libWTF.a ${JSC}/libbmalloc.a
        -Wl,--end-group
        ${HOST}/lib/libvorbisfile.a ${HOST}/lib/libvorbis.a ${HOST}/lib/libogg.a
        ${HOST}/lib/libicui18n.a ${HOST}/lib/libicuuc.a ${HOST}/lib/libicudata.a
        /usr/lib/x86_64-linux-gnu/libEGL.so.1 /usr/lib/x86_64-linux-gnu/libcurl.so.4
        dl pthread atomic m)
endif ()
