namespace Sentinel.Engine.Tests;

public class UpdateCheckerTests
{
    [Theory]
    [InlineData("1.0.0", "1.0.1", true)]
    [InlineData("1.0.0", "1.1.0", true)]
    [InlineData("1.0.0", "2.0.0", true)]
    [InlineData("1.2.3", "1.2.4", true)]
    [InlineData("1.0.0", "1.0.0", false)]
    [InlineData("1.0.1", "1.0.0", false)]
    [InlineData("2.0.0", "1.9.9", false)]
    public void IsNewerVersion_compares_semver_correctly(string current, string latest, bool expected)
    {
        Assert.Equal(expected, UpdateChecker.IsNewerVersion(current, latest));
    }

    [Theory]
    [InlineData("", "1.0.0")]
    [InlineData("1.0.0", "")]
    [InlineData("not-a-version", "1.0.0")]
    [InlineData("1.0.0", "abc")]
    public void IsNewerVersion_returns_false_for_unparseable_input(string current, string latest)
    {
        Assert.False(UpdateChecker.IsNewerVersion(current, latest));
    }

    [Fact]
    public void GetCurrentVersion_returns_non_empty_string()
    {
        var version = UpdateChecker.GetCurrentVersion();
        Assert.False(string.IsNullOrWhiteSpace(version));
    }

    [Fact]
    public async Task CheckForUpdateAsync_returns_early_when_not_configured()
    {
        var info = await UpdateChecker.CheckForUpdateAsync();
        Assert.False(info.UpdateAvailable);
        Assert.Equal(info.CurrentVersion, info.LatestVersion);
    }
}
