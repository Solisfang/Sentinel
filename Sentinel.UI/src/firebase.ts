import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyC6luPajDSMU1FyH5prC-LQgFtvj3JLdxE",
  authDomain: "sentinel-s073.firebaseapp.com",
  projectId: "sentinel-s073",
  storageBucket: "sentinel-s073.firebasestorage.app",
  messagingSenderId: "173114633978",
  appId: "1:173114633978:web:7cdc2cf8a4a0067a67e343"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// Enable offline IndexedDB persistence so cloud sync works even when
// the network is temporarily unavailable (WebView2 desktop scenario).
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    // Multiple tabs open — persistence can only be enabled in one tab at a time.
    console.warn('[Sentinel] Firestore persistence unavailable (multi-tab).');
  } else if (err.code === 'unimplemented') {
    // Current browser/environment does not support IndexedDB.
    console.warn('[Sentinel] Firestore persistence unsupported in this environment.');
  }
});

export default app;
