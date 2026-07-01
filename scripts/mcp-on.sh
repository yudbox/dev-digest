#!/usr/bin/env bash
set -euo pipefail

SETTINGS_FILE="$(cd "$(dirname "$0")/.." && pwd)/.claude/settings.json"

node -e "
  const fs = require('fs');
  const path = '$SETTINGS_FILE';
  const settings = JSON.parse(fs.readFileSync(path, 'utf-8'));

  if (!Array.isArray(settings.disabledMcpjsonServers) || !settings.disabledMcpjsonServers.includes('devdigest')) {
    console.log(\"MCP server 'devdigest' is already enabled.\");
    process.exit(0);
  }

  settings.disabledMcpjsonServers = settings.disabledMcpjsonServers.filter(s => s !== 'devdigest');

  if (settings.disabledMcpjsonServers.length === 0) {
    delete settings.disabledMcpjsonServers;
  }

  fs.writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
  console.log(\"MCP server 'devdigest' enabled. Restart Claude Code session to apply.\");
"
