# Model Context Protocol (MCP) for Sentinel


## Why MCP?
MCP servers let you use AI tools (like Copilot, Cursor, Windsurf) to query your local SQLite DB, Firestore cloud DB, fetch docs, and automate commits—without leaking sensitive data unintentionally.


## Required MCP Servers
- `sqlite-mcp-server`: For local DB queries (optional if using only Firestore)
- `firebase-mcp-server`: For Firestore and Firebase Auth queries
- `fetch` or `puppeteer`: For live docs
- `github-mcp`: (Optional) For auto-commits


## Usage
1. Start the MCP servers before coding.
2. Attach them in your AI tool.
3. Use the prompts in PROMPTS.md for each phase.
4. For cloud sync and authentication, ensure the `firebase-mcp-server` is running and configured with your Firebase project credentials.

## Troubleshooting
- If the AI gets stuck, check server logs.
- For DB issues, verify `sqlite-mcp-server` is running.
