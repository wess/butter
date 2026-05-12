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
 *
 * Function discovery
 *   C       BUTTER_EXPORT(...) block (this macro)
 *   Moxy    // @butter-export above each function
 *   Rust    // @butter-export above each #[no_mangle] pub extern "C" fn
 *   Zig     // @butter-export above each export fn
 *
 * Per-module compile config (butter.yaml)
 *   native:
 *     <module-name>:
 *       frameworks: [AudioToolbox, CoreAudio]   # macOS only, -framework X
 *       includes:   [./vendor/foo/include]      # -I<dir>
 *       libDirs:    [./vendor/foo/build]        # -L<dir>
 *       libs:       [foo, bar]                  # -lfoo -lbar
 *       extraFlags: [-DFOO=1]
 *
 *   Module names are the source-file basename (without extension) or the
 *   cargo project directory name.
 *
 * Event emission (C → TS)
 *   To push asynchronous events from native back to TS (e.g. from an audio
 *   callback thread), call butter_emit() with an action name and an
 *   optional JSON-encoded data string. Events accumulate in a lock-free
 *   ring buffer and are drained by the generated bindings on a ~16ms
 *   cadence. From TS:
 *
 *     const audio = await native("audio")
 *     audio.on("speech-start", (data) => { ... })
 *     audio.on("amplitude",    (data) => { console.log(data.rms) })
 *
 *   Define BUTTER_IMPL in exactly ONE .c file in your module to compile in
 *   the ring buffer implementation:
 *
 *     #define BUTTER_IMPL
 *     #include "butter.h"
 *
 *     BUTTER_EXPORT(
 *       void tick(void) {
 *         butter_emit("tick", "{\"t\":12345}");
 *       }
 *     )
 *
 *   The ring buffer is bounded (256 entries x 64-byte action x 4096-byte
 *   data). Overflow drops the OLDEST event silently — this is the right
 *   tradeoff for real-time producers (audio threads can't block).
 */

#ifndef BUTTER_H
#define BUTTER_H

#include <stdint.h>

#ifdef _WIN32
  #define BUTTER_API __declspec(dllexport)
#else
  #define BUTTER_API __attribute__((visibility("default")))
#endif

/*
 * BUTTER_EXPORT wraps exported functions in C files.
 * For Moxy files, use // @butter-export before each function instead.
 */
#define BUTTER_EXPORT(...) __VA_ARGS__

/*
 * Event emission API. Callable from any thread.
 *
 *   butter_emit("action-name", "{\"key\":\"value\"}")
 *
 * `data` is treated as opaque UTF-8 bytes (JSON expected for structured
 * payload; pass "" or NULL if no data).
 */
BUTTER_API void butter_emit(const char *action, const char *data);

/*
 * Drain one queued event. Returns 1 if an event was written into the output
 * buffers, 0 if the ring is empty. The generated TS bindings call this
 * automatically; user code generally doesn't need to.
 *
 * out_action: char[BUTTER_EVENT_ACTION_MAX]
 * out_data:   char[BUTTER_EVENT_DATA_MAX]
 */
BUTTER_API int butter_drain_next(char *out_action, char *out_data);

#define BUTTER_EVENT_ACTION_MAX 64
#define BUTTER_EVENT_DATA_MAX 4096
#define BUTTER_EVENT_RING_SIZE 256

#ifdef BUTTER_IMPL

#include <string.h>
#include <stdatomic.h>

typedef struct {
    char action[BUTTER_EVENT_ACTION_MAX];
    char data[BUTTER_EVENT_DATA_MAX];
} butter_event_t;

static butter_event_t butter_event_ring[BUTTER_EVENT_RING_SIZE];
static _Atomic int butter_event_head = 0;
static _Atomic int butter_event_tail = 0;

BUTTER_API void butter_emit(const char *action, const char *data) {
    if (!action) return;
    int head = atomic_load_explicit(&butter_event_head, memory_order_relaxed);
    int next = (head + 1) % BUTTER_EVENT_RING_SIZE;
    int tail = atomic_load_explicit(&butter_event_tail, memory_order_acquire);
    if (next == tail) {
        /* Ring full — drop the OLDEST so producers (e.g. audio callbacks)
         * never block. Advance tail to make room. */
        atomic_store_explicit(&butter_event_tail,
            (tail + 1) % BUTTER_EVENT_RING_SIZE, memory_order_release);
    }
    butter_event_t *slot = &butter_event_ring[head];
    size_t alen = strlen(action);
    if (alen >= BUTTER_EVENT_ACTION_MAX) alen = BUTTER_EVENT_ACTION_MAX - 1;
    memcpy(slot->action, action, alen);
    slot->action[alen] = '\0';
    if (data) {
        size_t dlen = strlen(data);
        if (dlen >= BUTTER_EVENT_DATA_MAX) dlen = BUTTER_EVENT_DATA_MAX - 1;
        memcpy(slot->data, data, dlen);
        slot->data[dlen] = '\0';
    } else {
        slot->data[0] = '\0';
    }
    atomic_store_explicit(&butter_event_head, next, memory_order_release);
}

BUTTER_API int butter_drain_next(char *out_action, char *out_data) {
    int tail = atomic_load_explicit(&butter_event_tail, memory_order_relaxed);
    int head = atomic_load_explicit(&butter_event_head, memory_order_acquire);
    if (tail == head) return 0;
    butter_event_t *slot = &butter_event_ring[tail];
    if (out_action) {
        memcpy(out_action, slot->action, BUTTER_EVENT_ACTION_MAX);
    }
    if (out_data) {
        memcpy(out_data, slot->data, BUTTER_EVENT_DATA_MAX);
    }
    atomic_store_explicit(&butter_event_tail,
        (tail + 1) % BUTTER_EVENT_RING_SIZE, memory_order_release);
    return 1;
}

#endif /* BUTTER_IMPL */

#endif /* BUTTER_H */
