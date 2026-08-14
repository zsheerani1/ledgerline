const state = {
  signals: [], review: [], lane: "all", weekOnly: false, lastVisit: null,
  filters: { vertical: "", geography: "", fit: "" }, q: "",
  curate: false, pending: {},
};

const DAY = 86400000;
const STATUSES = ["new", "reviewed", "starred", "parked", "dead"];
const HML = ["", "H", "M", "L"];
const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");
const daysUntil = (d) => Math.ceil((new Date(d) - Date.now()) / DAY);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const escAttr = esc;

async function init() {
  state.lastVisit = Number(localStorage.getItem("ledgerline:lastVisit")) || 0;
  localStorage.setItem("ledgerline:lastVisit", String(Date.now()));

  let payload;
  try {
    const res = await fetch("data/signals.json", { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    payload = await res.json();
  } catch {
    show("empty", "Couldn't load signals.json. Check the latest nightly Action run on GitHub.");
    return;
  }

  const all = payload.signals || [];
  state.review = all.filter((s) => s.needs_review && s.curated == null);
  state.signals = all.filter((s) => !state.review.includes(s) && s.curated?.status !== "dead");
  document.getElementById("last-run").textContent =
    "last run: " + (payload.generated ? new Date(payload.generated).toLocaleString("en-GB") : "unknown");

  buildFilterOptions();
  renderAll();
  renderEol();
  renderFreshness(payload.freshness || []);
  wire();
}

function show(id, text) {
  const el = document.getElementById(id);
  el.hidden = false;
  if (text) el.textContent = text;
}

function effective(s) {
  return { ...(s.curated || {}), ...(state.pending[s.id] || {}) };
}

function visible() {
  const q = state.q.trim().toLowerCase();
  return state.signals.filter((s) => {
    const c = effective(s);
    if (c.status === "dead") return false;
    if (state.lane !== "all" && s.lane !== state.lane) return false;
    if (state.filters.vertical && s.vertical !== state.filters.vertical) return false;
    if (state.filters.geography && s.geography !== state.filters.geography) return false;
    if (state.filters.fit && c.fit !== state.filters.fit) return false;
    if (q && ![s.org, s.title, s.system_context].some((f) => (f || "").toLowerCase().includes(q))) return false;
    if (state.weekOnly) {
      const recent = Date.now() - new Date(s.first_seen) < 7 * DAY;
      if (!recent && c.status !== "starred") return false;
    }
    return true;
  });
}

function buildFilterOptions() {
  const uniq = (key) => [...new Set(state.signals.map((s) => s[key]).filter(Boolean))].sort();
  fill("f-vertical", uniq("vertical"), "vertical");
  fill("f-geography", uniq("geography"), "geography");
}
function fill(id, values, label) {
  document.getElementById(id).innerHTML =
    `<option value="">${label}: all</option>` + values.map((v) => `<option value="${escAttr(v)}">${esc(v)}</option>`).join("");
}

function badge(kind, level) {
  if (!level) return "";
  const cls = level === "H" ? (kind === "Fit" ? "h-good" : "h-hot") : level === "M" ? "m" : "l";
  return `<span class="badge ${cls}">${kind} ${level}</span>`;
}
function deadlineTag(s) {
  if (s.lane !== "tender" || !s.trigger_date) return "";
  const d = daysUntil(s.trigger_date);
  if (d < 0) return "";
  return `<span class="deadline ${d <= 10 ? "soon" : "later"}">closes in ${d}d</span>`;
}

function curateControls(s) {
  const c = effective(s);
  const sel = (name, opts, val) =>
    `<select class="cur" data-id="${escAttr(s.id)}" data-field="${name}">` +
    opts.map((o) => `<option value="${o}" ${o === (val || "") ? "selected" : ""}>${name} ${o || "–"}</option>`).join("") +
    `</select>`;
  return `<div class="curate-row">
    ${sel("status", STATUSES, c.status || "new")}
    ${sel("fit", HML, c.fit)}
    ${sel("heat", HML, c.heat)}
    <input class="cur cur-play" data-id="${escAttr(s.id)}" data-field="play" value="${escAttr(c.play || "")}" placeholder="play_key" />
    <input class="cur cur-note" data-id="${escAttr(s.id)}" data-field="note" value="${escAttr(c.note || "")}" placeholder="note" />
  </div>`;
}

function sigRow(s) {
  const c = effective(s);
  const isNew = new Date(s.first_seen).getTime() > state.lastVisit;
  return `<li class="sig ${state.pending[s.id] ? "is-pending" : ""}">
    <div class="sig-head">
      ${isNew ? '<span class="new-dot" title="New since your last visit"></span>' : ""}
      <span class="lane-tag ${s.lane}">${s.lane}</span>
      <span class="org">${esc(s.org)}</span>
      ${c.status === "starred" ? '<span class="star" title="Starred">★</span>' : ""}
      ${deadlineTag(s)}
    </div>
    <div class="badges">${badge("Fit", c.fit)}${badge("Heat", c.heat)}</div>
    <div class="title">${esc(s.title)}</div>
    ${s.system_context ? `<div class="context">${esc(s.system_context)}</div>` : ""}
    <div class="sig-foot">
      <span>${esc(s.vertical)} · ${esc(s.geography)}${c.play ? ` · <span class="play">${esc(c.play)}</span>` : ""}</span>
      <span class="dates">${s.trigger_date ? "due " + fmt(s.trigger_date) + " · " : ""}seen ${fmt(s.first_seen)} · <a href="${escAttr(s.source_url)}" target="_blank" rel="noopener">source ↗</a></span>
    </div>
    ${c.note && !state.curate ? `<div class="note">${esc(c.note)}</div>` : ""}
    ${state.curate ? curateControls(s) : ""}
  </li>`;
}

function renderAll() {
  const rows = visible().sort((a, b) => {
    const star = (x) => (effective(x).status === "starred" ? 0 : 1);
    if (star(a) !== star(b)) return star(a) - star(b);
    return (a.trigger_date || "9999") < (b.trigger_date || "9999") ? -1 : 1;
  });
  document.getElementById("empty").hidden = rows.length > 0;
  document.getElementById("cards").innerHTML = rows.map(sigRow).join("");

  const hot = state.signals.filter((s) => effective(s).status === "starred");
  document.getElementById("hot").hidden = hot.length === 0;
  document.getElementById("hot-cards").innerHTML = hot.map((s) => {
    const c = effective(s);
    return `<div class="hot-card"><div class="org">${esc(s.org)}</div><div class="title">${esc(s.title)}</div><div class="play">${esc(c.play || "")} · Fit ${c.fit || "–"} · Heat ${c.heat || "–"}</div></div>`;
  }).join("");

  const inbox = document.getElementById("inbox");
  inbox.hidden = state.review.length === 0;
  document.getElementById("inbox-count").textContent = String(state.review.length);
  document.getElementById("inbox-items").innerHTML = state.review.map((s) => `
    <li class="inbox-item">
      <a href="${escAttr(s.source_url)}" target="_blank" rel="noopener">${esc(s.title)}</a>
      <span class="meta">${esc(s.vertical)} · seen ${fmt(s.first_seen)}</span>
    </li>`).join("");

  const n = Object.keys(state.pending).length;
  document.getElementById("save-curation").hidden = !state.curate;
  document.getElementById("save-curation").textContent = n ? `Save ${n} change${n > 1 ? "s" : ""}` : "No changes";
  document.getElementById("save-curation").disabled = n === 0;
  wireCurateInputs();
}

async function renderEol() {
  let clock;
  try {
    clock = await fetch("data/eol_clock.json", { cache: "no-store" }).then((r) => r.json());
  } catch { show("eol-error"); return; }
  const horizon = 6 * 365;
  document.getElementById("eol-rows").innerHTML = (clock.systems || []).map((sys) => {
    const d = daysUntil(sys.eol_date);
    const pct = Math.max(4, Math.min(100, Math.round(100 - (d / horizon) * 100)));
    const tone = d < 550 ? "red" : d < 1500 ? "amber" : "green";
    return `<div class="eol-row">
      <div class="eol-head"><span class="sys">${esc(sys.name)}</span><span class="days">${d.toLocaleString()} days to ${esc(sys.eol_label || "EOL")}</span></div>
      <div class="eol-track"><div class="eol-fill ${tone}" style="width:${pct}%"></div></div>
      <div class="eol-means">${esc(sys.what_it_means || "")}</div>
    </div>`;
  }).join("");
}

function renderFreshness(entries) {
  const STALE = 36 * 3600 * 1000;
  document.getElementById("freshness").innerHTML = entries.map((f) => {
    const stale = Date.now() - new Date(f.last_success).getTime() > STALE;
    return `<span class="${stale ? "stale" : "ok"}">${esc(f.source)} ${new Date(f.last_success).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}${stale ? " (stale)" : ""}</span>`;
  }).join("") || '<span class="stale">no fetcher has reported yet</span>';
}

function wire() {
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("is-active"));
      t.classList.add("is-active");
      state.lane = t.dataset.lane;
      renderAll();
    })
  );
  const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);
  on("view-week", "click", (e) => {
    state.weekOnly = !state.weekOnly;
    e.currentTarget.setAttribute("aria-pressed", String(state.weekOnly));
    renderAll();
  });
  on("f-vertical", "change", (e) => { state.filters.vertical = e.target.value; renderAll(); });
  on("f-geography", "change", (e) => { state.filters.geography = e.target.value; renderAll(); });
  on("f-fit", "change", (e) => { state.filters.fit = e.target.value; renderAll(); });
  on("q", "input", (e) => { state.q = e.target.value; renderAll(); });
  on("inbox-toggle", "click", () => {
    const el = document.getElementById("inbox-items");
    el.hidden = !el.hidden;
  });
  on("curate-toggle", "click", (e) => {
    state.curate = !state.curate;
    e.currentTarget.setAttribute("aria-pressed", String(state.curate));
    renderAll();
  });
  on("save-curation", "click", saveCuration);
}

function wireCurateInputs() {
  document.querySelectorAll(".cur").forEach((el) =>
    el.addEventListener("change", () => {
      const { id, field } = el.dataset;
      state.pending[id] = { ...(state.pending[id] || {}), [field]: el.value || null };
      renderAll();
    })
  );
}

async function saveCuration() {
  let key = localStorage.getItem("ledgerline:curateKey");
  if (!key) {
    key = prompt("Curation key (set once, stored in this browser):") || "";
    if (!key) return;
    localStorage.setItem("ledgerline:curateKey", key);
  }
  const btn = document.getElementById("save-curation");
  btn.textContent = "Saving…";
  btn.disabled = true;
  const changes = {};
  for (const [id, patch] of Object.entries(state.pending)) {
    const base = state.signals.find((s) => s.id === id)?.curated || {};
    changes[id] = { status: "reviewed", ...base, ...patch };
  }
  try {
    const res = await fetch("/.netlify/functions/curate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-curate-key": key },
      body: JSON.stringify(changes),
    });
    if (res.status === 403) {
      localStorage.removeItem("ledgerline:curateKey");
      throw new Error("wrong key");
    }
    if (!res.ok) throw new Error(`save failed (${res.status})`);
    for (const [id, entry] of Object.entries(changes)) {
      const s = state.signals.find((x) => x.id === id);
      if (s) s.curated = entry;
    }
    state.pending = {};
    btn.textContent = "Saved — redeploying";
    setTimeout(renderAll, 1500);
  } catch (err) {
    btn.textContent = `Save failed: ${err.message} — retry`;
    btn.disabled = false;
  }
}

init();
