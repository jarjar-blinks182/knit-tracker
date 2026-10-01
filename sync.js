// Optional cloud sync through Firebase (Firestore + email/password sign in).
// Each project is one document at users/{uid}/projects/{id}; the newest
// updatedAt wins. Pulls happen on open and whenever the app comes back to the
// foreground, which is what makes switching between phone and iPad work.

import { FIREBASE_CONFIG } from './config.js';
import * as store from './store.js';

const SDK = './vendor/firebase/';

let fb = null; // { auth, db, authApi, fs }
let user = null;
let status = 'local'; // local | signed-out | syncing | synced | offline | error
let lastError = '';
const listeners = new Set();
let pushTimer = null;
let running = null;

export const configured = Boolean(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey);

export function onStatus(fn) {
  listeners.add(fn);
  fn(getStatus());
}

export function getStatus() {
  return { status, user, error: lastError, configured };
}

function setStatus(s, err = '') {
  status = s;
  lastError = err;
  listeners.forEach((fn) => fn(getStatus()));
}

export async function init() {
  if (!configured) return setStatus('local');
  try {
    const [app, authApi, fs] = await Promise.all([
      import(`${SDK}firebase-app.js`),
      import(`${SDK}firebase-auth.js`),
      import(`${SDK}firebase-firestore.js`),
    ]);
    const fbApp = app.initializeApp(FIREBASE_CONFIG);
    fb = { auth: authApi.getAuth(fbApp), db: fs.getFirestore(fbApp), authApi, fs };
  } catch (e) {
    return setStatus('offline', 'Could not load sync.');
  }

  setStatus('signed-out');
  fb.authApi.onAuthStateChanged(fb.auth, (u) => {
    user = u ? { id: u.uid, email: u.email } : null;
    if (user) syncNow(); else setStatus('signed-out');
  });

  store.subscribe(({ fromRemote }) => { if (!fromRemote) schedulePush(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
    else flush();
  });
  window.addEventListener('online', syncNow);
  window.addEventListener('pagehide', flush);
}

function schedulePush() {
  if (!fb || !user) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(syncNow, 1200);
}

function flush() {
  clearTimeout(pushTimer);
  if (fb && user && store.dirtyProjects().length) push().catch(() => {});
}

export function syncNow() {
  if (!fb || !user) return Promise.resolve();
  if (running) return running;
  running = (async () => {
    if (!navigator.onLine) return setStatus('offline');
    setStatus('syncing');
    try {
      // Pull first, so newer changes from another device replace stale local
      // edits instead of being overwritten by them.
      await pull();
      await push();
      setStatus('synced');
    } catch (e) {
      setStatus(navigator.onLine ? 'error' : 'offline', friendly(e));
    }
  })().finally(() => { running = null; });
  return running;
}

function projectsRef() {
  return fb.fs.collection(fb.db, 'users', user.id, 'projects');
}

async function push() {
  const dirty = store.dirtyProjects().map((p) => JSON.parse(JSON.stringify(p)));
  if (!dirty.length) return;
  const { doc, setDoc, serverTimestamp } = fb.fs;
  const results = await Promise.allSettled(dirty.map((p) => setDoc(doc(projectsRef(), p.id), {
    data: p,
    updatedAt: p.updatedAt,
    deleted: !!p.deleted,
    syncedAt: serverTimestamp(),
  })));
  // A refused write means the saved copy is newer; the next pull brings it in.
  const done = dirty.filter((_, i) => results[i].status === 'fulfilled' || results[i].reason?.code === 'permission-denied');
  store.clearDirty(done);
  const failed = results.find((r) => r.status === 'rejected' && r.reason?.code !== 'permission-denied');
  if (failed) throw failed.reason;
}

async function pull() {
  const { query, where, orderBy, getDocs, Timestamp } = fb.fs;
  const since = store.lastPull();
  const q = since
    ? query(projectsRef(), where('syncedAt', '>', Timestamp.fromDate(new Date(since))), orderBy('syncedAt'))
    : query(projectsRef(), orderBy('syncedAt'));
  const snap = await getDocs(q);
  if (snap.empty) return;
  const rows = snap.docs.map((d) => d.data());
  const last = rows[rows.length - 1].syncedAt;
  store.mergeRemote(rows.map((r) => r.data), last ? last.toDate().toISOString() : since);
}

// ---- sign in ----

export async function signIn(email, password) {
  await fb.authApi.signInWithEmailAndPassword(fb.auth, email, password);
}

export async function createAccount(email, password) {
  await fb.authApi.createUserWithEmailAndPassword(fb.auth, email, password);
}

export async function resetPassword(email) {
  await fb.authApi.sendPasswordResetEmail(fb.auth, email);
}

export async function signOut() {
  await fb.authApi.signOut(fb.auth);
}

export function friendly(e) {
  const code = e?.code || '';
  const map = {
    'auth/invalid-credential': 'That email and password don’t match an account.',
    'auth/wrong-password': 'That password isn’t right.',
    'auth/user-not-found': 'There’s no account with that email. Use Create account.',
    'auth/email-already-in-use': 'There’s already an account with that email. Use Sign in.',
    'auth/weak-password': 'Use a password with at least 6 characters.',
    'auth/invalid-email': 'That doesn’t look like an email address.',
    'auth/too-many-requests': 'Too many tries. Wait a minute and try again.',
    'auth/network-request-failed': 'Can’t reach the server. Check your connection.',
    'auth/missing-password': 'Enter your password.',
    'auth/admin-restricted-operation': 'New accounts are turned off. Turn sign-up back on in Firebase (Authentication → Settings) to add one.',
    'auth/operation-not-allowed': 'Email/password sign in isn’t enabled in Firebase yet.',
    'auth/unauthorized-domain': 'This site isn’t in Firebase’s authorized domains yet.',
    'permission-denied': 'The server refused the change. Check firestore.rules is published.',
    unavailable: 'Can’t reach the server right now.',
  };
  return map[code] || e?.message || String(e);
}
