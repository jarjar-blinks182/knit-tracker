// Knitting time, worked out from counter taps so there is no timer to start
// or stop. Each tap adds the time since the previous tap, as long as that gap
// looks like knitting rather than a break. A gap counts as a break when it is
// longer than 3× this project's average row time (never under 15 minutes,
// never over an hour; 30 minutes until there are a few rows to average).
// The first row after a break gets the average row time, since its start
// wasn't tapped.
//
// Stored on the project: timeMs (total), timeRows (taps that added time, for
// the average), lastTapAt (ISO). timeMs can also be set by hand on the
// details page.

const MIN = 60 * 1000;

export function avgRowMs(p) {
  return p.timeRows >= 3 ? p.timeMs / p.timeRows : null;
}

export function breakAfterMs(p) {
  const avg = avgRowMs(p);
  if (avg == null) return 30 * MIN;
  return Math.min(60 * MIN, Math.max(15 * MIN, 3 * avg));
}

// Fields to merge into the project update for a tap at `at` (Date).
export function tapPatch(p, at = new Date()) {
  const timeMs = p.timeMs || 0;
  const timeRows = p.timeRows || 0;
  const last = p.lastTapAt ? Date.parse(p.lastTapAt) : NaN;
  const gap = at.getTime() - last;
  const patch = { lastTapAt: at.toISOString() };
  if (gap > 0 && gap <= breakAfterMs(p)) {
    patch.timeMs = timeMs + gap;
    patch.timeRows = timeRows + 1;
  } else {
    // Start of a session: credit the usual row time for the row just done.
    const avg = avgRowMs(p);
    if (avg) patch.timeMs = timeMs + avg;
  }
  return patch;
}

// True while taps are recent enough that the next one will still count.
export function knittingNow(p, at = Date.now()) {
  if (!p.lastTapAt) return false;
  return at - Date.parse(p.lastTapAt) <= breakAfterMs(p);
}

export function fmt(ms) {
  const m = Math.round((ms || 0) / MIN);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

// Whole hours once it's long, for small spaces like the stats tile.
export function fmtShort(ms) {
  return ms >= 10 * 60 * MIN ? `${Math.round(ms / (60 * MIN)).toLocaleString()} h` : fmt(ms);
}

// "1:30", "1h 30m", "90m", "90" (minutes), "1.5h" → ms; null if unreadable.
export function parse(text) {
  const s = String(text).trim().toLowerCase();
  if (!s) return 0;
  let m;
  if ((m = s.match(/^(\d+):([0-5]?\d)$/))) return (+m[1] * 60 + +m[2]) * MIN;
  if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) return Math.round(+m[1] * MIN);
  m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?|s)?)?)?$/);
  if (m && (m[1] || m[2])) return Math.round(((+m[1] || 0) * 60 + (+m[2] || 0)) * MIN);
  return null;
}
