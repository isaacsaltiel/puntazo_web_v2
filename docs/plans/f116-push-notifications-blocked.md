# F116 — Push notifications (BLOCKED, no shipped)

**Fecha decisión**: 2026-05-29 noche.
**Status**: NO se implementa hasta tener Cloud Functions.

## Por qué se postpone

Push notifications "reales" requieren 4 piezas:

1. **Service Worker** registrado en el sitio (`/firebase-messaging-sw.js`).
2. **FCM SDK** (`firebase-messaging-compat.js`) en cliente.
3. **Token registration**: pedir permission, obtener FCM token, guardarlo en `users/{uid}/fcmTokens/{tokenId}`.
4. **Trigger server-side** que dispare la push real cuando hay un evento (clip nuevo, partido por validar, recordatorio).

Las piezas 1-3 son client-side y se pueden hacer hoy. La pieza 4 requiere **Cloud Functions** corriendo, y Isaac priorizó no tocar cloud por ahora (las CFs viven separadas del repo web).

**Sin pieza 4, todo el setup queda inerte** — pedirías permission, almacenarías tokens, y nunca llegaría una notificación. Eso es deuda técnica que asusta al usuario sin valor.

Adicionalmente:
- **Service Worker introduce caching agresivo** que puede romper updates del sitio (versionar SW, invalidar caches manualmente). Riesgo operacional para un sitio que se itera rápido.
- **iOS Safari requiere PWA instalado** (Add to Home Screen) para recibir push. La fricción real es alta y el target user mayoritariamente no instala PWAs.

## Lo que SÍ se hizo en lugar de F116

[F115 match-expiration.js](../../assets/match-expiration.js) reemplaza el caso de uso más obvio: "recordarle al usuario que tiene un partido activo viejo". Funciona dentro del sitio (no necesita push), aparece como banner flotante al entrar a cualquier página, y el usuario lo cierra o termina el partido directo desde el banner. Cubre ~80% del valor que daría un push, sin la complejidad.

## Cuando se quiera abrir F116

Estos son los archivos/cosas a crear cuando llegue el día:

```
/firebase-messaging-sw.js                NUEVO (en raíz del sitio)
/assets/firebase-messaging-init.js       NUEVO (cliente: requestPermission, register token)
/assets/push-prefs.js                    NUEVO (UI: toggle "Activar notificaciones" en perfil-editar)

users/{uid}/fcmTokens/{tokenId}          NUEVA subcollection
  - token: string
  - userAgent: string
  - createdAt: serverTimestamp
  - lastSeenAt: serverTimestamp
  - prefs: { newClip: bool, matchValidation: bool, matchReminder: bool }
```

Reglas Firestore (agregar dentro de `match /users/{uid}`):
```firestore
match /fcmTokens/{tokenId} {
  allow read, write: if isMe(uid);
}
```

Cloud Functions necesarias (al menos):
- `onNewClip` (trigger Firestore) → enviar push a uid_owner del clip.
- `onScoreNeedsValidation` (trigger Firestore) → enviar push a invitados del partido.
- `cron-stale-matches` (trigger schedule) → cron que detecta partidos activos viejos y manda push de recordatorio (alternativa server-side al banner F115).

Estimado de effort cuando se priorice: **2-3 días de un worker** (SW + token flow + UI opt-in + reglas + 2-3 CFs + testing en iOS PWA + web normal).
