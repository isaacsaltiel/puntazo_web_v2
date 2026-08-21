# Brief para el Claude de la NUC de BreakPoint — layout del stream por Firestore (torneo CPAM)

> Pégale esto tal cual al chat de la NUC. Está escrito para que él conteste primero
> y programe después. Fecha: 2026-08-21. Contraparte web: la hace el maestro (PC de Isaac).

---

Hola. Soy el maestro (PC central de Isaac). Hoy hay un torneo de **CPAM** en BreakPoint y
vamos a sacar esto a producción **hoy mismo**. Tu máquina ya está transmitiendo a YouTube un
mosaico de varias canchas que Isaac cambia a mano. Queremos dos cosas:

1. Que la página de Puntazo muestre ese stream embebido (eso lo hago yo, lado web).
2. Que **el administrador del torneo** cambie el layout del mosaico desde una página web,
   sin tocar la NUC. Web escribe en Firestore → **tú** lees y recompones.

## PARTE 1 — Contéstame esto primero (datos reales, rutas exactas, sin adivinar)

1. **Proceso actual**: qué está transmitiendo a YouTube ahora mismo. Ruta exacta del
   script/.bat/servicio y cómo se lanzó. Si es ffmpeg, pega el comando completo
   (censura la stream key: solo largo y primeros 4 caracteres).
2. **Composición**: cómo se arman varias canchas en una sola imagen (filter_complex de
   ffmpeg con `xstack`/`overlay`, OBS con escenas, otro). Pega el `filter_complex` tal cual.
3. **Cambio en caliente**: hoy, cambiar de vista ¿obliga a reiniciar ffmpeg? ¿cuántos
   segundos se corta el stream en YouTube? ¿hay vía sin corte (ffmpeg `zmq`/`sendcmd`,
   obs-websocket, o un compositor intermedio tipo MediaMTX/OBS virtual)?
4. **Entradas**: lista las canchas disponibles con su URL RTSP (censura password) y el
   id/nombre con el que las llama el código. ¿Cuántas aguanta simultáneas?
5. **YouTube**: URL o video id del stream que está EN VIVO ahora. ¿Es un broadcast
   persistente (misma URL siempre) o se crea uno nuevo cada vez? ¿Dónde vive la stream key?
6. **Máquina**: CPU/GPU, encoder (QSV/NVENC/x264), resolución y bitrate de salida, y
   upstream real del club si lo has medido.
7. **Firestore**: ruta del `service_account.json` que usa el runner, y qué watchers de
   Firestore ya corren en esa máquina (ruta del código).

## PARTE 2 — Lo que hay que implementar (contrato ya cerrado, no lo cambies)

### Colección `stream_control`, doc id = `BreakPoint`

Campos que **escribe la web** (tú NUNCA los tocas):

| campo | tipo | valores |
|---|---|---|
| `mode` | string | `"solo"` \| `"pip"` \| `"multi"` \| `"grid"` |
| `primary` | string | id de cancha, ej. `"Cancha1"` |
| `secondaries` | array<string> | 0 a 3 ids de cancha, ej. `["Cancha2","Cancha3"]` |
| `rev` | number | entero que **sube en cada cambio** (idempotencia) |
| `requested_at` | timestamp | server timestamp |
| `requested_by` | string | email del operador |

Campos que **escribes tú** (merge, nunca pises los de arriba):

| campo | tipo | para qué |
|---|---|---|
| `applied_rev` | number | el `rev` que ya aplicaste |
| `applied_at` | timestamp | cuándo |
| `status` | string | `"applying"` \| `"live"` \| `"error"` |
| `last_error` | string | texto corto si truena |
| `nuc_seen_at` | timestamp | latido del watcher (cada ~15 s) — la web lo usa para decir "NUC conectada" |

**Regla de idempotencia:** solo actúas si `rev > applied_rev`. Si son iguales, no hagas nada.
(Así un reinicio tuyo no re-dispara el último layout, y un `onSnapshot` duplicado tampoco.)

### Semántica de los modos

- `solo` — solo `primary`, pantalla completa. `secondaries` se ignora.
- `pip` — `primary` grande a pantalla completa + `secondaries[0]` chica encima,
  **abajo a la izquierda**, ~28-30% del ancho, con marco/margen.
- `multi` — `primary` grande + **2 o 3** secundarias más chicas (~20-22% del ancho),
  apiladas abajo-izquierda hacia la derecha, o en columna izquierda. Tú elige lo que
  se vea mejor con tu filter_complex; que sea legible.
- `grid` — **todas del mismo tamaño**, incluyendo `primary`:
  - 2 canchas → lado a lado (izquierda / derecha)
  - 3 canchas → 2 en la columna izquierda (arriba/abajo) + 1 a la derecha centrada
  - 4 canchas → cuadrícula 2×2

En todos los modos el orden es: `primary` primero, luego `secondaries` en el orden que vengan.

### Colección `stream_public`, doc id = `BreakPoint` (para la página pública)

Esta la lee **cualquiera sin login** (`/vivo.html` en el sitio). Escríbela cuando el
broadcast arranque y cuando pare:

```json
{
  "live": true,
  "youtube_url": "https://www.youtube.com/watch?v=XXXXXXXXXXX",
  "titulo": "Torneo CPAM · BreakPoint",
  "organizador": "CPAM",
  "updated_at": "<server timestamp>"
}
```

Con `live:false` la página muestra "ahorita no hay transmisión". Si tú no la puedes
escribir todavía, no pasa nada: el operador la puede poner a mano desde el panel web.

### Restricciones

- **Aditivo e idempotente.** No rompas el pipeline de clips ni el stream actual.
- Si aplicar el layout corta el stream, **dilo en tu respuesta** (yo pongo el aviso en el
  panel) y deja `status:"applying"` mientras reinicias.
- Si una cancha pedida no existe o su RTSP no levanta, no mates el stream: sigue con las
  que sí, y pon el detalle en `last_error`.
- Si `secondaries` trae más de 3, quédate con las 3 primeras.
- No subas secretos a ningún repo ni los imprimas (solo largo + prefijo).

## PARTE 3 — Qué me devuelves

1. Las respuestas de la Parte 1.
2. Ruta del archivo nuevo del watcher y cómo se lanza (y si queda en el arranque).
3. Confirmación de que hiciste una prueba real: cambiaste `rev` a mano en Firestore y el
   mosaico cambió en YouTube. Dime cuántos segundos tardó y si hubo corte.
4. Si algo de esto no se puede hoy, dime **qué sí se puede en la próxima hora** — Isaac
   prefiere algo funcionando hoy aunque sea con corte de stream al cambiar de vista.
