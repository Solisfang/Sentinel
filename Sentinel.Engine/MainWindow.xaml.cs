using System.Diagnostics;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace Sentinel.Engine;

public partial class MainWindow : Window
{
    private readonly UserActivityMonitor _activityMonitor;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
        _activityMonitor = new UserActivityMonitor();
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
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

        WebView.CoreWebView2.Navigate("https://example.com");
        Debug.WriteLine("[Sentinel] WebView2 navigated to https://example.com");
    }

    protected override void OnClosed(EventArgs e)
    {
        _activityMonitor.Stop();
        base.OnClosed(e);
    }
}
