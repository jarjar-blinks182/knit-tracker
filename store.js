// Local-first storage. Every change is saved to localStorage immediately and
// marked dirty so the sync layer can push it when it's online and signed in.

const KEY = 'rowcounter.v1';

function blank() {
  return { projects: {}, dirty: [], lastPull: null };
}

let state = read();
const listeners = new Set();

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    return { ...blank(), ...JSON.parse(raw) };
  } catch {
    return blank();
  }
}

function write() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}

function emit(fromRemote = false) {
  listeners.forEach((fn) => fn({ fromRemote }));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function now() {
  return new Date().toISOString();
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function listProjects() {
  return Object.values(state.projects)
    .filter((p) => !p.deleted)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function getProject(id) {
  const p = state.projects[id];
  return p && !p.deleted ? p : null;
}

export function createProject(fields) {
  const t = now();
  const p = {
    id: uuid(),
    name: 'Untitled',
    craft: 'knit',
    rows: 0,
    target: null,
    repeat: null,
    notes: '',
    status: 'active', // or 'finished'
    finishedAt: null,
    yarns: [], // [{ brand, name, color, weight }]
    needle: '',
    link: '',
    stitchesPerRow: null, // for projects without a pattern
    createdAt: t,
    ...fields,
    updatedAt: t,
    deleted: false,
  };
  state.projects[p.id] = p;
  markDirty(p.id);
  return p;
}

export function updateProject(id, patch) {
  const p = state.projects[id];
  if (!p) return null;
  Object.assign(p, patch, { updatedAt: now() });
  markDirty(id);
  return p;
}

export function deleteProject(id) {
  // Kept as a tombstone so the delete syncs to other devices.
  return updateProject(id, { deleted: true });
}

function markDirty(id) {
  if (!state.dirty.includes(id)) state.dirty.push(id);
  write();
  emit();
}

// ---- used by sync.js ----

export function dirtyProjects() {
  return state.dirty.map((id) => state.projects[id]).filter(Boolean);
}

export function clearDirty(pushed) {
  // Only clear entries that haven't changed again since they were pushed.
  const sent = new Map(pushed.map((p) => [p.id, p.updatedAt]));
  state.dirty = state.dirty.filter((id) => sent.get(id) !== state.projects[id]?.updatedAt);
  write();
}

export function lastPull() {
  return state.lastPull;
}

export function mergeRemote(remote, pulledAt) {
  let changed = false;
  for (const r of remote) {
    const local = state.projects[r.id];
    if (!local || r.updatedAt > local.updatedAt) {
      state.projects[r.id] = r;
      state.dirty = state.dirty.filter((id) => id !== r.id);
      changed = true;
    }
  }
  if (pulledAt) state.lastPull = pulledAt;
  write();
  if (changed) emit(true);
  return changed;
}
