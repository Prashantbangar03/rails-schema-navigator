#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMG="$ROOT/images"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [[ ! -x "$CHROME" ]]; then
  echo "Google Chrome required for screenshots" >&2
  exit 1
fi

shot() {
  local html="$1" out="$2" w="$3" h="$4"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --window-size="${w},${h}" \
    --screenshot="$out" \
    "file://${html}"
  echo "wrote $out"
}

shot "$IMG/icon-render.html" "$IMG/icon.png" 128 128
shot "$IMG/demo-mock.html" "$IMG/hero.png" 1280 800
shot "$IMG/demo-compare-mock.html" "$IMG/compare.png" 1280 720

# Animated GIF: capture frames from demo-animated.html
FRAMES_DIR="$IMG/frames"
rm -rf "$FRAMES_DIR"
mkdir -p "$FRAMES_DIR"
for i in $(seq 0 15); do
  sleep 0.35
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --window-size=1280,800 \
    --screenshot="$FRAMES_DIR/frame-$(printf '%02d' "$i").png" \
    "file://${IMG}/demo-animated.html" 2>/dev/null || true
done

node "$ROOT/scripts/make-gif.mjs" "$FRAMES_DIR" "$IMG/demo.gif"
echo "done"
