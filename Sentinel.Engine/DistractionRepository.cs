using System.Diagnostics;
using Microsoft.EntityFrameworkCore;

namespace Sentinel.Engine;

public class DistractionRepository
{
    public async Task InitializeAsync()
    {
        try
        {
            await using var db = new SentinelDbContext();
            await db.Database.EnsureCreatedAsync();
            Debug.WriteLine("[Sentinel] SQLite database initialized.");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Sentinel] Failed to initialize database: {ex.Message}");
        }
    }

    public async Task AddDistractionAsync(Distraction distraction)
    {
        await using var db = new SentinelDbContext();
        db.Distractions.Add(distraction);
        await db.SaveChangesAsync();
    }

    public async Task<List<Distraction>> GetDistractionsAsync(DateTime? since = null)
    {
        await using var db = new SentinelDbContext();
        var query = db.Distractions.AsQueryable();

        if (since.HasValue)
            query = query.Where(d => d.Timestamp >= since.Value);

        return await query.OrderByDescending(d => d.Timestamp).ToListAsync();
    }

    public async Task AddSessionAsync(Session session)
    {
        await using var db = new SentinelDbContext();
        db.Sessions.Add(session);
        await db.SaveChangesAsync();
    }

    public async Task<List<Session>> GetSessionsAsync(DateTime? since = null)
    {
        await using var db = new SentinelDbContext();
        var query = db.Sessions.AsQueryable();

        if (since.HasValue)
            query = query.Where(s => s.StartedAt >= since.Value);

        return await query.OrderByDescending(s => s.StartedAt).ToListAsync();
    }

    public async Task<List<Distraction>> GetUnsyncedDistractionsAsync()
    {
        await using var db = new SentinelDbContext();
        return await db.Distractions
            .Where(d => !d.SyncedToCloud)
            .ToListAsync();
    }

    public async Task MarkAsSyncedAsync(int distractionId)
    {
        await using var db = new SentinelDbContext();
        var distraction = await db.Distractions.FindAsync(distractionId);
        if (distraction != null)
        {
            distraction.SyncedToCloud = true;
            await db.SaveChangesAsync();
        }
    }
}
