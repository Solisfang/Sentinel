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
