
- **1. Project Overview & Migration Charter**
    - 1.1. Purpose & Scope of This Document
    - 1.2. Source Architecture Summary (WPF/WebView2 + React + SQLite)
    - 1.3. Target Architecture Summary (Photino/C# + Angular + Firebase)
    - 1.4. Migration Principles & Non-Negotiable Constraints
    - 1.5. Glossary of Domain Terms
    - 1.6. Document Conventions & Placeholder Legend

## 1. Project Overview & Migration Charter

### 1.1. Purpose & Scope of This Document

This document is the single authoritative specification for re-implementing the Sentinel desktop application from its current architecture to the target architecture defined in `TARGET_ARCHITECTURE.md`. It is written for consumption by automated AI agents and must contain sufficient detail to reconstruct every module, interface, data model, IPC message, Firestore document, Cloud Function, and security rule without access to the original source files.

**In-scope:**

- Complete extraction and mapping of all existing business logic from the source codebase (`Sentinel.Engine/` C# WPF backend, `Sentinel.UI/src/` React/TypeScript frontend).
- Full specification of the target architecture: Photino C# shell, Angular (Strict TypeScript) frontend, Firebase (Firestore, Auth, Cloud Functions) backend.
- Exact interface definitions, IPC message envelope schemas, Firestore document schemas, and Cloud Function trigger contracts.
- Security rules, anti-cheat boundaries, and offline sync strategies.
- Migration execution plan with phased rollout.

**Out-of-scope:**

- Visual design mockups (see `artifacts/stitch/sentinel-product-design-brief/` for Stitch design system assets).
- End-user documentation or marketing materials.
- CI/CD pipeline configuration (covered separately).

### 1.2. Source Architecture Summary (WPF/WebView2 + React + SQLite)

The existing Sentinel application is a Windows desktop productivity timer with the following architecture:

#### 1.2.1. Desktop Shell — C# / .NET 8 / WPF / WebView2

- **Project file:** `Sentinel.Engine/Sentinel.Engine.csproj`
- **Target framework:** `net8.0-windows`
- **Output type:** `WinExe` (Windows executable, WPF)
- **UI hosting:** Microsoft WebView2 (`Microsoft.Web.WebView2` v1.0.3856.49) embedded in a WPF `<Window>` via the `<wpf:WebView2>` control.
- **Publishing:** Single-file, self-contained, `win-x64`, with compression enabled.

The C# shell is responsible for:

1. **Idle detection** — `UserActivityMonitor` class polls `GetLastInputInfo` via P/Invoke on a `DispatcherTimer` with a 1-second interval. When the idle duration (in milliseconds) exceeds a user-configurable threshold (default 45 seconds), it raises the `IdleDetected` event. When input resumes, it raises `UserActive`.
2. **Media-aware suppression** — `MediaDetector.IsAudioPlaying()` queries Windows Core Audio API (`IAudioMeterInformation` via COM interop). If peak audio level exceeds `0.001f`, idle detection is suppressed. Controlled by the `SuppressDuringMedia` setting.
3. **Snooze mechanism** — `UserActivityMonitor.Snooze(int minutes)` sets a `_snoozeUntil` timestamp. While snoozed, the polling loop skips idle evaluation. `CancelSnooze()` clears it. Auto-resumes on expiry.
4. **IPC bridge** — `MainWindow.OnWebMessageReceived` listens for JSON messages from the React frontend via `CoreWebView2.WebMessageReceived`. Outbound messages use `CoreWebView2.PostWebMessageAsJson`. All messages follow the envelope `{ "type": string, ...payload }`.
5. **Settings persistence** — `SettingsService` reads/writes `AppSettings` to `%LocalAppData%/Sentinel/settings.json` using `System.Text.Json`.
6. **Database** — `SentinelDbContext` (Entity Framework Core + SQLite) with two entities: `Distraction` and `Session`. Database file at `%LocalAppData%/Sentinel/sentinel.db`. WAL journal mode enabled. 7-stage manual schema migration engine in `DistractionRepository`.
7. **Reporting** — `ReportingService.GetReportDataAsync(DateTime since)` aggregates sessions and distractions into a `ReportData` DTO with daily focus breakdown, category breakdown, and recent session history.
8. **Window management** — Custom titlebar with DragMove, minimize/maximize/close, compact/mini-overlay mode toggle, taskbar flash on idle detection, WndProc hook for `WM_POWERBROADCAST` (suspend/resume) and `WM_HOTKEY`.
9. **Global hotkeys** — `Ctrl+Shift+S` (start/pause timer), `Ctrl+Shift+D` (log distraction) via `RegisterHotKey` P/Invoke.
10. **Crash reporting** — `CrashReporter` handles `AppDomain.UnhandledException` and `TaskScheduler.UnobservedTaskException`, writes to `crash.log`.
11. **Update checking** — `UpdateChecker` polls GitHub Releases API, cached for 24 hours.

#### 1.2.2. Frontend — React / TypeScript / Vite / Tailwind CSS

- **Project file:** `Sentinel.UI/package.json`
- **Bundler:** Vite, configured to output to `../Sentinel.Engine/wwwroot/`.
- **Code-splitting:** `recharts` and `firebase` are lazy-loaded chunks.

The React frontend is a single-page application in `App.tsx` with these core subsystems:

1. **Timer engine** — Drift-free anchor-based timer. On start, `timerAnchorRef` captures `{ startedAt: Date.now(), startTimeLeft: number }`. A `setInterval` (1-second) computes remaining time as `startTimeLeft - (Date.now() - startedAt) / 1000`, avoiding naive decrement drift.
2. **Timer states** — `isRunning`, `isComplete`, `isPausedByIntervention`. Modes: `pomodoro`, `shortBreak`, `longBreak`.
3. **Intervention flow** — On `IDLE_DETECTED` message: freeze timer (`setIsRunning(false)`, `setIsPausedByIntervention(true)`), show `InterventionModal`. User must type a distraction note or click a quick-suggestion pill. On submit: `LOG_DISTRACTION` IPC message dispatched, timer resumes. Quick suggestions: 2 most recent + 3 most frequent (from `buildQuickSuggestions()` in `taxonomy.ts`).
4. **Taxonomy engine** — `normalizeDistractionNote()` (lowercase, trim, collapse whitespace), `getMappedCategoryForNote()` (lookup against taxonomy map), `buildQuickSuggestions()` (frequency + recency algorithm).
5. **Views** — `TimerScreen`, `ReportsScreen`, `SettingsScreen`, `TaxonomyManagerScreen`, `SessionHistoryScreen`, `InterventionModal`, `OnboardingModal`, `AuthScreen`, `CompactTimerScreen`, `SessionCompleteScreen`, `ResumePromptModal`, `ConfirmModal`.
6. **Navigation** — State-driven (`view` string: `'timer' | 'settings' | 'auth' | 'reports' | 'taxonomy' | 'history'`), not route-based.
7. **Firebase integration** — `firebase.ts` initializes Firebase Auth and Firestore with `enableIndexedDbPersistence`. Sync writes session documents to a flat `sessions` collection (`{ userId, duration, distractions, completedAt }`). Pending syncs are retried via `pendingSyncsRef`.
8. **Bridge** — `postMessage` wrapper sends to `window.chrome.webview.postMessage()`. Inbound messages via `chrome.webview.addEventListener('message', ...)`.

#### 1.2.3. Source Data Models (Exact C# Definitions)

```csharp
namespace Sentinel.Engine;

public class Distraction
{
    public int Id { get; set; }
    public string Note { get; set; } = string.Empty;
    public string NormalizedNote { get; set; } = string.Empty;
    public string? CategoryName { get; set; }
    public DateTime Timestamp { get; set; }
    public bool IsFalseAlarm { get; set; }
}

public class Session
{
    public int Id { get; set; }
    public int DurationSeconds { get; set; }
    public DateTime StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? SessionName { get; set; }
    public bool EndedEarly { get; set; }
}

public class AppSettings
{
    public int PomodoroMinutes { get; set; } = 25;
    public int ShortBreakMinutes { get; set; } = 5;
    public int LongBreakMinutes { get; set; } = 15;
    public int IdleThresholdSeconds { get; set; } = 45;
    public bool CloudSyncEnabled { get; set; } = false;
    public bool SoundEnabled { get; set; } = true;
    public bool AlwaysOnTop { get; set; } = false;
    public bool SuppressDuringMedia { get; set; } = true;
    public int DailyFocusGoalMinutes { get; set; } = 120;
    public string OverlayStyle { get; set; } = "compact";
    public double WindowLeft { get; set; } = -1;
    public double WindowTop { get; set; } = -1;
    public int DataRetentionMonths { get; set; } = 0;
    public List<CustomPreset> CustomPresets { get; set; } = [];
}

public class CustomPreset
{
    public string Name { get; set; } = "";
    public int Focus { get; set; }
    public int ShortBreak { get; set; }
    public int LongBreak { get; set; }
}

public class TaxonomyData
{
    public List<DistractionEntryDto> RecentEntries { get; set; } = [];
    public List<DistractionGroupDto> Groups { get; set; } = [];
    public List<string> Categories { get; set; } = [];
}

public class DistractionEntryDto
{
    public int Id { get; set; }
    public string Note { get; set; } = string.Empty;
    public string NormalizedNote { get; set; } = string.Empty;
    public string? CategoryName { get; set; }
    public DateTime Timestamp { get; set; }
}

public class DistractionGroupDto
{
    public string Note { get; set; } = string.Empty;
    public string NormalizedNote { get; set; } = string.Empty;
    public string? CategoryName { get; set; }
    public int Count { get; set; }
    public DateTime LastSeenAt { get; set; }
}

public class ReportData
{
    public int TotalFocusSeconds { get; set; }
    public int SessionsCompleted { get; set; }
    public int DistractionsLogged { get; set; }
    public int FalseAlarms { get; set; }
    public double AvgSessionSeconds { get; set; }
    public List<DailyFocus> DailyFocus { get; set; } = [];
    public List<ReportBreakdownItem> TopCategories { get; set; } = [];
    public List<ReportBreakdownItem> TopDistractions { get; set; } = [];
    public List<SessionEntry> RecentSessions { get; set; } = [];
}

public class DailyFocus
{
    public string Date { get; set; } = "";
    public int FocusSeconds { get; set; }
    public int Sessions { get; set; }
    public int Distractions { get; set; }
}

public class ReportBreakdownItem
{
    public string Name { get; set; } = "";
    public int Count { get; set; }
    public string? CategoryName { get; set; }
}

public class SessionEntry
{
    public DateTime StartedAt { get; set; }
    public int DurationSeconds { get; set; }
    public bool Completed { get; set; }
    public bool EndedEarly { get; set; }
    public string? SessionName { get; set; }
    public DateTime? CompletedAt { get; set; }
    public int DistractionsCount { get; set; }
    public int FalseAlarmCount { get; set; }
}
```

#### 1.2.4. Source TypeScript Type Definitions (Exact)

```typescript
// Sentinel.UI/src/utils.ts
export interface TimerPreset {
  name: string;
  focus: number;
  shortBreak: number;
  longBreak: number;
}

export type TimerMode = 'pomodoro' | 'shortBreak' | 'longBreak';
export type OverlayStyle = 'pill' | 'compact' | 'monitoring';

export interface Settings {
  pomodoroMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  idleThresholdSeconds: number;
  cloudSyncEnabled: boolean;
  soundEnabled: boolean;
  alwaysOnTop: boolean;
  suppressDuringMedia: boolean;
  dailyFocusGoalMinutes: number;
  overlayStyle: OverlayStyle;
  customPresets: TimerPreset[];
}

// Sentinel.UI/src/app-types.ts
export type ReportRange = 'today' | 'week' | 'month' | 'all';

export interface ReportBreakdownItem {
  name: string;
  count: number;
  categoryName?: string | null;
}

export interface ReportData {
  totalFocusSeconds: number;
  sessionsCompleted: number;
  distractionsLogged: number;
  falseAlarms: number;
  avgSessionSeconds: number;
  dailyFocus: { date: string; focusSeconds: number; sessions: number; distractions: number }[];
  topCategories: ReportBreakdownItem[];
  topDistractions: ReportBreakdownItem[];
  recentSessions: SessionHistoryEntry[];
}

export interface SessionHistoryEntry {
  startedAt: string;
  durationSeconds: number;
  completed: boolean;
  endedEarly: boolean;
  sessionName: string | null;
  completedAt: string | null;
  distractionsCount: number;
  falseAlarmCount: number;
}

export interface DistractionEntry {
  id: number;
  note: string;
  normalizedNote: string;
  categoryName: string | null;
  timestamp: string;
}

export interface DistractionGroup {
  note: string;
  normalizedNote: string;
  categoryName: string | null;
  count: number;
  lastSeenAt: string;
}

export interface TaxonomyData {
  recentEntries: DistractionEntry[];
  groups: DistractionGroup[];
  categories: string[];
}
```

#### 1.2.5. Source IPC Message Registry (Complete)

All messages use the envelope `{ "type": string, ...additional_fields }`. Serialization: `System.Text.Json` with default options (camelCase property naming via `JsonNamingPolicy.CamelCase` where explicitly specified, PascalCase otherwise — the codebase is inconsistent and the target architecture must normalize to camelCase).

**C# → React (Outbound, via `PostWebMessageAsJson`):**

| Message Type | Additional Fields | Trigger |
|---|---|---|
| `IDLE_DETECTED` | *(none)* | `UserActivityMonitor.IdleDetected` event fires while monitor is running |
| `SETTINGS_LOADED` | `todaySessionsCompleted: int`, `todayFocusSeconds: int`, `settings: { pomodoroMinutes, shortBreakMinutes, longBreakMinutes, idleThresholdSeconds, cloudSyncEnabled, soundEnabled, alwaysOnTop, suppressDuringMedia, dailyFocusGoalMinutes, overlayStyle, customPresets: [{ name, focus, shortBreak, longBreak }] }` | WebView2 `NavigationCompleted`, or on `GET_SETTINGS` request |
| `REPORT_DATA` | `data: ReportData` (camelCase) | Response to `GET_REPORT_DATA` |
| `TAXONOMY_DATA` | `data: TaxonomyData` (camelCase) | Response to `GET_TAXONOMY_DATA`, or after any taxonomy mutation |
| `SESSION_LIST` | `sessions: SessionEntry[]`, `total: int` | Response to `GET_SESSIONS` |
| `UPDATE_AVAILABLE` | `currentVersion: string`, `latestVersion: string`, `downloadUrl: string`, `releaseNotes: string` | `UpdateChecker` finds newer version on GitHub Releases |
| `SNOOZE_STATUS` | `isSnoozed: bool`, `secondsRemaining: int` | After `SNOOZE`, `WATCHING_CONTENT`, or `CANCEL_SNOOZE` |
| `SYSTEM_SUSPEND` | *(none)* | `WM_POWERBROADCAST` with `PBT_APMSUSPEND` |
| `SYSTEM_RESUME` | *(none)* | `WM_POWERBROADCAST` with `PBT_APMRESUMEAUTOMATIC` |
| `HOTKEY_START_PAUSE` | *(none)* | `WM_HOTKEY` with id `HOTKEY_START_PAUSE` (Ctrl+Shift+S) |
| `HOTKEY_DISTRACTION` | *(none)* | `WM_HOTKEY` with id `HOTKEY_DISTRACTION` (Ctrl+Shift+D) |
| `EXPORT_DATA_RESULT` | `success: bool`, `path: string`, `error: string?` | Response to `EXPORT_DATA` |

**React → C# (Inbound, via `chrome.webview.postMessage`):**

| Message Type | Additional Fields | Handler |
|---|---|---|
| `LOG_DISTRACTION` | `note: string`, `categoryName: string?`, `forceUncategorized: bool?` | `HandleLogDistraction` — creates `Distraction` entity, auto-categorizes unless forced uncategorized |
| `FALSE_ALARM` | *(none)* | `HandleFalseAlarm` — creates `Distraction` with `IsFalseAlarm=true`, `Note="False Alarm"` |
| `INTERVENTION_DISMISSED` | *(none)* | Restores `Topmost` to `_settings.AlwaysOnTop`, restores compact mode if `_wasCompactBeforeIntervention` |
| `SNOOZE` | `minutes: int` | Calls `_activityMonitor.Snooze(minutes)`, sends `SNOOZE_STATUS` |
| `WATCHING_CONTENT` | `minutes: int` | Same as `SNOOZE` (aliases snooze for UX clarity) |
| `CANCEL_SNOOZE` | *(none)* | Calls `_activityMonitor.CancelSnooze()`, sends `SNOOZE_STATUS` |
| `SAVE_SETTINGS` | `settings: { ...AppSettings fields }` | `HandleSaveSettings` — deserializes, persists to disk, applies live changes (idle threshold, media suppression, always-on-top) |
| `GET_SETTINGS` | *(none)* | Calls `SendSettingsToReactAsync()` |
| `GET_REPORT_DATA` | `range: 'today' \| 'week' \| 'month' \| 'all'` | `HandleGetReportData` — converts range to `DateTime since`, calls `ReportingService`, sends `REPORT_DATA` |
| `GET_TAXONOMY_DATA` | *(none)* | `SendTaxonomyDataAsync` — calls `DistractionRepository.GetTaxonomyDataAsync()`, sends `TAXONOMY_DATA` |
| `UPDATE_DISTRACTION_GROUP` | `normalizedNote: string`, `note: string`, `categoryName: string?` | `HandleUpdateDistractionGroup` — calls `DistractionRepository.UpdateDistractionGroupAsync`, sends updated `TAXONOMY_DATA` |
| `RENAME_CATEGORY` | `oldName: string`, `newName: string` | `HandleRenameCategory` — calls `DistractionRepository.RenameCategoryAsync`, sends updated `TAXONOMY_DATA` |
| `DELETE_CATEGORY` | `categoryName: string` | `HandleDeleteCategory` — calls `DistractionRepository.DeleteCategoryAsync`, sends updated `TAXONOMY_DATA` |
| `LOG_SESSION` | `durationSeconds: int`, `sessionName: string?`, `endedEarly: bool?`, `startedAt: string?` (ISO 8601) | `HandleLogSession` — creates `Session` entity with UTC timestamps |
| `GET_SESSIONS` | `page: int`, `pageSize: int` | Responds with `SESSION_LIST` |
| `TIMER_RUNNING` | `running: bool` | If `true`: `_activityMonitor.Start()`. If `false`: `_activityMonitor.Stop()`. Links timer state to idle monitoring. |
| `TOGGLE_COMPACT` | *(none)* | `HandleToggleCompact` — toggles compact/mini-overlay mode |
| `PLAY_SOUND` | *(none)* | `PlayNotificationSound` |
| `EXPORT_DATA` | `format: string?` | `HandleExportData` |
| `SEED_DATABASE` | *(none)* | `HandleSeedDatabaseAsync` — runs `DatabaseSeeder` |
| `OVERLAY_CLOSE` | *(none)* | `Dispatcher.Invoke(() => Close())` |
| `OVERLAY_MINIMIZE` | *(none)* | `Dispatcher.Invoke(() => WindowState = Minimized)` |
| `OVERLAY_MAXIMIZE` | *(none)* | Aliases `TOGGLE_COMPACT` |
| `JS_ERROR` | `message: string`, `stack: string` | `CrashReporter.LogCrash("JS_ERROR", ...)` |

#### 1.2.6. Source Database Schema (SQLite, EF Core)

```
Table: Distractions
  Id              INTEGER PRIMARY KEY AUTOINCREMENT
  Note            TEXT NOT NULL DEFAULT ''
  NormalizedNote  TEXT NOT NULL DEFAULT ''
  CategoryName    TEXT (nullable)
  Timestamp       TEXT (DateTime, stored as ISO 8601 UTC)
  IsFalseAlarm    INTEGER (bool, default 0)
  INDEX: IX_Distractions_NormalizedNote ON NormalizedNote
  INDEX: IX_Distractions_Timestamp ON Timestamp
  INDEX: IX_Distractions_CategoryName ON CategoryName

Table: Sessions
  Id              INTEGER PRIMARY KEY AUTOINCREMENT
  DurationSeconds INTEGER NOT NULL
  StartedAt       TEXT (DateTime, stored as ISO 8601 UTC)
  CompletedAt     TEXT (DateTime, nullable)
  SessionName     TEXT (nullable)
  EndedEarly      INTEGER (bool, default 0)
  INDEX: IX_Sessions_StartedAt ON StartedAt

Table: _schema_version
  version         INTEGER PRIMARY KEY
```

Journal mode: WAL (Write-Ahead Logging) for concurrent read/write support between WPF UI thread and WebView2 renderer.

#### 1.2.7. Source Firestore Schema (Existing — Flat, Non-Ledger)

The existing codebase uses a simple flat Firestore structure that does **not** follow the target Event Ledger pattern:

```
Collection: sessions/{sessionId}
  userId:       string (Firebase Auth UID)
  duration:     number (seconds)
  distractions: string[] (array of distraction note strings)
  completedAt:  Timestamp (server timestamp)

Collection: distractions/{distractionId}
  userId:       string (Firebase Auth UID)
  ...fields TBD (rules exist but client sync not fully implemented)
```

**Existing Firestore Security Rules:**
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }
    match /sessions/{sessionId} {
      allow read: if request.auth != null && resource.data.userId == request.auth.uid;
      allow create: if request.auth != null && request.resource.data.userId == request.auth.uid;
      allow update, delete: if request.auth != null && resource.data.userId == request.auth.uid;
    }
    match /distractions/{distractionId} {
      allow read: if request.auth != null && resource.data.userId == request.auth.uid;
      allow create: if request.auth != null && request.resource.data.userId == request.auth.uid;
      allow update, delete: if request.auth != null && resource.data.userId == request.auth.uid;
    }
    match /_sentinel_health/{docId} { allow read: if request.auth != null; }
  }
}
```

**Critical migration observation:** The existing flat `sessions` collection allows `update` and `delete`, which violates the target architecture's anti-tampering requirement. The target architecture replaces this with an append-only `session_events` ledger where clients can only `create`.

#### 1.2.8. Source File Inventory (Complete)

| File | Responsibility |
|---|---|
| `Sentinel.Engine/App.xaml.cs` | WPF application entry point. Calls `SentinelLog.Info` and `TrimIfNeeded` on startup. |
| `Sentinel.Engine/MainWindow.xaml.cs` | WebView2 host, IPC bridge, idle detection wiring, hotkey registration, window management, all message dispatch handlers. Central orchestrator (~700 lines). |
| `Sentinel.Engine/MainWindow.xaml` | XAML layout: custom chromeless titlebar, WebView2 control. |
| `Sentinel.Engine/Models.cs` | Entity definitions: `Distraction`, `Session`, `DistractionNormalizer`, `TaxonomyData`, `DistractionEntryDto`, `DistractionGroupDto`. |
| `Sentinel.Engine/SentinelDbContext.cs` | EF Core DbContext with SQLite configuration, WAL mode, index definitions. Default DB path: `%LocalAppData%/Sentinel/sentinel.db`. |
| `Sentinel.Engine/DistractionRepository.cs` | CRUD operations for Distractions, 7-stage schema migration engine, auto-categorization, taxonomy queries, pruning. |
| `Sentinel.Engine/UserActivityMonitor.cs` | `GetLastInputInfo` P/Invoke polling, idle/active events, snooze mechanism. |
| `Sentinel.Engine/MediaDetector.cs` | Windows Core Audio COM interop (`IAudioMeterInformation`), `IsAudioPlaying()`. |
| `Sentinel.Engine/SettingsService.cs` | JSON file persistence for `AppSettings` at `%LocalAppData%/Sentinel/settings.json`. |
| `Sentinel.Engine/ReportingService.cs` | Aggregation queries: focus time, session counts, distraction breakdown, daily history. |
| `Sentinel.Engine/CrashReporter.cs` | Global exception handlers, `crash.log` writer. |
| `Sentinel.Engine/UpdateChecker.cs` | GitHub Releases API polling with 24-hour cache. |
| `Sentinel.Engine/DatabaseSeeder.cs` | Demo data generation for development/testing. |
| `Sentinel.Engine/SentinelLog.cs` | File-based logging utility. |
| `Sentinel.Engine/FirebaseService.cs` | Firebase Admin SDK integration (server-side, if used). |
| `Sentinel.Engine/app.manifest` | Windows application manifest (DPI awareness, UAC settings). |
| `Sentinel.Engine/Sentinel.Engine.csproj` | Project config: .NET 8, WPF, WebView2, EF Core SQLite, self-contained publish. |
| `Sentinel.UI/src/App.tsx` | Root React component: timer engine, state management, IPC bridge, intervention flow, auth, all view routing. |
| `Sentinel.UI/src/views.tsx` | All screen components: `TimerScreen`, `ReportsScreen`, `SettingsScreen`, `TaxonomyManagerScreen`, `SessionHistoryScreen`, `InterventionModal`, `OnboardingModal`, `AuthScreen`, `CompactTimerScreen`, `SessionCompleteScreen`, `ResumePromptModal`, `ConfirmModal`. |
| `Sentinel.UI/src/ui.tsx` | Design system primitives: `Glyph`, `WorkspaceLayout`, `SectionCard`, `ModalLayout`. |
| `Sentinel.UI/src/taxonomy.ts` | `normalizeDistractionNote()`, `getMappedCategoryForNote()`, `buildQuickSuggestions()`. |
| `Sentinel.UI/src/utils.ts` | `Settings` interface, `TimerPreset` interface, `PRESETS` array, `formatTime()`, `formatDuration()`, `formatSnoozeTime()`, `getTimerDuration()`, `calculateGoalProgress()`, `isPresetActive()`. |
| `Sentinel.UI/src/app-types.ts` | `ReportData`, `ReportRange`, `ReportBreakdownItem`, `SessionHistoryEntry`, `DistractionEntry`, `DistractionGroup`, `TaxonomyData` TypeScript interfaces. |
| `Sentinel.UI/src/firebase.ts` | Firebase app initialization, Auth + Firestore with `enableIndexedDbPersistence`. |
| `Sentinel.UI/src/bridge.test.ts` | Bridge communication tests. |
| `Sentinel.UI/src/taxonomy.test.ts` | Taxonomy normalization and suggestion tests. |
| `Sentinel.UI/src/utils.test.ts` | Utility function tests. |
| `Sentinel.UI/src/views.test.tsx` | View component tests. |
| `Sentinel.UI/src/ErrorBoundary.tsx` | React error boundary wrapper. |
| `Sentinel.UI/src/index.css` | Global styles (Tailwind CSS imports). |
| `Sentinel.UI/src/main.tsx` | React DOM entry point. |
| `Sentinel.UI/src/test-setup.ts` | Vitest test configuration. |
| `Sentinel.UI/src/ui-utils.ts` | UI utility functions. |

### 1.3. Target Architecture Summary (Photino/C# + Angular + Firebase)

The target architecture is defined authoritatively in `TARGET_ARCHITECTURE.md`. All implementation decisions must conform to its rules. This section restates them in full and maps each to the corresponding source-codebase component that will be migrated.

#### 1.3.1. Technology Stack Migration Map

| Layer | Source (Current) | Target (New) | Migration Notes |
|---|---|---|---|
| Desktop Shell | WPF (`<Window>`) + WebView2 (`Microsoft.Web.WebView2`) | **Photino** (`PhotinoWindow`) | Photino replaces both WPF and WebView2. It provides a lightweight chromeless window with built-in web view. No WPF dependency. No `Microsoft.Web.WebView2` NuGet. |
| Frontend Framework | React 18 + Vite + TypeScript | **Angular** (Strict TypeScript) | Complete rewrite. All React components, hooks, and state in `App.tsx`/`views.tsx` must be reimplemented as Angular components, services, and RxJS observables. |
| Styling | Tailwind CSS | **Tailwind CSS** (retain) | Tailwind config and utility classes carry forward. Design tokens from `artifacts/stitch/sentinel-product-design-brief/` apply. |
| Local Database | SQLite via EF Core | **Removed** — replaced by Firestore | SQLite is eliminated. All persistence moves to Firebase Firestore. A one-time migration utility converts existing SQLite data to Firestore documents. |
| Cloud Backend | Firebase (partial — flat collections, optional sync) | **Firebase** (full — Firestore, Auth, Cloud Functions) | Firestore structure changes from flat mutable collections to user-scoped documents with an append-only Event Ledger. Cloud Functions are new. |
| IPC Protocol | WebView2 `PostWebMessageAsJson` / `WebMessageReceived` | **Photino** `SendMessage` / `WebMessageReceived` | Message envelope schema (`{ type, ...payload }`) is preserved. Transport changes from WebView2 COM channel to Photino's native message passing. |
| Serialization | `System.Text.Json` (inconsistent casing) | **`System.Text.Json`** (strict camelCase via `JsonNamingPolicy.CamelCase`) | All outbound messages must use camelCase. Angular consumes camelCase natively. |

#### 1.3.2. Core Architectural Rules from TARGET_ARCHITECTURE.md

The following rules are **non-negotiable** and override any existing implementation pattern:

1. **The C# shell is a "dumb" wrapper.** It handles only: idle detection, active window whitelist checking, IPC message relay, and native OS hooks. It does **not** manage UI state, timer logic, or view routing. (Source deviation: the existing `MainWindow.xaml.cs` actively participates in session management and reporting aggregation. In the target, reporting aggregation moves either to Angular or to Cloud Functions.)

2. **Idle detection uses `GetLastInputInfo`** on a background thread. (Source match: `UserActivityMonitor` already does this. Port directly to Photino host.)

3. **Active Window Whitelist is new.** The C# shell must check the currently focused OS window process via `GetForegroundWindow` + `GetWindowThreadProcessId`. If the active process matches a user-defined whitelist (`devenv.exe`, `code.exe`, etc.), the idle timeout threshold is extended or paused. This does not exist in the source codebase and must be built from scratch.

4. **IPC handshake:** Shell sends `IdleDetected` JSON when idle threshold is breached. Shell listens for `AuditorCleared` (renamed from `INTERVENTION_DISMISSED`) from Angular to resume monitoring.

5. **Angular manages all UI state locally in memory.** Zero-latency responsiveness during offline use. (Source match: React `App.tsx` already manages state in-memory. Port pattern to Angular services.)

6. **The Distraction Auditor** (renamed from "Intervention Modal") freezes the local Pomodoro timer and triggers a forced-overlay modal. Cannot be dismissed without categorizing via the Distraction Taxonomy. (Source match: `InterventionModal` in `views.tsx`. Port to Angular.)

7. **Firestore uses two-pronged offline handling:**
   - **Standard Persistence** — Settings, Planner schedules, Taxonomy definitions use native Firestore offline persistence. Angular writes directly.
   - **Event Ledger** — Focus sessions and distractions are written as immutable event objects (`TimerStarted`, `IdleDetected`, `DistractionLogged`, etc.) to an append-only `session_events` collection. No updates or deletes.

8. **All gamification is server-side.** Cloud Functions process the Event Ledger. No client-side gamification calculations. This prevents cheating via IndexedDB or local file manipulation.

#### 1.3.3. Target Firestore Document Schemas (Event Ledger — Definitive)

The target architecture introduces a fundamentally different data model. The source's mutable `sessions` and `distractions` collections are replaced by:

**Standard Persistence Documents:**

```
users/{uid}/settings
{
  pomodoroMinutes:       number,       // default 25
  shortBreakMinutes:     number,       // default 5
  longBreakMinutes:      number,       // default 15
  idleThresholdSeconds:  number,       // default 45
  cloudSyncEnabled:      boolean,      // default false
  soundEnabled:          boolean,      // default true
  alwaysOnTop:           boolean,      // default false
  suppressDuringMedia:   boolean,      // default true
  dailyFocusGoalMinutes: number,       // default 120
  overlayStyle:          string,       // "compact" | "pill" | "monitoring"
  customPresets:         array<{       // array of preset objects
    name: string,
    focus: number,
    shortBreak: number,
    longBreak: number
  }>,
  activeWindowWhitelist: array<string> // NEW: e.g. ["devenv.exe", "code.exe"]
}

users/{uid}/planner_blocks/{blockId}
{
  start:       Timestamp,     // block start time
  end:         Timestamp,     // block end time
  label:       string,        // user-defined label
  color:       string,        // hex color code
  repeat:      string | null, // "daily" | "weekday" | "custom" | null
  repeatDays:  array<number>  // for custom: [0=Sun, 1=Mon, ... 6=Sat]
}

users/{uid}/taxonomy/{categoryId}
{
  name:            string,               // category display name
  noteMappings:    array<string>,         // normalized notes mapped to this category
  createdAt:       Timestamp,
  updatedAt:       Timestamp
}
```

**Secure Event Ledger (Append-Only, Immutable):**

```
users/{uid}/session_events/{eventId}
{
  type:        string,      // one of the event types below
  timestamp:   Timestamp,   // server timestamp (REQUIRED — set via serverTimestamp())
  sessionId:   string,      // client-generated UUID grouping events to a single focus session
  payload:     map           // event-type-specific data (see below)
}
```

**Event Type Definitions:**

| `type` Value | `payload` Fields | Trigger |
|---|---|---|
| `TimerStarted` | `{ durationSeconds: number, sessionName: string \| null, presetName: string \| null }` | User presses Start on timer |
| `TimerPaused` | `{ remainingSeconds: number }` | User presses Pause |
| `TimerResumed` | `{ remainingSeconds: number }` | User presses Resume after pause |
| `TimerCompleted` | `{ actualDurationSeconds: number }` | Timer reaches 00:00 naturally |
| `TimerEndedEarly` | `{ remainingSeconds: number, elapsedSeconds: number }` | User manually ends session before completion |
| `IdleDetected` | `{ idleDurationMs: number }` | C# shell detects idle threshold breach |
| `DistractionLogged` | `{ note: string, normalizedNote: string, categoryName: string \| null }` | User submits distraction note in Auditor modal |
| `FalseAlarmMarked` | `{}` | User marks intervention as false alarm |

**Write-Only Client Rule:** The client can `create` documents in `session_events`. It **cannot** `update` or `delete` them. This is enforced by Firestore security rules.

**Target Firestore Security Rules (Event Ledger Section):**

```
match /users/{uid}/session_events/{eventId} {
  allow create: if request.auth != null
                && request.auth.uid == uid
                && request.resource.data.type is string
                && request.resource.data.sessionId is string
                && request.resource.data.timestamp == request.time;
  allow read:   if request.auth != null && request.auth.uid == uid;
  allow update, delete: if false;
}
```

Note: `request.resource.data.timestamp == request.time` enforces that clients use `serverTimestamp()` and cannot forge past or future timestamps.

**Server-Computed Aggregates (Read-Only for Client):**

```
users/{uid}/stats/daily/{date}    // e.g., "2026-04-03"
{
  focusSeconds:     number,
  sessionsCompleted: number,
  distractionsLogged: number,
  falseAlarms:       number,
  swiftRecoveries:   number,
  bonusPoints:       number
}

users/{uid}/stats/streaks
{
  currentStreak:     number,      // consecutive days meeting threshold
  longestStreak:     number,
  lastActiveDate:    string,      // "YYYY-MM-DD"
  thresholdMinutes:  number       // minimum focus minutes to count a day
}

users/{uid}/achievements/{achievementId}
{
  name:        string,           // e.g., "Bronze Focus"
  tier:        string,           // "bronze" | "silver" | "gold"
  earnedAt:    Timestamp,
  milestone:   string,           // description of what was achieved
  isShiny:     boolean,          // RNG-dropped aesthetic variant
  rarity:      string | null     // "common" | "uncommon" | "rare" | "legendary" (for shiny only)
}
```

### 1.4. Migration Principles & Non-Negotiable Constraints

These principles govern all implementation decisions during the migration. Violations must be flagged immediately.

1. **Photino replaces WPF + WebView2.** The output project must not reference `Microsoft.Web.WebView2`, `UseWPF`, or any WPF namespace (`System.Windows.*`). The shell uses `PhotinoNET` NuGet package exclusively.

2. **Angular replaces React.** No React, ReactDOM, or JSX/TSX files in the target. All UI is Angular components with strict TypeScript. State is managed via Angular services and RxJS, not React hooks or `useState`/`useRef`.

3. **Firebase replaces SQLite.** No `Microsoft.EntityFrameworkCore.Sqlite` NuGet in the target. No local database files. All persistence is via Firestore (with IndexedDB offline cache).

4. **Event Ledger is append-only.** Focus sessions and distractions must **never** be written as mutable state documents. They are immutable event records. The existing pattern of writing a flat `sessions` document with `update`/`delete` permissions is prohibited.

5. **All gamification is server-side.** The Angular client must not calculate streaks, achievements, badges, or bonus points. It reads server-computed aggregates from Firestore in read-only mode.

6. **IPC message envelope is `{ type: string, payload: object }`.** Every C# → Angular and Angular → C# message must use this exact shape. The `type` field is a string constant. The `payload` field contains all message-specific data. No additional top-level fields outside `type` and `payload`. (Note: the source codebase uses heterogeneous top-level fields like `{ type, note, categoryName }`. The target normalizes this into `{ type, payload: { note, categoryName } }`.)

7. **The C# shell is stateless with respect to UI.** It does not track timer state, current view, or user session. It only relays IPC messages, manages OS hooks, and persists settings to disk (as a bridge service, since settings also sync to Firestore).

8. **camelCase JSON everywhere.** Both C# outbound serialization and Angular consumption must use `camelCase` property naming. The source codebase's inconsistent casing (some PascalCase, some camelCase) must be normalized.

9. **Offline-first.** The application must function flawlessly without internet. Firestore's native offline persistence handles the Standard Persistence path. The Event Ledger path uses Firestore's offline write queue — events are written to IndexedDB immediately and synced when connectivity returns.

10. **Active Window Whitelist is mandatory.** Unlike the source codebase (which has no whitelist), the target must implement process-level foreground window checking to prevent false idles when users are actively working in whitelisted applications.

### 1.5. Glossary of Domain Terms

| Term | Definition |
|---|---|
| **Sentinel** | The application name. A desktop productivity and time-management utility. |
| **Focus Session** | A timed Pomodoro work period. Default duration: 25 minutes. Tracked from `TimerStarted` to `TimerCompleted` (or `TimerEndedEarly`). |
| **Distraction** | An interruption logged during a focus session. Triggered by idle detection. Contains a user-typed note and optional category. |
| **Distraction Auditor** | The forced-overlay modal that appears when idle is detected during a focus session. Called "Intervention Modal" in the source codebase. Cannot be dismissed without logging a distraction or marking a false alarm. |
| **Distraction Taxonomy** | A hierarchical categorization system. Raw distraction notes (e.g., "twitter", "instagram") are mapped to categories (e.g., "Social Media"). Enables cleaner reporting. |
| **Normalized Note** | A distraction note transformed to lowercase, trimmed, and whitespace-collapsed. Used for deduplication and taxonomy matching. |
| **False Alarm** | An idle detection event that the user marks as not a genuine distraction (e.g., they were thinking, reading a physical book). Tracked separately in reports. |
| **Idle Detection** | Passive OS-level monitoring of global mouse and keyboard input via `GetLastInputInfo`. If no input is received for the configured threshold (default 45 seconds), an idle event is raised. |
| **Active Window Whitelist** | A user-configurable list of process names (e.g., `devenv.exe`, `code.exe`). When one of these processes owns the foreground window, idle detection is paused or the threshold is extended to prevent false alarms during passive work (reading docs, watching IDE compilation). |
| **Smart Suppression** | The media-aware idle suppression feature. If audio is playing (detected via Windows Core Audio API), idle detection is suppressed to avoid interrupting video/audio learning sessions. |
| **Snooze** | Temporary suppression of idle detection for a user-specified duration (in minutes). Used during deliberate breaks outside the timer or during "Watching Content" mode. |
| **Event Ledger** | The append-only `session_events` Firestore collection. Each event is immutable and captures a single state transition (timer started, idle detected, distraction logged, etc.). Processed by Cloud Functions to compute aggregates. |
| **Standard Persistence** | Firestore documents that use native offline persistence and direct read/write from the client. Used for settings, planner blocks, and taxonomy. |
| **Swift Recovery** | A gamification mechanic. If the time between an `IdleDetected` event and the corresponding `DistractionLogged` event is under 60 seconds, the server awards bonus points. Speed tiers: Instant (< 15s), Fast (< 30s), Swift (< 60s). |
| **Shiny Badge** | An aesthetic badge variant awarded by server-side RNG upon completing a Perfect Focus Block (no distractions, no early end). Rarity tiers: Common, Uncommon, Rare, Legendary. |
| **Perfect Focus Block** | A focus session that completes naturally (timer reaches 00:00) with zero distractions and zero false alarms. Eligible for shiny badge RNG. |
| **Compact Mode** | A small corner overlay window showing only the timer and essential controls. Called "Mini-Overlay Mode" in the source codebase. |
| **Planner** | A Teams-style calendar module for scheduling focus blocks. New in the target architecture. Not present in the source codebase. |
| **IPC Bridge** | The bidirectional JSON message channel between the C# Photino shell and the Angular frontend. Messages use the envelope `{ type: string, payload: object }`. |
| **Photino** | A lightweight, cross-platform framework for hosting web UIs in native windows. Replaces WPF + WebView2 in the target architecture. Uses the OS-native web view (Edge/WebView2 on Windows, WebKit on macOS/Linux). |

### 1.6. Document Conventions & Placeholder Legend

#### Formatting Conventions

- **Code blocks** contain exact, copy-pasteable implementations or schemas. They are never truncated or summarized.
- **Tables** enumerate every field, message type, or configuration option exhaustively. No rows are omitted.
- **"Source match"** indicates the existing codebase already implements this feature and it can be ported with adaptation to the new stack.
- **"New — Target Architecture"** indicates the feature does not exist in the source codebase and must be built from scratch per `TARGET_ARCHITECTURE.md`.
- **"Source deviation"** indicates the source codebase implements something differently from what the target architecture requires. The deviation is documented and the target rule takes precedence.

#### Section Status Legend

Each section body, when expanded, will carry a status indicator:

| Status | Meaning |
|---|---|
| `[PORTED]` | Existing logic mapped 1:1 from source to target, with stack-specific adaptations (e.g., React → Angular, WPF → Photino). |
| `[NEW]` | Feature specified in `TARGET_ARCHITECTURE.md` that has no source-codebase equivalent. Must be built from scratch. |
| `[REDESIGNED]` | Existing feature whose implementation must fundamentally change (e.g., Firestore flat collections → Event Ledger). |
| `[DROPPED]` | Source-codebase feature that is not carried forward (e.g., SQLite, EF Core migrations, WPF-specific window chrome). |

#### Cross-Reference Notation

Sections reference other sections using the format `→ §X.Y.Z` (e.g., `→ §3.2.1` references "IPC Bridge > C# → Angular Messages > IDLE_DETECTED"). These cross-references are stable and do not change when section content is expanded.

---

- **2. Photino C# Shell & Native Host**
    - 2.1. Project Scaffold & Build Configuration
        - 2.1.1. .csproj Configuration (TargetFramework, OutputType, Photino NuGet References)
        - 2.1.2. Single-File / Self-Contained Publish Profile
        - 2.1.3. App Manifest & UAC Elevation Requirements
        - 2.1.4. Embedded Resource Strategy (Angular dist Output)
    - 2.2. Application Lifecycle
        - 2.2.1. Entry Point & PhotinoWindow Initialization
        - 2.2.2. Startup Sequence (DB Init → Settings Load → Window Create → IPC Bind)
        - 2.2.3. Graceful Shutdown & Resource Disposal
        - 2.2.4. Global Exception Handling & Crash Reporter
            - 2.2.4.1. AppDomain.UnhandledException Handler
            - 2.2.4.2. TaskScheduler.UnobservedTaskException Handler
            - 2.2.4.3. Crash Log File Location & Rotation Policy
    - 2.3. Window Management
        - 2.3.1. Main Window Properties (Size, Title, Chromeless, AlwaysOnTop)
        - 2.3.2. Compact / Mini-Overlay Mode (Corner Overlay Toggle)
        - 2.3.3. DragMove Implementation for Chromeless Window
        - 2.3.4. Power State & Sleep/Resume Handling (WndProc Equivalent)
    - 2.4. Global Hotkey Registration
        - 2.4.1. Ctrl+Shift+S — Start/Pause Timer
        - 2.4.2. Ctrl+Shift+D — Log Distraction
        - 2.4.3. Platform P/Invoke for RegisterHotKey / UnregisterHotKey

---
