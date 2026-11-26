#!/bin/sh
# Writes a .css file from every .input.css file here. Run it after changing
# the classes in src/core/plans_tailwind.silk or inbox_tailwind.silk: the outputs are committed,
# so the docs build needs no Tailwind.
set -e
cd "$(dirname "$0")"
tools="${TMPDIR:-/tmp}/silkui-docs-tailwind"
mkdir -p "$tools"
npm install --silent --prefix "$tools" --no-audit --no-fund tailwindcss@4.3.5 @tailwindcss/cli@4.3.5
for input in *.input.css; do
  NODE_PATH="$tools/node_modules" "$tools/node_modules/.bin/tailwindcss" -i "$input" -o "${input%.input.css}.css"
done
python3 sync.py
