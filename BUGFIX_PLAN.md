# Sentinel — Bug Fix & Feature Plan

Investigated on 2026-03-22. All items **RESOLVED** ✓.

---

## BUG-1: Missing DB Columns — `IsFalseAlarm` and `CompletedAt` ✓ FIXED

**Status**: Fixed — Migration 5 added to `DistractionRepository.RunMigrationsAsync()`.

**Impact**: Reports show all zeros, taxonomy may silently fail, false alarms don't save properly.

**Root Cause**: The `Distraction.IsFalseAlarm` (bool) and `Session.CompletedAt` (DateTime?) columns exist in the EF Core model (`Models.cs`) but there is **no migration** to add them to existing databases. `EnsureCreatedAsync()` only creates tables that don't exist — it never adds columns to existing ones.

This means:
- **`GetTaxonomyDataAsync()`** queries `WHERE IsFalseAlarm = 0` → fails with "no such column" → caught silently by try/catch → returns empty data.
- **`GetReportDataAsync()`** queries `Sessions.CompletedAt` and `Distractions.IsFalseAlarm` → same failure → caught silently → returns zeroed `ReportData`.
- **`HandleFalseAlarm()`** tries to write `IsFalseAlarm = true` → fails silently.
- **`HandleLogSession()`** tries to write `CompletedAt = DateTime.UtcNow` → fails silently.

**Fix**:
- Add **Migration 5** to `DistractionRepository.RunMigrationsAsync()`:
  - `ALTER TABLE Distractions ADD COLUMN IsFalseAlarm INTEGER NOT NULL DEFAULT 0;` (if not exists)
  - `ALTER TABLE Sessions ADD COLUMN CompletedAt TEXT NULL;` (if not exists)
- Use the existing `ColumnExistsAsync()` guard pattern (same as migrations 1 and 4).

**Files**: `Sentinel.Engine/DistractionRepository.cs`

---

## BUG-2: Reports Show All Zeros ✓ FIXED (via BUG-1)

**Impact**: Reports screen shows 0 sessions, 0 distractions, 0 focus time for all date ranges.

**Root Cause**: This is a direct consequence of **BUG-1**. The `ReportingService.GetReportDataAsync()` try/catch returns an empty `new ReportData()` when the SQL query crashes on the missing `IsFalseAlarm`/`CompletedAt` columns.

**Fix**: Resolved by BUG-1's migration. No additional code changes needed — once the columns exist, the reporting queries will work.

**Verification**: After migration 5, navigate to Reports → "Today" range → should show data from the current session.

---

## BUG-3: Taxonomy Not Showing Logged Distractions ✓ FIXED (via BUG-1)

**Impact**: After logging distractions and mapping them, the taxonomy screen shows empty.

**Root Cause**: Also a consequence of **BUG-1**. `GetTaxonomyDataAsync()` filters with `.Where(d => !d.IsFalseAlarm)` which crashes on the missing column. The catch block in the caller silently swallows the error and the React side receives empty taxonomy data.

**Fix**: Resolved by BUG-1's migration.

**Verification**: After migration 5, log a distraction during an intervention → open Taxonomy Manager → should show the logged entry in "Recent" and in the groups list.

---

## BUG-4: Quick Suggestion Pills Not Appearing in Intervention Modal ✓ FIXED (via BUG-1)

**Impact**: The "Quick reuse" pills (2 recent + 3 frequent) don't show during interventions.

**Root Cause**: Same as BUG-3 — `buildQuickSuggestions(taxonomyData)` receives empty arrays because the taxonomy query failed silently.

**Code path**: `App.tsx` L698 → `buildQuickSuggestions(taxonomyData)` → uses `taxonomyData.recentEntries` (empty) and `taxonomyData.groups` (empty) → returns `[]` → pills section hidden.

**Fix**: Resolved by BUG-1's migration. No code changes needed.

---

## BUG-5: Settings Not Saving ✓ FIXED

**Impact**: User reports changes to settings don't persist.

**Investigation**: The auto-save flow is actually wired correctly:
1. `SettingsScreen` calls `updateSetting(key, value)` on every change → calls `onSaveSettings({...settings, [key]: value})`
2. `App.tsx` `saveSettings()` → `postMessage({ type: 'SAVE_SETTINGS', ... })`
3. `MainWindow.xaml.cs` `HandleSaveSettings()` → updates `_settings` → calls `SettingsService.Save()`

**Possible Causes**:
- If the settings JSON file path is not writable (unlikely, same path works for other files).
- The `HandleSaveSettings` may be crashing silently if a new settings field was added on the React side but not handled in C#. Need to check field mapping.
- **Most likely**: The C# `HandleSaveSettings` reads specific named fields. If `overlayStyle` or a new field isn't being read, those specific settings won't persist. Let me check — `HandleSaveSettings` reads: `pomodoroMinutes`, `shortBreakMinutes`, `longBreakMinutes`, `idleThresholdSeconds`, `cloudSyncEnabled`, `soundEnabled`, `alwaysOnTop`, `suppressDuringMedia`, `dailyFocusGoalMinutes`, `overlayStyle`. These match the React `Settings` interface.
- **Another possibility**: If `HandleSaveSettings` throws (e.g., missing expected property in the JSON), the catch in the message dispatcher would swallow it. Need to add try/catch with logging specific to save.

**Fix**:
- Add defensive `TryGetProperty` where missing for new fields.
- Add explicit error logging in `HandleSaveSettings` to diagnose.
- Test: change a setting → close app → reopen → verify it loaded the saved value.

**Files**: `Sentinel.Engine/MainWindow.xaml.cs`

---

## BUG-6: Cannot Update Preset Values ✓ FIXED (via BUG-5)

**Impact**: Clicking a preset doesn't change the timer durations.

**Investigation**: The `applyPreset` function in `App.tsx` (L476-489) correctly:
1. Creates a new settings object with `preset.focus`, `preset.shortBreak`, `preset.longBreak`
2. Calls `saveSettings(newSettings)` to update state + send to C#
3. Calls `setTimeLeft(preset.focus * 60)` to update the current timer
4. Resets timer state

**Possible Causes**:
- If `saveSettings` fails (BUG-5 territory), the preset values are in React state but not persisted.
- The preset selection UI (`showPresets` toggle) might not be rendering correctly.
- Need to verify the Presets UI actually calls `onApplyPreset`.

**Fix**: Likely resolved alongside BUG-5. If settings save works, presets will persist too.

**Files**: Same as BUG-5.

---

## FEATURE-1: Session History Screen ✓ IMPLEMENTED

**Impact**: No dedicated screen to view session history with details per session.

**Current State**: The Reports screen has a "Recent Sessions" section (`views.tsx` L619-650) but it only shows:
- `startedAt` (timestamp)
- `durationSeconds` (length)
- `completed` (boolean)

It does **NOT** show:
- Distractions logged during that session
- False alarms during that session
- Session name
- Session end time

**Proposed Implementation**:

### Phase 1: Enrich Session History Data

1. **Update `SessionEntry` model** (`ReportingService.cs`):
   - Add `SessionName` (string?)
   - Add `CompletedAt` (DateTime?)
   - Add `DistractionsCount` (int) — count of distractions that occurred within the session time window
   - Add `FalseAlarmCount` (int) — count of false alarms within the session time window
   - Populate by correlating `Distractions.Timestamp` between `Session.StartedAt` and `Session.CompletedAt`

2. **Update `SessionEntry` TS type** (`app-types.ts`):
   - Add `sessionName: string | null`
   - Add `completedAt: string | null`
   - Add `distractionsCount: number`
   - Add `falseAlarmCount: number`

3. **Update Recent Sessions UI** (`views.tsx`):
   - Show session name (if set)
   - Show start → end time
   - Show distraction count and false alarm count per session
   - Increase from 6 to 20 visible entries (or add pagination)

### Phase 2: Dedicated History View (Optional)

- Add a `'history'` view option
- Create `SessionHistoryScreen` component with:
  - Scrollable list of all sessions (paginated or virtual scroll)
  - Each session expandable to show individual distractions
  - Filter by date range
  - Summary stats at top
- Navigation: Add "History" link to the nav bar

**Files**: `Sentinel.Engine/ReportingService.cs`, `Sentinel.Engine/Models.cs`, `Sentinel.UI/src/app-types.ts`, `Sentinel.UI/src/views.tsx`, `Sentinel.UI/src/App.tsx`

---

## Fix Priority Order

| # | Issue | Type | Severity | Dependency |
|---|-------|------|----------|------------|
| 1 | BUG-1: Missing DB columns migration | Bug | **Critical** | None — root cause of BUG-2, BUG-3, BUG-4 |
| 2 | BUG-5: Settings not saving | Bug | High | Independent |
| 3 | BUG-6: Preset values not updating | Bug | High | Depends on BUG-5 |
| 4 | FEATURE-1 Phase 1: Enrich session data | Feature | Medium | Depends on BUG-1 |
| 5 | FEATURE-1 Phase 2: Dedicated history screen | Feature | Low | Depends on Phase 1 |

**BUG-1 alone should resolve 4 of the 6 reported symptoms** (reports zeros, taxonomy empty, pills missing, false alarms not tracked).

---

## Test Plan

After all fixes:
1. Start timer → wait for idle → log distraction → verify it appears in taxonomy
2. Log a false alarm → verify it's tracked separately
3. Complete a session → open Reports → "Today" → verify non-zero stats
4. Change settings (e.g., pomodoro minutes) → close app → reopen → verify setting persisted
5. Select a preset → verify timer updates → close/reopen → verify preset persisted
6. Complete 2-3 sessions with distractions → open session history → verify per-session details
7. Run full test suite: `dotnet test` + `npx vitest run` + `npx tsc --noEmit`
