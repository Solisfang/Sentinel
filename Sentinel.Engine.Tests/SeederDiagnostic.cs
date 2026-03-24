using Xunit;
using Xunit.Abstractions;

namespace Sentinel.Engine.Tests;

public class SeederDiagnostic
{
    private readonly ITestOutputHelper _output;

    public SeederDiagnostic(ITestOutputHelper output)
    {
        _output = output;
    }

    [Fact]
    public async Task DiagnoseSeederFailure()
    {
        // Use the real production DB to reproduce the error
        var dbPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Sentinel", "sentinel.db");

        _output.WriteLine($"DB path: {dbPath}");
        _output.WriteLine($"Exists: {File.Exists(dbPath)}");

        if (!File.Exists(dbPath))
        {
            _output.WriteLine("No DB file — nothing to diagnose.");
            return;
        }

        // Query the DB schema directly
        var factory = () => new SentinelDbContext(dbPath);
        await using var db = factory();

        var conn = db.Database.GetDbConnection();
        await conn.OpenAsync();

        // List tables
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;";
        await using var reader = await cmd.ExecuteReaderAsync();
        _output.WriteLine("Tables:");
        while (await reader.ReadAsync())
            _output.WriteLine($"  {reader.GetString(0)}");
        await reader.CloseAsync();

        // List columns on Sessions
        await using var cmd2 = conn.CreateCommand();
        cmd2.CommandText = "PRAGMA table_info(Sessions);";
        await using var reader2 = await cmd2.ExecuteReaderAsync();
        _output.WriteLine("\nSessions columns:");
        while (await reader2.ReadAsync())
            _output.WriteLine($"  {reader2.GetString(1)} ({reader2.GetString(2)})");
        await reader2.CloseAsync();

        // List columns on Distractions
        await using var cmd3 = conn.CreateCommand();
        cmd3.CommandText = "PRAGMA table_info(Distractions);";
        await using var reader3 = await cmd3.ExecuteReaderAsync();
        _output.WriteLine("\nDistractions columns:");
        while (await reader3.ReadAsync())
            _output.WriteLine($"  {reader3.GetString(1)} ({reader3.GetString(2)})");
        await reader3.CloseAsync();

        // Count rows
        await using var cmd4 = conn.CreateCommand();
        cmd4.CommandText = "SELECT (SELECT COUNT(*) FROM Sessions), (SELECT COUNT(*) FROM Distractions);";
        await using var reader4 = await cmd4.ExecuteReaderAsync();
        if (await reader4.ReadAsync())
            _output.WriteLine($"\nSessions: {reader4.GetInt32(0)}, Distractions: {reader4.GetInt32(1)}");
        await reader4.CloseAsync();

        // Schema version
        try
        {
            await using var cmd5 = conn.CreateCommand();
            cmd5.CommandText = "SELECT MAX(version) FROM _schema_version;";
            var ver = await cmd5.ExecuteScalarAsync();
            _output.WriteLine($"Schema version: {ver}");
        }
        catch (Exception ex)
        {
            _output.WriteLine($"Schema version error: {ex.Message}");
        }

        // Now try seeding and catch the full exception chain
        try
        {
            var seeder = new DatabaseSeeder(factory);
            var result = await seeder.SeedAsync();
            _output.WriteLine($"\nSeed result: AlreadySeeded={result.AlreadySeeded}, Sessions={result.SessionsAdded}, Distractions={result.DistractionsAdded}");
        }
        catch (Exception ex)
        {
            _output.WriteLine($"\nSEED FAILED:");
            _output.WriteLine($"  Type: {ex.GetType().FullName}");
            _output.WriteLine($"  Message: {ex.Message}");
            if (ex.InnerException != null)
            {
                _output.WriteLine($"  Inner Type: {ex.InnerException.GetType().FullName}");
                _output.WriteLine($"  Inner Message: {ex.InnerException.Message}");
            }
            _output.WriteLine($"  Stack: {ex.StackTrace}");
        }
    }
}
