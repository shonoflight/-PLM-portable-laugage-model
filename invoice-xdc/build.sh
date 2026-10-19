#!/usr/bin/env sh
# build.sh — packages the invoice webxdc app
# Generated with Claude Opus 5.5 (Claude Code)
#
# Summary: zips index.html + manifest.toml (+ icon.png if present) into
#          invoice.xdc, which can be attached to a Delta Chat message.
# Dependencies: `zip` command-line tool.
# Related files: index.html (the app), manifest.toml (app name).
set -e
cd "$(dirname "$0")"
rm -f invoice.xdc
FILES="index.html manifest.toml"
[ -f icon.png ] && FILES="$FILES icon.png"
zip -9 invoice.xdc $FILES
echo "Built $(pwd)/invoice.xdc"
