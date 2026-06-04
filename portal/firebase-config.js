import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import { getStorage }     from "https://www.gstatic.com/firebasejs/12.13.0/firebase-storage.js";

const firebaseConfig = {
  apiKey:            "AIzaSyAxdEIeLgCp1Eg6J3vMEMnwI6BaIeoyjnk",
  authDomain:        "douro-partners.firebaseapp.com",
  projectId:         "douro-partners",
  storageBucket:     "douro-partners.firebasestorage.app",
  messagingSenderId: "20074053140",
  appId:             "1:20074053140:web:64a790cc558f0688017101"
};

const app = initializeApp(firebaseConfig);

export const auth        = getAuth(app);
// Firestore with offline persistence (IndexedDB) + multi-tab support.
// Serves repeat page loads from local cache and only fetches changed docs from
// the server — keeps reads low at scale and makes navigation fast. Falls back
// to memory cache automatically if IndexedDB is unavailable.
export const db          = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
export const storage     = getStorage(app);
export const ADMIN_EMAILS = [
  'andre.rocha@douropartners.pt',
  'antonio.carvalho@douropartners.pt'
];
