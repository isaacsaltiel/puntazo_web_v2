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

// ── E7 · EL LOOP ─────────────────────────────────────────────────────────────
// Subtítulo de movimiento de liga: "Ganaste 3 pts. Subiste al #2 de {liga}, a 1
// victoria del líder Ana." (rivalidad concreta: nombra al rival inmediato arriba).
// `info` = { leagueName, rank, ptsGained, rivalName, gap } (gap = pts para alcanzar
// al de arriba; null si ya eres #1). Cero mojibake.
function leagueRankSubtitle(info) {
  info = info || {};
  const name = info.leagueName || "tu liga";
  const rank = Number.isFinite(info.rank) ? info.rank : null;
  const gained = Number.isFinite(info.ptsGained) ? info.ptsGained : 0;
  let s = (gained > 0 ? ("Ganaste " + gained + " pts. ") : "");
  if (rank === 1) {
    s += "Eres #1 de " + name + ". ¡A defenderlo!";
  } else if (rank != null) {
    s += "Vas #" + rank + " de " + name;
    if (info.rivalName && Number.isFinite(info.gap) && info.gap > 0) {
      s += ", a " + info.gap + " pts de " + info.rivalName + ".";
    } else {
      s += ".";
    }
  } else {
    s += "Tu posición en " + name + " se actualizó.";
  }
  return s;
}

// refId del league_rank: por liga+temporada (un solo notif vivo por liga; el nuevo
// movimiento PISA al anterior — el trigger borra+recrea para refrescar el subtítulo).
function leagueRankRefId(groupId, seasonId) {
  return String(groupId) + ":" + String(seasonId || "active");
}

function leagueRankPayload(groupId, seasonId, info) {
  return {
    type: "league_rank",
    refId: leagueRankRefId(groupId, seasonId),
    icon: "📊",
    title: "Te moviste en " + ((info && info.leagueName) || "tu liga"),
    subtitle: leagueRankSubtitle(info),
    href: "/liga.html?id=" + groupId,
  };
}

// Resumen semanal (onSchedule, domingo PM). refId por liga+semana (idempotente/sem).
function leagueWeeklyRefId(groupId, weekKey) {
  return String(groupId) + ":" + String(weekKey);
}
function leagueWeeklyPayload(groupId, weekKey, info) {
  info = info || {};
  const name = info.leagueName || "tu liga";
  let sub;
  if (Number.isFinite(info.rank) && info.rank === 1) {
    sub = "Cierras la semana como líder de " + name + ". Próximo rival: " + (info.chaserName || "el grupo") + ".";
  } else if (Number.isFinite(info.rank)) {
    sub = "Vas #" + info.rank + " en " + name +
          (info.leaderName ? (". Líder: " + info.leaderName) : "") +
          (info.nextName && Number.isFinite(info.gap) ? (". A " + info.gap + " pts de " + info.nextName + ".") : ".");
  } else {
    sub = "Resumen semanal de " + name + ".";
  }
  return {
    type: "league_weekly",
    refId: leagueWeeklyRefId(groupId, weekKey),
    icon: "🗓️",
    title: "Resumen de la semana · " + name,
    subtitle: sub,
    href: "/liga.html?id=" + groupId,
  };
}

// Campeón de temporada (notif a TODOS los miembros). refId por liga+temporada.
function seasonChampionRefId(groupId, seasonId) {
  return String(groupId) + ":" + String(seasonId);
}
function seasonChampionPayload(groupId, seasonId, info) {
  info = info || {};
  const name = info.leagueName || "tu liga";
  const champ = info.championName || "El campeón";
  const seasonName = info.seasonName || "la temporada";
  const youWon = !!info.youAreChampion;
  return {
    type: "season_champion",
    refId: seasonChampionRefId(groupId, seasonId),
    icon: "🏆",
    title: youWon ? ("¡Ganaste " + seasonName + "!") : ("Campeón de " + name),
    subtitle: youWon
      ? ("Te coronaste campeón de " + seasonName + " en " + name + ". ¡Felicidades!")
      : (champ + " ganó " + seasonName + " de " + name + "."),
    href: "/liga.html?id=" + groupId,
  };
}

// ── G1-B · cerrar el loop del invitado ───────────────────────────────────────
// Detecta slots que pasaron de INVITADO (guestId, sin uid) a RECLAMADO (con uid),
// comparando before/after por índice (el claim agrega uid in-place conservando el
// guestId). Devuelve [{ guestId, ownerUid, claimerUid, claimerName }]. PURA.
// Ignora el caso dueño-se-reclama-a-sí-mismo y slots sin dueño.
function detectGuestClaims(before, after) {
  const out = [];
  if (!before || !after) return out;
  const bj = Array.isArray(before.jugadores) ? before.jugadores : [];
  const aj = Array.isArray(after.jugadores) ? after.jugadores : [];
  aj.forEach(function (ja, i) {
    if (!ja || !ja.uid || !ja.guestId) return;            // ahora con uid y conserva guestId
    const jb = bj[i];
    if (!jb || jb.guestId !== ja.guestId || jb.uid) return; // antes: mismo guest, SIN uid
    const ownerUid = ja.ownerUid || jb.ownerUid || (after.userId || null);
    if (!ownerUid || ownerUid === ja.uid) return;          // sin dueño o auto-reclamo
    out.push({ guestId: ja.guestId, ownerUid: ownerUid, claimerUid: ja.uid, claimerName: firstName(ja.nombre) });
  });
  return out;
}

function guestClaimedPayload(guestId, claimerName) {
  return {
    type: "guest_claimed",
    refId: guestId,
    icon: "🎉",
    title: "Tu invitado se unió a Puntazo",
    subtitle: (claimerName || "Alguien") + " reclamó su lugar y ya tiene cuenta",
    href: "/amigos.html#invitados",
  };
}

module.exports = {
  notifId: notifId,
  detectGuestClaims: detectGuestClaims,
  guestClaimedPayload: guestClaimedPayload,
  friendReceptor: friendReceptor,
  firstName: firstName,
  registrantName: registrantName,
  pulseIsReady: pulseIsReady,
  computeMatchTargets: computeMatchTargets,
  friendRequestPayload: friendRequestPayload,
  matchConfirmPayload: matchConfirmPayload,
  clipReadyPayload: clipReadyPayload,
  // E7 · EL LOOP
  leagueRankSubtitle: leagueRankSubtitle,
  leagueRankRefId: leagueRankRefId,
  leagueRankPayload: leagueRankPayload,
  leagueWeeklyRefId: leagueWeeklyRefId,
  leagueWeeklyPayload: leagueWeeklyPayload,
  seasonChampionRefId: seasonChampionRefId,
  seasonChampionPayload: seasonChampionPayload,
};
