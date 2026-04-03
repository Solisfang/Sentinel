**2. Photino C# Shell & Native Host**
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
