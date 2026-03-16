// assets/script.js

// ----------------------- utilidades -----------------------
function getQueryParams() {
  const params = {};
  window.location.search.substring(1).split("&").forEach(pair => {
    const [key, value] = pair.split("=");
    if (key) params[decodeURIComponent(key)] = decodeURIComponent(value || "");
  });
  return params;
}

function setQueryParams(updates = {}, replace = false) {
  const p = getQueryParams();
  const next = { ...p, ...updates };
  const qs = Object.entries(next)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${location.pathname}${qs ? "?" + qs : ""}`;
  if (replace) history.replaceState({}, "", url);
  else history.pushState({}, "", url);
}

function formatAmPm(hour) {
  const h = parseInt(hour, 10);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12} ${suffix}`;
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function scrollToVideoById(id) {
  const target = document.getElementById(id);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ----------------------- analytics -----------------------
function trackEvent(name, params = {}) {
  try { if (typeof window.gtag === "function") window.gtag("event", name, params); } catch(e) {}
}

async function updateBusinessMetrics(videoId, increments = {}, setFields = {}) {
  try {
    const db = getFirestoreDb();
    if (!db || !videoId) return;
    const doc = db.collection("reactions").doc(String(videoId));
    const payload = {};
    Object.keys(increments || {}).forEach(k => {
      payload[k] = firebase.firestore.FieldValue.increment(Number(increments[k]) || 0);
    });
    Object.keys(setFields || {}).forEach(k => { payload[k] = setFields[k]; });
    if (Object.keys(payload).length === 0) return;
    await doc.set(payload, { merge: true });
  } catch(e) { console.warn("[metrics]", e); }
}

function gaCtx(extra = {}) {
  const p = getQueryParams();
  return { loc: p.loc || "", can: p.can || "", lado: p.lado || "", filtro: p.filtro || "", pg: p.pg || "", ...extra };
}

// ----------------------- GATE POR CANCHA -----------------------
async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function loadPasswords() {
  try {
    const res = await fetch(`data/passwords.json?cb=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch(e) { console.warn("[gate]", e); return null; }
}

function findCanchaRule(pwCfg, locId, canId) {
  if (!pwCfg?.canchas?.length) return null;
  return pwCfg.canchas.find(x => x.loc === locId && x.can === canId) || null;
}

function getAuthKey(locId, canId) { return `gate:${locId}:${canId}`; }

function isAuthorized(rule) {
  if (!rule || !rule.enabled) return true;
  try {
    const obj = JSON.parse(localStorage.getItem(getAuthKey(rule.loc, rule.can)) || "null");
    return !!(obj?.ok && typeof obj.exp === "number" && Date.now() < obj.exp);
  } catch { return false; }
}

function setAuthorized(rule) {
  const remember = (Number(rule.remember_hours) > 0 ? Number(rule.remember_hours) : 24) * 3600000;
  localStorage.setItem(getAuthKey(rule.loc, rule.can), JSON.stringify({ ok: true, exp: Date.now() + remember }));
}

async function requireCanchaPassword(locId, canId) {
  const pwCfg = await loadPasswords();
  const rule = findCanchaRule(pwCfg, locId, canId);
  if (!rule || !rule.enabled) return true;
  if (isAuthorized(rule)) return true;
  for (let i = 0; i < 3; i++) {
    const input = window.prompt("Esta cancha requiere contraseña.");
    if (input === null) return false;
    if (await sha256Hex(input) === rule.sha256) {
      setAuthorized(rule);
      trackEvent("gate_unlock", gaCtx({ result: "ok" }));
      return true;
    }
    alert("Contraseña incorrecta. Inténtalo de nuevo.");
  }
  trackEvent("gate_unlock", gaCtx({ result: "fail" }));
  return false;
}

// ----------------------- parseFromName -----------------------
function parseFromName(name) {
  const re = /^(.+?)_(.+?)_(.+?)_(\d{8})_(\d{6})\.mp4$/i;
  const m = String(name || "").match(re);
  if (!m) return null;
  const [, loc, can, lado, date8, time6] = m;
  const tryYYYYMMDD = () => {
    const Y = Number(date8.slice(0, 4)), Mo = Number(date8.slice(4, 6)), D = Number(date8.slice(6, 8));
    if (Y >= 1900 && Y <= 2100 && Mo >= 1 && Mo <= 12 && D >= 1 && D <= 31)
      return { Y: String(Y), M: date8.slice(4, 6), D: date8.slice(6, 8) };
    return null;
  };
  const tryDDMMYYYY = () => {
    const D = Number(date8.slice(0, 2)), Mo = Number(date8.slice(2, 4)), Y = Number(date8.slice(4, 8));
    if (Y >= 1900 && Y <= 2100 && Mo >= 1 && Mo <= 12 && D >= 1 && D <= 31)
      return { Y: String(Y), M: date8.slice(2, 4), D: date8.slice(0, 2) };
    return null;
  };
  const d = tryYYYYMMDD() || tryDDMMYYYY();
  if (!d) return null;
  const h = time6.slice(0, 2), mi = time6.slice(2, 4), s = time6.slice(4, 6);
  const tsKey = Number(`${d.Y}${d.M}${d.D}${h}${mi}${s}`);
  const date = new Date(Number(d.Y), Number(d.M) - 1, Number(d.D), Number(h), Number(mi), Number(s));
  return { loc, can, lado, date, tsKey, ymd: `${d.Y}${d.M}${d.D}`, Y: d.Y, M: d.M, D: d.D, h, mi, s };
}

// ----------------------- Filtro por día ── SOLO HOY Y AYER -----------------------
const DAY_OFFSETS = [0, 1];   // Solo Hoy y Ayer
const NEW_WINDOW_MS = 2 * 60 * 60 * 1000;

const uploadTimeCache = new Map();

function ymdFromDate(d) {
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, "0");
  const D = String(d.getDate()).padStart(2, "0");
  return `${Y}${M}${D}`;
}

function addDays(d, delta) {
  const x = new Date(d); x.setDate(x.getDate() + delta); return x;
}

function labelForOffset(off) {
  return off === 0 ? "Hoy" : "Ayer";
}

function parseUploadTimeFromEntry(entry) {
  const cand = entry?.subido_ts ?? entry?.ts_subida ?? entry?.upload_ts ?? entry?.uploaded_ts ?? entry?.mtime ?? entry?.last_modified;
  if (cand == null) return null;
  if (typeof cand === "number") return cand > 1e12 ? cand : cand > 1e9 ? cand * 1000 : null;
  if (typeof cand === "string") { const t = Date.parse(cand); return Number.isFinite(t) ? t : null; }
  return null;
}

async function tryHeadLastModified(url) {
  try {
    const res = await fetch(toDropboxDirectFetchUrl(url), { method: "HEAD", cache: "no-store" });
    if (!res.ok) return null;
    const lm = res.headers.get("Last-Modified") || res.headers.get("last-modified");
    if (!lm) return null;
    const t = Date.parse(lm); return Number.isFinite(t) ? t : null;
  } catch { return null; }
}

async function prefetchUploadTimes(entries, limit = 12) {
  const candidates = [...entries]
    .map(e => ({ e, m: parseFromName(e.nombre) }))
    .filter(x => x.m)
    .sort((a, b) => b.m.tsKey - a.m.tsKey)
    .slice(0, limit)
    .map(x => x.e);
  for (let i = 0; i < candidates.length; i += 4) {
    await Promise.all(candidates.slice(i, i + 4).map(async entry => {
      const url = entry?.url;
      if (!url || uploadTimeCache.has(url)) return;
      const direct = parseUploadTimeFromEntry(entry);
      if (direct) { uploadTimeCache.set(url, direct); return; }
      const head = await tryHeadLastModified(url);
      if (head) uploadTimeCache.set(url, head);
    }));
  }
}

function getKnownUploadDate(entry) {
  const direct = parseUploadTimeFromEntry(entry);
  if (direct) return new Date(direct);
  const t = uploadTimeCache.get(entry?.url);
  return t ? new Date(t) : null;
}

function isNewVideo(entry) {
  const up = getKnownUploadDate(entry);
  const base = up || entry?._meta?.date || null;
  if (!base) return false;
  return (Date.now() - base.getTime()) <= NEW_WINDOW_MS;
}

function ensureDayFilterContainer() {
  const hour = document.getElementById("filtro-horario");
  if (!hour) return null;
  let el = document.getElementById("filtro-dia");
  if (!el) {
    el = document.createElement("div");
    el.id = "filtro-dia";
    el.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px;";
    hour.parentElement.insertBefore(el, hour);
  }
  return el;
}

function dayPillStyles(btn, active) {
  btn.style.cssText = `
    display:inline-flex; align-items:center; gap:5px;
    padding:5px 14px; border-radius:999px;
    border:1px solid ${active ? "rgba(11,124,255,.38)" : "rgba(255,255,255,.14)"};
    background:${active ? "rgba(0,79,200,.18)" : "rgba(255,255,255,.05)"};
    color:${active ? "#fff" : "rgba(234,242,255,.72)"};
    font-family:inherit; font-size:0.78rem; font-weight:700;
    cursor:pointer; position:relative; white-space:nowrap;
    transition:all .15s ease;
  `;
}

function addRedDot(btn) {
  const dot = document.createElement("span");
  dot.style.cssText = "position:absolute;top:2px;right:2px;width:8px;height:8px;border-radius:50%;background:#ff2d2d;box-shadow:0 0 0 2px rgba(0,0,0,.35);";
  btn.appendChild(dot);
}

function renderDayFilterBar(allEntries, selectedKey) {
  const container = ensureDayFilterContainer();
  if (!container) return { selectedKey, dayKeys: [], byKey: new Map() };
  container.innerHTML = "";

  const now = new Date();
  const dayKeys = DAY_OFFSETS.map(off => ymdFromDate(addDays(now, -off)));
  const byKey = new Map(dayKeys.map(k => [k, []]));
  allEntries.forEach(e => { const k = e._meta?.ymd; if (byKey.has(k)) byKey.get(k).push(e); });

  dayKeys.forEach((k, off) => {
    const vids  = byKey.get(k) || [];
    const count = vids.length;
    const hasNew = vids.some(isNewVideo);
    const active = k === selectedKey;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `${labelForOffset(off)}${count ? ` (${count})` : ""}`;
    dayPillStyles(btn, active);
    if (hasNew && count) addRedDot(btn);

    btn.addEventListener("click", () => {
      setQueryParams({ dia: k, filtro: "", pg: 0, video: "" });
      populateVideos();
      scrollToTop();
    });
    container.appendChild(btn);
  });

  return { selectedKey, dayKeys, byKey };
}

// ----------------------- helpers opp side -----------------------
function absSeconds(a, b) { return Math.abs((a - b) / 1000); }

async function findOppositeConfig(cfg, locId, canId, ladoId) {
  const loc = cfg.locaciones.find(l => l.id === locId);
  const can = loc?.cancha.find(c => c.id === canId);
  if (!can) return null;
  const otros = (can.lados || []).filter(l => l.id !== ladoId);
  if (otros.length === 1) return { oppId: otros[0].id, oppUrl: otros[0].json_url, oppName: otros[0].nombre || otros[0].id };
  return null;
}

async function findOppositeVideo(entry, cfg, locId, canId, ladoId) {
  const meta = parseFromName(entry.nombre);
  if (!meta) return null;
  const oppCfg = await findOppositeConfig(cfg, locId, canId, ladoId);
  if (!oppCfg?.oppUrl) return null;
  try {
    const res = await fetch(`${oppCfg.oppUrl}?cb=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const dataOpp = await res.json();
    const sameDay = (dataOpp.videos || []).filter(v => { const m = parseFromName(v.nombre); return m && m.ymd === meta.ymd; });
    let best = null, bestDelta = Infinity;
    sameDay.forEach(v => {
      const mv = parseFromName(v.nombre);
      if (!mv) return;
      const delta = absSeconds(mv.date, meta.date);
      if (delta <= 15 && delta < bestDelta) { best = v; bestDelta = delta; }
    });
    return best ? { lado: oppCfg.oppId, nombre: best.nombre, url: best.url } : null;
  } catch { return null; }
}

// ----------------------- navegación -----------------------
async function populateLocaciones() {
  try {
    const config = await (await fetch(`data/config_locations.json?cb=${Date.now()}`, { cache: "no-store" })).json();
    const ul = document.getElementById("locaciones-lista");
    if (!ul) return;
    ul.innerHTML = "";
    config.locaciones.forEach(loc => {
      const li = document.createElement("li");
      li.classList.add("fade-in");
      const a = document.createElement("a");
      a.href = `locacion.html?loc=${loc.id}`;
      a.textContent = loc.nombre;
      a.classList.add("link-blanco");
      a.addEventListener("click", () => trackEvent("open_locacion", { loc: loc.id }));
      li.appendChild(a);
      ul.appendChild(li);
    });
  } catch(err) { console.error("populateLocaciones:", err); }
}

async function populateCanchas() {
  try {
    const params = getQueryParams();
    const config = await (await fetch(`data/config_locations.json?cb=${Date.now()}`, { cache: "no-store" })).json();
    const loc = config.locaciones.find(l => l.id === params.loc);
    const ul = document.getElementById("canchas-lista");
    if (!ul || !loc) return;
    ul.innerHTML = "";
    const nombreEl = document.getElementById("nombre-locacion");
    if (nombreEl) nombreEl.textContent = loc.nombre;
    loc.cancha.forEach(can => {
      const li = document.createElement("li");
      li.classList.add("fade-in");
      const a = document.createElement("a");
      const lados = Array.isArray(can.lados) ? can.lados : [];
      if (lados.length === 1) {
        a.href = `lado.html?loc=${params.loc}&can=${can.id}&lado=${lados[0].id}`;
        a.addEventListener("click", () => trackEvent("open_lado", { loc: params.loc, can: can.id, lado: lados[0].id, via: "direct_from_locacion" }));
      } else {
        a.href = `cancha.html?loc=${params.loc}&can=${can.id}`;
        a.addEventListener("click", () => trackEvent("open_cancha", { loc: params.loc, can: can.id }));
      }
      a.textContent = can.nombre;
      a.classList.add("link-blanco");
      li.appendChild(a);
      ul.appendChild(li);
    });
  } catch(err) { console.error("populateCanchas:", err); }
}

async function populateLados() {
  try {
    const params = getQueryParams();
    const config = await (await fetch(`data/config_locations.json?cb=${Date.now()}`, { cache: "no-store" })).json();
    const loc = config.locaciones.find(l => l.id === params.loc);
    const cancha = loc?.cancha.find(c => c.id === params.can);
    const lados = Array.isArray(cancha?.lados) ? cancha.lados : [];
    if (lados.length === 1) {
      window.location.href = `lado.html?loc=${params.loc}&can=${params.can}&lado=${lados[0].id}`;
      return;
    }
    const ul = document.getElementById("lados-lista");
    if (!ul || !cancha) return;
    ul.innerHTML = "";
    const linkClub = document.getElementById("link-club");
    const linkCancha = document.getElementById("link-cancha");
    if (linkClub) { linkClub.textContent = loc.nombre; linkClub.href = `locacion.html?loc=${params.loc}`; }
    if (linkCancha) { linkCancha.textContent = cancha.nombre; linkCancha.href = "#"; }
    cancha.lados.forEach(lado => {
      const li = document.createElement("li");
      li.classList.add("fade-in");
      const a = document.createElement("a");
      a.href = `lado.html?loc=${params.loc}&can=${params.can}&lado=${lado.id}`;
      a.textContent = lado.nombre || lado.id;
      a.classList.add("link-blanco");
      a.addEventListener("click", () => trackEvent("open_lado", { loc: params.loc, can: params.can, lado: lado.id }));
      li.appendChild(a);
      ul.appendChild(li);
    });
  } catch(err) { console.error("populateLados:", err); }
}

// ----------------------- PROMOCIONES -----------------------
let clubPromotions = null, promoConfig = null;

function deepMerge(base, override) {
  if (!override) return structuredClone(base);
  if (!base) return structuredClone(override);
  if (Array.isArray(base) && Array.isArray(override)) return structuredClone(override);
  if (typeof base === "object" && typeof override === "object") {
    const out = { ...base };
    for (const k of Object.keys(override)) out[k] = deepMerge(base[k], override[k]);
    return out;
  }
  return structuredClone(override);
}

function getButtonStyle(conf) {
  const b = conf?.button || {};
  return { bg: b.bg_color ?? conf?.bg_color ?? "#EA5B0C", fg: b.text_color ?? "#FFFFFF", border: b.border_color ?? "#FFFFFF", logo: b.logo ?? conf?.logo ?? null };
}

function resolvePlaceholders(str, entry, extraCtx = {}) {
  if (!str) return str;
  const meta = entry?.nombre ? parseFromName(entry.nombre) : null;
  const params = getQueryParams();
  const ctx = { videoUrl: entry?.url || "", videoName: entry?.nombre || "", loc: params.loc || meta?.loc || "", can: params.can || meta?.can || "", lado: params.lado || meta?.lado || "", YYYY: meta?.Y || "", MM: meta?.M || "", DD: meta?.D || "", hh: meta?.h || "", mm: meta?.mi || "", ss: meta?.s || "", ...extraCtx };
  return String(str).replace(/\{(videoUrl|videoName|loc|can|lado|YYYY|MM|DD|hh|mm|ss)\}/g, (_, k) => ctx[k] ?? "");
}

function resolvePlaceholdersInArray(arr, entry, extraCtx = {}) {
  return (arr || []).map(s => resolvePlaceholders(s, entry, extraCtx));
}

async function loadClubPromotions() {
  if (clubPromotions !== null) return clubPromotions;
  try { clubPromotions = await (await fetch("data/club_promotions.json?cb=" + Date.now(), { cache: "no-store" })).json(); } catch { clubPromotions = {}; }
  return clubPromotions;
}

async function loadPromotionDefinitions() {
  if (promoConfig !== null) return promoConfig;
  try { promoConfig = await (await fetch("data/promotions_config.json?cb=" + Date.now(), { cache: "no-store" })).json(); } catch { promoConfig = {}; }
  return promoConfig;
}

function stylePromoButton(el, conf) {
  const st = getButtonStyle(conf);
  el.style.cssText = `display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:12px 16px;border:1px solid ${st.border};border-radius:10px;font-weight:700;text-decoration:none;color:${st.fg};background:${st.bg};width:100%;min-height:44px;box-sizing:border-box;margin-top:10px;cursor:pointer;font-family:inherit;`;
}

let promoModalRoot = null;

function ensurePromoModalRoot() {
  if (promoModalRoot) return promoModalRoot;
  const wrap = document.createElement("div");
  wrap.id = "promo-modal-root";
  wrap.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.7);display:none;align-items:center;justify-content:center;z-index:2000;";
  const box = document.createElement("div");
  box.id = "promo-modal-box";
  box.style.cssText = "width:90%;max-width:560px;background:#fff;color:#000;border:2px solid #333;border-radius:12px;padding:20px;text-align:left;max-height:80vh;overflow-y:auto;box-sizing:border-box;";
  wrap.appendChild(box);
  wrap.addEventListener("click", e => { if (e.target === wrap) wrap.style.display = "none"; });
  document.body.appendChild(wrap);
  promoModalRoot = wrap;
  return wrap;
}

function clearNode(el) { while (el.firstChild) el.removeChild(el.firstChild); }

let toastTimer = null;
function toast(msg) {
  let el = document.getElementById("__promo_toast__");
  if (!el) {
    el = document.createElement("div");
    el.id = "__promo_toast__";
    el.style.cssText = "position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:10px 14px;border-radius:8px;z-index:3000;font-weight:600;";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = "none"; }, 1600);
}

async function doCopyAction(action, entry) {
  const text = resolvePlaceholders(action?.text || "", entry);
  try { await navigator.clipboard.writeText(text); toast("Copiado al portapapeles"); }
  catch { try { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); toast("Copiado"); ta.remove(); } catch { alert("No se pudo copiar"); } }
}

function doCloseAction() { const r = ensurePromoModalRoot(); r.style.display = "none"; }

function buildMailto(action, entry) {
  return `mailto:${action?.to || "contacto@puntazoclips.com"}?subject=${encodeURIComponent(resolvePlaceholders(action?.subject || "", entry))}&body=${encodeURIComponent(resolvePlaceholdersInArray(action?.bodyTemplate || [], entry).join("\n"))}`;
}

async function handlePromoAction(action, entry) {
  const type = (action?.type || "").toLowerCase();
  trackEvent("promo_action", gaCtx({ action_type: type, video_name: entry?.nombre || "" }));
  if (type === "url") { try { window.open(action.href || "#", action.target || "_blank"); } catch { location.href = action.href; } return; }
  if (type === "mailto") { location.href = buildMailto(action, entry); return; }
  if (type === "copy")  { await doCopyAction(action, entry); return; }
  doCloseAction();
}

function renderPromoModal(conf, entry) {
  const root = ensurePromoModalRoot();
  const box  = document.getElementById("promo-modal-box");
  clearNode(box);
  const theme = conf?.modal?.theme || {};
  box.style.border     = `2px solid ${theme.border_color || "#333"}`;
  box.style.background = theme.bg_color   || "#fff";
  box.style.color      = theme.text_color || "#000";
  const head = document.createElement("div");
  head.style.cssText = "display:flex;align-items:center;gap:10px;";
  (conf?.modal?.logos || []).slice(0, 3).forEach(src => {
    const img = document.createElement("img");
    img.src = src; img.alt = "logo"; img.style.cssText = "height:40px;width:auto;object-fit:contain;";
    head.appendChild(img);
  });
  const title = document.createElement("h2");
  title.textContent = conf?.modal?.title || resolvePlaceholders(conf?.label || "Promoción", entry);
  title.style.cssText = `margin:0;color:${theme.border_color || "#333"};`;
  head.appendChild(title);
  box.appendChild(head);
  const intro = conf?.modal?.intro_list || [];
  if (intro.length) {
    const ul = document.createElement("ul"); ul.style.paddingLeft = "20px";
    resolvePlaceholdersInArray(intro, entry).forEach(txt => { const li = document.createElement("li"); li.textContent = txt; ul.appendChild(li); });
    const d = document.createElement("div"); d.style.marginTop = "10px"; d.appendChild(ul); box.appendChild(d);
  }
  const btnRow = document.createElement("div"); btnRow.style.cssText = "display:flex;gap:8px;margin-top:18px;";
  (conf?.modal?.buttons || [{ label: "Cerrar", style: { bg_color: "#f5f5f5", text_color: "#000", border_color: "#ccc" }, action: { type: "close" } }]).slice(0, 3).forEach(bc => {
    const btn = document.createElement("button"); btn.type = "button";
    btn.textContent = resolvePlaceholders(bc.label || "Acción", entry);
    const s = bc.style || {};
    btn.style.cssText = `flex:1;padding:12px 16px;border:2px solid ${s.border_color || "#333"};border-radius:10px;background:${s.bg_color || "#333"};color:${s.text_color || "#fff"};cursor:pointer;font-family:inherit;`;
    btn.addEventListener("click", async () => await handlePromoAction(bc.action || {}, entry));
    btnRow.appendChild(btn);
  });
  box.appendChild(btnRow);
  root.style.display = "flex";
}

function openPromoModal(entry, conf) {
  if (!conf?.modal?.enabled) return;
  trackEvent("promo_modal_open", gaCtx({ video_name: entry?.nombre || "" }));
  renderPromoModal(conf, entry);
}

function legacyConvertIfNeeded(conf) {
  const c = structuredClone(conf);
  if (c?.action === "modal_then_mailto") {
    c.action = { type: "modal" };
    c.modal = c.modal || {};
    c.modal.enabled = true;
    if (!Array.isArray(c.modal.buttons) || !c.modal.buttons.length) {
      c.modal.buttons = [
        { label: "Nominar mi punto", style: { bg_color: c.border_color || "#004FC8", text_color: "#fff", border_color: c.border_color || "#004FC8" }, action: { type: "mailto", to: c.mailto || "contacto@puntazoclips.com", subject: c.subject || "Nominar punto", bodyTemplate: c.bodyTemplate || [] } },
        { label: "Cerrar", style: { bg_color: "#f5f5f5", text_color: "#000", border_color: "#ccc" }, action: { type: "close" } }
      ];
    }
    c.modal.theme = c.modal.theme || { bg_color: c.bg_color || "#fff", text_color: c.text_color || "#000", border_color: c.border_color || "#004FC8" };
    if (!c.modal.logos && c.logo) c.modal.logos = [c.logo];
  }
  return c;
}

async function buildPromoButtonsForClub(loc, entry) {
  const clubMap = await loadClubPromotions();
  const defs    = await loadPromotionDefinitions();
  let promosForLoc = clubMap?.[loc];
  if (!promosForLoc) return [];
  let promoIds = [], overrides = {};
  if (Array.isArray(promosForLoc)) { promoIds = promosForLoc; }
  else if (typeof promosForLoc === "object" && Array.isArray(promosForLoc.promos)) { promoIds = promosForLoc.promos; overrides = promosForLoc.overrides || {}; }
  else return [];

  const buttons = [];
  for (const pid of promoIds) {
    let base = defs?.[pid];
    if (!base) continue;
    base = legacyConvertIfNeeded(base);
    const merged = deepMerge(base, overrides[pid] || {});
    const actionObj = merged?.action || {};
    const actionType = (actionObj.type || (typeof merged.action === "string" ? merged.action : "") || "").toLowerCase();
    const st = getButtonStyle(merged);
    const label = merged?.label || "Promoción";

    const mkBtn = (isAnchor) => {
      const el = document.createElement(isAnchor ? "a" : "button");
      if (!isAnchor) { el.type = "button"; }
      el.className = "btn-promo";
      stylePromoButton(el, merged);
      if (st.logo) { const img = document.createElement("img"); img.src = st.logo; img.style.cssText = "height:20px;width:auto;object-fit:contain;"; el.appendChild(img); }
      const span = document.createElement("span"); span.textContent = resolvePlaceholders(label, entry); el.appendChild(span);
      return el;
    };

    if (actionType === "url") {
      const a = mkBtn(true); a.href = actionObj.href || "#"; a.target = actionObj.target || "_blank"; a.rel = "noopener";
      a.addEventListener("click", () => trackEvent("promo_click", gaCtx({ promo_id: pid, action_type: "url", video_name: entry?.nombre || "" })));
      buttons.push(a);
    } else if (actionType === "modal") {
      const btn = mkBtn(false);
      btn.addEventListener("click", () => { trackEvent("promo_click", gaCtx({ promo_id: pid, action_type: "modal", video_name: entry?.nombre || "" })); openPromoModal(entry, merged); });
      buttons.push(btn);
    } else if (!actionType && merged?.url) {
      const a = mkBtn(true); a.href = merged.url; a.target = "_blank"; a.rel = "noopener";
      a.addEventListener("click", () => trackEvent("promo_click", gaCtx({ promo_id: pid, action_type: "legacy_url", video_name: entry?.nombre || "" })));
      buttons.push(a);
    }
  }
  return buttons;
}

// ----------------------- video / paginación -----------------------
let allVideos = [];
let visibilityMap = new Map();
let currentPreviewActive = null;
const PAGE_SIZE = 10;
let videosListaCompleta = [];
let paginaActual = 0;
let cfgGlobal = null;
let oppInfoCache = null;
let contenedorVideos = null;
let contenedorBottomControls = null;
let contFiltroArriba = null, contFiltroAbajo = null;
let ultimoFiltroActivo = null;
let btnOppTopEl = null;

function ensureOppositeTopButton(oppHref, oppName) {
  const btnVolver = document.getElementById("btn-volver");
  if (!btnVolver) return;
  const parent = btnVolver.parentElement || document.body;
  if (window.getComputedStyle(parent).display !== "flex") {
    parent.style.cssText = "display:flex;align-items:center;gap:8px;justify-content:space-between;";
  }
  if (!btnOppTopEl) {
    btnOppTopEl = document.createElement("a");
    btnOppTopEl.id = "btn-opposite-top";
    btnOppTopEl.className = btnVolver.className || "btn-alt";
    btnOppTopEl.textContent = "← Otro ángulo";
    btnOppTopEl.style.marginLeft = "auto";
    btnOppTopEl.addEventListener("click", () => trackEvent("click_opposite_side", gaCtx({ position: "top" })));
    parent.appendChild(btnOppTopEl);
  }
  if (oppHref) { btnOppTopEl.href = oppHref; btnOppTopEl.style.display = ""; if (oppName) btnOppTopEl.title = `Ver ${oppName}`; }
  else { btnOppTopEl.style.display = "none"; }
}

function ensureBottomControlsContainer() {
  if (!contenedorBottomControls) {
    contenedorBottomControls = document.getElementById("bottom-controls");
    if (!contenedorBottomControls) {
      contenedorBottomControls = document.createElement("div");
      contenedorBottomControls.id = "bottom-controls";
      contenedorBottomControls.style.margin = "24px 0 12px";
      contenedorVideos.parentElement.insertBefore(contenedorBottomControls, contenedorVideos.nextSibling);
    }
  }
  if (!document.getElementById("paginator-bottom")) {
    const pag = document.createElement("div"); pag.id = "paginator-bottom"; contenedorBottomControls.appendChild(pag);
  }
  contFiltroAbajo = document.getElementById("filtro-horario-bottom");
  if (!contFiltroAbajo) {
    contFiltroAbajo = document.createElement("div"); contFiltroAbajo.id = "filtro-horario-bottom"; contFiltroAbajo.style.marginTop = "12px"; contenedorBottomControls.appendChild(contFiltroAbajo);
  }
}

function renderPaginator(container, totalItems, pageIndex, pageSize, onChange) {
  if (!container) return;
  container.innerHTML = "";
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages <= 1) return;

  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:12px 0;";

  const mkBtn = (label, disabled, handler) => {
    const b = document.createElement("button"); b.textContent = label; b.disabled = !!disabled;
    b.style.cssText = `padding:6px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#eaf2ff;cursor:${disabled ? "default" : "pointer"};font-family:inherit;font-size:.82rem;font-weight:700;`;
    b.addEventListener("click", handler); return b;
  };

  wrap.appendChild(mkBtn("‹ Anterior", pageIndex === 0, () => onChange(pageIndex - 1)));

  const windowSize = 5, start = Math.max(0, Math.min(pageIndex - 2, totalPages - windowSize)), end = Math.min(totalPages - 1, start + windowSize - 1);
  for (let i = start; i <= end; i++) {
    const num = mkBtn(String(i + 1), i === pageIndex, () => onChange(i));
    if (i === pageIndex) { num.style.background = "rgba(0,79,200,.28)"; num.style.borderColor = "rgba(11,124,255,.38)"; num.style.color = "#fff"; num.setAttribute("aria-current", "page"); }
    wrap.appendChild(num);
  }

  wrap.appendChild(mkBtn("Siguiente ›", pageIndex >= totalPages - 1, () => onChange(pageIndex + 1)));

  const info = document.createElement("span");
  const first = totalItems === 0 ? 0 : pageIndex * pageSize + 1, last = Math.min((pageIndex + 1) * pageSize, totalItems);
  info.textContent = `${first}–${last} de ${totalItems} · Página ${pageIndex + 1}/${totalPages}`;
  info.style.cssText = "margin-left:auto;font-size:.78rem;opacity:.65;color:#eaf2ff;";
  wrap.appendChild(info);
  container.appendChild(wrap);
}

function renderHourFilterIn(container, videos) {
  if (!container) return;
  const filtroHoraActivo = getQueryParams().filtro;
  container.innerHTML = "";
  const horasSet = new Set();
  videos.forEach(v => { const m = v.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/); if (m) horasSet.add(m[1]); });
  [...horasSet].sort().forEach(h => {
    const btn = document.createElement("button"); btn.type = "button";
    btn.textContent = `${formatAmPm(h)} - ${formatAmPm((+h + 1) % 24)}`;
    btn.className = "btn-filtro"; if (filtroHoraActivo === h) btn.classList.add("activo");
    btn.addEventListener("click", () => { trackEvent("filter_hour", gaCtx({ hour: h })); setQueryParams({ filtro: h, pg: 0, video: "" }); populateVideos(); scrollToTop(); });
    container.appendChild(btn);
  });
  const quitarBtn = document.createElement("button"); quitarBtn.textContent = "✕ Quitar filtro"; quitarBtn.className = "btn-filtro quitar";
  if (!filtroHoraActivo) quitarBtn.style.display = "none";
  quitarBtn.addEventListener("click", () => { setQueryParams({ filtro: "", pg: 0, video: "" }); populateVideos(); scrollToTop(); });
  container.appendChild(quitarBtn);
  container.style.display = "flex";
}

function createHourFilterUI(videos) {
  contFiltroArriba = document.getElementById("filtro-horario") || null;
  renderHourFilterIn(contFiltroArriba, videos);
  ensureBottomControlsContainer();
  renderHourFilterIn(contFiltroAbajo, videos);
}

// ----------------------- preview overlay -----------------------
function createPreviewOverlay(videoSrc, duration, parentCard) {
  const preview = document.createElement("video");
  preview.muted = true; preview.playsInline = true; preview.preload = "none"; preview.src = videoSrc; preview.className = "video-preview";
  let start = duration > 15 ? duration - 15 : 0, len = 5, end = start + len;
  const onLoadedMeta = () => { try { preview.currentTime = start; } catch {} };
  const onTimeUpdate = () => { try { if (preview.currentTime >= end) preview.currentTime = start; } catch {} };
  preview.addEventListener("loadedmetadata", onLoadedMeta);
  preview.addEventListener("timeupdate", onTimeUpdate);
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      visibilityMap.set(preview, entry.intersectionRatio);
      let max = 0, winner = null;
      visibilityMap.forEach((ratio, node) => { if (ratio > max) { max = ratio; winner = node; } });
      if (winner === preview && entry.isIntersecting) {
        const realPlaying = parentCard.querySelector("video.real")?.paused === false;
        if (!realPlaying) {
          if (currentPreviewActive && currentPreviewActive !== preview) currentPreviewActive.pause();
          currentPreviewActive = preview; preview.play().catch(() => {});
        }
      } else { preview.pause(); }
    });
  }, { threshold: [0.25, 0.5, 0.75] });
  io.observe(preview);
  preview._observer = io; preview._onLoadedMeta = onLoadedMeta; preview._onTimeUpdate = onTimeUpdate;
  preview.addEventListener("click", () => {
    trackEvent("click_preview_to_play", gaCtx({ video_name: parentCard?.id || "" }));
    const realVideo = parentCard.querySelector("video.real");
    if (realVideo) { preview.style.display = "none"; realVideo.style.display = "block"; realVideo.currentTime = 0; realVideo.play(); }
  });
  return preview;
}

function setupMutualExclusion(list) {
  list.forEach(v => v.addEventListener("play", () => { list.forEach(o => { if (o !== v) o.pause(); }); }));
}

async function loadPreviewsSequentially(previews) {
  for (const v of previews) {
    v.preload = "metadata";
    await new Promise(res => {
      v.addEventListener("loadedmetadata", res, { once: true });
      v.load();
    });
  }
}

function pauseAllVideos() {
  try { if (currentPreviewActive) currentPreviewActive.pause(); } catch {}
  currentPreviewActive = null;
  document.querySelectorAll("video.video-preview, video.real").forEach(v => {
    try { v.pause(); } catch {} try { v.preload = "none"; } catch {}
  });
}

// ----------------------- Dropbox URLs -----------------------
function toDropboxDirectFetchUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "www.dropbox.com") u.hostname = "dl.dropboxusercontent.com";
    u.searchParams.delete("raw"); u.searchParams.delete("dl");
    return u.toString();
  } catch { return url; }
}

// ----------------------- Auth helpers -----------------------
function getFirestoreDb() {
  try {
    if (window.PuntazoFirebase && typeof window.PuntazoFirebase.db === "function") return window.PuntazoFirebase.db();
    if (window.firebase && firebase.apps?.length && typeof firebase.firestore === "function") return firebase.firestore();
  } catch {}
  return null;
}

function getAuthUser() { try { return window.PuntazoAuth?.currentUser || null; } catch { return null; } }
function getFirestoreTimestamp() { try { return firebase.firestore.FieldValue.serverTimestamp(); } catch { return new Date(); } }

function buildSavedVideoMeta(entry, loc, can, lado) {
  return {
    videoId: entry.nombre, videoUrl: entry.url,
    club:    (document.getElementById("link-club")?.textContent  || loc).trim(),
    cancha:  (document.getElementById("link-cancha")?.textContent || can).trim(),
    lado:    (document.getElementById("nombre-lado")?.textContent || lado).trim(),
    fecha:   entry._meta ? `${entry._meta.Y}-${entry._meta.M}-${entry._meta.D}` : "",
    savedAt: getFirestoreTimestamp(), locId: loc, canId: can, ladoId: lado, nombreArchivo: entry.nombre,
  };
}

async function isVideoSavedForCurrentUser(videoId) {
  const user = getAuthUser(), db = getFirestoreDb();
  if (!user || !db) return false;
  return (await db.collection("usuarios").doc(user.uid).collection("guardados").doc(videoId).get()).exists;
}

async function saveVideoForCurrentUser(meta) {
  const user = getAuthUser(), db = getFirestoreDb();
  if (!user || !db) throw new Error("Sin usuario/DB");
  await db.collection("usuarios").doc(user.uid).collection("guardados").doc(meta.videoId).set(meta, { merge: true });
}

async function unsaveVideoForCurrentUser(videoId) {
  const user = getAuthUser(), db = getFirestoreDb();
  if (!user || !db) throw new Error("Sin usuario/DB");
  await db.collection("usuarios").doc(user.uid).collection("guardados").doc(videoId).delete();
}

// ----------------------- Botones pill -----------------------
function crearSharePill(entry) {
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "action-pill"; btn.textContent = "🔗"; btn.title = "Copiar enlace";
  btn.setAttribute("aria-label", "Copiar enlace");

  btn.addEventListener("click", async () => {
    const link = `${location.origin}/clip.html?videoId=${encodeURIComponent(entry.nombre)}`;
    trackEvent("click_share", gaCtx({ video_name: entry.nombre }));
    try {
      if (navigator.share) {
        await navigator.share({ title: "Puntazo", text: "Mira este puntazo 🎾", url: link });
        try { updateBusinessMetrics(entry.nombre, { shares: 1 }); } catch {}
        toast("Compartido"); return;
      }
    } catch {}
    try {
      await navigator.clipboard.writeText(link);
      btn.textContent = "✓"; setTimeout(() => { btn.textContent = "🔗"; }, 1500);
      try { updateBusinessMetrics(entry.nombre, { shares: 1 }); } catch {}
      toast("Enlace copiado");
    } catch { window.open(link, "_blank"); }
  });
  return btn;
}

function crearSavePill(entry, loc, can, lado) {
  const meta = buildSavedVideoMeta(entry, loc, can, lado);
  const btn  = document.createElement("button");
  btn.type = "button"; btn.className = "action-pill"; btn.title = "Guardar en tu perfil";
  btn.setAttribute("aria-label", "Guardar video");
  btn.dataset.saved = "0"; btn.dataset.loading = "0";

  const syncState = async () => {
    const user = getAuthUser();
    if (!user) { btn.textContent = "💾"; btn.classList.remove("is-saved"); return; }
    try {
      const saved = await isVideoSavedForCurrentUser(meta.videoId);
      btn.dataset.saved = saved ? "1" : "0";
      btn.classList.toggle("is-saved", saved);
      btn.textContent = saved ? "✅" : "💾";
    } catch {}
  };

  btn._syncSavedState = syncState;

  btn.addEventListener("click", async () => {
    if (!window.PuntazoAuth?.currentUser) {
      if (window.PuntazoAuth?.requireAuth) { window.PuntazoAuth.requireAuth(() => syncState()); }
      return;
    }
    if (btn.dataset.loading === "1") return;
    btn.dataset.loading = "1"; btn.disabled = true;
    try {
      const alreadySaved = btn.dataset.saved === "1";
      if (alreadySaved) {
        await unsaveVideoForCurrentUser(meta.videoId);
        trackEvent("unsave_video", gaCtx({ video_name: entry.nombre }));
      } else {
        await saveVideoForCurrentUser(meta);
        trackEvent("save_video", gaCtx({ video_name: entry.nombre }));
        try {
          const user = getAuthUser();
          await updateBusinessMetrics(meta.videoId, { saves: 1 }, {
            saved_by_user: true, immortal: true,
            immortal_reasons: { saved_by_user: { uid: user?.uid || null, at: getFirestoreTimestamp() } },
            immortal_markedAt: getFirestoreTimestamp()
          });
        } catch {}
      }
      btn.dataset.saved = alreadySaved ? "0" : "1";
      btn.classList.toggle("is-saved", !alreadySaved);
      btn.textContent = alreadySaved ? "💾" : "✅";
      toast(alreadySaved ? "Quitado de guardados" : "Guardado en tu perfil");
    } catch(err) { console.warn("[guardados]", err); }
    btn.disabled = false; btn.dataset.loading = "0";
    setTimeout(() => syncState().catch(() => {}), 300);
  });

  window.addEventListener("puntazo:auth-changed", () => { if (typeof syncState === "function") syncState(); });
  Promise.resolve().then(syncState);
  return btn;
}

// Fullscreen / pantalla completa
let puntazoFullscreenUnlockBound = false;
function bindFullscreenUnlockOnce() {
  if (puntazoFullscreenUnlockBound) return;
  puntazoFullscreenUnlockBound = true;
  const unlock = () => { try { if (screen.orientation?.unlock) screen.orientation.unlock(); } catch {} };
  document.addEventListener("fullscreenchange",       () => { if (!document.fullscreenElement) unlock(); });
  document.addEventListener("webkitfullscreenchange", () => { if (!document.fullscreenElement && !document.webkitFullscreenElement) unlock(); });
}

function isThisVideoFullscreen(video) {
  return !!(document.fullscreenElement === video || document.webkitFullscreenElement === video || video.webkitDisplayingFullscreen);
}

async function requestVideoFullscreen(video) {
  if (video.requestFullscreen)        return video.requestFullscreen();
  if (video.webkitRequestFullscreen)  return video.webkitRequestFullscreen();
  if (video.webkitEnterFullscreen)    { video.webkitEnterFullscreen(); return; }
  throw new Error("Fullscreen no soportado");
}

function crearFullscreenPill(video, card, entry) {
  bindFullscreenUnlockOnce();
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "action-pill"; btn.textContent = "⛶"; btn.title = "Pantalla completa";
  btn.setAttribute("aria-label", "Pantalla completa"); btn.style.display = "none";

  const syncLabel = () => {
    const active = isThisVideoFullscreen(video);
    btn.classList.toggle("is-active", active);
    btn.textContent = active ? "✕" : "⛶";
  };

  const syncVisibility = () => {
    btn.style.display = (!video.paused || isThisVideoFullscreen(video)) ? "inline-flex" : "none";
  };

  btn.addEventListener("click", async () => {
    try {
      if (isThisVideoFullscreen(video)) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        try { if (screen.orientation?.unlock) screen.orientation.unlock(); } catch {}
        trackEvent("video_fullscreen_exit", gaCtx({ video_name: entry.nombre }));
      } else {
        pauseAllVideos();
        const prev = card.querySelector("video.video-preview");
        if (prev) { try { prev.pause(); } catch {} prev.style.display = "none"; }
        video.style.display = "block";
        if (video.readyState < 1) video.load?.();
        await requestVideoFullscreen(video);
        try { await video.play(); } catch {}
        try { if (screen.orientation?.lock) await screen.orientation.lock("landscape"); } catch {}
        trackEvent("video_fullscreen_open", gaCtx({ video_name: entry.nombre }));
      }
      syncLabel(); syncVisibility();
    } catch(err) { console.warn("[fullscreen]", err); try { toast("No se pudo abrir pantalla completa"); } catch {} }
  });

  video.addEventListener("play",  syncVisibility);
  video.addEventListener("pause", syncVisibility);
  video.addEventListener("ended", syncVisibility);
  document.addEventListener("fullscreenchange",        () => { syncLabel(); syncVisibility(); });
  document.addEventListener("webkitfullscreenchange",  () => { syncLabel(); syncVisibility(); });
  video.addEventListener("webkitbeginfullscreen",      () => { syncLabel(); syncVisibility(); });
  video.addEventListener("webkitendfullscreen",        () => { try { if (screen.orientation?.unlock) screen.orientation.unlock(); } catch {}; syncLabel(); syncVisibility(); });
  return btn;
}

// ----------------------- limpiar página -----------------------
function limpiarRecursosDePagina() {
  try { if (currentPreviewActive) currentPreviewActive.pause(); } catch {}
  currentPreviewActive = null; visibilityMap = new Map();
  if (!contenedorVideos) return;
  Array.from(contenedorVideos.children).forEach(card => {
    [card.querySelector("video.real"), card.querySelector("video.video-preview")].forEach(v => {
      if (!v) return;
      try { v.pause?.(); } catch {}
      if (v._observer) { try { v._observer.disconnect(); } catch {} v._observer = null; }
      try { v.removeAttribute("src"); v.load?.(); } catch {}
    });
  });
  contenedorVideos.innerHTML = "";
  allVideos = [];
}

// ========== renderPaginaActual: NUEVO LAYOUT DE CARD ==========
async function renderPaginaActual({ fueCambioDePagina = false } = {}) {
  limpiarRecursosDePagina();

  const params = getQueryParams();
  const { loc, can, lado } = params;
  const start    = paginaActual * PAGE_SIZE;
  const end      = Math.min(start + PAGE_SIZE, videosListaCompleta.length);
  const pageSlice = videosListaCompleta.slice(start, end);

  for (const entry of pageSlice) {
    const m = entry.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/);
    let displayTime = entry.nombre.replace(".mp4", "");
    if (m) {
      const hr = parseInt(m[1], 10), mn = m[2], ap = hr >= 12 ? "PM" : "AM";
      displayTime = `${hr % 12 || 12}:${mn} ${ap}`;
    }

    // ── Card container ──
    const card = document.createElement("div");
    card.className = "video-card";
    card.id = entry.nombre;

    // ── 1. Header: hora + emoji preview ──
    const cardTop = document.createElement("div");
    cardTop.className = "card-top";

    const timeEl = document.createElement("span");
    timeEl.className = "card-time";
    timeEl.textContent = displayTime;
    cardTop.appendChild(timeEl);

    const rxnPreview = document.createElement("div");
    rxnPreview.className = "card-rxn-preview";
    rxnPreview.setAttribute("data-rxn-preview", "");
    cardTop.appendChild(rxnPreview);

    card.appendChild(cardTop);

    // ── 2. Video ──
    const wrap = document.createElement("div");
    wrap.className = "video-wrap";

    const real = document.createElement("video");
    real.className = "real";
    real.controls = true;
    real.playsInline = true;
    real.preload = "metadata";
    real.src = entry.url;
    real.style.display = "none";
    real.style.width = "100%";
    real.style.borderRadius = "8px";
    real.addEventListener("play", () => {
      trackEvent("play_video", gaCtx({ video_name: entry.nombre }));
      try { updateBusinessMetrics(entry.nombre, { views: 1 }); } catch {}
    }, { once: true });

    const preview = createPreviewOverlay(entry.url, entry.duracion || 60, card);
    preview.style.width = "100%";
    preview.style.borderRadius = "8px";

    wrap.appendChild(real);
    wrap.appendChild(preview);
    card.appendChild(wrap);

    // ── 3. Participantes slot (reactions.js lo puebla) ──
    const participantsSlot = document.createElement("div");
    participantsSlot.setAttribute("data-participants-slot", "");
    card.appendChild(participantsSlot);

    // ── 4. Botones de acción pill ──
    const actionPills = document.createElement("div");
    actionPills.className = "action-pills";

    const shareBtn = crearSharePill(entry);
    actionPills.appendChild(shareBtn);

    const saveBtn = crearSavePill(entry, loc, can, lado);
    actionPills.appendChild(saveBtn);

    const fsBtn = crearFullscreenPill(real, card, entry);
    actionPills.appendChild(fsBtn);

    card.appendChild(actionPills);

    // ── Promociones del club ──
    try {
      const promoButtons = await buildPromoButtonsForClub(loc, entry);
      if (promoButtons.length) {
        const promoContainer = document.createElement("div");
        promoContainer.className = "botones-container";
        promoContainer.style.cssText = "display:flex;flex-direction:column;gap:8px;margin-top:8px;";
        promoButtons.forEach(b => promoContainer.appendChild(b));
        card.appendChild(promoContainer);
      }
    } catch {}

    // ── 5. Reacciones slot ──
    const rxnSlot = document.createElement("div");
    rxnSlot.setAttribute("data-rxn-slot", "");
    card.appendChild(rxnSlot);

    // ── 6. Comentarios slot ──
    const commentsSlot = document.createElement("div");
    commentsSlot.setAttribute("data-comments-slot", "");
    card.appendChild(commentsSlot);

    // ── 7. Claim slot ──
    const claimSlot = document.createElement("div");
    claimSlot.setAttribute("data-claim-slot", "");
    card.appendChild(claimSlot);

    // ── Reacciones: attach en slot mode ──
    if (window.PuntazoReactions) {
      const fecha = entry._meta ? `${entry._meta.Y}-${entry._meta.M}-${entry._meta.D}` : "";
      PuntazoReactions.attach(card, { videoId: entry.nombre, videoUrl: entry.url, club: loc, cancha: can, lado, fecha });
    }

    // ── Link a otro ángulo (asíncrono) ──
    (async () => {
      try {
        const opposite = await findOppositeVideo(entry, cfgGlobal, loc, can, lado);
        if (opposite?.nombre) {
          const btnAlt = document.createElement("a");
          btnAlt.className = "btn-alt"; btnAlt.textContent = "← Otro ángulo";
          btnAlt.title = "Ver desde la otra cámara";
          btnAlt.href = `lado.html?loc=${loc}&can=${can}&lado=${opposite.lado}&video=${encodeURIComponent(opposite.nombre)}`;
          btnAlt.addEventListener("click", () => trackEvent("click_other_perspective", gaCtx({ video_name: entry.nombre, target_lado: opposite.lado })));
          actionPills.appendChild(btnAlt);
        }
      } catch {}
    })();

    contenedorVideos.appendChild(card);
    allVideos.push(real);
  }

  setupMutualExclusion(allVideos);
  loadPreviewsSequentially(Array.from(contenedorVideos.querySelectorAll("video.video-preview")));

  const pagBottom = document.getElementById("paginator-bottom");
  renderPaginator(pagBottom, videosListaCompleta.length, paginaActual, PAGE_SIZE, (newPage) => {
    const totalPages = Math.max(1, Math.ceil(videosListaCompleta.length / PAGE_SIZE));
    newPage = Math.min(Math.max(0, newPage), totalPages - 1);
    trackEvent("paginate", gaCtx({ from: paginaActual, to: newPage }));
    paginaActual = newPage;
    setQueryParams({ pg: paginaActual });
    renderPaginaActual({ fueCambioDePagina: true });
    scrollToTop();
  });

  if (fueCambioDePagina && contenedorVideos.firstElementChild) {
    contenedorVideos.firstElementChild.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// ----------------------- populateVideos -----------------------
async function populateVideos() {
  const params = getQueryParams();
  const { loc, can, lado, filtro, video: targetId } = params;

  try {
    const resCfg = await fetch(`data/config_locations.json?cb=${Date.now()}`, { cache: "no-store" });
    cfgGlobal = await resCfg.json();

    const locObj  = cfgGlobal.locaciones.find(l => l.id === loc);
    const canObj  = locObj?.cancha.find(c => c.id === can);
    const ladoObj = canObj?.lados.find(l => l.id === lado);
    contenedorVideos = document.getElementById("videos-container");
    const loading = document.getElementById("loading");

    if (!ladoObj?.json_url || !contenedorVideos) {
      if (contenedorVideos) contenedorVideos.innerHTML = "<p style='color:#fff;padding:20px 0'>Lado no encontrado.</p>";
      return;
    }

    trackEvent("view_side", gaCtx({ loc, can, lado, filtro: filtro || "", has_target_video: !!targetId }));

    const res = await fetch(`${ladoObj.json_url}?cb=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("No se pudo acceder al JSON.");
    const data = await res.json();
    if (loading) loading.style.display = "block";
    contenedorVideos.innerHTML = "";

    const linkClub   = document.getElementById("link-club");
    const linkCancha = document.getElementById("link-cancha");
    const nombreLado = document.getElementById("nombre-lado");
    if (linkClub)   { linkClub.textContent = locObj?.nombre || loc; linkClub.href = `locacion.html?loc=${loc}`; }
    if (linkCancha) { linkCancha.textContent = canObj?.nombre || can; }
    if (nombreLado) { nombreLado.textContent = ladoObj?.nombre || lado; }

    oppInfoCache = await findOppositeConfig(cfgGlobal, loc, can, lado);
    const oppTopHref = oppInfoCache?.oppId
      ? `lado.html?loc=${loc}&can=${can}&lado=${oppInfoCache.oppId}` + (params.filtro ? `&filtro=${encodeURIComponent(params.filtro)}` : "")
      : null;
    ensureOppositeTopButton(oppTopHref, oppInfoCache?.oppName);

    const raw = Array.isArray(data.videos) ? data.videos : [];
    raw.forEach(v => { v._meta = parseFromName(v.nombre); });
    await prefetchUploadTimes(raw, 12);

    let selectedKey = params.dia || ymdFromDate(new Date());
    if (targetId) { const tm = parseFromName(targetId); if (tm?.ymd) selectedKey = tm.ymd; }

    const model = renderDayFilterBar(raw, selectedKey);

    // Auto-fall a ayer si hoy está vacío y no hay día explícito
    const hasExplicitDay = ("dia" in params) && !!params.dia;
    if (!hasExplicitDay && !targetId) {
      const todayKey = model.dayKeys?.[0], yKey = model.dayKeys?.[1];
      const nToday = todayKey ? (model.byKey.get(todayKey) || []).length : 0;
      const nY     = yKey     ? (model.byKey.get(yKey)     || []).length : 0;
      if (nToday === 0 && nY > 0) {
        selectedKey = yKey;
        setQueryParams({ dia: selectedKey, pg: 0, video: "" }, true);
        renderDayFilterBar(raw, selectedKey);
      }
    }

    if (!model.dayKeys.includes(selectedKey)) {
      selectedKey = model.dayKeys[0] || ymdFromDate(new Date());
      renderDayFilterBar(raw, selectedKey);
    }

    let list = raw.filter(v => v._meta?.ymd === selectedKey);
    list.forEach(v => { v._isNew = isNewVideo(v); });

    createHourFilterUI(list);
    if (filtro) list = list.filter(v => { const m = v.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/); return m && m[1] === filtro; });

    list.sort((a, b) => {
      const ta = parseFromName(a.nombre)?.tsKey ?? -Infinity;
      const tb = parseFromName(b.nombre)?.tsKey ?? -Infinity;
      return tb - ta;
    });

    ultimoFiltroActivo   = filtro || null;
    videosListaCompleta  = list;

    ensureBottomControlsContainer();

    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    let desiredPg = parseInt(params.pg || "0", 10);
    if (Number.isNaN(desiredPg)) desiredPg = 0;
    if (targetId) {
      const idx = list.findIndex(v => v.nombre === targetId);
      if (idx >= 0) desiredPg = Math.floor(idx / PAGE_SIZE);
    }
    paginaActual = Math.min(Math.max(0, desiredPg), totalPages - 1);
    setQueryParams({ pg: paginaActual }, !("pg" in params));

    await renderPaginaActual({ fueCambioDePagina: false });
    if (loading) loading.style.display = "none";
    if (targetId) scrollToVideoById(targetId);

  } catch(err) {
    console.error("populateVideos:", err);
    const vc = document.getElementById("videos-container");
    if (vc) vc.innerHTML = "<p style='color:#fff;padding:20px 0'>No hay videos disponibles.</p>";
    const loading = document.getElementById("loading");
    if (loading) loading.style.display = "none";
  }
}

// ----------------------- scroll top -----------------------
function createScrollToTopBtn() {
  const btn = document.createElement("button");
  btn.textContent = "↑"; btn.className = "scroll-top"; btn.style.display = "none";
  btn.setAttribute("aria-label", "Ir arriba");
  btn.addEventListener("click", () => { trackEvent("scroll_to_top", gaCtx({})); scrollToTop(); });
  document.body.appendChild(btn);
  let lastY = window.scrollY;
  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    if (y > 100 && y < lastY && allVideos.length > 3) btn.style.display = "block";
    else btn.style.display = "none";
    lastY = y;
  });
}

async function isSingleLado(locId, canId) {
  try {
    let cfg = cfgGlobal;
    if (!cfg) cfg = await (await fetch(`data/config_locations.json?cb=${Date.now()}`, { cache: "no-store" })).json();
    const loc = cfg?.locaciones?.find(l => l.id === locId);
    const can = loc?.cancha?.find(c => c.id === canId);
    return Array.isArray(can?.lados) && can.lados.length === 1;
  } catch { return false; }
}

// ----------------------- arranque -----------------------
document.addEventListener("DOMContentLoaded", () => {
  const path = window.location.pathname;
  const p = getQueryParams();

  (async () => {
    if (path.endsWith("index.html") || path.endsWith("explorar.html") || path === "/") {
      populateLocaciones(); return;
    }
    if (path.endsWith("locacion.html")) { populateCanchas(); return; }
    if (path.endsWith("cancha.html")) {
      const ok = await requireCanchaPassword(p.loc, p.can);
      if (!ok) { window.location.href = `locacion.html?loc=${p.loc}`; return; }
      try {
        const cfg = await (await fetch(`data/config_locations.json?cb=${Date.now()}`, { cache: "no-store" })).json();
        const loc = cfg.locaciones.find(l => l.id === p.loc);
        const can = loc?.cancha.find(c => c.id === p.can);
        const lados = Array.isArray(can?.lados) ? can.lados : [];
        if (lados.length === 1) { window.location.href = `lado.html?loc=${p.loc}&can=${p.can}&lado=${lados[0].id}`; return; }
      } catch {}
      populateLados(); return;
    }
    if (path.endsWith("lado.html")) {
      const ok = await requireCanchaPassword(p.loc, p.can);
      if (!ok) { window.location.href = `cancha.html?loc=${p.loc}&can=${p.can}`; return; }
      populateVideos(); createScrollToTopBtn(); return;
    }
  })();

  // Botón volver
  const btnVolver = document.getElementById("btn-volver");
  if (btnVolver) {
    (async () => {
      const p2 = getQueryParams();
      if (path.endsWith("lado.html")) {
        const mono = await isSingleLado(p2.loc, p2.can);
        btnVolver.href = mono ? `locacion.html?loc=${p2.loc}` : `cancha.html?loc=${p2.loc}&can=${p2.can}`;
      } else if (path.endsWith("cancha.html")) {
        btnVolver.href = `locacion.html?loc=${p2.loc}`;
      } else if (path.endsWith("locacion.html")) {
        btnVolver.href = "explorar.html";
      }
    })();
  }
});

window.addEventListener("popstate", () => {
  const p = getQueryParams();
  if ((p.filtro || null) !== ultimoFiltroActivo) {
    populateVideos();
  } else {
    const totalPages = Math.max(1, Math.ceil(videosListaCompleta.length / PAGE_SIZE));
    let desiredPg = parseInt(p.pg || "0", 10);
    if (Number.isNaN(desiredPg)) desiredPg = 0;
    paginaActual = Math.min(Math.max(0, desiredPg), totalPages - 1);
    renderPaginaActual({ fueCambioDePagina: true });
    if (cfgGlobal && p.loc && p.can && p.lado) {
      findOppositeConfig(cfgGlobal, p.loc, p.can, p.lado).then(info => {
        const base = info?.oppId ? `lado.html?loc=${p.loc}&can=${p.can}&lado=${info.oppId}` : null;
        ensureOppositeTopButton(base ? (p.filtro ? `${base}&filtro=${encodeURIComponent(p.filtro)}` : base) : null, info?.oppName);
      }).catch(() => {});
    }
  }
});

// ── Navbar ──
function initNavbar() {
  if (window.__pz_nav_click_handler) {
    try { document.removeEventListener("click", window.__pz_nav_click_handler); } catch {}
  }
  const handler = function(e) {
    const toggle = e.target?.closest?.(".menu-toggle");
    if (toggle) {
      if (window.innerWidth > 860) { document.querySelector(".navbar")?.classList.remove("show"); return; }
      e.stopPropagation();
      const nav = document.querySelector(".navbar") || document.querySelector("#nav-menu");
      if (nav) nav.classList.toggle("show");
      return;
    }
    if (!e.target?.closest?.(".navbar")) {
      document.querySelector(".navbar")?.classList.remove("show");
      document.querySelector("#nav-menu")?.classList.remove("show");
    }
  };
  window.__pz_nav_click_handler = handler;
  document.addEventListener("click", handler);

  if (window.__pz_nav_scroll_handler) { try { window.removeEventListener("scroll", window.__pz_nav_scroll_handler); } catch {} }
  const scrollH = () => { document.querySelector(".navbar")?.classList.remove("show"); document.querySelector("#nav-menu")?.classList.remove("show"); };
  window.__pz_nav_scroll_handler = scrollH;
  window.addEventListener("scroll", scrollH, { passive: true });

  if (window.__pz_nav_resize_handler) { try { window.removeEventListener("resize", window.__pz_nav_resize_handler); } catch {} }
  const resizeH = () => { if (window.innerWidth > 860) { document.querySelector(".navbar")?.classList.remove("show"); document.querySelector("#nav-menu")?.classList.remove("show"); } };
  window.__pz_nav_resize_handler = resizeH;
  window.addEventListener("resize", resizeH);
}
window.addEventListener("puntazo:header-rendered", initNavbar);
