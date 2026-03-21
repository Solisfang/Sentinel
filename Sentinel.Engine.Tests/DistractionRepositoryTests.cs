namespace Sentinel.Engine.Tests;

public class DistractionRepositoryTests
{
    [Fact]
    public async Task AddDistractionAsync_trims_normalizes_and_auto_maps_existing_category()
    {
        using var workspace = new TestWorkspace();
        var repository = workspace.CreateRepository();
        await repository.InitializeAsync();

        await repository.AddDistractionAsync(new Distraction
        {
            Note = "Twitter",
            CategoryName = "Social Media",
            Timestamp = DateTime.UtcNow.AddMinutes(-10),
        });

        await repository.AddDistractionAsync(new Distraction
        {
            Note = "  twitter  ",
            Timestamp = DateTime.UtcNow,
        });

        var distractions = await repository.GetDistractionsAsync();
        var latest = distractions.OrderByDescending(d => d.Timestamp).First();

        Assert.Equal("twitter", latest.Note);
        Assert.Equal("twitter", latest.NormalizedNote);
        Assert.Equal("Social Media", latest.CategoryName);
    }

    [Fact]
    public async Task AddDistractionAsync_can_skip_auto_category_mapping()
    {
        using var workspace = new TestWorkspace();
        var repository = workspace.CreateRepository();
        await repository.InitializeAsync();

        await repository.AddDistractionAsync(new Distraction
        {
            Note = "Slack",
            CategoryName = "Messaging",
            Timestamp = DateTime.UtcNow.AddMinutes(-5),
        });

        await repository.AddDistractionAsync(
            new Distraction
            {
                Note = "Slack",
                Timestamp = DateTime.UtcNow,
            },
            skipAutoCategory: true);

        var distractions = await repository.GetDistractionsAsync();
        var latest = distractions.OrderByDescending(d => d.Timestamp).First();

        Assert.Null(latest.CategoryName);
    }

    [Fact]
    public async Task InitializeAsync_backfills_normalized_notes_and_cleans_categories()
    {
        using var workspace = new TestWorkspace();
        await workspace.ResetDatabaseAsync();

        await using (var db = workspace.CreateDbContext())
        {
            db.Distractions.Add(new Distraction
            {
                Note = "  Twitter  ",
                NormalizedNote = "",
                CategoryName = "  Social Media  ",
                Timestamp = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var repository = workspace.CreateRepository();
        await repository.InitializeAsync();

        var distraction = (await repository.GetDistractionsAsync()).Single();
        Assert.Equal("twitter", distraction.NormalizedNote);
        Assert.Equal("Social Media", distraction.CategoryName);
    }

    [Fact]
    public async Task GetTaxonomyDataAsync_returns_grouped_labels_recent_entries_and_distinct_categories()
    {
        using var workspace = new TestWorkspace();
        var repository = workspace.CreateRepository();
        await repository.InitializeAsync();
        var now = DateTime.UtcNow;

        await repository.AddDistractionAsync(new Distraction
        {
            Note = "Twitter",
            CategoryName = "Social Media",
            Timestamp = now.AddMinutes(-30),
        });
        await repository.AddDistractionAsync(new Distraction
        {
            Note = "twitter",
            Timestamp = now.AddMinutes(-20),
        });
        await repository.AddDistractionAsync(new Distraction
        {
            Note = "Slack",
            CategoryName = "Messaging",
            Timestamp = now.AddMinutes(-10),
        });

        var taxonomy = await repository.GetTaxonomyDataAsync();

        Assert.Equal(3, taxonomy.RecentEntries.Count);
        Assert.Contains("Social Media", taxonomy.Categories);
        Assert.Contains("Messaging", taxonomy.Categories);

        var twitterGroup = Assert.Single(taxonomy.Groups, group => group.NormalizedNote == "twitter");
        Assert.Equal(2, twitterGroup.Count);
        Assert.Equal("Social Media", twitterGroup.CategoryName);
        Assert.Equal("twitter", twitterGroup.Note);
    }

    [Fact]
    public async Task UpdateDistractionGroupAsync_updates_all_matching_entries()
    {
        using var workspace = new TestWorkspace();
        var repository = workspace.CreateRepository();
        await repository.InitializeAsync();

        await repository.AddDistractionAsync(new Distraction
        {
            Note = "Twitter",
            CategoryName = "Social Media",
            Timestamp = DateTime.UtcNow.AddMinutes(-5),
        });
        await repository.AddDistractionAsync(new Distraction
        {
            Note = "twitter",
            Timestamp = DateTime.UtcNow,
        });

        await repository.UpdateDistractionGroupAsync("twitter", "X / Twitter", "Networks");

        var updated = await repository.GetDistractionsAsync();
        Assert.All(updated, item =>
        {
            Assert.Equal("X / Twitter", item.Note);
            Assert.Equal("x / twitter", item.NormalizedNote);
            Assert.Equal("Networks", item.CategoryName);
        });
    }

    [Fact]
    public async Task RenameCategoryAsync_updates_matching_entries_case_insensitively()
    {
        using var workspace = new TestWorkspace();
        var repository = workspace.CreateRepository();
        await repository.InitializeAsync();

        await repository.AddDistractionAsync(new Distraction
        {
            Note = "Twitter",
            CategoryName = "Social Media",
            Timestamp = DateTime.UtcNow.AddMinutes(-5),
        });
        await repository.AddDistractionAsync(new Distraction
        {
            Note = "Instagram",
            CategoryName = "social media",
            Timestamp = DateTime.UtcNow,
        });

        await repository.RenameCategoryAsync("SOCIAL MEDIA", "Networking");

        var updated = await repository.GetDistractionsAsync();
        Assert.All(updated, item => Assert.Equal("Networking", item.CategoryName));
    }

    [Fact]
    public async Task Unsynced_distractions_can_be_marked_as_synced()
    {
        using var workspace = new TestWorkspace();
        var repository = workspace.CreateRepository();
        await repository.InitializeAsync();

        await repository.AddDistractionAsync(new Distraction
        {
            Note = "YouTube",
            Timestamp = DateTime.UtcNow,
            SyncedToCloud = false,
        });

        var unsynced = await repository.GetUnsyncedDistractionsAsync();
        var distraction = Assert.Single(unsynced);

        await repository.MarkAsSyncedAsync(distraction.Id);

        var remaining = await repository.GetUnsyncedDistractionsAsync();
        Assert.Empty(remaining);
    }

    [Fact]
    public async Task Sessions_can_be_saved_and_filtered_by_since_date()
    {
        using var workspace = new TestWorkspace();
        var repository = workspace.CreateRepository();
        await repository.InitializeAsync();
        var now = DateTime.UtcNow;

        await repository.AddSessionAsync(new Session
        {
            DurationSeconds = 1500,
            StartedAt = now.AddDays(-3),
            CompletedAt = now.AddDays(-3).AddMinutes(25),
        });

        await repository.AddSessionAsync(new Session
        {
            DurationSeconds = 3000,
            StartedAt = now.AddDays(-1),
            CompletedAt = now.AddDays(-1).AddMinutes(50),
        });

        var recentSessions = await repository.GetSessionsAsync(now.AddDays(-2));

        var session = Assert.Single(recentSessions);
        Assert.Equal(3000, session.DurationSeconds);
    }
}
