using System.Diagnostics;
using System.IO;

namespace Sentinel.Engine;

/// <summary>
/// Lightweight file logger that writes to %LocalAppData%/Sentinel/logs/sentinel.log 
/// in all build configurations. Replaces Debug.WriteLine for production visibility.
/// </summary>
public static class SentinelLog
{
    private static readonly string LogPath;
    private static readonly object Lock = new();

    static SentinelLog()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var logDir = Path.Combine(appData, "Sentinel", "logs");
        Directory.CreateDirectory(logDir);
        LogPath = Path.Combine(logDir, "sentinel.log");
    }

    public static void Info(string message)
    {
        Write("INFO", message);
    }

    public static void Warn(string message)
    {
        Write("WARN", message);
    }

    public static void Error(string message, Exception? ex = null)
    {
        var detail = ex?.InnerException != null
            ? $"{ex.GetType().Name}: {ex.Message} → {ex.InnerException.GetType().Name}: {ex.InnerException.Message}"
            : ex != null ? $"{ex.GetType().Name}: {ex.Message}" : "";
        var text = detail.Length > 0 ? $"{message} — {detail}" : message;
        Write("ERROR", text);
    }

    private static void Write(string level, string message)
    {
        var line = $"{DateTime.UtcNow:yyyy-MM-dd HH:mm:ss} [{level}] {message}";

        Debug.WriteLine($"[Sentinel] {message}");

        try
        {
            lock (Lock)
            {
                File.AppendAllText(LogPath, line + Environment.NewLine);
            }
        }
        catch
        {
            // Never throw from the logger
        }
    }

    public static string GetLogPath() => LogPath;

    /// <summary>Trim the log file if it exceeds 2 MB, keeping the second half.</summary>
    public static void TrimIfNeeded()
    {
        try
        {
            if (!File.Exists(LogPath)) return;
            var info = new FileInfo(LogPath);
            if (info.Length > 2_097_152) // 2 MB
            {
                lock (Lock)
                {
                    var lines = File.ReadAllLines(LogPath);
                    File.WriteAllLines(LogPath, lines.Skip(lines.Length / 2));
                }
            }
        }
        catch
        {
            // Ignore trim errors
        }
    }
}
