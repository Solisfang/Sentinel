namespace Sentinel.Engine.Tests;

public class SettingsServiceTests
{
    [Fact]
    public void SaveToPath_and_LoadFromPath_round_trip_settings()
    {
        using var workspace = new TestWorkspace();
        var settings = new AppSettings
        {
            PomodoroMinutes = 50,
            ShortBreakMinutes = 10,
            LongBreakMinutes = 20,
            IdleThresholdSeconds = 90,
            CloudSyncEnabled = true,
            SoundEnabled = false,
            AlwaysOnTop = false,
            SuppressDuringMedia = false,
            DailyFocusGoalMinutes = 180,
            WindowLeft = 120,
            WindowTop = 240,
        };

        SettingsService.SaveToPath(settings, workspace.SettingsPath);
        var loaded = SettingsService.LoadFromPath(workspace.SettingsPath);

        Assert.Equal(settings.PomodoroMinutes, loaded.PomodoroMinutes);
        Assert.Equal(settings.ShortBreakMinutes, loaded.ShortBreakMinutes);
        Assert.Equal(settings.LongBreakMinutes, loaded.LongBreakMinutes);
        Assert.Equal(settings.IdleThresholdSeconds, loaded.IdleThresholdSeconds);
        Assert.Equal(settings.CloudSyncEnabled, loaded.CloudSyncEnabled);
        Assert.Equal(settings.SoundEnabled, loaded.SoundEnabled);
        Assert.Equal(settings.AlwaysOnTop, loaded.AlwaysOnTop);
        Assert.Equal(settings.SuppressDuringMedia, loaded.SuppressDuringMedia);
        Assert.Equal(settings.DailyFocusGoalMinutes, loaded.DailyFocusGoalMinutes);
        Assert.Equal(settings.WindowLeft, loaded.WindowLeft);
        Assert.Equal(settings.WindowTop, loaded.WindowTop);
    }

    [Fact]
    public void LoadFromPath_returns_defaults_when_file_is_missing_or_invalid()
    {
        using var workspace = new TestWorkspace();

        var missing = SettingsService.LoadFromPath(workspace.SettingsPath);
        Assert.Equal(25, missing.PomodoroMinutes);

        File.WriteAllText(workspace.SettingsPath, "{ not valid json");
        var invalid = SettingsService.LoadFromPath(workspace.SettingsPath);

        Assert.Equal(25, invalid.PomodoroMinutes);
        Assert.Equal(45, invalid.IdleThresholdSeconds);
        Assert.False(invalid.AlwaysOnTop);
    }
}
