import * as store from './store.js';
import * as sync from './sync.js';
import * as P from './pattern.js';

const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const backEl = document.getElementById('back');
const badge = document.getElementById('sync-badge');
const dialog = document.getElementById('edit-dialog');
const form = document.getElementById('edit-form');

let current = null; // { name, id }
let editingId = null;
let wakeLock = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const craftIcon = (c) => (c === 'crochet' ? '🪝' : '🧶');

// ---------- routing ----------

function route() {
  const hash = location.hash || '#/';
  const ps = hash.match(/^#\/p\/([\w-]+)\/pattern/);
  if (ps) return showPatternSetup(ps[1]);
  const pd = hash.match(/^#\/p\/([\w-]+)\/details/);
  if (pd) return showDetails(pd[1]);
  if (hash.startsWith('#/stats')) return showStats();
  const m = hash.match(/^#\/p\/([\w-]+)/);
  if (m) return showCounter(m[1]);
  if (hash.startsWith('#/settings')) return showSettings();
  return showList();
}

window.addEventListener('hashchange', route);
store.subscribe(({ fromRemote }) => {
  // Re-render on synced changes, and on local changes in the list view.
  if (current?.name === 'list' || (fromRemote && ['counter', 'stats'].includes(current?.name))) route();
});

function setChrome(title, showBack) {
  titleEl.textContent = title;
  backEl.hidden = !showBack;
  backEl.href = '#/';
  backEl.textContent = '‹ Projects';
  document.title = showBack ? `${title} · Row Counter` : 'Row Counter';
}

// ---------- list ----------

function showList() {
  current = { name: 'list' };
  releaseWakeLock();
  setChrome('Projects', false);
  const projects = store.listProjects();
  const active = projects.filter((p) => p.status !== 'finished');
  const finished = projects
    .filter((p) => p.status === 'finished')
    .sort((a, b) => ((a.finishedAt || '') < (b.finishedAt || '') ? 1 : -1));
  view.innerHTML = `
    <section class="list">
      ${active.length ? active.map(card).join('') : `
        <div class="empty">
          <p class="big">🧶</p>
          <p>${finished.length ? 'Nothing on the needles right now.' : 'No projects yet.'}</p>
          <p class="muted">Add one for each thing on your needles or hook.</p>
        </div>`}
      <div class="list-actions">
        <button class="primary new-btn" id="new-btn">+ New project</button>
        <a class="ghost button" href="#/stats">Stats</a>
      </div>
      ${finished.length ? `
        <details class="finished" id="finished-list">
          <summary>Finished <span class="muted">(${finished.length})</span></summary>
          <div class="list">${finished.map(card).join('')}</div>
        </details>` : ''}
    </section>`;
  try {
    const fl = view.querySelector('#finished-list');
    if (fl) {
      fl.open = localStorage.getItem('rowcounter.finishedOpen') === '1';
      fl.ontoggle = () => { try { localStorage.setItem('rowcounter.finishedOpen', fl.open ? '1' : '0'); } catch {} };
    }
  } catch {}
  view.querySelector('#new-btn').onclick = () => openEditor(null);
}

function card(p) {
  const pct = p.target ? Math.min(100, Math.round((p.rows / p.target) * 100)) : null;
  let sub = p.target ? `${p.rows} of ${p.target} rows` : `${p.rows} row${p.rows === 1 ? '' : 's'}`;
  if (p.status === 'finished') {
    sub = `Finished${p.finishedAt ? ` ${fmtDate(p.finishedAt)}` : ''} · ${p.rows} rows`;
  } else if (p.pattern) {
    const pos = P.position(p.pattern, p.rows);
    sub = pos.complete ? 'Pattern complete' : `${esc(pos.section.name)} · repeat ${pos.repeat}/${pos.repeats} · row ${pos.rowInRepeat}/${pos.rowsPerRepeat}`;
  }
  return `
    <a class="card ${p.status === 'finished' ? 'is-finished' : ''}" href="#/p/${p.id}">
      <span class="card-icon" aria-hidden="true">${craftIcon(p.craft)}</span>
      <span class="card-main">
        <span class="card-name">${esc(p.name)}</span>
        <span class="card-sub">${sub}</span>
        ${pct !== null ? `<span class="bar"><span style="width:${pct}%"></span></span>` : ''}
      </span>
      <span class="card-count">${p.rows}</span>
    </a>`;
}

// ---------- counter ----------

function showCounter(id) {
  const p = store.getProject(id);
  if (!p) { location.hash = '#/'; return; }
  const isRerender = current?.name === 'counter' && current.id === id;
  current = { name: 'counter', id };
  setChrome(p.name, true);
  requestWakeLock();

  // If only the numbers changed (e.g. from sync), update in place so the
  // notes field keeps focus and cursor position.
  if (isRerender && view.querySelector('.counter')) return paintCounter(p);

  view.innerHTML = `
    <section class="counter">
      <button class="tap" id="plus" aria-label="Add a row">
        <span class="count" id="count"></span>
        <span class="count-label" id="count-label"></span>
        <span class="repeat" id="repeat"></span>
        <span class="next" id="next"></span>
      </button>
      <div class="progress" id="progress"><span></span></div>
      <div class="pattern-panel" id="pattern-panel" hidden></div>
      <div class="controls">
        <button id="minus" class="ghost" aria-label="Remove a row">− 1</button>
        <button id="plus2" class="primary" aria-label="Add a row">+ 1</button>
      </div>
      <label class="notes">Notes
        <textarea id="notes" rows="4" placeholder="Anything to remember about this project…"></textarea>
      </label>
      <a class="details-card" id="details-card" href="#/p/${p.id}/details"></a>
      <div class="row-actions">
        <button id="finish" class="ghost"></button>
        <button id="edit" class="ghost">Edit project</button>
        <a id="pattern-btn" class="ghost button" href="#/p/${p.id}/pattern"></a>
        <button id="reset" class="ghost">Reset count</button>
      </div>
    </section>`;

  const bump = (d) => {
    const cur = store.getProject(id);
    const rows = Math.max(0, cur.rows + d);
    if (rows === cur.rows) return;
    store.updateProject(id, { rows });
    if (navigator.vibrate) navigator.vibrate(d > 0 ? 15 : [10, 40, 10]);
    paintCounter(store.getProject(id));
  };
  view.querySelector('#plus').onclick = () => bump(1);
  view.querySelector('#plus2').onclick = () => bump(1);
  view.querySelector('#minus').onclick = () => bump(-1);
  view.querySelector('#edit').onclick = () => openEditor(id);
  view.querySelector('#finish').onclick = () => toggleFinished(id);
  view.querySelector('#reset').onclick = async () => {
    if (await ask('Reset the row count to 0?', 'Reset')) {
      store.updateProject(id, { rows: 0 });
      paintCounter(store.getProject(id));
    }
  };

  const notes = view.querySelector('#notes');
  notes.value = p.notes || '';
  let t;
  notes.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => store.updateProject(id, { notes: notes.value }), 500);
  };
  notes.onblur = () => { clearTimeout(t); if (notes.value !== store.getProject(id)?.notes) store.updateProject(id, { notes: notes.value }); };

  paintCounter(p);
}

function paintCounter(p) {
  setChrome(p.name, true);
  view.querySelector('#count').textContent = p.rows;
  view.querySelector('#count-label').textContent = p.target ? `of ${p.target} rows done` : (p.rows === 1 ? 'row done' : 'rows done');
  view.querySelector('#pattern-btn').textContent = p.pattern ? 'Edit pattern' : 'Set up pattern';
  view.querySelector('#finish').textContent = p.status === 'finished' ? 'Mark as in progress' : 'Mark as finished';
  view.querySelector('#finish').className = p.status !== 'finished' && p.pattern && p.rows >= P.totalRows(p.pattern) ? 'primary' : 'ghost';
  view.querySelector('#details-card').innerHTML = detailsSummary(p);
  const rep = view.querySelector('#repeat');
  const next = view.querySelector('#next');
  const panel = view.querySelector('#pattern-panel');
  const pos = p.pattern ? P.position(p.pattern, p.rows) : null;
  next.hidden = !pos;
  panel.hidden = !pos;
  if (pos) {
    next.innerHTML = pos.complete
      ? 'Pattern complete'
      : `Next: row ${pos.row} <span class="side side-${pos.side}">${pos.side}</span>`;
    panel.innerHTML = pos.complete ? `
      <div class="pp-main"><strong>All ${pos.total} rows done.</strong>${pos.sts != null ? ` ${pos.sts} sts on the needle.` : ''}</div>
      ${p.pattern.sections.at(-1).note ? `<div class="pp-note">${esc(p.pattern.sections.at(-1).note)}</div>` : ''}` : `
      <div class="pp-head">
        <span class="pp-section">${esc(pos.section.name)}</span>
        <span class="muted">section ${pos.sectionIndex + 1} of ${pos.sectionCount}</span>
      </div>
      <div class="pp-grid">
        <div><span class="pp-label">Repeat</span><span class="pp-val">${pos.repeat} <small>of ${pos.repeats}</small></span></div>
        <div><span class="pp-label">Row</span><span class="pp-val">${pos.rowInRepeat} <small>of ${pos.rowsPerRepeat}</small></span></div>
        ${pos.sts != null ? `<div><span class="pp-label">On needle</span><span class="pp-val">${pos.sts} <small>sts</small></span></div>` : ''}
      </div>
      <div class="pp-change ${pos.change ? (pos.change > 0 ? 'inc' : 'dec') : ''}">
        ${pos.change
          ? `This row: <strong>${pos.change > 0 ? 'increase' : 'decrease'} ${P.signed(pos.change)}</strong>${pos.after != null ? ` → ${pos.after} sts` : ''}`
          : 'This row: no increases or decreases'}
      </div>
      ${pos.section.note ? `<div class="pp-note">${esc(pos.section.note)}</div>` : ''}`;
  }
  if (p.repeat && !pos) {
    const done = Math.floor(p.rows / p.repeat);
    rep.textContent = `${p.rows % p.repeat} / ${p.repeat} into repeat ${done + 1}`;
    rep.hidden = false;
  } else {
    rep.hidden = true;
  }
  const prog = view.querySelector('#progress');
  prog.hidden = !p.target;
  if (p.target) prog.firstElementChild.style.width = `${Math.min(100, (p.rows / p.target) * 100)}%`;
  const notes = view.querySelector('#notes');
  if (document.activeElement !== notes && notes.value !== (p.notes || '')) notes.value = p.notes || '';
}

// ---------- confirm / notice (in-app, since some views block confirm()) ----------

function ask(message, okLabel = 'OK', withCancel = true) {
  const d = document.getElementById('ask-dialog');
  d.querySelector('#ask-text').textContent = message;
  d.querySelector('#ask-ok').textContent = okLabel;
  d.querySelector('#ask-cancel').hidden = !withCancel;
  d.returnValue = '';
  d.showModal();
  return new Promise((resolve) => {
    d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
  });
}

// ---------- create / edit ----------

function openEditor(id) {
  editingId = id;
  const p = id ? store.getProject(id) : null;
  form.reset();
  document.getElementById('edit-heading').textContent = p ? 'Edit project' : 'New project';
  document.getElementById('delete-btn').hidden = !p;
  form.querySelector('.two').hidden = !!p?.pattern;
  form.querySelector('#spr-row').hidden = !!p?.pattern;
  if (p) {
    form.elements.name.value = p.name;
    form.elements.craft.value = p.craft;
    form.elements.target.value = p.target ?? '';
    form.elements.repeat.value = p.repeat ?? '';
    form.elements.stitchesPerRow.value = p.stitchesPerRow ?? '';
  }
  dialog.showModal();
  if (!p) form.elements.name.focus();
}

dialog.addEventListener('close', () => {
  if (dialog.returnValue !== 'save') return;
  const num = (v) => (v && Number(v) > 0 ? Math.floor(Number(v)) : null);
  const fields = {
    name: form.elements.name.value.trim() || 'Untitled',
    craft: form.elements.craft.value,
    target: num(form.elements.target.value),
    repeat: num(form.elements.repeat.value),
    stitchesPerRow: num(form.elements.stitchesPerRow.value),
  };
  if (editingId) {
    if (store.getProject(editingId)?.pattern) { delete fields.target; delete fields.repeat; delete fields.stitchesPerRow; }
    store.updateProject(editingId, fields);
    route();
  } else {
    const p = store.createProject(fields);
    location.hash = `#/p/${p.id}`;
  }
});

document.getElementById('delete-btn').onclick = async () => {
  const p = store.getProject(editingId);
  if (p && await ask(`Delete “${p.name}”? This can't be undone.`, 'Delete')) {
    store.deleteProject(editingId);
    dialog.close('deleted');
    location.hash = '#/';
  }
};


// ---------- finished / details ----------

const WEIGHTS = ['Lace', 'Fingering', 'Sport', 'DK', 'Worsted', 'Aran', 'Bulky', 'Super bulky', 'Jumbo'];

function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return ''; }
}

function toggleFinished(id) {
  const p = store.getProject(id);
  if (p.status === 'finished') store.updateProject(id, { status: 'active', finishedAt: null });
  else store.updateProject(id, { status: 'finished', finishedAt: store.now() });
  paintCounter(store.getProject(id));
}

function yarnLine(y) {
  return [y.brand, y.name].filter(Boolean).join(' ') + (y.color ? ` · ${y.color}` : '') + (y.weight ? ` · ${y.weight}` : '');
}

function detailsSummary(p) {
  const yarns = (p.yarns || []).filter((y) => y.brand || y.name || y.color || y.weight);
  const tool = p.craft === 'crochet' ? 'Hook' : 'Needles';
  if (!yarns.length && !p.needle && !p.link) {
    return `<span class="dc-empty">Add yarn and ${tool.toLowerCase()} ›</span>`;
  }
  return `
    ${yarns.map((y) => `<span class="dc-row"><span class="dc-label">Yarn</span><span>${esc(yarnLine(y))}</span></span>`).join('')}
    ${p.needle ? `<span class="dc-row"><span class="dc-label">${tool}</span><span>${esc(p.needle)}</span></span>` : ''}
    ${p.link ? `<span class="dc-row"><span class="dc-label">Pattern</span><span class="dc-link">${esc(p.link)}</span></span>` : ''}
    <span class="dc-edit">Edit details ›</span>`;
}

function showDetails(id) {
  const p = store.getProject(id);
  if (!p) { location.hash = '#/'; return; }
  current = { name: 'details', id };
  releaseWakeLock();
  setChrome('Project details', true);
  backEl.href = `#/p/${id}`;
  backEl.textContent = '‹ Counter';
  const tool = p.craft === 'crochet' ? 'Hook size' : 'Needle size';
  const day = (iso) => (iso ? iso.slice(0, 10) : '');

  view.innerHTML = `
    <form class="setup" id="details-form">
      <h2>Yarn</h2>
      <div id="yarns" class="sections"></div>
      <button type="button" class="ghost" id="add-yarn">+ Add another yarn</button>

      <h2>Tools</h2>
      <label>${tool}
        <input id="needle" value="${esc(p.needle)}" placeholder="${p.craft === 'crochet' ? 'e.g. 4 mm (G-6)' : 'e.g. 3.5 mm (US 4), 80 cm circular'}" autocomplete="off">
      </label>

      <h2>Pattern</h2>
      <label>Pattern name, designer or link
        <input id="link" value="${esc(p.link)}" placeholder="e.g. Waffle Loop Bandana by Other Loops" autocomplete="off">
      </label>

      <h2>Dates</h2>
      <div class="two">
        <label>Started <input type="date" id="started" value="${day(p.createdAt)}"></label>
        <label>Finished <input type="date" id="finished" value="${day(p.finishedAt)}"></label>
      </div>
      <p class="muted small">Setting a finished date marks the project as finished.</p>

      <div class="row-actions setup-actions">
        <span class="spacer"></span>
        <a class="ghost button" href="#/p/${id}">Cancel</a>
        <button class="primary" id="save-details">Save</button>
      </div>
    </form>`;

  const yarnsEl = view.querySelector('#yarns');
  const yarnRow = (y = {}) => {
    const el = document.createElement('div');
    el.className = 'section-card';
    el.innerHTML = `
      <div class="two">
        <label>Brand <input class="y-brand" value="${esc(y.brand)}" placeholder="e.g. Gepard" autocomplete="off"></label>
        <label>Yarn <input class="y-name" value="${esc(y.name)}" placeholder="e.g. Eco Cashmere Vintage" autocomplete="off"></label>
        <label>Color <input class="y-color" value="${esc(y.color)}" placeholder="e.g. 126" autocomplete="off"></label>
        <label>Weight
          <select class="y-weight">
            <option value=""></option>
            ${WEIGHTS.map((w) => `<option ${w === y.weight ? 'selected' : ''}>${w}</option>`).join('')}
          </select>
        </label>
      </div>
      <button type="button" class="danger y-remove">Remove yarn</button>`;
    el.querySelector('.y-remove').onclick = () => el.remove();
    yarnsEl.append(el);
  };
  (p.yarns?.length ? p.yarns : [{}]).forEach(yarnRow);
  view.querySelector('#add-yarn').onclick = () => yarnRow();

  view.querySelector('#details-form').onsubmit = (e) => {
    e.preventDefault();
    const yarns = [...yarnsEl.querySelectorAll('.section-card')].map((el) => ({
      brand: el.querySelector('.y-brand').value.trim(),
      name: el.querySelector('.y-name').value.trim(),
      color: el.querySelector('.y-color').value.trim(),
      weight: el.querySelector('.y-weight').value,
    })).filter((y) => y.brand || y.name || y.color || y.weight);
    const started = view.querySelector('#started').value;
    const finished = view.querySelector('#finished').value;
    // Keep the original time of day when the date didn't change.
    const toIso = (d, prev) => (!d ? null : prev && prev.slice(0, 10) === d ? prev : new Date(`${d}T12:00:00`).toISOString());
    const patch = {
      yarns,
      needle: view.querySelector('#needle').value.trim(),
      link: view.querySelector('#link').value.trim(),
      createdAt: toIso(started, p.createdAt) || p.createdAt,
      finishedAt: toIso(finished, p.finishedAt),
    };
    patch.status = patch.finishedAt ? 'finished' : (p.status === 'finished' ? 'active' : p.status || 'active');
    store.updateProject(id, patch);
    location.hash = `#/p/${id}`;
  };
}

// ---------- stats ----------

function projectStitches(p) {
  if (p.pattern) return P.stitchesWorked(p.pattern, p.rows);
  if (p.stitchesPerRow) return p.stitchesPerRow * p.rows;
  return null;
}

function showStats() {
  current = { name: 'stats' };
  releaseWakeLock();
  setChrome('Stats', true);
  const all = store.listProjects();
  const finished = all.filter((p) => p.status === 'finished');
  const year = String(new Date().getFullYear());
  const thisYear = finished.filter((p) => (p.finishedAt || '').startsWith(year));
  const rows = all.reduce((a, p) => a + (p.rows || 0), 0);
  let stitches = 0;
  const unknown = [];
  for (const p of all) {
    const n = projectStitches(p);
    if (n == null) { if (p.rows) unknown.push(p); } else stitches += n;
  }
  const n = (x) => x.toLocaleString();
  const byCraft = (c) => finished.filter((p) => (p.craft || 'knit') === c).length;
  const weights = {};
  for (const p of finished) for (const y of p.yarns || []) if (y.weight) weights[y.weight] = (weights[y.weight] || 0) + 1;

  view.innerHTML = `
    <section class="stats">
      <div class="stat-hero">
        <span class="stat-label">Stitches worked</span>
        <span class="stat-big">${n(stitches)}</span>
        <span class="muted">${n(rows)} rows across ${all.length} project${all.length === 1 ? '' : 's'}</span>
      </div>
      <div class="stat-grid">
        <div class="stat"><span class="stat-val">${finished.length}</span><span class="stat-label">Finished</span></div>
        <div class="stat"><span class="stat-val">${thisYear.length}</span><span class="stat-label">Finished in ${year}</span></div>
        <div class="stat"><span class="stat-val">${all.length - finished.length}</span><span class="stat-label">In progress</span></div>
      </div>
      ${finished.length ? `<p class="muted small">Finished: ${byCraft('knit')} knitting, ${byCraft('crochet')} crochet${Object.keys(weights).length ? ` · yarn weights: ${Object.entries(weights).sort((a, b) => b[1] - a[1]).map(([w, c]) => `${esc(w)} ${c}`).join(', ')}` : ''}.</p>` : ''}
      ${unknown.length ? `<p class="muted small">Stitches aren't counted for ${unknown.map((p) => `<a href="#/p/${p.id}">${esc(p.name)}</a>`).join(', ')}. Set up a pattern or add stitches per row under Edit project.</p>` : ''}
      ${finished.length ? `
        <h2>Finished projects</h2>
        <div class="table-wrap summary"><table>
          <thead><tr><th>Project</th><th>Finished</th><th class="num">Stitches</th></tr></thead>
          <tbody>${finished.sort((a, b) => ((a.finishedAt || '') < (b.finishedAt || '') ? 1 : -1)).map((p) => {
            const st = projectStitches(p);
            return `<tr><td><a href="#/p/${p.id}">${esc(p.name)}</a>${p.yarns?.[0] ? `<br><small>${esc(yarnLine(p.yarns[0]))}</small>` : ''}</td>
              <td class="num">${p.finishedAt ? fmtDate(p.finishedAt) : ''}</td>
              <td class="num">${st == null ? '–' : n(st)}</td></tr>`;
          }).join('')}</tbody>
        </table></div>` : ''}
    </section>`;
}

// ---------- pattern setup ----------

function showPatternSetup(id) {
  const proj = store.getProject(id);
  if (!proj) { location.hash = '#/'; return; }
  current = { name: 'pattern', id };
  releaseWakeLock();
  setChrome('Pattern setup', true);
  backEl.href = `#/p/${id}`;
  backEl.textContent = '‹ Counter';

  view.innerHTML = `
    <section class="setup">
      <details class="paste" id="paste" ${proj.pattern ? '' : 'open'}>
        <summary>Paste pattern JSON</summary>
        <p class="muted">Paste JSON from Claude (see the README for the prompt), then check the sections below.</p>
        <textarea id="json" rows="6" spellcheck="false" placeholder='{ "castOn": 4, "sections": [ … ] }'></textarea>
        <div class="row-actions"><button type="button" class="primary" id="load-json">Load</button></div>
        <p class="msg" id="json-msg"></p>
      </details>

      <div class="setup-fields">
        <fieldset class="craft">
          <legend>First row is</legend>
          <label><input type="radio" name="side" value="RS" id="side-rs"> Right side (RS)</label>
          <label><input type="radio" name="side" value="WS" id="side-ws"> Wrong side (WS)</label>
        </fieldset>
        <div class="two">
          <label>Cast-on stitches <small>(optional)</small>
            <input id="cast-on" type="number" min="0" inputmode="numeric">
          </label>
          <label>Sizes <small>(optional)</small>
            <input id="sizes" placeholder="e.g. S, M, L" autocomplete="off">
          </label>
        </div>
        <label id="size-row" hidden>Size you're making
          <select id="size"></select>
        </label>
      </div>

      <h2>Sections</h2>
      <p class="muted small">For numbers that change by size, write them like the pattern does: <code>14 (21)</code>.
        Stitch changes are <code>row:change</code> within one repeat, like <code>1:+1, 3:+1, 5:+1</code>.</p>
      <div id="sections" class="sections"></div>
      <button type="button" class="ghost" id="add-section">+ Add section</button>

      <h2>Check</h2>
      <div id="summary" class="summary"></div>

      <div class="row-actions setup-actions">
        ${proj.pattern ? '<button type="button" class="danger" id="remove-pattern">Remove pattern</button>' : ''}
        <span class="spacer"></span>
        <a class="ghost button" href="#/p/${id}">Cancel</a>
        <button type="button" class="primary" id="save-pattern">Save pattern</button>
      </div>
    </section>`;

  const $ = (sel) => view.querySelector(sel);
  const sectionsEl = $('#sections');

  function sectionRow(s = {}) {
    const el = document.createElement('div');
    el.className = 'section-card';
    el.innerHTML = `
      <div class="section-top">
        <input class="s-name" placeholder="Section name, e.g. Increases" value="${esc(s.name || '')}">
        <button type="button" class="icon-btn s-remove" aria-label="Remove section">✕</button>
      </div>
      <div class="three">
        <label>Rows per repeat <input class="s-rows" inputmode="numeric" value="${esc(s.rowsPerRepeat ?? '')}"></label>
        <label>Repeats <input class="s-repeats" inputmode="numeric" value="${esc(P.formatSizes(s.repeats ?? 1))}"></label>
        <label>Stitches at end <small>(from pattern)</small> <input class="s-expected" inputmode="numeric" value="${esc(P.formatSizes(s.expectedEnd))}"></label>
      </div>
      <label>Stitch changes <input class="s-changes" placeholder="e.g. 1:+1, 3:+1, 5:+1" value="${esc(P.formatChanges(s.stitchChanges))}"></label>
      <label>Note <small>(optional)</small> <input class="s-note" value="${esc(s.note || '')}"></label>`;
    el.querySelector('.s-remove').onclick = () => { el.remove(); refresh(); };
    sectionsEl.append(el);
  }

  function fill(p) {
    $('#side-ws').checked = p.firstRowSide === 'WS';
    $('#side-rs').checked = p.firstRowSide !== 'WS';
    $('#cast-on').value = p.castOn ?? '';
    $('#sizes').value = (p.sizes || []).join(', ');
    syncSizes(p.size || 0);
    sectionsEl.innerHTML = '';
    (p.sections?.length ? p.sections : [{}]).forEach(sectionRow);
    refresh();
  }

  function syncSizes(selected) {
    const names = $('#sizes').value.split(',').map((x) => x.trim()).filter(Boolean);
    const sel = $('#size');
    const keep = selected ?? sel.selectedIndex;
    sel.innerHTML = names.map((n, i) => `<option value="${i}">${esc(n)}</option>`).join('');
    sel.selectedIndex = Math.max(0, Math.min(keep, names.length - 1));
    $('#size-row').hidden = names.length < 2;
  }

  // Read the form into a pattern; throws with a readable message.
  function read() {
    const sizes = $('#sizes').value.split(',').map((x) => x.trim()).filter(Boolean);
    const sections = [...sectionsEl.querySelectorAll('.section-card')].map((el, i) => {
      const name = el.querySelector('.s-name').value.trim() || `Section ${i + 1}`;
      let stitchChanges;
      try { stitchChanges = P.parseChanges(el.querySelector('.s-changes').value); }
      catch (e) { throw new Error(`${name}: ${e.message}`); }
      return {
        name,
        rowsPerRepeat: el.querySelector('.s-rows').value,
        repeats: P.parseSizes(el.querySelector('.s-repeats').value) ?? 1,
        expectedEnd: P.parseSizes(el.querySelector('.s-expected').value),
        stitchChanges,
        note: el.querySelector('.s-note').value.trim(),
      };
    });
    return P.normalize({
      name: proj.pattern?.name || '',
      sizes,
      size: sizes.length > 1 ? Number($('#size').value) : 0,
      firstRowSide: $('#side-ws').checked ? 'WS' : 'RS',
      castOn: $('#cast-on').value === '' ? null : $('#cast-on').value,
      sections,
    });
  }

  function refresh() {
    const out = $('#summary');
    try {
      const p = read();
      const pl = P.plan(p);
      const bad = pl.filter((s) => s.matches === false);
      out.innerHTML = `
        <div class="table-wrap"><table>
          <thead><tr><th>Section</th><th>Rows</th><th>Stitches</th></tr></thead>
          <tbody>${pl.map((s) => `
            <tr class="${s.matches === false ? 'warn' : ''}">
              <td>${esc(s.name)}<br><small>${s.repeats} × ${s.rowsPerRepeat} rows</small></td>
              <td class="num">${s.startRow}–${s.endRow}</td>
              <td class="num">${s.endSts == null ? '–' : `${s.startSts} → ${s.endSts}`}
                ${s.matches === true ? '<span class="ok" title="Matches the pattern">✓</span>' : ''}
                ${s.matches === false ? `<br><small>pattern says ${s.expected}</small>` : ''}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
        <p class="${bad.length ? 'msg error' : 'msg'}">${pl.at(-1).endRow} rows in total.
          ${bad.length ? `${bad.length} section${bad.length > 1 ? 's don’t' : ' doesn’t'} match the pattern’s stitch count. Check the highlighted rows.` : ''}</p>`;
      return p;
    } catch (e) {
      out.innerHTML = `<p class="msg error">${esc(e.message)}</p>`;
      return null;
    }
  }

  view.querySelector('.setup').addEventListener('input', (e) => {
    if (e.target.id === 'json') return;
    if (e.target.id === 'sizes') syncSizes();
    refresh();
  });
  $('#add-section').onclick = () => { sectionRow(); refresh(); };
  $('#load-json').onclick = () => {
    const msg = $('#json-msg');
    try {
      let text = $('#json').value.trim();
      // Tolerate a pasted ```json fenced block.
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      const p = P.normalize(text);
      fill(p);
      if (p.name && (proj.name === 'Untitled' || !proj.name)) store.updateProject(id, { name: p.name });
      msg.className = 'msg';
      msg.textContent = `Loaded ${p.sections.length} section${p.sections.length === 1 ? '' : 's'}. Check them below, then save.`;
      $('#paste').open = false;
    } catch (e) {
      msg.className = 'msg error';
      msg.textContent = e instanceof SyntaxError ? `That isn't valid JSON: ${e.message}` : e.message;
    }
  };
  $('#save-pattern').onclick = () => {
    const p = refresh();
    if (!p) return;
    store.updateProject(id, { pattern: p, target: P.totalRows(p), repeat: null });
    location.hash = `#/p/${id}`;
  };
  $('#remove-pattern')?.addEventListener('click', async () => {
    if (await ask('Remove the pattern from this project? The row count stays.', 'Remove')) {
      store.updateProject(id, { pattern: null, target: null });
      location.hash = `#/p/${id}`;
    }
  });

  fill(proj.pattern || { firstRowSide: 'RS', sections: [{}] });
}

// ---------- settings / sync ----------

function showSettings() {
  current = { name: 'settings' };
  releaseWakeLock();
  setChrome('Sync & backup', true);
  const s = sync.getStatus();
  let syncHtml;
  if (!s.configured) {
    syncHtml = `<p>Sync isn't set up yet, so projects are saved on this device only.</p>
      <p class="muted">Add your Firebase config to <code>config.js</code> to sync between your phone and iPad.</p>`;
  } else if (!s.user) {
    syncHtml = `
      <p>Sign in to sync your projects between devices. Use the same email and password on each one.</p>
      <form id="signin" class="stack">
        <label>Email <input type="email" name="email" id="signin-email" required autocomplete="email"></label>
        <label>Password <input type="password" name="password" id="signin-password" autocomplete="current-password" minlength="6"></label>
        <div class="row-actions">
          <button class="primary" value="signin">Sign in</button>
          <button class="ghost" value="create">Create account</button>
          <button class="ghost" value="reset" type="button" id="reset-pw">Forgot password</button>
        </div>
        <p class="muted" id="signin-msg"></p>
      </form>`;
  } else {
    syncHtml = `
      <p>Signed in as <strong>${esc(s.user.email)}</strong>.</p>
      <p class="muted">Status: <span id="status-text">${statusText(s)}</span></p>
      <div class="row-actions">
        <button class="primary" id="sync-now">Sync now</button>
        <button class="ghost" id="signout">Sign out</button>
      </div>`;
  }

  view.innerHTML = `
    <section class="settings">
      <h2>Sync</h2>
      ${syncHtml}
      <h2>Backup</h2>
      <p class="muted">Download all projects as a file, or restore from one.</p>
      <div class="row-actions">
        <button class="ghost" id="export">Download backup</button>
        <label class="ghost button">Restore backup<input type="file" id="import" accept="application/json" hidden></label>
      </div>
    </section>`;

  const signin = view.querySelector('#signin');
  if (signin) {
    const msg = view.querySelector('#signin-msg');
    const email = () => view.querySelector('#signin-email').value.trim();
    signin.onsubmit = async (e) => {
      e.preventDefault();
      const action = e.submitter?.value || 'signin';
      const password = view.querySelector('#signin-password').value;
      signin.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      msg.textContent = action === 'create' ? 'Creating your account…' : 'Signing in…';
      try {
        if (action === 'create') await sync.createAccount(email(), password);
        else await sync.signIn(email(), password);
        msg.textContent = '';
      } catch (err) {
        msg.textContent = sync.friendly(err);
      } finally {
        signin.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      }
    };
    view.querySelector('#reset-pw').onclick = async () => {
      if (!email()) { msg.textContent = 'Enter your email first.'; return; }
      try {
        await sync.resetPassword(email());
        msg.textContent = `If there's an account for ${email()}, a reset link is on its way.`;
      } catch (err) {
        msg.textContent = sync.friendly(err);
      }
    };
  }
  view.querySelector('#sync-now')?.addEventListener('click', () => sync.syncNow());
  view.querySelector('#signout')?.addEventListener('click', async () => { await sync.signOut(); showSettings(); });

  view.querySelector('#export').onclick = () => {
    const data = JSON.stringify({ exportedAt: store.now(), projects: store.listProjects() }, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = `row-counter-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  view.querySelector('#import').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { projects } = JSON.parse(await file.text());
      let n = 0;
      for (const p of projects || []) {
        if (!p.id || store.getProject(p.id)) continue;
        const { id, updatedAt, deleted, ...rest } = p;
        store.createProject(rest);
        n++;
      }
      ask(`Restored ${n} project${n === 1 ? '' : 's'}.`, 'OK', false);
    } catch {
      ask("That file couldn't be read as a backup.", 'OK', false);
    }
  };
}

function statusText(s) {
  return {
    local: 'This device only',
    'signed-out': 'Not signed in',
    syncing: 'Syncing…',
    synced: 'Up to date',
    offline: 'Offline, will sync when back online',
    error: `Sync problem: ${s.error}`,
  }[s.status];
}

let lastUserId;
sync.onStatus((s) => {
  // Redraw the sync screen when someone signs in or out.
  const uid = s.user?.id ?? null;
  if (uid !== lastUserId) {
    lastUserId = uid;
    if (current?.name === 'settings') showSettings();
  }
  badge.dataset.status = s.status;
  badge.title = statusText(s);
  badge.setAttribute('aria-label', `Sync: ${statusText(s)}`);
  const t = document.getElementById('status-text');
  if (t) t.textContent = statusText(s);
});

// ---------- keep screen awake while counting ----------

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {}
}
function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && current?.name === 'counter') requestWakeLock();
});

// ---------- start ----------

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
route();
sync.init();
