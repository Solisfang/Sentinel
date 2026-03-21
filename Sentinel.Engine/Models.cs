namespace Sentinel.Engine;

public static class DistractionNormalizer
{
    public static string Normalize(string? note)
    {
        return (note ?? string.Empty).Trim().ToLowerInvariant();
    }
}

public class Distraction
{
    public int Id { get; set; }
    public string Note { get; set; } = string.Empty;
    public string NormalizedNote { get; set; } = string.Empty;
    public string? CategoryName { get; set; }
    public DateTime Timestamp { get; set; }
    public bool IsFalseAlarm { get; set; }
    public bool SyncedToCloud { get; set; }
}

public class Session
{
    public int Id { get; set; }
    public int DurationSeconds { get; set; }
    public DateTime StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? SessionName { get; set; }
    public bool SyncedToCloud { get; set; }
}

public class TaxonomyData
{
    public List<DistractionEntryDto> RecentEntries { get; set; } = [];
    public List<DistractionGroupDto> Groups { get; set; } = [];
    public List<string> Categories { get; set; } = [];
}

public class DistractionEntryDto
{
    public int Id { get; set; }
    public string Note { get; set; } = string.Empty;
    public string NormalizedNote { get; set; } = string.Empty;
    public string? CategoryName { get; set; }
    public DateTime Timestamp { get; set; }
}

public class DistractionGroupDto
{
    public string Note { get; set; } = string.Empty;
    public string NormalizedNote { get; set; } = string.Empty;
    public string? CategoryName { get; set; }
    public int Count { get; set; }
    public DateTime LastSeenAt { get; set; }
}
