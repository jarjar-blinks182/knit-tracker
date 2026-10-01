// Pattern library: patterns saved once and reused for new projects. Kept like
// projects (localStorage first, dirty tracking for sync) but in its own key, and
// synced to users/{uid}/patterns/{id}. An entry's id comes from the pattern's
// content, so the same pattern saved on two devices becomes one entry.

import { now } from './store.js';

const KEY = 'rowcounter.library.v1';

let state = read();
const listeners = new Set();

function read() {
  try {
    return { patterns: {}, dirty: [], lastPull: null, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { patterns: {}, dirty: [], lastPull: null };
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

// Same sections, sizes and stitch counts give the same key; the chosen size
// and the name don't count, so a renamed or re-sized copy isn't a new pattern.
function hash(str) {
  let a = 0x811c9dc5;
  let b = 5381;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = (Math.imul(b, 33) + c) | 0;
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

export function keyOf(pattern) {
  const { size, name, ...rest } = pattern;
  return hash(JSON.stringify(rest));
}

export function list() {
  return Object.values(state.patterns)
    .filter((e) => !e.deleted)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export function get(id) {
  const e = state.patterns[id];
  return e && !e.deleted ? e : null;
}

export function has(pattern) {
  return !!get(keyOf(pattern));
}

function put(id, fields) {
  const e = { ...(state.patterns[id] || { id, createdAt: now() }), ...fields, updatedAt: now() };
  state.patterns[id] = e;
  if (!state.dirty.includes(id)) state.dirty.push(id);
  write();
  emit();
  return e;
}

// Adds a pattern unless the same one is already there. `revive` brings back an
// entry that was deleted from the library (for an explicit add, not for saves
// that happen along the way).
export function add(pattern, name, { revive = false } = {}) {
  const id = keyOf(pattern);
  const cur = state.patterns[id];
  if (cur && (!cur.deleted || !revive)) return cur.deleted ? null : cur;
  const title = String(name || pattern.name || 'Untitled pattern').trim().slice(0, 80);
  return put(id, { name: title, pattern: { ...structuredClone(pattern), name: title }, deleted: false });
}

export function rename(id, name) {
  const e = get(id);
  if (!e) return null;
  const title = String(name).trim().slice(0, 80) || e.name;
  return put(id, { name: title, pattern: { ...e.pattern, name: title } });
}

export function remove(id) {
  // Kept as a tombstone so the delete syncs to other devices.
  return put(id, { deleted: true });
}

// ---- used by sync.js ----

export function dirtyItems() {
  return state.dirty.map((id) => state.patterns[id]).filter(Boolean);
}

export function clearDirty(pushed) {
  const sent = new Map(pushed.map((e) => [e.id, e.updatedAt]));
  state.dirty = state.dirty.filter((id) => sent.get(id) !== state.patterns[id]?.updatedAt);
  write();
}

export function lastPull() {
  return state.lastPull;
}

export function mergeRemote(remote, pulledAt) {
  let changed = false;
  for (const r of remote) {
    const local = state.patterns[r.id];
    if (!local || r.updatedAt > local.updatedAt) {
      state.patterns[r.id] = r;
      state.dirty = state.dirty.filter((id) => id !== r.id);
      changed = true;
    }
  }
  if (pulledAt) state.lastPull = pulledAt;
  write();
  if (changed) emit(true);
  return changed;
}
