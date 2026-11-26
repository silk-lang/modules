#!/usr/bin/env python3
"""Writes the index of the runtime's built-in JavaScript: src/runtime/embedded.silk and
builtin_sources.c.

The C file embeds each file with #embed, so a build reads the JavaScript itself and an edit to a
file needs nothing run: only adding, removing or renaming a built-in does (`silk generate`, which
runs this, or `silk task embed`). No JS engine is needed at build time.
"""
from pathlib import Path
import hashlib
import json
import platform
import subprocess
import tomllib
from prepare_silkjs import prepare

ROOT = Path(__file__).resolve().parents[1]
# builtin_sources.c sits in the package directory because #embed finds a file by its path from the
# including file, and the build tracks only embedded files below that file's own directory.
SOURCES_C = ROOT / 'builtin_sources.c'
# Services whose built-ins are not in the core's table: the package of the real implementation
# embeds them, so a program without it has none of their bytes. Each: the package's C file, and the
# core's pointer that file sets when the program loads.
PACKAGED = {'TypeStripping': (ROOT / 'amaro/amaro_sources.c', 'silk_type_stripping_sources')}
FACTORY_PREFIX = '(function(module, exports, require, process) {\n'
FACTORY_SUFFIX = '\n})'
# runtime/bootstrap.js starts with its two host imports. Only they need a module: the three-line
# entry below. The bootstrap itself is a function like every built-in, the one after the last.
IMPORTS = ("import * as stdNamespace from 'silk:host/std';\n"
           "import * as osNamespace from 'silk:host/os';\n")
# The imports become the two line breaks here, which keeps the line numbers of runtime/bootstrap.js.
BOOTSTRAP_PREFIX = "(function(stdNamespace, osNamespace) { 'use strict';\n\n"


# tools/capabilities.toml: the service each built-in belongs to, the first rule that names it.
CAPABILITIES = tomllib.loads((ROOT / 'tools/capabilities.toml').read_text())


def service_of(name):
    for rule in CAPABILITIES['builtin']:
        if name in rule.get('names', []) or any(name.startswith(prefix) for prefix in rule.get('prefixes', [])):
            return rule['service']
    return 'Core'


def sources():
    yield 'internal/fs_async', ROOT / 'runtime/fs_async.js'
    for directory, prefix in ((ROOT / 'ext/node', ''), (ROOT / 'ext/web', 'internal/web/'), (ROOT / 'libs/node_resolver', 'internal/loader/')):
        if directory.exists():
            for path in sorted(directory.rglob('*.js')):
                yield prefix + path.relative_to(directory).with_suffix('').as_posix(), path


def bootstrap_text():
    source = (ROOT / 'runtime/bootstrap.js').read_text()
    if not source.startswith(IMPORTS):
        raise SystemExit('runtime/bootstrap.js must start with its two host imports')
    return source


def cache_build_identity(debug, environment=None):
    """What the built-ins' bytecode and a heap image depend on: the compiler, the profile, the
    JavaScript and every Silk and C source of the runtime and the engine. tools/build.py links
    it into the executable it builds (silk_build_identity in src/ext/builtin_cache.c)."""
    manifest = tomllib.loads((ROOT / 'silk.toml').read_text())
    engine = prepare(manifest)
    compiler = subprocess.check_output(
        ['silk', '+' + manifest['package']['silk-version'], '--version'],
        cwd=ROOT, env=environment, text=True).strip()
    digest = hashlib.sha256(b'Silk bytecode build identity v2\0')

    def include(name, contents):
        label = name.encode()
        digest.update(len(label).to_bytes(8, 'little'))
        digest.update(label)
        digest.update(len(contents).to_bytes(8, 'little'))
        digest.update(contents)

    include('configuration', json.dumps({
        'compiler': compiler, 'debug': debug,
        'system': platform.system(), 'machine': platform.machine(),
    }, sort_keys=True).encode())
    for name, path in sources():
        include('builtin/' + name, path.read_bytes())
    include('bootstrap', bootstrap_text().encode())
    for namespace, root in (('runtime', ROOT), ('silkjs', engine)):
        paths = set((root / 'src').rglob('*.silk'))
        paths.update((root / 'src').rglob('*.c'))
        paths.update((root / 'src').rglob('*.h'))
        paths.update(root.glob('*.toml'))
        paths.update((root / 'tools').glob('*.py'))
        for path in sorted(paths):
            include(namespace + '/' + path.relative_to(root).as_posix(), path.read_bytes())
    # The runtime's packages beside the core: WebAssembly and the executable.
    for package in ('wamr', 'cli'):
        for path in sorted((ROOT / package / 'src').rglob('*.silk')):
            include('runtime/' + package + '/' + path.relative_to(ROOT / package).as_posix(), path.read_bytes())
    # The runtime's C over WAMR moved to its own package; the identity still covers it.
    glue = ROOT.parent / 'native/wamr/glue'
    for path in sorted(glue.glob('*')):
        include('wamr/' + path.name, path.read_bytes())
    return digest.hexdigest()


def silk_bytes(text):
    return 'b"' + ''.join(chr(byte) if 32 <= byte < 127 and byte not in (34, 92) else '\\"' if byte == 34 else '\\\\' if byte == 92 else '\\x%02x' % byte for byte in text.encode()) + '"'


def c_bytes(text):
    return ''.join(f'{byte},' for byte in text.encode())


def embed_path(path):
    return path.relative_to(ROOT).as_posix()


def generate():
    names = []
    arrays = []
    packaged = {service: [] for service in PACKAGED}
    for index, (name, path) in enumerate(sources()):
        names.append(name)
        service = service_of(name)
        if service in PACKAGED:
            packaged[service].append((index, path))
            arrays.append(f'static const unsigned char b{index}[] = {{0}};\n')
            continue
        arrays.append(f'static const unsigned char b{index}[] = {{{c_bytes(FACTORY_PREFIX)}\n'
                      f'#embed "{embed_path(path)}" suffix(,)\n{c_bytes(FACTORY_SUFFIX)}}};\n')
    bootstrap = ROOT / 'runtime/bootstrap.js'
    bootstrap_text()
    count = len(names)
    arrays.append(f'static const unsigned char b{count}[] = {{{c_bytes(BOOTSTRAP_PREFIX)}\n'
                  f'#embed "{embed_path(bootstrap)}" clang::offset({len(IMPORTS.encode())}) suffix(,)\n'
                  f'{c_bytes(FACTORY_SUFFIX)}}};\n')
    packaged_indexes = {index for entries in packaged.values() for index, _ in entries}
    table = ''.join(f'  {{ b{index}, {0 if index in packaged_indexes else f"sizeof b{index}"} }},\n' for index in range(count + 1))
    hooks = ''
    lookups = ''
    for service, (path, pointer) in PACKAGED.items():
        hooks += (f'/* The built-ins of {service}, which its package installs (tools/embed.py, PACKAGED). */\n'
                  f'const unsigned char *(*{pointer})(size_t index, size_t *length);\n')
        cases = ''.join(f'    case {index}:\n' for index, _ in packaged[service])
        lookups += (f'  switch (index) {{\n{cases}      if ({pointer}) return {pointer}(index, length);\n'
                    f'      *length = 0; return (const unsigned char *)"";\n    default: break;\n  }}\n')
        package_arrays = ''.join(
            f'static const unsigned char b{index}[] = {{{c_bytes(FACTORY_PREFIX)}\n'
            f'#embed "{Path("..") / embed_path(source)}" suffix(,)\n{c_bytes(FACTORY_SUFFIX)}}};\n'
            for index, source in packaged[service])
        package_cases = ''.join(f'    case {index}: *length = sizeof b{index}; return b{index};\n' for index, _ in packaged[service])
        path.write_text(
            f'/* Generated by tools/embed.py: the built-ins of {service}, in the package of its real\n'
            ' * implementation. The core\'s table (builtin_sources.c) holds none of their bytes; this file\n'
            ' * hands them to it when the program loads. */\n'
            '#include <stddef.h>\n\n' + package_arrays
            + f'\nextern const unsigned char *(*{pointer})(size_t index, size_t *length);\n\n'
            + 'static const unsigned char *lookup(size_t index, size_t *length) {\n  switch (index) {\n' + package_cases
            + '    default: *length = 0; return (const unsigned char *)"";\n  }\n}\n\n'
            + f'__attribute__((constructor)) static void install(void) {{ {pointer} = lookup; }}\n\n'
            + '/* The package\'s Silk calls this, so that a program that depends on the package links this file. */\n'
            + f'int {pointer}_linked(void) {{ return 1; }}\n')
    SOURCES_C.write_text(
        '/* Generated by tools/embed.py: the built-in modules\' sources, each wrapped in its factory\n'
        ' * function, then the bootstrap\'s. The build embeds the files themselves (#embed), so editing\n'
        ' * one needs nothing regenerated. */\n'
        '#include <stddef.h>\n\n' + ''.join(arrays)
        + '\nstatic const struct { const unsigned char *data; size_t length; } sources[] = {\n' + table + '};\n\n'
        + hooks + '\n'
        + 'const unsigned char *silk_builtin_source(size_t index, size_t *length) {\n'
        + f'  if (index > {count}) {{ *length = 0; return (const unsigned char *)""; }}\n'
        + lookups
        + '  *length = sources[index].length;\n  return sources[index].data;\n}\n')
    entry = (IMPORTS + f"globalThis.__silkNative.compileBuiltin({count}, 'node:internal/bootstrap/silk')(stdNamespace, osNamespace);\n")
    arms = ''.join(f'    {index} => {silk_bytes(name)}\n' for index, name in enumerate(names))
    # The service each built-in belongs to (tools/capabilities.toml): the bootstrap registers only
    # those of the services the program has.
    services = ''.join(f'    {index} => {silk_bytes(service_of(name))}\n' for index, name in enumerate(names)
                       if service_of(name) != 'Core')
    (ROOT / 'src/runtime/embedded.silk').write_text(
        '// Generated by tools/embed.py from runtime/, ext/, and libs/node_resolver/; the sources\n'
        '// themselves are in builtin_sources.c.\n'
        'import silk.core.compilation\n'
        'import silk.mem.pointer { Pointer }\n\n'
        'unsafe extern "C" fn silk_builtin_source(index: usize, length: *mut usize) -> *const u8\n'
        'unsafe extern "C" fn silk_build_identity() -> *const u8\n'
        'const ANCHOR: u8 = 0\n\n'
        'pub fn debugBuild() -> bool { return compilation.debug }\n'
        '/// 64 hexadecimal digits that differ between builds whose bytecode differs.\n'
        "pub fn cacheBuildIdentity() -> &'static [u8] {\n"
        '  return unsafe Pointer.borrowMany<u8, u8>(&ANCHOR, unsafe Pointer.assumeMany<u8>(unsafe silk_build_identity()), 64)\n}\n'
        f"pub fn source() -> &'static [u8] {{ return {silk_bytes(entry)} }}\n"
        f"pub fn bootstrapSource() -> &'static [u8] {{ return builtinSource({count}) }}\n"
        f'pub fn builtinCount() -> usize {{ return {count} }}\n'
        "pub fn builtinName(index: usize) -> &'static [u8] {\n  return match index {\n" + arms + '    _ => b""\n  }\n}\n'
        "/// The service a built-in belongs to (docs/composable-runtime.md), `Core` for the core's.\n"
        "pub fn builtinService(index: usize) -> &'static [u8] {\n  return match index {\n" + services + '    _ => b"Core"\n  }\n}\n'
        "pub fn builtinSource(index: usize) -> &'static [u8] {\n  let mut length: usize = 0\n"
        '  let data = unsafe silk_builtin_source(index, Pointer.fromMutRef<usize>(&mut length))\n'
        '  return unsafe Pointer.borrowMany<u8, u8>(&ANCHOR, unsafe Pointer.assumeMany<u8>(data), length)\n}\n')
    print(f'Indexed {count} built-in modules')


if __name__ == '__main__':
    generate()
