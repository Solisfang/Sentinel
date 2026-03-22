using System.IO;
using System.Text.Json;

namespace Sentinel.Engine;

public class AppSettings
{
    public int PomodoroMinutes { get; set; } = 25;
    public int ShortBreakMinutes { get; set; } = 5;
    public int LongBreakMinutes { get; set; } = 15;
    public int IdleThresholdSeconds { get; set; } = 45;
    public bool CloudSyncEnabled { get; set; } = false;
    public bool SoundEnabled { get; set; } = true;
    public bool AlwaysOnTop { get; set; } = false;
    public bool SuppressDuringMedia { get; set; } = true;
    public int DailyFocusGoalMinutes { get; set; } = 120;
    public string OverlayStyle { get; set; } = "compact";
    public double WindowLeft { get; set; } = -1;
    public double WindowTop { get; set; } = -1;
    public int DataRetentionMonths { get; set; } = 0;
}

public class SettingsService
{
    private static readonly string SettingsFolder;
    private static readonly string SettingsPath;

    static SettingsService()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        SettingsFolder = Path.Combine(appData, "Sentinel");
        SettingsPath = Path.Combine(SettingsFolder, "settings.json");
        Directory.CreateDirectory(SettingsFolder);
    }

    public static AppSettings Load()
    {
        return LoadFromPath(SettingsPath);
    }

    public static AppSettings LoadFromPath(string settingsPath)
    {
        try
        {
            if (File.Exists(settingsPath))
            {
                var json = File.ReadAllText(settingsPath);
                return JsonSerializer.Deserialize<AppSettings>(json) ?? new AppSettings();
            }
        }
        catch
        {
            // Return defaults on any error
        }
        return new AppSettings();
    }

    public static void Save(AppSettings settings)
    {
        SaveToPath(settings, SettingsPath);
    }

    public static void SaveToPath(AppSettings settings, string settingsPath)
    {
        var directory = Path.GetDirectoryName(settingsPath);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var json = JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(settingsPath, json);
    }
}
