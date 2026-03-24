using System.Diagnostics;
using Microsoft.EntityFrameworkCore;

namespace Sentinel.Engine;

public class ReportData
{
    public int TotalFocusSeconds { get; set; }
    public int SessionsCompleted { get; set; }
    public int DistractionsLogged { get; set; }
    public int FalseAlarms { get; set; }
    public double AvgSessionSeconds { get; set; }
    public List<DailyFocus> DailyFocus { get; set; } = [];
    public List<ReportBreakdownItem> TopCategories { get; set; } = [];
    public List<ReportBreakdownItem> TopDistractions { get; set; } = [];
    public List<SessionEntry> RecentSessions { get; set; } = [];
}

public class DailyFocus
{
    public string Date { get; set; } = "";
    public int FocusSeconds { get; set; }
    public int Sessions { get; set; }
    public int Distractions { get; set; }
}

public class ReportBreakdownItem
{
    public string Name { get; set; } = "";
    public int Count { get; set; }
    public string? CategoryName { get; set; }
}

public class SessionEntry
{
    public DateTime StartedAt { get; set; }
    public int DurationSeconds { get; set; }
    public bool Completed { get; set; }
    public bool EndedEarly { get; set; }
    public string? SessionName { get; set; }
    public DateTime? CompletedAt { get; set; }
    public int DistractionsCount { get; set; }
    public int FalseAlarmCount { get; set; }
}

public class ReportingService
{
    private readonly Func<SentinelDbContext> _contextFactory;

    public ReportingService(Func<SentinelDbContext>? contextFactory = null)
    {
        _contextFactory = contextFactory ?? (() => new SentinelDbContext());
    }

    public async Task<ReportData> GetReportDataAsync(DateTime since)
    {
        try
        {
            await using var db = _contextFactory();

            var sessions = await db.Sessions
                .Where(s => s.StartedAt >= since)
                .ToListAsync();

            var distractions = await db.Distractions
                .Where(d => d.Timestamp >= since)
                .ToListAsync();

            var completedSessions = sessions.Where(s => s.CompletedAt.HasValue).ToList();
            var actualDistractions = distractions
                .Where(d => !d.IsFalseAlarm && !string.IsNullOrWhiteSpace(d.NormalizedNote))
                .ToList();

            var report = new ReportData
            {
                TotalFocusSeconds = completedSessions.Sum(s => s.DurationSeconds),
                SessionsCompleted = completedSessions.Count,
                DistractionsLogged = actualDistractions.Count,
                FalseAlarms = distractions.Count(d => d.IsFalseAlarm),
                AvgSessionSeconds = completedSessions.Count > 0
                    ? completedSessions.Average(s => s.DurationSeconds)
                    : 0,
            };

            // Use local calendar days so each bar on the chart matches what the user
            // considers a day, regardless of their UTC offset.
            var startDate = DateTime.Today.AddDays(-6);
            for (var i = 0; i < 7; i++)
            {
                var localDay = startDate.AddDays(i);
                var localNextDay = localDay.AddDays(1);
                // Convert local midnight boundaries to UTC for comparison with stored UTC timestamps.
                var dayUtc = localDay.ToUniversalTime();
                var nextDayUtc = localNextDay.ToUniversalTime();

                var daySessions = completedSessions
                    .Where(s => s.StartedAt >= dayUtc && s.StartedAt < nextDayUtc)
                    .ToList();
                var dayDistractions = actualDistractions
                    .Count(d => d.Timestamp >= dayUtc && d.Timestamp < nextDayUtc);

                report.DailyFocus.Add(new DailyFocus
                {
                    Date = localDay.ToString("MM/dd"),
                    FocusSeconds = daySessions.Sum(s => s.DurationSeconds),
                    Sessions = daySessions.Count,
                    Distractions = dayDistractions
                });
            }

            report.TopCategories = actualDistractions
                .GroupBy(d => string.IsNullOrWhiteSpace(d.CategoryName) ? "Uncategorized" : d.CategoryName!.Trim())
                .Select(group => new ReportBreakdownItem
                {
                    Name = group.Key,
                    Count = group.Count()
                })
                .OrderByDescending(item => item.Count)
                .ThenBy(item => item.Name)
                .Take(6)
                .ToList();

            report.TopDistractions = actualDistractions
                .GroupBy(d => d.NormalizedNote)
                .Select(group =>
                {
                    var mostRecent = group.OrderByDescending(item => item.Timestamp).First();
                    return new ReportBreakdownItem
                    {
                        Name = mostRecent.Note,
                        Count = group.Count(),
                        CategoryName = mostRecent.CategoryName
                    };
                })
                .OrderByDescending(item => item.Count)
                .ThenBy(item => item.Name)
                .Take(8)
                .ToList();

            report.RecentSessions = sessions
                .OrderByDescending(s => s.StartedAt)
                .Take(20)
                .Select(s =>
                {
                    var sessionEnd = s.CompletedAt ?? s.StartedAt.AddSeconds(s.DurationSeconds);
                    var sessionDistractions = distractions
                        .Where(d => d.Timestamp >= s.StartedAt && d.Timestamp <= sessionEnd)
                        .ToList();

                    return new SessionEntry
                    {
                        StartedAt = s.StartedAt,
                        DurationSeconds = s.DurationSeconds,
                        Completed = s.CompletedAt.HasValue,
                        EndedEarly = s.EndedEarly,
                        SessionName = s.SessionName,
                        CompletedAt = s.CompletedAt,
                        DistractionsCount = sessionDistractions.Count(d => !d.IsFalseAlarm),
                        FalseAlarmCount = sessionDistractions.Count(d => d.IsFalseAlarm),
                    };
                })
                .ToList();

            Debug.WriteLine(
                $"[Sentinel] Report generated: {report.SessionsCompleted} sessions, {report.DistractionsLogged} distractions");
            return report;
        }
        catch (Exception ex)
        {
            SentinelLog.Error($"Report generation failed", ex);
            return new ReportData();
        }
    }
}
