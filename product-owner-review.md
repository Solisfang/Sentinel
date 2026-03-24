# Product Owner Review & Issue Log

> Generated: 2026-03-24  
> Reviewer: QA Lead / Product Owner (automated deep-dive)  
> Codebase: Sentinel v0.x — WPF .NET 8 + WebView2 + React 19 + SQLite

---

## 1. Executive Summary

Sentinel's core architecture is sound, but a critical DB migration bug has been silently blocking **all** data reads and writes since the first schema upgrade was shipped. This is now fixed with an auto-reset recovery path. Beyond the data layer, 19 additional issues were identified across timer logic, reports, taxonomy management, cloud sync, and UX — ranging from a ghost-intervention race condition (High) to minor UX polish items (Low). No Critical issues remain after the DB fix.

---

## 2. Tested Workflows

* Workflow A: App startup & DB seeding
* Workflow B: Timer (start / pause / resume / complete / end-early / compact)
* Workflow C: Distraction logging & taxonomy auto-categorisation
* Workflow D: Intervention overlay (trigger / dismiss / snooze)
* Workflow E: History & reports (chart, session list, accuracy %)
* Workflow F: Taxonomy manager (groups, rename, delete CRUD)
* Workflow G: Settings (presets, custom presets, export, demo data, updates)
* Workflow H: Sleep / resume prompt
* Workflow I: Auth & cloud sync
* Workflow J: Onboarding / first-run UX

---

## 3. Issue Log

---

### Issue ID: PO-001 — DB Migration Failure Silently Leaves App Broken Forever

* **Severity:** Critical (now fixed)
* **Workflow / Module:** App Startup / Data Layer
* **Description:** Migration 1's backfill step called `db.Distractions.ToListAsync()`. Once migration 5 added `IsFalseAlarm` to the EF model, that query failed with `SQLite Error 1: 'no such column: d.IsFalseAlarm'` on any DB that hadn't yet run migration 5. The `catch` block in `InitializeAsync` swallowed the exception silently — every subsequent startup retried and failed the same way, leaving all tables unreadable forever.
* **Steps to Reproduce (Based on Code):**
  1. Have a `sentinel.db` created before migration 5 was added.
  2. Launch new build — `InitializeAsync` calls `RunMigrationsAsync`.
  3. `currentVersion < 1` branch runs the backfill via EF — SQLite rejects the implicit `SELECT *` because `IsFalseAlarm` doesn't exist.
  4. Exception is caught and logged, `InitializeAsync` returns without completing migrations.
  5. Every request to read/write data fails immediately.
* **Expected Behavior:** Migrations apply incrementally; app starts and shows data.
* **Actual Behavior:** All data reads/writes fail: empty screens, failed reports, seeder never runs.
* **Fix Applied:** Migration 1 backfill rewritten to raw SQL (no EF model); `InitializeAsync` now auto-backs-up and recreates the DB if migrations fail.
* **Relevant Files:** `DistractionRepository.cs` lines 17–67, 262–296

---

### Issue ID: PO-002 — Startup: WebView2 Navigation Before DB Is Ready

* **Severity:** High
* **Workflow / Module:** App Startup
* **Description:** `InitializeWebView()` is called right after `SeedAsync()`, but `NavigationCompleted` fires immediately and calls `SendSettingsToReactAsync()`. If the DB is still initialising (e.g. backfill on a large dataset), the settings/today data query runs concurrently and may read an incomplete state.
* **Steps to Reproduce (Based on Code):**
  1. App starts with a large existing DB requiring migration 1 backfill.
  2. `OnLoaded` awaits `InitializeAsync` — backfill in progress.
  3. WebView navigation happens after init, but `NavigationCompleted` immediately triggers `SendSettingsToReactAsync`.
  4. `SendSettingsToReactAsync` queries DB — no data race guard.
* **Expected Behavior:** UI receives accurate settings on first load.
* **Actual Behavior:** Potential empty/stale settings pushed to React if init isn't complete.
* **Relevant Files:** `MainWindow.xaml.cs` lines 96–120, 190–200

---

### Issue ID: PO-003 — Timer: Goal Progress Assumes Constant Session Length

* **Severity:** Medium
* **Workflow / Module:** Timer / Goal Progress Bar
* **Description:** `calculateGoalProgress` in `utils.ts` computes progress as `(todaySessionsCompleted × pomodoroMinutes) / dailyFocusGoalMinutes`. It assumes every completed session was the full `pomodoroMinutes` duration. If the user uses a 50-minute preset but the goal was set with 25-minute sessions in mind, or changes the preset mid-day, the progress bar overflows or shows wrong percentages.
* **Steps to Reproduce (Based on Code):**
  1. Set `dailyFocusGoalMinutes = 100`, `pomodoroMinutes = 25`.
  2. Complete 2 sessions → progress = 50%.
  3. Change preset to 50-minute sessions.
  4. Complete 1 more session → progress jumps to 150% (overflow).
* **Expected Behavior:** Progress is based on actual focus time (sum of `DurationSeconds`), not a count × current preset.
* **Actual Behavior:** Progress overflows or is wrong when presets change.
* **Relevant Files:** `utils.ts`, `MainWindow.xaml.cs` `SendSettingsToReactAsync`

---

### Issue ID: PO-004 — Timer: Global Hotkeys Fire When React Is Not Ready

* **Severity:** Low
* **Workflow / Module:** Timer / Hotkeys
* **Description:** `HOTKEY_START_PAUSE` and `HOTKEY_DISTRACTION` dispatch `postMessage` to React via WebView2. If the user presses the hotkey while the app is still loading (WebView2 is initialising), `CoreWebView2` may be null and the message is silently dropped.
* **Steps to Reproduce (Based on Code):**
  1. App launches — `OnLoaded` is still awaiting `InitializeWebView`.
  2. User presses `Ctrl+Shift+S`.
  3. `WndProc` handles `WM_HOTKEY` and calls `WebView.CoreWebView2?.PostWebMessageAsJson(...)`.
  4. `CoreWebView2` is null — message lost.
* **Expected Behavior:** Hotkey is queued or ignored gracefully.
* **Actual Behavior:** Silent no-op; user thinks hotkey is broken.
* **Relevant Files:** `MainWindow.xaml.cs` WndProc handler

---

### Issue ID: PO-005 — Timer: Spacebar Pauses Timer While Typing Session Name

* **Severity:** Low
* **Workflow / Module:** Timer / Input
* **Description:** The spacebar is bound to start/pause the timer via `keydown` listener. There is no check for whether the currently focused element is a text input, so typing a session name like "Deep work" will pause/resume the timer on the space character.
* **Steps to Reproduce (Based on Code):**
  1. Timer is running.
  2. User clicks the Session Name input and types "Deep work".
  3. Pressing Space fires the global `keydown` handler → timer pauses.
* **Expected Behavior:** Spacebar only toggles timer when no input is focused.
* **Actual Behavior:** Timer pauses mid-typing.
* **Relevant Files:** `App.tsx` keyboard event handler

---

### Issue ID: PO-006 — Distraction Log: Auto-Category Lookup May Miss Due to Normalisation Gap

* **Severity:** High
* **Workflow / Module:** Distraction Logging / Auto-Categorisation
* **Description:** `AddDistractionAsync` does an auto-category lookup using `NormalizedNote`. However, when React sends a `LOG_DISTRACTION` message, the note is passed as-is. If `MainWindow` sets `NormalizedNote` before calling the repository, and the repository also normalises again, there's a double-normalise which is safe — but if `forceUncategorized` is false and the note was manually pre-normalised in React, edge cases with Unicode or punctuation could cause a missed lookup.
* **Expected Behavior:** Auto-category always resolves consistently.
* **Actual Behavior:** Niche normalisation mismatches possible for non-ASCII inputs.
* **Relevant Files:** `DistractionRepository.cs` `AddDistractionAsync`, `MainWindow.xaml.cs` `HandleLogDistraction`

---

### Issue ID: PO-007 — Intervention: New Category Input Has No Validation

* **Severity:** Medium
* **Workflow / Module:** Intervention Overlay / Category Input
* **Description:** The "New Category" field in the Intervention modal accepts any string. An empty string after trim, extremely long strings (500+ chars), or strings with SQL-special characters are passed directly to `AddDistractionAsync`. While SQLite parameterised queries prevent injection, an empty category would be persisted and appear as an empty item in the Taxonomy Manager.
* **Steps to Reproduce (Based on Code):**
  1. Open Intervention modal.
  2. Enter a single space in "New Category" and submit.
  3. Distraction is saved with `CategoryName = ""` (after trim by `CleanCategory`).
  4. Actually `CleanCategory` returns `null` for empty — but the user sees no error.
* **Expected Behavior:** "New Category" field validates minimum 1 non-space character before allowing submit.
* **Actual Behavior:** Submit proceeds silently; category is silently dropped.
* **Relevant Files:** `views.tsx` Intervention modal, `DistractionRepository.cs` `CleanCategory`

---

### Issue ID: PO-008 — Intervention: "User Active" Does Not Auto-Dismiss Modal

* **Severity:** High
* **Workflow / Module:** Intervention Overlay
* **Description:** `UserActivityMonitor` fires `UserActive` event when the user resumes typing/clicking. `MainWindow.OnUserActive` sends a `USER_ACTIVE` message to React. However, `App.tsx` does not handle `USER_ACTIVE` to auto-dismiss the intervention overlay — the user must manually click "False Alarm" or "Log It" even though the system already knows they're back.
* **Steps to Reproduce (Based on Code):**
  1. User goes idle → intervention fires, modal appears.
  2. User starts typing again → `UserActive` event fires → `USER_ACTIVE` postMessage sent.
  3. React receives message — no handler for `USER_ACTIVE` in the switch statement.
  4. Modal stays open indefinitely.
* **Expected Behavior:** Modal auto-dismisses (or prompts "You're back! Log this as distraction?").
* **Actual Behavior:** Modal stays open until manually dismissed.
* **Relevant Files:** `MainWindow.xaml.cs` `OnUserActive`, `App.tsx` message switch

---

### Issue ID: PO-009 — Intervention: Ghost Popups When Timer Is Paused

* **Severity:** High
* **Workflow / Module:** Intervention / Timer Pause
* **Description:** The `UserActivityMonitor` is stopped only when React sends `TIMER_RUNNING: false`. If there's any message delivery delay or the app is mid-initialisation when the pause state is set, the monitor keeps running and can fire `IdleDetected` while the timer is intentionally paused — producing an intervention for a user who is legitimately taking a break.
* **Steps to Reproduce (Based on Code):**
  1. Timer is running.
  2. User clicks Pause — `TIMER_RUNNING: false` message sent.
  3. Message delivery has 1-3 frame delay due to WebView2 bridge.
  4. `IdleDetected` fires in the gap — intervention modal appears even though timer is paused.
* **Expected Behavior:** No intervention when timer is paused.
* **Actual Behavior:** Rare ghost intervention possible during pause transition.
* **Relevant Files:** `MainWindow.xaml.cs` `OnIdleDetected`, `TIMER_RUNNING` handler

---

### Issue ID: PO-010 — Reports: Inaccurate Daily Chart for Non-UTC Timezones

* **Severity:** High
* **Workflow / Module:** History / Daily Focus Chart
* **Description:** The 7-day chart groups sessions by day using local midnight boundaries converted to UTC. However, if a user in UTC-8 completes a session at 11 PM local (7 AM UTC next day), that session's UTC timestamp falls on the *next* UTC day. The boundary math must correctly use local-to-UTC conversion for each day boundary.
* **Steps to Reproduce (Based on Code):**
  1. User in UTC-8 completes a 25-min session at 11:30 PM local (7:30 AM UTC next day).
  2. `ReportingService` queries by UTC day boundaries.
  3. Session time (7:30 AM UTC) falls in tomorrow's UTC bucket, not today's local bucket.
  4. Today's bar shows no data; tomorrow's bar shows today's session.
* **Expected Behavior:** Sessions appear on the local calendar day they were performed.
* **Actual Behavior:** Sessions appear on the wrong day for timezones far from UTC.
* **Relevant Files:** `ReportingService.cs` daily chart aggregation

---

### Issue ID: PO-011 — Reports: "All Time" Query Has No Pagination / Limit

* **Severity:** Medium
* **Workflow / Module:** History Screen
* **Description:** `HandleGetReportData` with range `"all"` queries `GetSessionsAsync()` and `GetDistractionsAsync()` with no limit. A user with 2+ years of data could trigger a query returning thousands of rows, serialised to JSON, sent through WebView2 — potentially causing UI thread stalls or out-of-memory on lower-end machines.
* **Expected Behavior:** "All time" is capped (e.g., last 365 days) or paginated.
* **Actual Behavior:** Unbounded query; scales O(n) with all-time data.
* **Relevant Files:** `MainWindow.xaml.cs` `HandleGetReportData`, `DistractionRepository.cs` `GetSessionsAsync`

---

### Issue ID: PO-012 — Taxonomy: Category Rename Merges Without Warning

* **Severity:** Medium
* **Workflow / Module:** Taxonomy Manager
* **Description:** `RenameCategoryAsync` does a bulk UPDATE of all matching rows. If the user renames "Work" to "Social Media" and a "Social Media" category already exists, all "Work" entries silently merge into "Social Media". There is no duplicate-detection or confirmation prompt.
* **Steps to Reproduce (Based on Code):**
  1. User has 20 distractions in "Work" and 15 in "Social Media".
  2. User renames "Work" → "Social Media".
  3. `RenameCategoryAsync` updates 20 rows; "Work" disappears.
  4. "Social Media" now shows 35 historical entries with no undo.
* **Expected Behavior:** Warning shown if target category name already exists, with "Merge" / "Cancel" options.
* **Actual Behavior:** Silent merge; no undo.
* **Relevant Files:** `DistractionRepository.cs` `RenameCategoryAsync`, `views.tsx` taxonomy rename UI

---

### Issue ID: PO-013 — Taxonomy: UI Flicker on Category Rename

* **Severity:** Low
* **Workflow / Module:** Taxonomy Manager
* **Description:** After a rename, `App.tsx` calls `requestTaxonomyData()` to reload, but there is no optimistic update. The old category name remains visible for ~200ms while the new data round-trips through the WebView2 bridge, causing a visible flicker.
* **Expected Behavior:** Instant local update, confirmed by server response.
* **Actual Behavior:** Brief flicker back to old name.
* **Relevant Files:** `App.tsx` taxonomy rename handler, `views.tsx`

---

### Issue ID: PO-014 — Settings: Custom Preset Deleted Without Confirmation

* **Severity:** Medium
* **Workflow / Module:** Settings / Custom Presets
* **Description:** Clicking the × delete button on a custom preset immediately saves the deletion with no confirmation. Accidental clicks are irreversible unless the user recreates the preset from memory.
* **Expected Behavior:** Confirm dialog ("Delete preset 'Deep Work'?") before removing.
* **Actual Behavior:** Instant deletion with no undo.
* **Relevant Files:** `views.tsx` custom preset delete button

---

### Issue ID: PO-015 — Settings: AlwaysOnTop Corrupted During Active Intervention

* **Severity:** Medium
* **Workflow / Module:** Settings / Window Behaviour
* **Description:** During an intervention, `MainWindow` forces `Topmost = true`. When the user dismisses the intervention, it restores `Topmost = _settings.AlwaysOnTop`. If the user opened Settings and toggled AlwaysOnTop *while* the intervention overlay was active, the in-memory `_settings` changes but the intervention dismiss handler overwrites `Topmost` with the *old* saved value.
* **Expected Behavior:** AlwaysOnTop reflects the setting as last saved by the user.
* **Actual Behavior:** AlwaysOnTop reverts to pre-settings-change value after intervention dismissal.
* **Relevant Files:** `MainWindow.xaml.cs` intervention dismiss handler, `HandleSaveSettings`

---

### Issue ID: PO-016 — Cloud Sync: Failed Syncs Are Silently Lost

* **Severity:** High
* **Workflow / Module:** Auth / Cloud Sync
* **Description:** `syncSessionToFirestore` is fire-and-forget — called with `_ =` or in a background effect. If the network is unavailable, the sync throws and is logged to console, but no retry is queued and no "Sync Pending" indicator is shown. The session exists locally but never reaches the cloud.
* **Expected Behavior:** Failed syncs are queued and retried on next successful connection.
* **Actual Behavior:** Sync attempts are lost; no UI feedback; user assumes data is backed up.
* **Relevant Files:** `App.tsx` `syncSessionToFirestore`, timer complete handler

---

### Issue ID: PO-017 — Cloud Sync: Cross-Device Data Never Merges If Local Data Exists

* **Severity:** Medium
* **Workflow / Module:** Auth / Cloud Sync
* **Description:** Firestore data is fetched only when local DB has zero sessions. A user who starts on desktop (builds local data), then adds sessions on a laptop (Firestore), and returns to desktop will *never* see the laptop sessions — the merge check sees local data exists and skips the fetch entirely.
* **Expected Behavior:** Cloud data is merged on a per-record basis, not gated on local count.
* **Actual Behavior:** Cloud sessions are permanently invisible on any device with pre-existing local data.
* **Relevant Files:** `App.tsx` Firestore fetch condition

---

### Issue ID: PO-018 — UX: Compact Mode Has No Visible "Exit" Affordance

* **Severity:** High
* **Workflow / Module:** Compact Mode / UX Discoverability
* **Description:** Once in compact/widget mode, the full interface is hidden. The only way to exit is to double-click the compact widget — but this is not communicated anywhere in the UI. There is no tooltip, no button, and no hint text. New users who accidentally enter compact mode have no way to recover without knowing the hidden interaction.
* **Expected Behavior:** A visible "expand" icon or tooltip ("Double-click to expand") is present in compact mode.
* **Actual Behavior:** No affordance; users are stuck in compact mode with no recovery path visible.
* **Relevant Files:** `views.tsx` compact mode view, `MainWindow.xaml.cs` `HandleToggleCompact`

---

### Issue ID: PO-019 — UX: Sleep Prompt Enter Key May Double-Fire

* **Severity:** Low
* **Workflow / Module:** Sleep / Resume Prompt
* **Description:** The `ResumePromptModal` listens for `Enter` key globally to resume. If any button in the overlay has DOM focus when `Enter` is pressed, the `click` event fires *and* the keydown handler fires simultaneously — potentially triggering a resume twice or submitting a form in the background.
* **Expected Behavior:** Enter key maps to exactly one action in the resume prompt.
* **Actual Behavior:** Potential double-fire if a button is focused.
* **Relevant Files:** `App.tsx` resume prompt keydown handler, `views.tsx` `ResumePromptModal`

---

## 4. Summary by Severity

| Severity | Count | Issues |
|:---|:---:|:---|
| Critical | 1 | PO-001 (fixed) |
| High | 7 | PO-002, PO-006, PO-008, PO-009, PO-010, PO-016, PO-018 |
| Medium | 7 | PO-003, PO-007, PO-011, PO-012, PO-014, PO-015, PO-017 |
| Low | 4 | PO-004, PO-005, PO-013, PO-019 |

---

## 5. Recommended Fix Priority

1. **PO-001** — DB migration recovery (done ✅)  
2. **PO-008** — Auto-dismiss intervention on user-active  
3. **PO-018** — Compact mode exit affordance  
4. **PO-009** — Ghost intervention on timer pause  
5. **PO-016** — Cloud sync failure feedback / retry  
6. **PO-003** — Goal progress uses actual focus time  
7. **PO-010** — Daily chart timezone correctness  
8. **PO-012** — Taxonomy rename collision warning  
9. **PO-005** — Spacebar blocked in session name input  
10. **PO-014** — Custom preset delete confirmation  
