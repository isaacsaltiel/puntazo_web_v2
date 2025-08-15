#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import re
import sys
import shutil
import tempfile
import subprocess
from pathlib import Path
from base64 import b64encode
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, Tuple

import requests
import dropbox
from threading import Lock

# =========================
#  Configuración por entorno
# =========================
APP_KEY         = os.environ["DROPBOX_APP_KEY"]
APP_SECRET      = os.environ["DROPBOX_APP_SECRET"]
REFRESH_TOKEN   = os.environ["DROPBOX_REFRESH_TOKEN"]

LOGO1_PATH      = Path(os.environ.get("LOGO1_PATH", "logos/puntazo.png")).resolve()
CLUBS_ROOT      = Path(os.environ.get("CLUBS_ROOT", "clubs")).resolve()
DEBUG           = os.environ.get("DEBUG", "false").lower() in ("1", "true", "yes")
THIRD_LOGO_ON   = os.environ.get("THIRD_LOGO_ENABLED", "false").lower() in ("1", "true", "yes")

# Paralelismo
MAX_PARALLEL         = int(os.environ.get("MAX_PARALLEL", "2"))
THREADS_PER_FFMPEG   = int(os.environ.get("THREADS_PER_FFMPEG", "2"))
BATCH_LIMIT          = int(os.environ.get("BATCH_LIMIT", "20"))
NEWEST_FIRST         = os.environ.get("NEWEST_FIRST", "true").lower() in ("1","true","yes")

# Opcional: pruebas locales sin Dropbox
DRY_RUN        = os.environ.get("DRY_RUN", "false").lower() in ("1", "true", "yes")
LOCAL_INPUT    = Path(os.environ.get("LOCAL_INPUT", "input_demo.mp4")).resolve()
LOCAL_OUTDIR   = Path(os.environ.get("LOCAL_OUTDIR", "_out")).resolve()

# Rutas en Dropbox
CARPETA_ENTRANTES = os.environ.get("ENTRANTES", "/Puntazo/Entrantes")
CARPETA_RAIZ      = os.environ.get("DESTINO_RAIZ", "/Puntazo/Locaciones")

# Patrón de nombre de archivo: loc_can_lado_YYYYMMDD_HHMMSS.mp4
PATRON_VIDEO = re.compile(
    r"^(?P<loc>[^_]+)_(?P<can>[^_]+)_(?P<lado>[^_]+)_(?P<date>\d{8})_(?P<time>\d{6})\.mp4$"
)

# Para logs concurrentes ordenados
print_lock = Lock()
def log(msg: str):
    with print_lock:
        print(msg, flush=True)

# =========================
#  Utilidades
# =========================
def get_access_token() -> str:
    auth_header = b64encode(f"{APP_KEY}:{APP_SECRET}".encode()).decode()
    res = requests.post(
        "https://api.dropbox.com/oauth2/token",
        headers={"Authorization": f"Basic {auth_header}"},
        data={"grant_type": "refresh_token", "refresh_token": REFRESH_TOKEN},
        timeout=60,
    )
    res.raise_for_status()
    return res.json()["access_token"]

def run_cmd(cmd: list, cwd: Path = None) -> None:
    if DEBUG:
        log("[CMD] " + " ".join(map(str, cmd)))
    subprocess.run(cmd, check=True, cwd=cwd)

def ffprobe_dims(p: Path):
    """Devuelve (w,h) del primer stream de video (fallback 1920x1080)."""
    try:
        out = subprocess.check_output(
            ["ffprobe","-v","error","-select_streams","v:0",
             "-show_entries","stream=width,height",
             "-of","csv=s=,:p=0", str(p)],
            text=True, stderr=subprocess.STDOUT, timeout=30
        ).strip()
        w,h = out.split(",")
        return int(w), int(h)
    except Exception:
        return 1920,1080

def has_audio(p: Path) -> bool:
    try:
        out = subprocess.check_output(
            ["ffprobe","-v","error","-select_streams","a:0",
             "-show_entries","stream=codec_name","-of","csv=p=0", str(p)],
            text=True, stderr=subprocess.STDOUT, timeout=30
        ).strip()
        return bool(out)
    except Exception:
        return False

def get_duration(p: Path):
    """Duración en segundos (float) del medio; None si no se puede leer."""
    try:
        out = subprocess.check_output(
            ["ffprobe","-v","error","-show_entries","format=duration",
             "-of","default=noprint_wrappers=1:nokey=1", str(p)],
            text=True, stderr=subprocess.STDOUT, timeout=30
        ).strip()
        return float(out) if out else None
    except Exception:
        return None

def parse_ts_from_name(name: str) -> Optional[Tuple[int,int,int,int,int,int]]:
    m = PATRON_VIDEO.match(name)
    if not m:
        return None
    d = m.group("date"); t = m.group("time")
    try:
        return (int(d[0:4]), int(d[4:6]), int(d[6:8]),
                int(t[0:2]), int(t[2:4]), int(t[4:6]))
    except Exception:
        return None

# =========================
#  Procesamiento de un archivo
# =========================
def procesar_uno(nombre: str, ACCESS_TOKEN: str | None) -> tuple[str, bool, str]:
    """
    Procesa un archivo y devuelve (nombre, ok, msg).
    """
    dbx = None if DRY_RUN else dropbox.Dropbox(ACCESS_TOKEN)

    m = PATRON_VIDEO.match(nombre)
    if not m:
        return nombre, False, "nombre inválido"

    loc  = m.group("loc"); can  = m.group("can"); lado = m.group("lado")

    ruta_origen  = f"{CARPETA_ENTRANTES}/{nombre}"
    ruta_destino = f"{CARPETA_RAIZ}/{loc}/{can}/{lado}/{nombre}"

    log(f"▶️  START: {nombre}  ({loc}/{can}/{lado})")
    workdir = Path(tempfile.mkdtemp(prefix="ffmpeg_plus_")).resolve()

    try:
        # 1) Obtener input
        if DRY_RUN:
            if not LOCAL_INPUT.exists():
                return nombre, False, f"LOCAL_INPUT no existe: {LOCAL_INPUT}"
            shutil.copy2(LOCAL_INPUT, workdir / "input.mp4")
        else:
            try:
                md, resp = dbx.files_download(ruta_origen)
                (workdir / "input.mp4").write_bytes(resp.content)
            except Exception as e:
                return nombre, False, f"descarga falló: {e}"

        # 2) Recursos por club
        club_dir = CLUBS_ROOT / loc
        logo1 = LOGO1_PATH
        logo2 = club_dir / "logo.png"
        logo3 = club_dir / "tercer_logo.png"
        intro = club_dir / "intro.mp4"
        outro = club_dir / "outro.mp4"

        existe_logo2 = logo2.exists()
        existe_logo3 = logo3.exists() and THIRD_LOGO_ON
        existe_intro = intro.exists()
        existe_outro = outro.exists()

        log(f"   • Logo1 OK | Logo2 {'OK' if existe_logo2 else 'NO'} | 3erLogo {'ON' if THIRD_LOGO_ON else 'OFF'}→{'OK' if logo3.exists() else 'NO'} aplicado={'SÍ' if existe_logo3 else 'NO'}")
        log(f"   • Intro {'OK' if existe_intro else 'NO'} | Outro {'OK' if existe_outro else 'NO'}")

        # 3) Overlays → output_con_logo.mp4
        inputs = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-fflags", "+genpts"]
        if DEBUG:
            inputs.append("-report")
        inputs.extend(["-i", str(workdir / "input.mp4")])  # 0
        inputs.extend(["-i", str(logo1)])                  # 1
        in_idx = 2
        idx_logo2 = None
        idx_logo3 = None
        if existe_logo2:
            inputs.extend(["-i", str(logo2)]); idx_logo2 = in_idx; in_idx += 1
        if existe_logo3:
            inputs.extend(["-i", str(logo3)]); idx_logo3 = in_idx; in_idx += 1

        filters = []; current = "[0:v]"; nxt = 1
        filters.append(f"[1:v]scale=300:-1[l1]"); filters.append(f"{current}[l1]overlay=30:30[v{nxt}]"); current=f"[v{nxt}]"; nxt+=1
        if idx_logo2 is not None:
            filters.append(f"[{idx_logo2}:v]scale=200:-1[l2]"); filters.append(f"{current}[l2]overlay=W-w-15:15[v{nxt}]"); current=f"[v{nxt}]"; nxt+=1
        if idx_logo3 is not None:
            filters.append(f"[{idx_logo3}:v]scale=240:-1[l3]"); filters.append(f"{current}[l3]overlay=(W-w)/2:H-h-30[v{nxt}]"); current=f"[v{nxt}]"; nxt+=1
        filter_complex = ";".join(filters)

        cmd_logos = [
            *inputs,
            "-filter_complex", filter_complex,
            "-map", current, "-map", "0:a?",
            "-c:v", "libx264", "-threads", str(THREADS_PER_FFMPEG),
            "-c:a", "aac", "-movflags", "+faststart",
            str(workdir / "output_con_logo.mp4"),
        ]
        try:
            run_cmd(cmd_logos)
        except subprocess.CalledProcessError as e:
            return nombre, False, f"ffmpeg(logo) falló: {e}"

        # 4) Concat
        body = workdir / "output_con_logo.mp4"
        segs = []
        if (CLUBS_ROOT / loc / "intro.mp4").exists(): segs.append(CLUBS_ROOT / loc / "intro.mp4")
        segs.append(body)
        if (CLUBS_ROOT / loc / "outro.mp4").exists(): segs.append(CLUBS_ROOT / loc / "outro.mp4")

        if len(segs) == 1:
            final_path = workdir / "output.mp4"
            shutil.move(body, final_path)
        else:
            W,H = ffprobe_dims(body)
            cmd = ["ffmpeg","-y","-hide_banner","-loglevel","error","-fflags","+genpts"]
            if DEBUG: cmd.append("-report")
            for p in segs: cmd.extend(["-i", str(p)])

            seg_has_audio = [has_audio(p) for p in segs]
            seg_durations = [get_duration(p) or 0.0 for p in segs]

            fparts = []; pairs = []
            for i,_ in enumerate(segs):
                fparts.append(
                    f"[{i}:v]scale={W}:{H}:force_original_aspect_ratio=decrease,"
                    f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS[v{i}]"
                )
                if seg_has_audio[i]:
                    fparts.append(
                        f"[{i}:a]aformat=channel_layouts=stereo,aresample=sample_rate=48000:async=1:first_pts=0,asetpts=PTS-STARTPTS[a{i}]"
                    )
                else:
                    dur = max(seg_durations[i], 0.01)
                    fparts.append(f"anullsrc=r=48000:cl=stereo,atrim=0:{dur},asetpts=PTS-STARTPTS[a{i}]")
                pairs.append(f"[v{i}]"); pairs.append(f"[a{i}]")

            fparts.append("".join(pairs) + f"concat=n={len(segs)}:v=1:a=1[v][a]")
            fgraph = ";".join(fparts)

            cmd += [
                "-filter_complex", fgraph,
                "-map", "[v]", "-map", "[a]",
                "-c:v","libx264","-threads",str(THREADS_PER_FFMPEG),
                "-pix_fmt","yuv420p","-c:a","aac","-movflags","+faststart",
                str(workdir / "output.mp4")
            ]
            try:
                run_cmd(cmd)
            except subprocess.CalledProcessError as e:
                return nombre, False, f"ffmpeg(concat) falló: {e}"

        # 5) Subir / Borrar
        final_path = workdir / "output.mp4"
        if DRY_RUN:
            dest = LOCAL_OUTDIR / loc / can / lado
            dest.mkdir(parents=True, exist_ok=True)
            shutil.copy2(final_path, dest / nombre)
            log(f"✅ [DRY_RUN] Guardado en {dest / nombre}")
        else:
            try:
                with final_path.open("rb") as f:
                    dropbox.Dropbox(ACCESS_TOKEN).files_upload(
                        f.read(), ruta_destino, mode=dropbox.files.WriteMode.overwrite
                    )
                log(f"✅ Subido a {ruta_destino}")
            except Exception as e:
                return nombre, False, f"upload falló: {e}"
            try:
                dropbox.Dropbox(ACCESS_TOKEN).files_delete_v2(ruta_origen)
                log("🗑️  Eliminado original de Entrantes")
            except Exception as e:
                log(f"⚠️ No se pudo borrar el original {ruta_origen}: {e}")

        log(f"✅ DONE: {nombre}")
        return nombre, True, "ok"

    finally:
        try:
            shutil.rmtree(workdir, ignore_errors=True)
        except Exception:
            pass

# =========================
#  Flujo principal
# =========================
def main():
    if not LOGO1_PATH.exists():
        log(f"❌ Falta el logo base (Puntazo): {LOGO1_PATH}")
        sys.exit(1)

    ACCESS_TOKEN = None
    dbx = None
    if not DRY_RUN:
        try:
            ACCESS_TOKEN = get_access_token()
            dbx = dropbox.Dropbox(ACCESS_TOKEN)
        except Exception as e:
            log(f"❌ Error autenticando con Dropbox: {e}")
            sys.exit(1)

    only = os.environ.get("FILE_NAME")
    if only:
        nombres = [only]
        log(f"🔎 Modo archivo único: {only}")
    else:
        if DRY_RUN:
            if LOCAL_INPUT.exists():
                nombre = LOCAL_INPUT.name
                if not PATRON_VIDEO.match(nombre):
                    nombre = "Scorpion_Cancha1_LadoA_20250812_101010.mp4"
                nombres = [nombre]
            else:
                log("✅ DRY_RUN sin input local.")
                return
        else:
            try:
                res = dbx.files_list_folder(CARPETA_ENTRANTES)
                files = [e.name for e in res.entries if isinstance(e, dropbox.files.FileMetadata) and e.name.endswith(".mp4")]
                while res.has_more:
                    res = dbx.files_list_folder_continue(res.cursor)
                    files += [e.name for e in res.entries if isinstance(e, dropbox.files.FileMetadata) and e.name.endswith(".mp4")]

                def ts(n):
                    m=PATRON_VIDEO.match(n)
                    if not m: return None
                    d=m.group("date"); t=m.group("time")
                    try: return (int(d[0:4]),int(d[4:6]),int(d[6:8]),int(t[0:2]),int(t[2:4]),int(t[4:6]))
                    except: return None

                with_ts=[f for f in files if ts(f) is not None]
                no_ts=[f for f in files if ts(f) is None]

                with_ts=sorted(with_ts, key=lambda n: ts(n))
                if NEWEST_FIRST:
                    with_ts=list(reversed(with_ts))

                plan=(with_ts+no_ts)[:BATCH_LIMIT]

                log(f"🔭 Encontrados: {len(files)} en {CARPETA_ENTRANTES}")
                log(f"🗂️  Orden: {'más recientes primero' if NEWEST_FIRST else 'más antiguos primero'}  |  Límite lote: {BATCH_LIMIT}")
                if not plan:
                    log("✅ Nada que procesar.")
                    return
                log("📋 Plan de procesamiento (en orden):")
                for i,f in enumerate(plan,1):
                    log(f"  {i:02d}. {f}")

                nombres = plan

            except Exception as e:
                log(f"❌ No se pudo listar {CARPETA_ENTRANTES}: {e}")
                sys.exit(1)

    log(f"⚙️ Paralelo={MAX_PARALLEL}, hilos/ffmpeg={THREADS_PER_FFMPEG}")
    ok_count = 0
    fail_count = 0

    with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as ex:
        futs = {ex.submit(procesar_uno, n, ACCESS_TOKEN): n for n in nombres}
        for fut in as_completed(futs):
            nombre = futs[fut]
            try:
                _, ok, msg = fut.result()
                if ok:
                    ok_count += 1
                else:
                    fail_count += 1
                    log(f"❌ FAIL: {nombre} → {msg}")
            except Exception as e:
                fail_count += 1
                log(f"❌ EXC: {nombre} → {e}")

    total = ok_count + fail_count
    log(f"\n🏁 Resumen: TOTAL={total}  OK={ok_count}  FALLIDOS={fail_count}")
    if ok_count == 0 and fail_count > 0:
        sys.exit(1)

if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        log(f"❌ Subproceso falló: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        log("\n⏹️ Cancelado por el usuario.")
        sys.exit(130)
