// Firebase Configuration
// IMPORTANT: Replace these values with your own Firebase project config
// Get these from: https://console.firebase.google.com/ -> Project Settings -> General -> Your apps

const firebaseConfig = {
  apiKey: "AIzaSyD9dfIiBVCLPAQLqIKnvBonMA9Y1aKnKtw",
  authDomain: "majors-best-ball.firebaseapp.com",
  projectId: "majors-best-ball",
  storageBucket: "majors-best-ball.firebasestorage.app",
  messagingSenderId: "308011654361",
  appId: "1:308011654361:web:8a757a0530bb632d2c32c8",
  measurementId: "G-JVZY01PD9Y"
};
// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize services
const auth = firebase.auth();
const db = firebase.firestore();

// Larger local cache; prefer IndexedDB persistence so repeat reads of unchanged
// docs are served locally when possible (does not change live snapshot behavior).
try {
  db.settings({
    cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED
  });
} catch (e) {
  // settings must be called before any other Firestore use; ignore if already set
}

db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
  // failed-precondition: multiple tabs without multi-tab support
  // unimplemented: browser doesn't support persistence
  if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
    console.warn('Firestore persistence not enabled:', err);
  }
});

/**
 * Small in-memory doc cache for config / rarely changing docs.
 * Force-refresh with { force: true }. Default TTL 10 minutes.
 */
const FirestoreCache = {
  _mem: new Map(),
  defaultTtlMs: 10 * 60 * 1000,

  invalidate(key) {
    if (key) this._mem.delete(key);
    else this._mem.clear();
  },

  async getDoc(collectionName, docId, options = {}) {
    const key = `${collectionName}/${docId}`;
    const ttl = options.ttlMs != null ? options.ttlMs : this.defaultTtlMs;
    const cached = this._mem.get(key);
    if (!options.force && cached && (Date.now() - cached.at) < ttl) {
      return cached;
    }
    const snap = await db.collection(collectionName).doc(docId).get();
    const entry = {
      at: Date.now(),
      exists: snap.exists,
      data: snap.exists ? snap.data() : null,
      id: docId
    };
    this._mem.set(key, entry);
    return entry;
  }
};

window.FirestoreCache = FirestoreCache;

// Configure Google Auth Provider
const googleProvider = new firebase.auth.GoogleAuthProvider();

// Export for use in other modules
window.firebaseAuth = auth;
window.firebaseDb = db;
window.googleProvider = googleProvider;
