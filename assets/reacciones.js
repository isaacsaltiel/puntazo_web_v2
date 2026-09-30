/* ============================================================================
 * assets/reacciones.js — "Me gusta" y conteo de guardados por clip (2026-09-30)
 *
 * Isaac: botón de me gusta con su conteo, y conteo de guardados; más adelante
 * un feed de "virales" con los que más tengan.
 *
 * Firestore (reglas en firestore.rules):
 *   clip_likes/{nombre.mp4}/likers/{uid}   { uid, at }   ← el me gusta de cada quien
 *   clip_stats/{nombre.mp4}                { likes, guardados }   ← contadores públicos
 * El contador solo sube o baja de 1 en 1 y SOLO en el mismo lote en que se
 * crea / borra el me gusta (o el guardado en usuarios/{uid}/guardados), así
 * que nadie puede inflarlo. El id es el nombre del archivo: el vertical y el
 * horizontal del mismo clip comparten conteo.
 *
 * API (window.PuntazoReacciones):
 *   stats(nombre)            → Promise<{likes, guardados}>
 *   meGusta(nombre)          → Promise<bool>  (false sin sesión)
 *   alternarLike(nombre)     → Promise<{liked, likes}>  (pide sesión antes: usar pedirLike)
 *   pedirLike(nombre, cb)    → pide sesión si hace falta y alterna
 *   guardar(ref, data, nombre)  / quitarGuardado(ref, nombre)
 *        → como ref.set(data,{merge}) / ref.delete(), pero además cuentan.
 *   crearPillLike(nombre)    → botón corazón + número para las tarjetas.
 *   Evento window "pz:reaccion" {nombre, likes, guardados, liked}.
 * ========================================================================== */
(function () {
  "use strict";
  if (window.PuntazoReacciones) return;

  var COPY_LIKE = { title: "Dale me gusta a los mejores puntos.", text: "Inicia sesión y ayuda a que los mejores puntos del club lleguen a más gente.", cta: "Continuar con Google" };
  var cacheStats = {};   // nombre -> Promise<{likes, guardados}>
  var cacheLike = {};    // uid|nombre -> bool
  var ocupado = {};

  function db() { try { return window.PuntazoFirebase.db(); } catch (_) { return null; } }
  function usuario() { try { return (window.PuntazoAuth && PuntazoAuth.currentUser) || null; } catch (_) { return null; } }
  function FV() { return firebase.firestore.FieldValue; }
  function limpio(nombre) { nombre = String(nombre || ""); return nombre && nombre.indexOf("/") < 0 ? nombre : ""; }
  function num(v) { v = Number(v); return isFinite(v) && v > 0 ? Math.round(v) : 0; }
  function tope(pr, ms) { return Promise.race([pr, new Promise(function (_, rej) { setTimeout(function () { rej(new Error("timeout")); }, ms); })]); }

  function refStats(n) { return db().collection("clip_stats").doc(n); }
  function refLike(n, uid) { return db().collection("clip_likes").doc(n).collection("likers").doc(uid); }

  function avisar(n, extra) {
    cacheStats[n] = (cacheStats[n] || Promise.resolve({ likes: 0, guardados: 0 })).then(function (s) {
      var o = { likes: s.likes, guardados: s.guardados };
      if (extra.dLikes) o.likes = Math.max(0, o.likes + extra.dLikes);
      if (extra.dGuardados) o.guardados = Math.max(0, o.guardados + extra.dGuardados);
      try {
        window.dispatchEvent(new CustomEvent("pz:reaccion", { detail: { nombre: n, likes: o.likes, guardados: o.guardados, liked: extra.liked } }));
      } catch (_) {}
      return o;
    });
    return cacheStats[n];
  }

  function stats(nombre) {
    var n = limpio(nombre);
    if (!n || !db()) return Promise.resolve({ likes: 0, guardados: 0 });
    if (!cacheStats[n]) {
      cacheStats[n] = tope(refStats(n).get(), 8000).then(function (d) {
        var x = (d.exists && d.data()) || {};
        return { likes: num(x.likes), guardados: num(x.guardados) };
      }).catch(function () { delete cacheStats[n]; return { likes: 0, guardados: 0 }; });
    }
    return cacheStats[n];
  }

  function meGusta(nombre) {
    var n = limpio(nombre), u = usuario();
    if (!n || !u || !db()) return Promise.resolve(false);
    var k = u.uid + "|" + n;
    if (k in cacheLike) return Promise.resolve(cacheLike[k]);
    return tope(refLike(n, u.uid).get(), 8000).then(function (d) { cacheLike[k] = d.exists; return d.exists; })
      .catch(function () { return false; });
  }

  // soloDar: tras iniciar sesión, si ya le había dado me gusta (en otro
  // dispositivo) no se lo quita.
  async function alternarLike(nombre, soloDar) {
    var n = limpio(nombre), u = usuario(), d = db();
    if (!n || !u || !d) throw new Error("sin sesión");
    var k = u.uid + "|" + n;
    if (ocupado[k]) return ocupado[k];
    ocupado[k] = (async function () {
      var ya = await meGusta(n);
      await stats(n);   // base del conteo antes de sumar
      if (ya && soloDar) { var s0 = await stats(n); return { liked: true, likes: s0.likes }; }
      var b = d.batch(), r = refLike(n, u.uid);
      if (ya) {
        b.delete(r);
        b.set(refStats(n), { likes: FV().increment(-1) }, { merge: true });
      } else {
        b.set(r, { uid: u.uid, at: FV().serverTimestamp() });
        b.set(refStats(n), { likes: FV().increment(1) }, { merge: true });
      }
      await tope(b.commit(), 10000);
      cacheLike[k] = !ya;
      var s = await avisar(n, { dLikes: ya ? -1 : 1, liked: !ya });
      try { window.gtag && gtag("event", ya ? "quitar_like" : "like", { video_name: n }); } catch (_) {}
      return { liked: !ya, likes: s.likes };
    })();
    try { return await ocupado[k]; } finally { delete ocupado[k]; }
  }

  // Pide sesión (promueve cuentas) y alterna. cb(err, {liked, likes}).
  function pedirLike(nombre, cb) {
    cb = cb || function () {};
    var hacer = function (soloDar) { alternarLike(nombre, soloDar).then(function (r) { cb(null, r); }, function (e) { cb(e); }); };
    if (usuario()) return hacer(false);
    if (window.PuntazoAuth && PuntazoAuth.requireAuth) PuntazoAuth.requireAuth(function () { hacer(true); }, COPY_LIKE);
    else cb(new Error("sin auth"));
  }

  // Guardar / quitar contando. Si el contador no se puede mover (ya estaba
  // guardado, reglas viejas en caché…), se guarda igual sin contar.
  async function guardar(ref, data, nombre) {
    var n = limpio(nombre), d = db();
    if (!n || !d) return ref.set(data, { merge: true });
    try {
      var b = d.batch();
      b.set(ref, data, { merge: true });
      b.set(refStats(n), { guardados: FV().increment(1) }, { merge: true });
      await b.commit();
      avisar(n, { dGuardados: 1 });
    } catch (e) {
      await ref.set(data, { merge: true });
    }
  }
  async function quitarGuardado(ref, nombre) {
    var n = limpio(nombre), d = db();
    if (!n || !d) return ref.delete();
    try {
      var b = d.batch();
      b.delete(ref);
      b.set(refStats(n), { guardados: FV().increment(-1) }, { merge: true });
      await b.commit();
      avisar(n, { dGuardados: -1 });
    } catch (e) {
      await ref.delete();
    }
  }

  function corto(v) {
    v = num(v);
    if (v < 1000) return String(v);
    if (v < 10000) return (Math.floor(v / 100) / 10).toString().replace(/\.0$/, "") + " mil";
    return Math.floor(v / 1000) + " mil";
  }

  // ── Pill para las tarjetas horizontales (script.js / card.js) ──
  function crearPillLike(nombre) {
    var n = limpio(nombre);
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "action-pill pz-like";
    btn.dataset.ico = "heart";
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-label", "Me gusta");
    btn.title = "Me gusta";
    var cnt = document.createElement("span");
    cnt.className = "pz-like-n";
    btn.appendChild(cnt);
    function pintar(liked, likes) {
      if (liked !== undefined) {
        btn.classList.toggle("is-liked", !!liked);
        btn.setAttribute("aria-pressed", liked ? "true" : "false");
        btn.setAttribute("aria-label", liked ? "Quitar me gusta" : "Me gusta");
      }
      if (likes !== undefined) { cnt.textContent = likes > 0 ? corto(likes) : ""; btn.classList.toggle("has-n", likes > 0); }
    }
    function sync() {
      stats(n).then(function (s) { pintar(undefined, s.likes); });
      meGusta(n).then(function (l) { pintar(l); });
    }
    btn.addEventListener("click", function (e) {
      if (e.detail) btn.blur();
      if (btn.classList.contains("is-busy")) return;
      btn.classList.add("is-busy");
      pedirLike(n, function (err, r) {
        btn.classList.remove("is-busy");
        if (err) { sync(); return; }
        pintar(r.liked, r.likes);
        if (r.liked) { btn.classList.remove("is-pop"); void btn.offsetWidth; btn.classList.add("is-pop"); }
      });
      // Sin sesión se abre el login: el botón queda libre.
      if (!usuario()) btn.classList.remove("is-busy");
    });
    window.addEventListener("pz:reaccion", function (e) {
      var dt = e.detail || {};
      if (dt.nombre === n) pintar(dt.liked, dt.likes);
    });
    window.addEventListener("puntazo:auth-changed", sync);
    // Lee el conteo cuando la tarjeta se acerca a la pantalla (no 20 lecturas de golpe).
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (en) {
        if (en.some(function (x) { return x.isIntersecting; })) { io.disconnect(); sync(); }
      }, { rootMargin: "300px 0px" });
      requestAnimationFrame(function () { io.observe(btn); });
    } else sync();
    return btn;
  }

  // Estilos del pill (el círculo base vive en estilo.css, bloque ACCIONES DEL CLIP).
  (function css() {
    if (document.getElementById("pz-reacciones-css")) return;
    var HEART = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.1 5.3 3 1.7-1.9 3.2-3 5.3-3 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z' fill='none' stroke='black' stroke-width='2.2' stroke-linejoin='round'/%3E%3C/svg%3E\")";
    var HEART_ON = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.1 5.3 3 1.7-1.9 3.2-3 5.3-3 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z'/%3E%3C/svg%3E\")";
    var s = document.createElement("style");
    s.id = "pz-reacciones-css";
    s.textContent =
      ".action-pill[data-ico='heart']{--ico:" + HEART + ";}" +
      ".action-pill.pz-like.is-liked{--ico:" + HEART_ON + ";color:#ff3b5c;border-color:rgba(255,59,92,.45);background:rgba(255,59,92,.14);}" +
      ".action-pill.pz-like.has-n{width:auto;min-width:38px;padding:0 11px 0 9px;gap:5px;border-radius:999px;}" +
      ".pz-like-n{font:800 .8rem/1 Montserrat,system-ui,sans-serif;color:inherit;font-variant-numeric:tabular-nums;}" +
      ".pz-like-n:empty{display:none;}" +
      ".action-pill.pz-like.is-busy{opacity:.6;}" +
      ".action-pill.pz-like.is-pop::before{animation:pz-like-pop .38s ease;}" +
      "@keyframes pz-like-pop{0%{transform:scale(1)}40%{transform:scale(1.35)}100%{transform:scale(1)}}" +
      "@media (prefers-reduced-motion:reduce){.action-pill.pz-like.is-pop::before{animation:none}}";
    (document.head || document.documentElement).appendChild(s);
  })();

  window.PuntazoReacciones = {
    stats: stats, meGusta: meGusta, alternarLike: alternarLike, pedirLike: pedirLike,
    guardar: guardar, quitarGuardado: quitarGuardado, crearPillLike: crearPillLike, corto: corto,
    COPY_LIKE: COPY_LIKE
  };
})();
