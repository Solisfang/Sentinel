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

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;

        _activityMonitor = new UserActivityMonitor();
        _activityMonitor.IdleDetected += OnIdleDetected;
        _activityMonitor.UserActive += OnUserActive;

        _repository = new DistractionRepository();

        // Position window in bottom-right corner
        var workArea = SystemParameters.WorkArea;
        Left = workArea.Right - Width - 20;
        Top = workArea.Bottom - Height - 20;
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

        // Prevent the default white background from showing through
        WebView.DefaultBackgroundColor = System.Drawing.Color.Transparent;

        // Listen for messages from React
        WebView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;

        // Load the React dev server (or production build)
        var devServerUrl = "http://localhost:5173";
        WebView.CoreWebView2.Navigate(devServerUrl);
        Debug.WriteLine($"[Sentinel] WebView2 navigated to {devServerUrl}");
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
            var message = JsonSerializer.Deserialize<WebMessage>(json);

            if (message?.Type == "LOG_DISTRACTION" && !string.IsNullOrEmpty(message.Note))
            {
                Debug.WriteLine($"[Sentinel] Received distraction: {message.Note}");

                var distraction = new Distraction
                {
                    Note = message.Note,
                    Timestamp = message.Timestamp ?? DateTime.UtcNow
                };

                await _repository.AddDistractionAsync(distraction);
                Debug.WriteLine("[Sentinel] Distraction saved to SQLite");
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Sentinel] Error processing message: {ex.Message}");
        }
    }

    protected override void OnClosed(EventArgs e)
    {
        _activityMonitor.IdleDetected -= OnIdleDetected;
        _activityMonitor.UserActive -= OnUserActive;
        _activityMonitor.Stop();
        base.OnClosed(e);
    }

    private class WebMessage
    {
        public string? Type { get; set; }
        public string? Note { get; set; }
        public DateTime? Timestamp { get; set; }
    }
}
