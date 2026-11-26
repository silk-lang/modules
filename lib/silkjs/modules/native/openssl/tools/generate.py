#!/usr/bin/env python3
"""Writes what OpenSSL's Configure would: generated/ and the native compilation plan in ../build.silk.

    python3 tools/generate.py <openssl source directory>

The directory is an unpacked release, the one [native.archive.openssl] pins. Configure runs
there for linux-x86_64 without assembly, which builds the same objects on every 64-bit Linux and
macOS target but one (engines/e_afalg.c, a Linux engine); the few settings that differ by system
are made conditional in the copies below. Needs perl and make.
"""
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys

PACKAGE = Path(__file__).resolve().parents[1]
GENERATED = PACKAGE / 'generated'
OPTIONS = ['no-asm', 'no-shared', 'no-module', 'no-tests', 'no-apps', 'no-docs']
# System paths compiled into the library: where it reads openssl.cnf and the system store.
PATHS = {'OPENSSLDIR': '/etc/ssl', 'ENGINESDIR': '/usr/local/lib/engines-3', 'MODULESDIR': '/usr/local/lib/ossl-modules'}
LINUX_ONLY = {'engines/e_afalg.c'}


def main():
    source = Path(sys.argv[1]).resolve()
    work = PACKAGE / 'build/configure'
    shutil.rmtree(work, ignore_errors=True)
    shutil.copytree(source, work)
    subprocess.run(['perl', 'Configure', 'linux-x86_64', *OPTIONS], cwd=work, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(['make', 'build_generated', 'crypto/buildinf.h'], cwd=work, check=True, stdout=subprocess.DEVNULL)
    commands = subprocess.run(['make', '-n', 'build_libs'], cwd=work, check=True, capture_output=True, text=True).stdout
    # Some sources and headers are written only on the way to the objects that need them.
    written = sorted(set(re.findall(r'> *((?:crypto|providers|include|ssl)/[^ ;]+\.[ch])\b', commands)))
    if written:
        subprocess.run(['make', *written], cwd=work, check=True, stdout=subprocess.DEVNULL)
    makefile = (work / 'Makefile').read_text().replace('\\\n', ' ')
    objects = []
    for library in ('libcrypto.a', 'libssl.a'):
        objects += re.search(r'^' + re.escape(library) + r':\s*(.*)$', makefile, re.M).group(1).split()
    compiles = {}
    for line in commands.splitlines():
        if ' -c -o ' not in line:
            continue
        words = shlex.split(line)
        if '-c' in words and '-o' in words:
            compiles[words[words.index('-o') + 1]] = words
    shutil.rmtree(GENERATED, ignore_errors=True)
    original = {p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file()}
    for path in sorted(work.rglob('*')):
        name = path.relative_to(work).as_posix()
        if path.is_file() and name not in original and path.suffix in ('.h', '.c') and not name.startswith(('test/', 'apps/', 'fuzz/')):
            destination = GENERATED / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(neutral(name, path.read_text()))
    groups = {}
    for target in objects:
        words = compiles[target]
        file = words[-1]
        includes, flags = [], ['-O2', '-w', '-D_REENTRANT']
        for word in words[1:-1]:
            if word.startswith('-I'):
                directory = word[2:]
                directory = '' if directory == '.' else directory
                if (GENERATED / directory).is_dir():
                    includes.append(('generated/' + directory).rstrip('/'))
                includes.append('silkjs-openssl:' + directory)
            elif word.startswith('-D'):
                key = word[2:].split('=')[0]
                flags.append(f'-D{key}="{PATHS[key]}"' if key in PATHS else word)
        path = 'generated/' + file if (GENERATED / file).is_file() else 'silkjs-openssl:' + file
        system = '"linux"' if file in LINUX_ONLY else '["linux", "macos"]'
        groups.setdefault((tuple(includes), tuple(flags), system), []).append(path)
    # Each group of at most 100 files is its own constant: a constant is evaluated within its own
    # static step budget, which one plan of every file would exceed.
    chunks = []
    for (includes, flags, system), files in groups.items():
        for archived in (True, False):
            kind = [file for file in files if file.startswith('silkjs-openssl:') == archived]
            for start in range(0, len(kind), 100):
                chunks.append((includes, flags, system, kind[start:start + 100]))
    entries = ['import silk.build.plan { Library, Plan }\nimport silk.build.step { sourcePath }\n\n']
    for number, (includes, flags, system, files) in enumerate(chunks):
        condition = 'Intrinsic.targetOperatingSystem() == "linux"'
        if system != '\"linux\"':
            condition += ' || Intrinsic.targetOperatingSystem() == "darwin"'
        archive = files[0].startswith('silkjs-openssl:')
        names = [file.split(':', 1)[1] if archive else file for file in files]
        path = 'Plan.archivePath("silkjs-openssl", files[at])' if archive else 'sourcePath(files[at])'
        entries.append('// Files that compile with the same flags and include directories.\n'
                       f'static fn group{number}(start: Plan) -> Plan {{\n  if !({condition}) {{\n    return start\n  }}\n'
                       f'  let files: [string; {len(names)}] = [\n' + ''.join(f'    {literal(name)},\n' for name in names)
                       + '  ]\n  let mut plan = start\n  let mut at: usize = 0\n  while at < files.length {\n'
                       + f'    plan = plan |> Plan.compileNative("c", {path}, &['
                       + ', '.join(literal(f) for f in flags) + '], &['
                       + ', '.join(plan_path(i) for i in includes) + '])\n    at = at + 1\n  }\n  return plan\n}\n\n')
    entries.append('// Each group is its own constant, so each is evaluated within its own static step budget.\n')
    previous = 'Plan.empty()'
    for number in range(len(chunks)):
        entries.append(f'const STEP_{number}: Plan = group{number}({previous})\n')
        previous = f'STEP_{number}'
    entries.append(f'\nstatic fn plan() -> Plan {{\n  let mut plan = {previous}\n'
                   '  if Intrinsic.targetOperatingSystem() == "linux" {\n'
                   '    plan = plan |> Plan.linkLibrary("pthread", Library.dynamicSearch())\n'
                   '    plan = plan |> Plan.linkLibrary("dl", Library.dynamicSearch())\n  }\n'
                   '  return plan\n}\n\npub const PLAN: Plan = plan()\n')
    (PACKAGE / 'build.silk').write_text(''.join(entries))
    shutil.rmtree(PACKAGE / 'build', ignore_errors=True)
    print(f'{len(objects)} objects in {len(chunks)} groups')
    subprocess.run(['silk', 'format', str(PACKAGE / 'build.silk')], check=True)


def plan_path(text):
    if text.startswith("silkjs-openssl:"):
        return 'Plan.archivePath("silkjs-openssl", ' + literal(text.split(":", 1)[1]) + ")"
    return "sourcePath(" + literal(text) + ")"


def literal(text):
    return '"' + text.replace('\\', '\\\\').replace('"', '\\"') + '"'


def neutral(name, text):
    """The generated file for every target: what Configure wrote for one made conditional."""
    if name == 'include/openssl/configuration.h':
        marker = '# ifndef OPENSSL_SYS_'
        text = text.replace('#ifdef  __cplusplus', '#ifdef  __cplusplus', 1)
        addition = ('# if defined(__APPLE__) && !defined(OPENSSL_SYS_MACOSX)\n#  define OPENSSL_SYS_MACOSX 1\n# endif\n'
                    '# if !defined(__linux__) && !defined(OPENSSL_NO_AFALGENG)\n#  define OPENSSL_NO_AFALGENG\n# endif\n')
        at = text.index('# define OPENSSL_CONFIGURED_API')
        text = text[:at] + addition + text[at:]
    elif name == 'include/crypto/dso_conf.h':
        text = text.replace('# define DSO_EXTENSION ".so"', '# ifdef __APPLE__\n#  define DSO_EXTENSION ".dylib"\n# else\n#  define DSO_EXTENSION ".so"\n# endif')
    elif name == 'crypto/buildinf.h':
        text = re.sub(r'#define PLATFORM .*', '#if defined(__APPLE__)\n#define PLATFORM "platform: darwin64"\n#else\n#define PLATFORM "platform: linux"\n#endif', text)
        text = re.sub(r'#define DATE .*', '#define DATE "built on: reproducible build"', text)
        text = re.sub(r'static const char compiler_flags\[\] = \{.*?\};', "static const char compiler_flags[] = {\n    'c','o','m','p','i','l','e','r',':',' ','c','l','a','n','g','\\0'\n};", text, flags=re.S)
    return text


if __name__ == '__main__':
    main()
