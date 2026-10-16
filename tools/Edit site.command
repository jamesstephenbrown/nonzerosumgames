#!/bin/bash
# Double-click this to start the editor and open the site.
# (If you installed the launcher with install-launcher.sh, you never need this -
#  the editor is already running.)
cd "$(dirname "$0")/.."
open "http://localhost:4000/index.html?edit=1" &
exec /usr/bin/python3 tools/edit-server.py
