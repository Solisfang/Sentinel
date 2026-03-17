using System.IO;
using Microsoft.EntityFrameworkCore;

namespace Sentinel.Engine;

public class SentinelDbContext : DbContext
{
    public DbSet<Distraction> Distractions => Set<Distraction>();
    public DbSet<Session> Sessions => Set<Session>();

    private readonly string _dbPath;

    public SentinelDbContext()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var sentinelFolder = Path.Combine(appData, "Sentinel");
        Directory.CreateDirectory(sentinelFolder);
        _dbPath = Path.Combine(sentinelFolder, "sentinel.db");
    }

    protected override void OnConfiguring(DbContextOptionsBuilder options)
    {
        options.UseSqlite($"Data Source={_dbPath}");
    }
}
