# Briefs pendientes — rediseño y deuda (2026-06-10)

> Lo que Isaac pidió el 10-jun y NO se ejecutó en la sesión (es rediseño grande
> o requiere la NUC). Cada sección es un brief autosuficiente para un worker.
> Contexto general: docs/plans/auditoria-integral-2026-06-09.md.

---

## W-HERO — Rediseñar el hero del landing (index.html)

**Queja de Isaac:** "el Hero es horrible, mala simetría… en general mal todo".

Alcance: SOLO la sección hero de index.html (primer viewport). Mantener: header,
secciones siguientes, OG tags, GA. Sistema de diseño: Montserrat, azul
#004FC8/#0B7CFF, verde pelota #c8e835, fondo oscuro #050914 (ver
memory/reference-puntazo-design-system y assets/estilo.css).

Dirección: composición asimétrica intencional o centrada limpia (no el híbrido
actual), 1 mensaje ("Tus mejores puntos de pádel, en video, solos") + 1 CTA
primario (Encuentra tus clips) + 1 secundario (Usar botón). hero-bg.jpg pesa
2.2MB → reemplazar por WebP ≤200KB o gradiente + mockup de clip. Mobile-first
(la mayoría del tráfico). Validar en 360px, 390px, 768px, 1280px.

## W-SIMPLIFY — Desaturar "configurar partido" (registrar-min) y mi-partido

**Queja:** "no me encanta configurar partido ni mi partido… muy saturadas, te
llena de mucha mierda que no se termina por entender".

1. registrar-min.html: aplicar divulgación progresiva — pantalla 1 = SOLO
   jugadores y marcador (lo esencial); club/fecha/detalles colapsados en "Más
   opciones". Un solo CTA visible por paso.
2. mi-partido.html (328KB, 8.4k líneas): PRIMERO partir en assets propios
   (mi-partido.css + 3 módulos JS por los separadores `// ===` existentes —
   score, claims, ui; ver auditoría P3) y LUEGO rediseñar la jerarquía: arriba
   marcador vivo + acción primaria; todo lo demás (claims, compartir, ajustes)
   en sheets/acordeones. No tocar la lógica de pulsos ni claims.

Medir éxito: un usuario nuevo entiende qué hacer en <5 segundos en cada pantalla.

## W-F136 (NUC) — Clips de botón durables en "Mis clips"

**Queja:** "en mis clips no salen los puntazos registrados con mi botón".

Hoy: la web resuelve pulsos contra índices JSON con ventana corta (F123-B) y
mis-clips solo agrupa clips por PARTIDO; el quick-win 10-jun muestra los
pulsos del user con estado, pero el clip no queda ligado durablemente.

Fix NUC (este brief): al publicar un clip que vino de un pulso, la NUC escribe
en `pending_pulses/{pulseId}`: `consumed_by = { video_id, video_url,
completed_at }` (además del consumed_at actual). Con eso la web muestra el clip
exacto (no "búscalo en su cancha"). Botón FÍSICO (Arduino): sus pulsos no traen
uid_creator → siguen anónimos; documentar y decidir aparte (token de sesión de
cancha o similar).

Web (post-NUC, 20 líneas): en mis-clips loadMyPulses, si p.consumed_by.video_url
existe → render del clip directo.

## W-CLAIM-HIST — El claim transfiere el historial (promesa G1)

Cuando un invitado reclama su slot (guest claim), los partidos confirmed/ended
viejos del MISMO guestId (y sus alias fusionados) no se vinculan a su uid → la
promesa del mensaje de WhatsApp ("te tengo tus partidos con tu nivel") es falsa
para el histórico. Fix server-side: en onMatchNotify, tras detectGuestClaims,
query matches del ownerUid con ese guestId en jugadores[] y status confirmed/
ended, y backfill `uid` en el slot + playerUids (Admin SDK; NO tocar
ratingProcessed — el ranking histórico no se recalcula). Idempotente. Tests en
emulador obligatorios. Cuidado: el array jugadores se actualiza por índice.

## W-P3 — Deuda de calidad restante (auditoría 9-jun)

- Migrar diálogos nativos restantes a PZ.confirm/PZ.prompt: grupo.html,
  liga.html (cerrar temporada!), mi-nivel.html, detalle.html, perfil.html,
  mi-partido.html, script.js:75 (password de cancha — diseño cuidado),
  king/americano/sortear/marcador/torneo5/admin.
- Migrar las 21 copias de escapeHtml y 14+ de toDate/toMillis a PZ.* (mecánico,
  un archivo a la vez, smoke test por página).
- Imágenes → WebP: hero-bg 2.2MB, torneo5-bg 1.7MB (PNG!), carrusel2 569KB;
  `loading="lazy"` en carruseles/avatares; revisar assets/court-icons/ (34MB).
- `defer` en scripts propios; html2canvas on-demand en resumen.html.

## Pendientes de Isaac (no workers)

- Coordenadas de los clubes para el geofence del botón:
  assets/clubs-catalog.js → CLUB_DISPLAY[club].geo = { lat, lng, radiusM: 400 }.
- Decisiones P0.5 (privacidad, pulsos anónimos, passwords.json, inviteCode).
- Parte 2 del nivel (borrar rating semilla + recompute) — sigue staged.
