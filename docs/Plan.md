# Sentinel: Vibe Coding Master Plan

## Project Status

| Phase | Description | Status | Priority |
|-------|-------------|--------|----------|
| Phase 1 | C# Backend + Idle Detection + Firebase | ✅ Complete | - |
| Phase 2 | React UI + Timer + Intervention Modal | ✅ Complete | - |
| Phase 3 | WebView2 Bridge + SQLite + Settings | ✅ Complete | - |
| **Phase 4** | **UX Polish & Intervention Flow** | 🔲 Pending | **HIGH** |
| Phase 5 | Reporting & Analytics Dashboard | 🔲 Pending | Medium |
| Phase 6 | Production Build & Distribution | 🔲 Pending | Medium |
| Phase 7 | Advanced Features | 🔲 Pending | Low |
| Phase 8 | Polish & Optimization | 🔲 Pending | Low |

---

## Critical UX Issues to Fix (Phase 4)

### 🔴 High Priority

| Issue | Current State | Required Fix |
|-------|---------------|--------------|
| Timer during intervention | Keeps running | Should PAUSE when modal appears |
| False alarm handling | None | Add "False Alarm" button to dismiss without logging |
| Snooze feature | None | Add snooze (5/10/30 min) to suppress idle detection |
| Tutorial/content mode | None | "Watching Content" mode to suppress for longer |
| Custom timer durations | Only Pomodoro configurable | Allow all modes to be customized |

### 🟡 Medium Priority

| Issue | Current State | Required Fix |
|-------|---------------|--------------|
| Visual design | Dark but basic | Glassmorphism, better transparency |
| Button styling | Basic Tailwind | Rounded pills, hover effects, animations |
| Maximize button | Missing | Add to window controls |
| Timer presets | Hardcoded modes | Add preset configurations |

---

## 1. MCP Servers Setup

Attach these Model Context Protocol (MCP) servers for AI-assisted development:

* **`sqlite-mcp-server`**: Query local SQLite database to verify session saves
* **`firebase-mcp-server`**: Query Firestore and Firebase Auth for cloud-synced data
* **`fetch` or `puppeteer`**: Read Microsoft Learn docs for WebView2 or P/Invoke signatures
* **`github-mcp` (Optional)**: Auto-commit working milestones

---

## 2. Project Structure

```
/Sentinel
  ├── /Sentinel.UI        (Vite + React + TypeScript + Tailwind + Recharts + Firebase)
  ├── /Sentinel.Engine    (C# .NET 8 WPF + WebView2 + SQLite + Firebase Admin)
  └── /docs               (Documentation)
```

---

## 3. Completed Phases

### Phase 1: The Invisible Engine ✅
- Frameless, topmost, draggable WPF window
- WebView2 control with transparent background
- `UserActivityMonitor` with `GetLastInputInfo` P/Invoke
- Configurable idle detection threshold
- Firebase Admin SDK connectivity logging

### Phase 2: The Shiny UI ✅
- Vite + React + TypeScript + Tailwind CSS
- Pomodoro timer with Focus/Short Break/Long Break modes
- Intervention modal for distraction logging
- Recharts pie chart for session summary
- Firebase Auth (email/password login)
- Firestore cloud sync (opt-in)

### Phase 3: The Bridge ✅
- WebView2 loads React dev server
- C# → React messaging (`IDLE_DETECTED`, `SETTINGS_LOADED`)
- React → C# messaging (`LOG_DISTRACTION`, `SAVE_SETTINGS`)
- SQLite persistence via Entity Framework Core
- Settings panel with configurable options
- Window position persistence

---

## 4. Upcoming Phases

### Phase 4: UX Polish & Intervention Flow (NEXT)
*Goal: Fix critical UX issues before adding features.*

**4A: Visual Design Overhaul**
- Glassmorphism (blur + transparency)
- Better button styling (rounded pills, hover effects)
- Add maximize button to window controls
- Subtle animations and transitions

**4B: Configurable Timer Durations**
- Custom durations for Focus/Short Break/Long Break
- Timer presets ("Classic Pomodoro", "Deep Work", "Quick Sprint")
- Custom named sessions

**4C: Improved Intervention Flow**
- **PAUSE timer** when intervention modal appears
- Multiple response options:
  - "Log Distraction" → current behavior
  - "False Alarm" → dismiss without logging
  - "Snooze 5 min" → suppress idle temporarily
  - "Watching Content" → suppress for 30/60/90 min
- Snooze indicator in UI
- Auto-resume timer after intervention

**4D: Timer Pause Behavior**
- Visual indicator when paused (pulsing, grayed)
- Resume on any intervention response
- Clear state management

### Phase 5: Reporting & Analytics
*Goal: Add comprehensive reporting to track productivity patterns.*

- Daily/weekly/monthly statistics
- Focus time charts (bar, line)
- Distraction breakdown (pie)
- Session history list
- Export capabilities

### Phase 6: Production Build & Distribution
*Goal: Package Sentinel as a standalone Windows application.*

- Production asset bundling
- Single-file .exe publish
- Windows installer
- Auto-update mechanism

### Phase 7: Advanced Features
*Goal: Add power-user features.*

- Smart media suppression
- System sleep/wake recovery
- Global hotkeys
- Notification sounds
- Goals & streaks
- Data export/import

### Phase 8: Polish & Optimization
*Goal: Final polish before v1.0.*

- Onboarding flow
- Accessibility audit
- Performance optimization
- Crash reporting
- Beta testing

---

## 5. Intervention Flow Design (Phase 4)

### Current Flow (Problematic)
```
Idle detected → Show "Distracted?" modal → Timer keeps running!
                                         → Only option: log distraction
                                         → No way to dismiss false alarms
                                         → No way to snooze
```

### New Flow (Phase 4)
```
Idle detected
    ↓
PAUSE TIMER
    ↓
Show Intervention Modal:
┌─────────────────────────────────────┐
│         What happened?              │
│                                     │
│  [📝 Log Distraction]               │
│    └─ Input: "What distracted you?" │
│                                     │
│  [✓ False Alarm]                    │
│    └─ I was thinking/reading        │
│                                     │
│  [⏰ Snooze]                         │
│    └─ [ 5 min ] [ 10 min ] [ 30 min ]│
│                                     │
│  [🎬 Watching Content]              │
│    └─ Suppress for [ 30 ] [ 60 ] [ 90 ] min │
└─────────────────────────────────────┘
    ↓
User selects option
    ↓
RESUME TIMER (or keep paused if explicit pause)
    ↓
If snoozed: Show snooze indicator + countdown
```

---

## 6. Settings Schema (Phase 4 Update)

```typescript
interface Settings {
  // Timer Durations (in minutes)
  focusDuration: number;       // default: 25
  shortBreakDuration: number;  // default: 5
  longBreakDuration: number;   // default: 15

  // Custom Sessions
  customSessions: Array<{
    name: string;
    duration: number;
  }>;

  // Idle Detection
  idleThresholdSeconds: number;  // default: 45
  snoozeEnabled: boolean;
  defaultSnoozeDuration: number; // minutes

  // Behavior
  pauseOnIntervention: boolean;  // default: true
  autoResumeAfterIntervention: boolean; // default: true

  // Existing
  cloudSyncEnabled: boolean;
  soundEnabled: boolean;
  alwaysOnTop: boolean;
}
```

---

## 7. Key Files Reference

### C# Backend (Sentinel.Engine)
| File | Purpose |
|------|---------|
| `MainWindow.xaml` | Window layout, title bar, WebView2 |
| `MainWindow.xaml.cs` | Window logic, WebView2 messaging |
| `UserActivityMonitor.cs` | Idle detection with snooze support |
| `SettingsService.cs` | Load/save settings to JSON |
| `FirebaseService.cs` | Firebase Admin SDK connectivity |
| `SentinelDbContext.cs` | EF Core SQLite context |
| `DistractionRepository.cs` | Database operations |
| `Models.cs` | Distraction, Session entities |

### React Frontend (Sentinel.UI/src)
| File | Purpose |
|------|---------|
| `App.tsx` | Main app with timer, settings, auth |
| `firebase.ts` | Firebase client SDK config |
| `index.css` | Tailwind CSS imports |

---

## 8. Vibe Coding "Gotchas"

Watch out for these common issues:

* **WebView2 Initialization**: Always use `await webView.EnsureCoreWebView2Async()` before navigating
* **Transparent Window**: Set both `AllowsTransparency="True"` AND `webView.DefaultBackgroundColor = Transparent`
* **24-Day Tick Wrap**: `GetLastInputInfo` ticks overflow every ~24.9 days - use `unchecked` arithmetic
* **WPF Resources Order**: Define `<Window.Resources>` BEFORE referencing styles in XAML
* **System.IO in WPF**: Explicitly add `using System.IO;` - not auto-included like console apps
* **Timer State**: Always pause timer during interventions to avoid counting distracted time as focus time
