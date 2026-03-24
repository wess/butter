/*
 * butter.h — Native extension header for Butter apps
 *
 * Use BUTTER_EXPORT(...) to mark functions for automatic FFI binding generation.
 * Functions inside this block are compiled into a shared library and made
 * available to your TypeScript host code via `native("module")`.
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
 *
 *     double multiply(double a, double b) {
 *       return a * b;
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
 *
 *     double multiply(double a, double b) {
 *       return a * b;
 *     }
 *   )
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
