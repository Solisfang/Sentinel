namespace Sentinel.Engine.Tests;

public class DistractionNormalizerTests
{
    [Theory]
    [InlineData("  Twitter  ", "twitter")]
    [InlineData("INSTAGRAM", "instagram")]
    [InlineData(null, "")]
    [InlineData("", "")]
    public void Normalize_trims_and_lowercases_notes(string? note, string expected)
    {
        Assert.Equal(expected, DistractionNormalizer.Normalize(note));
    }
}
