#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node.js 24 or newer required")'
npm ci --cache "${npm_config_cache:-/workspace/.npm-cache}" --no-audit --no-fund
npm run build
