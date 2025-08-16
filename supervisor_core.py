#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os, sys, time, json, datetime, subprocess
import requests
import dropbox

# === Entorno ===
DROPBOX_APP_KEY       = os.environ["DROPBOX_APP_KEY"]
DROPBOX_APP_SECRET    = os.environ["DROPBOX_APP_SECRET"]
DROPBOX_REFRESH_TOKEN = os.environ["DROPBOX_REFRESH_TOKEN"]

PAT_GITHUB        = os.environ.get("PAT_GITHUB", "")
REPO              = os.environ.get("GITHUB_REPOSITORY", "")
PROC_WORKFLOW     = os.environ.get("PROC_WORKFLOW_NAME", "Procesar videos con FFmpeg")
GESTION_SCRIPT    = os.environ.get("GESTION_SCRIPT", "gestion_indice_ci.py")

HB_PATH           = os.environ.get("HB_PATH", "/PUNTAZO/ENTRANTES/heartbeats.txt")
HB_TTL_SECONDS    = int(os.environ.get("HB_TTL_SECONDS", "300"))  # 5 min
SLEEP_SECONDS     = int(os.environ.get("LOOP_SLEEP_SECONDS", "60"))
MAX_RUNTIME       = int(os.environ.get("MAX_RUNTIME_SECONDS", "34800"))  # ~5h48m

def log(msg: str):
    print(msg, flush=True)

def dbx_client():
    return dropbox.Dropbox(
        app_key=DROPBOX_APP_KEY,
        app_secret=DROPBOX_APP_SECRET,
        oauth2_refresh_token=DROPBOX_REFRESH_TOKEN
    )

def read_heartbeat(dbx: dropbox.Dropbox):
    """
    Devuelve (active: bool, activos: list[(loc,can,lado)] ) según HB_TTL_SECONDS.
    Formato esperado en heartbeats.txt:
    {"v":1,"updated":"...Z","pis":{"piid":{"start":"...Z","last":"...Z","beats":N,"loc":"...","can":"...","lado":"..."}, ...}}
    """
    try:
        md, resp = dbx.files_download(HB_PATH)
        content = resp.content.decode("utf-8").strip()
        if not content:
            return False, []
        data = json.loads(content)
    except dropbox.exceptions.ApiError:
        return False, []
    except Exception as e:
        log(f"⚠️  No se pudo leer/parsing heartbeat: {e}")
        return False, []

    now = datetime.datetime.utcnow()
    activos = []
    pis = data.get("pis") or {}
    for _, v in pis.items():
        last = v.get("last")
        loc  = v.get("loc"); can = v.get("can"); lado = v.get("lado")
        if not last:
            continue
        try:
            dt = datetime.datetime.fromisoformat(last.replace("Z",""))
        except Exception:
            continue
        if (now - dt).total_seconds() <= HB_TTL_SECONDS:
            if loc and can and lado:
                activos.append((loc, can, lado))
    return (len(activos) > 0), sorted(set(activos))

def procesar_running() -> bool:
    """
    ¿Hay un run 'in_progress' del workflow 'Procesar videos con FFmpeg'?
    """
    if not PAT_GITHUB or not REPO:
        return False
    try:
        h = {"Authorization": f"Bearer {PAT_GITHUB}", "Accept": "application/vnd.github+json"}
        base = f"https://api.github.com/repos/{REPO}/actions"
        r = requests.get(f"{base}/workflows", headers=h, timeout=20)
        r.raise_for_status()
        wf = next((w for w in r.json().get("workflows", []) if w.get("name") == PROC_WORKFLOW), None)
        if not wf:
            log(f"⚠️  Workflow '{PROC_WORKFLOW}' no encontrado por nombre.")
            return False
        rr = requests.get(f"{base}/workflows/{wf['id']}/runs?status=in_progress&per_page=1", headers=h, timeout=20)
        rr.raise_for_status()
        return int(rr.json().get("total_count", 0)) > 0
    except Exception as e:
        log(f"⚠️  Error consultando runs de '{PROC_WORKFLOW}': {e}")
        return False

def trigger_procesar():
    """
    Dispara repository_dispatch → event_type=procesar_video_ffmpeg (mismo repo).
    """
    if not PAT_GITHUB or not REPO:
        log("ℹ️  Sin PAT_GITHUB o REPO; no se dispara procesar.")
        return
    try:
        url = f"https://api.github.com/repos/{REPO}/dispatches"
        h   = {"Authorization": f"Bearer {PAT_GITHUB}", "Accept": "application/vnd.github+json"}
        payload = {"event_type": "procesar_video_ffmpeg"}
        r = requests.post(url, headers=h, json=payload, timeout=20)
        if r.status_code >= 300:
            log(f"⚠️  No se pudo disparar procesar: {r.status_code} {r.text}")
        else:
            log("🎬 Disparado: Procesar videos con FFmpeg")
    except Exception as e:
        log(f"⚠️  Error disparando procesar: {e}")

def run_gestion(loc: str, can: str, lado: str):
    """
    Ejecuta tu script de gestión para un trio (loc,can,lado).
    No falla el supervisor si este paso da error: registramos y seguimos.
    """
    cmd = [sys.executable, GESTION_SCRIPT, "--loc", loc, "--can", can, "--lado", lado]
    log(f"🗂️  Gestionando índice → {loc}/{can}/{lado}")
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        log(f"⚠️  Gestion falló para {loc}/{can}/{lado}: {e}")

def main():
    start = time.time()
    dbx = dbx_client()
    log("🚀 Supervisor Puntazo iniciado")

    while True:
        # fin por tiempo total
        if time.time() - start > MAX_RUNTIME:
            log("⏹️  Fin por ventana máxima del supervisor.")
            break

        # 1) Heartbeat
        active, activos = read_heartbeat(dbx)
        log(f"HB activo: {active} | locaciones activas: {len(activos)}")

        if not active:
            log("🛑 No hay latidos recientes (≤ TTL). Supervisor termina.")
            break

        # 2) Procesar videos (si no hay uno corriendo)
        if not procesar_running():
            trigger_procesar()
        else:
            log("⏭️  Ya hay 'Procesar videos con FFmpeg' en progreso.")

        # 3) Gestionar índice para locaciones activas (ligero, 1 vez por minuto)
        for (loc, can, lado) in activos:
            run_gestion(loc, can, lado)

        # 4) Espera 60s y repite
        time.sleep(SLEEP_SECONDS)

    log("✅ Supervisor Puntazo terminó.")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("⏹️  Cancelado por el usuario.")
        sys.exit(130)
    except Exception as e:
        log(f"💥 Error fatal: {e}")
        sys.exit(1)
