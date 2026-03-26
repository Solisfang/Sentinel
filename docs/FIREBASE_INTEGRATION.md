# Firebase Integration and Cloud Sync in Sentinel

## Overview
Sentinel uses Firebase to provide optional cloud synchronization for user data, including session history, settings, and taxonomy. This allows users to access their data across devices and ensures a seamless experience whether working locally or in the cloud.

## How Firebase Integrates in Sentinel

### 1. Firebase Setup
- The Firebase configuration is defined in the `Sentinel.UI/src/firebase.ts` file.
- It initializes the Firebase app using project-specific credentials (API key, project ID, etc.).
- Firebase services used include Authentication and Firestore (cloud database).

### 2. Authentication
- Users can sign in with email and password via the Account screen.
- Authentication state is managed in the UI, and the user's email is stored in the app state.
- When signed in, the app enables cloud sync features; otherwise, it operates in local-only mode.

### 3. Cloud Sync (Firestore)
- When cloud sync is enabled (user is authenticated), Sentinel reads and writes user data to Firestore.
- Data types synced include:
  - Session history (focus sessions duration, completion time)
  - Distractions (notes, mapped categories, timestamp)
- Data is stored in user-specific Firestore collections (`sessions` and `distractions`), ensuring privacy and separation between users.
- Sync operations are triggered on relevant app events (e.g., session complete, distraction logged).

### 4. Local-First Operation
- If the user is not signed in, all data is stored and managed locally in the browser (IndexedDB or localStorage).
- The app can function fully offline, and no data is sent to Firebase unless the user opts in by signing in.

### 5. Sync Logic and Conflict Resolution
- On sign-in, the app fetches the latest data from Firestore and merges it with any local changes.
- If there are conflicts (e.g., local changes while offline), the app uses a last-write-wins strategy or prompts the user to resolve.
- Changes made while online are immediately synced to Firestore.
- Changes made while offline are queued and synced when connectivity is restored.

### 6. Security and Privacy
- All user data in Firestore is protected by Firebase Authentication rules.
- Only authenticated users can access their own data.
- No data is shared between users unless explicitly designed (e.g., for future collaboration features).

## File References
- `Sentinel.UI/src/firebase.ts`: Firebase initialization and utility functions.
- `Sentinel.UI/src/App.tsx`: Main UI logic for authentication, sync status, and data operations with Firestore.

## Summary
- Sentinel's Firebase integration is optional and privacy-focused.
- Users can choose to work entirely locally or enable cloud sync for cross-device access.
- All sync operations are secure, user-specific, and designed for reliability and transparency.
