#!/usr/bin/env python3
"""Prints the executable a package build last wrote, from the request it published.

A package build (`silk build` in a package) names its output in the workspace's build/requests;
tools/build.py, tests/embed-smoke.py and CI read it here: python3 tools/built.py PACKAGE [--release]
"""
import sys
import tomllib
from pathlib import Path

REQUESTS = Path(__file__).resolve().parents[3] / 'build/requests'


def built(package, release=False):
    profile = 'release' if release else 'dev'
    requests = sorted(REQUESTS.glob(f'{package}.*.{profile}.toml'), key=lambda path: path.stat().st_mtime)
    if not requests:
        raise SystemExit(f'the build published no request for {package}')
    return Path(tomllib.loads(requests[-1].read_text())['output'])


if __name__ == '__main__':
    print(built(sys.argv[1], '--release' in sys.argv[2:]))
