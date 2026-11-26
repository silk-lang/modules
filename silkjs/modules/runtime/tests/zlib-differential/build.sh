#!/bin/sh
# Builds the differential harness: the runtime's zlib adapter (compress/src/ext/zlib_stream.silk over
# compress/src/stdlib_copy) as an object with C exports, zlib 1.3.1 from its pinned release, the zlib
# Node 24 builds (Chromium's, from deps/zlib at v24.22.3, with the defines of Node's x64 build),
# and the programs that drive them with the same calls. Needs the Silk toolchain, gcc and curl.
#
# fuzz_deflate checks the runtime's deflate (Chromium's hash) against Node's zlib;
# fuzz_deflate_rolling checks the stdlib's own hash against zlib 1.3.1. The _1.3.1 and _node
# inflate fuzzers check inflate against both.
#
#   tests/zlib-differential/build.sh            # writes build/zlib-differential/
#   build/zlib-differential/fuzz_deflate 1 20000    # seeds 1 to 20000; a third argument traces
#   build/zlib-differential/fuzz_deflate_rolling 1 20000
#   build/zlib-differential/fuzz_inflate_node 1 20000
#   build/zlib-differential/bench_codec <a large file> 5
set -e
here=$(cd "$(dirname "$0")" && pwd)
runtime=$(cd "$here/../.." && pwd)
out=$runtime/build/zlib-differential
mkdir -p "$out/zlib" "$out/package/src/ext"
cd "$out"
if [ ! -f zlib/deflate.c ]; then
  curl -fsSLo zlib.tgz https://github.com/madler/zlib/releases/download/v1.3.1/zlib-1.3.1.tar.gz
  echo "9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23  zlib.tgz" | sha256sum -c -
  tar xzf zlib.tgz -C zlib --strip-components 1
fi
node=e63cab040c09d43ceef8cb35508c40044614e906
if [ ! -f nzlib/.complete ]; then
  for name in $(awk '{print $2}' "$here/node-zlib.sha256"); do
    mkdir -p "nzlib/$(dirname "$name")"
    curl -fsSLo "nzlib/$name" "https://raw.githubusercontent.com/nodejs/node/$node/deps/zlib/$name"
  done
  (cd nzlib && sha256sum -c --quiet "$here/node-zlib.sha256") && touch nzlib/.complete
fi
mkdir -p nobj
nodeDefines="-DDEFLATE_SLIDE_HASH_SSE2 -DADLER32_SIMD_SSSE3 -DX86_NOT_WINDOWS -DINFLATE_CHUNK_SIMD_SSE2 -DINFLATE_CHUNK_READ_64LE -DHAVE_HIDDEN -mssse3"
for name in adler32.c adler32_simd.c compress.c cpu_features.c crc32.c deflate.c infback.c inffast.c inftrees.c trees.c uncompr.c zutil.c contrib/optimizations/inffast_chunk.c contrib/optimizations/inflate.c; do
  gcc -O2 -w $nodeDefines -Inzlib -Inzlib/contrib/optimizations -c "nzlib/$name" -o "nobj/$(echo "$name" | tr / _).o"
done
gcc -O2 -w $nodeDefines -Inzlib -c "$here/zref.c" -o nobj/zref.o
rm -f libnzref.a && ar rcs libnzref.a nobj/*.o
# The flags the runtime's zlib package had.
for name in adler32 crc32 deflate inflate inftrees inffast trees zutil; do
  gcc -O2 -w -c -DZ_HAVE_UNISTD_H -D_LARGEFILE64_SOURCE=1 -Izlib "zlib/$name.c" -o "$name.o"
done
gcc -O2 -w -c -Izlib "$here/zref.c" -o zref.o
rm -f libzref.a && ar rcs libzref.a zref.o adler32.o crc32.o deflate.o inflate.o inftrees.o inffast.o trees.o zutil.o
# A package of its own, so that the build reaches only the adapter and the codecs.
cp "$here/silk.toml" package/silk.toml
cp "$here/src/zshim.silk" package/src/zshim.silk
ln -sfn "$runtime/compress/src/stdlib_copy" package/src/stdlib_copy
ln -sfn "$runtime/compress/src/ext/zlib_stream.silk" package/src/ext/zlib_stream.silk
rm -f zshim.o
(cd package && silk build src/zshim.silk --emit object -o "$out/zshim.o")
objcopy --redefine-sym main=zs_unused_main zshim.o zshim_lib.o
gcc -O2 -w -no-pie -o fuzz_deflate "$here/fuzz_deflate.c" zshim_lib.o libnzref.a -lpthread
gcc -O2 -w -no-pie -DSILK_DEFLATE_NEW=zs_deflate_new_rolling -o fuzz_deflate_rolling "$here/fuzz_deflate.c" zshim_lib.o libzref.a
gcc -O2 -w -no-pie -o fuzz_inflate_node "$here/fuzz_inflate.c" zshim_lib.o libnzref.a -lpthread
gcc -O2 -w -no-pie -o fuzz_inflate_1.3.1 "$here/fuzz_inflate.c" zshim_lib.o libzref.a
gcc -O2 -w -no-pie -o bench_codec "$here/bench_codec.c" zshim_lib.o libnzref.a -lpthread
gcc -O2 -w -no-pie -o bench_crc "$here/bench_crc.c" zshim_lib.o libnzref.a -lpthread
echo "built $out"
