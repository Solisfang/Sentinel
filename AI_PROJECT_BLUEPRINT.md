# AI PROJECT BLUEPRINT — PROJECT SENTINEL

## Master Index

- **1. Project Overview & Migration Charter**
    - 1.1. Purpose & Scope of This Document
    - 1.2. Source Architecture Summary (WPF/WebView2 + React + SQLite)
    - 1.3. Target Architecture Summary (Photino/C# + Angular + Firebase)
    - 1.4. Migration Principles & Non-Negotiable Constraints
    - 1.5. Glossary of Domain Terms
    - 1.6. Document Conventions & Placeholder Legend

---

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

## 2. Photino C# Shell & Native Host

**Status: `[REDESIGNED]`** — The entire desktop host is rebuilt from WPF + WebView2 to Photino. The C# shell retains all OS-level responsibilities (idle detection, media detection, hotkeys, window management) but sheds all data-access and reporting logic. Per `TARGET_ARCHITECTURE.md` §3, the shell is strictly a "dumb" wrapper.

### 2.1. Project Scaffold & Build Configuration

#### 2.1.1. .csproj Configuration `[REDESIGNED]`

The source project (`Sentinel.Engine/Sentinel.Engine.csproj`) targets `net8.0-windows` with `<UseWPF>true</UseWPF>` and references `Microsoft.Web.WebView2` and `Microsoft.EntityFrameworkCore.Sqlite`. The target project removes all three dependencies and replaces them with Photino.

**Source .csproj (existing — to be replaced):**

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net8.0-windows</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <UseWPF>true</UseWPF>
    <AssemblyName>Sentinel</AssemblyName>
    <RootNamespace>Sentinel.Engine</RootNamespace>
    <Version>1.0.0</Version>
    <FileVersion>1.0.0.0</FileVersion>
    <AssemblyVersion>1.0.0.0</AssemblyVersion>
    <Product>Sentinel</Product>
    <Description>Privacy-first Pomodoro overlay for Windows</Description>
    <Company>Sentinel</Company>
    <Copyright>Copyright © 2026</Copyright>
    <ApplicationIcon>sentinel.ico</ApplicationIcon>
    <PublishSingleFile>true</PublishSingleFile>
    <SelfContained>true</SelfContained>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
    <IncludeNativeLibrariesForSelfExtract>true</IncludeNativeLibrariesForSelfExtract>
    <EnableCompressionInSingleFile>true</EnableCompressionInSingleFile>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.EntityFrameworkCore.Sqlite" Version="8.0.*" />
    <PackageReference Include="Microsoft.Web.WebView2" Version="1.0.3856.49" />
  </ItemGroup>
  <ItemGroup>
    <Content Include="wwwroot\**" CopyToOutputDirectory="PreserveNewest" />
  </ItemGroup>
</Project>
```

**Target .csproj (new — Photino):**

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net8.0-windows</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <!-- NO UseWPF — Photino replaces WPF entirely -->
    <AssemblyName>Sentinel</AssemblyName>
    <RootNamespace>Sentinel.Shell</RootNamespace>
    <Version>2.0.0</Version>
    <FileVersion>2.0.0.0</FileVersion>
    <AssemblyVersion>2.0.0.0</AssemblyVersion>
    <Product>Sentinel</Product>
    <Description>Privacy-first Pomodoro overlay for Windows — Photino shell</Description>
    <Company>Sentinel</Company>
    <Copyright>Copyright © 2026</Copyright>
    <ApplicationIcon>sentinel.ico</ApplicationIcon>
    <PublishSingleFile>true</PublishSingleFile>
    <SelfContained>true</SelfContained>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
    <IncludeNativeLibrariesForSelfExtract>true</IncludeNativeLibrariesForSelfExtract>
    <EnableCompressionInSingleFile>true</EnableCompressionInSingleFile>
  </PropertyGroup>
  <ItemGroup>
    <!-- Photino NuGet — replaces both WPF and WebView2 -->
    <PackageReference Include="Photino.NET" Version="3.*" />
    <!-- System.Text.Json for IPC serialization (included in .NET 8 SDK but pinned for clarity) -->
    <PackageReference Include="System.Text.Json" Version="8.0.*" />
    <!-- NO Microsoft.EntityFrameworkCore.Sqlite — all persistence via Firestore -->
    <!-- NO Microsoft.Web.WebView2 — Photino uses the OS-native web view -->
  </ItemGroup>
  <ItemGroup>
    <!-- Angular dist output embedded as content -->
    <Content Include="wwwroot\**" CopyToOutputDirectory="PreserveNewest" />
  </ItemGroup>
</Project>
```

**Key differences:**

| Property | Source | Target |
|---|---|---|
| `UseWPF` | `true` | **Removed entirely** |
| `RootNamespace` | `Sentinel.Engine` | `Sentinel.Shell` (reflects "dumb wrapper" role) |
| NuGet: `Microsoft.Web.WebView2` | Present | **Removed** |
| NuGet: `Microsoft.EntityFrameworkCore.Sqlite` | Present | **Removed** |
| NuGet: `Photino.NET` | Not present | **Added** (`3.*`) |
| `Version` | `1.0.0` | `2.0.0` (new major version for architecture break) |

**Constraint enforcement:** The build must fail if any of the following namespaces appear in source files: `System.Windows` (WPF), `Microsoft.Web.WebView2`, `Microsoft.EntityFrameworkCore`. A `.editorconfig` rule or a build-time analyzer should enforce this.

#### 2.1.2. Single-File / Self-Contained Publish Profile `[PORTED]`

The publish strategy carries forward from the source with no changes to the publish properties. The target project retains:

```xml
<PublishSingleFile>true</PublishSingleFile>
<SelfContained>true</SelfContained>
<RuntimeIdentifier>win-x64</RuntimeIdentifier>
<IncludeNativeLibrariesForSelfExtract>true</IncludeNativeLibrariesForSelfExtract>
<EnableCompressionInSingleFile>true</EnableCompressionInSingleFile>
```

**Publish command:**

```powershell
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```

The output is a single `Sentinel.exe` with the .NET runtime, Photino native libraries, and the `wwwroot/` folder (Angular dist) alongside it. The `wwwroot/` folder is **not** embedded inside the single-file EXE — it must be co-located as a sibling directory (Photino loads files from disk via `PhotinoWindow.Load()`).

#### 2.1.3. App Manifest & UAC Elevation Requirements `[PORTED]`

The source application manifest (`Sentinel.Engine/app.manifest`) specifies PerMonitorV2 DPI awareness and Windows 10/11 compatibility. This carries forward to the target unchanged.

**Source manifest (retained in target):**

```xml
<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="1.0.0.0" name="Sentinel"/>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
    </windowsSettings>
  </application>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <!-- Windows 10/11 -->
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}" />
    </application>
  </compatibility>
</assembly>
```

**UAC:** Sentinel does not require elevated privileges. The manifest does not include a `requestedExecutionLevel` element, defaulting to `asInvoker`. `GetLastInputInfo`, `GetForegroundWindow`, `RegisterHotKey`, and the Core Audio COM APIs all function without elevation.

**DPI:** Photino on Windows uses the same Edge/WebView2 runtime underneath. The `PerMonitorV2` manifest setting ensures proper scaling when the window is dragged between monitors with different DPI settings. The Angular frontend must use responsive CSS units (rem, %, vw/vh) rather than fixed pixel values.

#### 2.1.4. Embedded Resource Strategy (Angular dist Output) `[REDESIGNED]`

**Source strategy:** Vite builds the React app to `Sentinel.Engine/wwwroot/`. The .csproj includes `<Content Include="wwwroot\**" CopyToOutputDirectory="PreserveNewest" />`. WebView2 loads via `WebView.CoreWebView2.Navigate(new Uri(wwwrootPath).AbsoluteUri)` in production, or `http://localhost:5173` in dev mode.

**Target strategy:** Angular CLI builds to the same `wwwroot/` directory relative to the shell project. Photino loads the Angular app differently:

- **Production:** `PhotinoWindow.Load("wwwroot/index.html")` — loads from a file path relative to the executable. Photino resolves this to an absolute path internally.
- **Development:** `PhotinoWindow.Load(new Uri("http://localhost:4200"))` — Angular CLI dev server.

**Angular CLI build output configuration** (in `angular.json`):

```json
{
  "projects": {
    "sentinel-ui": {
      "architect": {
        "build": {
          "options": {
            "outputPath": "../Sentinel.Shell/wwwroot"
          }
        }
      }
    }
  }
}
```

**Detection logic for dev vs. production mode:**

```csharp
var wwwrootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot", "index.html");
if (File.Exists(wwwrootPath))
{
    window.Load(wwwrootPath);
}
else
{
    window.Load(new Uri("http://localhost:4200"));
}
```

This mirrors the existing source pattern from `MainWindow.InitializeWebView()` which checks for `wwwroot/index.html` existence and falls back to `http://localhost:5173`.

### 2.2. Application Lifecycle

#### 2.2.1. Entry Point & PhotinoWindow Initialization `[REDESIGNED]`

**Source entry point:** The source uses WPF's `App.xaml.cs` (`OnStartup`) → `MainWindow.xaml.cs` constructor → `OnLoaded`. The `MainWindow` constructor creates `UserActivityMonitor`, `DistractionRepository`, `ReportingService`, `DatabaseSeeder`, and loads `AppSettings`. `OnLoaded` initializes the database, seeds data, and initializes WebView2.

**Target entry point:** The target replaces the WPF application lifecycle with a `Program.cs` containing a standard `Main` method. There is no `App.xaml`, no XAML, and no WPF dispatcher. Photino provides its own message loop.

**Target `Program.cs` (complete structure):**

```csharp
using System.Text.Json;
using PhotinoNET;

namespace Sentinel.Shell;

public class Program
{
    private static PhotinoWindow? _window;
    private static UserActivityMonitor? _activityMonitor;
    private static AppSettings _settings = new();
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    [STAThread]
    public static void Main(string[] args)
    {
        // 1. Initialize crash reporter (must be first)
        CrashReporter.Initialize();
        SentinelLog.Info("Application starting...");
        SentinelLog.TrimIfNeeded();

        // 2. Load settings from disk
        _settings = SettingsService.Load();

        // 3. Initialize idle detection
        _activityMonitor = new UserActivityMonitor(_settings.IdleThresholdSeconds);
        _activityMonitor.SuppressDuringMedia = _settings.SuppressDuringMedia;
        _activityMonitor.IdleDetected += OnIdleDetected;
        _activityMonitor.UserActive += OnUserActive;

        // 4. Determine content source
        var wwwrootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot", "index.html");
        var isProduction = File.Exists(wwwrootPath);

        // 5. Create Photino window
        _window = new PhotinoWindow()
            .SetTitle("Sentinel")
            .SetUseOsDefaultSize(false)
            .SetSize(480, 640)
            .SetMinSize(360, 480)
            .SetCenter()
            .SetChromeless(true)
            .SetTopMost(_settings.AlwaysOnTop)
            .SetResizable(true)
            .SetLogVerbosity(0)
            .RegisterWebMessageReceivedHandler(OnWebMessageReceived)
            .RegisterWindowClosingHandler(OnWindowClosing);

        // 6. Load content
        if (isProduction)
        {
            _window.Load(wwwrootPath);
            SentinelLog.Info($"Production mode — loaded {wwwrootPath}");
        }
        else
        {
            _window.Load(new Uri("http://localhost:4200"));
            SentinelLog.Info("Dev mode — navigated to http://localhost:4200");
        }

        // 7. Register global hotkeys (after window handle is available)
        _window.RegisterCustomSchemeHandler("sentinel", HandleCustomScheme);

        // 8. Start the message loop (blocks until window closes)
        _window.WaitForClose();

        // 9. Cleanup
        OnShutdown();
    }
}
```

**Key differences from source:**

| Aspect | Source (WPF) | Target (Photino) |
|---|---|---|
| Thread model | WPF `Dispatcher` with `DispatcherTimer` | Photino's internal message loop; use `System.Timers.Timer` or `System.Threading.Timer` for polling |
| Window creation | XAML declarative + code-behind constructor | Fluent builder API (`new PhotinoWindow().Set...()`) |
| Content loading | `CoreWebView2.Navigate()` after async `EnsureCoreWebView2Async()` | `PhotinoWindow.Load()` — synchronous, called before `WaitForClose()` |
| IPC binding | `CoreWebView2.WebMessageReceived += handler` | `RegisterWebMessageReceivedHandler(handler)` |
| Message sending | `CoreWebView2.PostWebMessageAsJson(json)` | `PhotinoWindow.SendWebMessage(json)` |
| Database init | `DistractionRepository.InitializeAsync()` in `OnLoaded` | **Removed** — no local database |
| Seeder | `DatabaseSeeder.SeedAsync()` in `OnLoaded` | **Removed** — no local database |
| Reporting | `ReportingService` created in constructor | **Removed** — reports read from Firestore in Angular |

**What is NOT in the Photino shell (per `TARGET_ARCHITECTURE.md` "dumb wrapper" rule):**

- `DistractionRepository` — **DROPPED**. All distraction data is in Firestore, managed by Angular.
- `ReportingService` — **DROPPED**. Report aggregation moves to Cloud Functions (→ §8.3) and is read directly from Firestore by Angular (→ §5.7).
- `DatabaseSeeder` — **DROPPED**. No local SQLite database.
- `SentinelDbContext` — **DROPPED**. No Entity Framework.
- `FirebaseService` — **DROPPED** from shell. Firebase is client-side only (Angular).

**What IS in the Photino shell:**

- `UserActivityMonitor` — **PORTED** (→ §4.1)
- `MediaDetector` — **PORTED** (→ §4.3)
- `ActiveWindowWhitelist` — **NEW** (→ §4.4)
- `SettingsService` — **PORTED** (persists `AppSettings` to disk as a local cache; settings also sync to Firestore from Angular)
- `CrashReporter` — **PORTED** (→ §2.2.4)
- `SentinelLog` — **PORTED** (→ §2.2.4.3)
- `UpdateChecker` — **PORTED** (→ §2.2.1, runs in background)
- IPC message dispatch — **REDESIGNED** (→ §3)

#### 2.2.2. Startup Sequence `[REDESIGNED]`

The source startup sequence is: `App.OnStartup` → `MainWindow()` constructor → `OnLoaded` (async: DB init → seed → WebView2 init → send settings → register hotkeys → check updates).

The target startup sequence is streamlined because there is no database initialization:

```
1. CrashReporter.Initialize()
   └── Hooks AppDomain.UnhandledException
   └── Hooks TaskScheduler.UnobservedTaskException
   └── (No DispatcherUnhandledException — no WPF Dispatcher)

2. SentinelLog.TrimIfNeeded()
   └── Trims log file if > 2 MB

3. SettingsService.Load()
   └── Reads %LocalAppData%/Sentinel/settings.json
   └── Returns default AppSettings if file missing or corrupt

4. UserActivityMonitor construction
   └── new UserActivityMonitor(_settings.IdleThresholdSeconds)
   └── Set SuppressDuringMedia = _settings.SuppressDuringMedia
   └── Wire IdleDetected and UserActive event handlers

5. PhotinoWindow construction (fluent builder)
   └── SetChromeless(true) — no OS title bar
   └── SetSize(480, 640) — default full-mode dimensions
   └── SetMinSize(360, 480)
   └── SetTopMost(_settings.AlwaysOnTop)
   └── RegisterWebMessageReceivedHandler — IPC inbound
   └── RegisterWindowClosingHandler — cleanup

6. PhotinoWindow.Load()
   └── Production: Load("wwwroot/index.html")
   └── Development: Load(new Uri("http://localhost:4200"))

7. Register global hotkeys (→ §2.4)
   └── Requires window handle — available after window creation
   └── Ctrl+Shift+S (Start/Pause), Ctrl+Shift+D (Distraction)

8. PhotinoWindow.WaitForClose()
   └── Enters Photino's native message loop
   └── Blocks Main thread until window is closed
   └── All IPC callbacks execute on this thread

9. Post-close cleanup (OnShutdown)
   └── UnregisterHotKey calls
   └── ActivityMonitor.Stop()
   └── Save final settings (window position)
```

**Important timing note:** Unlike the source where `OnLoaded` is async and can `await` database operations before sending initial settings, the Photino shell must defer initial settings delivery. When Angular boots, it sends a `GET_SETTINGS` IPC message (→ §3.3). The shell responds with `SETTINGS_LOADED` (→ §3.2.3). This request-response pattern replaces the source's proactive `NavigationCompleted` → `SendSettingsToReactAsync()` flow.

#### 2.2.3. Graceful Shutdown & Resource Disposal `[PORTED]`

**Source shutdown:** `MainWindow.OnClosing` saves window position to settings. `MainWindow.OnClosed` unregisters hotkeys, removes WndProc hook, unwires `IdleDetected`/`UserActive` events, and stops the activity monitor.

**Target shutdown:** Photino's `RegisterWindowClosingHandler` replaces WPF's `OnClosing` event. A separate cleanup method runs after `WaitForClose()` returns.

```csharp
private static bool OnWindowClosing(object sender, EventArgs e)
{
    // Save window position before closing
    // Photino does not have a WindowState concept for maximized,
    // so we save the current position and size directly.
    if (_window != null && !_isCompactMode)
    {
        var (left, top) = _window.Location;
        _settings.WindowLeft = left;
        _settings.WindowTop = top;
    }
    else if (_isCompactMode)
    {
        _settings.WindowLeft = _savedLeft;
        _settings.WindowTop = _savedTop;
    }
    SettingsService.Save(_settings);

    return false; // false = allow close, true = cancel close
}

private static void OnShutdown()
{
    // Unregister global hotkeys
    if (_windowHandle != IntPtr.Zero)
    {
        NativeMethods.UnregisterHotKey(_windowHandle, HOTKEY_START_PAUSE);
        NativeMethods.UnregisterHotKey(_windowHandle, HOTKEY_DISTRACTION);
    }

    // Stop idle detection
    if (_activityMonitor != null)
    {
        _activityMonitor.IdleDetected -= OnIdleDetected;
        _activityMonitor.UserActive -= OnUserActive;
        _activityMonitor.Stop();
    }

    SentinelLog.Info("Application shutdown complete.");
}
```

#### 2.2.4. Global Exception Handling & Crash Reporter `[PORTED]`

The `CrashReporter` class carries forward from the source with one modification: the WPF `DispatcherUnhandledException` handler is removed (no WPF Dispatcher in Photino).

##### 2.2.4.1. AppDomain.UnhandledException Handler `[PORTED]`

**Source implementation (retained):**

```csharp
AppDomain.CurrentDomain.UnhandledException += (_, args) =>
{
    if (args.ExceptionObject is Exception ex)
    {
        LogCrash("UnhandledException", ex);
    }
};
```

This handler fires for unhandled exceptions on any thread. Since Photino's message loop does not catch exceptions the way WPF's Dispatcher does, this handler becomes the primary safety net for unhandled exceptions in event handlers and timer callbacks.

##### 2.2.4.2. TaskScheduler.UnobservedTaskException Handler `[PORTED]`

**Source implementation (retained):**

```csharp
TaskScheduler.UnobservedTaskException += (_, args) =>
{
    LogCrash("UnobservedTaskException", args.Exception);
    args.SetObserved();
};
```

This catches `Task` exceptions that were never awaited. Calling `SetObserved()` prevents the process from terminating.

**Source WPF handler (DROPPED):**

```csharp
// This handler is REMOVED in the target — no WPF Dispatcher exists.
// System.Windows.Application.Current.DispatcherUnhandledException += ...
```

##### 2.2.4.3. Crash Log File Location & Rotation Policy `[PORTED]`

**CrashReporter log:**

- **Path:** `%LocalAppData%/Sentinel/logs/crash.log`
- **Format per entry:**
  ```
  === 2026-04-03 14:22:15 UTC ===
  Source: {source}
  Type: {ex.GetType().FullName}
  Message: {ex.Message}
  Stack: {ex.StackTrace}
  ---
  ```
- **Rotation:** On startup, if file exceeds 1 MB, the first half of lines are discarded (keep second half).

**SentinelLog (application log):**

- **Path:** `%LocalAppData%/Sentinel/logs/sentinel.log`
- **Format per line:** `{yyyy-MM-dd HH:mm:ss} [{LEVEL}] {message}` where LEVEL is `INFO`, `WARN`, or `ERROR`.
- **Rotation:** On startup, if file exceeds 2 MB, the first half of lines are discarded (keep second half).
- **Thread safety:** All writes are serialized via a `lock` on a static object.

Both classes carry forward verbatim from the source, with the sole exception that `CrashReporter.Initialize()` no longer hooks `System.Windows.Application.Current.DispatcherUnhandledException`.

**Target CrashReporter.Initialize() (complete):**

```csharp
public static void Initialize()
{
    AppDomain.CurrentDomain.UnhandledException += (_, args) =>
    {
        if (args.ExceptionObject is Exception ex)
        {
            LogCrash("UnhandledException", ex);
        }
    };

    // NO DispatcherUnhandledException — Photino does not use WPF Dispatcher

    TaskScheduler.UnobservedTaskException += (_, args) =>
    {
        LogCrash("UnobservedTaskException", args.Exception);
        args.SetObserved();
    };

    Debug.WriteLine($"[Sentinel] Crash reporter initialized. Log: {LogPath}");
}
```

### 2.3. Window Management

#### 2.3.1. Main Window Properties `[REDESIGNED]`

**Source window properties** (from `MainWindow.xaml`):

| Property | Source Value |
|---|---|
| `Title` | `"Sentinel"` |
| `WindowStyle` | `None` (chromeless — custom titlebar) |
| `Background` | `#1a1a1e` |
| `Topmost` | `False` (overridden by `_settings.AlwaysOnTop` in constructor) |
| `Width` | `480` |
| `Height` | `640` |
| `MinWidth` | `360` |
| `MinHeight` | `480` |
| `ResizeMode` | `CanResizeWithGrip` |
| `WindowStartupLocation` | `CenterScreen` (overridden if saved position exists) |
| `ShowInTaskbar` | `True` |

**Target window properties** (Photino fluent API):

```csharp
_window = new PhotinoWindow()
    .SetTitle("Sentinel")
    .SetUseOsDefaultSize(false)
    .SetSize(480, 640)
    .SetMinSize(360, 480)
    .SetCenter()                         // CenterScreen equivalent
    .SetChromeless(true)                 // WindowStyle=None equivalent
    .SetTopMost(_settings.AlwaysOnTop)
    .SetResizable(true)
    .SetLogVerbosity(0);
```

**Source custom titlebar** (XAML in `MainWindow.xaml`): A 36px-high `<Grid>` with a `<TextBlock>` ("Sentinel" in `#666`, 12px, Medium weight) and a `<StackPanel>` containing three buttons (Minimize `−`, Maximize `□`/`❐`, Close `×`). The titlebar background is `#1a1a1e`. Button styles define hover colors (`#2a2a2e` for min/max, `#c42b1c` for close).

**Target custom titlebar:** Since Photino is chromeless, the titlebar is rendered entirely by Angular. The Angular app's root component must include a titlebar region at the top that:

1. Sends `OVERLAY_MINIMIZE`, `OVERLAY_MAXIMIZE`, and `OVERLAY_CLOSE` IPC messages to the C# shell for minimize/maximize/close actions.
2. Implements drag-to-move via the drag region (→ §2.3.3).
3. Matches the source visual design: 36px height, `#1a1a1e` background, `#666` text, button hover states.

**Restore saved window position:**

```csharp
if (_settings.WindowLeft >= 0 && _settings.WindowTop >= 0)
{
    _window.SetLeft((int)_settings.WindowLeft);
    _window.SetTop((int)_settings.WindowTop);
}
```

#### 2.3.2. Compact / Mini-Overlay Mode `[PORTED]`

**Source implementation** (`MainWindow.ApplyCompactToggle()`): The source toggles between two states:

**Full mode:**
- Size: restored from `_savedWidth` / `_savedHeight`
- Position: restored from `_savedLeft` / `_savedTop`
- Titlebar: visible (36px row)
- MinWidth: 360, MinHeight: 480
- ResizeMode: `CanResizeWithGrip`
- Topmost: `_settings.AlwaysOnTop`

**Compact mode** (three overlay styles from `_settings.OverlayStyle`):

| OverlayStyle | Width | Height | MinWidth | MinHeight |
|---|---|---|---|---|
| `"pill"` | 220 | 100 | 200 | 80 |
| `"monitoring"` | 320 | 160 | 280 | 120 |
| `"compact"` (default) | 260 | 140 | 220 | 100 |

Compact mode also: hides the titlebar, sets `Topmost = true` always, sets `ResizeMode = NoResize`, and positions the window at the bottom-right corner of the screen work area (20px inset from edges).

**Target implementation:** Photino does not have runtime `ResizeMode` toggling. The compact/full toggle must:

1. Save current size and position in instance fields (`_savedWidth`, `_savedHeight`, `_savedLeft`, `_savedTop`).
2. Call `_window.SetSize(width, height)` and `_window.SetLeft(x)` / `_window.SetTop(y)` for compact positioning.
3. Call `_window.SetTopMost(true)` for compact, `_window.SetTopMost(_settings.AlwaysOnTop)` for full.
4. Send `COMPACT_MODE_CHANGED` IPC message to Angular with `{ "type": "COMPACT_MODE_CHANGED", "payload": { "isCompact": bool } }` so the Angular app can switch its layout.

**Compact mode positioning (target):**

```csharp
// Get screen work area via P/Invoke (SystemParametersInfo or direct Win32 API)
var workArea = GetWorkArea(); // returns Rectangle { Left, Top, Right, Bottom }
var x = workArea.Right - width - 20;
var y = workArea.Bottom - height - 20;
_window.SetLeft(x);
_window.SetTop(y);
```

**Intervention expansion logic (ported from source):** When `IDLE_DETECTED` fires while in compact mode, the shell must:

1. Record `_wasCompactBeforeIntervention = true`.
2. Switch to full mode (so the Distraction Auditor modal is usable).
3. After `AUDITOR_CLEARED` is received, restore compact mode if `_wasCompactBeforeIntervention` was true.

#### 2.3.3. DragMove Implementation for Chromeless Window `[REDESIGNED]`

**Source:** WPF `DragMove()` is called from `TitleBar_MouseLeftButtonDown`. On double-click, `ToggleMaximize()` is called instead.

**Target:** Photino provides a built-in drag region mechanism. The Angular titlebar element must be marked with the CSS property:

```css
.titlebar-drag-region {
  -webkit-app-region: drag;
}
.titlebar-button {
  -webkit-app-region: no-drag;
}
```

Photino (and the underlying WebView2 on Windows) natively respects `-webkit-app-region: drag` to enable window dragging from HTML elements. No P/Invoke or manual `DragMove()` call is needed. Buttons within the titlebar must be marked `no-drag` so they remain clickable.

#### 2.3.4. Power State & Sleep/Resume Handling `[PORTED]`

**Source:** `MainWindow.WndProc` hooks `WM_POWERBROADCAST` (0x0218) and dispatches:

- `PBT_APMSUSPEND` (0x0004) → sends `{ "type": "SYSTEM_SUSPEND" }` to React
- `PBT_APMRESUMEAUTOMATIC` (0x0012) → sends `{ "type": "SYSTEM_RESUME" }` to React

**Target:** Photino does not expose a `WndProc` hook directly. The shell must use P/Invoke to subclass the Photino window and intercept power broadcast messages.

**Implementation approach:**

```csharp
using System.Runtime.InteropServices;

internal static class NativeMethods
{
    public delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr CallWindowProc(IntPtr lpPrevWndFunc, IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    public const int GWLP_WNDPROC = -4;
    public const uint WM_POWERBROADCAST = 0x0218;
    public const int PBT_APMSUSPEND = 0x0004;
    public const int PBT_APMRESUMEAUTOMATIC = 0x0012;
}
```

After the Photino window is created, obtain its `HWND` via `_window.WindowHandle` and install a subclass procedure:

```csharp
_originalWndProc = NativeMethods.SetWindowLongPtr(
    _windowHandle, NativeMethods.GWLP_WNDPROC,
    Marshal.GetFunctionPointerForDelegate(_wndProcDelegate));
```

The custom `WndProc` checks for `WM_POWERBROADCAST` and forwards `SYSTEM_SUSPEND` / `SYSTEM_RESUME` IPC messages to Angular via `_window.SendWebMessage(json)`. All other messages are passed through to `CallWindowProc(_originalWndProc, ...)`.

**Target IPC messages (normalized envelope):**

```json
{ "type": "SYSTEM_SUSPEND", "payload": {} }
{ "type": "SYSTEM_RESUME", "payload": {} }
```

Angular uses these to freeze/resume the timer and prompt the user with the `ResumePromptModal` (→ §5.4).

### 2.4. Global Hotkey Registration

#### 2.4.1. Ctrl+Shift+S — Start/Pause Timer `[PORTED]`

**Source:** `RegisterHotKey(hwnd, HOTKEY_START_PAUSE, MOD_CTRL | MOD_SHIFT, 0x53)` where `0x53` = `'S'`.

When triggered, the source sends `{ "type": "HOTKEY_START_PAUSE" }` via `PostWebMessageAsJson`. The React frontend's message handler calls `handleStartPauseRef.current()` to toggle the timer.

**Target:** Identical P/Invoke registration (→ §2.4.3). On trigger, send:

```json
{ "type": "HOTKEY_START_PAUSE", "payload": {} }
```

#### 2.4.2. Ctrl+Shift+D — Log Distraction `[PORTED]`

**Source:** `RegisterHotKey(hwnd, HOTKEY_DISTRACTION, MOD_CTRL | MOD_SHIFT, 0x44)` where `0x44` = `'D'`.

When triggered, the source sends `{ "type": "HOTKEY_DISTRACTION" }`. The React frontend opens the `InterventionModal` if the timer is running.

**Target:** Identical P/Invoke registration. On trigger, send:

```json
{ "type": "HOTKEY_DISTRACTION", "payload": {} }
```

#### 2.4.3. Platform P/Invoke for RegisterHotKey / UnregisterHotKey `[PORTED]`

**Source P/Invoke declarations (from `MainWindow.xaml.cs`):**

```csharp
[System.Runtime.InteropServices.DllImport("user32.dll")]
private static extern bool RegisterHotKey(IntPtr hWnd, int id, int fsModifiers, int vk);

[System.Runtime.InteropServices.DllImport("user32.dll")]
private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
```

**Target implementation** — consolidated into a `NativeMethods` static class:

```csharp
using System.Runtime.InteropServices;

namespace Sentinel.Shell;

internal static class NativeMethods
{
    // --- Hotkey Registration ---
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    public const uint MOD_CTRL = 0x0002;
    public const uint MOD_SHIFT = 0x0004;
    public const uint VK_S = 0x53;
    public const uint VK_D = 0x44;
    public const uint WM_HOTKEY = 0x0312;

    // --- Window Subclassing (for WndProc hook) ---
    public delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll")]
    public static extern IntPtr CallWindowProc(IntPtr lpPrevWndFunc, IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    public const int GWLP_WNDPROC = -4;

    // --- Power Broadcast ---
    public const uint WM_POWERBROADCAST = 0x0218;
    public const int PBT_APMSUSPEND = 0x0004;
    public const int PBT_APMRESUMEAUTOMATIC = 0x0012;

    // --- Foreground Window (for Active Window Whitelist → §4.4) ---
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    // --- Idle Detection (→ §4.1) ---
    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    // --- Window Foreground / Flash (for Intervention) ---
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [StructLayout(LayoutKind.Sequential)]
    public struct FLASHWINFO
    {
        public uint cbSize;
        public IntPtr hwnd;
        public uint dwFlags;
        public uint uCount;
        public uint dwTimeout;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool FlashWindowEx(ref FLASHWINFO pwfi);

    public const uint FLASHW_ALL = 3;
    public const uint FLASHW_TIMERNOFG = 12;

    // --- Screen Work Area (for Compact mode positioning) ---
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left, Top, Right, Bottom;
    }

    [DllImport("user32.dll")]
    public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, ref RECT pvParam, uint fWinIni);

    public const uint SPI_GETWORKAREA = 0x0030;
}
```

**Hotkey registration timing:** Hotkeys must be registered after the Photino window is created and its native handle (`_window.WindowHandle`) is available. The window handle is available immediately after the `PhotinoWindow` constructor completes (before `WaitForClose()`).

```csharp
_windowHandle = _window.WindowHandle;

// Register hotkeys
NativeMethods.RegisterHotKey(_windowHandle, HOTKEY_START_PAUSE,
    NativeMethods.MOD_CTRL | NativeMethods.MOD_SHIFT, NativeMethods.VK_S);
NativeMethods.RegisterHotKey(_windowHandle, HOTKEY_DISTRACTION,
    NativeMethods.MOD_CTRL | NativeMethods.MOD_SHIFT, NativeMethods.VK_D);
```

**Hotkey dispatch in WndProc subclass:**

```csharp
private static IntPtr WndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
{
    switch (msg)
    {
        case NativeMethods.WM_HOTKEY:
            var hotkeyId = wParam.ToInt32();
            if (hotkeyId == HOTKEY_START_PAUSE)
            {
                SendIpcMessage("HOTKEY_START_PAUSE", new { });
            }
            else if (hotkeyId == HOTKEY_DISTRACTION)
            {
                SendIpcMessage("HOTKEY_DISTRACTION", new { });
            }
            return IntPtr.Zero;

        case NativeMethods.WM_POWERBROADCAST:
            var pbType = wParam.ToInt32();
            if (pbType == NativeMethods.PBT_APMSUSPEND)
            {
                SendIpcMessage("SYSTEM_SUSPEND", new { });
            }
            else if (pbType == NativeMethods.PBT_APMRESUMEAUTOMATIC)
            {
                SendIpcMessage("SYSTEM_RESUME", new { });
            }
            break;
    }

    return NativeMethods.CallWindowProc(_originalWndProc, hWnd, msg, wParam, lParam);
}

private static void SendIpcMessage(string type, object payload)
{
    var message = JsonSerializer.Serialize(new { type, payload }, JsonOptions);
    _window?.SendWebMessage(message);
}
```

**Unregistration on close:**

```csharp
NativeMethods.UnregisterHotKey(_windowHandle, HOTKEY_START_PAUSE);
NativeMethods.UnregisterHotKey(_windowHandle, HOTKEY_DISTRACTION);
```

**Idle detection window focus behavior (ported from source):** When `IDLE_DETECTED` fires, the shell must force the window to the foreground so the Distraction Auditor is visible:

```csharp
private static void OnIdleDetected(object? sender, EventArgs e)
{
    if (_activityMonitor == null || !_activityMonitor.IsRunning) return;

    // Expand from compact mode if needed
    if (_isCompactMode)
    {
        _wasCompactBeforeIntervention = true;
        ToggleCompactMode();
    }
    else
    {
        _wasCompactBeforeIntervention = false;
    }

    // Force window to foreground
    _window?.SetTopMost(true);
    if (_windowHandle != IntPtr.Zero)
    {
        NativeMethods.SetForegroundWindow(_windowHandle);

        // Flash taskbar
        var flashInfo = new NativeMethods.FLASHWINFO
        {
            cbSize = (uint)Marshal.SizeOf<NativeMethods.FLASHWINFO>(),
            hwnd = _windowHandle,
            dwFlags = NativeMethods.FLASHW_ALL | NativeMethods.FLASHW_TIMERNOFG,
            uCount = 3,
            dwTimeout = 0
        };
        NativeMethods.FlashWindowEx(ref flashInfo);
    }

    SendIpcMessage("IDLE_DETECTED", new { });
}
```

**Source → Target IPC message rename:** The source sends `INTERVENTION_DISMISSED` from React when the user completes the intervention modal. The target architecture renames this to `AUDITOR_CLEARED` (per `TARGET_ARCHITECTURE.md` §3 naming convention). When received, the shell:

1. Restores `TopMost` to `_settings.AlwaysOnTop`.
2. If `_wasCompactBeforeIntervention`, toggles back to compact mode.

---

- **3. IPC Bridge (C# ↔ Angular)**
    - 3.1. Transport Mechanism
        - 3.1.1. Photino SendMessage / WebMessageReceived Event Binding
        - 3.1.2. JSON Serialization Contract (System.Text.Json Options)
        - 3.1.3. Message Envelope Schema (`{ type: string, payload: object }`)
    - 3.2. C# → Angular Messages (Outbound)
        - 3.2.1. `IDLE_DETECTED` — Idle Threshold Breach Notification
        - 3.2.2. `USER_ACTIVE` — User Resumed Input
        - 3.2.3. `SETTINGS_LOADED` — Initial Settings Payload on Startup
        - 3.2.4. `REPORT_DATA` — Aggregated Report Response
        - 3.2.5. `TAXONOMY_DATA` — Full Taxonomy Tree Response
        - 3.2.6. `SESSION_LIST` — Paginated Session History Response
        - 3.2.7. `UPDATE_AVAILABLE` — New Version Notification
        - 3.2.8. `SNOOZE_STATUS` — Snooze Timer State Change
    - 3.3. Angular → C# Messages (Inbound)
        - 3.3.1. `SAVE_SETTINGS` — Persist AppSettings to Disk
        - 3.3.2. `LOG_DISTRACTION` — Record Distraction Event
        - 3.3.3. `SAVE_SESSION` — Persist Completed Focus Session
        - 3.3.4. `GET_REPORT` — Request Report Aggregation
        - 3.3.5. `GET_TAXONOMY` — Request Taxonomy Data
        - 3.3.6. `UPDATE_TAXONOMY` — Rename / Remap Category
        - 3.3.7. `GET_SESSIONS` — Request Paginated History
        - 3.3.8. `SNOOZE_IDLE` — Temporarily Suppress Idle Detection
        - 3.3.9. `CANCEL_SNOOZE` — Resume Idle Detection
        - 3.3.10. `TOGGLE_COMPACT` — Switch Window Mode
        - 3.3.11. `CHECK_UPDATE` — Trigger Update Check
    - 3.4. Error Handling & Message Validation
        - 3.4.1. Unknown Message Type Logging
        - 3.4.2. Malformed Payload Rejection
        - 3.4.3. Thread Marshalling (Background → UI Thread Dispatch)

---

## 3. IPC Bridge (C# ↔ Angular)

**Status: `[REDESIGNED]`** — The transport mechanism changes from WebView2's `CoreWebView2.PostWebMessageAsJson` / `CoreWebView2.WebMessageReceived` to Photino's `PhotinoWindow.SendWebMessage` / `RegisterWebMessageReceivedHandler`. The message envelope schema is normalized from the source's heterogeneous top-level-field pattern into the strict `{ type, payload }` contract mandated by `TARGET_ARCHITECTURE.md` §1.4 rule 6. Several message types are renamed, several are dropped (database-dependent), and several are new.

### 3.1. Transport Mechanism

#### 3.1.1. Photino SendMessage / WebMessageReceived Event Binding `[REDESIGNED]`

**Source transport (WebView2):**

- **C# → JS (outbound):** `WebView.CoreWebView2.PostWebMessageAsJson(jsonString)` — posts a JSON string that the JavaScript side receives via `chrome.webview.addEventListener('message', handler)` where `handler` receives a `MessageEvent` with `.data` containing the parsed object.
- **JS → C# (inbound):** JavaScript calls `window.chrome.webview.postMessage(object)` — the C# side receives this via `CoreWebView2.WebMessageReceived += handler` where `handler.WebMessageAsJson` returns the JSON string.

**Target transport (Photino):**

- **C# → JS (outbound):** `_window.SendWebMessage(jsonString)` — Photino injects the message into the web view. The JavaScript side receives it via `window.external.receiveMessage` callback registration.
- **JS → C# (inbound):** JavaScript calls `window.external.sendMessage(jsonString)` — Photino invokes the handler registered via `RegisterWebMessageReceivedHandler`.

**Critical difference:** Photino's JavaScript API uses `window.external.sendMessage(string)` and `window.external.receiveMessage`, not `window.chrome.webview.postMessage(object)`. The Angular bridge service must adapt accordingly.

**C# handler registration (target):**

```csharp
_window = new PhotinoWindow()
    .RegisterWebMessageReceivedHandler(OnWebMessageReceived)
    // ... other configuration
    ;
```

**C# handler signature (target):**

```csharp
private static void OnWebMessageReceived(object? sender, string message)
{
    try
    {
        using var doc = JsonDocument.Parse(message);
        var root = doc.RootElement;
        if (!root.TryGetProperty("type", out var typeProp)) return;
        var messageType = typeProp.GetString();

        var payload = root.TryGetProperty("payload", out var payloadProp)
            ? payloadProp
            : default;

        switch (messageType)
        {
            // ... dispatch cases (→ §3.3)
        }
    }
    catch (Exception ex)
    {
        SentinelLog.Error("Error processing IPC message", ex);
    }
}
```

**Key differences from source handler:**

| Aspect | Source (WebView2) | Target (Photino) |
|---|---|---|
| Handler parameter | `CoreWebView2WebMessageReceivedEventArgs e` with `e.WebMessageAsJson` | `string message` (raw JSON string directly) |
| Async support | Handler is `async void`, can `await` DB calls | Handler is `void` — no `async` (no database calls in shell) |
| Thread context | Runs on WPF Dispatcher thread | Runs on Photino's message loop thread |
| Payload extraction | Reads top-level fields directly (`root.TryGetProperty("note", ...)`) | Reads from nested `payload` property (`payload.TryGetProperty("note", ...)`) |

**Angular-side bridge service (target):**

```typescript
// src/app/services/bridge.service.ts

import { Injectable, NgZone } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';

export interface IpcMessage<T = unknown> {
  type: string;
  payload: T;
}

@Injectable({ providedIn: 'root' })
export class BridgeService {
  private readonly messages$ = new Subject<IpcMessage>();

  constructor(private ngZone: NgZone) {
    // Register Photino inbound message handler
    if ((window as any).external?.receiveMessage) {
      (window as any).external.receiveMessage((rawMessage: string) => {
        this.ngZone.run(() => {
          try {
            const msg: IpcMessage = JSON.parse(rawMessage);
            this.messages$.next(msg);
          } catch {
            // Ignore non-JSON messages
          }
        });
      });
    } else {
      // Fallback for browser dev mode (no Photino host)
      window.addEventListener('message', (event: MessageEvent) => {
        this.ngZone.run(() => {
          try {
            const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            this.messages$.next(data);
          } catch {
            // Ignore non-JSON messages
          }
        });
      });
    }
  }

  /**
   * Send a message from Angular to the C# shell.
   */
  send<T>(type: string, payload: T = {} as T): void {
    const message = JSON.stringify({ type, payload });
    if ((window as any).external?.sendMessage) {
      (window as any).external.sendMessage(message);
    }
    // In browser dev mode without Photino, messages are silently dropped.
  }

  /**
   * Observe all inbound messages from the C# shell.
   */
  onMessage(): Observable<IpcMessage> {
    return this.messages$.asObservable();
  }

  /**
   * Observe inbound messages of a specific type, with typed payload.
   */
  on<T>(type: string): Observable<T> {
    return this.messages$.pipe(
      filter(msg => msg.type === type),
      map(msg => msg.payload as T)
    );
  }
}
```

**Source bridge (React — for reference, to be replaced):**

```typescript
// Source: Sentinel.UI/src/App.tsx
type WebViewHost = Window & {
  chrome?: {
    webview?: {
      addEventListener(event: string, handler: (e: MessageEvent) => void): void;
      removeEventListener(event: string, handler: (e: MessageEvent) => void): void;
      postMessage(message: unknown): void;
    };
  };
};

const postMessage = useCallback((message: object) => {
  const webview = (window as WebViewHost).chrome?.webview;
  if (webview) {
    webview.postMessage(message);
  }
}, []);
```

The source uses `chrome.webview.postMessage(object)` which accepts an object and serializes internally. The target uses `window.external.sendMessage(string)` which requires explicit `JSON.stringify()`.

#### 3.1.2. JSON Serialization Contract (System.Text.Json Options) `[REDESIGNED]`

**Source behavior:** The source codebase is inconsistent:
- Some outbound messages use anonymous objects with lowercase property names (e.g., `new { type = "IDLE_DETECTED" }`) — serialized with default `System.Text.Json` rules: PascalCase.
- Some use `JsonNamingPolicy.CamelCase` explicitly (e.g., `REPORT_DATA` and `TAXONOMY_DATA` handlers).
- Inbound messages from React use camelCase (JavaScript convention).

**Target contract: strict camelCase everywhere** (→ §1.4 rule 8).

**C# serialization options (singleton, used for all IPC):**

```csharp
namespace Sentinel.Shell;

internal static class IpcSerializer
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    public static string Serialize(string type, object payload)
    {
        var envelope = new { type, payload };
        return JsonSerializer.Serialize(envelope, Options);
    }
}
```

**Angular deserialization:** Angular receives camelCase JSON natively. No transformation needed. The `BridgeService` calls `JSON.parse()` on the raw string.

**C# deserialization for inbound messages:** The inbound handler uses `JsonDocument.Parse()` to read the `type` field and the `payload` sub-object. Individual payload fields are read via `TryGetProperty` with camelCase keys (e.g., `"pomodoroMinutes"`, `"idleThresholdSeconds"`).

#### 3.1.3. Message Envelope Schema `[REDESIGNED]`

**Source envelope (inconsistent):**

The source uses heterogeneous top-level fields. Examples:

```json
// Source outbound
{ "type": "IDLE_DETECTED" }
{ "type": "SETTINGS_LOADED", "todaySessionsCompleted": 3, "todayFocusSeconds": 4500, "settings": { ... } }
{ "type": "SNOOZE_STATUS", "isSnoozed": true, "secondsRemaining": 120 }
{ "type": "REPORT_DATA", "data": { ... } }

// Source inbound
{ "type": "LOG_DISTRACTION", "note": "twitter", "categoryName": "Social Media" }
{ "type": "TIMER_RUNNING", "running": true }
{ "type": "SNOOZE", "minutes": 5 }
```

**Target envelope (strict, normalized):**

Every message — inbound and outbound — MUST conform to exactly two top-level keys:

```typescript
interface IpcMessage {
  type: string;   // Message type constant (SCREAMING_SNAKE_CASE)
  payload: object; // All message-specific data nested here
}
```

**Normalization examples (source → target):**

```json
// Source: { "type": "IDLE_DETECTED" }
// Target: { "type": "IDLE_DETECTED", "payload": {} }

// Source: { "type": "SETTINGS_LOADED", "todaySessionsCompleted": 3, "todayFocusSeconds": 4500, "settings": { ... } }
// Target: { "type": "SETTINGS_LOADED", "payload": { "todaySessionsCompleted": 3, "todayFocusSeconds": 4500, "settings": { ... } } }

// Source: { "type": "LOG_DISTRACTION", "note": "twitter", "categoryName": "Social Media" }
// Target: { "type": "LOG_DISTRACTION", "payload": { "note": "twitter", "categoryName": "Social Media" } }

// Source: { "type": "TIMER_RUNNING", "running": true }
// Target: { "type": "TIMER_RUNNING", "payload": { "running": true } }
```

**C# outbound helper:**

```csharp
private static void SendIpcMessage(string type, object payload)
{
    var json = IpcSerializer.Serialize(type, payload);
    _window?.SendWebMessage(json);
}

// Usage:
SendIpcMessage("IDLE_DETECTED", new { });
SendIpcMessage("SETTINGS_LOADED", new { todaySessionsCompleted = 3, todayFocusSeconds = 4500, settings = settingsObj });
SendIpcMessage("SNOOZE_STATUS", new { isSnoozed = true, secondsRemaining = 120 });
```

**Angular outbound helper:**

```typescript
// Usage:
this.bridge.send('LOG_DISTRACTION', { note: 'twitter', categoryName: 'Social Media' });
this.bridge.send('TIMER_RUNNING', { running: true });
this.bridge.send('GET_SETTINGS'); // payload defaults to {}
```

### 3.2. C# → Angular Messages (Outbound)

All outbound messages are sent from the C# Photino shell to the Angular frontend via `_window.SendWebMessage(json)`. This section documents every message type, its exact `payload` shape, the trigger condition, and the migration mapping from the source.

#### 3.2.1. `IDLE_DETECTED` `[PORTED]`

**Source:** `{ "type": "IDLE_DETECTED" }` — sent from `OnIdleDetected` when `UserActivityMonitor.IdleDetected` fires.

**Target:**

```json
{
  "type": "IDLE_DETECTED",
  "payload": {
    "idleDurationMs": 45200
  }
}
```

| Payload Field | Type | Description |
|---|---|---|
| `idleDurationMs` | `number` | The measured idle duration in milliseconds at the moment the threshold was breached. Computed from `GetLastInputInfo`. New in target — the source sends no payload data. |

**Trigger:** `UserActivityMonitor.IdleDetected` event fires (→ §4.1). The shell also forces the window to foreground, flashes the taskbar, and expands from compact mode if necessary (→ §2.3.2, §2.4.3).

**Angular handler:** The Angular timer service freezes the timer, pauses the session, shows the Distraction Auditor modal, and writes an `IdleDetected` event to the Firestore Event Ledger (→ §7.3).

**Source mapping:** The source handler in `App.tsx` sets `setIsRunning(false)`, `setIsPausedByIntervention(true)`, `setShowIntervention(true)`, and requests taxonomy data. The target Angular handler must replicate this behavior.

#### 3.2.2. `USER_ACTIVE` `[PORTED]`

**Source:** Not explicitly sent as an IPC message. The `UserActive` event fires on the C# side but `OnUserActive` only calls `Debug.WriteLine`. The React handler case `'USER_ACTIVE'` exists but is a no-op.

**Target:**

```json
{
  "type": "USER_ACTIVE",
  "payload": {}
}
```

**Trigger:** `UserActivityMonitor.UserActive` event fires — user resumes input after being idle.

**Angular handler:** Reserved for future UX hints (e.g., "User returned" notification). Currently a no-op, matching source behavior. The Distraction Auditor is NOT auto-dismissed — the user must explicitly log a distraction or mark false alarm.

#### 3.2.3. `SETTINGS_LOADED` `[REDESIGNED]`

**Source:**

```json
{
  "type": "SETTINGS_LOADED",
  "todaySessionsCompleted": 3,
  "todayFocusSeconds": 4500,
  "settings": {
    "pomodoroMinutes": 25,
    "shortBreakMinutes": 5,
    "longBreakMinutes": 15,
    "idleThresholdSeconds": 45,
    "cloudSyncEnabled": false,
    "soundEnabled": true,
    "alwaysOnTop": false,
    "suppressDuringMedia": true,
    "dailyFocusGoalMinutes": 120,
    "overlayStyle": "compact",
    "customPresets": [{ "name": "Classic", "focus": 25, "shortBreak": 5, "longBreak": 15 }]
  }
}
```

The source computes `todaySessionsCompleted` and `todayFocusSeconds` by querying the local SQLite database.

**Target:**

```json
{
  "type": "SETTINGS_LOADED",
  "payload": {
    "settings": {
      "pomodoroMinutes": 25,
      "shortBreakMinutes": 5,
      "longBreakMinutes": 15,
      "idleThresholdSeconds": 45,
      "cloudSyncEnabled": false,
      "soundEnabled": true,
      "alwaysOnTop": false,
      "suppressDuringMedia": true,
      "dailyFocusGoalMinutes": 120,
      "overlayStyle": "compact",
      "customPresets": [
        { "name": "Classic", "focus": 25, "shortBreak": 5, "longBreak": 15 }
      ],
      "activeWindowWhitelist": ["devenv.exe", "code.exe"]
    }
  }
}
```

| Payload Field | Type | Description |
|---|---|---|
| `settings` | `object` | Full `AppSettings` object. See exact schema in → §6.1.3. |
| `settings.activeWindowWhitelist` | `string[]` | **NEW** — list of whitelisted process names. Not present in source. |

**Changes from source:**
- `todaySessionsCompleted` and `todayFocusSeconds` are **REMOVED** from this message. In the target architecture, the shell has no database and cannot compute these values. Angular reads today's stats from Firestore's server-computed daily aggregate document (`users/{uid}/stats/daily/{date}`, → §6.2.3.1).
- `activeWindowWhitelist` is **ADDED** to the settings object.

**Trigger:** Sent in response to `GET_SETTINGS` inbound message from Angular. The source proactively sends this on `NavigationCompleted`; the target waits for Angular to request it after bootstrapping.

**C# implementation:**

```csharp
private static void HandleGetSettings()
{
    SendIpcMessage("SETTINGS_LOADED", new
    {
        settings = new
        {
            pomodoroMinutes = _settings.PomodoroMinutes,
            shortBreakMinutes = _settings.ShortBreakMinutes,
            longBreakMinutes = _settings.LongBreakMinutes,
            idleThresholdSeconds = _settings.IdleThresholdSeconds,
            cloudSyncEnabled = _settings.CloudSyncEnabled,
            soundEnabled = _settings.SoundEnabled,
            alwaysOnTop = _settings.AlwaysOnTop,
            suppressDuringMedia = _settings.SuppressDuringMedia,
            dailyFocusGoalMinutes = _settings.DailyFocusGoalMinutes,
            overlayStyle = _settings.OverlayStyle,
            customPresets = _settings.CustomPresets.Select(p => new
            {
                name = p.Name,
                focus = p.Focus,
                shortBreak = p.ShortBreak,
                longBreak = p.LongBreak
            }).ToArray(),
            activeWindowWhitelist = _settings.ActiveWindowWhitelist
        }
    });
}
```

#### 3.2.4. `REPORT_DATA` `[DROPPED]`

**Source:** The C# `ReportingService` queries SQLite and sends `{ "type": "REPORT_DATA", "data": ReportData }`. The React `ReportsScreen` displays this data.

**Target:** This message is **DROPPED**. The C# shell has no database and cannot generate report data. In the target architecture, Angular reads report data directly from Firestore server-computed aggregate documents (→ §6.2.3, §5.7). The `GET_REPORT_DATA` inbound message is also dropped (→ §3.3.4).

#### 3.2.5. `TAXONOMY_DATA` `[DROPPED]`

**Source:** The C# `DistractionRepository.GetTaxonomyDataAsync()` queries SQLite and sends `{ "type": "TAXONOMY_DATA", "data": TaxonomyData }`. Sent proactively after any taxonomy mutation and in response to `GET_TAXONOMY_DATA`.

**Target:** This message is **DROPPED**. Taxonomy data is stored in Firestore (`users/{uid}/taxonomy/{categoryId}`, → §6.2.1.3) and read directly by Angular via Firestore snapshot listeners. The C# shell has no role in taxonomy management.

#### 3.2.6. `SESSION_LIST` `[DROPPED]`

**Source:** The C# shell queries SQLite for paginated session history and sends `{ "type": "SESSION_LIST", "sessions": [...], "total": int }`.

**Target:** This message is **DROPPED**. Session history is derived from the Firestore Event Ledger and server-computed aggregates, read directly by Angular (→ §5.8).

#### 3.2.7. `UPDATE_AVAILABLE` `[PORTED]`

**Source:**

```json
{
  "type": "UPDATE_AVAILABLE",
  "currentVersion": "1.0.0",
  "latestVersion": "1.1.0",
  "downloadUrl": "https://github.com/.../releases/tag/v1.1.0",
  "releaseNotes": "Bug fixes and improvements."
}
```

**Target:**

```json
{
  "type": "UPDATE_AVAILABLE",
  "payload": {
    "currentVersion": "2.0.0",
    "latestVersion": "2.1.0",
    "downloadUrl": "https://github.com/.../releases/tag/v2.1.0",
    "releaseNotes": "Bug fixes and improvements."
  }
}
```

| Payload Field | Type | Description |
|---|---|---|
| `currentVersion` | `string` | Semantic version of the running executable (from `Assembly.GetName().Version`). |
| `latestVersion` | `string` | Tag name from GitHub Releases API, trimmed of leading `v`/`V`. |
| `downloadUrl` | `string` | `html_url` from the GitHub release object. |
| `releaseNotes` | `string` | `body` from the GitHub release object. |

**Trigger:** `UpdateChecker.CheckForUpdateAsync()` runs in the background after startup. If a newer version is found (and not cached within 24 hours), this message is sent. Carries forward from source without logic changes.

#### 3.2.8. `SNOOZE_STATUS` `[PORTED]`

**Source:**

```json
{ "type": "SNOOZE_STATUS", "isSnoozed": true, "secondsRemaining": 120 }
```

**Target:**

```json
{
  "type": "SNOOZE_STATUS",
  "payload": {
    "isSnoozed": true,
    "secondsRemaining": 120
  }
}
```

| Payload Field | Type | Description |
|---|---|---|
| `isSnoozed` | `boolean` | Whether idle detection is currently snoozed. |
| `secondsRemaining` | `number` | Seconds until snooze auto-expires. `0` if not snoozed. |

**Trigger:** Sent after processing `SNOOZE_IDLE`, `WATCHING_CONTENT`, or `CANCEL_SNOOZE` inbound messages. The source sends this from `SendSnoozeStatusToReact()`. Logic carries forward identically.

**C# implementation:**

```csharp
private static void SendSnoozeStatus()
{
    if (_activityMonitor == null) return;
    SendIpcMessage("SNOOZE_STATUS", new
    {
        isSnoozed = _activityMonitor.IsSnoozed,
        secondsRemaining = _activityMonitor.SnoozeSecondsRemaining
    });
}
```

#### 3.2.9. `SYSTEM_SUSPEND` `[PORTED]`

**Source:** `{ "type": "SYSTEM_SUSPEND" }` — sent from `WndProc` on `PBT_APMSUSPEND`.

**Target:**

```json
{ "type": "SYSTEM_SUSPEND", "payload": {} }
```

**Trigger:** WndProc subclass intercepts `WM_POWERBROADCAST` with `wParam == PBT_APMSUSPEND` (→ §2.3.4).

**Angular handler:** Freezes the timer if running. Sets `wasRunningBeforeSuspend = true` for resume logic.

#### 3.2.10. `SYSTEM_RESUME` `[PORTED]`

**Source:** `{ "type": "SYSTEM_RESUME" }` — sent from `WndProc` on `PBT_APMRESUMEAUTOMATIC`.

**Target:**

```json
{ "type": "SYSTEM_RESUME", "payload": {} }
```

**Trigger:** WndProc subclass intercepts `WM_POWERBROADCAST` with `wParam == PBT_APMRESUMEAUTOMATIC`.

**Angular handler:** If `wasRunningBeforeSuspend`, shows the `ResumePromptModal`: "System sleep detected. Resume session or start fresh?" User chooses to resume (timer continues) or start fresh (timer resets). Matches source `handleResumeAfterSleep(resume)` logic in `App.tsx`.

#### 3.2.11. `HOTKEY_START_PAUSE` `[PORTED]`

**Source:** `{ "type": "HOTKEY_START_PAUSE" }` — sent from `WndProc` on `WM_HOTKEY` with id 1.

**Target:**

```json
{ "type": "HOTKEY_START_PAUSE", "payload": {} }
```

**Trigger:** Global hotkey `Ctrl+Shift+S` pressed (→ §2.4.1).

**Angular handler:** Toggles timer start/pause, equivalent to clicking the Start/Pause button.

#### 3.2.12. `HOTKEY_DISTRACTION` `[PORTED]`

**Source:** `{ "type": "HOTKEY_DISTRACTION" }` — sent from `WndProc` on `WM_HOTKEY` with id 2.

**Target:**

```json
{ "type": "HOTKEY_DISTRACTION", "payload": {} }
```

**Trigger:** Global hotkey `Ctrl+Shift+D` pressed (→ §2.4.2).

**Angular handler:** If timer is running, freezes timer and opens Distraction Auditor (same behavior as `IDLE_DETECTED`). Matches source behavior where `HOTKEY_DISTRACTION` case mirrors `IDLE_DETECTED` case.

#### 3.2.13. `COMPACT_MODE_CHANGED` `[PORTED]`

**Source:** `{ "type": "COMPACT_MODE_CHANGED", "isCompact": true }` — sent from `ApplyCompactToggle()`.

**Target:**

```json
{
  "type": "COMPACT_MODE_CHANGED",
  "payload": {
    "isCompact": true
  }
}
```

| Payload Field | Type | Description |
|---|---|---|
| `isCompact` | `boolean` | `true` when entering compact/overlay mode, `false` when restoring full mode. |

**Trigger:** Sent after `ToggleCompactMode()` executes in the shell (→ §2.3.2).

**Angular handler:** Switches the UI layout between `CompactTimerScreen` (minimal overlay) and the full app with navigation.

#### 3.2.14. `SOUND_PLAYED` `[DROPPED]`

**Source:** The `PLAY_SOUND` is an inbound message (React → C#). The shell plays `System.Media.SystemSounds.Exclamation.Play()`. There is no outbound confirmation.

**Target:** The sound-playing responsibility moves to Angular using the Web Audio API (`new Audio('notification.mp3').play()`). The `PLAY_SOUND` inbound message is **DROPPED**. No C# involvement in sound playback.

#### 3.2.15. Complete Outbound Message Registry (Target)

| Message Type | Payload Shape | Status |
|---|---|---|
| `IDLE_DETECTED` | `{ idleDurationMs: number }` | `[PORTED]` + enhanced |
| `USER_ACTIVE` | `{}` | `[PORTED]` |
| `SETTINGS_LOADED` | `{ settings: AppSettings }` | `[REDESIGNED]` — no todaySessionsCompleted/todayFocusSeconds |
| `UPDATE_AVAILABLE` | `{ currentVersion, latestVersion, downloadUrl, releaseNotes }` | `[PORTED]` |
| `SNOOZE_STATUS` | `{ isSnoozed, secondsRemaining }` | `[PORTED]` |
| `SYSTEM_SUSPEND` | `{}` | `[PORTED]` |
| `SYSTEM_RESUME` | `{}` | `[PORTED]` |
| `HOTKEY_START_PAUSE` | `{}` | `[PORTED]` |
| `HOTKEY_DISTRACTION` | `{}` | `[PORTED]` |
| `COMPACT_MODE_CHANGED` | `{ isCompact: boolean }` | `[PORTED]` |
| `REPORT_DATA` | — | `[DROPPED]` — Angular reads Firestore directly |
| `TAXONOMY_DATA` | — | `[DROPPED]` — Angular reads Firestore directly |
| `SESSION_LIST` | — | `[DROPPED]` — Angular reads Firestore directly |
| `EXPORT_DATA_RESULT` | — | `[DROPPED]` — no local data export (Firestore-native) |
| `SEED_COMPLETE` | — | `[DROPPED]` — no local database seeding |

### 3.3. Angular → C# Messages (Inbound)

All inbound messages are sent from the Angular frontend to the C# shell via `window.external.sendMessage(jsonString)` (through `BridgeService.send()`). The shell parses the JSON, extracts `type` and `payload`, and dispatches to the appropriate handler.

#### 3.3.1. `SAVE_SETTINGS` `[PORTED]`

**Source:** `{ "type": "SAVE_SETTINGS", "settings": { ...fields } }` — the C# handler reads individual fields from `settings`, updates the in-memory `_settings` object, applies live changes (idle threshold, media suppression, always-on-top), and calls `SettingsService.Save(_settings)`.

**Target:**

```json
{
  "type": "SAVE_SETTINGS",
  "payload": {
    "settings": {
      "pomodoroMinutes": 25,
      "shortBreakMinutes": 5,
      "longBreakMinutes": 15,
      "idleThresholdSeconds": 45,
      "cloudSyncEnabled": false,
      "soundEnabled": true,
      "alwaysOnTop": false,
      "suppressDuringMedia": true,
      "dailyFocusGoalMinutes": 120,
      "overlayStyle": "compact",
      "customPresets": [
        { "name": "Deep Work", "focus": 50, "shortBreak": 10, "longBreak": 20 }
      ],
      "activeWindowWhitelist": ["devenv.exe", "code.exe"]
    }
  }
}
```

**C# handler:**

```csharp
case "SAVE_SETTINGS":
    HandleSaveSettings(payload);
    break;

// ...

private static void HandleSaveSettings(JsonElement payload)
{
    try
    {
        if (!payload.TryGetProperty("settings", out var settings)) return;

        if (settings.TryGetProperty("pomodoroMinutes", out var pm))
            _settings.PomodoroMinutes = pm.GetInt32();
        if (settings.TryGetProperty("shortBreakMinutes", out var sbm))
            _settings.ShortBreakMinutes = sbm.GetInt32();
        if (settings.TryGetProperty("longBreakMinutes", out var lbm))
            _settings.LongBreakMinutes = lbm.GetInt32();
        if (settings.TryGetProperty("idleThresholdSeconds", out var its))
            _settings.IdleThresholdSeconds = its.GetInt32();
        if (settings.TryGetProperty("cloudSyncEnabled", out var cse))
            _settings.CloudSyncEnabled = cse.GetBoolean();
        if (settings.TryGetProperty("soundEnabled", out var se))
            _settings.SoundEnabled = se.GetBoolean();
        if (settings.TryGetProperty("alwaysOnTop", out var aot))
            _settings.AlwaysOnTop = aot.GetBoolean();
        if (settings.TryGetProperty("suppressDuringMedia", out var sdm))
            _settings.SuppressDuringMedia = sdm.GetBoolean();
        if (settings.TryGetProperty("dailyFocusGoalMinutes", out var dfg))
            _settings.DailyFocusGoalMinutes = dfg.GetInt32();
        if (settings.TryGetProperty("overlayStyle", out var os))
            _settings.OverlayStyle = os.GetString() ?? "compact";
        if (settings.TryGetProperty("customPresets", out var cp) && cp.ValueKind == JsonValueKind.Array)
        {
            _settings.CustomPresets = cp.EnumerateArray()
                .Select(p => new CustomPreset
                {
                    Name = p.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "",
                    Focus = p.TryGetProperty("focus", out var f) ? f.GetInt32() : 25,
                    ShortBreak = p.TryGetProperty("shortBreak", out var sb) ? sb.GetInt32() : 5,
                    LongBreak = p.TryGetProperty("longBreak", out var lb) ? lb.GetInt32() : 15,
                })
                .ToList();
        }
        if (settings.TryGetProperty("activeWindowWhitelist", out var awl) && awl.ValueKind == JsonValueKind.Array)
        {
            _settings.ActiveWindowWhitelist = awl.EnumerateArray()
                .Select(e => e.GetString() ?? "")
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .ToList();
        }

        // Apply live changes
        if (_activityMonitor != null)
        {
            _activityMonitor.IdleThresholdSeconds = _settings.IdleThresholdSeconds;
            _activityMonitor.SuppressDuringMedia = _settings.SuppressDuringMedia;
        }
        if (!_isCompactMode)
        {
            _window?.SetTopMost(_settings.AlwaysOnTop);
        }

        SettingsService.Save(_settings);
        SentinelLog.Info("Settings saved.");
    }
    catch (Exception ex)
    {
        SentinelLog.Error("Failed to save settings", ex);
    }
}
```

This is a direct port from the source `HandleSaveSettings` method, extended with `activeWindowWhitelist` parsing and adapted from `Dispatcher.Invoke` (WPF) to direct calls (Photino runs handlers on its message loop thread).

#### 3.3.2. `LOG_DISTRACTION` `[REDESIGNED]`

**Source:** `{ "type": "LOG_DISTRACTION", "note": "twitter", "categoryName": "Social Media", "forceUncategorized": false }` — C# creates a `Distraction` EF entity and saves to SQLite.

**Target:**

```json
{
  "type": "LOG_DISTRACTION",
  "payload": {
    "note": "twitter",
    "normalizedNote": "twitter",
    "categoryName": "Social Media"
  }
}
```

**Target C# handler:** The shell does **NOT** persist this data. Per the "dumb wrapper" rule (→ §1.3.2 rule 1), the shell has no database. Instead, Angular is responsible for:

1. Writing a `DistractionLogged` event to the Firestore Event Ledger (→ §7.3).
2. Updating local taxonomy data via Firestore Standard Persistence (→ §7.2).

**Shell-side action:** None. The shell does not need to process this message at all because there is no local database. However, the shell **does** need to know the distraction was logged so it can restore window state. This is handled by the `AUDITOR_CLEARED` message instead (→ §3.3.13).

**Migration note:** In the source, `LOG_DISTRACTION` goes to the C# shell because SQLite is there. In the target, the Angular app writes directly to Firestore. The `LOG_DISTRACTION` IPC message is therefore **DROPPED** from the C# inbound handler. Angular handles it internally.

#### 3.3.3. `LOG_SESSION` `[REDESIGNED]`

**Source:** `{ "type": "LOG_SESSION", "durationSeconds": 1500, "sessionName": "Deep Work", "endedEarly": false, "startedAt": "2026-04-03T10:00:00Z" }` — C# creates a `Session` EF entity and saves to SQLite.

**Target:** This message is **DROPPED** from the C# inbound handler. Angular writes `TimerCompleted` or `TimerEndedEarly` events directly to the Firestore Event Ledger. The shell has no role in session persistence.

#### 3.3.4. `GET_REPORT_DATA` `[DROPPED]`

**Source:** `{ "type": "GET_REPORT_DATA", "range": "week" }` — C# queries SQLite via `ReportingService` and responds with `REPORT_DATA`.

**Target:** **DROPPED**. No local database. Angular reads report data directly from Firestore server-computed aggregates (→ §6.2.3).

#### 3.3.5. `GET_TAXONOMY_DATA` `[DROPPED]`

**Source:** `{ "type": "GET_TAXONOMY_DATA" }` — C# queries SQLite via `DistractionRepository.GetTaxonomyDataAsync()` and responds with `TAXONOMY_DATA`.

**Target:** **DROPPED**. Taxonomy data lives in Firestore (`users/{uid}/taxonomy/{categoryId}`). Angular uses Firestore snapshot listeners for real-time updates.

#### 3.3.6. `UPDATE_DISTRACTION_GROUP` `[DROPPED]`

**Source:** `{ "type": "UPDATE_DISTRACTION_GROUP", "normalizedNote": "twitter", "note": "Twitter", "categoryName": "Social Media" }` — C# calls `DistractionRepository.UpdateDistractionGroupAsync()`.

**Target:** **DROPPED**. Angular writes taxonomy updates directly to Firestore.

#### 3.3.7. `RENAME_CATEGORY` `[DROPPED]`

**Source:** `{ "type": "RENAME_CATEGORY", "oldName": "Social", "newName": "Social Media" }` — C# calls `DistractionRepository.RenameCategoryAsync()`.

**Target:** **DROPPED**. Angular writes directly to Firestore taxonomy documents.

#### 3.3.8. `DELETE_CATEGORY` `[DROPPED]`

**Source:** `{ "type": "DELETE_CATEGORY", "categoryName": "Misc" }` — C# calls `DistractionRepository.DeleteCategoryAsync()`.

**Target:** **DROPPED**. Angular deletes the Firestore taxonomy document directly.

#### 3.3.9. `GET_SESSIONS` `[DROPPED]`

**Source:** `{ "type": "GET_SESSIONS", "page": 1, "pageSize": 20 }` — C# queries SQLite and responds with `SESSION_LIST`.

**Target:** **DROPPED**. Angular reads session history from Firestore Event Ledger.

#### 3.3.10. `SNOOZE_IDLE` `[PORTED]`

**Source:** Two separate messages: `{ "type": "SNOOZE", "minutes": 5 }` and `{ "type": "WATCHING_CONTENT", "minutes": 30 }`, both aliasing `_activityMonitor.Snooze(minutes)`.

**Target:** Unified into a single message type:

```json
{
  "type": "SNOOZE_IDLE",
  "payload": {
    "minutes": 5
  }
}
```

| Payload Field | Type | Description |
|---|---|---|
| `minutes` | `number` | Duration to snooze idle detection. |

**C# handler:**

```csharp
case "SNOOZE_IDLE":
    if (payload.TryGetProperty("minutes", out var snoozeProp))
    {
        var minutes = snoozeProp.GetInt32();
        _activityMonitor?.Snooze(minutes);
        SentinelLog.Info($"Snooze activated for {minutes} minutes");
        SendSnoozeStatus();
    }
    break;
```

**Source rename:** `SNOOZE` and `WATCHING_CONTENT` are merged into `SNOOZE_IDLE`. The Angular UI can still differentiate "Snooze" vs. "Watching Content" in its own UX, but both send the same IPC message.

#### 3.3.11. `CANCEL_SNOOZE` `[PORTED]`

**Source:** `{ "type": "CANCEL_SNOOZE" }`

**Target:**

```json
{
  "type": "CANCEL_SNOOZE",
  "payload": {}
}
```

**C# handler:**

```csharp
case "CANCEL_SNOOZE":
    _activityMonitor?.CancelSnooze();
    SentinelLog.Info("Snooze cancelled by user");
    SendSnoozeStatus();
    break;
```

#### 3.3.12. `TOGGLE_COMPACT` `[PORTED]`

**Source:** `{ "type": "TOGGLE_COMPACT" }`

**Target:**

```json
{
  "type": "TOGGLE_COMPACT",
  "payload": {}
}
```

**C# handler:** Calls `ToggleCompactMode()` which toggles between full and compact window mode (→ §2.3.2), then sends `COMPACT_MODE_CHANGED` outbound message (→ §3.2.13).

#### 3.3.13. `AUDITOR_CLEARED` `[REDESIGNED]`

**Source:** `{ "type": "INTERVENTION_DISMISSED" }` — React sends this after the user logs a distraction or marks a false alarm. The C# handler restores `Topmost` and compact mode.

**Target (renamed):**

```json
{
  "type": "AUDITOR_CLEARED",
  "payload": {}
}
```

**Name change rationale:** `TARGET_ARCHITECTURE.md` §3 uses "Distraction Auditor" instead of "Intervention Modal" and specifies the shell listens for `AuditorCleared`.

**C# handler:**

```csharp
case "AUDITOR_CLEARED":
    _window?.SetTopMost(_settings.AlwaysOnTop);
    if (_wasCompactBeforeIntervention)
    {
        _wasCompactBeforeIntervention = false;
        ToggleCompactMode();
    }
    break;
```

#### 3.3.14. `TIMER_RUNNING` `[PORTED]`

**Source:** `{ "type": "TIMER_RUNNING", "running": true }`

**Target:**

```json
{
  "type": "TIMER_RUNNING",
  "payload": {
    "running": true
  }
}
```

| Payload Field | Type | Description |
|---|---|---|
| `running` | `boolean` | `true` to start idle monitoring, `false` to stop. |

**C# handler:**

```csharp
case "TIMER_RUNNING":
    if (payload.TryGetProperty("running", out var runProp))
    {
        var running = runProp.GetBoolean();
        if (running)
            _activityMonitor?.Start();
        else
            _activityMonitor?.Stop();
        SentinelLog.Info($"Timer running: {running} — idle monitor {(running ? "started" : "stopped")}");
    }
    break;
```

This is the critical link between the Angular timer and C# idle detection. Idle monitoring only runs while the timer is active. Carries forward identically from source.

#### 3.3.15. `GET_SETTINGS` `[PORTED]`

**Source:** `{ "type": "GET_SETTINGS" }`

**Target:**

```json
{
  "type": "GET_SETTINGS",
  "payload": {}
}
```

**C# handler:** Calls `HandleGetSettings()` which sends `SETTINGS_LOADED` (→ §3.2.3).

#### 3.3.16. `CHECK_UPDATE` `[PORTED]`

**Source:** Not an explicit inbound message in the source (update check runs automatically on startup). Added in the target to allow manual re-check.

**Target:**

```json
{
  "type": "CHECK_UPDATE",
  "payload": {}
}
```

**C# handler:** Runs `UpdateChecker.CheckForUpdateAsync()` in the background. If update available, sends `UPDATE_AVAILABLE` (→ §3.2.7).

#### 3.3.17. `OVERLAY_CLOSE` `[PORTED]`

**Source:** `{ "type": "OVERLAY_CLOSE" }` — calls `Dispatcher.Invoke(() => Close())`.

**Target:**

```json
{
  "type": "OVERLAY_CLOSE",
  "payload": {}
}
```

**C# handler:** `_window?.Close()` — Photino equivalent of closing the window.

#### 3.3.18. `OVERLAY_MINIMIZE` `[PORTED]`

**Source:** `{ "type": "OVERLAY_MINIMIZE" }` — calls `Dispatcher.Invoke(() => WindowState = Minimized)`.

**Target:**

```json
{
  "type": "OVERLAY_MINIMIZE",
  "payload": {}
}
```

**C# handler:** `_window?.SetMinimized(true)` or equivalent Photino API to minimize the window.

#### 3.3.19. `JS_ERROR` `[PORTED]`

**Source:** `{ "type": "JS_ERROR", "message": "...", "stack": "..." }` — logs to `crash.log` via `CrashReporter.LogCrash`.

**Target:**

```json
{
  "type": "JS_ERROR",
  "payload": {
    "message": "TypeError: Cannot read property 'foo' of undefined",
    "stack": "at AppComponent.ngOnInit (app.component.ts:42)"
  }
}
```

**C# handler:**

```csharp
case "JS_ERROR":
    var jsMessage = payload.TryGetProperty("message", out var msgProp) ? msgProp.GetString() ?? "" : "";
    var jsStack = payload.TryGetProperty("stack", out var stackProp) ? stackProp.GetString() ?? "" : "";
    CrashReporter.LogCrash("JS_ERROR", new InvalidOperationException($"{jsMessage}\n{jsStack}"));
    break;
```

Angular's global error handler should catch unhandled exceptions and send this message to the shell for persistent crash logging.

#### 3.3.20. Complete Inbound Message Registry (Target)

| Message Type | Payload Shape | C# Handler Action | Status |
|---|---|---|---|
| `GET_SETTINGS` | `{}` | Send `SETTINGS_LOADED` | `[PORTED]` |
| `SAVE_SETTINGS` | `{ settings: AppSettings }` | Update in-memory settings, apply live, persist to disk | `[PORTED]` |
| `TIMER_RUNNING` | `{ running: boolean }` | Start/stop `UserActivityMonitor` | `[PORTED]` |
| `SNOOZE_IDLE` | `{ minutes: number }` | `Snooze(minutes)`, send `SNOOZE_STATUS` | `[PORTED]` (renamed from `SNOOZE`/`WATCHING_CONTENT`) |
| `CANCEL_SNOOZE` | `{}` | `CancelSnooze()`, send `SNOOZE_STATUS` | `[PORTED]` |
| `TOGGLE_COMPACT` | `{}` | Toggle compact/full mode, send `COMPACT_MODE_CHANGED` | `[PORTED]` |
| `AUDITOR_CLEARED` | `{}` | Restore TopMost, restore compact if needed | `[REDESIGNED]` (renamed from `INTERVENTION_DISMISSED`) |
| `CHECK_UPDATE` | `{}` | Run `UpdateChecker`, send `UPDATE_AVAILABLE` if found | `[PORTED]` |
| `OVERLAY_CLOSE` | `{}` | Close window | `[PORTED]` |
| `OVERLAY_MINIMIZE` | `{}` | Minimize window | `[PORTED]` |
| `JS_ERROR` | `{ message, stack }` | Log to `crash.log` | `[PORTED]` |
| `LOG_DISTRACTION` | — | — | `[DROPPED]` — Angular writes to Firestore directly |
| `FALSE_ALARM` | — | — | `[DROPPED]` — Angular writes to Firestore directly |
| `LOG_SESSION` | — | — | `[DROPPED]` — Angular writes to Firestore directly |
| `GET_REPORT_DATA` | — | — | `[DROPPED]` — Angular reads Firestore directly |
| `GET_TAXONOMY_DATA` | — | — | `[DROPPED]` — Angular reads Firestore directly |
| `UPDATE_DISTRACTION_GROUP` | — | — | `[DROPPED]` — Angular writes Firestore directly |
| `RENAME_CATEGORY` | — | — | `[DROPPED]` — Angular writes Firestore directly |
| `DELETE_CATEGORY` | — | — | `[DROPPED]` — Angular writes Firestore directly |
| `GET_SESSIONS` | — | — | `[DROPPED]` — Angular reads Firestore directly |
| `PLAY_SOUND` | — | — | `[DROPPED]` — Angular uses Web Audio API |
| `EXPORT_DATA` | — | — | `[DROPPED]` — no local database export |
| `SEED_DATABASE` | — | — | `[DROPPED]` — no local database |
| `OVERLAY_MAXIMIZE` | — | — | `[DROPPED]` — merged into `TOGGLE_COMPACT` |

### 3.4. Error Handling & Message Validation

#### 3.4.1. Unknown Message Type Logging `[PORTED]`

**Source:** The source `switch` statement has no `default` case — unknown message types are silently ignored.

**Target:** Unknown message types must be logged for debugging:

```csharp
default:
    SentinelLog.Warn($"Unknown IPC message type: {messageType}");
    break;
```

This aids debugging when Angular sends a message type that the shell does not yet handle (e.g., during development of new features).

#### 3.4.2. Malformed Payload Rejection `[REDESIGNED]`

**Source:** The source handler has a top-level `try/catch` around the entire `OnWebMessageReceived` that logs errors via `SentinelLog.Error("Error processing message", ex)`.

**Target:** The handler must validate:

1. **JSON parse success** — If `JsonDocument.Parse` throws, log the raw message (truncated to 200 chars for safety) and return.
2. **`type` field exists** — If `type` is missing, log and return.
3. **`type` is a string** — If `type` is not a string, log and return.
4. **`payload` field** — If `payload` is missing, default to an empty `JsonElement` (equivalent to `{}`). This is not an error — messages with empty payloads are valid.

```csharp
private static void OnWebMessageReceived(object? sender, string message)
{
    try
    {
        using var doc = JsonDocument.Parse(message);
        var root = doc.RootElement;

        if (!root.TryGetProperty("type", out var typeProp) || typeProp.ValueKind != JsonValueKind.String)
        {
            SentinelLog.Warn($"IPC message missing 'type' field: {Truncate(message, 200)}");
            return;
        }

        var messageType = typeProp.GetString();
        if (string.IsNullOrEmpty(messageType))
        {
            SentinelLog.Warn("IPC message has empty 'type' field");
            return;
        }

        var payload = root.TryGetProperty("payload", out var payloadProp)
            ? payloadProp
            : default;

        switch (messageType)
        {
            // ... dispatch cases
            default:
                SentinelLog.Warn($"Unknown IPC message type: {messageType}");
                break;
        }
    }
    catch (JsonException ex)
    {
        SentinelLog.Warn($"Malformed IPC JSON: {ex.Message} — raw: {Truncate(message, 200)}");
    }
    catch (Exception ex)
    {
        SentinelLog.Error("Error processing IPC message", ex);
    }
}

private static string Truncate(string value, int maxLength)
{
    return value.Length <= maxLength ? value : value[..maxLength] + "...";
}
```

#### 3.4.3. Thread Marshalling (Background → UI Thread Dispatch) `[REDESIGNED]`

**Source:** The source uses `Dispatcher.Invoke(() => { ... })` extensively to marshal calls from background threads (e.g., `OnIdleDetected`, `OnUserActive`, timer callbacks) to the WPF UI thread. All WebView2 `PostWebMessageAsJson` calls must happen on the UI thread.

**Target:** Photino's thread model is different:

1. `RegisterWebMessageReceivedHandler` callbacks execute on the Photino message loop thread (the same thread that called `WaitForClose()`).
2. `SendWebMessage` can be called from any thread — Photino internally marshals to the correct thread.
3. `UserActivityMonitor` timer callbacks execute on a `System.Timers.Timer` thread pool thread (not the Photino thread), because WPF's `DispatcherTimer` is not available.

**Consequence:** The `OnIdleDetected` and `OnUserActive` event handlers fire on a background thread. They call `SendWebMessage` which is thread-safe in Photino. However, window management calls (`SetTopMost`, `SetSize`, `SetLeft`, `SetTop`, `Close`, `SetMinimized`) must be called on the UI thread.

**Solution:** Use `_window.Invoke(Action)` for UI-thread operations:

```csharp
private static void OnIdleDetected(object? sender, EventArgs e)
{
    if (_activityMonitor == null || !_activityMonitor.IsRunning) return;

    _window?.Invoke(() =>
    {
        // Window management must happen on UI thread
        if (_isCompactMode)
        {
            _wasCompactBeforeIntervention = true;
            ToggleCompactMode();
        }
        else
        {
            _wasCompactBeforeIntervention = false;
        }

        _window?.SetTopMost(true);

        if (_windowHandle != IntPtr.Zero)
        {
            NativeMethods.SetForegroundWindow(_windowHandle);
            var flashInfo = new NativeMethods.FLASHWINFO
            {
                cbSize = (uint)Marshal.SizeOf<NativeMethods.FLASHWINFO>(),
                hwnd = _windowHandle,
                dwFlags = NativeMethods.FLASHW_ALL | NativeMethods.FLASHW_TIMERNOFG,
                uCount = 3,
                dwTimeout = 0
            };
            NativeMethods.FlashWindowEx(ref flashInfo);
        }
    });

    // SendWebMessage is thread-safe — no marshalling needed
    SendIpcMessage("IDLE_DETECTED", new { idleDurationMs = GetCurrentIdleDurationMs() });
}
```

**`UserActivityMonitor` timer change:** The source uses WPF `DispatcherTimer`. The target must use `System.Timers.Timer` (which fires on a thread pool thread) since there is no WPF Dispatcher:

```csharp
// Source (WPF):
_timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
_timer.Tick += OnTimerTick;

// Target (Photino):
_timer = new System.Timers.Timer(1000);
_timer.Elapsed += OnTimerTick;
_timer.AutoReset = true;
```

This means `OnTimerTick` fires on a thread pool thread, and all events raised from it (`IdleDetected`, `UserActive`) propagate on that same background thread. The IPC send is safe (Photino thread-safe), but window manipulation must use `_window.Invoke()`.

### 3.5. Complete C# IPC Dispatch Handler (Target)

The following is the complete `switch` block for the target shell's inbound message handler, showing every handled message type and the `default` fallback:

```csharp
switch (messageType)
{
    case "GET_SETTINGS":
        HandleGetSettings();
        break;

    case "SAVE_SETTINGS":
        HandleSaveSettings(payload);
        break;

    case "TIMER_RUNNING":
        if (payload.TryGetProperty("running", out var runProp))
        {
            var running = runProp.GetBoolean();
            if (running)
                _activityMonitor?.Start();
            else
                _activityMonitor?.Stop();
            SentinelLog.Info($"Timer running: {running} — idle monitor {(running ? "started" : "stopped")}");
        }
        break;

    case "SNOOZE_IDLE":
        if (payload.TryGetProperty("minutes", out var snoozeProp))
        {
            var minutes = snoozeProp.GetInt32();
            _activityMonitor?.Snooze(minutes);
            SentinelLog.Info($"Snooze activated for {minutes} minutes");
            SendSnoozeStatus();
        }
        break;

    case "CANCEL_SNOOZE":
        _activityMonitor?.CancelSnooze();
        SentinelLog.Info("Snooze cancelled by user");
        SendSnoozeStatus();
        break;

    case "TOGGLE_COMPACT":
        _window?.Invoke(ToggleCompactMode);
        break;

    case "AUDITOR_CLEARED":
        _window?.Invoke(() =>
        {
            _window?.SetTopMost(_settings.AlwaysOnTop);
            if (_wasCompactBeforeIntervention)
            {
                _wasCompactBeforeIntervention = false;
                ToggleCompactMode();
            }
        });
        break;

    case "CHECK_UPDATE":
        _ = Task.Run(async () =>
        {
            var updateInfo = await UpdateChecker.CheckForUpdateAsync();
            if (updateInfo.UpdateAvailable)
            {
                SendIpcMessage("UPDATE_AVAILABLE", new
                {
                    currentVersion = updateInfo.CurrentVersion,
                    latestVersion = updateInfo.LatestVersion,
                    downloadUrl = updateInfo.DownloadUrl,
                    releaseNotes = updateInfo.ReleaseNotes
                });
            }
        });
        break;

    case "OVERLAY_CLOSE":
        _window?.Invoke(() => _window?.Close());
        break;

    case "OVERLAY_MINIMIZE":
        _window?.Invoke(() => _window?.SetMinimized(true));
        break;

    case "JS_ERROR":
        var jsMessage = payload.TryGetProperty("message", out var msgProp) ? msgProp.GetString() ?? "" : "";
        var jsStack = payload.TryGetProperty("stack", out var stackProp) ? stackProp.GetString() ?? "" : "";
        CrashReporter.LogCrash("JS_ERROR", new InvalidOperationException($"{jsMessage}\n{jsStack}"));
        break;

    default:
        SentinelLog.Warn($"Unknown IPC message type: {messageType}");
        break;
}
```

**Message count summary:**
- **Outbound (C# → Angular):** 10 active message types (down from 12 in source — 3 dropped: `REPORT_DATA`, `TAXONOMY_DATA`, `SESSION_LIST`; 1 added: enhanced `IDLE_DETECTED` payload)
- **Inbound (Angular → C#):** 11 active message types (down from 22 in source — 13 dropped due to Firestore migration; 2 renamed: `SNOOZE`/`WATCHING_CONTENT` → `SNOOZE_IDLE`, `INTERVENTION_DISMISSED` → `AUDITOR_CLEARED`; 1 added: `CHECK_UPDATE`)

### 3.6. Angular-Side IPC Integration Patterns

This section documents how the Angular application consumes and produces IPC messages using the `BridgeService` (→ §3.1.1).

#### 3.6.1. Startup Handshake

When Angular bootstraps, the root `AppComponent` subscribes to IPC messages and requests initial settings:

```typescript
@Component({ /* ... */ })
export class AppComponent implements OnInit {
  constructor(
    private bridge: BridgeService,
    private settingsService: SettingsService,
    private timerService: TimerService
  ) {}

  ngOnInit(): void {
    // Subscribe to settings response
    this.bridge.on<{ settings: AppSettings }>('SETTINGS_LOADED').subscribe(data => {
      this.settingsService.apply(data.settings);
    });

    // Request initial settings from C# shell
    this.bridge.send('GET_SETTINGS');
  }
}
```

#### 3.6.2. Timer ↔ Idle Monitor Sync

The Angular timer service notifies the shell whenever the timer starts or stops, so idle detection is only active during focus sessions:

```typescript
// In TimerService
startTimer(): void {
  this.isRunning = true;
  this.bridge.send('TIMER_RUNNING', { running: true });
  // ... start anchor-based timer
}

pauseTimer(): void {
  this.isRunning = false;
  this.bridge.send('TIMER_RUNNING', { running: false });
  // ... clear interval
}
```

#### 3.6.3. Idle Detection → Distraction Auditor → Event Ledger Flow

The complete flow from idle detection to Firestore event write:

```
1. C# shell: UserActivityMonitor detects idle → sends IDLE_DETECTED IPC
2. Angular: BridgeService receives IDLE_DETECTED
3. Angular: TimerService freezes timer, writes IdleDetected event to Firestore Event Ledger
4. Angular: Shows DistractionAuditorComponent (forced modal)
5. User: Types distraction note, selects category, submits
6. Angular: Writes DistractionLogged event to Firestore Event Ledger
7. Angular: Sends AUDITOR_CLEARED IPC to C# shell
8. C# shell: Restores window state (TopMost, compact mode)
9. Angular: TimerService resumes timer
```

**Firestore events written during this flow:**

```typescript
// Step 3: IdleDetected event
await addDoc(collection(db, `users/${uid}/session_events`), {
  type: 'IdleDetected',
  timestamp: serverTimestamp(),
  sessionId: currentSessionId,
  payload: { idleDurationMs: data.idleDurationMs }
});

// Step 6: DistractionLogged event
await addDoc(collection(db, `users/${uid}/session_events`), {
  type: 'DistractionLogged',
  timestamp: serverTimestamp(),
  sessionId: currentSessionId,
  payload: {
    note: 'twitter',
    normalizedNote: 'twitter',
    categoryName: 'Social Media'
  }
});
```

These events are append-only and immutable (→ §7.3). The Cloud Function processing pipeline consumes them to compute Swift Recovery bonuses (→ §8.6) by comparing the `IdleDetected` and `DistractionLogged` timestamps for the same `sessionId`.

---

## 4. OS-Level Hooks & Native Interop

This section specifies every OS-level native interop surface used by the Sentinel C# shell. The shell's sole native responsibilities are: (1) polling for user input activity, (2) detecting system audio playback, (3) resolving the foreground window process, and (4) sending IPC messages to Angular when idle thresholds are breached. All UI reaction logic (timer freeze, overlay display, distraction logging) lives in Angular — the shell never renders UI or manages application state.

**Source files mapped:**
| Source File | Target File | Migration Status |
|---|---|---|
| `Sentinel.Engine\UserActivityMonitor.cs` | `Sentinel.Shell\Services\UserActivityMonitor.cs` | **PORTED** with breaking changes (§4.1) |
| `Sentinel.Engine\MediaDetector.cs` | `Sentinel.Shell\Services\MediaDetector.cs` | **PORTED** verbatim (§4.3) |
| *(no source equivalent)* | `Sentinel.Shell\Services\ActiveWindowMonitor.cs` | **NEW** (§4.4) |

---

### 4.1. Idle Detection Engine (UserActivityMonitor)

The `UserActivityMonitor` class is the heart of the Sentinel C# shell. It polls Win32 `GetLastInputInfo` once per second to detect global keyboard and mouse inactivity, fires events when the idle threshold is breached, and fires a complementary event when the user resumes activity. The class is **PORTED** from source to target with the following breaking changes:

| Aspect | Source (WPF) | Target (Photino) |
|---|---|---|
| Timer type | `System.Windows.Threading.DispatcherTimer` | `System.Timers.Timer` |
| Thread affinity | WPF dispatcher thread (STA) | `System.Timers.Timer` fires on `ThreadPool` thread |
| Event marshalling | Not needed (already on UI thread) | Events fire on pool thread; caller must use `_window.Invoke()` if touching Photino window |
| Idle payload | `EventArgs.Empty` (no data) | Custom `IdleEventArgs` carrying `idleDurationMs` (uint) |
| Active Window check | Not present | **NEW** — integrated into polling loop (→ §4.4.6) |

#### 4.1.1. P/Invoke: `GetLastInputInfo` Declaration & `LASTINPUTINFO` Struct

**Source implementation** (`Sentinel.Engine\UserActivityMonitor.cs`, lines 117–125):

```csharp
[StructLayout(LayoutKind.Sequential)]
private struct LASTINPUTINFO
{
    public uint cbSize;
    public uint dwTime;
}

[DllImport("user32.dll")]
private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
```

**Target implementation** — identical. No changes required.

```csharp
// File: Sentinel.Shell\Services\UserActivityMonitor.cs

[StructLayout(LayoutKind.Sequential)]
private struct LASTINPUTINFO
{
    public uint cbSize;
    public uint dwTime;
}

[DllImport("user32.dll", SetLastError = false)]
private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
```

**Win32 semantics:**
- `LASTINPUTINFO.cbSize` must be set to `Marshal.SizeOf<LASTINPUTINFO>()` (8 bytes) before the call.
- `LASTINPUTINFO.dwTime` returns the tick count (milliseconds since system boot) of the last keyboard or mouse input event. This value wraps every ~49.7 days (`uint.MaxValue` milliseconds).
- The idle duration is calculated as `unchecked((uint)Environment.TickCount - lastInput.dwTime)`. The `unchecked` context handles the wrap-around case correctly because unsigned subtraction wraps modularly.
- If `GetLastInputInfo` returns `false`, the method returns `0` (not idle), which is a safe fallback.

**Static helper method** (unchanged from source):

```csharp
private static uint GetIdleTimeMs()
{
    var lastInput = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };

    if (!GetLastInputInfo(ref lastInput))
        return 0;

    uint currentTick = (uint)Environment.TickCount;
    return unchecked(currentTick - lastInput.dwTime);
}
```

#### 4.1.2. Polling Loop Architecture (Timer Interval, Background Thread)

**Source implementation** (`Sentinel.Engine\UserActivityMonitor.cs`, lines 37–43):

The source uses WPF's `DispatcherTimer`:

```csharp
_timer = new DispatcherTimer
{
    Interval = TimeSpan.FromSeconds(1)
};
_timer.Tick += OnTimerTick;
```

`DispatcherTimer` fires the `Tick` event on the WPF dispatcher thread (the STA UI thread). This was convenient in the source because `MainWindow.xaml.cs` subscribed to `IdleDetected` / `UserActive` events and directly manipulated WPF UI elements without marshalling.

**Target implementation:**

The target replaces `DispatcherTimer` with `System.Timers.Timer` because the Photino shell has no WPF dispatcher. `System.Timers.Timer.Elapsed` fires on a `ThreadPool` thread.

```csharp
// File: Sentinel.Shell\Services\UserActivityMonitor.cs

using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Timers;

namespace Sentinel.Shell.Services;

public class UserActivityMonitor : IDisposable
{
    private readonly System.Timers.Timer _timer;
    private bool _wasIdle;
    private int _idleThresholdMs;
    private DateTime? _snoozeUntil;

    public event EventHandler<IdleEventArgs>? IdleDetected;
    public event EventHandler? UserActive;

    public bool SuppressDuringMedia { get; set; } = true;

    public bool IsSnoozed => _snoozeUntil.HasValue && DateTime.UtcNow < _snoozeUntil.Value;
    public int SnoozeSecondsRemaining => IsSnoozed
        ? (int)(_snoozeUntil!.Value - DateTime.UtcNow).TotalSeconds
        : 0;

    public bool IsRunning { get; private set; }

    public int IdleThresholdSeconds
    {
        get => _idleThresholdMs / 1000;
        set => _idleThresholdMs = value * 1000;
    }

    /// <summary>
    /// Injected by the host. The ActiveWindowMonitor checks if the currently
    /// focused window process is on the user's whitelist. When non-null and
    /// returning true, the idle threshold is suppressed (→ §4.4.6).
    /// </summary>
    public Func<bool>? IsWhitelistedAppFocused { get; set; }

    public UserActivityMonitor(int idleThresholdSeconds = 45)
    {
        _idleThresholdMs = idleThresholdSeconds * 1000;
        _timer = new System.Timers.Timer(1000); // 1-second interval
        _timer.Elapsed += OnTimerElapsed;
        _timer.AutoReset = true;
    }

    // ... (lifecycle and tick methods follow in subsequent subsections)
}
```

**Key differences from source:**

| Property | Source | Target |
|---|---|---|
| `_timer` type | `DispatcherTimer` | `System.Timers.Timer` |
| Event handler | `Tick += OnTimerTick` | `Elapsed += OnTimerElapsed` |
| Constructor param | `Interval = TimeSpan.FromSeconds(1)` | `new System.Timers.Timer(1000)` |
| AutoReset | Implicit (DispatcherTimer always auto-resets) | Explicit `AutoReset = true` |
| Disposal | Not implemented (WPF lifecycle) | Implements `IDisposable` (→ §4.1.6) |
| Whitelist hook | Not present | `Func<bool>? IsWhitelistedAppFocused` delegate (→ §4.4.6) |

#### 4.1.3. Idle Threshold Configuration (Seconds, User-Adjustable)

**Source implementation** (`Sentinel.Engine\UserActivityMonitor.cs`, lines 29–33):

```csharp
public int IdleThresholdSeconds
{
    get => _idleThresholdMs / 1000;
    set => _idleThresholdMs = value * 1000;
}
```

**Target implementation** — identical property signature. No changes.

**Configuration flow:**

1. On shell startup, `SettingsService.Load()` reads `settings.json` from `%LOCALAPPDATA%\Sentinel\settings.json`.
2. The `AppSettings.IdleThresholdSeconds` value (default `45`) is passed to the `UserActivityMonitor` constructor.
3. When Angular sends `SAVE_SETTINGS` (→ §3.3.1), the C# shell updates `_idleMonitor.IdleThresholdSeconds = newSettings.IdleThresholdSeconds`.
4. The change takes effect on the next timer tick — no restart required.

**Validation rules:**
- Minimum: `5` seconds (prevents false positives from brief pauses)
- Maximum: `3600` seconds (1 hour — any higher is meaningless)
- If the deserialized value from `settings.json` falls outside this range, clamp to the nearest boundary.
- Default: `45` seconds.

#### 4.1.4. State Machine: Monitoring → Idle Detected → User Resumed

The idle detection state machine uses a single boolean `_wasIdle` to track transitions. This is a two-state machine:

```
┌─────────────┐     idleMs >= threshold     ┌──────────────┐
│  MONITORING  │ ─────────────────────────► │ IDLE_DETECTED │
│ (_wasIdle =  │                            │ (_wasIdle =   │
│   false)     │ ◄───────────────────────── │   true)       │
└─────────────┘     idleMs < threshold      └──────────────┘
                    (user input detected)
```

**State transitions:**

| Current State | Condition | Action | New State |
|---|---|---|---|
| `_wasIdle == false` | `idleMs >= _idleThresholdMs` AND NOT suppressed by media AND NOT suppressed by whitelist | Fire `IdleDetected` event | `_wasIdle = true` |
| `_wasIdle == true` | `idleMs < _idleThresholdMs` | Fire `UserActive` event | `_wasIdle = false` |
| `_wasIdle == false` | `idleMs < _idleThresholdMs` | No-op | `_wasIdle = false` |
| `_wasIdle == true` | `idleMs >= _idleThresholdMs` | No-op (already fired) | `_wasIdle = true` |

**Suppression conditions** (any one prevents the idle → detected transition):
1. **Snooze active:** `IsSnoozed == true` → skip the entire tick (→ §4.2).
2. **Media playing:** `SuppressDuringMedia == true` AND `MediaDetector.IsAudioPlaying() == true` → treat as not idle (→ §4.3).
3. **Whitelisted app focused:** `IsWhitelistedAppFocused?.Invoke() == true` → treat as not idle (→ §4.4.6).

**Source implementation** (`Sentinel.Engine\UserActivityMonitor.cs`, lines 73–95):

```csharp
private void OnTimerTick(object? sender, EventArgs e)
{
    if (IsSnoozed) return;

    // Clear expired snooze
    if (_snoozeUntil.HasValue && DateTime.UtcNow >= _snoozeUntil.Value)
    {
        _snoozeUntil = null;
        Debug.WriteLine("[Sentinel] Snooze expired.");
    }

    uint idleMs = GetIdleTimeMs();
    bool isIdle = idleMs >= _idleThresholdMs;

    // Suppress idle detection if media is playing
    if (isIdle && SuppressDuringMedia && MediaDetector.IsAudioPlaying())
    {
        isIdle = false;
    }

    if (isIdle && !_wasIdle)
    {
        Debug.WriteLine($"[Sentinel] Idle Detected (idle for {idleMs}ms)");
        _wasIdle = true;
        IdleDetected?.Invoke(this, EventArgs.Empty);
    }
    else if (!isIdle && _wasIdle)
    {
        Debug.WriteLine("[Sentinel] User Active");
        _wasIdle = false;
        UserActive?.Invoke(this, EventArgs.Empty);
    }
}
```

**Target implementation:**

```csharp
// File: Sentinel.Shell\Services\UserActivityMonitor.cs

private void OnTimerElapsed(object? sender, ElapsedEventArgs e)
{
    if (IsSnoozed) return;

    // Clear expired snooze
    if (_snoozeUntil.HasValue && DateTime.UtcNow >= _snoozeUntil.Value)
    {
        _snoozeUntil = null;
        Debug.WriteLine("[Sentinel] Snooze expired.");
    }

    uint idleMs = GetIdleTimeMs();
    bool isIdle = idleMs >= (uint)_idleThresholdMs;

    // Suppress idle detection if media is playing
    if (isIdle && SuppressDuringMedia && MediaDetector.IsAudioPlaying())
    {
        isIdle = false;
    }

    // Suppress idle detection if a whitelisted application is focused (NEW)
    if (isIdle && IsWhitelistedAppFocused?.Invoke() == true)
    {
        isIdle = false;
    }

    if (isIdle && !_wasIdle)
    {
        Debug.WriteLine($"[Sentinel] Idle Detected (idle for {idleMs}ms)");
        _wasIdle = true;
        IdleDetected?.Invoke(this, new IdleEventArgs(idleMs));
    }
    else if (!isIdle && _wasIdle)
    {
        Debug.WriteLine("[Sentinel] User Active");
        _wasIdle = false;
        UserActive?.Invoke(this, EventArgs.Empty);
    }
}
```

**Changes from source:**
1. Method signature: `OnTimerTick(object?, EventArgs)` → `OnTimerElapsed(object?, ElapsedEventArgs)`.
2. **NEW suppression check:** `IsWhitelistedAppFocused?.Invoke() == true` inserted after the media check (→ §4.4.6).
3. `IdleDetected` now fires with `new IdleEventArgs(idleMs)` instead of `EventArgs.Empty` — the idle duration is needed by the IPC payload (→ §3.2.2).

#### 4.1.5. `IdleDetected` Event & `UserActive` Event Signatures

**Source signatures** (`Sentinel.Engine\UserActivityMonitor.cs`, lines 15–16):

```csharp
public event EventHandler? IdleDetected;
public event EventHandler? UserActive;
```

Both events use the base `EventHandler` delegate with `EventArgs.Empty`. No data is conveyed.

**Target signatures:**

```csharp
// File: Sentinel.Shell\Services\UserActivityMonitor.cs

public event EventHandler<IdleEventArgs>? IdleDetected;
public event EventHandler? UserActive;
```

**`IdleEventArgs` class:**

```csharp
// File: Sentinel.Shell\Services\IdleEventArgs.cs

namespace Sentinel.Shell.Services;

public sealed class IdleEventArgs : EventArgs
{
    /// <summary>
    /// The number of milliseconds the user has been idle at the moment
    /// the threshold was breached. This value is sent to Angular in the
    /// IDLE_DETECTED IPC message payload as "idleDurationMs".
    /// </summary>
    public uint IdleDurationMs { get; }

    public IdleEventArgs(uint idleDurationMs)
    {
        IdleDurationMs = idleDurationMs;
    }
}
```

**Rationale for the change:** The target `IDLE_DETECTED` IPC message (→ §3.2.2) carries `idleDurationMs` in its payload. The source event provided no data, which forced the `MainWindow.xaml.cs` handler to compute the idle duration redundantly. The target passes it from the polling loop where it is already known.

**IPC handler wiring** (in `Program.cs` or equivalent shell host):

```csharp
_idleMonitor.IdleDetected += (_, args) =>
{
    // Fires on ThreadPool thread — must marshal to Photino thread for SendWebMessage
    _window.Invoke(() =>
    {
        IpcSerializer.Send(_window, "IDLE_DETECTED", new
        {
            idleDurationMs = args.IdleDurationMs
        });
    });
};

_idleMonitor.UserActive += (_, _) =>
{
    _window.Invoke(() =>
    {
        IpcSerializer.Send(_window, "USER_ACTIVE", new { });
    });
};
```

**Thread safety note:** `System.Timers.Timer.Elapsed` fires on a `ThreadPool` thread. `PhotinoWindow.SendWebMessage()` must be called from the Photino message loop thread. The `_window.Invoke()` call marshals the delegate to the correct thread. This replaces the implicit thread affinity that WPF's `DispatcherTimer` provided in the source.

#### 4.1.6. Start / Stop Lifecycle Methods

**Source implementation** (`Sentinel.Engine\UserActivityMonitor.cs`, lines 47–58):

```csharp
public void Start()
{
    _wasIdle = false;
    _timer.Start();
    IsRunning = true;
    Debug.WriteLine($"[Sentinel] UserActivityMonitor started. Idle threshold: {IdleThresholdSeconds}s.");
}

public void Stop()
{
    _timer.Stop();
    IsRunning = false;
    Debug.WriteLine("[Sentinel] UserActivityMonitor stopped.");
}
```

**Target implementation:**

```csharp
// File: Sentinel.Shell\Services\UserActivityMonitor.cs

public void Start()
{
    _wasIdle = false;
    _timer.Start();
    IsRunning = true;
    Debug.WriteLine($"[Sentinel] UserActivityMonitor started. Idle threshold: {IdleThresholdSeconds}s.");
}

public void Stop()
{
    _timer.Stop();
    IsRunning = false;
    _wasIdle = false;
    Debug.WriteLine("[Sentinel] UserActivityMonitor stopped.");
}

public void Dispose()
{
    Stop();
    _timer.Elapsed -= OnTimerElapsed;
    _timer.Dispose();
}
```

**Changes from source:**
1. `Stop()` now also resets `_wasIdle = false` to ensure a clean state if `Start()` is called again (defensive).
2. `Dispose()` is **NEW** — required because `System.Timers.Timer` implements `IDisposable`. The source `DispatcherTimer` did not require explicit disposal.

**Lifecycle sequence in the target shell:**

1. `Program.Main()` creates `UserActivityMonitor(settings.IdleThresholdSeconds)`.
2. `_idleMonitor.SuppressDuringMedia = settings.SuppressDuringMedia`.
3. `_idleMonitor.IsWhitelistedAppFocused = () => _activeWindowMonitor.IsFocusedProcessWhitelisted()` (→ §4.4.6).
4. Wires `IdleDetected` and `UserActive` event handlers (→ §4.1.5).
5. Calls `_idleMonitor.Start()`.
6. On `PhotinoWindow.WindowClosing`, calls `_idleMonitor.Dispose()`.

---

### 4.2. Snooze Mechanism

The snooze mechanism temporarily suppresses idle detection for a user-specified duration. When snoozed, the polling loop short-circuits at the top of `OnTimerElapsed` — no P/Invoke calls are made, no events are fired, and the `_wasIdle` state is not mutated. The snooze mechanism is **PORTED** from source verbatim with no breaking changes.

**Source:** `Sentinel.Engine\UserActivityMonitor.cs`, lines 18–23 (properties), 60–69 (methods), 73–82 (tick integration).

#### 4.2.1. Snooze Duration (Minutes) & Internal Timer

The snooze is implemented as a `DateTime?` field, not a separate timer:

```csharp
private DateTime? _snoozeUntil;
```

When the user triggers a snooze, `_snoozeUntil` is set to `DateTime.UtcNow.AddMinutes(minutes)`. On every tick, the polling loop checks:

1. `IsSnoozed` — if `_snoozeUntil.HasValue && DateTime.UtcNow < _snoozeUntil.Value`, return immediately (skip entire tick).
2. After the snooze-skip check, if `_snoozeUntil.HasValue && DateTime.UtcNow >= _snoozeUntil.Value`, clear the snooze (`_snoozeUntil = null`) and proceed with normal idle detection.

**Properties (unchanged from source):**

```csharp
public bool IsSnoozed => _snoozeUntil.HasValue && DateTime.UtcNow < _snoozeUntil.Value;

public int SnoozeSecondsRemaining => IsSnoozed
    ? (int)(_snoozeUntil!.Value - DateTime.UtcNow).TotalSeconds
    : 0;
```

**Design rationale:** Using `DateTime.UtcNow` comparison instead of a countdown timer avoids accumulation of timer drift and eliminates the need for a second timer object. The `SnoozeSecondsRemaining` property is computed on-demand for Angular to display a countdown in the settings panel.

#### 4.2.2. `Snooze(int minutes)` — Temporarily Suppress Detection

**Source and target implementation (identical):**

```csharp
public void Snooze(int minutes)
{
    _snoozeUntil = DateTime.UtcNow.AddMinutes(minutes);
    _wasIdle = false;
    Debug.WriteLine($"[Sentinel] Idle detection snoozed for {minutes} minutes.");
}
```

**Behavior:**
- Sets the snooze expiry to `minutes` in the future.
- Resets `_wasIdle = false` so that if the user was in the `IDLE_DETECTED` state when they triggered snooze, the state machine returns to `MONITORING` cleanly.
- If called while already snoozed, the snooze duration is **replaced** (not extended). The new expiry overwrites the previous one.

**IPC trigger:** Angular sends `SNOOZE_IDLE` (→ §3.3.5) with payload `{ "minutes": 5 }`. The C# dispatch handler calls `_idleMonitor.Snooze(payload.minutes)`.

**Validation:** The C# handler should clamp `minutes` to `[1, 120]` (1 minute minimum, 2 hours maximum) before passing to `Snooze()`. Values outside this range are clamped silently.

#### 4.2.3. `CancelSnooze()` — Early Resume

**Source and target implementation (identical):**

```csharp
public void CancelSnooze()
{
    _snoozeUntil = null;
    Debug.WriteLine("[Sentinel] Snooze cancelled.");
}
```

**Behavior:**
- Clears the snooze expiry immediately. The next timer tick will proceed with normal idle detection.
- Safe to call when not snoozed (no-op in that case because `_snoozeUntil` is already `null`).

**IPC trigger:** Angular sends `CANCEL_SNOOZE` (→ §3.3.6) with an empty payload `{}`. The C# dispatch handler calls `_idleMonitor.CancelSnooze()`.

#### 4.2.4. Auto-Resume on Snooze Expiry

The snooze auto-expires without any explicit action. The expiry is detected inside the polling loop:

```csharp
private void OnTimerElapsed(object? sender, ElapsedEventArgs e)
{
    if (IsSnoozed) return; // ← snooze is active, skip tick

    // Clear expired snooze (this fires on the first tick AFTER expiry)
    if (_snoozeUntil.HasValue && DateTime.UtcNow >= _snoozeUntil.Value)
    {
        _snoozeUntil = null;
        Debug.WriteLine("[Sentinel] Snooze expired.");
    }

    // ... normal idle detection continues
}
```

**Order of operations on expiry tick:**
1. `IsSnoozed` returns `false` because `DateTime.UtcNow >= _snoozeUntil.Value`.
2. The snooze-clear block runs, sets `_snoozeUntil = null`, and logs the expiry.
3. Normal idle detection proceeds for this tick and all subsequent ticks.

**No IPC notification is sent on snooze expiry.** Angular can poll `SNOOZE_STATUS` or track the remaining time locally using the `minutes` value it sent in the original `SNOOZE_IDLE` message. If Angular needs real-time snooze-expired notification in the future, a new `SNOOZE_EXPIRED` outbound IPC message can be added.

---

### 4.3. Media-Aware Suppression (Smart Suppression)

The Media-Aware Suppression feature prevents false idle detections when the user is consuming media (watching a video, listening to a podcast). The system checks the Windows Core Audio API's `IAudioMeterInformation` to determine if audio is currently playing. If audio peak level exceeds a threshold, the idle detection is suppressed even if the user has not touched keyboard or mouse.

**Source file:** `Sentinel.Engine\MediaDetector.cs` (81 lines, complete).
**Target file:** `Sentinel.Shell\Services\MediaDetector.cs`.
**Migration status:** **PORTED** verbatim — no changes required. The `MediaDetector` class has zero WPF dependencies. It is a pure static class using COM interop.

#### 4.3.1. Windows Core Audio API Integration (`IAudioMeterInformation`)

The `MediaDetector` uses four COM interop declarations to access the Windows Core Audio API:

**1. `MMDeviceEnumerator` (CoClass)**

```csharp
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
private class MMDeviceEnumerator { }
```

- **CLSID:** `BCDE0395-E52F-467C-8E3D-C4579291692E`
- **Role:** Factory class. Instantiated via `new MMDeviceEnumerator()`, which internally calls `CoCreateInstance`.

**2. `IMMDeviceEnumerator` (Interface)**

```csharp
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
private interface IMMDeviceEnumerator
{
    int NotImpl1();
    int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, [MarshalAs(UnmanagedType.Interface)] out IMMDevice device);
}
```

- **IID:** `A95664D2-9614-4F35-A746-DE8DB63617E6`
- **`NotImpl1()`:** Placeholder for `EnumAudioEndpoints` (vtable slot 3). Must be declared to maintain correct vtable ordering.
- **`GetDefaultAudioEndpoint`:** Retrieves the default audio render device. `EDataFlow.eRender` = speakers/headphones output. `ERole.eMultimedia` = multimedia playback role.

**3. `IMMDevice` (Interface)**

```csharp
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
private interface IMMDevice
{
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
}
```

- **IID:** `D666063F-1587-4E43-81F1-B948E807363F`
- **`Activate`:** Activates a device interface. Called with the `IAudioMeterInformation` GUID to get the audio meter. `clsCtx` is passed as `0` (default context). `activationParams` is `IntPtr.Zero` (no activation parameters).

**4. `IAudioMeterInformation` (Interface)**

```csharp
[ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
private interface IAudioMeterInformation
{
    int GetPeakValue(out float pfPeak);
}
```

- **IID:** `C02216F6-8C67-4B5B-9D00-D008E73E0064`
- **`GetPeakValue`:** Returns the peak audio level as a float in the range `[0.0, 1.0]`. This is a hardware-level reading from the audio endpoint mixer, not a per-application reading.

**Supporting enums:**

```csharp
private enum EDataFlow { eRender = 0 }
private enum ERole { eMultimedia = 1 }
```

#### 4.3.2. `IsAudioPlaying()` — Peak Level Threshold (> 0.001f)

**Source and target implementation (identical):**

```csharp
// File: Sentinel.Shell\Services\MediaDetector.cs

public static bool IsAudioPlaying()
{
    try
    {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out var device);
        if (device == null) return false;

        var iidAudioMeter = typeof(IAudioMeterInformation).GUID;
        device.Activate(ref iidAudioMeter, 0, IntPtr.Zero, out var obj);

        if (obj is IAudioMeterInformation meter)
        {
            meter.GetPeakValue(out float peak);
            Marshal.ReleaseComObject(meter);
            Marshal.ReleaseComObject(device);
            Marshal.ReleaseComObject(enumerator);
            return peak > 0.001f;
        }

        Marshal.ReleaseComObject(device);
        Marshal.ReleaseComObject(enumerator);
    }
    catch (Exception ex)
    {
        Debug.WriteLine($"[Sentinel] MediaDetector error: {ex.Message}");
    }
    return false;
}
```

**Threshold rationale:** `0.001f` filters out near-zero noise floor readings that occur even when no audio is playing (electrical noise, DAC idle current). Values tested empirically: silence typically reads `0.0` to `0.0005f`; quiet audio (e.g., ambient music at low volume) reads `0.005f`+; spoken word at moderate volume reads `0.01f`+.

**COM object lifecycle:** Every call to `IsAudioPlaying()` creates and releases three COM objects. This is acceptable because the method is called at most once per second (from the idle polling loop) and the COM objects are lightweight (no file handles, no GPU resources). The `try/catch` around the entire method ensures that COM errors (e.g., no audio device present, device disconnected mid-session) do not propagate to the caller.

**`device == null` check:** This handles the case where no default audio output device exists. This can occur on headless systems or systems with all audio devices disabled. The method returns `false` (treat as no audio playing), which is the safe fallback.

#### 4.3.3. `SuppressDuringMedia` Setting Toggle

**Source implementation** (`Sentinel.Engine\UserActivityMonitor.cs`, line 18):

```csharp
public bool SuppressDuringMedia { get; set; } = true;
```

**Target implementation** — identical. Default is `true` (media suppression enabled by default).

This property is set by the shell host on startup from `AppSettings.SuppressDuringMedia` and updated dynamically when Angular sends `SAVE_SETTINGS`:

```csharp
// In the SAVE_SETTINGS handler:
_idleMonitor.SuppressDuringMedia = newSettings.SuppressDuringMedia;
```

**AppSettings property** (`Sentinel.Engine\SettingsService.cs`, line 16 in source):

```csharp
public bool SuppressDuringMedia { get; set; } = true;
```

This property is serialized to `settings.json` as `"SuppressDuringMedia": true`.

#### 4.3.4. Integration Point: Skip Idle Trigger When Media Active

The media check is performed inside the polling loop **after** the idle threshold comparison but **before** the state transition:

```csharp
uint idleMs = GetIdleTimeMs();
bool isIdle = idleMs >= (uint)_idleThresholdMs;

// Suppress idle detection if media is playing
if (isIdle && SuppressDuringMedia && MediaDetector.IsAudioPlaying())
{
    isIdle = false;
}
```

**Evaluation order (short-circuit):**
1. `isIdle` — if `false`, skip the entire block (user is active, no suppression needed).
2. `SuppressDuringMedia` — if `false`, skip (feature disabled by user).
3. `MediaDetector.IsAudioPlaying()` — only called if both previous conditions are `true`. This is the expensive call (COM interop), so it is evaluated last.

**Effect:** When all three conditions are `true`, `isIdle` is forced to `false`. The state machine treats this tick as "user active" and does not fire `IdleDetected`. If the user was not previously idle (`_wasIdle == false`), this is a no-op. If the user was previously idle (`_wasIdle == true`), this will fire `UserActive` — which is correct because media playback indicates the user is present.

---

### 4.4. Active Window Whitelist (New — Target Architecture)

**This is a NEW feature introduced by the TARGET_ARCHITECTURE.md. It has no source equivalent.** The Active Window Whitelist prevents "False Idles" — situations where the user is actively working in an application (e.g., reading code in VS Code, reviewing a document in Adobe Reader) but has not touched the keyboard or mouse for longer than the idle threshold. Without this feature, Sentinel would falsely fire `IdleDetected` during focused reading sessions.

**Specification from TARGET_ARCHITECTURE.md, §3:**

> **Active Window Whitelist:** To prevent "False Idles," the C# backend must check the currently focused OS window process. If the active process matches a user-defined whitelist (e.g., `devenv.exe`, `code.exe`), the idle timeout threshold is extended or paused.

**Implementation strategy:** A new static class `ActiveWindowMonitor` encapsulates the P/Invoke calls and whitelist matching logic. The `UserActivityMonitor` integrates with it via the `IsWhitelistedAppFocused` delegate property (→ §4.1.2, §4.4.6).

#### 4.4.1. P/Invoke: `GetForegroundWindow` + `GetWindowThreadProcessId`

```csharp
// File: Sentinel.Shell\Services\ActiveWindowMonitor.cs

using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Sentinel.Shell.Services;

public class ActiveWindowMonitor
{
    private HashSet<string> _whitelist = new(StringComparer.OrdinalIgnoreCase);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    // ... (methods follow in subsequent subsections)
}
```

**Win32 semantics:**

- **`GetForegroundWindow()`:** Returns the `HWND` of the window the user is currently interacting with (the window that has keyboard focus). Returns `IntPtr.Zero` if no window has foreground focus (e.g., desktop focused with no window selected, lock screen active).
- **`GetWindowThreadProcessId(HWND, out PID)`:** Given a window handle, returns the thread ID that created the window and writes the owning process ID to the `out` parameter. Returns `0` on failure.

#### 4.4.2. Process Name Resolution from Window Handle

```csharp
// File: Sentinel.Shell\Services\ActiveWindowMonitor.cs

/// <summary>
/// Returns the process name (e.g., "code") of the currently focused window,
/// or null if the window handle is invalid or the process cannot be resolved.
/// The returned name does NOT include the ".exe" extension.
/// </summary>
public static string? GetForegroundProcessName()
{
    try
    {
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return null;

        GetWindowThreadProcessId(hwnd, out uint pid);
        if (pid == 0) return null;

        using var process = Process.GetProcessById((int)pid);
        return process.ProcessName; // e.g., "code", "devenv", "chrome"
    }
    catch (ArgumentException)
    {
        // Process exited between GetWindowThreadProcessId and GetProcessById
        return null;
    }
    catch (InvalidOperationException)
    {
        // Process has exited; ProcessName is not available
        return null;
    }
}
```

**Important notes:**
- `Process.ProcessName` returns the name WITHOUT the `.exe` extension (e.g., `"code"` not `"code.exe"`).
- The `try/catch` handles a race condition: the foreground process can exit between the `GetWindowThreadProcessId` call and the `Process.GetProcessById` call. In this case, `GetProcessById` throws `ArgumentException`. This is a safe fallback — return `null` (not whitelisted).
- `InvalidOperationException` is caught for cases where the process object exists but the process has already exited by the time `ProcessName` is accessed.

#### 4.4.3. User-Configurable Whitelist (e.g., `devenv.exe`, `code.exe`)

The whitelist is a list of process names provided by the user. Users configure this via the Angular Settings panel (→ §5.6), which sends the full whitelist in every `SAVE_SETTINGS` message.

**Examples of whitelisted process names:**

| User enters | Stored as | `Process.ProcessName` match |
|---|---|---|
| `code.exe` | `code` | `"code"` ✓ |
| `devenv.exe` | `devenv` | `"devenv"` ✓ |
| `chrome` | `chrome` | `"chrome"` ✓ |
| `Adobe Acrobat` | `Adobe Acrobat` | Depends on actual `ProcessName` — may need `AcroRd32` |

**Normalization rule:** When setting the whitelist, strip the `.exe` extension if present. Matching is case-insensitive.

```csharp
// File: Sentinel.Shell\Services\ActiveWindowMonitor.cs

/// <summary>
/// Updates the whitelist. Strips ".exe" suffixes and stores names
/// in a case-insensitive HashSet for O(1) lookup.
/// </summary>
public void SetWhitelist(IEnumerable<string> processNames)
{
    _whitelist = new HashSet<string>(
        processNames
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
                ? name[..^4]
                : name),
        StringComparer.OrdinalIgnoreCase
    );
    Debug.WriteLine($"[Sentinel] Active window whitelist updated: [{string.Join(", ", _whitelist)}]");
}
```

#### 4.4.4. Whitelist Persistence in `AppSettings`

**NEW property added to `AppSettings`:**

```csharp
// File: Sentinel.Shell\Models\AppSettings.cs (target)
// Source file: Sentinel.Engine\SettingsService.cs (AppSettings class)

public class AppSettings
{
    // ... existing properties unchanged ...
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

    // NEW — Active Window Whitelist
    public List<string> ActiveWindowWhitelist { get; set; } = [];
}
```

**Serialization in `settings.json`:**

```json
{
  "PomodoroMinutes": 25,
  "ShortBreakMinutes": 5,
  "LongBreakMinutes": 15,
  "IdleThresholdSeconds": 45,
  "CloudSyncEnabled": false,
  "SoundEnabled": true,
  "AlwaysOnTop": false,
  "SuppressDuringMedia": true,
  "DailyFocusGoalMinutes": 120,
  "OverlayStyle": "compact",
  "WindowLeft": -1,
  "WindowTop": -1,
  "DataRetentionMonths": 0,
  "CustomPresets": [],
  "ActiveWindowWhitelist": ["code", "devenv", "chrome"]
}
```

**IPC round-trip:**
1. Angular sends `SAVE_SETTINGS` with `payload.settings.activeWindowWhitelist: ["code.exe", "devenv.exe"]`.
2. C# handler persists to `AppSettings.ActiveWindowWhitelist` and calls `_activeWindowMonitor.SetWhitelist(newSettings.ActiveWindowWhitelist)`.
3. C# sends `SETTINGS_LOADED` back with `payload.settings.activeWindowWhitelist: ["code", "devenv"]` (normalized, `.exe` stripped) — see §3.2.3.

#### 4.4.5. Threshold Extension Logic: Pause or Extend Idle Timeout While Whitelisted App Focused

**Design decision:** The TARGET_ARCHITECTURE.md states the idle timeout threshold should be "extended or paused." This implementation chooses **paused** (suppression), which is simpler and more predictable than dynamically extending the threshold.

**Semantics:** When a whitelisted app is focused and the user has exceeded the idle threshold, the idle detection is **suppressed** — the `IdleDetected` event is not fired. This is functionally identical to the media suppression behavior (→ §4.3.4). The user appears "not idle" to the state machine.

**Alternative (not implemented):** Dynamically multiply the idle threshold by a factor (e.g., 3x) when a whitelisted app is focused. This was rejected because:
1. It adds complexity to the threshold configuration (users must understand two thresholds).
2. Eventually the extended threshold would be breached anyway, firing a potentially unwanted idle detection.
3. Suppression is the behavior users expect — "don't interrupt me while I'm reading code."

**Core method:**

```csharp
// File: Sentinel.Shell\Services\ActiveWindowMonitor.cs

/// <summary>
/// Returns true if the currently focused OS window belongs to a process
/// whose name is in the user-configured whitelist. Returns false if:
/// - No whitelist is configured (empty list)
/// - The foreground window cannot be resolved
/// - The process name is not in the whitelist
/// </summary>
public bool IsFocusedProcessWhitelisted()
{
    if (_whitelist.Count == 0) return false;

    string? processName = GetForegroundProcessName();
    if (processName == null) return false;

    return _whitelist.Contains(processName);
}
```

**Performance:** `HashSet<string>.Contains` is O(1). `GetForegroundProcessName()` performs two P/Invoke calls and one `Process.GetProcessById` call — all are sub-millisecond. The total cost of `IsFocusedProcessWhitelisted()` is negligible relative to the 1-second polling interval.

#### 4.4.6. Integration with Idle Detection Polling Loop

The `ActiveWindowMonitor` is integrated into `UserActivityMonitor` via a delegate property, not a direct dependency. This keeps the `UserActivityMonitor` testable without requiring actual Win32 API access in unit tests.

**Delegate injection (in `Program.cs`):**

```csharp
var activeWindowMonitor = new ActiveWindowMonitor();
activeWindowMonitor.SetWhitelist(settings.ActiveWindowWhitelist);

var idleMonitor = new UserActivityMonitor(settings.IdleThresholdSeconds)
{
    SuppressDuringMedia = settings.SuppressDuringMedia,
    IsWhitelistedAppFocused = () => activeWindowMonitor.IsFocusedProcessWhitelisted()
};
```

**Polling loop integration** (inside `OnTimerElapsed`, after media check):

```csharp
uint idleMs = GetIdleTimeMs();
bool isIdle = idleMs >= (uint)_idleThresholdMs;

// Suppress idle detection if media is playing
if (isIdle && SuppressDuringMedia && MediaDetector.IsAudioPlaying())
{
    isIdle = false;
}

// Suppress idle detection if a whitelisted application is focused (NEW)
if (isIdle && IsWhitelistedAppFocused?.Invoke() == true)
{
    isIdle = false;
}

// State machine transitions (unchanged)
if (isIdle && !_wasIdle) { ... }
else if (!isIdle && _wasIdle) { ... }
```

**Evaluation order:**
1. Media check runs first. If media is playing, `isIdle` is set to `false` and the whitelist check is skipped (`isIdle` is already `false`, short-circuit on `isIdle &&`).
2. Whitelist check runs only if media check did not suppress. This avoids the cost of two P/Invoke calls + process lookup when media is already playing.
3. The `?.Invoke()` null-conditional handles the case where `IsWhitelistedAppFocused` is not set (e.g., in unit tests, or if the feature is disabled). When `null`, the expression evaluates to `null`, and `null == true` is `false` — no suppression.

**Settings update handler** (when Angular sends `SAVE_SETTINGS`):

```csharp
// In the SAVE_SETTINGS dispatch:
_activeWindowMonitor.SetWhitelist(newSettings.ActiveWindowWhitelist);
_idleMonitor.SuppressDuringMedia = newSettings.SuppressDuringMedia;
_idleMonitor.IdleThresholdSeconds = newSettings.IdleThresholdSeconds;
```

---

### 4.5. Complete Target File: `ActiveWindowMonitor.cs`

For reference, the complete `ActiveWindowMonitor` class assembled from §4.4.1 through §4.4.5:

```csharp
// File: Sentinel.Shell\Services\ActiveWindowMonitor.cs

using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Sentinel.Shell.Services;

public class ActiveWindowMonitor
{
    private HashSet<string> _whitelist = new(StringComparer.OrdinalIgnoreCase);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    /// <summary>
    /// Returns the process name (e.g., "code") of the currently focused window,
    /// or null if the window handle is invalid or the process cannot be resolved.
    /// The returned name does NOT include the ".exe" extension.
    /// </summary>
    public static string? GetForegroundProcessName()
    {
        try
        {
            IntPtr hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return null;

            GetWindowThreadProcessId(hwnd, out uint pid);
            if (pid == 0) return null;

            using var process = Process.GetProcessById((int)pid);
            return process.ProcessName;
        }
        catch (ArgumentException)
        {
            return null;
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }

    /// <summary>
    /// Updates the whitelist. Strips ".exe" suffixes and stores names
    /// in a case-insensitive HashSet for O(1) lookup.
    /// </summary>
    public void SetWhitelist(IEnumerable<string> processNames)
    {
        _whitelist = new HashSet<string>(
            processNames
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Select(name => name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
                    ? name[..^4]
                    : name),
            StringComparer.OrdinalIgnoreCase
        );
        Debug.WriteLine($"[Sentinel] Active window whitelist updated: [{string.Join(", ", _whitelist)}]");
    }

    /// <summary>
    /// Returns true if the currently focused OS window belongs to a process
    /// whose name is in the user-configured whitelist.
    /// </summary>
    public bool IsFocusedProcessWhitelisted()
    {
        if (_whitelist.Count == 0) return false;

        string? processName = GetForegroundProcessName();
        if (processName == null) return false;

        return _whitelist.Contains(processName);
    }
}
```

---

### 4.6. Complete Target File: `UserActivityMonitor.cs`

For reference, the complete migrated `UserActivityMonitor` class assembled from §4.1.1 through §4.1.6 and §4.2.1 through §4.2.4:

```csharp
// File: Sentinel.Shell\Services\UserActivityMonitor.cs

using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Timers;

namespace Sentinel.Shell.Services;

public class UserActivityMonitor : IDisposable
{
    private readonly System.Timers.Timer _timer;
    private bool _wasIdle;
    private int _idleThresholdMs;
    private DateTime? _snoozeUntil;

    public event EventHandler<IdleEventArgs>? IdleDetected;
    public event EventHandler? UserActive;

    public bool SuppressDuringMedia { get; set; } = true;

    public bool IsSnoozed => _snoozeUntil.HasValue && DateTime.UtcNow < _snoozeUntil.Value;
    public int SnoozeSecondsRemaining => IsSnoozed
        ? (int)(_snoozeUntil!.Value - DateTime.UtcNow).TotalSeconds
        : 0;

    public bool IsRunning { get; private set; }

    public int IdleThresholdSeconds
    {
        get => _idleThresholdMs / 1000;
        set => _idleThresholdMs = value * 1000;
    }

    /// <summary>
    /// Injected by the host. Returns true if the currently focused window
    /// process is on the user's whitelist, suppressing idle detection.
    /// </summary>
    public Func<bool>? IsWhitelistedAppFocused { get; set; }

    public UserActivityMonitor(int idleThresholdSeconds = 45)
    {
        _idleThresholdMs = idleThresholdSeconds * 1000;
        _timer = new System.Timers.Timer(1000);
        _timer.Elapsed += OnTimerElapsed;
        _timer.AutoReset = true;
    }

    public void Start()
    {
        _wasIdle = false;
        _timer.Start();
        IsRunning = true;
        Debug.WriteLine($"[Sentinel] UserActivityMonitor started. Idle threshold: {IdleThresholdSeconds}s.");
    }

    public void Stop()
    {
        _timer.Stop();
        IsRunning = false;
        _wasIdle = false;
        Debug.WriteLine("[Sentinel] UserActivityMonitor stopped.");
    }

    public void Snooze(int minutes)
    {
        _snoozeUntil = DateTime.UtcNow.AddMinutes(minutes);
        _wasIdle = false;
        Debug.WriteLine($"[Sentinel] Idle detection snoozed for {minutes} minutes.");
    }

    public void CancelSnooze()
    {
        _snoozeUntil = null;
        Debug.WriteLine("[Sentinel] Snooze cancelled.");
    }

    public void Dispose()
    {
        Stop();
        _timer.Elapsed -= OnTimerElapsed;
        _timer.Dispose();
    }

    private void OnTimerElapsed(object? sender, ElapsedEventArgs e)
    {
        if (IsSnoozed) return;

        // Clear expired snooze
        if (_snoozeUntil.HasValue && DateTime.UtcNow >= _snoozeUntil.Value)
        {
            _snoozeUntil = null;
            Debug.WriteLine("[Sentinel] Snooze expired.");
        }

        uint idleMs = GetIdleTimeMs();
        bool isIdle = idleMs >= (uint)_idleThresholdMs;

        // Suppress idle detection if media is playing
        if (isIdle && SuppressDuringMedia && MediaDetector.IsAudioPlaying())
        {
            isIdle = false;
        }

        // Suppress idle detection if a whitelisted application is focused
        if (isIdle && IsWhitelistedAppFocused?.Invoke() == true)
        {
            isIdle = false;
        }

        if (isIdle && !_wasIdle)
        {
            Debug.WriteLine($"[Sentinel] Idle Detected (idle for {idleMs}ms)");
            _wasIdle = true;
            IdleDetected?.Invoke(this, new IdleEventArgs(idleMs));
        }
        else if (!isIdle && _wasIdle)
        {
            Debug.WriteLine("[Sentinel] User Active");
            _wasIdle = false;
            UserActive?.Invoke(this, EventArgs.Empty);
        }
    }

    private static uint GetIdleTimeMs()
    {
        var lastInput = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };

        if (!GetLastInputInfo(ref lastInput))
            return 0;

        uint currentTick = (uint)Environment.TickCount;
        return unchecked(currentTick - lastInput.dwTime);
    }

    #region P/Invoke

    [StructLayout(LayoutKind.Sequential)]
    private struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    #endregion
}
```

---

### 4.7. Complete Target File: `MediaDetector.cs`

For reference, the complete `MediaDetector` class — ported verbatim from source with no changes:

```csharp
// File: Sentinel.Shell\Services\MediaDetector.cs

using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Sentinel.Shell.Services;

/// <summary>
/// Detects whether audio is currently playing on the system
/// using the Windows Core Audio API (IAudioMeterInformation).
/// </summary>
public static class MediaDetector
{
    public static bool IsAudioPlaying()
    {
        try
        {
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out var device);
            if (device == null) return false;

            var iidAudioMeter = typeof(IAudioMeterInformation).GUID;
            device.Activate(ref iidAudioMeter, 0, IntPtr.Zero, out var obj);

            if (obj is IAudioMeterInformation meter)
            {
                meter.GetPeakValue(out float peak);
                Marshal.ReleaseComObject(meter);
                Marshal.ReleaseComObject(device);
                Marshal.ReleaseComObject(enumerator);
                return peak > 0.001f;
            }

            Marshal.ReleaseComObject(device);
            Marshal.ReleaseComObject(enumerator);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Sentinel] MediaDetector error: {ex.Message}");
        }
        return false;
    }

    #region COM Interop

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumerator { }

    private enum EDataFlow { eRender = 0 }
    private enum ERole { eMultimedia = 1 }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        int NotImpl1();
        int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, [MarshalAs(UnmanagedType.Interface)] out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }

    [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioMeterInformation
    {
        int GetPeakValue(out float pfPeak);
    }

    #endregion
}
```

---

### 4.8. Complete Target File: `IdleEventArgs.cs`

```csharp
// File: Sentinel.Shell\Services\IdleEventArgs.cs

namespace Sentinel.Shell.Services;

public sealed class IdleEventArgs : EventArgs
{
    /// <summary>
    /// The number of milliseconds the user has been idle at the moment
    /// the threshold was breached.
    /// </summary>
    public uint IdleDurationMs { get; }

    public IdleEventArgs(uint idleDurationMs)
    {
        IdleDurationMs = idleDurationMs;
    }
}
```

---

### 4.9. Cross-Reference Table

| Section | Source File | Target File | Status |
|---|---|---|---|
| §4.1 | `Sentinel.Engine\UserActivityMonitor.cs` | `Sentinel.Shell\Services\UserActivityMonitor.cs` | PORTED with changes |
| §4.2 | `Sentinel.Engine\UserActivityMonitor.cs` (snooze methods) | `Sentinel.Shell\Services\UserActivityMonitor.cs` | PORTED verbatim |
| §4.3 | `Sentinel.Engine\MediaDetector.cs` | `Sentinel.Shell\Services\MediaDetector.cs` | PORTED verbatim |
| §4.4 | *(no source)* | `Sentinel.Shell\Services\ActiveWindowMonitor.cs` | NEW |
| §4.8 | *(no source)* | `Sentinel.Shell\Services\IdleEventArgs.cs` | NEW |
| §4.1.5 | — | IPC wiring in `Program.cs` | References §3.2.2, §3.2.8 |
| §4.4.4 | `Sentinel.Engine\SettingsService.cs` (`AppSettings`) | `Sentinel.Shell\Models\AppSettings.cs` | MODIFIED (added `ActiveWindowWhitelist`) |
| §4.4.6 | — | Delegate injection in `Program.cs` | References §2.4 |

## 5. Angular Frontend Application

This section specifies every module, component, service, routing rule, and data flow in the Angular frontend application. The Angular app replaces the source React/Vite/TypeScript SPA (`Sentinel.UI/src/`) and serves as the sole presentation layer and local state manager. It runs inside the Photino WebView (→ §2) and communicates with the C# shell exclusively via IPC messages (→ §3).

**Critical migration principle:** In the source architecture, the React app delegated most data operations (report queries, session logging, taxonomy mutations, export) to the C# shell via IPC→SQLite. In the target architecture, the Angular app writes directly to Firestore for all persistent data. The C# shell has no database. The only IPC messages Angular sends to the C# shell are: window management commands (`TOGGLE_COMPACT`, `OVERLAY_MINIMIZE`, `OVERLAY_CLOSE`, `PLAY_SOUND`), settings persistence (`SAVE_SETTINGS`, `GET_SETTINGS`), and the idle-response handshake (`AUDITOR_CLEARED`). All session events, distraction logs, taxonomy changes, report queries, and planner operations are performed by Angular directly against Firebase.

**Source files mapped:**

| Source File | Target Equivalent | Migration Status |
|---|---|---|
| `Sentinel.UI/src/App.tsx` | `src/app/app.component.ts` + feature modules | **REWRITTEN** — monolithic component split into Angular modules |
| `Sentinel.UI/src/views.tsx` | Feature components across modules | **REWRITTEN** — each exported function component → Angular component |
| `Sentinel.UI/src/utils.ts` | `src/app/core/timer.utils.ts` | **PORTED** — pure functions carried forward |
| `Sentinel.UI/src/taxonomy.ts` | `src/app/core/taxonomy.utils.ts` | **PORTED** — pure functions carried forward |
| `Sentinel.UI/src/app-types.ts` | `src/app/core/models.ts` | **PORTED** with modifications for Event Ledger |
| `Sentinel.UI/src/ui.tsx` | `src/app/shared/` components | **REWRITTEN** — React components → Angular components |
| `Sentinel.UI/src/ui-utils.ts` | `src/app/shared/ui-utils.ts` | **PORTED** verbatim |
| `Sentinel.UI/src/firebase.ts` | `src/app/core/firebase.service.ts` | **REWRITTEN** — uses Angular Fire / modular SDK |
| `Sentinel.UI/src/index.css` | `src/styles.css` | **PORTED** with Tailwind v4 migration |
| *(no source)* | `src/app/planner/` module | **NEW** — Teams-style planner (→ §5.6) |

---

### 5.1. Project Scaffold & Tooling

#### 5.1.1. Angular CLI Configuration (Strict TypeScript Mode)

The Angular project is created with `ng new sentinel-ui --strict --style=css --routing --ssr=false`. The `--strict` flag enables:

- `strict: true` in `tsconfig.json` (enables `strictNullChecks`, `strictPropertyInitialization`, `noImplicitAny`, `noImplicitReturns`, `noFallthroughCasesInSwitch`).
- `strictTemplates: true` and `strictInjectionParameters: true` in `angularCompilerOptions`.

**`tsconfig.json` excerpt:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "experimentalDecorators": true,
    "moduleResolution": "bundler",
    "importHelpers": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "sourceMap": true,
    "declaration": false,
    "downlevelIteration": true,
    "paths": {
      "@core/*": ["src/app/core/*"],
      "@shared/*": ["src/app/shared/*"],
      "@features/*": ["src/app/features/*"]
    }
  },
  "angularCompilerOptions": {
    "enableI18nLegacyMessageIdFormat": false,
    "strictInjectionParameters": true,
    "strictInputAccessModifiers": true,
    "strictTemplates": true
  }
}
```

**`angular.json` build configuration (relevant excerpts):**

```json
{
  "projects": {
    "sentinel-ui": {
      "architect": {
        "build": {
          "builder": "@angular-devkit/build-angular:application",
          "options": {
            "outputPath": "dist/sentinel-ui",
            "index": "src/index.html",
            "browser": "src/main.ts",
            "tsConfig": "tsconfig.app.json",
            "assets": [
              { "glob": "**/*", "input": "src/assets" }
            ],
            "styles": ["src/styles.css"],
            "budgets": [
              { "type": "initial", "maximumWarning": "500kB", "maximumError": "1MB" },
              { "type": "anyComponentStyle", "maximumWarning": "4kB", "maximumError": "8kB" }
            ]
          },
          "configurations": {
            "production": {
              "optimization": true,
              "outputHashing": "all",
              "sourceMap": false,
              "namedChunks": false
            }
          }
        }
      }
    }
  }
}
```

#### 5.1.2. Build Output Path → Photino Embedded Resources

The Angular production build output (`dist/sentinel-ui/browser/`) is embedded into the Photino C# project as static resources. The Photino shell loads the Angular app from the local file system.

**Build integration:**

1. Angular production build:  `ng build --configuration=production`
2. Output lands in: `Sentinel.UI/dist/sentinel-ui/browser/` (contains `index.html`, JS chunks, CSS, and assets).
3. The C# `.csproj` includes a post-build step or MSBuild target that copies the Angular output into `wwwroot/` under the shell project.
4. Photino loads the app via: `new PhotinoWindow().Load("wwwroot/index.html")`.

**`index.html` base href:** `<base href="./">` — the relative base href ensures the app works when loaded from a file path rather than an HTTP origin.

#### 5.1.3. Tailwind CSS / Design System Integration

The source uses Tailwind CSS v4 (imported via `@import "tailwindcss";` in `index.css`). The target maintains this approach.

**Source design system tokens** (from `Sentinel.UI/src/index.css` and `artifacts/stitch/sentinel-product-design-brief/design-system.md`):

The "Obsidian Sanctuary" design system defines the following CSS custom properties, which are carried forward verbatim:

```css
:root {
  color-scheme: dark;
  font-family: 'Inter Variable', 'Inter', sans-serif;
  --font-display: 'Manrope Variable', 'Manrope', sans-serif;
  --font-body: 'Inter Variable', 'Inter', sans-serif;
  --app-bg: #131313;
  --surface-lowest: #0e0e0e;
  --surface-low: #1c1b1b;
  --surface: #201f1f;
  --surface-high: #2a2a2a;
  --surface-highest: #353534;
  --outline: rgba(73, 68, 85, 0.32);
  --outline-strong: rgba(148, 142, 161, 0.28);
  --primary: #cdbdff;
  --primary-strong: #7c4dff;
  --secondary: #8dcdff;
  --tertiary: #3ce36a;
  --text-primary: #e5e2e1;
  --text-secondary: #cac3d8;
  --text-muted: #948ea1;
  --page-padding: clamp(1.1rem, 2.3vw, 1.8rem);
  --section-gap: clamp(1.75rem, 3vw, 2.25rem);
  --card-padding: clamp(1.15rem, 2vw, 1.65rem);
  --card-radius: 1.45rem;
  --control-height: 3rem;
  --shell-max: 54rem;
  --shell-max-wide: 78rem;
  --modal-max: 34rem;
  --shadow-lg: 0 16px 40px rgba(0, 0, 0, 0.3);
  --shadow-soft: 0 4px 16px rgba(0, 0, 0, 0.2);
  --nav-collapsed: 4.75rem;
  --nav-expanded: 15.5rem;
  --topbar-height: 3.2rem;
}
```

**Font hosting:** Self-hosted via `@fontsource-variable/inter` and `@fontsource-variable/manrope`. No external font requests (GDPR compliant).

**Accent color constants** (used across timer modes, charts, and metric cards):

```typescript
// File: src/app/core/design-tokens.ts

export const ACCENT_COLORS = {
  primary: '#7c4dff',
  secondary: '#00affe',
  tertiary: '#3ce36a',
  warning: '#f59e0b',
  danger: '#ef4444',
  pink: '#ec4899',
} as const;

export const CHART_COLORS = ['#7c4dff', '#00affe', '#3ce36a', '#f59e0b', '#ec4899', '#ef4444'] as const;

export const MODE_META: Record<TimerMode, {
  label: string;
  accent: string;
  accentSoft: string;
  accentText: string;
  topbarLabel: string;
}> = {
  pomodoro: {
    label: 'Focus',
    accent: '#7c4dff',
    accentSoft: 'rgba(124, 77, 255, 0.18)',
    accentText: '#cdbdff',
    topbarLabel: 'Focus Active',
  },
  shortBreak: {
    label: 'Short Break',
    accent: '#3ce36a',
    accentSoft: 'rgba(60, 227, 106, 0.16)',
    accentText: '#a8f4bc',
    topbarLabel: 'Short Break',
  },
  longBreak: {
    label: 'Long Break',
    accent: '#00affe',
    accentSoft: 'rgba(0, 175, 254, 0.16)',
    accentText: '#b7e8ff',
    topbarLabel: 'Long Break',
  },
};
```

#### 5.1.4. Code-Splitting Strategy (Lazy-Load Charts & Firebase Modules)

Angular lazy-loads feature modules to keep the initial bundle under the 500 kB budget:

| Module | Route Path | Lazy-Loaded | Rationale |
|---|---|---|---|
| `TimerModule` | `/` (default) | No — eagerly loaded | Primary view, must render instantly |
| `ReportsModule` | `/reports` | Yes | Contains chart libraries (ng2-charts or similar) |
| `HistoryModule` | `/history` | Yes | Large session list rendering |
| `TaxonomyModule` | `/taxonomy` | Yes | Infrequently used |
| `SettingsModule` | `/settings` | Yes | Infrequently used |
| `AccountModule` | `/account` | Yes | Firebase Auth SDK is heavy |
| `PlannerModule` | `/planner` | Yes | **NEW** — calendar grid is heavy |
| `OnboardingModule` | (overlay, no route) | Yes | One-time modal |

**Firebase SDK:** Use the modular/tree-shakable Firebase JS SDK v10+ (`firebase/app`, `firebase/auth`, `firebase/firestore`). Do NOT use `@angular/fire` compatibility layer — use direct imports with Angular `inject()` for services. This produces smaller bundles than the compat namespace imports.

---

### 5.2. Design System & Shared Components

The shared component library is located at `src/app/shared/` and provides the reusable building blocks for every feature module. These components are direct Angular ports of the React components in `Sentinel.UI/src/ui.tsx`.

#### 5.2.1. Icon System (Lucide-Style Glyph Component)

**Source:** `Sentinel.UI/src/ui.tsx` — `Glyph` React component with inline SVG paths.

The source defines a `Glyph` component that renders inline SVGs for 24 icon names. Each icon is a 24×24 viewBox SVG with `stroke-width: 1.8`, `stroke-linecap: round`, `stroke-linejoin: round`.

**Target: `GlyphComponent`**

```typescript
// File: src/app/shared/glyph/glyph.component.ts

import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

export type GlyphName =
  | 'timer' | 'reports' | 'taxonomy' | 'settings' | 'account'
  | 'overlay' | 'pip' | 'dashboard' | 'play' | 'pause' | 'stop'
  | 'shield' | 'spark' | 'database' | 'search' | 'arrow-right'
  | 'download' | 'bolt' | 'moon' | 'cloud' | 'keyboard' | 'target'
  | 'history' | 'planner';

@Component({
  selector: 'app-glyph',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.viewBox]="'0 0 24 24'"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      [class]="'h-5 w-5 ' + className"
      aria-hidden="true">
      <ng-container [ngSwitch]="name">
        <!-- Timer -->
        <ng-container *ngSwitchCase="'timer'">
          <circle cx="12" cy="13" r="7.5"/>
          <path d="M12 13V9.5"/>
          <path d="M12 13L14.5 14.5"/>
          <path d="M9.5 3.5H14.5"/>
          <path d="M16.5 5.5L18 4"/>
        </ng-container>
        <!-- ... one ngSwitchCase per GlyphName, carrying forward all SVG paths from source verbatim -->
      </ng-container>
    </svg>
  `,
})
export class GlyphComponent {
  @Input({ required: true }) name!: GlyphName;
  @Input() className = '';
}
```

**Complete glyph SVG path registry** — each icon's SVG path data is carried forward verbatim from the source `renderGlyph()` switch statement in `Sentinel.UI/src/ui.tsx`. The full set of 23 icons (timer, reports, taxonomy, settings, account, overlay, pip, dashboard, play, pause, stop, shield, spark, database, search, arrow-right, download, bolt, moon, cloud, keyboard, target, history) plus 1 new icon (`planner` — for the Planner module, → §5.6) must be implemented.

#### 5.2.2. WorkspaceLayout — App Shell with Navigation

**Source:** `Sentinel.UI/src/ui.tsx` — `WorkspaceLayout` React component.

The WorkspaceLayout provides the persistent sidebar navigation and top bar that wraps every non-modal view. It uses a CSS grid with two columns: collapsed sidebar (`var(--nav-collapsed)` = 4.75rem) and main content area.

**Target: `WorkspaceLayoutComponent`**

```typescript
// File: src/app/shared/workspace-layout/workspace-layout.component.ts

import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

export type WorkspaceViewKey = 'timer' | 'planner' | 'reports' | 'history' | 'taxonomy' | 'settings' | 'account';

@Component({
  selector: 'app-workspace-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sentinel-app sentinel-app--workspace">
      <div class="sentinel-workspace">
        <!-- Sidebar -->
        <nav class="sentinel-sidebar" role="navigation" aria-label="Main navigation">
          <div class="sentinel-sidebar__brand">
            <span class="sentinel-sidebar__brand-mark">
              <app-glyph name="shield" className="h-5 w-5"/>
            </span>
          </div>
          <div class="sentinel-sidebar__nav">
            <!-- Navigation items for each WorkspaceViewKey -->
            <button *ngFor="let item of navItems"
              (click)="navigate(item.key)"
              [class.sentinel-sidebar__item--active]="activeView === item.key"
              class="sentinel-sidebar__item"
              [attr.aria-label]="item.label">
              <app-glyph [name]="item.icon" className="h-5 w-5"/>
            </button>
          </div>
        </nav>

        <!-- Main area -->
        <div class="sentinel-main">
          <!-- Top bar -->
          <header class="sentinel-topbar">
            <div class="sentinel-topbar__status">
              <span class="sentinel-topbar__label">{{ statusLabel }}</span>
              <span class="sentinel-topbar__detail">{{ statusDetail }}</span>
            </div>
            <div class="sentinel-topbar__meta">
              <ng-content select="[topbar-meta]"></ng-content>
            </div>
          </header>
          <!-- Page content -->
          <main class="sentinel-page-content" [attr.role]="role" [attr.aria-label]="ariaLabel">
            <ng-content></ng-content>
          </main>
        </div>
      </div>
    </div>
  `,
})
export class WorkspaceLayoutComponent {
  @Input({ required: true }) activeView!: WorkspaceViewKey;
  @Input() statusLabel = '';
  @Input() statusDetail = '';
  @Input() userEmail: string | null = null;
  @Input() role = 'main';
  @Input() ariaLabel = '';

  navItems: { key: WorkspaceViewKey; icon: GlyphName; label: string }[] = [
    { key: 'timer', icon: 'timer', label: 'Timer' },
    { key: 'planner', icon: 'planner', label: 'Planner' },
    { key: 'reports', icon: 'reports', label: 'Reports' },
    { key: 'history', icon: 'history', label: 'History' },
    { key: 'taxonomy', icon: 'taxonomy', label: 'Taxonomy' },
    { key: 'settings', icon: 'settings', label: 'Settings' },
    { key: 'account', icon: 'account', label: 'Account' },
  ];

  navigate(key: WorkspaceViewKey): void {
    // Emits via Router.navigate or event output — feature modules handle this
  }
}
```

**Change from source:** The source navigation has 6 items (timer, reports, history, taxonomy, settings, account). The target adds a 7th: `planner` (→ §5.6), positioned second in the navigation list.

#### 5.2.3. SectionCard — Content Container Component

**Source:** `Sentinel.UI/src/ui.tsx` — `SectionCard` React component.

`SectionCard` is the primary content container used throughout the app. It implements the "Obsidian Sanctuary" design principle: no hard borders, tonal depth via nested `surface` backgrounds, `card-radius` rounding.

```typescript
// File: src/app/shared/section-card/section-card.component.ts

@Component({
  selector: 'app-section-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sentinel-panel sentinel-card" [class]="className">
      <div class="sentinel-card__header" *ngIf="title">
        <div class="sentinel-card__header-text">
          <app-glyph *ngIf="icon" [name]="icon" className="h-4 w-4 text-[var(--text-muted)]"/>
          <div>
            <h3 class="sentinel-card__title">{{ title }}</h3>
            <p *ngIf="description" class="sentinel-card__description">{{ description }}</p>
          </div>
        </div>
        <ng-content select="[card-actions]"></ng-content>
      </div>
      <div class="sentinel-card__body" [class]="bodyClassName">
        <ng-content></ng-content>
      </div>
    </div>
  `,
})
export class SectionCardComponent {
  @Input() title?: string;
  @Input() description?: string;
  @Input() icon?: GlyphName;
  @Input() className = '';
  @Input() bodyClassName = '';
}
```

#### 5.2.4. ModalLayout — Overlay Modal Wrapper

**Source:** `Sentinel.UI/src/ui.tsx` — `ModalLayout` and `ModalCard` React components.

The `ModalLayout` renders a full-screen overlay backdrop with a centered `ModalCard`. Used by: intervention modal, onboarding wizard, session complete screen, resume prompt, confirm dialogs.

```typescript
// File: src/app/shared/modal/modal-layout.component.ts

@Component({
  selector: 'app-modal-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sentinel-modal-backdrop" [attr.role]="role" [attr.aria-label]="ariaLabel">
      <ng-content></ng-content>
    </div>
  `,
})
export class ModalLayoutComponent {
  @Input() role = 'dialog';
  @Input() ariaLabel = '';
}

@Component({
  selector: 'app-modal-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sentinel-modal-card" [class]="className">
      <ng-content></ng-content>
    </div>
  `,
})
export class ModalCardComponent {
  @Input() className = '';
}
```

#### 5.2.5. Theme & Color Palette Constants

All theme constants are defined as CSS custom properties (→ §5.1.3). TypeScript-side constants for programmatic use:

```typescript
// File: src/app/core/design-tokens.ts

export type TimerMode = 'pomodoro' | 'shortBreak' | 'longBreak';
export type OverlayStyle = 'pill' | 'compact' | 'monitoring';
```

The `MODE_META` constant (defined in §5.1.3) maps each `TimerMode` to its accent colors and labels. This is the TypeScript equivalent of the source `MODE_META` object in `Sentinel.UI/src/views.tsx`.

#### 5.2.6. Responsive Breakpoints for Compact vs. Full Mode

The app operates in two layout modes controlled by the C# shell:

| Mode | Window Size | Trigger | CSS Class |
|---|---|---|---|
| **Full mode** | ~1100×780 px (default) | Normal window state | `.sentinel-app--workspace` |
| **Compact mode** | ~340×160 px | User clicks PiP button or C# sends `COMPACT_MODE_CHANGED` | `.sentinel-glass-overlay` |

**Compact mode detection:** The Angular `AppComponent` listens for the `COMPACT_MODE_CHANGED` IPC message (→ §3.2.9) and toggles a `isCompactMode` signal. When `true`, the router is bypassed and the `CompactTimerComponent` is rendered directly.

**Overlay styles in compact mode:**

The source defines three overlay styles selectable via `settings.overlayStyle`:

1. **`pill`** — Minimal: drag bar, timer display, progress bar. Single-click ↔ start/pause.
2. **`compact`** — Functional: drag bar, timer display, play/pause button, progress bar.
3. **`monitoring`** — Monitoring: drag bar, timer display, status text ("In deep work" / distraction count), play/pause button, progress bar.

All three overlay styles share the `.sentinel-glass-overlay` class (glassmorphism backdrop with `backdrop-filter: blur(20px)`).

---

### 5.3. Routing & Navigation

#### 5.3.1. Route Definitions (Timer, Planner, Reports, History, Settings, Account)

```typescript
// File: src/app/app.routes.ts

import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/timer/timer.component').then(m => m.TimerComponent),
  },
  {
    path: 'planner',
    loadComponent: () =>
      import('./features/planner/planner.component').then(m => m.PlannerComponent),
  },
  {
    path: 'reports',
    loadComponent: () =>
      import('./features/reports/reports.component').then(m => m.ReportsComponent),
  },
  {
    path: 'history',
    loadComponent: () =>
      import('./features/history/history.component').then(m => m.HistoryComponent),
  },
  {
    path: 'taxonomy',
    loadComponent: () =>
      import('./features/taxonomy/taxonomy.component').then(m => m.TaxonomyComponent),
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./features/settings/settings.component').then(m => m.SettingsComponent),
  },
  {
    path: 'account',
    loadComponent: () =>
      import('./features/account/account.component').then(m => m.AccountComponent),
  },
  { path: '**', redirectTo: '' },
];
```

**Note:** All feature routes use standalone component lazy loading (`loadComponent`) rather than `loadChildren` with NgModules. This produces finer-grained code-splitting.

#### 5.3.2. Lazy-Loaded Feature Modules

Every route except the default (`''` → `TimerComponent`) is lazy-loaded. The `TimerComponent` is eagerly loaded because it is the landing view and must render instantly without a loading state.

#### 5.3.3. Route Guards (Auth-Required for Account/Cloud Features)

```typescript
// File: src/app/core/auth.guard.ts

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { map, take } from 'rxjs';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  return authService.user$.pipe(
    take(1),
    map(user => {
      if (user) return true;
      return router.createUrlTree(['/account']);
    }),
  );
};
```

**Usage:** The `authGuard` is optionally applied to feature routes that require cloud access. Currently no routes are guard-protected because the app is designed to work in local-only mode. The guard is available for future use when server-exclusive features (e.g., leaderboards) are added.

#### 5.3.4. Deep-Link Support from IPC Messages

The C# shell does not navigate the Angular app via URL changes. Instead, Angular listens for IPC messages that imply a view change. The source uses `setView('reports')` etc. in response to various user actions; the target uses `Router.navigate()`:

| IPC Message / User Action | Source Behavior | Target Behavior |
|---|---|---|
| `IDLE_DETECTED` received | `setShowIntervention(true)` (overlay, no route change) | Angular `InterventionService.show()` (overlay, no route change) |
| User clicks "Reports" in sidebar | `setView('reports')` | `Router.navigate(['/reports'])` |
| `COMPACT_MODE_CHANGED` | `setIsCompactMode(data.isCompact)` | `AppComponent.isCompactMode.set(data.isCompact)` — bypasses router |

---

### 5.4. Core Timer Module

The timer module is the heart of the Sentinel frontend. It implements a drift-free countdown engine, manages the Pomodoro work/break cycle, and surfaces session progress to the user. This module is eagerly loaded.

**Source:** The entire timer logic in the source lives in `App.tsx` as React hooks and refs. In the target, it is extracted into a dedicated `TimerService` (singleton, provided in `root`) and a `TimerComponent` (presentation layer).

#### 5.4.1. Drift-Free Anchor-Based Timer Engine

##### 5.4.1.1. `timerAnchor` — `Date.now()` Snapshot at Start

**Source implementation** (`Sentinel.UI/src/App.tsx`, lines 122–126):

```typescript
const timerAnchorRef = useRef<{ startedAt: number; startTimeLeft: number } | null>(null);
```

When the timer starts (or resumes from pause), an anchor object is captured:

```typescript
if (!timerAnchorRef.current) {
  const now = Date.now();
  timerAnchorRef.current = { startedAt: now, startTimeLeft: timeLeft };
}
```

**Target implementation:**

```typescript
// File: src/app/core/timer.service.ts

interface TimerAnchor {
  startedAt: number;    // Date.now() at the moment the timer was started/resumed
  startTimeLeft: number; // seconds remaining at that moment
}

@Injectable({ providedIn: 'root' })
export class TimerService {
  private timerAnchor: TimerAnchor | null = null;
  private sessionStartedAt: number | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  // Signals (Angular signals for reactive UI binding)
  readonly timeLeft = signal<number>(25 * 60);
  readonly isRunning = signal<boolean>(false);
  readonly isComplete = signal<boolean>(false);
  readonly timerMode = signal<TimerMode>('pomodoro');
  readonly sessionName = signal<string>('');
  readonly isPausedByIntervention = signal<boolean>(false);
  readonly distractions = signal<DistractionRecord[]>([]);
  readonly sessionsCompletedToday = signal<number>(0);
  readonly todayFocusSeconds = signal<number>(0);

  // ...
}
```

##### 5.4.1.2. `setInterval` Tick: Remaining = Anchor + Duration − Now

**Source implementation** (`Sentinel.UI/src/App.tsx`, lines 270–295):

The source uses `setInterval(fn, 250)` (4 ticks per second) for responsive display. On each tick:

```typescript
const elapsed = Math.floor((Date.now() - anchor.startedAt) / 1000);
const remaining = Math.max(0, anchor.startTimeLeft - elapsed);
```

If `remaining <= 0`, the timer is complete: the interval is cleared, the session is logged, and the session-complete screen is shown.

**Target implementation:**

```typescript
// File: src/app/core/timer.service.ts (continued)

startTimer(): void {
  if (this.isRunning()) return;

  const mode = this.timerMode();
  const settings = this.settingsService.settings();

  if (this.isComplete()) {
    this.timeLeft.set(getTimerDuration(mode, settings));
    this.isComplete.set(false);
    this.distractions.set([]);
    this.sessionStartedAt = null;
  }

  const now = Date.now();
  this.timerAnchor = { startedAt: now, startTimeLeft: this.timeLeft() };

  if (this.sessionStartedAt === null) {
    const alreadyElapsed = getTimerDuration(mode, settings) - this.timeLeft();
    this.sessionStartedAt = now - alreadyElapsed * 1000;
  }

  this.isRunning.set(true);
  this.isPausedByIntervention.set(false);

  this.intervalId = setInterval(() => this.tick(), 250);

  this.bridgeService.send('TIMER_RUNNING', { running: true });
}

pauseTimer(): void {
  this.clearInterval();
  this.timerAnchor = null;
  this.isRunning.set(false);
  this.bridgeService.send('TIMER_RUNNING', { running: false });
}

private tick(): void {
  if (!this.timerAnchor) return;

  const elapsed = Math.floor((Date.now() - this.timerAnchor.startedAt) / 1000);
  const remaining = Math.max(0, this.timerAnchor.startTimeLeft - elapsed);

  if (remaining <= 0) {
    this.clearInterval();
    this.timerAnchor = null;
    this.timeLeft.set(0);
    this.isRunning.set(false);
    this.isComplete.set(true);

    if (this.timerMode() === 'pomodoro') {
      this.completeSession(false); // endedEarly = false
    }
  } else {
    this.timeLeft.set(remaining);
  }
}

private clearInterval(): void {
  if (this.intervalId !== null) {
    clearInterval(this.intervalId);
    this.intervalId = null;
  }
}
```

##### 5.4.1.3. Drift Correction vs. Naïve Decrement

**Why the anchor pattern:** A naïve `timeLeft -= 1` every 1000ms drifts by ~50–200ms per minute because `setInterval` does not guarantee exact timing and the callback may be delayed by UI thread work. The anchor pattern eliminates all drift:

$$\text{remaining} = \text{startTimeLeft} - \lfloor (\text{now} - \text{startedAt}) / 1000 \rfloor$$

The 250ms poll interval means the displayed time updates at most 250ms after each second boundary, which is imperceptible to users. The anchor is recaptured on every pause/resume to prevent stale offsets.

#### 5.4.2. Timer States: Stopped → Running → Paused → Completed

```
         startTimer()        tick() remaining=0
STOPPED ────────────► RUNNING ──────────────► COMPLETED
  ▲                     │    ▲                     │
  │                     │    │                     │
  │    pauseTimer() ◄───┘    │ resumeTimer()       │
  │                          │                     │
  │    PAUSED ───────────────┘                     │
  │      │                                         │
  │      │  IDLE_DETECTED                          │
  │      ▼                                         │
  │    PAUSED_BY_INTERVENTION                      │
  │      │                                         │
  │      │  dismissIntervention()                  │
  │      ▼                                         │
  │    RUNNING ◄───────────────────────────────────┘
  │                                        (Start Again)
  └────────────────────────────────────────────────┘
                       reset()
```

**State signals:**

| Signal | Type | States |
|---|---|---|
| `isRunning` | `boolean` | `true` → RUNNING; `false` → STOPPED, PAUSED, COMPLETED, or PAUSED_BY_INTERVENTION |
| `isComplete` | `boolean` | `true` → COMPLETED screen shown |
| `isPausedByIntervention` | `boolean` | `true` → paused because `IDLE_DETECTED` was received |

#### 5.4.3. Pomodoro / Break Duration Presets

##### 5.4.3.1. Default Presets (25/5, 50/10, Custom)

**Source** (`Sentinel.UI/src/utils.ts`, lines 1–6):

```typescript
export const PRESETS: TimerPreset[] = [
  { name: 'Classic', focus: 25, shortBreak: 5, longBreak: 15 },
  { name: 'Deep Work', focus: 50, shortBreak: 10, longBreak: 20 },
  { name: 'Sprint', focus: 15, shortBreak: 3, longBreak: 10 },
];
```

**Target:** Carried forward verbatim.

```typescript
// File: src/app/core/timer.utils.ts

export interface TimerPreset {
  name: string;
  focus: number;     // minutes
  shortBreak: number; // minutes
  longBreak: number;  // minutes
}

export const PRESETS: readonly TimerPreset[] = [
  { name: 'Classic', focus: 25, shortBreak: 5, longBreak: 15 },
  { name: 'Deep Work', focus: 50, shortBreak: 10, longBreak: 20 },
  { name: 'Sprint', focus: 15, shortBreak: 3, longBreak: 10 },
] as const;
```

##### 5.4.3.2. Custom Presets Persistence via Settings

Users can save their current timer durations as a named custom preset. Custom presets are stored in `AppSettings.customPresets` (→ §6.1.3.8) and persisted via `SAVE_SETTINGS` IPC → `settings.json` on the C# side, and to Firestore `users/{uid}/settings` when cloud sync is enabled.

**Source flow** (`Sentinel.UI/src/views.tsx`, SettingsScreen):
1. User sets custom durations and clicks "Save Current as Preset".
2. A name input appears. User enters a name and presses Enter or clicks Save.
3. The new preset is appended to `settings.customPresets[]`.
4. `onSaveSettings({ ...settings, customPresets: [...settings.customPresets, newPreset] })` is called.
5. The C# shell persists the full settings object.

**Target:** Same flow, but `saveSettings()` also writes to Firestore via `SettingsService`.

#### 5.4.4. Timer Screen UI

The `TimerComponent` renders the main timer view inside the `WorkspaceLayout`. It displays the circular progress ring, mode selector tabs, session name input, timer controls, preset panel, and session snapshot sidebar.

##### 5.4.4.1. Circular Progress Ring

**Source:** `ProgressRing` function component in `Sentinel.UI/src/views.tsx`.

An SVG circle with `radius=120`, `viewBox="0 0 280 280"`, rotating from 12-o'clock position (`-rotate-90`). The progress is visualized via `strokeDasharray` and `strokeDashoffset`:

```typescript
const circumference = 2 * Math.PI * radius; // 2π × 120 ≈ 753.98
const offset = circumference * (1 - progress / 100);
```

The accent color changes per timer mode:
- **Pomodoro:** `#7c4dff` (primary purple)
- **Short Break:** `#3ce36a` (tertiary green)
- **Long Break:** `#00affe` (secondary blue)

A `drop-shadow` filter (`0 0 16px ${accent}55`) creates a glow effect on the progress arc.

**Target:** Port as `ProgressRingComponent` in `src/app/shared/progress-ring/`. Same SVG structure, using `@Input() progress: number` (0–100) and `@Input() accent: string`.

##### 5.4.4.2. Start / Pause / Reset Controls

**Source:** Three control buttons rendered conditionally in `TimerScreen`:

- **Start Focus / Pause Session** — primary button, toggles between start and pause. Minimum width 10rem.
- **Reset** — secondary button, visible when `isRunning || isPausedByIntervention || timerProgress > 0`. If timer is running, shows a `ConfirmModal` before resetting.
- **End Session** — inline text button, visible when `timerMode === 'pomodoro' && (isRunning || timerProgress > 0)`. Triggers the early-end session flow (→ §5.4.5.2).

##### 5.4.4.3. Session Name Input

**Source:** `<input>` with `placeholder="Name this focus session..."` and CSS class `sentinel-input--subtle` (no visible border, transparent background, bottom accent on focus).

The session name is stored in `sessionName` state and passed to the session record on completion. It is optional — sessions can be unnamed.

##### 5.4.4.4. Daily Focus Goal Progress Indicator

**Source:** `calculateGoalProgress()` function (`Sentinel.UI/src/utils.ts`, lines 84–88):

```typescript
export function calculateGoalProgress(todayFocusSeconds: number, settings: Settings): number {
  if (settings.dailyFocusGoalMinutes <= 0) return 0;
  return Math.min(100, Math.round((todayFocusSeconds / (settings.dailyFocusGoalMinutes * 60)) * 100));
}
```

**Target:** Port verbatim to `src/app/core/timer.utils.ts`. The `todayFocusSeconds` value is computed by reading the Firestore daily aggregate document `users/{uid}/stats/daily/{YYYY-MM-DD}` (→ §6.2.3.1) on app startup and after each session completion. In the source, this value came from the C# shell via `SETTINGS_LOADED.todayFocusSeconds` (computed from SQLite). In the target, Angular reads it directly from Firestore.

**Sidebar display:** The "Progress Today" section card in the timer view shows: sessions completed, distraction count, and goal % as `InsightRow` components.

#### 5.4.5. Session Completion Flow

##### 5.4.5.1. Auto-Trigger on Timer Reaching Zero

When `remaining <= 0` in the tick loop:

1. Timer is stopped (`isRunning = false`, `isComplete = true`).
2. If `timerMode === 'pomodoro'`, a session completion record is created.
3. `PLAY_SOUND` IPC message is sent to the C# shell (→ §3.3.10).
4. The `SessionCompleteComponent` is rendered (modal overlay).

##### 5.4.5.2. Manual Early-End (`endedEarly` Flag)

**Source:** `handleEndSession()` in `App.tsx` — only available during pomodoro mode. Shows a `ConfirmModal` with the elapsed time before committing.

The source calculates:
```typescript
const totalDuration = getTimerDuration('pomodoro', settings);
const elapsed = totalDuration - timeLeft;
```

If `elapsed < 1`, the end-session button is a no-op (prevents zero-length sessions).

**Target:** Same logic. The `endedEarly` flag is set to `true` in the session event.

##### 5.4.5.3. Session Record Construction (Duration, StartedAt, CompletedAt, Name, EndedEarly)

**Source flow** (normal completion, `App.tsx` lines 282–293):

```typescript
const startedAt = new Date(sessionStartedAtRef.current ?? Date.now()).toISOString();
const duration = getTimerDuration('pomodoro', settingsRef.current);
postMessage({
  type: 'LOG_SESSION',
  durationSeconds: duration,
  sessionName: sessionNameRef.current || undefined,
  startedAt,
});
```

**Source flow** (early end, `App.tsx` lines 603–615):

```typescript
const startedAt = new Date(sessionStartedAtRef.current ?? Date.now()).toISOString();
postMessage({
  type: 'LOG_SESSION',
  durationSeconds: elapsed,
  sessionName: sessionName || undefined,
  startedAt,
  endedEarly: true,
});
```

**Target flow:**

In the target, the `LOG_SESSION` IPC message is **DROPPED** (→ §3.3.3). Instead, Angular writes session events directly to the Firestore Event Ledger:

```typescript
// File: src/app/core/timer.service.ts

private async completeSession(endedEarly: boolean): Promise<void> {
  const settings = this.settingsService.settings();
  const totalDuration = getTimerDuration('pomodoro', settings);
  const elapsed = endedEarly ? (totalDuration - this.timeLeft()) : totalDuration;
  const startedAt = this.sessionStartedAt
    ? new Date(this.sessionStartedAt).toISOString()
    : new Date().toISOString();
  const completedAt = new Date().toISOString();
  const sessionId = this.currentSessionId; // UUID generated at timer start

  // Update local counters
  this.sessionsCompletedToday.update(n => n + 1);
  this.todayFocusSeconds.update(n => n + elapsed);

  // Write Event Ledger entries to Firestore
  await this.eventLedgerService.writeEvent({
    type: endedEarly ? 'TimerEndedEarly' : 'TimerCompleted',
    sessionId,
    timestamp: completedAt,
    payload: {
      durationSeconds: elapsed,
      sessionName: this.sessionName() || null,
      startedAt,
      completedAt,
      endedEarly,
    },
  });

  // Play completion sound
  this.bridgeService.send('PLAY_SOUND', {});

  this.sessionStartedAt = null;
}
```

##### 5.4.5.4. Session Event Ledger Records (Replaces IPC `LOG_SESSION`)

Instead of sending `LOG_SESSION` to the C# shell (which would write to SQLite), Angular writes directly to `users/{uid}/session_events/{eventId}`. The event types for session lifecycle:

| Event Type | Payload | Trigger |
|---|---|---|
| `TimerStarted` | `{ sessionId, durationSeconds, sessionName, startedAt }` | User clicks Start |
| `TimerPaused` | `{ sessionId, pausedAt, timeLeftSeconds }` | User clicks Pause |
| `TimerCompleted` | `{ sessionId, durationSeconds, sessionName, startedAt, completedAt, endedEarly: false }` | Timer reaches zero |
| `TimerEndedEarly` | `{ sessionId, durationSeconds, sessionName, startedAt, completedAt, endedEarly: true }` | User ends session early |

See → §6.2.2 for the complete Event Ledger schema.

---

### 5.5. Distraction Intervention Flow (Captured Intervention)

The intervention flow is the defining UX feature of Sentinel. When the C# shell detects user idleness during a running timer, it sends `IDLE_DETECTED` via IPC. Angular freezes the timer, overlays a forced modal, and requires the user to categorize the distraction before resuming work.

**Source:** The entire flow is orchestrated in `App.tsx` via React state (`showIntervention`, `isPausedByIntervention`, `distractionInput`, `categorySelection`, etc.) and rendered by the `InterventionModal` component in `views.tsx`.

#### 5.5.1. Trigger: `IDLE_DETECTED` IPC Message Received

**Source** (`App.tsx` lines 197–204):

```typescript
case 'IDLE_DETECTED':
  if (isRunning) {
    wasRunningRef.current = true;
    setIsRunning(false);
    setIsPausedByIntervention(true);
    setShowIntervention(true);
    postMessage({ type: 'GET_TAXONOMY_DATA' });
  }
  break;
```

**Target:**

```typescript
// File: src/app/core/bridge.service.ts (message handler)

case 'IDLE_DETECTED':
  if (this.timerService.isRunning()) {
    this.timerService.pauseForIntervention();
    this.interventionService.show();
  }
  break;
```

**Key difference from source:** The source sends `GET_TAXONOMY_DATA` IPC to request fresh taxonomy data from the C# shell (SQLite). The target does NOT send this message — taxonomy data is loaded from Firestore snapshot listeners and is always current in memory.

**Hotkey trigger:** The source also triggers the intervention flow on `HOTKEY_DISTRACTION` (Ctrl+Shift+D). The target handles this identically — the C# shell sends `HOTKEY_DISTRACTION` via IPC, and Angular treats it the same as `IDLE_DETECTED`.

#### 5.5.2. Timer Freeze: Pause Timer State on Intervention

When `IDLE_DETECTED` arrives:

1. `timerService.pauseForIntervention()` is called.
2. This sets `isPausedByIntervention = true`, `isRunning = false`.
3. The `timerAnchor` is cleared (same as pause).
4. The `sessionStartedAt` is NOT cleared — the session clock continues for duration tracking.

```typescript
// File: src/app/core/timer.service.ts

pauseForIntervention(): void {
  this.clearInterval();
  this.timerAnchor = null;
  this.isRunning.set(false);
  this.isPausedByIntervention.set(true);
  this.bridgeService.send('TIMER_RUNNING', { running: false });
}
```

#### 5.5.3. Forced Overlay Modal (Non-Dismissible Without Input)

The `InterventionModalComponent` renders on top of all content. Per TARGET_ARCHITECTURE.md §4: "The user cannot dismiss this modal without categorizing the distraction via the Distraction Taxonomy."

**Source enforcement:** The source actually allows dismissal without input — clicking "False Alarm" or pressing Escape dismisses the modal. This is carried forward because "False Alarm" is itself a categorization (it writes a `FalseAlarmMarked` event). The Escape key also dismisses (calls `dismissIntervention()` which sends `INTERVENTION_DISMISSED` → target: `AUDITOR_CLEARED`).

**Target: `InterventionModalComponent` inputs and outputs:**

```typescript
// File: src/app/features/intervention/intervention-modal.component.ts

@Component({
  selector: 'app-intervention-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // template renders the intervention UI
})
export class InterventionModalComponent {
  // Injected services
  private taxonomyService = inject(TaxonomyService);
  private interventionService = inject(InterventionService);

  // Local state
  distractionInput = signal('');
  categorySelection = signal<string>('__auto__');
  newCategoryName = signal('');

  // Computed
  inferredCategory = computed(() => {
    const note = this.distractionInput().trim();
    if (!note) return null;
    return getMappedCategoryForNote(this.taxonomyService.groups(), note);
  });

  quickSuggestions = computed(() =>
    buildQuickSuggestions(this.taxonomyService.taxonomyData())
  );

  categoryOptions = computed(() =>
    this.taxonomyService.categories()
  );
}
```

##### 5.5.3.1. Distraction Note Text Input

An `<input type="text">` with `placeholder="What pulled you away?"`, `autofocus`. The value is bound to `distractionInput()`.

##### 5.5.3.2. Category Selection / Auto-Suggest

A `<select>` dropdown rendered when `distractionInput().trim()` is non-empty:

| Option Value | Display Text | Behavior |
|---|---|---|
| `__auto__` | `Suggested: {inferredCategoryName}` or `No category` | Uses `getMappedCategoryForNote()` result |
| `__none__` | `Keep uncategorized` | Forces `categoryName = null` |
| `{existing category}` | `{category name}` | Assigns the selected category |
| `__new__` | `Create new category` | Shows a secondary text input for the new category name |

##### 5.5.3.3. "False Alarm" Toggle (`IsFalseAlarm` Flag)

The "False Alarm" button dismisses the intervention without logging a distraction. In the target, this writes a `FalseAlarmMarked` event to the Event Ledger:

```typescript
async handleFalseAlarm(): Promise<void> {
  await this.eventLedgerService.writeEvent({
    type: 'FalseAlarmMarked',
    sessionId: this.timerService.currentSessionId,
    timestamp: new Date().toISOString(),
    payload: {},
  });
  this.interventionService.dismiss();
}
```

**Source:** The source sends `{ type: 'FALSE_ALARM' }` IPC to the C# shell, which increments a counter in SQLite. The target writes directly to Firestore.

##### 5.5.3.4. Quick Suggestion Pills (2 Recent + 3 Frequent)

**Source:** `buildQuickSuggestions()` in `Sentinel.UI/src/taxonomy.ts`. Returns up to 5 suggestions:

1. First 2: most recent distinct distraction notes from `taxonomyData.recentEntries`.
2. Next 3: most frequent distraction notes from `taxonomyData.groups`, sorted by `count` descending, then by `lastSeenAt` descending.
3. Deduplication: uses a `Set<string>` of normalized notes to prevent overlap.

**Target:** Carried forward verbatim. The `TaxonomyService` maintains `taxonomyData()` signal fed by Firestore snapshot listener on `users/{uid}/taxonomy/{categoryId}` and `users/{uid}/session_events` (for recent entries).

#### 5.5.4. Distraction Taxonomy Engine

##### 5.5.4.1. `normalizeDistractionNote()` — Lowercase, Trim, Collapse Whitespace

**Source** (`Sentinel.UI/src/taxonomy.ts`, lines 11–13):

```typescript
export function normalizeDistractionNote(note: string): string {
  return note.trim().toLowerCase();
}
```

**Target:** Carried forward verbatim to `src/app/core/taxonomy.utils.ts`.

##### 5.5.4.2. `getMappedCategoryForNote()` — Lookup Against Taxonomy Map

**Source** (`Sentinel.UI/src/taxonomy.ts`, lines 15–23):

```typescript
export function getMappedCategoryForNote(
  groups: DistractionGroup[],
  note: string,
): string | null {
  const normalized = normalizeDistractionNote(note);
  if (!normalized) return null;
  return groups.find((group) => group.normalizedNote === normalized)?.categoryName ?? null;
}
```

**Target:** Carried forward verbatim. The `groups` array comes from the `TaxonomyService` which reads Firestore `users/{uid}/taxonomy/{categoryId}` documents.

##### 5.5.4.3. `buildQuickSuggestions()` — Frequency + Recency Algorithm

**Source** (`Sentinel.UI/src/taxonomy.ts`, lines 25–66):

```typescript
export function buildQuickSuggestions(taxonomyData: TaxonomyData): QuickSuggestion[] {
  const suggestions: QuickSuggestion[] = [];
  const seen = new Set<string>();

  // Phase 1: 2 most recent distinct entries
  for (const entry of taxonomyData.recentEntries) {
    if (!entry.normalizedNote || seen.has(entry.normalizedNote)) continue;
    suggestions.push({
      note: entry.note,
      categoryName: entry.categoryName,
      source: 'Recent',
    });
    seen.add(entry.normalizedNote);
    if (suggestions.length >= 2) break;
  }

  // Phase 2: Most frequent groups
  const frequentGroups = [...taxonomyData.groups].sort((left, right) => right.count - left.count);
  for (const group of frequentGroups) {
    if (!group.normalizedNote || seen.has(group.normalizedNote)) continue;
    suggestions.push({
      note: group.note,
      categoryName: group.categoryName,
      source: 'Frequent',
    });
    seen.add(group.normalizedNote);
    if (suggestions.length >= 5) return suggestions;
  }

  // Phase 3: Fill remaining from most-recent groups
  const recentGroups = [...taxonomyData.groups].sort(
    (left, right) => new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime(),
  );
  for (const group of recentGroups) {
    if (!group.normalizedNote || seen.has(group.normalizedNote)) continue;
    suggestions.push({
      note: group.note,
      categoryName: group.categoryName,
      source: 'Frequent',
    });
    seen.add(group.normalizedNote);
    if (suggestions.length >= 5) break;
  }

  return suggestions;
}
```

**Target:** Carried forward verbatim to `src/app/core/taxonomy.utils.ts`.

**Data source change:** In the source, `taxonomyData` comes from the C# shell via `TAXONOMY_DATA` IPC message (C# queries SQLite). In the target, the `TaxonomyService` maintains taxonomy data from Firestore snapshot listeners. The `TaxonomyData` interface is unchanged:

```typescript
// File: src/app/core/models.ts

export interface DistractionEntry {
  id: string; // Changed from number (SQLite auto-increment) to string (Firestore doc ID)
  note: string;
  normalizedNote: string;
  categoryName: string | null;
  timestamp: string; // ISO 8601
}

export interface DistractionGroup {
  note: string;
  normalizedNote: string;
  categoryName: string | null;
  count: number;
  lastSeenAt: string; // ISO 8601
}

export interface TaxonomyData {
  recentEntries: DistractionEntry[];
  groups: DistractionGroup[];
  categories: string[];
}
```

#### 5.5.5. Submission: Firestore Event Ledger Write (Replaces IPC `LOG_DISTRACTION`)

**Source** (`App.tsx` lines 469–492):

```typescript
postMessage({
  type: 'LOG_DISTRACTION',
  note: cleanNote,
  categoryName: resolvedCategoryName,
  forceUncategorized,
});
```

The source sends the distraction to the C# shell, which writes to SQLite. It also optionally writes a separate Firestore document (`distractions` collection) if cloud sync is enabled.

**Target:**

```typescript
// File: src/app/features/intervention/intervention-modal.component.ts

async submitDistraction(note: string, categoryName: string | null): Promise<void> {
  const cleanNote = note.trim();
  if (!cleanNote) return;

  const normalizedNote = normalizeDistractionNote(cleanNote);
  const sessionId = this.timerService.currentSessionId;

  // Write to Event Ledger
  await this.eventLedgerService.writeEvent({
    type: 'DistractionLogged',
    sessionId,
    timestamp: new Date().toISOString(),
    payload: {
      note: cleanNote,
      normalizedNote,
      categoryName,
    },
  });

  // Update local distractions array for in-session display
  this.timerService.distractions.update(list => [...list, {
    note: cleanNote,
    categoryName,
    timestamp: new Date(),
  }]);

  // Update taxonomy in Firestore (note → category mapping)
  await this.taxonomyService.upsertMapping(normalizedNote, cleanNote, categoryName);

  this.interventionService.dismiss();
}
```

**Key differences from source:**
1. No IPC message to C# shell — Angular writes directly to Firestore.
2. No separate `distractions` flat collection — the distraction is recorded as a `DistractionLogged` event in the Event Ledger (`users/{uid}/session_events/{eventId}`).
3. The taxonomy mapping (`note → category`) is updated in Firestore `users/{uid}/taxonomy/{categoryId}` — not via IPC to C# SQLite.

#### 5.5.6. Timer Resume After Distraction Logged

After the distraction is logged (or a false alarm is recorded), the intervention modal is dismissed and the timer resumes automatically:

```typescript
// File: src/app/core/intervention.service.ts

dismiss(): void {
  this.isVisible.set(false);
  this.bridgeService.send('AUDITOR_CLEARED', {});

  if (this.timerService.isPausedByIntervention()) {
    this.timerService.resumeAfterIntervention();
  }
}
```

```typescript
// File: src/app/core/timer.service.ts

resumeAfterIntervention(): void {
  this.isPausedByIntervention.set(false);
  this.startTimer(); // Re-captures anchor, re-starts interval
}
```

**IPC message:** `AUDITOR_CLEARED` is sent to the C# shell (→ §3.3.2). This replaces the source's `INTERVENTION_DISMISSED`. The C# shell does nothing with this message except log it — it does not control the idle monitor lifecycle (the monitor is always running when the timer runs; it just re-fires if idle resumes).

---

### 5.6. Teams-Style Planner Module (New — Target Architecture)

**This is a NEW feature with no source equivalent.** The Planner module provides a Teams-style calendar grid where users schedule focus blocks in advance. It is specified in TARGET_ARCHITECTURE.md §4 ("Core Modules: Timer, Planner (Teams-style calendar), History, Reports, Settings, and Account").

#### 5.6.1. Calendar Grid Component (Day / Week / Month Views)

The `PlannerComponent` renders a multi-view calendar:

- **Day view:** Vertical time axis (00:00–23:59) with hourly gridlines. Focus blocks are rendered as positioned rectangles.
- **Week view:** 7-column grid with shared vertical time axis. Default view.
- **Month view:** Traditional 7×5/6 grid showing colored dots for days with scheduled blocks.

The calendar component should use an Angular-compatible library (e.g., `angular-calendar` or custom-built) that supports drag interactions.

#### 5.6.2. Focus Block Scheduling (Drag-to-Create, Resize, Move)

Users interact with the calendar via:

1. **Drag-to-create:** Click and drag on an empty time slot to create a new focus block.
2. **Resize:** Drag the bottom edge of an existing block to extend or shorten it.
3. **Move:** Drag the body of a block to a different time slot.
4. **Click to edit:** Click a block to open an inline editor (label, color, repeat rule).

#### 5.6.3. Planner Data Model (PlannedBlock)

```typescript
// File: src/app/core/models.ts

export interface PlannedBlock {
  id: string;            // Firestore doc ID
  userId: string;        // From Firebase Auth
  label: string;         // User-defined label, e.g., "Deep Work", "Writing"
  color: string;         // Hex color from a curated palette
  startTime: string;     // ISO 8601 datetime
  endTime: string;       // ISO 8601 datetime
  durationMinutes: number; // Cached for display, computed from start/end
  repeat: RepeatRule | null; // null = one-time block
  createdAt: string;     // ISO 8601
  updatedAt: string;     // ISO 8601
}

export interface RepeatRule {
  frequency: 'daily' | 'weekdays' | 'custom';
  customDays?: number[]; // 0=Sunday, 1=Monday, ..., 6=Saturday
  until?: string;        // ISO 8601 date — end of recurrence (optional, null = indefinite)
}
```

#### 5.6.4. Recurring Block Rules (Daily, Weekday, Custom)

| Rule | Behavior |
|---|---|
| `daily` | Block repeats every day at the same time |
| `weekdays` | Block repeats Monday–Friday |
| `custom` | Block repeats on specific days of the week (e.g., Mon/Wed/Fri) |

Recurring blocks are expanded client-side for display. The Firestore document stores the base block with its repeat rule. The calendar component generates virtual instances for the display range.

#### 5.6.5. Planner ↔ Timer Integration (Auto-Start from Scheduled Block)

When the current time matches the `startTime` of a `PlannedBlock`, the Planner module can optionally auto-start the timer:

1. A notification banner appears: "Scheduled focus block: {label} — Start now?"
2. User confirms → `TimerService.startTimer()` is called with the block's `durationMinutes`.
3. The `sessionName` is pre-filled with the block's `label`.

This is an optional enhancement and may be deferred to a later release.

#### 5.6.6. Firestore Standard Persistence for Planner Documents

Planner blocks use Firestore's **Standard Persistence** path (not the Event Ledger). Angular writes directly to `users/{uid}/planner_blocks/{blockId}` using `setDoc`/`updateDoc`/`deleteDoc`.

```typescript
// Firestore path: users/{uid}/planner_blocks/{blockId}

// Example document:
{
  "label": "Deep Work",
  "color": "#7c4dff",
  "startTime": "2026-04-03T09:00:00.000Z",
  "endTime": "2026-04-03T10:30:00.000Z",
  "durationMinutes": 90,
  "repeat": {
    "frequency": "weekdays",
    "customDays": null,
    "until": null
  },
  "createdAt": "2026-04-01T12:00:00.000Z",
  "updatedAt": "2026-04-01T12:00:00.000Z"
}
```

**Firestore security rule** (→ §10):

```
match /users/{uid}/planner_blocks/{blockId} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

---

### 5.7. Reports & Analytics Module

The Reports module displays aggregated focus data: total focus time, session counts, distraction breakdowns by category, daily history timelines, and intervention accuracy metrics.

**Source:** `ReportsScreen` component in `Sentinel.UI/src/views.tsx`. Uses Recharts (`BarChart`, `PieChart`) for visualizations.

**Critical migration change:** In the source, report data comes from the C# shell via IPC `GET_REPORT_DATA` → SQLite query → `REPORT_DATA` response. In the target, all report data comes from Firestore. Angular reads server-computed aggregate documents (→ §6.2.3) and raw Event Ledger entries for detailed views.

#### 5.7.1. Report Data Source (Firestore Direct — No IPC)

**Source flow:**

```
Angular → IPC GET_REPORT_DATA { range } → C# ReportingService → SQLite Query → IPC REPORT_DATA { data } → Angular
```

**Target flow:**

```
Angular → Firestore query on users/{uid}/stats/daily/{date} + users/{uid}/session_events → Local aggregation → Display
```

The `ReportService` in Angular queries:

1. **Daily aggregates:** `users/{uid}/stats/daily/{YYYY-MM-DD}` — server-computed documents containing `{ totalFocusSeconds, sessionsCompleted, distractionsLogged, falseAlarms }`. These are written by Cloud Functions (→ §8).
2. **Session history:** `users/{uid}/session_events` where `type in ['TimerCompleted', 'TimerEndedEarly']`, ordered by `timestamp desc`, limited to the selected date range.
3. **Distraction breakdown:** `users/{uid}/session_events` where `type == 'DistractionLogged'`, grouped client-side by `payload.categoryName`.

**Fallback for offline/first-use:** If daily aggregate documents don't exist yet (e.g., Cloud Functions haven't processed events yet, or user is offline without prior sync), Angular falls back to client-side aggregation from cached Event Ledger entries in Firestore's IndexedDB persistence.

#### 5.7.2. Focus Time Summary (Total Hours, Session Count)

**Source `ReportData` interface** (`Sentinel.UI/src/app-types.ts`, lines 7–18):

```typescript
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
```

**Target** — same interface structure, but computed from Firestore data:

```typescript
// File: src/app/core/models.ts

export interface ReportData {
  totalFocusSeconds: number;
  sessionsCompleted: number;
  distractionsLogged: number;
  falseAlarms: number;
  avgSessionSeconds: number;
  dailyFocus: DailyFocusEntry[];
  topCategories: ReportBreakdownItem[];
  topDistractions: ReportBreakdownItem[];
  recentSessions: SessionHistoryEntry[];
}

export interface DailyFocusEntry {
  date: string; // YYYY-MM-DD
  focusSeconds: number;
  sessions: number;
  distractions: number;
}

export interface ReportBreakdownItem {
  name: string;
  count: number;
  categoryName?: string | null;
}

export interface SessionHistoryEntry {
  sessionId: string;
  startedAt: string;    // ISO 8601
  completedAt: string | null;
  durationSeconds: number;
  completed: boolean;
  endedEarly: boolean;
  sessionName: string | null;
  distractionsCount: number;
  falseAlarmCount: number;
}
```

Metric cards rendered in a 4-column grid: Focus Time, Sessions, Categories, Distractions.

#### 5.7.3. Distraction Breakdown (Category Pie Chart, Frequency Bar Chart)

**Source:** `ReportsScreen` renders a Recharts `PieChart` for top categories with the `COLORS` palette (`['#7c4dff', '#00affe', '#3ce36a', '#f59e0b', '#ec4899', '#ef4444']`). Below it, an `InsightRow` list with color-coded bars.

**Target:** Replace Recharts with an Angular charting library (e.g., `ng2-charts` wrapping Chart.js, or `ngx-echarts`). The chart configuration:

- **Pie chart:** Inner radius 42, outer radius 68, data from `reportData.topCategories`.
- **Colors:** Same `CHART_COLORS` array.
- **Tooltip:** Dark-themed (`background: '#201f1f'`, `border: '1px solid rgba(73, 68, 85, 0.25)'`, `borderRadius: 16px`).

#### 5.7.4. Daily History Timeline (Bar Chart)

**Source:** `ReportsScreen` renders a Recharts `BarChart` with focus minutes per day. X-axis shows date strings, Y-axis is hidden, bars use `#7c4dff` fill with `radius: [10, 10, 0, 0]` (rounded top corners).

**Target:** Same configuration with the Angular charting library.

#### 5.7.5. Date Range Selector (Since Date Filter)

**Source range options:**

```typescript
const RANGE_OPTIONS: { key: ReportRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'All' },
];
```

**Target:** Carried forward verbatim. The `ReportRange` type: `'today' | 'week' | 'month' | 'all'`.

**Date calculation:**

```typescript
const since =
  range === 'today'  ? startOfToday()
  : range === 'week' ? new Date(Date.now() - 7 * 86_400_000)
  : range === 'month'? new Date(Date.now() - 30 * 86_400_000)
  : new Date(0); // 'all' — epoch
```

#### 5.7.6. Daily Focus Goal vs. Actual Visualization

The daily focus goal is displayed in the "Progress Today" sidebar card on the timer screen and as Intervention Accuracy metrics on the reports screen. The goal percentage is computed by `calculateGoalProgress()` (→ §5.4.4.4).

The reports screen additionally shows an "Intervention Accuracy" section card:

```typescript
const total = distractionsLogged + falseAlarms;
const accuracy = total === 0 ? 100 : Math.round(((total - falseAlarms) / total) * 100);
```

Displayed as a large percentage with explanatory text.

---

### 5.8. Session History Module

The Session History module provides a dedicated paginated list of all completed focus sessions with detail cards.

**Source:** `SessionHistoryScreen` component in `Sentinel.UI/src/views.tsx`.

#### 5.8.1. Paginated Session List (Firestore Query — No IPC)

**Source:** The source requests session history via `GET_REPORT_DATA` IPC (same as reports). The `reportData.recentSessions` array is displayed.

**Target:** The `HistoryComponent` queries Firestore directly:

```typescript
// Firestore query:
// users/{uid}/session_events
// where type in ['TimerCompleted', 'TimerEndedEarly']
// orderBy timestamp desc
// limit pageSize

const sessionsQuery = query(
  collection(db, `users/${uid}/session_events`),
  where('type', 'in', ['TimerCompleted', 'TimerEndedEarly']),
  orderBy('timestamp', 'desc'),
  limit(PAGE_SIZE),
);
```

**Pagination:** Client-side pagination using `startAfter()` cursor-based Firestore pagination for subsequent pages.

**Page size:** 10 items per page (matching source `PAGE_SIZE = 10`).

#### 5.8.2. Session Detail Card (Name, Duration, Start/End, EarlyEnd Badge)

Each session card renders:

| Field | Source | Display |
|---|---|---|
| Session name | `payload.sessionName` or fallback to date | Bold title |
| Start time | `payload.startedAt` | `toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})` |
| End time | `payload.completedAt` | Same format, separated by "—" |
| Duration | `payload.durationSeconds` | `formatDuration()` (e.g., "25m", "1h 30m") |
| Ended early | `type === 'TimerEndedEarly'` | Amber badge "Ended early" |
| Distraction count | Count of `DistractionLogged` events with same `sessionId` | "{n} distraction(s)" |
| False alarm count | Count of `FalseAlarmMarked` events with same `sessionId` | "{n} false alarm(s)" |
| Clean session | No distractions, no false alarms, not ended early | "Clean session" |

**Summary strip:** Above the session list, three `MetricCard` components show Total Focus, Sessions count, and Total Distractions for the selected range.

#### 5.8.3. Distraction Log Per Session

For the target, the distraction log per session is derived from Event Ledger queries:

```typescript
// For a given sessionId, get all DistractionLogged and FalseAlarmMarked events:
const distractionsQuery = query(
  collection(db, `users/${uid}/session_events`),
  where('sessionId', '==', sessionId),
  where('type', 'in', ['DistractionLogged', 'FalseAlarmMarked']),
  orderBy('timestamp', 'asc'),
);
```

This replaces the source's `distractionsCount` and `falseAlarmCount` fields which were pre-computed by the C# `ReportingService` from SQLite.

---

### 5.9. Taxonomy Manager Module

The Taxonomy Manager allows users to organize, rename, and re-categorize their logged distraction labels. It provides a searchable, paginated list of distraction groups and a category editor.

**Source:** `TaxonomyManagerScreen` component in `Sentinel.UI/src/views.tsx`.

#### 5.9.1. Full Taxonomy Tree View

The taxonomy view is a two-column layout:

- **Left column (60%):** "Manage Labels" — searchable, filterable list of `DistractionGroup` entries. Each group shows the distraction note, its current category (or "Uncategorized"), occurrence count, and an expandable editor.
- **Right column (40%):** "Categories" list + "Recent Logs" list.

**Summary strip:** Four `MetricCard` components: Labels count, Categorized %, Categories count, Total Logs count.

**Filters:**
- Search input: filters by note text or category name (case-insensitive).
- "All" / "Uncategorized" toggle pills: filters to show only uncategorized entries.

#### 5.9.2. Category Rename Operation (Firestore Direct — No IPC)

**Source:** Sends `RENAME_CATEGORY` IPC to C# shell, which runs a SQLite UPDATE on all distractions with the old category name.

**Target:** Angular updates the Firestore taxonomy documents directly:

```typescript
// File: src/app/core/taxonomy.service.ts

async renameCategory(oldName: string, newName: string): Promise<void> {
  // Query all taxonomy docs with categoryName === oldName
  const snap = await getDocs(
    query(
      collection(db, `users/${uid}/taxonomy`),
      where('categoryName', '==', oldName),
    ),
  );

  const batch = writeBatch(db);
  snap.docs.forEach(doc => {
    batch.update(doc.ref, { categoryName: newName.trim() });
  });
  await batch.commit();
}
```

#### 5.9.3. Note → Category Remap Operation

The `TaxonomyGroupEditor` component allows the user to change the category assigned to a distraction note group:

1. User expands a group row.
2. Selects a different category from the dropdown (or creates a new one).
3. Clicks "Save".
4. Angular calls `taxonomyService.upsertMapping(normalizedNote, note, newCategoryName)`.

**Source:** Sends `UPDATE_DISTRACTION_GROUP` IPC with `{ normalizedNote, note, categoryName }` to C# shell.

**Target:** Angular writes directly to Firestore taxonomy collection.

#### 5.9.4. Uncategorized Distraction Triage Workflow

The "Uncategorized" filter pill shows only distraction groups where `categoryName === null`. This is the primary triage workflow: users review their uncategorized distractions and assign categories to improve reporting accuracy.

**Metric tracking:** The "Categorized %" metric card shows:

```typescript
const categorizedPct = groups.length
  ? Math.round(((groups.length - uncategorizedCount) / groups.length) * 100)
  : 0;
```

---

### 5.10. Settings Module

The Settings module provides controls for all user-configurable parameters. Settings are persisted to both the C# shell (`settings.json` via IPC `SAVE_SETTINGS`) and Firestore (`users/{uid}/settings` via direct write when cloud sync is enabled).

**Source:** `SettingsScreen` component in `Sentinel.UI/src/views.tsx`.

#### 5.10.1. Pomodoro Duration Settings

**Input:** Three `NumberField` inputs in a 3-column grid:
- Focus: `settings.pomodoroMinutes`, range `[1, 120]`
- Short Break: `settings.shortBreakMinutes`, range `[1, 30]`
- Long Break: `settings.longBreakMinutes`, range `[1, 60]`

Each change calls `updateSetting(key, value)` → `onSaveSettings({...settings, [key]: value})` → IPC `SAVE_SETTINGS`.

#### 5.10.2. Break Duration Settings

Handled by the same fields as §5.10.1 (Short Break and Long Break columns).

#### 5.10.3. Idle Threshold Adjustment (Seconds Slider)

**Source:** `<input type="range" min={10} max={300} step={5}>` bound to `settings.idleThresholdSeconds`.

**Dynamic hint text:**

```typescript
settings.idleThresholdSeconds <= 30
  ? 'Very sensitive — triggers quickly after you stop moving.'
  : settings.idleThresholdSeconds <= 60
    ? 'Balanced — gives you a moment to think before flagging.'
    : settings.idleThresholdSeconds <= 120
      ? 'Relaxed — ideal if you read or study between sessions.'
      : 'Very relaxed — long pauses are allowed before intervention.';
```

#### 5.10.4. Always-On-Top Toggle

A `sentinel-toggle-row` switch button bound to `settings.alwaysOnTop`. When toggled, the IPC `SAVE_SETTINGS` message carries the new value. The C# shell reads `settings.AlwaysOnTop` and calls `_window.SetTopMost(value)`.

#### 5.10.5. Suppress During Media Toggle

A toggle switch bound to `settings.suppressDuringMedia`. Labels: "Active" / "Disabled". Description dynamically changes to explain the current behavior.

#### 5.10.6. Daily Focus Goal (Minutes)

**Input:** Single `NumberField` for `settings.dailyFocusGoalMinutes`, range `[0, 1440]`. `0` disables the goal indicator.

#### 5.10.7. Overlay Style Preference

**Source:** Not exposed in the settings UI in the current source (the `overlayStyle` property exists on `Settings` but the UI dropdown was not implemented in `SettingsScreen`).

**Target:** Add a dropdown or segmented control to select between `'pill'`, `'compact'`, and `'monitoring'` overlay styles. Persisted in `settings.overlayStyle`.

#### 5.10.8. Cloud Sync Enable/Disable Toggle

An inline toggle switch with a custom-styled track (purple when enabled, gray when disabled). Labels: "Enabled" / "Disabled". Sub-text dynamically indicates whether data syncs to the cloud or stays local.

#### 5.10.9. Custom Preset Management (Add / Edit / Delete)

Three operations:

1. **Add:** When current timer durations don't match any built-in preset, a "Save Current as Preset" button appears. Clicking it reveals a name input. The new preset is appended to `settings.customPresets[]`.
2. **Delete:** Each custom preset has a small `×` button in the top-right corner. Clicking it shows a `ConfirmModal`: "Delete '{name}'? This cannot be undone." Confirmed → preset is removed from the array.
3. **Apply:** Clicking any preset (built-in or custom) immediately updates the timer durations and calls `saveSettings()`.

**Duplicate name prevention:** The source checks `settings.customPresets.some(p => p.name.toLowerCase() === newName.toLowerCase())` to disable the Save button if the name already exists.

#### 5.10.10. Active Window Whitelist Editor (New — Target Architecture)

**This is a NEW feature introduced in §4.4.** The settings UI must include an editor for the `activeWindowWhitelist` setting.

**UI design:**

```
┌───────────────────────────────────────────────┐
│ Active Window Whitelist                       │
│ Apps that prevent idle detection when focused.│
│                                               │
│ ┌───────────────────┐  ┌─────┐               │
│ │ code.exe          │  │ Add │               │
│ └───────────────────┘  └─────┘               │
│                                               │
│ ┌────────────────────────────────────┐        │
│ │ code                          [×]  │        │
│ │ devenv                        [×]  │        │
│ │ chrome                        [×]  │        │
│ └────────────────────────────────────┘        │
└───────────────────────────────────────────────┘
```

- A text input for entering process names.
- An "Add" button to append to the list.
- Each entry has a `×` button to remove it.
- The `.exe` extension is stripped on display (normalization is done by the C# `ActiveWindowMonitor.SetWhitelist()` method, → §4.4.3).
- Changes are persisted via `saveSettings()` → IPC `SAVE_SETTINGS` + Firestore write.

---

### 5.11. Account & Auth Module

The Account module provides Firebase Authentication integration for optional cloud sync.

**Source:** `AuthScreen` component in `Sentinel.UI/src/views.tsx`.

#### 5.11.1. Firebase Auth Integration (Email/Password, Google Sign-In)

**Source** (`Sentinel.UI/src/firebase.ts`):

```typescript
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
```

**Target:**

```typescript
// File: src/app/core/auth.service.ts

import { Injectable, signal } from '@angular/core';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  GoogleAuthProvider,
  type User,
} from 'firebase/auth';
import { firebaseApp } from './firebase.config';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = getAuth(firebaseApp);
  private googleProvider = new GoogleAuthProvider();

  readonly user = signal<User | null>(null);
  readonly user$ = new Observable<User | null>(subscriber => {
    return onAuthStateChanged(this.auth, user => subscriber.next(user));
  });

  constructor() {
    onAuthStateChanged(this.auth, user => this.user.set(user));
  }

  async signInWithEmail(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(this.auth, email, password);
  }

  async signUpWithEmail(email: string, password: string): Promise<void> {
    await createUserWithEmailAndPassword(this.auth, email, password);
  }

  async signInWithGoogle(): Promise<void> {
    try {
      await signInWithPopup(this.auth, this.googleProvider);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user' || code === 'auth/user-cancelled') {
        await signInWithRedirect(this.auth, this.googleProvider);
      } else {
        throw err;
      }
    }
  }

  async signOut(): Promise<void> {
    await signOut(this.auth);
  }

  get uid(): string | null {
    return this.user()?.uid ?? null;
  }

  get email(): string | null {
    return this.user()?.email ?? null;
  }
}
```

**Error mapping** (carried forward from source `App.tsx`):

| Firebase Error Code | User-Facing Message |
|---|---|
| `auth/user-not-found`, `auth/invalid-credential`, `auth/invalid-login-credentials` | "No account found with this email. Please sign up first." |
| `auth/wrong-password` | "Incorrect password. Please try again." |
| `auth/too-many-requests` | "Too many failed attempts. Please try again later." |
| `auth/invalid-email` | "Invalid email address." |
| `auth/email-already-in-use` | "An account with this email already exists. Please log in instead." |
| `auth/weak-password` | "Password is too weak. Use at least 6 characters." |
| *(default)* | `error.message` or "Login failed. Please try again." |

#### 5.11.2. Auth State Listener & User Context Provider

**Source** (`App.tsx` lines 164–172):

```typescript
useEffect(() => {
  const unsubscribe = onAuthStateChanged(auth, (user) => {
    setUser(user);
    if (!user) {
      setReportData(null);
      setExportStatus(null);
    }
  });
  return () => unsubscribe();
}, []);
```

**Target:** The `AuthService.user` signal is reactive. Components inject `AuthService` and read `authService.user()` or `authService.email` in templates.

When the user signs out (`user` becomes `null`):
1. Firestore snapshot listeners are detached.
2. Local cached data is cleared.
3. The app continues to function in local-only mode.

#### 5.11.3. Sign-In / Sign-Up / Sign-Out Screens

The `AccountComponent` renders two states:

**Signed out:**
- Email input field
- Password input field
- Login button (primary)
- Sign Up button (secondary)
- "or" divider
- "Continue with Google" button (styled with Google favicon)
- Error message area

**Signed in:**
- "Signed In As" card showing email
- Logout button (danger style)
- Contextual info cards: "Zero-friction local mode" and "Optional universal sync"

#### 5.11.4. Account Profile Display

When signed in, the user's email is displayed in:
1. The Account screen ("Signed In As: {email}")
2. The sidebar bottom area (truncated email)
3. The Settings screen's Account field ("Manage {username}")

No profile photo or display name is shown — Sentinel uses email-only identity.

---

### 5.12. Onboarding Flow

The onboarding flow is a one-time modal wizard shown on first launch.

**Source:** `OnboardingModal` component in `Sentinel.UI/src/views.tsx`, triggered by `localStorage.getItem('sentinel_onboarded') !== 'true'`.

#### 5.12.1. First-Launch Detection

**Source:**

```typescript
const [showOnboarding, setShowOnboarding] = useState(() => {
  return localStorage.getItem('sentinel_onboarded') !== 'true';
});
```

**Target:** The Angular app uses the same `localStorage` check in the `AppComponent`:

```typescript
readonly showOnboarding = signal(localStorage.getItem('sentinel_onboarded') !== 'true');
```

When running inside Photino's WebView, `localStorage` is persisted via the Chromium profile directory. This persists across app restarts.

#### 5.12.2. Onboarding Modal Wizard (Welcome, Preset Selection, Goal Setting)

**Source step definitions** (`App.tsx` lines 873–886):

```typescript
const onboardingSteps = [
  {
    title: 'Welcome to Sentinel',
    body: 'A privacy-first focus timer that gently nudges you back when you drift.',
  },
  {
    title: 'How It Works',
    body: 'Sentinel detects when you stop interacting with your PC and pauses to ask what distracted you.',
  },
  {
    title: 'Keyboard Shortcuts',
    body: 'Ctrl+Shift+S to start/pause. Ctrl+Shift+D to log a distraction. Space to toggle timer. Esc to go back.',
  },
  {
    title: 'Your Data Stays Local',
    body: 'Everything is stored on your machine. Cloud sync is opt-in via Settings.',
  },
];
```

**Target:** Carried forward verbatim as the step array.

**Modal UI:** Step indicator dots (circles, active = `#7c4dff`, inactive = `rgba(148, 142, 161, 0.32)`), "Skip intro" ghost button, "Back" secondary button (hidden on first step), "Next" / "Enter Sentinel" (last step) primary button.

#### 5.12.3. Initial Settings Persistence on Completion

**Source:**

```typescript
const completeOnboarding = () => {
  localStorage.setItem('sentinel_onboarded', 'true');
  setShowOnboarding(false);
};
```

**Target:** Same implementation. The onboarding does not currently persist any settings (no preset selection or goal setting happens during onboarding in the source). Future enhancement: the onboarding wizard could include a step for choosing a default preset and setting the daily focus goal.

---

### 5.13. Core Services Summary

| Service | File | Scope | Responsibility |
|---|---|---|---|
| `BridgeService` | `src/app/core/bridge.service.ts` | `providedIn: 'root'` | IPC send/receive with C# shell (→ §3) |
| `TimerService` | `src/app/core/timer.service.ts` | `providedIn: 'root'` | Drift-free timer engine, session lifecycle |
| `SettingsService` | `src/app/core/settings.service.ts` | `providedIn: 'root'` | Load/save settings via IPC + Firestore |
| `AuthService` | `src/app/core/auth.service.ts` | `providedIn: 'root'` | Firebase Auth state management |
| `InterventionService` | `src/app/core/intervention.service.ts` | `providedIn: 'root'` | Intervention modal visibility and state |
| `TaxonomyService` | `src/app/core/taxonomy.service.ts` | `providedIn: 'root'` | Firestore taxonomy CRUD + quick suggestions |
| `EventLedgerService` | `src/app/core/event-ledger.service.ts` | `providedIn: 'root'` | Append-only writes to `session_events` |
| `ReportService` | `src/app/core/report.service.ts` | `providedIn: 'root'` | Firestore aggregate queries for reports |
| `PlannerService` | `src/app/core/planner.service.ts` | `providedIn: 'root'` | Firestore CRUD for planner blocks |

### 5.14. Keyboard Shortcuts

**Source shortcuts** (displayed in settings, handled in `App.tsx` keydown listener and C# `WndProc` hotkeys):

| Shortcut | Source Handler | Target Handler | Behavior |
|---|---|---|---|
| `Ctrl+Shift+S` | C# `WndProc` sends `HOTKEY_START_PAUSE` IPC | Same — C# sends IPC, Angular calls `timerService.toggleStartPause()` | Start or pause the timer |
| `Ctrl+Shift+D` | C# `WndProc` sends `HOTKEY_DISTRACTION` IPC | Same — Angular triggers intervention flow | Log a distraction immediately |
| `Space` | Angular `keydown` listener on `view === 'timer'` | Same — `timerService.toggleStartPause()` | Toggle the active timer |
| `Escape` | Angular `keydown` listener | Same | Go back or dismiss current surface |
| `Enter` | Angular `keydown` listener on resume prompt | Same — resumes timer after sleep | Confirm resume |

### 5.15. IPC Message Handling — Angular `BridgeService` Inbound Dispatch

Complete dispatch table for messages received from the C# shell, with the Angular handler for each:

| IPC Message | Angular Handler |
|---|---|
| `SETTINGS_LOADED` | `settingsService.applySettings(payload.settings)` |
| `IDLE_DETECTED` | `if (timerService.isRunning()) { timerService.pauseForIntervention(); interventionService.show(); }` |
| `USER_ACTIVE` | No-op (reserved for future UX hint) |
| `SNOOZE_STATUS` | `timerService.updateSnoozeState(payload.isSnoozed, payload.secondsRemaining)` |
| `HOTKEY_START_PAUSE` | `timerService.toggleStartPause()` |
| `HOTKEY_DISTRACTION` | Same as `IDLE_DETECTED` |
| `SYSTEM_SUSPEND` | `if (timerService.isRunning()) { timerService.pauseTimer(); showResumePrompt = true; }` |
| `SYSTEM_RESUME` | `if (wasPausedBySuspend) { showResumePrompt = true; }` |
| `UPDATE_AVAILABLE` | `settingsService.updateInfo.set(payload)` |
| `COMPACT_MODE_CHANGED` | `appComponent.isCompactMode.set(payload.isCompact)` |

**Dropped inbound handlers** (these exist in the source but are removed because Angular no longer receives data from C#):

| Source IPC Message | Reason Dropped |
|---|---|
| `REPORT_DATA` | Angular reads reports from Firestore directly |
| `TAXONOMY_DATA` | Angular reads taxonomy from Firestore directly |
| `SESSION_LIST` | Angular reads session history from Firestore directly |
| `EXPORT_COMPLETE` | Export feature is handled by Angular (CSV/JSON from Firestore data) |
| `SEED_COMPLETE` | Database seeding is removed (no SQLite) |

### 5.16. Cross-Reference Table

| Section | Source File | Target File/Module | Status |
|---|---|---|---|
| §5.1 | `Sentinel.UI/package.json`, `vite.config.ts`, `tsconfig.json` | `angular.json`, `tsconfig.json` | REWRITTEN |
| §5.2 | `Sentinel.UI/src/ui.tsx`, `ui-utils.ts` | `src/app/shared/` components | REWRITTEN |
| §5.3 | `App.tsx` (view state + conditional rendering) | `src/app/app.routes.ts` | REWRITTEN |
| §5.4 | `App.tsx` (timer hooks + refs) | `src/app/core/timer.service.ts`, `src/app/features/timer/` | REWRITTEN |
| §5.5 | `App.tsx` (intervention handlers), `views.tsx` (InterventionModal), `taxonomy.ts` | `src/app/features/intervention/`, `src/app/core/taxonomy.utils.ts` | REWRITTEN + PORTED |
| §5.6 | *(no source)* | `src/app/features/planner/` | NEW |
| §5.7 | `App.tsx` (report handlers), `views.tsx` (ReportsScreen) | `src/app/features/reports/` | REWRITTEN |
| §5.8 | `views.tsx` (SessionHistoryScreen) | `src/app/features/history/` | REWRITTEN |
| §5.9 | `views.tsx` (TaxonomyManagerScreen) | `src/app/features/taxonomy/` | REWRITTEN |
| §5.10 | `views.tsx` (SettingsScreen) | `src/app/features/settings/` | REWRITTEN + NEW (§5.10.10) |
| §5.11 | `App.tsx` (auth handlers), `views.tsx` (AuthScreen), `firebase.ts` | `src/app/features/account/`, `src/app/core/auth.service.ts` | REWRITTEN |
| §5.12 | `views.tsx` (OnboardingModal), `App.tsx` (onboarding state) | `src/app/features/onboarding/` | REWRITTEN |
| §5.13 | `App.tsx` (all business logic) | `src/app/core/` services | REWRITTEN |
| §5.14 | `App.tsx` (keydown listener), `MainWindow.xaml.cs` (WndProc) | `src/app/core/keyboard.service.ts` + C# shell | PORTED |
| §5.15 | `App.tsx` (`handleMessage` switch) | `src/app/core/bridge.service.ts` | REWRITTEN |

## 6. Data Models & Schema

This section specifies every data model, entity, DTO, and Firestore document schema used by the Sentinel application. It maps the source SQLite entities to their target Firestore equivalents, defines the exact shape of every Event Ledger event type, and documents the server-computed aggregate documents written by Cloud Functions (→ §8).

**Migration principle:** The source architecture stores all persistent data in two places: (1) SQLite database at `%LOCALAPPDATA%\Sentinel\sentinel.db` (sessions, distractions), and (2) JSON file at `%LOCALAPPDATA%\Sentinel\settings.json` (app settings). The target architecture eliminates SQLite entirely. All persistent data is stored in Firestore under a user-scoped document hierarchy (`users/{uid}/...`). The C# shell retains only `settings.json` for local-first settings access (the shell needs settings before Angular boots and before Firebase Auth completes).

**Data flow overview:**

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        SOURCE ARCHITECTURE                              │
│                                                                         │
│  settings.json ──── SettingsService.Load() ──── C# AppSettings          │
│  sentinel.db   ──── SentinelDbContext     ──── Distraction, Session     │
│  Firestore     ──── flat collections      ──── sessions, distractions   │
│                     (optional, cloud sync)                              │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                        TARGET ARCHITECTURE                              │
│                                                                         │
│  settings.json ──── SettingsService.Load() ──── C# AppSettings          │
│                     (C# shell only, local-first fallback)               │
│                                                                         │
│  Firestore:                                                             │
│    users/{uid}/settings           ──── Standard Persistence             │
│    users/{uid}/planner_blocks/    ──── Standard Persistence (NEW)       │
│    users/{uid}/taxonomy/          ──── Standard Persistence             │
│    users/{uid}/session_events/    ──── Secure Event Ledger (append-only)│
│    users/{uid}/stats/daily/       ──── Server-Computed Aggregates       │
│    users/{uid}/stats/streaks      ──── Server-Computed Aggregates       │
│    users/{uid}/achievements/      ──── Server-Computed Aggregates       │
└──────────────────────────────────────────────────────────────────────────┘
```

---

### 6.1. Local Models (Carried from Existing Codebase)

This subsection documents every data model defined in the source C# and TypeScript codebases. These models define the shape of data as it existed in SQLite and React state. Understanding them is essential for constructing the Firestore migration and for ensuring the target Angular interfaces are backwards-compatible with the source data semantics.

#### 6.1.1. `Distraction` Entity

**Source file:** `Sentinel.Engine\Models.cs`, lines 12–20.

**Source C# class:**

```csharp
public class Distraction
{
    public int Id { get; set; }
    public string Note { get; set; } = string.Empty;
    public string NormalizedNote { get; set; } = string.Empty;
    public string? CategoryName { get; set; }
    public DateTime Timestamp { get; set; }
    public bool IsFalseAlarm { get; set; }
}
```

**SQLite table schema** (generated by EF Core `EnsureCreated`):

```sql
CREATE TABLE "Distractions" (
    "Id"             INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "Note"           TEXT NOT NULL,
    "NormalizedNote"  TEXT NOT NULL,
    "CategoryName"   TEXT,
    "Timestamp"      TEXT NOT NULL,
    "IsFalseAlarm"   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX "IX_Distractions_NormalizedNote" ON "Distractions" ("NormalizedNote");
CREATE INDEX "IX_Distractions_Timestamp"     ON "Distractions" ("Timestamp");
CREATE INDEX "IX_Distractions_CategoryName"  ON "Distractions" ("CategoryName");
```

**EF Core configuration** (`SentinelDbContext.OnModelCreating`):

```csharp
modelBuilder.Entity<Distraction>(entity =>
{
    entity.HasIndex(d => d.NormalizedNote);
    entity.HasIndex(d => d.Timestamp);
    entity.HasIndex(d => d.CategoryName);
});
```

**Field-by-field specification:**

##### 6.1.1.1. `Id` (int, PK, Auto-Increment)

- **Type:** `int`
- **Constraint:** Primary key, auto-incrementing via SQLite `AUTOINCREMENT`.
- **Target equivalent:** Replaced by Firestore auto-generated document ID (`string`). The numeric ID has no semantic meaning and is not carried to the target.

##### 6.1.1.2. `Note` (string, Original User Input)

- **Type:** `string`, non-nullable, default `string.Empty`.
- **Semantics:** The raw distraction note as entered by the user (e.g., `"Twitter"`, `"checking Slack"`). Trimmed on write by `DistractionRepository.AddDistractionAsync()`: `distraction.Note = distraction.Note.Trim()`.
- **Target equivalent:** `payload.note` field inside `DistractionLogged` Event Ledger events (→ §6.2.2.3). Also stored in the taxonomy document's `noteMappings` for quick-suggestion display.

##### 6.1.1.3. `NormalizedNote` (string, Lowercased/Trimmed)

- **Type:** `string`, non-nullable, default `string.Empty`.
- **Semantics:** Lowercase, whitespace-trimmed version of `Note` for case-insensitive grouping. Computed by `DistractionNormalizer.Normalize()`:

```csharp
public static string Normalize(string? note)
{
    return (note ?? string.Empty).Trim().ToLowerInvariant();
}
```

The TypeScript equivalent (`normalizeDistractionNote()` in `Sentinel.UI/src/taxonomy.ts`):

```typescript
export function normalizeDistractionNote(note: string): string {
  return note.trim().toLowerCase();
}
```

- **Target equivalent:** `payload.normalizedNote` field inside `DistractionLogged` events. Also used as the key for taxonomy note-to-category mappings.

##### 6.1.1.4. `CategoryName` (string, Nullable, Taxonomy Group)

- **Type:** `string?`, nullable.
- **Semantics:** The category this distraction was assigned to. `null` means uncategorized. Trimmed on write by `DistractionRepository.CleanCategory()`:

```csharp
private static string? CleanCategory(string? categoryName)
{
    var trimmed = categoryName?.Trim();
    return string.IsNullOrWhiteSpace(trimmed) ? null : trimmed;
}
```

- **Auto-categorization (source):** If the user doesn't explicitly set a category, `AddDistractionAsync` queries previous distractions with the same `NormalizedNote` and uses the most recent non-null `CategoryName`. In the target, this logic moves to the Angular `TaxonomyService`, which looks up the Firestore taxonomy document for the matching `normalizedNote`.

##### 6.1.1.5. `Timestamp` (DateTime, UTC)

- **Type:** `DateTime`, stored as ISO 8601 text in SQLite.
- **Semantics:** The moment the distraction was logged. Set by the C# shell when it receives the `LOG_DISTRACTION` IPC message.
- **Target equivalent:** The `timestamp` field on the Event Ledger event envelope (→ §6.2.2.4). Set by Angular at the moment the user clicks "Log it" in the intervention modal.

##### 6.1.1.6. `IsFalseAlarm` (bool, Default false)

- **Type:** `bool`, default `false`.
- **Semantics:** `true` if the user clicked "False Alarm" in the intervention modal. False alarms are excluded from grouping, category inference, and distraction counts. They are included in the "Intervention Accuracy" metric (`accuracy% = (total - falseAlarms) / total * 100`).
- **Target equivalent:** False alarms are logged as a separate event type `FalseAlarmMarked` (→ §6.2.2.3) rather than a boolean flag on a distraction record. This is a schema denormalization — the Event Ledger pattern uses distinct event types rather than stateful fields.

#### 6.1.2. `Session` Entity

**Source file:** `Sentinel.Engine\Models.cs`, lines 22–30.

**Source C# class:**

```csharp
public class Session
{
    public int Id { get; set; }
    public int DurationSeconds { get; set; }
    public DateTime StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? SessionName { get; set; }
    public bool EndedEarly { get; set; }
}
```

**SQLite table schema:**

```sql
CREATE TABLE "Sessions" (
    "Id"              INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "DurationSeconds" INTEGER NOT NULL,
    "StartedAt"       TEXT NOT NULL,
    "CompletedAt"     TEXT,
    "SessionName"     TEXT,
    "EndedEarly"      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX "IX_Sessions_StartedAt" ON "Sessions" ("StartedAt");
```

**Field-by-field specification:**

##### 6.1.2.1. `Id` (int, PK, Auto-Increment)

- **Type:** `int`
- **Target equivalent:** Replaced by `sessionId` — a UUID (`crypto.randomUUID()`) generated by Angular at timer start. This ID correlates all Event Ledger events for the same session.

##### 6.1.2.2. `DurationSeconds` (int)

- **Type:** `int`
- **Semantics:** The focused work duration in seconds. For completed sessions: `settings.pomodoroMinutes * 60`. For early-ended sessions: `totalDuration - timeLeft` at the moment the user clicked "End Session."
- **Target equivalent:** `payload.durationSeconds` in `TimerCompleted` and `TimerEndedEarly` events.

##### 6.1.2.3. `StartedAt` (DateTime, UTC)

- **Type:** `DateTime`, stored as ISO 8601 text.
- **Semantics:** The wall-clock timestamp when the user clicked "Start Focus." The source calculates this retroactively: `sessionStartedAtRef.current = now - alreadyElapsed * 1000` to account for pauses. The `StartedAt` represents the absolute start of the session, not the most recent resume.
- **Target equivalent:** `payload.startedAt` on `TimerCompleted` / `TimerEndedEarly` events, and the `timestamp` field on the `TimerStarted` event.

##### 6.1.2.4. `CompletedAt` (DateTime, UTC)

- **Type:** `DateTime?`, nullable.
- **Semantics:** `null` for sessions that were abandoned (timer reset without completing). Set to `DateTime.UtcNow` when the session completes or ends early. In practice, the source always sets this because `LOG_SESSION` IPC is only sent on timer completion or early end — abandoned sessions are not logged.
- **Target equivalent:** `payload.completedAt` on `TimerCompleted` / `TimerEndedEarly` events.

##### 6.1.2.5. `SessionName` (string, Nullable)

- **Type:** `string?`, nullable.
- **Semantics:** User-defined label for the session (e.g., "Writing report", "Code review"). May be `null` or empty if the user didn't name the session.
- **Target equivalent:** `payload.sessionName` on `TimerStarted`, `TimerCompleted`, and `TimerEndedEarly` events.

##### 6.1.2.6. `EndedEarly` (bool, Default false)

- **Type:** `bool`, default `false`.
- **Semantics:** `true` if the user clicked "End Session" before the timer reached zero. The `DurationSeconds` field records the actual elapsed time, not the full configured duration.
- **Target equivalent:** Represented by the event type distinction: `TimerCompleted` (endedEarly = false) vs. `TimerEndedEarly` (endedEarly = true). Additionally, `payload.endedEarly` is included as a boolean for explicit clarity.

#### 6.1.3. `AppSettings` Model

**Source files:**
- C# class: `Sentinel.Engine\SettingsService.cs`, lines 7–24 (`AppSettings`), lines 26–32 (`CustomPreset`).
- TypeScript interface: `Sentinel.UI\src\utils.ts`, lines 20–32 (`Settings`).

**Source C# class:**

```csharp
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
```

**Source TypeScript interface:**

```typescript
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
```

**Storage:** `%LOCALAPPDATA%\Sentinel\settings.json`, serialized with `System.Text.Json` using `WriteIndented = true`. PascalCase property names in JSON (no `JsonNamingPolicy` configured in source).

**Target C# class** (carried forward with additions):

```csharp
// File: Sentinel.Shell\Models\AppSettings.cs

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
    public List<CustomPreset> CustomPresets { get; set; } = [];

    // NEW — Target Architecture
    public List<string> ActiveWindowWhitelist { get; set; } = [];
}
```

**Target TypeScript interface:**

```typescript
// File: src/app/core/models.ts

export type OverlayStyle = 'pill' | 'compact' | 'monitoring';

export interface TimerPreset {
  name: string;
  focus: number;     // minutes
  shortBreak: number; // minutes
  longBreak: number;  // minutes
}

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

  // NEW — Target Architecture
  activeWindowWhitelist: string[];
}

export const defaultSettings: Settings = {
  pomodoroMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  idleThresholdSeconds: 45,
  cloudSyncEnabled: false,
  soundEnabled: true,
  alwaysOnTop: false,
  suppressDuringMedia: true,
  dailyFocusGoalMinutes: 120,
  overlayStyle: 'compact',
  customPresets: [],
  activeWindowWhitelist: [],
};
```

**Field-by-field specification:**

##### 6.1.3.1. `PomodoroMinutes` / `ShortBreakMinutes` / `LongBreakMinutes` (int, Minutes)

| Field | C# Type | TS Type | Default | Validation |
|---|---|---|---|---|
| `PomodoroMinutes` | `int` | `number` | `25` | `[1, 120]` |
| `ShortBreakMinutes` | `int` | `number` | `5` | `[1, 30]` |
| `LongBreakMinutes` | `int` | `number` | `15` | `[1, 60]` |

These values define the countdown duration in minutes for each timer mode. Angular converts to seconds via `getTimerDuration(mode, settings)`:

```typescript
export function getTimerDuration(mode: TimerMode, settings: Settings): number {
  switch (mode) {
    case 'pomodoro': return settings.pomodoroMinutes * 60;
    case 'shortBreak': return settings.shortBreakMinutes * 60;
    case 'longBreak': return settings.longBreakMinutes * 60;
  }
}
```

##### 6.1.3.2. `IdleThresholdSeconds` (int, Seconds)

- **C# type:** `int`, default `45`.
- **Semantics:** Number of seconds of keyboard/mouse inactivity before the C# shell fires `IDLE_DETECTED`. Mapped to `UserActivityMonitor.IdleThresholdSeconds` (→ §4.1.3).
- **Validation:** `[5, 3600]` (5 seconds min, 1 hour max). The source settings UI uses `[10, 300]` with step `5`; the target widens the API-level range.

##### 6.1.3.3. `CloudSyncEnabled` (bool)

- **Default:** `false`.
- **Semantics:** When `true` AND the user is authenticated, Angular writes data to Firestore and reads from Firestore snapshot listeners. When `false`, Angular operates in local-only mode (data persists only in Firestore's IndexedDB cache, which is ephemeral).

##### 6.1.3.4. `AlwaysOnTop` (bool)

- **Default:** `false`.
- **Semantics:** When `true`, the C# shell calls `_window.SetTopMost(true)` to pin the Sentinel window above all other windows. The source achieved this via WPF `Window.Topmost = true`.

##### 6.1.3.5. `SuppressDuringMedia` (bool)

- **Default:** `true`.
- **Semantics:** Controls the media-aware suppression in `UserActivityMonitor` (→ §4.3.3). When `true` and system audio is playing above the `0.001f` peak threshold, idle detection is suppressed.

##### 6.1.3.6. `DailyFocusGoalMinutes` (int)

- **Default:** `120` (2 hours).
- **Semantics:** The user's target daily focus time. Used by `calculateGoalProgress()` (→ §5.4.4.4). `0` disables the goal progress indicator.
- **Validation:** `[0, 1440]`.

##### 6.1.3.7. `OverlayStyle` (string)

- **Default:** `"compact"`.
- **Valid values:** `"pill"`, `"compact"`, `"monitoring"`.
- **Semantics:** Controls the compact-mode overlay appearance (→ §5.2.6).

##### 6.1.3.8. `CustomPresets` (List of Preset Objects)

- **C# type:** `List<CustomPreset>`, default empty.
- **TS type:** `TimerPreset[]`.
- **Element shape:**

```typescript
interface TimerPreset {
  name: string;       // User-defined label, e.g., "My Flow"
  focus: number;      // Pomodoro duration in minutes
  shortBreak: number; // Short break duration in minutes
  longBreak: number;  // Long break duration in minutes
}
```

- **Serialized example:**

```json
{
  "CustomPresets": [
    { "Name": "My Flow", "Focus": 40, "ShortBreak": 8, "LongBreak": 20 }
  ]
}
```

##### 6.1.3.9. `ActiveWindowWhitelist` (List of string, New — Target Architecture)

- **C# type:** `List<string>`, default empty.
- **TS type:** `string[]`.
- **Semantics:** Process names that suppress idle detection when focused (→ §4.4). The `.exe` extension is stripped during normalization. Matching is case-insensitive.
- **Serialized example:**

```json
{
  "ActiveWindowWhitelist": ["code", "devenv", "chrome"]
}
```

**Removed source fields (not carried to target):**

| Source Field | Reason Removed |
|---|---|
| `DataRetentionMonths` | No local database to prune. Firestore data is retained indefinitely (or managed via Cloud Function TTL policies). |
| `WindowLeft` / `WindowTop` | Window position is managed by Photino's built-in window state persistence. The C# shell does not need to track these explicitly. |

#### 6.1.4. `ReportData` Aggregate DTO

**Source files:**
- C# class: `Sentinel.Engine\ReportingService.cs`, lines 7–19 (`ReportData`), lines 21–27 (`DailyFocus`), lines 29–33 (`ReportBreakdownItem`), lines 35–46 (`SessionEntry`).
- TypeScript interface: `Sentinel.UI\src\app-types.ts`, full file.

**Source C# class:**

```csharp
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

**Source TypeScript interfaces:**

```typescript
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
```

##### 6.1.4.1. Total Focus Time, Session Count, Distraction Count

| Field | C# Type | TS Type | Computation (Source) |
|---|---|---|---|
| `TotalFocusSeconds` | `int` | `number` | `completedSessions.Sum(s => s.DurationSeconds)` |
| `SessionsCompleted` | `int` | `number` | `completedSessions.Count` (sessions with `CompletedAt != null`) |
| `DistractionsLogged` | `int` | `number` | Count of non-false-alarm distractions with non-empty `NormalizedNote` |
| `FalseAlarms` | `int` | `number` | `distractions.Count(d => d.IsFalseAlarm)` |
| `AvgSessionSeconds` | `double` | `number` | `completedSessions.Average(s => s.DurationSeconds)` or `0` if no sessions |

**Target computation:** These aggregates are read from Firestore `users/{uid}/stats/daily/{date}` documents (→ §6.2.3.1) and summed across the selected date range by the Angular `ReportService`. If aggregate documents don't exist yet, Angular falls back to client-side aggregation from cached Event Ledger entries.

##### 6.1.4.2. Distraction Breakdown by Category

**Source computation** (`ReportingService.GetReportDataAsync()`):

```csharp
report.TopCategories = actualDistractions
    .GroupBy(d => string.IsNullOrWhiteSpace(d.CategoryName)
        ? "Uncategorized"
        : d.CategoryName!.Trim())
    .Select(group => new ReportBreakdownItem
    {
        Name = group.Key,
        Count = group.Count()
    })
    .OrderByDescending(item => item.Count)
    .ThenBy(item => item.Name)
    .Take(6)
    .ToList();
```

**Target computation:** Angular queries `DistractionLogged` events within the selected date range, groups by `payload.categoryName` (using `"Uncategorized"` for null), and sorts by count descending. Top 6 are displayed.

##### 6.1.4.3. Daily History Array (Date, FocusMinutes, DistractionCount)

**Source computation:** The source generates exactly 7 days of data (today minus 6 days to today), bucketed by local calendar days:

```csharp
var startDate = DateTime.Today.AddDays(-6);
for (var i = 0; i < 7; i++)
{
    var localDay = startDate.AddDays(i);
    // ...
    report.DailyFocus.Add(new DailyFocus
    {
        Date = localDay.ToString("MM/dd"),
        FocusSeconds = daySessions.Sum(s => s.DurationSeconds),
        Sessions = daySessions.Count,
        Distractions = dayDistractions
    });
}
```

**Target computation:** Angular reads `users/{uid}/stats/daily/{YYYY-MM-DD}` documents for the selected range. Each document contains pre-computed daily totals (→ §6.2.3.1). The date range is dynamic based on the `ReportRange` selector (today, week, month, all) rather than hardcoded to 7 days.

#### 6.1.5. Taxonomy Models (Source DTOs)

**Source file:** `Sentinel.Engine\Models.cs`, lines 32–62.

These DTOs are returned by `DistractionRepository.GetTaxonomyDataAsync()` and sent to the React frontend via the `TAXONOMY_DATA` IPC message.

**Source C# classes:**

```csharp
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
```

**Source TypeScript interfaces:**

```typescript
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

**Target TypeScript interfaces:**

```typescript
// File: src/app/core/models.ts

export interface DistractionEntry {
  id: string;           // Changed: Firestore doc ID (string) replaces SQLite auto-increment (int)
  note: string;
  normalizedNote: string;
  categoryName: string | null;
  timestamp: string;    // ISO 8601
}

export interface DistractionGroup {
  note: string;
  normalizedNote: string;
  categoryName: string | null;
  count: number;
  lastSeenAt: string;   // ISO 8601
}

export interface TaxonomyData {
  recentEntries: DistractionEntry[];
  groups: DistractionGroup[];
  categories: string[];
}
```

**Data source change:** In the source, `GetTaxonomyDataAsync()` runs a SQLite query that:
1. Fetches all non-false-alarm distractions ordered by timestamp descending.
2. Takes the 30 most recent for `RecentEntries`.
3. Groups by `NormalizedNote` to build `Groups`, extracting the most recent `Note`, `CategoryName`, and `Timestamp` per group, plus the count.
4. Extracts distinct non-null category names for `Categories`.

In the target, this data is derived from:
- **`RecentEntries`:** Last 30 `DistractionLogged` events from `users/{uid}/session_events`, ordered by `timestamp` descending.
- **`Groups`:** Computed from Firestore taxonomy documents at `users/{uid}/taxonomy/{normalizedNote}` (→ §6.2.1.3).
- **`Categories`:** Distinct `categoryName` values extracted from taxonomy documents.

#### 6.1.6. `DistractionNormalizer` Utility

**Source file:** `Sentinel.Engine\Models.cs`, lines 3–9.

```csharp
public static class DistractionNormalizer
{
    public static string Normalize(string? note)
    {
        return (note ?? string.Empty).Trim().ToLowerInvariant();
    }
}
```

**Target:** This logic is duplicated in Angular's `normalizeDistractionNote()` (→ §5.5.4.1). The C# shell no longer needs this normalizer because it no longer writes distraction records.

---

### 6.2. Firestore Document Schemas (Target Architecture)

This subsection defines the exact Firestore document structure for every collection and subcollection in the target architecture. The Firestore hierarchy is user-scoped: all data lives under `users/{uid}/`.

**Top-level Firestore structure:**

```
users/
  {uid}/
    settings                           ← Standard Persistence (single document)
    planner_blocks/
      {blockId}                        ← Standard Persistence
    taxonomy/
      {normalizedNote}                 ← Standard Persistence
    session_events/
      {eventId}                        ← Secure Event Ledger (append-only)
    stats/
      daily/
        {YYYY-MM-DD}                   ← Server-Computed Aggregate
      streaks                          ← Server-Computed Aggregate (single document)
    achievements/
      {achievementId}                  ← Server-Computed Aggregate
```

#### 6.2.1. Standard Persistence Documents

Standard Persistence documents use Firestore's native offline persistence (`enableIndexedDbPersistence`). Angular writes directly to these documents using `setDoc`, `updateDoc`, `deleteDoc`. Firestore automatically syncs to the cloud when the network is available. Conflict resolution is Last-Write-Wins (Firestore default for single-document writes).

##### 6.2.1.1. `users/{uid}/settings` — AppSettings Mirror

**Firestore path:** `users/{uid}/settings` (single document, NOT a subcollection).

This document mirrors the `AppSettings` model. Angular writes to this document whenever the user changes settings AND `cloudSyncEnabled` is `true`. The C# shell also maintains a local `settings.json` file for the same data (→ §6.1.3). The C# `settings.json` is the source of truth on app startup; Firestore is the source of truth for cross-device sync.

**Document schema:**

```json
{
  "pomodoroMinutes": 25,
  "shortBreakMinutes": 5,
  "longBreakMinutes": 15,
  "idleThresholdSeconds": 45,
  "cloudSyncEnabled": true,
  "soundEnabled": true,
  "alwaysOnTop": false,
  "suppressDuringMedia": true,
  "dailyFocusGoalMinutes": 120,
  "overlayStyle": "compact",
  "customPresets": [
    {
      "name": "My Flow",
      "focus": 40,
      "shortBreak": 8,
      "longBreak": 20
    }
  ],
  "activeWindowWhitelist": ["code", "devenv"],
  "updatedAt": "2026-04-03T10:30:00.000Z"
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `pomodoroMinutes` | `number` | `25` | Focus session duration in minutes. |
| `shortBreakMinutes` | `number` | `5` | Short break duration in minutes. |
| `longBreakMinutes` | `number` | `15` | Long break duration in minutes. |
| `idleThresholdSeconds` | `number` | `45` | Idle detection threshold in seconds. |
| `cloudSyncEnabled` | `boolean` | `false` | Whether cloud sync is active. |
| `soundEnabled` | `boolean` | `true` | Whether sound notifications are enabled. |
| `alwaysOnTop` | `boolean` | `false` | Whether the window stays above all others. |
| `suppressDuringMedia` | `boolean` | `true` | Whether idle detection is suppressed during audio playback. |
| `dailyFocusGoalMinutes` | `number` | `120` | Daily focus target in minutes. |
| `overlayStyle` | `string` | `"compact"` | Compact mode overlay style (`"pill"`, `"compact"`, `"monitoring"`). |
| `customPresets` | `array` | `[]` | User-defined timer presets. Each element: `{ name: string, focus: number, shortBreak: number, longBreak: number }`. |
| `activeWindowWhitelist` | `array` | `[]` | Process names that suppress idle detection. |
| `updatedAt` | `string` | — | ISO 8601 timestamp of last update. Set by Angular on write. |

**Excluded fields:** `WindowLeft`, `WindowTop`, and `DataRetentionMonths` are NOT synced to Firestore. They are local-only concerns persisted in `settings.json`.

**Firestore security rule:**

```
match /users/{uid}/settings {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

##### 6.2.1.2. `users/{uid}/planner_blocks/{blockId}` — Scheduled Focus Blocks

**Firestore path:** `users/{uid}/planner_blocks/{blockId}` (subcollection, auto-generated document IDs).

**This is a NEW collection — no source equivalent exists.** It stores planned focus blocks for the Teams-style Planner module (→ §5.6).

**Document schema:**

```json
{
  "label": "Deep Work",
  "color": "#7c4dff",
  "startTime": "2026-04-03T09:00:00.000Z",
  "endTime": "2026-04-03T10:30:00.000Z",
  "durationMinutes": 90,
  "repeat": {
    "frequency": "weekdays",
    "customDays": null,
    "until": null
  },
  "createdAt": "2026-04-01T12:00:00.000Z",
  "updatedAt": "2026-04-01T12:00:00.000Z"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `label` | `string` | Yes | User-defined block label (e.g., "Deep Work", "Writing"). |
| `color` | `string` | Yes | Hex color from a curated palette (e.g., `"#7c4dff"`). |
| `startTime` | `string` | Yes | ISO 8601 datetime of block start. |
| `endTime` | `string` | Yes | ISO 8601 datetime of block end. |
| `durationMinutes` | `number` | Yes | Cached duration computed from `endTime - startTime`. |
| `repeat` | `object \| null` | Yes | Recurrence rule. `null` for one-time blocks. |
| `repeat.frequency` | `string` | If `repeat` non-null | `"daily"`, `"weekdays"`, or `"custom"`. |
| `repeat.customDays` | `number[] \| null` | If `frequency === "custom"` | Day-of-week indices (0=Sun, 1=Mon, ..., 6=Sat). |
| `repeat.until` | `string \| null` | No | ISO 8601 date for recurrence end. `null` = indefinite. |
| `createdAt` | `string` | Yes | ISO 8601 timestamp of document creation. |
| `updatedAt` | `string` | Yes | ISO 8601 timestamp of last update. |

**Operations:**

| Operation | Firestore Method | When |
|---|---|---|
| Create block | `addDoc(collection(db, 'users/{uid}/planner_blocks'), block)` | User drags on calendar |
| Update block | `updateDoc(doc(db, 'users/{uid}/planner_blocks/{blockId}'), changes)` | User resizes, moves, or edits |
| Delete block | `deleteDoc(doc(db, 'users/{uid}/planner_blocks/{blockId}'))` | User deletes a block |
| List blocks | `query(collection, where('startTime', '>=', rangeStart), where('startTime', '<=', rangeEnd))` | Calendar view loads |

**Firestore security rule:**

```
match /users/{uid}/planner_blocks/{blockId} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

##### 6.2.1.3. `users/{uid}/taxonomy/{normalizedNote}` — Category Definitions & Note Mappings

**Firestore path:** `users/{uid}/taxonomy/{normalizedNote}` (subcollection, document IDs are the normalized distraction note strings).

**This replaces the source's implicit taxonomy stored in the SQLite `Distractions` table.** In the source, taxonomy data was derived dynamically by grouping all distractions by `NormalizedNote`. In the target, each unique distraction note has its own Firestore document that stores the current category assignment and metadata.

**Document schema:**

```json
{
  "note": "Twitter",
  "normalizedNote": "twitter",
  "categoryName": "Social Media",
  "count": 14,
  "lastSeenAt": "2026-04-03T09:15:00.000Z",
  "createdAt": "2026-03-01T08:00:00.000Z",
  "updatedAt": "2026-04-03T09:15:00.000Z"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `note` | `string` | Yes | The most-recent raw distraction note (preserves casing). Updated on each new occurrence. |
| `normalizedNote` | `string` | Yes | Lowercase/trimmed version. Also used as the document ID. |
| `categoryName` | `string \| null` | Yes | The currently assigned category. `null` = uncategorized. |
| `count` | `number` | Yes | Total number of times this distraction has been logged. Incremented on each `DistractionLogged` event. |
| `lastSeenAt` | `string` | Yes | ISO 8601 timestamp of the most recent occurrence. |
| `createdAt` | `string` | Yes | ISO 8601 timestamp of the first occurrence. |
| `updatedAt` | `string` | Yes | ISO 8601 timestamp of the last metadata update (category change, note remap, etc.). |

**Write operations:**

| Operation | Source Equivalent | Firestore Implementation |
|---|---|---|
| Log distraction | `DistractionRepository.AddDistractionAsync()` | `setDoc(doc, data, { merge: true })` — upsert: increment `count`, update `lastSeenAt` and `note` |
| Change category | `DistractionRepository.UpdateDistractionGroupAsync()` | `updateDoc(doc, { categoryName: newName, updatedAt: now })` |
| Rename category | `DistractionRepository.RenameCategoryAsync()` | Batch update: query all docs with old `categoryName`, update each to new name |
| Delete category | `DistractionRepository.DeleteCategoryAsync()` | Batch update: query all docs with target `categoryName`, set `categoryName: null` |

**Angular `TaxonomyService` upsert on distraction log:**

```typescript
// File: src/app/core/taxonomy.service.ts

async upsertMapping(
  normalizedNote: string,
  note: string,
  categoryName: string | null,
): Promise<void> {
  const uid = this.authService.uid;
  if (!uid) return;

  const docRef = doc(this.db, `users/${uid}/taxonomy/${normalizedNote}`);
  const now = new Date().toISOString();

  await setDoc(docRef, {
    note,
    normalizedNote,
    categoryName,
    count: increment(1),
    lastSeenAt: now,
    updatedAt: now,
  }, { merge: true });

  // Set createdAt only on first write (merge won't overwrite existing)
  // Use a conditional: if doc doesn't exist, createdAt is set; if it does, merge skips it
}
```

**Note on auto-categorization:** In the source, when a distraction is logged without a category, `AddDistractionAsync` queries previous distractions with the same `NormalizedNote` and inherits the most recent `CategoryName`. In the target, Angular reads the taxonomy document for the `normalizedNote` before displaying the category selector — if `categoryName` is non-null, it's pre-selected as the "Suggested" option. This is already implemented in the intervention modal's `getMappedCategoryForNote()` (→ §5.5.4.2).

**Deriving `TaxonomyData` from Firestore:**

The Angular `TaxonomyService` constructs the `TaxonomyData` interface from Firestore:

- **`groups`:** Direct read of all documents in `users/{uid}/taxonomy/`, mapped to `DistractionGroup[]`.
- **`categories`:** Extracted from `groups` as distinct non-null `categoryName` values, sorted alphabetically.
- **`recentEntries`:** Derived from the last 30 `DistractionLogged` events in `users/{uid}/session_events/` (query: `where('type', '==', 'DistractionLogged')`, `orderBy('timestamp', 'desc')`, `limit(30)`).

**Firestore security rule:**

```
match /users/{uid}/taxonomy/{noteId} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

#### 6.2.2. Secure Event Ledger Collection

The Event Ledger is the core data persistence mechanism for sessions and distractions in the target architecture. It implements the append-only, immutable event pattern specified in TARGET_ARCHITECTURE.md §5:

> The Angular app writes immutable event objects (e.g., `TimerStarted`, `IdleDetected`, `DistractionLogged`) to an append-only `session_events` Firestore collection.

**Anti-tampering rationale:** The Event Ledger prevents cheating by making session data immutable from the client's perspective. Clients can only **create** events — they cannot **update** or **delete** them. All gamification calculations (streaks, achievements, Swift Recovery) are performed server-side by Cloud Functions that trust only the immutable event stream.

##### 6.2.2.1. `users/{uid}/session_events/{eventId}` — Append-Only Immutable Events

**Firestore path:** `users/{uid}/session_events/{eventId}` (subcollection, auto-generated document IDs via `addDoc()`).

Every event in the ledger conforms to a normalized envelope (→ §6.2.2.4) plus a type-specific `payload` object.

##### 6.2.2.2. Event Types: `TimerStarted`, `TimerPaused`, `TimerCompleted`, `TimerEndedEarly`

**`TimerStarted`**

Written when the user clicks "Start Focus" and the timer begins counting down.

```json
{
  "type": "TimerStarted",
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "timestamp": "2026-04-03T09:00:00.000Z",
  "payload": {
    "durationSeconds": 1500,
    "sessionName": "Writing report",
    "startedAt": "2026-04-03T09:00:00.000Z",
    "timerMode": "pomodoro",
    "presetName": "Classic"
  }
}
```

| Payload Field | Type | Description |
|---|---|---|
| `durationSeconds` | `number` | Configured session duration (e.g., `1500` = 25 minutes). |
| `sessionName` | `string \| null` | User-defined session label. `null` if unnamed. |
| `startedAt` | `string` | ISO 8601 timestamp. Same as envelope `timestamp` for TimerStarted. |
| `timerMode` | `string` | `"pomodoro"`, `"shortBreak"`, or `"longBreak"`. |
| `presetName` | `string \| null` | Name of the preset used (e.g., `"Classic"`, `"Deep Work"`). `null` if custom. |

**`TimerPaused`**

Written when the user manually pauses the timer (not via intervention — that's handled separately by `IdleDetected`).

```json
{
  "type": "TimerPaused",
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "timestamp": "2026-04-03T09:12:30.000Z",
  "payload": {
    "pausedAt": "2026-04-03T09:12:30.000Z",
    "timeLeftSeconds": 750,
    "reason": "manual"
  }
}
```

| Payload Field | Type | Description |
|---|---|---|
| `pausedAt` | `string` | ISO 8601 timestamp of the pause. |
| `timeLeftSeconds` | `number` | Seconds remaining on the timer at the moment of pause. |
| `reason` | `string` | `"manual"` (user clicked Pause), `"intervention"` (idle detected), or `"suspend"` (system sleep). |

**`TimerCompleted`**

Written when the timer reaches zero naturally.

```json
{
  "type": "TimerCompleted",
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "timestamp": "2026-04-03T09:25:00.000Z",
  "payload": {
    "durationSeconds": 1500,
    "sessionName": "Writing report",
    "startedAt": "2026-04-03T09:00:00.000Z",
    "completedAt": "2026-04-03T09:25:00.000Z",
    "endedEarly": false,
    "distractionCount": 2,
    "falseAlarmCount": 0
  }
}
```

| Payload Field | Type | Description |
|---|---|---|
| `durationSeconds` | `number` | Full session duration in seconds. |
| `sessionName` | `string \| null` | Session label. |
| `startedAt` | `string` | ISO 8601 timestamp of session start. |
| `completedAt` | `string` | ISO 8601 timestamp of completion. |
| `endedEarly` | `boolean` | Always `false` for `TimerCompleted`. |
| `distractionCount` | `number` | Number of `DistractionLogged` events with this `sessionId`. Computed client-side at completion for display purposes. The authoritative count is derived server-side. |
| `falseAlarmCount` | `number` | Number of `FalseAlarmMarked` events with this `sessionId`. Same caveat as above. |

**`TimerEndedEarly`**

Written when the user manually ends the session before the timer reaches zero.

```json
{
  "type": "TimerEndedEarly",
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "timestamp": "2026-04-03T09:18:00.000Z",
  "payload": {
    "durationSeconds": 1080,
    "sessionName": "Writing report",
    "startedAt": "2026-04-03T09:00:00.000Z",
    "completedAt": "2026-04-03T09:18:00.000Z",
    "endedEarly": true,
    "distractionCount": 1,
    "falseAlarmCount": 0
  }
}
```

Same schema as `TimerCompleted` except `endedEarly` is `true` and `durationSeconds` is the actual elapsed time (not the configured duration).

##### 6.2.2.3. Event Types: `IdleDetected`, `DistractionLogged`, `FalseAlarmMarked`

**`IdleDetected`**

Written when the C# shell sends `IDLE_DETECTED` via IPC and Angular pauses the timer for intervention. This event marks the beginning of the intervention window.

```json
{
  "type": "IdleDetected",
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "timestamp": "2026-04-03T09:10:00.000Z",
  "payload": {
    "idleDurationMs": 45120,
    "timerTimeLeftSeconds": 900
  }
}
```

| Payload Field | Type | Description |
|---|---|---|
| `idleDurationMs` | `number` | Milliseconds the user was idle when the threshold was breached. Carried from the C# `IdleEventArgs.IdleDurationMs` (→ §4.1.5). |
| `timerTimeLeftSeconds` | `number` | Seconds remaining on the timer at the moment idle was detected. Useful for server-side analysis. |

**`DistractionLogged`**

Written when the user logs a distraction via the intervention modal.

```json
{
  "type": "DistractionLogged",
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "timestamp": "2026-04-03T09:10:45.000Z",
  "payload": {
    "note": "Twitter",
    "normalizedNote": "twitter",
    "categoryName": "Social Media"
  }
}
```

| Payload Field | Type | Description |
|---|---|---|
| `note` | `string` | Raw distraction note as entered by the user. Trimmed. |
| `normalizedNote` | `string` | Lowercase/trimmed version for grouping. |
| `categoryName` | `string \| null` | Assigned category. `null` if uncategorized. |

**Critical server-side usage:** Cloud Functions compare the `timestamp` of `DistractionLogged` against the `timestamp` of the preceding `IdleDetected` event for the same `sessionId`. If the difference is under 60 seconds, a **Swift Recovery Multiplier** bonus is awarded (→ §8.6).

**`FalseAlarmMarked`**

Written when the user clicks "False Alarm" in the intervention modal.

```json
{
  "type": "FalseAlarmMarked",
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "timestamp": "2026-04-03T09:10:30.000Z",
  "payload": {}
}
```

| Payload Field | Type | Description |
|---|---|---|
| *(empty payload)* | `object` | No additional data is needed. The event existence itself is the datum. |

**Source equivalent:** In the source, false alarms are stored as `Distraction` rows with `IsFalseAlarm = true`. In the target, they are distinct event types in the ledger. This eliminates the need for `IsFalseAlarm` boolean flags and simplifies Cloud Function processing (separate event types avoid conditional branching).

##### 6.2.2.4. Event Envelope: `{ type, timestamp, sessionId, payload }`

Every Event Ledger document conforms to the following normalized envelope:

```typescript
// File: src/app/core/models.ts

export interface SessionEvent<TPayload = Record<string, unknown>> {
  type: SessionEventType;
  sessionId: string;
  timestamp: string;     // ISO 8601, set by Angular at event creation time
  payload: TPayload;
}

export type SessionEventType =
  | 'TimerStarted'
  | 'TimerPaused'
  | 'TimerCompleted'
  | 'TimerEndedEarly'
  | 'IdleDetected'
  | 'DistractionLogged'
  | 'FalseAlarmMarked';
```

**Envelope field specification:**

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `string` | Yes | Discriminator. One of the `SessionEventType` values. Cloud Functions dispatch on this field. |
| `sessionId` | `string` | Yes | UUID (`crypto.randomUUID()`) generated by Angular at timer start. Correlates all events for a single focus session. Persists across pauses and interventions within the same session. Reset when a new session starts. |
| `timestamp` | `string` | Yes | ISO 8601 string, set by `new Date().toISOString()` at event creation on the client. This is the client-side timestamp. Firestore's `serverTimestamp()` is NOT used for this field because events must be writable offline. |
| `payload` | `object` | Yes | Type-specific data. Shape varies per event type (→ §6.2.2.2, §6.2.2.3). Always an object, never a primitive. |

**Why client timestamps instead of server timestamps:** The app must function offline (TARGET_ARCHITECTURE.md: "Optimistic Offline"). Firestore `serverTimestamp()` resolves to `null` locally until the document syncs to the server, which breaks offline reads. Client-issued ISO 8601 timestamps are immediately available and sortable. Cloud Functions can validate timestamp plausibility during processing.

**Angular `EventLedgerService` write implementation:**

```typescript
// File: src/app/core/event-ledger.service.ts

import { Injectable, inject } from '@angular/core';
import { Firestore, collection, addDoc } from 'firebase/firestore';
import { AuthService } from './auth.service';
import type { SessionEvent } from './models';

@Injectable({ providedIn: 'root' })
export class EventLedgerService {
  private firestore = inject(Firestore);
  private authService = inject(AuthService);

  async writeEvent<T extends Record<string, unknown>>(
    event: SessionEvent<T>,
  ): Promise<string | null> {
    const uid = this.authService.uid;
    if (!uid) return null;

    const colRef = collection(this.firestore, `users/${uid}/session_events`);
    const docRef = await addDoc(colRef, {
      type: event.type,
      sessionId: event.sessionId,
      timestamp: event.timestamp,
      payload: event.payload,
    });

    return docRef.id;
  }
}
```

**Firestore document example (raw):**

```json
// Path: users/abc123/session_events/auto-generated-id

{
  "type": "DistractionLogged",
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "timestamp": "2026-04-03T09:10:45.000Z",
  "payload": {
    "note": "Twitter",
    "normalizedNote": "twitter",
    "categoryName": "Social Media"
  }
}
```

##### 6.2.2.5. Write-Only Client Rule: Client Can Create, Cannot Update or Delete

**Firestore security rule:**

```
match /users/{uid}/session_events/{eventId} {
  // Clients can only CREATE new events — never update or delete.
  // This ensures the event stream is immutable and tamper-proof.
  allow create: if request.auth != null && request.auth.uid == uid
                && request.resource.data.type is string
                && request.resource.data.sessionId is string
                && request.resource.data.timestamp is string
                && request.resource.data.payload is map;

  // Read is allowed for the owning user (Angular needs to query for reports/history).
  allow read: if request.auth != null && request.auth.uid == uid;

  // Update and delete are DENIED for all clients — only Cloud Functions
  // (via Admin SDK, which bypasses security rules) can modify events if needed.
  allow update, delete: if false;
}
```

**Enforcement summary:**

| Operation | Client (Angular) | Cloud Function (Admin SDK) |
|---|---|---|
| **Create** | ✅ Allowed (authenticated, own UID, schema-validated) | ✅ Allowed (bypasses rules) |
| **Read** | ✅ Allowed (own UID only) | ✅ Allowed |
| **Update** | ❌ Denied | ✅ Allowed (for processing flags, if ever needed) |
| **Delete** | ❌ Denied | ✅ Allowed (for data cleanup, if ever needed) |

**Rationale (from TARGET_ARCHITECTURE.md §6):** "To prevent users from cheating by editing local IndexedDB or SQLite files, all gamification logic is strictly server-side." If a user modifies their local IndexedDB to add fake events, those events will be synced to Firestore and processed by Cloud Functions — but the Cloud Functions validate event plausibility (e.g., session duration < 24 hours, timestamps monotonically increasing) and reject anomalous data.

#### 6.2.3. Server-Computed Aggregates

Server-Computed Aggregates are Firestore documents written exclusively by Cloud Functions (→ §8). Angular reads these documents but never writes to them. They contain pre-computed totals and derived metrics that would be expensive or insecure to compute client-side.

##### 6.2.3.1. `users/{uid}/stats/daily/{YYYY-MM-DD}` — Daily Focus Totals

**Firestore path:** `users/{uid}/stats/daily/{YYYY-MM-DD}` (subcollection, document ID is the date string).

**Written by:** Cloud Function `onDocumentCreated` trigger on `session_events` (→ §8.3.4).

**Document schema:**

```json
{
  "date": "2026-04-03",
  "totalFocusSeconds": 5400,
  "sessionsCompleted": 3,
  "sessionsEndedEarly": 1,
  "distractionsLogged": 7,
  "falseAlarms": 2,
  "avgSessionSeconds": 1800.0,
  "longestSessionSeconds": 2400,
  "swiftRecoveryCount": 3,
  "updatedAt": "2026-04-03T15:30:00.000Z"
}
```

| Field | Type | Description |
|---|---|---|
| `date` | `string` | `YYYY-MM-DD` format. Same as the document ID. |
| `totalFocusSeconds` | `number` | Sum of `durationSeconds` for all `TimerCompleted` and `TimerEndedEarly` events on this date. |
| `sessionsCompleted` | `number` | Count of `TimerCompleted` events on this date. |
| `sessionsEndedEarly` | `number` | Count of `TimerEndedEarly` events on this date. |
| `distractionsLogged` | `number` | Count of `DistractionLogged` events on this date. |
| `falseAlarms` | `number` | Count of `FalseAlarmMarked` events on this date. |
| `avgSessionSeconds` | `number` | Average `durationSeconds` across all completed and early-ended sessions. |
| `longestSessionSeconds` | `number` | Maximum `durationSeconds` across all sessions on this date. |
| `swiftRecoveryCount` | `number` | Count of distractions logged within 60 seconds of the preceding `IdleDetected` event (→ §8.6). |
| `updatedAt` | `string` | ISO 8601 timestamp of the last Cloud Function update. |

**Angular read pattern:**

```typescript
// Read daily aggregates for a date range
const dailyQuery = query(
  collection(db, `users/${uid}/stats/daily`),
  where('date', '>=', startDate),   // "2026-03-27"
  where('date', '<=', endDate),     // "2026-04-03"
  orderBy('date', 'asc'),
);
```

**Firestore security rule:**

```
match /users/{uid}/stats/{document=**} {
  // Read-only for the owning user. Only Cloud Functions can write.
  allow read: if request.auth != null && request.auth.uid == uid;
  allow write: if false;
}
```

##### 6.2.3.2. `users/{uid}/stats/streaks` — Current & Longest Streak

**Firestore path:** `users/{uid}/stats/streaks` (single document).

**Written by:** Cloud Function that runs after each `TimerCompleted` event to check if the user has maintained a consecutive-day focus streak.

**Document schema:**

```json
{
  "currentStreak": 5,
  "longestStreak": 12,
  "lastActiveDate": "2026-04-03",
  "streakStartDate": "2026-03-30",
  "updatedAt": "2026-04-03T15:30:00.000Z"
}
```

| Field | Type | Description |
|---|---|---|
| `currentStreak` | `number` | Number of consecutive calendar days with at least one completed session. Reset to `1` if a day is missed. |
| `longestStreak` | `number` | All-time longest streak. Never decreases. |
| `lastActiveDate` | `string` | `YYYY-MM-DD` of the most recent day with a completed session. Used to detect streak breaks. |
| `streakStartDate` | `string` | `YYYY-MM-DD` of the first day of the current streak. |
| `updatedAt` | `string` | ISO 8601 timestamp of the last update. |

**Streak logic (computed by Cloud Function):**

```
if lastActiveDate === today:
    no change (already counted today)
else if lastActiveDate === yesterday:
    currentStreak += 1
    longestStreak = max(longestStreak, currentStreak)
    lastActiveDate = today
else:
    currentStreak = 1
    streakStartDate = today
    lastActiveDate = today
```

##### 6.2.3.3. `users/{uid}/achievements/{achievementId}` — Earned Badges

**Firestore path:** `users/{uid}/achievements/{achievementId}` (subcollection, document IDs are achievement type keys).

**Written by:** Cloud Function achievement engine (→ §8.5).

**Document schema:**

```json
{
  "achievementId": "focus_bronze",
  "tier": "bronze",
  "category": "focus",
  "title": "First Steps",
  "description": "Complete 10 focus sessions.",
  "earnedAt": "2026-04-02T14:00:00.000Z",
  "isShiny": false,
  "progress": {
    "current": 10,
    "target": 10
  }
}
```

| Field | Type | Description |
|---|---|---|
| `achievementId` | `string` | Unique achievement key (e.g., `"focus_bronze"`, `"streak_gold"`, `"recovery_silver"`). Also used as the document ID. |
| `tier` | `string` | `"bronze"`, `"silver"`, or `"gold"`. |
| `category` | `string` | Achievement category: `"focus"`, `"streak"`, `"recovery"`, `"perfect"`. |
| `title` | `string` | Human-readable title (e.g., "First Steps", "Marathon Runner"). |
| `description` | `string` | Human-readable description of the achievement criteria. |
| `earnedAt` | `string` | ISO 8601 timestamp when the badge was awarded. |
| `isShiny` | `boolean` | `true` if this is a server-side RNG "Shiny Badge" drop. From TARGET_ARCHITECTURE.md: "Server-side RNG drops for rare aesthetic badges awarded upon completion of perfect focus blocks." |
| `progress` | `object` | Contains `current` (number achieved) and `target` (threshold for this tier). |

**Achievement definitions** (from TARGET_ARCHITECTURE.md §6):

| Achievement ID | Tier | Category | Title | Threshold |
|---|---|---|---|---|
| `focus_bronze` | Bronze | Focus | First Steps | 10 sessions completed |
| `focus_silver` | Silver | Focus | Focused Mind | 50 sessions completed |
| `focus_gold` | Gold | Focus | Marathon Runner | 200 sessions completed |
| `streak_bronze` | Bronze | Streak | Building Habits | 3-day streak |
| `streak_silver` | Silver | Streak | Consistent | 7-day streak |
| `streak_gold` | Gold | Streak | Unstoppable | 30-day streak |
| `recovery_bronze` | Bronze | Recovery | Quick Draw | 10 swift recoveries (< 60s) |
| `recovery_silver` | Silver | Recovery | Reflexive | 50 swift recoveries |
| `recovery_gold` | Gold | Recovery | Lightning | 200 swift recoveries |
| `perfect_bronze` | Bronze | Perfect | Clean Block | 1 session with 0 distractions |
| `perfect_silver` | Silver | Perfect | Laser Focus | 10 clean sessions |
| `perfect_gold` | Gold | Perfect | Untouchable | 50 clean sessions |

**Shiny badge mechanic:** When a user completes a perfect session (0 distractions, timer runs to natural completion), the Cloud Function rolls a random number. If the roll exceeds a threshold (e.g., 95th percentile), a `isShiny: true` variant of the achievement is awarded. Shiny badges have no gameplay advantage — they are purely aesthetic ("Shiny Badges" from TARGET_ARCHITECTURE.md).

**Firestore security rule:**

```
match /users/{uid}/achievements/{achievementId} {
  // Read-only for the owning user. Only Cloud Functions can write.
  allow read: if request.auth != null && request.auth.uid == uid;
  allow write: if false;
}
```

---

### 6.3. IPC Settings Payload Shapes

This subsection documents the exact JSON shapes exchanged between the C# shell and Angular frontend for settings-related IPC messages. These shapes bridge the C# `AppSettings` model and the Angular `Settings` interface.

#### 6.3.1. `SETTINGS_LOADED` Payload (C# → Angular)

Sent by the C# shell in response to `GET_SETTINGS` (→ §3.2.3).

```json
{
  "type": "SETTINGS_LOADED",
  "payload": {
    "settings": {
      "pomodoroMinutes": 25,
      "shortBreakMinutes": 5,
      "longBreakMinutes": 15,
      "idleThresholdSeconds": 45,
      "cloudSyncEnabled": false,
      "soundEnabled": true,
      "alwaysOnTop": false,
      "suppressDuringMedia": true,
      "dailyFocusGoalMinutes": 120,
      "overlayStyle": "compact",
      "customPresets": [
        { "name": "My Flow", "focus": 40, "shortBreak": 8, "longBreak": 20 }
      ],
      "activeWindowWhitelist": ["code", "devenv"]
    }
  }
}
```

**Casing:** All JSON keys use **camelCase** (enforced by `JsonNamingPolicy.CamelCase` in the C# `IpcSerializer`, → §3.1.1). The C# properties are PascalCase internally but serialized as camelCase.

**Changes from source:** The source `SETTINGS_LOADED` included `todaySessionsCompleted` and `todayFocusSeconds` fields at the top level (computed from SQLite). These are **REMOVED** in the target because the C# shell has no database. Angular reads today's stats from Firestore `users/{uid}/stats/daily/{today}`.

#### 6.3.2. `SAVE_SETTINGS` Payload (Angular → C#)

Sent by Angular when the user changes any setting (→ §3.3.1).

```json
{
  "type": "SAVE_SETTINGS",
  "payload": {
    "settings": {
      "pomodoroMinutes": 30,
      "shortBreakMinutes": 5,
      "longBreakMinutes": 15,
      "idleThresholdSeconds": 60,
      "cloudSyncEnabled": true,
      "soundEnabled": true,
      "alwaysOnTop": false,
      "suppressDuringMedia": true,
      "dailyFocusGoalMinutes": 150,
      "overlayStyle": "monitoring",
      "customPresets": [],
      "activeWindowWhitelist": ["code.exe", "devenv.exe", "chrome"]
    }
  }
}
```

**C# handler processing:**

1. Deserialize `payload.settings` into `AppSettings` (camelCase JSON → PascalCase properties via `JsonNamingPolicy.CamelCase`).
2. Persist to `%LOCALAPPDATA%\Sentinel\settings.json` via `SettingsService.Save()`.
3. Apply runtime changes: `_idleMonitor.IdleThresholdSeconds = newSettings.IdleThresholdSeconds`.
4. Apply runtime changes: `_idleMonitor.SuppressDuringMedia = newSettings.SuppressDuringMedia`.
5. Apply runtime changes: `_activeWindowMonitor.SetWhitelist(newSettings.ActiveWindowWhitelist)`.
6. Apply runtime changes: `_window.SetTopMost(newSettings.AlwaysOnTop)`.
7. Send `SETTINGS_LOADED` response with the persisted settings (round-trip confirmation).

---

### 6.4. Source-to-Target Entity Mapping Table

| Source Entity | Source Location | Target Equivalent | Target Location | Migration Strategy |
|---|---|---|---|---|
| `Distraction` (C# class) | `Sentinel.Engine\Models.cs` | `DistractionLogged` / `FalseAlarmMarked` events | `users/{uid}/session_events/{eventId}` | Each distraction becomes an append-only event. `IsFalseAlarm=true` rows become `FalseAlarmMarked` events. |
| `Session` (C# class) | `Sentinel.Engine\Models.cs` | `TimerStarted` / `TimerCompleted` / `TimerEndedEarly` events | `users/{uid}/session_events/{eventId}` | Each session becomes 2+ events (start + completion/early-end). |
| `AppSettings` (C# class) | `Sentinel.Engine\SettingsService.cs` | `settings.json` (C# local) + Firestore `users/{uid}/settings` | `%LOCALAPPDATA%\Sentinel\settings.json` + Firestore | Dual persistence. C# local for offline startup; Firestore for cross-device sync. |
| `CustomPreset` (C# class) | `Sentinel.Engine\SettingsService.cs` | Nested in `AppSettings.customPresets` | Same nesting in both `settings.json` and Firestore | No structural change. |
| `TaxonomyData` (C# class) | `Sentinel.Engine\Models.cs` | `TaxonomyService` signal + Firestore `users/{uid}/taxonomy/` | Firestore subcollection | Each distraction group becomes its own Firestore document. |
| `DistractionEntryDto` | `Sentinel.Engine\Models.cs` | `DistractionEntry` (TS) | Derived from `session_events` query | `id` changes from `int` to `string`. |
| `DistractionGroupDto` | `Sentinel.Engine\Models.cs` | Firestore taxonomy document | `users/{uid}/taxonomy/{normalizedNote}` | Each group becomes a persistent document. |
| `ReportData` (C# class) | `Sentinel.Engine\ReportingService.cs` | `ReportData` (TS) | Computed from Firestore aggregates + events | Angular computes from `stats/daily` + event queries. |
| `DailyFocus` (C# class) | `Sentinel.Engine\ReportingService.cs` | `DailyFocusEntry` (TS) | `users/{uid}/stats/daily/{date}` | Server-computed by Cloud Functions. |
| `SessionEntry` (C# class) | `Sentinel.Engine\ReportingService.cs` | `SessionHistoryEntry` (TS) | Derived from `TimerCompleted`/`TimerEndedEarly` events | `sessionId` (string UUID) replaces `id` (int). |
| `SentinelDbContext` (EF Core) | `Sentinel.Engine\SentinelDbContext.cs` | **ELIMINATED** | — | No SQLite database in the target. |
| `DistractionRepository` | `Sentinel.Engine\DistractionRepository.cs` | **ELIMINATED** — logic moves to Angular services | `TaxonomyService`, `EventLedgerService` | All CRUD operations move to Firestore direct writes. |
| `ReportingService` | `Sentinel.Engine\ReportingService.cs` | **ELIMINATED** — logic moves to Angular `ReportService` | `src/app/core/report.service.ts` | Reports are computed from Firestore aggregates. |
| *(none)* | — | `PlannedBlock` (TS) | `users/{uid}/planner_blocks/{blockId}` | **NEW** entity for the Planner module. |
| *(none)* | — | `Achievement` (TS) | `users/{uid}/achievements/{achievementId}` | **NEW** entity for gamification. |
| *(none)* | — | `StreakData` (TS) | `users/{uid}/stats/streaks` | **NEW** entity for streak tracking. |

---

### 6.5. Complete Target TypeScript Model File

For reference, the complete set of TypeScript interfaces for the target Angular application, assembled from all subsections:

```typescript
// File: src/app/core/models.ts

// ─── Timer ─────────────────────────────────────────────────────────────

export type TimerMode = 'pomodoro' | 'shortBreak' | 'longBreak';
export type OverlayStyle = 'pill' | 'compact' | 'monitoring';
export type ReportRange = 'today' | 'week' | 'month' | 'all';

export interface TimerPreset {
  name: string;
  focus: number;
  shortBreak: number;
  longBreak: number;
}

// ─── Settings ──────────────────────────────────────────────────────────

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
  activeWindowWhitelist: string[];
}

// ─── Taxonomy ──────────────────────────────────────────────────────────

export interface DistractionEntry {
  id: string;
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

export interface QuickSuggestion {
  note: string;
  categoryName: string | null;
  source: 'Recent' | 'Frequent';
}

// ─── Reports ───────────────────────────────────────────────────────────

export interface ReportData {
  totalFocusSeconds: number;
  sessionsCompleted: number;
  distractionsLogged: number;
  falseAlarms: number;
  avgSessionSeconds: number;
  dailyFocus: DailyFocusEntry[];
  topCategories: ReportBreakdownItem[];
  topDistractions: ReportBreakdownItem[];
  recentSessions: SessionHistoryEntry[];
}

export interface DailyFocusEntry {
  date: string;
  focusSeconds: number;
  sessions: number;
  distractions: number;
}

export interface ReportBreakdownItem {
  name: string;
  count: number;
  categoryName?: string | null;
}

export interface SessionHistoryEntry {
  sessionId: string;
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number;
  completed: boolean;
  endedEarly: boolean;
  sessionName: string | null;
  distractionsCount: number;
  falseAlarmCount: number;
}

// ─── Event Ledger ──────────────────────────────────────────────────────

export type SessionEventType =
  | 'TimerStarted'
  | 'TimerPaused'
  | 'TimerCompleted'
  | 'TimerEndedEarly'
  | 'IdleDetected'
  | 'DistractionLogged'
  | 'FalseAlarmMarked';

export interface SessionEvent<TPayload = Record<string, unknown>> {
  type: SessionEventType;
  sessionId: string;
  timestamp: string;
  payload: TPayload;
}

export interface TimerStartedPayload {
  durationSeconds: number;
  sessionName: string | null;
  startedAt: string;
  timerMode: TimerMode;
  presetName: string | null;
}

export interface TimerPausedPayload {
  pausedAt: string;
  timeLeftSeconds: number;
  reason: 'manual' | 'intervention' | 'suspend';
}

export interface TimerCompletedPayload {
  durationSeconds: number;
  sessionName: string | null;
  startedAt: string;
  completedAt: string;
  endedEarly: boolean;
  distractionCount: number;
  falseAlarmCount: number;
}

export interface IdleDetectedPayload {
  idleDurationMs: number;
  timerTimeLeftSeconds: number;
}

export interface DistractionLoggedPayload {
  note: string;
  normalizedNote: string;
  categoryName: string | null;
}

// FalseAlarmMarked uses empty payload: Record<string, never>

// ─── Planner ───────────────────────────────────────────────────────────

export interface PlannedBlock {
  id: string;
  label: string;
  color: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  repeat: RepeatRule | null;
  createdAt: string;
  updatedAt: string;
}

export interface RepeatRule {
  frequency: 'daily' | 'weekdays' | 'custom';
  customDays?: number[];
  until?: string;
}

// ─── Server-Computed ───────────────────────────────────────────────────

export interface DailyStats {
  date: string;
  totalFocusSeconds: number;
  sessionsCompleted: number;
  sessionsEndedEarly: number;
  distractionsLogged: number;
  falseAlarms: number;
  avgSessionSeconds: number;
  longestSessionSeconds: number;
  swiftRecoveryCount: number;
  updatedAt: string;
}

export interface StreakData {
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string;
  streakStartDate: string;
  updatedAt: string;
}

export interface Achievement {
  achievementId: string;
  tier: 'bronze' | 'silver' | 'gold';
  category: 'focus' | 'streak' | 'recovery' | 'perfect';
  title: string;
  description: string;
  earnedAt: string;
  isShiny: boolean;
  progress: {
    current: number;
    target: number;
  };
}

// ─── Local Session State (Angular in-memory only) ──────────────────────

export interface DistractionRecord {
  note: string;
  categoryName: string | null;
  timestamp: Date;
}
```

---

### 6.6. Cross-Reference Table

| Section | Source File | Target File / Firestore Path | Status |
|---|---|---|---|
| §6.1.1 | `Sentinel.Engine\Models.cs` (`Distraction`) | `users/{uid}/session_events/{eventId}` (Event Ledger events) | REPLACED by event types |
| §6.1.2 | `Sentinel.Engine\Models.cs` (`Session`) | `users/{uid}/session_events/{eventId}` (Event Ledger events) | REPLACED by event types |
| §6.1.3 | `Sentinel.Engine\SettingsService.cs` (`AppSettings`) | `settings.json` + `users/{uid}/settings` | MODIFIED (added `ActiveWindowWhitelist`, removed `DataRetentionMonths`, `WindowLeft`, `WindowTop`) |
| §6.1.4 | `Sentinel.Engine\ReportingService.cs` (`ReportData`) | `src/app/core/models.ts` (`ReportData`) | PORTED — computed from Firestore instead of SQLite |
| §6.1.5 | `Sentinel.Engine\Models.cs` (Taxonomy DTOs) | `src/app/core/models.ts` + `users/{uid}/taxonomy/` | MODIFIED — `id` int→string, data from Firestore |
| §6.1.6 | `Sentinel.Engine\Models.cs` (`DistractionNormalizer`) | `src/app/core/taxonomy.utils.ts` | PORTED verbatim |
| §6.2.1.1 | *(no source equivalent)* | `users/{uid}/settings` | NEW Firestore schema |
| §6.2.1.2 | *(no source equivalent)* | `users/{uid}/planner_blocks/{blockId}` | NEW |
| §6.2.1.3 | Implicit in SQLite `Distractions` table | `users/{uid}/taxonomy/{normalizedNote}` | NEW — explicit taxonomy documents |
| §6.2.2 | `Sentinel.Engine\SentinelDbContext.cs` (SQLite) | `users/{uid}/session_events/{eventId}` | NEW — Event Ledger replaces SQLite |
| §6.2.3.1 | `Sentinel.Engine\ReportingService.cs` (daily aggregation) | `users/{uid}/stats/daily/{date}` | NEW — server-computed |
| §6.2.3.2 | *(no source equivalent)* | `users/{uid}/stats/streaks` | NEW |
| §6.2.3.3 | *(no source equivalent)* | `users/{uid}/achievements/{achievementId}` | NEW |
| §6.3 | `Sentinel.Engine\MainWindow.xaml.cs` (IPC handlers) | IPC envelope schema (→ §3) | DOCUMENTED |
| §6.4 | All source entity files | All target Firestore paths | MAPPING TABLE |
| §6.5 | `Sentinel.UI\src\app-types.ts`, `utils.ts` | `src/app/core/models.ts` | COMPLETE target file |

## 7. Firebase Hybrid Sync Architecture

This section specifies the complete data synchronization strategy for the target Sentinel application. The architecture is "hybrid" because it uses two fundamentally different persistence paths — Standard Persistence (read-write documents) and the Secure Event Ledger (append-only immutable events) — unified under Firestore's native offline-first model. Every architectural decision maps to the directive from TARGET_ARCHITECTURE.md §5:

> The application utilizes a two-pronged approach to offline data handling via Firestore:
> - **Standard Persistence:** User Settings, Planner schedules, and Distraction Taxonomy definitions use Firestore's native offline persistence.
> - **The Event Ledger (Secure Sync):** Focus sessions and distractions DO NOT update a unified "state" document locally. Instead, the Angular app writes immutable event objects to an append-only `session_events` Firestore collection.

**Source architecture summary (what we're replacing):**

The source React application (`Sentinel.UI\src\App.tsx`, `Sentinel.UI\src\firebase.ts`) implements a rudimentary cloud sync with:
1. `enableIndexedDbPersistence(db)` called on startup for offline caching.
2. `syncSessionToFirestore()` — writes a flat `sessions` document with `{ userId, duration, distractions[], completedAt: serverTimestamp() }` to a global `sessions` collection. Uses an in-memory `pendingSyncsRef` retry queue.
3. `submitDistraction()` — writes a flat `distractions` document with `{ userId, note, categoryName, timestamp: serverTimestamp() }` to a global `distractions` collection. No retry queue (fire-and-forget).
4. `fetchFirestoreHistory()` — reads from both flat collections, merges cloud counts with local SQLite report data using `Math.max()`.
5. Firestore security rules enforce `userId == request.auth.uid` on flat global collections.

**Target architecture changes:**

| Aspect | Source | Target |
|---|---|---|
| Collection layout | Flat global (`sessions/{id}`, `distractions/{id}`) with `userId` field | User-scoped subcollections (`users/{uid}/session_events/{id}`) |
| Write model | Mutable state documents (sessions, distractions) | Append-only immutable events (Event Ledger) |
| Retry queue | In-memory `pendingSyncsRef` (lost on app restart) | Firestore's native offline write queue (persisted in IndexedDB) |
| Server timestamps | `serverTimestamp()` (null offline) | Client ISO 8601 strings (always available offline) |
| Report data source | SQLite local + Firestore merge via `Math.max()` | Firestore only — server-computed aggregates + event queries |
| Security model | `userId` field matching (`resource.data.userId == request.auth.uid`) | Subcollection path matching (`request.auth.uid == uid`) + write-only rules |
| Taxonomy storage | Implicit in SQLite `Distractions` table | Explicit Firestore documents (`users/{uid}/taxonomy/{normalizedNote}`) |
| Settings sync | Not synced to Firestore | Dual persistence: local `settings.json` + Firestore `users/{uid}/settings` |

---

### 7.1. Optimistic Offline Strategy

Sentinel operates on an **Optimistic Offline** basis (TARGET_ARCHITECTURE.md §1): "functioning flawlessly without internet access." The app never blocks on network availability. All Firestore writes are optimistic — they succeed locally immediately and sync to the server when connectivity is restored. All reads prioritize the local IndexedDB cache and only fetch from the server when the cache is stale or empty.

#### 7.1.1. Firestore `enableIndexedDbPersistence` Configuration

**Source implementation** (`Sentinel.UI\src\firebase.ts`, lines 22–32):

```typescript
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    console.warn('[Sentinel] Firestore persistence unavailable (multi-tab).');
  } else if (err.code === 'unimplemented') {
    console.warn('[Sentinel] Firestore persistence unsupported in this environment.');
  }
});
```

**Target implementation** (`src/app/core/firebase.provider.ts`):

The Angular target uses the modular Firebase SDK (v10+). Firestore offline persistence is configured during application bootstrap via `provideFirebaseApp` and `provideFirestore` from `@angular/fire`:

```typescript
// File: src/app/core/firebase.provider.ts

import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideFirestore, getFirestore, enableIndexedDbPersistence } from '@angular/fire/firestore';
import { provideAuth, getAuth } from '@angular/fire/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyC6luPajDSMU1FyH5prC-LQgFtvj3JLdxE',
  authDomain: 'sentinel-s073.firebaseapp.com',
  projectId: 'sentinel-s073',
  storageBucket: 'sentinel-s073.firebasestorage.app',
  messagingSenderId: '173114633978',
  appId: '1:173114633978:web:7cdc2cf8a4a0067a67e343',
};

export const firebaseProviders = [
  provideFirebaseApp(() => initializeApp(firebaseConfig)),
  provideFirestore(() => {
    const firestore = getFirestore();
    enableIndexedDbPersistence(firestore).catch((err) => {
      if (err.code === 'failed-precondition') {
        console.warn('[Sentinel] Firestore persistence unavailable (multi-tab).');
      } else if (err.code === 'unimplemented') {
        console.warn('[Sentinel] Firestore persistence unsupported in this environment.');
      }
    });
    return firestore;
  }),
  provideAuth(() => getAuth()),
];
```

**Bootstrap integration** (`src/app/app.config.ts`):

```typescript
// File: src/app/app.config.ts

import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { firebaseProviders } from './core/firebase.provider';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    ...firebaseProviders,
  ],
};
```

**What `enableIndexedDbPersistence` does:**

1. Creates an IndexedDB database in the Photino embedded Chromium process.
2. Caches all Firestore documents that the app reads or writes.
3. When the app writes a document while offline, Firestore queues the write in IndexedDB and applies it to the local cache immediately (optimistic write).
4. When network connectivity is restored, Firestore automatically flushes the offline write queue to the server.
5. If the app reads a collection or document while offline, Firestore returns results from the IndexedDB cache.

**Differences from `enableMultiTabIndexedDbPersistence`:**

Sentinel runs inside a single Photino window — there is never a multi-tab scenario. The single-tab `enableIndexedDbPersistence` is used. If `failed-precondition` fires (multiple instances of Sentinel running simultaneously), the second instance operates without offline persistence (writes still work but aren't cached locally for offline reads).

**IndexedDB storage location:**

The IndexedDB database is stored by the Photino Chromium engine at:
```
%LOCALAPPDATA%\Sentinel\chromium-data\Default\IndexedDB\
```

This is separate from the C# `settings.json` file at `%LOCALAPPDATA%\Sentinel\settings.json`. Both persist independently.

#### 7.1.2. Offline Write Queue & Automatic Sync on Reconnect

**Source behavior (problems being fixed):**

The source React app uses a manual in-memory retry queue (`pendingSyncsRef`):

```typescript
// Source: Sentinel.UI\src\App.tsx, lines 136–166

const pendingSyncsRef = useRef<Array<{
  duration: number;
  distractions: string[];
  completedAt: Date;
}>>([]);

const syncSessionToFirestore = useCallback(async () => {
  if (!user || !settings.cloudSyncEnabled) return;

  pendingSyncsRef.current.push({
    duration: settings.pomodoroMinutes * 60,
    distractions: distractions.map((item) => item.note),
    completedAt: new Date(),
  });

  const pending = [...pendingSyncsRef.current];
  const failed: typeof pending = [];

  for (const session of pending) {
    try {
      await addDoc(collection(db, 'sessions'), {
        userId: user.uid,
        duration: session.duration,
        distractions: session.distractions,
        completedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('[Sentinel] Sync failed, will retry:', error);
      failed.push(session);
    }
  }

  pendingSyncsRef.current = failed;
}, [user, settings, distractions]);
```

**Problems:**

1. **Data loss on restart:** `pendingSyncsRef` is a React `useRef` — it's lost when the app closes or crashes. If a session fails to sync and the user closes Sentinel, that session is permanently lost from the cloud.
2. **No retry trigger:** Failed syncs are only retried when the NEXT session completes (because `syncSessionToFirestore` is only called on session completion). There is no periodic retry or network-restored trigger.
3. **Server timestamps break offline:** `serverTimestamp()` resolves to `null` in the local IndexedDB cache until the document syncs to the server. This means offline reads of pending documents return `null` for the timestamp field.
4. **Fire-and-forget distractions:** The `submitDistraction()` function has no retry queue at all — if the Firestore write fails, the distraction is only in SQLite.

**Target behavior (how Firestore's native queue replaces `pendingSyncsRef`):**

In the target architecture, there is **NO manual retry queue**. Firestore's `enableIndexedDbPersistence` handles everything:

1. When Angular calls `addDoc()` to write an Event Ledger event, Firestore immediately:
   - Writes the document to the local IndexedDB cache.
   - Returns a resolved `Promise` with the document reference (the write "succeeds" instantly).
   - Enqueues the write for server sync in IndexedDB.
2. If the network is available, the write is flushed to the server within milliseconds.
3. If the network is unavailable, the write remains in the IndexedDB queue indefinitely. Firestore retries automatically when connectivity is restored — even across app restarts, because the queue is persisted in IndexedDB.
4. If the write fails permanently (e.g., security rule rejection), the document is removed from the local cache and an error is surfaced via the `onSnapshot` listener (if active).

**Angular service implementation (no retry queue needed):**

```typescript
// File: src/app/core/event-ledger.service.ts

import { Injectable, inject } from '@angular/core';
import { Firestore, collection, addDoc } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import type { SessionEvent } from './models';

@Injectable({ providedIn: 'root' })
export class EventLedgerService {
  private firestore = inject(Firestore);
  private authService = inject(AuthService);

  /**
   * Write an event to the append-only Event Ledger.
   *
   * This method is fire-and-forget in terms of network sync.
   * Firestore's IndexedDB persistence guarantees the write is
   * durably queued even if the network is unavailable or the
   * app restarts before the write reaches the server.
   *
   * Returns the auto-generated Firestore document ID, or null
   * if the user is not authenticated (events are silently dropped
   * for unauthenticated users — they can still use the timer
   * locally without cloud persistence).
   */
  async writeEvent<T extends Record<string, unknown>>(
    event: SessionEvent<T>,
  ): Promise<string | null> {
    const uid = this.authService.uid;
    if (!uid) return null;

    const colRef = collection(this.firestore, `users/${uid}/session_events`);
    const docRef = await addDoc(colRef, {
      type: event.type,
      sessionId: event.sessionId,
      timestamp: event.timestamp,
      payload: event.payload,
    });

    return docRef.id;
  }
}
```

**Migration note:** The `pendingSyncsRef` pattern is **completely eliminated**. The 4 lines of `useRef` + the 30-line `syncSessionToFirestore` callback + the retry loop are ALL replaced by Firestore's built-in offline queue. The Angular `EventLedgerService.writeEvent()` is a single `addDoc()` call — no try/catch retry logic needed.

#### 7.1.3. Conflict Resolution: Last-Write-Wins for Settings, Append-Only for Events

The two persistence paths have fundamentally different conflict semantics:

**Standard Persistence (Settings, Planner, Taxonomy) — Last-Write-Wins:**

Firestore's default conflict resolution for single-document writes is Last-Write-Wins (LWW). When two devices write to the same document (e.g., `users/{uid}/settings`) while both are offline, the last write to reach the server wins. This is acceptable for settings because:

1. Settings changes are infrequent and user-intentional.
2. The `updatedAt` timestamp lets the UI show which device last modified settings.
3. There's no way to "merge" conflicting settings changes (e.g., if Device A sets `pomodoroMinutes: 30` and Device B sets `pomodoroMinutes: 40`, there's no meaningful merge — one must win).

**Sequence diagram — Settings conflict with LWW:**

```
┌──────────┐           ┌──────────┐           ┌──────────┐
│ Device A  │           │ Device B  │           │ Firestore │
└────┬─────┘           └────┬─────┘           └────┬─────┘
     │                      │                      │
     │  updateDoc(settings,  │                      │
     │  pomodoroMinutes: 30) │                      │
     │───────────┐          │                      │
     │           │ (offline) │                      │
     │           │          │  updateDoc(settings,  │
     │           │          │  pomodoroMinutes: 40) │
     │           │          │───────────┐          │
     │           │          │           │ (offline) │
     │           │          │           │          │
     │  ── comes online ──  │           │          │
     │──────────────────────┼──────────────────────▶│ pomodoroMinutes: 30
     │           │          │           │          │
     │           │          │  ── comes online ──  │
     │           │          │──────────────────────▶│ pomodoroMinutes: 40 (WINS)
     │           │          │           │          │
     │◀─────────────────────┼──────────────────────│ snapshot: 40
     │           │          │◀─────────────────────│ snapshot: 40
```

**Secure Event Ledger — No Conflicts (Append-Only):**

Event Ledger documents are append-only. Every event has a unique auto-generated document ID (`addDoc()`). There is no update or overwrite — each event is a new document. This means:

1. Two devices can log events simultaneously with zero conflict risk.
2. Offline events from Device A and Device B both sync to the server independently.
3. Cloud Functions process each event individually via `onDocumentCreated` triggers.
4. Event ordering is determined by the client-issued `timestamp` field, not by Firestore server arrival order.

**Sequence diagram — Event Ledger with no conflicts:**

```
┌──────────┐           ┌──────────┐           ┌──────────┐
│ Device A  │           │ Device B  │           │ Firestore │
└────┬─────┘           └────┬─────┘           └────┬─────┘
     │                      │                      │
     │  addDoc(TimerStarted,│                      │
     │  sessionId: "aaa")   │                      │
     │───────────┐          │                      │
     │           │ (offline) │                      │
     │           │          │  addDoc(TimerStarted, │
     │           │          │  sessionId: "bbb")   │
     │           │          │───────────┐          │
     │           │          │           │ (offline) │
     │           │          │           │          │
     │  ── comes online ──  │           │          │
     │──────────────────────┼──────────────────────▶│ event "aaa" created
     │           │          │  ── comes online ──  │
     │           │          │──────────────────────▶│ event "bbb" created
     │           │          │           │          │
     │  Both events coexist — no conflict.         │
```

---

### 7.2. Standard Persistence Path (Settings, Planner, Taxonomy)

Standard Persistence covers three document types that use Firestore's native read-write-delete operations. These documents are mutable — the client can create, read, update, and delete them. They are NOT part of the Event Ledger.

**Standard Persistence documents:**

| Firestore Path | Document Type | Schema Reference |
|---|---|---|
| `users/{uid}/settings` | Single document | → §6.2.1.1 |
| `users/{uid}/planner_blocks/{blockId}` | Subcollection | → §6.2.1.2 |
| `users/{uid}/taxonomy/{normalizedNote}` | Subcollection | → §6.2.1.3 |

#### 7.2.1. Direct Firestore Document Writes from Angular Services

Each Standard Persistence document type has a dedicated Angular service that encapsulates all Firestore operations. The services use `@angular/fire` wrappers around the modular Firebase SDK.

**Settings write flow:**

```
User changes setting in SettingsComponent
  → SettingsService.updateSetting(key, value)
    → IPC: SAVE_SETTINGS (to C# shell for local settings.json persistence)
    → Firestore: updateDoc(users/{uid}/settings, { [key]: value, updatedAt: now })
       → IndexedDB: write cached locally immediately
       → Server: synced when network available
```

**Angular `SettingsService` (target) — Firestore write:**

```typescript
// File: src/app/core/settings.service.ts

import { Injectable, inject, signal, computed } from '@angular/core';
import { Firestore, doc, setDoc, onSnapshot } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { IpcService } from './ipc.service';
import type { Settings } from './models';
import { defaultSettings } from './models';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private firestore = inject(Firestore);
  private authService = inject(AuthService);
  private ipcService = inject(IpcService);

  /** Reactive settings signal — components read from this. */
  readonly settings = signal<Settings>({ ...defaultSettings });

  /**
   * Initialize: load settings from C# shell (local settings.json),
   * then attach Firestore snapshot listener if authenticated and cloudSyncEnabled.
   */
  initialize(): void {
    // Request settings from C# shell (→ §3.2.3)
    this.ipcService.send({ type: 'GET_SETTINGS' });

    // Listen for SETTINGS_LOADED from C# shell
    this.ipcService.on<{ settings: Settings }>('SETTINGS_LOADED', (data) => {
      this.settings.set(data.settings);

      // If cloud sync is enabled and user is authenticated,
      // start listening for Firestore changes (cross-device sync).
      if (data.settings.cloudSyncEnabled) {
        this.attachFirestoreListener();
      }
    });
  }

  /**
   * Update a setting. Writes to BOTH:
   * 1. C# shell (local settings.json via IPC)
   * 2. Firestore (cloud sync, if enabled and authenticated)
   */
  async updateSettings(newSettings: Settings): Promise<void> {
    this.settings.set(newSettings);

    // Write to C# shell (local persistence)
    this.ipcService.send({ type: 'SAVE_SETTINGS', payload: { settings: newSettings } });

    // Write to Firestore (cloud persistence)
    const uid = this.authService.uid;
    if (uid && newSettings.cloudSyncEnabled) {
      const docRef = doc(this.firestore, `users/${uid}/settings`);
      await setDoc(docRef, {
        ...newSettings,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Attach Firestore snapshot listener for cross-device settings sync.
   * When settings change on another device, this listener fires and
   * updates the local signal + pushes to C# shell.
   */
  private attachFirestoreListener(): void {
    const uid = this.authService.uid;
    if (!uid) return;

    const docRef = doc(this.firestore, `users/${uid}/settings`);
    onSnapshot(docRef, (snapshot) => {
      if (!snapshot.exists()) return;

      const remoteSettings = snapshot.data() as Settings;

      // Only apply remote settings if they differ from local.
      // This prevents a feedback loop: local write → listener fires → local write.
      const currentUpdatedAt = (this.settings() as Settings & { updatedAt?: string }).updatedAt;
      const remoteUpdatedAt = (remoteSettings as Settings & { updatedAt?: string }).updatedAt;

      if (remoteUpdatedAt && remoteUpdatedAt !== currentUpdatedAt) {
        this.settings.set(remoteSettings);
        // Push to C# shell so local settings.json is updated
        this.ipcService.send({ type: 'SAVE_SETTINGS', payload: { settings: remoteSettings } });
      }
    });
  }
}
```

**Taxonomy write flow:**

```
User logs distraction "Twitter" with category "Social Media"
  → InterventionComponent emits (distractionLogged) event
  → TimerService.logDistraction(note, categoryName)
    → EventLedgerService.writeEvent({ type: 'DistractionLogged', ... })
    → TaxonomyService.upsertMapping('twitter', 'Twitter', 'Social Media')
      → Firestore: setDoc(users/{uid}/taxonomy/twitter, { ... }, { merge: true })
```

**Angular `TaxonomyService` — Firestore write (upsert on distraction log):**

```typescript
// File: src/app/core/taxonomy.service.ts

import { Injectable, inject, signal } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  query,
  where,
  getDocs,
  onSnapshot,
  writeBatch,
  increment,
} from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import type { TaxonomyData, DistractionGroup } from './models';

@Injectable({ providedIn: 'root' })
export class TaxonomyService {
  private firestore = inject(Firestore);
  private authService = inject(AuthService);

  readonly taxonomyData = signal<TaxonomyData>({
    recentEntries: [],
    groups: [],
    categories: [],
  });

  /**
   * Upsert a taxonomy mapping when a distraction is logged.
   * Creates the document if it doesn't exist, or updates count/lastSeenAt if it does.
   */
  async upsertMapping(
    normalizedNote: string,
    note: string,
    categoryName: string | null,
  ): Promise<void> {
    const uid = this.authService.uid;
    if (!uid) return;

    const docRef = doc(this.firestore, `users/${uid}/taxonomy/${normalizedNote}`);
    const now = new Date().toISOString();

    await setDoc(
      docRef,
      {
        note,
        normalizedNote,
        categoryName,
        count: increment(1),
        lastSeenAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  }

  /**
   * Rename a category across all taxonomy documents.
   * Source equivalent: DistractionRepository.RenameCategoryAsync().
   */
  async renameCategory(oldName: string, newName: string): Promise<void> {
    const uid = this.authService.uid;
    if (!uid) return;

    const colRef = collection(this.firestore, `users/${uid}/taxonomy`);
    const q = query(colRef, where('categoryName', '==', oldName));
    const snapshot = await getDocs(q);

    const batch = writeBatch(this.firestore);
    const now = new Date().toISOString();

    snapshot.docs.forEach((docSnap) => {
      batch.update(docSnap.ref, { categoryName: newName, updatedAt: now });
    });

    await batch.commit();
  }

  /**
   * Delete a category (set categoryName to null for all affected documents).
   * Source equivalent: DistractionRepository.DeleteCategoryAsync().
   */
  async deleteCategory(categoryName: string): Promise<void> {
    const uid = this.authService.uid;
    if (!uid) return;

    const colRef = collection(this.firestore, `users/${uid}/taxonomy`);
    const q = query(colRef, where('categoryName', '==', categoryName));
    const snapshot = await getDocs(q);

    const batch = writeBatch(this.firestore);
    const now = new Date().toISOString();

    snapshot.docs.forEach((docSnap) => {
      batch.update(docSnap.ref, { categoryName: null, updatedAt: now });
    });

    await batch.commit();
  }

  /**
   * Update the category for a single distraction group.
   * Source equivalent: DistractionRepository.UpdateDistractionGroupAsync().
   */
  async updateGroupCategory(
    normalizedNote: string,
    newCategoryName: string | null,
  ): Promise<void> {
    const uid = this.authService.uid;
    if (!uid) return;

    const docRef = doc(this.firestore, `users/${uid}/taxonomy/${normalizedNote}`);
    const now = new Date().toISOString();

    await updateDoc(docRef, {
      categoryName: newCategoryName,
      updatedAt: now,
    });
  }

  /**
   * Attach real-time listener for taxonomy changes.
   * Rebuilds the TaxonomyData signal whenever any taxonomy document changes.
   */
  attachListener(): void {
    const uid = this.authService.uid;
    if (!uid) return;

    const colRef = collection(this.firestore, `users/${uid}/taxonomy`);
    onSnapshot(colRef, (snapshot) => {
      const groups: DistractionGroup[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          note: data['note'] as string,
          normalizedNote: data['normalizedNote'] as string,
          categoryName: (data['categoryName'] as string) ?? null,
          count: data['count'] as number,
          lastSeenAt: data['lastSeenAt'] as string,
        };
      });

      const categories = [
        ...new Set(
          groups
            .map((g) => g.categoryName)
            .filter((c): c is string => c !== null),
        ),
      ].sort();

      this.taxonomyData.update((prev) => ({
        ...prev,
        groups,
        categories,
      }));
    });
  }
}
```

**Planner write operations:**

Planner blocks use standard Firestore CRUD. The `PlannerService` is documented in → §5.6. All operations (`addDoc`, `updateDoc`, `deleteDoc`) use the Standard Persistence path.

**Source-to-target mapping of Firestore write operations:**

| Source Operation | Source Code Location | Target Angular Service | Target Firestore Operation |
|---|---|---|---|
| Session write | `App.tsx:syncSessionToFirestore()` | `EventLedgerService.writeEvent()` | `addDoc(users/{uid}/session_events, event)` |
| Distraction write | `App.tsx:submitDistraction()` | `EventLedgerService.writeEvent()` + `TaxonomyService.upsertMapping()` | `addDoc(session_events)` + `setDoc(taxonomy, merge)` |
| Report fetch | `App.tsx:fetchFirestoreHistory()` | `ReportService.loadReport()` | `getDocs(stats/daily)` + `getDocs(session_events)` |
| *(not in source)* | — | `SettingsService.updateSettings()` | `setDoc(users/{uid}/settings)` |
| *(not in source)* | — | `PlannerService.createBlock()` | `addDoc(users/{uid}/planner_blocks)` |

#### 7.2.2. Real-Time Snapshot Listeners for Cross-Device Sync

**Source behavior:** The source app does NOT use real-time listeners. It uses one-shot `getDocs()` queries to fetch cloud data when the user opens the Reports screen. There is no cross-device sync for settings, taxonomy, or session data.

**Target behavior:** The target app uses Firestore `onSnapshot()` listeners to receive real-time updates when data changes on another device (or when Cloud Functions write server-computed aggregates).

**Listeners to register:**

| Listener | Firestore Path | Trigger | Angular Service |
|---|---|---|---|
| Settings sync | `users/{uid}/settings` | Settings change on another device | `SettingsService.attachFirestoreListener()` |
| Taxonomy sync | `users/{uid}/taxonomy` (collection) | Category rename/delete on another device, or new distraction logged | `TaxonomyService.attachListener()` |
| Daily stats update | `users/{uid}/stats/daily/{today}` | Cloud Function writes daily aggregate after event processing | `ReportService.attachDailyStatsListener()` |
| Streak update | `users/{uid}/stats/streaks` | Cloud Function updates streak after session completion | `ReportService.attachStreakListener()` |
| Achievement unlock | `users/{uid}/achievements` (collection) | Cloud Function awards new achievement | `AchievementService.attachListener()` |

**Listener lifecycle:**

```
App starts
  → AuthService.onAuthStateChanged()
    → if user authenticated:
      → SettingsService.attachFirestoreListener()
      → TaxonomyService.attachListener()
      → ReportService.attachDailyStatsListener()
      → ReportService.attachStreakListener()
      → AchievementService.attachListener()
    → if user signs out:
      → All listeners are automatically cleaned up by @angular/fire
         (subscriptions tied to component lifecycle via DestroyRef)
```

**`onSnapshot` behavior offline:**

When the app is offline, `onSnapshot` still fires — it returns results from the local IndexedDB cache. The `SnapshotMetadata.fromCache` flag indicates whether the data came from the cache or the server:

```typescript
onSnapshot(docRef, (snapshot) => {
  const data = snapshot.data();
  const fromCache = snapshot.metadata.fromCache;
  // fromCache === true → data is from local IndexedDB cache
  // fromCache === false → data is fresh from server
});
```

Angular services do NOT differentiate between cache and server reads. All data is treated equally — the UI never shows a "stale data" warning. This is the "Optimistic Offline" principle.

#### 7.2.3. Local Cache Read Priority (Offline-First Reads)

**Firestore read priority with `enableIndexedDbPersistence`:**

1. **First read (cache empty):** Firestore fetches from the server, caches in IndexedDB, returns to caller.
2. **Subsequent reads (cache populated, online):** Firestore returns from cache immediately AND initiates a server fetch. If the server returns newer data, the `onSnapshot` listener fires again with the updated data.
3. **Reads while offline (cache populated):** Firestore returns from cache. No server fetch attempted. `fromCache === true`.
4. **Reads while offline (cache empty):** Firestore returns an empty result set. No error thrown.

**Practical implication for Angular services:**

All query operations (`getDocs`, `getDoc`) use the default Firestore cache behavior. DO NOT use `getDocFromServer()` or `getDocsFromServer()` — these bypass the cache and throw errors when offline.

```typescript
// CORRECT — uses cache when offline, server when online:
const snapshot = await getDocs(
  query(collection(db, `users/${uid}/stats/daily`), where('date', '>=', startDate)),
);

// INCORRECT — throws FirestoreError when offline:
// const snapshot = await getDocsFromServer(...);
```

**Settings read priority (C# shell vs. Firestore):**

Settings have a special dual-source read priority:

```
1. App starts → C# shell loads settings.json from disk → sends SETTINGS_LOADED via IPC
2. Angular applies local settings immediately (zero-latency startup)
3. If cloudSyncEnabled && authenticated:
   a. Firestore snapshot listener fires with cloud settings
   b. If cloud settings have a newer updatedAt → override local settings
   c. Push updated settings back to C# shell via SAVE_SETTINGS IPC
```

This ensures the app is usable within milliseconds of startup (local settings.json) while seamlessly pulling in cross-device changes when available.

---

### 7.3. Secure Event Ledger Path (Sessions & Distractions)

The Secure Event Ledger is the core differentiator of the target sync architecture. All session and distraction data flows through append-only, immutable event documents. This path is fundamentally different from Standard Persistence — the client can only CREATE events, never UPDATE or DELETE them.

#### 7.3.1. Client-Side Event Construction (Immutable Event Objects)

Every event written to the ledger conforms to the `SessionEvent<T>` envelope (→ §6.2.2.4). Events are constructed entirely on the client (Angular) and written as complete documents. There is no partial write or field-level update.

**Event construction flow for each event type:**

**`TimerStarted` — constructed when the user clicks "Start Focus":**

```typescript
// File: src/app/features/timer/timer.service.ts

startSession(sessionName: string | null): void {
  const sessionId = crypto.randomUUID();
  this.currentSessionId.set(sessionId);
  this.distractions.set([]);

  const settings = this.settingsService.settings();
  const timerMode = this.timerMode();
  const durationSeconds = getTimerDuration(timerMode, settings);

  const now = new Date().toISOString();

  // Write event to ledger
  this.eventLedgerService.writeEvent({
    type: 'TimerStarted',
    sessionId,
    timestamp: now,
    payload: {
      durationSeconds,
      sessionName,
      startedAt: now,
      timerMode,
      presetName: this.activePresetName(),
    },
  });

  // Start the countdown
  this.timeLeft.set(durationSeconds);
  this.isRunning.set(true);
  this.startCountdown();
}
```

**`TimerPaused` — constructed when the timer is paused (manually or by intervention):**

```typescript
pauseTimer(reason: 'manual' | 'intervention' | 'suspend'): void {
  this.isRunning.set(false);
  this.stopCountdown();

  const sessionId = this.currentSessionId();
  if (!sessionId) return;

  this.eventLedgerService.writeEvent({
    type: 'TimerPaused',
    sessionId,
    timestamp: new Date().toISOString(),
    payload: {
      pausedAt: new Date().toISOString(),
      timeLeftSeconds: this.timeLeft(),
      reason,
    },
  });
}
```

**`TimerCompleted` — constructed when the countdown reaches zero:**

```typescript
private onTimerComplete(): void {
  const sessionId = this.currentSessionId();
  if (!sessionId) return;

  const distractions = this.distractions();
  const settings = this.settingsService.settings();
  const durationSeconds = getTimerDuration(this.timerMode(), settings);

  this.eventLedgerService.writeEvent({
    type: 'TimerCompleted',
    sessionId,
    timestamp: new Date().toISOString(),
    payload: {
      durationSeconds,
      sessionName: this.sessionName(),
      startedAt: this.sessionStartedAt()!,
      completedAt: new Date().toISOString(),
      endedEarly: false,
      distractionCount: distractions.filter((d) => d.categoryName !== null || d.note !== '').length,
      falseAlarmCount: 0, // FalseAlarms are separate events, count from local state
    },
  });

  // IPC: tell C# shell to play completion sound
  this.ipcService.send({ type: 'SESSION_COMPLETE' });
}
```

**`TimerEndedEarly` — constructed when the user clicks "End Session" before timer reaches zero:**

```typescript
endSessionEarly(): void {
  const sessionId = this.currentSessionId();
  if (!sessionId) return;

  const startedAt = this.sessionStartedAt();
  if (!startedAt) return;

  const settings = this.settingsService.settings();
  const totalDuration = getTimerDuration(this.timerMode(), settings);
  const elapsed = totalDuration - this.timeLeft();

  this.eventLedgerService.writeEvent({
    type: 'TimerEndedEarly',
    sessionId,
    timestamp: new Date().toISOString(),
    payload: {
      durationSeconds: elapsed,
      sessionName: this.sessionName(),
      startedAt,
      completedAt: new Date().toISOString(),
      endedEarly: true,
      distractionCount: this.distractions().length,
      falseAlarmCount: 0,
    },
  });

  this.isRunning.set(false);
  this.stopCountdown();
  this.ipcService.send({ type: 'SESSION_COMPLETE' });
}
```

**`IdleDetected` — constructed when the C# shell sends `IDLE_DETECTED` via IPC:**

```typescript
// File: src/app/core/ipc-dispatch.service.ts (idle handler)

private handleIdleDetected(payload: { idleDurationMs: number }): void {
  const timerService = inject(TimerService);
  const sessionId = timerService.currentSessionId();

  if (!sessionId || !timerService.isRunning()) return;

  // Pause the timer
  timerService.pauseTimer('intervention');

  // Write IdleDetected event
  this.eventLedgerService.writeEvent({
    type: 'IdleDetected',
    sessionId,
    timestamp: new Date().toISOString(),
    payload: {
      idleDurationMs: payload.idleDurationMs,
      timerTimeLeftSeconds: timerService.timeLeft(),
    },
  });

  // Show intervention modal
  timerService.showIntervention.set(true);
}
```

**`DistractionLogged` — constructed when the user submits a distraction in the intervention modal:**

```typescript
// File: src/app/features/timer/timer.service.ts

logDistraction(note: string, categoryName: string | null): void {
  const sessionId = this.currentSessionId();
  if (!sessionId) return;

  const normalizedNote = normalizeDistractionNote(note);

  // Write DistractionLogged event to ledger
  this.eventLedgerService.writeEvent({
    type: 'DistractionLogged',
    sessionId,
    timestamp: new Date().toISOString(),
    payload: {
      note: note.trim(),
      normalizedNote,
      categoryName,
    },
  });

  // Upsert taxonomy mapping
  this.taxonomyService.upsertMapping(normalizedNote, note.trim(), categoryName);

  // Track locally for session-scoped distraction list
  this.distractions.update((prev) => [
    ...prev,
    { note: note.trim(), categoryName, timestamp: new Date() },
  ]);
}
```

**`FalseAlarmMarked` — constructed when the user clicks "False Alarm" in the intervention modal:**

```typescript
markFalseAlarm(): void {
  const sessionId = this.currentSessionId();
  if (!sessionId) return;

  this.eventLedgerService.writeEvent({
    type: 'FalseAlarmMarked',
    sessionId,
    timestamp: new Date().toISOString(),
    payload: {},
  });
}
```

#### 7.3.2. Append-Only Write Pattern (No Updates, No Deletes)

**Enforcement at three levels:**

1. **Application-level:** The `EventLedgerService` exposes ONLY a `writeEvent()` method. There is no `updateEvent()`, `deleteEvent()`, or `patchEvent()` method. The service API makes it physically impossible to modify existing events from Angular code.

2. **Security-rule level:** Firestore security rules deny all `update` and `delete` operations on the `session_events` subcollection (→ §7.4.2). Even if a developer accidentally adds an update call, it will fail at runtime.

3. **Cloud Function level:** Cloud Functions use the Admin SDK, which bypasses security rules. However, the Cloud Functions are designed to only READ events and WRITE to aggregate documents (`stats/daily`, `stats/streaks`, `achievements`). No Cloud Function ever modifies an event document.

**What happens if a user tries to tamper with IndexedDB:**

A technically sophisticated user could open Chrome DevTools, navigate to Application → IndexedDB, and modify cached event documents. However:

1. The modified document will sync to Firestore on the next network connection.
2. The Firestore security rule will reject the write because `update` is denied:
   ```
   allow update, delete: if false;
   ```
3. Firestore will remove the tampered document from the local cache (reverting to the server state).
4. Cloud Functions have already processed the original event — the aggregate documents are authoritative.

**What about deleting IndexedDB entirely:**

If a user clears IndexedDB, they lose their local cache. On the next app start:
1. Firestore re-fetches all data from the server.
2. All previously synced events are restored.
3. Any events that were written offline but not yet synced are permanently lost.

This is an acceptable trade-off. The offline window is typically short (seconds to minutes), and the Photino app runs in a persistent process that syncs continuously when online.

#### 7.3.3. Pending Sync Queue (`pendingSyncsRef` Migration to Angular)

**Source implementation** (`Sentinel.UI\src\App.tsx`, lines 136–166):

The source uses an in-memory `useRef` array to track sessions that failed to sync:

```typescript
const pendingSyncsRef = useRef<Array<{
  duration: number;
  distractions: string[];
  completedAt: Date;
}>>([]);
```

**Problems with the source approach:**

| Problem | Impact |
|---|---|
| `useRef` is in-memory only | Data lost on app close, crash, or system restart |
| Retry triggers only on next session completion | If no more sessions are completed, pending data never syncs |
| Only sessions have retry logic | Distractions are fire-and-forget (`catch` logs error, no retry) |
| `serverTimestamp()` used for `completedAt` | Pending documents have `null` timestamp in local cache |
| No deduplication on retry | If Firestore write succeeds but the `addDoc` promise times out, the retry creates a duplicate |

**Target solution: Eliminate the manual queue entirely.**

Firestore's `enableIndexedDbPersistence` provides a built-in write queue that solves ALL of the above problems:

| Feature | Source (`pendingSyncsRef`) | Target (Firestore native queue) |
|---|---|---|
| Persistence | In-memory, lost on close | IndexedDB, persists across restarts |
| Retry trigger | Manual (next session only) | Automatic (network reconnect) |
| Coverage | Sessions only | All Firestore writes (events, taxonomy, settings) |
| Deduplication | None | Built-in (Firestore uses write IDs) |
| Timestamp handling | `serverTimestamp()` (null offline) | Client ISO 8601 string (always available) |

**Migration action:** Delete the `pendingSyncsRef` and `syncSessionToFirestore` function entirely. Replace all `addDoc(collection(db, 'sessions'), {...})` calls with `EventLedgerService.writeEvent({...})`. The `writeEvent` method is a single `addDoc` call with no retry logic — Firestore handles retries internally.

**Code diff (conceptual):**

```diff
- // Source: App.tsx
- const pendingSyncsRef = useRef<Array<{...}>>([]);
- const syncSessionToFirestore = useCallback(async () => {
-   if (!user || !settings.cloudSyncEnabled) return;
-   pendingSyncsRef.current.push({...});
-   const pending = [...pendingSyncsRef.current];
-   const failed: typeof pending = [];
-   for (const session of pending) {
-     try {
-       await addDoc(collection(db, 'sessions'), {...});
-     } catch (error) {
-       failed.push(session);
-     }
-   }
-   pendingSyncsRef.current = failed;
- }, [...]);

+ // Target: TimerService
+ this.eventLedgerService.writeEvent({
+   type: 'TimerCompleted',
+   sessionId: this.currentSessionId(),
+   timestamp: new Date().toISOString(),
+   payload: { ... },
+ });
```

#### 7.3.4. Event Ordering & Timestamp Consistency (Server Timestamp vs. Client Timestamp)

**Source behavior: `serverTimestamp()` (problematic):**

The source uses Firestore's `serverTimestamp()` for timestamps:

```typescript
// Source: App.tsx:156
await addDoc(collection(db, 'sessions'), {
  userId: user.uid,
  duration: session.duration,
  distractions: session.distractions,
  completedAt: serverTimestamp(),  // ← Server timestamp
});
```

**Problem:** `serverTimestamp()` resolves to `null` in the local IndexedDB cache until the document syncs to the server. This means:
1. Offline reads of pending documents return `null` for `completedAt`.
2. Queries with `orderBy('completedAt')` or `where('completedAt', '>=', ...)` skip pending documents.
3. Reports generated while offline may silently exclude recent sessions.

**Target behavior: Client ISO 8601 strings:**

The target uses client-generated ISO 8601 timestamps:

```typescript
const now = new Date().toISOString();
// → "2026-04-03T09:00:00.000Z"

this.eventLedgerService.writeEvent({
  type: 'TimerCompleted',
  sessionId,
  timestamp: now,           // ← Client timestamp, always available
  payload: {
    completedAt: now,       // ← Also client timestamp
    ...
  },
});
```

**Advantages:**

1. **Always available offline:** `new Date().toISOString()` works without network access.
2. **Immediately queryable:** The `timestamp` field is set on the document before it enters the IndexedDB write queue. Offline queries work correctly.
3. **Sortable:** ISO 8601 strings sort lexicographically in the correct chronological order.

**Disadvantage (mitigated):**

Client timestamps can be spoofed or incorrect (system clock drift). This is mitigated by:

1. **Cloud Functions validate plausibility:** The server checks that `timestamp` is within a reasonable window (e.g., not in the future by more than 5 minutes, not older than 30 days from when it arrives at the server).
2. **Event ordering within a session is enforced by `sessionId`:** Events for the same session must follow a logical sequence: `TimerStarted` → (optional `TimerPaused`, `IdleDetected`, `DistractionLogged`, `FalseAlarmMarked`) → `TimerCompleted` or `TimerEndedEarly`. Cloud Functions validate this sequence.
3. **Gamification is server-authoritative:** Even if a user sets their system clock to log an artificially fast Swift Recovery (< 60s), the Cloud Function can cross-reference `serverTimestamp()` on the Firestore document metadata to detect clock manipulation.

**Event ordering guarantee across devices:**

Events from different devices have different `sessionId` values. Events within a session are linearly ordered by `timestamp`. Cross-session ordering uses `timestamp` for display but is not semantically significant (sessions don't interact with each other).

```
Device A session "aaa":
  [TimerStarted t=09:00] → [IdleDetected t=09:10] → [DistractionLogged t=09:10:30] → [TimerCompleted t=09:25]

Device B session "bbb":
  [TimerStarted t=09:05] → [TimerCompleted t=09:30]

Report view: sorted by timestamp, interleaved. No ambiguity because sessionId groups events.
```

#### 7.3.5. Anti-Tampering Rationale: Why Events, Not State Documents

**Why not use mutable state documents for sessions?**

The source architecture stores sessions as mutable state documents:

```json
// Source: flat sessions/{sessionId} document
{
  "userId": "abc123",
  "duration": 1500,
  "distractions": ["Twitter", "Slack"],
  "completedAt": "2026-04-03T09:25:00Z"
}
```

A user with IndexedDB access could modify this document to inflate their focus time (`duration: 99999`), remove distractions (`distractions: []`), or change the timestamp (`completedAt` pushed earlier to create fake streaks).

**The Event Ledger prevents this** (TARGET_ARCHITECTURE.md §6):

> To prevent users from cheating by editing local IndexedDB or SQLite files, all gamification logic is strictly server-side.

The Event Ledger is append-only: the client writes immutable event documents that the client cannot modify after creation. The server processes these events to compute aggregates. Even if a user adds fake events to their local IndexedDB:

1. **Fake events must pass security rules:** The event must have a valid `type`, `sessionId`, `timestamp`, and `payload` (→ §7.4.2).
2. **Cloud Functions validate event sequences:** A `TimerCompleted` event without a preceding `TimerStarted` event for the same `sessionId` is rejected.
3. **Server computes aggregates:** The user cannot directly write to `stats/daily`, `stats/streaks`, or `achievements` — these are read-only for the client (→ §7.4.3).
4. **Temporal plausibility checks:** A session claiming 10 hours of focus (`durationSeconds: 36000`) from a 25-minute timer is flagged and excluded.

**Trade-off:** The Event Ledger generates more Firestore documents than mutable state documents (each session produces 2-10 events instead of 1 state document). This increases Firestore read/write costs. The trade-off is acceptable for a desktop productivity app with modest data volumes (a power user might generate ~50 events per day = ~1,500 per month).

---

### 7.4. Firestore Security Rules

This subsection specifies the complete Firestore security rules for the target architecture. The rules replace the source rules (`firestore.rules`) which use flat global collections with `userId` field matching.

**Source rules** (`firestore.rules`):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
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
    match /_sentinel_health/{docId} {
      allow read: if request.auth != null;
    }
  }
}
```

**Source rule problems:**

1. **Flat collections with `userId` field:** Any authenticated user can theoretically enumerate document IDs in `sessions/` and `distractions/`. The `resource.data.userId` check only fires on read — ID enumeration is possible.
2. **Full CRUD on sessions and distractions:** The `update` and `delete` permissions on sessions mean a user can modify or delete their past session data, undermining gamification integrity.
3. **No schema validation:** There's no validation that `request.resource.data` contains the expected fields.
4. **No Server-Computed protection:** There are no rules for aggregate or achievement documents (they don't exist in the source).

**Target rules** (`firestore.rules`):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ─── Default deny ───────────────────────────────────────────────
    match /{document=**} {
      allow read, write: if false;
    }

    // ─── User-scoped data ────────────────────────────────────────────
    match /users/{uid} {

      // ─── 7.4.1. Standard Persistence: Settings ───────────────────
      match /settings {
        allow read: if request.auth != null && request.auth.uid == uid;
        allow write: if request.auth != null && request.auth.uid == uid;
      }

      // ─── 7.4.1. Standard Persistence: Planner Blocks ─────────────
      match /planner_blocks/{blockId} {
        allow read: if request.auth != null && request.auth.uid == uid;
        allow write: if request.auth != null && request.auth.uid == uid;
      }

      // ─── 7.4.1. Standard Persistence: Taxonomy ───────────────────
      match /taxonomy/{noteId} {
        allow read: if request.auth != null && request.auth.uid == uid;
        allow write: if request.auth != null && request.auth.uid == uid;
      }

      // ─── 7.4.2. Event Ledger: Append-Only ─────────────────────────
      match /session_events/{eventId} {
        // Client can READ their own events (for reports, history).
        allow read: if request.auth != null && request.auth.uid == uid;

        // Client can only CREATE new events. Schema validation ensures
        // the event has the required fields.
        allow create: if request.auth != null
                      && request.auth.uid == uid
                      && request.resource.data.type is string
                      && request.resource.data.type in [
                           'TimerStarted',
                           'TimerPaused',
                           'TimerCompleted',
                           'TimerEndedEarly',
                           'IdleDetected',
                           'DistractionLogged',
                           'FalseAlarmMarked'
                         ]
                      && request.resource.data.sessionId is string
                      && request.resource.data.timestamp is string
                      && request.resource.data.payload is map;

        // UPDATE and DELETE are DENIED for all clients.
        // Only Cloud Functions (Admin SDK) can modify events if needed.
        allow update, delete: if false;
      }

      // ─── 7.4.3. Server-Computed: Read-Only for Client ─────────────
      match /stats/{document=**} {
        allow read: if request.auth != null && request.auth.uid == uid;
        allow write: if false;
      }

      match /achievements/{achievementId} {
        allow read: if request.auth != null && request.auth.uid == uid;
        allow write: if false;
      }
    }
  }
}
```

#### 7.4.1. User Isolation: `request.auth.uid == uid`

**Source pattern:** `resource.data.userId == request.auth.uid` — matches a `userId` FIELD inside the document against the authenticated user.

**Target pattern:** `request.auth.uid == uid` — matches the authenticated user against the `{uid}` path SEGMENT in the document path.

**Why the target pattern is superior:**

1. **No field dependency:** The source pattern requires every document to contain a `userId` field. If a document is missing this field (data migration bug, schema evolution), the rule silently denies access. The target pattern relies on the document PATH, which is inherently set by the write operation.

2. **No ID enumeration:** In the source flat collection (`sessions/{sessionId}`), a user can attempt to read arbitrary document IDs — the `resource.data.userId` check only fires after Firestore loads the document. In the target user-scoped collection (`users/{uid}/session_events/{eventId}`), Firestore denies access at the PATH level before loading the document.

3. **Cleaner queries:** The source requires `where('userId', '==', user.uid)` on every query. The target queries are scoped to the user's subcollection by path — no `where` filter needed for user isolation.

```typescript
// Source: requires userId filter
const q = query(
  collection(db, 'sessions'),
  where('userId', '==', user.uid),
  orderBy('completedAt', 'desc'),
);

// Target: user isolation is in the path
const q = query(
  collection(db, `users/${uid}/session_events`),
  orderBy('timestamp', 'desc'),
);
```

#### 7.4.2. Event Ledger Write-Only Rule (Create Only, No Update/Delete)

The Event Ledger rule is the most critical security enforcement in the target architecture:

```
allow create: if request.auth != null
              && request.auth.uid == uid
              && request.resource.data.type is string
              && request.resource.data.type in [
                   'TimerStarted', 'TimerPaused', 'TimerCompleted',
                   'TimerEndedEarly', 'IdleDetected', 'DistractionLogged',
                   'FalseAlarmMarked'
                 ]
              && request.resource.data.sessionId is string
              && request.resource.data.timestamp is string
              && request.resource.data.payload is map;

allow update, delete: if false;
```

**Schema validation breakdown:**

| Check | Purpose |
|---|---|
| `request.auth != null` | Ensures the user is authenticated. |
| `request.auth.uid == uid` | Ensures the user can only write to their own subcollection. |
| `request.resource.data.type is string` | Ensures the `type` field exists and is a string. |
| `type in [...]` | Allowlist of valid event types. Prevents injection of arbitrary event types. |
| `request.resource.data.sessionId is string` | Ensures the `sessionId` field exists and is a string. |
| `request.resource.data.timestamp is string` | Ensures the `timestamp` field exists and is a string. |
| `request.resource.data.payload is map` | Ensures the `payload` field exists and is an object/map. |
| `allow update, delete: if false` | Immutability enforcement. No client can modify or delete events. |

**What this does NOT validate:**

- **Payload shape per event type:** The rule does not validate that a `TimerCompleted` event has `durationSeconds`, `startedAt`, `completedAt`, etc. This is intentional — security rules have a 1MB evaluation limit and complex per-type validation would be fragile. Cloud Functions validate payload structure during processing (→ §8.2.2).
- **Timestamp format:** The rule checks `timestamp is string` but not that it's valid ISO 8601. Cloud Functions validate format during processing.
- **Session event ordering:** The rule does not check that `TimerStarted` precedes `TimerCompleted`. Cloud Functions validate event sequences.

#### 7.4.3. Server-Computed Fields: Read-Only for Client

```
match /stats/{document=**} {
  allow read: if request.auth != null && request.auth.uid == uid;
  allow write: if false;
}

match /achievements/{achievementId} {
  allow read: if request.auth != null && request.auth.uid == uid;
  allow write: if false;
}
```

These rules ensure that:

1. **Clients can read their own aggregates and achievements** — Angular needs to display daily stats, streaks, and badges.
2. **Clients CANNOT write to these documents** — `allow write: if false` is an absolute deny. Only Cloud Functions (using the Admin SDK, which bypasses security rules) can create and update these documents.
3. **The wildcard `{document=**}`** on stats covers both `stats/daily/{date}` and `stats/streaks` subcollection paths.

**Why `allow write: if false` instead of no rule at all:**

Firestore's default behavior with no matching rule is to deny access. However, explicitly writing `allow write: if false` serves as documentation and prevents accidental permission grants if a parent rule is too permissive.

#### 7.4.4. Rate Limiting Considerations

Firestore security rules do not natively support rate limiting. However, abuse prevention is addressed at multiple levels:

**1. Firebase App Check (recommended for production):**

App Check verifies that requests come from a legitimate Sentinel app instance, not a script or modified client. Configuration:

```typescript
// File: src/app/core/firebase.provider.ts (addition)

import { provideAppCheck, initializeAppCheck, ReCaptchaV3Provider } from '@angular/fire/app-check';

export const firebaseProviders = [
  // ... existing providers ...
  provideAppCheck(() =>
    initializeAppCheck(undefined, {
      provider: new ReCaptchaV3Provider('RECAPTCHA_V3_SITE_KEY'),
      isTokenAutoRefreshEnabled: true,
    }),
  ),
];
```

**2. Cloud Function throttling:**

Cloud Functions can track event creation rate per user and flag accounts exceeding reasonable thresholds:

- **Reasonable threshold:** A focus session generates at most ~10 events (1 start, 1 complete, up to 8 interventions). At most 4 sessions per hour. Maximum ~40 events per hour per user.
- **Abuse flag:** If a user creates >100 events in a 10-minute window, the Cloud Function sets a `flagged: true` field on the user's profile document. Flagged users' achievements are suspended pending review.

**3. Firestore write quotas:**

Firestore enforces a default maximum of 1 write per second per document. Since every Event Ledger event is a NEW document (unique `eventId`), this limit is per-document and does not throttle normal usage. The subcollection itself can handle thousands of writes per second.

**4. Security rule compute limits:**

Firestore evaluates security rules within a 1MB compute budget per request. The target rules are simple (no recursive reads, no `get()` calls) and well within this budget.

---

### 7.5. Data Migration: SQLite → Firestore

This subsection specifies the one-time migration utility that transfers existing local data (SQLite database) to the target Firestore architecture. Users upgrading from the source WPF/React app to the target Photino/Angular app must have their historical data preserved.

#### 7.5.1. One-Time Migration Utility for Existing Local Data

**Migration trigger:**

The migration runs automatically on first launch of the target Sentinel app if:

1. A SQLite database exists at `%LOCALAPPDATA%\Sentinel\sentinel.db`.
2. A migration marker file does NOT exist at `%LOCALAPPDATA%\Sentinel\.migration-complete`.
3. The user is authenticated (migration requires a valid UID to write to Firestore).

**Migration flow:**

```
Target app launches
  → C# shell checks for sentinel.db existence
    → if exists AND no .migration-complete marker:
      → C# shell sends IPC: { type: 'MIGRATION_AVAILABLE', payload: { sessionCount, distractionCount } }
      → Angular shows migration prompt: "Found X sessions and Y distractions from your previous installation. Migrate to cloud?"
        → User confirms → Angular sends IPC: { type: 'START_MIGRATION' }
          → C# shell reads SQLite → sends chunks via IPC: { type: 'MIGRATION_CHUNK', payload: { events: [...] } }
          → Angular writes each chunk to Firestore
          → C# shell sends IPC: { type: 'MIGRATION_COMPLETE' }
          → C# shell creates .migration-complete marker file
          → C# shell renames sentinel.db to sentinel.db.migrated (backup, not deleted)
        → User declines → Angular sends IPC: { type: 'SKIP_MIGRATION' }
          → C# shell creates .migration-complete marker file
          → No data is migrated; sentinel.db is preserved unchanged
```

**C# shell migration reader:**

```csharp
// File: Sentinel.Shell\Services\MigrationService.cs

using Microsoft.Data.Sqlite;
using System.Text.Json;

public class MigrationService
{
    private readonly string _dbPath;
    private readonly string _markerPath;
    private const int ChunkSize = 50;

    public MigrationService()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var sentinelDir = Path.Combine(appData, "Sentinel");
        _dbPath = Path.Combine(sentinelDir, "sentinel.db");
        _markerPath = Path.Combine(sentinelDir, ".migration-complete");
    }

    public bool IsMigrationAvailable()
    {
        return File.Exists(_dbPath) && !File.Exists(_markerPath);
    }

    public (int sessions, int distractions) GetMigrationCounts()
    {
        using var connection = new SqliteConnection($"Data Source={_dbPath}");
        connection.Open();

        using var sessionCmd = connection.CreateCommand();
        sessionCmd.CommandText = "SELECT COUNT(*) FROM Sessions";
        var sessions = Convert.ToInt32(sessionCmd.ExecuteScalar());

        using var distractionCmd = connection.CreateCommand();
        distractionCmd.CommandText = "SELECT COUNT(*) FROM Distractions";
        var distractions = Convert.ToInt32(distractionCmd.ExecuteScalar());

        return (sessions, distractions);
    }

    public IEnumerable<string> ReadSessionsAsEventChunks()
    {
        using var connection = new SqliteConnection($"Data Source={_dbPath}");
        connection.Open();

        using var cmd = connection.CreateCommand();
        cmd.CommandText = @"
            SELECT Id, DurationSeconds, StartedAt, CompletedAt, SessionName, EndedEarly
            FROM Sessions
            ORDER BY StartedAt ASC";

        using var reader = cmd.ExecuteReader();
        var chunk = new List<object>();

        while (reader.Read())
        {
            var sessionId = Guid.NewGuid().ToString();
            var startedAt = reader.GetDateTime(2).ToString("o");
            var completedAt = reader.IsDBNull(3) ? null : reader.GetDateTime(3).ToString("o");
            var durationSeconds = reader.GetInt32(1);
            var sessionName = reader.IsDBNull(4) ? null : reader.GetString(4);
            var endedEarly = reader.GetBoolean(5);

            // Generate TimerStarted event
            chunk.Add(new
            {
                type = "TimerStarted",
                sessionId,
                timestamp = startedAt,
                payload = new
                {
                    durationSeconds,
                    sessionName,
                    startedAt,
                    timerMode = "pomodoro",
                    presetName = (string?)null,
                },
                migrated = true,
            });

            // Generate TimerCompleted or TimerEndedEarly event
            var completionType = endedEarly ? "TimerEndedEarly" : "TimerCompleted";
            chunk.Add(new
            {
                type = completionType,
                sessionId,
                timestamp = completedAt ?? startedAt,
                payload = new
                {
                    durationSeconds,
                    sessionName,
                    startedAt,
                    completedAt = completedAt ?? startedAt,
                    endedEarly,
                    distractionCount = 0,
                    falseAlarmCount = 0,
                },
                migrated = true,
            });

            if (chunk.Count >= ChunkSize * 2)
            {
                yield return JsonSerializer.Serialize(chunk,
                    new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
                chunk.Clear();
            }
        }

        if (chunk.Count > 0)
        {
            yield return JsonSerializer.Serialize(chunk,
                new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
        }
    }

    public IEnumerable<string> ReadDistractionsAsEventChunks()
    {
        using var connection = new SqliteConnection($"Data Source={_dbPath}");
        connection.Open();

        using var cmd = connection.CreateCommand();
        cmd.CommandText = @"
            SELECT Id, Note, NormalizedNote, CategoryName, Timestamp, IsFalseAlarm
            FROM Distractions
            ORDER BY Timestamp ASC";

        using var reader = cmd.ExecuteReader();
        var chunk = new List<object>();

        while (reader.Read())
        {
            var note = reader.GetString(1);
            var normalizedNote = reader.GetString(2);
            var categoryName = reader.IsDBNull(3) ? null : reader.GetString(3);
            var timestamp = reader.GetDateTime(4).ToString("o");
            var isFalseAlarm = reader.GetBoolean(5);

            // Distractions from SQLite don't have sessionId — generate a synthetic one
            // grouped by timestamp proximity (within 30 minutes = same session).
            var eventType = isFalseAlarm ? "FalseAlarmMarked" : "DistractionLogged";

            var eventObj = new Dictionary<string, object?>
            {
                ["type"] = eventType,
                ["sessionId"] = "migrated-" + Guid.NewGuid().ToString(),
                ["timestamp"] = timestamp,
                ["migrated"] = true,
            };

            if (isFalseAlarm)
            {
                eventObj["payload"] = new { };
            }
            else
            {
                eventObj["payload"] = new
                {
                    note,
                    normalizedNote,
                    categoryName,
                };
            }

            chunk.Add(eventObj);

            if (chunk.Count >= ChunkSize)
            {
                yield return JsonSerializer.Serialize(chunk,
                    new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
                chunk.Clear();
            }
        }

        if (chunk.Count > 0)
        {
            yield return JsonSerializer.Serialize(chunk,
                new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
        }
    }

    public void MarkMigrationComplete()
    {
        File.WriteAllText(_markerPath, DateTime.UtcNow.ToString("o"));

        // Rename the SQLite database to .migrated (backup, not deleted)
        var migratedPath = _dbPath + ".migrated";
        if (File.Exists(_dbPath) && !File.Exists(migratedPath))
        {
            File.Move(_dbPath, migratedPath);
        }
    }
}
```

**IPC message shapes for migration:**

| Message | Direction | Shape |
|---|---|---|
| `MIGRATION_AVAILABLE` | C# → Angular | `{ type: 'MIGRATION_AVAILABLE', payload: { sessionCount: number, distractionCount: number } }` |
| `START_MIGRATION` | Angular → C# | `{ type: 'START_MIGRATION' }` |
| `MIGRATION_CHUNK` | C# → Angular | `{ type: 'MIGRATION_CHUNK', payload: { events: SessionEvent[], chunkIndex: number, totalChunks: number } }` |
| `MIGRATION_COMPLETE` | C# → Angular | `{ type: 'MIGRATION_COMPLETE', payload: { migratedSessions: number, migratedDistractions: number } }` |
| `SKIP_MIGRATION` | Angular → C# | `{ type: 'SKIP_MIGRATION' }` |

#### 7.5.2. Session History Backfill as Ledger Events

Each source SQLite `Session` row is converted to a pair of Event Ledger events:

```
Source SQLite Session row:
  { Id: 42, DurationSeconds: 1500, StartedAt: '2026-03-15T09:00:00Z',
    CompletedAt: '2026-03-15T09:25:00Z', SessionName: null, EndedEarly: false }

Target Event Ledger events:
  1. { type: 'TimerStarted', sessionId: 'new-uuid', timestamp: '2026-03-15T09:00:00Z',
       payload: { durationSeconds: 1500, sessionName: null, startedAt: '2026-03-15T09:00:00Z',
                  timerMode: 'pomodoro', presetName: null }, migrated: true }

  2. { type: 'TimerCompleted', sessionId: 'same-uuid', timestamp: '2026-03-15T09:25:00Z',
       payload: { durationSeconds: 1500, sessionName: null, startedAt: '2026-03-15T09:00:00Z',
                  completedAt: '2026-03-15T09:25:00Z', endedEarly: false,
                  distractionCount: 0, falseAlarmCount: 0 }, migrated: true }
```

**Key decisions:**

| Decision | Rationale |
|---|---|
| New `sessionId` (UUID) for each migrated session | Source SQLite `Id` is an integer auto-increment with no semantic meaning. Cannot be reused as a Firestore path segment. |
| `timerMode` defaults to `'pomodoro'` | Source sessions don't record timer mode. All sessions are assumed to be pomodoro sessions. |
| `distractionCount: 0` / `falseAlarmCount: 0` | Source sessions don't record per-session distraction counts. These are set to 0 for migrated sessions. Cloud Functions can optionally recompute from migrated distraction events. |
| `migrated: true` flag | Extra field on migrated events to distinguish them from organically created events. Cloud Functions check this flag to avoid re-processing already-aggregated data during migration. |
| `presetName: null` | Source sessions don't track presets. |

**Session event correlation with distractions:**

Source SQLite doesn't have a `sessionId` FK on distractions — there's no way to correlate which distractions belong to which session. Migrated distractions get synthetic `sessionId` values (→ §7.5.3). Cloud Functions process migrated events differently: the `migrated: true` flag triggers a migration-specific aggregation path that doesn't attempt to deduct idle time or calculate Swift Recovery for historical data.

#### 7.5.3. Distraction History Backfill

Each source SQLite `Distraction` row is converted to either a `DistractionLogged` event or a `FalseAlarmMarked` event:

```
Source SQLite Distraction row (non-false-alarm):
  { Id: 123, Note: 'Twitter', NormalizedNote: 'twitter', CategoryName: 'Social Media',
    Timestamp: '2026-03-15T09:10:00Z', IsFalseAlarm: false }

Target Event Ledger event:
  { type: 'DistractionLogged', sessionId: 'migrated-new-uuid',
    timestamp: '2026-03-15T09:10:00Z',
    payload: { note: 'Twitter', normalizedNote: 'twitter', categoryName: 'Social Media' },
    migrated: true }

Source SQLite Distraction row (false alarm):
  { Id: 124, Note: '', NormalizedNote: '', CategoryName: null,
    Timestamp: '2026-03-15T09:12:00Z', IsFalseAlarm: true }

Target Event Ledger event:
  { type: 'FalseAlarmMarked', sessionId: 'migrated-new-uuid',
    timestamp: '2026-03-15T09:12:00Z',
    payload: {},
    migrated: true }
```

**Synthetic `sessionId` for migrated distractions:**

Since source distractions don't reference a session, each migrated distraction gets a unique synthetic `sessionId` prefixed with `"migrated-"`. This ensures:

1. Migrated distractions don't accidentally correlate with migrated sessions (session-distraction correlation is not reconstructable from the source data).
2. Cloud Functions can identify migrated distractions by the `"migrated-"` prefix or the `migrated: true` flag.
3. The `sessionId` field is still populated (required by security rules and event envelope schema).

**Taxonomy backfill:**

During distraction migration, the Angular migration service also upserts taxonomy documents:

```typescript
// File: src/app/core/migration.service.ts (excerpt)

private async backfillTaxonomy(distractions: MigratedDistraction[]): Promise<void> {
  const uid = this.authService.uid;
  if (!uid) return;

  // Group by normalizedNote
  const groups = new Map<string, {
    note: string;
    normalizedNote: string;
    categoryName: string | null;
    count: number;
    lastSeenAt: string;
    firstSeenAt: string;
  }>();

  for (const d of distractions) {
    if (d.isFalseAlarm) continue;

    const existing = groups.get(d.normalizedNote);
    if (existing) {
      existing.count++;
      if (d.timestamp > existing.lastSeenAt) {
        existing.lastSeenAt = d.timestamp;
        existing.note = d.note;
        existing.categoryName = d.categoryName;
      }
      if (d.timestamp < existing.firstSeenAt) {
        existing.firstSeenAt = d.timestamp;
      }
    } else {
      groups.set(d.normalizedNote, {
        note: d.note,
        normalizedNote: d.normalizedNote,
        categoryName: d.categoryName,
        count: 1,
        lastSeenAt: d.timestamp,
        firstSeenAt: d.timestamp,
      });
    }
  }

  // Write taxonomy documents
  const batch = writeBatch(this.firestore);

  for (const [normalizedNote, group] of groups) {
    const docRef = doc(this.firestore, `users/${uid}/taxonomy/${normalizedNote}`);
    batch.set(docRef, {
      note: group.note,
      normalizedNote: group.normalizedNote,
      categoryName: group.categoryName,
      count: group.count,
      lastSeenAt: group.lastSeenAt,
      createdAt: group.firstSeenAt,
      updatedAt: group.lastSeenAt,
    });
  }

  await batch.commit();
}
```

#### 7.5.4. Deduplication Strategy for Migrated Records

**Problem:** If the migration is interrupted (app crash, network error mid-migration) and re-run, events could be duplicated. Additionally, the source SQLite data may overlap with data already synced to Firestore via the source app's `syncSessionToFirestore()`.

**Deduplication at migration time:**

1. **Migration marker:** The `.migration-complete` marker file prevents the migration from running twice. If the marker exists, the migration is skipped entirely — even if only partial data was migrated.

2. **Idempotent migration chunking:** Each chunk is written to Firestore using `addDoc()` (auto-generated IDs). If a chunk is written twice due to a retry, duplicate events are created. This is handled post-migration by Cloud Functions.

3. **Cloud Function deduplication:** When Cloud Functions process events with `migrated: true`, they use the following deduplication strategy:
   - For `TimerStarted`/`TimerCompleted` pairs: check if a daily aggregate for that date already includes the session's `durationSeconds`. If the aggregate's `totalFocusSeconds` would exceed a plausible daily maximum (e.g., 24 hours), flag the duplicate.
   - For `DistractionLogged`: check if a taxonomy document already has a `count` equal to or greater than the migrated total. If so, skip incrementing.

4. **Pre-migration cleanup of source Firestore data:** Before writing migrated events, the Angular migration service queries the EXISTING flat `sessions` and `distractions` collections (source schema) for documents with `userId == uid`. If found, these are counted but NOT deleted (the target user-scoped collections are separate from the source flat collections). The migration proceeds regardless — the old flat collections are orphaned and can be cleaned up later by an admin Cloud Function.

**Migration progress tracking:**

The Angular migration service tracks progress via a local `migration-progress` key in `localStorage`:

```typescript
interface MigrationProgress {
  totalSessions: number;
  totalDistractions: number;
  migratedSessions: number;
  migratedDistractions: number;
  lastChunkIndex: number;
  startedAt: string;
}
```

If the app restarts during migration, the service reads `localStorage` and resumes from `lastChunkIndex + 1`. This prevents re-writing already-migrated chunks.

**Post-migration verification:**

After migration completes, the Angular migration service displays a summary:

```
Migration Complete
  Sessions migrated: 142
  Distractions migrated: 387
  Taxonomy categories created: 8
  
  Your historical data is now available in Reports.
  The original database has been backed up to sentinel.db.migrated.
```

---

### 7.6. Angular Service Architecture for Sync

This subsection provides a structural overview of how the sync-related Angular services are organized and how they interact.

**Service dependency graph:**

```
┌─────────────────────────────────────────────────────────────┐
│                    Angular Services                          │
│                                                             │
│  ┌──────────────┐    ┌──────────────────┐                   │
│  │  AuthService  │◄──┤  All services    │ (provides uid)    │
│  └──────┬───────┘    └──────────────────┘                   │
│         │                                                    │
│  ┌──────▼───────┐    ┌──────────────────┐                   │
│  │  IpcService   │◄──┤  SettingsService │ (SAVE_SETTINGS)   │
│  └──────────────┘    │  TimerService    │ (SESSION_COMPLETE) │
│                      └──────────────────┘                   │
│                                                             │
│  ┌──────────────────────────────────────────────┐           │
│  │            EventLedgerService                 │           │
│  │  writeEvent() → addDoc(session_events)        │           │
│  └──────────────────┬───────────────────────────┘           │
│                     │                                        │
│  ┌──────────────────▼───────────────────────────┐           │
│  │  Used by:                                     │           │
│  │  • TimerService (start, pause, complete, end) │           │
│  │  • IpcDispatchService (idle detected)         │           │
│  │  • InterventionComponent (distraction, false) │           │
│  └──────────────────────────────────────────────┘           │
│                                                             │
│  ┌──────────────────┐  ┌────────────────────┐               │
│  │ TaxonomyService   │  │  SettingsService   │               │
│  │ upsertMapping()   │  │  updateSettings()  │               │
│  │ renameCategory()  │  │  attachListener()  │               │
│  │ deleteCategory()  │  └────────────────────┘               │
│  │ attachListener()  │                                       │
│  └──────────────────┘  ┌────────────────────┐               │
│                        │  PlannerService     │               │
│  ┌──────────────────┐  │  createBlock()      │               │
│  │  ReportService    │  │  updateBlock()     │               │
│  │  loadReport()     │  │  deleteBlock()     │               │
│  │  attachListeners()│  └────────────────────┘               │
│  └──────────────────┘                                       │
│                        ┌────────────────────┐               │
│                        │ AchievementService  │               │
│                        │ attachListener()    │               │
│                        └────────────────────┘               │
│                                                             │
│  ┌──────────────────────────────────────────────┐           │
│  │           MigrationService                    │           │
│  │  checkMigration() → startMigration()          │           │
│  │  Uses: EventLedgerService, TaxonomyService    │           │
│  └──────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

**Sync data flow summary (complete lifecycle for a single session):**

```
1. User clicks "Start Focus"
   → TimerService.startSession()
     → EventLedgerService.writeEvent({ type: 'TimerStarted', ... })
       → Firestore addDoc(users/{uid}/session_events) → IndexedDB cache + server queue

2. C# shell detects idle after 45s
   → IPC: IDLE_DETECTED → IpcDispatchService.handleIdleDetected()
     → TimerService.pauseTimer('intervention')
       → EventLedgerService.writeEvent({ type: 'IdleDetected', ... })
       → EventLedgerService.writeEvent({ type: 'TimerPaused', ... })

3. User logs distraction "Twitter" / "Social Media"
   → TimerService.logDistraction('Twitter', 'Social Media')
     → EventLedgerService.writeEvent({ type: 'DistractionLogged', ... })
     → TaxonomyService.upsertMapping('twitter', 'Twitter', 'Social Media')
       → Firestore setDoc(users/{uid}/taxonomy/twitter, { merge: true })

4. Timer reaches zero
   → TimerService.onTimerComplete()
     → EventLedgerService.writeEvent({ type: 'TimerCompleted', ... })
     → IpcService.send({ type: 'SESSION_COMPLETE' })

5. Cloud Function triggers (server-side, → §8)
   → onDocumentCreated(users/{uid}/session_events/{eventId})
     → Processes TimerCompleted event
     → Updates users/{uid}/stats/daily/{date}
     → Updates users/{uid}/stats/streaks
     → Checks achievement thresholds → writes users/{uid}/achievements/{id}

6. Angular snapshot listeners fire
   → ReportService: dailyStats signal updated with new aggregate
   → AchievementService: new badge appears in UI
```

---

### 7.7. Cross-Reference Table

| Section | Source File | Target File / Service | Status |
|---|---|---|---|
| §7.1.1 | `Sentinel.UI\src\firebase.ts` (`enableIndexedDbPersistence`) | `src/app/core/firebase.provider.ts` | PORTED to Angular DI |
| §7.1.2 | `Sentinel.UI\src\App.tsx` (`pendingSyncsRef`, `syncSessionToFirestore`) | ELIMINATED — Firestore native queue | REPLACED |
| §7.1.3 | *(implicit in source)* | Documented conflict resolution strategy | NEW |
| §7.2.1 | `Sentinel.UI\src\App.tsx` (`addDoc` calls) | `SettingsService`, `TaxonomyService`, `PlannerService` | RESTRUCTURED into Angular services |
| §7.2.2 | *(not in source — no snapshot listeners)* | `onSnapshot` listeners in all services | NEW |
| §7.2.3 | *(implicit Firestore cache behavior)* | Documented read priority strategy | NEW |
| §7.3.1 | `Sentinel.UI\src\App.tsx` (`syncSessionToFirestore`, `submitDistraction`) | `EventLedgerService.writeEvent()`, `TimerService` | RESTRUCTURED — 7 event types replace 2 flat writes |
| §7.3.2 | *(source allows update/delete)* | Append-only enforcement at 3 levels | NEW |
| §7.3.3 | `Sentinel.UI\src\App.tsx` (`pendingSyncsRef`) | ELIMINATED | REPLACED by Firestore native queue |
| §7.3.4 | `Sentinel.UI\src\App.tsx` (`serverTimestamp()`) | Client ISO 8601 strings | CHANGED |
| §7.3.5 | *(source uses mutable state documents)* | Anti-tampering rationale documented | NEW |
| §7.4.1 | `firestore.rules` (`resource.data.userId == request.auth.uid`) | `request.auth.uid == uid` (path-based) | CHANGED |
| §7.4.2 | `firestore.rules` (`allow update, delete` on sessions) | `allow update, delete: if false` on events | CHANGED |
| §7.4.3 | *(not in source)* | Read-only rules for stats/achievements | NEW |
| §7.4.4 | *(not in source)* | Rate limiting strategy documented | NEW |
| §7.5.1 | `Sentinel.Engine\SentinelDbContext.cs` (SQLite source) | `MigrationService` (C# reader + Angular writer) | NEW |
| §7.5.2 | `Sentinel.Engine\Models.cs` (`Session`) | Session → Event pair conversion | NEW |
| §7.5.3 | `Sentinel.Engine\Models.cs` (`Distraction`) | Distraction → Event conversion + taxonomy backfill | NEW |
| §7.5.4 | *(not in source)* | Deduplication strategy documented | NEW |
| §7.6 | `Sentinel.UI\src\App.tsx` (monolithic) | Angular service dependency graph | RESTRUCTURED |

## 8. Cloud Functions — Server-Side Authority & Gamification

This section specifies the complete Firebase Cloud Functions backend that processes the Event Ledger, computes aggregates, tracks streaks, awards achievements, and implements the gamification mechanics. Every computation in this section runs exclusively on the server. The Angular client NEVER computes gamification metrics — it only reads the results from Firestore documents written by these functions.

**Governing directive** (TARGET_ARCHITECTURE.md §6):

> To prevent users from cheating by editing local IndexedDB or SQLite files, all gamification logic is strictly server-side.
> - **Ledger Processing:** Firebase Cloud Functions listen to `onDocumentCreated` triggers on the `session_events` collection.
> - **Calculations:** The server processes the immutable events to calculate total focus time, daily streaks, and distraction recovery times.

**Source codebase equivalent:**

The source application has NO server-side processing. All calculations are performed client-side:
- `ReportingService.cs` (`Sentinel.Engine\ReportingService.cs`) — C# service that queries SQLite to compute `ReportData` (total focus seconds, sessions completed, distractions count, daily breakdown, top categories, top distractions, recent sessions). This logic is ELIMINATED in the target and replaced by Cloud Functions.
- `App.tsx:fetchFirestoreHistory()` — React function that reads flat `sessions` and `distractions` Firestore collections and merges counts with local SQLite data using `Math.max()`. This logic is ELIMINATED.

**What Section 8 replaces:**

| Source Component | Source Location | Cloud Function Replacement |
|---|---|---|
| `ReportingService.GetReportDataAsync()` | `Sentinel.Engine\ReportingService.cs` | §8.3 Focus Time Calculation + §8.3.4 Daily Aggregate |
| `App.tsx:fetchFirestoreHistory()` | `Sentinel.UI\src\App.tsx` lines 710–759 | §8.3.4 Daily Aggregate (Angular reads aggregates, not raw events) |
| *(no source equivalent)* | — | §8.4 Streak Tracking Engine |
| *(no source equivalent)* | — | §8.5 Achievement & Badge System |
| *(no source equivalent)* | — | §8.6 Swift Recovery Multiplier |
| *(no source equivalent)* | — | §8.7 Shiny Badge RNG System |

---

### 8.1. Function Deployment & Configuration

#### 8.1.1. Firebase Functions Runtime (Node.js / TypeScript)

Cloud Functions are written in TypeScript and run on the Firebase Functions (2nd gen) runtime, which uses Cloud Run under the hood.

**Project structure:**

```
functions/
  package.json
  tsconfig.json
  .eslintrc.js
  src/
    index.ts                     ← Function exports (entry point)
    config.ts                    ← Environment configuration
    types.ts                     ← Shared TypeScript interfaces
    pipeline/
      event-processor.ts         ← Main onDocumentCreated handler
      event-validator.ts         ← Schema validation
      idempotency.ts             ← Double-processing guard
      event-dispatcher.ts        ← Route to type-specific handlers
    handlers/
      timer-completed.ts         ← TimerCompleted / TimerEndedEarly
      distraction-logged.ts      ← DistractionLogged + Swift Recovery
      false-alarm.ts             ← FalseAlarmMarked
      idle-detected.ts           ← IdleDetected (no-op currently, reserved)
      timer-started.ts           ← TimerStarted (no-op currently, reserved)
      timer-paused.ts            ← TimerPaused (no-op currently, reserved)
    engines/
      daily-aggregate.ts         ← Daily stats computation
      streak.ts                  ← Streak tracking
      achievement.ts             ← Achievement check pipeline
      swift-recovery.ts          ← Swift Recovery Multiplier
      shiny-badge.ts             ← Shiny Badge RNG system
```

**`package.json` (key dependencies):**

```json
{
  "name": "sentinel-functions",
  "main": "lib/index.js",
  "engines": {
    "node": "20"
  },
  "dependencies": {
    "firebase-admin": "^12.0.0",
    "firebase-functions": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint": "^8.57.0"
  },
  "scripts": {
    "build": "tsc",
    "serve": "firebase emulators:start --only functions",
    "deploy": "firebase deploy --only functions",
    "test": "jest --config jest.config.js"
  }
}
```

**`tsconfig.json`:**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "outDir": "lib",
    "sourceMap": true,
    "strict": true,
    "target": "es2022",
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "compileOnSave": true,
  "include": ["src"]
}
```

**Function entry point** (`src/index.ts`):

```typescript
// File: functions/src/index.ts

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { processSessionEvent } from './pipeline/event-processor';
import { FUNCTION_CONFIG } from './config';

// Global configuration for all functions
setGlobalOptions({
  region: FUNCTION_CONFIG.region,
  memory: FUNCTION_CONFIG.memory,
  timeoutSeconds: FUNCTION_CONFIG.timeoutSeconds,
});

/**
 * Main trigger: fires whenever a new event is created in any user's session_events collection.
 *
 * This is the ONLY Cloud Function trigger. All processing fans out from here
 * via the event dispatcher (→ §8.2.4).
 */
export const onSessionEventCreated = onDocumentCreated(
  'users/{uid}/session_events/{eventId}',
  async (event) => {
    await processSessionEvent(event);
  },
);
```

#### 8.1.2. Region & Memory Allocation

**Configuration** (`src/config.ts`):

```typescript
// File: functions/src/config.ts

export const FUNCTION_CONFIG = {
  /** Firebase Functions region. Use the region closest to the majority of users. */
  region: 'us-central1',

  /** Memory allocation. 256MB is sufficient for event processing. */
  memory: '256MiB' as const,

  /** Timeout in seconds. Event processing should complete in <10s. */
  timeoutSeconds: 60,

  /** Maximum instances to prevent runaway scaling. */
  maxInstances: 100,

  /**
   * Minimum focus seconds to count a day toward a streak.
   * A user must complete at least this many seconds of focused work
   * for the day to count. Default: 0 (any completed session counts).
   */
  streakMinimumFocusSeconds: 0,

  /**
   * Swift Recovery threshold in milliseconds.
   * If the user logs a distraction within this duration after IdleDetected,
   * they earn a Swift Recovery bonus.
   */
  swiftRecoveryThresholdMs: 60_000,

  /**
   * Swift Recovery speed tiers (ms thresholds).
   * Each tier awards a different multiplier.
   */
  swiftRecoveryTiers: {
    instant: 15_000,   // < 15 seconds
    fast: 30_000,      // < 30 seconds
    swift: 60_000,     // < 60 seconds
  },

  /**
   * Shiny badge drop rate (probability out of 1.0).
   * On a perfect session, the RNG rolls this chance.
   */
  shinyBadgeDropRate: 0.05, // 5% base chance

  /**
   * Maximum plausible session duration in seconds.
   * Events claiming longer durations are rejected.
   */
  maxSessionDurationSeconds: 86_400, // 24 hours

  /**
   * Maximum acceptable clock skew in milliseconds.
   * Events with timestamps more than this far in the future are rejected.
   */
  maxClockSkewMs: 5 * 60 * 1000, // 5 minutes
} as const;
```

**Scaling rationale:**

- **256MiB memory:** Event processing reads 1-3 Firestore documents and writes 1-3 documents. No large data sets, no image processing, no ML inference. 256MiB is more than sufficient.
- **60s timeout:** Normal processing completes in 1-5 seconds. The 60s timeout is a safety net for cases where Firestore reads are slow (cold region, network latency).
- **100 max instances:** At peak, a single user generates ~40 events/hour. With 1,000 concurrent users, that's 40,000 events/hour = ~11 events/second. Each function invocation takes <5s, so 100 instances can handle 20+ events/second with headroom.

#### 8.1.3. Environment Variables & Secrets

Cloud Functions do not require external API keys or secrets for Firestore operations — the Firebase Admin SDK authenticates automatically via the service account attached to the Cloud Functions runtime.

**No environment variables are needed for MVP.** All configuration is hardcoded in `config.ts`. If future requirements add external integrations (e.g., email notifications, Slack webhooks), secrets should be stored using Firebase Secret Manager:

```typescript
import { defineSecret } from 'firebase-functions/params';

const slackWebhookUrl = defineSecret('SLACK_WEBHOOK_URL');

export const onSessionEventCreated = onDocumentCreated(
  {
    document: 'users/{uid}/session_events/{eventId}',
    secrets: [slackWebhookUrl],
  },
  async (event) => {
    // Access via slackWebhookUrl.value()
  },
);
```

---

### 8.2. Event Ledger Processing Pipeline

The processing pipeline is the central nervous system of the Cloud Functions backend. Every event that enters the `session_events` collection flows through a four-stage pipeline:

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Event Processing Pipeline                        │
│                                                                      │
│  onDocumentCreated                                                   │
│  └─► Stage 1: Event Validation (§8.2.2)                             │
│       └─► Stage 2: Idempotency Guard (§8.2.3)                      │
│            └─► Stage 3: Event Dispatcher (§8.2.4)                   │
│                 └─► Stage 4: Type-Specific Handler                  │
│                      ├─► TimerCompleted → DailyAggregate → Streak   │
│                      │                  → Achievement → ShinyBadge  │
│                      ├─► TimerEndedEarly → DailyAggregate → Streak  │
│                      │                   → Achievement              │
│                      ├─► DistractionLogged → DailyAggregate         │
│                      │                    → SwiftRecovery           │
│                      │                    → Achievement             │
│                      ├─► FalseAlarmMarked → DailyAggregate          │
│                      ├─► IdleDetected → (no-op, reserved)           │
│                      ├─► TimerStarted → (no-op, reserved)           │
│                      └─► TimerPaused → (no-op, reserved)            │
└──────────────────────────────────────────────────────────────────────┘
```

#### 8.2.1. `onDocumentCreated` Trigger on `users/{uid}/session_events/{eventId}`

**Trigger path:** `users/{uid}/session_events/{eventId}`

**How `onDocumentCreated` works:**

1. When Angular writes a new event document via `addDoc()`, Firestore creates the document in the server database.
2. Firestore emits a `create` event to Cloud Functions.
3. The Cloud Function receives a `FirestoreEvent` object containing:
   - `event.data` — a `QueryDocumentSnapshot` with the full document data.
   - `event.params.uid` — the `{uid}` path parameter (the authenticated user's UID).
   - `event.params.eventId` — the `{eventId}` path parameter (the auto-generated document ID).

**Important timing detail:** The trigger fires when the document reaches the Firestore SERVER, not when it's written to the client's local IndexedDB cache. If the client is offline, the trigger fires when the client comes back online and the pending write syncs.

**Pipeline entry point** (`src/pipeline/event-processor.ts`):

```typescript
// File: functions/src/pipeline/event-processor.ts

import { FirestoreEvent, QueryDocumentSnapshot } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { validateEvent } from './event-validator';
import { checkIdempotency, markProcessed } from './idempotency';
import { dispatchEvent } from './event-dispatcher';
import type { SessionEvent } from '../types';

export async function processSessionEvent(
  event: FirestoreEvent<QueryDocumentSnapshot | undefined>,
): Promise<void> {
  const snapshot = event.data;
  if (!snapshot) {
    logger.warn('Event triggered with no data', { eventId: event.params.eventId });
    return;
  }

  const uid = event.params.uid;
  const eventId = event.params.eventId;
  const rawData = snapshot.data();

  // Stage 1: Validate event schema
  const validatedEvent = validateEvent(rawData, eventId);
  if (!validatedEvent) {
    logger.error('Event validation failed', { uid, eventId, rawData });
    return;
  }

  // Stage 2: Idempotency guard
  const alreadyProcessed = await checkIdempotency(uid, eventId);
  if (alreadyProcessed) {
    logger.info('Event already processed, skipping', { uid, eventId });
    return;
  }

  // Stage 3 + 4: Dispatch to type-specific handler
  try {
    await dispatchEvent(uid, eventId, validatedEvent);
    await markProcessed(uid, eventId, validatedEvent.type);
    logger.info('Event processed successfully', {
      uid,
      eventId,
      type: validatedEvent.type,
      sessionId: validatedEvent.sessionId,
    });
  } catch (error) {
    logger.error('Event processing failed', { uid, eventId, error });
    throw error; // Rethrow to trigger Cloud Functions retry
  }
}
```

#### 8.2.2. Event Validation & Schema Enforcement

The validator ensures every event conforms to the `SessionEvent` envelope and that payload fields are plausible. This is the server-side complement to the Firestore security rules (→ §7.4.2), which perform basic type checks but not semantic validation.

**Shared types** (`src/types.ts`):

```typescript
// File: functions/src/types.ts

export type SessionEventType =
  | 'TimerStarted'
  | 'TimerPaused'
  | 'TimerCompleted'
  | 'TimerEndedEarly'
  | 'IdleDetected'
  | 'DistractionLogged'
  | 'FalseAlarmMarked';

export const VALID_EVENT_TYPES: ReadonlySet<string> = new Set<SessionEventType>([
  'TimerStarted',
  'TimerPaused',
  'TimerCompleted',
  'TimerEndedEarly',
  'IdleDetected',
  'DistractionLogged',
  'FalseAlarmMarked',
]);

export interface SessionEvent {
  type: SessionEventType;
  sessionId: string;
  timestamp: string;
  payload: Record<string, unknown>;
  migrated?: boolean;
}

export interface TimerStartedPayload {
  durationSeconds: number;
  sessionName: string | null;
  startedAt: string;
  timerMode: string;
  presetName: string | null;
}

export interface TimerPausedPayload {
  pausedAt: string;
  timeLeftSeconds: number;
  reason: 'manual' | 'intervention' | 'suspend';
}

export interface TimerCompletedPayload {
  durationSeconds: number;
  sessionName: string | null;
  startedAt: string;
  completedAt: string;
  endedEarly: boolean;
  distractionCount: number;
  falseAlarmCount: number;
}

export interface IdleDetectedPayload {
  idleDurationMs: number;
  timerTimeLeftSeconds: number;
}

export interface DistractionLoggedPayload {
  note: string;
  normalizedNote: string;
  categoryName: string | null;
}

// FalseAlarmMarked has empty payload: {}

export interface DailyStatsDocument {
  date: string;
  totalFocusSeconds: number;
  sessionsCompleted: number;
  sessionsEndedEarly: number;
  distractionsLogged: number;
  falseAlarms: number;
  avgSessionSeconds: number;
  longestSessionSeconds: number;
  swiftRecoveryCount: number;
  updatedAt: string;
}

export interface StreakDocument {
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string;
  streakStartDate: string;
  updatedAt: string;
}

export interface AchievementDocument {
  achievementId: string;
  tier: 'bronze' | 'silver' | 'gold';
  category: 'focus' | 'streak' | 'recovery' | 'perfect';
  title: string;
  description: string;
  earnedAt: string;
  isShiny: boolean;
  progress: {
    current: number;
    target: number;
  };
}
```

**Validator implementation** (`src/pipeline/event-validator.ts`):

```typescript
// File: functions/src/pipeline/event-validator.ts

import { logger } from 'firebase-functions/v2';
import { VALID_EVENT_TYPES, FUNCTION_CONFIG } from '../config';
import type { SessionEvent } from '../types';

/**
 * Validates the raw Firestore document data against the SessionEvent schema.
 * Returns a typed SessionEvent if valid, or null if invalid.
 */
export function validateEvent(
  data: Record<string, unknown>,
  eventId: string,
): SessionEvent | null {
  // Required string fields
  if (typeof data.type !== 'string' || !VALID_EVENT_TYPES.has(data.type)) {
    logger.warn('Invalid event type', { eventId, type: data.type });
    return null;
  }

  if (typeof data.sessionId !== 'string' || data.sessionId.length === 0) {
    logger.warn('Missing or empty sessionId', { eventId });
    return null;
  }

  if (typeof data.timestamp !== 'string' || data.timestamp.length === 0) {
    logger.warn('Missing or empty timestamp', { eventId });
    return null;
  }

  // Validate timestamp is parseable ISO 8601
  const ts = Date.parse(data.timestamp);
  if (isNaN(ts)) {
    logger.warn('Unparseable timestamp', { eventId, timestamp: data.timestamp });
    return null;
  }

  // Reject future-dated events (clock skew protection)
  const now = Date.now();
  if (ts > now + FUNCTION_CONFIG.maxClockSkewMs) {
    logger.warn('Future-dated event rejected', {
      eventId,
      timestamp: data.timestamp,
      skewMs: ts - now,
    });
    return null;
  }

  // Reject events older than 1 year (stale data protection)
  const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
  if (ts < oneYearAgo) {
    logger.warn('Event older than 1 year rejected', { eventId, timestamp: data.timestamp });
    return null;
  }

  // Payload must be an object
  if (typeof data.payload !== 'object' || data.payload === null || Array.isArray(data.payload)) {
    logger.warn('Invalid payload (not an object)', { eventId });
    return null;
  }

  // Type-specific payload validation
  const payload = data.payload as Record<string, unknown>;

  if (data.type === 'TimerCompleted' || data.type === 'TimerEndedEarly') {
    if (typeof payload.durationSeconds !== 'number' || payload.durationSeconds <= 0) {
      logger.warn('Invalid durationSeconds', { eventId, durationSeconds: payload.durationSeconds });
      return null;
    }
    if (payload.durationSeconds > FUNCTION_CONFIG.maxSessionDurationSeconds) {
      logger.warn('Session duration exceeds maximum', {
        eventId,
        durationSeconds: payload.durationSeconds,
        max: FUNCTION_CONFIG.maxSessionDurationSeconds,
      });
      return null;
    }
    if (typeof payload.startedAt !== 'string' || typeof payload.completedAt !== 'string') {
      logger.warn('Missing startedAt or completedAt', { eventId });
      return null;
    }
    if (typeof payload.endedEarly !== 'boolean') {
      logger.warn('Missing endedEarly flag', { eventId });
      return null;
    }
  }

  if (data.type === 'DistractionLogged') {
    if (typeof payload.note !== 'string') {
      logger.warn('Missing distraction note', { eventId });
      return null;
    }
    if (typeof payload.normalizedNote !== 'string') {
      logger.warn('Missing normalizedNote', { eventId });
      return null;
    }
  }

  if (data.type === 'IdleDetected') {
    if (typeof payload.idleDurationMs !== 'number') {
      logger.warn('Missing idleDurationMs', { eventId });
      return null;
    }
  }

  if (data.type === 'TimerStarted') {
    if (typeof payload.durationSeconds !== 'number' || payload.durationSeconds <= 0) {
      logger.warn('Invalid durationSeconds on TimerStarted', { eventId });
      return null;
    }
  }

  return {
    type: data.type as SessionEvent['type'],
    sessionId: data.sessionId as string,
    timestamp: data.timestamp as string,
    payload,
    migrated: data.migrated === true ? true : undefined,
  };
}
```

#### 8.2.3. Idempotency Guard (Prevent Double-Processing)

Cloud Functions guarantee "at least once" delivery — the same event may trigger the function multiple times (e.g., due to retries after transient errors). The idempotency guard prevents double-counting by tracking which events have already been processed.

**Strategy: Processed events subcollection.**

Each processed event is recorded in a lightweight subcollection:
```
users/{uid}/processed_events/{eventId}
```

This document contains only the event type and processing timestamp. It exists solely as a deduplication marker.

**Implementation** (`src/pipeline/idempotency.ts`):

```typescript
// File: functions/src/pipeline/idempotency.ts

import { getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();

/**
 * Check if an event has already been processed.
 * Returns true if the event should be SKIPPED (already processed).
 */
export async function checkIdempotency(uid: string, eventId: string): Promise<boolean> {
  const docRef = db.doc(`users/${uid}/processed_events/${eventId}`);
  const snapshot = await docRef.get();
  return snapshot.exists;
}

/**
 * Mark an event as processed.
 * Called AFTER all handlers complete successfully.
 */
export async function markProcessed(
  uid: string,
  eventId: string,
  eventType: string,
): Promise<void> {
  const docRef = db.doc(`users/${uid}/processed_events/${eventId}`);
  await docRef.set({
    eventType,
    processedAt: new Date().toISOString(),
  });
}
```

**Firestore security rule for `processed_events`:**

```
match /users/{uid}/processed_events/{eventId} {
  // Clients never read or write processed_events. Only Cloud Functions (Admin SDK).
  allow read, write: if false;
}
```

**Trade-off:** Each event creates an additional Firestore document in `processed_events`. This doubles the Firestore write cost per event. The alternative (using a `processed: true` flag on the event document itself) would require `update` permission on `session_events`, which breaks the append-only security model (→ §7.4.2). The separate subcollection preserves event immutability.

**Cleanup:** `processed_events` documents can be periodically cleaned up by a scheduled Cloud Function (e.g., delete documents older than 30 days). Processing is idempotent even if the marker is cleaned up — the worst case is a re-computation of aggregates, which is additive and harmless because the aggregate update logic uses atomic increments.

#### 8.2.4. Event Type Dispatcher (Route to Appropriate Handler)

The dispatcher reads the `type` field from the validated event and routes to the appropriate handler function.

**Implementation** (`src/pipeline/event-dispatcher.ts`):

```typescript
// File: functions/src/pipeline/event-dispatcher.ts

import { logger } from 'firebase-functions/v2';
import type { SessionEvent } from '../types';
import { handleTimerCompleted } from '../handlers/timer-completed';
import { handleDistractionLogged } from '../handlers/distraction-logged';
import { handleFalseAlarm } from '../handlers/false-alarm';

/**
 * Dispatch a validated event to the appropriate type-specific handler.
 *
 * NOT all event types have handlers. TimerStarted, TimerPaused, and
 * IdleDetected are currently no-ops (reserved for future analytics).
 * They are still validated and their idempotency is tracked, but no
 * aggregate writes occur.
 */
export async function dispatchEvent(
  uid: string,
  eventId: string,
  event: SessionEvent,
): Promise<void> {
  switch (event.type) {
    case 'TimerCompleted':
    case 'TimerEndedEarly':
      await handleTimerCompleted(uid, eventId, event);
      break;

    case 'DistractionLogged':
      await handleDistractionLogged(uid, eventId, event);
      break;

    case 'FalseAlarmMarked':
      await handleFalseAlarm(uid, eventId, event);
      break;

    case 'TimerStarted':
    case 'TimerPaused':
    case 'IdleDetected':
      // No-op for now. These events are stored for analytics and
      // future features (e.g., "time in pause" metrics, idle frequency analysis).
      logger.info('Event stored (no processing required)', {
        type: event.type,
        eventId,
      });
      break;

    default:
      logger.warn('Unknown event type in dispatcher', { type: event.type, eventId });
      break;
  }
}
```

**Why some event types are no-ops:**

| Event Type | Current Processing | Future Use |
|---|---|---|
| `TimerStarted` | None (stored only) | Session start analytics, active user tracking |
| `TimerPaused` | None (stored only) | "Time in pause" metrics, pause frequency analysis |
| `IdleDetected` | None (directly) | Looked up by Swift Recovery handler (→ §8.6.2). Not processed as a standalone trigger. |
| `TimerCompleted` | Full processing | — |
| `TimerEndedEarly` | Full processing | — |
| `DistractionLogged` | Full processing | — |
| `FalseAlarmMarked` | Counter increment only | — |

---

### 8.3. Focus Time Calculation Engine

The Focus Time Calculation Engine is the server-side replacement for the source `ReportingService.GetReportDataAsync()` (`Sentinel.Engine\ReportingService.cs`). In the source, this C# service queries SQLite to compute totals. In the target, Cloud Functions compute the same totals from Event Ledger events and write them to Firestore aggregate documents.

**Source computation** (from `ReportingService.cs` lines 68–82):

```csharp
var completedSessions = sessions.Where(s => s.CompletedAt.HasValue).ToList();
var actualDistractions = distractions
    .Where(d => !d.IsFalseAlarm && !string.IsNullOrWhiteSpace(d.NormalizedNote))
    .ToList();

var report = new ReportData
{
    TotalFocusSeconds = completedSessions.Sum(s => s.DurationSeconds),
    SessionsCompleted = completedSessions.Count,
    DistractionsLogged = actualDistractions.Count,
    FalseAlarms = distractions.Count(d => d.IsFalseAlarm),
    AvgSessionSeconds = completedSessions.Count > 0
        ? completedSessions.Average(s => s.DurationSeconds)
        : 0,
};
```

**Target replacement:** Each `TimerCompleted`, `TimerEndedEarly`, `DistractionLogged`, and `FalseAlarmMarked` event triggers an incremental update to the daily aggregate document. No batch query of all events is needed — the aggregate is maintained in real time.

#### 8.3.1. Session Duration Derivation from `TimerStarted` → `TimerCompleted` Event Pairs

**Source approach:**

In the source, `Session.DurationSeconds` is set by the React frontend at session completion:
- For `TimerCompleted`: `settings.pomodoroMinutes * 60` (full configured duration).
- For `TimerEndedEarly`: `totalDuration - timeLeft` (actual elapsed time).

The source stores this as a single field on the Session SQLite row.

**Target approach:**

The target uses the `durationSeconds` field from the `TimerCompleted` or `TimerEndedEarly` event payload. This value is computed identically by the Angular frontend (→ §7.3.1) and is the authoritative source for focus time.

**Server-side validation of `durationSeconds`:**

The Cloud Function does NOT blindly trust the client-supplied `durationSeconds`. It cross-validates:

```typescript
// File: functions/src/handlers/timer-completed.ts (excerpt)

function validateDuration(event: SessionEvent): number | null {
  const payload = event.payload as TimerCompletedPayload;
  const durationSeconds = payload.durationSeconds;

  // Reject non-positive or absurdly large durations
  if (durationSeconds <= 0 || durationSeconds > FUNCTION_CONFIG.maxSessionDurationSeconds) {
    return null;
  }

  // Cross-validate with startedAt/completedAt timestamps
  const startedAt = Date.parse(payload.startedAt);
  const completedAt = Date.parse(payload.completedAt);

  if (isNaN(startedAt) || isNaN(completedAt)) {
    return null;
  }

  const wallClockDuration = (completedAt - startedAt) / 1000;

  // Allow 10% tolerance for clock drift and pause time
  // (pauses aren't deducted from durationSeconds because
  // durationSeconds represents actual focused work time)
  if (durationSeconds > wallClockDuration * 1.1 + 60) {
    // Duration claims more focused time than wall clock allows
    // (+60s grace for timing precision)
    return null;
  }

  return durationSeconds;
}
```

**Why not compute duration from `TimerStarted` timestamps?**

Computing duration purely from `TimerStarted.timestamp` to `TimerCompleted.timestamp` would yield wall-clock time, not focused time. The user may have paused the timer, been interrupted by interventions, or had the system go to sleep. The client-supplied `durationSeconds` already accounts for pauses. The server validates it's plausible but trusts it within bounds.

#### 8.3.2. Idle Time Deduction: Subtract `IdleDetected` → `DistractionLogged` Intervals

**Source behavior:** The source does NOT deduct idle time from session duration. `Session.DurationSeconds` in SQLite is the total time from start to completion (or early end), including all idle intervals.

**Target behavior:** The target also does NOT deduct idle time from the `durationSeconds` field. The Angular frontend already pauses the timer during interventions (→ §5.5.1), so `durationSeconds` only counts time when the timer was actively counting down. Idle intervals are inherently excluded.

However, idle events are valuable for analytics. The Cloud Function tracks the number of idle interruptions per session and the total idle duration for future reporting:

```typescript
// This is reserved for future analytics. Currently, no idle deduction occurs.
// The IdleDetected event handler is a no-op (→ §8.2.4).
//
// Future enhancement: query all IdleDetected events for a sessionId,
// compute total idle time, and store as a session-level metric.
```

#### 8.3.3. Early End Handling: `TimerEndedEarly` Partial Credit Calculation

When a `TimerEndedEarly` event is processed, the Cloud Function treats it identically to a `TimerCompleted` event for aggregation purposes. The `durationSeconds` field reflects the actual focused time (not the configured duration), so partial credit is automatically correct.

**Difference in aggregate tracking:**

| Field | `TimerCompleted` Impact | `TimerEndedEarly` Impact |
|---|---|---|
| `totalFocusSeconds` | += `payload.durationSeconds` | += `payload.durationSeconds` |
| `sessionsCompleted` | += 1 | (not incremented) |
| `sessionsEndedEarly` | (not incremented) | += 1 |
| `avgSessionSeconds` | Recalculated | Recalculated |
| `longestSessionSeconds` | `max(current, durationSeconds)` | `max(current, durationSeconds)` |
| Streak tracking | Counts toward daily streak | Counts toward daily streak |
| Achievement: focus sessions | Counts toward total | Counts toward total |
| Achievement: perfect sessions | Eligible (if 0 distractions) | NOT eligible (endedEarly = true → not "perfect") |

#### 8.3.4. Daily Aggregate Update (`users/{uid}/stats/daily/{date}`)

The daily aggregate is the primary output of the Focus Time Calculation Engine. It is an incrementally-maintained document at `users/{uid}/stats/daily/{YYYY-MM-DD}` (→ §6.2.3.1).

**Handler implementation** (`src/handlers/timer-completed.ts`):

```typescript
// File: functions/src/handlers/timer-completed.ts

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import type { SessionEvent, TimerCompletedPayload } from '../types';
import { FUNCTION_CONFIG } from '../config';
import { updateStreak } from '../engines/streak';
import { checkAchievements } from '../engines/achievement';
import { checkShinyBadge } from '../engines/shiny-badge';

const db = getFirestore();

/**
 * Handle TimerCompleted and TimerEndedEarly events.
 *
 * 1. Validate duration
 * 2. Update daily aggregate
 * 3. Update streak
 * 4. Check achievements
 * 5. (TimerCompleted only) Check for shiny badge
 */
export async function handleTimerCompleted(
  uid: string,
  eventId: string,
  event: SessionEvent,
): Promise<void> {
  const payload = event.payload as TimerCompletedPayload;
  const durationSeconds = payload.durationSeconds;

  // Validate duration
  if (durationSeconds <= 0 || durationSeconds > FUNCTION_CONFIG.maxSessionDurationSeconds) {
    logger.warn('Invalid session duration, skipping', { uid, eventId, durationSeconds });
    return;
  }

  // Determine the calendar date from the event timestamp.
  // Use the event's timestamp (client-side) to determine the date.
  const eventDate = new Date(event.timestamp);
  const dateKey = formatDateKey(eventDate);

  const isCompleted = event.type === 'TimerCompleted';
  const isEndedEarly = event.type === 'TimerEndedEarly';

  // Step 1: Update daily aggregate
  const dailyRef = db.doc(`users/${uid}/stats/daily/${dateKey}`);
  const dailySnap = await dailyRef.get();

  if (dailySnap.exists) {
    // Incremental update
    const currentData = dailySnap.data()!;
    const currentTotal = (currentData.totalFocusSeconds as number) || 0;
    const currentCompleted = (currentData.sessionsCompleted as number) || 0;
    const currentEndedEarly = (currentData.sessionsEndedEarly as number) || 0;
    const currentLongest = (currentData.longestSessionSeconds as number) || 0;
    const totalSessions = currentCompleted + currentEndedEarly;

    const newTotal = currentTotal + durationSeconds;
    const newCompleted = isCompleted ? currentCompleted + 1 : currentCompleted;
    const newEndedEarly = isEndedEarly ? currentEndedEarly + 1 : currentEndedEarly;
    const newTotalSessions = newCompleted + newEndedEarly;
    const newAvg = newTotalSessions > 0 ? newTotal / newTotalSessions : 0;
    const newLongest = Math.max(currentLongest, durationSeconds);

    await dailyRef.update({
      totalFocusSeconds: newTotal,
      sessionsCompleted: newCompleted,
      sessionsEndedEarly: newEndedEarly,
      avgSessionSeconds: Math.round(newAvg * 100) / 100,
      longestSessionSeconds: newLongest,
      updatedAt: new Date().toISOString(),
    });
  } else {
    // First session of the day — create document
    await dailyRef.set({
      date: dateKey,
      totalFocusSeconds: durationSeconds,
      sessionsCompleted: isCompleted ? 1 : 0,
      sessionsEndedEarly: isEndedEarly ? 1 : 0,
      distractionsLogged: 0,
      falseAlarms: 0,
      avgSessionSeconds: durationSeconds,
      longestSessionSeconds: durationSeconds,
      swiftRecoveryCount: 0,
      updatedAt: new Date().toISOString(),
    });
  }

  // Step 2: Update streak
  await updateStreak(uid, dateKey);

  // Step 3: Check achievements
  await checkAchievements(uid, {
    type: event.type,
    durationSeconds,
    dateKey,
    sessionId: event.sessionId,
    distractionCount: payload.distractionCount ?? 0,
    endedEarly: payload.endedEarly,
  });

  // Step 4: Check shiny badge (only for naturally completed sessions)
  if (isCompleted && !payload.endedEarly && payload.distractionCount === 0) {
    await checkShinyBadge(uid, event.sessionId);
  }
}

/**
 * Format a Date object as YYYY-MM-DD string.
 * Uses UTC to ensure consistent date boundaries across timezones.
 */
function formatDateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}
```

**Distraction and false alarm counter updates** (`src/handlers/distraction-logged.ts`, `src/handlers/false-alarm.ts`):

```typescript
// File: functions/src/handlers/distraction-logged.ts

import { getFirestore } from 'firebase-admin/firestore';
import type { SessionEvent, DistractionLoggedPayload } from '../types';
import { checkSwiftRecovery } from '../engines/swift-recovery';
import { checkAchievements } from '../engines/achievement';

const db = getFirestore();

export async function handleDistractionLogged(
  uid: string,
  eventId: string,
  event: SessionEvent,
): Promise<void> {
  const payload = event.payload as DistractionLoggedPayload;
  const eventDate = new Date(event.timestamp);
  const dateKey = eventDate.toISOString().split('T')[0];

  // Step 1: Increment daily distraction counter
  const dailyRef = db.doc(`users/${uid}/stats/daily/${dateKey}`);
  const dailySnap = await dailyRef.get();

  if (dailySnap.exists) {
    const currentDistractions = (dailySnap.data()!.distractionsLogged as number) || 0;
    await dailyRef.update({
      distractionsLogged: currentDistractions + 1,
      updatedAt: new Date().toISOString(),
    });
  } else {
    // Edge case: distraction event arrives before session completion event.
    // Create a minimal daily doc that will be enriched by the session handler later.
    await dailyRef.set({
      date: dateKey,
      totalFocusSeconds: 0,
      sessionsCompleted: 0,
      sessionsEndedEarly: 0,
      distractionsLogged: 1,
      falseAlarms: 0,
      avgSessionSeconds: 0,
      longestSessionSeconds: 0,
      swiftRecoveryCount: 0,
      updatedAt: new Date().toISOString(),
    });
  }

  // Step 2: Check Swift Recovery (→ §8.6)
  await checkSwiftRecovery(uid, eventId, event);

  // Step 3: Check recovery achievements
  await checkAchievements(uid, {
    type: event.type,
    durationSeconds: 0,
    dateKey,
    sessionId: event.sessionId,
    distractionCount: 0,
    endedEarly: false,
  });
}
```

```typescript
// File: functions/src/handlers/false-alarm.ts

import { getFirestore } from 'firebase-admin/firestore';
import type { SessionEvent } from '../types';

const db = getFirestore();

export async function handleFalseAlarm(
  uid: string,
  eventId: string,
  event: SessionEvent,
): Promise<void> {
  const eventDate = new Date(event.timestamp);
  const dateKey = eventDate.toISOString().split('T')[0];

  const dailyRef = db.doc(`users/${uid}/stats/daily/${dateKey}`);
  const dailySnap = await dailyRef.get();

  if (dailySnap.exists) {
    const currentFalseAlarms = (dailySnap.data()!.falseAlarms as number) || 0;
    await dailyRef.update({
      falseAlarms: currentFalseAlarms + 1,
      updatedAt: new Date().toISOString(),
    });
  } else {
    await dailyRef.set({
      date: dateKey,
      totalFocusSeconds: 0,
      sessionsCompleted: 0,
      sessionsEndedEarly: 0,
      distractionsLogged: 0,
      falseAlarms: 1,
      avgSessionSeconds: 0,
      longestSessionSeconds: 0,
      swiftRecoveryCount: 0,
      updatedAt: new Date().toISOString(),
    });
  }
}
```

---

### 8.4. Streak Tracking Engine

The Streak Tracking Engine maintains the `users/{uid}/stats/streaks` document (→ §6.2.3.2). It fires after every `TimerCompleted` or `TimerEndedEarly` event to update the user's consecutive-day focus streak.

**Source equivalent:** There is no streak tracking in the source codebase. This is entirely NEW functionality specified in TARGET_ARCHITECTURE.md §6.

#### 8.4.1. Daily Completion Threshold (Minimum Focus Minutes to Count Day)

A day counts toward the streak if the user has at least one `TimerCompleted` or `TimerEndedEarly` event on that calendar date. The minimum focus threshold is configurable via `FUNCTION_CONFIG.streakMinimumFocusSeconds` (default: `0`, meaning any completed session counts).

**Future enhancement:** Allow users to set a personal daily minimum (e.g., "30 minutes of focus to count toward my streak"). This would be read from the user's settings document and passed to the streak engine.

#### 8.4.2. Current Streak Counter (Consecutive Days Meeting Threshold)

#### 8.4.3. Longest Streak Record

#### 8.4.4. Streak Recalculation on Missed Day

#### 8.4.5. Timezone Handling for Day Boundary Detection

**Streak engine implementation** (`src/engines/streak.ts`):

```typescript
// File: functions/src/engines/streak.ts

import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import type { StreakDocument } from '../types';

const db = getFirestore();

/**
 * Update the user's streak document after a session completion event.
 *
 * Streak rules (§8.4.2 – §8.4.4):
 *
 * - If lastActiveDate === today → no change (already counted today).
 * - If lastActiveDate === yesterday → increment currentStreak.
 * - If lastActiveDate is older than yesterday → streak broken, reset to 1.
 * - longestStreak = max(longestStreak, currentStreak). Never decreases.
 *
 * @param uid - The authenticated user's UID.
 * @param dateKey - The YYYY-MM-DD date of the event being processed.
 */
export async function updateStreak(uid: string, dateKey: string): Promise<void> {
  const streakRef = db.doc(`users/${uid}/stats/streaks`);
  const streakSnap = await streakRef.get();

  const now = new Date().toISOString();
  const today = dateKey;
  const yesterday = getPreviousDateKey(dateKey);

  if (!streakSnap.exists) {
    // First-ever session — initialize streak
    const newStreak: StreakDocument = {
      currentStreak: 1,
      longestStreak: 1,
      lastActiveDate: today,
      streakStartDate: today,
      updatedAt: now,
    };
    await streakRef.set(newStreak);
    logger.info('Streak initialized', { uid, dateKey });
    return;
  }

  const current = streakSnap.data() as StreakDocument;

  // §8.4.2: Already counted today
  if (current.lastActiveDate === today) {
    logger.info('Streak already counted for today', { uid, dateKey });
    return;
  }

  // §8.4.2: Consecutive day (yesterday → today)
  if (current.lastActiveDate === yesterday) {
    const newCurrentStreak = current.currentStreak + 1;
    const newLongestStreak = Math.max(current.longestStreak, newCurrentStreak);

    await streakRef.update({
      currentStreak: newCurrentStreak,
      longestStreak: newLongestStreak,
      lastActiveDate: today,
      updatedAt: now,
    });
    logger.info('Streak extended', {
      uid,
      dateKey,
      currentStreak: newCurrentStreak,
      longestStreak: newLongestStreak,
    });
    return;
  }

  // §8.4.4: Streak broken (gap of 1+ days)
  await streakRef.update({
    currentStreak: 1,
    streakStartDate: today,
    lastActiveDate: today,
    updatedAt: now,
  });
  logger.info('Streak reset', { uid, dateKey, previousLastActive: current.lastActiveDate });
}

/**
 * Get the YYYY-MM-DD string for the day before the given date.
 *
 * §8.4.5: Timezone handling — dateKey is computed from the event's
 * client-side ISO 8601 timestamp, which is in UTC. The day boundary
 * is therefore UTC midnight. This means a user in UTC-8 who completes
 * a session at 11 PM local time (7 AM next day UTC) will see it
 * counted toward the NEXT UTC day.
 *
 * For MVP, UTC day boundaries are acceptable. Future enhancement:
 * read the user's timezone from their settings and compute local
 * day boundaries server-side.
 */
function getPreviousDateKey(dateKey: string): string {
  const date = new Date(dateKey + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().split('T')[0];
}
```

**Timezone handling rationale (§8.4.5):**

The `dateKey` is derived from the event's `timestamp` field using `new Date(timestamp).toISOString().split('T')[0]`. Since the client emits timestamps in UTC (via `new Date().toISOString()`), the date boundary is UTC midnight.

**Impact on users in non-UTC timezones:**

- A user in UTC+5 who completes a session at 11:30 PM local time (6:30 PM UTC) has it counted toward the CURRENT UTC day — correct.
- A user in UTC-8 who completes a session at 11:30 PM local time (7:30 AM NEXT DAY UTC) has it counted toward the NEXT UTC day — may feel incorrect to the user.

**MVP acceptance:** UTC boundaries are acceptable for MVP. The streak is a motivational tool, not a legal contract. Users in extreme negative UTC offsets may see occasional "wrong day" counting, but the streak continuity logic (yesterday/today comparison) still works correctly — it's just shifted by their UTC offset.

**Future enhancement:** Store `timezoneOffset` (minutes) in the `TimerCompleted` event payload. The Cloud Function would then compute the local date key:

```typescript
// Future: const localDate = new Date(timestamp.getTime() - timezoneOffset * 60000);
// Future: const dateKey = localDate.toISOString().split('T')[0];
```

---

### 8.5. Achievement & Badge System

The Achievement System awards badges when users reach predefined milestones. All achievement evaluation runs server-side after aggregate documents are updated. The client CANNOT award achievements — it can only read the `users/{uid}/achievements/` subcollection.

#### 8.5.1. Tiered Achievements

Achievements are organized into 4 categories × 3 tiers = 12 total achievements. Each tier has a progressively higher threshold.

##### 8.5.1.1. Bronze Tier — Milestone Definitions

| Achievement ID | Category | Title | Description | Threshold | Metric Source |
|---|---|---|---|---|---|
| `focus_bronze` | Focus | First Steps | Complete 10 focus sessions. | 10 sessions | Cumulative `sessionsCompleted` + `sessionsEndedEarly` across all daily aggregates |
| `streak_bronze` | Streak | Building Habits | Maintain a 3-day focus streak. | 3-day streak | `stats/streaks.currentStreak >= 3` |
| `recovery_bronze` | Recovery | Quick Draw | Achieve 10 Swift Recoveries. | 10 recoveries | Cumulative `swiftRecoveryCount` across all daily aggregates |
| `perfect_bronze` | Perfect | Clean Block | Complete a session with 0 distractions and no early end. | 1 perfect session | Per-session check at `TimerCompleted` time |

##### 8.5.1.2. Silver Tier — Milestone Definitions

| Achievement ID | Category | Title | Description | Threshold | Metric Source |
|---|---|---|---|---|---|
| `focus_silver` | Focus | Focused Mind | Complete 50 focus sessions. | 50 sessions | Cumulative sessions |
| `streak_silver` | Streak | Consistent | Maintain a 7-day focus streak. | 7-day streak | `stats/streaks.currentStreak >= 7` |
| `recovery_silver` | Recovery | Reflexive | Achieve 50 Swift Recoveries. | 50 recoveries | Cumulative Swift Recovery count |
| `perfect_silver` | Perfect | Laser Focus | Complete 10 perfect sessions. | 10 perfect sessions | Cumulative perfect session count |

##### 8.5.1.3. Gold Tier — Milestone Definitions

| Achievement ID | Category | Title | Description | Threshold | Metric Source |
|---|---|---|---|---|---|
| `focus_gold` | Focus | Marathon Runner | Complete 200 focus sessions. | 200 sessions | Cumulative sessions |
| `streak_gold` | Streak | Unstoppable | Maintain a 30-day focus streak. | 30-day streak | `stats/streaks.currentStreak >= 30` |
| `recovery_gold` | Recovery | Lightning | Achieve 200 Swift Recoveries. | 200 recoveries | Cumulative Swift Recovery count |
| `perfect_gold` | Perfect | Untouchable | Complete 50 perfect sessions. | 50 perfect sessions | Cumulative perfect session count |

**Achievement definitions data** (`src/engines/achievement.ts` — definitions array):

```typescript
// File: functions/src/engines/achievement.ts (definitions)

export interface AchievementDefinition {
  achievementId: string;
  tier: 'bronze' | 'silver' | 'gold';
  category: 'focus' | 'streak' | 'recovery' | 'perfect';
  title: string;
  description: string;
  threshold: number;
}

export const ACHIEVEMENT_DEFINITIONS: ReadonlyArray<AchievementDefinition> = [
  // Focus achievements
  { achievementId: 'focus_bronze',    tier: 'bronze', category: 'focus',    title: 'First Steps',     description: 'Complete 10 focus sessions.',                         threshold: 10 },
  { achievementId: 'focus_silver',    tier: 'silver', category: 'focus',    title: 'Focused Mind',    description: 'Complete 50 focus sessions.',                         threshold: 50 },
  { achievementId: 'focus_gold',      tier: 'gold',   category: 'focus',    title: 'Marathon Runner',  description: 'Complete 200 focus sessions.',                        threshold: 200 },

  // Streak achievements
  { achievementId: 'streak_bronze',   tier: 'bronze', category: 'streak',   title: 'Building Habits', description: 'Maintain a 3-day focus streak.',                      threshold: 3 },
  { achievementId: 'streak_silver',   tier: 'silver', category: 'streak',   title: 'Consistent',      description: 'Maintain a 7-day focus streak.',                      threshold: 7 },
  { achievementId: 'streak_gold',     tier: 'gold',   category: 'streak',   title: 'Unstoppable',     description: 'Maintain a 30-day focus streak.',                     threshold: 30 },

  // Recovery achievements
  { achievementId: 'recovery_bronze', tier: 'bronze', category: 'recovery', title: 'Quick Draw',      description: 'Achieve 10 Swift Recoveries (< 60s response time).', threshold: 10 },
  { achievementId: 'recovery_silver', tier: 'silver', category: 'recovery', title: 'Reflexive',       description: 'Achieve 50 Swift Recoveries.',                       threshold: 50 },
  { achievementId: 'recovery_gold',   tier: 'gold',   category: 'recovery', title: 'Lightning',       description: 'Achieve 200 Swift Recoveries.',                      threshold: 200 },

  // Perfect session achievements
  { achievementId: 'perfect_bronze',  tier: 'bronze', category: 'perfect',  title: 'Clean Block',     description: 'Complete a session with 0 distractions.',             threshold: 1 },
  { achievementId: 'perfect_silver',  tier: 'silver', category: 'perfect',  title: 'Laser Focus',     description: 'Complete 10 perfect sessions.',                       threshold: 10 },
  { achievementId: 'perfect_gold',    tier: 'gold',   category: 'perfect',  title: 'Untouchable',     description: 'Complete 50 perfect sessions.',                       threshold: 50 },
] as const;
```

#### 8.5.2. Achievement Check Pipeline (Post-Aggregation Evaluation)

The achievement check runs AFTER the daily aggregate and streak documents are updated. It reads the current cumulative metrics and compares them against each achievement threshold.

**Implementation** (`src/engines/achievement.ts`):

```typescript
// File: functions/src/engines/achievement.ts

import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { ACHIEVEMENT_DEFINITIONS } from './achievement';
import type { AchievementDefinition, AchievementDocument, StreakDocument } from '../types';

const db = getFirestore();

export interface AchievementContext {
  type: string;          // Event type that triggered this check
  durationSeconds: number;
  dateKey: string;
  sessionId: string;
  distractionCount: number;
  endedEarly: boolean;
}

/**
 * Check all achievement thresholds and award any newly earned badges.
 *
 * This function is called after EVERY session completion and distraction event.
 * It reads current cumulative metrics and compares against thresholds.
 *
 * §8.5.4: Duplicate prevention — each achievement document is written with
 * the achievementId as the document ID. `set()` with `{ merge: false }` is
 * NOT used; instead, we check `exists` before writing to prevent overwriting
 * an existing achievement (which would reset `earnedAt`).
 */
export async function checkAchievements(
  uid: string,
  context: AchievementContext,
): Promise<void> {
  // Gather current metrics
  const metrics = await gatherMetrics(uid, context);

  // Check each achievement definition
  for (const definition of ACHIEVEMENT_DEFINITIONS) {
    const currentValue = getMetricValue(definition, metrics);
    if (currentValue === null || currentValue < definition.threshold) {
      continue;
    }

    // Threshold met — check if already awarded
    const achievementRef = db.doc(`users/${uid}/achievements/${definition.achievementId}`);
    const achievementSnap = await achievementRef.get();

    if (achievementSnap.exists) {
      // Already awarded — skip (§8.5.4)
      continue;
    }

    // Award the achievement
    const achievement: AchievementDocument = {
      achievementId: definition.achievementId,
      tier: definition.tier,
      category: definition.category,
      title: definition.title,
      description: definition.description,
      earnedAt: new Date().toISOString(),
      isShiny: false,
      progress: {
        current: currentValue,
        target: definition.threshold,
      },
    };

    await achievementRef.set(achievement);
    logger.info('Achievement awarded', {
      uid,
      achievementId: definition.achievementId,
      tier: definition.tier,
      currentValue,
    });
  }
}

interface CumulativeMetrics {
  totalSessions: number;
  totalSwiftRecoveries: number;
  totalPerfectSessions: number;
  currentStreak: number;
}

/**
 * Gather cumulative metrics from Firestore aggregate documents.
 */
async function gatherMetrics(
  uid: string,
  context: AchievementContext,
): Promise<CumulativeMetrics> {
  // Read all daily aggregate documents to compute lifetime totals
  const dailyCollection = db.collection(`users/${uid}/stats/daily`);
  const dailySnap = await dailyCollection.get();

  let totalSessions = 0;
  let totalSwiftRecoveries = 0;

  dailySnap.docs.forEach((doc) => {
    const data = doc.data();
    totalSessions += (data.sessionsCompleted || 0) + (data.sessionsEndedEarly || 0);
    totalSwiftRecoveries += (data.swiftRecoveryCount || 0);
  });

  // Read streak document
  const streakRef = db.doc(`users/${uid}/stats/streaks`);
  const streakSnap = await streakRef.get();
  const currentStreak = streakSnap.exists
    ? (streakSnap.data() as StreakDocument).currentStreak
    : 0;

  // Count perfect sessions.
  // A perfect session: TimerCompleted with distractionCount === 0 and endedEarly === false.
  // We need to query session_events for this. For efficiency, we track it as a counter
  // on the user's stats document.
  const perfectRef = db.doc(`users/${uid}/stats/perfect_sessions`);
  const perfectSnap = await perfectRef.get();
  let totalPerfectSessions = perfectSnap.exists
    ? (perfectSnap.data()!.count as number) || 0
    : 0;

  // If the current event is a perfect session, increment the counter
  if (
    (context.type === 'TimerCompleted') &&
    context.distractionCount === 0 &&
    !context.endedEarly
  ) {
    totalPerfectSessions += 1;
    await perfectRef.set({ count: totalPerfectSessions, updatedAt: new Date().toISOString() });
  }

  return {
    totalSessions,
    totalSwiftRecoveries,
    totalPerfectSessions,
    currentStreak,
  };
}

/**
 * Extract the relevant metric value for a given achievement definition.
 */
function getMetricValue(
  definition: AchievementDefinition,
  metrics: CumulativeMetrics,
): number | null {
  switch (definition.category) {
    case 'focus':
      return metrics.totalSessions;
    case 'streak':
      return metrics.currentStreak;
    case 'recovery':
      return metrics.totalSwiftRecoveries;
    case 'perfect':
      return metrics.totalPerfectSessions;
    default:
      return null;
  }
}
```

**Perfect sessions counter document:**

The achievement engine maintains an additional document at `users/{uid}/stats/perfect_sessions`:

```json
{
  "count": 7,
  "updatedAt": "2026-04-03T15:30:00.000Z"
}
```

This exists because counting perfect sessions would otherwise require scanning ALL `TimerCompleted` events and cross-referencing with `DistractionLogged` events for the same `sessionId` — an expensive operation. The counter is maintained incrementally.

**Firestore security rule for `perfect_sessions`:**

```
// Already covered by the wildcard:
// match /users/{uid}/stats/{document=**} {
//   allow read: if request.auth != null && request.auth.uid == uid;
//   allow write: if false;
// }
```

#### 8.5.3. Achievement Document Write (`users/{uid}/achievements/{achievementId}`)

Achievement documents are written to `users/{uid}/achievements/{achievementId}` with the `achievementId` as the document ID. The document schema is defined in → §6.2.3.3.

**Write example:**

```typescript
const achievementRef = db.doc(`users/${uid}/achievements/focus_bronze`);
await achievementRef.set({
  achievementId: 'focus_bronze',
  tier: 'bronze',
  category: 'focus',
  title: 'First Steps',
  description: 'Complete 10 focus sessions.',
  earnedAt: new Date().toISOString(),
  isShiny: false,
  progress: {
    current: 10,
    target: 10,
  },
});
```

**Angular reads achievements via `onSnapshot` listener** (→ §7.2.2):

```typescript
// File: src/app/core/achievement.service.ts

import { Injectable, inject, signal } from '@angular/core';
import { Firestore, collection, onSnapshot } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import type { Achievement } from './models';

@Injectable({ providedIn: 'root' })
export class AchievementService {
  private firestore = inject(Firestore);
  private authService = inject(AuthService);

  readonly achievements = signal<Achievement[]>([]);

  attachListener(): void {
    const uid = this.authService.uid;
    if (!uid) return;

    const colRef = collection(this.firestore, `users/${uid}/achievements`);
    onSnapshot(colRef, (snapshot) => {
      const achievements = snapshot.docs.map((doc) => doc.data() as Achievement);
      this.achievements.set(achievements);
    });
  }
}
```

When a Cloud Function writes a new achievement document, the Angular `onSnapshot` listener fires immediately (if online) or on next sync (if offline). The UI can then display a badge notification.

#### 8.5.4. Duplicate Award Prevention

Duplicate prevention is achieved through two mechanisms:

**1. Document ID as natural key:**

The achievement document ID IS the `achievementId` string (e.g., `focus_bronze`). Firestore's `set()` would overwrite an existing document with the same ID. To prevent this, the Cloud Function checks `exists` before writing:

```typescript
const achievementSnap = await achievementRef.get();
if (achievementSnap.exists) {
  // Already awarded — skip
  continue;
}
```

**2. Idempotency guard on the triggering event:**

The pipeline's idempotency guard (→ §8.2.3) ensures the achievement check is not re-triggered for the same event. Even if the guard fails (e.g., `processed_events` document deleted), the `exists` check on the achievement document prevents double-writing.

**Why not use Firestore transactions?**

A transaction (`runTransaction`) would provide stronger consistency but is unnecessary here. The worst case without a transaction is a race condition where two concurrent function invocations both read `exists === false` and both write the achievement. Since both writes contain identical data (same `achievementId`, `tier`, `title`), the result is correct — only `earnedAt` might differ by milliseconds. The `isShiny` field is deterministic for non-shiny badges and is handled separately for shiny badges (→ §8.7).

---

### 8.6. Swift Recovery Multiplier

The Swift Recovery Multiplier rewards users who quickly acknowledge their distraction after an idle detection event. It is specified in TARGET_ARCHITECTURE.md §6:

> *Swift Recovery Multiplier:* Bonus points awarded by the server if the timestamp difference between an `IdleDetected` event and a `DistractionLogged` event is under 60 seconds.

#### 8.6.1. Trigger: `DistractionLogged` Event Created

The Swift Recovery check is invoked by the `distraction-logged` handler (→ §8.3.4, `handleDistractionLogged`). It fires for every `DistractionLogged` event — ALL distractions are evaluated for Swift Recovery, not just those that follow an `IdleDetected` event.

#### 8.6.2. Lookup: Find Most Recent `IdleDetected` Event for Same Session

The Cloud Function queries the `session_events` subcollection for the most recent `IdleDetected` event with the same `sessionId`:

```typescript
// File: functions/src/engines/swift-recovery.ts

import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { FUNCTION_CONFIG } from '../config';
import type { SessionEvent, IdleDetectedPayload } from '../types';

const db = getFirestore();

/**
 * Check if a DistractionLogged event qualifies for a Swift Recovery bonus.
 *
 * Flow:
 * 1. Query for the most recent IdleDetected event with the same sessionId.
 * 2. Calculate the time delta between IdleDetected.timestamp and DistractionLogged.timestamp.
 * 3. If delta < 60 seconds, award the bonus.
 * 4. Determine the speed tier (Instant, Fast, Swift).
 * 5. Increment the daily swiftRecoveryCount.
 */
export async function checkSwiftRecovery(
  uid: string,
  eventId: string,
  event: SessionEvent,
): Promise<void> {
  const sessionId = event.sessionId;
  const distractionTimestamp = Date.parse(event.timestamp);

  if (isNaN(distractionTimestamp)) {
    logger.warn('Invalid distraction timestamp for Swift Recovery', { eventId });
    return;
  }

  // §8.6.2: Find the most recent IdleDetected event for this session
  const eventsRef = db.collection(`users/${uid}/session_events`);
  const idleQuery = eventsRef
    .where('sessionId', '==', sessionId)
    .where('type', '==', 'IdleDetected')
    .orderBy('timestamp', 'desc')
    .limit(1);

  const idleSnap = await idleQuery.get();

  if (idleSnap.empty) {
    // No IdleDetected event for this session — no Swift Recovery possible.
    // This happens if the user manually logs a distraction without an idle trigger.
    logger.info('No IdleDetected event found for session, skipping Swift Recovery', {
      uid,
      sessionId,
    });
    return;
  }

  const idleEvent = idleSnap.docs[0].data() as SessionEvent;
  const idleTimestamp = Date.parse(idleEvent.timestamp);

  if (isNaN(idleTimestamp)) {
    logger.warn('Invalid idle timestamp for Swift Recovery', { uid, sessionId });
    return;
  }

  // §8.6.3: Calculate time delta
  const deltaMs = distractionTimestamp - idleTimestamp;

  // §8.6.4: Check threshold
  if (deltaMs < 0 || deltaMs >= FUNCTION_CONFIG.swiftRecoveryThresholdMs) {
    // Negative delta means IdleDetected arrived AFTER DistractionLogged (clock issue).
    // Delta >= 60s means too slow.
    logger.info('Swift Recovery not qualified', { uid, sessionId, deltaMs });
    return;
  }

  // §8.6.6: Determine speed tier
  const tier = getRecoveryTier(deltaMs);

  logger.info('Swift Recovery awarded', {
    uid,
    sessionId,
    eventId,
    deltaMs,
    tier,
  });

  // §8.6.5: Increment daily swiftRecoveryCount
  const eventDate = new Date(event.timestamp);
  const dateKey = eventDate.toISOString().split('T')[0];
  const dailyRef = db.doc(`users/${uid}/stats/daily/${dateKey}`);
  const dailySnap = await dailyRef.get();

  if (dailySnap.exists) {
    const currentCount = (dailySnap.data()!.swiftRecoveryCount as number) || 0;
    await dailyRef.update({
      swiftRecoveryCount: currentCount + 1,
      updatedAt: new Date().toISOString(),
    });
  } else {
    // Edge case: daily doc not yet created
    await dailyRef.set({
      date: dateKey,
      totalFocusSeconds: 0,
      sessionsCompleted: 0,
      sessionsEndedEarly: 0,
      distractionsLogged: 0,
      falseAlarms: 0,
      avgSessionSeconds: 0,
      longestSessionSeconds: 0,
      swiftRecoveryCount: 1,
      updatedAt: new Date().toISOString(),
    });
  }
}

/**
 * §8.6.6: Determine the recovery speed tier.
 *
 * Tiers:
 * - Instant: < 15 seconds — fastest recovery
 * - Fast: < 30 seconds — quick recovery
 * - Swift: < 60 seconds — within threshold
 *
 * Currently all tiers are treated equally (increment swiftRecoveryCount by 1).
 * Future enhancement: assign different point multipliers per tier.
 */
function getRecoveryTier(deltaMs: number): 'instant' | 'fast' | 'swift' {
  if (deltaMs < FUNCTION_CONFIG.swiftRecoveryTiers.instant) {
    return 'instant';
  }
  if (deltaMs < FUNCTION_CONFIG.swiftRecoveryTiers.fast) {
    return 'fast';
  }
  return 'swift';
}
```

#### 8.6.3. Time Delta Calculation: `DistractionLogged.timestamp − IdleDetected.timestamp`

The delta is computed from the client-issued ISO 8601 timestamps:

```typescript
const deltaMs = Date.parse(distractionLogged.timestamp) - Date.parse(idleDetected.timestamp);
```

**Why client timestamps are reliable for this calculation:**

Both timestamps are generated on the SAME device within the SAME session. The system clock does not change between the two events (unless the user manually changes their clock during an intervention — an implausible scenario). Therefore, the delta is accurate regardless of absolute clock drift.

**Edge case — clock change during intervention:**

If the user changes their system clock during the intervention (e.g., to fake a fast recovery), the delta would be artificially short. This is mitigated by:

1. The delta must be >= 0 (negative deltas are rejected).
2. Future enhancement: compare against Firestore `createTime` metadata (server timestamp) for the two documents. The `createTime` is set by the Firestore server when the document is first written, providing an independent timestamp. If the client delta and server delta differ by more than 10 seconds, flag the recovery as suspicious.

#### 8.6.4. Threshold: Delta < 60 Seconds Qualifies for Bonus

The threshold is `FUNCTION_CONFIG.swiftRecoveryThresholdMs = 60_000` (60 seconds = 60,000 milliseconds).

**Rationale:** 60 seconds is a generous window that rewards intentional, prompt distraction acknowledgment without being so tight that normal modal interaction time (reading the prompt, selecting a category, typing a note) would disqualify legitimate recoveries.

**Failure cases (no bonus):**

| Scenario | Delta | Result |
|---|---|---|
| User logs distraction in 5 seconds | 5,000ms | ✅ Swift Recovery (Instant tier) |
| User logs distraction in 45 seconds | 45,000ms | ✅ Swift Recovery (Swift tier) |
| User logs distraction in 90 seconds | 90,000ms | ❌ No bonus |
| User snoozes intervention, logs later | 300,000ms+ | ❌ No bonus |
| User marks false alarm | N/A | ❌ FalseAlarmMarked is not DistractionLogged |
| No IdleDetected event for session | N/A | ❌ No idle trigger to compare against |

#### 8.6.5. Bonus Points Calculation & Application

Currently, the Swift Recovery bonus is a simple counter increment (`swiftRecoveryCount += 1`). There is no point system in MVP. The counter is used for:

1. **Daily aggregate display:** Shown in the Reports view as "Swift Recoveries today."
2. **Achievement tracking:** Recovery achievements (`recovery_bronze`, `recovery_silver`, `recovery_gold`) use the cumulative `swiftRecoveryCount` across all daily aggregates.

**Future enhancement — tiered point multipliers:**

```typescript
// Future: different point values per tier
const TIER_MULTIPLIERS = {
  instant: 3,  // < 15s
  fast: 2,     // < 30s
  swift: 1,    // < 60s
};

// Future: swiftRecoveryPoints += TIER_MULTIPLIERS[tier];
```

#### 8.6.6. Recovery Speed Tiers (Instant < 15s, Fast < 30s, Swift < 60s)

| Tier | Threshold | Delta Range | Description |
|---|---|---|---|
| **Instant** | < 15,000ms | 0 – 14,999ms | The user acknowledged the distraction almost immediately. Indicates high focus awareness. |
| **Fast** | < 30,000ms | 15,000 – 29,999ms | Quick recovery. Normal response time for reading the modal and entering a note. |
| **Swift** | < 60,000ms | 30,000 – 59,999ms | Within the threshold. User took time to categorize but still responded reasonably quickly. |

All three tiers currently award the same bonus (swiftRecoveryCount += 1). The tier classification is logged for analytics and is available for future point differentiation.

---

### 8.7. Shiny Badge RNG System

The Shiny Badge system adds a collectible element to the gamification. On completion of a "perfect" focus session (no distractions, timer ran to natural completion), the server rolls a random number to determine if the user receives a rare aesthetic variant of an achievement badge.

**Specification** (TARGET_ARCHITECTURE.md §6):

> *Shiny Badges:* Server-side RNG (Random Number Generator) drops for rare aesthetic badges awarded upon completion of perfect focus blocks.

#### 8.7.1. Trigger Condition: Perfect Focus Block Completed (No Distractions, No Early End)

A Shiny Badge roll occurs when ALL of the following conditions are met:

1. The event type is `TimerCompleted` (NOT `TimerEndedEarly`).
2. `payload.endedEarly === false`.
3. `payload.distractionCount === 0`.

These conditions are checked in the `handleTimerCompleted` handler (→ §8.3.4):

```typescript
// From: functions/src/handlers/timer-completed.ts

if (isCompleted && !payload.endedEarly && payload.distractionCount === 0) {
  await checkShinyBadge(uid, event.sessionId);
}
```

**Verification of `distractionCount`:**

The client-supplied `distractionCount` is treated as advisory. For the Shiny Badge check, the Cloud Function ALSO verifies by querying the Event Ledger:

```typescript
// File: functions/src/engines/shiny-badge.ts (excerpt)

async function verifyPerfectSession(uid: string, sessionId: string): Promise<boolean> {
  const eventsRef = db.collection(`users/${uid}/session_events`);
  const distractionQuery = eventsRef
    .where('sessionId', '==', sessionId)
    .where('type', '==', 'DistractionLogged')
    .limit(1);

  const distractionSnap = await distractionQuery.get();
  return distractionSnap.empty; // true if no distractions found
}
```

This server-side verification prevents a client from setting `distractionCount: 0` on a session that actually had distractions.

#### 8.7.2. Server-Side Random Number Generation

The Cloud Function uses Node.js `crypto.randomInt()` for cryptographically secure random number generation:

```typescript
import { randomInt } from 'crypto';

function rollShinyDrop(): boolean {
  // Roll a number between 0 and 9999 (inclusive)
  const roll = randomInt(10_000);
  // Drop rate: FUNCTION_CONFIG.shinyBadgeDropRate (default 0.05 = 5%)
  const threshold = Math.floor(FUNCTION_CONFIG.shinyBadgeDropRate * 10_000);
  return roll < threshold;
}
```

**Why `crypto.randomInt()` and not `Math.random()`?**

`Math.random()` uses a PRNG (Pseudo-Random Number Generator) seeded from the system clock. While adequate for most uses, `crypto.randomInt()` uses the OS's cryptographic random source, providing better uniformity and unpredictability. Since Shiny Badges are a gamification feature affecting user motivation, using a robust RNG prevents suspicion of bias.

#### 8.7.3. Drop Rate Table (Rarity Tiers: Common, Uncommon, Rare, Legendary)

The base drop rate (`FUNCTION_CONFIG.shinyBadgeDropRate = 0.05`) is 5% per perfect session. When a shiny drop is triggered, a second roll determines the rarity tier:

| Rarity | Roll Range | Probability (given drop) | Overall Probability | Visual Treatment |
|---|---|---|---|---|
| **Common** | 0 – 5999 | 60% | 3.0% per perfect session | Subtle shimmer effect |
| **Uncommon** | 6000 – 8499 | 25% | 1.25% per perfect session | Animated sparkle border |
| **Rare** | 8500 – 9699 | 12% | 0.6% per perfect session | Holographic gradient |
| **Legendary** | 9700 – 9999 | 3% | 0.15% per perfect session | Animated particle aura + unique color |

```typescript
type ShinyRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

function rollRarity(): ShinyRarity {
  const roll = randomInt(10_000);
  if (roll < 6000) return 'common';
  if (roll < 8500) return 'uncommon';
  if (roll < 9700) return 'rare';
  return 'legendary';
}
```

#### 8.7.4. Badge Catalog & Aesthetic Variants

Shiny badges are NOT separate achievement types — they are aesthetic variants of the 12 existing achievements (→ §8.5.1). A user can have BOTH a regular `focus_bronze` badge and a shiny `focus_bronze` badge. The shiny variant is stored as a separate document with `_shiny` suffix:

**Shiny badge document IDs:**

| Regular Achievement | Shiny Variant Document ID |
|---|---|
| `focus_bronze` | `focus_bronze_shiny` |
| `focus_silver` | `focus_silver_shiny` |
| `focus_gold` | `focus_gold_shiny` |
| `streak_bronze` | `streak_bronze_shiny` |
| `streak_silver` | `streak_silver_shiny` |
| `streak_gold` | `streak_gold_shiny` |
| `recovery_bronze` | `recovery_bronze_shiny` |
| `recovery_silver` | `recovery_silver_shiny` |
| `recovery_gold` | `recovery_gold_shiny` |
| `perfect_bronze` | `perfect_bronze_shiny` |
| `perfect_silver` | `perfect_silver_shiny` |
| `perfect_gold` | `perfect_gold_shiny` |

**Shiny badge selection logic:**

When a shiny drop is triggered, the Cloud Function selects which achievement to make shiny:

1. Query the user's existing achievements (`users/{uid}/achievements/`).
2. Filter to achievements that do NOT already have a shiny variant.
3. If no eligible achievements exist, the shiny drop is wasted (the user has all-shiny — an extremely rare condition).
4. Select a random eligible achievement from the filtered list.

#### 8.7.5. Badge Document Write with Rarity Metadata

**Shiny badge document schema:**

```json
{
  "achievementId": "focus_bronze_shiny",
  "tier": "bronze",
  "category": "focus",
  "title": "First Steps ✦",
  "description": "Complete 10 focus sessions. (Shiny variant)",
  "earnedAt": "2026-04-03T15:30:00.000Z",
  "isShiny": true,
  "shinyRarity": "rare",
  "shinySessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "progress": {
    "current": 10,
    "target": 10
  }
}
```

| Field | Type | Description |
|---|---|---|
| `achievementId` | `string` | Same as the regular achievement but with `_shiny` suffix. |
| `tier` | `string` | Same as the base achievement's tier. |
| `category` | `string` | Same as the base achievement's category. |
| `title` | `string` | Base title with `✦` appended. |
| `description` | `string` | Base description with "(Shiny variant)" appended. |
| `earnedAt` | `string` | ISO 8601 timestamp of award. |
| `isShiny` | `boolean` | Always `true` for shiny badges. |
| `shinyRarity` | `string` | `"common"`, `"uncommon"`, `"rare"`, or `"legendary"`. |
| `shinySessionId` | `string` | The `sessionId` of the perfect session that triggered the drop. |
| `progress` | `object` | Copied from the base achievement. |

**Full implementation** (`src/engines/shiny-badge.ts`):

```typescript
// File: functions/src/engines/shiny-badge.ts

import { getFirestore } from 'firebase-admin/firestore';
import { randomInt } from 'crypto';
import { logger } from 'firebase-functions/v2';
import { FUNCTION_CONFIG } from '../config';
import { ACHIEVEMENT_DEFINITIONS } from './achievement';
import type { AchievementDocument } from '../types';

const db = getFirestore();

type ShinyRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

/**
 * Check if a perfect session earns a Shiny Badge.
 *
 * §8.7.1: Only called for perfect sessions (TimerCompleted, 0 distractions, not ended early).
 * §8.7.2: Uses crypto.randomInt() for RNG.
 * §8.7.3: Two-phase roll — first roll determines drop, second determines rarity.
 */
export async function checkShinyBadge(
  uid: string,
  sessionId: string,
): Promise<void> {
  // Verify the session was truly perfect (server-side verification)
  const isPerfect = await verifyPerfectSession(uid, sessionId);
  if (!isPerfect) {
    logger.info('Session not verified as perfect, skipping shiny badge roll', {
      uid,
      sessionId,
    });
    return;
  }

  // Phase 1: Roll for shiny drop
  const dropRoll = randomInt(10_000);
  const dropThreshold = Math.floor(FUNCTION_CONFIG.shinyBadgeDropRate * 10_000);

  if (dropRoll >= dropThreshold) {
    logger.info('Shiny badge roll failed', { uid, sessionId, dropRoll, dropThreshold });
    return;
  }

  // Phase 2: Determine rarity
  const rarity = rollRarity();

  // Phase 3: Select which achievement to make shiny
  const achievementsRef = db.collection(`users/${uid}/achievements`);
  const achievementsSnap = await achievementsRef.get();

  const earnedIds = new Set(achievementsSnap.docs.map((doc) => doc.id));

  // Find achievements that are earned but don't have a shiny variant yet
  const eligibleForShiny = ACHIEVEMENT_DEFINITIONS.filter((def) => {
    const hasRegular = earnedIds.has(def.achievementId);
    const hasShiny = earnedIds.has(`${def.achievementId}_shiny`);
    return hasRegular && !hasShiny;
  });

  if (eligibleForShiny.length === 0) {
    logger.info('No eligible achievements for shiny variant', { uid, sessionId });
    return;
  }

  // Random selection from eligible achievements
  const selected = eligibleForShiny[randomInt(eligibleForShiny.length)];

  // Phase 4: Write shiny badge document
  const shinyId = `${selected.achievementId}_shiny`;
  const shinyRef = db.doc(`users/${uid}/achievements/${shinyId}`);

  // Get the base achievement's progress
  const baseDoc = await db.doc(`users/${uid}/achievements/${selected.achievementId}`).get();
  const baseData = baseDoc.data() as AchievementDocument;

  const shinyBadge: AchievementDocument & { shinyRarity: string; shinySessionId: string } = {
    achievementId: shinyId,
    tier: selected.tier,
    category: selected.category,
    title: `${selected.title} ✦`,
    description: `${selected.description} (Shiny variant)`,
    earnedAt: new Date().toISOString(),
    isShiny: true,
    shinyRarity: rarity,
    shinySessionId: sessionId,
    progress: baseData.progress,
  };

  await shinyRef.set(shinyBadge);

  logger.info('Shiny badge awarded!', {
    uid,
    sessionId,
    achievementId: shinyId,
    rarity,
  });
}

async function verifyPerfectSession(uid: string, sessionId: string): Promise<boolean> {
  const eventsRef = db.collection(`users/${uid}/session_events`);

  // Check for any DistractionLogged events for this session
  const distractionQuery = eventsRef
    .where('sessionId', '==', sessionId)
    .where('type', '==', 'DistractionLogged')
    .limit(1);
  const distractionSnap = await distractionQuery.get();

  if (!distractionSnap.empty) {
    return false; // Has distractions — not perfect
  }

  // Check for any FalseAlarmMarked events (false alarms don't count as distractions
  // but a session with false alarms is still "perfect" — the trigger was a false alarm)
  // No action needed for false alarms.

  // Verify the session actually completed (has a TimerCompleted event, not TimerEndedEarly)
  const completedQuery = eventsRef
    .where('sessionId', '==', sessionId)
    .where('type', '==', 'TimerCompleted')
    .limit(1);
  const completedSnap = await completedQuery.get();

  return !completedSnap.empty; // Must have a TimerCompleted event
}

function rollRarity(): ShinyRarity {
  const roll = randomInt(10_000);
  if (roll < 6000) return 'common';
  if (roll < 8500) return 'uncommon';
  if (roll < 9700) return 'rare';
  return 'legendary';
}
```

#### 8.7.6. Anti-Cheat: Why RNG Must Be Server-Side

**The threat:** If the shiny badge RNG ran on the client (Angular), a user could:

1. Intercept the RNG call and force it to always return `true`.
2. Modify the Angular source code in the Photino Chromium cache to change the drop rate.
3. Directly write shiny achievement documents to Firestore (if `allow write` were permitted).

**The defense:** All three attack vectors are closed by the target architecture:

1. **RNG runs on the server:** The `crypto.randomInt()` call is in a Cloud Function. The client has no access to the RNG state.
2. **Angular source modification is irrelevant:** Even if a user modifies the Angular code, the modified code cannot trigger the Cloud Function's shiny badge logic — the Cloud Function only fires on `onDocumentCreated` for `session_events`, and the function itself decides whether to roll.
3. **Firestore security rules deny client writes to achievements:**
   ```
   match /users/{uid}/achievements/{achievementId} {
     allow write: if false;
   }
   ```
   Only the Cloud Function (Admin SDK, which bypasses rules) can write achievement documents.

**The only remaining attack surface:** A user could create fake `TimerCompleted` events with `distractionCount: 0` to trigger more shiny rolls. This is mitigated by:
- The `verifyPerfectSession()` function queries the Event Ledger for actual `DistractionLogged` events, ignoring the client-supplied `distractionCount`.
- Event validation (→ §8.2.2) rejects events with implausible `durationSeconds`.
- Rate limiting (→ §7.4.4) flags accounts with excessive event creation.

---

### 8.8. Migrated Event Handling

Events created by the SQLite → Firestore migration utility (→ §7.5) have a `migrated: true` flag. The Cloud Function pipeline handles these events differently to avoid retroactive gamification anomalies.

**Migrated event processing rules:**

| Feature | Normal Events | Migrated Events |
|---|---|---|
| Daily aggregate update | Incremental update | Incremental update (same logic) |
| Streak tracking | Full evaluation | **SKIPPED** — historical streak reconstruction is complex and produces misleading results |
| Achievement check | Full evaluation | **SKIPPED** — achievements should be earned "live," not retroactively from imported data |
| Swift Recovery | Full evaluation | **SKIPPED** — migrated distractions don't have reliable IdleDetected pairing |
| Shiny Badge roll | Full evaluation | **SKIPPED** — perfect session verification requires IdleDetected event correlation |
| Idempotency tracking | Yes | Yes (same `processed_events` logic) |

**Implementation in the dispatcher:**

```typescript
// File: functions/src/pipeline/event-dispatcher.ts (addition for migrated events)

export async function dispatchEvent(
  uid: string,
  eventId: string,
  event: SessionEvent,
): Promise<void> {
  const isMigrated = event.migrated === true;

  switch (event.type) {
    case 'TimerCompleted':
    case 'TimerEndedEarly':
      if (isMigrated) {
        // Only update daily aggregate — skip streak, achievements, shiny
        await handleMigratedTimerCompleted(uid, eventId, event);
      } else {
        await handleTimerCompleted(uid, eventId, event);
      }
      break;

    case 'DistractionLogged':
      if (isMigrated) {
        // Only update daily distraction counter — skip Swift Recovery, achievements
        await handleMigratedDistractionLogged(uid, eventId, event);
      } else {
        await handleDistractionLogged(uid, eventId, event);
      }
      break;

    case 'FalseAlarmMarked':
      // False alarm handling is the same for migrated and normal events
      await handleFalseAlarm(uid, eventId, event);
      break;

    // ... other event types unchanged
  }
}
```

**Migrated timer handler:**

```typescript
// File: functions/src/handlers/timer-completed.ts (migrated variant)

export async function handleMigratedTimerCompleted(
  uid: string,
  eventId: string,
  event: SessionEvent,
): Promise<void> {
  const payload = event.payload as TimerCompletedPayload;
  const durationSeconds = payload.durationSeconds;

  if (durationSeconds <= 0 || durationSeconds > FUNCTION_CONFIG.maxSessionDurationSeconds) {
    return;
  }

  const eventDate = new Date(event.timestamp);
  const dateKey = eventDate.toISOString().split('T')[0];
  const isCompleted = event.type === 'TimerCompleted';
  const isEndedEarly = event.type === 'TimerEndedEarly';

  // Same daily aggregate update logic as normal handler
  const dailyRef = db.doc(`users/${uid}/stats/daily/${dateKey}`);
  const dailySnap = await dailyRef.get();

  if (dailySnap.exists) {
    const data = dailySnap.data()!;
    const newTotal = ((data.totalFocusSeconds as number) || 0) + durationSeconds;
    const newCompleted = ((data.sessionsCompleted as number) || 0) + (isCompleted ? 1 : 0);
    const newEndedEarly = ((data.sessionsEndedEarly as number) || 0) + (isEndedEarly ? 1 : 0);
    const newTotalSessions = newCompleted + newEndedEarly;

    await dailyRef.update({
      totalFocusSeconds: newTotal,
      sessionsCompleted: newCompleted,
      sessionsEndedEarly: newEndedEarly,
      avgSessionSeconds: newTotalSessions > 0 ? Math.round((newTotal / newTotalSessions) * 100) / 100 : 0,
      longestSessionSeconds: Math.max((data.longestSessionSeconds as number) || 0, durationSeconds),
      updatedAt: new Date().toISOString(),
    });
  } else {
    await dailyRef.set({
      date: dateKey,
      totalFocusSeconds: durationSeconds,
      sessionsCompleted: isCompleted ? 1 : 0,
      sessionsEndedEarly: isEndedEarly ? 1 : 0,
      distractionsLogged: 0,
      falseAlarms: 0,
      avgSessionSeconds: durationSeconds,
      longestSessionSeconds: durationSeconds,
      swiftRecoveryCount: 0,
      updatedAt: new Date().toISOString(),
    });
  }

  // NO streak update, NO achievement check, NO shiny badge for migrated events
}
```

---

### 8.9. Cross-Reference Table

| Section | Source File | Target File / Function | Status |
|---|---|---|---|
| §8.1.1 | *(no source equivalent)* | `functions/src/index.ts` | NEW |
| §8.1.2 | *(no source equivalent)* | `functions/src/config.ts` | NEW |
| §8.1.3 | *(no source equivalent)* | Firebase environment (no external secrets for MVP) | NEW |
| §8.2.1 | *(no source equivalent)* | `functions/src/pipeline/event-processor.ts` | NEW |
| §8.2.2 | *(no source equivalent)* | `functions/src/pipeline/event-validator.ts` | NEW |
| §8.2.3 | *(no source equivalent)* | `functions/src/pipeline/idempotency.ts` | NEW |
| §8.2.4 | *(no source equivalent)* | `functions/src/pipeline/event-dispatcher.ts` | NEW |
| §8.3.1 | `Sentinel.Engine\ReportingService.cs` (focus time computation) | `functions/src/handlers/timer-completed.ts` | REPLACED — server-side incremental aggregate |
| §8.3.2 | *(source does not deduct idle time)* | No idle deduction (same as source) | NO CHANGE |
| §8.3.3 | `Sentinel.Engine\ReportingService.cs` (session counting) | `functions/src/handlers/timer-completed.ts` | REPLACED — separate counters for completed vs. early-ended |
| §8.3.4 | `Sentinel.Engine\ReportingService.cs` (daily focus array) | `functions/src/handlers/timer-completed.ts` + `distraction-logged.ts` + `false-alarm.ts` | REPLACED — server-computed `stats/daily/{date}` |
| §8.4 | *(no source equivalent)* | `functions/src/engines/streak.ts` | NEW |
| §8.5 | *(no source equivalent)* | `functions/src/engines/achievement.ts` | NEW |
| §8.5.3 | *(no source equivalent)* | `users/{uid}/achievements/{achievementId}` | NEW — document write (→ §6.2.3.3) |
| §8.6 | *(no source equivalent)* | `functions/src/engines/swift-recovery.ts` | NEW |
| §8.7 | *(no source equivalent)* | `functions/src/engines/shiny-badge.ts` | NEW |
| §8.8 | `Sentinel.Engine\DistractionRepository.cs` (migration schema v6) | `functions/src/handlers/timer-completed.ts` (migrated variant) | ADAPTED — migrated events skip gamification |

## 9. Migration Execution Plan

This section defines the phase-by-phase execution plan for migrating Project Sentinel from the source stack (WPF / WebView2 / React / SQLite) to the target stack (Photino / Angular / Firebase). Each phase is a self-contained vertical slice that can be built, tested, and demonstrated independently. Phases are ordered by dependency — each phase builds on the deliverables of prior phases.

**Governing principles:**

1. **Vertical slices over horizontal layers.** Each phase delivers a working feature, not a layer. Phase 1 produces a window that sends and receives IPC messages. Phase 4 produces a working timer with intervention flow. No phase delivers "just infrastructure."
2. **Source-first verification.** Before implementing a target feature, read the source file(s) that implement the equivalent behavior. Verify that the target implementation handles every edge case the source handles.
3. **No parallel paths.** The source application (`Sentinel.Engine` + `Sentinel.UI`) remains the production build until Phase 12. The target application (`Sentinel.Shell` + `Sentinel.App`) is developed in a separate project directory within the same solution. The two coexist in `Sentinel.sln` throughout development.
4. **Test at each phase boundary.** Each phase has explicit acceptance criteria. All criteria must pass before proceeding to the next phase.

**Phase dependency graph:**

```
Phase 1: Photino Shell ──────────────────────────────────────┐
Phase 2: OS Hooks ────────────────────────────────┐          │
Phase 3: Angular Scaffold ──────────────────┐     │          │
                                            ▼     ▼          ▼
Phase 4: Timer + Intervention ◄─── [3] ◄── [2] ◄── [1]
Phase 5: Firebase Auth + Std Persistence ◄─── [3]
Phase 6: Event Ledger ◄─── [4] + [5]
Phase 7: Cloud Functions ◄─── [6]
Phase 8: Planner ◄─── [5]
Phase 9: Reports ◄─── [7]
Phase 10: Migration Tooling ◄─── [6] + [7]
Phase 11: E2E Testing ◄─── [1–10]
Phase 12: Installer + Release ◄─── [11]
```

**Solution structure after all phases complete:**

```
Sentinel.sln
├── Sentinel.Engine/           ← Source (WPF) — RETAINED for reference, excluded from build
├── Sentinel.Engine.Tests/     ← Source tests — RETAINED for reference
├── Sentinel.Shell/            ← Target (Photino C# host)
├── Sentinel.Shell.Tests/      ← Target C# tests (xUnit)
├── Sentinel.App/              ← Target (Angular SPA)
├── functions/                 ← Firebase Cloud Functions (TypeScript)
├── build.ps1                  ← UPDATED for target
├── installer.iss              ← UPDATED for target
└── firebase.json              ← UPDATED with functions config
```

---

### 9.1. Phase 1: Photino Shell Scaffold & IPC Skeleton

**Objective:** Create the `Sentinel.Shell` C# project with a `PhotinoWindow` that loads a placeholder HTML page and demonstrates bidirectional IPC message passing between C# and the web content.

**Prerequisites:** None. This is the first phase.

**Blueprint references:** §2 (Photino C# Shell & Native Host), §3 (IPC Bridge)

#### 9.1.1. Deliverables

| # | Deliverable | File Path | Status |
|---|---|---|---|
| 1 | New C# console project (WinExe output) | `Sentinel.Shell/Sentinel.Shell.csproj` | NEW |
| 2 | Program entry point with PhotinoWindow | `Sentinel.Shell/Program.cs` | NEW |
| 3 | IPC router (C# side) | `Sentinel.Shell/IpcDispatcher.cs` | NEW |
| 4 | IPC message type constants | `Sentinel.Shell/IpcMessageTypes.cs` | NEW |
| 5 | Placeholder HTML for IPC testing | `Sentinel.Shell/wwwroot/index.html` | NEW (temporary — replaced in Phase 3) |
| 6 | App manifest (DPI awareness, admin) | `Sentinel.Shell/app.manifest` | PORTED from `Sentinel.Engine/app.manifest` |
| 7 | Application icon | `Sentinel.Shell/sentinel.ico` | COPIED from `Sentinel.Engine/sentinel.ico` |
| 8 | Solution file updated | `Sentinel.sln` | MODIFIED — add `Sentinel.Shell` project |

#### 9.1.2. Source → Target File Map

| Source File | Target File | Action |
|---|---|---|
| `Sentinel.Engine/Sentinel.Engine.csproj` | `Sentinel.Shell/Sentinel.Shell.csproj` | REWRITE — remove WPF, WebView2, EF Core; add `Photino.NET` |
| `Sentinel.Engine/App.xaml` | *(eliminated)* | WPF Application class not needed — Photino uses `Main()` |
| `Sentinel.Engine/App.xaml.cs` | `Sentinel.Shell/Program.cs` | REWRITE — `PhotinoWindow` replaces WPF `Application` lifecycle |
| `Sentinel.Engine/MainWindow.xaml` | *(eliminated)* | XAML window not needed — Photino creates a native window |
| `Sentinel.Engine/MainWindow.xaml.cs` | `Sentinel.Shell/Program.cs` + `Sentinel.Shell/IpcDispatcher.cs` | SPLIT — window setup in `Program.cs`, IPC routing in `IpcDispatcher.cs` |
| `Sentinel.Engine/app.manifest` | `Sentinel.Shell/app.manifest` | PORTED verbatim |

#### 9.1.3. Implementation Steps

**Step 1: Create `Sentinel.Shell.csproj`**

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net8.0-windows</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <UseWPF>false</UseWPF>

    <AssemblyName>Sentinel</AssemblyName>
    <RootNamespace>Sentinel.Shell</RootNamespace>
    <Version>2.0.0</Version>
    <FileVersion>2.0.0.0</FileVersion>
    <AssemblyVersion>2.0.0.0</AssemblyVersion>
    <Product>Sentinel</Product>
    <Description>Privacy-first Pomodoro overlay for Windows</Description>
    <Company>Sentinel</Company>
    <Copyright>Copyright © 2026</Copyright>
    <ApplicationIcon>sentinel.ico</ApplicationIcon>

    <PublishSingleFile>true</PublishSingleFile>
    <SelfContained>true</SelfContained>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
    <IncludeNativeLibrariesForSelfExtract>true</IncludeNativeLibrariesForSelfExtract>
    <EnableCompressionInSingleFile>true</EnableCompressionInSingleFile>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Photino.NET" Version="3.*" />
  </ItemGroup>

  <ItemGroup>
    <Content Include="wwwroot\**" CopyToOutputDirectory="PreserveNewest" />
  </ItemGroup>

</Project>
```

**Key differences from source `Sentinel.Engine.csproj`:**

| Property | Source | Target | Rationale |
|---|---|---|---|
| `UseWPF` | `true` | `false` | Photino does not use WPF |
| `Microsoft.EntityFrameworkCore.Sqlite` | Present | REMOVED | SQLite eliminated (→ §1) |
| `Microsoft.Web.WebView2` | Present | REMOVED | Photino replaces WebView2 (→ §2) |
| `Photino.NET` | Absent | ADDED | Photino shell (→ §2) |
| `Version` | `1.0.0` | `2.0.0` | Major version bump for architecture change |

**Step 2: Create `Program.cs` (→ §2)**

```csharp
// File: Sentinel.Shell/Program.cs

using PhotinoNET;
using System.Text.Json;

namespace Sentinel.Shell;

class Program
{
    private static PhotinoWindow? _window;
    private static IpcDispatcher? _dispatcher;

    [STAThread]
    static void Main(string[] args)
    {
        _dispatcher = new IpcDispatcher();

        _window = new PhotinoWindow()
            .SetTitle("Sentinel")
            .SetUseOsDefaultSize(false)
            .SetSize(420, 720)
            .SetMinSize(360, 600)
            .Center()
            .SetIconFile("sentinel.ico")
            .SetLogVerbosity(0)
            .RegisterWebMessageReceivedHandler(OnWebMessageReceived);

        // Load the Angular SPA (or placeholder in Phase 1)
        string wwwrootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot", "index.html");
        _window.Load(wwwrootPath);

        // Wire up the dispatcher's send callback
        _dispatcher.Initialize(message =>
        {
            _window.SendWebMessage(message);
        });

        _window.WaitForClose();
    }

    private static void OnWebMessageReceived(object? sender, string message)
    {
        try
        {
            _dispatcher?.HandleInbound(message);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[IPC] Error handling message: {ex.Message}");
        }
    }
}
```

**Source comparison — `MainWindow.xaml.cs` IPC handler being replaced:**

The source uses WebView2's `CoreWebView2.WebMessageReceived` event and `CoreWebView2.PostWebMessageAsJson()`. The target replaces these with Photino's `RegisterWebMessageReceivedHandler` and `SendWebMessage`. The handler signature changes from `CoreWebView2WebMessageReceivedEventArgs` to a raw `string` parameter. The message format remains `{ type: string, payload: object }` JSON (→ §3).

**Step 3: Create `IpcDispatcher.cs` (→ §3)**

```csharp
// File: Sentinel.Shell/IpcDispatcher.cs

using System.Text.Json;

namespace Sentinel.Shell;

public class IpcDispatcher
{
    private Action<string>? _sendToFrontend;

    public void Initialize(Action<string> sendCallback)
    {
        _sendToFrontend = sendCallback;
    }

    public void Send(string type, object? payload = null)
    {
        var envelope = new { type, payload };
        string json = JsonSerializer.Serialize(envelope, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        });
        _sendToFrontend?.Invoke(json);
    }

    public void HandleInbound(string rawJson)
    {
        using var doc = JsonDocument.Parse(rawJson);
        var root = doc.RootElement;

        if (!root.TryGetProperty("type", out var typeProp))
        {
            Console.Error.WriteLine("[IPC] Received message without 'type' field");
            return;
        }

        string messageType = typeProp.GetString() ?? string.Empty;

        switch (messageType)
        {
            case IpcMessageTypes.SAVE_SETTINGS:
                // Wired in Phase 2 — SettingsService
                break;
            case IpcMessageTypes.AUDITOR_CLEARED:
                // Wired in Phase 2 — UserActivityMonitor
                break;
            case IpcMessageTypes.TOGGLE_COMPACT:
                // Wired in Phase 1 — window sizing
                HandleToggleCompact(root);
                break;
            case IpcMessageTypes.PLAY_SOUND:
                // Wired in Phase 2 — System.Media.SoundPlayer
                break;
            default:
                Console.Error.WriteLine($"[IPC] Unknown message type: {messageType}");
                break;
        }
    }

    private void HandleToggleCompact(JsonElement root)
    {
        // Placeholder — Phase 2 will implement window resizing
        Send(IpcMessageTypes.COMPACT_MODE_CHANGED, new { compact = true });
    }
}
```

**Step 4: Create `IpcMessageTypes.cs` (→ §3)**

```csharp
// File: Sentinel.Shell/IpcMessageTypes.cs

namespace Sentinel.Shell;

public static class IpcMessageTypes
{
    // C# → Angular (outbound)
    public const string IDLE_DETECTED = "IDLE_DETECTED";
    public const string USER_ACTIVE = "USER_ACTIVE";
    public const string SETTINGS_LOADED = "SETTINGS_LOADED";
    public const string UPDATE_AVAILABLE = "UPDATE_AVAILABLE";
    public const string SNOOZE_STATUS = "SNOOZE_STATUS";
    public const string SYSTEM_SUSPEND = "SYSTEM_SUSPEND";
    public const string SYSTEM_RESUME = "SYSTEM_RESUME";
    public const string HOTKEY_START_PAUSE = "HOTKEY_START_PAUSE";
    public const string HOTKEY_DISTRACTION = "HOTKEY_DISTRACTION";
    public const string COMPACT_MODE_CHANGED = "COMPACT_MODE_CHANGED";
    public const string MIGRATION_AVAILABLE = "MIGRATION_AVAILABLE";
    public const string MIGRATION_CHUNK = "MIGRATION_CHUNK";
    public const string MIGRATION_COMPLETE = "MIGRATION_COMPLETE";

    // Angular → C# (inbound)
    public const string SAVE_SETTINGS = "SAVE_SETTINGS";
    public const string AUDITOR_CLEARED = "AUDITOR_CLEARED";
    public const string TOGGLE_COMPACT = "TOGGLE_COMPACT";
    public const string OVERLAY_MINIMIZE = "OVERLAY_MINIMIZE";
    public const string OVERLAY_CLOSE = "OVERLAY_CLOSE";
    public const string PLAY_SOUND = "PLAY_SOUND";
    public const string START_MIGRATION = "START_MIGRATION";
    public const string SKIP_MIGRATION = "SKIP_MIGRATION";
}
```

**Step 5: Create placeholder `wwwroot/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sentinel – IPC Test</title>
  <style>
    body { font-family: system-ui; background: #0a0a0a; color: #e0e0e0; padding: 2rem; }
    pre { background: #1a1a1a; padding: 1rem; border-radius: 0.5rem; overflow: auto; max-height: 300px; }
    button { background: #3b82f6; color: white; border: none; padding: 0.5rem 1rem; border-radius: 0.5rem; cursor: pointer; margin: 0.25rem; }
  </style>
</head>
<body>
  <h1>Sentinel IPC Test Harness</h1>
  <button onclick="sendMessage('TOGGLE_COMPACT', {})">Toggle Compact</button>
  <button onclick="sendMessage('SAVE_SETTINGS', { pomodoroMinutes: 25 })">Save Settings</button>
  <h2>Messages Received:</h2>
  <pre id="log"></pre>
  <script>
    const log = document.getElementById('log');

    // Photino IPC: receive from C#
    window.external.receiveMessage(function(message) {
      const entry = JSON.parse(message);
      log.textContent = JSON.stringify(entry, null, 2) + '\n---\n' + log.textContent;
    });

    // Photino IPC: send to C#
    function sendMessage(type, payload) {
      window.external.sendMessage(JSON.stringify({ type, payload }));
    }
  </script>
</body>
</html>
```

**Step 6: Update `Sentinel.sln`**

Add the `Sentinel.Shell` project to the solution. Retain `Sentinel.Engine` and `Sentinel.Engine.Tests` projects for reference.

```
dotnet sln Sentinel.sln add Sentinel.Shell\Sentinel.Shell.csproj
```

#### 9.1.4. Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| 1 | `dotnet build Sentinel.Shell` compiles without errors | CLI build |
| 2 | Running `Sentinel.Shell.exe` opens a native window with the test harness | Manual launch |
| 3 | Clicking "Toggle Compact" sends `TOGGLE_COMPACT` to C# and receives `COMPACT_MODE_CHANGED` back | Observe message in `<pre>` log |
| 4 | Window title is "Sentinel" | Visual check |
| 5 | Window icon is `sentinel.ico` | Visual check |
| 6 | Window starts centered at 420×720 pixels | Visual check |
| 7 | `Sentinel.Engine` project still builds independently | `dotnet build Sentinel.Engine` |

---

### 9.2. Phase 2: Port Idle Detection & Native Hooks to Photino Host

**Objective:** Port all OS-level monitoring services from `Sentinel.Engine` into `Sentinel.Shell` and wire them to the IPC dispatcher so that idle detection, media detection, active window monitoring, system suspend/resume, hotkeys, and settings persistence all function within the Photino host.

**Prerequisites:** Phase 1 (Photino shell exists, IPC dispatcher functional).

**Blueprint references:** §4 (OS-Level Hooks & Native Interop), §2.3 (Settings Persistence), §3 (IPC message types)

#### 9.2.1. Deliverables

| # | Deliverable | File Path | Status |
|---|---|---|---|
| 1 | Idle detection service | `Sentinel.Shell/Services/UserActivityMonitor.cs` | PORTED from `Sentinel.Engine/UserActivityMonitor.cs` with breaking changes (→ §4.1) |
| 2 | Media/audio detection service | `Sentinel.Shell/Services/MediaDetector.cs` | PORTED verbatim from `Sentinel.Engine/MediaDetector.cs` (→ §4.2) |
| 3 | Active window monitor (NEW) | `Sentinel.Shell/Services/ActiveWindowMonitor.cs` | NEW (→ §4.3) |
| 4 | System suspend/resume monitor | `Sentinel.Shell/Services/SystemSuspendMonitor.cs` | NEW — extracted from `MainWindow.xaml.cs` event handling |
| 5 | Global hotkey registration | `Sentinel.Shell/Services/HotkeyManager.cs` | NEW — extracted from `MainWindow.xaml.cs` hotkey logic |
| 6 | Settings data model | `Sentinel.Shell/Models/AppSettings.cs` | PORTED from `Sentinel.Engine/SettingsService.cs` (→ §4.4) |
| 7 | Settings file I/O service | `Sentinel.Shell/Services/SettingsService.cs` | PORTED from `Sentinel.Engine/SettingsService.cs` (→ §2.3) |
| 8 | Program.cs updated with service wiring | `Sentinel.Shell/Program.cs` | MODIFIED — instantiate and wire all services |
| 9 | IpcDispatcher updated with all handlers | `Sentinel.Shell/IpcDispatcher.cs` | MODIFIED — handle `SAVE_SETTINGS`, `AUDITOR_CLEARED`, `PLAY_SOUND` |

#### 9.2.2. Source → Target File Map

| Source File | Source Class/Method | Target File | Target Class | Action |
|---|---|---|---|---|
| `Sentinel.Engine/UserActivityMonitor.cs` | `UserActivityMonitor` | `Sentinel.Shell/Services/UserActivityMonitor.cs` | `UserActivityMonitor` | PORTED — `DispatcherTimer` → `System.Timers.Timer`, new `IdleEventArgs`, integrated `ActiveWindowMonitor` check |
| `Sentinel.Engine/MediaDetector.cs` | `MediaDetector` | `Sentinel.Shell/Services/MediaDetector.cs` | `MediaDetector` | PORTED verbatim — uses COM `IAudioMeterInformation` |
| `Sentinel.Engine/MainWindow.xaml.cs` | Suspend/Resume handlers | `Sentinel.Shell/Services/SystemSuspendMonitor.cs` | `SystemSuspendMonitor` | EXTRACTED — `SystemEvents.PowerModeChanged` listener |
| `Sentinel.Engine/MainWindow.xaml.cs` | `RegisterHotKey` P/Invoke | `Sentinel.Shell/Services/HotkeyManager.cs` | `HotkeyManager` | EXTRACTED — `RegisterHotKey`/`UnregisterHotKey` P/Invoke |
| `Sentinel.Engine/SettingsService.cs` | `SettingsService` + `AppSettings` | `Sentinel.Shell/Services/SettingsService.cs` + `Sentinel.Shell/Models/AppSettings.cs` | `SettingsService` + `AppSettings` | SPLIT — model separated from service; `ActiveWindowWhitelist` field added |
| *(no source)* | — | `Sentinel.Shell/Services/ActiveWindowMonitor.cs` | `ActiveWindowMonitor` | NEW — `GetForegroundWindow` + `GetWindowThreadProcessId` for whitelist check |

#### 9.2.3. Key Breaking Changes from Source

**`UserActivityMonitor` breaking changes (→ §4.1):**

| Aspect | Source (`Sentinel.Engine`) | Target (`Sentinel.Shell`) |
|---|---|---|
| Timer type | `System.Windows.Threading.DispatcherTimer` | `System.Timers.Timer` (no WPF dependency) |
| Event threading | Events fire on UI thread (WPF Dispatcher) | Events fire on ThreadPool thread — must use `_window.Invoke()` for UI calls |
| Event args | `EventArgs` (no data) | `IdleEventArgs { IdleDurationMs: long }` |
| Active window check | Not present | Integrated — polls `ActiveWindowMonitor.IsWhitelistedActive()` before firing idle |
| Media check | Separate, called by `MainWindow.xaml.cs` | Integrated — polls `MediaDetector.IsAudioPlaying()` to suppress false idles |

**`AppSettings` addition (→ §4.4):**

```csharp
// Added field in target AppSettings (not present in source):
public List<string> ActiveWindowWhitelist { get; set; } = new()
{
    "devenv",    // Visual Studio
    "code",      // VS Code
    "rider64",   // JetBrains Rider
};
```

#### 9.2.4. Implementation Steps

**Step 1:** Port `UserActivityMonitor.cs` with timer type change and `ActiveWindowMonitor` integration (→ §4.1).

**Step 2:** Copy `MediaDetector.cs` verbatim — COM interop for `IAudioMeterInformation` is WPF-independent (→ §4.2).

**Step 3:** Create `ActiveWindowMonitor.cs` with `GetForegroundWindow`/`GetWindowThreadProcessId` P/Invoke (→ §4.3).

**Step 4:** Extract `SystemSuspendMonitor.cs` from `MainWindow.xaml.cs` — `Microsoft.Win32.SystemEvents.PowerModeChanged` listener that fires `SYSTEM_SUSPEND` and `SYSTEM_RESUME` IPC messages.

**Step 5:** Extract `HotkeyManager.cs` from `MainWindow.xaml.cs` — `RegisterHotKey`/`UnregisterHotKey` P/Invoke for `Ctrl+Shift+S` (start/pause) and `Ctrl+Shift+D` (log distraction).

**Step 6:** Split `SettingsService.cs` into `Models/AppSettings.cs` (POCO) and `Services/SettingsService.cs` (file I/O). Add `ActiveWindowWhitelist` property. Settings path remains `%LOCALAPPDATA%\Sentinel\settings.json`.

**Step 7:** Update `Program.cs` to instantiate all services and wire event handlers:

```csharp
// File: Sentinel.Shell/Program.cs (Phase 2 additions — service wiring)

var settings = SettingsService.Load();
var dispatcher = new IpcDispatcher();
var mediaDetector = new MediaDetector();
var activeWindowMonitor = new ActiveWindowMonitor(settings.ActiveWindowWhitelist);
var activityMonitor = new UserActivityMonitor(
    settings.IdleThresholdSeconds,
    mediaDetector,
    activeWindowMonitor
);
var suspendMonitor = new SystemSuspendMonitor();

activityMonitor.IdleDetected += (s, e) =>
{
    _window!.Invoke(() => dispatcher.Send(IpcMessageTypes.IDLE_DETECTED, new
    {
        idleDurationMs = e.IdleDurationMs
    }));
};

activityMonitor.UserBecameActive += (s, e) =>
{
    _window!.Invoke(() => dispatcher.Send(IpcMessageTypes.USER_ACTIVE, null));
};

suspendMonitor.Suspended += (s, e) =>
    _window!.Invoke(() => dispatcher.Send(IpcMessageTypes.SYSTEM_SUSPEND, null));

suspendMonitor.Resumed += (s, e) =>
    _window!.Invoke(() => dispatcher.Send(IpcMessageTypes.SYSTEM_RESUME, null));
```

**Step 8:** Update `IpcDispatcher.cs` to handle `SAVE_SETTINGS`, `AUDITOR_CLEARED`, and `PLAY_SOUND` inbound messages. `SAVE_SETTINGS` calls `SettingsService.Save()`. `AUDITOR_CLEARED` calls `activityMonitor.ResetIdleState()`. `PLAY_SOUND` plays a system sound via `System.Media.SoundPlayer`.

#### 9.2.5. Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| 1 | Idle detection fires `IDLE_DETECTED` IPC message after configured threshold of inactivity | Leave machine idle for threshold seconds, observe IPC message in test harness |
| 2 | Moving mouse/keyboard after idle fires `USER_ACTIVE` IPC message | Move mouse after idle, observe message |
| 3 | Idle detection is suppressed when a whitelisted process (e.g., `code.exe`) is focused | Focus VS Code, leave idle — no `IDLE_DETECTED` fires |
| 4 | Idle detection is suppressed when audio is playing | Play audio, leave idle — no `IDLE_DETECTED` fires |
| 5 | `SAVE_SETTINGS` IPC message persists settings to `%LOCALAPPDATA%\Sentinel\settings.json` | Send `SAVE_SETTINGS`, verify file on disk |
| 6 | `SETTINGS_LOADED` is sent to frontend on startup with loaded settings | Observe message on app launch |
| 7 | System sleep → `SYSTEM_SUSPEND` IPC, wake → `SYSTEM_RESUME` IPC | Put machine to sleep and wake |
| 8 | Hotkey `Ctrl+Shift+S` sends `HOTKEY_START_PAUSE` IPC | Press hotkey, observe message |
| 9 | All source `Sentinel.Engine.Tests` that cover `UserActivityMonitor`, `MediaDetector`, `SettingsService` continue to pass against the source project | `dotnet test Sentinel.Engine.Tests` |

---

### 9.3. Phase 3: Angular App Scaffold with Design System

**Objective:** Create the Angular SPA project (`Sentinel.App`), configure Tailwind CSS v4 with the dark-mode design system (→ §5.1, design tokens from `artifacts/stitch/sentinel-product-design-brief/design-system.md`), implement shared layout components, set up routing for all feature modules, and connect the Angular app to the Photino shell's `wwwroot`.

**Prerequisites:** Phase 1 (Photino shell loads `wwwroot/index.html`).

**Blueprint references:** §5 (Angular Frontend Application), §5.1 (Project Scaffold), §5.2 (Shared Components), §5.3 (Routing)

#### 9.3.1. Deliverables

| # | Deliverable | File Path(s) | Status |
|---|---|---|---|
| 1 | Angular project via `ng new` (standalone, no NgModules) | `Sentinel.App/` | NEW |
| 2 | Tailwind CSS v4 configuration with design tokens | `Sentinel.App/src/styles.css`, `Sentinel.App/tailwind.config.js` | NEW |
| 3 | App routing with lazy-loaded feature modules | `Sentinel.App/src/app/app.routes.ts` | NEW |
| 4 | `BridgeService` — Angular ↔ Photino IPC wrapper | `Sentinel.App/src/app/core/bridge.service.ts` | NEW (→ §3.6) |
| 5 | Shared `IconComponent` | `Sentinel.App/src/app/shared/icon.component.ts` | NEW (→ §5.2.1) |
| 6 | Shared `WorkspaceLayoutComponent` | `Sentinel.App/src/app/shared/workspace-layout.component.ts` | NEW (→ §5.2.2) |
| 7 | Shared `SectionCardComponent` | `Sentinel.App/src/app/shared/section-card.component.ts` | NEW (→ §5.2.3) |
| 8 | Shared `ModalLayoutComponent` | `Sentinel.App/src/app/shared/modal-layout.component.ts` | NEW (→ §5.2.4) |
| 9 | Build script integration (Vite → `ng build` → `wwwroot/`) | `Sentinel.App/angular.json` + `build.ps1` | MODIFIED |
| 10 | Feature module stubs (empty routed components) | `Sentinel.App/src/app/features/*/` | NEW — 9 feature modules |

#### 9.3.2. Source → Target File Map

| Source File | Target File | Action |
|---|---|---|
| `Sentinel.UI/package.json` | `Sentinel.App/package.json` | REWRITE — Angular CLI replaces Vite/React |
| `Sentinel.UI/vite.config.ts` | `Sentinel.App/angular.json` | REPLACED by Angular CLI build config |
| `Sentinel.UI/tailwind.config.js` | `Sentinel.App/tailwind.config.js` | PORTED — same design tokens, Angular-specific `content` paths |
| `Sentinel.UI/src/index.css` | `Sentinel.App/src/styles.css` | PORTED — Tailwind directives + custom properties |
| `Sentinel.UI/index.html` | `Sentinel.App/src/index.html` | PORTED — `<app-root>` replaces `<div id="root">` |
| `Sentinel.UI/src/App.tsx` (router structure) | `Sentinel.App/src/app/app.routes.ts` | RESTRUCTURED — React Router → Angular lazy routes |
| `Sentinel.UI/src/ui.tsx` (`Icon`, layout components) | `Sentinel.App/src/app/shared/*.component.ts` | PORTED to Angular standalone components |
| `Sentinel.UI/src/bridge.test.ts` (IPC bridge) | `Sentinel.App/src/app/core/bridge.service.ts` | REWRITTEN — class-based Angular service with Signals |

#### 9.3.3. Angular Project Structure (§5.1)

```
Sentinel.App/
  angular.json
  package.json
  tsconfig.json
  tsconfig.app.json
  tailwind.config.js
  src/
    index.html
    main.ts
    styles.css
    app/
      app.component.ts
      app.routes.ts
      core/
        bridge.service.ts
        models.ts                    ← (stub — populated in Phase 4)
      shared/
        icon.component.ts
        workspace-layout.component.ts
        section-card.component.ts
        modal-layout.component.ts
        ui-utils.ts
      features/
        timer/
          timer.component.ts         ← (stub — populated in Phase 4)
          timer.routes.ts
        intervention/
          intervention.component.ts  ← (stub — populated in Phase 4)
        planner/
          planner.component.ts       ← (stub — populated in Phase 8)
          planner.routes.ts
        reports/
          reports.component.ts       ← (stub — populated in Phase 9)
          reports.routes.ts
        history/
          history.component.ts       ← (stub — populated in Phase 9)
          history.routes.ts
        taxonomy/
          taxonomy.component.ts      ← (stub — populated in Phase 5)
          taxonomy.routes.ts
        settings/
          settings.component.ts      ← (stub — populated in Phase 5)
          settings.routes.ts
        account/
          account.component.ts       ← (stub — populated in Phase 5)
          account.routes.ts
        onboarding/
          onboarding.component.ts    ← (stub — populated in Phase 5)
```

#### 9.3.4. Design System Integration

**Source:** Design tokens are defined in `artifacts/stitch/sentinel-product-design-brief/design-system.md`. These specify the exact color palette, typography scale, spacing scale, border radii, and shadows.

**Target:** Tailwind CSS v4 custom theme in `styles.css` using `@theme` directive:

```css
/* File: Sentinel.App/src/styles.css */

@import "tailwindcss";

@theme {
  /* Colors from design-system.md */
  --color-surface-primary: #0a0a0a;
  --color-surface-secondary: #141414;
  --color-surface-tertiary: #1e1e1e;
  --color-border-default: #2a2a2a;
  --color-border-active: #3b82f6;
  --color-text-primary: #f5f5f5;
  --color-text-secondary: #a3a3a3;
  --color-text-muted: #737373;
  --color-accent-blue: #3b82f6;
  --color-accent-green: #22c55e;
  --color-accent-amber: #f59e0b;
  --color-accent-red: #ef4444;

  /* Typography */
  --font-family-sans: 'Inter Variable', system-ui, sans-serif;
  --font-family-display: 'Manrope Variable', system-ui, sans-serif;

  /* Spacing — 4px base unit */
  --spacing-1: 0.25rem;
  --spacing-2: 0.5rem;
  --spacing-3: 0.75rem;
  --spacing-4: 1rem;
  --spacing-6: 1.5rem;
  --spacing-8: 2rem;

  /* Border radius */
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
}

/* Global resets */
body {
  @apply bg-surface-primary text-text-primary font-sans;
  margin: 0;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
}
```

#### 9.3.5. BridgeService (§3.6)

```typescript
// File: Sentinel.App/src/app/core/bridge.service.ts

import { Injectable, NgZone, inject, signal } from '@angular/core';

export interface IpcEnvelope {
  type: string;
  payload: unknown;
}

type MessageHandler = (payload: unknown) => void;

@Injectable({ providedIn: 'root' })
export class BridgeService {
  private readonly ngZone = inject(NgZone);
  private readonly handlers = new Map<string, MessageHandler[]>();

  readonly connected = signal(false);

  constructor() {
    // Register Photino inbound message listener
    if ((window as any).external?.receiveMessage) {
      (window as any).external.receiveMessage((raw: string) => {
        this.ngZone.run(() => {
          try {
            const envelope: IpcEnvelope = JSON.parse(raw);
            this.dispatch(envelope.type, envelope.payload);
          } catch (err) {
            console.error('[BridgeService] Failed to parse IPC message:', err);
          }
        });
      });
      this.connected.set(true);
    } else {
      console.warn('[BridgeService] Photino IPC not available — running in browser mode');
    }
  }

  send(type: string, payload: unknown = null): void {
    const json = JSON.stringify({ type, payload });
    if ((window as any).external?.sendMessage) {
      (window as any).external.sendMessage(json);
    } else {
      console.warn('[BridgeService] Cannot send — no Photino bridge:', type);
    }
  }

  on(type: string, handler: MessageHandler): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);

    // Return unsubscribe function
    return () => {
      const current = this.handlers.get(type);
      if (current) {
        const index = current.indexOf(handler);
        if (index !== -1) current.splice(index, 1);
      }
    };
  }

  private dispatch(type: string, payload: unknown): void {
    const list = this.handlers.get(type);
    if (list) {
      for (const handler of list) {
        handler(payload);
      }
    }
  }
}
```

#### 9.3.6. Build Pipeline Integration

Update `build.ps1` to build the Angular app into `Sentinel.Shell/wwwroot/` instead of `Sentinel.Engine/wwwroot/`:

```powershell
# build.ps1 changes for Phase 3:
# - $UIDir changes from Sentinel.UI to Sentinel.App
# - $EngineDir changes from Sentinel.Engine to Sentinel.Shell
# - npm run build → ng build --configuration production
# - Vite outputs to wwwroot/ via vite.config.ts → Angular outputs via angular.json outputPath
```

The Angular `angular.json` must set `outputPath` to `../Sentinel.Shell/wwwroot` so that `ng build` places the production assets directly into the shell's content directory.

#### 9.3.7. Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| 1 | `ng build` compiles without errors | CLI build |
| 2 | Running `Sentinel.Shell.exe` loads the Angular app (not the Phase 1 test harness) | Visual — see app scaffold |
| 3 | Navigation between stub routes works (sidebar or URL) | Click nav links → route changes |
| 4 | Dark theme renders correctly (dark background, light text) | Visual check |
| 5 | `BridgeService` receives `SETTINGS_LOADED` on app startup | Console log or UI indicator |
| 6 | `BridgeService.send()` delivers messages to C# `IpcDispatcher` | Send a test message, observe C# console output |
| 7 | Shared components (`Icon`, `WorkspaceLayout`, `SectionCard`, `ModalLayout`) render correctly | Navigate to a route that uses them |

---

### 9.4. Phase 4: Timer Module & Intervention Flow in Angular

**Objective:** Implement the complete timer engine and distraction intervention flow in Angular, replicating and enhancing the source React implementation. This phase delivers the core user-facing feature: start a focus session → detect idle → force intervention modal → log distraction or mark false alarm → resume timer.

**Prerequisites:** Phase 2 (idle detection wired to IPC), Phase 3 (Angular scaffold with `BridgeService`).

**Blueprint references:** §5.4 (Timer Module), §5.5 (Intervention Flow)

#### 9.4.1. Deliverables

| # | Deliverable | File Path(s) | Status |
|---|---|---|---|
| 1 | `TimerService` — core timer engine | `Sentinel.App/src/app/core/timer.service.ts` | NEW (→ §5.4.1) |
| 2 | Timer utility functions | `Sentinel.App/src/app/core/timer.utils.ts` | PORTED from `Sentinel.UI/src/utils.ts` (→ §5.4.2) |
| 3 | Timer component (main UI) | `Sentinel.App/src/app/features/timer/timer.component.ts` | NEW (→ §5.4.3) |
| 4 | `InterventionService` — intervention state machine | `Sentinel.App/src/app/core/intervention.service.ts` | NEW (→ §5.5.1) |
| 5 | Intervention modal component | `Sentinel.App/src/app/features/intervention/intervention.component.ts` | NEW (→ §5.5.2) |
| 6 | `KeyboardService` — global keyboard shortcuts | `Sentinel.App/src/app/core/keyboard.service.ts` | NEW (→ §5.10) |
| 7 | Data models (timer-related interfaces) | `Sentinel.App/src/app/core/models.ts` | POPULATED (→ §6.1) |

#### 9.4.2. Source → Target Component Map

| Source | Source Location | Target | Target Location | Action |
|---|---|---|---|---|
| Timer state machine (hooks) | `Sentinel.UI/src/App.tsx` lines 85–250 | `TimerService` | `src/app/core/timer.service.ts` | RESTRUCTURED — React hooks → Angular service with Signals |
| `formatTime()`, `formatTimeShort()` | `Sentinel.UI/src/utils.ts` | `timer.utils.ts` | `src/app/core/timer.utils.ts` | PORTED — pure functions, framework-independent |
| `InterventionModal` component | `Sentinel.UI/src/views.tsx` lines 1–120 | `InterventionComponent` | `src/app/features/intervention/intervention.component.ts` | PORTED — JSX → Angular template |
| Timer display UI | `Sentinel.UI/src/App.tsx` (render section) | `TimerComponent` | `src/app/features/timer/timer.component.ts` | PORTED — JSX → Angular template |
| `handleDistraction()` | `Sentinel.UI/src/App.tsx` lines 300–350 | `InterventionService.logDistraction()` | `src/app/core/intervention.service.ts` | RESTRUCTURED — calls `EventLedgerService` (wired in Phase 6, stubbed here) |
| `handleFalseAlarm()` | `Sentinel.UI/src/App.tsx` lines 360–380 | `InterventionService.markFalseAlarm()` | `src/app/core/intervention.service.ts` | RESTRUCTURED — calls `EventLedgerService` (wired in Phase 6, stubbed here) |

#### 9.4.3. Timer States & Transitions (→ §5.4.1)

The `TimerService` manages the following state machine:

```
                    ┌──────────┐
         start()   │          │  complete()
    ┌──────────────►│ RUNNING  ├──────────────────┐
    │               │          │                  │
    │               └────┬─────┘                  ▼
    │                    │                   ┌──────────┐
┌───┴────┐       pause() │                   │ COMPLETED │
│  IDLE  │               │                   └──────────┘
└───┬────┘               ▼
    │              ┌──────────┐
    │              │ PAUSED   │
    │              └────┬─────┘
    │           resume() │
    │                    │
    │               ┌────▼─────┐
    │     endEarly()│ RUNNING  │
    └───────────────┤          │
                    └──────────┘

RUNNING + IDLE_DETECTED IPC → INTERRUPTED (intervention modal shown)
INTERRUPTED + distraction logged → RUNNING (timer resumes)
INTERRUPTED + false alarm marked → RUNNING (timer resumes)
```

**Key difference from source:** The source timer runs in React state (`useState` hooks). The target timer runs in an Angular service using `signal()` primitives. The timer tick uses `setInterval()` in both source and target — this is a deliberate choice over `requestAnimationFrame` because the timer must continue ticking even when the window is minimized or unfocused.

#### 9.4.4. Intervention Modal Behavior (→ §5.5)

**Source behavior** (from `Sentinel.UI/src/views.tsx` `InterventionModal`):

1. Modal appears when `IDLE_DETECTED` IPC message arrives.
2. Modal has a 5-second snooze countdown.
3. User must select a distraction note and category from the taxonomy, OR mark as false alarm.
4. Modal cannot be dismissed without action.
5. On submit, `AUDITOR_CLEARED` IPC message is sent to C#.

**Target behavior:** Identical to source, with these enhancements:

- The modal is an Angular overlay component rendered at the root level (not inside a feature route).
- The `InterventionService` manages modal visibility, snooze state, and the distraction form.
- Distraction logging calls `EventLedgerService.writeEvent()` (wired in Phase 6; in Phase 4, this is a console.log stub).
- Taxonomy suggestions are provided by `TaxonomyService` (wired in Phase 5; in Phase 4, uses hardcoded defaults).

#### 9.4.5. Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| 1 | Timer starts counting down from configured duration (default 25:00) | Click start, observe countdown |
| 2 | Timer can be paused and resumed | Click pause → timer stops, click resume → timer continues |
| 3 | Timer reaching zero triggers completion state and plays a sound (`PLAY_SOUND` IPC) | Wait for timer to reach 0:00 |
| 4 | `IDLE_DETECTED` IPC from C# triggers the intervention modal overlay | Leave machine idle |
| 5 | Intervention modal cannot be dismissed without logging a distraction or marking false alarm | Try clicking outside modal — nothing happens |
| 6 | Logging a distraction dismisses the modal and resumes the timer | Enter note, select category, submit |
| 7 | Marking false alarm dismisses the modal and resumes the timer | Click "False Alarm" button |
| 8 | `AUDITOR_CLEARED` IPC is sent to C# after distraction/false alarm | Observe C# console output |
| 9 | Keyboard shortcut `Ctrl+Shift+S` toggles start/pause | Press hotkey |
| 10 | Timer display shows `MM:SS` format with leading zeros | Visual check |

---

### 9.5. Phase 5: Firebase Integration (Auth, Standard Persistence)

**Objective:** Integrate Firebase Authentication (Google sign-in) and implement the Standard Persistence path for Settings, Taxonomy, and Account features. After this phase, users can sign in, their settings sync to Firestore, and the taxonomy manager reads/writes to Firestore.

**Prerequisites:** Phase 3 (Angular scaffold with routing and shared components).

**Blueprint references:** §5.8 (Account/Auth), §5.9 (Settings), §5.6 (Taxonomy), §7.1 (Offline Persistence), §7.2 (Standard Persistence)

#### 9.5.1. Deliverables

| # | Deliverable | File Path(s) | Status |
|---|---|---|---|
| 1 | Firebase provider (Angular DI initialization) | `Sentinel.App/src/app/core/firebase.provider.ts` | NEW (→ §7.1.1) |
| 2 | `AuthService` — Firebase Auth + Google sign-in | `Sentinel.App/src/app/core/auth.service.ts` | NEW (→ §5.8) |
| 3 | Auth guard for protected routes | `Sentinel.App/src/app/core/auth.guard.ts` | NEW (→ §5.3) |
| 4 | `SettingsService` (Angular) — Firestore sync + local bridge | `Sentinel.App/src/app/core/settings.service.ts` | NEW (→ §7.2.1) |
| 5 | Settings feature component | `Sentinel.App/src/app/features/settings/settings.component.ts` | POPULATED (→ §5.9) |
| 6 | `TaxonomyService` — Firestore CRUD + snapshot listener | `Sentinel.App/src/app/core/taxonomy.service.ts` | NEW (→ §7.2.1) |
| 7 | Taxonomy utility functions | `Sentinel.App/src/app/core/taxonomy.utils.ts` | PORTED from `Sentinel.UI/src/taxonomy.ts` |
| 8 | Taxonomy manager feature component | `Sentinel.App/src/app/features/taxonomy/taxonomy.component.ts` | POPULATED (→ §5.6) |
| 9 | Account feature component (sign-in/sign-out) | `Sentinel.App/src/app/features/account/account.component.ts` | POPULATED (→ §5.8) |
| 10 | Onboarding modal component | `Sentinel.App/src/app/features/onboarding/onboarding.component.ts` | POPULATED (→ §5.9) |
| 11 | Firebase config (`firebase.ts`) | `Sentinel.App/src/environments/firebase.config.ts` | NEW |
| 12 | Firestore security rules (Standard Persistence subset) | `firestore.rules` | MODIFIED (→ §7.4) |

#### 9.5.2. Source → Target File Map

| Source File | Target File | Action |
|---|---|---|
| `Sentinel.UI/src/firebase.ts` (init, `enableIndexedDbPersistence`) | `Sentinel.App/src/app/core/firebase.provider.ts` | REWRITTEN — Angular DI provider pattern, `enableIndexedDbPersistence` call |
| `Sentinel.UI/src/App.tsx` (auth state listener) | `Sentinel.App/src/app/core/auth.service.ts` | RESTRUCTURED — `onAuthStateChanged` listener in Angular service |
| `Sentinel.UI/src/views.tsx` `AuthScreen` | `Sentinel.App/src/app/features/account/account.component.ts` | PORTED — JSX → Angular template |
| `Sentinel.UI/src/views.tsx` `SettingsScreen` | `Sentinel.App/src/app/features/settings/settings.component.ts` | PORTED — JSX → Angular template |
| `Sentinel.UI/src/views.tsx` `TaxonomyManagerScreen` | `Sentinel.App/src/app/features/taxonomy/taxonomy.component.ts` | PORTED — JSX → Angular template |
| `Sentinel.UI/src/views.tsx` `OnboardingModal` | `Sentinel.App/src/app/features/onboarding/onboarding.component.ts` | PORTED — JSX → Angular template |
| `Sentinel.UI/src/taxonomy.ts` (normalization, suggestions) | `Sentinel.App/src/app/core/taxonomy.utils.ts` | PORTED verbatim — pure functions |
| `firestore.rules` (source — flat collections) | `firestore.rules` (target — user-scoped subcollections) | REWRITTEN (→ §7.4) |

#### 9.5.3. Firebase Initialization (→ §7.1)

The Angular app initializes Firebase with `enableIndexedDbPersistence()` for offline-first behavior:

```typescript
// File: Sentinel.App/src/app/core/firebase.provider.ts

import { APP_INITIALIZER, EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';
import { FIREBASE_CONFIG } from '../../environments/firebase.config';

let db: ReturnType<typeof getFirestore>;
let auth: ReturnType<typeof getAuth>;

export function getDb() { return db; }
export function getAuthInstance() { return auth; }

export function provideFirebase(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: APP_INITIALIZER,
      useFactory: () => async () => {
        const app = initializeApp(FIREBASE_CONFIG);
        db = getFirestore(app);
        auth = getAuth(app);
        try {
          await enableIndexedDbPersistence(db);
        } catch (err: any) {
          if (err.code === 'failed-precondition') {
            console.warn('Firestore persistence failed: multiple tabs open');
          } else if (err.code === 'unimplemented') {
            console.warn('Firestore persistence not available in this browser');
          }
        }
      },
      multi: true,
    },
  ]);
}
```

#### 9.5.4. Dual Settings Sync (→ §7.2.1)

The Angular `SettingsService` maintains a dual sync:

1. **Firestore → Angular:** `onSnapshot` listener on `users/{uid}/settings` — provides cross-device sync.
2. **Angular → C# Shell:** `SAVE_SETTINGS` IPC message — keeps the C# `settings.json` file in sync for shell-level settings (idle threshold, whitelist).

When settings change in Angular:
```
Angular UI → SettingsService.updateSettings()
  → setDoc(users/{uid}/settings, ...) → Firestore
  → bridgeService.send('SAVE_SETTINGS', ...) → C# SettingsService.Save() → settings.json
```

When settings arrive from another device (Firestore snapshot):
```
Firestore onSnapshot → SettingsService.handleRemoteChange()
  → update Angular signals
  → bridgeService.send('SAVE_SETTINGS', ...) → C# SettingsService.Save() → settings.json
```

#### 9.5.5. Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| 1 | Google sign-in flow works (popup or redirect) | Click "Sign in with Google" → authenticated |
| 2 | Auth state persists across app restarts (IndexedDB) | Close and reopen app — still signed in |
| 3 | Signed-out users are redirected to the Account page | Navigate to a protected route while signed out |
| 4 | Settings changes write to Firestore `users/{uid}/settings` | Change a setting, verify in Firebase console |
| 5 | Settings changes also write to local `settings.json` via IPC | Change a setting, check `%LOCALAPPDATA%\Sentinel\settings.json` |
| 6 | Taxonomy CRUD operations work: add, rename, delete categories | Perform each operation, verify in Firestore |
| 7 | Taxonomy data loads from Firestore on app start (snapshot listener) | Sign in → taxonomy appears |
| 8 | Offline mode: settings changes are queued and sync when online | Disconnect network → change setting → reconnect → verify Firestore |
| 9 | Onboarding modal appears on first sign-in (no settings doc exists) | Sign in with a new account |
| 10 | Firestore security rules reject writes from unauthenticated users | Use Firebase emulator to test rule rejection |

---

### 9.6. Phase 6: Event Ledger Client-Side Implementation

**Objective:** Implement the `EventLedgerService` in Angular, wire it to the `TimerService` and `InterventionService`, and enable the append-only Event Ledger write path for all 7 session event types. After this phase, every timer action and distraction log creates an immutable event document in `users/{uid}/session_events/`.

**Prerequisites:** Phase 4 (timer and intervention flow functional), Phase 5 (Firebase Auth and Firestore initialized).

**Blueprint references:** §6.2.2 (Event Ledger schema), §7.3 (Event Ledger persistence path), §3 (IPC message `LOG_DISTRACTION` / `LOG_SESSION` redesign)

#### 9.6.1. Deliverables

| # | Deliverable | File Path(s) | Status |
|---|---|---|---|
| 1 | `EventLedgerService` — append-only event writer | `Sentinel.App/src/app/core/event-ledger.service.ts` | NEW (→ §7.3.1) |
| 2 | Session event type definitions (TypeScript) | `Sentinel.App/src/app/core/models.ts` (additions) | POPULATED (→ §6.2.2) |
| 3 | `TimerService` updated to emit ledger events | `Sentinel.App/src/app/core/timer.service.ts` | MODIFIED — calls `EventLedgerService.writeEvent()` |
| 4 | `InterventionService` updated to emit ledger events | `Sentinel.App/src/app/core/intervention.service.ts` | MODIFIED — calls `EventLedgerService.writeEvent()` |
| 5 | Firestore security rules (Event Ledger subset) | `firestore.rules` | MODIFIED — append-only enforcement (→ §7.4.2) |

#### 9.6.2. The 7 Event Types (→ §6.2.2)

| Event Type | Emitted By | When | Payload |
|---|---|---|---|
| `TimerStarted` | `TimerService.startSession()` | User clicks Start | `{ durationSeconds, timerMode, presetName }` |
| `TimerPaused` | `TimerService.pause()` | User clicks Pause | `{ pausedAt, elapsedSeconds, reason }` |
| `TimerCompleted` | `TimerService.onTimerComplete()` | Timer reaches zero | `{ durationSeconds, startedAt, completedAt, distractionCount, falseAlarmCount, endedEarly: false }` |
| `TimerEndedEarly` | `TimerService.endEarly()` | User clicks End Early | `{ durationSeconds, startedAt, completedAt, distractionCount, falseAlarmCount, endedEarly: true }` |
| `IdleDetected` | `BridgeService` (from C# IPC) | `IDLE_DETECTED` IPC arrives | `{ idleDurationMs, timerTimeLeftSeconds }` |
| `DistractionLogged` | `InterventionService.logDistraction()` | User submits distraction form | `{ note, normalizedNote, categoryName }` |
| `FalseAlarmMarked` | `InterventionService.markFalseAlarm()` | User clicks False Alarm | `{}` (empty payload) |

#### 9.6.3. EventLedgerService Implementation (→ §7.3.1)

```typescript
// File: Sentinel.App/src/app/core/event-ledger.service.ts

import { Injectable, inject } from '@angular/core';
import { collection, addDoc } from 'firebase/firestore';
import { getDb } from './firebase.provider';
import { AuthService } from './auth.service';
import type { SessionEventType } from './models';

@Injectable({ providedIn: 'root' })
export class EventLedgerService {
  private readonly authService = inject(AuthService);

  async writeEvent(
    type: SessionEventType,
    sessionId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const uid = this.authService.uid;
    if (!uid) {
      console.error('[EventLedgerService] Cannot write event: not authenticated');
      return;
    }

    const event = {
      type,
      sessionId,
      timestamp: new Date().toISOString(), // Client ISO 8601, NOT serverTimestamp()
      payload,
    };

    const eventsRef = collection(getDb(), `users/${uid}/session_events`);
    await addDoc(eventsRef, event);
  }
}
```

**Key design decisions (→ §7.3):**

| Decision | Implementation | Rationale |
|---|---|---|
| `addDoc()` not `setDoc()` | Auto-generated document IDs | Append-only — no need for client-controlled IDs |
| `new Date().toISOString()` not `serverTimestamp()` | Client-side ISO 8601 string | `serverTimestamp()` resolves to `null` in offline reads (→ §7.3.4) |
| No `try/catch` retry logic | Firestore's native offline queue handles retries | Replaces the source's lossy `pendingSyncsRef` queue (→ §7.1.2) |
| `sessionId` as a parameter | Passed from `TimerService` (generated at session start) | Correlates all events within a session |

#### 9.6.4. TimerService Integration Points

In this phase, the `TimerService` stubs from Phase 4 are wired to emit real ledger events:

```typescript
// Additions to TimerService:

startSession(): void {
  this.currentSessionId = crypto.randomUUID();
  // ... existing timer start logic ...
  this.eventLedger.writeEvent('TimerStarted', this.currentSessionId, {
    durationSeconds: this.configuredDuration(),
    timerMode: this.timerMode(),
    presetName: this.presetName(),
  });
}

onTimerComplete(): void {
  // ... existing completion logic ...
  this.eventLedger.writeEvent('TimerCompleted', this.currentSessionId, {
    durationSeconds: this.configuredDuration(),
    startedAt: this.sessionStartedAt,
    completedAt: new Date().toISOString(),
    distractionCount: this.distractionCount(),
    falseAlarmCount: this.falseAlarmCount(),
    endedEarly: false,
  });
}
```

#### 9.6.5. Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| 1 | Starting a timer creates a `TimerStarted` event in Firestore | Check Firebase console → `users/{uid}/session_events/` |
| 2 | Pausing creates a `TimerPaused` event | Verify in Firestore |
| 3 | Timer completion creates a `TimerCompleted` event with correct `durationSeconds` | Verify in Firestore |
| 4 | Ending early creates a `TimerEndedEarly` event with `endedEarly: true` | Verify in Firestore |
| 5 | Idle detection creates an `IdleDetected` event | Leave machine idle, verify in Firestore |
| 6 | Logging a distraction creates a `DistractionLogged` event with note and category | Submit distraction form, verify in Firestore |
| 7 | Marking false alarm creates a `FalseAlarmMarked` event with empty payload | Click false alarm, verify in Firestore |
| 8 | All events share the same `sessionId` within a single focus session | Verify `sessionId` consistency across events |
| 9 | All events have client ISO 8601 `timestamp` (not Firestore server timestamp) | Verify `timestamp` field format |
| 10 | Events created offline are queued and sync when online | Disconnect → create events → reconnect → verify Firestore |
| 11 | Firestore security rules reject `update` and `delete` on `session_events` | Use Firebase emulator to test rule rejection |

---

### 9.7. Phase 7: Cloud Functions — Ledger Processing & Gamification

**Objective:** Implement the Firebase Cloud Functions backend that processes Event Ledger events, computes daily aggregates, tracks streaks, awards achievements, calculates Swift Recovery bonuses, and rolls for Shiny Badges. After this phase, the server-side authority model is fully operational.

**Prerequisites:** Phase 6 (Event Ledger events are being written to Firestore).

**Blueprint references:** §8 (Cloud Functions — complete section)

#### 9.7.1. Deliverables

| # | Deliverable | File Path(s) | Status |
|---|---|---|---|
| 1 | Cloud Functions project scaffold | `functions/package.json`, `functions/tsconfig.json` | NEW (→ §8.1.1) |
| 2 | Function entry point & config | `functions/src/index.ts`, `functions/src/config.ts` | NEW (→ §8.1.1, §8.1.2) |
| 3 | Shared type definitions | `functions/src/types.ts` | NEW (→ §8.2.2) |
| 4 | Event processing pipeline | `functions/src/pipeline/event-processor.ts` | NEW (→ §8.2.1) |
| 5 | Event validator | `functions/src/pipeline/event-validator.ts` | NEW (→ §8.2.2) |
| 6 | Idempotency guard | `functions/src/pipeline/idempotency.ts` | NEW (→ §8.2.3) |
| 7 | Event dispatcher | `functions/src/pipeline/event-dispatcher.ts` | NEW (→ §8.2.4) |
| 8 | Timer completed handler | `functions/src/handlers/timer-completed.ts` | NEW (→ §8.3.4) |
| 9 | Distraction logged handler | `functions/src/handlers/distraction-logged.ts` | NEW (→ §8.3.4) |
| 10 | False alarm handler | `functions/src/handlers/false-alarm.ts` | NEW (→ §8.3.4) |
| 11 | No-op handlers (started, paused, idle) | `functions/src/handlers/timer-started.ts`, `timer-paused.ts`, `idle-detected.ts` | NEW (→ §8.2.4) |
| 12 | Daily aggregate engine | `functions/src/engines/daily-aggregate.ts` | NEW (→ §8.3.4) |
| 13 | Streak tracking engine | `functions/src/engines/streak.ts` | NEW (→ §8.4) |
| 14 | Achievement engine | `functions/src/engines/achievement.ts` | NEW (→ §8.5) |
| 15 | Swift Recovery engine | `functions/src/engines/swift-recovery.ts` | NEW (→ §8.6) |
| 16 | Shiny Badge engine | `functions/src/engines/shiny-badge.ts` | NEW (→ §8.7) |
| 17 | Migrated event variants | (within existing handlers) | NEW (→ §8.8) |
| 18 | Firebase deployment config | `firebase.json` (updated `functions` section) | MODIFIED |
| 19 | Firestore security rules (server-computed aggregates) | `firestore.rules` | MODIFIED — read-only rules for `stats/`, `achievements/`, `processed_events/` |

#### 9.7.2. Source → Target Replacement Map

| Source Component | Source File | Cloud Function Replacement | Target File |
|---|---|---|---|
| `ReportingService.GetReportDataAsync()` | `Sentinel.Engine/ReportingService.cs` | Daily Aggregate Engine | `functions/src/engines/daily-aggregate.ts` (called from `timer-completed.ts`) |
| `App.tsx:fetchFirestoreHistory()` | `Sentinel.UI/src/App.tsx` | Eliminated — Angular reads aggregates | *(no target file — Angular reads `stats/daily/` directly)* |
| *(no source)* | — | Streak Tracking | `functions/src/engines/streak.ts` |
| *(no source)* | — | Achievement System | `functions/src/engines/achievement.ts` |
| *(no source)* | — | Swift Recovery | `functions/src/engines/swift-recovery.ts` |
| *(no source)* | — | Shiny Badge RNG | `functions/src/engines/shiny-badge.ts` |

#### 9.7.3. Implementation Steps

**Step 1: Initialize Cloud Functions project**

```bash
cd functions
npm init -y
npm install firebase-admin@^12 firebase-functions@^5
npm install -D typescript@~5.5 @types/node@^20
```

**Step 2: Implement the processing pipeline (→ §8.2)**

The pipeline is the entry point for all event processing. Each event flows through:
1. **Validation** (`event-validator.ts`) — verify schema, check required fields, validate timestamp plausibility.
2. **Idempotency** (`idempotency.ts`) — check `processed_events/{eventId}`, skip if already processed.
3. **Dispatch** (`event-dispatcher.ts`) — route to type-specific handler based on `event.type`.
4. **Handler** — type-specific logic (aggregate update, streak, achievements, etc.).

**Step 3: Implement handlers (→ §8.3–§8.4)**

- `timer-completed.ts`: Update daily aggregate → update streak → check achievements → check shiny badge.
- `distraction-logged.ts`: Update daily distraction counter → check Swift Recovery → check recovery achievements.
- `false-alarm.ts`: Update daily false alarm counter.
- `timer-started.ts`, `timer-paused.ts`, `idle-detected.ts`: No-op handlers (reserved for future analytics).

**Step 4: Implement engines (→ §8.4–§8.7)**

- `streak.ts`: Maintain `users/{uid}/stats/streaks` with `currentStreak`, `longestStreak`, `lastActiveDate`.
- `achievement.ts`: Check 12 achievement thresholds (4 categories × 3 tiers), write to `users/{uid}/achievements/{id}`.
- `swift-recovery.ts`: Query preceding `IdleDetected` event, calculate delta, categorize into speed tier.
- `shiny-badge.ts`: Verify perfect session, roll for drop (5% base rate), determine rarity tier, write shiny variant.

**Step 5: Deploy and verify with Firebase Emulator**

```bash
firebase emulators:start --only functions,firestore
```

Test by writing event documents directly to the Firestore emulator and verifying that aggregate documents, streak documents, and achievement documents are created correctly.

#### 9.7.4. Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| 1 | `TimerCompleted` event triggers Cloud Function and creates/updates `stats/daily/{date}` | Write event to emulator → verify aggregate document |
| 2 | `sessionsCompleted` counter increments correctly | Complete 3 sessions → counter = 3 |
| 3 | `totalFocusSeconds` sums correctly across sessions | Complete sessions with known durations → verify sum |
| 4 | `TimerEndedEarly` increments `sessionsEndedEarly`, not `sessionsCompleted` | End early → verify counters |
| 5 | Streak increments when consecutive days have sessions | Create events on consecutive dates → verify streak |
| 6 | Streak resets when a day is skipped | Skip a date → verify `currentStreak = 1` |
| 7 | `longestStreak` never decreases | Break streak → `longestStreak` remains at previous high |
| 8 | Bronze focus achievement is awarded at 10 sessions | Create 10 `TimerCompleted` events → verify `focus_bronze` document |
| 9 | Duplicate events (same `eventId`) are not double-counted | Process same event twice → aggregate unchanged after second |
| 10 | Swift Recovery awards when `DistractionLogged` is <60s after `IdleDetected` | Create paired events → verify `swiftRecoveryCount` increment |
| 11 | Shiny Badge roll occurs on perfect session (verified server-side) | Create perfect session → check logs for shiny roll |
| 12 | Migrated events update aggregates but skip streak/achievement/shiny | Write event with `migrated: true` → verify selective processing |
| 13 | Cloud Functions deploy successfully to `sentinel-s073` | `firebase deploy --only functions` |

---

### 9.8. Phase 8: Planner Module (Teams-Style Calendar)

**Objective:** Implement the Planner feature — a Teams-style calendar view where users can schedule focus blocks, breaks, and meetings throughout their day. This is entirely NEW functionality not present in the source codebase.

**Prerequisites:** Phase 5 (Firebase Standard Persistence — `PlannerService` writes to `users/{uid}/planner_blocks/`).

**Blueprint references:** §5.6 (Planner Module), §6.2.1.2 (Planner Block schema), §7.2.1 (Standard Persistence for planner)

#### 9.8.1. Deliverables

| # | Deliverable | File Path(s) | Status |
|---|---|---|---|
| 1 | `PlannerService` — Firestore CRUD for planner blocks | `Sentinel.App/src/app/core/planner.service.ts` | NEW (→ §7.2.1) |
| 2 | Planner feature component (calendar view) | `Sentinel.App/src/app/features/planner/planner.component.ts` | NEW (→ §5.6) |
| 3 | Planner block model | `Sentinel.App/src/app/core/models.ts` (additions) | POPULATED (→ §6.2.1.2) |
| 4 | Firestore security rules for `planner_blocks` | `firestore.rules` | MODIFIED (→ §7.4) |

#### 9.8.2. Planner Block Schema (→ §6.2.1.2)

```typescript
export interface PlannerBlock {
  id: string;              // Firestore document ID
  title: string;           // e.g., "Deep Work", "Meeting", "Break"
  startTime: string;       // ISO 8601 datetime
  endTime: string;         // ISO 8601 datetime
  blockType: 'focus' | 'break' | 'meeting' | 'other';
  color: string;           // Hex color for calendar display
  recurring: boolean;      // Whether this block repeats daily
  notes: string;           // Optional user notes
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
}
```

#### 9.8.3. Source Context

The source codebase has NO planner functionality. The `views.tsx` file contains `TimerScreen`, `ReportsScreen`, `SessionHistoryScreen`, `TaxonomyManagerScreen`, `SettingsScreen`, and `AuthScreen` — but no planner or calendar view. This feature is specified in TARGET_ARCHITECTURE.md §4:

> **Core Modules:** Timer, Planner (Teams-style calendar), History, Reports, Settings, and Account.

The Planner is referenced in the Stitch design brief at `artifacts/stitch/sentinel-product-design-brief/` and the navigation structure expects a "Planner" route.

#### 9.8.4. Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| 1 | Calendar view displays the current day's hours (7 AM – 10 PM default) | Visual check |
| 2 | Users can create, edit, and delete planner blocks via drag-and-drop or form | Perform each CRUD operation |
| 3 | Planner blocks persist to Firestore `users/{uid}/planner_blocks/` | Verify in Firebase console |
| 4 | Planner blocks load from Firestore on app start (snapshot listener) | Sign in → blocks appear |
| 5 | Offline mode: block changes queue and sync when online | Disconnect → create block → reconnect → verify Firestore |
| 6 | Focus blocks can trigger the timer with the configured duration | Click "Start" on a focus block → timer starts |

---

### 9.9. Phase 9: Reports Module with Server-Computed Aggregates

**Objective:** Implement the Reports and History features in Angular. Reports read from server-computed aggregate documents (`stats/daily/{date}`, `stats/streaks`, `achievements/`). History shows a chronological list of session events. This phase replaces the source's `ReportingService.cs` and React `ReportsScreen`.

**Prerequisites:** Phase 7 (Cloud Functions compute aggregates and achievements).

**Blueprint references:** §5.7 (Reports Module), §5.8 (History Module), §6.2.3 (Server-computed aggregate schemas)

#### 9.9.1. Deliverables

| # | Deliverable | File Path(s) | Status |
|---|---|---|---|
| 1 | `ReportService` — Firestore aggregate reader | `Sentinel.App/src/app/core/report.service.ts` | NEW (→ §7.2.2) |
| 2 | `AchievementService` — Firestore achievement listener | `Sentinel.App/src/app/core/achievement.service.ts` | NEW (→ §8.5.3) |
| 3 | Reports feature component (charts, stats cards) | `Sentinel.App/src/app/features/reports/reports.component.ts` | POPULATED (→ §5.7) |
| 4 | History feature component (event list) | `Sentinel.App/src/app/features/history/history.component.ts` | POPULATED (→ §5.8) |
| 5 | Report data models | `Sentinel.App/src/app/core/models.ts` (additions) | POPULATED (→ §6.2.3) |

#### 9.9.2. Source → Target Replacement Map

| Source Component | Source File | Target Component | Target File | Change |
|---|---|---|---|---|
| `ReportingService.GetReportDataAsync()` | `Sentinel.Engine/ReportingService.cs` | `ReportService.loadReport()` | `src/app/core/report.service.ts` | REPLACED — reads Firestore aggregates instead of querying SQLite |
| `App.tsx:fetchFirestoreHistory()` | `Sentinel.UI/src/App.tsx` | ELIMINATED | — | Angular reads `stats/daily/` directly |
| `ReportsScreen` (React) | `Sentinel.UI/src/views.tsx` | `ReportsComponent` (Angular) | `src/app/features/reports/reports.component.ts` | PORTED — JSX → Angular template, Recharts → custom charts or ngx-charts |
| `SessionHistoryScreen` (React) | `Sentinel.UI/src/views.tsx` | `HistoryComponent` (Angular) | `src/app/features/history/history.component.ts` | PORTED — JSX → Angular template, reads `session_events` directly |

#### 9.9.3. Report Data Sources

The Angular `ReportService` reads from Firestore aggregate documents (computed by Cloud Functions in Phase 7):

| Data | Firestore Path | Listener Type |
|---|---|---|
| Daily focus stats | `users/{uid}/stats/daily/{date}` | `onSnapshot` on date range query |
| Streak info | `users/{uid}/stats/streaks` | `onSnapshot` on single document |
| Achievements | `users/{uid}/achievements/` | `onSnapshot` on collection |
| Session event history | `users/{uid}/session_events/` | Paginated `getDocs` query (not real-time) |

**Key difference from source:** The source `ReportingService.cs` queries SQLite and computes aggregates on every report request. The target reads pre-computed aggregates from Firestore — no computation is done client-side. This means reports load instantly from cache (Firestore IndexedDB persistence) even when offline.

#### 9.9.4. Report Metrics Displayed

| Metric | Source Field | Display |
|---|---|---|
| Total focus time (today) | `stats/daily/{today}.totalFocusSeconds` | `HH:MM:SS` or `X hours Y minutes` |
| Sessions completed (today) | `stats/daily/{today}.sessionsCompleted` | Integer count |
| Sessions ended early (today) | `stats/daily/{today}.sessionsEndedEarly` | Integer count |
| Distractions logged (today) | `stats/daily/{today}.distractionsLogged` | Integer count |
| False alarms (today) | `stats/daily/{today}.falseAlarms` | Integer count |
| Swift recoveries (today) | `stats/daily/{today}.swiftRecoveryCount` | Integer count |
| Current streak | `stats/streaks.currentStreak` | `X days` |
| Longest streak | `stats/streaks.longestStreak` | `X days` |
| Weekly/monthly trends | `stats/daily/` (date range query) | Bar chart or line chart |
| Achievements earned | `achievements/` (all documents) | Badge grid with rarity indicators |

#### 9.9.5. Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| 1 | Reports page displays today's focus stats (total time, sessions, distractions) | Complete a session → navigate to Reports → verify stats |
| 2 | Streak display shows correct current and longest streak | Verify against `stats/streaks` document |
| 3 | Achievement badges display with correct tier (bronze/silver/gold) and shiny indicator | Earn an achievement → verify badge appears |
| 4 | History page shows chronological list of session events | Navigate to History → verify events listed |
| 5 | Reports load instantly from cache when offline | Disconnect → navigate to Reports → data appears |
| 6 | Date range selector filters daily aggregates correctly | Select "Last 7 days" → verify chart shows 7 data points |
| 7 | Charts render correctly for weekly/monthly trends | Visual check |

---

### 9.10. Phase 10: SQLite → Firestore Data Migration Tooling

**Objective:** Implement the data migration utility that reads the user's existing SQLite database (`sentinel.db`) and imports session history and distraction history into the Firestore Event Ledger. This ensures users don't lose their historical data when upgrading from the source to the target application.

**Prerequisites:** Phase 6 (Event Ledger write path), Phase 7 (Cloud Functions process migrated events correctly with `migrated: true` flag).

**Blueprint references:** §7.5 (Data Migration SQLite → Firestore)

#### 9.10.1. Deliverables

| # | Deliverable | File Path(s) | Status |
|---|---|---|---|
| 1 | C# SQLite reader service | `Sentinel.Shell/Services/MigrationService.cs` | NEW (→ §7.5.1) |
| 2 | Angular migration service (writer) | `Sentinel.App/src/app/core/migration.service.ts` | NEW (→ §7.5.1) |
| 3 | Migration prompt UI component | `Sentinel.App/src/app/features/onboarding/migration.component.ts` | NEW |
| 4 | IPC messages for migration flow | Already defined in `IpcMessageTypes.cs` (Phase 1) | WIRED |
| 5 | SQLite NuGet dependency (read-only, migration only) | `Sentinel.Shell/Sentinel.Shell.csproj` | MODIFIED — add `Microsoft.Data.Sqlite` (not EF Core) |

#### 9.10.2. Migration Flow (→ §7.5.1)

```
1. App startup → C# MigrationService checks for sentinel.db existence
   Path: %LOCALAPPDATA%\Sentinel\sentinel.db
   Also checks for .migration-complete marker file

2. If sentinel.db exists AND .migration-complete does NOT exist:
   → C# reads session count and distraction count from SQLite
   → Sends MIGRATION_AVAILABLE IPC: { sessionCount, distractionCount }

3. Angular shows migration prompt:
   "Found 142 sessions and 387 distractions in your local database.
    Would you like to import this history into your cloud account?"
   [Import History] [Skip]

4. If user clicks Import:
   → Angular sends START_MIGRATION IPC
   → C# reads SQLite data in chunks (50 records per chunk)
   → C# sends MIGRATION_CHUNK IPC for each chunk: { events[], chunkIndex, totalChunks }
   → Angular writes each chunk to Firestore via EventLedgerService (with migrated: true)
   → Angular shows progress bar: "Importing chunk 3 of 12..."

5. When all chunks are written:
   → C# sends MIGRATION_COMPLETE IPC: { migratedSessions, migratedDistractions }
   → Angular shows success summary
   → C# creates .migration-complete marker file
   → C# renames sentinel.db → sentinel.db.migrated (backup)

6. If user clicks Skip:
   → Angular sends SKIP_MIGRATION IPC
   → C# creates .migration-complete marker file (prevents future prompts)
```

#### 9.10.3. Source → Target Data Conversion (→ §7.5.2, §7.5.3)

**Session conversion:**

Each SQLite `Session` row becomes a `TimerStarted` + `TimerCompleted` event pair:

| SQLite Session Field | → `TimerStarted` Event | → `TimerCompleted` Event |
|---|---|---|
| `Id` (int) | *(not used — new UUID generated for `sessionId`)* | *(same UUID)* |
| `DurationSeconds` (int) | `payload.durationSeconds` | `payload.durationSeconds` |
| `StartedAt` (datetime) | `timestamp` | *(not used)* |
| `CompletedAt` (datetime) | *(not used)* | `timestamp`, `payload.completedAt` |
| *(not in source)* | `payload.timerMode = 'pomodoro'` | `payload.startedAt` (= `StartedAt`) |
| *(not in source)* | `payload.presetName = null` | `payload.distractionCount = 0` |
| *(not in source)* | `migrated = true` | `payload.falseAlarmCount = 0`, `payload.endedEarly = false`, `migrated = true` |

**Distraction conversion:**

Each SQLite `Distraction` row becomes either a `DistractionLogged` or `FalseAlarmMarked` event:

| SQLite Distraction Field | → Target Event |
|---|---|
| `IsFalseAlarm = false` | `type = 'DistractionLogged'`, `payload = { note, normalizedNote, categoryName }` |
| `IsFalseAlarm = true` | `type = 'FalseAlarmMarked'`, `payload = {}` |
| `Timestamp` | `timestamp` (ISO 8601) |
| *(no session FK)* | `sessionId = 'migrated-' + crypto.randomUUID()` |
| *(not in source)* | `migrated = true` |

#### 9.10.4. C# MigrationService SQLite Reader

The C# `MigrationService` uses `Microsoft.Data.Sqlite` (lightweight ADO.NET provider) instead of EF Core. This avoids adding the full EF Core dependency to the target shell for a one-time migration utility.

**Key implementation detail:** The C# service reads SQLite data and sends it to Angular via IPC chunks. Angular then writes to Firestore using the `EventLedgerService`. This design ensures that:
1. The C# shell never needs Firebase SDK or network access for migration.
2. Firestore offline persistence handles network failures during migration.
3. The same `EventLedgerService.writeEvent()` path is used, ensuring consistent schema.

**SQLite dependency in `.csproj`:**

```xml
<!-- Added to Sentinel.Shell.csproj for migration only -->
<PackageReference Include="Microsoft.Data.Sqlite" Version="8.0.*" />
```

This is a lighter dependency than `Microsoft.EntityFrameworkCore.Sqlite` — it's the raw ADO.NET provider without the ORM overhead.

#### 9.10.5. Deduplication Strategy (→ §7.5.4)

| Risk | Mitigation |
|---|---|
| Migration interrupted and re-run | `.migration-complete` marker file prevents re-execution |
| Chunk written twice due to IPC retry | `localStorage` tracks `lastChunkIndex` — resume from `lastChunkIndex + 1` |
| Source Firestore data overlap (flat collections) | Old flat `sessions`/`distractions` collections are in separate paths — no collision with user-scoped `session_events/` |
| Cloud Functions double-count migrated events | Idempotency guard (→ §8.2.3) prevents double-processing |

#### 9.10.6. Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| 1 | Migration prompt appears when `sentinel.db` exists and `.migration-complete` does not | Place a test `sentinel.db` in `%LOCALAPPDATA%\Sentinel\`, launch app |
| 2 | Migration prompt does NOT appear when `.migration-complete` exists | Create marker file → launch app → no prompt |
| 3 | Clicking "Import" reads SQLite data and sends chunks via IPC | Observe progress bar and IPC messages |
| 4 | All sessions are converted to `TimerStarted` + `TimerCompleted` event pairs | Verify event count in Firestore = 2 × session count |
| 5 | All non-false-alarm distractions become `DistractionLogged` events | Verify in Firestore |
| 6 | All false-alarm distractions become `FalseAlarmMarked` events | Verify in Firestore |
| 7 | All migrated events have `migrated: true` flag | Query Firestore for events where `migrated == true` |
| 8 | Cloud Functions process migrated events: aggregates updated, streaks/achievements skipped | Verify `stats/daily/` documents exist, no achievement documents from migration |
| 9 | `sentinel.db` is renamed to `sentinel.db.migrated` after successful migration | Check file system |
| 10 | Clicking "Skip" creates `.migration-complete` marker and dismisses prompt | Click Skip → verify marker file exists |
| 11 | Interrupted migration resumes from last chunk on next app launch | Kill app mid-migration → relaunch → verify resume |

---

### 9.11. Phase 11: End-to-End Testing & Security Audit

**Objective:** Verify the complete application flow end-to-end across all phases, run the Firestore security rules audit, perform offline/online sync testing, and validate the anti-cheat mechanisms specified in §11 (Security & Anti-Cheat Considerations).

**Prerequisites:** All prior phases (1–10) complete.

**Blueprint references:** §10 (Testing Strategy), §11 (Security & Anti-Cheat Considerations)

#### 9.11.1. Deliverables

| # | Deliverable | File Path(s) | Status |
|---|---|---|---|
| 1 | C# shell unit tests (xUnit) | `Sentinel.Shell.Tests/` | NEW (→ §10.1) |
| 2 | Angular unit tests (Jasmine/Karma) | `Sentinel.App/src/**/*.spec.ts` | NEW (→ §10.2) |
| 3 | Firestore security rules test suite | `tests/firestore-rules.test.ts` | NEW (→ §10.3.3) |
| 4 | Integration test: IPC round-trip | `Sentinel.Shell.Tests/IpcRoundTripTests.cs` | NEW (→ §10.3.1) |
| 5 | Integration test: Event Ledger → Cloud Function → Aggregate | `tests/ledger-integration.test.ts` | NEW (→ §10.3.2) |
| 6 | Manual E2E test script | `docs/E2E_TEST_SCRIPT.md` | NEW (→ §10.4) |
| 7 | Security audit checklist (completed) | `docs/SECURITY_AUDIT.md` | NEW (→ §11.3) |

#### 9.11.2. C# Shell Unit Tests (→ §10.1)

| Test Suite | File | Tests |
|---|---|---|
| `UserActivityMonitorTests` | `Sentinel.Shell.Tests/UserActivityMonitorTests.cs` | State transitions: idle → active → idle, threshold enforcement, whitelist suppression, media suppression |
| `MediaDetectorTests` | `Sentinel.Shell.Tests/MediaDetectorTests.cs` | Mock audio session enumeration, silence detection |
| `SettingsServiceTests` | `Sentinel.Shell.Tests/SettingsServiceTests.cs` | Serialization round-trip, default values, missing file handling |
| `IpcDispatcherTests` | `Sentinel.Shell.Tests/IpcDispatcherTests.cs` | Message routing, unknown type handling, malformed JSON handling |
| `MigrationServiceTests` | `Sentinel.Shell.Tests/MigrationServiceTests.cs` | SQLite reading, chunking, marker file logic |

**Source test reference:** The existing `Sentinel.Engine.Tests/` project contains tests for the source implementations. These serve as a specification for the target tests:

| Source Test File | Target Equivalent |
|---|---|
| `Sentinel.Engine.Tests/SettingsServiceTests.cs` | `Sentinel.Shell.Tests/SettingsServiceTests.cs` |
| `Sentinel.Engine.Tests/DistractionNormalizerTests.cs` | Angular test: `taxonomy.utils.spec.ts` |
| `Sentinel.Engine.Tests/DistractionRepositoryTests.cs` | *(eliminated — no repository in target)* |
| `Sentinel.Engine.Tests/ReportingServiceTests.cs` | Cloud Functions test: `ledger-integration.test.ts` |
| `Sentinel.Engine.Tests/CrashReporterTests.cs` | *(retained if crash reporter is ported)* |
| `Sentinel.Engine.Tests/UpdateCheckerTests.cs` | `Sentinel.Shell.Tests/UpdateCheckerTests.cs` |

#### 9.11.3. Angular Unit Tests (→ §10.2)

| Test Suite | File | Tests |
|---|---|---|
| `TimerService` | `src/app/core/timer.service.spec.ts` | Drift-free accuracy, state transitions, pause/resume, `sessionId` generation |
| `BridgeService` | `src/app/core/bridge.service.spec.ts` | Message dispatch, handler registration/unregistration, malformed JSON |
| `EventLedgerService` | `src/app/core/event-ledger.service.spec.ts` | Event writing (mock Firestore), offline queue behavior |
| `TaxonomyUtils` | `src/app/core/taxonomy.utils.spec.ts` | Normalization, suggestion algorithm, edge cases |
| `InterventionService` | `src/app/core/intervention.service.spec.ts` | Modal state machine, snooze countdown, form validation |
| `SettingsService` | `src/app/core/settings.service.spec.ts` | Dual sync (Firestore + IPC), default values, listener cleanup |

#### 9.11.4. Firestore Security Rules Testing (→ §10.3.3)

Using the Firebase Emulator Suite and `@firebase/rules-unit-testing`:

| Test | Expected Result |
|---|---|
| Authenticated user reads own `settings` | ✅ Allow |
| Authenticated user reads another user's `settings` | ❌ Deny |
| Authenticated user writes to own `session_events` | ✅ Allow (create only) |
| Authenticated user updates own `session_events` | ❌ Deny |
| Authenticated user deletes own `session_events` | ❌ Deny |
| Authenticated user reads own `stats/daily/{date}` | ✅ Allow |
| Authenticated user writes to own `stats/daily/{date}` | ❌ Deny |
| Authenticated user reads own `achievements/{id}` | ✅ Allow |
| Authenticated user writes to own `achievements/{id}` | ❌ Deny |
| Unauthenticated user reads any document | ❌ Deny |
| Authenticated user reads own `processed_events` | ❌ Deny |
| Rate limit: >100 events/hour rejected | ❌ Deny (if implemented) |

#### 9.11.5. End-to-End Test Scenarios (→ §10.4)

| # | Scenario | Verification |
|---|---|---|
| 1 | Full session lifecycle: Start → Idle → Intervene → Log Distraction → Resume → Complete → Badge | Walk through entire flow, verify Firestore state at each step |
| 2 | Offline → Online sync: Complete session while offline → reconnect → verify events in Firestore → verify Cloud Function processed | Disconnect network, run session, reconnect |
| 3 | Migration flow: Place `sentinel.db` → launch app → import → verify Firestore events | Manual test with a sample database |
| 4 | Multi-device settings sync: Change setting on device A → verify update on device B | Use two instances (or emulator) |
| 5 | Anti-cheat: Attempt to write achievement via client SDK → verify rejection | Use Firestore client SDK to attempt `setDoc` on achievements |

#### 9.11.6. Security Audit Checklist (→ §11)

| # | Check | §Reference | Pass/Fail |
|---|---|---|---|
| 1 | All gamification computed server-side (no client trust) | §11.2.1 | — |
| 2 | Event Ledger is append-only (no update/delete from client) | §11.2.2, §7.4.2 | — |
| 3 | Server validates event timestamps — rejects future-dated events | §11.2.3, §8.2.2 | — |
| 4 | `processed_events` inaccessible to clients | §8.2.3, §7.4 | — |
| 5 | `stats/` and `achievements/` are read-only for clients | §7.4.3 | — |
| 6 | Firebase API key restricted (HTTP referrer or App Check) | §11.1.3 | — |
| 7 | Shiny Badge RNG runs server-side (`crypto.randomInt`) | §8.7.6 | — |
| 8 | `distractionCount` field on `TimerCompleted` is verified server-side | §8.7.1 | — |
| 9 | User isolation: cannot read/write other users' data | §7.4.1 | — |
| 10 | IndexedDB tampering cannot affect server-computed metrics | §11.1.1 | — |

#### 9.11.7. Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| 1 | All C# shell unit tests pass | `dotnet test Sentinel.Shell.Tests` |
| 2 | All Angular unit tests pass | `ng test --no-watch --code-coverage` |
| 3 | All Firestore security rules tests pass | `npm test` in test project with emulator |
| 4 | All 5 E2E scenarios pass manual verification | Documented in `docs/E2E_TEST_SCRIPT.md` |
| 5 | All 10 security audit checklist items pass | Documented in `docs/SECURITY_AUDIT.md` |
| 6 | No critical or high-severity security issues remain open | Security review sign-off |

---

### 9.12. Phase 12: Installer, Auto-Update, & Production Release

**Objective:** Update the build pipeline, Inno Setup installer, and auto-update mechanism for the target application. Produce a production-ready installer that replaces the source application on end-user machines.

**Prerequisites:** Phase 11 (all tests pass, security audit complete).

**Blueprint references:** §2 (Photino Shell), §1 (Project Overview — deployment target)

#### 9.12.1. Deliverables

| # | Deliverable | File Path(s) | Status |
|---|---|---|---|
| 1 | Updated build script | `build.ps1` | MODIFIED — targets `Sentinel.Shell` + `Sentinel.App` |
| 2 | Updated Inno Setup installer script | `installer.iss` | MODIFIED — references `Sentinel.Shell` output |
| 3 | Updated solution file | `Sentinel.sln` | MODIFIED — default build targets `Sentinel.Shell` |
| 4 | Auto-update checker (ported) | `Sentinel.Shell/Services/UpdateChecker.cs` | PORTED from `Sentinel.Engine/UpdateChecker.cs` |
| 5 | Production build verification | `publish/Sentinel.exe` | VERIFIED — single-file self-contained |
| 6 | Installer output | `installer/SentinelSetup-2.0.0.exe` | BUILT |

#### 9.12.2. Build Script Changes (`build.ps1`)

The build script currently targets `Sentinel.Engine` (source) and `Sentinel.UI` (React/Vite). The updated script targets `Sentinel.Shell` (target) and `Sentinel.App` (Angular):

**Key changes:**

| Variable | Source Value | Target Value |
|---|---|---|
| `$UIDir` | `Sentinel.UI` | `Sentinel.App` |
| `$EngineDir` | `Sentinel.Engine` | `Sentinel.Shell` |
| `$WwwrootDir` | `Sentinel.Engine\wwwroot` | `Sentinel.Shell\wwwroot` |
| UI Build Command | `npm run build` (Vite) | `npx ng build --configuration production` (Angular CLI) |
| UI Output | Vite outputs to `wwwroot/` via `vite.config.ts` `outDir` | Angular outputs to `../Sentinel.Shell/wwwroot` via `angular.json` `outputPath` |
| Test Command | `dotnet test Sentinel.Engine.Tests` | `dotnet test Sentinel.Shell.Tests` + `npx ng test --no-watch` |

**Updated `build.ps1`:**

```powershell
# build.ps1 — Sentinel Production Build Script (Target Architecture)
# Usage: .\build.ps1 [-Clean] [-SkipUI] [-SkipPublish] [-SkipTests] [-Installer]

param(
    [switch]$Clean,
    [switch]$SkipUI,
    [switch]$SkipPublish,
    [switch]$SkipTests,
    [switch]$Installer
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$UIDir = Join-Path $Root "Sentinel.App"
$ShellDir = Join-Path $Root "Sentinel.Shell"
$WwwrootDir = Join-Path $ShellDir "wwwroot"
$PublishDir = Join-Path $Root "publish"

# ... (same structure as source build.ps1, with updated paths)
```

#### 9.12.3. Installer Script Changes (`installer.iss`)

**Key changes:**

| Setting | Source Value | Target Value |
|---|---|---|
| `SetupIconFile` | `Sentinel.Engine\sentinel.ico` | `Sentinel.Shell\sentinel.ico` |
| `Source` (Files section) | `publish\*` | `publish\*` (unchanged — dotnet publish output) |
| `AppVersion` | `1.0.0` | `2.0.0` |

The installer structure remains the same — Inno Setup packages the contents of the `publish/` folder into a self-extracting installer. The folder contents change (Photino DLLs instead of WebView2 DLLs), but the installer script is largely unchanged.

**New consideration — WebView2 runtime no longer required:**

The source application depends on the WebView2 Evergreen Runtime being installed on the user's machine. The target application uses Photino, which bundles Chromium directly. This eliminates the WebView2 runtime dependency and simplifies installation — no prerequisite check or runtime download is needed.

#### 9.12.4. Auto-Update Checker

The `UpdateChecker` is ported from `Sentinel.Engine/UpdateChecker.cs` with minimal changes:

| Aspect | Source | Target |
|---|---|---|
| Version source | `Sentinel.Engine.csproj` `<Version>` | `Sentinel.Shell.csproj` `<Version>` |
| Update check URL | GitHub releases API or custom endpoint | Same |
| IPC message | `UPDATE_AVAILABLE` via WebView2 `PostWebMessageAsJson` | `UPDATE_AVAILABLE` via Photino `SendWebMessage` |
| Download/install | Opens browser to download page | Same |

#### 9.12.5. Production Verification Checklist

| # | Check | Verification |
|---|---|---|
| 1 | `dotnet publish` produces a single-file executable | `publish/Sentinel.exe` exists, single file |
| 2 | Published size is reasonable (< 100 MB) | Check file size |
| 3 | App launches from published location (outside dev environment) | Copy `publish/` to a temp folder, run `Sentinel.exe` |
| 4 | Installer builds successfully | `ISCC.exe installer.iss` completes |
| 5 | Installer creates correct Start Menu and Desktop shortcuts | Install on a test machine, verify |
| 6 | Uninstaller removes all installed files | Uninstall, verify clean removal |
| 7 | Auto-start registry entry works (if selected during install) | Enable auto-start → restart Windows → Sentinel launches |
| 8 | Migration from source app works end-to-end | Install target over source → migration prompt appears → import completes |
| 9 | Firebase connection works in production (not just emulator) | Verify Firestore writes in Firebase console |
| 10 | No WebView2 runtime dependency (Photino bundles Chromium) | Install on a clean machine without WebView2 → app works |

#### 9.12.6. Release Cutover Plan

The release follows a staged cutover:

1. **Pre-release (internal):** Build `SentinelSetup-2.0.0-beta.1.exe`. Install on developer machines alongside the source app (`v1.x`). Verify migration flow and all features with real user data.

2. **Release candidate:** Build `SentinelSetup-2.0.0-rc.1.exe`. Distribute to a small group of beta users. Collect feedback on migration, performance, and stability.

3. **Production release:** Build `SentinelSetup-2.0.0.exe`. Publish to the distribution channel (GitHub Releases or website). The `v1.x` auto-update checker directs users to the `v2.0.0` download page.

4. **Post-release monitoring:** Monitor Firebase Cloud Function logs for errors. Monitor Firestore usage metrics (reads, writes, storage). Address any migration failures reported by users.

**Version numbering:**

| Version | Meaning |
|---|---|
| `1.x.x` | Source application (WPF + React + SQLite) |
| `2.0.0` | Target application (Photino + Angular + Firebase) — initial release |
| `2.0.x` | Patch releases (bug fixes) |
| `2.1.0` | First feature release (e.g., timezone-aware streaks, tiered Swift Recovery points) |

#### 9.12.7. Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| 1 | `build.ps1` completes successfully with all steps (UI build, .NET publish, tests, installer) | `.\build.ps1 -Installer` |
| 2 | Installer output exists at `installer/SentinelSetup-2.0.0.exe` | File exists |
| 3 | Clean install on a machine without WebView2 runtime succeeds | Install and launch on clean machine |
| 4 | Upgrade install over source `v1.x` triggers migration flow | Install `v2.0.0` over `v1.x` → migration prompt |
| 5 | Published `Sentinel.exe` size is < 100 MB (single file, self-contained) | `(Get-Item publish\Sentinel.exe).Length / 1MB` |
| 6 | Auto-update checker detects new versions and notifies user | Simulate version check |
| 7 | All acceptance criteria from Phases 1–11 still pass in the production build | Full regression verification |

---

### 9.13. Cross-Reference Table

| Phase | Blueprint Sections Referenced | Source Files Consumed | Target Files Produced |
|---|---|---|---|
| §9.1 | §2, §3 | `Sentinel.Engine.csproj`, `App.xaml.cs`, `MainWindow.xaml.cs`, `app.manifest` | `Sentinel.Shell.csproj`, `Program.cs`, `IpcDispatcher.cs`, `IpcMessageTypes.cs` |
| §9.2 | §4, §2.3, §3 | `UserActivityMonitor.cs`, `MediaDetector.cs`, `SettingsService.cs`, `MainWindow.xaml.cs` | `Services/UserActivityMonitor.cs`, `Services/MediaDetector.cs`, `Services/ActiveWindowMonitor.cs`, `Services/SystemSuspendMonitor.cs`, `Services/HotkeyManager.cs`, `Services/SettingsService.cs`, `Models/AppSettings.cs` |
| §9.3 | §5.1, §5.2, §5.3, §3.6 | `package.json`, `vite.config.ts`, `tailwind.config.js`, `index.css`, `index.html`, `ui.tsx`, `bridge.test.ts` | `Sentinel.App/` scaffold, `angular.json`, `app.routes.ts`, `bridge.service.ts`, shared components |
| §9.4 | §5.4, §5.5, §5.10 | `App.tsx` (timer hooks, intervention), `views.tsx` (InterventionModal), `utils.ts` | `timer.service.ts`, `timer.utils.ts`, `timer.component.ts`, `intervention.service.ts`, `intervention.component.ts`, `keyboard.service.ts` |
| §9.5 | §5.6, §5.8, §5.9, §7.1, §7.2, §7.4 | `firebase.ts`, `App.tsx` (auth), `views.tsx` (AuthScreen, SettingsScreen, TaxonomyManagerScreen, OnboardingModal), `taxonomy.ts`, `firestore.rules` | `firebase.provider.ts`, `auth.service.ts`, `auth.guard.ts`, `settings.service.ts`, `taxonomy.service.ts`, `taxonomy.utils.ts`, settings/taxonomy/account/onboarding components, `firestore.rules` |
| §9.6 | §6.2.2, §7.3, §3 | `App.tsx` (syncSessionToFirestore, submitDistraction) | `event-ledger.service.ts`, `models.ts` (event types), `firestore.rules` (append-only) |
| §9.7 | §8 (entire section) | `ReportingService.cs`, `App.tsx` (fetchFirestoreHistory) | `functions/` (entire directory: pipeline, handlers, engines), `firebase.json` |
| §9.8 | §5.6, §6.2.1.2, §7.2.1 | *(no source — entirely new feature)* | `planner.service.ts`, `planner.component.ts`, `models.ts` (PlannerBlock) |
| §9.9 | §5.7, §5.8, §6.2.3 | `ReportingService.cs`, `views.tsx` (ReportsScreen, SessionHistoryScreen), `App.tsx` (fetchFirestoreHistory) | `report.service.ts`, `achievement.service.ts`, reports/history components |
| §9.10 | §7.5 | `SentinelDbContext.cs`, `Models.cs` (Session, Distraction) | `MigrationService.cs` (C#), `migration.service.ts` (Angular), `migration.component.ts` |
| §9.11 | §10, §11 | `Sentinel.Engine.Tests/*` (reference specs) | `Sentinel.Shell.Tests/*`, Angular `*.spec.ts`, `firestore-rules.test.ts`, E2E test script, security audit |
| §9.12 | §2, §1 | `build.ps1`, `installer.iss`, `UpdateChecker.cs` | Updated `build.ps1`, updated `installer.iss`, `UpdateChecker.cs`, `SentinelSetup-2.0.0.exe` |

- **10. Testing Strategy**
    - 10.1. Unit Tests — C# Shell (xUnit)
        - 10.1.1. UserActivityMonitor State Transitions
        - 10.1.2. MediaDetector Mock Audio Sessions
        - 10.1.3. SettingsService Serialization Round-Trip
        - 10.1.4. IPC Message Dispatch Routing
    - 10.2. Unit Tests — Angular (Jasmine/Karma)
        - 10.2.1. Timer Service Drift-Free Accuracy
        - 10.2.2. Taxonomy Normalization & Suggestion Algorithm
        - 10.2.3. Intervention Modal State Machine
        - 10.2.4. Firestore Service Offline Queue Behavior
    - 10.3. Integration Tests
        - 10.3.1. IPC Round-Trip (C# ↔ Angular Message Flow)
        - 10.3.2. Firestore Emulator — Event Ledger Write & Cloud Function Trigger
        - 10.3.3. Security Rules Testing with Firebase Emulator Suite
    - 10.4. End-to-End Tests
        - 10.4.1. Full Session Lifecycle (Start → Idle → Intervene → Complete → Badge)
        - 10.4.2. Offline → Online Sync Verification
        - 10.4.3. Multi-Device Conflict Resolution

- **11. Security & Anti-Cheat Considerations**
    - 11.1. Client-Side Threat Model
        - 11.1.1. IndexedDB Manipulation Prevention
        - 11.1.2. IPC Message Forgery Mitigation
        - 11.1.3. Firebase API Key Restriction (HTTP Referrer, App Check)
    - 11.2. Server-Side Authority Boundary
        - 11.2.1. All Gamification Computed Server-Side (No Client Trust)
        - 11.2.2. Event Ledger Immutability Enforcement
        - 11.2.3. Server Timestamp Validation (Reject Future-Dated Events)
    - 11.3. Firestore Security Rules Audit Checklist

- **12. Appendices**
    - 12.1. Existing Codebase File Inventory
        - 12.1.1. Sentinel.Engine/ — Complete File List with Responsibilities
        - 12.1.2. Sentinel.UI/src/ — Complete File List with Responsibilities
        - 12.1.3. Sentinel.Engine.Tests/ — Complete Test File List
    - 12.2. IPC Message Type Registry (Complete Enumeration)
    - 12.3. Firestore Collection & Document Path Registry
    - 12.4. Cloud Function Trigger & Handler Registry
    - 12.5. EF Core Migration History (7-Stage Schema Evolution from Existing Codebase)
    - 12.6. Design System Token Reference (Colors, Spacing, Typography)
    - 12.7. Known Issues & Technical Debt Carried Forward from Existing Codebase
