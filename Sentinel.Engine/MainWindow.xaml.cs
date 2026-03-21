using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;

namespace Sentinel.Engine;

public partial class MainWindow : Window
{
    private readonly UserActivityMonitor _activityMonitor;
    private readonly DistractionRepository _repository;
    private readonly ReportingService _reportingService;
    private AppSettings _settings;
    private HwndSource? _hwndSource;

    // Compact mode state
    private bool _isCompactMode;
    private double _savedWidth;
    private double _savedHeight;
    private double _savedLeft;
    private double _savedTop;
    private WindowState _savedWindowState;

    // Power broadcast constants
    private const int WM_POWERBROADCAST = 0x0218;
    private const int PBT_APMSUSPEND = 0x0004;
    private const int PBT_APMRESUMEAUTOMATIC = 0x0012;

    // Global hotkey constants
    private const int WM_HOTKEY = 0x0312;
    private const int HOTKEY_START_PAUSE = 1;
    private const int HOTKEY_DISTRACTION = 2;
    private const int MOD_CTRL = 0x0002;
    private const int MOD_SHIFT = 0x0004;

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, int fsModifiers, int vk);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    [return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
    private static extern bool FlashWindowEx(ref FLASHWINFO pwfi);

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct FLASHWINFO
    {
        public uint cbSize;
        public IntPtr hwnd;
        public uint dwFlags;
        public uint uCount;
        public uint dwTimeout;
    }

    private const uint FLASHW_ALL = 3;
    private const uint FLASHW_TIMERNOFG = 12;

    public MainWindow()
    {
        CrashReporter.Initialize();
        CrashReporter.TrimLog();

        InitializeComponent();
        Loaded += OnLoaded;
        Closing += OnClosing;

        _settings = SettingsService.Load();
        _activityMonitor = new UserActivityMonitor(_settings.IdleThresholdSeconds);
        _activityMonitor.IdleDetected += OnIdleDetected;
        _activityMonitor.UserActive += OnUserActive;

        _repository = new DistractionRepository();
        _reportingService = new ReportingService();
        _activityMonitor.SuppressDuringMedia = _settings.SuppressDuringMedia;

        // Restore window position if saved
        if (_settings.WindowLeft >= 0 && _settings.WindowTop >= 0)
        {
            WindowStartupLocation = WindowStartupLocation.Manual;
            Left = _settings.WindowLeft;
            Top = _settings.WindowTop;
        }

        Topmost = _settings.AlwaysOnTop;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        await _repository.InitializeAsync();
        await InitializeWebView();
        // Activity monitor starts only when timer starts (via TIMER_RUNNING message)

        // Hook WndProc for power broadcast and global hotkeys
        _hwndSource = HwndSource.FromHwnd(new WindowInteropHelper(this).Handle);
        _hwndSource?.AddHook(WndProc);

        // Register global hotkeys: Ctrl+Shift+S (start/pause), Ctrl+Shift+D (distraction)
        var hwnd = new WindowInteropHelper(this).Handle;
        RegisterHotKey(hwnd, HOTKEY_START_PAUSE, MOD_CTRL | MOD_SHIFT, 0x53); // S
        RegisterHotKey(hwnd, HOTKEY_DISTRACTION, MOD_CTRL | MOD_SHIFT, 0x44); // D

        Debug.WriteLine("[Sentinel] MainWindow loaded. WebView2 initialized. Activity monitor started. Hotkeys registered.");

        // Check for updates in background (non-blocking)
        _ = CheckForUpdatesAsync();
    }

    private async Task CheckForUpdatesAsync()
    {
        var updateInfo = await UpdateChecker.CheckForUpdateAsync();
        if (updateInfo.UpdateAvailable)
        {
            Dispatcher.Invoke(() =>
            {
                var message = JsonSerializer.Serialize(new
                {
                    type = "UPDATE_AVAILABLE",
                    currentVersion = updateInfo.CurrentVersion,
                    latestVersion = updateInfo.LatestVersion,
                    downloadUrl = updateInfo.DownloadUrl,
                    releaseNotes = updateInfo.ReleaseNotes
                });
                WebView.CoreWebView2?.PostWebMessageAsJson(message);
            });
        }
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        switch (msg)
        {
            case WM_POWERBROADCAST:
                var pbType = wParam.ToInt32();
                if (pbType == PBT_APMSUSPEND)
                {
                    Debug.WriteLine("[Sentinel] System suspending — notifying React to save state");
                    var suspendMsg = JsonSerializer.Serialize(new { type = "SYSTEM_SUSPEND" });
                    WebView.CoreWebView2?.PostWebMessageAsJson(suspendMsg);
                }
                else if (pbType == PBT_APMRESUMEAUTOMATIC)
                {
                    Debug.WriteLine("[Sentinel] System resumed — notifying React");
                    var resumeMsg = JsonSerializer.Serialize(new { type = "SYSTEM_RESUME" });
                    WebView.CoreWebView2?.PostWebMessageAsJson(resumeMsg);
                }
                break;

            case WM_HOTKEY:
                var hotkeyId = wParam.ToInt32();
                if (hotkeyId == HOTKEY_START_PAUSE)
                {
                    Debug.WriteLine("[Sentinel] Global hotkey: Start/Pause");
                    var msg1 = JsonSerializer.Serialize(new { type = "HOTKEY_START_PAUSE" });
                    WebView.CoreWebView2?.PostWebMessageAsJson(msg1);
                    handled = true;
                }
                else if (hotkeyId == HOTKEY_DISTRACTION)
                {
                    Debug.WriteLine("[Sentinel] Global hotkey: Distraction");
                    var msg2 = JsonSerializer.Serialize(new { type = "HOTKEY_DISTRACTION" });
                    WebView.CoreWebView2?.PostWebMessageAsJson(msg2);
                    handled = true;
                }
                break;
        }
        return IntPtr.Zero;
    }

    private async Task InitializeWebView()
    {
        var env = await CoreWebView2Environment.CreateAsync();
        await WebView.EnsureCoreWebView2Async(env);

        WebView.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 26, 26, 30);
        WebView.CoreWebView2.Settings.IsNonClientRegionSupportEnabled = true;
        WebView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;

        // Send initial settings when page loads
        WebView.CoreWebView2.NavigationCompleted += (s, args) =>
        {
            if (args.IsSuccess)
            {
                SendSettingsToReact();
            }
        };

        var devServerUrl = "http://localhost:5173";
        var wwwrootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot", "index.html");

        if (File.Exists(wwwrootPath))
        {
            WebView.CoreWebView2.Navigate(new Uri(wwwrootPath).AbsoluteUri);
            Debug.WriteLine($"[Sentinel] Production mode — loaded {wwwrootPath}");
        }
        else
        {
            WebView.CoreWebView2.Navigate(devServerUrl);
            Debug.WriteLine($"[Sentinel] Dev mode — navigated to {devServerUrl}");
        }
    }

    private void SendSettingsToReact()
    {
        var message = JsonSerializer.Serialize(new
        {
            type = "SETTINGS_LOADED",
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
                overlayStyle = _settings.OverlayStyle
            }
        });
        WebView.CoreWebView2?.PostWebMessageAsJson(message);
        Debug.WriteLine("[Sentinel] Settings sent to React");
    }

    #region Window Control Handlers

    private void TitleBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ClickCount == 2)
            ToggleMaximize();
        else
            DragMove();
    }

    private void MinimizeBtn_Click(object sender, RoutedEventArgs e)
    {
        WindowState = WindowState.Minimized;
    }

    private void MaximizeBtn_Click(object sender, RoutedEventArgs e)
    {
        ToggleMaximize();
    }

    private void ToggleMaximize()
    {
        WindowState = WindowState == WindowState.Maximized
            ? WindowState.Normal
            : WindowState.Maximized;
    }

    private void CloseBtn_Click(object sender, RoutedEventArgs e)
    {
        Close();
    }

    #endregion

    private void OnIdleDetected(object? sender, EventArgs e)
    {
        Debug.WriteLine("[Sentinel] Idle Detected - Sending message to React");

        Dispatcher.Invoke(() =>
        {
            // Force window to foreground so the intervention popup is visible
            if (WindowState == WindowState.Minimized)
                WindowState = WindowState.Normal;

            Topmost = true; // Stay on top while intervention is shown

            var hwnd = new WindowInteropHelper(this).Handle;
            SetForegroundWindow(hwnd);
            Activate();

            // Flash taskbar if still not focused
            var flashInfo = new FLASHWINFO
            {
                cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf<FLASHWINFO>(),
                hwnd = hwnd,
                dwFlags = FLASHW_ALL | FLASHW_TIMERNOFG,
                uCount = 3,
                dwTimeout = 0
            };
            FlashWindowEx(ref flashInfo);

            var message = JsonSerializer.Serialize(new { type = "IDLE_DETECTED" });
            WebView.CoreWebView2?.PostWebMessageAsJson(message);
        });
    }

    private void OnUserActive(object? sender, EventArgs e)
    {
        Debug.WriteLine("[Sentinel] User Active");
    }

    private void SendSnoozeStatusToReact()
    {
        Dispatcher.Invoke(() =>
        {
            var message = JsonSerializer.Serialize(new
            {
                type = "SNOOZE_STATUS",
                isSnoozed = _activityMonitor.IsSnoozed,
                secondsRemaining = _activityMonitor.SnoozeSecondsRemaining
            });
            WebView.CoreWebView2?.PostWebMessageAsJson(message);
        });
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            var json = e.WebMessageAsJson;
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var messageType = root.GetProperty("type").GetString();

            switch (messageType)
            {
                case "LOG_DISTRACTION":
                    await HandleLogDistraction(root);
                    break;

                case "FALSE_ALARM":
                    await HandleFalseAlarm();
                    break;

                case "INTERVENTION_DISMISSED":
                    Dispatcher.Invoke(() => Topmost = _settings.AlwaysOnTop);
                    break;

                case "SNOOZE":
                    var snoozeMinutes = root.GetProperty("minutes").GetInt32();
                    _activityMonitor.Snooze(snoozeMinutes);
                    Debug.WriteLine($"[Sentinel] Snooze activated for {snoozeMinutes} minutes");
                    SendSnoozeStatusToReact();
                    break;

                case "WATCHING_CONTENT":
                    var watchMinutes = root.GetProperty("minutes").GetInt32();
                    _activityMonitor.Snooze(watchMinutes);
                    Debug.WriteLine($"[Sentinel] Watching content mode for {watchMinutes} minutes");
                    SendSnoozeStatusToReact();
                    break;

                case "CANCEL_SNOOZE":
                    _activityMonitor.CancelSnooze();
                    Debug.WriteLine("[Sentinel] Snooze cancelled by user");
                    SendSnoozeStatusToReact();
                    break;

                case "SAVE_SETTINGS":
                    HandleSaveSettings(root);
                    break;

                case "GET_SETTINGS":
                    SendSettingsToReact();
                    break;

                case "GET_REPORT_DATA":
                    await HandleGetReportData(root);
                    break;

                case "GET_TAXONOMY_DATA":
                    await SendTaxonomyDataAsync();
                    break;

                case "UPDATE_DISTRACTION_GROUP":
                    await HandleUpdateDistractionGroup(root);
                    break;

                case "RENAME_CATEGORY":
                    await HandleRenameCategory(root);
                    break;

                case "LOG_SESSION":
                    await HandleLogSession(root);
                    break;

                case "EXPORT_DATA":
                    await HandleExportData(root);
                    break;

                case "PLAY_SOUND":
                    PlayNotificationSound();
                    break;

                case "TOGGLE_COMPACT":
                    HandleToggleCompact();
                    break;

                case "TIMER_RUNNING":
                    var running = root.GetProperty("running").GetBoolean();
                    if (running)
                        _activityMonitor.Start();
                    else
                        _activityMonitor.Stop();
                    Debug.WriteLine($"[Sentinel] Timer running: {running} — idle monitor {(running ? "started" : "stopped")}");
                    break;

                case "OVERLAY_CLOSE":
                    Dispatcher.Invoke(() => Close());
                    break;

                case "OVERLAY_MAXIMIZE":
                    HandleToggleCompact();
                    break;
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Sentinel] Error processing message: {ex.Message}");
        }
    }

    private async Task HandleLogDistraction(JsonElement root)
    {
        var note = root.GetProperty("note").GetString();
        if (string.IsNullOrEmpty(note)) return;
        var categoryName = root.TryGetProperty("categoryName", out var categoryProp)
            ? categoryProp.GetString()
            : null;
        var forceUncategorized = root.TryGetProperty("forceUncategorized", out var forceProp) &&
                                 forceProp.GetBoolean();

        var distraction = new Distraction
        {
            Note = note,
            NormalizedNote = DistractionNormalizer.Normalize(note),
            CategoryName = categoryName,
            Timestamp = DateTime.UtcNow
        };

        await _repository.AddDistractionAsync(distraction, skipAutoCategory: forceUncategorized);
        Debug.WriteLine($"[Sentinel] Distraction saved: {note}");
        await SendTaxonomyDataAsync();
    }

    private async Task HandleFalseAlarm()
    {
        var distraction = new Distraction
        {
            Note = "False Alarm",
            NormalizedNote = DistractionNormalizer.Normalize("False Alarm"),
            Timestamp = DateTime.UtcNow,
            IsFalseAlarm = true
        };
        await _repository.AddDistractionAsync(distraction);
        Debug.WriteLine("[Sentinel] False alarm logged");
    }

    private async Task HandleGetReportData(JsonElement root)
    {
        var range = root.TryGetProperty("range", out var rangeProp)
            ? rangeProp.GetString() ?? "week"
            : "week";

        var since = range switch
        {
            "today" => DateTime.UtcNow.Date,
            "week" => DateTime.UtcNow.Date.AddDays(-7),
            "month" => DateTime.UtcNow.Date.AddDays(-30),
            "all" => DateTime.MinValue,
            _ => DateTime.UtcNow.Date.AddDays(-7)
        };

        var report = await _reportingService.GetReportDataAsync(since);

        Dispatcher.Invoke(() =>
        {
            var message = JsonSerializer.Serialize(new
            {
                type = "REPORT_DATA",
                data = report
            }, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
            WebView.CoreWebView2?.PostWebMessageAsJson(message);
        });
    }

    private async Task SendTaxonomyDataAsync()
    {
        var data = await _repository.GetTaxonomyDataAsync();

        Dispatcher.Invoke(() =>
        {
            var message = JsonSerializer.Serialize(new
            {
                type = "TAXONOMY_DATA",
                data
            }, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
            WebView.CoreWebView2?.PostWebMessageAsJson(message);
        });
    }

    private async Task HandleUpdateDistractionGroup(JsonElement root)
    {
        var normalizedNote = root.GetProperty("normalizedNote").GetString();
        var note = root.GetProperty("note").GetString();
        var categoryName = root.TryGetProperty("categoryName", out var categoryProp)
            ? categoryProp.GetString()
            : null;

        if (string.IsNullOrWhiteSpace(normalizedNote) || string.IsNullOrWhiteSpace(note))
        {
            return;
        }

        await _repository.UpdateDistractionGroupAsync(normalizedNote, note, categoryName);
        Debug.WriteLine($"[Sentinel] Taxonomy group updated: {normalizedNote} -> {note} ({categoryName ?? "none"})");
        await SendTaxonomyDataAsync();
    }

    private async Task HandleRenameCategory(JsonElement root)
    {
        var oldName = root.GetProperty("oldName").GetString();
        var newName = root.GetProperty("newName").GetString();

        if (string.IsNullOrWhiteSpace(oldName) || string.IsNullOrWhiteSpace(newName))
        {
            return;
        }

        await _repository.RenameCategoryAsync(oldName, newName);
        Debug.WriteLine($"[Sentinel] Category renamed: {oldName} -> {newName}");
        await SendTaxonomyDataAsync();
    }

    private async Task HandleLogSession(JsonElement root)
    {
        var durationSeconds = root.GetProperty("durationSeconds").GetInt32();
        var sessionName = root.TryGetProperty("sessionName", out var nameProp)
            ? nameProp.GetString()
            : null;
        var session = new Session
        {
            DurationSeconds = durationSeconds,
            StartedAt = DateTime.UtcNow.AddSeconds(-durationSeconds),
            CompletedAt = DateTime.UtcNow,
            SessionName = sessionName
        };
        await _repository.AddSessionAsync(session);
        Debug.WriteLine($"[Sentinel] Session saved: {durationSeconds}s{(sessionName != null ? $" ({sessionName})" : "")}");
    }

    private void PlayNotificationSound()
    {
        if (!_settings.SoundEnabled) return;
        try
        {
            System.Media.SystemSounds.Exclamation.Play();
            Debug.WriteLine("[Sentinel] Notification sound played");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Sentinel] Sound play failed: {ex.Message}");
        }
    }

    private async Task HandleExportData(JsonElement root)
    {
        var format = root.TryGetProperty("format", out var fmtProp)
            ? fmtProp.GetString() ?? "json"
            : "json";

        try
        {
            var sessions = await _repository.GetSessionsAsync();
            var distractions = await _repository.GetDistractionsAsync();
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var exportDir = Path.Combine(appData, "Sentinel", "exports");
            Directory.CreateDirectory(exportDir);

            var timestamp = DateTime.Now.ToString("yyyyMMdd_HHmmss");
            string filePath;

            if (format == "csv")
            {
                filePath = Path.Combine(exportDir, $"sentinel_sessions_{timestamp}.csv");
                var lines = new List<string> { "StartedAt,DurationSeconds,Completed" };
                lines.AddRange(sessions.Select(s =>
                    $"{s.StartedAt:yyyy-MM-dd HH:mm:ss},{s.DurationSeconds},{s.CompletedAt.HasValue}"));
                await File.WriteAllLinesAsync(filePath, lines);

                var dFilePath = Path.Combine(exportDir, $"sentinel_distractions_{timestamp}.csv");
                var dLines = new List<string> { "Timestamp,Note,CategoryName,IsFalseAlarm" };
                dLines.AddRange(distractions.Select(d =>
                    $"{d.Timestamp:yyyy-MM-dd HH:mm:ss},\"{d.Note.Replace("\"", "\"\"")}\",\"{(d.CategoryName ?? string.Empty).Replace("\"", "\"\"")}\",{d.IsFalseAlarm}"));
                await File.WriteAllLinesAsync(dFilePath, dLines);
            }
            else
            {
                filePath = Path.Combine(exportDir, $"sentinel_backup_{timestamp}.json");
                var data = new
                {
                    exportedAt = DateTime.UtcNow,
                    sessions = sessions.Select(s => new { s.StartedAt, s.DurationSeconds, s.CompletedAt }),
                    distractions = distractions.Select(d => new { d.Timestamp, d.Note, d.CategoryName, d.IsFalseAlarm })
                };
                var json = JsonSerializer.Serialize(data, new JsonSerializerOptions
                {
                    WriteIndented = true,
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase
                });
                await File.WriteAllTextAsync(filePath, json);
            }

            Dispatcher.Invoke(() =>
            {
                var responseMsg = JsonSerializer.Serialize(new
                {
                    type = "EXPORT_COMPLETE",
                    path = filePath,
                    format
                });
                WebView.CoreWebView2?.PostWebMessageAsJson(responseMsg);
            });

            Debug.WriteLine($"[Sentinel] Data exported to {filePath}");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Sentinel] Export failed: {ex.Message}");
            Dispatcher.Invoke(() =>
            {
                var errMsg = JsonSerializer.Serialize(new
                {
                    type = "EXPORT_COMPLETE",
                    error = ex.Message
                });
                WebView.CoreWebView2?.PostWebMessageAsJson(errMsg);
            });
        }
    }

    private void HandleSaveSettings(JsonElement root)
    {
        var settings = root.GetProperty("settings");

        _settings.PomodoroMinutes = settings.GetProperty("pomodoroMinutes").GetInt32();
        _settings.ShortBreakMinutes = settings.GetProperty("shortBreakMinutes").GetInt32();
        _settings.LongBreakMinutes = settings.GetProperty("longBreakMinutes").GetInt32();
        _settings.IdleThresholdSeconds = settings.GetProperty("idleThresholdSeconds").GetInt32();
        _settings.CloudSyncEnabled = settings.GetProperty("cloudSyncEnabled").GetBoolean();
        _settings.SoundEnabled = settings.GetProperty("soundEnabled").GetBoolean();
        _settings.AlwaysOnTop = settings.GetProperty("alwaysOnTop").GetBoolean();

        if (settings.TryGetProperty("suppressDuringMedia", out var sdm))
            _settings.SuppressDuringMedia = sdm.GetBoolean();
        if (settings.TryGetProperty("dailyFocusGoalMinutes", out var dfg))
            _settings.DailyFocusGoalMinutes = dfg.GetInt32();
        if (settings.TryGetProperty("overlayStyle", out var os))
            _settings.OverlayStyle = os.GetString() ?? "compact";

        // Apply settings immediately
        _activityMonitor.IdleThresholdSeconds = _settings.IdleThresholdSeconds;
        _activityMonitor.SuppressDuringMedia = _settings.SuppressDuringMedia;
        if (!_isCompactMode)
            Topmost = _settings.AlwaysOnTop;

        SettingsService.Save(_settings);
        Debug.WriteLine("[Sentinel] Settings saved");
    }

    private void HandleToggleCompact()
    {
        Dispatcher.Invoke(() =>
        {
            if (_isCompactMode)
            {
                // Restore full window
                _isCompactMode = false;
                Width = _savedWidth;
                Height = _savedHeight;
                Left = _savedLeft;
                Top = _savedTop;
                WindowState = _savedWindowState;
                Topmost = _settings.AlwaysOnTop;
                TitleBarGrid.Visibility = Visibility.Visible;
                TitleBarRow.Height = new GridLength(36);
                MinWidth = 360;
                MinHeight = 480;
                ResizeMode = ResizeMode.CanResizeWithGrip;
            }
            else
            {
                // Save current size/pos and shrink
                _isCompactMode = true;
                _savedWindowState = WindowState;
                _savedWidth = ActualWidth;
                _savedHeight = ActualHeight;
                _savedLeft = Left;
                _savedTop = Top;
                WindowState = WindowState.Normal;
                TitleBarGrid.Visibility = Visibility.Collapsed;
                TitleBarRow.Height = new GridLength(0);

                // Size based on overlay style
                var style = _settings.OverlayStyle ?? "compact";
                switch (style)
                {
                    case "pill":
                        MinWidth = 200; MinHeight = 80;
                        Width = 220; Height = 100;
                        break;
                    case "monitoring":
                        MinWidth = 280; MinHeight = 120;
                        Width = 320; Height = 160;
                        break;
                    default: // compact
                        MinWidth = 220; MinHeight = 100;
                        Width = 260; Height = 140;
                        break;
                }
                ResizeMode = ResizeMode.NoResize;
                Topmost = true;

                // Position bottom-right of screen
                var workArea = SystemParameters.WorkArea;
                Left = workArea.Right - Width - 20;
                Top = workArea.Bottom - Height - 20;
            }

            var message = JsonSerializer.Serialize(new
            {
                type = "COMPACT_MODE_CHANGED",
                isCompact = _isCompactMode
            });
            WebView.CoreWebView2?.PostWebMessageAsJson(message);
            Debug.WriteLine($"[Sentinel] Compact mode: {_isCompactMode}");
        });
    }

    private void OnClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        // Save window position
        _settings.WindowLeft = Left;
        _settings.WindowTop = Top;
        SettingsService.Save(_settings);
    }

    protected override void OnClosed(EventArgs e)
    {
        // Unregister global hotkeys
        var hwnd = new WindowInteropHelper(this).Handle;
        UnregisterHotKey(hwnd, HOTKEY_START_PAUSE);
        UnregisterHotKey(hwnd, HOTKEY_DISTRACTION);
        _hwndSource?.RemoveHook(WndProc);

        _activityMonitor.IdleDetected -= OnIdleDetected;
        _activityMonitor.UserActive -= OnUserActive;
        _activityMonitor.Stop();
        base.OnClosed(e);
    }
}
