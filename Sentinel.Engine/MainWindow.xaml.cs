using System.Diagnostics;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using Microsoft.Web.WebView2.Core;

namespace Sentinel.Engine;

public partial class MainWindow : Window
{
    private readonly UserActivityMonitor _activityMonitor;
    private readonly DistractionRepository _repository;
    private AppSettings _settings;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
        Closing += OnClosing;

        _settings = SettingsService.Load();
        _activityMonitor = new UserActivityMonitor(_settings.IdleThresholdSeconds);
        _activityMonitor.IdleDetected += OnIdleDetected;
        _activityMonitor.UserActive += OnUserActive;

        _repository = new DistractionRepository();

        // Restore window position or default to bottom-right
        if (_settings.WindowLeft >= 0 && _settings.WindowTop >= 0)
        {
            Left = _settings.WindowLeft;
            Top = _settings.WindowTop;
        }
        else
        {
            var workArea = SystemParameters.WorkArea;
            Left = workArea.Right - Width - 20;
            Top = workArea.Bottom - Height - 20;
        }

        Topmost = _settings.AlwaysOnTop;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        await _repository.InitializeAsync();
        await InitializeWebView();
        _activityMonitor.Start();
        Debug.WriteLine("[Sentinel] MainWindow loaded. WebView2 initialized. Activity monitor started.");
    }

    private async Task InitializeWebView()
    {
        var env = await CoreWebView2Environment.CreateAsync();
        await WebView.EnsureCoreWebView2Async(env);

        WebView.DefaultBackgroundColor = System.Drawing.Color.Transparent;
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
        WebView.CoreWebView2.Navigate(devServerUrl);
        Debug.WriteLine($"[Sentinel] WebView2 navigated to {devServerUrl}");
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
                alwaysOnTop = _settings.AlwaysOnTop
            }
        });
        WebView.CoreWebView2?.PostWebMessageAsJson(message);
        Debug.WriteLine("[Sentinel] Settings sent to React");
    }

    #region Window Control Handlers

    private void TitleBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        DragMove();
    }

    private void MinimizeBtn_Click(object sender, RoutedEventArgs e)
    {
        WindowState = WindowState.Minimized;
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
            var message = JsonSerializer.Serialize(new { type = "IDLE_DETECTED" });
            WebView.CoreWebView2?.PostWebMessageAsJson(message);
        });
    }

    private void OnUserActive(object? sender, EventArgs e)
    {
        Debug.WriteLine("[Sentinel] User Active");
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

                case "SAVE_SETTINGS":
                    HandleSaveSettings(root);
                    break;

                case "GET_SETTINGS":
                    SendSettingsToReact();
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

        var distraction = new Distraction
        {
            Note = note,
            Timestamp = DateTime.UtcNow
        };

        await _repository.AddDistractionAsync(distraction);
        Debug.WriteLine($"[Sentinel] Distraction saved: {note}");
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

        // Apply settings immediately
        _activityMonitor.IdleThresholdSeconds = _settings.IdleThresholdSeconds;
        Topmost = _settings.AlwaysOnTop;

        SettingsService.Save(_settings);
        Debug.WriteLine("[Sentinel] Settings saved");
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
        _activityMonitor.IdleDetected -= OnIdleDetected;
        _activityMonitor.UserActive -= OnUserActive;
        _activityMonitor.Stop();
        base.OnClosed(e);
    }
}
