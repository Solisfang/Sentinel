## 7. Firebase Hybrid Sync Architecture

This section specifies the complete data synchronization strategy for the target Sentinel application. The architecture is "hybrid" because it uses two fundamentally different persistence paths — Standard Persistence (read-write documents) and the Secure Event Ledger (append-only immutable events) — unified under Firestore's native offline-first model. Every architectural decision maps to the directive from TARGET_ARCHITECTURE.md §5:

> The application utilizes a two-pronged approach to offline data handling via Firestore:
> - **Standard Persistence:** User Settings, Planner schedules, and Distraction Taxonomy definitions use Firestore's native offline persistence.
> - **The Event Ledger (Secure Sync):** Focus sessions and distractions DO NOT update a unified "state" document locally. Instead, the Angular app writes immutable event objects to an append-only `session_events` Firestore collection.

**Source architecture summary (what we're replacing):**

The source React application (`Sentinel.UI\src\App.tsx`, `Sentinel.UI\src\firebase.ts`) implements a rudimentary cloud sync with:
1. `enableIndexedDbPersistence(db)` called on startup for offline caching.
2. `syncSessionToFirestore()` — writes a flat `sessions` document with `{ userId, duration, distractions[], completedAt: serverTimestamp() }` to a global `sessions` collection. Uses an in-memory `pendingSyncsRef` retry queue.
3. `submitDistraction()` — writes a flat `distractions` document with `{ userId, note, categoryName, timestamp: serverTimestamp() }` to a global `distractions` collection. No retry queue (fire-and-forget).
4. `fetchFirestoreHistory()` — reads from both flat collections, merges cloud counts with local SQLite report data using `Math.max()`.
5. Firestore security rules enforce `userId == request.auth.uid` on flat global collections.

**Target architecture changes:**

| Aspect | Source | Target |
|---|---|---|
| Collection layout | Flat global (`sessions/{id}`, `distractions/{id}`) with `userId` field | User-scoped subcollections (`users/{uid}/session_events/{id}`) |
| Write model | Mutable state documents (sessions, distractions) | Append-only immutable events (Event Ledger) |
| Retry queue | In-memory `pendingSyncsRef` (lost on app restart) | Firestore's native offline write queue (persisted in IndexedDB) |
| Server timestamps | `serverTimestamp()` (null offline) | Client ISO 8601 strings (always available offline) |
| Report data source | SQLite local + Firestore merge via `Math.max()` | Firestore only — server-computed aggregates + event queries |
| Security model | `userId` field matching (`resource.data.userId == request.auth.uid`) | Subcollection path matching (`request.auth.uid == uid`) + write-only rules |
| Taxonomy storage | Implicit in SQLite `Distractions` table | Explicit Firestore documents (`users/{uid}/taxonomy/{normalizedNote}`) |
| Settings sync | Not synced to Firestore | Dual persistence: local `settings.json` + Firestore `users/{uid}/settings` |

---

### 7.1. Optimistic Offline Strategy

Sentinel operates on an **Optimistic Offline** basis (TARGET_ARCHITECTURE.md §1): "functioning flawlessly without internet access." The app never blocks on network availability. All Firestore writes are optimistic — they succeed locally immediately and sync to the server when connectivity is restored. All reads prioritize the local IndexedDB cache and only fetch from the server when the cache is stale or empty.

#### 7.1.1. Firestore `enableIndexedDbPersistence` Configuration

**Source implementation** (`Sentinel.UI\src\firebase.ts`, lines 22–32):

```typescript
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    console.warn('[Sentinel] Firestore persistence unavailable (multi-tab).');
  } else if (err.code === 'unimplemented') {
    console.warn('[Sentinel] Firestore persistence unsupported in this environment.');
  }
});
```

**Target implementation** (`src/app/core/firebase.provider.ts`):

The Angular target uses the modular Firebase SDK (v10+). Firestore offline persistence is configured during application bootstrap via `provideFirebaseApp` and `provideFirestore` from `@angular/fire`:

```typescript
// File: src/app/core/firebase.provider.ts

import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideFirestore, getFirestore, enableIndexedDbPersistence } from '@angular/fire/firestore';
import { provideAuth, getAuth } from '@angular/fire/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyC6luPajDSMU1FyH5prC-LQgFtvj3JLdxE',
  authDomain: 'sentinel-s073.firebaseapp.com',
  projectId: 'sentinel-s073',
  storageBucket: 'sentinel-s073.firebasestorage.app',
  messagingSenderId: '173114633978',
  appId: '1:173114633978:web:7cdc2cf8a4a0067a67e343',
};

export const firebaseProviders = [
  provideFirebaseApp(() => initializeApp(firebaseConfig)),
  provideFirestore(() => {
    const firestore = getFirestore();
    enableIndexedDbPersistence(firestore).catch((err) => {
      if (err.code === 'failed-precondition') {
        console.warn('[Sentinel] Firestore persistence unavailable (multi-tab).');
      } else if (err.code === 'unimplemented') {
        console.warn('[Sentinel] Firestore persistence unsupported in this environment.');
      }
    });
    return firestore;
  }),
  provideAuth(() => getAuth()),
];
```

**Bootstrap integration** (`src/app/app.config.ts`):

```typescript
// File: src/app/app.config.ts

import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { firebaseProviders } from './core/firebase.provider';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    ...firebaseProviders,
  ],
};
```

**What `enableIndexedDbPersistence` does:**

1. Creates an IndexedDB database in the Photino embedded Chromium process.
2. Caches all Firestore documents that the app reads or writes.
3. When the app writes a document while offline, Firestore queues the write in IndexedDB and applies it to the local cache immediately (optimistic write).
4. When network connectivity is restored, Firestore automatically flushes the offline write queue to the server.
5. If the app reads a collection or document while offline, Firestore returns results from the IndexedDB cache.

**Differences from `enableMultiTabIndexedDbPersistence`:**

Sentinel runs inside a single Photino window — there is never a multi-tab scenario. The single-tab `enableIndexedDbPersistence` is used. If `failed-precondition` fires (multiple instances of Sentinel running simultaneously), the second instance operates without offline persistence (writes still work but aren't cached locally for offline reads).

**IndexedDB storage location:**

The IndexedDB database is stored by the Photino Chromium engine at:
```
%LOCALAPPDATA%\Sentinel\chromium-data\Default\IndexedDB\
```

This is separate from the C# `settings.json` file at `%LOCALAPPDATA%\Sentinel\settings.json`. Both persist independently.

#### 7.1.2. Offline Write Queue & Automatic Sync on Reconnect

**Source behavior (problems being fixed):**

The source React app uses a manual in-memory retry queue (`pendingSyncsRef`):

```typescript
// Source: Sentinel.UI\src\App.tsx, lines 136–166

const pendingSyncsRef = useRef<Array<{
  duration: number;
  distractions: string[];
  completedAt: Date;
}>>([]);

const syncSessionToFirestore = useCallback(async () => {
  if (!user || !settings.cloudSyncEnabled) return;

  pendingSyncsRef.current.push({
    duration: settings.pomodoroMinutes * 60,
    distractions: distractions.map((item) => item.note),
    completedAt: new Date(),
  });

  const pending = [...pendingSyncsRef.current];
  const failed: typeof pending = [];

  for (const session of pending) {
    try {
      await addDoc(collection(db, 'sessions'), {
        userId: user.uid,
        duration: session.duration,
        distractions: session.distractions,
        completedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('[Sentinel] Sync failed, will retry:', error);
      failed.push(session);
    }
  }

  pendingSyncsRef.current = failed;
}, [user, settings, distractions]);
```

**Problems:**

1. **Data loss on restart:** `pendingSyncsRef` is a React `useRef` — it's lost when the app closes or crashes. If a session fails to sync and the user closes Sentinel, that session is permanently lost from the cloud.
2. **No retry trigger:** Failed syncs are only retried when the NEXT session completes (because `syncSessionToFirestore` is only called on session completion). There is no periodic retry or network-restored trigger.
3. **Server timestamps break offline:** `serverTimestamp()` resolves to `null` in the local IndexedDB cache until the document syncs to the server. This means offline reads of pending documents return `null` for the timestamp field.
4. **Fire-and-forget distractions:** The `submitDistraction()` function has no retry queue at all — if the Firestore write fails, the distraction is only in SQLite.

**Target behavior (how Firestore's native queue replaces `pendingSyncsRef`):**

In the target architecture, there is **NO manual retry queue**. Firestore's `enableIndexedDbPersistence` handles everything:

1. When Angular calls `addDoc()` to write an Event Ledger event, Firestore immediately:
   - Writes the document to the local IndexedDB cache.
   - Returns a resolved `Promise` with the document reference (the write "succeeds" instantly).
   - Enqueues the write for server sync in IndexedDB.
2. If the network is available, the write is flushed to the server within milliseconds.
3. If the network is unavailable, the write remains in the IndexedDB queue indefinitely. Firestore retries automatically when connectivity is restored — even across app restarts, because the queue is persisted in IndexedDB.
4. If the write fails permanently (e.g., security rule rejection), the document is removed from the local cache and an error is surfaced via the `onSnapshot` listener (if active).

**Angular service implementation (no retry queue needed):**

```typescript
// File: src/app/core/event-ledger.service.ts

import { Injectable, inject } from '@angular/core';
import { Firestore, collection, addDoc } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import type { SessionEvent } from './models';

@Injectable({ providedIn: 'root' })
export class EventLedgerService {
  private firestore = inject(Firestore);
  private authService = inject(AuthService);

  /**
   * Write an event to the append-only Event Ledger.
   *
   * This method is fire-and-forget in terms of network sync.
   * Firestore's IndexedDB persistence guarantees the write is
   * durably queued even if the network is unavailable or the
   * app restarts before the write reaches the server.
   *
   * Returns the auto-generated Firestore document ID, or null
   * if the user is not authenticated (events are silently dropped
   * for unauthenticated users — they can still use the timer
   * locally without cloud persistence).
   */
  async writeEvent<T extends Record<string, unknown>>(
    event: SessionEvent<T>,
  ): Promise<string | null> {
    const uid = this.authService.uid;
    if (!uid) return null;

    const colRef = collection(this.firestore, `users/${uid}/session_events`);
    const docRef = await addDoc(colRef, {
      type: event.type,
      sessionId: event.sessionId,
      timestamp: event.timestamp,
      payload: event.payload,
    });

    return docRef.id;
  }
}
```

**Migration note:** The `pendingSyncsRef` pattern is **completely eliminated**. The 4 lines of `useRef` + the 30-line `syncSessionToFirestore` callback + the retry loop are ALL replaced by Firestore's built-in offline queue. The Angular `EventLedgerService.writeEvent()` is a single `addDoc()` call — no try/catch retry logic needed.

#### 7.1.3. Conflict Resolution: Last-Write-Wins for Settings, Append-Only for Events

The two persistence paths have fundamentally different conflict semantics:

**Standard Persistence (Settings, Planner, Taxonomy) — Last-Write-Wins:**

Firestore's default conflict resolution for single-document writes is Last-Write-Wins (LWW). When two devices write to the same document (e.g., `users/{uid}/settings`) while both are offline, the last write to reach the server wins. This is acceptable for settings because:

1. Settings changes are infrequent and user-intentional.
2. The `updatedAt` timestamp lets the UI show which device last modified settings.
3. There's no way to "merge" conflicting settings changes (e.g., if Device A sets `pomodoroMinutes: 30` and Device B sets `pomodoroMinutes: 40`, there's no meaningful merge — one must win).

**Sequence diagram — Settings conflict with LWW:**

```
┌──────────┐           ┌──────────┐           ┌──────────┐
│ Device A  │           │ Device B  │           │ Firestore │
└────┬─────┘           └────┬─────┘           └────┬─────┘
     │                      │                      │
     │  updateDoc(settings,  │                      │
     │  pomodoroMinutes: 30) │                      │
     │───────────┐          │                      │
     │           │ (offline) │                      │
     │           │          │  updateDoc(settings,  │
     │           │          │  pomodoroMinutes: 40) │
     │           │          │───────────┐          │
     │           │          │           │ (offline) │
     │           │          │           │          │
     │  ── comes online ──  │           │          │
     │──────────────────────┼──────────────────────▶│ pomodoroMinutes: 30
     │           │          │           │          │
     │           │          │  ── comes online ──  │
     │           │          │──────────────────────▶│ pomodoroMinutes: 40 (WINS)
     │           │          │           │          │
     │◀─────────────────────┼──────────────────────│ snapshot: 40
     │           │          │◀─────────────────────│ snapshot: 40
```

**Secure Event Ledger — No Conflicts (Append-Only):**

Event Ledger documents are append-only. Every event has a unique auto-generated document ID (`addDoc()`). There is no update or overwrite — each event is a new document. This means:

1. Two devices can log events simultaneously with zero conflict risk.
2. Offline events from Device A and Device B both sync to the server independently.
3. Cloud Functions process each event individually via `onDocumentCreated` triggers.
4. Event ordering is determined by the client-issued `timestamp` field, not by Firestore server arrival order.

**Sequence diagram — Event Ledger with no conflicts:**

```
┌──────────┐           ┌──────────┐           ┌──────────┐
│ Device A  │           │ Device B  │           │ Firestore │
└────┬─────┘           └────┬─────┘           └────┬─────┘
     │                      │                      │
     │  addDoc(TimerStarted,│                      │
     │  sessionId: "aaa")   │                      │
     │───────────┐          │                      │
     │           │ (offline) │                      │
     │           │          │  addDoc(TimerStarted, │
     │           │          │  sessionId: "bbb")   │
     │           │          │───────────┐          │
     │           │          │           │ (offline) │
     │           │          │           │          │
     │  ── comes online ──  │           │          │
     │──────────────────────┼──────────────────────▶│ event "aaa" created
     │           │          │  ── comes online ──  │
     │           │          │──────────────────────▶│ event "bbb" created
     │           │          │           │          │
     │  Both events coexist — no conflict.         │
```

---

### 7.2. Standard Persistence Path (Settings, Planner, Taxonomy)

Standard Persistence covers three document types that use Firestore's native read-write-delete operations. These documents are mutable — the client can create, read, update, and delete them. They are NOT part of the Event Ledger.

**Standard Persistence documents:**

| Firestore Path | Document Type | Schema Reference |
|---|---|---|
| `users/{uid}/settings` | Single document | → §6.2.1.1 |
| `users/{uid}/planner_blocks/{blockId}` | Subcollection | → §6.2.1.2 |
| `users/{uid}/taxonomy/{normalizedNote}` | Subcollection | → §6.2.1.3 |

#### 7.2.1. Direct Firestore Document Writes from Angular Services

Each Standard Persistence document type has a dedicated Angular service that encapsulates all Firestore operations. The services use `@angular/fire` wrappers around the modular Firebase SDK.

**Settings write flow:**

```
User changes setting in SettingsComponent
  → SettingsService.updateSetting(key, value)
    → IPC: SAVE_SETTINGS (to C# shell for local settings.json persistence)
    → Firestore: updateDoc(users/{uid}/settings, { [key]: value, updatedAt: now })
       → IndexedDB: write cached locally immediately
       → Server: synced when network available
```

**Angular `SettingsService` (target) — Firestore write:**

```typescript
// File: src/app/core/settings.service.ts

import { Injectable, inject, signal, computed } from '@angular/core';
import { Firestore, doc, setDoc, onSnapshot } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { IpcService } from './ipc.service';
import type { Settings } from './models';
import { defaultSettings } from './models';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private firestore = inject(Firestore);
  private authService = inject(AuthService);
  private ipcService = inject(IpcService);

  /** Reactive settings signal — components read from this. */
  readonly settings = signal<Settings>({ ...defaultSettings });

  /**
   * Initialize: load settings from C# shell (local settings.json),
   * then attach Firestore snapshot listener if authenticated and cloudSyncEnabled.
   */
  initialize(): void {
    // Request settings from C# shell (→ §3.2.3)
    this.ipcService.send({ type: 'GET_SETTINGS' });

    // Listen for SETTINGS_LOADED from C# shell
    this.ipcService.on<{ settings: Settings }>('SETTINGS_LOADED', (data) => {
      this.settings.set(data.settings);

      // If cloud sync is enabled and user is authenticated,
      // start listening for Firestore changes (cross-device sync).
      if (data.settings.cloudSyncEnabled) {
        this.attachFirestoreListener();
      }
    });
  }

  /**
   * Update a setting. Writes to BOTH:
   * 1. C# shell (local settings.json via IPC)
   * 2. Firestore (cloud sync, if enabled and authenticated)
   */
  async updateSettings(newSettings: Settings): Promise<void> {
    this.settings.set(newSettings);

    // Write to C# shell (local persistence)
    this.ipcService.send({ type: 'SAVE_SETTINGS', payload: { settings: newSettings } });

    // Write to Firestore (cloud persistence)
    const uid = this.authService.uid;
    if (uid && newSettings.cloudSyncEnabled) {
      const docRef = doc(this.firestore, `users/${uid}/settings`);
      await setDoc(docRef, {
        ...newSettings,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Attach Firestore snapshot listener for cross-device settings sync.
   * When settings change on another device, this listener fires and
   * updates the local signal + pushes to C# shell.
   */
  private attachFirestoreListener(): void {
    const uid = this.authService.uid;
    if (!uid) return;

    const docRef = doc(this.firestore, `users/${uid}/settings`);
    onSnapshot(docRef, (snapshot) => {
      if (!snapshot.exists()) return;

      const remoteSettings = snapshot.data() as Settings;

      // Only apply remote settings if they differ from local.
      // This prevents a feedback loop: local write → listener fires → local write.
      const currentUpdatedAt = (this.settings() as Settings & { updatedAt?: string }).updatedAt;
      const remoteUpdatedAt = (remoteSettings as Settings & { updatedAt?: string }).updatedAt;

      if (remoteUpdatedAt && remoteUpdatedAt !== currentUpdatedAt) {
        this.settings.set(remoteSettings);
        // Push to C# shell so local settings.json is updated
        this.ipcService.send({ type: 'SAVE_SETTINGS', payload: { settings: remoteSettings } });
      }
    });
  }
}
```

**Taxonomy write flow:**

```
User logs distraction "Twitter" with category "Social Media"
  → InterventionComponent emits (distractionLogged) event
  → TimerService.logDistraction(note, categoryName)
    → EventLedgerService.writeEvent({ type: 'DistractionLogged', ... })
    → TaxonomyService.upsertMapping('twitter', 'Twitter', 'Social Media')
      → Firestore: setDoc(users/{uid}/taxonomy/twitter, { ... }, { merge: true })
```

**Angular `TaxonomyService` — Firestore write (upsert on distraction log):**

```typescript
// File: src/app/core/taxonomy.service.ts

import { Injectable, inject, signal } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  query,
  where,
  getDocs,
  onSnapshot,
  writeBatch,
  increment,
} from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import type { TaxonomyData, DistractionGroup } from './models';

@Injectable({ providedIn: 'root' })
export class TaxonomyService {
  private firestore = inject(Firestore);
  private authService = inject(AuthService);

  readonly taxonomyData = signal<TaxonomyData>({
    recentEntries: [],
    groups: [],
    categories: [],
  });

  /**
   * Upsert a taxonomy mapping when a distraction is logged.
   * Creates the document if it doesn't exist, or updates count/lastSeenAt if it does.
   */
  async upsertMapping(
    normalizedNote: string,
    note: string,
    categoryName: string | null,
  ): Promise<void> {
    const uid = this.authService.uid;
    if (!uid) return;

    const docRef = doc(this.firestore, `users/${uid}/taxonomy/${normalizedNote}`);
    const now = new Date().toISOString();

    await setDoc(
      docRef,
      {
        note,
        normalizedNote,
        categoryName,
        count: increment(1),
        lastSeenAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  }

  /**
   * Rename a category across all taxonomy documents.
   * Source equivalent: DistractionRepository.RenameCategoryAsync().
   */
  async renameCategory(oldName: string, newName: string): Promise<void> {
    const uid = this.authService.uid;
    if (!uid) return;

    const colRef = collection(this.firestore, `users/${uid}/taxonomy`);
    const q = query(colRef, where('categoryName', '==', oldName));
    const snapshot = await getDocs(q);

    const batch = writeBatch(this.firestore);
    const now = new Date().toISOString();

    snapshot.docs.forEach((docSnap) => {
      batch.update(docSnap.ref, { categoryName: newName, updatedAt: now });
    });

    await batch.commit();
  }

  /**
   * Delete a category (set categoryName to null for all affected documents).
   * Source equivalent: DistractionRepository.DeleteCategoryAsync().
   */
  async deleteCategory(categoryName: string): Promise<void> {
    const uid = this.authService.uid;
    if (!uid) return;

    const colRef = collection(this.firestore, `users/${uid}/taxonomy`);
    const q = query(colRef, where('categoryName', '==', categoryName));
    const snapshot = await getDocs(q);

    const batch = writeBatch(this.firestore);
    const now = new Date().toISOString();

    snapshot.docs.forEach((docSnap) => {
      batch.update(docSnap.ref, { categoryName: null, updatedAt: now });
    });

    await batch.commit();
  }

  /**
   * Update the category for a single distraction group.
   * Source equivalent: DistractionRepository.UpdateDistractionGroupAsync().
   */
  async updateGroupCategory(
    normalizedNote: string,
    newCategoryName: string | null,
  ): Promise<void> {
    const uid = this.authService.uid;
    if (!uid) return;

    const docRef = doc(this.firestore, `users/${uid}/taxonomy/${normalizedNote}`);
    const now = new Date().toISOString();

    await updateDoc(docRef, {
      categoryName: newCategoryName,
      updatedAt: now,
    });
  }

  /**
   * Attach real-time listener for taxonomy changes.
   * Rebuilds the TaxonomyData signal whenever any taxonomy document changes.
   */
  attachListener(): void {
    const uid = this.authService.uid;
    if (!uid) return;

    const colRef = collection(this.firestore, `users/${uid}/taxonomy`);
    onSnapshot(colRef, (snapshot) => {
      const groups: DistractionGroup[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          note: data['note'] as string,
          normalizedNote: data['normalizedNote'] as string,
          categoryName: (data['categoryName'] as string) ?? null,
          count: data['count'] as number,
          lastSeenAt: data['lastSeenAt'] as string,
        };
      });

      const categories = [
        ...new Set(
          groups
            .map((g) => g.categoryName)
            .filter((c): c is string => c !== null),
        ),
      ].sort();

      this.taxonomyData.update((prev) => ({
        ...prev,
        groups,
        categories,
      }));
    });
  }
}
```

**Planner write operations:**

Planner blocks use standard Firestore CRUD. The `PlannerService` is documented in → §5.6. All operations (`addDoc`, `updateDoc`, `deleteDoc`) use the Standard Persistence path.

**Source-to-target mapping of Firestore write operations:**

| Source Operation | Source Code Location | Target Angular Service | Target Firestore Operation |
|---|---|---|---|
| Session write | `App.tsx:syncSessionToFirestore()` | `EventLedgerService.writeEvent()` | `addDoc(users/{uid}/session_events, event)` |
| Distraction write | `App.tsx:submitDistraction()` | `EventLedgerService.writeEvent()` + `TaxonomyService.upsertMapping()` | `addDoc(session_events)` + `setDoc(taxonomy, merge)` |
| Report fetch | `App.tsx:fetchFirestoreHistory()` | `ReportService.loadReport()` | `getDocs(stats/daily)` + `getDocs(session_events)` |
| *(not in source)* | — | `SettingsService.updateSettings()` | `setDoc(users/{uid}/settings)` |
| *(not in source)* | — | `PlannerService.createBlock()` | `addDoc(users/{uid}/planner_blocks)` |

#### 7.2.2. Real-Time Snapshot Listeners for Cross-Device Sync

**Source behavior:** The source app does NOT use real-time listeners. It uses one-shot `getDocs()` queries to fetch cloud data when the user opens the Reports screen. There is no cross-device sync for settings, taxonomy, or session data.

**Target behavior:** The target app uses Firestore `onSnapshot()` listeners to receive real-time updates when data changes on another device (or when Cloud Functions write server-computed aggregates).

**Listeners to register:**

| Listener | Firestore Path | Trigger | Angular Service |
|---|---|---|---|
| Settings sync | `users/{uid}/settings` | Settings change on another device | `SettingsService.attachFirestoreListener()` |
| Taxonomy sync | `users/{uid}/taxonomy` (collection) | Category rename/delete on another device, or new distraction logged | `TaxonomyService.attachListener()` |
| Daily stats update | `users/{uid}/stats/daily/{today}` | Cloud Function writes daily aggregate after event processing | `ReportService.attachDailyStatsListener()` |
| Streak update | `users/{uid}/stats/streaks` | Cloud Function updates streak after session completion | `ReportService.attachStreakListener()` |
| Achievement unlock | `users/{uid}/achievements` (collection) | Cloud Function awards new achievement | `AchievementService.attachListener()` |

**Listener lifecycle:**

```
App starts
  → AuthService.onAuthStateChanged()
    → if user authenticated:
      → SettingsService.attachFirestoreListener()
      → TaxonomyService.attachListener()
      → ReportService.attachDailyStatsListener()
      → ReportService.attachStreakListener()
      → AchievementService.attachListener()
    → if user signs out:
      → All listeners are automatically cleaned up by @angular/fire
         (subscriptions tied to component lifecycle via DestroyRef)
```

**`onSnapshot` behavior offline:**

When the app is offline, `onSnapshot` still fires — it returns results from the local IndexedDB cache. The `SnapshotMetadata.fromCache` flag indicates whether the data came from the cache or the server:

```typescript
onSnapshot(docRef, (snapshot) => {
  const data = snapshot.data();
  const fromCache = snapshot.metadata.fromCache;
  // fromCache === true → data is from local IndexedDB cache
  // fromCache === false → data is fresh from server
});
```

Angular services do NOT differentiate between cache and server reads. All data is treated equally — the UI never shows a "stale data" warning. This is the "Optimistic Offline" principle.

#### 7.2.3. Local Cache Read Priority (Offline-First Reads)

**Firestore read priority with `enableIndexedDbPersistence`:**

1. **First read (cache empty):** Firestore fetches from the server, caches in IndexedDB, returns to caller.
2. **Subsequent reads (cache populated, online):** Firestore returns from cache immediately AND initiates a server fetch. If the server returns newer data, the `onSnapshot` listener fires again with the updated data.
3. **Reads while offline (cache populated):** Firestore returns from cache. No server fetch attempted. `fromCache === true`.
4. **Reads while offline (cache empty):** Firestore returns an empty result set. No error thrown.

**Practical implication for Angular services:**

All query operations (`getDocs`, `getDoc`) use the default Firestore cache behavior. DO NOT use `getDocFromServer()` or `getDocsFromServer()` — these bypass the cache and throw errors when offline.

```typescript
// CORRECT — uses cache when offline, server when online:
const snapshot = await getDocs(
  query(collection(db, `users/${uid}/stats/daily`), where('date', '>=', startDate)),
);

// INCORRECT — throws FirestoreError when offline:
// const snapshot = await getDocsFromServer(...);
```

**Settings read priority (C# shell vs. Firestore):**

Settings have a special dual-source read priority:

```
1. App starts → C# shell loads settings.json from disk → sends SETTINGS_LOADED via IPC
2. Angular applies local settings immediately (zero-latency startup)
3. If cloudSyncEnabled && authenticated:
   a. Firestore snapshot listener fires with cloud settings
   b. If cloud settings have a newer updatedAt → override local settings
   c. Push updated settings back to C# shell via SAVE_SETTINGS IPC
```

This ensures the app is usable within milliseconds of startup (local settings.json) while seamlessly pulling in cross-device changes when available.

---

### 7.3. Secure Event Ledger Path (Sessions & Distractions)

The Secure Event Ledger is the core differentiator of the target sync architecture. All session and distraction data flows through append-only, immutable event documents. This path is fundamentally different from Standard Persistence — the client can only CREATE events, never UPDATE or DELETE them.

#### 7.3.1. Client-Side Event Construction (Immutable Event Objects)

Every event written to the ledger conforms to the `SessionEvent<T>` envelope (→ §6.2.2.4). Events are constructed entirely on the client (Angular) and written as complete documents. There is no partial write or field-level update.

**Event construction flow for each event type:**

**`TimerStarted` — constructed when the user clicks "Start Focus":**

```typescript
// File: src/app/features/timer/timer.service.ts

startSession(sessionName: string | null): void {
  const sessionId = crypto.randomUUID();
  this.currentSessionId.set(sessionId);
  this.distractions.set([]);

  const settings = this.settingsService.settings();
  const timerMode = this.timerMode();
  const durationSeconds = getTimerDuration(timerMode, settings);

  const now = new Date().toISOString();

  // Write event to ledger
  this.eventLedgerService.writeEvent({
    type: 'TimerStarted',
    sessionId,
    timestamp: now,
    payload: {
      durationSeconds,
      sessionName,
      startedAt: now,
      timerMode,
      presetName: this.activePresetName(),
    },
  });

  // Start the countdown
  this.timeLeft.set(durationSeconds);
  this.isRunning.set(true);
  this.startCountdown();
}
```

**`TimerPaused` — constructed when the timer is paused (manually or by intervention):**

```typescript
pauseTimer(reason: 'manual' | 'intervention' | 'suspend'): void {
  this.isRunning.set(false);
  this.stopCountdown();

  const sessionId = this.currentSessionId();
  if (!sessionId) return;

  this.eventLedgerService.writeEvent({
    type: 'TimerPaused',
    sessionId,
    timestamp: new Date().toISOString(),
    payload: {
      pausedAt: new Date().toISOString(),
      timeLeftSeconds: this.timeLeft(),
      reason,
    },
  });
}
```

**`TimerCompleted` — constructed when the countdown reaches zero:**

```typescript
private onTimerComplete(): void {
  const sessionId = this.currentSessionId();
  if (!sessionId) return;

  const distractions = this.distractions();
  const settings = this.settingsService.settings();
  const durationSeconds = getTimerDuration(this.timerMode(), settings);

  this.eventLedgerService.writeEvent({
    type: 'TimerCompleted',
    sessionId,
    timestamp: new Date().toISOString(),
    payload: {
      durationSeconds,
      sessionName: this.sessionName(),
      startedAt: this.sessionStartedAt()!,
      completedAt: new Date().toISOString(),
      endedEarly: false,
      distractionCount: distractions.filter((d) => d.categoryName !== null || d.note !== '').length,
      falseAlarmCount: 0, // FalseAlarms are separate events, count from local state
    },
  });

  // IPC: tell C# shell to play completion sound
  this.ipcService.send({ type: 'SESSION_COMPLETE' });
}
```

**`TimerEndedEarly` — constructed when the user clicks "End Session" before timer reaches zero:**

```typescript
endSessionEarly(): void {
  const sessionId = this.currentSessionId();
  if (!sessionId) return;

  const startedAt = this.sessionStartedAt();
  if (!startedAt) return;

  const settings = this.settingsService.settings();
  const totalDuration = getTimerDuration(this.timerMode(), settings);
  const elapsed = totalDuration - this.timeLeft();

  this.eventLedgerService.writeEvent({
    type: 'TimerEndedEarly',
    sessionId,
    timestamp: new Date().toISOString(),
    payload: {
      durationSeconds: elapsed,
      sessionName: this.sessionName(),
      startedAt,
      completedAt: new Date().toISOString(),
      endedEarly: true,
      distractionCount: this.distractions().length,
      falseAlarmCount: 0,
    },
  });

  this.isRunning.set(false);
  this.stopCountdown();
  this.ipcService.send({ type: 'SESSION_COMPLETE' });
}
```

**`IdleDetected` — constructed when the C# shell sends `IDLE_DETECTED` via IPC:**

```typescript
// File: src/app/core/ipc-dispatch.service.ts (idle handler)

private handleIdleDetected(payload: { idleDurationMs: number }): void {
  const timerService = inject(TimerService);
  const sessionId = timerService.currentSessionId();

  if (!sessionId || !timerService.isRunning()) return;

  // Pause the timer
  timerService.pauseTimer('intervention');

  // Write IdleDetected event
  this.eventLedgerService.writeEvent({
    type: 'IdleDetected',
    sessionId,
    timestamp: new Date().toISOString(),
    payload: {
      idleDurationMs: payload.idleDurationMs,
      timerTimeLeftSeconds: timerService.timeLeft(),
    },
  });

  // Show intervention modal
  timerService.showIntervention.set(true);
}
```

**`DistractionLogged` — constructed when the user submits a distraction in the intervention modal:**

```typescript
// File: src/app/features/timer/timer.service.ts

logDistraction(note: string, categoryName: string | null): void {
  const sessionId = this.currentSessionId();
  if (!sessionId) return;

  const normalizedNote = normalizeDistractionNote(note);

  // Write DistractionLogged event to ledger
  this.eventLedgerService.writeEvent({
    type: 'DistractionLogged',
    sessionId,
    timestamp: new Date().toISOString(),
    payload: {
      note: note.trim(),
      normalizedNote,
      categoryName,
    },
  });

  // Upsert taxonomy mapping
  this.taxonomyService.upsertMapping(normalizedNote, note.trim(), categoryName);

  // Track locally for session-scoped distraction list
  this.distractions.update((prev) => [
    ...prev,
    { note: note.trim(), categoryName, timestamp: new Date() },
  ]);
}
```

**`FalseAlarmMarked` — constructed when the user clicks "False Alarm" in the intervention modal:**

```typescript
markFalseAlarm(): void {
  const sessionId = this.currentSessionId();
  if (!sessionId) return;

  this.eventLedgerService.writeEvent({
    type: 'FalseAlarmMarked',
    sessionId,
    timestamp: new Date().toISOString(),
    payload: {},
  });
}
```

#### 7.3.2. Append-Only Write Pattern (No Updates, No Deletes)

**Enforcement at three levels:**

1. **Application-level:** The `EventLedgerService` exposes ONLY a `writeEvent()` method. There is no `updateEvent()`, `deleteEvent()`, or `patchEvent()` method. The service API makes it physically impossible to modify existing events from Angular code.

2. **Security-rule level:** Firestore security rules deny all `update` and `delete` operations on the `session_events` subcollection (→ §7.4.2). Even if a developer accidentally adds an update call, it will fail at runtime.

3. **Cloud Function level:** Cloud Functions use the Admin SDK, which bypasses security rules. However, the Cloud Functions are designed to only READ events and WRITE to aggregate documents (`stats/daily`, `stats/streaks`, `achievements`). No Cloud Function ever modifies an event document.

**What happens if a user tries to tamper with IndexedDB:**

A technically sophisticated user could open Chrome DevTools, navigate to Application → IndexedDB, and modify cached event documents. However:

1. The modified document will sync to Firestore on the next network connection.
2. The Firestore security rule will reject the write because `update` is denied:
   ```
   allow update, delete: if false;
   ```
3. Firestore will remove the tampered document from the local cache (reverting to the server state).
4. Cloud Functions have already processed the original event — the aggregate documents are authoritative.

**What about deleting IndexedDB entirely:**

If a user clears IndexedDB, they lose their local cache. On the next app start:
1. Firestore re-fetches all data from the server.
2. All previously synced events are restored.
3. Any events that were written offline but not yet synced are permanently lost.

This is an acceptable trade-off. The offline window is typically short (seconds to minutes), and the Photino app runs in a persistent process that syncs continuously when online.

#### 7.3.3. Pending Sync Queue (`pendingSyncsRef` Migration to Angular)

**Source implementation** (`Sentinel.UI\src\App.tsx`, lines 136–166):

The source uses an in-memory `useRef` array to track sessions that failed to sync:

```typescript
const pendingSyncsRef = useRef<Array<{
  duration: number;
  distractions: string[];
  completedAt: Date;
}>>([]);
```

**Problems with the source approach:**

| Problem | Impact |
|---|---|
| `useRef` is in-memory only | Data lost on app close, crash, or system restart |
| Retry triggers only on next session completion | If no more sessions are completed, pending data never syncs |
| Only sessions have retry logic | Distractions are fire-and-forget (`catch` logs error, no retry) |
| `serverTimestamp()` used for `completedAt` | Pending documents have `null` timestamp in local cache |
| No deduplication on retry | If Firestore write succeeds but the `addDoc` promise times out, the retry creates a duplicate |

**Target solution: Eliminate the manual queue entirely.**

Firestore's `enableIndexedDbPersistence` provides a built-in write queue that solves ALL of the above problems:

| Feature | Source (`pendingSyncsRef`) | Target (Firestore native queue) |
|---|---|---|
| Persistence | In-memory, lost on close | IndexedDB, persists across restarts |
| Retry trigger | Manual (next session only) | Automatic (network reconnect) |
| Coverage | Sessions only | All Firestore writes (events, taxonomy, settings) |
| Deduplication | None | Built-in (Firestore uses write IDs) |
| Timestamp handling | `serverTimestamp()` (null offline) | Client ISO 8601 string (always available) |

**Migration action:** Delete the `pendingSyncsRef` and `syncSessionToFirestore` function entirely. Replace all `addDoc(collection(db, 'sessions'), {...})` calls with `EventLedgerService.writeEvent({...})`. The `writeEvent` method is a single `addDoc` call with no retry logic — Firestore handles retries internally.

**Code diff (conceptual):**

```diff
- // Source: App.tsx
- const pendingSyncsRef = useRef<Array<{...}>>([]);
- const syncSessionToFirestore = useCallback(async () => {
-   if (!user || !settings.cloudSyncEnabled) return;
-   pendingSyncsRef.current.push({...});
-   const pending = [...pendingSyncsRef.current];
-   const failed: typeof pending = [];
-   for (const session of pending) {
-     try {
-       await addDoc(collection(db, 'sessions'), {...});
-     } catch (error) {
-       failed.push(session);
-     }
-   }
-   pendingSyncsRef.current = failed;
- }, [...]);

+ // Target: TimerService
+ this.eventLedgerService.writeEvent({
+   type: 'TimerCompleted',
+   sessionId: this.currentSessionId(),
+   timestamp: new Date().toISOString(),
+   payload: { ... },
+ });
```

#### 7.3.4. Event Ordering & Timestamp Consistency (Server Timestamp vs. Client Timestamp)

**Source behavior: `serverTimestamp()` (problematic):**

The source uses Firestore's `serverTimestamp()` for timestamps:

```typescript
// Source: App.tsx:156
await addDoc(collection(db, 'sessions'), {
  userId: user.uid,
  duration: session.duration,
  distractions: session.distractions,
  completedAt: serverTimestamp(),  // ← Server timestamp
});
```

**Problem:** `serverTimestamp()` resolves to `null` in the local IndexedDB cache until the document syncs to the server. This means:
1. Offline reads of pending documents return `null` for `completedAt`.
2. Queries with `orderBy('completedAt')` or `where('completedAt', '>=', ...)` skip pending documents.
3. Reports generated while offline may silently exclude recent sessions.

**Target behavior: Client ISO 8601 strings:**

The target uses client-generated ISO 8601 timestamps:

```typescript
const now = new Date().toISOString();
// → "2026-04-03T09:00:00.000Z"

this.eventLedgerService.writeEvent({
  type: 'TimerCompleted',
  sessionId,
  timestamp: now,           // ← Client timestamp, always available
  payload: {
    completedAt: now,       // ← Also client timestamp
    ...
  },
});
```

**Advantages:**

1. **Always available offline:** `new Date().toISOString()` works without network access.
2. **Immediately queryable:** The `timestamp` field is set on the document before it enters the IndexedDB write queue. Offline queries work correctly.
3. **Sortable:** ISO 8601 strings sort lexicographically in the correct chronological order.

**Disadvantage (mitigated):**

Client timestamps can be spoofed or incorrect (system clock drift). This is mitigated by:

1. **Cloud Functions validate plausibility:** The server checks that `timestamp` is within a reasonable window (e.g., not in the future by more than 5 minutes, not older than 30 days from when it arrives at the server).
2. **Event ordering within a session is enforced by `sessionId`:** Events for the same session must follow a logical sequence: `TimerStarted` → (optional `TimerPaused`, `IdleDetected`, `DistractionLogged`, `FalseAlarmMarked`) → `TimerCompleted` or `TimerEndedEarly`. Cloud Functions validate this sequence.
3. **Gamification is server-authoritative:** Even if a user sets their system clock to log an artificially fast Swift Recovery (< 60s), the Cloud Function can cross-reference `serverTimestamp()` on the Firestore document metadata to detect clock manipulation.

**Event ordering guarantee across devices:**

Events from different devices have different `sessionId` values. Events within a session are linearly ordered by `timestamp`. Cross-session ordering uses `timestamp` for display but is not semantically significant (sessions don't interact with each other).

```
Device A session "aaa":
  [TimerStarted t=09:00] → [IdleDetected t=09:10] → [DistractionLogged t=09:10:30] → [TimerCompleted t=09:25]

Device B session "bbb":
  [TimerStarted t=09:05] → [TimerCompleted t=09:30]

Report view: sorted by timestamp, interleaved. No ambiguity because sessionId groups events.
```

#### 7.3.5. Anti-Tampering Rationale: Why Events, Not State Documents

**Why not use mutable state documents for sessions?**

The source architecture stores sessions as mutable state documents:

```json
// Source: flat sessions/{sessionId} document
{
  "userId": "abc123",
  "duration": 1500,
  "distractions": ["Twitter", "Slack"],
  "completedAt": "2026-04-03T09:25:00Z"
}
```

A user with IndexedDB access could modify this document to inflate their focus time (`duration: 99999`), remove distractions (`distractions: []`), or change the timestamp (`completedAt` pushed earlier to create fake streaks).

**The Event Ledger prevents this** (TARGET_ARCHITECTURE.md §6):

> To prevent users from cheating by editing local IndexedDB or SQLite files, all gamification logic is strictly server-side.

The Event Ledger is append-only: the client writes immutable event documents that the client cannot modify after creation. The server processes these events to compute aggregates. Even if a user adds fake events to their local IndexedDB:

1. **Fake events must pass security rules:** The event must have a valid `type`, `sessionId`, `timestamp`, and `payload` (→ §7.4.2).
2. **Cloud Functions validate event sequences:** A `TimerCompleted` event without a preceding `TimerStarted` event for the same `sessionId` is rejected.
3. **Server computes aggregates:** The user cannot directly write to `stats/daily`, `stats/streaks`, or `achievements` — these are read-only for the client (→ §7.4.3).
4. **Temporal plausibility checks:** A session claiming 10 hours of focus (`durationSeconds: 36000`) from a 25-minute timer is flagged and excluded.

**Trade-off:** The Event Ledger generates more Firestore documents than mutable state documents (each session produces 2-10 events instead of 1 state document). This increases Firestore read/write costs. The trade-off is acceptable for a desktop productivity app with modest data volumes (a power user might generate ~50 events per day = ~1,500 per month).

---

### 7.4. Firestore Security Rules

This subsection specifies the complete Firestore security rules for the target architecture. The rules replace the source rules (`firestore.rules`) which use flat global collections with `userId` field matching.

**Source rules** (`firestore.rules`):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
    match /sessions/{sessionId} {
      allow read: if request.auth != null && resource.data.userId == request.auth.uid;
      allow create: if request.auth != null && request.resource.data.userId == request.auth.uid;
      allow update, delete: if request.auth != null && resource.data.userId == request.auth.uid;
    }
    match /distractions/{distractionId} {
      allow read: if request.auth != null && resource.data.userId == request.auth.uid;
      allow create: if request.auth != null && request.resource.data.userId == request.auth.uid;
      allow update, delete: if request.auth != null && resource.data.userId == request.auth.uid;
    }
    match /_sentinel_health/{docId} {
      allow read: if request.auth != null;
    }
  }
}
```

**Source rule problems:**

1. **Flat collections with `userId` field:** Any authenticated user can theoretically enumerate document IDs in `sessions/` and `distractions/`. The `resource.data.userId` check only fires on read — ID enumeration is possible.
2. **Full CRUD on sessions and distractions:** The `update` and `delete` permissions on sessions mean a user can modify or delete their past session data, undermining gamification integrity.
3. **No schema validation:** There's no validation that `request.resource.data` contains the expected fields.
4. **No Server-Computed protection:** There are no rules for aggregate or achievement documents (they don't exist in the source).

**Target rules** (`firestore.rules`):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ─── Default deny ───────────────────────────────────────────────
    match /{document=**} {
      allow read, write: if false;
    }

    // ─── User-scoped data ────────────────────────────────────────────
    match /users/{uid} {

      // ─── 7.4.1. Standard Persistence: Settings ───────────────────
      match /settings {
        allow read: if request.auth != null && request.auth.uid == uid;
        allow write: if request.auth != null && request.auth.uid == uid;
      }

      // ─── 7.4.1. Standard Persistence: Planner Blocks ─────────────
      match /planner_blocks/{blockId} {
        allow read: if request.auth != null && request.auth.uid == uid;
        allow write: if request.auth != null && request.auth.uid == uid;
      }

      // ─── 7.4.1. Standard Persistence: Taxonomy ───────────────────
      match /taxonomy/{noteId} {
        allow read: if request.auth != null && request.auth.uid == uid;
        allow write: if request.auth != null && request.auth.uid == uid;
      }

      // ─── 7.4.2. Event Ledger: Append-Only ─────────────────────────
      match /session_events/{eventId} {
        // Client can READ their own events (for reports, history).
        allow read: if request.auth != null && request.auth.uid == uid;

        // Client can only CREATE new events. Schema validation ensures
        // the event has the required fields.
        allow create: if request.auth != null
                      && request.auth.uid == uid
                      && request.resource.data.type is string
                      && request.resource.data.type in [
                           'TimerStarted',
                           'TimerPaused',
                           'TimerCompleted',
                           'TimerEndedEarly',
                           'IdleDetected',
                           'DistractionLogged',
                           'FalseAlarmMarked'
                         ]
                      && request.resource.data.sessionId is string
                      && request.resource.data.timestamp is string
                      && request.resource.data.payload is map;

        // UPDATE and DELETE are DENIED for all clients.
        // Only Cloud Functions (Admin SDK) can modify events if needed.
        allow update, delete: if false;
      }

      // ─── 7.4.3. Server-Computed: Read-Only for Client ─────────────
      match /stats/{document=**} {
        allow read: if request.auth != null && request.auth.uid == uid;
        allow write: if false;
      }

      match /achievements/{achievementId} {
        allow read: if request.auth != null && request.auth.uid == uid;
        allow write: if false;
      }
    }
  }
}
```

#### 7.4.1. User Isolation: `request.auth.uid == uid`

**Source pattern:** `resource.data.userId == request.auth.uid` — matches a `userId` FIELD inside the document against the authenticated user.

**Target pattern:** `request.auth.uid == uid` — matches the authenticated user against the `{uid}` path SEGMENT in the document path.

**Why the target pattern is superior:**

1. **No field dependency:** The source pattern requires every document to contain a `userId` field. If a document is missing this field (data migration bug, schema evolution), the rule silently denies access. The target pattern relies on the document PATH, which is inherently set by the write operation.

2. **No ID enumeration:** In the source flat collection (`sessions/{sessionId}`), a user can attempt to read arbitrary document IDs — the `resource.data.userId` check only fires after Firestore loads the document. In the target user-scoped collection (`users/{uid}/session_events/{eventId}`), Firestore denies access at the PATH level before loading the document.

3. **Cleaner queries:** The source requires `where('userId', '==', user.uid)` on every query. The target queries are scoped to the user's subcollection by path — no `where` filter needed for user isolation.

```typescript
// Source: requires userId filter
const q = query(
  collection(db, 'sessions'),
  where('userId', '==', user.uid),
  orderBy('completedAt', 'desc'),
);

// Target: user isolation is in the path
const q = query(
  collection(db, `users/${uid}/session_events`),
  orderBy('timestamp', 'desc'),
);
```

#### 7.4.2. Event Ledger Write-Only Rule (Create Only, No Update/Delete)

The Event Ledger rule is the most critical security enforcement in the target architecture:

```
allow create: if request.auth != null
              && request.auth.uid == uid
              && request.resource.data.type is string
              && request.resource.data.type in [
                   'TimerStarted', 'TimerPaused', 'TimerCompleted',
                   'TimerEndedEarly', 'IdleDetected', 'DistractionLogged',
                   'FalseAlarmMarked'
                 ]
              && request.resource.data.sessionId is string
              && request.resource.data.timestamp is string
              && request.resource.data.payload is map;

allow update, delete: if false;
```

**Schema validation breakdown:**

| Check | Purpose |
|---|---|
| `request.auth != null` | Ensures the user is authenticated. |
| `request.auth.uid == uid` | Ensures the user can only write to their own subcollection. |
| `request.resource.data.type is string` | Ensures the `type` field exists and is a string. |
| `type in [...]` | Allowlist of valid event types. Prevents injection of arbitrary event types. |
| `request.resource.data.sessionId is string` | Ensures the `sessionId` field exists and is a string. |
| `request.resource.data.timestamp is string` | Ensures the `timestamp` field exists and is a string. |
| `request.resource.data.payload is map` | Ensures the `payload` field exists and is an object/map. |
| `allow update, delete: if false` | Immutability enforcement. No client can modify or delete events. |

**What this does NOT validate:**

- **Payload shape per event type:** The rule does not validate that a `TimerCompleted` event has `durationSeconds`, `startedAt`, `completedAt`, etc. This is intentional — security rules have a 1MB evaluation limit and complex per-type validation would be fragile. Cloud Functions validate payload structure during processing (→ §8.2.2).
- **Timestamp format:** The rule checks `timestamp is string` but not that it's valid ISO 8601. Cloud Functions validate format during processing.
- **Session event ordering:** The rule does not check that `TimerStarted` precedes `TimerCompleted`. Cloud Functions validate event sequences.

#### 7.4.3. Server-Computed Fields: Read-Only for Client

```
match /stats/{document=**} {
  allow read: if request.auth != null && request.auth.uid == uid;
  allow write: if false;
}

match /achievements/{achievementId} {
  allow read: if request.auth != null && request.auth.uid == uid;
  allow write: if false;
}
```

These rules ensure that:

1. **Clients can read their own aggregates and achievements** — Angular needs to display daily stats, streaks, and badges.
2. **Clients CANNOT write to these documents** — `allow write: if false` is an absolute deny. Only Cloud Functions (using the Admin SDK, which bypasses security rules) can create and update these documents.
3. **The wildcard `{document=**}`** on stats covers both `stats/daily/{date}` and `stats/streaks` subcollection paths.

**Why `allow write: if false` instead of no rule at all:**

Firestore's default behavior with no matching rule is to deny access. However, explicitly writing `allow write: if false` serves as documentation and prevents accidental permission grants if a parent rule is too permissive.

#### 7.4.4. Rate Limiting Considerations

Firestore security rules do not natively support rate limiting. However, abuse prevention is addressed at multiple levels:

**1. Firebase App Check (recommended for production):**

App Check verifies that requests come from a legitimate Sentinel app instance, not a script or modified client. Configuration:

```typescript
// File: src/app/core/firebase.provider.ts (addition)

import { provideAppCheck, initializeAppCheck, ReCaptchaV3Provider } from '@angular/fire/app-check';

export const firebaseProviders = [
  // ... existing providers ...
  provideAppCheck(() =>
    initializeAppCheck(undefined, {
      provider: new ReCaptchaV3Provider('RECAPTCHA_V3_SITE_KEY'),
      isTokenAutoRefreshEnabled: true,
    }),
  ),
];
```

**2. Cloud Function throttling:**

Cloud Functions can track event creation rate per user and flag accounts exceeding reasonable thresholds:

- **Reasonable threshold:** A focus session generates at most ~10 events (1 start, 1 complete, up to 8 interventions). At most 4 sessions per hour. Maximum ~40 events per hour per user.
- **Abuse flag:** If a user creates >100 events in a 10-minute window, the Cloud Function sets a `flagged: true` field on the user's profile document. Flagged users' achievements are suspended pending review.

**3. Firestore write quotas:**

Firestore enforces a default maximum of 1 write per second per document. Since every Event Ledger event is a NEW document (unique `eventId`), this limit is per-document and does not throttle normal usage. The subcollection itself can handle thousands of writes per second.

**4. Security rule compute limits:**

Firestore evaluates security rules within a 1MB compute budget per request. The target rules are simple (no recursive reads, no `get()` calls) and well within this budget.

---

### 7.5. Data Migration: SQLite → Firestore

This subsection specifies the one-time migration utility that transfers existing local data (SQLite database) to the target Firestore architecture. Users upgrading from the source WPF/React app to the target Photino/Angular app must have their historical data preserved.

#### 7.5.1. One-Time Migration Utility for Existing Local Data

**Migration trigger:**

The migration runs automatically on first launch of the target Sentinel app if:

1. A SQLite database exists at `%LOCALAPPDATA%\Sentinel\sentinel.db`.
2. A migration marker file does NOT exist at `%LOCALAPPDATA%\Sentinel\.migration-complete`.
3. The user is authenticated (migration requires a valid UID to write to Firestore).

**Migration flow:**

```
Target app launches
  → C# shell checks for sentinel.db existence
    → if exists AND no .migration-complete marker:
      → C# shell sends IPC: { type: 'MIGRATION_AVAILABLE', payload: { sessionCount, distractionCount } }
      → Angular shows migration prompt: "Found X sessions and Y distractions from your previous installation. Migrate to cloud?"
        → User confirms → Angular sends IPC: { type: 'START_MIGRATION' }
          → C# shell reads SQLite → sends chunks via IPC: { type: 'MIGRATION_CHUNK', payload: { events: [...] } }
          → Angular writes each chunk to Firestore
          → C# shell sends IPC: { type: 'MIGRATION_COMPLETE' }
          → C# shell creates .migration-complete marker file
          → C# shell renames sentinel.db to sentinel.db.migrated (backup, not deleted)
        → User declines → Angular sends IPC: { type: 'SKIP_MIGRATION' }
          → C# shell creates .migration-complete marker file
          → No data is migrated; sentinel.db is preserved unchanged
```

**C# shell migration reader:**

```csharp
// File: Sentinel.Shell\Services\MigrationService.cs

using Microsoft.Data.Sqlite;
using System.Text.Json;

public class MigrationService
{
    private readonly string _dbPath;
    private readonly string _markerPath;
    private const int ChunkSize = 50;

    public MigrationService()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var sentinelDir = Path.Combine(appData, "Sentinel");
        _dbPath = Path.Combine(sentinelDir, "sentinel.db");
        _markerPath = Path.Combine(sentinelDir, ".migration-complete");
    }

    public bool IsMigrationAvailable()
    {
        return File.Exists(_dbPath) && !File.Exists(_markerPath);
    }

    public (int sessions, int distractions) GetMigrationCounts()
    {
        using var connection = new SqliteConnection($"Data Source={_dbPath}");
        connection.Open();

        using var sessionCmd = connection.CreateCommand();
        sessionCmd.CommandText = "SELECT COUNT(*) FROM Sessions";
        var sessions = Convert.ToInt32(sessionCmd.ExecuteScalar());

        using var distractionCmd = connection.CreateCommand();
        distractionCmd.CommandText = "SELECT COUNT(*) FROM Distractions";
        var distractions = Convert.ToInt32(distractionCmd.ExecuteScalar());

        return (sessions, distractions);
    }

    public IEnumerable<string> ReadSessionsAsEventChunks()
    {
        using var connection = new SqliteConnection($"Data Source={_dbPath}");
        connection.Open();

        using var cmd = connection.CreateCommand();
        cmd.CommandText = @"
            SELECT Id, DurationSeconds, StartedAt, CompletedAt, SessionName, EndedEarly
            FROM Sessions
            ORDER BY StartedAt ASC";

        using var reader = cmd.ExecuteReader();
        var chunk = new List<object>();

        while (reader.Read())
        {
            var sessionId = Guid.NewGuid().ToString();
            var startedAt = reader.GetDateTime(2).ToString("o");
            var completedAt = reader.IsDBNull(3) ? null : reader.GetDateTime(3).ToString("o");
            var durationSeconds = reader.GetInt32(1);
            var sessionName = reader.IsDBNull(4) ? null : reader.GetString(4);
            var endedEarly = reader.GetBoolean(5);

            // Generate TimerStarted event
            chunk.Add(new
            {
                type = "TimerStarted",
                sessionId,
                timestamp = startedAt,
                payload = new
                {
                    durationSeconds,
                    sessionName,
                    startedAt,
                    timerMode = "pomodoro",
                    presetName = (string?)null,
                },
                migrated = true,
            });

            // Generate TimerCompleted or TimerEndedEarly event
            var completionType = endedEarly ? "TimerEndedEarly" : "TimerCompleted";
            chunk.Add(new
            {
                type = completionType,
                sessionId,
                timestamp = completedAt ?? startedAt,
                payload = new
                {
                    durationSeconds,
                    sessionName,
                    startedAt,
                    completedAt = completedAt ?? startedAt,
                    endedEarly,
                    distractionCount = 0,
                    falseAlarmCount = 0,
                },
                migrated = true,
            });

            if (chunk.Count >= ChunkSize * 2)
            {
                yield return JsonSerializer.Serialize(chunk,
                    new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
                chunk.Clear();
            }
        }

        if (chunk.Count > 0)
        {
            yield return JsonSerializer.Serialize(chunk,
                new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
        }
    }

    public IEnumerable<string> ReadDistractionsAsEventChunks()
    {
        using var connection = new SqliteConnection($"Data Source={_dbPath}");
        connection.Open();

        using var cmd = connection.CreateCommand();
        cmd.CommandText = @"
            SELECT Id, Note, NormalizedNote, CategoryName, Timestamp, IsFalseAlarm
            FROM Distractions
            ORDER BY Timestamp ASC";

        using var reader = cmd.ExecuteReader();
        var chunk = new List<object>();

        while (reader.Read())
        {
            var note = reader.GetString(1);
            var normalizedNote = reader.GetString(2);
            var categoryName = reader.IsDBNull(3) ? null : reader.GetString(3);
            var timestamp = reader.GetDateTime(4).ToString("o");
            var isFalseAlarm = reader.GetBoolean(5);

            // Distractions from SQLite don't have sessionId — generate a synthetic one
            // grouped by timestamp proximity (within 30 minutes = same session).
            var eventType = isFalseAlarm ? "FalseAlarmMarked" : "DistractionLogged";

            var eventObj = new Dictionary<string, object?>
            {
                ["type"] = eventType,
                ["sessionId"] = "migrated-" + Guid.NewGuid().ToString(),
                ["timestamp"] = timestamp,
                ["migrated"] = true,
            };

            if (isFalseAlarm)
            {
                eventObj["payload"] = new { };
            }
            else
            {
                eventObj["payload"] = new
                {
                    note,
                    normalizedNote,
                    categoryName,
                };
            }

            chunk.Add(eventObj);

            if (chunk.Count >= ChunkSize)
            {
                yield return JsonSerializer.Serialize(chunk,
                    new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
                chunk.Clear();
            }
        }

        if (chunk.Count > 0)
        {
            yield return JsonSerializer.Serialize(chunk,
                new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
        }
    }

    public void MarkMigrationComplete()
    {
        File.WriteAllText(_markerPath, DateTime.UtcNow.ToString("o"));

        // Rename the SQLite database to .migrated (backup, not deleted)
        var migratedPath = _dbPath + ".migrated";
        if (File.Exists(_dbPath) && !File.Exists(migratedPath))
        {
            File.Move(_dbPath, migratedPath);
        }
    }
}
```

**IPC message shapes for migration:**

| Message | Direction | Shape |
|---|---|---|
| `MIGRATION_AVAILABLE` | C# → Angular | `{ type: 'MIGRATION_AVAILABLE', payload: { sessionCount: number, distractionCount: number } }` |
| `START_MIGRATION` | Angular → C# | `{ type: 'START_MIGRATION' }` |
| `MIGRATION_CHUNK` | C# → Angular | `{ type: 'MIGRATION_CHUNK', payload: { events: SessionEvent[], chunkIndex: number, totalChunks: number } }` |
| `MIGRATION_COMPLETE` | C# → Angular | `{ type: 'MIGRATION_COMPLETE', payload: { migratedSessions: number, migratedDistractions: number } }` |
| `SKIP_MIGRATION` | Angular → C# | `{ type: 'SKIP_MIGRATION' }` |

#### 7.5.2. Session History Backfill as Ledger Events

Each source SQLite `Session` row is converted to a pair of Event Ledger events:

```
Source SQLite Session row:
  { Id: 42, DurationSeconds: 1500, StartedAt: '2026-03-15T09:00:00Z',
    CompletedAt: '2026-03-15T09:25:00Z', SessionName: null, EndedEarly: false }

Target Event Ledger events:
  1. { type: 'TimerStarted', sessionId: 'new-uuid', timestamp: '2026-03-15T09:00:00Z',
       payload: { durationSeconds: 1500, sessionName: null, startedAt: '2026-03-15T09:00:00Z',
                  timerMode: 'pomodoro', presetName: null }, migrated: true }

  2. { type: 'TimerCompleted', sessionId: 'same-uuid', timestamp: '2026-03-15T09:25:00Z',
       payload: { durationSeconds: 1500, sessionName: null, startedAt: '2026-03-15T09:00:00Z',
                  completedAt: '2026-03-15T09:25:00Z', endedEarly: false,
                  distractionCount: 0, falseAlarmCount: 0 }, migrated: true }
```

**Key decisions:**

| Decision | Rationale |
|---|---|
| New `sessionId` (UUID) for each migrated session | Source SQLite `Id` is an integer auto-increment with no semantic meaning. Cannot be reused as a Firestore path segment. |
| `timerMode` defaults to `'pomodoro'` | Source sessions don't record timer mode. All sessions are assumed to be pomodoro sessions. |
| `distractionCount: 0` / `falseAlarmCount: 0` | Source sessions don't record per-session distraction counts. These are set to 0 for migrated sessions. Cloud Functions can optionally recompute from migrated distraction events. |
| `migrated: true` flag | Extra field on migrated events to distinguish them from organically created events. Cloud Functions check this flag to avoid re-processing already-aggregated data during migration. |
| `presetName: null` | Source sessions don't track presets. |

**Session event correlation with distractions:**

Source SQLite doesn't have a `sessionId` FK on distractions — there's no way to correlate which distractions belong to which session. Migrated distractions get synthetic `sessionId` values (→ §7.5.3). Cloud Functions process migrated events differently: the `migrated: true` flag triggers a migration-specific aggregation path that doesn't attempt to deduct idle time or calculate Swift Recovery for historical data.

#### 7.5.3. Distraction History Backfill

Each source SQLite `Distraction` row is converted to either a `DistractionLogged` event or a `FalseAlarmMarked` event:

```
Source SQLite Distraction row (non-false-alarm):
  { Id: 123, Note: 'Twitter', NormalizedNote: 'twitter', CategoryName: 'Social Media',
    Timestamp: '2026-03-15T09:10:00Z', IsFalseAlarm: false }

Target Event Ledger event:
  { type: 'DistractionLogged', sessionId: 'migrated-new-uuid',
    timestamp: '2026-03-15T09:10:00Z',
    payload: { note: 'Twitter', normalizedNote: 'twitter', categoryName: 'Social Media' },
    migrated: true }

Source SQLite Distraction row (false alarm):
  { Id: 124, Note: '', NormalizedNote: '', CategoryName: null,
    Timestamp: '2026-03-15T09:12:00Z', IsFalseAlarm: true }

Target Event Ledger event:
  { type: 'FalseAlarmMarked', sessionId: 'migrated-new-uuid',
    timestamp: '2026-03-15T09:12:00Z',
    payload: {},
    migrated: true }
```

**Synthetic `sessionId` for migrated distractions:**

Since source distractions don't reference a session, each migrated distraction gets a unique synthetic `sessionId` prefixed with `"migrated-"`. This ensures:

1. Migrated distractions don't accidentally correlate with migrated sessions (session-distraction correlation is not reconstructable from the source data).
2. Cloud Functions can identify migrated distractions by the `"migrated-"` prefix or the `migrated: true` flag.
3. The `sessionId` field is still populated (required by security rules and event envelope schema).

**Taxonomy backfill:**

During distraction migration, the Angular migration service also upserts taxonomy documents:

```typescript
// File: src/app/core/migration.service.ts (excerpt)

private async backfillTaxonomy(distractions: MigratedDistraction[]): Promise<void> {
  const uid = this.authService.uid;
  if (!uid) return;

  // Group by normalizedNote
  const groups = new Map<string, {
    note: string;
    normalizedNote: string;
    categoryName: string | null;
    count: number;
    lastSeenAt: string;
    firstSeenAt: string;
  }>();

  for (const d of distractions) {
    if (d.isFalseAlarm) continue;

    const existing = groups.get(d.normalizedNote);
    if (existing) {
      existing.count++;
      if (d.timestamp > existing.lastSeenAt) {
        existing.lastSeenAt = d.timestamp;
        existing.note = d.note;
        existing.categoryName = d.categoryName;
      }
      if (d.timestamp < existing.firstSeenAt) {
        existing.firstSeenAt = d.timestamp;
      }
    } else {
      groups.set(d.normalizedNote, {
        note: d.note,
        normalizedNote: d.normalizedNote,
        categoryName: d.categoryName,
        count: 1,
        lastSeenAt: d.timestamp,
        firstSeenAt: d.timestamp,
      });
    }
  }

  // Write taxonomy documents
  const batch = writeBatch(this.firestore);

  for (const [normalizedNote, group] of groups) {
    const docRef = doc(this.firestore, `users/${uid}/taxonomy/${normalizedNote}`);
    batch.set(docRef, {
      note: group.note,
      normalizedNote: group.normalizedNote,
      categoryName: group.categoryName,
      count: group.count,
      lastSeenAt: group.lastSeenAt,
      createdAt: group.firstSeenAt,
      updatedAt: group.lastSeenAt,
    });
  }

  await batch.commit();
}
```

#### 7.5.4. Deduplication Strategy for Migrated Records

**Problem:** If the migration is interrupted (app crash, network error mid-migration) and re-run, events could be duplicated. Additionally, the source SQLite data may overlap with data already synced to Firestore via the source app's `syncSessionToFirestore()`.

**Deduplication at migration time:**

1. **Migration marker:** The `.migration-complete` marker file prevents the migration from running twice. If the marker exists, the migration is skipped entirely — even if only partial data was migrated.

2. **Idempotent migration chunking:** Each chunk is written to Firestore using `addDoc()` (auto-generated IDs). If a chunk is written twice due to a retry, duplicate events are created. This is handled post-migration by Cloud Functions.

3. **Cloud Function deduplication:** When Cloud Functions process events with `migrated: true`, they use the following deduplication strategy:
   - For `TimerStarted`/`TimerCompleted` pairs: check if a daily aggregate for that date already includes the session's `durationSeconds`. If the aggregate's `totalFocusSeconds` would exceed a plausible daily maximum (e.g., 24 hours), flag the duplicate.
   - For `DistractionLogged`: check if a taxonomy document already has a `count` equal to or greater than the migrated total. If so, skip incrementing.

4. **Pre-migration cleanup of source Firestore data:** Before writing migrated events, the Angular migration service queries the EXISTING flat `sessions` and `distractions` collections (source schema) for documents with `userId == uid`. If found, these are counted but NOT deleted (the target user-scoped collections are separate from the source flat collections). The migration proceeds regardless — the old flat collections are orphaned and can be cleaned up later by an admin Cloud Function.

**Migration progress tracking:**

The Angular migration service tracks progress via a local `migration-progress` key in `localStorage`:

```typescript
interface MigrationProgress {
  totalSessions: number;
  totalDistractions: number;
  migratedSessions: number;
  migratedDistractions: number;
  lastChunkIndex: number;
  startedAt: string;
}
```

If the app restarts during migration, the service reads `localStorage` and resumes from `lastChunkIndex + 1`. This prevents re-writing already-migrated chunks.

**Post-migration verification:**

After migration completes, the Angular migration service displays a summary:

```
Migration Complete
  Sessions migrated: 142
  Distractions migrated: 387
  Taxonomy categories created: 8
  
  Your historical data is now available in Reports.
  The original database has been backed up to sentinel.db.migrated.
```

---

### 7.6. Angular Service Architecture for Sync

This subsection provides a structural overview of how the sync-related Angular services are organized and how they interact.

**Service dependency graph:**

```
┌─────────────────────────────────────────────────────────────┐
│                    Angular Services                          │
│                                                             │
│  ┌──────────────┐    ┌──────────────────┐                   │
│  │  AuthService  │◄──┤  All services    │ (provides uid)    │
│  └──────┬───────┘    └──────────────────┘                   │
│         │                                                    │
│  ┌──────▼───────┐    ┌──────────────────┐                   │
│  │  IpcService   │◄──┤  SettingsService │ (SAVE_SETTINGS)   │
│  └──────────────┘    │  TimerService    │ (SESSION_COMPLETE) │
│                      └──────────────────┘                   │
│                                                             │
│  ┌──────────────────────────────────────────────┐           │
│  │            EventLedgerService                 │           │
│  │  writeEvent() → addDoc(session_events)        │           │
│  └──────────────────┬───────────────────────────┘           │
│                     │                                        │
│  ┌──────────────────▼───────────────────────────┐           │
│  │  Used by:                                     │           │
│  │  • TimerService (start, pause, complete, end) │           │
│  │  • IpcDispatchService (idle detected)         │           │
│  │  • InterventionComponent (distraction, false) │           │
│  └──────────────────────────────────────────────┘           │
│                                                             │
│  ┌──────────────────┐  ┌────────────────────┐               │
│  │ TaxonomyService   │  │  SettingsService   │               │
│  │ upsertMapping()   │  │  updateSettings()  │               │
│  │ renameCategory()  │  │  attachListener()  │               │
│  │ deleteCategory()  │  └────────────────────┘               │
│  │ attachListener()  │                                       │
│  └──────────────────┘  ┌────────────────────┐               │
│                        │  PlannerService     │               │
│  ┌──────────────────┐  │  createBlock()      │               │
│  │  ReportService    │  │  updateBlock()     │               │
│  │  loadReport()     │  │  deleteBlock()     │               │
│  │  attachListeners()│  └────────────────────┘               │
│  └──────────────────┘                                       │
│                        ┌────────────────────┐               │
│                        │ AchievementService  │               │
│                        │ attachListener()    │               │
│                        └────────────────────┘               │
│                                                             │
│  ┌──────────────────────────────────────────────┐           │
│  │           MigrationService                    │           │
│  │  checkMigration() → startMigration()          │           │
│  │  Uses: EventLedgerService, TaxonomyService    │           │
│  └──────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

**Sync data flow summary (complete lifecycle for a single session):**

```
1. User clicks "Start Focus"
   → TimerService.startSession()
     → EventLedgerService.writeEvent({ type: 'TimerStarted', ... })
       → Firestore addDoc(users/{uid}/session_events) → IndexedDB cache + server queue

2. C# shell detects idle after 45s
   → IPC: IDLE_DETECTED → IpcDispatchService.handleIdleDetected()
     → TimerService.pauseTimer('intervention')
       → EventLedgerService.writeEvent({ type: 'IdleDetected', ... })
       → EventLedgerService.writeEvent({ type: 'TimerPaused', ... })

3. User logs distraction "Twitter" / "Social Media"
   → TimerService.logDistraction('Twitter', 'Social Media')
     → EventLedgerService.writeEvent({ type: 'DistractionLogged', ... })
     → TaxonomyService.upsertMapping('twitter', 'Twitter', 'Social Media')
       → Firestore setDoc(users/{uid}/taxonomy/twitter, { merge: true })

4. Timer reaches zero
   → TimerService.onTimerComplete()
     → EventLedgerService.writeEvent({ type: 'TimerCompleted', ... })
     → IpcService.send({ type: 'SESSION_COMPLETE' })

5. Cloud Function triggers (server-side, → §8)
   → onDocumentCreated(users/{uid}/session_events/{eventId})
     → Processes TimerCompleted event
     → Updates users/{uid}/stats/daily/{date}
     → Updates users/{uid}/stats/streaks
     → Checks achievement thresholds → writes users/{uid}/achievements/{id}

6. Angular snapshot listeners fire
   → ReportService: dailyStats signal updated with new aggregate
   → AchievementService: new badge appears in UI
```

---

### 7.7. Cross-Reference Table

| Section | Source File | Target File / Service | Status |
|---|---|---|---|
| §7.1.1 | `Sentinel.UI\src\firebase.ts` (`enableIndexedDbPersistence`) | `src/app/core/firebase.provider.ts` | PORTED to Angular DI |
| §7.1.2 | `Sentinel.UI\src\App.tsx` (`pendingSyncsRef`, `syncSessionToFirestore`) | ELIMINATED — Firestore native queue | REPLACED |
| §7.1.3 | *(implicit in source)* | Documented conflict resolution strategy | NEW |
| §7.2.1 | `Sentinel.UI\src\App.tsx` (`addDoc` calls) | `SettingsService`, `TaxonomyService`, `PlannerService` | RESTRUCTURED into Angular services |
| §7.2.2 | *(not in source — no snapshot listeners)* | `onSnapshot` listeners in all services | NEW |
| §7.2.3 | *(implicit Firestore cache behavior)* | Documented read priority strategy | NEW |
| §7.3.1 | `Sentinel.UI\src\App.tsx` (`syncSessionToFirestore`, `submitDistraction`) | `EventLedgerService.writeEvent()`, `TimerService` | RESTRUCTURED — 7 event types replace 2 flat writes |
| §7.3.2 | *(source allows update/delete)* | Append-only enforcement at 3 levels | NEW |
| §7.3.3 | `Sentinel.UI\src\App.tsx` (`pendingSyncsRef`) | ELIMINATED | REPLACED by Firestore native queue |
| §7.3.4 | `Sentinel.UI\src\App.tsx` (`serverTimestamp()`) | Client ISO 8601 strings | CHANGED |
| §7.3.5 | *(source uses mutable state documents)* | Anti-tampering rationale documented | NEW |
| §7.4.1 | `firestore.rules` (`resource.data.userId == request.auth.uid`) | `request.auth.uid == uid` (path-based) | CHANGED |
| §7.4.2 | `firestore.rules` (`allow update, delete` on sessions) | `allow update, delete: if false` on events | CHANGED |
| §7.4.3 | *(not in source)* | Read-only rules for stats/achievements | NEW |
| §7.4.4 | *(not in source)* | Rate limiting strategy documented | NEW |
| §7.5.1 | `Sentinel.Engine\SentinelDbContext.cs` (SQLite source) | `MigrationService` (C# reader + Angular writer) | NEW |
| §7.5.2 | `Sentinel.Engine\Models.cs` (`Session`) | Session → Event pair conversion | NEW |
| §7.5.3 | `Sentinel.Engine\Models.cs` (`Distraction`) | Distraction → Event conversion + taxonomy backfill | NEW |
| §7.5.4 | *(not in source)* | Deduplication strategy documented | NEW |
| §7.6 | `Sentinel.UI\src\App.tsx` (monolithic) | Angular service dependency graph | RESTRUCTURED |

