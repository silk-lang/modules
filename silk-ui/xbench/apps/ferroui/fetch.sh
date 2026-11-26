#!/bin/bash
# usage: fetch.sh -> vendor/ferroui: wieslawsoltes/FerroUI at the pinned commit.
set -euo pipefail
D=$(cd "$(dirname "$0")" && pwd)
REV=${FERROUI_REV:-6ab3b81494d71f8c98a7f676d69c689d994f1533}
[[ -d $D/vendor/ferroui/.git ]] && { echo "vendor/ferroui exists: $(git -C "$D/vendor/ferroui" rev-parse HEAD)"; exit 0; }
mkdir -p "$D/vendor" && git init -q "$D/vendor/ferroui" && cd "$D/vendor/ferroui"
git remote add origin https://github.com/wieslawsoltes/FerroUI
git fetch -q --depth 1 origin $REV && git checkout -q FETCH_HEAD && git rev-parse HEAD
