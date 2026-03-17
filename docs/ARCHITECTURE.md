# Sentinel Architecture Overview

## Folder Structure
```
```
/Sentinel
  ├── /Sentinel.UI      (Vite + React + TypeScript + Tailwind + Recharts + Firebase)
  └── /Sentinel.Engine  (C# .NET 8 WPF + WebView2 + SQLite + Firebase)
```
```


## System Flow
1. User interacts with the React UI overlay.
2. C# backend manages window, idle detection, and local SQLite storage.
3. WebView2 bridges C# and React via messaging.
4. Firebase Auth manages user identity and login.
5. Firestore provides cloud sync for session data and distractions, enabling cross-device access and backup.
6. MCP servers enable AI-assisted coding and DB inspection.

## Key Components
- **Idle Detection**: C# polls hardware input.
- **Intervention Modal**: React UI prompts user on distraction.
- **Session Logging**: Data is stored both locally (SQLite) and synced to Firestore for backup and multi-device support.
- **Authentication**: Firebase Auth provides secure, privacy-respecting user login.
