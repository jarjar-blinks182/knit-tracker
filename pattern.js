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
      // A number, or one per size like [3, 1] for "3 (1) increases".
      const d = (Array.isArray(v) ? v : [v]).map((x) => Math.round(Number(String(x).replace('−', '-'))));
      if (!row || row > rowsPerRepeat) throw new Error(`${label}: stitch change on row ${k}, but the repeat only has ${rowsPerRepeat} rows.`);
      if (d.some((x) => !Number.isFinite(x))) throw new Error(`${label}: row ${k} change should be a number like +1 or -2.`);
      if (d.some((x) => x)) stitchChanges[row] = d.length === 1 ? d[0] : d;
    }
    const untilIn = Array.isArray(s.untilLength) ? s.untilLength : s.untilLength ? [s.untilLength] : [];
    const until = untilIn.map((x) => String(x).trim().slice(0, 60)).filter(Boolean);
    return {
      name: String(s.name || `Section ${i + 1}`).slice(0, 60),
      rowsPerRepeat,
      repeats: until.length ? null : repeats,
      // "Repeat until 11 cm": the knitter says when the section is done.
      untilLength: until.length > 1 ? until : until[0] || null,
      estimate: perSize(s.estimate, `${label}: estimated rows`, 1),
      inTheRound: typeof s.inTheRound === 'boolean' ? s.inTheRound : null,
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
    inTheRound: !!raw.inTheRound,
    castOn: perSize(raw.castOn, 'Cast-on stitches', 0),
    sections,
  };
}

const sumChanges = (s) => Object.values(s.stitchChanges).reduce((a, b) => a + b, 0);

// Resolve per-size stitch changes ({ 1: [3, 1] }) for the chosen size.
function changesFor(s, size) {
  const out = {};
  for (const [k, v] of Object.entries(s.stitchChanges || {})) {
    const d = forSize(v, size);
    if (d) out[k] = d;
  }
  return out;
}

// Stitches gained or lost over the first n rows of a section.
function stitchDelta(s, n) {
  let d = Math.floor(n / s.rowsPerRepeat) * sumChanges(s);
  for (let r = 1; r <= n % s.rowsPerRepeat; r++) d += s.stitchChanges[r] || 0;
  return d;
}

export const inRound = (p, s) => (s && s.inTheRound != null ? s.inTheRound : !!p.inTheRound);
export const rowWord = (p, s, n = 1) => `${inRound(p, s) ? 'round' : 'row'}${n === 1 ? '' : 's'}`;

// Section summaries for the chosen size: where each starts and ends, stitch
// counts, and whether they match the counts the pattern states.
// `ends` maps a "knit until length" section's index to the total rows done
// when the knitter finished it. The first unfinished one is `open`; rows of
// the sections after it aren't known yet (startRow/endRow are null).
export function plan(p, ends = {}) {
  let row = 0;
  let rowKnown = true;
  let sts = forSize(p.castOn, p.size) ?? null;
  return p.sections.map((raw, index) => {
    const s = { ...raw, stitchChanges: changesFor(raw, p.size) };
    const until = forSize(s.untilLength, p.size) || null;
    const expected = forSize(s.expectedEnd, p.size) ?? null;
    const startRow = rowKnown ? row + 1 : null;
    const startSts = sts;
    let repeats = null;
    let rowsIn = null;
    let open = false;
    if (until) {
      const end = rowKnown ? ends[index] : null;
      if (end != null && end >= row) {
        rowsIn = end - row;
        repeats = Math.ceil(rowsIn / s.rowsPerRepeat);
      } else {
        open = rowKnown;
      }
    } else {
      repeats = forSize(s.repeats, p.size) || 1;
      rowsIn = repeats * s.rowsPerRepeat;
    }
    if (rowsIn == null) {
      rowKnown = false;
      if (sts !== null && sumChanges(s) !== 0) sts = null;
    } else {
      if (rowKnown) row += rowsIn;
      if (sts !== null) sts += stitchDelta(s, rowsIn);
    }
    return {
      ...s,
      index,
      until,
      estimate: forSize(s.estimate, p.size) ?? null,
      repeats,
      startRow,
      endRow: rowKnown ? row : null,
      startSts,
      endSts: sts,
      open,
      expected,
      matches: expected == null || sts === null ? null : expected === sts,
    };
  });
}

// Total rows, or null while a "knit until length" section is unfinished.
export function totalRows(p, ends = {}) {
  const pl = plan(p, ends);
  return pl.length ? pl[pl.length - 1].endRow : 0;
}

// Drop finished-at marks beyond the current count (after undoing rows).
export function pruneEnds(ends, done) {
  const out = {};
  for (const [k, v] of Object.entries(ends || {})) if (v <= done) out[k] = v;
  return out;
}

// Where the knitter is after `done` rows: the row they're about to work.
export function position(p, done, ends = {}) {
  const pl = plan(p, ends);
  const row = done + 1;
  const s = pl.find((x) => (x.open ? row >= x.startRow : x.endRow != null && row <= x.endRow));
  const last = pl[pl.length - 1];
  if (!s) {
    return { complete: true, total: last?.endRow ?? done, side: null, sts: last ? last.endSts : forSize(p.castOn, p.size), unit: rowWord(p, last, 2) };
  }
  const round = inRound(p, s);
  const into = row - s.startRow; // 0-based rows into this section
  const repeat = Math.floor(into / s.rowsPerRepeat) + 1;
  const rowInRepeat = (into % s.rowsPerRepeat) + 1;
  const sts = s.startSts === null ? null : s.startSts + stitchDelta(s, into);
  const change = s.stitchChanges[rowInRepeat] || 0;
  return {
    complete: false,
    total: last.endRow, // null while a length section is open
    row,
    side: round ? null : ((row % 2 === 1) === (p.firstRowSide === 'RS') ? 'RS' : 'WS'),
    inRound: round,
    unit: rowWord(p, s),
    sectionIndex: s.index,
    sectionCount: pl.length,
    section: s,
    open: s.open, // "until length": the knitter taps done
    rowInSection: into + 1,
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

// "3:+1, 5:+1, 9:-2" ↔ { 3: 1, 5: 1, 9: -2 }; per size: "1:+3 (+1)" ↔ { 1: [3, 1] }
export function parseChanges(text) {
  const out = {};
  const num = (x) => Number(x.replace('−', '-').replace(/\s/g, ''));
  const parts = String(text || '').split(/[;\n]+|,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^(?:row\s*|round\s*)?(\d+)\s*[:=]?\s*([+\-−]?\s*\d+)\s*(?:\(([^)]*)\))?$/i);
    if (!m) throw new Error(`Couldn't read “${part}”. Use row:change, like 3:+1 or 5:-1, and 1:+3 (+1) for sizes.`);
    const more = m[3] ? m[3].split(',').map((x) => x.trim()).filter(Boolean) : [];
    if (more.some((x) => !/^[+\-−]?\s*\d+$/.test(x))) throw new Error(`Couldn't read the sizes in “${part}”.`);
    out[m[1]] = more.length ? [num(m[2]), ...more.map(num)] : num(m[2]);
  }
  return out;
}

export function formatChanges(obj) {
  const sg = (d) => `${d > 0 ? '+' : ''}${d}`;
  return Object.entries(obj || {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([r, d]) => `${r}:${Array.isArray(d) ? `${sg(d[0])}${d.length > 1 ? ` (${d.slice(1).map(sg).join(', ')})` : ''}` : sg(d)}`)
    .join(', ');
}

export const signed = (d) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '0');

// Stitches worked over the first `done` rows: each row produces the number of
// stitches on the needle after it. Null when the cast-on count is unknown.
export function stitchesWorked(p, done, ends = {}) {
  if (forSize(p.castOn, p.size) == null) return null;
  let total = 0;
  for (const s of plan(p, ends)) {
    if (s.startRow == null || s.startRow > done) break;
    if (s.startSts == null) return null;
    const n = (s.open ? done : Math.min(s.endRow, done)) - s.startRow + 1;
    for (let k = 1; k <= n; k++) total += s.startSts + stitchDelta(s, k);
  }
  return total;
}
