/* beacon — SPA: search hero, live results, workspace send, keys sheet. */
"use strict";
const $ = (s, r) => (r || document).querySelector(s);
const view = $("#view");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, opts) {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
function toast(msg, ms) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), ms || 2600);
}
function openSheet(html) {
  $("#sheetBody").innerHTML = html;
  $("#sheetWrap").hidden = false;
}
function closeSheet() { $("#sheetWrap").hidden = true; }
document.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeSheet(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

/* ---------- home ---------- */
async function renderHome() {
  let jobs = [];
  try { jobs = (await api("/api/search")).jobs || []; } catch { /* offline */ }
  view.innerHTML = `
    <section class="hero">
      <p class="eyebrow">Business entity search</p>
      <h1>Find the companies <em>worth calling.</em></h1>
      <p>Natural-language search across the web for real businesses — by industry and territory. No people, no noise.</p>
    </section>
    <form class="card search-card" id="searchForm">
      <div class="field"><label for="fIndustry">Industry</label>
        <input id="fIndustry" placeholder="e.g. dental clinics" autocomplete="off" required></div>
      <div class="field"><label for="fLocation">Territory</label>
        <input id="fLocation" placeholder="e.g. Madisonville, Cincinnati" autocomplete="off" required></div>
      <button class="btn primary" type="submit">Search businesses</button>
      <p class="fineprint">Powered by Parallel FindAll · companies only</p>
    </form>
    <h2 class="section-t">Recent searches</h2>
    <div class="recent" id="recent"></div>`;
  const box = $("#recent");
  if (!jobs.length) {
    box.innerHTML = `<div class="empty">No searches yet — your history will appear here.</div>`;
  } else {
    box.innerHTML = jobs.slice(0, 8).map((j) => `
      <a class="jobrow" href="#/s/${esc(j.id)}">
        <span class="q"><b>${esc(j.industry)} · ${esc(j.location)}</b>
        <small>${new Date(j.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></span>
        <span class="pill ${esc(j.status)}">${j.status === "done" ? `<span class="n">${j.company_count}</span> found` : esc(j.status)}</span>
      </a>`).join("");
  }
  $("#searchForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const industry = $("#fIndustry").value.trim(), location = $("#fLocation").value.trim();
    if (!industry || !location) return;
    const btn = e.target.querySelector("button");
    btn.disabled = true; btn.textContent = "Starting…";
    try {
      const j = await api("/api/search", { method: "POST", body: JSON.stringify({ industry, location }) });
      location_hash(`#/s/${j.job_id}`);
    } catch (err) {
      toast(String(err.message || err));
      if (/api key/i.test(String(err.message))) openKeys();
      btn.disabled = false; btn.textContent = "Search businesses";
    }
  });
}
function location_hash(h) { window.location.hash = h; }

/* ---------- results ---------- */
let pollTimer = null;
const selected = new Set();

async function renderResults(id) {
  selected.clear();
  clearInterval(pollTimer);
  view.innerHTML = `
    <div class="res-head">
      <a class="back" href="#/">← New search</a>
      <h2 id="rTitle">Searching…</h2>
      <div class="meta" id="rMeta"></div>
      <div class="progress" id="rProg" hidden><i style="width:5%"></i></div>
      <p class="progress-label" id="rProgL"></p>
    </div>
    <div id="rBody"><div class="sk"><i style="width:70%"></i><i style="width:95%"></i><i style="width:40%"></i></div>
    <div class="sk"><i style="width:60%"></i><i style="width:90%"></i><i style="width:35%"></i></div></div>
    <div id="rBar"></div>`;
  const load = async () => {
    let job;
    try { job = await api(`/api/search/${encodeURIComponent(id)}`); }
    catch { $("#rBody").innerHTML = `<div class="err-card">Couldn't load this search.</div>`; return; }
    paintResults(job);
    if (job.status === "running") {
      clearInterval(pollTimer);
      pollTimer = setInterval(async () => {
        try {
          const j = await api(`/api/search/${encodeURIComponent(id)}`);
          paintResults(j);
          if (j.status !== "running") clearInterval(pollTimer);
        } catch { clearInterval(pollTimer); }
      }, 2500);
    }
  };
  await load();
}

function paintResults(job) {
  $("#rTitle").textContent = `${job.industry} · ${job.location}`;
  const done = job.status === "done", failed = job.status === "failed";
  $("#rMeta").innerHTML = `
    <span class="pill ${esc(job.status)}">${failed ? "failed" : job.status === "running" ? "searching" : `<span class="n">${job.companies.length}</span> companies`}</span>
    <span>via Parallel FindAll</span>`;
  const prog = $("#rProg"), pl = $("#rProgL");
  if (job.status === "running") {
    prog.hidden = false;
    const p = job.progress || { done: 0, total: 2 };
    prog.firstElementChild.style.width = Math.max(5, Math.round((p.done / Math.max(1, p.total)) * 100)) + "%";
    pl.textContent = p.current || "Searching the web for companies…";
  } else { prog.hidden = true; pl.textContent = ""; }

  const body = $("#rBody");
  if (failed) {
    body.innerHTML = `<div class="err-card"><b>Search failed.</b><br>${esc(job.error || "unknown error")}</div>
      <button class="btn ghost" onclick="history.back()">Try again</button>`;
    $("#rBar").innerHTML = "";
    return;
  }
  if (!done) return; // still skeleton
  if (!job.companies.length) {
    body.innerHTML = `<div class="empty">No companies matched. Try broadening the industry or territory.</div>`;
    $("#rBar").innerHTML = "";
    return;
  }
  body.innerHTML = `<div class="results-grid">` + job.companies.map((c, i) => `
    <article class="card company${selected.has(c.name) ? " sel" : ""}" data-name="${esc(c.name)}">
      <button class="check" data-i="${i}" aria-label="select ${esc(c.name)}">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3"><path d="M4 12l5 5L20 6"/></svg>
      </button>
      <div class="body">
        <h3>${esc(c.name)}</h3>
        ${c.description ? `<p>${esc(c.description)}</p>` : ""}
        <div class="foot">
          ${c.url ? `<a class="dom" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(domain(c.url))} ↗</a>` : ""}
          <span class="src">FindAll</span>
        </div>
      </div>
    </article>`).join("") + `</div>`;
  body.querySelectorAll(".check").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const card = b.closest(".company"), name = card.dataset.name;
    if (selected.has(name)) selected.delete(name); else selected.add(name);
    card.classList.toggle("sel", selected.has(name));
    paintBar(job);
  }));
  body.querySelectorAll(".company").forEach((card) => card.addEventListener("click", () => {
    const name = card.dataset.name;
    if (selected.has(name)) selected.delete(name); else selected.add(name);
    card.classList.toggle("sel", selected.has(name));
    paintBar(job);
  }));
  paintBar(job);
}

function domain(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } }

function paintBar(job) {
  const bar = $("#rBar");
  const n = selected.size || job.companies.length;
  bar.innerHTML = `
    <div class="actionbar">
      <span class="count">${n} selected</span>
      <button class="btn dark" id="expBtn">Export</button>
      <button class="btn primary" id="crmBtn">Send to exec-crm</button>
    </div>`;
  $("#expBtn").addEventListener("click", () => {
    window.open(`/api/search/${encodeURIComponent(job.id)}/export?format=csv`, "_blank");
  });
  $("#crmBtn").addEventListener("click", () => openWorkspacePicker(job));
}

/* ---------- workspace picker + send ---------- */
async function openWorkspacePicker(job) {
  openSheet(`<div class="grab"></div><h3>Send to exec-crm</h3>
    <p class="sub">Creates a company + contact for each selected business.</p>
    <div id="wsList"><div class="empty">Loading workspaces…</div></div>`);
  let workspaces;
  try { workspaces = (await api("/api/workspaces")).workspaces || []; }
  catch (e) { $("#wsList").innerHTML = `<div class="err-card">${esc(e.message)}</div>`; return; }
  if (!workspaces.length) {
    $("#wsList").innerHTML = `<div class="empty">No workspaces in exec-crm yet.</div>`;
    return;
  }
  let picked = workspaces[0].id;
  const names = selected.size ? [...selected] : job.companies.map((c) => c.name);
  $("#wsList").innerHTML = workspaces.map((w, i) => `
    <button class="wsrow${i === 0 ? " sel" : ""}" data-id="${w.id}"><span class="dot"></span>${esc(w.name)}</button>`).join("") +
    `<div style="height:10px"></div>
     <button class="btn primary" id="sendGo">Send ${names.length} ${names.length === 1 ? "company" : "companies"}</button>`;
  $("#wsList").querySelectorAll(".wsrow").forEach((b) => b.addEventListener("click", () => {
    picked = Number(b.dataset.id);
    $("#wsList").querySelectorAll(".wsrow").forEach((x) => x.classList.toggle("sel", x === b));
  }));
  $("#sendGo").addEventListener("click", async (e) => {
    const btn = e.target; btn.disabled = true; btn.textContent = "Sending…";
    try {
      const r = await api(`/api/search/${encodeURIComponent(job.id)}/send-to-crm`, {
        method: "POST", body: JSON.stringify({ workspace_id: picked, selected: names }),
      });
      closeSheet();
      toast(`Sent ${r.created} to ${r.workspace}${r.skipped ? ` (${r.skipped} already there)` : ""}`, 3400);
    } catch (err) { toast(String(err.message || err)); btn.disabled = false; btn.textContent = "Send"; }
  });
}

/* ---------- keys ---------- */
async function openKeys() {
  openSheet(`<div class="grab"></div><h3>API keys</h3>
    <p class="sub">Keys stay on this server — never in chat, never in the browser history.</p>
    <div id="keyList"><div class="empty">Loading…</div></div>`);
  let keys;
  try { keys = (await api("/api/keys")).keys || []; }
  catch { $("#keyList").innerHTML = `<div class="err-card">Couldn't load keys.</div>`; return; }
  $("#keyList").innerHTML = keys.map((k) => `
    <div class="keyrow">
      <div class="nm">${esc(k.name)}</div>
      <div class="bn">${esc(k.benefit)}<br><a href="${esc(k.signup)}" target="_blank" rel="noopener">${esc(k.signupLabel)} ↗</a></div>
      <div class="st ${k.configured ? "on" : "off"}">${k.configured ? "● configured" + (k.masked ? ` (${esc(k.masked)})` : "") : "○ not set"}</div>
      <div class="inrow">
        <input type="password" placeholder="paste key…" data-kid="${esc(k.id)}" autocomplete="off">
        <button class="save" data-kid="${esc(k.id)}">Save</button>
      </div>
    </div>`).join("");
  $("#keyList").querySelectorAll(".save").forEach((b) => b.addEventListener("click", async () => {
    const kid = b.dataset.kid;
    const input = $(`input[data-kid="${kid}"]`);
    try {
      await api("/api/keys", { method: "POST", body: JSON.stringify({ id: kid, value: input.value }) });
      toast("Key saved"); openKeys();
    } catch (e) { toast(String(e.message || e)); }
  }));
}
$("#keysBtn").addEventListener("click", openKeys);

/* ---------- router ---------- */
function route() {
  clearInterval(pollTimer);
  const h = window.location.hash || "#/";
  const m = h.match(/^#\/s\/(.+)$/);
  if (m) renderResults(decodeURIComponent(m[1]));
  else { renderHome(); if (h !== "#/") history.replaceState(null, "", "#/"); }
}
window.addEventListener("hashchange", route);
route();
