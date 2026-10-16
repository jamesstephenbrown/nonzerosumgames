#!/bin/bash
# Make the editor start itself at login, so it is simply always there.
#
#   bash tools/install-launcher.sh          install (or re-install after moving the repo)
#   bash tools/install-launcher.sh remove   stop it and remove it from login
#
# Run this once per Mac. The plist is generated with this repo's actual path,
# so a clone in a different place on another machine just works.

set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="games.nonzerosum.editor"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ "$1" = "remove" ]; then
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Removed. The editor will no longer start at login."
    exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents"
sed "s|__DIR__|$DIR|g" "$DIR/tools/editor.launchagent.plist" > "$PLIST"

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

sleep 1
if curl -fsS -o /dev/null http://localhost:4000/ 2>/dev/null; then
    echo "Running at http://localhost:4000 and will start automatically at login."
else
    echo "Installed, but it did not answer on port 4000. Check /tmp/nzsg-editor.log"
fi
echo "Site: $DIR"
