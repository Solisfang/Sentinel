# Sentinel Architecture Overview

## Folder Structure

```
/Sentinel
├── /docs                    # Documentation
│   ├── Plan.md             # Master plan and phase tracking
│   ├── PROMPTS.md          # AI prompts for each phase
│   ├── ARCHITECTURE.md     # This file
│   ├── SETUP.md            # Setup instructions
│   └── ...
│
├── /Sentinel.Engine         # C# .NET 8 WPF Backend
│   ├── MainWindow.xaml      # Window layout with WebView2
│   ├── MainWindow.xaml.cs   # Window logic, messaging
│   ├── UserActivityMonitor.cs # Idle detection
│   ├── SettingsService.cs   # Settings persistence
│   ├── FirebaseService.cs   # Firebase Admin SDK
│   ├── SentinelDbContext.cs # EF Core SQLite
│   ├── DistractionRepository.cs # DB operations
│   └── Models.cs            # Data entities
│
└── /Sentinel.UI             # React + TypeScript Frontend
    ├── src/
    │   ├── App.tsx          # Main app component
    │   ├── firebase.ts      # Firebase client config
    │   └── index.css        # Tailwind styles
    ├── package.json
    └── vite.config.ts
```

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Windows Desktop                           │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              Sentinel.Engine.exe (WPF)                  │ │
│  │  ┌─────────────────────────────────────────────────┐    │ │
│  │  │            WebView2 Control                      │    │ │
│  │  │  ┌─────────────────────────────────────────────┐ │    │ │
│  │  │  │         React App (Sentinel.UI)             │ │    │ │
│  │  │  │                                             │ │    │ │
│  │  │  │  ┌─────────┐  ┌─────────┐  ┌─────────┐    │ │    │ │
│  │  │  │  │  Timer  │  │Settings │  │  Auth   │    │ │    │ │
│  │  │  │  └─────────┘  └─────────┘  └─────────┘    │ │    │ │
│  │  │  │                                             │ │    │ │
│  │  │  └─────────────────────────────────────────────┘ │    │ │
│  │  └─────────────────────────────────────────────────┘    │ │
│  │                                                         │ │
│  │  ┌──────────────────┐  ┌──────────────────────────┐    │ │
│  │  │UserActivityMonitor│  │   SettingsService       │    │ │
│  │  │ (Idle Detection)  │  │   (JSON Persistence)    │    │ │
│  │  └──────────────────┘  └──────────────────────────┘    │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
           │                           │
           ▼                           ▼
    ┌──────────────┐          ┌──────────────────┐
    │   SQLite     │          │   Firebase        │
    │   (Local)    │          │   (Cloud)         │
    │              │          │ ┌──────────────┐  │
    │ • sessions   │          │ │  Firestore   │  │
    │ • distractions│         │ │  • sessions  │  │
    └──────────────┘          │ │  • distracts │  │
                              │ └──────────────┘  │
                              │ ┌──────────────┐  │
                              │ │  Auth        │  │
                              │ │  • users     │  │
                              │ └──────────────┘  │
                              └──────────────────┘
```

---

## Data Flow

### 1. Timer Flow
```
User clicks Start → React updates state → Timer counts down
Timer hits 0 → Session saved to SQLite → If cloud sync: save to Firestore
```

### 2. Idle Detection Flow (Current)
```
C# polls GetLastInputInfo every 1s
  ↓
Idle > threshold?
  ↓ YES
PostWebMessageAsJson({ type: 'IDLE_DETECTED' })
  ↓
React shows Intervention Modal (timer keeps running - BUG)
  ↓
User types distraction + Enter
  ↓
postMessage({ type: 'LOG_DISTRACTION', note: '...' })
  ↓
C# saves to SQLite → If cloud sync: save to Firestore
```

### 2b. Idle Detection Flow (Phase 4 - Improved)
```
C# polls GetLastInputInfo every 1s
  ↓
Idle > threshold? AND not snoozed?
  ↓ YES
PostWebMessageAsJson({ type: 'IDLE_DETECTED' })
  ↓
React PAUSES TIMER + shows Intervention Modal
  ↓
User selects option:
  ├─ "Log Distraction" → save to DB → resume timer
  ├─ "False Alarm" → no save → resume timer
  ├─ "Snooze X min" → set snooze state → resume timer
  └─ "Watching Content" → long snooze → resume timer
  ↓
If snoozed: C# suppresses idle events for N minutes
```

### 3. Settings Flow
```
User changes setting in React UI
  ↓
postMessage({ type: 'SAVE_SETTINGS', settings: {...} })
  ↓
C# receives message → Updates in-memory settings
  ↓
SettingsService.Save() → writes to settings.json
  ↓
Settings applied immediately (e.g., idle threshold, always on top)
```

---

## Key Components

### C# Backend

| Component | Responsibility |
|-----------|---------------|
| `MainWindow` | WPF window, WebView2 host, message routing |
| `UserActivityMonitor` | P/Invoke `GetLastInputInfo`, fires idle events |
| `SettingsService` | Load/save settings to JSON file |
| `DistractionRepository` | CRUD operations on SQLite |
| `SentinelDbContext` | EF Core context for SQLite |
| `FirebaseService` | Firebase Admin SDK initialization |

### React Frontend

| Component | Responsibility |
|-----------|---------------|
| `App.tsx` | Main app, timer logic, state management |
| Timer View | Pomodoro countdown, mode switching |
| Settings View | Configure timer, idle, sync options |
| Auth View | Firebase email/password login |
| Intervention Modal | Distraction input prompt |

---

## WebView2 Message Protocol

### C# → React Messages

| Type | Payload | Purpose |
|------|---------|---------|
| `SETTINGS_LOADED` | `{ settings: {...} }` | Initial settings on page load |
| `IDLE_DETECTED` | `{}` | Trigger intervention modal |

### React → C# Messages

| Type | Payload | Purpose |
|------|---------|---------|
| `LOG_DISTRACTION` | `{ note: string }` | Save distraction |
| `SAVE_SETTINGS` | `{ settings: {...} }` | Persist settings |
| `GET_SETTINGS` | `{}` | Request current settings |

---

## Storage Locations

| Data | Location | Format |
|------|----------|--------|
| User Settings | `%LOCALAPPDATA%\Sentinel\settings.json` | JSON |
| Local Database | `%LOCALAPPDATA%\Sentinel\sentinel.db` | SQLite |
| Cloud Sessions | Firestore `sessions` collection | Document |
| Cloud Distractions | Firestore `distractions` collection | Document |

---

## Security Considerations

- **Local-First**: All data stored locally by default
- **Opt-In Sync**: Cloud sync requires explicit user consent
- **No Keylogging**: Uses `GetLastInputInfo` (passive polling), not hooks
- **Firebase Auth**: Secure email/password authentication
- **Credential Security**: Firebase service account JSON should never be committed
