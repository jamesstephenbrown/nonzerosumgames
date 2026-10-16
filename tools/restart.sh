#!/bin/bash
# Restart the editor so it picks up new code.
#
#   bash tools/restart.sh
#
# Handles both ways of running it: under launchd (where Ctrl-C is useless,
# because KeepAlive restarts it immediately), or as a plain process you started
# in a Terminal.

LABEL="games.nonzerosum.editor"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ -f "$PLIST" ] && launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    launchctl kickstart -k "gui/$(id -u)/$LABEL"
    echo "Restarted via launchd."
else
    PIDS=$(lsof -ti:4000 2>/dev/null)
    if [ -n "$PIDS" ]; then
        kill $PIDS 2>/dev/null
        sleep 1
        kill -9 $PIDS 2>/dev/null
        echo "Stopped stray process on port 4000."
    fi
    echo "Starting..."
    cd "$(dirname "$0")/.."
    nohup /usr/bin/python3 tools/edit-server.py >/tmp/nzsg-editor.log 2>&1 &
    disown
fi

sleep 1
if curl -fsS -o /dev/null http://localhost:4000/ 2>/dev/null; then
    echo "Running at http://localhost:4000"
else
    echo "Not answering yet. Check /tmp/nzsg-editor.log"
fi
