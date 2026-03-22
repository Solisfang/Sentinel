using System.Diagnostics;
using Microsoft.EntityFrameworkCore;

namespace Sentinel.Engine;

public class DistractionRepository
{
    private readonly Func<SentinelDbContext> _contextFactory;

    public DistractionRepository(Func<SentinelDbContext>? contextFactory = null)
    {
        _contextFactory = contextFactory ?? (() => new SentinelDbContext());
    }

    public async Task InitializeAsync()
    {
        try
        {
            await using var db = _contextFactory();
            await db.Database.EnsureCreatedAsync();
            await db.Database.ExecuteSqlRawAsync("PRAGMA journal_mode=WAL;");
            await RunMigrationsAsync(db);
            Debug.WriteLine("[Sentinel] SQLite database initialized.");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Sentinel] Failed to initialize database: {ex.Message}");
        }
    }

    /// <summary>
    /// Remove distractions and sessions older than the specified number of months.
    /// Call periodically (e.g., on app startup) to keep the database bounded.
    /// </summary>
    public async Task PruneOldDataAsync(int retentionMonths)
    {
        if (retentionMonths <= 0) return;

        try
        {
            var cutoff = DateTime.UtcNow.AddMonths(-retentionMonths);
            await using var db = _contextFactory();

            var oldDistractions = await db.Distractions
                .Where(d => d.Timestamp < cutoff)
                .ToListAsync();
            var oldSessions = await db.Sessions
                .Where(s => s.StartedAt < cutoff)
                .ToListAsync();

            if (oldDistractions.Count > 0) db.Distractions.RemoveRange(oldDistractions);
            if (oldSessions.Count > 0) db.Sessions.RemoveRange(oldSessions);

            if (oldDistractions.Count > 0 || oldSessions.Count > 0)
            {
                await db.SaveChangesAsync();
                Debug.WriteLine($"[Sentinel] Pruned {oldDistractions.Count} distractions and {oldSessions.Count} sessions older than {retentionMonths} months.");
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Sentinel] Data pruning failed: {ex.Message}");
        }
    }

    public async Task AddDistractionAsync(Distraction distraction, bool skipAutoCategory = false)
    {
        await using var db = _contextFactory();

        distraction.Note = distraction.Note.Trim();
        distraction.NormalizedNote = DistractionNormalizer.Normalize(distraction.Note);
        distraction.CategoryName = CleanCategory(distraction.CategoryName);

        if (!skipAutoCategory && !distraction.IsFalseAlarm && string.IsNullOrWhiteSpace(distraction.CategoryName))
        {
            distraction.CategoryName = await db.Distractions
                .Where(d => !d.IsFalseAlarm && d.NormalizedNote == distraction.NormalizedNote && d.CategoryName != null)
                .OrderByDescending(d => d.Timestamp)
                .Select(d => d.CategoryName)
                .FirstOrDefaultAsync();
        }

        db.Distractions.Add(distraction);
        await db.SaveChangesAsync();
    }

    public async Task<List<Distraction>> GetDistractionsAsync(DateTime? since = null)
    {
        await using var db = _contextFactory();
        var query = db.Distractions.AsQueryable();

        if (since.HasValue)
            query = query.Where(d => d.Timestamp >= since.Value);

        return await query.OrderByDescending(d => d.Timestamp).ToListAsync();
    }

    public async Task<TaxonomyData> GetTaxonomyDataAsync()
    {
        await using var db = _contextFactory();

        var actualDistractions = await db.Distractions
            .Where(d => !d.IsFalseAlarm)
            .OrderByDescending(d => d.Timestamp)
            .ToListAsync();

        var recentEntries = actualDistractions
            .Take(30)
            .Select(d => new DistractionEntryDto
            {
                Id = d.Id,
                Note = d.Note,
                NormalizedNote = d.NormalizedNote,
                CategoryName = d.CategoryName,
                Timestamp = d.Timestamp
            })
            .ToList();

        var groups = actualDistractions
            .GroupBy(d => d.NormalizedNote)
            .Select(group =>
            {
                var mostRecent = group.OrderByDescending(item => item.Timestamp).First();
                return new DistractionGroupDto
                {
                    Note = mostRecent.Note,
                    NormalizedNote = group.Key,
                    CategoryName = mostRecent.CategoryName,
                    Count = group.Count(),
                    LastSeenAt = mostRecent.Timestamp
                };
            })
            .OrderByDescending(group => group.LastSeenAt)
            .ThenByDescending(group => group.Count)
            .ToList();

        var categories = actualDistractions
            .Select(d => CleanCategory(d.CategoryName))
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .Cast<string>()
            .ToList();

        return new TaxonomyData
        {
            RecentEntries = recentEntries,
            Groups = groups,
            Categories = categories
        };
    }

    public async Task UpdateDistractionGroupAsync(string normalizedNote, string note, string? categoryName)
    {
        var cleanNote = note.Trim();
        var cleanNormalized = DistractionNormalizer.Normalize(cleanNote);
        var cleanCategory = CleanCategory(categoryName);

        await using var db = _contextFactory();

        var matches = await db.Distractions
            .Where(d => !d.IsFalseAlarm && d.NormalizedNote == normalizedNote)
            .ToListAsync();

        foreach (var match in matches)
        {
            match.Note = cleanNote;
            match.NormalizedNote = cleanNormalized;
            match.CategoryName = cleanCategory;
        }

        await db.SaveChangesAsync();
    }

    public async Task RenameCategoryAsync(string oldName, string newName)
    {
        var cleanOld = CleanCategory(oldName);
        var cleanNew = CleanCategory(newName);

        if (string.IsNullOrWhiteSpace(cleanOld) || string.IsNullOrWhiteSpace(cleanNew))
        {
            return;
        }

        await using var db = _contextFactory();

        var matches = await db.Distractions
            .Where(d => d.CategoryName != null)
            .ToListAsync();

        foreach (var match in matches.Where(d =>
                     string.Equals(d.CategoryName, cleanOld, StringComparison.OrdinalIgnoreCase)))
        {
            match.CategoryName = cleanNew;
        }

        await db.SaveChangesAsync();
    }

    public async Task AddSessionAsync(Session session)
    {
        await using var db = _contextFactory();
        db.Sessions.Add(session);
        await db.SaveChangesAsync();
    }

    public async Task<List<Session>> GetSessionsAsync(DateTime? since = null)
    {
        await using var db = _contextFactory();
        var query = db.Sessions.AsQueryable();

        if (since.HasValue)
            query = query.Where(s => s.StartedAt >= since.Value);

        return await query.OrderByDescending(s => s.StartedAt).ToListAsync();
    }

    private static string? CleanCategory(string? categoryName)
    {
        var trimmed = categoryName?.Trim();
        return string.IsNullOrWhiteSpace(trimmed) ? null : trimmed;
    }

    // --- Versioned schema migrations ---
    // Each migration runs exactly once, tracked via the _schema_version table.

    private static async Task RunMigrationsAsync(SentinelDbContext db)
    {
        // Create version tracking table if it doesn't exist
        await db.Database.ExecuteSqlRawAsync(
            "CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY);");

        var currentVersion = await GetSchemaVersionAsync(db);

        if (currentVersion < 1)
        {
            // Migration 1: Add NormalizedNote and CategoryName columns (may already exist from old ALTER TABLE)
            if (!await ColumnExistsAsync(db, "Distractions", "NormalizedNote"))
                await db.Database.ExecuteSqlRawAsync(
                    "ALTER TABLE Distractions ADD COLUMN NormalizedNote TEXT NOT NULL DEFAULT '';");

            if (!await ColumnExistsAsync(db, "Distractions", "CategoryName"))
                await db.Database.ExecuteSqlRawAsync(
                    "ALTER TABLE Distractions ADD COLUMN CategoryName TEXT NULL;");

            // Backfill NormalizedNote and clean categories for any existing rows
            var distractions = await db.Distractions.ToListAsync();
            var changed = false;
            foreach (var d in distractions)
            {
                var normalized = DistractionNormalizer.Normalize(d.Note);
                if (!string.Equals(d.NormalizedNote, normalized, StringComparison.Ordinal))
                {
                    d.NormalizedNote = normalized;
                    changed = true;
                }

                var cleanCat = CleanCategory(d.CategoryName);
                if (!string.Equals(d.CategoryName, cleanCat, StringComparison.Ordinal))
                {
                    d.CategoryName = cleanCat;
                    changed = true;
                }
            }
            if (changed) await db.SaveChangesAsync();

            await SetSchemaVersionAsync(db, 1);
            Debug.WriteLine("[Sentinel] Migration 1 applied: NormalizedNote + CategoryName + backfill.");
        }

        if (currentVersion < 2)
        {
            // Migration 2: Add indexes for query performance
            await db.Database.ExecuteSqlRawAsync(
                "CREATE INDEX IF NOT EXISTS IX_Distractions_NormalizedNote ON Distractions(NormalizedNote);");
            await db.Database.ExecuteSqlRawAsync(
                "CREATE INDEX IF NOT EXISTS IX_Distractions_Timestamp ON Distractions(Timestamp);");
            await db.Database.ExecuteSqlRawAsync(
                "CREATE INDEX IF NOT EXISTS IX_Distractions_CategoryName ON Distractions(CategoryName);");
            await db.Database.ExecuteSqlRawAsync(
                "CREATE INDEX IF NOT EXISTS IX_Sessions_StartedAt ON Sessions(StartedAt);");

            await SetSchemaVersionAsync(db, 2);
            Debug.WriteLine("[Sentinel] Migration 2 applied: indexes on Distractions + Sessions.");
        }

        if (currentVersion < 3)
        {
            // Migration 3: Drop the unused SyncedToCloud column
            // SQLite doesn't support DROP COLUMN before 3.35.0, so we just leave it and ignore it.
            // The column is no longer in the EF model, so EF won't read/write it.
            await SetSchemaVersionAsync(db, 3);
            Debug.WriteLine("[Sentinel] Migration 3 applied: SyncedToCloud deprecated (ignored by EF).");
        }

        if (currentVersion < 4)
        {
            // Migration 4: Add SessionName column to Sessions table
            if (!await ColumnExistsAsync(db, "Sessions", "SessionName"))
                await db.Database.ExecuteSqlRawAsync(
                    "ALTER TABLE Sessions ADD COLUMN SessionName TEXT NULL;");

            await SetSchemaVersionAsync(db, 4);
            Debug.WriteLine("[Sentinel] Migration 4 applied: SessionName column added to Sessions.");
        }

        if (currentVersion < 5)
        {
            // Migration 5: Add IsFalseAlarm to Distractions and CompletedAt to Sessions
            if (!await ColumnExistsAsync(db, "Distractions", "IsFalseAlarm"))
                await db.Database.ExecuteSqlRawAsync(
                    "ALTER TABLE Distractions ADD COLUMN IsFalseAlarm INTEGER NOT NULL DEFAULT 0;");

            if (!await ColumnExistsAsync(db, "Sessions", "CompletedAt"))
                await db.Database.ExecuteSqlRawAsync(
                    "ALTER TABLE Sessions ADD COLUMN CompletedAt TEXT NULL;");

            await SetSchemaVersionAsync(db, 5);
            Debug.WriteLine("[Sentinel] Migration 5 applied: IsFalseAlarm + CompletedAt columns.");
        }

        if (currentVersion < 6)
        {
            // Migration 6: Add EndedEarly flag to Sessions
            if (!await ColumnExistsAsync(db, "Sessions", "EndedEarly"))
                await db.Database.ExecuteSqlRawAsync(
                    "ALTER TABLE Sessions ADD COLUMN EndedEarly INTEGER NOT NULL DEFAULT 0;");

            await SetSchemaVersionAsync(db, 6);
            Debug.WriteLine("[Sentinel] Migration 6 applied: EndedEarly column on Sessions.");
        }
    }

    private static async Task<int> GetSchemaVersionAsync(SentinelDbContext db)
    {
        try
        {
            var connection = db.Database.GetDbConnection();
            if (connection.State != System.Data.ConnectionState.Open)
                await connection.OpenAsync();

            await using var cmd = connection.CreateCommand();
            cmd.CommandText = "SELECT MAX(version) FROM _schema_version;";
            var result = await cmd.ExecuteScalarAsync();
            return result is DBNull or null ? 0 : Convert.ToInt32(result);
        }
        catch (Exception ex)
        {
            SentinelLog.Warn($"Failed to get schema version: {ex.Message}");
            return 0;
        }
    }

    private static async Task SetSchemaVersionAsync(SentinelDbContext db, int version)
    {
        await db.Database.ExecuteSqlAsync(
            $"INSERT OR REPLACE INTO _schema_version(version) VALUES ({version})");
    }

    private static async Task<bool> ColumnExistsAsync(
        SentinelDbContext db,
        string tableName,
        string columnName)
    {
        var connection = db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
        {
            await connection.OpenAsync();
        }

        await using var command = connection.CreateCommand();
        command.CommandText = $"PRAGMA table_info({tableName});";

        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var existingColumn = reader["name"]?.ToString();
            if (string.Equals(existingColumn, columnName, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }
}
