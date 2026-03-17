using System.Diagnostics;
using System.Windows;

namespace Sentinel.Engine;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        Debug.WriteLine("[Sentinel] Application starting...");

        // Initialize Firebase in the background — don't block the UI
        _ = Task.Run(FirebaseService.InitializeAsync);
    }
}
