# Hot-Patch — Saneamiento de secretos en config.json del runner WellStreet

> Worker de **hot-patch** corriendo vía Claude Code DENTRO de la PC del club
> **WellStreet**. NO trabaja sobre el repositorio web. Coordinado por el chat
> maestro. Etapa corta y acotada — NO toques nada fuera de lo descrito.
>
> **Path del runner**: `C:\Users\WellStreet\Desktop\Puntazo-release` (verifica
> con `dir`). El reporte de la etapa E lo confirmó.

## Origen

El reporte de la etapa E reportó un bug crítico de seguridad: el archivo
`config.json`, rotulado como **"Plantilla sanitizada para release ZIP"**,
contiene en claro:

- el **password del NVR Hikvision** (≈ línea 6),
- un **GitHub Personal Access Token `ghp_…`** (≈ línea 110).

Si ese ZIP de release se distribuyó, ambos secretos están comprometidos.

> **Acción manual de Isaac, EN PARALELO a este worker (no es tarea tuya)**: rotar
> el PAT de GitHub (revoke + regenerar) y rotar el password del NVR. Este worker
> NO puede rotar credenciales externas; solo limpia el archivo y el release.

## Objetivo

1. Sacar los secretos en claro del archivo que se empaqueta en el ZIP de release.
2. Mantener el runner en producción **funcionando** (el `config.json` que el
   runner lee en runtime puede seguir teniendo los valores reales, pero NO debe
   ser el mismo archivo que se distribuye).
3. Verificar que no haya **otros** secretos en claro en el árbol del release.

## Alcance

### 1. Auditoría de secretos (primero, sin cambiar nada)

- Localiza el/los `config.json` del runner y distingue: ¿cuál lee el runner en
  runtime? ¿cuál se empaqueta en el ZIP de release? ¿son el mismo archivo?
- Grep por patrones de secreto en TODO el árbol del release: `ghp_`, `password`,
  `secret`, `token`, `api_key`, `rtsp://.*:.*@`, claves privadas. Reporta cada
  hallazgo con `file:line` (NO transcribas el valor del secreto en el reporte —
  solo el path y el tipo).

### 2. Saneamiento

- Crear/confirmar `config.example.json` (o `config.template.json`) con los campos
  presentes pero los secretos **reemplazados por placeholders** (`"<NVR_PASSWORD>"`,
  `"<GITHUB_PAT>"`, etc.). Este es el archivo que va al ZIP de release.
- Asegurar que el `config.json` **real** (con valores vivos) esté en `.gitignore`
  (si el repo se versionó en E-0) y **excluido del empaquetado del ZIP**. Localiza
  el script/proceso que arma el ZIP y confírmalo.
- Si solo existe un `config.json` que hace ambos papeles: separa en dos
  (`config.json` real en runtime, `config.example.json` para distribución) y ajusta
  cualquier referencia.
- NO cambies los valores que el runner usa en runtime — el club debe seguir
  grabando. Solo cambias qué archivo se distribuye.

### 3. Verificación

- Confirmar que el runner sigue arrancando y leyendo su config real correctamente
  (no rompiste el path que carga la config).
- Confirmar que el ZIP de release (si lo regeneras) NO contiene secretos en claro.
- Listar qué secretos quedaron expuestos para que Isaac sepa exactamente qué rotar.

## Fuera de alcance (NO toques)

- **Rotar las credenciales** (PAT, password NVR). Acción manual de Isaac.
- **Cualquier lógica de ingesta, NVR, cola o Firestore**. Esto es solo
  saneamiento de secretos. La migración Firestore es E-0 (otro worker).
- **El mapeo de canales** y el swap Cancha5/Cancha6.
- **El repo web.**

## Riesgos

- **Romper el arranque del runner** si mueves/renombras el config que lee en
  runtime. Verifica el path de carga ANTES de mover nada.
- **Falso "sanitizado"**: asegúrate de que el archivo del ZIP sea realmente el de
  placeholders, no una copia con secretos.

## Definition of done

- Inventario de secretos expuestos (path + tipo, sin valores) entregado a Isaac.
- `config.example.json` con placeholders es lo que va al ZIP; `config.json` real
  excluido del empaquetado y del git (si aplica).
- Runner verificado arrancando con su config real.
- Reporte en formato `docs/workers/README.md`, con la lista de secretos a rotar
  destacada arriba para Isaac.

## Formato del reporte de regreso

Estándar del README. Destaca arriba, en negrita, la lista de **secretos que Isaac
debe rotar** (tipo + dónde se usan), para que no se pierda en el reporte.
