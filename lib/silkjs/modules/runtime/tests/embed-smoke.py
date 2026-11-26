#!/usr/bin/env python3
"""Build the embedding smoke test, a host that embeds the runtime, and check what it prints.

The host evaluates its own module (no script in its arguments), turns the loop with a
bounded wait while the runtime is kept alive with nothing referenced, and the module
ends the runtime with process.exit: the host's turn reports the status, and 'exit'
listeners ran. Run after tools/build.py, which prepares the native archives and
src/runtime/embedded.silk: python3 tests/embed-smoke.py [--skip-build]
"""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from built import built  # noqa: E402
# The same host (the core's src/embed_smoke.silk) twice: without WebAssembly (./smoke, EmptyWasm),
# and with it (./smoke-wamr, WamrWasm and every other capability's package). Only the second
# program depends on WAMR.
# The first has no file system either (EmptyFiles); the second's is in memory (MemoryFiles).
# The libraries of capabilities in packages of their own are linked only into the second: these
# are a symbol of each, which the first must not define.
# zlib and Zstandard are Silk code in ./compress, so the compression jobs' C entry stands for them.
LIBRARIES = {'WAMR': 'wasm_runtime_full_init', 'compression': 'silkCompressionWork', 'brotli': 'BrotliEncoderCreateInstance',
             'nghttp2': 'nghttp2_session_client_new',
             'llhttp': 'llhttp_init', 'SQLite': 'sqlite3_open_v2',
             'OpenSSL': 'SSL_CTX_new',
             'inspector server': 'silk_inspector_create',
             'amaro': 'silk_type_stripping_sources_linked',
             'Node-API': 'napi_create_object',
             # libuv is Node-API addons' (./napi), never the core's.
             'libuv': 'uv_loop_init'}
PROGRAMS = [
    ('embed-smoke', ROOT / 'smoke', 'silkjs-runtime-smoke', 'undefined', False),
    ('embed-smoke-wamr', ROOT / 'smoke-wamr', 'silkjs-runtime-smoke-wamr', 'object', True),
]


def defined(executable):
    listing = subprocess.run(['nm', '--defined-only', str(executable)], capture_output=True, text=True, check=True).stdout
    names = {line.split()[-1] for line in listing.splitlines() if line.split()}
    # Since Silk 0.1.0-dev.88 a Linux executable's .symtab names each Silk function by its
    # declaration (`package:src/file.silk::name`), C exports included: also keep the bare name.
    return names | {name.rsplit('::', 1)[-1] for name in names if '::' in name}


def expected(wasm, files):
    return [
        'add 5',
        'wasm ' + wasm,
        'lib 42',
        'meta true true',
        'libraries ' + ('object object function object object object object object function object strip true' if files else 'undefined undefined undefined undefined undefined undefined undefined undefined undefined undefined false false'),
        'dlopen ' + ('ERR_DLOPEN_FAILED' if files else 'ERR_DLOPEN_DISABLED'),
        'env EMBED_SMOKE,OPENSSL_CONF fixed /embed-smoke',
        'setenv EPERM',
        *(['fs function', 'read hello from memory', 'dir greeting.txt,out.txt 6 false', 'sqlite 5 true true', 'wasi UVWASI_ENOTCAPABLE'] if files else
          ['fs ERR_UNKNOWN_BUILTIN_MODULE undefined false']),
        'crypto ' + ('there' if files else 'ERR_NO_CRYPTO'),
        'worker ' + ('started' if files else 'ERR_WORKER_INIT_FAILED'),
        'cjs helpers',
        'missing ERR_MODULE_NOT_FOUND',
        'tick 1',
        'tick 2',
        'tick 3',
        'async ' + ('abcdef' if files else 'none'),
        'exit 3',
        'host: callback returned 42 after its microtask',
        'host: finished with 3',
    ]


def build(name, package, manifest_name):
    version = tomllib.loads((ROOT / 'silk.toml').read_text())['package']['silk-version']
    directory = ROOT / 'build' / name
    directory.mkdir(parents=True, exist_ok=True)
    environment = {**os.environ, 'SILKJS_CLANG_BUILD': str(directory)}
    subprocess.run(['silk', '+' + version, 'build', '--debug', 'true', '--clang', str(ROOT / 'tools/clang.py')],
                   cwd=package, env=environment, check=True)
    # The package build names its output in the request it publishes (tools/built.py).
    shutil.copy2(built(manifest_name), directory / name)


def main():
    failed = False
    for name, package, source, wasm, files in PROGRAMS:
        if '--skip-build' not in sys.argv[1:]:
            build(name, package, source)
        executable = ROOT / 'build' / name / name
        result = subprocess.run([str(executable)], capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL)
        lines = result.stdout.splitlines()
        symbols = defined(executable)
        linked = [library for library, symbol in LIBRARIES.items() if symbol in symbols]
        wanted = list(LIBRARIES) if files else []
        if linked != wanted:
            print(f'{name} failed: links {linked or "no library"}, expected {wanted or "none"}')
            failed = True
        if result.returncode != 3 or lines != expected(wasm, files):
            print(f'{name} failed: status {result.returncode}')
            print('stdout:\n' + result.stdout)
            print('stderr:\n' + result.stderr)
            print('expected:\n' + '\n'.join(expected(wasm, files)))
            failed = True
        else:
            print(f'{name} passed')
            if files and not failed:
                # The host owns its process (Options.ownsProcess): it starts as well from the heap
                # image that silk task image appends to it.
                subprocess.run(['silk', 'task', 'image', '--program', str(executable)], cwd=ROOT / 'tools/capabilities', check=True)
                # A start from the image lists the image pages it wrote there: none is written otherwise.
                pages = ROOT / 'build' / name / 'image-pages'
                pages.unlink(missing_ok=True)
                imaged = subprocess.run([str(executable)], capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL,
                                        env={**os.environ, 'SILKJS_HEAP_IMAGE_PAGES': str(pages)})
                if not pages.exists() or imaged.returncode != 3 or imaged.stdout.splitlines() != expected(wasm, files):
                    print(f'{name} from its heap image failed: status {imaged.returncode}, restored {pages.exists()}')
                    print('stdout:\n' + imaged.stdout)
                    print('stderr:\n' + imaged.stderr)
                    failed = True
                else:
                    print(f'{name} passed from its heap image')
    if failed:
        sys.exit(1)


if __name__ == '__main__':
    main()
