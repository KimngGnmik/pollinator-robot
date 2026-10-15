/* Team designs saved in the GitHub repo, picked from a dropdown. Used by the Workbench and Draftpad.
   const ss = SharedSave({repo, folder, def, container, select?, get, set, start, draftKey, label})
     folder     repo folder holding one JSON file per design plus index.json (the list everyone sees)
     def        repo path of the frozen default; never written here ("Restore default" loads it)
     container  where the Design list, status chip and Save button go (select: use this existing <select> instead)
     get()      the page's current design data, e.g. {code} or {code, rev}; set(data) shows a design
     start(d)   called once at load with the design to show (null: keep the page's own)
   Every save is a commit, so every version of every design is kept. Unsaved edits stay on the device, per design.
   The GitHub token is stored in this browser and shared by both pages. */
(function () {
'use strict';
window.SharedSave = function (o) {
  const GH = 'https://api.github.com/repos/' + o.repo;
  const LS = {get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }};
  const TOKEN = 'pw-gh-token', WHO = 'ss-your-name', LAST = o.draftKey + ':last', DRAFT = s => o.draftKey + ':draft:' + s;
  const token = () => LS.get(TOKEN) || '';
  const hdr = () => { const h = {Accept: 'application/vnd.github+json'}; if (token()) h.Authorization = 'Bearer ' + token(); return h; };
  const fromB64 = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, '')), c => c.charCodeAt(0)));
  const toB64 = s => { const by = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < by.length; i += 0x8000) bin += String.fromCharCode.apply(null, by.subarray(i, i + 0x8000)); return btoa(bin); };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'design';
  const path = slug => o.folder + '/' + slug + '.json';
  const httpErr = s => s === 404 ? 'not found' : s === 403 || s === 429 ? 'GitHub is rate-limiting this network; try again in a few minutes' : 'GitHub error ' + s;

  async function ghGet(p, ref) {
    const r = await fetch(GH + '/contents/' + p + '?ref=' + (ref || 'main'), {headers: hdr(), cache: 'no-store'});
    if (!r.ok) { const e = new Error(httpErr(r.status)); e.status = r.status; throw e; }
    const j = await r.json(); return {sha: j.sha, data: JSON.parse(fromB64(j.content))};
  }
  async function readJSON(p, ref) {                    // GitHub first (always fresh), the site's own copy as a fallback
    try { return await ghGet(p, ref); }
    catch (e) { if (ref || e.status === 404) throw e; const r = await fetch(p, {cache: 'no-store'}); if (!r.ok) throw e; return {sha: null, data: await r.json()}; }
  }
  async function ghPut(p, data, message, sha) {
    const body = {message, content: toB64(JSON.stringify(data, null, 2) + '\n'), branch: 'main'};
    if (sha) body.sha = sha;
    const r = await fetch(GH + '/contents/' + p, {method: 'PUT', headers: Object.assign(hdr(), {'Content-Type': 'application/json'}), body: JSON.stringify(body)});
    if (r.status === 401) throw new Error("GitHub didn't accept the token. Check it, or make a new one.");
    if (r.status === 403 || r.status === 404) throw new Error("That token can't write to pollinator-robot. It needs Contents: Read and write on this repository.");
    if (r.status === 409 || r.status === 422) { const e = new Error('Someone saved at the same moment. Press Save again.'); e.status = 409; throw e; }
    if (!r.ok) throw new Error('GitHub error ' + r.status);
    return (await r.json()).content.sha;
  }

  // ---- state
  let index = [];                                      // [{slug, name, savedAt, by}] from index.json
  let cur = null;                                      // {slug, name, sha, data}: the design being edited, as last saved
  const keys = () => Object.keys(o.get());
  const snap = d => JSON.stringify(keys().map(k => (d && d[k] != null ? d[k] : null)));
  const dirty = () => !cur || !cur.data || snap(cur.data) !== snap(o.get());
  const readDraft = s => { try { const d = JSON.parse(LS.get(DRAFT(s)) || 'null'); return d && d.data ? d : null; } catch (e) { return null; } };

  // ---- UI
  const css = document.createElement('style');
  css.textContent = `
.ss-bar{display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap}
.ss-sel{display:inline-flex;gap:6px;align-items:center;font-size:13px;color:var(--ss-muted,#666)}
.ss-sel select{font:inherit;font-size:14px;color:var(--ss-fg,#222);background:var(--ss-field,#fff);border:1px solid var(--ss-line,#ccc);border-radius:6px;padding:6px 8px;max-width:220px}
.ss-chip{border:1px solid currentColor;border-radius:999px;padding:3px 9px;font:600 11px/1.3 inherit;text-transform:uppercase;letter-spacing:.05em;background:none;cursor:pointer;white-space:nowrap}
.ss-chip.ok{color:#2f8a52}.ss-chip.dirty{color:#b06400}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .ss-chip.ok{color:#4fbf7a}:root:not([data-theme="light"]) .ss-chip.dirty{color:#f0a33a}}
:root[data-theme="dark"] .ss-chip.ok{color:#4fbf7a}:root[data-theme="dark"] .ss-chip.dirty{color:#f0a33a}
.ss-btn{font:inherit;font-size:14px;color:var(--ss-fg,#222);background:var(--ss-field,#fff);border:1px solid var(--ss-line,#ccc);border-radius:6px;padding:6px 12px;cursor:pointer}
.ss-btn.primary{background:var(--ss-accent,#2f5f9e);border-color:var(--ss-accent,#2f5f9e);color:var(--ss-accent-ink,#fff);font-weight:600}
.ss-btn:disabled{opacity:.5}
.ss-dlg{border:1px solid var(--ss-line,#ccc);border-radius:10px;background:var(--ss-bg,#fff);color:var(--ss-fg,#222);padding:0;width:min(500px,calc(100% - 32px))}
.ss-dlg::backdrop{background:rgba(0,0,0,.45)}
.ss-in{padding:16px;display:grid;gap:10px;font-size:14px}
.ss-in h3{margin:0;font-size:18px}
.ss-in p{margin:0;color:var(--ss-muted,#666)}
.ss-in label{display:grid;gap:4px;color:var(--ss-muted,#666);font-size:13px}
.ss-in input{font:inherit;font-size:15px;padding:7px 9px;border:1px solid var(--ss-line,#ccc);border-radius:6px;background:var(--ss-field,#fafafa);color:var(--ss-fg,#222);min-width:0}
.ss-two{display:grid;grid-template-columns:1fr 1fr;gap:8px}
@media (max-width:480px){.ss-two{grid-template-columns:1fr}}
.ss-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.ss-list{display:grid;gap:6px;max-height:240px;overflow:auto}
.ss-item{display:flex;gap:8px;align-items:center;border:1px solid var(--ss-line,#ccc);border-radius:6px;padding:7px 9px}
.ss-item.cur{border-color:#2f8a52}.ss-item div{flex:1;min-width:0}.ss-item b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ss-item small{color:var(--ss-muted,#666);font-size:12px}
.ss-note{border:1px solid #b06400;border-radius:6px;padding:9px;display:grid;gap:6px}
.ss-in details summary{cursor:pointer;font-weight:600}.ss-in ol{margin:6px 0;padding-left:20px;color:var(--ss-muted,#666);display:grid;gap:3px}
.ss-toast{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:var(--ss-fg,#222);color:var(--ss-bg,#fff);padding:9px 14px;border-radius:8px;font-size:14px;z-index:30;max-width:calc(100% - 32px)}`;
  document.head.appendChild(css);

  const bar = document.createElement('span'); bar.className = 'ss-bar';
  let sel = o.select, group = null;
  if (sel) {                                           // add "Team designs" to the page's own dropdown
    group = document.createElement('optgroup'); group.label = 'Team designs'; sel.insertBefore(group, sel.firstChild);
    const ex = [...sel.children].filter(c => c.tagName === 'OPTION');
    if (ex.length) { const g = document.createElement('optgroup'); g.label = 'Examples'; ex.forEach(op => g.appendChild(op)); sel.appendChild(g); }
    const prev = sel.onchange;
    sel.onchange = e => { const v = sel.value; if (v.startsWith('team:') || v === 'new:') return pick(v); if (prev) prev.call(sel, e); };
  } else {
    const lab = document.createElement('label'); lab.className = 'ss-sel'; lab.textContent = 'Design';
    sel = document.createElement('select'); sel.setAttribute('aria-label', 'Design'); group = sel;
    lab.appendChild(sel); bar.appendChild(lab);
    sel.onchange = () => pick(sel.value);
  }
  const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'ss-chip ok'; chip.textContent = 'Saved';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'ss-btn primary'; btn.textContent = 'Save';
  bar.append(chip, btn); o.container.appendChild(bar);

  const dlg = document.createElement('dialog'); dlg.className = 'ss-dlg';
  dlg.innerHTML = `<form method="dialog" class="ss-in">
  <h3>Save design</h3><p data-k="state"></p>
  <div class="ss-two"><label>Design name<input data-k="name" autocomplete="off"></label><label>Your name<input data-k="who" autocomplete="off" placeholder="so the team knows who"></label></div>
  <label>What changed?<input data-k="note" autocomplete="off" placeholder="e.g. raised roller 2"></label>
  <p data-k="hint">Saved designs appear in the Design list for everyone.</p>
  <div class="ss-row"><button type="button" class="ss-btn primary" data-k="save">Save for everyone</button></div>
  <div class="ss-note" data-k="conflict" hidden><span data-k="ctext"></span>
    <div class="ss-row"><button type="button" class="ss-btn" data-k="force">Save anyway</button><button type="button" class="ss-btn" data-k="theirs">Load theirs</button></div></div>
  <div class="ss-row"><button type="button" class="ss-btn" data-k="discard">Discard my changes</button><button type="button" class="ss-btn" data-k="default">Restore default</button></div>
  <p><b>Versions of this design</b></p><div class="ss-list" data-k="list"></div>
  <details data-k="tok"><summary data-k="toksum">GitHub access (needed to save)</summary>
    <ol><li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a></li>
    <li>Repository access: <b>Only select repositories</b> → <b>pollinator-robot</b></li>
    <li>Permissions: <b>+ Add permissions</b> → tick <b>Contents</b> → change it to <b>Read and write</b></li>
    <li><b>Generate token</b>, copy it, paste it here</li></ol>
    <div class="ss-row"><input type="password" data-k="tokin" placeholder="github_pat_…" aria-label="GitHub token" autocomplete="off" style="flex:1"><button type="button" class="ss-btn" data-k="tokset">Use token</button><button type="button" class="ss-btn" data-k="tokdel">Forget</button></div>
  </details>
  <div class="ss-row" style="justify-content:flex-end"><button class="ss-btn">Close</button></div></form>`;
  document.body.appendChild(dlg);
  const $k = k => dlg.querySelector('[data-k="' + k + '"]');
  const toastEl = document.createElement('div'); toastEl.className = 'ss-toast'; toastEl.hidden = true; document.body.appendChild(toastEl);
  let tt = 0; const toast = t => { toastEl.textContent = t; toastEl.hidden = false; clearTimeout(tt); tt = setTimeout(() => toastEl.hidden = true, 3500); };

  function renderSelect() {
    const items = index.slice();
    if (cur && !items.some(d => d.slug === cur.slug)) items.push({slug: cur.slug, name: cur.name, local: true});
    group.innerHTML = '';
    for (const d of items) {
      const op = document.createElement('option'); op.value = 'team:' + d.slug;
      op.textContent = d.name + (d.local ? ' (not saved yet)' : readDraft(d.slug) ? ' • unsaved' : '');
      group.appendChild(op);
    }
    const nw = document.createElement('option'); nw.value = 'new:'; nw.textContent = '+ New design…'; group.appendChild(nw);
    if (cur) sel.value = 'team:' + cur.slug;
  }
  let lastDirty = null;
  function tick() {                                    // every second: keep this device's unsaved copy, update the chip
    if (!cur) return;
    const d = dirty();
    if (d) LS.set(DRAFT(cur.slug), JSON.stringify({name: cur.name, data: o.get(), synced: snap(cur.data)}));
    else if (readDraft(cur.slug)) LS.set(DRAFT(cur.slug), '');
    chip.textContent = d ? 'Unsaved changes' : 'Saved';
    chip.className = 'ss-chip ' + (d ? 'dirty' : 'ok');
    if (d !== lastDirty) { lastDirty = d; renderSelect(); }
  }
  function stateText() {
    $k('state').textContent = !cur.data ? `"${cur.name}" isn't saved yet. Save it to add it to the Design list for everyone.`
      : dirty() ? `You have changes to "${cur.name}" on this device that nobody else sees yet.`
      : `"${cur.name}" is saved${cur.data.savedAt ? ' (' + new Date(cur.data.savedAt).toLocaleString() + (cur.data.by ? ', by ' + cur.data.by : '') + ')' : ''}.`;
  }

  async function loadIndex() {
    try { index = (await readJSON(o.folder + '/index.json')).data; } catch (e) { index = []; }
    index.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  }
  async function open(slug, boot, ignoreDraft) {
    let rec = null; try { rec = await readJSON(path(slug)); } catch (e) {}
    const meta = index.find(d => d.slug === slug), dr = ignoreDraft ? null : readDraft(slug);
    cur = {slug, name: (rec && rec.data.name) || (meta && meta.name) || (dr && dr.name) || slug, sha: rec ? rec.sha : null, data: rec ? rec.data : null};
    const show = dr ? dr.data : rec ? rec.data : null;
    LS.set(LAST, slug);
    if (boot) o.start(show); else if (show) o.set(show);
    if (dr && rec && dr.synced !== snap(rec.data)) setTimeout(() => toast(`Someone saved a newer "${cur.name}" since your unsaved changes. Open Save to compare or discard.`), 700);
    else if (dr && boot) setTimeout(() => toast('Your unsaved changes from last time are back.'), 700);
    lastDirty = null; tick(); renderSelect();
  }
  async function pick(v) {
    if (v === 'new:') {
      const name = (prompt('Name for the new design') || '').trim();
      if (!name) { renderSelect(); return; }
      const slug = slugify(name);
      if (index.some(d => d.slug === slug)) { toast(`"${name}" already exists, so it's open now.`); return open(slug); }
      let base = null; try { base = (await readJSON(o.def)).data; } catch (e) {}
      cur = {slug, name, sha: null, data: null};
      LS.set(LAST, slug);
      if (base) o.set(base);
      lastDirty = null; tick(); renderSelect();
      return toast(`New design "${name}". Press Save to share it.`);
    }
    if (v.startsWith('team:')) return open(v.slice(5));
  }

  async function listVersions() {
    const el = $k('list');
    if (!cur.data) { el.innerHTML = '<p>No saved versions yet.</p>'; return; }
    el.innerHTML = '<p>Loading…</p>';
    try {
      const r = await fetch(GH + '/commits?path=' + path(cur.slug) + '&per_page=30', {headers: hdr(), cache: 'no-store'});
      if (!r.ok) throw new Error(httpErr(r.status));
      const list = await r.json();
      el.innerHTML = list.map((c, i) => `<div class="ss-item${i ? '' : ' cur'}"><div><b>${esc(c.commit.message.split('\n')[0])}</b><small>${i ? '' : 'latest · '}${new Date(c.commit.author.date).toLocaleString()}</small></div><button type="button" class="ss-btn" data-ver="${c.sha}">Load</button></div>`).join('') || '<p>No saved versions yet.</p>';
    } catch (e) { el.innerHTML = '<p>' + esc(e.message) + '</p>'; }
  }
  function openDialog(tok) {
    $k('conflict').hidden = true; force = false;
    $k('name').value = cur.name; $k('who').value = LS.get(WHO) || '';
    stateText(); listVersions();
    $k('toksum').textContent = token() ? 'GitHub access: set on this browser' : 'GitHub access (needed to save)';
    $k('tok').open = !!tok || !token();
    if (!dlg.open) dlg.showModal();
  }
  chip.onclick = () => openDialog(); btn.onclick = () => openDialog();
  $k('name').oninput = () => {
    const slug = slugify($k('name').value || cur.name);
    $k('hint').textContent = slug === cur.slug ? 'Saved designs appear in the Design list for everyone.'
      : index.some(d => d.slug === slug) ? `"${$k('name').value}" already exists. Saving replaces it (its old versions are kept).`
      : `Saves as a new design "${$k('name').value}". "${cur.name}" stays as it is.`;
  };
  $k('tokset').onclick = () => { const t = $k('tokin').value.trim(); if (!t) return toast('Paste a token first'); LS.set(TOKEN, t); $k('tokin').value = ''; $k('tok').open = false; $k('toksum').textContent = 'GitHub access: set on this browser'; toast('Token saved in this browser'); };
  $k('tokdel').onclick = () => { LS.set(TOKEN, ''); $k('toksum').textContent = 'GitHub access (needed to save)'; toast('Token removed from this browser'); };

  let force = false;
  async function save() {
    if (!token()) { openDialog(true); return toast('Add a GitHub token to save for everyone'); }
    const name = $k('name').value.trim() || cur.name, slug = slugify(name), who = $k('who').value.trim();
    LS.set(WHO, who);
    $k('save').disabled = true;
    try {
      let latest = null;
      try { latest = await ghGet(path(slug)); } catch (e) { if (e.status !== 404) throw e; }
      if (!force && latest) {
        const changed = slug === cur.slug ? cur.sha && latest.sha !== cur.sha : true;
        if (changed) {
          $k('ctext').textContent = slug === cur.slug ? 'Someone saved a newer version of this design while you were editing. Saving yours replaces it, but theirs stays in Versions.'
            : `A design called "${latest.data.name}" already exists. Saving replaces it, but its old versions stay in Versions.`;
          $k('conflict').hidden = false; return;
        }
      }
      const data = Object.assign({name}, o.get(), {savedAt: new Date().toISOString(), by: who || undefined});
      const sha = await ghPut(path(slug), data, $k('note').value.trim() || `Update ${name}`, latest && latest.sha);
      const old = cur.slug;
      cur = {slug, name, sha, data};
      LS.set(DRAFT(slug), ''); if (old !== slug) LS.set(DRAFT(old), ''); LS.set(LAST, slug);
      for (let attempt = 0; attempt < 3; attempt++) {     // add / refresh this design in the shared list
        try {
          let idx = {sha: null, data: []}; try { idx = await ghGet(o.folder + '/index.json'); } catch (e) { if (e.status !== 404) throw e; }
          const list = idx.data.filter(d => d.slug !== slug); list.unshift({slug, name, savedAt: data.savedAt, by: who || undefined});
          await ghPut(o.folder + '/index.json', list, `List: ${name}`, idx.sha); index = list; break;
        } catch (e) { if (e.status !== 409 || attempt === 2) throw e; }
      }
      $k('note').value = ''; $k('conflict').hidden = true; force = false;
      lastDirty = null; tick(); renderSelect(); stateText(); listVersions();
      toast(`Saved "${name}" for everyone`);
    } catch (e) { toast("Couldn't save: " + e.message); }
    finally { $k('save').disabled = false; }
  }
  $k('save').onclick = () => { force = false; save(); };
  $k('force').onclick = () => { force = true; save(); };
  $k('theirs').onclick = () => { $k('conflict').hidden = true; dlg.close(); LS.set(DRAFT(cur.slug), ''); open(cur.slug, false, true).then(() => toast('Loaded the newest saved version')); };
  $k('discard').onclick = () => {
    dlg.close(); LS.set(DRAFT(cur.slug), '');
    if (!cur.data) { toast('Discarded'); return restoreDefault(); }
    open(cur.slug, false, true).then(() => toast('Back to the saved version'));
  };
  async function restoreDefault() { try { o.set((await readJSON(o.def)).data); toast('Default loaded. Save to make it this design again.'); } catch (e) { toast("Couldn't load the default: " + e.message); } }
  $k('default').onclick = () => { dlg.close(); restoreDefault(); };
  $k('list').onclick = async e => {
    const v = e.target.closest('[data-ver]'); if (!v) return;
    try { const f = await ghGet(path(cur.slug), v.dataset.ver); dlg.close(); o.set(f.data); toast('Older version loaded. Save to make it the latest.'); } catch (err) { toast("Couldn't load that version: " + err.message); }
  };

  // ---- start: the design this device had open last (or the newest one)
  (async () => {
    await loadIndex();
    const last = LS.get(LAST);
    const slug = last && (index.some(d => d.slug === last) || readDraft(last)) ? last : index.length ? index[0].slug : 'main';
    await open(slug, true);
    setInterval(tick, 1000);
  })();
  return {restoreDefault, refresh: async () => { await loadIndex(); renderSelect(); }};
};
})();
