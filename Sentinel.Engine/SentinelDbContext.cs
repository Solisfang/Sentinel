using System.IO;
using Microsoft.EntityFrameworkCore;

namespace Sentinel.Engine;

public class SentinelDbContext : DbContext
{
    public DbSet<Distraction> Distractions => Set<Distraction>();
    public DbSet<Session> Sessions => Set<Session>();

    private readonly string? _dbPath;

    public SentinelDbContext()
    {
        _dbPath = GetDefaultDatabasePath();
    }

    public SentinelDbContext(string dbPath)
    {
        _dbPath = EnsureDatabaseDirectory(dbPath);
    }

    public SentinelDbContext(DbContextOptions<SentinelDbContext> options) : base(options)
    {
    }

    protected override void OnConfiguring(DbContextOptionsBuilder options)
    {
        if (options.IsConfigured)
        {
            return;
        }

        options.UseSqlite($"Data Source={_dbPath ?? GetDefaultDatabasePath()}");
    }

    private static string GetDefaultDatabasePath()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var sentinelFolder = Path.Combine(appData, "Sentinel");
        Directory.CreateDirectory(sentinelFolder);
        return Path.Combine(sentinelFolder, "sentinel.db");
    }

    private static string EnsureDatabaseDirectory(string dbPath)
    {
        var directory = Path.GetDirectoryName(dbPath);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }

        return dbPath;
    }
}
