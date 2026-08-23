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
  return `${h % 12 || 12} ${h >= 12 ? "PM" : "AM"}`;
}

function scrollToTop() { window.scrollTo({ top: 0, behavior: "smooth" }); }

function scrollToVideoById(id) {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  // Resalta el clip un par de segundos (deep-link desde notificación / "otro ángulo")
  // para que ubiques de inmediato cuál es.
  try {
    target.classList.add("pz-clip-highlight");
    setTimeout(() => { try { target.classList.remove("pz-clip-highlight"); } catch {} }, 2600);
  } catch {}
}

// ----------------------- analytics -----------------------
function trackEvent(name, params = {}) {
  try { if (typeof window.gtag === "function") window.gtag("event", name, params); } catch(e) {}
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
  try { const res = await fetch(`data/passwords.json?cb=${Date.now()}`, { cache: "no-store" }); if (!res.ok) throw new Error(); return await res.json(); } catch { return null; }
}
function findCanchaRule(pwCfg, locId, canId) {
  if (!pwCfg?.canchas?.length) return null;
  return pwCfg.canchas.find(x => x.loc === locId && x.can === canId) || null;
}
function getAuthKey(locId, canId) { return `gate:${locId}:${canId}`; }
function isAuthorized(rule) {
  if (!rule || !rule.enabled) return true;
  try { const obj = JSON.parse(localStorage.getItem(getAuthKey(rule.loc, rule.can)) || "null"); return !!(obj?.ok && typeof obj.exp === "number" && Date.now() < obj.exp); } catch { return false; }
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
    if (await sha256Hex(input) === rule.sha256) { setAuthorized(rule); trackEvent("gate_unlock", gaCtx({ result: "ok" })); return true; }
    alert("Contraseña incorrecta. Inténtalo de nuevo.");
  }
  trackEvent("gate_unlock", gaCtx({ result: "fail" }));
  return false;
}

// ----------------------- GATE POR CLUB -----------------------
// (2026-06-12) Gate a nivel CLUB: una sola contraseña para TODO el club, antes
// de poder ver cualquier cancha/lado/clip de ese club (ej. Scorpion). Config en
// passwords.json → clubs:[{loc,enabled,sha256,remember_hours}]. Reusa sha256Hex/
// loadPasswords. Llave de localStorage independiente de la de cancha.
function findClubRule(pwCfg, locId) {
  if (!pwCfg?.clubs?.length) return null;
  return pwCfg.clubs.find(x => x.loc === locId) || null;
}
function getClubAuthKey(locId) { return `gate:club:${locId}`; }
function isClubAuthorized(rule) {
  if (!rule || !rule.enabled) return true;
  try { const obj = JSON.parse(localStorage.getItem(getClubAuthKey(rule.loc)) || "null"); return !!(obj?.ok && typeof obj.exp === "number" && Date.now() < obj.exp); } catch { return false; }
}
function setClubAuthorized(rule) {
  const remember = (Number(rule.remember_hours) > 0 ? Number(rule.remember_hours) : 24) * 3600000;
  localStorage.setItem(getClubAuthKey(rule.loc), JSON.stringify({ ok: true, exp: Date.now() + remember }));
}
async function requireClubPassword(locId) {
  const pwCfg = await loadPasswords();
  const rule = findClubRule(pwCfg, locId);
  if (!rule || !rule.enabled) return true;
  if (isClubAuthorized(rule)) return true;
  for (let i = 0; i < 3; i++) {
    const input = window.prompt("Este club requiere contraseña para ver sus puntazos.");
    if (input === null) return false;
    if (await sha256Hex(input) === rule.sha256) { setClubAuthorized(rule); trackEvent("gate_unlock", gaCtx({ result: "ok", scope: "club" })); return true; }
    alert("Contraseña incorrecta. Inténtalo de nuevo.");
  }
  trackEvent("gate_unlock", gaCtx({ result: "fail", scope: "club" }));
  return false;
}

// ----------------------- parseFromName -----------------------
// F123-D: ahora reconoce sufijo opcional _TAG_TAGID entre lado y fecha
// (espejo de F123-A en assets/matches.js). El grupo lado se ancla a
// (Lado[A-Z]) para evitar que el backtracking se trague el sufijo.
// Backwards-compatible: filenames sin sufijo siguen parseando igual con
// tag=null, tagId=null.
function parseFromName(name) {
  const re = /^(.+?)_(.+?)_(Lado[A-Z])(?:_([A-Z][A-Z_]*)_([A-Za-z0-9]+))?_(\d{8})_(\d{6})\.mp4$/i;
  const m = String(name || "").match(re);
  if (!m) return null;
  const [, loc, can, lado, tag, tagId, date8, time6] = m;
  const tryYYYYMMDD = () => {
    const Y = Number(date8.slice(0,4)), Mo = Number(date8.slice(4,6)), D = Number(date8.slice(6,8));
    if (Y>=1900&&Y<=2100&&Mo>=1&&Mo<=12&&D>=1&&D<=31) return { Y: String(Y), M: date8.slice(4,6), D: date8.slice(6,8) };
    return null;
  };
  const tryDDMMYYYY = () => {
    const D = Number(date8.slice(0,2)), Mo = Number(date8.slice(2,4)), Y = Number(date8.slice(4,8));
    if (Y>=1900&&Y<=2100&&Mo>=1&&Mo<=12&&D>=1&&D<=31) return { Y: String(Y), M: date8.slice(2,4), D: date8.slice(0,2) };
    return null;
  };
  const d = tryYYYYMMDD() || tryDDMMYYYY();
  if (!d) return null;
  const h = time6.slice(0,2), mi = time6.slice(2,4), s = time6.slice(4,6);
  const tsKey = Number(`${d.Y}${d.M}${d.D}${h}${mi}${s}`);
  const date = new Date(Number(d.Y), Number(d.M)-1, Number(d.D), Number(h), Number(mi), Number(s));
  return {
    loc, can, lado, date, tsKey,
    ymd: `${d.Y}${d.M}${d.D}`, Y: d.Y, M: d.M, D: d.D, h, mi, s,
    tag: tag || null, tagId: tagId || null,
  };
}

// ── Etiqueta de fecha para separadores ──────────────────────────
function getDateLabel(meta) {
  if (!meta) return "Anterior";
  const today = new Date(); today.setHours(0,0,0,0);
  const vDate = new Date(Number(meta.Y), Number(meta.M)-1, Number(meta.D)); vDate.setHours(0,0,0,0);
  const diff  = Math.round((today - vDate) / 86400000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  if (diff <= 7)  return `Hace ${diff} días`;
  return vDate.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

// ── URL de vitrina derivada del json_url ─────────────────────────
function getVitrinaUrl(jsonUrl) {
  return jsonUrl ? jsonUrl.replace("videos_recientes.json", "videos_vitrina.json") : null;
}

// ── Separador de fecha ───────────────────────────────────────────
function crearSeparadorFecha(label) {
  const sep = document.createElement("div");
  sep.className = "date-separator";
  sep.innerHTML = `<div class="date-sep-line"></div><div class="date-sep-label">${label}</div><div class="date-sep-line"></div>`;
  return sep;
}

// ── Constantes de vitrina ────────────────────────────────────────
const MIN_VITRINA_VIDEOS = 5;
const MAX_VIDEOS_SIN_FILTRO_HORA = 10;

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
  const meta = parseFromName(entry.nombre); if (!meta) return null;
  const oppCfg = await findOppositeConfig(cfg, locId, canId, ladoId); if (!oppCfg?.oppUrl) return null;
  try {
    const res = await fetch(`${oppCfg.oppUrl}?cb=${Date.now()}`, { cache: "no-store" }); if (!res.ok) return null;
    const dataOpp = await res.json();
    const sameDay = (dataOpp.videos || []).filter(v => { const m = parseFromName(v.nombre); return m && m.ymd === meta.ymd; });
    let best = null, bestDelta = Infinity;
    sameDay.forEach(v => { const mv = parseFromName(v.nombre); if (!mv) return; const d = absSeconds(mv.date, meta.date); if (d <= 15 && d < bestDelta) { best = v; bestDelta = d; } });
    return best ? { lado: oppCfg.oppId, nombre: best.nombre, url: best.url } : null;
  } catch { return null; }
}

// ----------------------- navegación -----------------------
async function populateLocaciones() {
  try {
    const config = await (await fetch(`data/config_locations.json?cb=${Date.now()}`, { cache: "no-store" })).json();
    const ul = document.getElementById("locaciones-lista"); if (!ul) return; ul.innerHTML = "";
    config.locaciones.forEach(loc => {
      const li = document.createElement("li"); li.classList.add("fade-in");
      const a = document.createElement("a"); a.href = `locacion.html?loc=${loc.id}`; a.textContent = loc.nombre; a.classList.add("link-blanco");
      a.addEventListener("click", () => trackEvent("open_locacion", { loc: loc.id }));
      li.appendChild(a); ul.appendChild(li);
    });
  } catch(err) { console.error("populateLocaciones:", err); }
}

async function populateCanchas() {
  try {
    const params = getQueryParams();
    const config = await (await fetch(`data/config_locations.json?cb=${Date.now()}`, { cache: "no-store" })).json();
    const loc = config.locaciones.find(l => l.id === params.loc);
    const ul = document.getElementById("canchas-lista"); if (!ul || !loc) return; ul.innerHTML = "";
    const nombreEl = document.getElementById("nombre-locacion"); if (nombreEl) nombreEl.textContent = loc.nombre;
    loc.cancha.forEach(can => {
      const li = document.createElement("li"); li.classList.add("fade-in");
      const a = document.createElement("a");
      const lados = Array.isArray(can.lados) ? can.lados : [];
      if (lados.length === 1) { a.href = `lado.html?loc=${params.loc}&can=${can.id}&lado=${lados[0].id}`; a.addEventListener("click", () => trackEvent("open_lado", { loc: params.loc, can: can.id, lado: lados[0].id, via: "direct_from_locacion" })); }
      else { a.href = `cancha.html?loc=${params.loc}&can=${can.id}`; a.addEventListener("click", () => trackEvent("open_cancha", { loc: params.loc, can: can.id })); }
      a.textContent = can.nombre; a.classList.add("link-blanco");
      li.appendChild(a); ul.appendChild(li);
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
    if (lados.length === 1) { window.location.href = `lado.html?loc=${params.loc}&can=${params.can}&lado=${lados[0].id}`; return; }
    const ul = document.getElementById("lados-lista"); if (!ul || !cancha) return; ul.innerHTML = "";
    const linkClub = document.getElementById("link-club"), linkCancha = document.getElementById("link-cancha");
    if (linkClub)   { linkClub.textContent = loc.nombre; linkClub.href = `locacion.html?loc=${params.loc}`; }
    // F135 (Fix 4): "cambiar cancha" → selector de canchas del club actual.
    if (linkCancha) { linkCancha.textContent = cancha.nombre; linkCancha.href = `entrada.html?modo=canchas&loc=${encodeURIComponent(params.loc)}`; }
    cancha.lados.forEach(lado => {
      const li = document.createElement("li"); li.classList.add("fade-in");
      const a = document.createElement("a"); a.href = `lado.html?loc=${params.loc}&can=${params.can}&lado=${lado.id}`; a.textContent = lado.nombre || lado.id; a.classList.add("link-blanco");
      a.addEventListener("click", () => trackEvent("open_lado", { loc: params.loc, can: params.can, lado: lado.id }));
      li.appendChild(a); ul.appendChild(li);
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
function resolvePlaceholdersInArray(arr, entry, extraCtx = {}) { return (arr || []).map(s => resolvePlaceholders(s, entry, extraCtx)); }

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
  if (!el) { el = document.createElement("div"); el.id = "__promo_toast__"; el.style.cssText = "position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:10px 14px;border-radius:8px;z-index:3000;font-weight:600;"; document.body.appendChild(el); }
  el.textContent = msg; el.style.display = "block";
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.style.display = "none"; }, 1600);
}

async function doCopyAction(action, entry) {
  const text = resolvePlaceholders(action?.text || "", entry);
  try { await navigator.clipboard.writeText(text); toast("Copiado"); }
  catch { try { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); toast("Copiado"); ta.remove(); } catch { alert("No se pudo copiar"); } }
}
function doCloseAction() { ensurePromoModalRoot().style.display = "none"; }
function buildMailto(action, entry) { return `mailto:${action?.to || "contacto@puntazoclips.com"}?subject=${encodeURIComponent(resolvePlaceholders(action?.subject || "", entry))}&body=${encodeURIComponent(resolvePlaceholdersInArray(action?.bodyTemplate || [], entry).join("\n"))}`; }
// 19-ago-2026: se retiro el correo como canal de contacto (decision de Isaac; ahora
// todo entra por Instagram o WhatsApp). Este constructor sustituye a buildMailto en
// las promos: WhatsApp -y no el mensaje directo de Instagram- porque los enlaces de
// Instagram NO admiten texto prellenado, y aqui el cuerpo carga datos que si hacen
// falta (URL del clip, nombre del archivo, el consentimiento de uso en redes).
// El asunto viaja como primera linea, ya que WhatsApp no tiene campo de asunto.
const WHATSAPP_PUNTAZO = "522206804856";
function buildWhatsApp(action, entry) {
  const NL     = String.fromCharCode(10);
  const cuerpo = resolvePlaceholdersInArray(action?.bodyTemplate || [], entry).join(NL);
  const asunto = resolvePlaceholders(action?.subject || "", entry);
  const texto  = asunto ? ("*" + asunto + "*" + NL + NL + cuerpo) : cuerpo;
  return "https://wa.me/" + (action?.phone || WHATSAPP_PUNTAZO) + "?text=" + encodeURIComponent(texto);
}

async function handlePromoAction(action, entry) {
  const type = (action?.type || "").toLowerCase();
  trackEvent("promo_action", gaCtx({ action_type: type, video_name: entry?.nombre || "" }));
  if (type === "url")    { try { window.open(action.href || "#", action.target || "_blank"); } catch { location.href = action.href; } return; }
  if (type === "whatsapp") { const u = buildWhatsApp(action, entry); try { window.open(u, "_blank"); } catch { location.href = u; } return; }
  if (type === "mailto") { location.href = buildMailto(action, entry); return; }   // legacy: ninguna promo lo usa ya
  if (type === "copy")   { await doCopyAction(action, entry); return; }
  doCloseAction();
}

function renderPromoModal(conf, entry) {
  const root = ensurePromoModalRoot(), box = document.getElementById("promo-modal-box"); clearNode(box);
  const theme = conf?.modal?.theme || {};
  box.style.border = `2px solid ${theme.border_color || "#333"}`; box.style.background = theme.bg_color || "#fff"; box.style.color = theme.text_color || "#000";
  const head = document.createElement("div"); head.style.cssText = "display:flex;align-items:center;gap:10px;";
  (conf?.modal?.logos || []).slice(0,3).forEach(src => { const img = document.createElement("img"); img.src = src; img.style.cssText = "height:40px;width:auto;object-fit:contain;"; head.appendChild(img); });
  const title = document.createElement("h2"); title.textContent = conf?.modal?.title || resolvePlaceholders(conf?.label || "Promoción", entry); title.style.cssText = `margin:0;color:${theme.border_color || "#333"};`; head.appendChild(title); box.appendChild(head);
  const intro = conf?.modal?.intro_list || [];
  if (intro.length) { const ul = document.createElement("ul"); ul.style.paddingLeft = "20px"; resolvePlaceholdersInArray(intro, entry).forEach(txt => { const li = document.createElement("li"); li.textContent = txt; ul.appendChild(li); }); const d = document.createElement("div"); d.style.marginTop = "10px"; d.appendChild(ul); box.appendChild(d); }
  const btnRow = document.createElement("div"); btnRow.style.cssText = "display:flex;gap:8px;margin-top:18px;";
  (conf?.modal?.buttons || [{ label: "Cerrar", style: { bg_color: "#f5f5f5", text_color: "#000", border_color: "#ccc" }, action: { type: "close" } }]).slice(0,3).forEach(bc => {
    const btn = document.createElement("button"); btn.type = "button"; btn.textContent = resolvePlaceholders(bc.label || "Acción", entry);
    const s = bc.style || {}; btn.style.cssText = `flex:1;padding:12px 16px;border:2px solid ${s.border_color||"#333"};border-radius:10px;background:${s.bg_color||"#333"};color:${s.text_color||"#fff"};cursor:pointer;font-family:inherit;`;
    btn.addEventListener("click", async () => await handlePromoAction(bc.action || {}, entry)); btnRow.appendChild(btn);
  });
  box.appendChild(btnRow); root.style.display = "flex";
}

function openPromoModal(entry, conf) {
  if (!conf?.modal?.enabled) return;
  trackEvent("promo_modal_open", gaCtx({ video_name: entry?.nombre || "" }));
  renderPromoModal(conf, entry);
}

function legacyConvertIfNeeded(conf) {
  const c = structuredClone(conf);
  if (c?.action === "modal_then_mailto") {
    c.action = { type: "modal" }; c.modal = c.modal || {}; c.modal.enabled = true;
    if (!Array.isArray(c.modal.buttons) || !c.modal.buttons.length) {
      c.modal.buttons = [
        { label: "Nominar mi punto", style: { bg_color: c.border_color || "#004FC8", text_color: "#fff", border_color: c.border_color || "#004FC8" }, action: { type: "whatsapp", phone: c.whatsapp || WHATSAPP_PUNTAZO, subject: c.subject || "Nominar punto", bodyTemplate: c.bodyTemplate || [] } },
        { label: "Cerrar", style: { bg_color: "#f5f5f5", text_color: "#000", border_color: "#ccc" }, action: { type: "close" } }
      ];
    }
    c.modal.theme = c.modal.theme || { bg_color: c.bg_color || "#fff", text_color: c.text_color || "#000", border_color: c.border_color || "#004FC8" };
    if (!c.modal.logos && c.logo) c.modal.logos = [c.logo];
  }
  return c;
}

async function buildPromoButtonsForClub(loc, entry) {
  const clubMap = await loadClubPromotions(), defs = await loadPromotionDefinitions();
  let promosForLoc = clubMap?.[loc]; if (!promosForLoc) return [];
  let promoIds = [], overrides = {};
  if (Array.isArray(promosForLoc)) { promoIds = promosForLoc; }
  else if (typeof promosForLoc === "object" && Array.isArray(promosForLoc.promos)) { promoIds = promosForLoc.promos; overrides = promosForLoc.overrides || {}; }
  else return [];
  const buttons = [];
  for (const pid of promoIds) {
    let base = defs?.[pid]; if (!base) continue;
    base = legacyConvertIfNeeded(base);
    const merged = deepMerge(base, overrides[pid] || {});
    const actionObj = merged?.action || {};
    const actionType = (actionObj.type || (typeof merged.action === "string" ? merged.action : "") || "").toLowerCase();
    const st = getButtonStyle(merged); const label = merged?.label || "Promoción";
    const mkBtn = (isAnchor) => {
      const el = document.createElement(isAnchor ? "a" : "button"); if (!isAnchor) el.type = "button";
      el.className = "btn-promo"; stylePromoButton(el, merged);
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
// PAGINACIÓN POR DÍAS COMPLETOS (19-ago-2026, decisión de Isaac).
// Antes: rebanadas fijas de 10, que partían un día a la mitad entre dos páginas
// ("los del martes: 6 aquí y 4 en la siguiente"), lo cual desorienta al jugador
// que busca por día. Ahora una página SIEMPRE contiene días enteros.
//   · Objetivo ~10 videos por página.
//   · Mínimo 7 para cerrar una página (si va en menos, sigue sumando días).
//   · SIN máximo: si un solo día trae 28 videos, esa página lleva los 28.
// La decisión de cerrar página compara qué queda MÁS CERCA de 10: cerrar aquí
// o sumar el día siguiente. Así 7+3 se junta (=10) pero 7+20 no (7 gana a 27).
const PAGE_TARGET = 10;   // tamaño ideal de página
const PAGE_MIN    = 7;    // no se cierra una página con menos, salvo que se acaben los días
const PAGE_SIZE   = PAGE_TARGET;   // se conserva: lo usan el deep-link y el paginador legacy

// Agrupa la lista (ya ordenada, más reciente primero) en páginas de días completos.
// Devuelve [[video,...], [video,...]] — nunca parte un día entre dos páginas.
function construirPaginasPorDia(lista) {
  if (!Array.isArray(lista) || lista.length === 0) return [[]];
  // 1) Agrupar por etiqueta de día, respetando el orden ya calculado.
  const dias = [];
  let actual = null;
  for (const v of lista) {
    const key = v._dateLabel || "—";
    if (!actual || actual.key !== key) { actual = { key, items: [] }; dias.push(actual); }
    actual.items.push(v);
  }
  // 2) Empaquetar días en páginas.
  const paginas = [];
  let pag = [];
  for (let i = 0; i < dias.length; i++) {
    pag = pag.concat(dias[i].items);
    const quedanDias = i < dias.length - 1;
    if (!quedanDias) break;                      // último día: se cierra al salir
    if (pag.length < PAGE_MIN) continue;         // muy corta todavía: suma otro día
    const siSumo = pag.length + dias[i + 1].items.length;
    // ¿Cerrar aquí queda más cerca del objetivo que sumar el día siguiente?
    if (Math.abs(pag.length - PAGE_TARGET) <= Math.abs(siSumo - PAGE_TARGET)) {
      paginas.push(pag); pag = [];
    }
  }
  if (pag.length) paginas.push(pag);
  return paginas.length ? paginas : [[]];
}

// Índice de la página que contiene el video nº idx de la lista plana.
function paginaDeIndice(paginas, idx) {
  let acc = 0;
  for (let i = 0; i < paginas.length; i++) {
    if (idx < acc + paginas[i].length) return i;
    acc += paginas[i].length;
  }
  return 0;
}

// Cuántos videos hay antes de la página p (para el "N–M de T" del paginador).
function offsetDePagina(paginas, p) {
  let acc = 0;
  for (let i = 0; i < p && i < paginas.length; i++) acc += paginas[i].length;
  return acc;
}
let videosListaCompleta = [];
let paginaActual = 0;
let paginasPorDia = [[]];   // páginas de días completos (ver construirPaginasPorDia)
let cfgGlobal = null;
let oppInfoCache = null;
let contenedorVideos = null;
let contenedorBottomControls = null;
let contFiltroArriba = null, contFiltroAbajo = null;
let ultimoFiltroActivo = null;
let btnOppTopEl = null;

function ensureOppositeTopButton(oppHref, oppName) {
  const btnVolver = document.getElementById("btn-volver"); if (!btnVolver) return;
  const parent = btnVolver.parentElement || document.body;
  if (window.getComputedStyle(parent).display !== "flex") parent.style.cssText = "display:flex;align-items:center;gap:8px;justify-content:space-between;";
  if (!btnOppTopEl) {
    btnOppTopEl = document.createElement("a"); btnOppTopEl.id = "btn-opposite-top"; btnOppTopEl.className = btnVolver.className || "btn-alt";
    btnOppTopEl.textContent = "← Otro ángulo"; btnOppTopEl.style.marginLeft = "auto";
    btnOppTopEl.addEventListener("click", () => trackEvent("click_opposite_side", gaCtx({ position: "top" })));
    parent.appendChild(btnOppTopEl);
  }
  if (oppHref) { btnOppTopEl.href = oppHref; btnOppTopEl.style.display = ""; if (oppName) btnOppTopEl.title = `Ver ${oppName}`; }
  else { btnOppTopEl.style.display = "none"; }
}

function ensureBottomControlsContainer() {
  if (!contenedorBottomControls) {
    contenedorBottomControls = document.getElementById("bottom-controls");
    if (!contenedorBottomControls) { contenedorBottomControls = document.createElement("div"); contenedorBottomControls.id = "bottom-controls"; contenedorBottomControls.style.margin = "24px 0 12px"; contenedorVideos.parentElement.insertBefore(contenedorBottomControls, contenedorVideos.nextSibling); }
  }
  if (!document.getElementById("paginator-bottom")) { const pag = document.createElement("div"); pag.id = "paginator-bottom"; contenedorBottomControls.appendChild(pag); }
  contFiltroAbajo = document.getElementById("filtro-horario-bottom");
  if (!contFiltroAbajo) { contFiltroAbajo = document.createElement("div"); contFiltroAbajo.id = "filtro-horario-bottom"; contFiltroAbajo.style.marginTop = "12px"; contenedorBottomControls.appendChild(contFiltroAbajo); }
}

// `pageSize` puede ser un NÚMERO (páginas de tamaño fijo, uso legacy) o el ARREGLO
// de páginas por día — en cuyo caso el conteo y el rango "N–M" salen de él, porque
// con días completos las páginas ya no miden todas lo mismo.
function renderPaginator(container, totalItems, pageIndex, pageSize, onChange) {
  if (!container) return; container.innerHTML = "";
  const porDia     = Array.isArray(pageSize);
  const totalPages = porDia ? Math.max(1, pageSize.length)
                            : Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages <= 1) return;
  const wrap = document.createElement("div"); wrap.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:12px 0;";
  const mkBtn = (label, disabled, handler) => {
    const b = document.createElement("button"); b.textContent = label; b.disabled = !!disabled;
    b.style.cssText = `padding:6px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#eaf2ff;cursor:${disabled?"default":"pointer"};font-family:inherit;font-size:.82rem;font-weight:700;`;
    b.addEventListener("click", handler); return b;
  };
  wrap.appendChild(mkBtn("‹ Anterior", pageIndex === 0, () => onChange(pageIndex - 1)));
  const windowSize = 5, start = Math.max(0, Math.min(pageIndex - 2, totalPages - windowSize)), end = Math.min(totalPages - 1, start + windowSize - 1);
  for (let i = start; i <= end; i++) {
    const num = mkBtn(String(i+1), i === pageIndex, () => onChange(i));
    if (i === pageIndex) { num.style.background = "rgba(0,79,200,.28)"; num.style.borderColor = "rgba(11,124,255,.38)"; num.style.color = "#fff"; num.setAttribute("aria-current","page"); }
    wrap.appendChild(num);
  }
  wrap.appendChild(mkBtn("Siguiente ›", pageIndex >= totalPages - 1, () => onChange(pageIndex + 1)));
  const info = document.createElement("span");
  const off   = porDia ? offsetDePagina(pageSize, pageIndex) : pageIndex * pageSize;
  const largo = porDia ? (pageSize[pageIndex]?.length || 0)  : pageSize;
  const first = totalItems === 0 ? 0 : off + 1, last = Math.min(off + largo, totalItems);
  info.textContent = `${first}–${last} de ${totalItems} · Página ${pageIndex+1}/${totalPages}`; info.style.cssText = "margin-left:auto;font-size:.78rem;opacity:.65;color:#eaf2ff;";
  wrap.appendChild(info); container.appendChild(wrap);
}

function renderHourFilterIn(container, videos) {
  if (!container) return;
  const filtroHoraActivo = getQueryParams().filtro; container.innerHTML = "";
  const horasSet = new Set();
  videos.forEach(v => { const m = v.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/); if (m) horasSet.add(m[1]); });
  [...horasSet].sort().forEach(h => {
    const btn = document.createElement("button"); btn.type = "button";
    btn.textContent = `${formatAmPm(h)} - ${formatAmPm((+h+1)%24)}`; btn.className = "btn-filtro";
    if (filtroHoraActivo === h) btn.classList.add("activo");
    btn.addEventListener("click", () => { trackEvent("filter_hour", gaCtx({ hour: h })); setQueryParams({ filtro: h, pg: 0, video: "" }); populateVideos(); scrollToTop(); });
    container.appendChild(btn);
  });
  const qBtn = document.createElement("button"); qBtn.textContent = "✕ Quitar filtro"; qBtn.className = "btn-filtro quitar";
  if (!filtroHoraActivo) qBtn.style.display = "none";
  qBtn.addEventListener("click", () => { setQueryParams({ filtro: "", pg: 0, video: "" }); populateVideos(); scrollToTop(); });
  container.appendChild(qBtn); container.style.display = "flex";
}

function createHourFilterUI(videos) {
  contFiltroArriba = document.getElementById("filtro-horario") || null;
  renderHourFilterIn(contFiltroArriba, videos);
  ensureBottomControlsContainer();
  renderHourFilterIn(contFiltroAbajo, videos);
}

// ----------------------- preview overlay -----------------------
function createPreviewOverlay(videoSrc, duration, parentCard, posterUrl) {
  const preview = document.createElement("video");
  preview.muted = true; preview.playsInline = true; preview.preload = "none";
  // Portada-imagen ligera (poster): si la NUC ya generó la miniatura, se ve AL INSTANTE
  // en cualquier dispositivo, sin bajar ni decodificar el video. Cubre el "rectángulo
  // negro" en redes lentas / ahorro de datos / modo bajo consumo.
  if (posterUrl) preview.poster = toDropboxDirectFetchUrl(posterUrl);
  // #t=0.2 → el navegador pinta un frame REAL del INICIO del clip como portada.
  // Es barato (solo lee los primeros bytes del archivo) y SIEMPRE se ve algo, aunque
  // el autoplay esté bloqueado o el seek a la acción falle. Antes el único frame era
  // un seek profundo a duration-15 (final del archivo) que en móvil/Dropbox no llegaba
  // → rectángulo negro permanente.
  preview.src = videoSrc.indexOf("#") === -1 ? videoSrc + "#t=0.2" : videoSrc;
  preview.className = "video-preview";
  let start = duration > 15 ? duration - 15 : 0, end = start + 5;
  let jumpedToAction = false;
  // Portada: frame barato del inicio (NO el seek profundo que fallaba).
  const onLoadedMeta = () => { try { preview.currentTime = 0.2; } catch {} };
  const onTimeUpdate = () => { try { if (jumpedToAction && preview.currentTime >= end) preview.currentTime = start; } catch {} };
  // Recién al reproducir (scroll) saltamos a la acción (últimos 15s) y ahí loopea.
  const onPlay = () => { if (!jumpedToAction) { jumpedToAction = true; try { preview.currentTime = start; } catch {} } };
  preview.addEventListener("loadedmetadata", onLoadedMeta);
  preview.addEventListener("timeupdate", onTimeUpdate);
  preview.addEventListener("play", onPlay);
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      visibilityMap.set(preview, e.intersectionRatio);
      let max = 0, winner = null;
      visibilityMap.forEach((ratio, node) => { if (ratio > max) { max = ratio; winner = node; } });
      if (winner === preview && e.isIntersecting) {
        const realPlaying = parentCard.querySelector("video.real")?.paused === false;
        if (!realPlaying) { if (currentPreviewActive && currentPreviewActive !== preview) currentPreviewActive.pause(); currentPreviewActive = preview; preview.play().catch(() => {}); }
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

function setupMutualExclusion(list) { list.forEach(v => v.addEventListener("play", () => { list.forEach(o => { if (o !== v) o.pause(); }); })); }
async function loadPreviewsSequentially(previews) {
  for (const v of previews) {
    // Con poster-imagen ya hay portada visible: NO bajamos bytes del video para pintar
    // el frame; el loop de acción se carga solo al hacer scroll (play()). Ahorro real.
    if (v.poster) continue;
    v.preload = "metadata";
    await new Promise(res => { v.addEventListener("loadedmetadata", res, { once: true }); v.load(); });
  }
}
function pauseAllVideos() {
  try { if (currentPreviewActive) currentPreviewActive.pause(); } catch {}
  currentPreviewActive = null;
  document.querySelectorAll("video.video-preview, video.real").forEach(v => { try { v.pause(); } catch {} try { v.preload = "none"; } catch {} });
}

// ----------------------- Dropbox URLs -----------------------
function toDropboxDirectFetchUrl(url) {
  try { const u = new URL(url); if (u.hostname === "www.dropbox.com") u.hostname = "dl.dropboxusercontent.com"; u.searchParams.delete("raw"); u.searchParams.delete("dl"); return u.toString(); } catch { return url; }
}

// ----------------------- Auth helpers -----------------------
function getFirestoreDb() {
  try { if (window.PuntazoFirebase && typeof window.PuntazoFirebase.db === "function") return window.PuntazoFirebase.db(); if (window.firebase && firebase.apps?.length && typeof firebase.firestore === "function") return firebase.firestore(); } catch {}
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
  const user = getAuthUser(), db = getFirestoreDb(); if (!user || !db) return false;
  return (await db.collection("usuarios").doc(user.uid).collection("guardados").doc(videoId).get()).exists;
}
async function saveVideoForCurrentUser(meta) {
  const user = getAuthUser(), db = getFirestoreDb(); if (!user || !db) throw new Error("Sin usuario/DB");
  await db.collection("usuarios").doc(user.uid).collection("guardados").doc(meta.videoId).set(meta, { merge: true });
}
async function unsaveVideoForCurrentUser(videoId) {
  const user = getAuthUser(), db = getFirestoreDb(); if (!user || !db) throw new Error("Sin usuario/DB");
  await db.collection("usuarios").doc(user.uid).collection("guardados").doc(videoId).delete();
}

// ----------------------- Botones pill -----------------------

// Compartir el video real (MP4), no el link. Dropbox a veces redirige
// www.dropbox.com → dl.dropboxusercontent.com al hacer fetch(), y ese salto
// entre hosts puede romper CORS; vamos directo al host servible.
function toDirectFetchUrl(url) {
  try {
    const u = new URL(url, location.href);
    if (u.hostname === "www.dropbox.com") u.hostname = "dl.dropboxusercontent.com";
    u.searchParams.delete("raw"); u.searchParams.delete("dl");
    return u.toString();
  } catch { return url; }
}
function toForceDownloadUrl(url) {
  try {
    const u = new URL(url, location.href);
    if (u.hostname === "dl.dropboxusercontent.com") u.hostname = "www.dropbox.com";
    u.searchParams.delete("raw"); u.searchParams.set("dl", "1");
    return u.toString();
  } catch { return url; }
}

async function downloadWithProgress(url, { onProgress, signal } = {}) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const total = parseInt(res.headers.get("Content-Length") || "0", 10);
  const type = url.toLowerCase().includes(".mp4") ? "video/mp4" : (res.headers.get("Content-Type") || "video/mp4");
  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!reader) {
    const blob = await res.blob();
    if (onProgress) onProgress({ percent: 100, indeterminate: false });
    return new Blob([blob], { type: blob.type || type });
  }
  const chunks = []; let received = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength || 0;
    if (onProgress) {
      if (total) onProgress({ percent: Math.max(0, Math.min(100, Math.round(received / total * 100))), indeterminate: false });
      else onProgress({ percent: null, indeterminate: true });
    }
  }
  return new Blob(chunks, { type });
}

function crearSharePill(entry, video) {
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "action-pill"; btn.textContent = "📤"; btn.title = "Compartir video"; btn.setAttribute("aria-label", "Compartir");

  let state = "idle"; // idle | downloading | ready
  let pendingFile = null;
  let controller = null;
  let fillEl = null, labelEl = null;

  const setIdle = () => {
    state = "idle"; pendingFile = null; controller = null; fillEl = null; labelEl = null;
    btn.classList.remove("is-progress");
    btn.disabled = false;
    btn.innerHTML = "";
    btn.textContent = "📤";
    btn.title = "Compartir video";
  };

  const tryShareFile = async (file) => {
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "Puntazo", text: "¡Mira este puntazo! 🎾" });
      return true;
    }
    return false;
  };

  const downloadToDisk = (file) => {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url; a.download = entry.nombre;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
    toast("Video descargado");
  };

  const setProgress = ({ percent, indeterminate }) => {
    if (!fillEl || !labelEl) return;
    if (indeterminate) {
      fillEl.style.transform = "";
      fillEl.classList.add("is-indeterminate");
      labelEl.textContent = "";
    } else {
      fillEl.classList.remove("is-indeterminate");
      fillEl.style.transform = `scaleX(${(percent || 0) / 100})`;
      labelEl.textContent = percent + "%";
    }
  };

  btn.addEventListener("click", async () => {
    if (state === "ready" && pendingFile) {
      let ok = false;
      try { ok = await tryShareFile(pendingFile); } catch {}
      if (ok) trackEvent("share_success", gaCtx({ video_name: entry.nombre, mode: "manual_ready" }));
      else downloadToDisk(pendingFile);
      setIdle();
      return;
    }

    if (state === "downloading") {
      try { controller && controller.abort(); } catch {}
      return;
    }

    if (!entry.url) { toast("Video no disponible"); return; }

    trackEvent("click_share_download", gaCtx({ video_name: entry.nombre }));
    if (window.PZ && PZ.trackDownload) PZ.trackDownload(entry.nombre, { club: entry.loc || null, cancha: entry.can || null, lado: entry.lado || null, mode: "click" });
    if (video) { try { video.pause(); } catch {} }

    state = "downloading";
    btn.classList.add("is-progress");
    btn.title = "Toca para cancelar";
    btn.innerHTML = "";
    fillEl = document.createElement("span"); fillEl.className = "pill-fill";
    labelEl = document.createElement("span"); labelEl.className = "pill-label"; labelEl.textContent = "0%";
    btn.appendChild(fillEl); btn.appendChild(labelEl);

    controller = new AbortController();
    try {
      const blob = await downloadWithProgress(toDirectFetchUrl(entry.url), {
        signal: controller.signal,
        onProgress: setProgress,
      });
      const file = new File([blob], entry.nombre, { type: blob.type || "video/mp4" });

      let shared = false;
      try { shared = await tryShareFile(file); } catch { shared = false; }

      if (shared) {
        trackEvent("share_success", gaCtx({ video_name: entry.nombre, mode: "auto_share" }));
        setIdle();
        return;
      }

      if (navigator.canShare) {
        trackEvent("share_ready", gaCtx({ video_name: entry.nombre }));
        pendingFile = file; state = "ready";
        btn.classList.remove("is-progress");
        btn.innerHTML = ""; btn.textContent = "📤 Listo";
        btn.title = "Toca para compartir";
      } else {
        trackEvent("download_fallback", gaCtx({ video_name: entry.nombre, mode: "local_blob" }));
        downloadToDisk(file);
        setIdle();
      }
    } catch (err) {
      if (err && err.name === "AbortError") { setIdle(); toast("Descarga cancelada"); return; }
      console.warn("[crearSharePill]", err);
      try {
        const a = document.createElement("a");
        a.href = toForceDownloadUrl(entry.url);
        a.download = entry.nombre;
        document.body.appendChild(a); a.click();
        setTimeout(() => a.remove(), 500);
        trackEvent("download_fallback", gaCtx({ video_name: entry.nombre, mode: "force_dl" }));
      } catch {}
      setIdle();
      toast("No se pudo compartir, se intentó descargar");
    }
  });

  return btn;
}

function crearSavePill(entry, loc, can, lado) {
  const meta = buildSavedVideoMeta(entry, loc, can, lado);
  const btn  = document.createElement("button");
  btn.type = "button"; btn.className = "action-pill"; btn.title = "Guardar en tu perfil"; btn.setAttribute("aria-label", "Guardar");
  btn.dataset.saved = "0"; btn.dataset.loading = "0";
  // 💾 siempre — azul cuando guardado, gris cuando no (sin ✅)
  btn.textContent = "💾";

  const syncState = async () => {
    const user = getAuthUser();
    if (!user) { btn.classList.remove("is-saved"); return; }
    try { const saved = await isVideoSavedForCurrentUser(meta.videoId); btn.dataset.saved = saved ? "1" : "0"; btn.classList.toggle("is-saved", saved); } catch {}
  };
  btn._syncSavedState = syncState;

  btn.addEventListener("click", async () => {
    if (!window.PuntazoAuth?.currentUser) { if (window.PuntazoAuth?.requireAuth) window.PuntazoAuth.requireAuth(() => syncState()); return; }
    if (btn.dataset.loading === "1") return;
    btn.dataset.loading = "1"; btn.disabled = true;
    try {
      const alreadySaved = btn.dataset.saved === "1";
      if (alreadySaved) {
        await unsaveVideoForCurrentUser(meta.videoId); trackEvent("unsave_video", gaCtx({ video_name: entry.nombre }));
        btn.classList.remove("is-saved"); btn.dataset.saved = "0"; toast("Quitado de guardados");
      } else {
        await saveVideoForCurrentUser(meta); trackEvent("save_video", gaCtx({ video_name: entry.nombre }));
        btn.classList.add("is-saved"); btn.dataset.saved = "1"; toast("Guardado en tu perfil");
      }
    } catch(err) { console.warn("[guardados]", err); }
    btn.disabled = false; btn.dataset.loading = "0";
    setTimeout(() => syncState().catch(() => {}), 300);
  });

  window.addEventListener("puntazo:auth-changed", () => syncState());
  Promise.resolve().then(syncState);
  return btn;
}

let puntazoFullscreenUnlockBound = false;
function bindFullscreenUnlockOnce() {
  if (puntazoFullscreenUnlockBound) return; puntazoFullscreenUnlockBound = true;
  const unlock = () => { try { if (screen.orientation?.unlock) screen.orientation.unlock(); } catch {} };
  document.addEventListener("fullscreenchange",       () => { if (!document.fullscreenElement) unlock(); });
  document.addEventListener("webkitfullscreenchange", () => { if (!document.fullscreenElement && !document.webkitFullscreenElement) unlock(); });
}
function isThisVideoFullscreen(video) { return !!(document.fullscreenElement === video || document.webkitFullscreenElement === video || video.webkitDisplayingFullscreen); }
async function requestVideoFullscreen(video) {
  if (video.requestFullscreen)       return video.requestFullscreen();
  if (video.webkitRequestFullscreen) return video.webkitRequestFullscreen();
  if (video.webkitEnterFullscreen)   { video.webkitEnterFullscreen(); return; }
  throw new Error("Fullscreen no soportado");
}

function crearFullscreenPill(video, card, entry) {
  bindFullscreenUnlockOnce();
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "action-pill"; btn.textContent = "⛶"; btn.title = "Pantalla completa"; btn.setAttribute("aria-label", "Pantalla completa"); btn.style.display = "none";
  const syncLabel = () => { const a = isThisVideoFullscreen(video); btn.classList.toggle("is-active", a); btn.textContent = a ? "✕" : "⛶"; };
  const syncVis   = () => { btn.style.display = (!video.paused || isThisVideoFullscreen(video)) ? "inline-flex" : "none"; };
  btn.addEventListener("click", async () => {
    try {
      if (isThisVideoFullscreen(video)) {
        if (document.exitFullscreen) await document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        try { if (screen.orientation?.unlock) screen.orientation.unlock(); } catch {}
        trackEvent("video_fullscreen_exit", gaCtx({ video_name: entry.nombre }));
      } else {
        pauseAllVideos();
        const prev = card.querySelector("video.video-preview"); if (prev) { try { prev.pause(); } catch {} prev.style.display = "none"; }
        video.style.display = "block"; if (video.readyState < 1) video.load?.();
        await requestVideoFullscreen(video); try { await video.play(); } catch {}
        try { if (screen.orientation?.lock) await screen.orientation.lock("landscape"); } catch {}
        trackEvent("video_fullscreen_open", gaCtx({ video_name: entry.nombre }));
      }
      syncLabel(); syncVis();
    } catch(err) { console.warn("[fullscreen]", err); try { toast("No se pudo abrir pantalla completa"); } catch {} }
  });
  video.addEventListener("play",  syncVis); video.addEventListener("pause", syncVis); video.addEventListener("ended", syncVis);
  document.addEventListener("fullscreenchange",       () => { syncLabel(); syncVis(); });
  document.addEventListener("webkitfullscreenchange", () => { syncLabel(); syncVis(); });
  video.addEventListener("webkitbeginfullscreen", () => { syncLabel(); syncVis(); });
  video.addEventListener("webkitendfullscreen",   () => { try { if (screen.orientation?.unlock) screen.orientation.unlock(); } catch {}; syncLabel(); syncVis(); });
  return btn;
}

// ----------------------- limpiar página -----------------------
function limpiarRecursosDePagina() {
  try { if (currentPreviewActive) currentPreviewActive.pause(); } catch {}
  currentPreviewActive = null; visibilityMap = new Map();
  if (!contenedorVideos) return;
  Array.from(contenedorVideos.children).forEach(card => {
    [card.querySelector("video.real"), card.querySelector("video.video-preview")].forEach(v => {
      if (!v) return; try { v.pause?.(); } catch {}
      if (v._observer) { try { v._observer.disconnect(); } catch {} v._observer = null; }
      try { v.removeAttribute("src"); v.load?.(); } catch {}
    });
  });
  contenedorVideos.innerHTML = ""; allVideos = [];
}

// ========== renderPaginaActual — con separadores de fecha ==========
async function renderPaginaActual({ fueCambioDePagina = false } = {}) {
  limpiarRecursosDePagina();

  const params = getQueryParams();
  const { loc, can, lado } = params;
  // La página ya viene armada con días completos (nunca parte un día en dos).
  if (!Array.isArray(paginasPorDia) || !paginasPorDia.length) paginasPorDia = [[]];
  if (paginaActual >= paginasPorDia.length) paginaActual = paginasPorDia.length - 1;
  if (paginaActual < 0) paginaActual = 0;
  const start     = offsetDePagina(paginasPorDia, paginaActual);
  const pageSlice = paginasPorDia[paginaActual] || [];
  const end       = start + pageSlice.length;

  // Etiqueta del último video ANTES de esta página (para decidir si
  // el primer elemento de la página necesita separador)
  const prevLabel = start > 0 ? (videosListaCompleta[start - 1]?._dateLabel || null) : null;
  let lastRenderedLabel = prevLabel;

  for (const entry of pageSlice) {
    const m = entry.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/);
    let displayTime = "";
    if (m) { const hr = parseInt(m[1],10), mn = m[2], ap = hr>=12?"PM":"AM"; displayTime = `${hr%12||12}:${mn} ${ap}`; }

    // ── Separador de fecha (cuando cambia el día) ────────────────
    const currentLabel = entry._dateLabel || "Anterior";
    if (currentLabel !== lastRenderedLabel) {
      contenedorVideos.appendChild(crearSeparadorFecha(currentLabel));
      lastRenderedLabel = currentLabel;
    }

    // ── Card ──
    const card = document.createElement("div");
    card.className = "video-card"; card.id = entry.nombre;

    // F123-D: badge "PARTIDO COMPLETO" si el video tiene tag=PARTIDO.
    // entry._meta viene de parseFromName (ahora expone tag/tagId).
    // Backwards-compatible: clips sin tag se renderean exactamente igual.
    if (entry._meta && entry._meta.tag === "PARTIDO") {
      card.classList.add("is-partido-completo");
      const badge = document.createElement("div");
      badge.className = "card-partido-badge";
      badge.textContent = "🎾 PARTIDO COMPLETO";
      card.appendChild(badge);
    }

    // 1. Header: hora
    const cardTop = document.createElement("div"); cardTop.className = "card-top";
    const timeEl = document.createElement("span"); timeEl.className = "card-time"; timeEl.textContent = displayTime;
    cardTop.appendChild(timeEl); card.appendChild(cardTop);

    // 2. Video
    const wrap = document.createElement("div"); wrap.className = "video-wrap";
    const real = document.createElement("video");
    real.className = "real"; real.controls = true; real.playsInline = true; real.preload = "metadata"; real.src = entry.url;
    if (entry.poster_url) real.poster = toDropboxDirectFetchUrl(entry.poster_url);
    real.style.display = "none"; real.style.width = "100%"; real.style.borderRadius = "8px";
    real.addEventListener("play", () => { trackEvent("play_video", gaCtx({ video_name: entry.nombre })); }, { once: true });
    // (2026-06-10) Métrica de reproducciones server-side (video_stats).
    real.addEventListener("play", () => {
      if (window.PZ && PZ.trackVideoView) PZ.trackVideoView(entry.nombre, { club: entry.loc || null, cancha: entry.can || null, lado: entry.lado || null });
    });
    const preview = createPreviewOverlay(entry.url, entry.duracion || 60, card, entry.poster_url);
    preview.style.width = "100%"; preview.style.borderRadius = "8px";
    wrap.appendChild(real); wrap.appendChild(preview); card.appendChild(wrap);

    // 3. Botones pill
    const actionPills = document.createElement("div"); actionPills.className = "action-pills";
    actionPills.appendChild(crearSharePill(entry, real));
    actionPills.appendChild(crearSavePill(entry, loc, can, lado));
    actionPills.appendChild(crearFullscreenPill(real, card, entry));
    card.appendChild(actionPills);

    // Promociones
    try {
      const promoButtons = await buildPromoButtonsForClub(loc, entry);
      if (promoButtons.length) {
        const pc = document.createElement("div"); pc.className = "botones-container"; pc.style.cssText = "display:flex;flex-direction:column;gap:8px;margin-top:8px;";
        promoButtons.forEach(b => pc.appendChild(b)); card.appendChild(pc);
      }
    } catch {}

    // Otro ángulo (async)
    (async () => {
      try {
        const opposite = await findOppositeVideo(entry, cfgGlobal, loc, can, lado);
        if (opposite?.nombre) {
          const btnAlt = document.createElement("a"); btnAlt.className = "btn-alt"; btnAlt.textContent = "← Otro ángulo"; btnAlt.title = "Ver desde la otra cámara";
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
  renderPaginator(pagBottom, videosListaCompleta.length, paginaActual, paginasPorDia, (newPage) => {
    const totalPages = Math.max(1, paginasPorDia.length);
    newPage = Math.min(Math.max(0, newPage), totalPages - 1);
    trackEvent("paginate", gaCtx({ from: paginaActual, to: newPage }));
    paginaActual = newPage; setQueryParams({ pg: paginaActual });
    renderPaginaActual({ fueCambioDePagina: true }); scrollToTop();
  });

  if (fueCambioDePagina && contenedorVideos.firstElementChild) {
    contenedorVideos.firstElementChild.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// ===================== populateVideos — VITRINA =====================
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

    trackEvent("view_side", gaCtx({ loc, can, lado, filtro: filtro||"", has_target_video: !!targetId }));

    // ── 1. Recientes (24h) ─────────────────────────────────────
    const res = await fetch(`${ladoObj.json_url}?cb=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("No se pudo acceder al JSON.");
    const data = await res.json();
    if (loading) loading.style.display = "block";
    contenedorVideos.innerHTML = "";

    // Breadcrumb
    const linkClub = document.getElementById("link-club"), linkCancha = document.getElementById("link-cancha"), nombreLado = document.getElementById("nombre-lado");
    // F139: ambos breadcrumbs (nombre del club y cancha) van al selector de
    // CANCHAS del club actual, igual que "← Regresar". Antes "Club" caía en la
    // lista de clubs (locacion.html). Reusa el deep-link modo=canchas (F135).
    if (linkClub)   { linkClub.textContent = locObj?.nombre || loc; linkClub.href = `entrada.html?modo=canchas&loc=${encodeURIComponent(loc)}`; }
    if (linkCancha) { linkCancha.textContent = canObj?.nombre || can; linkCancha.href = `entrada.html?modo=canchas&loc=${encodeURIComponent(loc)}`; }
    if (nombreLado) { nombreLado.textContent = ladoObj?.nombre || lado; }

    // Lado opuesto
    oppInfoCache = await findOppositeConfig(cfgGlobal, loc, can, lado);
    const oppTopHref = oppInfoCache?.oppId ? `lado.html?loc=${loc}&can=${can}&lado=${oppInfoCache.oppId}` + (params.filtro ? `&filtro=${encodeURIComponent(params.filtro)}` : "") : null;
    ensureOppositeTopButton(oppTopHref, oppInfoCache?.oppName);

    const recientes = Array.isArray(data.videos) ? data.videos : [];
    recientes.forEach(v => { v._meta = parseFromName(v.nombre); v._isVitrina = false; });

    // ── 2. Vitrina: SIEMPRE se carga (19-ago-2026) ─────────────
    // Antes solo se pedía si había menos de MIN_VITRINA_VIDEOS recientes, así que
    // en un día movido el jugador perdía de vista todo lo de días anteriores. Hoy
    // el indexador publica la ventana completa de 14 días y aquí se consume entera;
    // la paginación por días completos evita que eso sature una sola pantalla.
    let vitrina = [];
    {
      try {
        const vitrinaUrl = getVitrinaUrl(ladoObj.json_url);
        if (vitrinaUrl) {
          const resV = await fetch(`${vitrinaUrl}?cb=${Date.now()}`, { cache: "no-store" });
          if (resV.ok) {
            const dataV = await resV.json();
            const existingNames = new Set(recientes.map(v => v.nombre));
            vitrina = (dataV.videos || []).filter(v => !existingNames.has(v.nombre));
            vitrina.forEach(v => { v._meta = parseFromName(v.nombre); v._isVitrina = true; });
          }
        }
      } catch(e) { console.warn("[vitrina]", e); }
    }

    // ── 3. Combinar, etiquetar fecha, ordenar ─────────────────
    const combined = [...recientes, ...vitrina];
    combined.forEach(v => { v._dateLabel = getDateLabel(v._meta); });
    combined.sort((a, b) => (b._meta?.tsKey ?? -Infinity) - (a._meta?.tsKey ?? -Infinity));

    // ── 4. Filtro de hora: solo si recientes > MAX ─────────────
    const showHourFilter = recientes.length > MAX_VIDEOS_SIN_FILTRO_HORA;

    // Ocultar filtro de día (eliminado)
    const diaContainer = document.getElementById("filtro-dia");
    if (diaContainer) { diaContainer.innerHTML = ""; diaContainer.style.display = "none"; }

    if (showHourFilter) {
      createHourFilterUI(recientes);
    } else {
      const fh = document.getElementById("filtro-horario");
      if (fh) { fh.innerHTML = ""; fh.style.display = "none"; }
      ensureBottomControlsContainer();
      if (contFiltroAbajo) { contFiltroAbajo.innerHTML = ""; contFiltroAbajo.style.display = "none"; }
    }

    // ── 5. Aplicar filtro de hora si aplica ────────────────────
    let list = [...combined];
    if (showHourFilter && filtro) {
      list = list.filter(v => { const mh = v.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/); return mh && mh[1] === filtro; });
    }

    ultimoFiltroActivo  = (showHourFilter && filtro) ? filtro : null;
    videosListaCompleta = list;

    ensureBottomControlsContainer();

    // Deep-link desde la notificación "tu puntazo ya está listo": ?pt=<ms de
    // consumed_at> resuelve el clip EXACTO por cercanía temporal (±90s), igual que
    // perfil. Así la notificación aterriza justo en ese video (cuya preview ya
    // muestra los primeros segundos por el frame de portada).
    let targetIdResolved = targetId;
    if (!targetIdResolved && params.pt) {
      const ptMs = parseInt(params.pt, 10);
      if (!Number.isNaN(ptMs)) {
        let best = null, bestDelta = Infinity;
        for (const v of list) {
          const dms = (v._meta && v._meta.date) ? v._meta.date.getTime() : null;
          if (dms == null) continue;
          const delta = Math.abs(dms - ptMs);
          if (delta <= 90000 && delta < bestDelta) { best = v; bestDelta = delta; }
        }
        if (best) targetIdResolved = best.nombre;
      }
    }

    // Se arman las páginas por días completos ANTES de resolver la página pedida,
    // porque el deep-link (?pg=, ?id=, ?pt=) tiene que aterrizar en la página real.
    paginasPorDia = construirPaginasPorDia(list);
    const totalPages = Math.max(1, paginasPorDia.length);
    let desiredPg = parseInt(params.pg || "0", 10);
    if (Number.isNaN(desiredPg)) desiredPg = 0;
    if (targetIdResolved) { const idx = list.findIndex(v => v.nombre === targetIdResolved); if (idx >= 0) desiredPg = paginaDeIndice(paginasPorDia, idx); }
    paginaActual = Math.min(Math.max(0, desiredPg), totalPages - 1);
    setQueryParams({ pg: paginaActual }, !("pg" in params));

    await renderPaginaActual({ fueCambioDePagina: false });
    if (loading) loading.style.display = "none";
    if (targetIdResolved) scrollToVideoById(targetIdResolved);

  } catch(err) {
    console.error("populateVideos:", err);
    const vc = document.getElementById("videos-container");
    if (vc) vc.innerHTML = "<p style='color:#fff;padding:20px 0'>No hay videos disponibles.</p>";
    const loading = document.getElementById("loading"); if (loading) loading.style.display = "none";
  }
}

// ----------------------- scroll top -----------------------
function createScrollToTopBtn() {
  const btn = document.createElement("button"); btn.textContent = "↑"; btn.className = "scroll-top"; btn.style.display = "none"; btn.setAttribute("aria-label", "Ir arriba");
  btn.addEventListener("click", () => { trackEvent("scroll_to_top", gaCtx({})); scrollToTop(); });
  document.body.appendChild(btn);
  let lastY = window.scrollY;
  window.addEventListener("scroll", () => { const y = window.scrollY; if (y > 100 && y < lastY && allVideos.length > 3) btn.style.display = "block"; else btn.style.display = "none"; lastY = y; });
}

// ----------------------- arranque -----------------------
document.addEventListener("DOMContentLoaded", () => {
  const path = window.location.pathname, p = getQueryParams();
  (async () => {
    if (path.endsWith("index.html") || path.endsWith("explorar.html") || path === "/") { populateLocaciones(); return; }
    if (path.endsWith("locacion.html")) {
      // Gate de club: no ver ni la lista de canchas de un club protegido sin pass.
      if (!(await requireClubPassword(p.loc))) { window.location.href = "index.html"; return; }
      populateCanchas(); return;
    }
    if (path.endsWith("cancha.html")) {
      if (!(await requireClubPassword(p.loc))) { window.location.href = "index.html"; return; }
      const ok = await requireCanchaPassword(p.loc, p.can);
      if (!ok) { window.location.href = `locacion.html?loc=${p.loc}`; return; }
      try {
        const cfg = await (await fetch(`data/config_locations.json?cb=${Date.now()}`, { cache: "no-store" })).json();
        const loc = cfg.locaciones.find(l => l.id === p.loc), can = loc?.cancha.find(c => c.id === p.can);
        const lados = Array.isArray(can?.lados) ? can.lados : [];
        if (lados.length === 1) { window.location.href = `lado.html?loc=${p.loc}&can=${p.can}&lado=${lados[0].id}`; return; }
      } catch {}
      populateLados(); return;
    }
    if (path.endsWith("lado.html")) {
      if (!(await requireClubPassword(p.loc))) { window.location.href = "index.html"; return; }
      const ok = await requireCanchaPassword(p.loc, p.can);
      if (!ok) { window.location.href = `cancha.html?loc=${p.loc}&can=${p.can}`; return; }
      // F126: expone el loader como global para que el refresh-bar pueda
      // dispararlo on-demand sin recargar la página completa.
      window.PuntazoLadoReload = populateVideos;
      populateVideos(); createScrollToTopBtn(); return;
    }
  })();

  const btnVolver = document.getElementById("btn-volver");
  if (btnVolver) {
    const p2 = getQueryParams();
    // (2026-08-23) "← Regresar" desde lado.html va SIEMPRE directo a la
    // pantalla de opciones de entrada (Ver clips / Usar botón / Más
    // herramientas) de la MISMA cancha y MISMO lado que se estaba viendo —
    // sin excepción por club. Antes Scorpion (único club multi-lado) caía a
    // cancha.html a re-elegir lado, rompiendo la regla "mismo flujo siempre
    // para todos los clubes" (club → cancha → opciones → destino, y de
    // regreso directo a opciones). "Cambiar cancha" sigue siendo el lugar
    // explícito para cambiar de cancha o lado; regresar no debe forzarlo.
    if (path.endsWith("lado.html")) {
      btnVolver.href = `entrada.html?loc=${encodeURIComponent(p2.loc)}&can=${encodeURIComponent(p2.can)}&lado=${encodeURIComponent(p2.lado)}`;
    }
    else if (path.endsWith("cancha.html")) { btnVolver.href = `locacion.html?loc=${p2.loc}`; }
    else if (path.endsWith("locacion.html")) { btnVolver.href = "explorar.html"; }
  }
});

window.addEventListener("popstate", () => {
  const p = getQueryParams();
  if ((p.filtro || null) !== ultimoFiltroActivo) { populateVideos(); }
  else {
    const totalPages = Math.max(1, paginasPorDia.length);
    let desiredPg = parseInt(p.pg || "0", 10); if (Number.isNaN(desiredPg)) desiredPg = 0;
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
  if (window.__pz_nav_click_handler) { try { document.removeEventListener("click", window.__pz_nav_click_handler); } catch {} }
  const handler = function(e) {
    const toggle = e.target?.closest?.(".menu-toggle");
    if (toggle) { if (window.innerWidth > 860) { document.querySelector(".navbar")?.classList.remove("show"); return; } e.stopPropagation(); const nav = document.querySelector(".navbar") || document.querySelector("#nav-menu"); if (nav) nav.classList.toggle("show"); return; }
    if (!e.target?.closest?.(".navbar")) { document.querySelector(".navbar")?.classList.remove("show"); document.querySelector("#nav-menu")?.classList.remove("show"); }
  };
  window.__pz_nav_click_handler = handler; document.addEventListener("click", handler);
  if (window.__pz_nav_scroll_handler) { try { window.removeEventListener("scroll", window.__pz_nav_scroll_handler); } catch {} }
  const scrollH = () => { document.querySelector(".navbar")?.classList.remove("show"); document.querySelector("#nav-menu")?.classList.remove("show"); };
  window.__pz_nav_scroll_handler = scrollH; window.addEventListener("scroll", scrollH, { passive: true });
  if (window.__pz_nav_resize_handler) { try { window.removeEventListener("resize", window.__pz_nav_resize_handler); } catch {} }
  const resizeH = () => { if (window.innerWidth > 860) { document.querySelector(".navbar")?.classList.remove("show"); document.querySelector("#nav-menu")?.classList.remove("show"); } };
  window.__pz_nav_resize_handler = resizeH; window.addEventListener("resize", resizeH);
}
window.addEventListener("puntazo:header-rendered", initNavbar);
