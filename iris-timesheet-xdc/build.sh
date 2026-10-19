#!/usr/bin/env sh
# =====================================================================
# build.sh — packages the IRIS Timesheet webxdc app
# Generated with: Claude Opus 5.5 (claude-opus-5-5)
# ---------------------------------------------------------------------
# WHAT IT DOES   zips everything the app needs into iris-timesheet.xdc
#                (attach that file to a Delta Chat message to use it).
# DEPENDENCIES   `zip` command-line tool.
# RELATIONSHIP   packs index.html, styles.css, manifest.toml, icon.png,
#                js/*, vendor/*, form/iris-timesheet.pdf.
# =====================================================================
set -e
cd "$(dirname "$0")"
rm -f iris-timesheet.xdc
zip -9 -q -r iris-timesheet.xdc index.html styles.css manifest.toml icon.png js vendor form
echo "Built $(pwd)/iris-timesheet.xdc ($(wc -c < iris-timesheet.xdc) bytes)"
