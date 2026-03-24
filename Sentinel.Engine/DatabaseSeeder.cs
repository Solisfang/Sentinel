using Microsoft.EntityFrameworkCore;

namespace Sentinel.Engine;

/// <summary>
/// Populates the local database with realistic sample data so the UI can be
/// explored and tested without running real focus sessions.
/// Safe to call multiple times: will do nothing if ≥10 sessions already exist.
/// </summary>
public class DatabaseSeeder
{
    private readonly Func<SentinelDbContext> _contextFactory;

    public DatabaseSeeder(Func<SentinelDbContext>? contextFactory = null)
    {
        _contextFactory = contextFactory ?? (() => new SentinelDbContext());
    }

    public async Task<SeedResult> SeedAsync()
    {
        await using var db = _contextFactory();

        var existingSessions = await db.Sessions.CountAsync();
        if (existingSessions >= 10)
            return new SeedResult { AlreadySeeded = true };

        var rng = new Random(42); // deterministic — same data every time
        var now = DateTime.UtcNow;

        // ── Distraction templates (note, category) ────────────────────────────
        var templates = new (string Note, string? Category)[]
        {
            ("checking twitter",    "Social Media"),
            ("instagram scroll",    "Social Media"),
            ("linkedin feed",       "Social Media"),
            ("facebook",            "Social Media"),
            ("checking email",      "Email"),
            ("gmail inbox",         "Email"),
            ("newsletter",          "Email"),
            ("slack messages",      "Messaging"),
            ("whatsapp",            "Messaging"),
            ("discord",             "Messaging"),
            ("telegram",            "Messaging"),
            ("hacker news",         "News"),
            ("reading article",     "News"),
            ("reddit",              "Entertainment"),
            ("youtube video",       "YouTube"),
            ("podcast tab",         "Entertainment"),
            ("online shopping",     "Shopping"),
            ("amazon browsing",     "Shopping"),
            ("phone notification",  null),
            ("random browsing",     null),
        };

        var sessionLabels = new string?[]
        {
            null, null, null,
            "Deep coding", "Deep coding",
            "PR review",
            "Design work",
            "Planning",
            "Documentation",
            "Bug investigation",
        };

        var sessions    = new List<Session>();
        var distractions = new List<Distraction>();

        // ── Generate 30 days of history ───────────────────────────────────────
        for (var daysAgo = 29; daysAgo >= 0; daysAgo--)
        {
            var localDay = DateTime.Today.AddDays(-daysAgo);
            var dayUtc   = localDay.ToUniversalTime();

            // Fewer sessions on weekends
            if (localDay.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday
                && rng.NextDouble() > 0.45) continue;

            // 1–4 sessions per working day
            var count = rng.Next(1, 5);
            var hour  = 9; // first session around 9 AM

            for (var s = 0; s < count; s++)
            {
                hour += rng.Next(1, 3);
                if (hour > 18) break;

                // Duration: 15 m sprint, standard 25 m × 3, or 50 m deep-work
                var durationMin = new[] { 15, 25, 25, 25, 50 }[rng.Next(5)];
                var durationSec = durationMin * 60;

                var endedEarly = rng.NextDouble() < 0.12;
                if (endedEarly)
                    durationSec = rng.Next(4 * 60, durationMin * 60 - 60);

                var startedAt = dayUtc.AddHours(hour).AddMinutes(rng.Next(0, 55));

                sessions.Add(new Session
                {
                    DurationSeconds = durationSec,
                    StartedAt       = startedAt,
                    CompletedAt     = startedAt.AddSeconds(durationSec),
                    SessionName     = sessionLabels[rng.Next(sessionLabels.Length)],
                    EndedEarly      = endedEarly,
                });

                // 0–4 distractions per session
                var dCount = rng.Next(0, 5);
                for (var d = 0; d < dCount; d++)
                {
                    if (durationSec < 90) break; // skip for very short sessions
                    var offsetSec = rng.Next(30, durationSec - 30);

                    if (rng.NextDouble() < 0.10) // ~10 % false alarms
                    {
                        distractions.Add(new Distraction
                        {
                            Note           = "False Alarm",
                            NormalizedNote = DistractionNormalizer.Normalize("False Alarm"),
                            Timestamp      = startedAt.AddSeconds(offsetSec),
                            IsFalseAlarm   = true,
                        });
                    }
                    else
                    {
                        var (note, category) = templates[rng.Next(templates.Length)];
                        distractions.Add(new Distraction
                        {
                            Note           = note,
                            NormalizedNote = DistractionNormalizer.Normalize(note),
                            CategoryName   = category,
                            Timestamp      = startedAt.AddSeconds(offsetSec),
                        });
                    }
                }
            }
        }

        db.Sessions.AddRange(sessions);
        db.Distractions.AddRange(distractions);
        await db.SaveChangesAsync();

        SentinelLog.Info(
            $"Seed complete: {sessions.Count} sessions, {distractions.Count} distractions inserted.");

        return new SeedResult
        {
            SessionsAdded     = sessions.Count,
            DistractionsAdded = distractions.Count,
        };
    }
}

public class SeedResult
{
    public bool AlreadySeeded     { get; set; }
    public int  SessionsAdded     { get; set; }
    public int  DistractionsAdded { get; set; }
}
