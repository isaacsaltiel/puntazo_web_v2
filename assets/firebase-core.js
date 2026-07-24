(function () {
  "use strict";

  if (window.PuntazoFirebase) return;

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDN6lutb_WqCZHQT3_NbxjZ2BlA8wjnfPg",
    authDomain: "puntazo-clips.firebaseapp.com",
    projectId: "puntazo-clips",
    storageBucket: "puntazo-clips.firebasestorage.app",
    messagingSenderId: "400777430029",
    appId: "1:400777430029:web:4ce79047ddf5544a010144",
    measurementId: "G-1954JRGNL6"
  };

  // Lista de emails con acceso de administrador (admin.html, vista admin de reacciones).
  // Para agregar admin: añadir email en minúsculas a este array y hacer push a master.
  const ADMIN_EMAILS = [
    "isaacsaltiel@gmail.com"
  ];

  function isAdminEmail(email) {
    if (!email) return false;
    return ADMIN_EMAILS.includes(String(email).trim().toLowerCase());
  }

  function assertFirebaseBase() {
    if (!window.firebase || typeof firebase.initializeApp !== "function") {
      throw new Error("Firebase base SDK no está cargado.");
    }
  }

  function ensureApp() {
    assertFirebaseBase();
    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    return firebase.app();
  }

  function app() {
    return ensureApp();
  }

  // Por default Firestore habla por WebChannel (streaming sobre HTTP). Hay
  // muchísimas redes reales donde eso simplemente no pasa: proxies de oficina,
  // filtrado del ISP, antivirus que inspecciona TLS, WiFi de hotel/club con
  // portal cautivo, algunos operadores móviles. Cuando falla no da error: la
  // consulta se queda colgada para siempre y el usuario ve la pantalla en
  // blanco — de ahí el "con VPN sí me deja entrar".
  //
  // experimentalAutoDetectLongPolling detecta ese caso en el primer intento y
  // se cae a long-polling HTTP normal, que atraviesa cualquier red. Se aplica
  // una sola vez y ANTES de la primera operación (por eso vive aquí y no en
  // cada página): settings() truena si Firestore ya arrancó.
  let firestoreConfigured = false;

  function db() {
    ensureApp();
    if (typeof firebase.firestore !== "function") {
      throw new Error("Firebase Firestore SDK no está cargado.");
    }
    const store = firebase.firestore();
    if (!firestoreConfigured) {
      firestoreConfigured = true;
      try {
        store.settings({ experimentalAutoDetectLongPolling: true });
      } catch (err) {
        // Firestore ya estaba corriendo: se queda con el transporte default.
        console.warn("[Puntazo Firebase] transporte no ajustado:", err);
      }
    }
    return store;
  }

  function auth() {
    ensureApp();
    if (typeof firebase.auth !== "function") {
      throw new Error("Firebase Auth SDK no está cargado.");
    }
    return firebase.auth();
  }

  window.PuntazoFirebase = {
    config: FIREBASE_CONFIG,
    ADMIN_EMAILS,
    isAdminEmail,
    ensureApp,
    app,
    db,
    auth
  };

  try {
    ensureApp();
  } catch (err) {
    console.warn("[Puntazo Firebase] App todavía no lista:", err);
  }
})();
