#!/bin/bash
# usage: SILKUI=<silkui checkout> silk-native-build.sh <app dir> [scene ...]
# Builds a Silk-native xbench app (silk-direct, silk-loom) against the Silk UI checkout: writes
# its silk.toml from silk.toml.in with the library revisions that checkout pins, gives it the
# corpus, the pictures and the compiled stylesheet (from apps/react: the same sheet the React
# build embeds), builds release, and copies the binary to out/<scene>/ for each scene (one
# binary serves every scene: the scene is its first argument).
set -euo pipefail
APP=$(cd "$1" && pwd); shift; NAME=$(basename "$APP")
XB=$(cd "$(dirname "$0")/.." && pwd); WEB=$XB/apps/react/web
# The Silk UI checkout to build against: by default the one this suite lives in.
SILKUI=${SILKUI:-$(cd "$(dirname "$0")/../.." && pwd)}
scenes=("$@"); [[ ${#scenes[@]} -gt 0 ]] || scenes=(feed wall stream churn)
W=$SILKUI/modules/tree/window/silk.toml
pin() { grep -m1 -oE "$1\.git\", rev = \"[0-9a-f]{40}\", path = \"$2\"" "$W" | grep -oE '[0-9a-f]{40}'; }
# Loom pins Silk UI by revision: the one its window module names (mapped to $SILKUI in the Silk home).
LOOM_SILKUI=$([[ -n "${LOOM:-}" ]] && grep -m1 -oE 'silkui.git", rev = "[0-9a-f]{40}' "$LOOM/modules/loom/window/silk.toml" | grep -oE '[0-9a-f]{40}' || true)
# Point the Silk home's git cache for that revision at $SILKUI, so Loom builds against the same
# Silk UI as the other apps (and without fetching Loom's pin).
if [[ -n "$LOOM_SILKUI" ]]; then
  CACHE=${SILK_HOME:-$HOME/.silk}/git
  mkdir -p "$CACHE"
  if [[ ! -e "$CACHE/$LOOM_SILKUI" || -L "$CACHE/$LOOM_SILKUI" ]]; then
    ln -sfn "$SILKUI" "$CACHE/$LOOM_SILKUI"
    printf 'https://github.com/silk-lang/silkui.git\n%s\n' "$LOOM_SILKUI" > "$CACHE/$LOOM_SILKUI.fetched"
  else
    echo "note: $CACHE/$LOOM_SILKUI is a real checkout, not \$SILKUI; Loom builds against it" >&2
  fi
fi
VERSION=$(grep -m1 -oh '"0\.1\.0-dev\.[^"]*"' "$W" "$SILKUI/silk.toml" | head -1 | tr -d '"')
sed -e "s#@SILKUI@#$SILKUI#g" -e "s#@SILK_VERSION@#$VERSION#g" \
    -e "s#@LIB_FONTS@#$(pin lib-fonts modules/collection)#g" -e "s#@LIB_GRAPHICS@#$(pin lib-graphics modules/atlas)#g" \
    -e "s#@LIB_NATIVE_WINDOW@#$(pin lib-native modules/platform/window)#g" -e "s#@LIB_NATIVE_GPU@#$(pin lib-native modules/gpu/webgpu)#g" \
    -e "s#@LOOM@#${LOOM:-}#g" -e "s#@LOOM_SILKUI@#$LOOM_SILKUI#g" \
    "$APP/silk.toml.in" > "$APP/silk.toml"
mkdir -p "$APP/assets"
cp "$XB/content/corpus.txt" "$APP/assets/corpus.txt"
for i in 0 1 2 3; do printf 'data:image/png;base64,%s' "$(base64 -w0 "$XB/assets/images/picture-$i.png" 2>/dev/null || base64 -i "$XB/assets/images/picture-$i.png")" > "$APP/assets/picture-$i.dataurl"; done
# The stylesheet: @silkui/vite's compile of style/bench.css (fonts inside as data URLs).
if [[ ! -f "$WEB/dist-silk/feed/app.sheet" ]]; then
  "$XB/apps/silk-react/build.sh" --sheet-only
fi
cp "$WEB/dist-silk/feed/app.sheet" "$APP/assets/app.sheet"
(cd "$APP" && silk build --release --progress plain > "$APP/build.log" 2>&1) || { grep -a -A6 -E "error|warning" "$APP/build.log" | head -80; exit 1; }
bin=$(ls "$APP"/build/*/release/"$NAME")
for scene in "${scenes[@]}"; do
  mkdir -p "$APP/out/$scene"; cp "$bin" "$APP/out/$scene/$NAME"
  [[ $(uname) == Darwin ]] && codesign -f -s - "$APP/out/$scene/$NAME" > /dev/null 2>&1 || true
done
rev() { git -C "$1" rev-parse --short=10 HEAD 2>/dev/null || echo unknown; }
printf '{"silkui": "%s", "silkui_path": "%s", "silk": "%s", "loom": "%s", "built": "%s"}\n' "$(rev "$SILKUI")" "${SILKUI/#$HOME/~}" "$VERSION" "${LOOM:+$(rev "$LOOM")}" "$(date -u +%FT%TZ)" > "$APP/VERSION"
echo "built $NAME"
