using Microsoft.EntityFrameworkCore;

namespace Sentinel.Engine.Tests;

internal sealed class TestWorkspace : IDisposable
{
    private readonly string _rootPath;

    public TestWorkspace()
    {
        _rootPath = Path.Combine(
            Path.GetTempPath(),
            "Sentinel.Tests",
            Guid.NewGuid().ToString("N"));

        Directory.CreateDirectory(_rootPath);
    }

    public string DatabasePath => Path.Combine(_rootPath, "sentinel.test.db");
    public string SettingsPath => Path.Combine(_rootPath, "settings.json");

    public SentinelDbContext CreateDbContext()
    {
        return new SentinelDbContext(DatabasePath);
    }

    public DistractionRepository CreateRepository()
    {
        return new DistractionRepository(() => new SentinelDbContext(DatabasePath));
    }

    public ReportingService CreateReportingService()
    {
        return new ReportingService(() => new SentinelDbContext(DatabasePath));
    }

    public async Task ResetDatabaseAsync()
    {
        await using var db = CreateDbContext();
        await db.Database.EnsureDeletedAsync();
        await db.Database.EnsureCreatedAsync();
    }

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(_rootPath))
            {
                Directory.Delete(_rootPath, true);
            }
        }
        catch
        {
            // Temp cleanup should never fail the test run.
        }
    }
}
