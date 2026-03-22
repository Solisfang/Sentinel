namespace Sentinel.Engine.Tests;

public class ReportingServiceTests
{
    [Fact]
    public async Task GetReportDataAsync_aggregates_sessions_distractions_and_breakdowns()
    {
        using var workspace = new TestWorkspace();
        var repository = workspace.CreateRepository();
        var reporting = workspace.CreateReportingService();
        await repository.InitializeAsync();

        var now = DateTime.UtcNow.Date.AddHours(10);

        await repository.AddSessionAsync(new Session
        {
            DurationSeconds = 1500,
            StartedAt = now.AddDays(-1),
            CompletedAt = now.AddDays(-1).AddMinutes(25),
            SessionName = "Deep Work",
        });
        await repository.AddSessionAsync(new Session
        {
            DurationSeconds = 3000,
            StartedAt = now.AddDays(-2),
            CompletedAt = now.AddDays(-2).AddMinutes(50),
            SessionName = "Sprint",
        });
        await repository.AddSessionAsync(new Session
        {
            DurationSeconds = 900,
            StartedAt = now.AddHours(-2),
            CompletedAt = null,
            SessionName = "Interrupted",
        });

        await repository.AddDistractionAsync(new Distraction
        {
            Note = "Twitter",
            CategoryName = "Social Media",
            Timestamp = now.AddDays(-1),
        });
        await repository.AddDistractionAsync(new Distraction
        {
            Note = "twitter",
            Timestamp = now.AddDays(-1).AddMinutes(15),
        });
        await repository.AddDistractionAsync(new Distraction
        {
            Note = "Slack",
            CategoryName = "Messaging",
            Timestamp = now.AddDays(-2),
        });
        await repository.AddDistractionAsync(new Distraction
        {
            Note = "False Alarm",
            Timestamp = now.AddDays(-2).AddMinutes(5),
            IsFalseAlarm = true,
        });

        var report = await reporting.GetReportDataAsync(now.AddDays(-7));

        Assert.Equal(4500, report.TotalFocusSeconds);
        Assert.Equal(2, report.SessionsCompleted);
        Assert.Equal(3, report.DistractionsLogged);
        Assert.Equal(1, report.FalseAlarms);
        Assert.Equal(2250, report.AvgSessionSeconds);
        Assert.Equal(7, report.DailyFocus.Count);
        Assert.Equal(4500, report.DailyFocus.Sum(day => day.FocusSeconds));

        Assert.Contains(report.TopCategories, item => item.Name == "Social Media" && item.Count == 2);
        Assert.Contains(report.TopCategories, item => item.Name == "Messaging" && item.Count == 1);

        var topDistraction = Assert.Single(report.TopDistractions, item => item.Name == "twitter");
        Assert.Equal(2, topDistraction.Count);
        Assert.Equal("Social Media", topDistraction.CategoryName);

        Assert.Equal(3, report.RecentSessions.Count);
        Assert.False(report.RecentSessions.First().Completed);
    }

    [Fact]
    public async Task GetReportDataAsync_returns_zeroes_with_empty_database()
    {
        using var workspace = new TestWorkspace();
        var repository = workspace.CreateRepository();
        var reporting = workspace.CreateReportingService();
        await repository.InitializeAsync();

        var report = await reporting.GetReportDataAsync(DateTime.UtcNow.AddDays(-7));

        Assert.Equal(0, report.TotalFocusSeconds);
        Assert.Equal(0, report.SessionsCompleted);
        Assert.Equal(0, report.DistractionsLogged);
        Assert.Equal(0, report.FalseAlarms);
        Assert.Equal(0, report.AvgSessionSeconds);
        Assert.Equal(7, report.DailyFocus.Count);
        Assert.Empty(report.TopCategories);
        Assert.Empty(report.TopDistractions);
        Assert.Empty(report.RecentSessions);
    }
}
