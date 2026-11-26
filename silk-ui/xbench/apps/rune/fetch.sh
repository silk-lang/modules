#!/bin/bash
# usage: fetch.sh -> vendor/rune: anomalyco/rune, branch dev at the pinned commit.
set -euo pipefail
D=$(cd "$(dirname "$0")" && pwd)
REV=${RUNE_REV:-d170ff6e4a9691e3db0b0ad83e7e719b720afc84}
[[ -d $D/vendor/rune/.git ]] && { echo "vendor/rune exists: $(git -C "$D/vendor/rune" rev-parse HEAD)"; exit 0; }
mkdir -p "$D/vendor" && git init -q "$D/vendor/rune" && cd "$D/vendor/rune"
git remote add origin https://github.com/anomalyco/rune
git fetch -q --depth 1 origin $REV && git checkout -q FETCH_HEAD && git rev-parse HEAD
