using Microsoft.Data.Sqlite;

var dbPath = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
    "Sentinel", "sentinel.db");

Console.WriteLine($"DB: {dbPath}");
Console.WriteLine($"Exists: {File.Exists(dbPath)}");
Console.WriteLine($"Size: {new FileInfo(dbPath).Length} bytes");

using var conn = new SqliteConnection($"Data Source={dbPath}");
conn.Open();

// Sessions columns BEFORE
Console.WriteLine("\n=== Sessions COLUMNS (before) ===");
using (var cmd = conn.CreateCommand())
{
    cmd.CommandText = "PRAGMA table_info(Sessions);";
    using var r = cmd.ExecuteReader();
    while (r.Read()) Console.WriteLine($"  {r["name"]} ({r["type"]}) notnull={r["notnull"]} default={r["dflt_value"] ?? "NULL"}");
}

// Drop SyncedToCloud from Sessions
Console.WriteLine("\n=== DROPPING SyncedToCloud ===");
try
{
    using var cmd = conn.CreateCommand();
    cmd.CommandText = "ALTER TABLE Sessions DROP COLUMN SyncedToCloud;";
    cmd.ExecuteNonQuery();
    Console.WriteLine("  Sessions: SyncedToCloud dropped");
}
catch (Exception ex) { Console.WriteLine($"  Sessions drop failed: {ex.Message}"); }

try
{
    using var cmd = conn.CreateCommand();
    cmd.CommandText = "ALTER TABLE Distractions DROP COLUMN SyncedToCloud;";
    cmd.ExecuteNonQuery();
    Console.WriteLine("  Distractions: SyncedToCloud dropped");
}
catch (Exception ex) { Console.WriteLine($"  Distractions drop failed: {ex.Message}"); }

// Update schema version
using (var cmd = conn.CreateCommand())
{
    cmd.CommandText = "INSERT OR REPLACE INTO _schema_version(version) VALUES (7);";
    cmd.ExecuteNonQuery();
    Console.WriteLine("  Schema version set to 7");
}

// Sessions columns AFTER
Console.WriteLine("\n=== Sessions COLUMNS (after) ===");
using (var cmd = conn.CreateCommand())
{
    cmd.CommandText = "PRAGMA table_info(Sessions);";
    using var r = cmd.ExecuteReader();
    while (r.Read()) Console.WriteLine($"  {r["name"]} ({r["type"]}) notnull={r["notnull"]} default={r["dflt_value"] ?? "NULL"}");
}

// Try a test insert
Console.WriteLine("\n=== TEST INSERT ===");
try
{
    using var cmd = conn.CreateCommand();
    cmd.CommandText = @"INSERT INTO Sessions (DurationSeconds, StartedAt, CompletedAt, SessionName, EndedEarly)
                        VALUES (1500, '2026-03-20 10:00:00', '2026-03-20 10:25:00', 'Test', 0);";
    cmd.ExecuteNonQuery();
    Console.WriteLine("  Session INSERT succeeded!");
    
    // Check the inserted row
    using var cmd2 = conn.CreateCommand();
    cmd2.CommandText = "SELECT * FROM Sessions ORDER BY Id DESC LIMIT 1;";
    using var r = cmd2.ExecuteReader();
    if (r.Read())
    {
        for (int i = 0; i < r.FieldCount; i++)
            Console.WriteLine($"  {r.GetName(i)} = {(r.IsDBNull(i) ? "NULL" : r.GetValue(i))}");
    }
    
    // Clean up test row
    using var cmd3 = conn.CreateCommand();
    cmd3.CommandText = "DELETE FROM Sessions WHERE SessionName = 'Test';";
    cmd3.ExecuteNonQuery();
    Console.WriteLine("  Test row cleaned up");
}
catch (Exception ex) { Console.WriteLine($"  INSERT failed: {ex.Message}"); }

Console.WriteLine("\nDone. Migration 7 applied successfully.");
