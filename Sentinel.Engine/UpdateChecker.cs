using System.Diagnostics;
using System.Net.Http;
using System.Reflection;
using System.Text.Json;

namespace Sentinel.Engine;

public class UpdateInfo
{
    public bool UpdateAvailable { get; set; }
    public string CurrentVersion { get; set; } = "";
    public string LatestVersion { get; set; } = "";
    public string DownloadUrl { get; set; } = "";
    public string ReleaseNotes { get; set; } = "";
}

public class UpdateChecker
{
    private static readonly HttpClient _httpClient = new();
    private const string GitHubOwner = "sentinel";
    private const string GitHubRepo = "sentinel";

    static UpdateChecker()
    {
        _httpClient.DefaultRequestHeaders.UserAgent.ParseAdd("Sentinel/1.0");
        _httpClient.Timeout = TimeSpan.FromSeconds(10);
    }

    public static string GetCurrentVersion()
    {
        var version = Assembly.GetExecutingAssembly().GetName().Version;
        return version != null ? $"{version.Major}.{version.Minor}.{version.Build}" : "1.0.0";
    }

    public static async Task<UpdateInfo> CheckForUpdateAsync()
    {
        var current = GetCurrentVersion();
        var info = new UpdateInfo { CurrentVersion = current, LatestVersion = current };

        try
        {
            var url = $"https://api.github.com/repos/{GitHubOwner}/{GitHubRepo}/releases/latest";
            var response = await _httpClient.GetStringAsync(url);
            using var doc = JsonDocument.Parse(response);
            var root = doc.RootElement;

            var tagName = root.GetProperty("tag_name").GetString() ?? "";
            var latestVersion = tagName.TrimStart('v', 'V');
            info.LatestVersion = latestVersion;

            if (root.TryGetProperty("html_url", out var htmlUrl))
                info.DownloadUrl = htmlUrl.GetString() ?? "";

            if (root.TryGetProperty("body", out var body))
                info.ReleaseNotes = body.GetString() ?? "";

            info.UpdateAvailable = IsNewerVersion(current, latestVersion);

            Debug.WriteLine($"[Sentinel] Update check: current={current}, latest={latestVersion}, available={info.UpdateAvailable}");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Sentinel] Update check failed: {ex.Message}");
        }

        return info;
    }

    private static bool IsNewerVersion(string current, string latest)
    {
        if (Version.TryParse(current, out var currentVer) && Version.TryParse(latest, out var latestVer))
        {
            return latestVer > currentVer;
        }
        return false;
    }
}
