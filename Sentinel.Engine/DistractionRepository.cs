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
            await EnsureSchemaAsync(db);
            await BackfillNormalizedNotesAsync(db);
            Debug.WriteLine("[Sentinel] SQLite database initialized.");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Sentinel] Failed to initialize database: {ex.Message}");
        }
    }

    public async Task AddDistractionAsync(Distraction distraction, bool skipAutoCategory = false)
    {
        await using var db = _contextFactory();
        await EnsureSchemaAsync(db);

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
        await EnsureSchemaAsync(db);

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
        await EnsureSchemaAsync(db);

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
        await EnsureSchemaAsync(db);

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

    public async Task<List<Distraction>> GetUnsyncedDistractionsAsync()
    {
        await using var db = _contextFactory();
        return await db.Distractions
            .Where(d => !d.SyncedToCloud)
            .ToListAsync();
    }

    public async Task MarkAsSyncedAsync(int distractionId)
    {
        await using var db = _contextFactory();
        var distraction = await db.Distractions.FindAsync(distractionId);
        if (distraction != null)
        {
            distraction.SyncedToCloud = true;
            await db.SaveChangesAsync();
        }
    }

    private static async Task EnsureSchemaAsync(SentinelDbContext db)
    {
        if (!await ColumnExistsAsync(db, "Distractions", "NormalizedNote"))
        {
            await db.Database.ExecuteSqlRawAsync(
                "ALTER TABLE Distractions ADD COLUMN NormalizedNote TEXT NOT NULL DEFAULT '';");
        }

        if (!await ColumnExistsAsync(db, "Distractions", "CategoryName"))
        {
            await db.Database.ExecuteSqlRawAsync(
                "ALTER TABLE Distractions ADD COLUMN CategoryName TEXT NULL;");
        }
    }

    private static async Task BackfillNormalizedNotesAsync(SentinelDbContext db)
    {
        var distractions = await db.Distractions.ToListAsync();
        var changed = false;

        foreach (var distraction in distractions)
        {
            var normalized = DistractionNormalizer.Normalize(distraction.Note);
            if (!string.Equals(distraction.NormalizedNote, normalized, StringComparison.Ordinal))
            {
                distraction.NormalizedNote = normalized;
                changed = true;
            }

            var cleanCategory = CleanCategory(distraction.CategoryName);
            if (!string.Equals(distraction.CategoryName, cleanCategory, StringComparison.Ordinal))
            {
                distraction.CategoryName = cleanCategory;
                changed = true;
            }
        }

        if (changed)
        {
            await db.SaveChangesAsync();
        }
    }

    private static string? CleanCategory(string? categoryName)
    {
        var trimmed = categoryName?.Trim();
        return string.IsNullOrWhiteSpace(trimmed) ? null : trimmed;
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
