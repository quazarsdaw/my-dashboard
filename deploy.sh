#!/bin/bash
# Deploy dashboard to Windows server
# Usage: ./deploy.sh user@server-ip
#
# First time: run setup on the server (see DEPLOY.md)
# After that: just run this script to update files

set -e

if [ -z "$1" ]; then
  echo "Usage: ./deploy.sh user@server-ip"
  echo "Example: ./deploy.sh kirill@192.168.1.100"
  exit 1
fi

SERVER="$1"
REMOTE_DIR="C:/dashboard"
FILES="index.html tracker.html health.html gym.html finance.html goals.html store.html profile.html gamification.js topbar.js"

echo "Deploying to $SERVER:$REMOTE_DIR ..."

for f in $FILES; do
  scp "$f" "$SERVER:$REMOTE_DIR/$f"
  echo "  uploaded $f"
done

echo ""
echo "Done! Dashboard updated at http://$(echo $SERVER | cut -d@ -f2):8080"
