using System.Windows;

namespace Sentinel.Engine;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        SentinelLog.Info("Application starting...");
        SentinelLog.TrimIfNeeded();
    }
}
