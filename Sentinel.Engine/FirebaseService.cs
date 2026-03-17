using System.Diagnostics;
using System.IO;
using FirebaseAdmin;
using FirebaseAdmin.Auth;
using Google.Apis.Auth.OAuth2;
using Google.Cloud.Firestore;

namespace Sentinel.Engine;

public static class FirebaseService
{
    public static async Task InitializeAsync()
    {
        try
        {
            InitializeFirebaseApp();
            await TestAuthConnectivity();
            await TestFirestoreConnectivity();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Sentinel] Firebase initialization failed: {ex.Message}");
            Debug.WriteLine("[Sentinel] The app will continue in local-only mode.");
        }
    }

    private static void InitializeFirebaseApp()
    {
        string credentialPath = GetCredentialPath();

        if (!File.Exists(credentialPath))
        {
            Debug.WriteLine($"[Sentinel] Firebase credentials not found at: {credentialPath}");
            Debug.WriteLine("[Sentinel] To enable Firebase, place your service account JSON at the path above.");
            throw new FileNotFoundException("Firebase service account JSON not found.", credentialPath);
        }

        if (FirebaseApp.DefaultInstance == null)
        {
#pragma warning disable CS0618 // GoogleCredential.FromJson is deprecated but CredentialFactory replacement is not yet stable
            FirebaseApp.Create(new AppOptions
            {
                Credential = GoogleCredential.FromJson(File.ReadAllText(credentialPath))
            });
#pragma warning restore CS0618
            Debug.WriteLine("[Sentinel] FirebaseApp created successfully.");
        }
    }

    private static async Task TestAuthConnectivity()
    {
        // Verify Firebase Auth is accessible by listing users (page size 1)
        var auth = FirebaseAuth.DefaultInstance;
        var pagedEnumerable = auth.ListUsersAsync(null);
        var enumerator = pagedEnumerable.GetAsyncEnumerator();

        // Just test that we can reach the Auth service — we don't need actual results
        try
        {
            await enumerator.MoveNextAsync();
        }
        catch (Exception ex) when (ex.Message.Contains("NOT_FOUND") || ex.Message.Contains("PERMISSION_DENIED"))
        {
            // Auth is reachable but may have no users or restricted permissions — that's fine
        }
        finally
        {
            await enumerator.DisposeAsync();
        }

        Debug.WriteLine("[Sentinel] Firebase Auth connectivity: OK");
    }

    private static async Task TestFirestoreConnectivity()
    {
        var projectId = FirebaseApp.DefaultInstance.Options.ProjectId;

        if (string.IsNullOrEmpty(projectId))
        {
            Debug.WriteLine("[Sentinel] Firebase project ID not found in credentials. Skipping Firestore test.");
            return;
        }

        var db = FirestoreDb.Create(projectId);

        // Test connectivity by reading a non-existent doc (fast, no writes)
        var docRef = db.Collection("_sentinel_health").Document("ping");
        var snapshot = await docRef.GetSnapshotAsync();

        Debug.WriteLine($"[Sentinel] Firestore connectivity: OK (project: {projectId})");
    }

    private static string GetCredentialPath()
    {
        // Check environment variable first, then fall back to a file next to the executable
        var envPath = Environment.GetEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS");
        if (!string.IsNullOrEmpty(envPath))
            return envPath;

        return Path.Combine(AppContext.BaseDirectory, "firebase-service-account.json");
    }
}
