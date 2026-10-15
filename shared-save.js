/* Shared saving for a page whose state is one block of code, kept in the GitHub repo so everyone opens the same design.
   SharedSave({repo, current, def, container, get, set, draftKey})
     current  repo path of the shared design (every Save is a commit, so every version is kept)
     def      repo path of the frozen default; never written here, "Restore default" loads it
     get/set  read and replace the page's code; draftKey is where the page keeps its own unsaved copy
   The GitHub token is shared with the Workbench (same site, same browser storage). */
(function () {
'use strict';
window.SharedSave = function (o) {
  const GH = 'https://api.github.com/repos/' + o.repo;
  const LS = {get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }};
  const TOKEN = 'pw-gh-token', SYNCED = o.draftKey + '.synced';
  let shared = null;
  const token = () => LS.get(TOKEN) || '';
  const hdr = () => { const h = {Accept: 'application/vnd.github+json'}; if (token()) h.Authorization = 'Bearer ' + token(); return h; };
  const fromB64 = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, '')), c => c.charCodeAt(0)));
  const toB64 = s => { const by = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < by.length; i += 0x8000) bin += String.fromCharCode.apply(null, by.subarray(i, i + 0x8000)); return btoa(bin); };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  async function ghFile(path, ref) {
    const r = await fetch(GH + '/contents/' + path + '?ref=' + (ref || 'main'), {headers: hdr(), cache: 'no-store'});
    if (!r.ok) { const e = new Error(r.status === 404 ? 'not found' : r.status === 403 || r.status === 429 ? 'GitHub is rate-limiting this network; try again in a few minutes' : 'GitHub error ' + r.status); e.status = r.status; throw e; }
    const j = await r.json(); return {sha: j.sha, data: JSON.parse(fromB64(j.content))};
  }
  async function read(path, ref) {
    try { const f = await ghFile(path, ref); return Object.assign({}, f.data, {sha: f.sha}); }
    catch (e) { if (ref) throw e; const r = await fetch(path, {cache: 'no-store'}); if (!r.ok) throw e; return Object.assign({}, await r.json(), {sha: null}); }
  }

  // ---- UI: a status chip and a Save button in the page header, one dialog
  const css = document.createElement('style');
  css.textContent = `
.ss-chip{border:1px solid currentColor;border-radius:999px;padding:3px 9px;font:600 11px var(--mono,monospace);text-transform:uppercase;letter-spacing:.05em;background:none;cursor:pointer}
.ss-chip.ok{color:#2f8a52}.ss-chip.dirty{color:#b06400}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .ss-chip.ok{color:#4fbf7a}:root:not([data-theme="light"]) .ss-chip.dirty{color:#f0a33a}}
.ss-btn{font:inherit;font-size:13px;color:var(--ink,#222);background:var(--panel,#fff);border:1px solid var(--rule,#ccc);border-radius:4px;padding:5px 10px;cursor:pointer}
.ss-btn.primary{background:var(--accent2,#2f5f9e);border-color:var(--accent2,#2f5f9e);color:#fff}
.ss-btn:disabled{opacity:.5}
.ss-dlg{border:1px solid var(--rule,#ccc);border-radius:8px;background:var(--panel,#fff);color:var(--ink,#222);padding:0;width:min(480px,calc(100% - 32px));font-family:var(--sans,system-ui,sans-serif)}
.ss-dlg::backdrop{background:rgba(0,0,0,.45)}
.ss-in{padding:16px;display:grid;gap:10px;font-size:14px}
.ss-in h3{margin:0;font:500 15px var(--mono,monospace);letter-spacing:.08em;text-transform:uppercase}
.ss-in p{margin:0;color:var(--ink2,#666)}
.ss-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.ss-row input{flex:1;min-width:0;font:inherit;padding:6px 8px;border:1px solid var(--rule,#ccc);border-radius:4px;background:var(--code-bg,#fafafa);color:var(--ink,#222)}
.ss-list{display:grid;gap:6px;max-height:260px;overflow:auto}
.ss-item{display:flex;gap:8px;align-items:center;border:1px solid var(--rule,#ccc);border-radius:4px;padding:7px 9px}
.ss-item.cur{border-color:#2f8a52}.ss-item div{flex:1;min-width:0}.ss-item b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ss-item small{color:var(--ink2,#666);font:11px var(--mono,monospace)}
.ss-note{border:1px solid #b06400;border-radius:4px;padding:8px;display:grid;gap:6px}
.ss-in details summary{cursor:pointer;font-weight:600}.ss-in ol{margin:6px 0;padding-left:20px;color:var(--ink2,#666)}
.ss-toast{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:var(--ink,#222);color:var(--paper,#fff);padding:8px 14px;border-radius:6px;font-size:13px;z-index:30;max-width:calc(100% - 32px)}`;
  document.head.appendChild(css);
  const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'ss-chip ok'; chip.textContent = 'Saved';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'ss-btn primary'; btn.textContent = 'Save';
  o.container.append(chip, btn);
  const dlg = document.createElement('dialog'); dlg.className = 'ss-dlg';
  dlg.innerHTML = `<form method="dialog" class="ss-in">
  <h3>Shared design</h3><p data-k="state">Loading…</p>
  <div class="ss-row"><input data-k="note" placeholder="What changed?" aria-label="What changed"><button type="button" class="ss-btn primary" data-k="save">Save for everyone</button></div>
  <div class="ss-note" data-k="conflict" hidden><span>Someone saved a newer version while you were editing. Saving yours replaces it, but theirs stays in Versions.</span>
    <div class="ss-row"><button type="button" class="ss-btn" data-k="force">Save mine anyway</button><button type="button" class="ss-btn" data-k="theirs">Load theirs</button></div></div>
  <div class="ss-row"><button type="button" class="ss-btn" data-k="discard">Discard my changes</button><button type="button" class="ss-btn" data-k="default">Restore default</button></div>
  <p><b>Versions</b></p><div class="ss-list" data-k="list"><p>Loading…</p></div>
  <details data-k="tok"><summary data-k="toksum">GitHub access (needed to save)</summary>
    <ol><li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a></li>
    <li>Repository access: <b>Only select repositories</b> → <b>pollinator-robot</b></li>
    <li>Permissions → Repository → <b>Contents: Read and write</b>, then Generate and copy it</li></ol>
    <p>Teammates you add as collaborators can use a classic token with the <b>public_repo</b> scope. The token stays in this browser only, and the Workbench uses the same one.</p>
    <div class="ss-row" style="margin-top:6px"><input type="password" data-k="tokin" placeholder="github_pat_…" aria-label="GitHub token" autocomplete="off"><button type="button" class="ss-btn" data-k="tokset">Use token</button><button type="button" class="ss-btn" data-k="tokdel">Forget</button></div>
  </details>
  <div class="ss-row" style="justify-content:flex-end"><button class="ss-btn">Close</button></div></form>`;
  document.body.appendChild(dlg);
  const $k = k => dlg.querySelector('[data-k="' + k + '"]');
  const toastEl = document.createElement('div'); toastEl.className = 'ss-toast'; toastEl.hidden = true; document.body.appendChild(toastEl);
  let tt = 0; const toast = t => { toastEl.textContent = t; toastEl.hidden = false; clearTimeout(tt); tt = setTimeout(() => toastEl.hidden = true, 3200); };

  const dirty = () => !shared || o.get() !== shared.code;
  function status() {
    const d = dirty();
    chip.textContent = !shared ? 'Offline' : d ? 'Unsaved changes' : 'Saved';
    chip.className = 'ss-chip ' + (d ? 'dirty' : 'ok');
    $k('state').textContent = !shared ? "Couldn't reach the shared design. Your edits are kept on this device."
      : d ? 'You have changes on this device that nobody else sees yet. Save them for everyone, or discard them.'
      : 'This is the shared design' + (shared.savedAt ? ', saved ' + new Date(shared.savedAt).toLocaleString() : '') + '.';
  }
  function load(d, msg) { o.set(d.code || ''); status(); if (msg) toast(msg); }
  function synced(code) { LS.set(SYNCED, code); }

  async function listVersions() {
    const el = $k('list');
    try {
      const r = await fetch(GH + '/commits?path=' + o.current + '&per_page=30', {headers: hdr(), cache: 'no-store'});
      if (!r.ok) throw new Error(r.status === 403 || r.status === 429 ? 'GitHub is rate-limiting this network; try again in a few minutes' : 'GitHub error ' + r.status);
      const list = await r.json();
      el.innerHTML = list.map((c, i) => `<div class="ss-item${i ? '' : ' cur'}"><div><b>${esc(c.commit.message.split('\n')[0])}</b><small>${i ? '' : 'current · '}${esc(c.commit.author.name)} · ${new Date(c.commit.author.date).toLocaleString()}</small></div><button type="button" class="ss-btn" data-ver="${c.sha}">Load</button></div>`).join('')
        + '<div class="ss-item"><div><b>Default</b><small>the frozen starting point, never overwritten</small></div><button type="button" class="ss-btn" data-def="1">Load</button></div>';
    } catch (e) { el.innerHTML = '<p>' + esc(e.message) + '</p>'; }
  }
  function open(tok) {
    $k('conflict').hidden = true; status(); listVersions();
    $k('toksum').textContent = token() ? 'GitHub access: set on this browser' : 'GitHub access (needed to save)';
    $k('tok').open = !!tok || !token();
    if (!dlg.open) dlg.showModal();
  }
  chip.onclick = () => open(); btn.onclick = () => open();
  $k('tokset').onclick = () => { const t = $k('tokin').value.trim(); if (!t) return toast('Paste a token first'); LS.set(TOKEN, t); $k('tokin').value = ''; $k('tok').open = false; $k('toksum').textContent = 'GitHub access: set on this browser'; toast('Token saved in this browser'); };
  $k('tokdel').onclick = () => { LS.set(TOKEN, ''); $k('toksum').textContent = 'GitHub access (needed to save)'; toast('Token removed from this browser'); };

  async function save(force) {
    if (!token()) { open(true); return toast('Add a GitHub token to save for everyone'); }
    $k('save').disabled = true;
    try {
      let latest = null;
      try { latest = await ghFile(o.current); } catch (e) { if (e.status !== 404) throw e; }
      if (!force && latest && shared && shared.sha && latest.sha !== shared.sha) { $k('conflict').hidden = false; return; }
      const code = o.get(), design = {name: o.label || 'Design', code, savedAt: new Date().toISOString()};
      const body = {message: $k('note').value.trim() || 'Update design', content: toB64(JSON.stringify(design, null, 2) + '\n'), branch: 'main'};
      if (latest) body.sha = latest.sha;
      const r = await fetch(GH + '/contents/' + o.current, {method: 'PUT', headers: Object.assign(hdr(), {'Content-Type': 'application/json'}), body: JSON.stringify(body)});
      if (r.status === 401) throw new Error("GitHub didn't accept the token. Check it, or make a new one.");
      if (r.status === 403 || r.status === 404) throw new Error("That token can't write to pollinator-robot. It needs Contents: Read and write on this repository.");
      if (r.status === 409 || r.status === 422) throw new Error('Someone saved at the same moment. Press Save again.');
      if (!r.ok) throw new Error('GitHub error ' + r.status);
      const j = await r.json();
      shared = Object.assign(design, {sha: j.content.sha}); synced(code);
      $k('note').value = ''; $k('conflict').hidden = true; status(); listVersions(); toast('Saved for everyone');
    } catch (e) { toast("Couldn't save: " + e.message); }
    finally { $k('save').disabled = false; }
  }
  $k('save').onclick = () => save(false);
  $k('force').onclick = () => save(true);
  $k('theirs').onclick = async () => { try { shared = await read(o.current); synced(shared.code); $k('conflict').hidden = true; load(shared, 'Loaded the newest shared design'); } catch (e) { toast("Couldn't load it: " + e.message); } };
  $k('discard').onclick = async () => { try { shared = await read(o.current); } catch (e) {} if (!shared) return toast("Can't reach the shared design right now"); synced(shared.code); load(shared, 'Back to the shared design'); };
  async function restoreDefault() { try { load(await read(o.def), 'Default loaded. Press Save to make it the shared design again.'); } catch (e) { toast("Couldn't load the default: " + e.message); } }
  $k('default').onclick = () => { dlg.close(); restoreDefault(); };
  $k('list').onclick = async e => {
    const v = e.target.closest('[data-ver]'), d = e.target.closest('[data-def]');
    if (d) { dlg.close(); return restoreDefault(); }
    if (!v) return;
    try { const f = await read(o.current, v.dataset.ver); dlg.close(); load(f, 'Older version loaded. Save to make it the shared design.'); } catch (err) { toast("Couldn't load that version: " + err.message); }
  };

  // ---- start: open the shared design unless this device has its own edits since it last synced
  (async () => {
    try { shared = await read(o.current); } catch (e) { shared = null; }
    const local = LS.get(o.draftKey), last = LS.get(SYNCED);
    if (shared && (local == null || local === last || local === shared.code)) { synced(shared.code); if (o.get() !== shared.code) o.set(shared.code); }
    else if (shared && local !== shared.code) setTimeout(() => toast('Your unsaved changes from last time are back. Open Save to share or discard them.'), 600);
    status();
    setInterval(status, 1000);
  })();
};
})();
