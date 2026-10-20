# Local Computer MCP Tools

This package adds permission-gated Windows computer tools to an MCP-compatible agent such as Codex.

## Included tools

- Read-only: `computer_status`, `get_system_info`, `list_windows`, `get_cursor_position`, `capture_screen`
- Write-gated: `open_application`, `open_url`, `click_screen`, `type_text`
- Windows-MCP read-only bridge: `windows_mcp_status`, `list_displays`, `inspect_desktop`,
  `capture_desktop`, `wait_for_ui`
- Windows-MCP write-gated bridge: `launch_installed_application`

Write tools are disabled unless the MCP server process receives
`TALK_AI_TOOLS_WRITE_ENABLED=1`. URL opening can be restricted with a comma-separated
`TALK_AI_TOOLS_ALLOWED_HOSTS` allowlist.

## Local setup

```powershell
cd agent-tool-server
npm install
npm run check
npm run check:windows-mcp
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
MVP for the built-in tools. The Windows-MCP bridge can inspect the active Chrome, Edge, or Firefox page
through `inspect_desktop({ useDom: true })` while keeping execution local.

## Windows-MCP bridge

The bridge starts the pinned `windows-mcp==0.8.8` package lazily through `uvx` over stdio. It does not
listen on a TCP port. Python 3.14+ and `uvx` must be available on the local Windows computer.

The child process is restricted to `ControlStatus`, `DisplayInventory`, `Snapshot`, `Screenshot`, `App`,
and `WaitFor`. Anonymous telemetry is disabled and the upstream desktop-control policy is set to `strict`.
The wrapper further restricts `App` to Start Menu name launches only; executable paths and arguments are
not exposed.

To disable the bridge, set `TALK_AI_WINDOWS_MCP_ENABLED=0`. If `uvx.exe` is not on PATH, set
`TALK_AI_WINDOWS_MCP_UVX_PATH` to its absolute path. Application launch also requires the existing
`TALK_AI_TOOLS_WRITE_ENABLED=1` opt-in.
