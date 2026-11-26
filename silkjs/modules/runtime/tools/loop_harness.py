#!/usr/bin/env python3
"""Builds and runs tests/loop-harness/main.silk: the loop of ext.uv_loop driven directly, without the
runtime around it (async coalescing, signals, spawn and kill, a missing program, fs events, a stat
poll, close order, the thread pool and cancellation, idle/prepare/check order, timers, walk order).
Each check prints its name and whether it held; the program exits with the number that did not.

Usage: python3 tools/loop_harness.py [--work DIR]
Needs Silk on PATH (and SILK_CLANG for Silk's Clang where the default is not it).
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    work = sys.argv[sys.argv.index('--work') + 1] if '--work' in sys.argv else tempfile.mkdtemp(prefix='loop-harness-')
    package = os.path.join(os.path.abspath(work), 'package')
    if os.path.exists(package):
        shutil.rmtree(package)
    os.makedirs(os.path.join(package, 'src'))
    # libuv's C API in Silk is the Node-API package's; it uses the core's records.
    os.symlink(os.path.join(HERE, 'napi', 'src', 'ext'), os.path.join(package, 'src', 'ext'))
    shutil.copy(os.path.join(HERE, 'tests', 'loop-harness', 'main.silk'), os.path.join(package, 'src', 'main.silk'))
    with open(os.path.join(HERE, 'silk.toml')) as manifest:
        version = re.search(r'^silk-version = "(.*)"', manifest.read(), re.M).group(1)
    with open(os.path.join(package, 'silk.toml'), 'w') as manifest:
        manifest.write(f'[package]\nname = "loopharness"\nversion = "0.1.0"\nsilk-version = "{version}"\n'
                       f'[dependencies]\nsilkjsruntime = {{ path = "{HERE}", package = "silkjs-runtime" }}\n')
    compiler = os.environ.get('SILK_CLANG', 'clang')
    # As tools/libuv_suite.py: on Linux, C library names Silk's link stub lacks (fstat) resolve when
    # the program loads.
    if sys.platform == 'darwin':
        # Silk's Clang brings no macOS SDK: link against Xcode's (or SDKROOT), as tools/libuv_suite.py.
        sdk = os.environ.get('SDKROOT') or subprocess.run(['xcrun', '--show-sdk-path'], capture_output=True, text=True).stdout.strip()
        extra = (f'-isysroot {sdk} ' if sdk else '') + '-lSystem -lpthread -lm'
    else:
        extra = '-lpthread -ldl -lm -lrt -Wl,--unresolved-symbols=ignore-all'
    driver = os.path.join(os.path.abspath(work), 'clang.sh')
    with open(driver, 'w') as script:
        script.write('#!/bin/sh\nfor a in "$@"; do case $a in -c|-S|-E|--version|-dumpmachine) exec %s "$@";; esac; done\n'
                     'exec %s "$@" -x none %s\n' % (compiler, compiler, extra))
    os.chmod(driver, 0o755)
    arguments = ['silk', 'build', '--ignore-warnings', '--clang', driver]
    subprocess.run(arguments, cwd=package, check=True)
    built = [os.path.join(root, name) for root, _, names in os.walk(os.path.join(package, 'build'))
             for name in names if name == 'loopharness']
    done = subprocess.run([built[0]], cwd=work, timeout=300)
    print(f'loop harness: exit {done.returncode} ({"every check held" if done.returncode == 0 else "checks failed"})')
    return done.returncode


if __name__ == '__main__':
    sys.exit(main())
