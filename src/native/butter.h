/*
 * butter.h — Native extension header for Butter apps
 *
 * Drop one or more source files into src/native/ and Butter will compile them
 * to a shared library and generate TypeScript FFI bindings reachable via
 * `native("module")`. Four languages are supported; all four cross the C ABI.
 *
 * Layout                            Build path
 *   src/native/foo.c                clang/cc/cl.exe
 *   src/native/foo.mxy              moxy → C → clang/cc/cl.exe
 *   src/native/foo.rs               rustc --crate-type cdylib
 *   src/native/foo.zig              zig build-lib -dynamic
 *   src/native/foo/Cargo.toml       cargo build --release
 *                                   (Cargo.toml must set crate-type = ["cdylib"])
 *
 * Function discovery
 *   C       BUTTER_EXPORT(...) block (this macro)
 *   Moxy    // @butter-export above each function
 *   Rust    // @butter-export above each #[no_mangle] pub extern "C" fn
 *   Zig     // @butter-export above each export fn
 *
 * Example (C):
 *   #include "butter.h"
 *
 *   BUTTER_EXPORT(
 *     int fast_hash(const char *input, int len) {
 *       int hash = 0;
 *       for (int i = 0; i < len; i++) hash = hash * 31 + input[i];
 *       return hash;
 *     }
 *   )
 *
 * Example (Moxy):
 *   #include "butter.h"
 *
 *   BUTTER_EXPORT(
 *     int fast_hash(string input, int len) {
 *       int hash = 0;
 *       for i in 0..len { hash = hash * 31 + input[i]; }
 *       return hash;
 *     }
 *   )
 *
 * Example (Rust, single file — src/native/math.rs):
 *   // @butter-export
 *   #[no_mangle]
 *   pub extern "C" fn add(a: i32, b: i32) -> i32 {
 *     a + b
 *   }
 *
 *   // @butter-export
 *   #[no_mangle]
 *   pub extern "C" fn fast_hash(input: *const u8, len: i32) -> i32 {
 *     let mut hash: i32 = 0;
 *     unsafe {
 *       for i in 0..len { hash = hash.wrapping_mul(31).wrapping_add(*input.offset(i as isize) as i32); }
 *     }
 *     hash
 *   }
 *
 * Example (Rust, Cargo project — src/native/hash/{Cargo.toml, src/lib.rs}):
 *   # Cargo.toml
 *   [package]
 *   name = "hash"
 *   version = "0.1.0"
 *   edition = "2021"
 *
 *   [lib]
 *   crate-type = ["cdylib"]
 *
 *   // src/lib.rs
 *   // @butter-export
 *   #[no_mangle]
 *   pub extern "C" fn hash(input: *const u8, len: i32) -> i32 { ... }
 *
 * Example (Zig — src/native/fib.zig):
 *   // @butter-export
 *   export fn fib(n: i32) i32 {
 *     return if (n < 2) n else fib(n - 1) + fib(n - 2);
 *   }
 *
 *   // @butter-export
 *   export fn greet(name: [*:0]const u8) void {
 *     _ = name; // use as needed
 *   }
 */

#ifndef BUTTER_H
#define BUTTER_H

#ifdef _WIN32
  #define BUTTER_API __declspec(dllexport)
#else
  #define BUTTER_API __attribute__((visibility("default")))
#endif

/*
 * BUTTER_EXPORT wraps exported functions in C files.
 * For Moxy files, use // @butter-export before each function instead.
 *
 * C usage:
 *   BUTTER_EXPORT(
 *     int add(int a, int b) { return a + b; }
 *   )
 *
 * Moxy usage:
 *   // @butter-export
 *   int add(int a, int b) {
 *     return a + b;
 *   }
 */
#define BUTTER_EXPORT(...) __VA_ARGS__

#endif /* BUTTER_H */
