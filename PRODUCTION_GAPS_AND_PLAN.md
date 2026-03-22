# Product Readiness & Gap Analysis Report

> Generated: 2026-03-22
> Scope: Full codebase audit of Sentinel desktop app (WPF .NET 8 + WebView2 + React/TypeScript)

---

## 1. Current State Summary

Sentinel is a **functional prototype** with solid architectural foundations but significant gaps that prevent a confident v1.0 release. The core user workflow — start timer, detect idle, log distraction, view reports — works end-to-end. Settings, SQLite persistence, taxonomy management, overlay mode, and the WebView2 bridge are all implemented and wired.

However, the codebase has:
- **Critical security gaps** in the Firebase/Firestore integration (no server-side security rules, exposed API key without restriction, no data isolation enforcement)
- **No EF Core migrations** — the schema is managed via raw `ALTER TABLE` statements and `EnsureCreatedAsync()`, making future schema changes risky
- **Minimal test coverage** (~50 tests for ~4,500+ lines of logic) concentrated on pure utilities; zero coverage of the timer lifecycle, message bridge, or any WPF/WebView2 code
- **Orphaned sync infrastructure** on the C# side (`GetUnsyncedDistractionsAsync`, `MarkAsSyncedAsync`) that is never called
- **No code signing**, no CI/CD pipeline, and a hardcoded placeholder GitHub repo in the update checker
- **No Firestore security rules** in the repository — cloud data is unprotected

**Honest assessment**: The app works for a solo developer testing locally. It is not ready for distribution to untrusted users due to the Firebase security posture, lack of error telemetry from the UI layer, and insufficient test coverage of critical paths.

---

## 2. Verified Workflows & Data Integrity

### Fully Functional & Verified

| Workflow | C# | React | Local DB | Notes |
|----------|-----|-------|----------|-------|
| Timer countdown + mode switching | N/A | `App.tsx` `useEffect` interval | — | Works. Timer respects pomodoro/short/long break modes. |
| Idle detection → intervention popup | `UserActivityMonitor` polls `GetLastInputInfo` | `IDLE_DETECTED` handler pauses timer, shows modal | — | Works. Includes foreground forcing + taskbar flash. |
| Distraction logging (typed + quick pills) | `DistractionRepository.AddDistractionAsync` | `submitDistraction()` in `App.tsx` | `Distractions` table | Works. Auto-category lookup, normalization, and category assignment all functional. |
| False alarm / Snooze / Watching content | `UserActivityMonitor.Snooze()` | Intervention modal options | `Distractions` (IsFalseAlarm) | Works. Snooze countdown visible in UI. |
| Session completion + logging | `DistractionRepository.AddSessionAsync` | Session complete screen, auto-log | `Sessions` table | Works. Duration, start/complete timestamps saved. |
| Settings save/load roundtrip | `SettingsService.Save/Load` (JSON) | `SAVE_SETTINGS` / `SETTINGS_LOADED` bridge | `settings.json` | Works. All 11 settings fields persisted. **Tested**: Roundtrip + corrupt file fallback. |
| Report data generation | `ReportingService.GetReportDataAsync` | Reports screen with charts | Read from `Sessions` + `Distractions` | Works. Date filtering, aggregation, top categories/distractions. **Tested**: Aggregation logic. |
| Taxonomy management (group edit, rename) | `DistractionRepository.UpdateDistractionGroupAsync` / `RenameCategoryAsync` | Taxonomy manager screen | Bulk updates on `Distractions` | Works. **Tested**: Group update, category rename, backfill. |
| Compact/overlay mode toggle | `HandleToggleCompact` saves/restores window state | `CompactTimerScreen` renders pill/compact/monitoring | — | Works. Three overlay styles supported. |
| System sleep/wake recovery | `WndProc` intercepts `PBT_APMSUSPEND`/`PBT_APMRESUMEAUTOMATIC` | Resume prompt modal | — | Works. Timer paused on suspend, resume choice presented. |
| Global hotkeys (Ctrl+Shift+S/D) | `RegisterHotKey`/`WndProc` dispatch | `HOTKEY_START_PAUSE`/`HOTKEY_DISTRACTION` handlers | — | Works. Registered on load, unregistered on close. |
| Data export (CSV + JSON) | `HandleExportData` in `MainWindow.xaml.cs` | Export button in settings | Reads from `Sessions` + `Distractions` | Works. Exported to `%LocalAppData%\Sentinel\exports\`. |
| Media suppression | `MediaDetector.IsAudioPlaying()` via Core Audio API | N/A | — | Works. Peak level > 0.001 suppresses idle detection. |
| Crash reporting | `CrashReporter` catches `UnhandledException`, `DispatcherUnhandledException`, `UnobservedTaskException` | N/A | Log file | Works. Writes to `%LocalAppData%\Sentinel\logs\crash.log`. |
| Window position persistence | `OnClosing` saves Left/Top | N/A | `settings.json` | Works. |
| Onboarding flow | N/A | `OnboardingModal` with 4 steps | `localStorage` | Works. Shows once, remembers via `sentinel_onboarded`. |

### Database Schema Integrity

The `Distractions` table has 7 columns: `Id`, `Note`, `NormalizedNote`, `CategoryName`, `Timestamp`, `IsFalseAlarm`, `SyncedToCloud`. The `Sessions` table has 6 columns: `Id`, `DurationSeconds`, `StartedAt`, `CompletedAt`, `SessionName`, `SyncedToCloud`. Both map correctly to the C# models.

Schema migration for `NormalizedNote` and `CategoryName` is handled by `EnsureSchemaAsync` using `PRAGMA table_info` + `ALTER TABLE`. This is functional but fragile (see Section 4).

---

## 3. Workflow Gaps & Bugs (The "To-Fix" List)

### 3A. Firebase / Cloud Sync — CRITICAL

| # | Issue | Severity | Files | Details |
|---|-------|----------|-------|---------|
| 1 | **No Firestore security rules in repository** | **CRITICAL** | (missing file) | No `firestore.rules` or `firebase.json` exists. If the Firestore instance uses default rules (`allow read, write: if true`), **any unauthenticated user can read/write all data**. Even if rules are set in the Firebase console, they're not version-controlled. |
| 2 | **Firebase client API key is hardcoded and unrestricted** | **HIGH** | `Sentinel.UI/src/firebase.ts` L6 | The API key `AIzaSyC6luPajDSMU1FyH5prC-LQgFtvj3JLdxE` is committed to source. Firebase client API keys are [designed to be public](https://firebase.google.com/docs/projects/api-keys), but they **must** be restricted to specific referrer domains/apps in the Google Cloud Console. Without restrictions, the key can be used to consume quota from any origin. |
| 3 | **No Firestore data isolation** | **HIGH** | `Sentinel.UI/src/App.tsx` L534–546 | `fetchFirestoreHistory` queries `sessions` and `distractions` filtered by `userId`. But without server-side security rules enforcing `request.auth.uid == resource.data.userId`, any authenticated user can read any other user's data by constructing a different query. |
| 4 | **Dual Firebase initialization — C# Admin SDK + React Client SDK** | **MEDIUM** | `FirebaseService.cs`, `firebase.ts` | Two independent Firebase connections: C# uses the **Admin SDK** (service account, full privileges), React uses the **Client SDK** (user auth). The Admin SDK is initialized on every app start (`App.xaml.cs` L13) but **never actually used** for any operation — all cloud sync goes through the React Client SDK. The Admin SDK service account JSON next to the executable is a privilege escalation risk if discovered by malware. |
| 5 | **C# sync methods are orphaned / dead code** | **MEDIUM** | `DistractionRepository.cs` L189–206 | `GetUnsyncedDistractionsAsync()` and `MarkAsSyncedAsync()` are implemented but **never called anywhere** in the codebase. The sync flow bypasses C# entirely — React writes directly to Firestore. This means `SyncedToCloud` on `Distraction` and `Session` models is never set to `true`. |
| 6 | **Cloud report data naively merged** | **MEDIUM** | `App.tsx` L555–566 | `fetchFirestoreHistory` adds cloud session/distraction counts directly to the local report data. If the same session is saved both locally and to Firestore (which happens in `submitDistraction`), the counts are **double-counted**. |
| 7 | **No offline queue / retry for Firestore writes** | **LOW** | `App.tsx` L286–298, L354–365 | Firestore writes in `syncSessionToFirestore` and `submitDistraction` have try/catch that `console.error` on failure. Failed writes are silently lost — no retry, no queue, no indicator to the user. |

### 3B. Local Database & Schema

| # | Issue | Severity | Files | Details |
|---|-------|----------|-------|---------|
| 8 | **No EF Core migrations — schema managed via raw ALTER TABLE** | **HIGH** | `DistractionRepository.cs` L206–220 | `EnsureSchemaAsync` uses `PRAGMA table_info` + raw SQL `ALTER TABLE ADD COLUMN`. This works for the current two added columns but becomes untenable as the schema evolves. There's no migration history, no rollback capability, and no way to detect partially-applied migrations. |
| 9 | **`EnsureCreatedAsync` prevents future migrations** | **HIGH** | `DistractionRepository.cs` L20 | EF Core's `EnsureCreatedAsync()` creates the database without migration history. Once called, `Database.MigrateAsync()` [cannot be used on the same database](https://learn.microsoft.com/en-us/ef/core/managing-schemas/ensure-created). This locks the project out of proper EF Core migrations forever unless the database is recreated. |
| 10 | **`BackfillNormalizedNotesAsync` loads entire table into memory** | **MEDIUM** | `DistractionRepository.cs` L222–248 | On every `InitializeAsync()` call, `BackfillNormalizedNotesAsync` runs `db.Distractions.ToListAsync()` — loading every distraction into memory. For a user with thousands of entries, this is a startup performance hit. The backfill should be a one-time migration, not a per-launch operation. |
| 11 | **`RenameCategoryAsync` loads all distractions to filter in memory** | **LOW** | `DistractionRepository.cs` L147–161 | Loads all distractions where `CategoryName != null`, then does a case-insensitive string comparison in C# LINQ. For large datasets, a SQL `WHERE LOWER(CategoryName) = LOWER(@old)` would be more efficient. |

### 3C. Timer & State Management

| # | Issue | Severity | Files | Details |
|---|-------|----------|-------|---------|
| 12 | **Timer drift — no anchor-based timing** | **MEDIUM** | `App.tsx` L217–231 | The timer uses `setInterval(1000)` with `setTimeLeft(prev => prev - 1)`. JavaScript intervals can drift significantly (system load, tab throttling). After a 25-minute session, the actual elapsed time could differ by several seconds. A production timer should compare against `Date.now()` on each tick. |
| 13 | **Goal progress is session-count-based, not actual time** | **LOW** | `utils.ts` L80–84 | `calculateGoalProgress` multiplies `sessionsCompleted * pomodoroMinutes * 60`. But `sessionsCompleted` is an in-memory counter that resets on app restart. It doesn't query the database for today's actual sessions. The daily goal is therefore only accurate within a single app session. |
| 14 | **Distractions array only tracks current session** | **LOW** | `App.tsx` L67 | `distractions` state is an in-memory array cleared on session complete or restart. The pie chart on `SessionCompleteScreen` only shows the current session's distractions. This is by design, but there's no way to see per-session distraction breakdown in historical reports. |
| 15 | **`wasRunningRef` can get stuck** | **LOW** | `App.tsx` L96 | If `SYSTEM_SUSPEND` fires while `isRunning` is true, `wasRunningRef.current` is set to true. If the user then manually starts a timer before the resume prompt appears, the ref stays `true` and a later resume prompt could incorrectly auto-resume. |

### 3D. Update Checker

| # | Issue | Severity | Files | Details |
|---|-------|----------|-------|---------|
| 16 | **GitHub repo URL is a placeholder** | **HIGH** | `UpdateChecker.cs` L29–30 | `GitHubOwner = "sentinel"` and `GitHubRepo = "sentinel"` — these don't point to a real GitHub repository. The update check will always fail (404) or point to the wrong repo. |
| 17 | **No code signing or checksum validation** | **MEDIUM** | `UpdateChecker.cs` | The download URL from GitHub is rendered directly as a clickable link in the UI (`views.tsx` L1344). No checksum or signature verification — a compromised GitHub release could serve malware. |
| 18 | **No rate limiting or caching of update checks** | **LOW** | `MainWindow.xaml.cs` L115 | `CheckForUpdatesAsync` fires on every app launch with no cooldown. GitHub's unauthenticated API rate limit is 60 req/hour. Frequent app restarts could exhaust this. |

### 3E. Error Handling & Resilience

| # | Issue | Severity | Files | Details |
|---|-------|----------|-------|---------|
| 19 | **React ErrorBoundary has no telemetry bridge** | **MEDIUM** | `ErrorBoundary.tsx` L26 | `componentDidCatch` only logs to `console.error`. The C# backend has `CrashReporter` but there's no `postMessage` call to report JS errors to the crash log. Frontend errors are invisible in production. |
| 20 | **ErrorBoundary "Try Again" can infinite-loop** | **LOW** | `ErrorBoundary.tsx` L43 | Clicking "Try Again" resets `hasError` and re-renders children. If the error is deterministic, this creates an infinite crash-recover loop with no retry limit. |
| 21 | **`DispatcherUnhandledException` marks ALL errors as handled** | **MEDIUM** | `CrashReporter.cs` L32 | `args.Handled = true` prevents app crash for **all** dispatcher exceptions, including potentially corrupting ones (out of memory, stack overflow). This should be selective. |
| 22 | **Settings deserialization swallows all exceptions** | **LOW** | `SettingsService.cs` L50 | `catch { }` silently returns defaults on any JSON parse error. If the settings file is corrupted mid-write (e.g., crash during save), the user loses all customizations with no notification. |

### 3F. UI/UX Gaps

| # | Issue | Severity | Files | Details |
|---|-------|----------|-------|---------|
| 23 | **Accuracy metric is semantically inverted** | **LOW** | `views.tsx` L1904 | `interventionAccuracy` shows `falseAlarms / total * 100` and labels it "Accuracy". Mathematically, this is the false-alarm rate — higher is worse, not better. |
| 24 | **NumberField doesn't clamp values** | **LOW** | `views.tsx` L2217 | `Number(event.target.value)` can produce `NaN` (empty string) or out-of-range values. The HTML `min`/`max` attributes are advisory — manual input bypasses them. |
| 25 | **No confirmation before session reset** | **LOW** | `App.tsx` L424 | `handleReset` immediately zeros the timer with no confirmation dialog. Accidental clicks lose progress. |
| 26 | **External Google Fonts dependency — GDPR concern** | **MEDIUM** | `index.css` L1 | `@import url('https://fonts.googleapis.com/css2?...')` transmits user IP to Google on every app load. In the EU, this has been [ruled a GDPR violation](https://www.theregister.com/2022/01/31/website_fine_google_fonts_gdpr/) without explicit consent. For a privacy-first product, self-hosting fonts is necessary. |

---

## 4. Technical Debt & API/DB Issues

### 4A. Architecture Concerns

| # | Issue | Category | Details |
|---|-------|----------|---------|
| 27 | **Dual Firebase SDK — unnecessary complexity** | Architecture | C# Admin SDK is initialized on every startup but never used. All Firestore operations happen via React Client SDK. The Admin SDK adds ~15MB to the binary and requires a service account JSON file. Either commit to C#-side sync (and remove React direct writes) or remove the Admin SDK entirely. |
| 28 | **Message bridge is stringly-typed** | Architecture | All WebView2 messages use `type` strings (`"LOG_DISTRACTION"`, `"SAVE_SETTINGS"`, etc.) with `JsonElement` parsing. There's no shared schema or contract — a typo in either side silently fails. Consider generating TypeScript types from C# models or maintaining a shared message catalog. |
| 29 | **No dependency injection** | Architecture | `MainWindow` directly instantiates `DistractionRepository`, `ReportingService`, `UserActivityMonitor`, and `SettingsService`. This makes the 760-line `MainWindow.xaml.cs` untestable. Abstracting dependencies behind interfaces would enable unit testing of message handlers. |
| 30 | **`SentinelDbContext` creates a new connection per operation** | Performance | Every repository method creates and disposes a `SentinelDbContext` via `_contextFactory()`. For frequent operations (distraction logging during rapid interventions), this creates connection churn. A scoped lifetime or connection pooling would be more efficient. |

### 4B. Database Issues

| # | Issue | Category | Details |
|---|-------|----------|---------|
| 31 | **No database indexes** | Performance | Neither the `SentinelDbContext` nor the raw SQL adds indexes. Queries like `WHERE NormalizedNote = @note AND CategoryName IS NOT NULL ORDER BY Timestamp DESC` perform full table scans. As the database grows, taxonomy lookups and report generation will slow. |
| 32 | **No data retention / cleanup** | Data Growth | There's no mechanism to prune old data. After months of use, the `Distractions` table could have thousands of rows, all loaded by `BackfillNormalizedNotesAsync` on every startup. |
| 33 | **`SyncedToCloud` column is always false** | Dead Feature | Since C# sync methods are never called, this column never transitions to `true`. It occupies space in every row with no purpose. |

### 4C. Build & Distribution

| # | Issue | Category | Details |
|---|-------|----------|---------|
| 34 | **No CI/CD pipeline** | DevOps | No GitHub Actions, Azure DevOps, or any CI configuration. Builds are manual via `build.ps1`. |
| 35 | **No code signing** | Distribution | The published `.exe` and installer are unsigned. Windows SmartScreen will block the installer for new users until reputation is built. The PRD mentions purchasing an OV/IV certificate but this hasn't been acted on. |
| 36 | **Build doesn't run tests** | DevOps | `build.ps1` builds and publishes without running tests. A broken test suite won't block a production release. |
| 37 | **Installer version is hardcoded** | DevOps | `installer.iss` L6: `#define AppVersion "1.0.0"`. Not injected from `Sentinel.Engine.csproj` or build script. Manual version management risks mismatches. |
| 38 | **`test-all.ps1` doesn't propagate exit codes** | DevOps | If `dotnet test` fails, the script continues to `npm test`. The script returns 0 even if engine tests fail. |

### 4D. Missing Logging/Monitoring

| # | Issue | Category | Details |
|---|-------|----------|---------|
| 39 | **All C# logging goes to `Debug.WriteLine`** | Observability | In a Release build, `Debug.WriteLine` output is stripped. Production users have zero visibility into idle detection, message handling, or database operations unless they attach a debugger. `CrashReporter` only captures exceptions, not operational logs. |
| 40 | **No structured logging** | Observability | No log levels (info/warn/error), no structured format (JSON), no log rotation beyond the 1MB crash log trim. |
| 41 | **Frontend errors are lost** | Observability | `console.error` in React is invisible in the desktop app (no DevTools open by default). No bridge to ship JS errors to C# `CrashReporter`. |

---

## 5. Actionable Remediation Plan

### Priority 1 — Security Blockers (Must Fix Before Any Distribution)

- [ ] **P1-1**: Create `firestore.rules` with proper security rules enforcing `request.auth.uid == resource.data.userId` for all reads/writes. Deploy via Firebase CLI. Version-control the rules file.
- [ ] **P1-2**: Restrict the Firebase API key in Google Cloud Console to the Sentinel app's specific platform (Windows desktop, specific referrer if applicable).
- [ ] **P1-3**: Remove the C# Firebase Admin SDK (`FirebaseAdmin`, `Google.Cloud.Firestore` packages) and `FirebaseService.cs` entirely — it's unused and the service account JSON is a security liability. Remove the `_ = Task.Run(FirebaseService.InitializeAsync)` call from `App.xaml.cs`.
- [ ] **P1-4**: Self-host Google Fonts (Inter + Manrope) locally in the `wwwroot` bundle to eliminate the GDPR-violating external request and improve offline reliability.
- [ ] **P1-5**: Fix `CrashReporter.cs` to not blindly mark all `DispatcherUnhandledException` as handled. Only suppress known recoverable exception types.

### Priority 2 — Data Integrity & Correctness (Must Fix For v1.0)

- [ ] **P2-1**: Migrate from `EnsureCreatedAsync()` + manual `ALTER TABLE` to proper EF Core migrations. Create an initial migration matching the current schema, then add migration for `NormalizedNote` and `CategoryName`. This enables safe future schema evolution.
- [ ] **P2-2**: Make `BackfillNormalizedNotesAsync` a one-time migration rather than a per-launch operation. After applying, skip on subsequent launches (track via a version marker row or migration history).
- [ ] **P2-3**: Add indexes: `Distractions(NormalizedNote)`, `Distractions(Timestamp)`, `Distractions(CategoryName)`, `Sessions(StartedAt)`.
- [ ] **P2-4**: Fix the double-counting in cloud report merge (`fetchFirestoreHistory`). Either deduplicate by timestamp/ID or show local and cloud data separately.
- [ ] **P2-5**: Replace `setInterval(1000)` timer with anchor-based timing using `Date.now()` to prevent drift over long sessions.
- [ ] **P2-6**: Set the `UpdateChecker` `GitHubOwner` and `GitHubRepo` to the actual repository, or disable the update checker until a real release exists.
- [ ] **P2-7**: Remove dead C# sync code (`GetUnsyncedDistractionsAsync`, `MarkAsSyncedAsync`) or implement proper C#-side sync. Remove `SyncedToCloud` from both models if staying with React-only sync.

### Priority 3 — Test Coverage (Required for Confidence)

- [ ] **P3-1**: Add integration tests for `App.tsx` timer lifecycle — start, pause, resume, complete, mode switching. Mock `postMessage` and assert message sequences.
- [ ] **P3-2**: Add C# unit tests for `UpdateChecker.IsNewerVersion` (pure function, easy win).
- [ ] **P3-3**: Add C# unit tests for `CrashReporter.LogCrash` and `TrimLog` (file I/O only).
- [ ] **P3-4**: Add interaction tests for `InterventionModal` — form submit, quick suggestion click, false alarm, snooze.
- [ ] **P3-5**: Add tests for `DistractionRepository.GetDistractionsAsync(since)` date filtering.
- [ ] **P3-6**: Add test for `ReportingService.GetReportDataAsync` with empty database (should return zeros, not throw).
- [ ] **P3-7**: Add render tests for `TimerScreen`, `CompactTimerScreen`, `SessionCompleteScreen`, `OnboardingModal`.
- [ ] **P3-8**: Add a bridge test to verify `postMessage` sends correct message shapes for each action type.
- [ ] **P3-9**: Fix `test-all.ps1` to check `$LASTEXITCODE` after `dotnet test` and fail early.
- [ ] **P3-10**: Add `build.ps1` step to run `test-all.ps1` before publishing.

### Priority 4 — Production Readiness (Should Fix For v1.0)

- [ ] **P4-1**: Replace `Debug.WriteLine` with a proper logging framework (Serilog, NLog, or `Microsoft.Extensions.Logging`) that writes to a file in Release builds.
- [ ] **P4-2**: Add a `postMessage({ type: 'JS_ERROR', ... })` bridge in `ErrorBoundary.componentDidCatch` so frontend crashes are captured in the C# crash log.
- [ ] **P4-3**: Add a retry limit (e.g., 3 attempts) to `ErrorBoundary` "Try Again" before showing a permanent error state.
- [ ] **P4-4**: Introduce dependency injection in `MainWindow` (or extract message handler into a testable service class) to enable unit testing of C# message handlers without WPF.
- [ ] **P4-5**: Set up a basic CI pipeline (GitHub Actions) that runs `test-all.ps1` + `build.ps1` on every push.
- [ ] **P4-6**: Purchase and configure a code-signing certificate (OV or IV) for the published exe and installer.
- [ ] **P4-7**: Wire version from `Sentinel.Engine.csproj` into `installer.iss` during build.
- [ ] **P4-8**: Add Firestore offline persistence configuration in the React Client SDK (`enableIndexedDbPersistence`) for proper offline support with retry.
- [ ] **P4-9**: Clamp `NumberField` values to `min`/`max` and handle `NaN` from empty input.
- [ ] **P4-10**: Fix `interventionAccuracy` metric — either invert the formula to show actual accuracy `(1 - falseAlarms/total) * 100` or relabel it "False Alarm Rate".

### Priority 5 — Polish & Improvements (Nice to Have)

- [ ] **P5-1**: Add a confirmation dialog before `handleReset` to prevent accidental timer resets.
- [ ] **P5-2**: Cache the update check result for 24 hours to avoid GitHub API rate limiting.
- [ ] **P5-3**: Add data retention settings (auto-prune entries older than N months).
- [ ] **P5-4**: Add exhaustive `never` check in `renderGlyph` switch default to catch missing glyph implementations at compile time.
- [ ] **P5-5**: Make `fetchFirestoreHistory` daily goal progress query the actual database for today's sessions instead of using the in-memory session counter.
- [ ] **P5-6**: Remove the `SummaryStat` wrapper component in `views.tsx` — it's a zero-logic passthrough over `MetricCard`.
- [ ] **P5-7**: Add `npm install` and `dotnet restore` steps to `build.ps1` for reproducible builds from a clean checkout.
- [ ] **P5-8**: Validate `updateInfo.downloadUrl` against a known domain pattern before rendering it as a clickable link.
- [ ] **P5-9**: Add uninstall cleanup option in `installer.iss` to remove `%LocalAppData%\Sentinel` user data.
- [ ] **P5-10**: Consider connection pooling or a scoped `SentinelDbContext` lifetime to reduce SQLite connection churn.

---

## Appendix A: Untested Code Paths

### C# — Zero Test Coverage

| Class / Method | File | Lines | Risk |
|----------------|------|-------|------|
| `MainWindow` (entire class) | `MainWindow.xaml.cs` | ~760 | HIGH — all message handling, WndProc, export, compact toggle |
| `UserActivityMonitor` (entire class) | `UserActivityMonitor.cs` | ~115 | HIGH — idle detection, snooze, media suppression |
| `FirebaseService` (entire class) | `FirebaseService.cs` | ~100 | MEDIUM — init, connectivity tests |
| `UpdateChecker` (entire class) | `UpdateChecker.cs` | ~76 | MEDIUM — `IsNewerVersion` is easily testable |
| `CrashReporter` (entire class) | `CrashReporter.cs` | ~88 | LOW — file I/O, testable |
| `MediaDetector` (entire class) | `MediaDetector.cs` | ~75 | LOW — COM interop, hard to test |

### TypeScript — Zero Test Coverage

| Module / Component | File | Risk |
|--------------------|------|------|
| `App` component (all state + logic) | `App.tsx` | HIGH — 860+ lines, orchestrator |
| `TimerScreen` | `views.tsx` | MEDIUM |
| `CompactTimerScreen` | `views.tsx` | MEDIUM |
| `SessionCompleteScreen` | `views.tsx` | LOW |
| `OnboardingModal` | `views.tsx` | LOW |
| `ResumePromptModal` | `views.tsx` | LOW |
| `ErrorBoundary` | `ErrorBoundary.tsx` | LOW |
| All `ui.tsx` components | `ui.tsx` | LOW |

## Appendix B: Message Protocol Inventory

Below is the complete set of WebView2 messages used. None are formally typed on both sides — each is a potential silent failure point if either side drifts.

### C# → React (7 message types)
| Type | Sent From | Handled In |
|------|-----------|------------|
| `SETTINGS_LOADED` | `SendSettingsToReact()` | `App.tsx` message handler |
| `IDLE_DETECTED` | `OnIdleDetected()` | `App.tsx` message handler |
| `SNOOZE_STATUS` | `SendSnoozeStatusToReact()` | `App.tsx` message handler |
| `REPORT_DATA` | `HandleGetReportData()` | `App.tsx` message handler |
| `TAXONOMY_DATA` | `SendTaxonomyDataAsync()` | `App.tsx` message handler |
| `SYSTEM_SUSPEND` / `SYSTEM_RESUME` | `WndProc` | `App.tsx` message handler |
| `HOTKEY_START_PAUSE` / `HOTKEY_DISTRACTION` | `WndProc` | `App.tsx` message handler |
| `UPDATE_AVAILABLE` | `CheckForUpdatesAsync()` | `App.tsx` message handler |
| `COMPACT_MODE_CHANGED` | `HandleToggleCompact()` | `App.tsx` message handler |
| `EXPORT_COMPLETE` | `HandleExportData()` | `App.tsx` message handler |

### React → C# (15 message types)
| Type | Sent From | Handled In |
|------|-----------|------------|
| `LOG_DISTRACTION` | `submitDistraction()` | `HandleLogDistraction()` |
| `FALSE_ALARM` | `handleFalseAlarm()` | `HandleFalseAlarm()` |
| `INTERVENTION_DISMISSED` | `dismissIntervention()` | Resets `Topmost` |
| `SNOOZE` | `handleSnooze()` | `_activityMonitor.Snooze()` |
| `WATCHING_CONTENT` | `handleWatchingContent()` | `_activityMonitor.Snooze()` |
| `CANCEL_SNOOZE` | `handleCancelSnooze()` | `_activityMonitor.CancelSnooze()` |
| `SAVE_SETTINGS` | `saveSettings()` | `HandleSaveSettings()` |
| `GET_SETTINGS` | (on load) | `SendSettingsToReact()` |
| `GET_REPORT_DATA` | `requestReportData()` | `HandleGetReportData()` |
| `GET_TAXONOMY_DATA` | `requestTaxonomyData()` | `SendTaxonomyDataAsync()` |
| `UPDATE_DISTRACTION_GROUP` | `handleSaveTaxonomyGroup()` | `HandleUpdateDistractionGroup()` |
| `RENAME_CATEGORY` | `handleRenameCategory()` | `HandleRenameCategory()` |
| `LOG_SESSION` | Timer complete | `HandleLogSession()` |
| `EXPORT_DATA` | `handleExport()` | `HandleExportData()` |
| `PLAY_SOUND` | Timer complete | `PlayNotificationSound()` |
| `TOGGLE_COMPACT` | `toggleCompact()` | `HandleToggleCompact()` |
| `TIMER_RUNNING` | `useEffect` on `isRunning` | Start/stop `_activityMonitor` |
| `OVERLAY_CLOSE` | Compact close button | `Close()` |
| `OVERLAY_MAXIMIZE` | (compact) | `HandleToggleCompact()` |
