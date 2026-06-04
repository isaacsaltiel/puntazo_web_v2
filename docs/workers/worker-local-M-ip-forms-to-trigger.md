# Worker Local M — Migrar Interpadel de Forms/CSV a POST /trigger (Cloudflare Tunnel)

> Worker de **implementación** corriendo dentro de la NUC de **Interpadel**
> (`c:\Users\BreakPoint\Desktop\PUNTAZO_NEW_F1`). NO trabaja sobre el repo web.
> Coordinado por el chat maestro.
>
> **Branch base**: `master` local del repo NUC (IP no es repo git aún — ver
> Riesgos / depende de HP-IP que hace `git init`). **Depende de Worker K**
> (el endpoint `POST /trigger` del dashboard debe existir — en IP ya existe en
> `core/dashboard.py`). Resuelve la **opción (3)** de la decisión 3 del maestro.

## Objetivo

Eliminar de raíz el polling de Google Drive (Forms CSV + Button CSV) en
Interpadel, migrando la ingesta de pulsos externos a **`POST /trigger`** del
dashboard Flask, expuesto a internet vía **Cloudflare Tunnel**.

Cierra el hueco del cruce de colas (`BUTTON_QUEUE_CSV` apuntaba a `BP_Puntazo`)
de forma **definitiva** — la opción (1) inmediata (setear `forms_csv`/`button_csv`
a `""`) ya lo mitigó; M elimina el mecanismo Forms por completo.

## Contexto que ya sabemos (del audit IP 2026-06-03)

- IP ingiere hoy por: Arduino serial (BTN:0..3 → cam 3..6), **Forms CSV**
  (polling Drive cada 60s), **Button CSV** (polling cada 2s), teclado, visión-pose.
- El endpoint `POST /trigger` **ya existe** en `core/dashboard.py` con auth
  `X-Puntazo-Token` + rate-limit 20s/cam. **Está listo, solo falta exponerlo.**
- El Apps Script de migración ya está escrito: `CONTEXTO/apps_script_trigger.gs`,
  pero con `NUC_BASE_URL = "http://TU_IP_PUBLICA_O_DDNS:5050"` (placeholder).
- Bloqueado por: (a) no hay Cloudflare Tunnel arriba; (b) no se hizo port-forward;
  (c) `PUNTAZO_DASH_TOKEN` no seteado.
- El mount de Drive: `G:\Mi unidad\BP_Puntazo\puntazo_queue.csv` y
  `...puntazo_button_queue.csv` (con el typo `BP_Puntazo`).

## Arquitectura relevante

- **Cloudflare Tunnel** (`cloudflared`): expone `localhost:5050` a un hostname
  público con TLS, sin port-forward ni IP pública. Corre como servicio Windows.
- **`POST /trigger`** (dashboard, Worker K): recibe `{ cam, ... }` con header
  `X-Puntazo-Token`, llama a `register_press(cam, ts)`.
- **Apps Script**: el form de Google dispara un `UrlFetchApp.fetch(NUC_BASE_URL +
  "/trigger", { headers: { "X-Puntazo-Token": ... } })` en vez de escribir a Drive.

## Archivos importantes a revisar

- `core/dashboard.py` — el handler `POST /trigger` (auth, rate-limit, `register_press`).
- `CONTEXTO/apps_script_trigger.gs` — el Apps Script a completar.
- `CONTEXTO/config.json` — `NUC_BASE_URL`, `PUNTAZO_DASH_TOKEN`, fuentes
  `forms_csv` / `button_csv` (a apagar definitivamente).
- `core/sources/chain.py`, `core/sources/forms_csv.py`, `core/sources/button_csv.py`
  — las fuentes legacy a desregistrar.

## Alcance

1. **Auditar** el `POST /trigger` actual y el registro de fuentes en el arranque.
   Confirmar que `register_press` es el mismo seam que usa el botón. `file:line`.
2. **Instalar y configurar Cloudflare Tunnel** (`cloudflared`) como servicio
   Windows, apuntando a `localhost:5050`. Hostname público estable.
3. **Setear `PUNTAZO_DASH_TOKEN`** (env / config real, NO versionado) y verificar
   que el dashboard exige el header.
4. **Completar el Apps Script**: `NUC_BASE_URL` = hostname del tunnel, header de
   token, mapeo de cancha→cam correcto. Desplegarlo en el form de Google.
5. **Apagar las fuentes Forms/Button CSV**: desregistrarlas del arranque (no solo
   `""`, sino quitar el polling de Drive). Conservar Arduino + teclado + visión.
6. **Verificar end-to-end**: un submit del Form llega vía tunnel → `/trigger` →
   clip generado, sin tocar Drive.

## Fuera de alcance

- **Cambios al repo web.**
- **El dashboard en sí** (es Worker K; aquí solo se expone y se usa su `/trigger`).
- **Apagar Arduino / teclado / visión-pose** — siguen como fuentes válidas.
- **BP/WS** — esta migración es específica de IP.
- **Sanear secretos** (token en config) — eso es HP-IP.

## Riesgos

- **Tunnel expone `/trigger` a internet**: sin `PUNTAZO_DASH_TOKEN` fuerte,
  cualquiera dispara clips. Token obligatorio + rate-limit verificado ANTES de
  exponer. Considerar restringir por Cloudflare Access si Isaac quiere doble capa.
- **`/api/stop` también queda expuesto**: el tunnel expone TODO el dashboard. Un
  atacante con el token podría parar el runner. Confirmar que el token protege
  `/api/stop` igual que `/trigger`, o restringir esas rutas a LAN.
- **Pérdida de pulsos durante el corte**: si se apaga Forms CSV antes de que el
  tunnel esté validado, hay ventana sin ingesta externa. Validar `/trigger`
  end-to-end ANTES de apagar el CSV.
- **`cloudflared` se cae**: si el servicio muere, los Forms dejan de llegar. El
  watchdog (Worker J) o un health-check debería vigilarlo. Anotar como follow-up.
- **Rate-limit 20s/cam** puede descartar pulsos legítimos rápidos en cancha
  concurrida. Confirmar que el límite tiene sentido para el caso real.

## Validaciones

Cada item ✅ ❌ o ⏭️ con razón:

1. **Tunnel arriba**: `cloudflared` como servicio, el hostname público responde a
   `GET /` (dashboard) con TLS.
2. **Auth**: `POST /trigger` sin token → 401/403. Con token válido → 200 + encola.
3. **End-to-end Form**: submit real del Google Form → llega vía tunnel → clip de
   la cámara correcta generado y subido a Dropbox.
4. **Mapeo cancha→cam**: el Form de Cancha N dispara la cámara N correcta (3-6).
5. **CSV apagado**: tras desregistrar Forms/Button CSV, NO hay polling a Drive
   (verificar en logs que no se lee `G:\...`).
6. **Fuentes restantes intactas**: Arduino/teclado/visión siguen disparando.
7. **Sin pérdida en el corte**: documentar que `/trigger` se validó antes de
   apagar el CSV.
8. **Resiliencia tunnel**: matar `cloudflared` → documentar qué pasa (¿lo
   relanza el watchdog? ¿health-check?).

## Definition of done

- Cloudflare Tunnel activo como servicio, exponiendo `localhost:5050` con TLS.
- `PUNTAZO_DASH_TOKEN` seteado y exigido por el dashboard.
- Apps Script desplegado apuntando al tunnel, disparando `/trigger`.
- Forms/Button CSV desregistrados (cero polling de Drive).
- Validaciones 1-8 documentadas.
- Branch `worker-local-M-ip-forms-to-trigger` con commit SHA (o reporte sin branch
  si IP aún no se versiona — coordinar con HP-IP que hace `git init`).
- Reporte en formato `docs/workers/README.md`.

## Formato del reporte de regreso

Ver `docs/workers/README.md`. Sí o sí incluir:

- Hostname público del tunnel (sin el token).
- Confirmación de que `/api/stop` queda protegido o restringido a LAN.
- Cómo se vigila la caída de `cloudflared` (o si queda como follow-up).
- Logs que confirmen cero polling de Drive tras el corte.

---

**Referencias rápidas**:
- Worker K (provee `/trigger`): `docs/workers/worker-local-K-dashboard-flask-port.md`.
- HP-IP (git init + secretos): `docs/workers/worker-local-HP-IP-secrets-saneamiento.md`.
- Apps Script fuente: `CONTEXTO/apps_script_trigger.gs` (en la NUC IP).
- Estado consolidado: `docs/plans/nuc-state-2026-06-03.md`.
- Convención: `docs/workers/README.md`.
