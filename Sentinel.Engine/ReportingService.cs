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
}

public class ReportingService
{
    public async Task<ReportData> GetReportDataAsync(DateTime since)
    {
        try
        {
            await using var db = new SentinelDbContext();

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

            var startDate = DateTime.UtcNow.Date.AddDays(-6);
            for (var i = 0; i < 7; i++)
            {
                var day = startDate.AddDays(i);
                var nextDay = day.AddDays(1);
                var daySessions = completedSessions.Where(s => s.StartedAt >= day && s.StartedAt < nextDay).ToList();
                var dayDistractions = actualDistractions.Count(d => d.Timestamp >= day && d.Timestamp < nextDay);

                report.DailyFocus.Add(new DailyFocus
                {
                    Date = day.ToString("MM/dd"),
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
                .Select(s => new SessionEntry
                {
                    StartedAt = s.StartedAt,
                    DurationSeconds = s.DurationSeconds,
                    Completed = s.CompletedAt.HasValue
                })
                .ToList();

            Debug.WriteLine(
                $"[Sentinel] Report generated: {report.SessionsCompleted} sessions, {report.DistractionsLogged} distractions");
            return report;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Sentinel] Report generation failed: {ex.Message}");
            return new ReportData();
        }
    }
}
