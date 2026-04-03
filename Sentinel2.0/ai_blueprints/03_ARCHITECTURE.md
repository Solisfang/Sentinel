 **3. IPC Bridge (C# ↔ Angular)**
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
