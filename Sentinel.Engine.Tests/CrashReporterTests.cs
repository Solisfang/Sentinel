namespace Sentinel.Engine.Tests;

public class CrashReporterTests
{
    [Fact]
    public void LogCrash_writes_entry_to_specified_path()
    {
        var path = Path.Combine(Path.GetTempPath(), $"sentinel_test_{Guid.NewGuid():N}.log");

        try
        {
            CrashReporter.LogCrash(path, "TestSource", new InvalidOperationException("test error"));

            var content = File.ReadAllText(path);
            Assert.Contains("TestSource", content);
            Assert.Contains("test error", content);
            Assert.Contains("InvalidOperationException", content);
        }
        finally
        {
            if (File.Exists(path)) File.Delete(path);
        }
    }

    [Fact]
    public void LogCrash_appends_multiple_entries()
    {
        var path = Path.Combine(Path.GetTempPath(), $"sentinel_test_{Guid.NewGuid():N}.log");

        try
        {
            CrashReporter.LogCrash(path, "First", new Exception("one"));
            CrashReporter.LogCrash(path, "Second", new Exception("two"));

            var content = File.ReadAllText(path);
            Assert.Contains("First", content);
            Assert.Contains("Second", content);
        }
        finally
        {
            if (File.Exists(path)) File.Delete(path);
        }
    }

    [Fact]
    public void TrimLog_does_nothing_when_file_is_missing()
    {
        var path = Path.Combine(Path.GetTempPath(), $"sentinel_test_{Guid.NewGuid():N}.log");
        // Should not throw
        CrashReporter.TrimLog(path);
        Assert.False(File.Exists(path));
    }

    [Fact]
    public void TrimLog_does_nothing_when_file_is_small()
    {
        var path = Path.Combine(Path.GetTempPath(), $"sentinel_test_{Guid.NewGuid():N}.log");

        try
        {
            File.WriteAllText(path, "small log content");
            var sizeBefore = new FileInfo(path).Length;

            CrashReporter.TrimLog(path);

            Assert.Equal(sizeBefore, new FileInfo(path).Length);
        }
        finally
        {
            if (File.Exists(path)) File.Delete(path);
        }
    }

    [Fact]
    public void TrimLog_trims_file_exceeding_1MB()
    {
        var path = Path.Combine(Path.GetTempPath(), $"sentinel_test_{Guid.NewGuid():N}.log");

        try
        {
            // Write > 1MB of log lines
            var lines = new string[20_000];
            for (var i = 0; i < lines.Length; i++)
            {
                lines[i] = $"=== Line {i} === {new string('x', 60)}";
            }
            File.WriteAllLines(path, lines);
            Assert.True(new FileInfo(path).Length > 1_048_576);

            CrashReporter.TrimLog(path);

            var trimmed = File.ReadAllLines(path);
            Assert.True(trimmed.Length < lines.Length);
            Assert.Equal(lines.Length / 2, trimmed.Length);
        }
        finally
        {
            if (File.Exists(path)) File.Delete(path);
        }
    }

    [Fact]
    public void GetLogPath_returns_non_empty_path()
    {
        var logPath = CrashReporter.GetLogPath();
        Assert.False(string.IsNullOrWhiteSpace(logPath));
        Assert.EndsWith(".log", logPath);
    }
}
