## 8. Cloud Functions — Server-Side Authority & Gamification

This section specifies the complete Firebase Cloud Functions backend that processes the Event Ledger, computes aggregates, tracks streaks, awards achievements, and implements the gamification mechanics. Every computation in this section runs exclusively on the server. The Angular client NEVER computes gamification metrics — it only reads the results from Firestore documents written by these functions.

**Governing directive** (TARGET_ARCHITECTURE.md §6):

> To prevent users from cheating by editing local IndexedDB or SQLite files, all gamification logic is strictly server-side.
> - **Ledger Processing:** Firebase Cloud Functions listen to `onDocumentCreated` triggers on the `session_events` collection.
> - **Calculations:** The server processes the immutable events to calculate total focus time, daily streaks, and distraction recovery times.

**Source codebase equivalent:**

The source application has NO server-side processing. All calculations are performed client-side:
- `ReportingService.cs` (`Sentinel.Engine\ReportingService.cs`) — C# service that queries SQLite to compute `ReportData` (total focus seconds, sessions completed, distractions count, daily breakdown, top categories, top distractions, recent sessions). This logic is ELIMINATED in the target and replaced by Cloud Functions.
- `App.tsx:fetchFirestoreHistory()` — React function that reads flat `sessions` and `distractions` Firestore collections and merges counts with local SQLite data using `Math.max()`. This logic is ELIMINATED.

**What Section 8 replaces:**

| Source Component | Source Location | Cloud Function Replacement |
|---|---|---|
| `ReportingService.GetReportDataAsync()` | `Sentinel.Engine\ReportingService.cs` | §8.3 Focus Time Calculation + §8.3.4 Daily Aggregate |
| `App.tsx:fetchFirestoreHistory()` | `Sentinel.UI\src\App.tsx` lines 710–759 | §8.3.4 Daily Aggregate (Angular reads aggregates, not raw events) |
| *(no source equivalent)* | — | §8.4 Streak Tracking Engine |
| *(no source equivalent)* | — | §8.5 Achievement & Badge System |
| *(no source equivalent)* | — | §8.6 Swift Recovery Multiplier |
| *(no source equivalent)* | — | §8.7 Shiny Badge RNG System |

---

### 8.1. Function Deployment & Configuration

#### 8.1.1. Firebase Functions Runtime (Node.js / TypeScript)

Cloud Functions are written in TypeScript and run on the Firebase Functions (2nd gen) runtime, which uses Cloud Run under the hood.

**Project structure:**

```
functions/
  package.json
  tsconfig.json
  .eslintrc.js
  src/
    index.ts                     ← Function exports (entry point)
    config.ts                    ← Environment configuration
    types.ts                     ← Shared TypeScript interfaces
    pipeline/
      event-processor.ts         ← Main onDocumentCreated handler
      event-validator.ts         ← Schema validation
      idempotency.ts             ← Double-processing guard
      event-dispatcher.ts        ← Route to type-specific handlers
    handlers/
      timer-completed.ts         ← TimerCompleted / TimerEndedEarly
      distraction-logged.ts      ← DistractionLogged + Swift Recovery
      false-alarm.ts             ← FalseAlarmMarked
      idle-detected.ts           ← IdleDetected (no-op currently, reserved)
      timer-started.ts           ← TimerStarted (no-op currently, reserved)
      timer-paused.ts            ← TimerPaused (no-op currently, reserved)
    engines/
      daily-aggregate.ts         ← Daily stats computation
      streak.ts                  ← Streak tracking
      achievement.ts             ← Achievement check pipeline
      swift-recovery.ts          ← Swift Recovery Multiplier
      shiny-badge.ts             ← Shiny Badge RNG system
```

**`package.json` (key dependencies):**

```json
{
  "name": "sentinel-functions",
  "main": "lib/index.js",
  "engines": {
    "node": "20"
  },
  "dependencies": {
    "firebase-admin": "^12.0.0",
    "firebase-functions": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint": "^8.57.0"
  },
  "scripts": {
    "build": "tsc",
    "serve": "firebase emulators:start --only functions",
    "deploy": "firebase deploy --only functions",
    "test": "jest --config jest.config.js"
  }
}
```

**`tsconfig.json`:**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "outDir": "lib",
    "sourceMap": true,
    "strict": true,
    "target": "es2022",
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "compileOnSave": true,
  "include": ["src"]
}
```

**Function entry point** (`src/index.ts`):

```typescript
// File: functions/src/index.ts

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { processSessionEvent } from './pipeline/event-processor';
import { FUNCTION_CONFIG } from './config';

// Global configuration for all functions
setGlobalOptions({
  region: FUNCTION_CONFIG.region,
  memory: FUNCTION_CONFIG.memory,
  timeoutSeconds: FUNCTION_CONFIG.timeoutSeconds,
});

/**
 * Main trigger: fires whenever a new event is created in any user's session_events collection.
 *
 * This is the ONLY Cloud Function trigger. All processing fans out from here
 * via the event dispatcher (→ §8.2.4).
 */
export const onSessionEventCreated = onDocumentCreated(
  'users/{uid}/session_events/{eventId}',
  async (event) => {
    await processSessionEvent(event);
  },
);
```

#### 8.1.2. Region & Memory Allocation

**Configuration** (`src/config.ts`):

```typescript
// File: functions/src/config.ts

export const FUNCTION_CONFIG = {
  /** Firebase Functions region. Use the region closest to the majority of users. */
  region: 'us-central1',

  /** Memory allocation. 256MB is sufficient for event processing. */
  memory: '256MiB' as const,

  /** Timeout in seconds. Event processing should complete in <10s. */
  timeoutSeconds: 60,

  /** Maximum instances to prevent runaway scaling. */
  maxInstances: 100,

  /**
   * Minimum focus seconds to count a day toward a streak.
   * A user must complete at least this many seconds of focused work
   * for the day to count. Default: 0 (any completed session counts).
   */
  streakMinimumFocusSeconds: 0,

  /**
   * Swift Recovery threshold in milliseconds.
   * If the user logs a distraction within this duration after IdleDetected,
   * they earn a Swift Recovery bonus.
   */
  swiftRecoveryThresholdMs: 60_000,

  /**
   * Swift Recovery speed tiers (ms thresholds).
   * Each tier awards a different multiplier.
   */
  swiftRecoveryTiers: {
    instant: 15_000,   // < 15 seconds
    fast: 30_000,      // < 30 seconds
    swift: 60_000,     // < 60 seconds
  },

  /**
   * Shiny badge drop rate (probability out of 1.0).
   * On a perfect session, the RNG rolls this chance.
   */
  shinyBadgeDropRate: 0.05, // 5% base chance

  /**
   * Maximum plausible session duration in seconds.
   * Events claiming longer durations are rejected.
   */
  maxSessionDurationSeconds: 86_400, // 24 hours

  /**
   * Maximum acceptable clock skew in milliseconds.
   * Events with timestamps more than this far in the future are rejected.
   */
  maxClockSkewMs: 5 * 60 * 1000, // 5 minutes
} as const;
```

**Scaling rationale:**

- **256MiB memory:** Event processing reads 1-3 Firestore documents and writes 1-3 documents. No large data sets, no image processing, no ML inference. 256MiB is more than sufficient.
- **60s timeout:** Normal processing completes in 1-5 seconds. The 60s timeout is a safety net for cases where Firestore reads are slow (cold region, network latency).
- **100 max instances:** At peak, a single user generates ~40 events/hour. With 1,000 concurrent users, that's 40,000 events/hour = ~11 events/second. Each function invocation takes <5s, so 100 instances can handle 20+ events/second with headroom.

#### 8.1.3. Environment Variables & Secrets

Cloud Functions do not require external API keys or secrets for Firestore operations — the Firebase Admin SDK authenticates automatically via the service account attached to the Cloud Functions runtime.

**No environment variables are needed for MVP.** All configuration is hardcoded in `config.ts`. If future requirements add external integrations (e.g., email notifications, Slack webhooks), secrets should be stored using Firebase Secret Manager:

```typescript
import { defineSecret } from 'firebase-functions/params';

const slackWebhookUrl = defineSecret('SLACK_WEBHOOK_URL');

export const onSessionEventCreated = onDocumentCreated(
  {
    document: 'users/{uid}/session_events/{eventId}',
    secrets: [slackWebhookUrl],
  },
  async (event) => {
    // Access via slackWebhookUrl.value()
  },
);
```

---

### 8.2. Event Ledger Processing Pipeline

The processing pipeline is the central nervous system of the Cloud Functions backend. Every event that enters the `session_events` collection flows through a four-stage pipeline:

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Event Processing Pipeline                        │
│                                                                      │
│  onDocumentCreated                                                   │
│  └─► Stage 1: Event Validation (§8.2.2)                             │
│       └─► Stage 2: Idempotency Guard (§8.2.3)                      │
│            └─► Stage 3: Event Dispatcher (§8.2.4)                   │
│                 └─► Stage 4: Type-Specific Handler                  │
│                      ├─► TimerCompleted → DailyAggregate → Streak   │
│                      │                  → Achievement → ShinyBadge  │
│                      ├─► TimerEndedEarly → DailyAggregate → Streak  │
│                      │                   → Achievement              │
│                      ├─► DistractionLogged → DailyAggregate         │
│                      │                    → SwiftRecovery           │
│                      │                    → Achievement             │
│                      ├─► FalseAlarmMarked → DailyAggregate          │
│                      ├─► IdleDetected → (no-op, reserved)           │
│                      ├─► TimerStarted → (no-op, reserved)           │
│                      └─► TimerPaused → (no-op, reserved)            │
└──────────────────────────────────────────────────────────────────────┘
```

#### 8.2.1. `onDocumentCreated` Trigger on `users/{uid}/session_events/{eventId}`

**Trigger path:** `users/{uid}/session_events/{eventId}`

**How `onDocumentCreated` works:**

1. When Angular writes a new event document via `addDoc()`, Firestore creates the document in the server database.
2. Firestore emits a `create` event to Cloud Functions.
3. The Cloud Function receives a `FirestoreEvent` object containing:
   - `event.data` — a `QueryDocumentSnapshot` with the full document data.
   - `event.params.uid` — the `{uid}` path parameter (the authenticated user's UID).
   - `event.params.eventId` — the `{eventId}` path parameter (the auto-generated document ID).

**Important timing detail:** The trigger fires when the document reaches the Firestore SERVER, not when it's written to the client's local IndexedDB cache. If the client is offline, the trigger fires when the client comes back online and the pending write syncs.

**Pipeline entry point** (`src/pipeline/event-processor.ts`):

```typescript
// File: functions/src/pipeline/event-processor.ts

import { FirestoreEvent, QueryDocumentSnapshot } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { validateEvent } from './event-validator';
import { checkIdempotency, markProcessed } from './idempotency';
import { dispatchEvent } from './event-dispatcher';
import type { SessionEvent } from '../types';

export async function processSessionEvent(
  event: FirestoreEvent<QueryDocumentSnapshot | undefined>,
): Promise<void> {
  const snapshot = event.data;
  if (!snapshot) {
    logger.warn('Event triggered with no data', { eventId: event.params.eventId });
    return;
  }

  const uid = event.params.uid;
  const eventId = event.params.eventId;
  const rawData = snapshot.data();

  // Stage 1: Validate event schema
  const validatedEvent = validateEvent(rawData, eventId);
  if (!validatedEvent) {
    logger.error('Event validation failed', { uid, eventId, rawData });
    return;
  }

  // Stage 2: Idempotency guard
  const alreadyProcessed = await checkIdempotency(uid, eventId);
  if (alreadyProcessed) {
    logger.info('Event already processed, skipping', { uid, eventId });
    return;
  }

  // Stage 3 + 4: Dispatch to type-specific handler
  try {
    await dispatchEvent(uid, eventId, validatedEvent);
    await markProcessed(uid, eventId, validatedEvent.type);
    logger.info('Event processed successfully', {
      uid,
      eventId,
      type: validatedEvent.type,
      sessionId: validatedEvent.sessionId,
    });
  } catch (error) {
    logger.error('Event processing failed', { uid, eventId, error });
    throw error; // Rethrow to trigger Cloud Functions retry
  }
}
```

#### 8.2.2. Event Validation & Schema Enforcement

The validator ensures every event conforms to the `SessionEvent` envelope and that payload fields are plausible. This is the server-side complement to the Firestore security rules (→ §7.4.2), which perform basic type checks but not semantic validation.

**Shared types** (`src/types.ts`):

```typescript
// File: functions/src/types.ts

export type SessionEventType =
  | 'TimerStarted'
  | 'TimerPaused'
  | 'TimerCompleted'
  | 'TimerEndedEarly'
  | 'IdleDetected'
  | 'DistractionLogged'
  | 'FalseAlarmMarked';

export const VALID_EVENT_TYPES: ReadonlySet<string> = new Set<SessionEventType>([
  'TimerStarted',
  'TimerPaused',
  'TimerCompleted',
  'TimerEndedEarly',
  'IdleDetected',
  'DistractionLogged',
  'FalseAlarmMarked',
]);

export interface SessionEvent {
  type: SessionEventType;
  sessionId: string;
  timestamp: string;
  payload: Record<string, unknown>;
  migrated?: boolean;
}

export interface TimerStartedPayload {
  durationSeconds: number;
  sessionName: string | null;
  startedAt: string;
  timerMode: string;
  presetName: string | null;
}

export interface TimerPausedPayload {
  pausedAt: string;
  timeLeftSeconds: number;
  reason: 'manual' | 'intervention' | 'suspend';
}

export interface TimerCompletedPayload {
  durationSeconds: number;
  sessionName: string | null;
  startedAt: string;
  completedAt: string;
  endedEarly: boolean;
  distractionCount: number;
  falseAlarmCount: number;
}

export interface IdleDetectedPayload {
  idleDurationMs: number;
  timerTimeLeftSeconds: number;
}

export interface DistractionLoggedPayload {
  note: string;
  normalizedNote: string;
  categoryName: string | null;
}

// FalseAlarmMarked has empty payload: {}

export interface DailyStatsDocument {
  date: string;
  totalFocusSeconds: number;
  sessionsCompleted: number;
  sessionsEndedEarly: number;
  distractionsLogged: number;
  falseAlarms: number;
  avgSessionSeconds: number;
  longestSessionSeconds: number;
  swiftRecoveryCount: number;
  updatedAt: string;
}

export interface StreakDocument {
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string;
  streakStartDate: string;
  updatedAt: string;
}

export interface AchievementDocument {
  achievementId: string;
  tier: 'bronze' | 'silver' | 'gold';
  category: 'focus' | 'streak' | 'recovery' | 'perfect';
  title: string;
  description: string;
  earnedAt: string;
  isShiny: boolean;
  progress: {
    current: number;
    target: number;
  };
}
```

**Validator implementation** (`src/pipeline/event-validator.ts`):

```typescript
// File: functions/src/pipeline/event-validator.ts

import { logger } from 'firebase-functions/v2';
import { VALID_EVENT_TYPES, FUNCTION_CONFIG } from '../config';
import type { SessionEvent } from '../types';

/**
 * Validates the raw Firestore document data against the SessionEvent schema.
 * Returns a typed SessionEvent if valid, or null if invalid.
 */
export function validateEvent(
  data: Record<string, unknown>,
  eventId: string,
): SessionEvent | null {
  // Required string fields
  if (typeof data.type !== 'string' || !VALID_EVENT_TYPES.has(data.type)) {
    logger.warn('Invalid event type', { eventId, type: data.type });
    return null;
  }

  if (typeof data.sessionId !== 'string' || data.sessionId.length === 0) {
    logger.warn('Missing or empty sessionId', { eventId });
    return null;
  }

  if (typeof data.timestamp !== 'string' || data.timestamp.length === 0) {
    logger.warn('Missing or empty timestamp', { eventId });
    return null;
  }

  // Validate timestamp is parseable ISO 8601
  const ts = Date.parse(data.timestamp);
  if (isNaN(ts)) {
    logger.warn('Unparseable timestamp', { eventId, timestamp: data.timestamp });
    return null;
  }

  // Reject future-dated events (clock skew protection)
  const now = Date.now();
  if (ts > now + FUNCTION_CONFIG.maxClockSkewMs) {
    logger.warn('Future-dated event rejected', {
      eventId,
      timestamp: data.timestamp,
      skewMs: ts - now,
    });
    return null;
  }

  // Reject events older than 1 year (stale data protection)
  const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
  if (ts < oneYearAgo) {
    logger.warn('Event older than 1 year rejected', { eventId, timestamp: data.timestamp });
    return null;
  }

  // Payload must be an object
  if (typeof data.payload !== 'object' || data.payload === null || Array.isArray(data.payload)) {
    logger.warn('Invalid payload (not an object)', { eventId });
    return null;
  }

  // Type-specific payload validation
  const payload = data.payload as Record<string, unknown>;

  if (data.type === 'TimerCompleted' || data.type === 'TimerEndedEarly') {
    if (typeof payload.durationSeconds !== 'number' || payload.durationSeconds <= 0) {
      logger.warn('Invalid durationSeconds', { eventId, durationSeconds: payload.durationSeconds });
      return null;
    }
    if (payload.durationSeconds > FUNCTION_CONFIG.maxSessionDurationSeconds) {
      logger.warn('Session duration exceeds maximum', {
        eventId,
        durationSeconds: payload.durationSeconds,
        max: FUNCTION_CONFIG.maxSessionDurationSeconds,
      });
      return null;
    }
    if (typeof payload.startedAt !== 'string' || typeof payload.completedAt !== 'string') {
      logger.warn('Missing startedAt or completedAt', { eventId });
      return null;
    }
    if (typeof payload.endedEarly !== 'boolean') {
      logger.warn('Missing endedEarly flag', { eventId });
      return null;
    }
  }

  if (data.type === 'DistractionLogged') {
    if (typeof payload.note !== 'string') {
      logger.warn('Missing distraction note', { eventId });
      return null;
    }
    if (typeof payload.normalizedNote !== 'string') {
      logger.warn('Missing normalizedNote', { eventId });
      return null;
    }
  }

  if (data.type === 'IdleDetected') {
    if (typeof payload.idleDurationMs !== 'number') {
      logger.warn('Missing idleDurationMs', { eventId });
      return null;
    }
  }

  if (data.type === 'TimerStarted') {
    if (typeof payload.durationSeconds !== 'number' || payload.durationSeconds <= 0) {
      logger.warn('Invalid durationSeconds on TimerStarted', { eventId });
      return null;
    }
  }

  return {
    type: data.type as SessionEvent['type'],
    sessionId: data.sessionId as string,
    timestamp: data.timestamp as string,
    payload,
    migrated: data.migrated === true ? true : undefined,
  };
}
```

#### 8.2.3. Idempotency Guard (Prevent Double-Processing)

Cloud Functions guarantee "at least once" delivery — the same event may trigger the function multiple times (e.g., due to retries after transient errors). The idempotency guard prevents double-counting by tracking which events have already been processed.

**Strategy: Processed events subcollection.**

Each processed event is recorded in a lightweight subcollection:
```
users/{uid}/processed_events/{eventId}
```

This document contains only the event type and processing timestamp. It exists solely as a deduplication marker.

**Implementation** (`src/pipeline/idempotency.ts`):

```typescript
// File: functions/src/pipeline/idempotency.ts

import { getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();

/**
 * Check if an event has already been processed.
 * Returns true if the event should be SKIPPED (already processed).
 */
export async function checkIdempotency(uid: string, eventId: string): Promise<boolean> {
  const docRef = db.doc(`users/${uid}/processed_events/${eventId}`);
  const snapshot = await docRef.get();
  return snapshot.exists;
}

/**
 * Mark an event as processed.
 * Called AFTER all handlers complete successfully.
 */
export async function markProcessed(
  uid: string,
  eventId: string,
  eventType: string,
): Promise<void> {
  const docRef = db.doc(`users/${uid}/processed_events/${eventId}`);
  await docRef.set({
    eventType,
    processedAt: new Date().toISOString(),
  });
}
```

**Firestore security rule for `processed_events`:**

```
match /users/{uid}/processed_events/{eventId} {
  // Clients never read or write processed_events. Only Cloud Functions (Admin SDK).
  allow read, write: if false;
}
```

**Trade-off:** Each event creates an additional Firestore document in `processed_events`. This doubles the Firestore write cost per event. The alternative (using a `processed: true` flag on the event document itself) would require `update` permission on `session_events`, which breaks the append-only security model (→ §7.4.2). The separate subcollection preserves event immutability.

**Cleanup:** `processed_events` documents can be periodically cleaned up by a scheduled Cloud Function (e.g., delete documents older than 30 days). Processing is idempotent even if the marker is cleaned up — the worst case is a re-computation of aggregates, which is additive and harmless because the aggregate update logic uses atomic increments.

#### 8.2.4. Event Type Dispatcher (Route to Appropriate Handler)

The dispatcher reads the `type` field from the validated event and routes to the appropriate handler function.

**Implementation** (`src/pipeline/event-dispatcher.ts`):

```typescript
// File: functions/src/pipeline/event-dispatcher.ts

import { logger } from 'firebase-functions/v2';
import type { SessionEvent } from '../types';
import { handleTimerCompleted } from '../handlers/timer-completed';
import { handleDistractionLogged } from '../handlers/distraction-logged';
import { handleFalseAlarm } from '../handlers/false-alarm';

/**
 * Dispatch a validated event to the appropriate type-specific handler.
 *
 * NOT all event types have handlers. TimerStarted, TimerPaused, and
 * IdleDetected are currently no-ops (reserved for future analytics).
 * They are still validated and their idempotency is tracked, but no
 * aggregate writes occur.
 */
export async function dispatchEvent(
  uid: string,
  eventId: string,
  event: SessionEvent,
): Promise<void> {
  switch (event.type) {
    case 'TimerCompleted':
    case 'TimerEndedEarly':
      await handleTimerCompleted(uid, eventId, event);
      break;

    case 'DistractionLogged':
      await handleDistractionLogged(uid, eventId, event);
      break;

    case 'FalseAlarmMarked':
      await handleFalseAlarm(uid, eventId, event);
      break;

    case 'TimerStarted':
    case 'TimerPaused':
    case 'IdleDetected':
      // No-op for now. These events are stored for analytics and
      // future features (e.g., "time in pause" metrics, idle frequency analysis).
      logger.info('Event stored (no processing required)', {
        type: event.type,
        eventId,
      });
      break;

    default:
      logger.warn('Unknown event type in dispatcher', { type: event.type, eventId });
      break;
  }
}
```

**Why some event types are no-ops:**

| Event Type | Current Processing | Future Use |
|---|---|---|
| `TimerStarted` | None (stored only) | Session start analytics, active user tracking |
| `TimerPaused` | None (stored only) | "Time in pause" metrics, pause frequency analysis |
| `IdleDetected` | None (directly) | Looked up by Swift Recovery handler (→ §8.6.2). Not processed as a standalone trigger. |
| `TimerCompleted` | Full processing | — |
| `TimerEndedEarly` | Full processing | — |
| `DistractionLogged` | Full processing | — |
| `FalseAlarmMarked` | Counter increment only | — |

---

### 8.3. Focus Time Calculation Engine

The Focus Time Calculation Engine is the server-side replacement for the source `ReportingService.GetReportDataAsync()` (`Sentinel.Engine\ReportingService.cs`). In the source, this C# service queries SQLite to compute totals. In the target, Cloud Functions compute the same totals from Event Ledger events and write them to Firestore aggregate documents.

**Source computation** (from `ReportingService.cs` lines 68–82):

```csharp
var completedSessions = sessions.Where(s => s.CompletedAt.HasValue).ToList();
var actualDistractions = distractions
    .Where(d => !d.IsFalseAlarm && !string.IsNullOrWhiteSpace(d.NormalizedNote))
    .ToList();

var report = new ReportData
{
    TotalFocusSeconds = completedSessions.Sum(s => s.DurationSeconds),
    SessionsCompleted = completedSessions.Count,
    DistractionsLogged = actualDistractions.Count,
    FalseAlarms = distractions.Count(d => d.IsFalseAlarm),
    AvgSessionSeconds = completedSessions.Count > 0
        ? completedSessions.Average(s => s.DurationSeconds)
        : 0,
};
```

**Target replacement:** Each `TimerCompleted`, `TimerEndedEarly`, `DistractionLogged`, and `FalseAlarmMarked` event triggers an incremental update to the daily aggregate document. No batch query of all events is needed — the aggregate is maintained in real time.

#### 8.3.1. Session Duration Derivation from `TimerStarted` → `TimerCompleted` Event Pairs

**Source approach:**

In the source, `Session.DurationSeconds` is set by the React frontend at session completion:
- For `TimerCompleted`: `settings.pomodoroMinutes * 60` (full configured duration).
- For `TimerEndedEarly`: `totalDuration - timeLeft` (actual elapsed time).

The source stores this as a single field on the Session SQLite row.

**Target approach:**

The target uses the `durationSeconds` field from the `TimerCompleted` or `TimerEndedEarly` event payload. This value is computed identically by the Angular frontend (→ §7.3.1) and is the authoritative source for focus time.

**Server-side validation of `durationSeconds`:**

The Cloud Function does NOT blindly trust the client-supplied `durationSeconds`. It cross-validates:

```typescript
// File: functions/src/handlers/timer-completed.ts (excerpt)

function validateDuration(event: SessionEvent): number | null {
  const payload = event.payload as TimerCompletedPayload;
  const durationSeconds = payload.durationSeconds;

  // Reject non-positive or absurdly large durations
  if (durationSeconds <= 0 || durationSeconds > FUNCTION_CONFIG.maxSessionDurationSeconds) {
    return null;
  }

  // Cross-validate with startedAt/completedAt timestamps
  const startedAt = Date.parse(payload.startedAt);
  const completedAt = Date.parse(payload.completedAt);

  if (isNaN(startedAt) || isNaN(completedAt)) {
    return null;
  }

  const wallClockDuration = (completedAt - startedAt) / 1000;

  // Allow 10% tolerance for clock drift and pause time
  // (pauses aren't deducted from durationSeconds because
  // durationSeconds represents actual focused work time)
  if (durationSeconds > wallClockDuration * 1.1 + 60) {
    // Duration claims more focused time than wall clock allows
    // (+60s grace for timing precision)
    return null;
  }

  return durationSeconds;
}
```

**Why not compute duration from `TimerStarted` timestamps?**

Computing duration purely from `TimerStarted.timestamp` to `TimerCompleted.timestamp` would yield wall-clock time, not focused time. The user may have paused the timer, been interrupted by interventions, or had the system go to sleep. The client-supplied `durationSeconds` already accounts for pauses. The server validates it's plausible but trusts it within bounds.

#### 8.3.2. Idle Time Deduction: Subtract `IdleDetected` → `DistractionLogged` Intervals

**Source behavior:** The source does NOT deduct idle time from session duration. `Session.DurationSeconds` in SQLite is the total time from start to completion (or early end), including all idle intervals.

**Target behavior:** The target also does NOT deduct idle time from the `durationSeconds` field. The Angular frontend already pauses the timer during interventions (→ §5.5.1), so `durationSeconds` only counts time when the timer was actively counting down. Idle intervals are inherently excluded.

However, idle events are valuable for analytics. The Cloud Function tracks the number of idle interruptions per session and the total idle duration for future reporting:

```typescript
// This is reserved for future analytics. Currently, no idle deduction occurs.
// The IdleDetected event handler is a no-op (→ §8.2.4).
//
// Future enhancement: query all IdleDetected events for a sessionId,
// compute total idle time, and store as a session-level metric.
```

#### 8.3.3. Early End Handling: `TimerEndedEarly` Partial Credit Calculation

When a `TimerEndedEarly` event is processed, the Cloud Function treats it identically to a `TimerCompleted` event for aggregation purposes. The `durationSeconds` field reflects the actual focused time (not the configured duration), so partial credit is automatically correct.

**Difference in aggregate tracking:**

| Field | `TimerCompleted` Impact | `TimerEndedEarly` Impact |
|---|---|---|
| `totalFocusSeconds` | += `payload.durationSeconds` | += `payload.durationSeconds` |
| `sessionsCompleted` | += 1 | (not incremented) |
| `sessionsEndedEarly` | (not incremented) | += 1 |
| `avgSessionSeconds` | Recalculated | Recalculated |
| `longestSessionSeconds` | `max(current, durationSeconds)` | `max(current, durationSeconds)` |
| Streak tracking | Counts toward daily streak | Counts toward daily streak |
| Achievement: focus sessions | Counts toward total | Counts toward total |
| Achievement: perfect sessions | Eligible (if 0 distractions) | NOT eligible (endedEarly = true → not "perfect") |

#### 8.3.4. Daily Aggregate Update (`users/{uid}/stats/daily/{date}`)

The daily aggregate is the primary output of the Focus Time Calculation Engine. It is an incrementally-maintained document at `users/{uid}/stats/daily/{YYYY-MM-DD}` (→ §6.2.3.1).

**Handler implementation** (`src/handlers/timer-completed.ts`):

```typescript
// File: functions/src/handlers/timer-completed.ts

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import type { SessionEvent, TimerCompletedPayload } from '../types';
import { FUNCTION_CONFIG } from '../config';
import { updateStreak } from '../engines/streak';
import { checkAchievements } from '../engines/achievement';
import { checkShinyBadge } from '../engines/shiny-badge';

const db = getFirestore();

/**
 * Handle TimerCompleted and TimerEndedEarly events.
 *
 * 1. Validate duration
 * 2. Update daily aggregate
 * 3. Update streak
 * 4. Check achievements
 * 5. (TimerCompleted only) Check for shiny badge
 */
export async function handleTimerCompleted(
  uid: string,
  eventId: string,
  event: SessionEvent,
): Promise<void> {
  const payload = event.payload as TimerCompletedPayload;
  const durationSeconds = payload.durationSeconds;

  // Validate duration
  if (durationSeconds <= 0 || durationSeconds > FUNCTION_CONFIG.maxSessionDurationSeconds) {
    logger.warn('Invalid session duration, skipping', { uid, eventId, durationSeconds });
    return;
  }

  // Determine the calendar date from the event timestamp.
  // Use the event's timestamp (client-side) to determine the date.
  const eventDate = new Date(event.timestamp);
  const dateKey = formatDateKey(eventDate);

  const isCompleted = event.type === 'TimerCompleted';
  const isEndedEarly = event.type === 'TimerEndedEarly';

  // Step 1: Update daily aggregate
  const dailyRef = db.doc(`users/${uid}/stats/daily/${dateKey}`);
  const dailySnap = await dailyRef.get();

  if (dailySnap.exists) {
    // Incremental update
    const currentData = dailySnap.data()!;
    const currentTotal = (currentData.totalFocusSeconds as number) || 0;
    const currentCompleted = (currentData.sessionsCompleted as number) || 0;
    const currentEndedEarly = (currentData.sessionsEndedEarly as number) || 0;
    const currentLongest = (currentData.longestSessionSeconds as number) || 0;
    const totalSessions = currentCompleted + currentEndedEarly;

    const newTotal = currentTotal + durationSeconds;
    const newCompleted = isCompleted ? currentCompleted + 1 : currentCompleted;
    const newEndedEarly = isEndedEarly ? currentEndedEarly + 1 : currentEndedEarly;
    const newTotalSessions = newCompleted + newEndedEarly;
    const newAvg = newTotalSessions > 0 ? newTotal / newTotalSessions : 0;
    const newLongest = Math.max(currentLongest, durationSeconds);

    await dailyRef.update({
      totalFocusSeconds: newTotal,
      sessionsCompleted: newCompleted,
      sessionsEndedEarly: newEndedEarly,
      avgSessionSeconds: Math.round(newAvg * 100) / 100,
      longestSessionSeconds: newLongest,
      updatedAt: new Date().toISOString(),
    });
  } else {
    // First session of the day — create document
    await dailyRef.set({
      date: dateKey,
      totalFocusSeconds: durationSeconds,
      sessionsCompleted: isCompleted ? 1 : 0,
      sessionsEndedEarly: isEndedEarly ? 1 : 0,
      distractionsLogged: 0,
      falseAlarms: 0,
      avgSessionSeconds: durationSeconds,
      longestSessionSeconds: durationSeconds,
      swiftRecoveryCount: 0,
      updatedAt: new Date().toISOString(),
    });
  }

  // Step 2: Update streak
  await updateStreak(uid, dateKey);

  // Step 3: Check achievements
  await checkAchievements(uid, {
    type: event.type,
    durationSeconds,
    dateKey,
    sessionId: event.sessionId,
    distractionCount: payload.distractionCount ?? 0,
    endedEarly: payload.endedEarly,
  });

  // Step 4: Check shiny badge (only for naturally completed sessions)
  if (isCompleted && !payload.endedEarly && payload.distractionCount === 0) {
    await checkShinyBadge(uid, event.sessionId);
  }
}

/**
 * Format a Date object as YYYY-MM-DD string.
 * Uses UTC to ensure consistent date boundaries across timezones.
 */
function formatDateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}
```

**Distraction and false alarm counter updates** (`src/handlers/distraction-logged.ts`, `src/handlers/false-alarm.ts`):

```typescript
// File: functions/src/handlers/distraction-logged.ts

import { getFirestore } from 'firebase-admin/firestore';
import type { SessionEvent, DistractionLoggedPayload } from '../types';
import { checkSwiftRecovery } from '../engines/swift-recovery';
import { checkAchievements } from '../engines/achievement';

const db = getFirestore();

export async function handleDistractionLogged(
  uid: string,
  eventId: string,
  event: SessionEvent,
): Promise<void> {
  const payload = event.payload as DistractionLoggedPayload;
  const eventDate = new Date(event.timestamp);
  const dateKey = eventDate.toISOString().split('T')[0];

  // Step 1: Increment daily distraction counter
  const dailyRef = db.doc(`users/${uid}/stats/daily/${dateKey}`);
  const dailySnap = await dailyRef.get();

  if (dailySnap.exists) {
    const currentDistractions = (dailySnap.data()!.distractionsLogged as number) || 0;
    await dailyRef.update({
      distractionsLogged: currentDistractions + 1,
      updatedAt: new Date().toISOString(),
    });
  } else {
    // Edge case: distraction event arrives before session completion event.
    // Create a minimal daily doc that will be enriched by the session handler later.
    await dailyRef.set({
      date: dateKey,
      totalFocusSeconds: 0,
      sessionsCompleted: 0,
      sessionsEndedEarly: 0,
      distractionsLogged: 1,
      falseAlarms: 0,
      avgSessionSeconds: 0,
      longestSessionSeconds: 0,
      swiftRecoveryCount: 0,
      updatedAt: new Date().toISOString(),
    });
  }

  // Step 2: Check Swift Recovery (→ §8.6)
  await checkSwiftRecovery(uid, eventId, event);

  // Step 3: Check recovery achievements
  await checkAchievements(uid, {
    type: event.type,
    durationSeconds: 0,
    dateKey,
    sessionId: event.sessionId,
    distractionCount: 0,
    endedEarly: false,
  });
}
```

```typescript
// File: functions/src/handlers/false-alarm.ts

import { getFirestore } from 'firebase-admin/firestore';
import type { SessionEvent } from '../types';

const db = getFirestore();

export async function handleFalseAlarm(
  uid: string,
  eventId: string,
  event: SessionEvent,
): Promise<void> {
  const eventDate = new Date(event.timestamp);
  const dateKey = eventDate.toISOString().split('T')[0];

  const dailyRef = db.doc(`users/${uid}/stats/daily/${dateKey}`);
  const dailySnap = await dailyRef.get();

  if (dailySnap.exists) {
    const currentFalseAlarms = (dailySnap.data()!.falseAlarms as number) || 0;
    await dailyRef.update({
      falseAlarms: currentFalseAlarms + 1,
      updatedAt: new Date().toISOString(),
    });
  } else {
    await dailyRef.set({
      date: dateKey,
      totalFocusSeconds: 0,
      sessionsCompleted: 0,
      sessionsEndedEarly: 0,
      distractionsLogged: 0,
      falseAlarms: 1,
      avgSessionSeconds: 0,
      longestSessionSeconds: 0,
      swiftRecoveryCount: 0,
      updatedAt: new Date().toISOString(),
    });
  }
}
```

---

### 8.4. Streak Tracking Engine

The Streak Tracking Engine maintains the `users/{uid}/stats/streaks` document (→ §6.2.3.2). It fires after every `TimerCompleted` or `TimerEndedEarly` event to update the user's consecutive-day focus streak.

**Source equivalent:** There is no streak tracking in the source codebase. This is entirely NEW functionality specified in TARGET_ARCHITECTURE.md §6.

#### 8.4.1. Daily Completion Threshold (Minimum Focus Minutes to Count Day)

A day counts toward the streak if the user has at least one `TimerCompleted` or `TimerEndedEarly` event on that calendar date. The minimum focus threshold is configurable via `FUNCTION_CONFIG.streakMinimumFocusSeconds` (default: `0`, meaning any completed session counts).

**Future enhancement:** Allow users to set a personal daily minimum (e.g., "30 minutes of focus to count toward my streak"). This would be read from the user's settings document and passed to the streak engine.

#### 8.4.2. Current Streak Counter (Consecutive Days Meeting Threshold)

#### 8.4.3. Longest Streak Record

#### 8.4.4. Streak Recalculation on Missed Day

#### 8.4.5. Timezone Handling for Day Boundary Detection

**Streak engine implementation** (`src/engines/streak.ts`):

```typescript
// File: functions/src/engines/streak.ts

import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import type { StreakDocument } from '../types';

const db = getFirestore();

/**
 * Update the user's streak document after a session completion event.
 *
 * Streak rules (§8.4.2 – §8.4.4):
 *
 * - If lastActiveDate === today → no change (already counted today).
 * - If lastActiveDate === yesterday → increment currentStreak.
 * - If lastActiveDate is older than yesterday → streak broken, reset to 1.
 * - longestStreak = max(longestStreak, currentStreak). Never decreases.
 *
 * @param uid - The authenticated user's UID.
 * @param dateKey - The YYYY-MM-DD date of the event being processed.
 */
export async function updateStreak(uid: string, dateKey: string): Promise<void> {
  const streakRef = db.doc(`users/${uid}/stats/streaks`);
  const streakSnap = await streakRef.get();

  const now = new Date().toISOString();
  const today = dateKey;
  const yesterday = getPreviousDateKey(dateKey);

  if (!streakSnap.exists) {
    // First-ever session — initialize streak
    const newStreak: StreakDocument = {
      currentStreak: 1,
      longestStreak: 1,
      lastActiveDate: today,
      streakStartDate: today,
      updatedAt: now,
    };
    await streakRef.set(newStreak);
    logger.info('Streak initialized', { uid, dateKey });
    return;
  }

  const current = streakSnap.data() as StreakDocument;

  // §8.4.2: Already counted today
  if (current.lastActiveDate === today) {
    logger.info('Streak already counted for today', { uid, dateKey });
    return;
  }

  // §8.4.2: Consecutive day (yesterday → today)
  if (current.lastActiveDate === yesterday) {
    const newCurrentStreak = current.currentStreak + 1;
    const newLongestStreak = Math.max(current.longestStreak, newCurrentStreak);

    await streakRef.update({
      currentStreak: newCurrentStreak,
      longestStreak: newLongestStreak,
      lastActiveDate: today,
      updatedAt: now,
    });
    logger.info('Streak extended', {
      uid,
      dateKey,
      currentStreak: newCurrentStreak,
      longestStreak: newLongestStreak,
    });
    return;
  }

  // §8.4.4: Streak broken (gap of 1+ days)
  await streakRef.update({
    currentStreak: 1,
    streakStartDate: today,
    lastActiveDate: today,
    updatedAt: now,
  });
  logger.info('Streak reset', { uid, dateKey, previousLastActive: current.lastActiveDate });
}

/**
 * Get the YYYY-MM-DD string for the day before the given date.
 *
 * §8.4.5: Timezone handling — dateKey is computed from the event's
 * client-side ISO 8601 timestamp, which is in UTC. The day boundary
 * is therefore UTC midnight. This means a user in UTC-8 who completes
 * a session at 11 PM local time (7 AM next day UTC) will see it
 * counted toward the NEXT UTC day.
 *
 * For MVP, UTC day boundaries are acceptable. Future enhancement:
 * read the user's timezone from their settings and compute local
 * day boundaries server-side.
 */
function getPreviousDateKey(dateKey: string): string {
  const date = new Date(dateKey + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().split('T')[0];
}
```

**Timezone handling rationale (§8.4.5):**

The `dateKey` is derived from the event's `timestamp` field using `new Date(timestamp).toISOString().split('T')[0]`. Since the client emits timestamps in UTC (via `new Date().toISOString()`), the date boundary is UTC midnight.

**Impact on users in non-UTC timezones:**

- A user in UTC+5 who completes a session at 11:30 PM local time (6:30 PM UTC) has it counted toward the CURRENT UTC day — correct.
- A user in UTC-8 who completes a session at 11:30 PM local time (7:30 AM NEXT DAY UTC) has it counted toward the NEXT UTC day — may feel incorrect to the user.

**MVP acceptance:** UTC boundaries are acceptable for MVP. The streak is a motivational tool, not a legal contract. Users in extreme negative UTC offsets may see occasional "wrong day" counting, but the streak continuity logic (yesterday/today comparison) still works correctly — it's just shifted by their UTC offset.

**Future enhancement:** Store `timezoneOffset` (minutes) in the `TimerCompleted` event payload. The Cloud Function would then compute the local date key:

```typescript
// Future: const localDate = new Date(timestamp.getTime() - timezoneOffset * 60000);
// Future: const dateKey = localDate.toISOString().split('T')[0];
```

---

### 8.5. Achievement & Badge System

The Achievement System awards badges when users reach predefined milestones. All achievement evaluation runs server-side after aggregate documents are updated. The client CANNOT award achievements — it can only read the `users/{uid}/achievements/` subcollection.

#### 8.5.1. Tiered Achievements

Achievements are organized into 4 categories × 3 tiers = 12 total achievements. Each tier has a progressively higher threshold.

##### 8.5.1.1. Bronze Tier — Milestone Definitions

| Achievement ID | Category | Title | Description | Threshold | Metric Source |
|---|---|---|---|---|---|
| `focus_bronze` | Focus | First Steps | Complete 10 focus sessions. | 10 sessions | Cumulative `sessionsCompleted` + `sessionsEndedEarly` across all daily aggregates |
| `streak_bronze` | Streak | Building Habits | Maintain a 3-day focus streak. | 3-day streak | `stats/streaks.currentStreak >= 3` |
| `recovery_bronze` | Recovery | Quick Draw | Achieve 10 Swift Recoveries. | 10 recoveries | Cumulative `swiftRecoveryCount` across all daily aggregates |
| `perfect_bronze` | Perfect | Clean Block | Complete a session with 0 distractions and no early end. | 1 perfect session | Per-session check at `TimerCompleted` time |

##### 8.5.1.2. Silver Tier — Milestone Definitions

| Achievement ID | Category | Title | Description | Threshold | Metric Source |
|---|---|---|---|---|---|
| `focus_silver` | Focus | Focused Mind | Complete 50 focus sessions. | 50 sessions | Cumulative sessions |
| `streak_silver` | Streak | Consistent | Maintain a 7-day focus streak. | 7-day streak | `stats/streaks.currentStreak >= 7` |
| `recovery_silver` | Recovery | Reflexive | Achieve 50 Swift Recoveries. | 50 recoveries | Cumulative Swift Recovery count |
| `perfect_silver` | Perfect | Laser Focus | Complete 10 perfect sessions. | 10 perfect sessions | Cumulative perfect session count |

##### 8.5.1.3. Gold Tier — Milestone Definitions

| Achievement ID | Category | Title | Description | Threshold | Metric Source |
|---|---|---|---|---|---|
| `focus_gold` | Focus | Marathon Runner | Complete 200 focus sessions. | 200 sessions | Cumulative sessions |
| `streak_gold` | Streak | Unstoppable | Maintain a 30-day focus streak. | 30-day streak | `stats/streaks.currentStreak >= 30` |
| `recovery_gold` | Recovery | Lightning | Achieve 200 Swift Recoveries. | 200 recoveries | Cumulative Swift Recovery count |
| `perfect_gold` | Perfect | Untouchable | Complete 50 perfect sessions. | 50 perfect sessions | Cumulative perfect session count |

**Achievement definitions data** (`src/engines/achievement.ts` — definitions array):

```typescript
// File: functions/src/engines/achievement.ts (definitions)

export interface AchievementDefinition {
  achievementId: string;
  tier: 'bronze' | 'silver' | 'gold';
  category: 'focus' | 'streak' | 'recovery' | 'perfect';
  title: string;
  description: string;
  threshold: number;
}

export const ACHIEVEMENT_DEFINITIONS: ReadonlyArray<AchievementDefinition> = [
  // Focus achievements
  { achievementId: 'focus_bronze',    tier: 'bronze', category: 'focus',    title: 'First Steps',     description: 'Complete 10 focus sessions.',                         threshold: 10 },
  { achievementId: 'focus_silver',    tier: 'silver', category: 'focus',    title: 'Focused Mind',    description: 'Complete 50 focus sessions.',                         threshold: 50 },
  { achievementId: 'focus_gold',      tier: 'gold',   category: 'focus',    title: 'Marathon Runner',  description: 'Complete 200 focus sessions.',                        threshold: 200 },

  // Streak achievements
  { achievementId: 'streak_bronze',   tier: 'bronze', category: 'streak',   title: 'Building Habits', description: 'Maintain a 3-day focus streak.',                      threshold: 3 },
  { achievementId: 'streak_silver',   tier: 'silver', category: 'streak',   title: 'Consistent',      description: 'Maintain a 7-day focus streak.',                      threshold: 7 },
  { achievementId: 'streak_gold',     tier: 'gold',   category: 'streak',   title: 'Unstoppable',     description: 'Maintain a 30-day focus streak.',                     threshold: 30 },

  // Recovery achievements
  { achievementId: 'recovery_bronze', tier: 'bronze', category: 'recovery', title: 'Quick Draw',      description: 'Achieve 10 Swift Recoveries (< 60s response time).', threshold: 10 },
  { achievementId: 'recovery_silver', tier: 'silver', category: 'recovery', title: 'Reflexive',       description: 'Achieve 50 Swift Recoveries.',                       threshold: 50 },
  { achievementId: 'recovery_gold',   tier: 'gold',   category: 'recovery', title: 'Lightning',       description: 'Achieve 200 Swift Recoveries.',                      threshold: 200 },

  // Perfect session achievements
  { achievementId: 'perfect_bronze',  tier: 'bronze', category: 'perfect',  title: 'Clean Block',     description: 'Complete a session with 0 distractions.',             threshold: 1 },
  { achievementId: 'perfect_silver',  tier: 'silver', category: 'perfect',  title: 'Laser Focus',     description: 'Complete 10 perfect sessions.',                       threshold: 10 },
  { achievementId: 'perfect_gold',    tier: 'gold',   category: 'perfect',  title: 'Untouchable',     description: 'Complete 50 perfect sessions.',                       threshold: 50 },
] as const;
```

#### 8.5.2. Achievement Check Pipeline (Post-Aggregation Evaluation)

The achievement check runs AFTER the daily aggregate and streak documents are updated. It reads the current cumulative metrics and compares them against each achievement threshold.

**Implementation** (`src/engines/achievement.ts`):

```typescript
// File: functions/src/engines/achievement.ts

import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { ACHIEVEMENT_DEFINITIONS } from './achievement';
import type { AchievementDefinition, AchievementDocument, StreakDocument } from '../types';

const db = getFirestore();

export interface AchievementContext {
  type: string;          // Event type that triggered this check
  durationSeconds: number;
  dateKey: string;
  sessionId: string;
  distractionCount: number;
  endedEarly: boolean;
}

/**
 * Check all achievement thresholds and award any newly earned badges.
 *
 * This function is called after EVERY session completion and distraction event.
 * It reads current cumulative metrics and compares against thresholds.
 *
 * §8.5.4: Duplicate prevention — each achievement document is written with
 * the achievementId as the document ID. `set()` with `{ merge: false }` is
 * NOT used; instead, we check `exists` before writing to prevent overwriting
 * an existing achievement (which would reset `earnedAt`).
 */
export async function checkAchievements(
  uid: string,
  context: AchievementContext,
): Promise<void> {
  // Gather current metrics
  const metrics = await gatherMetrics(uid, context);

  // Check each achievement definition
  for (const definition of ACHIEVEMENT_DEFINITIONS) {
    const currentValue = getMetricValue(definition, metrics);
    if (currentValue === null || currentValue < definition.threshold) {
      continue;
    }

    // Threshold met — check if already awarded
    const achievementRef = db.doc(`users/${uid}/achievements/${definition.achievementId}`);
    const achievementSnap = await achievementRef.get();

    if (achievementSnap.exists) {
      // Already awarded — skip (§8.5.4)
      continue;
    }

    // Award the achievement
    const achievement: AchievementDocument = {
      achievementId: definition.achievementId,
      tier: definition.tier,
      category: definition.category,
      title: definition.title,
      description: definition.description,
      earnedAt: new Date().toISOString(),
      isShiny: false,
      progress: {
        current: currentValue,
        target: definition.threshold,
      },
    };

    await achievementRef.set(achievement);
    logger.info('Achievement awarded', {
      uid,
      achievementId: definition.achievementId,
      tier: definition.tier,
      currentValue,
    });
  }
}

interface CumulativeMetrics {
  totalSessions: number;
  totalSwiftRecoveries: number;
  totalPerfectSessions: number;
  currentStreak: number;
}

/**
 * Gather cumulative metrics from Firestore aggregate documents.
 */
async function gatherMetrics(
  uid: string,
  context: AchievementContext,
): Promise<CumulativeMetrics> {
  // Read all daily aggregate documents to compute lifetime totals
  const dailyCollection = db.collection(`users/${uid}/stats/daily`);
  const dailySnap = await dailyCollection.get();

  let totalSessions = 0;
  let totalSwiftRecoveries = 0;

  dailySnap.docs.forEach((doc) => {
    const data = doc.data();
    totalSessions += (data.sessionsCompleted || 0) + (data.sessionsEndedEarly || 0);
    totalSwiftRecoveries += (data.swiftRecoveryCount || 0);
  });

  // Read streak document
  const streakRef = db.doc(`users/${uid}/stats/streaks`);
  const streakSnap = await streakRef.get();
  const currentStreak = streakSnap.exists
    ? (streakSnap.data() as StreakDocument).currentStreak
    : 0;

  // Count perfect sessions.
  // A perfect session: TimerCompleted with distractionCount === 0 and endedEarly === false.
  // We need to query session_events for this. For efficiency, we track it as a counter
  // on the user's stats document.
  const perfectRef = db.doc(`users/${uid}/stats/perfect_sessions`);
  const perfectSnap = await perfectRef.get();
  let totalPerfectSessions = perfectSnap.exists
    ? (perfectSnap.data()!.count as number) || 0
    : 0;

  // If the current event is a perfect session, increment the counter
  if (
    (context.type === 'TimerCompleted') &&
    context.distractionCount === 0 &&
    !context.endedEarly
  ) {
    totalPerfectSessions += 1;
    await perfectRef.set({ count: totalPerfectSessions, updatedAt: new Date().toISOString() });
  }

  return {
    totalSessions,
    totalSwiftRecoveries,
    totalPerfectSessions,
    currentStreak,
  };
}

/**
 * Extract the relevant metric value for a given achievement definition.
 */
function getMetricValue(
  definition: AchievementDefinition,
  metrics: CumulativeMetrics,
): number | null {
  switch (definition.category) {
    case 'focus':
      return metrics.totalSessions;
    case 'streak':
      return metrics.currentStreak;
    case 'recovery':
      return metrics.totalSwiftRecoveries;
    case 'perfect':
      return metrics.totalPerfectSessions;
    default:
      return null;
  }
}
```

**Perfect sessions counter document:**

The achievement engine maintains an additional document at `users/{uid}/stats/perfect_sessions`:

```json
{
  "count": 7,
  "updatedAt": "2026-04-03T15:30:00.000Z"
}
```

This exists because counting perfect sessions would otherwise require scanning ALL `TimerCompleted` events and cross-referencing with `DistractionLogged` events for the same `sessionId` — an expensive operation. The counter is maintained incrementally.

**Firestore security rule for `perfect_sessions`:**

```
// Already covered by the wildcard:
// match /users/{uid}/stats/{document=**} {
//   allow read: if request.auth != null && request.auth.uid == uid;
//   allow write: if false;
// }
```

#### 8.5.3. Achievement Document Write (`users/{uid}/achievements/{achievementId}`)

Achievement documents are written to `users/{uid}/achievements/{achievementId}` with the `achievementId` as the document ID. The document schema is defined in → §6.2.3.3.

**Write example:**

```typescript
const achievementRef = db.doc(`users/${uid}/achievements/focus_bronze`);
await achievementRef.set({
  achievementId: 'focus_bronze',
  tier: 'bronze',
  category: 'focus',
  title: 'First Steps',
  description: 'Complete 10 focus sessions.',
  earnedAt: new Date().toISOString(),
  isShiny: false,
  progress: {
    current: 10,
    target: 10,
  },
});
```

**Angular reads achievements via `onSnapshot` listener** (→ §7.2.2):

```typescript
// File: src/app/core/achievement.service.ts

import { Injectable, inject, signal } from '@angular/core';
import { Firestore, collection, onSnapshot } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import type { Achievement } from './models';

@Injectable({ providedIn: 'root' })
export class AchievementService {
  private firestore = inject(Firestore);
  private authService = inject(AuthService);

  readonly achievements = signal<Achievement[]>([]);

  attachListener(): void {
    const uid = this.authService.uid;
    if (!uid) return;

    const colRef = collection(this.firestore, `users/${uid}/achievements`);
    onSnapshot(colRef, (snapshot) => {
      const achievements = snapshot.docs.map((doc) => doc.data() as Achievement);
      this.achievements.set(achievements);
    });
  }
}
```

When a Cloud Function writes a new achievement document, the Angular `onSnapshot` listener fires immediately (if online) or on next sync (if offline). The UI can then display a badge notification.

#### 8.5.4. Duplicate Award Prevention

Duplicate prevention is achieved through two mechanisms:

**1. Document ID as natural key:**

The achievement document ID IS the `achievementId` string (e.g., `focus_bronze`). Firestore's `set()` would overwrite an existing document with the same ID. To prevent this, the Cloud Function checks `exists` before writing:

```typescript
const achievementSnap = await achievementRef.get();
if (achievementSnap.exists) {
  // Already awarded — skip
  continue;
}
```

**2. Idempotency guard on the triggering event:**

The pipeline's idempotency guard (→ §8.2.3) ensures the achievement check is not re-triggered for the same event. Even if the guard fails (e.g., `processed_events` document deleted), the `exists` check on the achievement document prevents double-writing.

**Why not use Firestore transactions?**

A transaction (`runTransaction`) would provide stronger consistency but is unnecessary here. The worst case without a transaction is a race condition where two concurrent function invocations both read `exists === false` and both write the achievement. Since both writes contain identical data (same `achievementId`, `tier`, `title`), the result is correct — only `earnedAt` might differ by milliseconds. The `isShiny` field is deterministic for non-shiny badges and is handled separately for shiny badges (→ §8.7).

---

### 8.6. Swift Recovery Multiplier

The Swift Recovery Multiplier rewards users who quickly acknowledge their distraction after an idle detection event. It is specified in TARGET_ARCHITECTURE.md §6:

> *Swift Recovery Multiplier:* Bonus points awarded by the server if the timestamp difference between an `IdleDetected` event and a `DistractionLogged` event is under 60 seconds.

#### 8.6.1. Trigger: `DistractionLogged` Event Created

The Swift Recovery check is invoked by the `distraction-logged` handler (→ §8.3.4, `handleDistractionLogged`). It fires for every `DistractionLogged` event — ALL distractions are evaluated for Swift Recovery, not just those that follow an `IdleDetected` event.

#### 8.6.2. Lookup: Find Most Recent `IdleDetected` Event for Same Session

The Cloud Function queries the `session_events` subcollection for the most recent `IdleDetected` event with the same `sessionId`:

```typescript
// File: functions/src/engines/swift-recovery.ts

import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { FUNCTION_CONFIG } from '../config';
import type { SessionEvent, IdleDetectedPayload } from '../types';

const db = getFirestore();

/**
 * Check if a DistractionLogged event qualifies for a Swift Recovery bonus.
 *
 * Flow:
 * 1. Query for the most recent IdleDetected event with the same sessionId.
 * 2. Calculate the time delta between IdleDetected.timestamp and DistractionLogged.timestamp.
 * 3. If delta < 60 seconds, award the bonus.
 * 4. Determine the speed tier (Instant, Fast, Swift).
 * 5. Increment the daily swiftRecoveryCount.
 */
export async function checkSwiftRecovery(
  uid: string,
  eventId: string,
  event: SessionEvent,
): Promise<void> {
  const sessionId = event.sessionId;
  const distractionTimestamp = Date.parse(event.timestamp);

  if (isNaN(distractionTimestamp)) {
    logger.warn('Invalid distraction timestamp for Swift Recovery', { eventId });
    return;
  }

  // §8.6.2: Find the most recent IdleDetected event for this session
  const eventsRef = db.collection(`users/${uid}/session_events`);
  const idleQuery = eventsRef
    .where('sessionId', '==', sessionId)
    .where('type', '==', 'IdleDetected')
    .orderBy('timestamp', 'desc')
    .limit(1);

  const idleSnap = await idleQuery.get();

  if (idleSnap.empty) {
    // No IdleDetected event for this session — no Swift Recovery possible.
    // This happens if the user manually logs a distraction without an idle trigger.
    logger.info('No IdleDetected event found for session, skipping Swift Recovery', {
      uid,
      sessionId,
    });
    return;
  }

  const idleEvent = idleSnap.docs[0].data() as SessionEvent;
  const idleTimestamp = Date.parse(idleEvent.timestamp);

  if (isNaN(idleTimestamp)) {
    logger.warn('Invalid idle timestamp for Swift Recovery', { uid, sessionId });
    return;
  }

  // §8.6.3: Calculate time delta
  const deltaMs = distractionTimestamp - idleTimestamp;

  // §8.6.4: Check threshold
  if (deltaMs < 0 || deltaMs >= FUNCTION_CONFIG.swiftRecoveryThresholdMs) {
    // Negative delta means IdleDetected arrived AFTER DistractionLogged (clock issue).
    // Delta >= 60s means too slow.
    logger.info('Swift Recovery not qualified', { uid, sessionId, deltaMs });
    return;
  }

  // §8.6.6: Determine speed tier
  const tier = getRecoveryTier(deltaMs);

  logger.info('Swift Recovery awarded', {
    uid,
    sessionId,
    eventId,
    deltaMs,
    tier,
  });

  // §8.6.5: Increment daily swiftRecoveryCount
  const eventDate = new Date(event.timestamp);
  const dateKey = eventDate.toISOString().split('T')[0];
  const dailyRef = db.doc(`users/${uid}/stats/daily/${dateKey}`);
  const dailySnap = await dailyRef.get();

  if (dailySnap.exists) {
    const currentCount = (dailySnap.data()!.swiftRecoveryCount as number) || 0;
    await dailyRef.update({
      swiftRecoveryCount: currentCount + 1,
      updatedAt: new Date().toISOString(),
    });
  } else {
    // Edge case: daily doc not yet created
    await dailyRef.set({
      date: dateKey,
      totalFocusSeconds: 0,
      sessionsCompleted: 0,
      sessionsEndedEarly: 0,
      distractionsLogged: 0,
      falseAlarms: 0,
      avgSessionSeconds: 0,
      longestSessionSeconds: 0,
      swiftRecoveryCount: 1,
      updatedAt: new Date().toISOString(),
    });
  }
}

/**
 * §8.6.6: Determine the recovery speed tier.
 *
 * Tiers:
 * - Instant: < 15 seconds — fastest recovery
 * - Fast: < 30 seconds — quick recovery
 * - Swift: < 60 seconds — within threshold
 *
 * Currently all tiers are treated equally (increment swiftRecoveryCount by 1).
 * Future enhancement: assign different point multipliers per tier.
 */
function getRecoveryTier(deltaMs: number): 'instant' | 'fast' | 'swift' {
  if (deltaMs < FUNCTION_CONFIG.swiftRecoveryTiers.instant) {
    return 'instant';
  }
  if (deltaMs < FUNCTION_CONFIG.swiftRecoveryTiers.fast) {
    return 'fast';
  }
  return 'swift';
}
```

#### 8.6.3. Time Delta Calculation: `DistractionLogged.timestamp − IdleDetected.timestamp`

The delta is computed from the client-issued ISO 8601 timestamps:

```typescript
const deltaMs = Date.parse(distractionLogged.timestamp) - Date.parse(idleDetected.timestamp);
```

**Why client timestamps are reliable for this calculation:**

Both timestamps are generated on the SAME device within the SAME session. The system clock does not change between the two events (unless the user manually changes their clock during an intervention — an implausible scenario). Therefore, the delta is accurate regardless of absolute clock drift.

**Edge case — clock change during intervention:**

If the user changes their system clock during the intervention (e.g., to fake a fast recovery), the delta would be artificially short. This is mitigated by:

1. The delta must be >= 0 (negative deltas are rejected).
2. Future enhancement: compare against Firestore `createTime` metadata (server timestamp) for the two documents. The `createTime` is set by the Firestore server when the document is first written, providing an independent timestamp. If the client delta and server delta differ by more than 10 seconds, flag the recovery as suspicious.

#### 8.6.4. Threshold: Delta < 60 Seconds Qualifies for Bonus

The threshold is `FUNCTION_CONFIG.swiftRecoveryThresholdMs = 60_000` (60 seconds = 60,000 milliseconds).

**Rationale:** 60 seconds is a generous window that rewards intentional, prompt distraction acknowledgment without being so tight that normal modal interaction time (reading the prompt, selecting a category, typing a note) would disqualify legitimate recoveries.

**Failure cases (no bonus):**

| Scenario | Delta | Result |
|---|---|---|
| User logs distraction in 5 seconds | 5,000ms | ✅ Swift Recovery (Instant tier) |
| User logs distraction in 45 seconds | 45,000ms | ✅ Swift Recovery (Swift tier) |
| User logs distraction in 90 seconds | 90,000ms | ❌ No bonus |
| User snoozes intervention, logs later | 300,000ms+ | ❌ No bonus |
| User marks false alarm | N/A | ❌ FalseAlarmMarked is not DistractionLogged |
| No IdleDetected event for session | N/A | ❌ No idle trigger to compare against |

#### 8.6.5. Bonus Points Calculation & Application

Currently, the Swift Recovery bonus is a simple counter increment (`swiftRecoveryCount += 1`). There is no point system in MVP. The counter is used for:

1. **Daily aggregate display:** Shown in the Reports view as "Swift Recoveries today."
2. **Achievement tracking:** Recovery achievements (`recovery_bronze`, `recovery_silver`, `recovery_gold`) use the cumulative `swiftRecoveryCount` across all daily aggregates.

**Future enhancement — tiered point multipliers:**

```typescript
// Future: different point values per tier
const TIER_MULTIPLIERS = {
  instant: 3,  // < 15s
  fast: 2,     // < 30s
  swift: 1,    // < 60s
};

// Future: swiftRecoveryPoints += TIER_MULTIPLIERS[tier];
```

#### 8.6.6. Recovery Speed Tiers (Instant < 15s, Fast < 30s, Swift < 60s)

| Tier | Threshold | Delta Range | Description |
|---|---|---|---|
| **Instant** | < 15,000ms | 0 – 14,999ms | The user acknowledged the distraction almost immediately. Indicates high focus awareness. |
| **Fast** | < 30,000ms | 15,000 – 29,999ms | Quick recovery. Normal response time for reading the modal and entering a note. |
| **Swift** | < 60,000ms | 30,000 – 59,999ms | Within the threshold. User took time to categorize but still responded reasonably quickly. |

All three tiers currently award the same bonus (swiftRecoveryCount += 1). The tier classification is logged for analytics and is available for future point differentiation.

---

### 8.7. Shiny Badge RNG System

The Shiny Badge system adds a collectible element to the gamification. On completion of a "perfect" focus session (no distractions, timer ran to natural completion), the server rolls a random number to determine if the user receives a rare aesthetic variant of an achievement badge.

**Specification** (TARGET_ARCHITECTURE.md §6):

> *Shiny Badges:* Server-side RNG (Random Number Generator) drops for rare aesthetic badges awarded upon completion of perfect focus blocks.

#### 8.7.1. Trigger Condition: Perfect Focus Block Completed (No Distractions, No Early End)

A Shiny Badge roll occurs when ALL of the following conditions are met:

1. The event type is `TimerCompleted` (NOT `TimerEndedEarly`).
2. `payload.endedEarly === false`.
3. `payload.distractionCount === 0`.

These conditions are checked in the `handleTimerCompleted` handler (→ §8.3.4):

```typescript
// From: functions/src/handlers/timer-completed.ts

if (isCompleted && !payload.endedEarly && payload.distractionCount === 0) {
  await checkShinyBadge(uid, event.sessionId);
}
```

**Verification of `distractionCount`:**

The client-supplied `distractionCount` is treated as advisory. For the Shiny Badge check, the Cloud Function ALSO verifies by querying the Event Ledger:

```typescript
// File: functions/src/engines/shiny-badge.ts (excerpt)

async function verifyPerfectSession(uid: string, sessionId: string): Promise<boolean> {
  const eventsRef = db.collection(`users/${uid}/session_events`);
  const distractionQuery = eventsRef
    .where('sessionId', '==', sessionId)
    .where('type', '==', 'DistractionLogged')
    .limit(1);

  const distractionSnap = await distractionQuery.get();
  return distractionSnap.empty; // true if no distractions found
}
```

This server-side verification prevents a client from setting `distractionCount: 0` on a session that actually had distractions.

#### 8.7.2. Server-Side Random Number Generation

The Cloud Function uses Node.js `crypto.randomInt()` for cryptographically secure random number generation:

```typescript
import { randomInt } from 'crypto';

function rollShinyDrop(): boolean {
  // Roll a number between 0 and 9999 (inclusive)
  const roll = randomInt(10_000);
  // Drop rate: FUNCTION_CONFIG.shinyBadgeDropRate (default 0.05 = 5%)
  const threshold = Math.floor(FUNCTION_CONFIG.shinyBadgeDropRate * 10_000);
  return roll < threshold;
}
```

**Why `crypto.randomInt()` and not `Math.random()`?**

`Math.random()` uses a PRNG (Pseudo-Random Number Generator) seeded from the system clock. While adequate for most uses, `crypto.randomInt()` uses the OS's cryptographic random source, providing better uniformity and unpredictability. Since Shiny Badges are a gamification feature affecting user motivation, using a robust RNG prevents suspicion of bias.

#### 8.7.3. Drop Rate Table (Rarity Tiers: Common, Uncommon, Rare, Legendary)

The base drop rate (`FUNCTION_CONFIG.shinyBadgeDropRate = 0.05`) is 5% per perfect session. When a shiny drop is triggered, a second roll determines the rarity tier:

| Rarity | Roll Range | Probability (given drop) | Overall Probability | Visual Treatment |
|---|---|---|---|---|
| **Common** | 0 – 5999 | 60% | 3.0% per perfect session | Subtle shimmer effect |
| **Uncommon** | 6000 – 8499 | 25% | 1.25% per perfect session | Animated sparkle border |
| **Rare** | 8500 – 9699 | 12% | 0.6% per perfect session | Holographic gradient |
| **Legendary** | 9700 – 9999 | 3% | 0.15% per perfect session | Animated particle aura + unique color |

```typescript
type ShinyRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

function rollRarity(): ShinyRarity {
  const roll = randomInt(10_000);
  if (roll < 6000) return 'common';
  if (roll < 8500) return 'uncommon';
  if (roll < 9700) return 'rare';
  return 'legendary';
}
```

#### 8.7.4. Badge Catalog & Aesthetic Variants

Shiny badges are NOT separate achievement types — they are aesthetic variants of the 12 existing achievements (→ §8.5.1). A user can have BOTH a regular `focus_bronze` badge and a shiny `focus_bronze` badge. The shiny variant is stored as a separate document with `_shiny` suffix:

**Shiny badge document IDs:**

| Regular Achievement | Shiny Variant Document ID |
|---|---|
| `focus_bronze` | `focus_bronze_shiny` |
| `focus_silver` | `focus_silver_shiny` |
| `focus_gold` | `focus_gold_shiny` |
| `streak_bronze` | `streak_bronze_shiny` |
| `streak_silver` | `streak_silver_shiny` |
| `streak_gold` | `streak_gold_shiny` |
| `recovery_bronze` | `recovery_bronze_shiny` |
| `recovery_silver` | `recovery_silver_shiny` |
| `recovery_gold` | `recovery_gold_shiny` |
| `perfect_bronze` | `perfect_bronze_shiny` |
| `perfect_silver` | `perfect_silver_shiny` |
| `perfect_gold` | `perfect_gold_shiny` |

**Shiny badge selection logic:**

When a shiny drop is triggered, the Cloud Function selects which achievement to make shiny:

1. Query the user's existing achievements (`users/{uid}/achievements/`).
2. Filter to achievements that do NOT already have a shiny variant.
3. If no eligible achievements exist, the shiny drop is wasted (the user has all-shiny — an extremely rare condition).
4. Select a random eligible achievement from the filtered list.

#### 8.7.5. Badge Document Write with Rarity Metadata

**Shiny badge document schema:**

```json
{
  "achievementId": "focus_bronze_shiny",
  "tier": "bronze",
  "category": "focus",
  "title": "First Steps ✦",
  "description": "Complete 10 focus sessions. (Shiny variant)",
  "earnedAt": "2026-04-03T15:30:00.000Z",
  "isShiny": true,
  "shinyRarity": "rare",
  "shinySessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "progress": {
    "current": 10,
    "target": 10
  }
}
```

| Field | Type | Description |
|---|---|---|
| `achievementId` | `string` | Same as the regular achievement but with `_shiny` suffix. |
| `tier` | `string` | Same as the base achievement's tier. |
| `category` | `string` | Same as the base achievement's category. |
| `title` | `string` | Base title with `✦` appended. |
| `description` | `string` | Base description with "(Shiny variant)" appended. |
| `earnedAt` | `string` | ISO 8601 timestamp of award. |
| `isShiny` | `boolean` | Always `true` for shiny badges. |
| `shinyRarity` | `string` | `"common"`, `"uncommon"`, `"rare"`, or `"legendary"`. |
| `shinySessionId` | `string` | The `sessionId` of the perfect session that triggered the drop. |
| `progress` | `object` | Copied from the base achievement. |

**Full implementation** (`src/engines/shiny-badge.ts`):

```typescript
// File: functions/src/engines/shiny-badge.ts

import { getFirestore } from 'firebase-admin/firestore';
import { randomInt } from 'crypto';
import { logger } from 'firebase-functions/v2';
import { FUNCTION_CONFIG } from '../config';
import { ACHIEVEMENT_DEFINITIONS } from './achievement';
import type { AchievementDocument } from '../types';

const db = getFirestore();

type ShinyRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

/**
 * Check if a perfect session earns a Shiny Badge.
 *
 * §8.7.1: Only called for perfect sessions (TimerCompleted, 0 distractions, not ended early).
 * §8.7.2: Uses crypto.randomInt() for RNG.
 * §8.7.3: Two-phase roll — first roll determines drop, second determines rarity.
 */
export async function checkShinyBadge(
  uid: string,
  sessionId: string,
): Promise<void> {
  // Verify the session was truly perfect (server-side verification)
  const isPerfect = await verifyPerfectSession(uid, sessionId);
  if (!isPerfect) {
    logger.info('Session not verified as perfect, skipping shiny badge roll', {
      uid,
      sessionId,
    });
    return;
  }

  // Phase 1: Roll for shiny drop
  const dropRoll = randomInt(10_000);
  const dropThreshold = Math.floor(FUNCTION_CONFIG.shinyBadgeDropRate * 10_000);

  if (dropRoll >= dropThreshold) {
    logger.info('Shiny badge roll failed', { uid, sessionId, dropRoll, dropThreshold });
    return;
  }

  // Phase 2: Determine rarity
  const rarity = rollRarity();

  // Phase 3: Select which achievement to make shiny
  const achievementsRef = db.collection(`users/${uid}/achievements`);
  const achievementsSnap = await achievementsRef.get();

  const earnedIds = new Set(achievementsSnap.docs.map((doc) => doc.id));

  // Find achievements that are earned but don't have a shiny variant yet
  const eligibleForShiny = ACHIEVEMENT_DEFINITIONS.filter((def) => {
    const hasRegular = earnedIds.has(def.achievementId);
    const hasShiny = earnedIds.has(`${def.achievementId}_shiny`);
    return hasRegular && !hasShiny;
  });

  if (eligibleForShiny.length === 0) {
    logger.info('No eligible achievements for shiny variant', { uid, sessionId });
    return;
  }

  // Random selection from eligible achievements
  const selected = eligibleForShiny[randomInt(eligibleForShiny.length)];

  // Phase 4: Write shiny badge document
  const shinyId = `${selected.achievementId}_shiny`;
  const shinyRef = db.doc(`users/${uid}/achievements/${shinyId}`);

  // Get the base achievement's progress
  const baseDoc = await db.doc(`users/${uid}/achievements/${selected.achievementId}`).get();
  const baseData = baseDoc.data() as AchievementDocument;

  const shinyBadge: AchievementDocument & { shinyRarity: string; shinySessionId: string } = {
    achievementId: shinyId,
    tier: selected.tier,
    category: selected.category,
    title: `${selected.title} ✦`,
    description: `${selected.description} (Shiny variant)`,
    earnedAt: new Date().toISOString(),
    isShiny: true,
    shinyRarity: rarity,
    shinySessionId: sessionId,
    progress: baseData.progress,
  };

  await shinyRef.set(shinyBadge);

  logger.info('Shiny badge awarded!', {
    uid,
    sessionId,
    achievementId: shinyId,
    rarity,
  });
}

async function verifyPerfectSession(uid: string, sessionId: string): Promise<boolean> {
  const eventsRef = db.collection(`users/${uid}/session_events`);

  // Check for any DistractionLogged events for this session
  const distractionQuery = eventsRef
    .where('sessionId', '==', sessionId)
    .where('type', '==', 'DistractionLogged')
    .limit(1);
  const distractionSnap = await distractionQuery.get();

  if (!distractionSnap.empty) {
    return false; // Has distractions — not perfect
  }

  // Check for any FalseAlarmMarked events (false alarms don't count as distractions
  // but a session with false alarms is still "perfect" — the trigger was a false alarm)
  // No action needed for false alarms.

  // Verify the session actually completed (has a TimerCompleted event, not TimerEndedEarly)
  const completedQuery = eventsRef
    .where('sessionId', '==', sessionId)
    .where('type', '==', 'TimerCompleted')
    .limit(1);
  const completedSnap = await completedQuery.get();

  return !completedSnap.empty; // Must have a TimerCompleted event
}

function rollRarity(): ShinyRarity {
  const roll = randomInt(10_000);
  if (roll < 6000) return 'common';
  if (roll < 8500) return 'uncommon';
  if (roll < 9700) return 'rare';
  return 'legendary';
}
```

#### 8.7.6. Anti-Cheat: Why RNG Must Be Server-Side

**The threat:** If the shiny badge RNG ran on the client (Angular), a user could:

1. Intercept the RNG call and force it to always return `true`.
2. Modify the Angular source code in the Photino Chromium cache to change the drop rate.
3. Directly write shiny achievement documents to Firestore (if `allow write` were permitted).

**The defense:** All three attack vectors are closed by the target architecture:

1. **RNG runs on the server:** The `crypto.randomInt()` call is in a Cloud Function. The client has no access to the RNG state.
2. **Angular source modification is irrelevant:** Even if a user modifies the Angular code, the modified code cannot trigger the Cloud Function's shiny badge logic — the Cloud Function only fires on `onDocumentCreated` for `session_events`, and the function itself decides whether to roll.
3. **Firestore security rules deny client writes to achievements:**
   ```
   match /users/{uid}/achievements/{achievementId} {
     allow write: if false;
   }
   ```
   Only the Cloud Function (Admin SDK, which bypasses rules) can write achievement documents.

**The only remaining attack surface:** A user could create fake `TimerCompleted` events with `distractionCount: 0` to trigger more shiny rolls. This is mitigated by:
- The `verifyPerfectSession()` function queries the Event Ledger for actual `DistractionLogged` events, ignoring the client-supplied `distractionCount`.
- Event validation (→ §8.2.2) rejects events with implausible `durationSeconds`.
- Rate limiting (→ §7.4.4) flags accounts with excessive event creation.

---

### 8.8. Migrated Event Handling

Events created by the SQLite → Firestore migration utility (→ §7.5) have a `migrated: true` flag. The Cloud Function pipeline handles these events differently to avoid retroactive gamification anomalies.

**Migrated event processing rules:**

| Feature | Normal Events | Migrated Events |
|---|---|---|
| Daily aggregate update | Incremental update | Incremental update (same logic) |
| Streak tracking | Full evaluation | **SKIPPED** — historical streak reconstruction is complex and produces misleading results |
| Achievement check | Full evaluation | **SKIPPED** — achievements should be earned "live," not retroactively from imported data |
| Swift Recovery | Full evaluation | **SKIPPED** — migrated distractions don't have reliable IdleDetected pairing |
| Shiny Badge roll | Full evaluation | **SKIPPED** — perfect session verification requires IdleDetected event correlation |
| Idempotency tracking | Yes | Yes (same `processed_events` logic) |

**Implementation in the dispatcher:**

```typescript
// File: functions/src/pipeline/event-dispatcher.ts (addition for migrated events)

export async function dispatchEvent(
  uid: string,
  eventId: string,
  event: SessionEvent,
): Promise<void> {
  const isMigrated = event.migrated === true;

  switch (event.type) {
    case 'TimerCompleted':
    case 'TimerEndedEarly':
      if (isMigrated) {
        // Only update daily aggregate — skip streak, achievements, shiny
        await handleMigratedTimerCompleted(uid, eventId, event);
      } else {
        await handleTimerCompleted(uid, eventId, event);
      }
      break;

    case 'DistractionLogged':
      if (isMigrated) {
        // Only update daily distraction counter — skip Swift Recovery, achievements
        await handleMigratedDistractionLogged(uid, eventId, event);
      } else {
        await handleDistractionLogged(uid, eventId, event);
      }
      break;

    case 'FalseAlarmMarked':
      // False alarm handling is the same for migrated and normal events
      await handleFalseAlarm(uid, eventId, event);
      break;

    // ... other event types unchanged
  }
}
```

**Migrated timer handler:**

```typescript
// File: functions/src/handlers/timer-completed.ts (migrated variant)

export async function handleMigratedTimerCompleted(
  uid: string,
  eventId: string,
  event: SessionEvent,
): Promise<void> {
  const payload = event.payload as TimerCompletedPayload;
  const durationSeconds = payload.durationSeconds;

  if (durationSeconds <= 0 || durationSeconds > FUNCTION_CONFIG.maxSessionDurationSeconds) {
    return;
  }

  const eventDate = new Date(event.timestamp);
  const dateKey = eventDate.toISOString().split('T')[0];
  const isCompleted = event.type === 'TimerCompleted';
  const isEndedEarly = event.type === 'TimerEndedEarly';

  // Same daily aggregate update logic as normal handler
  const dailyRef = db.doc(`users/${uid}/stats/daily/${dateKey}`);
  const dailySnap = await dailyRef.get();

  if (dailySnap.exists) {
    const data = dailySnap.data()!;
    const newTotal = ((data.totalFocusSeconds as number) || 0) + durationSeconds;
    const newCompleted = ((data.sessionsCompleted as number) || 0) + (isCompleted ? 1 : 0);
    const newEndedEarly = ((data.sessionsEndedEarly as number) || 0) + (isEndedEarly ? 1 : 0);
    const newTotalSessions = newCompleted + newEndedEarly;

    await dailyRef.update({
      totalFocusSeconds: newTotal,
      sessionsCompleted: newCompleted,
      sessionsEndedEarly: newEndedEarly,
      avgSessionSeconds: newTotalSessions > 0 ? Math.round((newTotal / newTotalSessions) * 100) / 100 : 0,
      longestSessionSeconds: Math.max((data.longestSessionSeconds as number) || 0, durationSeconds),
      updatedAt: new Date().toISOString(),
    });
  } else {
    await dailyRef.set({
      date: dateKey,
      totalFocusSeconds: durationSeconds,
      sessionsCompleted: isCompleted ? 1 : 0,
      sessionsEndedEarly: isEndedEarly ? 1 : 0,
      distractionsLogged: 0,
      falseAlarms: 0,
      avgSessionSeconds: durationSeconds,
      longestSessionSeconds: durationSeconds,
      swiftRecoveryCount: 0,
      updatedAt: new Date().toISOString(),
    });
  }

  // NO streak update, NO achievement check, NO shiny badge for migrated events
}
```

---

### 8.9. Cross-Reference Table

| Section | Source File | Target File / Function | Status |
|---|---|---|---|
| §8.1.1 | *(no source equivalent)* | `functions/src/index.ts` | NEW |
| §8.1.2 | *(no source equivalent)* | `functions/src/config.ts` | NEW |
| §8.1.3 | *(no source equivalent)* | Firebase environment (no external secrets for MVP) | NEW |
| §8.2.1 | *(no source equivalent)* | `functions/src/pipeline/event-processor.ts` | NEW |
| §8.2.2 | *(no source equivalent)* | `functions/src/pipeline/event-validator.ts` | NEW |
| §8.2.3 | *(no source equivalent)* | `functions/src/pipeline/idempotency.ts` | NEW |
| §8.2.4 | *(no source equivalent)* | `functions/src/pipeline/event-dispatcher.ts` | NEW |
| §8.3.1 | `Sentinel.Engine\ReportingService.cs` (focus time computation) | `functions/src/handlers/timer-completed.ts` | REPLACED — server-side incremental aggregate |
| §8.3.2 | *(source does not deduct idle time)* | No idle deduction (same as source) | NO CHANGE |
| §8.3.3 | `Sentinel.Engine\ReportingService.cs` (session counting) | `functions/src/handlers/timer-completed.ts` | REPLACED — separate counters for completed vs. early-ended |
| §8.3.4 | `Sentinel.Engine\ReportingService.cs` (daily focus array) | `functions/src/handlers/timer-completed.ts` + `distraction-logged.ts` + `false-alarm.ts` | REPLACED — server-computed `stats/daily/{date}` |
| §8.4 | *(no source equivalent)* | `functions/src/engines/streak.ts` | NEW |
| §8.5 | *(no source equivalent)* | `functions/src/engines/achievement.ts` | NEW |
| §8.5.3 | *(no source equivalent)* | `users/{uid}/achievements/{achievementId}` | NEW — document write (→ §6.2.3.3) |
| §8.6 | *(no source equivalent)* | `functions/src/engines/swift-recovery.ts` | NEW |
| §8.7 | *(no source equivalent)* | `functions/src/engines/shiny-badge.ts` | NEW |
| §8.8 | `Sentinel.Engine\DistractionRepository.cs` (migration schema v6) | `functions/src/handlers/timer-completed.ts` (migrated variant) | ADAPTED — migrated events skip gamification |

