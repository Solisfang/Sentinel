# Model Context Protocol (MCP) for Sentinel

## Why MCP?
MCP servers let you use AI tools (like Copilot, Cursor, Windsurf) to query your local SQLite DB, fetch docs, and automate commits—without leaking data.

## Required MCP Servers
- `sqlite-mcp-server`: For DB queries
- `fetch` or `puppeteer`: For live docs
- `github-mcp`: (Optional) For auto-commits

## Usage
1. Start the MCP servers before coding.
2. Attach them in your AI tool.
3. Use the prompts in PROMPTS.md for each phase.

## Troubleshooting
- If the AI gets stuck, check server logs.
- For DB issues, verify `sqlite-mcp-server` is running.
