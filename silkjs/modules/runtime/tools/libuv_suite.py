#!/usr/bin/env python3
"""Runs libuv's own test suite against real libuv and against the runtime's Silk exports.

The same test sources (libuv's test/*.c) are linked twice: with libuv built from the given source
tree, and with the runtime's ext.uv_api_* modules in place of libuv. Each runner runs every test as
a separate process; the script prints both results and fails when a test passes with libuv and
fails with the Silk exports.

    python3 tools/libuv_suite.py --libuv-src libuv-v1.51.0 --work /tmp/uvsuite

Needs Silk and Clang on PATH (SILK_CLANG for Silk's Clang), and CMake for libuv. Run it as a user
that is not root: the suite refuses root, and this script runs it with setpriv as `nobody` when it
is started as root on Linux.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# libuv's C API in Silk is the Node-API package's (napi/src/ext); it uses the core's records.
EXT = os.path.join(HERE, 'napi', 'src', 'ext')
MODULES = ['uv_api_loop', 'uv_api_sys', 'uv_api_fs', 'uv_api_stream']
# Tests of libuv's internals rather than its interface: they compile libuv's own sources in, so
# their results are left out. Their copies of public functions are renamed, so as not to clash
# with the Silk exports (the test list must still link: it ends at the first missing test).
SKIPPED_SOURCES = {'test-idna.c'}
RENAMED = ['uv_wtf8_length_as_utf16', 'uv_wtf8_to_utf16', 'uv_utf16_length_as_wtf8', 'uv_utf16_to_wtf8']

ENTRY = r'''
#include <stdio.h>
#include <string.h>
int uv_test_main(int argc, char **argv);
#include <stdlib.h>
/* A program of the caller's (--diagnostic), run instead of the suite when UV_SUITE_DIAGNOSTIC is set. */
__attribute__((weak)) int uv_suite_diagnostic(void) { return 2; }
#ifdef __APPLE__
extern int *_NSGetArgc(void);
extern char ***_NSGetArgv(void);
int uv_suite_entry(void) {
  if (getenv("UV_SUITE_DIAGNOSTIC")) return uv_suite_diagnostic();
  return uv_test_main(*_NSGetArgc(), *_NSGetArgv());
}
#else
int uv_suite_entry(void) {
  if (getenv("UV_SUITE_DIAGNOSTIC")) return uv_suite_diagnostic();
  static char buffer[65536];
  static char *argv[256];
  FILE *f = fopen("/proc/self/cmdline", "rb");
  size_t n = f ? fread(buffer, 1, sizeof buffer - 1, f) : 0;
  int argc = 0;
  if (f) fclose(f);
  for (size_t i = 0; i < n && argc < 255; i += strlen(buffer + i) + 1) argv[argc++] = buffer + i;
  argv[argc] = NULL;
  return uv_test_main(argc, argv);
}
#endif
'''


def run(command, **options):
    print('+', ' '.join(command), flush=True)
    subprocess.run(command, check=True, **options)


def sysroot():
    """Silk's Clang brings no macOS SDK: point it at Xcode's (or SDKROOT)."""
    if sys.platform != 'darwin':
        return []
    sdk = os.environ.get('SDKROOT') or subprocess.run(['xcrun', '--show-sdk-path'], capture_output=True, text=True).stdout.strip()
    return ['-isysroot', sdk] if sdk else []


def compile_tests(source, objects, compiler):
    os.makedirs(objects, exist_ok=True)
    test = os.path.join(source, 'test')
    flags = ['-O1', '-g', '-w', '-D_GNU_SOURCE', '-D_FILE_OFFSET_BITS=64', '-I', os.path.join(source, 'include'),
             '-I', os.path.join(source, 'src'), '-I', test]
    flags += sysroot()
    jobs = []
    for name in sorted(os.listdir(test)):
        if not name.endswith('.c'):
            continue
        if name.startswith(('benchmark-', 'run-benchmarks', 'runner-win', 'echo-server', 'blackhole-server', 'dns-server')):
            continue
        extra = ['-Dmain=uv_test_main'] if name == 'run-tests.c' else []
        if name in SKIPPED_SOURCES:
            extra = [f'-D{function}=libuv_internal_{function}' for function in RENAMED]
        output = os.path.join(objects, name[:-2] + '.o')
        jobs.append(subprocess.Popen([compiler, *flags, *extra, '-c', os.path.join(test, name), '-o', output]))
        if len(jobs) >= os.cpu_count():
            if jobs.pop(0).wait() != 0:
                sys.exit('test compilation failed')
    for job in jobs:
        if job.wait() != 0:
            sys.exit('test compilation failed')
    for name in ('echo-server.c', 'blackhole-server.c'):
        if os.path.exists(os.path.join(test, name)):
            run([compiler, *flags, '-c', os.path.join(test, name), '-o', os.path.join(objects, name[:-2] + '.o')])
    with open(os.path.join(objects, 'entry.c'), 'w') as entry:
        entry.write(ENTRY)
    run([compiler, '-O1', *sysroot(), '-c', os.path.join(objects, 'entry.c'), '-o', os.path.join(objects, 'entry.o')])


def build_silk(work, objects, compiler):
    package = os.path.join(work, 'silk')
    if os.path.exists(package):
        shutil.rmtree(package)
    os.makedirs(os.path.join(package, 'src'))
    os.symlink(EXT, os.path.join(package, 'src', 'ext'))
    with open(os.path.join(HERE, 'silk.toml')) as manifest:
        version = re.search(r'^silk-version = "(.*)"', manifest.read(), re.M).group(1)
    with open(os.path.join(package, 'silk.toml'), 'w') as manifest:
        manifest.write(f'[package]\nname = "uvsuite"\nversion = "0.1.0"\nsilk-version = "{version}"\n'
                       f'[dependencies]\nsilkjsruntime = {{ path = "{HERE}", package = "silkjs-runtime" }}\n')
    with open(os.path.join(package, 'src', 'main.silk'), 'w') as main:
        main.write(''.join(f'import ext.{module}\n' for module in MODULES))
        main.write('unsafe extern "C" fn uv_suite_entry() -> i32\npub fn main() -> i32 { return unsafe uv_suite_entry() }\n')
    inputs = sorted(os.path.join(objects, name) for name in os.listdir(objects) if name.endswith('.o'))
    libraries = [*sysroot(), '-lSystem', '-lpthread', '-lm'] if sys.platform == 'darwin' else [
        '-lpthread', '-ldl', '-lm', '-lrt', '-lutil', '-Wl,--export-dynamic',
        # The test objects are compiled against the system's C library, which may be newer than
        # the one Silk links: its versioned names resolve when the program loads.
        '-Wl,--unresolved-symbols=ignore-all']
    driver = os.path.join(work, 'clang.sh')
    with open(driver, 'w') as script:
        script.write('#!/bin/sh\nfor a in "$@"; do case $a in -c|-S|-E|--version|-dumpmachine) exec %s "$@";; esac; done\n'
                     'exec %s "$@" -x none %s %s\n' % (compiler, compiler, ' '.join(inputs), ' '.join(libraries)))
    os.chmod(driver, 0o755)
    run(['silk', 'build', '--ignore-warnings', '--clang', driver], cwd=package)
    built = [os.path.join(root, name) for root, _, names in os.walk(os.path.join(package, 'build'))
             for name in names if name == 'uvsuite']
    runner = os.path.join(work, 'uv_run_tests_silk')
    shutil.copy(built[0], runner)
    return runner


def build_real(source, work):
    build = os.path.join(work, 'real')
    run(['cmake', '-S', source, '-B', build, '-DLIBUV_BUILD_TESTS=ON', '-DCMAKE_BUILD_TYPE=Debug'])
    run(['cmake', '--build', build, '--target', 'uv_run_tests_a', '-j', str(os.cpu_count())])
    return os.path.join(build, 'uv_run_tests_a')


def run_suite(runner, directory, log):
    command = [runner]
    if os.geteuid() == 0:
        if not shutil.which('setpriv'):
            sys.exit('the suite cannot run as root, and setpriv is missing')
        command = ['setpriv', '--reuid=nobody', '--regid=nogroup', '--clear-groups', runner]
    with open(log, 'w') as output:
        subprocess.run(command, cwd=directory, stdout=output, stderr=subprocess.STDOUT)
    results = {}
    with open(log, errors='replace') as output:
        for line in output:
            match = re.match(r'(not ok|ok) \d+ - (\S+)', line)
            if match:
                results[match.group(2)] = match.group(1) == 'ok'
    return results


def diagnose(path, source, work, compiler, silk_runner):
    """Runs the --diagnostic program with libuv and with the Silk exports and prints both."""
    stub = os.path.join(work, 'diagnostic-main.c')
    with open(stub, 'w') as main:
        main.write('int uv_suite_diagnostic(void);\nint main(void) { return uv_suite_diagnostic(); }\n')
    real = os.path.join(work, 'diagnostic-real')
    archive = os.path.join(work, 'real', 'libuv.a')
    run([compiler, '-O0', '-g', *sysroot(), '-I', os.path.join(source, 'include'), os.path.abspath(path), stub, archive, '-lpthread', '-o', real]
        + ([] if sys.platform == 'darwin' else ['-ldl', '-lm', '-lrt']))
    outputs = []
    for program, environment in ((real, {}), (silk_runner, {'UV_SUITE_DIAGNOSTIC': '1'})):
        directory = os.path.join(work, 'diagnostic-run')
        os.makedirs(directory, exist_ok=True)
        done = subprocess.run([program], cwd=directory, env={**os.environ, **environment}, capture_output=True, text=True, timeout=120)
        outputs.append(done.stdout + done.stderr + f'exit {done.returncode}\n')
    print('--- diagnostic, libuv / Silk')
    lefts, rights = outputs[0].splitlines(), outputs[1].splitlines()
    differences = 0
    for index in range(max(len(lefts), len(rights))):
        left = lefts[index] if index < len(lefts) else '(none)'
        right = rights[index] if index < len(rights) else '(none)'
        if left != right:
            differences += 1
        print(('   ' if left == right else '!! ') + left + ('' if left == right else '   |   ' + right))
    print('--- end of diagnostic: ' + ('the same' if differences == 0 else f'{differences} lines differ'))
    return differences


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--libuv-src', required=True)
    parser.add_argument('--work', required=True)
    parser.add_argument('--diagnostic', help='a C file defining int uv_suite_diagnostic(void), linked into the Silk runner')
    options = parser.parse_args()
    source = os.path.abspath(options.libuv_src)
    work = os.path.abspath(options.work)
    compiler = os.environ.get('SILK_CLANG', 'clang')
    os.makedirs(work, exist_ok=True)
    compile_tests(source, os.path.join(work, 'objects'), compiler)
    if options.diagnostic:
        run([compiler, '-O0', '-g', *sysroot(), '-I', os.path.join(source, 'include'), '-c', os.path.abspath(options.diagnostic),
             '-o', os.path.join(work, 'objects', 'diagnostic.o')])
    silk_runner = build_silk(work, os.path.join(work, 'objects'), compiler)
    real_runner = build_real(source, work)
    diagnostic_differences = 0
    if options.diagnostic:
        diagnostic_differences = diagnose(options.diagnostic, source, work, compiler, silk_runner)
    directory = os.path.join(work, 'run')
    if os.path.exists(directory):
        shutil.rmtree(directory)
    shutil.copytree(os.path.join(source, 'test', 'fixtures'), os.path.join(directory, 'test', 'fixtures'))
    if os.geteuid() == 0:
        for root, names, files in os.walk(directory):
            for name in [root, *[os.path.join(root, n) for n in names + files]]:
                os.chown(name, 65534, -1)
        path = work
        while path != '/':
            os.chmod(path, os.stat(path).st_mode | 0o005)
            path = os.path.dirname(path)
    real = run_suite(real_runner, directory, os.path.join(work, 'real.tap'))
    silk = run_suite(silk_runner, directory, os.path.join(work, 'silk.tap'))
    internal = set()
    for name in SKIPPED_SOURCES:
        with open(os.path.join(source, 'test', name), errors='replace') as test:
            internal.update(re.findall(r'TEST_IMPL\((\w+)\)', test.read()))
    for name in internal:
        real.pop(name, None)
        silk.pop(name, None)
    regressions = sorted(name for name, passed in real.items() if passed and not silk.get(name, False))
    print(f'libuv: {sum(real.values())} of {len(real)} passed')
    print(f'Silk:  {sum(silk.values())} of {len(silk)} passed (tests of libuv internals left out: {", ".join(sorted(SKIPPED_SOURCES))})')
    print('failed with both:', ' '.join(sorted(n for n, p in real.items() if not p and not silk.get(n, False))) or 'none')
    print('passed only with Silk:', ' '.join(sorted(n for n, p in silk.items() if p and not real.get(n, False))) or 'none')
    if regressions:
        print('FAILED with Silk, passed with libuv:', ' '.join(regressions))
        # Each failing test's own report, from the runner's TAP output.
        with open(os.path.join(work, 'silk.tap'), errors='replace') as tap:
            blocks = re.split(r'\n(?=(?:not ok|ok) \d+ - )', tap.read())
        for block in blocks:
            match = re.match(r'not ok \d+ - (\S+)', block)
            if match and match.group(1) in regressions:
                print('\n'.join(block.splitlines()[:40]))
        return 1
    print('no test fails with Silk that passes with libuv')
    return 1 if diagnostic_differences else 0


if __name__ == '__main__':
    sys.exit(main())
