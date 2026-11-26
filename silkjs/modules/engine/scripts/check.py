#!/usr/bin/env python3
"""Correctness gate for SilkJS changes.

Runs, in order:
  0. a type check of every entry point and fixture outside the package exports (silk check
     on a temporary manifest that also exports them), so signature changes cannot strand them
  1. the native regression suite: silk test src/tests.silk
  2. QuickJS's own tests/*.js (vendored in tests/upstream/ from the pinned upstream
     revision) under the release qjs binary
  3. SilkJS's own regression scripts, tests/silkjs/*.js (behavior QuickJS gets wrong),
     and each of them (and a module, tests/fixtures/image_module) again from a
     bytecode image (--write-image, then --image): the output and exit status must be
     those of the source
  4. the benchmark workloads once each, checking output against C QuickJS
     (scripts/bench.py --skip-micro --runs 1)
  5. 200 generated programs under the plain and observed dispatch loops, which must agree
     (scripts/differential.py, about 15 seconds)

  python3 scripts/check.py                 # everything
  python3 scripts/check.py --skip-native   # only the JS-level checks (needs a release build)

test_bjson.js is not vendored: it needs upstream's bjson.so C plugin.
"""
import argparse
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from toolchain import release_binary

ROOT = Path(__file__).resolve().parents[1]
BINARY = release_binary()
# (script, extra qjs arguments); upstream's Makefile `test` target uses the same flags.
UPSTREAM = [
    ('test_closure.js', []), ('test_language.js', []), ('test_builtin.js', ['--std']),
    ('test_loop.js', []), ('test_bigint.js', []), ('test_cyclic_import.js', []),
    ('test_std.js', []), ('test_worker.js', []),
]


def step(name, command, cwd=ROOT):
    start = time.perf_counter()
    result = subprocess.run(command, cwd=cwd, capture_output=True, text=True)
    elapsed = time.perf_counter() - start
    status = 'PASS' if result.returncode == 0 else 'FAIL'
    print(f'{status}  {name}  ({elapsed:.1f}s)', flush=True)
    if result.returncode != 0:
        print((result.stdout + result.stderr)[-4000:])
    return result.returncode == 0


def images(binary, scripts):
    """Runs every script from a bytecode image and compares with its run from source."""
    start = time.perf_counter()
    failures = []
    with tempfile.TemporaryDirectory() as scratch:
        image = str(Path(scratch) / 'script.bin')
        for script, flags in scripts:
            source = subprocess.run([str(binary), *flags, script.name], cwd=script.parent, capture_output=True, text=True)
            written = subprocess.run([str(binary), *flags, '--write-image', image, script.name], cwd=script.parent,
                                     capture_output=True, text=True)
            loaded = subprocess.run([str(binary), *flags, '--image', image], cwd=script.parent, capture_output=True, text=True)
            if written.returncode != 0 or (loaded.stdout, loaded.returncode) != (source.stdout, source.returncode):
                failures.append(f'{script.name}: {(written.stderr + loaded.stdout + loaded.stderr)[-300:]}')
    print(f"{'FAIL' if failures else 'PASS'}  scripts from bytecode images  ({time.perf_counter() - start:.1f}s)", flush=True)
    for failure in failures:
        print(failure)
    return not failures


def entry_modules():
    """Modules with a `main` that silk check does not otherwise reach. Fixtures importing a
    generated module that is not present (it comes from a generator script) are left out."""
    present = {path.stem for path in (ROOT / 'src').glob('*.silk')}
    modules = []
    for path in sorted((ROOT / 'src').glob('*.silk')):
        text = path.read_text()
        if not re.search(r'(?m)^(pub )?(effect )?fn main\(', text):
            continue
        imported = re.findall(r'(?m)^import (\w+)', text)
        if all(name in present or name == 'silk' for name in imported):
            modules.append(path.stem)
    return modules


def check_entries():
    manifest = (ROOT / 'silk.toml').read_text()
    anchor = '  "js_libc_bjson_plugin",'
    if anchor not in manifest:
        raise SystemExit('check.py: silk.toml exports changed; update check_entries')
    extra = ''.join(f', "{name}"' for name in ['tests', 'test262_runner', *entry_modules()])
    temporary = ROOT / '.entries-check.toml'
    temporary.write_text(manifest.replace(anchor, anchor[:-1] + extra + ',', 1))
    try:
        return step('entry points type-check', ['silk', 'check', '--manifest-path', str(temporary)])
    finally:
        temporary.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--binary', type=Path, default=BINARY)
    parser.add_argument('--skip-native', action='store_true', help='skip silk test src/tests.silk')
    parser.add_argument('--skip-bench', action='store_true', help='skip the benchmark output check')
    args = parser.parse_args()
    ok = check_entries()
    if not args.skip_native:
        ok &= step('native regression suite', ['silk', 'test', 'src/tests.silk', '-o', 'build/core-tests',
                                               '--optimization', 'speed', '--debug', 'false'])
    binary = args.binary.expanduser().resolve()
    if not binary.is_file():
        raise SystemExit(f'missing {binary}; build with `silk build --release`')
    for script, flags in UPSTREAM:
        ok &= step(f'upstream {script}', [str(binary), *flags, script], cwd=ROOT / 'tests/upstream')
    scripts = []
    for script in sorted((ROOT / 'tests/silkjs').glob('*.js')):
        # A first line `// flags: ...` passes those qjs arguments (e.g. --experimental for Intl).
        first = script.read_text().split('\n', 1)[0]
        flags = first.removeprefix('// flags:').split() if first.startswith('// flags:') else []
        scripts.append((script, flags))
        ok &= step(f'silkjs {script.name}', [str(binary), *flags, script.name], cwd=ROOT / 'tests/silkjs')
    scripts.append((ROOT / 'tests/fixtures/image_module/main.mjs', []))
    ok &= images(binary, scripts)
    if not args.skip_bench:
        ok &= step('benchmark outputs', [sys.executable, 'scripts/bench.py', '--binary', str(binary),
                                         '--skip-micro', '--runs', '1'])
    ok &= step('differential plain vs observed', [sys.executable, 'scripts/differential.py', '--engine', str(binary)])
    print('\nall checks passed' if ok else '\nCHECKS FAILED')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
