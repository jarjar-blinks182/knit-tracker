// A pattern is a list of sections worked one after another. Each section is a
// block of rows repeated some number of times, with stitch increases (+) or
// decreases (−) on given rows of the block. Values that differ by size are
// arrays, one entry per size, e.g. repeats: [14, 21].
//
// {
//   "name": "Waffle Loop Bandana",
//   "sizes": ["1", "2"],          // optional
//   "size": 0,                    // index into sizes
//   "firstRowSide": "RS",         // or "WS"
//   "castOn": 4,
//   "sections": [
//     { "name": "Increases", "rowsPerRepeat": 8, "repeats": [14, 21],
//       "stitchChanges": { "1": 1, "3": 1, "5": 1 }, "expectedEnd": [51, 72], "note": "" }
//   ]
// }

const int = (v, min = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min ? n : null;
};

// Pick this size's value from a number or a per-size array.
export function forSize(v, size) {
  if (Array.isArray(v)) return v[Math.min(size, v.length - 1)];
  return v;
}

// Turn pasted JSON (or the setup form) into a clean pattern, or throw an
// Error whose message tells the user what to fix.
export function normalize(input) {
  const raw = typeof input === 'string' ? JSON.parse(input) : input;
  if (!raw || typeof raw !== 'object') throw new Error('The pattern should be a JSON object.');
  const sizes = Array.isArray(raw.sizes) ? raw.sizes.map(String).filter(Boolean) : [];
  const nSizes = Math.max(1, sizes.length);
  const perSize = (v, what, min) => {
    if (v === undefined || v === null || v === '') return null;
    const arr = Array.isArray(v) ? v : [v];
    const out = arr.map((x) => int(x, min));
    if (out.some((x) => x === null)) throw new Error(`${what} must be a whole number.`);
    if (out.length === 1) return out[0];
    return out;
  };
  const sectionsIn = Array.isArray(raw.sections) ? raw.sections : [];
  if (!sectionsIn.length) throw new Error('Add at least one section.');
  const sections = sectionsIn.map((s, i) => {
    const label = s.name ? `“${s.name}”` : `Section ${i + 1}`;
    const rowsPerRepeat = int(s.rowsPerRepeat ?? s.rows, 1);
    if (!rowsPerRepeat) throw new Error(`${label}: rows per repeat must be 1 or more.`);
    const repeats = perSize(s.repeats ?? 1, `${label}: repeats`, 1);
    const stitchChanges = {};
    for (const [k, v] of Object.entries(s.stitchChanges || {})) {
      const row = int(k, 1);
      const d = Math.round(Number(v));
      if (!row || row > rowsPerRepeat) throw new Error(`${label}: stitch change on row ${k}, but the repeat only has ${rowsPerRepeat} rows.`);
      if (!Number.isFinite(d)) throw new Error(`${label}: row ${k} change should be a number like +1 or -2.`);
      if (d) stitchChanges[row] = d;
    }
    return {
      name: String(s.name || `Section ${i + 1}`).slice(0, 60),
      rowsPerRepeat,
      repeats,
      stitchChanges,
      expectedEnd: perSize(s.expectedEnd, `${label}: expected stitches`, 0),
      note: s.note ? String(s.note).slice(0, 300) : '',
    };
  });
  return {
    name: raw.name ? String(raw.name).slice(0, 80) : '',
    sizes,
    size: Math.min(int(raw.size) ?? 0, nSizes - 1),
    firstRowSide: String(raw.firstRowSide || 'RS').toUpperCase() === 'WS' ? 'WS' : 'RS',
    castOn: int(raw.castOn) ?? null,
    sections,
  };
}

// Section summaries for the chosen size: where each ends, stitch counts, and
// whether they match the counts the pattern states.
export function plan(p) {
  let row = 0;
  let sts = p.castOn;
  return p.sections.map((s) => {
    const repeats = forSize(s.repeats, p.size) || 1;
    const perRepeat = Object.values(s.stitchChanges).reduce((a, b) => a + b, 0);
    const startRow = row + 1;
    const startSts = sts;
    row += repeats * s.rowsPerRepeat;
    if (sts !== null) sts += repeats * perRepeat;
    const expected = forSize(s.expectedEnd, p.size);
    return {
      ...s,
      repeats,
      startRow,
      endRow: row,
      startSts,
      endSts: sts,
      expected: expected ?? null,
      matches: expected == null || sts === null ? null : expected === sts,
    };
  });
}

export function totalRows(p) {
  const pl = plan(p);
  return pl.length ? pl[pl.length - 1].endRow : 0;
}

// Where the knitter is after `done` rows: the row they're about to work.
export function position(p, done) {
  const pl = plan(p);
  const total = pl.length ? pl[pl.length - 1].endRow : 0;
  const row = done + 1;
  const sideOf = (r) => ((r % 2 === 1) === (p.firstRowSide === 'RS') ? 'RS' : 'WS');
  if (row > total) {
    return { complete: true, total, side: sideOf(row), sts: pl.length ? pl[pl.length - 1].endSts : p.castOn };
  }
  const i = pl.findIndex((s) => row <= s.endRow);
  const s = pl[i];
  const into = row - s.startRow; // 0-based rows into this section
  const repeat = Math.floor(into / s.rowsPerRepeat) + 1;
  const rowInRepeat = (into % s.rowsPerRepeat) + 1;
  const perRepeat = Object.values(s.stitchChanges).reduce((a, b) => a + b, 0);
  let sts = null;
  if (s.startSts !== null) {
    sts = s.startSts + (repeat - 1) * perRepeat;
    for (let r = 1; r < rowInRepeat; r++) sts += s.stitchChanges[r] || 0;
  }
  const change = s.stitchChanges[rowInRepeat] || 0;
  return {
    complete: false,
    total,
    row,
    side: sideOf(row),
    sectionIndex: i,
    sectionCount: pl.length,
    section: s,
    repeat,
    repeats: s.repeats,
    rowInRepeat,
    rowsPerRepeat: s.rowsPerRepeat,
    sts, // on the needle before working this row
    change, // stitches gained or lost on this row
    after: sts === null ? null : sts + change,
  };
}

// ---- helpers for the setup form ----

// "14 (21)" or "14, 21" or "14" → 14 or [14, 21]
export function parseSizes(text) {
  const nums = String(text || '').match(/-?\d+/g);
  if (!nums) return null;
  return nums.length === 1 ? Number(nums[0]) : nums.map(Number);
}

export function formatSizes(v) {
  if (v == null) return '';
  if (!Array.isArray(v)) return String(v);
  return `${v[0]}${v.length > 1 ? ` (${v.slice(1).join(', ')})` : ''}`;
}

// "3:+1, 5:+1, 9:-2" ↔ { 3: 1, 5: 1, 9: -2 }
export function parseChanges(text) {
  const out = {};
  const parts = String(text || '').split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^(?:row\s*)?(\d+)\s*[:=]?\s*([+\-−]?\s*\d+)$/i);
    if (!m) throw new Error(`Couldn't read “${part}”. Use row:change, like 3:+1 or 5:-1.`);
    out[m[1]] = Number(m[2].replace('−', '-').replace(/\s/g, ''));
  }
  return out;
}

export function formatChanges(obj) {
  return Object.entries(obj || {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([r, d]) => `${r}:${d > 0 ? '+' : ''}${d}`)
    .join(', ');
}

export const signed = (d) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '0');

// Stitches worked over the first `done` rows: each row produces the number of
// stitches on the needle after it. Null when the cast-on count is unknown.
export function stitchesWorked(p, done) {
  if (p.castOn == null) return null;
  let sts = p.castOn;
  let total = 0;
  let row = 0;
  for (const s of plan(p)) {
    for (let r = 0; r < s.repeats; r++) {
      for (let i = 1; i <= s.rowsPerRepeat; i++) {
        if (row >= done) return total;
        row++;
        sts += s.stitchChanges[i] || 0;
        total += sts;
      }
    }
  }
  return total;
}
