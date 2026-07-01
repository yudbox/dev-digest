#!/usr/bin/env bash
set -euo pipefail

SETTINGS_FILE="$(cd "$(dirname "$0")/.." && pwd)/.claude/settings.json"

node -e "
  const fs = require('fs');
  const path = '$SETTINGS_FILE';
  const settings = JSON.parse(fs.readFileSync(path, 'utf-8'));

  if (!Array.isArray(settings.disabledMcpjsonServers)) {
    settings.disabledMcpjsonServers = [];
  }

  if (!settings.disabledMcpjsonServers.includes('devdigest')) {
    settings.disabledMcpjsonServers.push('devdigest');
    fs.writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
    console.log(\"MCP server 'devdigest' disabled. Restart Claude Code session to apply.\");
  } else {
    console.log(\"MCP server 'devdigest' is already disabled.\");
  }
"
