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

            // Only suppress known recoverable exceptions. Let fatal ones crash the app
            // so the user knows something went seriously wrong.
            if (args.Exception is InvalidOperationException
                or TimeoutException
                or System.Net.Http.HttpRequestException
                or System.IO.IOException)
            {
                args.Handled = true;
            }
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
        LogCrash(LogPath, source, ex);
    }

    internal static void LogCrash(string path, string source, Exception ex)
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

            File.AppendAllText(path, entry + Environment.NewLine);
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
        TrimLog(LogPath);
    }

    internal static void TrimLog(string path)
    {
        try
        {
            if (!File.Exists(path)) return;
            var info = new FileInfo(path);
            // Trim if log exceeds 1MB
            if (info.Length > 1_048_576)
            {
                var lines = File.ReadAllLines(path);
                var half = lines.Length / 2;
                File.WriteAllLines(path, lines.Skip(half));
                Debug.WriteLine("[Sentinel] Crash log trimmed.");
            }
        }
        catch
        {
            // Ignore trim errors
        }
    }
}
