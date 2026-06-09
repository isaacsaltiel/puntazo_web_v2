/**
 * E7 — E2E del tagging server-side + LOOP (onMatchLeagueTag) contra emuladores
 * functions+firestore. Siembra una liga con 4 miembros (memberUids), un match
 * pending con 3 de ellos, lo flota a confirmed y verifica:
 *   - el trigger escribe match.leagueGroupId == la liga (≥3 miembros)
 *   - llega una notif league_rank a un jugador-miembro
 * Luego un match con SOLO 2 miembros → NO se taggea.
 *
 * Correr: firebase emulators:exec --only functions,firestore "node itest/league-tag-e2e.js"
 */
"use strict";
const assert = require("node:assert");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "puntazo-clips" });
const db = admin.firestore();
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

const GID = "liga-tag-e2e";

async function seedLeague() {
  await db.collection("groups").doc(GID).set({
    groupId: GID, name: "Liga E2E", type: "liga",
    creatorUid: "ana", admins: ["ana"], memberCount: 4,
    memberUids: ["ana", "beto", "caro", "dani"],
    inviteCode: "x", createdAt: admin.firestore.FieldValue.serverTimestamp(),
    league: { mode: "individual", sport: "padel", pointsWin: 3, pointsLoss: 0, countThreshold: 3, activeSeasonId: "s1" },
  });
  await db.collection("groups").doc(GID).collection("seasons").doc("s1").set({
    seasonId: "s1", name: "Temporada 1", startMs: 0, endMs: null, closed: false,
  });
  // members docs (para memberName en la notif)
  await Promise.all(["ana", "beto", "caro", "dani"].map(function (uid) {
    return db.collection("groups").doc(GID).collection("members").doc(uid)
      .set({ uid: uid, role: uid === "ana" ? "admin" : "member", displayName: uid.toUpperCase() });
  }));
}

async function seedMatch(id, uids, statusPending) {
  const js = [];
  js.push({ uid: uids[0], equipo: "team1", nombre: uids[0] });
  if (uids[1]) js.push({ uid: uids[1], equipo: "team1", nombre: uids[1] });
  else js.push({ equipo: "team1", nombre: "Dummy" });
  js.push({ uid: uids[2], equipo: "team2", nombre: uids[2] });
  js.push({ uid: uids[3], equipo: "team2", nombre: uids[3] });
  await db.collection("matches").doc(id).set({
    userId: uids[0], status: statusPending ? "pending_confirmation" : "confirmed",
    deporte: "padel", loc: "BreakPoint", modo: "partido_3",
    jugadores: js,
    marcador: { sets: [{ team1: 6, team2: 3 }, { team1: 6, team2: 4 }], ganador: "team1" },
    endedAt: admin.firestore.Timestamp.fromDate(new Date("2026-06-08T18:00:00Z")),
    playerUids: js.filter(function (j) { return j.uid; }).map(function (j) { return j.uid; }),
    ratingProcessed: false,
  });
}

async function pollLeagueTag(matchId, expected) {
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const m = await db.collection("matches").doc(matchId).get();
    if (m.exists && ("leagueGroupId" in (m.data() || {}))) {
      if (expected === null) {
        if (m.data().leagueGroupId === null) return null;
      } else if (m.data().leagueGroupId === expected) return expected;
    }
  }
  return undefined; // timeout
}

async function main() {
  await seedLeague();

  // (1) Match con 3 miembros (ana,caro,dani) + un dummy → debe taggear a la liga.
  const m1 = "lt-three";
  await seedMatch(m1, ["ana", null, "caro", "dani"], true); // team1: ana + dummy
  await sleep(1500);
  await db.collection("matches").doc(m1).update({ status: "confirmed", updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  const tag1 = await pollLeagueTag(m1, GID);
  assert.strictEqual(tag1, GID, "match con 3 miembros debió taggearse a la liga");

  // notif league_rank a 'ana' (jugadora-miembro). refId = GID:s1
  let gotNotif = false;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const n = await db.collection("notifications").doc("ana").collection("items").doc("league_rank__" + GID + ":s1").get();
    if (n.exists) { gotNotif = true; assert.match(n.data().subtitle || "", /pts|#/); break; }
  }
  assert.ok(gotNotif, "debió llegar notif league_rank a ana");

  // (2) Match con SOLO 2 miembros (ana,beto vs forasteros) → NO taggea.
  const m2 = "lt-two";
  await db.collection("matches").doc(m2).set({
    userId: "ana", status: "pending_confirmation", deporte: "padel", loc: "BreakPoint", modo: "partido_3",
    jugadores: [
      { uid: "ana", equipo: "team1", nombre: "ana" }, { uid: "beto", equipo: "team1", nombre: "beto" },
      { uid: "extrano1", equipo: "team2", nombre: "x1" }, { uid: "extrano2", equipo: "team2", nombre: "x2" },
    ],
    marcador: { sets: [{ team1: 6, team2: 0 }], ganador: "team1" },
    endedAt: admin.firestore.Timestamp.fromDate(new Date("2026-06-08T19:00:00Z")),
    playerUids: ["ana", "beto", "extrano1", "extrano2"], ratingProcessed: false,
  });
  await sleep(1000);
  await db.collection("matches").doc(m2).update({ status: "confirmed", updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  const tag2 = await pollLeagueTag(m2, null);
  assert.strictEqual(tag2, null, "match con 2 miembros NO debe taggearse (leagueGroupId=null)");

  console.log("LEAGUE-TAG-E2E-OK");
}
main().then(function () { process.exit(0); }).catch(function (e) { console.error("LEAGUE-TAG-E2E-FAIL:", e); process.exit(1); });
