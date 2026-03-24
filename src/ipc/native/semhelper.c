/*
 * Thin wrappers around variadic POSIX functions for ARM64 compatibility.
 * Bun FFI cannot call variadic C functions correctly on Apple Silicon
 * because variadic arguments use a different calling convention.
 *
 * Wraps: sem_open (variadic) and shm_open (variadic)
 */
#include <semaphore.h>
#include <fcntl.h>
#include <sys/mman.h>

sem_t* sem_open_create(const char *name, int oflag, unsigned int mode, unsigned int value) {
    return sem_open(name, oflag, mode, value);
}

sem_t* sem_open_existing(const char *name, int oflag) {
    return sem_open(name, oflag);
}

int shm_open_create(const char *name, int oflag, unsigned int mode) {
    return shm_open(name, oflag, mode);
}

int shm_open_existing(const char *name, int oflag) {
    return shm_open(name, oflag);
}
