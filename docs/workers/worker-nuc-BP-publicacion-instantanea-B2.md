# Worker NUC BreakPoint — Fase B2: el clip en ~2 min, sin cambiar cómo se ve

## Por qué
B1 quedó cerrada: **2:50** del pulso a la web, **6 s** de la subida a verse, y el índice por
lado tarda 54 s. Lo que queda son tus etapas (mediana de tu tabla de la Fase A):

| Etapa | Hoy |
|---|---|
| Encolado + espera | 11 + 20 s (la descarga empieza en T+31) |
| Descarga del NVR | 66 s |
| ffmpeg pase 1 (logos) + pase 2 (outro, miniatura) | 39 + 20 s |
| Subidas mp4 + jpg | 10 + 4 s |

B2 ataca la espera, el encode y la subida **sin cambiar el clip**. Meta: **~2:00 del pulso a
la web.** La descarga del NVR (66 s) no se toca aquí: esa es la Fase B3.

## 1. La espera del NVR: relativa al pulso, NO un sleep fijo (regla de Isaac)
**Hoy:** `sleep(WAIT_BEFORE_REQUEST_SECONDS = 20)` dentro del worker antes de CADA descarga.
La descarga empieza en T+31, y en una ráfaga el 2º y el 3º clip vuelven a esperar 20 s aunque
sus pulsos tengan minutos.

**Regla nueva (Isaac, 11-sep):** entre el momento que se quiere capturar (el pulso) y el
inicio de la descarga deben pasar **COMO MÍNIMO 20 s**. Si ya pasaron, no se espera nada.
- **Cadena de pulsos:** cuenta el ÚLTIMO pulso.
- **Jobs sin pulso** (recuperar, partido completo, manual_exact): cuenta el fin de la
  ventana, con el mismo margen: `inicio ≥ fin_de_ventana + 15 s`. En un pulso normal el fin
  es pulso + 5 s de post-roll, así que es lo mismo que pulso + 20 s.
- **Implementación:** `espera = max(0, objetivo − ahora)`. Loguea cuánto esperó.
- **Tu medición la respalda:** pidiendo en T+10 y en T+20 el NVR cerró bien; en T+5 se
  colgó. Con esta regla, lo más temprano posible es T+20.
- **Ahorro:** un clip suelto empieza en T+20 en vez de T+31 (−11 s). En una ráfaga, el 2º y
  el 3º ya no esperan (−20 s cada uno).
- **Flag:** `ESPERA_RELATIVA_AL_PULSO` (OFF = el sleep fijo de hoy).

## 2. Logos pre-escalados: mismo look, ~−40 s
Tu medición mostró que QSV no es el cuello (el transcode puro tarda 10 s). Lo es el
filtergraph: en cada clip se decodifican con libvpx-vp9 y alfa 3 webm a tamaño nativo
(puntazo_anim 1400×1400@30, BreakPoint 1024×1024@30, ANUNCIO 2280×560@30), solo para
escalarlos a ~316, ~338 y ~900 px.
- **Que el filtergraph reciba cada logo YA en su tamaño final:** mismos píxeles, misma
  posición, mismos tiempos y mismo loop.
- **Caché:** genera la versión escalada una sola vez, fuera del camino del clip, con llave =
  sha256 del archivo origen + tamaño destino. Debe regenerarse sola cuando asset_sync cambie
  un asset (el anuncio de Loka ya cambió de versión varias veces).
- **Si la caché no está lista o falla,** usa el camino de hoy. Nunca un clip sin logos.
- **Formato:** el que decodifique más rápido conservando el alfa sin bordes (VP9 con alfa en
  calidad alta, ProRes 4444, qtrle…). Mide y elige.
- **Libertad:** si con logos chicos conviene fusionar los dos pases, hazlo. Lo que importa es
  el tiempo y que el resultado se vea igual.
- **1440p se queda. NO cambies la resolución:** 1080p es decisión de Isaac. Como dato, mide
  cuánto tardaría a 1080p, pero no lo actives.
- **Flag:** `LOGOS_PREESCALADOS`.

**A/B obligatorio antes de reiniciar**, en frío, con una copia aislada como en B1:
- Usa 3 crudos reales distintos. Al menos uno debe llevar el outro completo.
- Pasa el mismo crudo por el camino de hoy y por el nuevo. Reporta el tiempo de cada uno y el
  SSIM del video completo (filtro `ssim` de ffmpeg). Esperado: ≥ 0.99.
- Saca cuadros lado a lado en 0.5 s, 5 s, 30 s y dentro del outro. Súbelos a
  `/Puntazo/briefs/respuestas/B2-comparacion/` para que Isaac los vea.
- Si el SSIM baja de 0.99 o se ve un borde o halo en algún logo, NO lo actives y repórtalo.

## 3. Una sola subida para el mp4 y el jpg (~−4 s)
Es lo que dejaste pendiente en B1 (#8). Una sola invocación de rclone para los dos archivos.
Si falla el jpg, el mp4 cuenta como subido: verifica cuál llegó. **Flag:** `SUBIDA_UNICA`.

## 4. Los pulsos en vivo pasan antes que los recuperados
El 8-sep, dos pulsos en vivo de la Cancha 3 esperaron detrás de 4 recuperaciones de 2 min y
se vieron a los 13:41 y 11:51. Los pulsos en vivo (botón, teclado, web, test) van primero; las
recuperaciones y el partido completo, después. Sin inanición: si no hay pulsos en vivo, los
otros siguen corriendo. **Flag:** `PRIORIDAD_EN_VIVO`.

## 5. Recomendado, si queda simple: watchdog de la descarga
Si la descarga del NVR deja de avanzar N segundos (el archivo no crece), córtala y reintenta
una vez, en vez de esperar el timeout de 185 s. Es lo que viste pidiendo en T+5.

## Aparte, solo lectura: el botón `ip-cancha4`
Isaac **NO** movió ningún botón a BreakPoint. Aun así, tu log (10-sep 21:10) vio
`ip-cancha4`, un nombre de Interpadel, sin mapeo. Investiga sin cambiar nada:
- ¿A qué broker MQTT se conecta el runner? Solo host y puerto, nada de credenciales. ¿Es de
  la red local o está en internet?
- ¿A qué topics se suscribe?
- En los logs de los últimos 14 días: cada aparición de `ip-cancha4` (hora, topic y payload
  sin secretos) y cualquier otro dispositivo sin mapeo.
- Si el broker registra las IP de los clientes: ¿desde qué IP llegó? ¿Aparece en `arp -a`
  (MAC)?
- Riesgo: ¿un botón de otro club podría generar un clip en BreakPoint si su nombre
  coincidiera con un mapeo?

## Documentación para las otras NUCs
Cuando BreakPoint quede cerrado, Isaac va a documentar B1 + B2 y llevarlos a Interpadel y a
WellStreet, que tienen códigos distintos. Al terminar B2, deja en tu repo
`CAMBIOS-PUBLICACION-INSTANTANEA.md` (con copia en `/Puntazo/briefs/respuestas/`). Por cada
cambio de B1 y de B2, anota:
- qué hace;
- dónde está (función y archivo:línea);
- su flag;
- cómo se probó;
- las trampas para portarlo: dependencias, orden de los pasos, y lo que el cambio asume de
  esta NUC.

## Candados y reinicio
- Todo en una rama, con un commit chico por punto.
- El A/B de los logos se hace en frío, antes de tocar producción.
- Reinicia con la cola vacía y `-DryRun` primero. **El momento lo decide Isaac**; mejor entre
  00:30 y 05:30, o en el valle de 14 a 16 h.
- Después del reinicio: 1 pulso de prueba y los primeros clips reales.

## Reglas
- No toques la descarga del NVR más allá de la espera (punto 1) y el watchdog (punto 5).
- Nunca imprimas secretos: solo largo y prefijo.
- Si algo de este brief no cuadra con tu código, dilo antes de improvisar.

## Entrega
El reporte en este formato, en un bloque listo para copiar. Súbelo también a
`/Puntazo/briefs/respuestas/RESPUESTA-BREAKPOINT-B2.md`.

```
# RESPUESTA BP — Fase B2
Fecha/hora local:            Rama y commits:
1 Espera relativa: dónde, cómo se calcula el objetivo, log de ejemplo
2 Logos: formato elegido, dónde vive la caché, cómo se invalida
  A/B (3 crudos): tiempo hoy vs nuevo | SSIM | ¿se ve igual? (link a las imágenes)
  Dato 1080p (sin activar): __ s
3 Subida única: cómo, y qué pasa si falla el jpg
4 Prioridad: cómo, y cómo evitas la inanición
5 Watchdog: ¿hecho? N = __ s
Flags y su valor final
Tiempos por etapa (5-10 clips reales tras el reinicio; misma tabla que en la Fase A):
Del pulso a visible: mediana __ (antes 2:50)
ip-cancha4: broker | topics | apariciones | IP/MAC | riesgo
CAMBIOS-PUBLICACION-INSTANTANEA.md: ¿listo? ¿dónde?
Riesgos o pendientes:
```
