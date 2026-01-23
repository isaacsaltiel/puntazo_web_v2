// assets/script.js

// ----------------------- utilidades -----------------------
function getQueryParams() {
  const params = {};
  window.location.search
    .substring(1)
    .split("&")
    .forEach(pair => {
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

// ----------------------- analytics helpers (SAFE) -----------------------
function trackEvent(name, params = {}) {
  try {
    if (typeof window.gtag === "function") {
      window.gtag("event", name, params);
    }
  } catch (e) {
    // si falla, NO rompe nada
  }
}

// Helper: contexto estándar para analytics (loc/can/lado)
function gaCtx(extra = {}) {
  const p = getQueryParams();
  return {
    loc: p.loc || "",
    can: p.can || "",
    lado: p.lado || "",
    filtro: p.filtro || "",
    pg: p.pg || "",
    ...extra
  };
}


// ----------------------- GATE POR CANCHA -----------------------
async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
}

async function loadPasswords() {
  try {
    const url = `data/passwords.json?cb=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP '+res.status);
    return await res.json();
  } catch (e) {
    console.warn('[gate] No se pudo cargar passwords.json:', e);
    return null;
  }
}

function findCanchaRule(pwCfg, locId, canId) {
  if (!pwCfg?.canchas?.length) return null;
  return pwCfg.canchas.find(x => x.loc === locId && x.can === canId) || null;
}

function getAuthKey(locId, canId) {
  return `gate:${locId}:${canId}`;
}

function isAuthorized(rule) {
  if (!rule) return true;
  if (!rule.enabled) return true;
  const k = getAuthKey(rule.loc || '', rule.can || '');
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (!obj?.ok || typeof obj.exp !== 'number') return false;
    return Date.now() < obj.exp;
  } catch { return false; }
}

function setAuthorized(rule) {
  const remember = (Number(rule.remember_hours) > 0 ? Number(rule.remember_hours) : 24) * 3600 * 1000;
  const exp = Date.now() + remember;
  const k = getAuthKey(rule.loc, rule.can);
  localStorage.setItem(k, JSON.stringify({ ok: true, exp }));
}

async function requireCanchaPassword(locId, canId) {
  const pwCfg = await loadPasswords();
  const rule = findCanchaRule(pwCfg, locId, canId);
  if (!rule || !rule.enabled) return true;
  if (isAuthorized(rule)) return true;

  for (let i = 0; i < 3; i++) {
    const input = window.prompt('Esta cancha requiere contraseña.');
    if (input === null) return false;
    const h = await sha256Hex(input);
    if (h === rule.sha256) {
      setAuthorized(rule);

      // [GA4] autorización exitosa
      trackEvent("gate_unlock", gaCtx({ result: "ok" }));

      return true;
    }
    alert('Contraseña incorrecta. Inténtalo de nuevo.');
  }

  // [GA4] falló gate
  trackEvent("gate_unlock", gaCtx({ result: "fail" }));

  return false;
}

/* ===================== Helpers de asociación (opuesto automático) ===================== */
function parseFromName(name) {
  const re = /^(.+?)_(.+?)_(.+?)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.mp4$/;
  const m = name.match(re);
  if (!m) return null;
  const [, loc, can, lado, Y, M, D, h, mi, s] = m;
  const tsKey = Number(`${Y}${M}${D}${h}${mi}${s}`);
  const date = new Date(Number(Y), Number(M) - 1, Number(D), Number(h), Number(mi), Number(s));
  return { loc, can, lado, date, tsKey, ymd: `${Y}${M}${D}`, Y, M, D, h, mi, s };
}
function absSeconds(a, b) { return Math.abs((a - b) / 1000); }

async function findOppositeConfig(cfg, locId, canId, ladoId) {
  const loc = cfg.locaciones.find(l => l.id === locId);
  const can = loc?.cancha.find(c => c.id === canId);
  if (!can) return null;
  const otros = (can.lados || []).filter(l => l.id !== ladoId);
  if (otros.length === 1) {
    const opp = otros[0];
    return { oppId: opp.id, oppUrl: opp.json_url, oppName: opp.nombre || opp.id };
  }
  return null;
}

async function findOppositeVideo(entry, cfg, locId, canId, ladoId) {
  const meta = parseFromName(entry.nombre);
  if (!meta) return null;

  const oppCfg = await findOppositeConfig(cfg, locId, canId, ladoId);
  if (!oppCfg || !oppCfg.oppUrl) return null;

  try {
    const res = await fetch(`${oppCfg.oppUrl}?cb=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const dataOpp = await res.json();
    const sameDay = dataOpp.videos?.filter(v => {
      const m = parseFromName(v.nombre);
      return m && m.ymd === meta.ymd;
    }) || [];

    let best = null;
    let bestDelta = Infinity;

    sameDay.forEach(v => {
      const mv = parseFromName(v.nombre);
      if (!mv) return;
      const delta = absSeconds(mv.date, meta.date);
      if (delta <= 15 && delta < bestDelta) {
        best = v;
        bestDelta = delta;
      }
    });

    return best ? { lado: oppCfg.oppId, nombre: best.nombre, url: best.url } : null;
  } catch {
    return null;
  }
}
/* =================== FIN Helpers de asociación =================== */


// ----------------------- navegación -----------------------
async function populateLocaciones() {
  try {
    const url = `data/config_locations.json?cb=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    const config = await res.json();
    const ul = document.getElementById("locaciones-lista");
    if (!ul) return;
    ul.innerHTML = "";
    config.locaciones.forEach(loc => {
      const li = document.createElement("li");
      li.classList.add("fade-in");
      li.style.marginBottom = "10px";
      const a = document.createElement("a");
      a.href = `locacion.html?loc=${loc.id}`;
      a.textContent = loc.nombre;
      a.classList.add("link-blanco");

      // [GA4] click locación
      a.addEventListener("click", () => {
        trackEvent("open_locacion", { loc: loc.id, loc_name: loc.nombre || "" });
      });

      li.appendChild(a);
      ul.appendChild(li);
    });
  } catch (err) {
    console.error("Error en populateLocaciones():", err);
  }
}

async function populateCanchas() {
  try {
    const params = getQueryParams();
    const locId = params.loc;
    const url = `data/config_locations.json?cb=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    const config = await res.json();
    const loc = config.locaciones.find(l => l.id === locId);
    const ul = document.getElementById("canchas-lista");
    if (!ul || !loc) return;
    ul.innerHTML = "";
    const nombreEl = document.getElementById("nombre-locacion");
    if (nombreEl) nombreEl.textContent = loc.nombre;

    loc.cancha.forEach(can => {
      const li = document.createElement("li");
      li.classList.add("fade-in");
      li.style.marginBottom = "10px";
      const a = document.createElement("a");

      // SALTO DE “LADOS” SI SOLO HAY UNO
      const lados = Array.isArray(can.lados) ? can.lados : [];
      if (lados.length === 1) {
        const unico = lados[0];
        a.href = `lado.html?loc=${locId}&can=${can.id}&lado=${unico.id}`;

        // [GA4] click cancha mono-lado (directo a lado)
        a.addEventListener("click", () => {
          trackEvent("open_lado", {
            loc: locId,
            can: can.id,
            lado: unico.id,
            can_name: can.nombre || "",
            via: "direct_from_locacion"
          });
        });

      } else {
        a.href = `cancha.html?loc=${locId}&can=${can.id}`;

        // [GA4] click cancha
        a.addEventListener("click", () => {
          trackEvent("open_cancha", { loc: locId, can: can.id, can_name: can.nombre || "" });
        });
      }

      a.textContent = can.nombre;
      a.classList.add("link-blanco");
      li.appendChild(a);
      ul.appendChild(li);
    });
  } catch (err) {
    console.error("Error en populateCanchas():", err);
  }
}

async function populateLados() {
  try {
    const params = getQueryParams();
    const locId = params.loc;
    const canId = params.can;
    const url = `data/config_locations.json?cb=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    const config = await res.json();
    const loc = config.locaciones.find(l => l.id === locId);
    const cancha = loc?.cancha.find(c => c.id === canId);

    // REDIRECCIÓN AUTOMÁTICA SI SOLO HAY UN LADO
    const lados = Array.isArray(cancha?.lados) ? cancha.lados : [];
    if (lados.length === 1) {
      const unico = lados[0];
      window.location.href = `lado.html?loc=${locId}&can=${canId}&lado=${unico.id}`;
      return;
    }

    const ul = document.getElementById("lados-lista");
    if (!ul || !loc || !cancha) return;
    ul.innerHTML = "";
    const linkClub = document.getElementById("link-club");
    const linkCancha = document.getElementById("link-cancha");
    if (linkClub) {
      linkClub.textContent = loc.nombre;
      linkClub.href = `locacion.html?loc=${locId}`;
    }
    if (linkCancha) {
      linkCancha.textContent = cancha.nombre;
      linkCancha.href = "#";
    }
    const sep2 = document.getElementById("breadcrumb-sep2");
    if (sep2) sep2.style.display = "none";
    const nombreLado = document.getElementById("nombre-lado");
    if (nombreLado) nombreLado.style.display = "none";

    cancha.lados.forEach(lado => {
      const li = document.createElement("li");
      li.classList.add("fade-in");
      li.style.marginBottom = "10px";
      const a = document.createElement("a");
      a.href = `lado.html?loc=${locId}&can=${canId}&lado=${lado.id}`;
      a.textContent = lado.nombre || lado.id;
      a.classList.add("link-blanco");

      // [GA4] click lado
      a.addEventListener("click", () => {
        trackEvent("open_lado", {
          loc: locId,
          can: canId,
          lado: lado.id,
          lado_name: lado.nombre || ""
        });
      });

      li.appendChild(a);
      ul.appendChild(li);
    });
  } catch (err) {
    console.error("Error en populateLados():", err);
  }
}


// ----------------------- PROMOCIONES (multi-club) -----------------------
let clubPromotions = null;
let promoConfig = null;

function deepMerge(base, override) {
  if (!override) return structuredClone(base);
  if (!base) return structuredClone(override);
  if (Array.isArray(base) && Array.isArray(override)) {
    return structuredClone(override);
  }
  if (typeof base === 'object' && typeof override === 'object') {
    const out = { ...base };
    for (const k of Object.keys(override)) {
      out[k] = deepMerge(base[k], override[k]);
    }
    return out;
  }
  return structuredClone(override);
}

function getButtonStyle(conf) {
  const b = conf?.button || {};
  return {
    bg: b.bg_color ?? conf?.bg_color ?? conf?.color ?? "#EA5B0C",
    fg: b.text_color ?? conf?.text_color ?? "#FFFFFF",
    border: b.border_color ?? conf?.border_color ?? "#FFFFFF",
    logo: b.logo ?? conf?.logo ?? null,
  };
}

function resolvePlaceholders(str, entry, extraCtx = {}) {
  if (!str) return str;
  const meta = entry?.nombre ? parseFromName(entry.nombre) : null;
  const params = getQueryParams();
  const ctx = {
    videoUrl: entry?.url || "",
    videoName: entry?.nombre || "",
    loc: params.loc || meta?.loc || "",
    can: params.can || meta?.can || "",
    lado: params.lado || meta?.lado || "",
    YYYY: meta?.Y || "",
    MM: meta?.M || "",
    DD: meta?.D || "",
    hh: meta?.h || "",
    mm: meta?.mi || "",
    ss: meta?.s || "",
    ...extraCtx
  };
  return String(str).replace(/\{(videoUrl|videoName|loc|can|lado|YYYY|MM|DD|hh|mm|ss)\}/g, (_, k) => ctx[k] ?? "");
}

function resolvePlaceholdersInArray(arr, entry, extraCtx = {}) {
  return (arr || []).map(s => resolvePlaceholders(s, entry, extraCtx));
}

async function loadClubPromotions() {
  if (clubPromotions !== null) return clubPromotions;
  try {
    const res = await fetch("data/club_promotions.json?cb=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    clubPromotions = await res.json();
    return clubPromotions;
  } catch (err) {
    console.warn("[promo] No se pudo cargar club_promotions.json", err);
    return {};
  }
}
async function loadPromotionDefinitions() {
  if (promoConfig !== null) return promoConfig;
  try {
    const res = await fetch("data/promotions_config.json?cb=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    promoConfig = await res.json();
    return promoConfig;
  } catch (err) {
    console.warn("[promo] No se pudo cargar promotions_config.json", err);
    return {};
  }
}

function stylePromoButton(el, conf) {
  const st = getButtonStyle(conf);
  el.style.display = "inline-flex";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.gap = "10px";
  el.style.padding = "12px 16px";
  el.style.border = `1px solid ${st.border}`;
  el.style.borderRadius = "10px";
  el.style.fontWeight = "700";
  el.style.textDecoration = "none";
  el.style.color = st.fg;
  el.style.background = st.bg;
  el.style.width = "100%";
  el.style.minHeight = "44px";
  el.style.boxSizing = "border-box";
  el.style.marginTop = "10px";
}

let promoModalRoot = null;

function ensurePromoModalRoot() {
  if (promoModalRoot) return promoModalRoot;

  const wrap = document.createElement("div");
  wrap.id = "promo-modal-root";
  wrap.style.position = "fixed";
  wrap.style.inset = "0";
  wrap.style.background = "rgba(0,0,0,.7)";
  wrap.style.display = "none";
  wrap.style.alignItems = "center";
  wrap.style.justifyContent = "center";
  wrap.style.zIndex = "2000";

  const box = document.createElement("div");
  box.id = "promo-modal-box";
  box.style.width = "90%";
  box.style.maxWidth = "560px";
  box.style.background = "#fff";
  box.style.color = "#000";
  box.style.border = "2px solid #333";
  box.style.borderRadius = "12px";
  box.style.padding = "20px";
  box.style.textAlign = "left";
  box.style.maxHeight = "80vh";
  box.style.overflowY = "auto";
  box.style.boxSizing = "border-box";
  wrap.appendChild(box);

  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) {
      wrap.style.display = "none";
    }
  });

  document.body.appendChild(wrap);
  promoModalRoot = wrap;
  return wrap;
}

function clearNode(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function doUrlAction(action) {
  const href = action?.href || "#";
  const target = action?.target || "_blank";
  try { window.open(href, target); } catch { location.href = href; }
}

function doCloseAction() {
  const root = ensurePromoModalRoot();
  root.style.display = "none";
}

function buildMailto(action, entry) {
  const to = action?.to || "contacto@puntazoclips.com";
  const subject = encodeURIComponent(resolvePlaceholders(action?.subject || "", entry));
  const lines = resolvePlaceholdersInArray(action?.bodyTemplate || [], entry);
  const body = encodeURIComponent(lines.join("\n"));
  return `mailto:${to}?subject=${subject}&body=${body}`;
}

async function doCopyAction(action, entry) {
  const text = resolvePlaceholders(action?.text || "", entry);
  try {
    await navigator.clipboard.writeText(text);
    toast("Copiado al portapapeles");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast("Copiado al portapapeles"); }
    catch { alert("No se pudo copiar"); }
    finally { ta.remove(); }
  }
}

let toastTimer = null;
function toast(msg) {
  let el = document.getElementById("__promo_toast__");
  if (!el) {
    el = document.createElement("div");
    el.id = "__promo_toast__";
    el.style.position = "fixed";
    el.style.left = "50%";
    el.style.bottom = "26px";
    el.style.transform = "translateX(-50%)";
    el.style.background = "rgba(0,0,0,.8)";
    el.style.color = "#fff";
    el.style.padding = "10px 14px";
    el.style.borderRadius = "8px";
    el.style.zIndex = "3000";
    el.style.fontWeight = "600";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = "none"; }, 1600);
}

function renderPromoModal(conf, entry) {
  const root = ensurePromoModalRoot();
  const box = document.getElementById("promo-modal-box");
  clearNode(box);

  const theme = conf?.modal?.theme || {};
  const borderColor = theme.border_color || "#333";
  const bgColor = theme.bg_color || "#fff";
  const fgColor = theme.text_color || "#000";

  box.style.border = `2px solid ${borderColor}`;
  box.style.background = bgColor;
  box.style.color = fgColor;

  const head = document.createElement("div");
  head.style.display = "flex";
  head.style.alignItems = "center";
  head.style.gap = "10px";
  const logos = (conf?.modal?.logos || []).slice(0,3);
  if (logos.length) {
    logos.forEach(src => {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "logo";
      img.style.height = "40px";
      img.style.width = "auto";
      img.style.objectFit = "contain";
      head.appendChild(img);
    });
  }
  const title = document.createElement("h2");
  title.textContent = conf?.modal?.title || resolvePlaceholders(conf?.label || "Promoción", entry);
  title.style.margin = "0";
  title.style.color = borderColor;
  head.appendChild(title);
  box.appendChild(head);

  const intro = conf?.modal?.intro_list || [];
  if (intro.length) {
    const desc = document.createElement("div");
    desc.style.marginTop = "10px";
    const ul = document.createElement("ul");
    ul.style.paddingLeft = "20px";
    resolvePlaceholdersInArray(intro, entry).forEach(txt => {
      const li = document.createElement("li");
      li.textContent = txt;
      ul.appendChild(li);
    });
    desc.appendChild(ul);
    box.appendChild(desc);
  }

  const req = conf?.modal?.requirements;
  if (req?.items?.length) {
    const reqTitle = document.createElement("p");
    reqTitle.style.margin = "10px 0 6px";
    reqTitle.innerHTML = `<strong>${req.title_bold || "Requisitos:"}</strong>`;
    box.appendChild(reqTitle);

    const reqUl = document.createElement("ul");
    reqUl.style.paddingLeft = "20px";
    resolvePlaceholdersInArray(req.items, entry).forEach(txt => {
      const li = document.createElement("li");
      li.textContent = txt;
      reqUl.appendChild(li);
    });
    box.appendChild(reqUl);
  }

  const btnRow = document.createElement("div");
  btnRow.style.display = "flex";
  btnRow.style.gap = "8px";
  btnRow.style.marginTop = "18px";

  const buttons = (conf?.modal?.buttons || []).slice(0,3);
  buttons.forEach(bc => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = resolvePlaceholders(bc.label || "Acción", entry);

    const s = bc.style || {};
    btn.style.flex = "1";
    btn.style.padding = "12px 16px";
    btn.style.border = `2px solid ${s.border_color || borderColor}`;
    btn.style.borderRadius = "10px";
    btn.style.background = s.bg_color || borderColor;
    btn.style.color = s.text_color || "#fff";
    btn.style.cursor = "pointer";
    btn.addEventListener("click", async () => {
      const act = bc.action || {};
      await handlePromoAction(act, entry);
    });
    btnRow.appendChild(btn);
  });

  if (!buttons.length) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Cerrar";
    btn.style.flex = "1";
    btn.style.padding = "12px 16px";
    btn.style.border = `2px solid ${borderColor}`;
    btn.style.borderRadius = "10px";
    btn.style.background = "#f5f5f5";
    btn.style.color = "#000";
    btn.style.cursor = "pointer";
    btn.addEventListener("click", doCloseAction);
    btnRow.appendChild(btn);
  }

  box.appendChild(btnRow);

  root.style.display = "flex";
}

async function handlePromoAction(action, entry) {
  const type = (action?.type || "").toLowerCase();

  // [GA4] promo action
  trackEvent("promo_action", gaCtx({
    action_type: type || "unknown",
    video_name: entry?.nombre || ""
  }));

  if (type === "url") {
    doUrlAction(action);
    return;
  }
  if (type === "mailto") {
    const href = buildMailto(action, entry);
    location.href = href;
    return;
  }
  if (type === "copy") {
    await doCopyAction(action, entry);
    return;
  }
  if (type === "close") {
    doCloseAction();
    return;
  }
  doCloseAction();
}

function openPromoModal(entry, conf) {
  if (!conf?.modal?.enabled) {
    console.warn("[promo] Intento de abrir modal con enabled=false");
    return;
  }

  // [GA4] promo modal open
  trackEvent("promo_modal_open", gaCtx({ video_name: entry?.nombre || "", promo_label: conf?.label || "" }));

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
        {
          label: "Nominar mi punto",
          style: {
            bg_color: c.border_color || "#004FC8",
            text_color: "#fff",
            border_color: c.border_color || "#004FC8"
          },
          action: {
            type: "mailto",
            to: c.mailto || "contacto@puntazoclips.com",
            subject: c.subject || "Nominar punto",
            bodyTemplate: c.bodyTemplate || []
          }
        },
        {
          label: "Cerrar",
          style: { bg_color: "#f5f5f5", text_color: "#000", border_color: "#ccc" },
          action: { type: "close" }
        }
      ];
    }
    c.modal.theme = c.modal.theme || {
      bg_color: c.bg_color || "#fff",
      text_color: c.text_color || "#000",
      border_color: c.border_color || "#004FC8"
    };
    if (!c.modal.logos && c.logo) c.modal.logos = [c.logo];
  }
  return c;
}

async function buildPromoButtonsForClub(loc, entry) {
  const clubMap = await loadClubPromotions();
  const defs = await loadPromotionDefinitions();

  let promosForLoc = clubMap?.[loc];
  if (!promosForLoc) return [];

  let promoIds = [];
  let overrides = {};

  if (Array.isArray(promosForLoc)) {
    promoIds = promosForLoc;
  } else if (typeof promosForLoc === "object" && Array.isArray(promosForLoc.promos)) {
    promoIds = promosForLoc.promos;
    overrides = promosForLoc.overrides || {};
  } else {
    return [];
  }

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

    if (actionType === "url") {
      const a = document.createElement("a");
      a.href = actionObj.href || "#";
      a.target = actionObj.target || "_blank";
      a.rel = "noopener";
      a.className = "btn-promo";
      stylePromoButton(a, merged);

      // [GA4] promo click
      a.addEventListener("click", () => {
        trackEvent("promo_click", gaCtx({
          promo_id: pid,
          promo_label: label,
          action_type: "url",
          video_name: entry?.nombre || ""
        }));
      });

      if (st.logo) {
        const img = document.createElement("img");
        img.src = st.logo;
        img.alt = pid;
        img.style.height = "20px";
        img.style.width = "auto";
        img.style.objectFit = "contain";
        a.appendChild(img);
      }
      const span = document.createElement("span");
      span.textContent = resolvePlaceholders(label, entry);
      a.appendChild(span);
      buttons.push(a);
      continue;
    }

    if (actionType === "modal") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-promo";
      stylePromoButton(btn, merged);

      // [GA4] promo click
      btn.addEventListener("click", () => {
        trackEvent("promo_click", gaCtx({
          promo_id: pid,
          promo_label: label,
          action_type: "modal",
          video_name: entry?.nombre || ""
        }));
        openPromoModal(entry, merged);
      });

      if (st.logo) {
        const img = document.createElement("img");
        img.src = st.logo;
        img.alt = pid;
        img.style.height = "20px";
        img.style.width = "auto";
        img.style.objectFit = "contain";
        btn.appendChild(img);
      }
      const span = document.createElement("span");
      span.textContent = resolvePlaceholders(label, entry);
      btn.appendChild(span);

      buttons.push(btn);
      continue;
    }

    if (!actionType && merged?.url) {
      const a = document.createElement("a");
      a.href = merged.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.className = "btn-promo";
      stylePromoButton(a, merged);

      // [GA4] promo click legacy
      a.addEventListener("click", () => {
        trackEvent("promo_click", gaCtx({
          promo_id: pid,
          promo_label: label,
          action_type: "legacy_url",
          video_name: entry?.nombre || ""
        }));
      });

      if (st.logo) {
        const img = document.createElement("img");
        img.src = st.logo;
        img.alt = pid;
        img.style.height = "20px";
        img.style.width = "auto";
        img.style.objectFit = "contain";
        a.appendChild(img);
      }
      const span = document.createElement("span");
      span.textContent = resolvePlaceholders(label, entry);
      a.appendChild(span);
      buttons.push(a);
      continue;
    }
  }

  return buttons;
}


// ----------------------- video + filtros + paginación -----------------------
let allVideos = [];
let visibilityMap = new Map();
let currentPreviewActive = null;

const PAGE_SIZE = 10;
let videosListaCompleta = [];
let paginacionHabilitada = false;
let paginaActual = 0;
let cfgGlobal = null;
let oppInfoCache = null;
let contenedorVideos = null;

let contenedorBottomControls = null;
let contFiltroArriba = null;
let contFiltroAbajo = null;
let ultimoFiltroActivo = null;

let btnOppTopEl = null;
function ensureOppositeTopButton(oppHref, oppName) {
  const btnVolver = document.getElementById("btn-volver");
  if (!btnVolver) return;

  const parent = btnVolver.parentElement || document.body;
  const csParent = window.getComputedStyle(parent);
  if (csParent.display !== "flex") {
    parent.style.display = "flex";
    parent.style.alignItems = "center";
    parent.style.gap = parent.style.gap || "8px";
    parent.style.justifyContent = parent.style.justifyContent || "space-between";
  } else if (!parent.style.justifyContent) {
    parent.style.justifyContent = "space-between";
  }

  if (!btnOppTopEl) {
    btnOppTopEl = document.createElement("a");
    btnOppTopEl.id = "btn-opposite-top";
    if (btnVolver.className) btnOppTopEl.className = btnVolver.className;
    else btnOppTopEl.className = "btn-alt";
    btnOppTopEl.textContent = "Ir al lado opuesto";
    btnOppTopEl.title = "Cambiar a la otra cámara";
    btnOppTopEl.setAttribute("aria-label", "Ir al lado opuesto");
    btnOppTopEl.style.marginLeft = "auto";
    try {
      const cs = window.getComputedStyle(btnVolver);
      btnOppTopEl.style.padding = btnOppTopEl.style.padding || cs.padding;
      btnOppTopEl.style.borderRadius = btnOppTopEl.style.borderRadius || cs.borderRadius;
      btnOppTopEl.style.fontSize = btnOppTopEl.style.fontSize || cs.fontSize;
      btnOppTopEl.style.lineHeight = btnOppTopEl.style.lineHeight || cs.lineHeight;
    } catch {}

    // [GA4] click lado opuesto (top)
    btnOppTopEl.addEventListener("click", () => {
      trackEvent("click_opposite_side", gaCtx({ position: "top" }));
    });

    parent.appendChild(btnOppTopEl);
  }

  if (oppHref) {
    btnOppTopEl.href = oppHref;
    btnOppTopEl.style.display = "";
    if (oppName) btnOppTopEl.title = `Cambiar a ${oppName}`;
  } else {
    btnOppTopEl.style.display = "none";
  }
}

function ensureBottomControlsContainer() {
  if (!contenedorBottomControls) {
    contenedorBottomControls = document.getElementById("bottom-controls");
    if (!contenedorBottomControls) {
      contenedorBottomControls = document.createElement("div");
      contenedorBottomControls.id = "bottom-controls";
      contenedorBottomControls.style.margin = "24px 0 12px 0";
      contenedorVideos.parentElement.insertBefore(contenedorBottomControls, contenedorVideos.nextSibling);
    }
  }
  let pagBottom = document.getElementById("paginator-bottom");
  if (!pagBottom) {
    pagBottom = document.createElement("div");
    pagBottom.id = "paginator-bottom";
    contenedorBottomControls.appendChild(pagBottom);
  }
  contFiltroAbajo = document.getElementById("filtro-horario-bottom");
  if (!contFiltroAbajo) {
    contFiltroAbajo = document.createElement("div");
    contFiltroAbajo.id = "filtro-horario-bottom";
    contFiltroAbajo.style.marginTop = "12px";
    contenedorBottomControls.appendChild(contFiltroAbajo);
  }
}

function renderPaginator(container, totalItems, pageIndex, pageSize, onChange, oppHref) {
  if (!container) return;
  container.innerHTML = "";

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages === 1 && !oppHref) return;

  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexWrap = "wrap";
  wrap.style.alignItems = "center";
  wrap.style.gap = "8px";

  const mkBtn = (label, disabled, handler, title) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.title = title || label;
    b.disabled = !!disabled;
    b.style.padding = "6px 10px";
    b.style.border = "none";
    b.style.borderRadius = "8px";
    b.style.cursor = disabled ? "default" : "pointer";
    b.addEventListener("click", handler);
    return b;
  };

  wrap.appendChild(mkBtn("‹ Anterior", pageIndex === 0, () => onChange(pageIndex - 1), "Página anterior"));

  const windowSize = 5;
  let start = Math.max(0, pageIndex - Math.floor(windowSize / 2));
  let end = Math.min(totalPages - 1, start + windowSize - 1);
  start = Math.max(0, Math.min(start, Math.max(0, end - windowSize + 1)));

  for (let i = start; i <= end; i++) {
    const num = document.createElement("button");
    num.textContent = String(i + 1);
    num.style.padding = "6px 10px";
    num.style.border = "none";
    num.style.borderRadius = "8px";
    num.style.cursor = i === pageIndex ? "default" : "pointer";
    if (i === pageIndex) {
      num.disabled = true;
      num.setAttribute("aria-current", "page");
      num.style.fontWeight = "700";
      num.style.outline = "1px solid rgba(255,255,255,0.3)";
    }
    num.addEventListener("click", () => onChange(i));
    wrap.appendChild(num);
  }

  wrap.appendChild(mkBtn("Siguiente ›", pageIndex >= totalPages - 1, () => onChange(pageIndex + 1), "Página siguiente"));

  const info = document.createElement("span");
  const first = totalItems === 0 ? 0 : pageIndex * pageSize + 1;
  const last = Math.min((pageIndex + 1) * pageSize, totalItems);
  const pageLabel = totalPages > 1 ? ` · Página ${pageIndex + 1}/${totalPages}` : "";
  info.textContent = `Mostrando ${first}–${last} de ${totalItems}${pageLabel}`;
  info.style.marginLeft = "auto";
  info.style.opacity = "0.85";
  wrap.appendChild(info);

  if (oppHref) {
    const opp = document.createElement("a");
    opp.textContent = "Ir al lado opuesto";
    const btnVolver = document.getElementById("btn-volver");
    if (btnVolver && btnVolver.className) {
      opp.className = btnVolver.className;
    } else {
      opp.className = "btn-alt";
    }
    opp.href = oppHref;

    // [GA4] click lado opuesto (bottom)
    opp.addEventListener("click", () => {
      trackEvent("click_opposite_side", gaCtx({ position: "bottom" }));
    });

    wrap.appendChild(opp);
  }

  container.appendChild(wrap);
}

function renderHourFilterIn(container, videos) {
  if (!container) return;
  const params = getQueryParams();
  const filtroHoraActivo = params.filtro;

  container.innerHTML = "";
  const horasSet = new Set();
  videos.forEach(v => {
    const m = v.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/);
    if (m) horasSet.add(m[1]);
  });

  [...horasSet].sort().forEach(h => {
    const btn = document.createElement("button");
    btn.textContent = `${formatAmPm(h)} - ${formatAmPm((+h + 1) % 24)}`;
    btn.className = "btn-filtro";
    if (filtroHoraActivo === h) btn.classList.add("activo");
    btn.addEventListener("click", () => {
      // [GA4] filtro por hora
      trackEvent("filter_hour", gaCtx({ hour: h }));

      setQueryParams({ filtro: h, pg: 0, video: "" });
      populateVideos();
      scrollToTop();
    });
    container.appendChild(btn);
  });

  const quitarBtn = document.createElement("button");
  quitarBtn.textContent = "Quitar filtro";
  quitarBtn.className = "btn-filtro quitar";
  if (!filtroHoraActivo) quitarBtn.style.display = "none";
  quitarBtn.addEventListener("click", () => {
    // [GA4] quitar filtro
    trackEvent("filter_remove", gaCtx({ prev_hour: filtroHoraActivo || "" }));

    setQueryParams({ filtro: "", pg: 0, video: "" });
    populateVideos();
    scrollToTop();
  });
  container.appendChild(quitarBtn);
  container.style.display = "flex";
}

function createHourFilterUI(videos) {
  const filtroDiv = document.getElementById("filtro-horario");
  contFiltroArriba = filtroDiv || null;
  renderHourFilterIn(contFiltroArriba, videos);

  ensureBottomControlsContainer();
  renderHourFilterIn(contFiltroAbajo, videos);
}

function createPreviewOverlay(videoSrc, duration, parentCard) {
  const preview = document.createElement("video");
  preview.muted = true;
  preview.playsInline = true;
  preview.preload = "none";
  preview.src = videoSrc;
  preview.className = "video-preview";
  preview.setAttribute("aria-label", "Vista previa");

  let start = duration > 15 ? duration - 15 : 0;
  const len = 5, end = start + len;

  const onLoadedMeta = () => { try { preview.currentTime = start; } catch {} };
  const onTimeUpdate = () => {
    try { if (preview.currentTime >= end) preview.currentTime = start; } catch {}
  };
  preview.addEventListener("loadedmetadata", onLoadedMeta);
  preview.addEventListener("timeupdate", onTimeUpdate);

  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      visibilityMap.set(preview, entry.intersectionRatio);
      let max = 0, winner = null;
      visibilityMap.forEach((ratio, node) => { if (ratio > max) [max, winner] = [ratio, node]; });
      if (winner === preview && entry.isIntersecting) {
        const realPlaying = parentCard.querySelector("video.real")?.paused === false;
        if (!realPlaying) {
          if (currentPreviewActive && currentPreviewActive !== preview) currentPreviewActive.pause();
          currentPreviewActive = preview;
          preview.play().catch(() => {});
        }
      } else {
        preview.pause();
      }
    });
  }, { threshold: [0.25, 0.5, 0.75] });

  io.observe(preview);
  preview._observer = io;
  preview._onLoadedMeta = onLoadedMeta;
  preview._onTimeUpdate = onTimeUpdate;

  preview.addEventListener("click", () => {
    // [GA4] click preview para reproducir real
    const id = parentCard?.id || "";
    trackEvent("click_preview_to_play", gaCtx({ video_name: id }));

    const realVideo = parentCard.querySelector("video.real");
    if (realVideo) {
      preview.style.display = "none";
      realVideo.style.display = "block";
      realVideo.currentTime = 0;
      realVideo.play();
    }
  });

  return preview;
}

function setupMutualExclusion(list) {
  list.forEach(v => v.addEventListener("play", () => {
    list.forEach(o => { if (o !== v) o.pause(); });
  }));
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
  document.querySelectorAll("video.video-preview, video.real").forEach(v => {
    try { v.pause(); } catch {}
    try { v.preload = "none"; } catch {}
  });
}


// ---------------- DESCARGA CON PROGRESO + COMPARTIR ----------------

// Convierte links de Dropbox "www.dropbox.com" a link directo apto para fetch()
// y evita parametros que causan redirects (raw=1 / dl=1).
function toDropboxDirectFetchUrl(url) {
  try {
    const u = new URL(url);

    // Si viene de www.dropbox.com, pásalo al host directo
    if (u.hostname === "www.dropbox.com") {
      u.hostname = "dl.dropboxusercontent.com";
    }

    // Quita params que meten redirects (y rompen CORS)
    u.searchParams.delete("raw");
    u.searchParams.delete("dl");

    return u.toString();
  } catch {
    return url;
  }
}

// Fallback: construye un link que fuerza descarga "normal" (sin fetch)
function toDropboxForceDownloadUrl(url) {
  try {
    const u = new URL(url);

    // Para descarga normal, lo correcto es usar www.dropbox.com con dl=1
    if (u.hostname === "dl.dropboxusercontent.com") {
      u.hostname = "www.dropbox.com";
    }

    u.searchParams.delete("raw");
    u.searchParams.set("dl", "1");

    return u.toString();
  } catch {
    return url;
  }
}

async function downloadWithProgress(url, { onStart, onProgress, onFinish, signal } = {}) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const totalHeader = res.headers.get("Content-Length") || res.headers.get("content-length");
  const total = totalHeader ? parseInt(totalHeader, 10) : 0;

  const defaultType = url.toLowerCase().endsWith(".mp4")
    ? "video/mp4"
    : (res.headers.get("Content-Type") || "application/octet-stream");

  const reader = res.body?.getReader?.();

  if (onStart) onStart({ totalKnown: !!total, totalBytes: total });

  if (!reader) {
    const blob = await res.blob();
    if (onProgress) onProgress({ percent: 100, loaded: blob.size, total: blob.size, indeterminate: !total });
    if (onFinish) onFinish();
    return new Blob([blob], { type: blob.type || defaultType });
  }

  const chunks = [];
  let received = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    chunks.push(value);
    received += value.byteLength || value.length || 0;

    if (onProgress) {
      if (total) {
        const pct = Math.max(0, Math.min(100, Math.round((received / total) * 100)));
        onProgress({ percent: pct, loaded: received, total, indeterminate: false });
      } else {
        onProgress({ percent: null, loaded: received, total: 0, indeterminate: true });
      }
    }
  }

  if (onFinish) onFinish();
  return new Blob(chunks, { type: defaultType });
}

async function crearBotonAccionCompartir(entry) {
  const btn = document.createElement("button");
  btn.className = "btn-share-large";
  btn.textContent = "Compartir | Descargar";
  btn.title = "Compartir video";
  btn.setAttribute("aria-label", "Compartir video");
  btn.dataset.state = "idle";
  btn._shareFile = null;

  const tryShareFile = async (file) => {
    try {
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "Video Puntazo",
          text: "Mira este _*PUNTAZO*_"
        });
        return true;
      }
    } catch (e) {
      throw e;
    }
    return false;
  };

  btn.addEventListener("click", async (e) => {
    e.preventDefault();

    // [GA4] click share/download
    trackEvent("click_share_download", gaCtx({ video_name: entry?.nombre || "" }));

    // Si ya está listo para compartir (porque el navegador no auto-compartió)
    if (btn.dataset.state === "ready" && btn._shareFile) {
      let okShare = false;
      try {
        okShare = await tryShareFile(btn._shareFile);
      } catch {}

      // [GA4] share success manual
      if (okShare) {
        trackEvent("share_success", gaCtx({ video_name: entry?.nombre || "", mode: "manual_ready" }));
      }

      // Si no se puede compartir, descarga el blob local
      if (!navigator.canShare?.({ files: [btn._shareFile] })) {
        // [GA4] download fallback (file)
        trackEvent("download_fallback", gaCtx({ video_name: entry?.nombre || "", mode: "local_blob" }));

        const url = URL.createObjectURL(btn._shareFile);
        const a = document.createElement("a");
        a.href = url;
        a.download = entry.nombre;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          URL.revokeObjectURL(url);
          a.remove();
        }, 800);
      }

      btn._shareFile = null;
      btn.textContent = "Compartido";
      setTimeout(() => {
        btn.textContent = "Compartir | Descargar";
        btn.dataset.state = "idle";
      }, 1200);
      return;
    }

    if (btn.dataset.state === "downloading") return;

    pauseAllVideos();

    btn.dataset.state = "downloading";
    btn.disabled = true;
    const originalContent = btn.textContent;

    // UI progreso
    btn.textContent = "";
    const wrap = document.createElement("span");
    wrap.className = "btn-progress";

    const label = document.createElement("span");
    label.className = "btn-progress__label";
    label.textContent = "Descargando…";

    const percentSpan = document.createElement("span");
    percentSpan.className = "btn-progress__percent";
    percentSpan.textContent = "0%";

    const bar = document.createElement("span");
    bar.className = "btn-progress__bar";
    const fill = document.createElement("span");
    fill.className = "btn-progress__fill";
    bar.appendChild(fill);

    const spinner = document.createElement("span");
    spinner.className = "btn-progress__spinner";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn-progress__cancel";
    cancelBtn.textContent = "Cancelar";

    wrap.appendChild(label);
    wrap.appendChild(percentSpan);
    wrap.appendChild(bar);
    wrap.appendChild(spinner);
    wrap.appendChild(cancelBtn);
    btn.appendChild(wrap);

    const controller = new AbortController();
    const { signal } = controller;

    const restoreIdle = (text = originalContent) => {
      btn.innerHTML = "";
      btn.textContent = text;
      btn.disabled = false;
      btn.dataset.state = "idle";
      btn._shareFile = null;
    };

    cancelBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      try { controller.abort(); } catch {}
      btn.innerHTML = "";
      btn.textContent = "Cancelado";
      setTimeout(() => restoreIdle(originalContent), 1200);
    });

    try {
      // ✅ AQUÍ VA LA CORRECCIÓN: usar URL directa para fetch
      const directUrl = toDropboxDirectFetchUrl(entry.url);

      const blob = await downloadWithProgress(directUrl, {
        signal,
        onStart({ totalKnown }) {
          if (!totalKnown) {
            spinner.style.display = "inline-block";
            percentSpan.textContent = "";
            fill.style.width = "0%";
            fill.style.opacity = "0.4";
          }
        },
        onProgress({ percent, indeterminate }) {
          if (indeterminate) {
            spinner.style.display = "inline-block";
            percentSpan.textContent = "";
            fill.style.width = "100%";
            fill.style.opacity = "0.4";
          } else {
            spinner.style.display = "none";
            percentSpan.textContent = `${percent}%`;
            fill.style.width = `${percent}%`;
            fill.style.opacity = "1";
          }
        },
        onFinish() {
          percentSpan.textContent = "100%";
          fill.style.width = "100%";
        }
      });

      const file = new File([blob], entry.nombre, { type: blob.type || "video/mp4" });

      let autoShared = false;
      try {
        autoShared = await tryShareFile(file);
      } catch {
        autoShared = false;
      }

      if (autoShared) {
        // [GA4] share success auto
        trackEvent("share_success", gaCtx({ video_name: entry?.nombre || "", mode: "auto_share" }));

        btn.innerHTML = "";
        btn.textContent = "Compartido";
        setTimeout(() => restoreIdle(originalContent), 1200);
      } else {
        // [GA4] share ready (user needs to tap again)
        trackEvent("share_ready", gaCtx({ video_name: entry?.nombre || "" }));

        btn._shareFile = file;
        btn.innerHTML = "";
        btn.textContent = "Listo — Tageanos @puntazoclips !";
        btn.disabled = false;
        btn.dataset.state = "ready";
      }
    } catch (err) {
      if (err?.name === "AbortError") return;

      console.warn("Descarga/compartir falló:", err);

      // ✅ FALLBACK: descarga normal (sin fetch) para que nunca muera el botón
      try {
        const fallbackUrl = toDropboxForceDownloadUrl(entry.url);

        // [GA4] download fallback (dropbox link)
        trackEvent("download_fallback", gaCtx({ video_name: entry?.nombre || "", mode: "dropbox_dl1" }));

        const a = document.createElement("a");
        a.href = fallbackUrl;
        a.download = entry.nombre; // a veces se ignora por cross-origin, pero no estorba
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 500);

        btn.innerHTML = "";
        btn.textContent = "Descargando…";
        setTimeout(() => restoreIdle(originalContent), 1200);
        return;
      } catch {}

      // Si hasta el fallback falla, mostramos error
      btn.innerHTML = "";
      btn.textContent = "Error";
      setTimeout(() => restoreIdle(originalContent), 1500);
    }
  });

  return btn;
}

function limpiarRecursosDePagina() {
  try { if (currentPreviewActive) currentPreviewActive.pause(); } catch {}
  currentPreviewActive = null;
  visibilityMap = new Map();

  if (!contenedorVideos) return;
  const cards = Array.from(contenedorVideos.children);
  cards.forEach(card => {
    const real = card.querySelector("video.real");
    const prev = card.querySelector("video.video-preview");

    [real, prev].forEach(v => {
      if (!v) return;
      try { v.pause?.(); } catch {}
      if (v === prev && v._observer) {
        try { v._observer.disconnect(); } catch {}
        v.removeEventListener?.("loadedmetadata", v._onLoadedMeta);
        v.removeEventListener?.("timeupdate", v._onTimeUpdate);
        v._observer = null;
      }
      try { v.removeAttribute("src"); v.load?.(); } catch {}
    });
  });

  contenedorVideos.innerHTML = "";
  allVideos = [];
}

async function renderPaginaActual({ fueCambioDePagina = false } = {}) {
  limpiarRecursosDePagina();

  const params = getQueryParams();
  const { loc, can, lado } = params;

  const start = paginaActual * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, videosListaCompleta.length);
  const pageSlice = videosListaCompleta.slice(start, end);

  for (const entry of pageSlice) {
    const m = entry.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/);
    let displayTime = entry.nombre.replace(".mp4", "");
    if (m) {
      const hr = parseInt(m[1],10), mn = m[2], ap = hr>=12?"PM":"AM";
      displayTime = `${hr%12||12}:${mn} ${ap}`;
    }

    const card = document.createElement("div");
    card.className = "video-card";
    card.id = entry.nombre;

    const title = document.createElement("div");
    title.className = "video-title";
    title.textContent = displayTime;
    card.appendChild(title);

    const wrap = document.createElement("div");
    wrap.style.position = "relative";
    wrap.style.width = "100%";

    const real = document.createElement("video");
    real.className = "real";
    real.controls = true;
    real.playsInline = true;
    real.preload = "metadata";
    real.src = entry.url;
    real.style.display = "none";
    real.style.width = "100%";
    real.style.borderRadius = "6px";

    // [GA4] play video (once per card)
    real.addEventListener("play", () => {
      trackEvent("play_video", gaCtx({ video_name: entry?.nombre || "" }));
    }, { once: true });

    const preview = createPreviewOverlay(entry.url, entry.duracion||60, card);

    wrap.appendChild(real);
    wrap.appendChild(preview);
    card.appendChild(wrap);

    try {
      const promoButtons = await buildPromoButtonsForClub(loc, entry);
      if (promoButtons.length) {
        const promoContainer = document.createElement("div");
        promoContainer.className = "botones-container";
        promoContainer.style.display = "flex";
        promoContainer.style.flexDirection = "column";
        promoContainer.style.gap = "8px";
        promoContainer.style.marginTop = "12px";
        promoButtons.forEach(b => promoContainer.appendChild(b));
        card.appendChild(promoContainer);
      }
    } catch (e) {
      console.warn("[promo] No se pudieron renderizar promos:", e);
    }

    const btnContainer = document.createElement("div");
    btnContainer.className = "botones-container";
    btnContainer.style.display = "flex";
    btnContainer.style.alignItems = "center";
    btnContainer.style.marginTop = "12px";

    const actionBtn = await crearBotonAccionCompartir(entry);
    actionBtn.style.removeProperty('flex');
    btnContainer.appendChild(actionBtn);

    (async () => {
      try {
        const opposite = await findOppositeVideo(entry, cfgGlobal, loc, can, lado);
        if (opposite && opposite.nombre) {
          const btnAlt = document.createElement("a");
          btnAlt.className = "btn-alt";
          btnAlt.textContent = "Ver otra perspectiva";
          btnAlt.title = "Cambiar a la otra cámara";
          btnAlt.href = `lado.html?loc=${loc}&can=${can}&lado=${opposite.lado}&video=${encodeURIComponent(opposite.nombre)}`;

          // [GA4] click otra perspectiva (per video)
          btnAlt.addEventListener("click", () => {
            trackEvent("click_other_perspective", gaCtx({
              video_name: entry?.nombre || "",
              target_lado: opposite.lado || ""
            }));
          });

          btnContainer.appendChild(btnAlt);
        }
      } catch {}
    })();

    card.appendChild(btnContainer);
    contenedorVideos.appendChild(card);
    allVideos.push(real);
  }

  setupMutualExclusion(allVideos);

  const previews = Array.from(contenedorVideos.querySelectorAll("video.video-preview"));
  loadPreviewsSequentially(previews);

  const total = videosListaCompleta.length;
  const p = getQueryParams();

  const oppHref = oppInfoCache?.oppId
    ? (() => {
        const base = `lado.html?loc=${p.loc}&can=${p.can}&lado=${oppInfoCache.oppId}`;
        const parts = [];
        if (typeof paginaActual === "number") parts.push(`pg=${paginaActual}`);
        if (p.filtro) parts.push(`filtro=${encodeURIComponent(p.filtro)}`);
        return parts.length ? `${base}&${parts.join("&")}` : base;
      })()
    : null;

  const pagBottom = document.getElementById("paginator-bottom");
  const onChange = (newPage) => {
    if (newPage < 0) newPage = 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (newPage > totalPages - 1) newPage = totalPages - 1;

    // [GA4] paginate
    trackEvent("paginate", gaCtx({
      from: paginaActual,
      to: newPage,
      total_items: total,
      page_size: PAGE_SIZE
    }));

    paginaActual = newPage;
    setQueryParams({ pg: paginaActual }, false);
    renderPaginaActual({ fueCambioDePagina: true });
    scrollToTop();
  };
  renderPaginator(pagBottom, total, paginaActual, PAGE_SIZE, onChange, oppHref);

  if (fueCambioDePagina && contenedorVideos.firstElementChild) {
    contenedorVideos.firstElementChild.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function populateVideos() {
  const params = getQueryParams();
  const { loc, can, lado, filtro, video: targetId } = params;
  const urlCfg = `data/config_locations.json?cb=${Date.now()}`;

  try {
    const resCfg = await fetch(urlCfg, { cache: "no-store" });
    cfgGlobal = await resCfg.json();

    const locObj = cfgGlobal.locaciones.find(l => l.id === loc);
    const canObj = locObj?.cancha.find(c => c.id === can);
    const ladoObj = canObj?.lados.find(l => l.id === lado);
    contenedorVideos = document.getElementById("videos-container");
    const loading = document.getElementById("loading");
    if (!ladoObj?.json_url || !contenedorVideos) {
      if (contenedorVideos) contenedorVideos.innerHTML = "<p style='color:#fff;'>Lado no encontrado.</p>";
      return;
    }

    // [GA4] view side (entrada a página de videos)
    trackEvent("view_side", gaCtx({
      loc: loc,
      can: can,
      lado: lado,
      filtro: filtro || "",
      has_target_video: !!targetId
    }));

    const res = await fetch(`${ladoObj.json_url}?cb=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("No se pudo acceder al JSON.");
    const data = await res.json();
    if (loading) loading.style.display = "block";
    contenedorVideos.innerHTML = "";

    const linkClub = document.getElementById("link-club");
    const linkCancha = document.getElementById("link-cancha");
    const nombreLado = document.getElementById("nombre-lado");
    if (linkClub) { linkClub.textContent = locObj?.nombre || loc; linkClub.href = `locacion.html?loc=${loc}`; }
    if (linkCancha) { linkCancha.textContent = canObj?.nombre || can; linkCancha.href = `cancha.html?loc=${loc}&can=${can}`; }
    if (nombreLado) { nombreLado.textContent = ladoObj?.nombre || lado; }

    oppInfoCache = await findOppositeConfig(cfgGlobal, loc, can, lado);
    const oppTopHref = oppInfoCache?.oppId
      ? (() => {
          const base = `lado.html?loc=${loc}&can=${can}&lado=${oppInfoCache.oppId}`;
          const parts = [];
          if (params.pg !== undefined) parts.push(`pg=${encodeURIComponent(params.pg)}`);
          if (params.filtro) parts.push(`filtro=${encodeURIComponent(params.filtro)}`);
          return parts.length ? `${base}&${parts.join("&")}` : base;
        })()
      : null;
    ensureOppositeTopButton(oppTopHref, oppInfoCache?.oppName);

    createHourFilterUI(data.videos);

    let list = data.videos || [];
    if (filtro) {
      list = list.filter(v => {
        const m = v.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/);
        return m && m[1] === filtro;
      });
    }

    list.sort((a, b) => {
      const pa = parseFromName(a.nombre);
      const pb = parseFromName(b.nombre);
      const ta = pa ? pa.tsKey : -Infinity;
      const tb = pb ? pb.tsKey : -Infinity;
      return tb - ta;
    });

    ultimoFiltroActivo = filtro || null;
    videosListaCompleta = list;
    paginacionHabilitada = videosListaCompleta.length > 7;

    ensureBottomControlsContainer();

    const totalPages = Math.max(1, Math.ceil(videosListaCompleta.length / PAGE_SIZE));
    let desiredPg = parseInt(params.pg || "0", 10);
    if (Number.isNaN(desiredPg)) desiredPg = 0;

    if (targetId) {
      const idx = videosListaCompleta.findIndex(v => v.nombre === targetId);
      if (idx >= 0 && paginacionHabilitada) desiredPg = Math.floor(idx / PAGE_SIZE);
    }

    paginaActual = Math.min(Math.max(0, desiredPg), totalPages - 1);
    setQueryParams({ pg: paginaActual }, !("pg" in params));

    await renderPaginaActual({ fueCambioDePagina: false });

    if (loading) loading.style.display = "none";

    if (targetId) scrollToVideoById(targetId);
  } catch (err) {
    console.error("Error en populateVideos():", err);
    const vc = document.getElementById("videos-container");
    if (vc) vc.innerHTML = "<p style='color:#fff;'>No hay videos disponibles.</p>";
    const loading = document.getElementById("loading");
    if (loading) loading.style.display = "none";
  }
}


// ----------------------- scroll-top -----------------------
function createScrollToTopBtn() {
  const btn = document.createElement("button");
  btn.textContent = "↑";
  btn.className = "scroll-top";
  btn.style.display = "none";
  btn.setAttribute("aria-label", "Ir arriba");
  btn.addEventListener("click", () => {
    // [GA4] scroll to top
    trackEvent("scroll_to_top", gaCtx({}));
    scrollToTop();
  });
  document.body.appendChild(btn);

  let lastY = window.scrollY;
  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    if (y > 100 && y < lastY && allVideos.length > 3) btn.style.display = "block";
    else btn.style.display = "none";
    lastY = y;
  });
}

// ---------- Helper: detectar si una cancha es “mono-lado” ----------
async function isSingleLado(locId, canId) {
  try {
    let cfg = cfgGlobal;
    if (!cfg) {
      const res = await fetch(`data/config_locations.json?cb=${Date.now()}`, { cache: "no-store" });
      cfg = await res.json();
    }
    const loc = cfg?.locaciones?.find(l => l.id === locId);
    const can = loc?.cancha?.find(c => c.id === canId);
    return Array.isArray(can?.lados) && can.lados.length === 1;
  } catch {
    return false;
  }
}


// ----------------------- arranque -----------------------
document.addEventListener("DOMContentLoaded", () => {
  const path = window.location.pathname;
  const p = getQueryParams();

  (async () => {
    if (path.endsWith("index.html") || path.endsWith("/")) {
      populateLocaciones();
      return;
    }

    if (path.endsWith("locacion.html")) {
      populateCanchas();
      return;
    }

    if (path.endsWith("cancha.html")) {
      const ok = await requireCanchaPassword(p.loc, p.can);
      if (!ok) {
        window.location.href = `locacion.html?loc=${p.loc}`;
        return;
      }
      // Si la cancha solo tiene un lado, redirigimos directo al lado
      try {
        const res = await fetch(`data/config_locations.json?cb=${Date.now()}`, { cache: "no-store" });
        const cfg = await res.json();
        const loc = cfg.locaciones.find(l => l.id === p.loc);
        const can = loc?.cancha.find(c => c.id === p.can);
        const lados = Array.isArray(can?.lados) ? can.lados : [];
        if (lados.length === 1) {
          const unico = lados[0];
          window.location.href = `lado.html?loc=${p.loc}&can=${p.can}&lado=${unico.id}`;
          return;
        }
      } catch {}
      populateLados();
      return;
    }

    if (path.endsWith("lado.html")) {
      const ok = await requireCanchaPassword(p.loc, p.can);
      if (!ok) {
        window.location.href = `cancha.html?loc=${p.loc}&can=${p.can}`;
        return;
      }
      populateVideos();
      createScrollToTopBtn();
      return;
    }
  })();

  // href del botón "Regresar a la cancha" con salto si es mono-lado
  const btnVolver = document.getElementById("btn-volver");
  if (btnVolver) {
    (async () => {
      const path2 = window.location.pathname;
      const p2 = getQueryParams();
      if (path2.endsWith("lado.html")) {
        const mono = await isSingleLado(p2.loc, p2.can);
        btnVolver.href = mono
          ? `locacion.html?loc=${p2.loc}`          // salto al menú de canchas (no al de lados)
          : `cancha.html?loc=${p2.loc}&can=${p2.can}`;
      } else if (path2.endsWith("cancha.html")) {
        btnVolver.href = `locacion.html?loc=${p2.loc}`;
      } else if (path2.endsWith("locacion.html")) {
        btnVolver.href = "index.html";
      }
    })();
  }
});

window.addEventListener("popstate", () => {
  const p = getQueryParams();
  const newFilter = p.filtro || null;
  if (newFilter !== ultimoFiltroActivo) {
    populateVideos();
  } else {
    const totalPages = Math.max(1, Math.ceil(videosListaCompleta.length / PAGE_SIZE));
    let desiredPg = parseInt(p.pg || "0", 10);
    if (Number.isNaN(desiredPg)) desiredPg = 0;
    paginaActual = Math.min(Math.max(0, desiredPg), totalPages - 1);
    renderPaginaActual({ fueCambioDePagina: true });

    if (cfgGlobal && p.loc && p.can && p.lado) {
      findOppositeConfig(cfgGlobal, p.loc, p.can, p.lado).then(info => {
        const base = info?.oppId
          ? `lado.html?loc=${p.loc}&can=${p.can}&lado=${info.oppId}`
          : null;
        const parts = [];
        if (p.pg !== undefined) parts.push(`pg=${encodeURIComponent(p.pg)}`);
        if (p.filtro) parts.push(`filtro=${encodeURIComponent(p.filtro)}`);
        const oppTopHref = base ? (parts.length ? `${base}&${parts.join("&")}` : base) : null;
        ensureOppositeTopButton(oppTopHref, info?.oppName);
      }).catch(() => {});
    }
  }
});


// Cierra navbar al scrollear o click fuera
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.navbar');

  if (btn && nav) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      nav.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
      if (nav.classList.contains('show') && !nav.contains(e.target) && e.target !== btn) {
        nav.classList.remove('show');
      }
    });

    window.addEventListener('scroll', () => {
      if (nav.classList.contains('show')) nav.classList.remove('show');
    });
  }
});

// === NAVBAR: toggle + cerrar al scroll o click fuera ===
function initNavbar(){
  const btn = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.navbar');
  if (!btn || !nav) return;

  const close = () => nav.classList.remove('show');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    nav.classList.toggle('show');
  });

  document.addEventListener('click', (e) => {
    if (nav.classList.contains('show') && !nav.contains(e.target) && e.target !== btn) {
      close();
    }
  });

  window.addEventListener('scroll', close);
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) close();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
});
/* ==========================================================
   RECUPERAR PUNTAZO (Google Forms) - Banner arriba de la página
   PÉGALO AL FINAL COMPLETO DE assets/script.js
   ========================================================== */
(() => {
  const RECOVERY_FORM_URL =
    "https://docs.google.com/forms/d/e/1FAIpQLSfdPf8qcP1N7R13ef9P1mb2eZVcFnTeDZtHsKNoh6fAN4TDvQ/viewform?usp=send_form";

  // WhatsApp (footer / soporte)
  const WHATSAPP_NUMBER = "5212206804856"; // +52 1 220 680 4856
  const WHATSAPP_TEXT =
    "Hola Puntazo 👋\nQuiero recuperar un puntazo que no se registró.\n\n📅 Día:\n📍 Club:\n🎾 Cancha:\n🕒 Hora exacta (o rango):\n\nGracias!";

  function injectRecoveryStyles() {
    if (document.getElementById("puntazo-recovery-styles")) return;

    const style = document.createElement("style");
    style.id = "puntazo-recovery-styles";
    style.textContent = `
      /* ===== Banner Recuperación ===== */
      #puntazo-recovery-banner {
        width: min(1100px, calc(100% - 24px));
        margin: 14px auto 10px auto;
        padding: 14px 14px;
        border-radius: 16px;
        border: 1px solid rgba(0,0,0,0.08);
        background: linear-gradient(135deg, rgba(255, 247, 237, 0.95), rgba(239, 246, 255, 0.95));
        box-shadow: 0 10px 22px rgba(0,0,0,0.06);
        display: flex;
        gap: 14px;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        position: relative;
        overflow: hidden;
        animation: puntazoFadeIn 320ms ease-out;
      }

      #puntazo-recovery-banner::before {
        content: "";
        position: absolute;
        inset: 0;
        background: radial-gradient(circle at 10% 20%, rgba(251, 146, 60, 0.12), transparent 60%),
                    radial-gradient(circle at 90% 0%, rgba(59, 130, 246, 0.12), transparent 55%);
        pointer-events: none;
      }

      .puntazo-recovery-left {
        display: flex;
        gap: 12px;
        align-items: flex-start;
        min-width: 260px;
        flex: 1;
        z-index: 1;
      }

      .puntazo-recovery-icon {
        width: 42px;
        height: 42px;
        border-radius: 12px;
        display: grid;
        place-items: center;
        background: rgba(255,255,255,0.7);
        border: 1px solid rgba(0,0,0,0.06);
        font-size: 22px;
        flex: 0 0 auto;
      }

      .puntazo-recovery-texts {
        display: grid;
        gap: 3px;
      }

      .puntazo-recovery-kicker {
        font-size: 12px;
        opacity: 0.8;
        font-weight: 600;
        letter-spacing: 0.2px;
      }

      .puntazo-recovery-title {
        font-size: 16px;
        font-weight: 800;
        line-height: 1.15;
      }

      .puntazo-recovery-sub {
        font-size: 13px;
        opacity: 0.85;
        line-height: 1.25;
      }

      .puntazo-recovery-actions {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
        z-index: 1;
      }

      .puntazo-recovery-btn {
        border: 0;
        cursor: pointer;
        padding: 10px 12px;
        border-radius: 12px;
        font-weight: 800;
        font-size: 13px;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        white-space: nowrap;
        user-select: none;
        transform: translateY(0px);
        transition: transform 120ms ease, filter 120ms ease, opacity 120ms ease;
      }

      .puntazo-recovery-btn:hover {
        transform: translateY(-1px);
        filter: brightness(1.02);
      }

      .puntazo-recovery-btn:active {
        transform: translateY(0px);
        opacity: 0.95;
      }

      .puntazo-recovery-btn.primary {
        background: rgba(17, 24, 39, 0.92);
        color: white;
      }

      .puntazo-recovery-btn.secondary {
        background: rgba(255,255,255,0.75);
        color: rgba(17, 24, 39, 0.95);
        border: 1px solid rgba(0,0,0,0.10);
      }

      .puntazo-recovery-mini {
        font-size: 11px;
        opacity: 0.8;
        margin-top: 3px;
      }

      @keyframes puntazoFadeIn {
        from { opacity: 0; transform: translateY(-6px); }
        to   { opacity: 1; transform: translateY(0px); }
      }

      @media (max-width: 520px) {
        #puntazo-recovery-banner {
          padding: 12px;
        }
        .puntazo-recovery-title {
          font-size: 15px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function buildWhatsAppURL() {
    const text = encodeURIComponent(WHATSAPP_TEXT);
    return `https://wa.me/${WHATSAPP_NUMBER}?text=${text}`;
  }

  function injectRecoveryBanner() {
    // Evita duplicados
    if (document.getElementById("puntazo-recovery-banner")) return;

    const banner = document.createElement("section");
    banner.id = "puntazo-recovery-banner";
    banner.innerHTML = `
      <div class="puntazo-recovery-left">
        <div class="puntazo-recovery-icon">🕵️‍♂️</div>
        <div class="puntazo-recovery-texts">
          <div class="puntazo-recovery-kicker">¿Se te perdió un puntazo?</div>
          <div class="puntazo-recovery-title">Recupéralo en 30 segundos</div>
          <div class="puntazo-recovery-sub">
            Llena el formulario con <b>día, club, cancha y hora</b> y lo buscamos por ti.
            <div class="puntazo-recovery-mini">Tip: si no sabes la hora exacta, pon un rango aproximado.</div>
          </div>
        </div>
      </div>

      <div class="puntazo-recovery-actions">
        <a class="puntazo-recovery-btn primary" id="puntazo-recover-form"
           href="${RECOVERY_FORM_URL}" target="_blank" rel="noopener">
          📋 Recuperar mi puntazo
        </a>

        <a class="puntazo-recovery-btn secondary" id="puntazo-recover-wa"
           href="${buildWhatsAppURL()}" target="_blank" rel="noopener"
           title="Si de plano urge o tienes duda rápida, aquí está WhatsApp">
          💬 WhatsApp
        </a>
      </div>
    `;

    // Dónde lo metemos (lo más arriba posible sin romper nada)
    const header =
      document.querySelector("header") ||
      document.querySelector("#topbar") ||
      document.querySelector(".topbar");

    const filters =
      document.querySelector("#filters") ||
      document.querySelector(".filters") ||
      document.querySelector("#controls") ||
      document.querySelector(".controls");

    // Preferencia: después del header si existe, si no antes de filtros, si no al inicio del body
    if (header && header.parentNode) {
      header.insertAdjacentElement("afterend", banner);
      return;
    }
    if (filters && filters.parentNode) {
      filters.parentNode.insertBefore(banner, filters);
      return;
    }

    document.body.insertBefore(banner, document.body.firstChild);
  }

  // Corre cuando el DOM esté listo
  window.addEventListener("DOMContentLoaded", () => {
    injectRecoveryStyles();
    injectRecoveryBanner();
  });
})();

