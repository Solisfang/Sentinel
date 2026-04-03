## 9. Migration Execution Plan

This section defines the phase-by-phase execution plan for migrating Project Sentinel from the source stack (WPF / WebView2 / React / SQLite) to the target stack (Photino / Angular / Firebase). Each phase is a self-contained vertical slice that can be built, tested, and demonstrated independently. Phases are ordered by dependency — each phase builds on the deliverables of prior phases.

**Governing principles:**

1. **Vertical slices over horizontal layers.** Each phase delivers a working feature, not a layer. Phase 1 produces a window that sends and receives IPC messages. Phase 4 produces a working timer with intervention flow. No phase delivers "just infrastructure."
2. **Source-first verification.** Before implementing a target feature, read the source file(s) that implement the equivalent behavior. Verify that the target implementation handles every edge case the source handles.
3. **No parallel paths.** The source application (`Sentinel.Engine` + `Sentinel.UI`) remains the production build until Phase 12. The target application (`Sentinel.Shell` + `Sentinel.App`) is developed in a separate project directory within the same solution. The two coexist in `Sentinel.sln` throughout development.
4. **Test at each phase boundary.** Each phase has explicit acceptance criteria. All criteria must pass before proceeding to the next phase.
5. **Greenfield bootstrap fallback.** If source files are not present (for example, clean-workspace scaffolding), treat Source → Target mappings as behavior references only and scaffold target files directly from the target architecture and phase deliverables.

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

**Objective:** Create the Angular SPA project (`Sentinel.App`), configure Tailwind CSS v4 with the dark-mode design system (→ §5.1, design tokens from `stitch_exports/Sentinel2.0/metadata/design-system-theme.json`), implement shared layout components, set up routing for all feature modules, and connect the Angular app to the Photino shell's `wwwroot`.

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

**Source:** Design tokens are defined in `stitch_exports/Sentinel2.0/metadata/design-system-theme.json`. These specify the exact color palette, typography scale, spacing scale, border radii, and shadows.

**Target:** Tailwind CSS v4 custom theme in `styles.css` using `@theme` directive:

```css
/* File: Sentinel.App/src/styles.css */

@import "tailwindcss";

@theme {
  /* Colors from stitch_exports/Sentinel2.0/metadata/design-system-theme.json */
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

The Planner is referenced in the Stitch exports at `stitch_exports/Sentinel2.0/` and the navigation structure expects a "Planner" route.

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
