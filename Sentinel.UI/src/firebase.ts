import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

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
export default app;
