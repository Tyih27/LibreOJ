cmake_minimum_required(VERSION 3.15)
project(libreoj-judge)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_FLAGS "-Wall -std=c++17")
set(CMAKE_CXX_FLAGS_DEBUG "-g")
set(CMAKE_CXX_FLAGS_RELEASE "-O2")

include_directories(${CMAKE_JS_INC})

# Builtin Checkers
add_library(
    builtin_checkers
    SHARED
    ${CMAKE_JS_SRC}
    "native/builtin_checkers/builtin_checkers.cc"
    "native/builtin_checkers/integers.h"
    "native/builtin_checkers/floats.h"
    "native/builtin_checkers/lines.h"
    "native/builtin_checkers/binary.h"
    "native/builtin_checkers/checkers/acmp.h"
    "native/builtin_checkers/checkers/bcmp.h"
    "native/builtin_checkers/checkers/caseicmp.h"
    "native/builtin_checkers/checkers/casencmp.h"
    "native/builtin_checkers/checkers/casewcmp.h"
    "native/builtin_checkers/checkers/dcmp.h"
    "native/builtin_checkers/checkers/fcmp.h"
    "native/builtin_checkers/checkers/hcmp.h"
    "native/builtin_checkers/checkers/icmp.h"
    "native/builtin_checkers/checkers/lcmp.h"
    "native/builtin_checkers/checkers/ncmp.h"
    "native/builtin_checkers/checkers/rcmp.h"
    "native/builtin_checkers/checkers/rcmp4.h"
    "native/builtin_checkers/checkers/rcmp6.h"
    "native/builtin_checkers/checkers/rcmp9.h"
    "native/builtin_checkers/checkers/rncmp.h"
    "native/builtin_checkers/checkers/uncmp.h"
    "native/builtin_checkers/checkers/wcmp.h"
    "native/builtin_checkers/checkers/yesno.h"
)
set_target_properties(builtin_checkers PROPERTIES PREFIX "" SUFFIX ".node")
target_include_directories(builtin_checkers PRIVATE 
    ${CMAKE_SOURCE_DIR}/node_modules/node-addon-api 
    ${CMAKE_SOURCE_DIR}/node_modules/node-addon-api/src
    ${CMAKE_JS_INC}
    "vendor/testlib"
)
target_link_libraries(builtin_checkers PRIVATE ${CMAKE_JS_LIB})

# POSIX
add_library(
    posix
    SHARED
    ${CMAKE_JS_SRC}
    "native/posix/posix.cc"
)
set_target_properties(posix PROPERTIES PREFIX "" SUFFIX ".node")
target_include_directories(posix PRIVATE 
    ${CMAKE_SOURCE_DIR}/node_modules/node-addon-api 
    ${CMAKE_SOURCE_DIR}/node_modules/node-addon-api/src
    ${CMAKE_JS_INC}
)
target_link_libraries(posix PRIVATE ${CMAKE_JS_LIB})

# fs_native
add_library(
    fs_native
    SHARED
    ${CMAKE_JS_SRC}
    "native/fs_native/fs_native.cc"
)
set_target_properties(fs_native PROPERTIES PREFIX "" SUFFIX ".node")
target_include_directories(fs_native PRIVATE 
    ${CMAKE_SOURCE_DIR}/node_modules/node-addon-api 
    ${CMAKE_SOURCE_DIR}/node_modules/node-addon-api/src
    ${CMAKE_JS_INC}
)
target_link_libraries(fs_native PRIVATE ${CMAKE_JS_LIB} stdc++fs)
