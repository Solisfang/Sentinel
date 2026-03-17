namespace Sentinel.Engine;

public class Distraction
{
    public int Id { get; set; }
    public string Note { get; set; } = string.Empty;
    public DateTime Timestamp { get; set; }
    public bool SyncedToCloud { get; set; }
}

public class Session
{
    public int Id { get; set; }
    public int DurationSeconds { get; set; }
    public DateTime StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public bool SyncedToCloud { get; set; }
}
