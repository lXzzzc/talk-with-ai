# Local Computer MCP Tools

This package adds permission-gated Windows computer tools to an MCP-compatible agent such as Codex.

## Included tools

- Read-only: `computer_status`, `get_system_info`, `list_windows`, `get_cursor_position`, `capture_screen`
- Write-gated: `open_application`, `open_url`, `click_screen`, `type_text`

Write tools are disabled unless the MCP server process receives
`TALK_AI_TOOLS_WRITE_ENABLED=1`. URL opening can be restricted with a comma-separated
`TALK_AI_TOOLS_ALLOWED_HOSTS` allowlist.

## Local setup

```powershell
cd agent-tool-server
npm install
npm run check
npm run register:codex
```

Restart Codex after registration. Confirm the server with:

```powershell
codex mcp get talk-with-ai-computer --json
```

The registration script intentionally installs the read-only default. To opt into write tools,
remove and re-add the server explicitly:

```powershell
codex mcp remove talk-with-ai-computer
codex mcp add --env TALK_AI_TOOLS_WRITE_ENABLED=1 talk-with-ai-computer -- node "C:\absolute\path\to\agent-tool-server\dist\server.js"
```

Optionally add `--env TALK_AI_TOOLS_ALLOWED_HOSTS=localhost,example.com` before the server name.

## Safety model

- The server never offers arbitrary shell execution.
- Applications come from a fixed allowlist.
- URLs allow only HTTP(S), reject embedded credentials, and support a host allowlist.
- Text input is length-limited and must never contain secrets.
- Coordinate clicks and typing are marked as consequential actions and should be verified with a new screenshot.
- Tool errors return bounded messages and do not expose environment variables.

The current implementation is Windows-only. Browser DOM-level automation is intentionally outside this
MVP; add it later as separate Playwright tools with a dedicated browser profile and per-domain policy.
