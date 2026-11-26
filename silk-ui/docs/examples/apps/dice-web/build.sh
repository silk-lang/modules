#!/bin/sh
# Builds the page into dist/ and, with `serve`, serves it on http://localhost:8018.
set -e
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../.." && pwd)"

cd "$root"
silk build --manifest-path "$here/silk.toml" \
  --target wasm32-unknown-unknown --optimization size --debug false

rm -rf "$here/dist"
mkdir -p "$here/dist"
cp "$root/build/wasm32-unknown-unknown/size/dice-web.wasm" "$here/dist/dice.wasm"
dom="$(silk package-path --manifest "$here/silk.toml" --dependency loom_dom --path js/silk-ui-dom.js | python3 -c 'import json,sys; print(json.load(sys.stdin))')"
cp "$dom" "$here/dist/silk-ui-dom.js"
cp "$here/web/index.html" "$here/dist/index.html"
echo "Built $here/dist"

if [ "$1" = "serve" ]; then
  cd "$here/dist"
  exec python3 -m http.server 8018
fi
