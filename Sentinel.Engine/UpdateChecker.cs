using System.Diagnostics;
using System.IO;
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
    // TODO: Set these to the actual GitHub repository before release
    private const string GitHubOwner = "";
    private const string GitHubRepo = "";

    private static readonly string CachePath;
    private static readonly TimeSpan CacheDuration = TimeSpan.FromHours(24);

    static UpdateChecker()
    {
        _httpClient.DefaultRequestHeaders.UserAgent.ParseAdd("Sentinel/1.0");
        _httpClient.Timeout = TimeSpan.FromSeconds(10);

        var appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        CachePath = Path.Combine(appData, "Sentinel", "update-check.json");
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
            if (string.IsNullOrEmpty(GitHubOwner) || string.IsNullOrEmpty(GitHubRepo))
            {
                Debug.WriteLine("[Sentinel] Update checker disabled — no GitHub repository configured.");
                return info;
            }

            // Return cached result if it's less than 24 hours old
            var cached = ReadCache();
            if (cached != null)
            {
                Debug.WriteLine("[Sentinel] Using cached update check result.");
                return cached;
            }

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

            WriteCache(info);
            Debug.WriteLine($"[Sentinel] Update check: current={current}, latest={latestVersion}, available={info.UpdateAvailable}");
        }
        catch (Exception ex)
        {
            SentinelLog.Warn($"Update check failed: {ex.Message}");
        }

        return info;
    }

    internal static bool IsNewerVersion(string current, string latest)
    {
        if (Version.TryParse(current, out var currentVer) && Version.TryParse(latest, out var latestVer))
        {
            return latestVer > currentVer;
        }
        return false;
    }

    private static UpdateInfo? ReadCache()
    {
        try
        {
            if (!File.Exists(CachePath)) return null;
            var fileInfo = new FileInfo(CachePath);
            if (DateTime.UtcNow - fileInfo.LastWriteTimeUtc > CacheDuration) return null;

            var json = File.ReadAllText(CachePath);
            return JsonSerializer.Deserialize<UpdateInfo>(json);
        }
        catch
        {
            return null;
        }
    }

    private static void WriteCache(UpdateInfo info)
    {
        try
        {
            var dir = Path.GetDirectoryName(CachePath);
            if (dir != null) Directory.CreateDirectory(dir);
            File.WriteAllText(CachePath, JsonSerializer.Serialize(info));
        }
        catch
        {
            // Non-critical — just skip caching
        }
    }
}
