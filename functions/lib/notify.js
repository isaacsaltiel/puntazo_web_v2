"use strict";
/**
 * EN2a — lógica PURA (sin admin/SDK) del fan-out de notificaciones server-side.
 * Se importa desde functions/index.js y se unit-testea SIN emulador.
 *
 * Schema del notif  (notifications/{ownerUid}/items/{notifId}):
 *   { type, refId, icon, title, subtitle, href, createdAt, read:false, readAt:null }
 *
 * Idempotencia: notifId determinístico = type + "__" + refId  (un solo notif por
 * evento fuente; crear-si-ausente; borrar cuando la condición de origen deja de
 * aplicar). Los TÍTULOS/SUBTÍTULOS/ICONOS/HREF se mantienen IDÉNTICOS a los que
 * EN1 (assets/notifications.js) ya produce, para que EN2b sólo cambie la FUENTE
 * (agregación cliente → onSnapshot) sin tocar el render.
 */

const NOTIF_SEP = "__";

function notifId(type, refId) {
  return type + NOTIF_SEP + String(refId);
}

// Receptor de una solicitud de amistad = el participante que NO la mandó.
// (friendships/{fid} = { uidA, uidB, requesterUid, status, ... })
function friendReceptor(f) {
  if (!f) return null;
  if (f.requesterUid === f.uidA) return f.uidB || null;
  if (f.requesterUid === f.uidB) return f.uidA || null;
  // requesterUid no coincide con ningún participante (dato corrupto) → sin receptor.
  return null;
}

// Primer nombre (mismo criterio que EN1 firstName), con fallback "Alguien".
function firstName(n) {
  const s = String(n == null ? "" : n).trim().split(/\s+/)[0];
  return s || "Alguien";
}

// Nombre del registrante de un match (su jugador es el de uid === userId).
function registrantName(match) {
  const js = Array.isArray(match && match.jugadores) ? match.jugadores : [];
  const reg = js.find(function (j) { return j && j.uid === (match && match.userId); });
  return reg ? firstName(reg.nombre) : "Alguien";
}

// ¿El pulso está "listo"? (mismo criterio que el vigía / EN1)
function pulseIsReady(d) {
  return !!(d && d.consumed_at && !d.error_reason);
}

/**
 * Set objetivo del fan-out de match_confirm sobre playerUids.
 * Devuelve { ensure:[uids], remove:[uids] }:
 *  - status pending_confirmation: ensure = players que NO son el registrante y
 *    que NO han aceptado todavía; remove = el resto (registrante + ya-aceptados).
 *  - cualquier otro status (confirmed/disputed/void/expired): remove = TODOS.
 *    (El caso "match borrado" lo decide el trigger, que fuerza remove=TODOS.)
 */
function computeMatchTargets(match) {
  const players = Array.isArray(match && match.playerUids) ? match.playerUids.slice() : [];
  if (!match || match.status !== "pending_confirmation") {
    return { ensure: [], remove: players };
  }
  const accepted = match.scoreAcceptedBy || {};
  const ensure = [];
  const remove = [];
  players.forEach(function (uid) {
    if (uid !== match.userId && !accepted[uid]) ensure.push(uid);
    else remove.push(uid);
  });
  return { ensure: ensure, remove: remove };
}

// ── Builders de payload (sin createdAt/read/readAt — eso lo pone el trigger) ──
function friendRequestPayload(friendshipId, requesterName) {
  return {
    type: "friend_request",
    refId: friendshipId,
    icon: "🤝",
    title: "Te mandó solicitud de amistad",
    subtitle: requesterName || "Alguien",
    href: "/amigos.html",
  };
}
function matchConfirmPayload(matchId, regName) {
  return {
    type: "match_confirm",
    refId: matchId,
    icon: "🎾",
    title: "Tienes un partido por confirmar",
    subtitle: (regName || "Alguien") + " registró un partido contigo",
    href: "/confirmar.html?id=" + matchId,
  };
}
function clipReadyPayload(pulseId) {
  return {
    type: "clip_ready",
    refId: pulseId,
    icon: "🎬",
    title: "Tu puntazo ya está listo",
    subtitle: "El clip que pediste ya se procesó",
    href: "/perfil.html?pulse=" + pulseId + "#mis-puntazos",
  };
}

module.exports = {
  notifId: notifId,
  friendReceptor: friendReceptor,
  firstName: firstName,
  registrantName: registrantName,
  pulseIsReady: pulseIsReady,
  computeMatchTargets: computeMatchTargets,
  friendRequestPayload: friendRequestPayload,
  matchConfirmPayload: matchConfirmPayload,
  clipReadyPayload: clipReadyPayload,
};
