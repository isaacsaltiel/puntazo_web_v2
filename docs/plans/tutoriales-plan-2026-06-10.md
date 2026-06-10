# Tutoriales en Puntazo — plan + guiones paso a paso (2026-06-10)

## Cómo meterlos (mecánica propuesta, en orden de esfuerzo)

1. **Coachmarks de primera vez (recomendado para v1).** Componente `PZ.coach(steps)`
   en assets/util.js: burbujas ancladas a elementos (selector CSS + texto + botón
   "Siguiente"), overlay oscuro, se dispara si `localStorage['pz_tut_<seccion>']`
   no existe y se marca al terminar/saltar. 3-4 pasos máx por pantalla. Reusa el
   estilo de PZ.confirm. Cada pantalla declara sus pasos (los guiones de abajo).
2. **Página /como-funciona.html** con las mismas guías en formato scrolleable
   (sirve de link en el dropdown del avatar y para WhatsApp de soporte).
3. **Videos cortos** (15-30s, capturas de pantalla del flujo real) embebidos en
   /como-funciona — fase 2, cuando los flujos dejen de moverse.

Reglas de oro: nunca bloquear la acción principal; siempre "Saltar"; máx 1 tutorial
por sesión; re-accesibles desde "?" en el header de cada sección.

---

## Guiones paso a paso (contenido listo para coachmarks o página)

### 📲 El botón (boton.html)
1. **Este es tu botón de puntazos.** ¿Hiciste un punto increíble? Tócalo en los
   siguientes 30 segundos y lo capturamos en video.
2. **No tienes que hacer nada más.** El clip se procesa solo (~1 min) y queda en
   la cancha. Con sesión iniciada, también en "Mis clips".
3. **El historial de abajo** te dice a qué hora pediste cada puntazo de hoy.

### 🎬 Mis clips (mis-clips.html)
1. **Aquí viven los clips de tus partidos**, agrupados por partido.
2. **"Tus puntazos de botón"** (arriba) muestra el estado de lo que pediste con
   el botón: ⏳ procesando → ✅ listo (con link a su cancha).
3. **Comparte**: cada clip tiene botón de compartir directo a WhatsApp.

### ➕ Registrar un partido (registrar-min.html)
1. **Registra en 4 pasos**: quiénes jugaron → marcador → confirma y listo.
2. **¿Jugó alguien sin cuenta?** Escribe su nombre y queda como invitado — luego
   puede reclamar su lugar (y su historial) con un link.
3. **Tu rival confirma.** El partido cuenta para el nivel cuando alguien del
   equipo contrario lo confirme. Te avisamos con la campana 🔔.

### ✅ Confirmar un partido (confirmar.html)
1. **Te registraron un partido.** Revisa el marcador: ¿así quedó?
2. **Confirma** y el partido cuenta para el nivel de los 4.
3. **¿Algo está mal?** Tócale "Disputar" y dinos qué (marcador / no jugué /
   equipos). Nadie gana nivel hasta resolverse.

### 📊 Mi nivel y ranking (mi-nivel.html)
1. **Tu nivel (1.0–7.0) se calcula solo** con cada partido confirmado. Más
   partidos con gente real = más preciso.
2. **El toggle de arriba** cambia entre TU progreso (evolución, W-L, historial)
   y el ranking global de todos los jugadores.
3. **"Calibrando"** = pocos partidos todavía; tu nivel puede moverse rápido al
   principio. Es normal.

### 🤝 Amigos e invitados (amigos.html)
1. **Busca por nombre o @handle** y manda solicitud. Verás las enviadas en
   "esperando respuesta"; te avisamos cuando acepten.
2. **Tus invitados** son los que jugaron sin cuenta. Tócales "📲 Invitar" para
   mandarles su link de WhatsApp — al crear cuenta reclaman sus partidos.
3. **¿Dos invitados eran la misma persona?** Fusiónalos.

### 🏆 Grupos y ligas (grupos.html / liga.html)
1. **Un grupo junta a tu banda**; una liga además lleva TABLA.
2. **No hay que capturar nada extra**: cada partido confirmado entre miembros
   (3+ del grupo) se cuenta solo para la liga.
3. **Comparte el link del grupo** para que entren solos; la campana avisa cuando
   te mueves en la tabla y el domingo llega el resumen semanal.

### 👤 Perfil (perfil.html)
1. **Tu base.** Nivel y ranking arriba, partido activo o "Iniciar partido", tus
   últimos partidos y tus puntazos pendientes.
2. **Desde el avatar (arriba derecha)** llegas a todo: partidos, clips, nivel,
   amigos, ligas, registrar.

---

## Orden de implementación sugerido
1. `PZ.coach()` + coachmark en **registrar-min** y **confirmar** (donde más se
   pierde gente nueva — llegan por link de WhatsApp sin contexto).
2. **mi-nivel** y **liga** (explican el sistema, reducen "¿por qué no subo?").
3. /como-funciona.html con todos los guiones.
4. boton/mis-clips/amigos/perfil.
