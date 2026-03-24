# Sentinel — Known Issues

> Last updated: 2026-03-24  
> Status key: 🔴 Open · 🟡 In Progress · ✅ Fixed

---

## P1 — Critical (Wrong Data / Silent Data Loss)

### DB-01 UTC timezone bug in all date-range queries ✅ Fixed
**File:** `Sentinel.Engine/MainWindow.xaml.cs`, `ReportingService.cs`  
**Problem:** `DateTime.UtcNow.Date` was used for "today/week/month" range boundaries. For users in UTC−N timezones, the UTC day flips earlier than local midnight, causing sessions done in the evening to land in the "wrong" UTC day and disappear from "Today" reports. Conversely, late-UTC-night sessions appear in "Today" when they were done on the local previous evening.  
**Fix:** All range boundaries changed to `DateTime.Today.ToUniversalTime()` (local midnight converted to UTC). Daily focus chart also switched to local day buckets.

---

### DB-02 Session `StartedAt` is a backward approximation — ignores pauses ✅ Fixed
**File:** `Sentinel.Engine/MainWindow.xaml.cs` → `HandleLogSession`, `Sentinel.UI/src/App.tsx`  
**Problem:** When a session completes, React sent only `durationSeconds`. C# reconstructed `StartedAt = UtcNow - durationSeconds`. If the user paused the timer for 10 minutes mid-session, `StartedAt` would be 10 minutes too late (the "clock time" the session ran across was longer than the focus time).  
**Fix:** React now sends an ISO `startedAt` timestamp captured when the timer first starts. C# uses it directly and only falls back to the approximation if the field is absent (for forward compatibility).

---

### DB-03 Stale closure captures wrong `sessionName` and `settings` at timer completion ✅ Fixed
**File:** `Sentinel.UI/src/App.tsx`  
**Problem:** The timer's `setInterval` callback was defined inside a `useEffect([isRunning, timeLeft, timerMode])`. `sessionName` and `settings` were NOT in the deps array (intentionally, to avoid resetting the running interval). This means if the user typed a session name or changed pomodoro duration mid-session, the old values were logged when the session completed.  
**Fix:** `sessionNameRef` and `settingsRef` are now live refs updated on every render (via `useLayoutEffect`). The interval callback reads from the refs, always getting current values.

---

### DB-04 Daily focus chart always shows UTC-day buckets instead of local-day buckets ✅ Fixed
**File:** `Sentinel.Engine/ReportingService.cs`  
**Problem:** `startDate = DateTime.UtcNow.Date.AddDays(-6)` and per-day boundaries used UTC midnight. Sessions sat in the wrong bucket for non-UTC users, causing the chart to show zero for days that actually had sessions.  
**Fix:** `startDate = DateTime.Today.AddDays(-6)` with each day's UTC bounds computed via `.ToUniversalTime()`.

---

## P2 — Functional Bugs

### DB-05 Fresh database runs all 6 migrations unnecessarily ✅ Fixed
**File:** `Sentinel.Engine/DistractionRepository.cs` → `InitializeAsync`  
**Problem:** `EnsureCreatedAsync` creates the full schema from the current EF model (all columns already present). Then `RunMigrationsAsync` still ran every migration 1–6, doing redundant column-existence checks and backfill logic on an empty database.  
**Fix:** `EnsureCreatedAsync` returns `true` when the DB is brand-new. On that path, we now skip all migrations, create the `_schema_version` table, and set version to 6 (latest).

---

### DB-06 Export CSV/JSON missing `SessionName` and `EndedEarly` fields ✅ Fixed
**File:** `Sentinel.Engine/MainWindow.xaml.cs` → `HandleExportData`  
**Problem:** Session exports only included `StartedAt`, `DurationSeconds`, `CompletedAt`. `SessionName` and `EndedEarly` silently dropped.  
**Fix:** Both fields added to CSV columns and JSON object.

---

### DB-07 `InitializeAsync` silently swallows DB init failure 🔴 Open
**File:** `Sentinel.Engine/DistractionRepository.cs`  
**Problem:** `catch (Exception ex)` only calls `Debug.WriteLine`. If SQLite fails to init (e.g. permissions, corrupt file), the app continues running but every data operation silently fails. The user sees blank screens with no error.  
**Current:** Uses `SentinelLog.Error` after the fix in a previous session but still does not surface an error dialog to the user.  
**Planned fix:** Show a WPF `MessageBox` and offer "Open data folder" option.

---

### DB-08 `todaySessionsCompleted` counts ALL session rows, not just completed ones 🔴 Open
**File:** `Sentinel.Engine/MainWindow.xaml.cs` → `SendSettingsToReactAsync`  
**Problem:** `GetSessionsAsync(since: todayStart).Count` returns every row started today including any hypothetically incomplete ones. Currently all saved sessions ARE complete, but the intent is to show finished-session count.  
**Planned fix:** Add filter `s.CompletedAt.HasValue` to the query.

---

### DB-09 False-alarm association is by timestamp window, not session ID 🔴 Open
**File:** `Sentinel.Engine/ReportingService.cs`  
**Problem:** Per-session false alarm counts are calculated by matching distractions whose `Timestamp` falls between `session.StartedAt` and `session.StartedAt + DurationSeconds`. If two sessions overlap in the DB (which should not happen but can during dev), false alarms can be double-counted.  
**Planned fix:** Add a nullable `SessionId FK` to `Distractions` in a future migration.

---

### DB-10 `RenameCategoryAsync` loads ALL distractions into memory before filtering 🔴 Open
**File:** `Sentinel.Engine/DistractionRepository.cs`  
**Problem:** `var matches = await db.Distractions.Where(d => d.CategoryName != null).ToListAsync()` loads every categorised distraction, then filters by name in-memory. On a large dataset this wastes memory and is slow.  
**Planned fix:** Add `.Where(d => d.CategoryName == cleanOld)` before `.ToListAsync()`.

---

## P3 — UI / Display Bugs

### UI-01 History screen shows "No data" until it loads a fresh fetch 🔴 Open
**File:** `Sentinel.UI/src/App.tsx`  
**Context:** Previously fixed so `openHistory()` calls `requestReportData('all')` before navigating. Verify this still works end-to-end with a real session in the DB — if `reportData` is already populated from a previous "Reports" visit it should just show instantly. Monitor for edge cases.

---

### UI-02 Custom presets not visually distinct in timer presets panel 🔴 Open
**File:** `Sentinel.UI/src/views.tsx`  
**Problem:** Custom presets render using `PresetChoice` identical to built-ins. No delete affordance is shown in the quick-access panel (unlike the settings screen which has a ×).  
**Planned fix:** Add a small × overlay button on custom preset cards in the timer panel.

---

### UI-03 Session complete screen always says "Focus block finished" even for early-ended sessions 🔴 Open
**File:** `Sentinel.UI/src/views.tsx` → `SessionCompleteScreen`  
**Problem:** When a session is ended early via the "End Session" button, the same completion modal appears as for a natural finish. It should acknowledge the early end.

---

### UI-04 `calculateGoalProgress` uses session count × pomodoro minutes, ignoring early-ended sessions 🔴 Open
**File:** `Sentinel.UI/src/utils.ts`  
**Problem:** `sessionsCompleted * pomodoroMinutes * 60` assumes every session was full-length. Early-ended sessions (which could be much shorter) inflate the daily goal progress.  
**Planned fix:** Track total focus seconds in React state, incremented by actual `elapsed` on each session log.

---

### UI-05 Firebase 403 console errors on every page load 🔴 Open (deferred)
**File:** `Sentinel.UI/src/firebase.ts`  
**Problem:** The Firebase project API key is not authorised for the current domain/origin when running in the Webview2 host. This produces a 403 on `securetoken.googleapis.com` and `enableIndexedDbPersistence()` deprecation warning.  
**Status:** Firebase is optional; local functionality is unaffected. Fix deferred until Firebase project is properly configured.

---

## P4 — Code Quality

### CQ-01 Several catch blocks still use `Debug.WriteLine` instead of `SentinelLog` 🔴 Open
**Files:** `DistractionRepository.cs` (data pruning catch), `MainWindow.xaml.cs` (several spots)  
**Planned fix:** Global sweep to replace remaining `Debug.WriteLine` in catch blocks.

---

### CQ-02 `ReportingService` returns empty `ReportData{}` on exception — UI shows "No data" 🔴 Open
**File:** `Sentinel.Engine/ReportingService.cs`  
**Problem:** Any exception during report generation results in silent zeros, indistinguishable from "no sessions yet" to the user.  
**Planned fix:** Return a discriminated union / error state, or propagate via a separate error message type.

---

### CQ-03 `GetSessionsAsync` has no ordering by default when `since` is null 🔴 Open
**File:** `Sentinel.Engine/DistractionRepository.cs`  
**Problem:** Calling `GetSessionsAsync()` without `since` returns sessions in `OrderByDescending(StartedAt)` order — consistent, but callers that iterate do not guarantee order. Minor.

---

### CQ-04 `handleStartPause` ref updated via `useLayoutEffect` but still called during render in some edge paths 🔴 Open
**File:** `Sentinel.UI/src/App.tsx`  
**Problem:** The ESLint `refs` rule was resolved but the pattern is fragile. Consider migrating to `useReducer` for timer state to consolidate the ref-heavy pattern.
