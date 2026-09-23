---
url: /guias/como-transmitir-un-torneo-de-padel-en-vivo/
title: "Cómo transmitir un torneo de pádel en vivo por YouTube"
description: "Qué equipo, qué internet y qué pasos necesitas para transmitir un torneo de pádel en YouTube: cámaras, OBS, bitrate, marcador, audio, privacidad y checklist."
h1: "Cómo transmitir un torneo de pádel en vivo"
crumb: "Transmitir un torneo"
eyebrow: "Guía para clubes"
lead: "Para transmitir un torneo de pádel en vivo necesitas **una cámara que vea la cancha completa**, **un encoder** como OBS y **internet con subida estable**: YouTube recomienda 4 Mbps para 720p y 10 Mbps para 1080p a 30 cuadros por segundo, por cada transmisión. Lo difícil no es la tecnología, es que no se caiga a media final."
type: article
order: 6
nav: guias
breadcrumbs: [["Guías", "/guias/"]]
parent: /guias/
published: 2026-09-22
updated: 2026-09-22
keywords: ["transmitir torneo de pádel en vivo", "streaming de pádel para clubes", "cómo transmitir pádel en YouTube", "cámaras para transmitir pádel", "transmisión en vivo torneo de pádel", "OBS pádel YouTube"]
short: "Transmitir un torneo en vivo"
card: "Equipo, internet, YouTube, marcador, audio, privacidad y checklist del día del torneo."
cta: clubs
tldr:
  - "**Lo mínimo:** una cámara alta detrás de la cancha, una computadora con OBS conectada por cable y un canal de YouTube verificado."
  - "**Internet:** YouTube recomienda 4 Mbps de subida para 720p y 10 Mbps para 1080p a 30 cuadros por segundo, por cada transmisión. Deja margen de sobra."
  - "**Una semana antes:** verifica el canal y activa las transmisiones en vivo; la primera vez puede tardar hasta 24 horas."
  - "**Una transmisión con cambio de cancha** suele ser mejor que una por cancha: gasta menos internet y siempre muestra el partido que importa."
  - "**Plan B:** graba en local al mismo tiempo, ten un internet de respaldo y avisa a los jugadores que el torneo se transmite."
faq:
  - q: "¿Qué velocidad de internet necesito para transmitir pádel en vivo?"
    a: "Depende de la calidad. YouTube recomienda 4 Mbps de subida para 720p a 30 cuadros por segundo, 6 Mbps para 720p a 60 y 10 Mbps para 1080p a 30, por cada transmisión. Mide tu subida a la hora del torneo, con el club lleno, y deja margen: si apenas alcanzas el número, la transmisión se va a trabar."
  - q: "¿Puedo usar las cámaras de seguridad del club para transmitir?"
    a: "Muchas veces sí. Si son cámaras IP y alguna ve la cancha completa desde atrás y en alto, OBS puede tomar su señal por la red. Revisa la resolución y los cuadros por segundo de esa cámara: una cámara pensada solo para vigilancia puede verse pobre en pantalla completa."
  - q: "¿Cuánto tarda YouTube en habilitar la transmisión en vivo?"
    a: "La primera vez puede tardar hasta 24 horas, según la ayuda de YouTube, y el canal tiene que estar verificado con un número de teléfono. Hazlo al menos una semana antes del torneo para tener tiempo de hacer una prueba completa."
  - q: "¿Necesito permiso de los jugadores para transmitir el torneo?"
    a: "Conviene tenerlo siempre. Pon en la inscripción que el torneo se transmite, coloca letreros en las canchas y ofrece una alternativa a quien no quiera salir. Para categorías infantiles o juveniles, pide autorización por escrito a los padres."
  - q: "¿Cuántas cámaras necesito para transmitir un torneo de pádel?"
    a: "Una por cancha que quieras mostrar. Para la mayoría de los torneos de club basta con las cámaras de las canchas principales y una sola transmisión en la que un operador va cambiando de cancha. Una segunda cámara lateral en la cancha central se ve bien en la final, pero no es indispensable."
related:
  - /para-clubes/
  - /guias/patrocinios-para-clubes-de-padel/
  - /guias/tecnologia-para-clubes-de-padel/
---

## ¿Qué necesitas para transmitir un torneo de pádel?

Menos de lo que parece, pero cada pieza tiene que ser confiable: en un torneo no hay segunda toma.

| Pieza | Opción básica | Opción de club |
|---|---|---|
| Cámara | Un celular o una webcam en un tripié alto | Cámaras IP fijas del club, una por cancha |
| Encoder | Laptop con OBS Studio (gratis) | Computadora dedicada o un sistema administrado por un proveedor |
| Internet | El del club, por cable | Línea con subida suficiente y un respaldo móvil |
| Plataforma | Canal de YouTube verificado | El mismo, con eventos programados por día |
| Marcador | Texto que el operador actualiza a mano | Gráfico con nombres, ronda y marcador |
| Personas | Una persona que opere todo el día | Un operador y alguien que lleve los marcadores |

El encoder es el programa que toma la imagen de la cámara, le agrega el marcador y los logos, y la manda a YouTube. OBS Studio es gratis y funciona en Windows, Mac y Linux. Si tus cámaras son IP, OBS puede recibir su señal por la red con una fuente de medios y la dirección RTSP de cada cámara, sin cables de video hasta la computadora.

## ¿Cuánto internet necesitas?

YouTube publica la [tasa de bits recomendada para transmisiones en vivo](https://support.google.com/youtube/answer/2853702?hl=es-419). Estos son los valores para H.264, el códec más común:

| Calidad | Cuadros por segundo | Subida recomendada por transmisión |
|---|---|---|
| 720p | 30 | 4 Mbps |
| 720p | 60 | 6 Mbps |
| 1080p | 30 | 10 Mbps |
| 1080p | 60 | 12 Mbps |

A eso súmale el audio (YouTube recomienda 128 Kbps en estéreo) y deja margen. Una regla prudente es que tu subida medida sea al menos el doble de lo que vas a transmitir. Si vas a mandar dos canchas en 720p a 30, son 8 Mbps de video: busca 16 Mbps de subida libres.

Tres detalles que se olvidan:

- **Mide a la hora del torneo.** Un sábado con el club lleno, cien celulares en el Wi-Fi le quitan subida a todo. Si puedes, separa la red de invitados o ponle límite ese día.
- **La computadora va por cable.** Nunca transmitas un torneo con el encoder conectado por Wi-Fi.
- **No subas de más.** Muchas cámaras de seguridad trabajan a 25 o 30 cuadros por segundo. Configurar 60 en OBS no mejora nada si la cámara no los da.

Para un torneo de club, 720p a 30 cuadros se ve bien en el celular, donde lo verá casi todo el mundo, y es más fácil de sostener que 1080p.

## ¿Cómo se configura YouTube para transmitir?

<ol class="ct-steps">
<li><strong>Verifica el canal.</strong> YouTube pide un número de teléfono y manda un código por mensaje o llamada. Sin verificación no se puede transmitir en vivo. Usa el canal del club, no el personal de alguien que mañana se va. Detalles en la <a href="https://support.google.com/youtube/answer/171664?hl=es-419">ayuda de verificación</a>.</li>
<li><strong>Activa las transmisiones en vivo con tiempo.</strong> Según YouTube, la primera vez <a href="https://support.google.com/youtube/answer/2907883?hl=es-419">puede tardar hasta 24 horas</a>. También pide que el canal no haya tenido restricciones de transmisión en los últimos 90 días y que la persona que transmite tenga al menos 16 años.</li>
<li><strong>Programa el evento.</strong> En YouTube Studio: Crear, Transmitir en vivo, Administrar, Programar transmisión. Ponle un título que se entienda ("Final Torneo de Primavera, 2ª fuerza varonil") y una miniatura con el logo del club. Así el link existe desde antes y la gente puede activar el recordatorio.</li>
<li><strong>Conecta el encoder.</strong> Copia la URL del servidor y la clave de transmisión a OBS. La clave es como una contraseña: quien la tenga puede transmitir en tu canal, así que no la mandes por el grupo de WhatsApp.</li>
<li><strong>Haz una prueba real.</strong> El día anterior, transmite 20 minutos en privado o no listado desde la misma computadora, con la misma cámara y a la misma hora del torneo. Míralo desde un celular con datos, no desde el Wi-Fi del club.</li>
</ol>

Un detalle de YouTube que afecta a los torneos largos: si una transmisión dura más de 12 horas, [es posible que no se archive](https://support.google.com/youtube/answer/6247592?hl=es-419). Si el torneo va de 8 de la mañana a 10 de la noche, crea un evento por bloque (mañana y tarde) o uno por día de finales.

## ¿Una cancha principal o todas las canchas?

Hay dos formas de hacerlo y cada una tiene su costo.

**Una transmisión por cancha.** Cada cancha tiene su propio evento de YouTube y el público elige. Es lo que quieren las familias, porque encuentran el partido de su gente. El problema es que multiplicas la subida (cuatro canchas en 720p a 30 cuadros son 16 Mbps solo de video) y necesitas a alguien pendiente de cuatro marcadores.

**Una sola transmisión que cambia de cancha.** Un operador decide qué partido sale al aire: el más cerrado, el de la siguiente ronda, la final. Gasta el internet de una sola transmisión y el video resultante se puede ver completo después, como si fuera un programa. Para la mayoría de los torneos de club es la mejor opción.

Así lo hacemos en Puntazo: tomamos la señal de las cámaras que ya graban las canchas para los clips y la mandamos a YouTube, con un panel desde el que se elige qué cancha sale al aire. Lo hemos usado en InterPadel y en torneos.

## ¿Dónde se pone la cámara?

Detrás de la cancha, en alto y centrada a lo ancho. La pared de fondo de una cancha reglamentaria mide 4 metros entre cristal y malla, así que la cámara tiene que ir por encima de eso para ver las dos mitades, los globos y la salida de pared.

Errores típicos:

- **Cámara lateral y baja.** Se ve bonito en una foto, pero en video no se entiende la profundidad y la mitad de la cancha queda tapada por los jugadores.
- **Detrás del cristal y a la altura de la gente.** Reflejos, manos en el vidrio y espectadores caminando enfrente todo el partido.
- **Luces de frente.** En canchas techadas, un reflector apuntando al lente quema la imagen. Muévela unos centímetros antes de fijarla.

## El marcador en pantalla

Un torneo sin marcador en pantalla se sigue a medias. Lo mínimo es un cintillo con los nombres de las parejas, la ronda y el marcador por sets.

La forma más confiable en un torneo de club es un operador que actualiza el marcador a mano en OBS entre puntos (una fuente de texto por pareja y otra por el marcador). Hay aplicaciones que generan gráficos para OBS, pero lo que suele fallar es la persona, no el programa: asigna a alguien que solo haga eso.

Si el árbitro o un jugador quiere llevar la cuenta desde su celular, nuestro [marcador de pádel gratis](/marcador.html) sirve para eso, aunque no se conecta con la transmisión.

## Audio: menos es más

El sonido de la cancha (la bola en la pala, el golpe en el cristal, los gritos después del punto) es lo que hace que una transmisión de pádel se sienta viva. Si tu cámara no tiene micrófono, un micrófono sencillo cerca de la cancha mejora mucho la experiencia.

Lo que no debes hacer es transmitir con la música del club de fondo. YouTube [revisa cada transmisión en busca de contenido de terceros](https://support.google.com/youtube/answer/3367684?hl=es-419): si detecta música con derechos, puede reemplazar tu imagen por una fija, cortar la transmisión y quitarte temporalmente el acceso a transmitir en vivo. Apaga las bocinas cerca de las canchas que se transmiten.

## ¿Cómo compartir el link y avisar a los jugadores?

- **Comparte el link del evento programado** unos días antes en los grupos de WhatsApp del club, en historias de Instagram y en el correo de inscripción.
- **Pon un QR en el club** que lleve a la transmisión, para que quien está en la cafetería vea la otra cancha.
- **Para los patrocinadores,** el logo en el cintillo del marcador es un espacio que se puede vender. En la guía de [patrocinios para clubes de pádel](/guias/patrocinios-para-clubes-de-padel/) explicamos cómo medirlo.

Y antes que todo, avisa que se transmite. En México, la [Ley Federal de Protección de Datos Personales en Posesión de los Particulares](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf) (la versión nueva se publicó en el Diario Oficial el 20 de marzo de 2025) obliga a informar para qué usas los datos de las personas, y la imagen de alguien identificable cuenta como dato personal. Esto no es asesoría legal, pero en la práctica funciona así:

- Una línea en la inscripción: "El torneo se transmite en vivo por YouTube y puede quedar grabado".
- Letreros en las canchas que se transmiten.
- Una alternativa para quien no quiera salir, como jugar en una cancha que no se transmite.
- En categorías infantiles o juveniles, autorización por escrito de los padres. YouTube, además, [tiene reglas propias](https://support.google.com/youtube/answer/2474026?hl=es-419) para transmisiones donde aparecen menores y puede desactivar el chat.
- Que la cámara vea la cancha y nada más: ni la cafetería ni los vestidores.

## Plan B: si se cae el internet

Se va a caer algún día. Prepárate para que no sea en la final:

- **Graba en local al mismo tiempo.** OBS puede grabar y transmitir a la vez. Si la transmisión falla, el partido queda en el disco duro y lo subes después. YouTube también recomienda guardar una copia local.
- **Ten un internet de respaldo.** Un celular o un módem con datos móviles y buena señal en el club. Prueba antes cuánta subida da en la cancha, no en la calle.
- **Guarda en OBS un perfil más ligero** (720p y menos bitrate) por si la subida no alcanza.
- **Conecta el router y la computadora a un no-break,** porque un apagón de dos segundos lo reinicia todo.
- **Comparte el link de tu canal terminado en /live,** que lleva a la transmisión activa. Si tienes que crear un evento nuevo, nadie se pierde.

## Checklist del día del torneo

- **Una semana antes:** canal verificado, transmisiones en vivo activadas, cámaras revisadas (encuadre y limpieza) y el aviso de transmisión incluido en la inscripción.
- **El día anterior:** eventos programados con título y miniatura, prueba de 20 minutos a la misma hora del torneo vista con datos móviles, prueba de subida con el club en uso, internet de respaldo probado y letreros impresos.
- **Una hora antes:** grabación local activa, nombres de las parejas en el marcador, música del club apagada y link publicado en los grupos.
- **Durante:** una persona dedicada solo a la transmisión, que revise de vez en cuando el estado de la transmisión en YouTube Studio y el chat.
- **Al terminar:** revisar que la transmisión quedó guardada y cortar los mejores puntos para redes.

Sobre ese último punto: si tu club tiene Puntazo, los jugadores pueden marcar sus mejores puntos con el botón durante el torneo y tener su clip en un par de minutos, aparte de la transmisión. Si quieres transmitir los torneos de tu club con las cámaras de las canchas, en [Puntazo para clubes](/para-clubes/) está lo que instalamos, o escríbenos por [WhatsApp]({{wa_clubes}}).
