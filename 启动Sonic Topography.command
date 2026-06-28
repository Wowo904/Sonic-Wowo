#!/bin/zsh
set -e

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but was not found."
  echo "Install Node.js from https://nodejs.org/ and run this again."
  read -r "?Press Enter to close..."
  exit 1
fi

if [ ! -d node_modules ]; then
  npm ci
fi

if [ ! -d dist ]; then
  npm run build
fi

open "http://127.0.0.1:4173"
npm start
