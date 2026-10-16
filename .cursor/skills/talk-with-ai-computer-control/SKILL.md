---
name: talk-with-ai-computer-control
description: Safely inspects and controls the local Windows computer through the talk-with-ai-computer MCP tools. Use when the user asks to view the desktop, list windows, take a screenshot, open an allowlisted app or URL, click, or type text.
---

# Talk With AI Computer Control

## Workflow

1. Call `computer_status` before the first computer action.
2. For inspection, prefer `list_windows` and `capture_screen`.
3. Before clicking, capture the screen and calculate the coordinate from the current image. Never reuse coordinates after the window layout changes.
4. Before typing, verify that the intended control is focused. Never type passwords, API keys, payment data, personal identifiers, or other secrets.
5. Treat opening applications or URLs, clicking, and typing as write actions. If write actions are disabled, explain the local opt-in setting; do not bypass it.
6. After a write action, capture the screen again and verify the expected result before continuing.
7. Stop after two repeated failures and report the observable state.

## Boundaries

- Do not use the tools to send messages, submit purchases, change security settings, delete data, or approve irreversible actions unless the user explicitly requests that exact action and the host requests confirmation.
- Do not attempt arbitrary shell execution; this server intentionally does not expose it.
- Prefer browser- or application-specific APIs when they provide stronger element identity than screen coordinates.
