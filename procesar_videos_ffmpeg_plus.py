#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import re
import sys
import json
import shutil
import tempfile
import subprocess
from pathlib import Path
from base64 import b64encode

import requests
import dropbox

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

# Opcional: pruebas locales sin Dropbox
DRY_RUN        = os.environ.get("DRY_RUN", "false").lower() in ("1", "true", "yes")
LOCAL_INPUT    = Path(os.environ.get("LOCAL_INPUT", "input_demo.mp4")).resolve()
LOCAL_OUTDIR   = Path(os.environ.get("LOCAL_OUTDIR", "_out")).resolve()

# Rutas en Dropbox
CARPETA_ENTRANTES = "/Puntazo/Entrantes"
CARPETA_RAIZ      = "/Puntazo/Locaciones"

# Patrón de nombre de archivo: loc_can_lado_YYYYMMDD_HHMMSS.mp4
PATRON_VIDEO = re.compile(r"^(?P<loc>[^_]+)_(?P<can>[^_]+)_(?P<lado>[^_]+)_(\d{8})_(\d{6})\.mp4$")

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
        print("[CMD]", " ".join(map(str, cmd)))
    subprocess.run(cmd, check=True, cwd=cwd)

def safe_unlink(p: Path):
    try:
        if p.exists():
            p.unlink()
    except Exception:
        pass

def ffprobe_dims(p: Path):
    """Devuelve (w,h) del primer stream de video."""
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
        return 1920,1080  # fallback

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

# =========================
#  Flujo principal
# =========================
def main():
    if not LOGO1_PATH.exists():
        print(f"❌ Falta el logo base (Puntazo): {LOGO1_PATH}")
        sys.exit(1)

    if DRY_RUN:
        print("🧪 DRY_RUN=TRUE → no se usa Dropbox. Se procesará un input local.")
        if not LOCAL_INPUT.exists():
            print(f"❌ LOCAL_INPUT no existe: {LOCAL_INPUT}")
            sys.exit(1)
    else:
        try:
            ACCESS_TOKEN = get_access_token()
        except Exception as e:
            print(f"❌ Error autenticando con Dropbox: {e}")
            sys.exit(1)
        dbx = dropbox.Dropbox(ACCESS_TOKEN)

    print("🔎 Buscando videos nuevos en Entrantes..." if not DRY_RUN else "🔎 Preparando input local...")
    entries = []

    if DRY_RUN:
        nombre = LOCAL_INPUT.name
        if not PATRON_VIDEO.match(nombre):
            nombre = "Scorpion_Cancha1_LadoA_20250812_101010.mp4"
        entries = [{"name": nombre, "local": True}]
    else:
        try:
            result = dbx.files_list_folder(CARPETA_ENTRANTES)
        except Exception as e:
            print(f"❌ No se pudo listar {CARPETA_ENTRANTES}: {e}")
            sys.exit(1)
        videos = [e for e in result.entries if isinstance(e, dropbox.files.FileMetadata) and e.name.endswith(".mp4")]
        while result.has_more:
            result = dbx.files_list_folder_continue(result.cursor)
            videos.extend([e for e in result.entries if isinstance(e, dropbox.files.FileMetadata) and e.name.endswith(".mp4")])
        entries = [{"name": e.name, "id": e.id} for e in videos]

    if not entries:
        print("✅ No hay videos nuevos por procesar.")
        return

    for item in entries:
        nombre = item["name"]
        m = PATRON_VIDEO.match(nombre)
        if not m:
            print(f"⚠️ Nombre inválido, se omite: {nombre}")
            continue

        loc  = m.group("loc")
        can  = m.group("can")
        lado = m.group("lado")

        ruta_origen  = f"{CARPETA_ENTRANTES}/{nombre}"
        ruta_destino = f"{CARPETA_RAIZ}/{loc}/{can}/{lado}/{nombre}"

        print(f"\n🚀 Procesando: {nombre}")
        print(f"   → loc={loc}  can={can}  lado={lado}")

        workdir = Path(tempfile.mkdtemp(prefix="ffmpeg_plus_")).resolve()

        try:
            # 1) Obtener input
            if DRY_RUN:
                shutil.copy2(LOCAL_INPUT, workdir / "input.mp4")
                ruta_origen = f"[local]{LOCAL_INPUT}"
            else:
                try:
                    md, resp = dbx.files_download(ruta_origen)
                    (workdir / "input.mp4").write_bytes(resp.content)
                except Exception as e:
                    print(f"❌ Error descargando {ruta_origen}: {e}")
                    continue

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

            print(f"   • Logo1: OK  | Logo2(club): {'OK' if existe_logo2 else 'NO'}")
            print(f"   • Tercer logo: {'ON' if THIRD_LOGO_ON else 'OFF'} | archivo: {'OK' if logo3.exists() else 'NO'} | aplicado: {'SÍ' if existe_logo3 else 'NO'}")
            print(f"   • Intro: {'OK' if existe_intro else 'NO'} | Outro: {'OK' if existe_outro else 'NO'}")

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
                inputs.extend(["-i", str(logo2)])
                idx_logo2 = in_idx; in_idx += 1
            if existe_logo3:
                inputs.extend(["-i", str(logo3)])
                idx_logo3 = in_idx; in_idx += 1

            filters = []
            current = "[0:v]"
            nxt = 1

            # logo1 arriba-izq
            filters.append(f"[1:v]scale=300:-1[l1]")
            filters.append(f"{current}[l1]overlay=30:30[v{nxt}]")
            current = f"[v{nxt}]"; nxt += 1

            # logo2 arriba-der
            if idx_logo2 is not None:
                filters.append(f"[{idx_logo2}:v]scale=200:-1[l2]")
                filters.append(f"{current}[l2]overlay=W-w-15:15[v{nxt}]")
                current = f"[v{nxt}]"; nxt += 1

            # logo3 abajo-centro
            if idx_logo3 is not None:
                filters.append(f"[{idx_logo3}:v]scale=240:-1[l3]")
                filters.append(f"{current}[l3]overlay=(W-w)/2:H-h-30[v{nxt}]")
                current = f"[v{nxt}]"; nxt += 1

            filter_complex = ";".join(filters)

            cmd_logos = inputs + [
                "-filter_complex", filter_complex,
                "-map", current,          # salida de video filtrado
                "-map", "0:a?",           # audio si existe
                "-c:v", "libx264",
                "-c:a", "aac",
                "-movflags", "+faststart",
                str(workdir / "output_con_logo.mp4"),
            ]

            try:
                run_cmd(cmd_logos)
            except subprocess.CalledProcessError as e:
                print(f"❌ Error aplicando logos a {nombre}: {e}")
                continue

            # 4) Concat con FILTER (normaliza PTS/dimensiones)
            body = workdir / "output_con_logo.mp4"
            segs = []
            if existe_intro: segs.append(intro)
            segs.append(body)
            if existe_outro: segs.append(outro)

            if len(segs) == 1:
                final_path = workdir / "output.mp4"
                shutil.move(body, final_path)
            else:
                # dimensiones del body para igualar intro/outro
                W,H = ffprobe_dims(body)

                # ¿todos los segmentos tienen audio?
                all_audio = all(has_audio(p) for p in segs)

                # Entradas
                cmd = ["ffmpeg","-y","-hide_banner","-loglevel","error","-fflags","+genpts"]
                if DEBUG:
                    cmd.append("-report")
                for p in segs:
                    cmd.extend(["-i", str(p)])

                # Construir filter_complex
                fparts = []
                vlabels = []
                alabels = []

                for i,_p in enumerate(segs):
                    fparts.append(f"[{i}:v]scale={W}:{H}:force_original_aspect_ratio=decrease,setsar=1,setpts=PTS-STARTTIME[v{i}]")
                    vlabels.append(f"[v{i}]")
                    if all_audio:
                        fparts.append(f"[{i}:a]aresample=async=1:first_pts=0[a{i}]")
                        alabels.append(f"[a{i}]")

                if all_audio:
                    concat_line = "".join(vlabels + alabels) + f"concat=n={len(segs)}:v=1:a=1[v][a]"
                else:
                    concat_line = "".join(vlabels) + f"concat=n={len(segs)}:v=1:a=0[v]"

                fparts.append(concat_line)
                fgraph = ";".join(fparts)

                cmd += ["-filter_complex", fgraph, "-map", "[v]"]
                if all_audio:
                    cmd += ["-map", "[a]", "-c:a", "aac"]
                else:
                    cmd += ["-an"]
                cmd += ["-c:v","libx264","-pix_fmt","yuv420p","-movflags","+faststart", str(workdir / "output.mp4")]

                try:
                    run_cmd(cmd)
                except subprocess.CalledProcessError as e:
                    print(f"❌ Error al concatenar intro/outro en {nombre}: {e}")
                    continue

            # 5) Subir / Guardar
            final_path = workdir / "output.mp4"
            if DRY_RUN:
                dest = LOCAL_OUTDIR / loc / can / lado
                dest.mkdir(parents=True, exist_ok=True)
                shutil.copy2(final_path, dest / nombre)
                print(f"✅ [DRY_RUN] Guardado en {dest / nombre}")
            else:
                try:
                    with final_path.open("rb") as f:
                        dbx.files_upload(f.read(), ruta_destino, mode=dropbox.files.WriteMode.overwrite)
                    print(f"✅ Subido a {ruta_destino}")
                except Exception as e:
                    print(f"❌ Error subiendo a {ruta_destino}: {e}")
                    continue
                # 6) Borrar original
                try:
                    dbx.files_delete_v2(ruta_origen)
                    print("🗑️  Eliminado original de Entrantes")
                except Exception as e:
                    print(f"⚠️ No se pudo borrar el original {ruta_origen}: {e}")

        finally:
            try:
                shutil.rmtree(workdir, ignore_errors=True)
            except Exception:
                pass

    print("\n🏁 Todos los videos han sido procesados.")

if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        print(f"❌ Subproceso falló: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n⏹️ Cancelado por el usuario.")
        sys.exit(130)
