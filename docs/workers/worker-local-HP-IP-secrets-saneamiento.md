# Hot-Patch IP — Saneamiento de secretos en config.json + git init del runner Interpadel

> Worker de **hot-patch** corriendo dentro de la NUC de **Interpadel**
> (`c:\Users\BreakPoint\Desktop\PUNTAZO_NEW_F1`). NO trabaja sobre el repo web.
> Coordinado por el chat maestro. Etapa corta y acotada — NO toques nada fuera de
> lo descrito.
>
> Es el **HP-equivalente** de WellStreet (`worker-local-HP-wellstreet-config-secrets.md`)
> aplicado a Interpadel. **Primer paso del onboarding Firestore de IP.**

## Origen

El audit de IP (2026-06-03) reportó secretos en claro en
`CONTEXTO/config.json`:

- `nvr.password` (≈ línea 7),
- `github.pat_token = "ghp_…"` (el PAT viejo — **ya rotado 5/5 por el maestro**,
  pero el archivo sigue conteniendo el nuevo token en claro tras la rotación),
- `notifications.telegram_bot_token` (placeholder hoy, pero quedará real cuando
  se configure Telegram con Worker J).

Además, **IP no es repo git** (`.git/` ausente) → no hay `.gitignore` que proteja
nada todavía.

> **Nota**: el PAT ya fue rotado por el maestro. Este worker NO rota credenciales;
> solo saca los secretos del archivo que se versiona/distribuye y establece el
> `.gitignore`.

## Objetivo

1. Inicializar git en el runner de IP con un `.gitignore` que excluya secretos
   desde el primer commit.
2. Separar `config.json` (real, runtime) de `config.example.json` (placeholders,
   distribuible/versionable).
3. Dejar la base lista para el onboarding Firestore (cuando llegue el
   `service_account.json`, que NO debe entrar a git).

## Alcance

### 0. Git init (primero)

- `git init` en `c:\Users\BreakPoint\Desktop\PUNTAZO_NEW_F1`.
- `.gitignore` que excluya: `CONTEXTO/config.json`, `secrets/` (y cualquier
  `service_account*.json`), `*.lock`, `*.pid`, `logs/`, `media/`, `exportados/`,
  `queue/`, `CONTEXTO/registry_backup_*`, `heartbeat.txt`, `.env`.
- Commit inicial "estado pre-HP-IP" del árbol **ya sin secretos versionados**
  (verifica con `git status` que `config.json` NO esté staged).
- Si Isaac NO quiere versionar la máquina: reporta y trabaja sin git (solo separa
  los archivos).

### 1. Auditoría de secretos (sin cambiar valores)

- Grep en TODO el árbol por: `ghp_`, `password`, `secret`, `token`, `api_key`,
  `rtsp://.*:.*@`, claves privadas. Reporta cada hallazgo con `file:line` (NO
  transcribas el valor — solo path + tipo).
- Distingue: ¿qué `config.json` lee el runner en runtime? ¿hay alguno que se
  empaquete/distribuya?

### 2. Saneamiento

- Crear `CONTEXTO/config.example.json` con TODOS los campos presentes pero los
  secretos reemplazados por placeholders (`"<NVR_PASSWORD>"`, `"<GITHUB_PAT>"`,
  `"<TELEGRAM_BOT_TOKEN>"`, etc.). Este es el archivo versionable.
- El `config.json` real (valores vivos) queda gitignored y NO se distribuye.
- Preferir `.env` para los secretos si el `config_loader.py` ya lo soporta
  (el audit notó `config_loader.py:190` prefiere `GITHUB_PAT` env y cae al de
  config.json si no hay env). Migrar al menos el PAT a `.env`.

### 3. Verificación

- El runner sigue arrancando y leyendo su config real (no romper el path de carga).
- `config.json` real NO está en git (`git check-ignore` lo confirma).
- Listar los secretos que quedaron en el archivo real (para que Isaac sepa qué
  hay y qué se migró a `.env`).

## Fuera de alcance (NO toques)

- **Rotar credenciales** — el PAT ya lo rotó el maestro; el pwd NVR **no se
  cambia** (decisión consciente del maestro, riesgo asumido).
- **Cualquier lógica de ingesta, NVR, cola, FFmpeg, visión, dashboard.**
- **Apagar las fuentes Forms/CSV** — eso es Worker M (aunque la opción (1)
  inmediata de poner `forms_csv`/`button_csv` a `""` puede hacerla este worker
  si el maestro lo confirma; por defecto NO, para no mezclar scope).
- **El mapeo de canales.**
- **El repo web.**

## Riesgos

- **Romper el arranque** si mueves/renombras el config que lee en runtime.
  Verifica el path de carga (`config_loader.py`) ANTES de mover nada.
- **`git add .` accidental antes del `.gitignore`**: crea el `.gitignore`
  **antes** del primer `git add`, o el secreto entra al historial desde el commit 1.
- **Falso "sanitizado"**: asegúrate de que `config.example.json` tenga
  placeholders, no una copia con valores reales.

## Validaciones

Cada item ✅ ❌ o ⏭️ con razón:

1. **Git init limpio**: `git status` tras el commit inicial muestra `config.json`
   y `secrets/` como ignorados (no trackeados).
2. **`git check-ignore CONTEXTO/config.json`** → confirma ignorado.
3. **`config.example.json`** existe con placeholders (cero secretos reales).
4. **Runner arranca** leyendo el config real correctamente (procesa un pulso).
5. **PAT en `.env`** (si el loader lo soporta) → el runner usa el token del env,
   no el de config.json.
6. **Inventario de secretos** entregado (path + tipo, sin valores).

## Definition of done

- Runner IP versionado con `.gitignore` que protege secretos desde el commit 1
  (o reportado por qué no se versionó).
- `config.example.json` con placeholders = lo distribuible; `config.json` real
  ignorado.
- Runner verificado arrancando con su config real.
- Inventario de secretos expuestos (sin valores) destacado arriba para Isaac.
- Reporte en formato `docs/workers/README.md`.

## Formato del reporte de regreso

Estándar del README. Destaca arriba, en negrita, la lista de **secretos que
siguen en el archivo real** (tipo + dónde se usan) y cuáles se migraron a `.env`.

---

**Referencias rápidas**:
- HP hermano (WellStreet): `docs/workers/worker-local-HP-wellstreet-config-secrets.md`.
- Siguiente en la secuencia IP: Worker A (`pulses.log`) → B+D+E0 (Firestore).
- Estado consolidado: `docs/plans/nuc-state-2026-06-03.md`.
- Convención: `docs/workers/README.md`.
