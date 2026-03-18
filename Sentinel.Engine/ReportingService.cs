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
    public List<DistractionCategory> TopDistractions { get; set; } = [];
    public List<SessionEntry> RecentSessions { get; set; } = [];
}

public class DailyFocus
{
    public string Date { get; set; } = "";
    public int FocusSeconds { get; set; }
    public int Sessions { get; set; }
    public int Distractions { get; set; }
}

public class DistractionCategory
{
    public string Name { get; set; } = "";
    public int Count { get; set; }
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
            var actualDistractions = distractions.Where(d => !d.IsFalseAlarm).ToList();

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

            // Daily focus for last 7 days
            var startDate = DateTime.UtcNow.Date.AddDays(-6);
            for (int i = 0; i < 7; i++)
            {
                var day = startDate.AddDays(i);
                var nextDay = day.AddDays(1);
                var daySessions = completedSessions.Where(s => s.StartedAt >= day && s.StartedAt < nextDay).ToList();
                var dayDistractions = actualDistractions.Where(d => d.Timestamp >= day && d.Timestamp < nextDay).Count();

                report.DailyFocus.Add(new DailyFocus
                {
                    Date = day.ToString("MM/dd"),
                    FocusSeconds = daySessions.Sum(s => s.DurationSeconds),
                    Sessions = daySessions.Count,
                    Distractions = dayDistractions
                });
            }

            // Top distraction categories
            report.TopDistractions = actualDistractions
                .GroupBy(d => d.Note.ToLowerInvariant().Trim())
                .Select(g => new DistractionCategory { Name = g.Key, Count = g.Count() })
                .OrderByDescending(c => c.Count)
                .Take(6)
                .ToList();

            // Recent sessions (last 20)
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

            Debug.WriteLine($"[Sentinel] Report generated: {report.SessionsCompleted} sessions, {report.DistractionsLogged} distractions");
            return report;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Sentinel] Report generation failed: {ex.Message}");
            return new ReportData();
        }
    }
}
