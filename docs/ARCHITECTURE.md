# Sentinel Architecture Overview

## Folder Structure
```
/Sentinel
  ├── /Sentinel.UI      (Vite + React + TypeScript + Tailwind + Recharts)
  └── /Sentinel.Engine  (C# .NET 8 WPF + WebView2 + SQLite)
```

## System Flow
1. User interacts with the React UI overlay.
2. C# backend manages window, idle detection, and SQLite storage.
3. WebView2 bridges C# and React via messaging.
4. MCP servers enable AI-assisted coding and DB inspection.

## Key Components
- **Idle Detection**: C# polls hardware input.
- **Intervention Modal**: React UI prompts user on distraction.
- **Session Logging**: All data stored locally in SQLite.
