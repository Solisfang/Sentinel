using System.Diagnostics;
using System.IO;

namespace Sentinel.Engine;

public static class CrashReporter
{
    private static readonly string LogDir;
    private static readonly string LogPath;

    static CrashReporter()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        LogDir = Path.Combine(appData, "Sentinel", "logs");
        Directory.CreateDirectory(LogDir);
        LogPath = Path.Combine(LogDir, "crash.log");
    }

    public static void Initialize()
    {
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
        {
            if (args.ExceptionObject is Exception ex)
            {
                LogCrash("UnhandledException", ex);
            }
        };

        System.Windows.Application.Current.DispatcherUnhandledException += (_, args) =>
        {
            LogCrash("DispatcherUnhandledException", args.Exception);
            args.Handled = true; // Prevent app crash for recoverable errors
        };

        TaskScheduler.UnobservedTaskException += (_, args) =>
        {
            LogCrash("UnobservedTaskException", args.Exception);
            args.SetObserved();
        };

        Debug.WriteLine($"[Sentinel] Crash reporter initialized. Log: {LogPath}");
    }

    public static void LogCrash(string source, Exception ex)
    {
        try
        {
            var entry = $"""
            === {DateTime.UtcNow:yyyy-MM-dd HH:mm:ss UTC} ===
            Source: {source}
            Type: {ex.GetType().FullName}
            Message: {ex.Message}
            Stack: {ex.StackTrace}
            ---
            """;

            File.AppendAllText(LogPath, entry + Environment.NewLine);
            Debug.WriteLine($"[Sentinel] Crash logged: {source} — {ex.Message}");
        }
        catch
        {
            // Don't throw from the crash reporter
        }
    }

    public static string GetLogPath() => LogPath;

    public static void TrimLog()
    {
        try
        {
            if (!File.Exists(LogPath)) return;
            var info = new FileInfo(LogPath);
            // Trim if log exceeds 1MB
            if (info.Length > 1_048_576)
            {
                var lines = File.ReadAllLines(LogPath);
                var half = lines.Length / 2;
                File.WriteAllLines(LogPath, lines.Skip(half));
                Debug.WriteLine("[Sentinel] Crash log trimmed.");
            }
        }
        catch
        {
            // Ignore trim errors
        }
    }
}
