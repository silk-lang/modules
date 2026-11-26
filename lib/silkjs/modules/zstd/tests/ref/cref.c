/* The C twin of tools/cli: the same environment protocol and the same sequence of
 * ZSTD_compressStream2 calls, against the reference libzstd. Build:
 *   cc -O2 -o cref cref.c -I<zstd>/lib <zstd>/lib/libzstd.a -lpthread */
#define ZSTD_STATIC_LINKING_ONLY
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "zstd.h"

static long envInt(const char* name, long fallback) { const char* v = getenv(name); return (v && *v) ? atol(v) : fallback; }

int main(void) {
    FILE* in = fopen(getenv("ZIN"), "rb"); if (!in) { printf("cannot open ZIN\n"); return 2; }
    fseek(in, 0, SEEK_END); size_t length = (size_t)ftell(in); fseek(in, 0, SEEK_SET);
    unsigned char* input = malloc(length + 64);
    if (fread(input, 1, length, in) != length) return 2;
    fclose(in);
    FILE* out = fopen(getenv("ZOUT"), "wb"); if (!out) { printf("cannot open ZOUT\n"); return 2; }
    FILE* trace = getenv("ZTRACE") ? fopen(getenv("ZTRACE"), "wb") : NULL;
    size_t ichunk = (size_t)envInt("ZICHUNK", 0), ochunk = (size_t)envInt("ZOCHUNK", 16384), flushEvery = (size_t)envInt("ZFLUSH", 0);
    long pledge = envInt("ZPLEDGE", -1), repeat = envInt("ZREPEAT", 1), loops = envInt("ZLOOPS", 1);
    unsigned char* outBuffer = malloc(ochunk + 64);
    ZSTD_CCtx* c = ZSTD_createCCtx();
    int failed = 0;
    const char* p = getenv("ZPARAMS");
    if (p) {
        char* copy = strdup(p); char* save = NULL; char* tok = strtok_r(copy, " ,", &save);
        while (tok) {
            long id = atol(tok); tok = strtok_r(NULL, " ,", &save); if (!tok) break;
            long value = atol(tok); tok = strtok_r(NULL, " ,", &save);
            size_t r = ZSTD_CCtx_setParameter(c, (ZSTD_cParameter)id, (int)value);
            if (trace) fprintf(trace, "P %ld %ld %ld\n", id, value, (long)r);
            if (ZSTD_isError(r)) failed = 1;
        }
    }
    unsigned char* dictBuf = NULL; size_t dictLength = 0;
    if (getenv("ZDICT")) {
        FILE* df = fopen(getenv("ZDICT"), "rb"); if (!df) { printf("cannot open ZDICT\n"); return 2; }
        fseek(df, 0, SEEK_END); dictLength = (size_t)ftell(df); fseek(df, 0, SEEK_SET);
        dictBuf = malloc(dictLength + 64);
        if (fread(dictBuf, 1, dictLength, df) != dictLength) return 2;
        fclose(df);
        if (!failed) {
            size_t r = ZSTD_CCtx_loadDictionary(c, dictBuf, dictLength);
            if (trace) fprintf(trace, "D %ld\n", (long)r);
            if (ZSTD_isError(r)) failed = 1;
        }
    }
    long resetEach = envInt("ZRESET", 0), dropAt = envInt("ZDROP", -1), midLoad = envInt("ZMIDLOAD", 0);
    clock_t start = clock();
    size_t total = 0;
    for (long frame = 0; frame < repeat && !failed; frame++) {
        if (frame > 0 && resetEach == 1) {
            size_t r = ZSTD_CCtx_reset(c, ZSTD_reset_session_only);
            if (trace) fprintf(trace, "R %ld\n", (long)r);
            if (ZSTD_isError(r)) failed = 1;
        }
        if (frame == dropAt) {
            size_t r = ZSTD_CCtx_loadDictionary(c, NULL, 0);
            if (trace) fprintf(trace, "D %ld\n", (long)r);
            if (ZSTD_isError(r)) failed = 1;
        }
        if (pledge >= 0) {
            size_t r = ZSTD_CCtx_setPledgedSrcSize(c, (unsigned long long)pledge);
            if (trace) fprintf(trace, "S %ld\n", (long)r);
            if (ZSTD_isError(r)) failed = 1;
        }
        if (ichunk == 0) {
            size_t srcPos = 0;
            while (!failed) {
                size_t dstPos = 0;
                size_t r = ZSTD_compressStream2_simpleArgs(c, outBuffer, ochunk, &dstPos, input, length, &srcPos, ZSTD_e_end);
                if (trace) fprintf(trace, "C %ld %ld %ld %ld\n", 2L, (long)r, (long)srcPos, (long)dstPos);
                fwrite(outBuffer, 1, dstPos, out); total += dstPos;
                if (ZSTD_isError(r)) failed = 1;
                if (r == 0) break;
            }
        } else {
            size_t offset = 0, index = 0; long loopsLeft = loops;
            while (!failed) {
                if (offset >= length) { if (--loopsLeft <= 0 || length == 0) break; offset = 0; }
                size_t size = length - offset < ichunk ? length - offset : ichunk;
                index++;
                int endOp = (flushEvery != 0 && index % flushEvery == 0) ? 1 : 0;
                size_t srcPos = 0;
                while (!failed) {
                    size_t dstPos = 0;
                    size_t r = ZSTD_compressStream2_simpleArgs(c, outBuffer, ochunk, &dstPos, input + offset, size, &srcPos, (ZSTD_EndDirective)endOp);
                    if (trace) fprintf(trace, "C %ld %ld %ld %ld\n", (long)endOp, (long)r, (long)srcPos, (long)dstPos);
                    fwrite(outBuffer, 1, dstPos, out); total += dstPos;
                    if (ZSTD_isError(r)) failed = 1;
                    if (srcPos == size && (endOp == 0 || r == 0)) break;
                }
                if (midLoad == 1 && frame == 0 && index == 1 && dictBuf) {
                    size_t r = ZSTD_CCtx_loadDictionary(c, dictBuf, dictLength);
                    if (trace) fprintf(trace, "D %ld\n", (long)r);
                }
                offset += size;
            }
            while (!failed) {
                size_t dstPos = 0, srcPos = 0;
                size_t r = ZSTD_compressStream2_simpleArgs(c, outBuffer, ochunk, &dstPos, input, 0, &srcPos, ZSTD_e_end);
                if (trace) fprintf(trace, "C %ld %ld %ld %ld\n", 2L, (long)r, (long)srcPos, (long)dstPos);
                fwrite(outBuffer, 1, dstPos, out); total += dstPos;
                if (ZSTD_isError(r)) failed = 1;
                if (r == 0) break;
            }
        }
    }
    clock_t elapsed = clock() - start;
    ZSTD_freeCCtx(c);
    fclose(out); if (trace) fclose(trace);
    printf("in %ld out %ld usec %ld\n", (long)length, (long)total, (long)elapsed);
    return failed ? 1 : 0;
}
