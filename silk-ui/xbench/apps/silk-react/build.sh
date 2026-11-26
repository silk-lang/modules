#!/bin/bash
# usage: SILKUI=<silkui checkout> [SILK_HOME=...] build.sh [scene ...]
# Builds the React scenes on Silk UI: for each scene, the Vite build of ../react/web with
# @silkui/vite (VITE_XB_SCENE=<scene>), then the host package in host/ embedding it, release.
# Writes out/<scene>/silk-react and VERSION (what it was built from).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); XB=$(cd "$HERE/../.." && pwd); WEB=$XB/apps/react/web
# The Silk UI checkout to build against: by default the one this suite lives in.
SILKUI=${SILKUI:-$(cd "$(dirname "$0")/../../.." && pwd)}
scenes=("$@"); [[ ${#scenes[@]} -gt 0 ]] || scenes=(feed wall stream churn canvas chat input)
VERSION=$(grep -m1 -oh '"0\.1\.0-dev\.[^"]*"' "$SILKUI/modules/silkui/window/silk.toml" "$SILKUI/silk.toml" | head -1 | tr -d '"')
(cd "$WEB" && [[ -d node_modules/vite ]] || npm ci --no-audit --no-fund)
mkdir -p "$WEB/node_modules/@silkui"
for p in core react vite; do rm -rf "$WEB/node_modules/@silkui/$p"; cp -R "$SILKUI/modules/js/packages/$p" "$WEB/node_modules/@silkui/$p"; done
if [[ ${scenes[0]} == --sheet-only ]]; then
  (cd "$WEB" && SILK_PACKAGES=1 VITE_XB_SCENE=feed npx vite build > /dev/null); exit 0
fi
sed -e "s#@SILKUI@#$SILKUI#" -e "s#@SILK_VERSION@#$VERSION#" "$HERE/host/silk.toml.in" > "$HERE/host/silk.toml"
for scene in "${scenes[@]}"; do
  (cd "$WEB" && SILK_PACKAGES=1 VITE_XB_SCENE=$scene npx vite build > /dev/null)
  cp "$WEB/dist-silk/$scene/app.js" "$WEB/dist-silk/$scene/app.sheet" "$HERE/host/"
  (cd "$HERE/host" && silk build --release --progress plain > "$HERE/build-$scene.log" 2>&1) || { tail -30 "$HERE/build-$scene.log"; exit 1; }
  bin=$(ls "$HERE"/host/build/*/release/xbench-react)
  mkdir -p "$HERE/out/$scene"; cp "$bin" "$HERE/out/$scene/silk-react"
  [[ $(uname) == Darwin ]] && codesign -f -s - "$HERE/out/$scene/silk-react" > /dev/null 2>&1 || true
  echo "built silk-react $scene"
done
rev() { git -C "$1" rev-parse --short=10 HEAD 2>/dev/null || echo unknown; }
printf '{"silkui": "%s", "silkui_path": "%s", "silk": "%s", "built": "%s"}\n' "$(rev "$SILKUI")" "${SILKUI/#$HOME/~}" "$VERSION" "$(date -u +%FT%TZ)" > "$HERE/VERSION"
