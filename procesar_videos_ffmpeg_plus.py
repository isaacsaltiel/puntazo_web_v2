#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import re
import sys
import time
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

LOGO1_PATH      = Path(os.environ.get("LOGO1_PATH", "assets/logos/puntazo.png")).resolve()
CLUBS_ROOT      = Path(os.environ.get("CLUBS_ROOT", "clubs")).resolve()
DEBUG           = os.environ.get("DEBUG", "false").lower() in ("1", "true", "yes")
THIRD_LOGO_ON   = os.environ.get("THIRD_LOGO_ENABLED", "false").lower() in ("1", "true", "yes")

# Rutas en Dropbox (ajusta si cambias tu layout)
CARPETA_ENTRANTES = "/Puntazo/Entrantes"
CARPETA_RAIZ      = "/Puntazo/Locaciones"

# Patrón de nombre de archivo: loc_can_lado_YYYYMMDD_HHMMSS.mp4
PATRON_VIDEO = re.compile(
    r"^(?P<loc>[^_]+)_(?P<can>[^_]+)_(?P<lado>[^_]+)_(\d{8})_(\d{6})\.mp4$"
)

# =========================
#  Utilidades
# =========================
def get_access_token() -> str:
    """Intercambia refresh token por access token (Dropbox OAuth2)."""
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
    """Ejecuta un comando mostrando errores si ocurren."""
    if DEBUG:
        print("[CMD]", " ".join(map(str, cmd)))
    subprocess.run(cmd, check=True, cwd=cwd)

def safe_unlink(p: Path):
    try:
        if p.exists():
            p.unlink()
    except Exception:
        pass

def bool_str(b: bool) -> str:
    return "TRUE" if b else "FALSE"

# =========================
#  Flujo principal
# =========================
def main():
    # Validaciones mínimas
    if not LOGO1_PATH.exists():
        print(f"❌ Falta el logo base (Puntazo): {LOGO1_PATH}")
        sys.exit(1)

    if DEBUG:
        print(f"[DEBUG] LOGO1_PATH={LOGO1_PATH}")
        print(f"[DEBUG] CLUBS_ROOT={CLUBS_ROOT}")
        print(f"[DEBUG] THIRD_LOGO_ENABLED={bool_str(THIRD_LOGO_ON)}")

    # Autenticación Dropbox
    try:
        ACCESS_TOKEN = get_access_token()
    except Exception as e:
        print(f"❌ Error autenticando con Dropbox: {e}")
        sys.exit(1)

    dbx = dropbox.Dropbox(ACCESS_TOKEN)

    # Listar todos los .mp4 en Entrantes (incluye paginación)
    print("🔎 Buscando videos nuevos en Entrantes...")
    try:
        result = dbx.files_list_folder(CARPETA_ENTRANTES)
    except Exception as e:
        print(f"❌ No se pudo listar {CARPETA_ENTRANTES}: {e}")
        sys.exit(1)

    videos = [e for e in result.entries if isinstance(e, dropbox.files.FileMetadata) and e.name.endswith(".mp4")]
    while result.has_more:
        result = dbx.files_list_folder_continue(result.cursor)
        videos.extend([e for e in result.entries if isinstance(e, dropbox.files.FileMetadata) and e.name.endswith(".mp4")])

    if not videos:
        print("✅ No hay videos nuevos por procesar.")
        return

    # Procesar cada video
    for entry in videos:
        nombre = entry.name
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

        # Temp dir aislado por archivo
        workdir = Path(tempfile.mkdtemp(prefix="ffmpeg_plus_")).resolve()

        try:
            # 1) Descargar video original
            try:
                md, resp = dbx.files_download(ruta_origen)
                (workdir / "input.mp4").write_bytes(resp.content)
            except Exception as e:
                print(f"❌ Error descargando {ruta_origen}: {e}")
                continue

            # 2) Localizar recursos del club
            club_dir = CLUBS_ROOT / loc
            logo1 = LOGO1_PATH  # siempre
            logo2 = club_dir / "logo.png"
            logo3 = club_dir / "tercer_logo.png"
            intro = club_dir / "intro.mp4"
            outro = club_dir / "outro.mp4"

            existe_logo2 = logo2.exists()
            existe_logo3 = logo3.exists() and THIRD_LOGO_ON
            existe_intro = intro.exists()
            existe_outro = outro.exists()

            if DEBUG:
                print(f"[DEBUG] club_dir={club_dir}")
                print(f"[DEBUG] logo2={logo2} exists={existe_logo2}")
                print(f"[DEBUG] logo3={logo3} exists&enabled={existe_logo3}")
                print(f"[DEBUG] intro={intro} exists={existe_intro}")
                print(f"[DEBUG] outro={outro} exists={existe_outro}")

            # 3) Aplicar logos sobre input.mp4 → output_con_logo.mp4
            # Construcción dinámica de -filter_complex
            inputs = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
            if DEBUG:
                inputs.append("-report")

            # Inputs: 0=input.mp4, 1=logo1, 2=logo2?, 3=logo3?
            inputs.extend(["-i", str(workdir / "input.mp4")])
            inputs.extend(["-i", str(logo1)])
            if existe_logo2:
                inputs.extend(["-i", str(logo2)])
            if existe_logo3:
                inputs.extend(["-i", str(logo3)])

            # Construimos filtros
            filters = []
            current = "[0:v]"  # arranca del video base
            next_label_idx = 1

            # logo1 (arriba-izquierda, 30:30) escala 300px ancho
            filters.append(f"[1:v]scale=300:-1[l1]")
            filters.append(f"{current}[l1]overlay=30:30[v{next_label_idx}]")
            current = f"[v{next_label_idx}]"
            next_label_idx += 1

            # logo2 (arriba-derecha, W-w-15:15) escala 200px ancho
            if existe_logo2:
                # En este caso, su índice de stream depende de si hay logo3 o no,
                # pero como usamos labels no importa: el logo2 SIEMPRE es la tercera entrada visible si existe.
                # Calculemos su número real:
                # 0=input, 1=logo1, 2=logo2 si existe, 3=logo3 si existe (si no, logo3 no está)
                idx_logo2 = 2
                filters.append(f"[{idx_logo2}:v]scale=200:-1[l2]")
                filters.append(f"{current}[l2]overlay=W-w-15:15[v{next_label_idx}]")
                current = f"[v{next_label_idx}]"
                next_label_idx += 1

            # logo3 (abajo-centro, (W-w)/2:H-h-30) escala 220-260px ancho
            if existe_logo3:
                # Índice de logo3 depende de si hay logo2:
                # si logo2 existe → logo3 es 3, si no → 2
                idx_logo3 = 3 if existe_logo2 else 2
                filters.append(f"[{idx_logo3}:v]scale=240:-1[l3]")
                filters.append(f"{current}[l3]overlay=(W-w)/2:H-h-30[v{next_label_idx}]")
                current = f"[v{next_label_idx}]"
                next_label_idx += 1

            filter_complex = ";".join(filters)

            cmd_logos = inputs + [
                "-filter_complex", filter_complex,
                "-map", "0:a?",              # incluir audio si existe
                "-c:v", "libx264",
                "-c:a", "aac",
                "-shortest",
                str(workdir / "output_con_logo.mp4"),
            ]

            try:
                run_cmd(cmd_logos)
            except subprocess.CalledProcessError as e:
                print(f"❌ Error aplicando logos a {nombre}: {e}")
                continue

            # 4) Concatenar intro + body + outro → output.mp4
            concat_list = []
            if existe_intro:
                concat_list.append(str(intro))
            concat_list.append(str(workdir / "output_con_logo.mp4"))
            if existe_outro:
                concat_list.append(str(outro))

            if len(concat_list) == 1:
                # No hay intro/outro; renombrar directamente
                final_path = workdir / "output.mp4"
                shutil.move(workdir / "output_con_logo.mp4", final_path)
            else:
                # Crear concat.txt
                concat_txt = workdir / "concat.txt"
                concat_txt.write_text("\n".join([f"file '{p}'" for p in concat_list]), encoding="utf-8")

                # Usar re-encode final para máxima compatibilidad
                cmd_concat = [
                    "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                    "-f", "concat",
                    "-safe", "0",
                    "-i", str(concat_txt),
                    "-c:v", "libx264",
                    "-pix_fmt", "yuv420p",
                    "-c:a", "aac",
                    str(workdir / "output.mp4"),
                ]
                try:
                    run_cmd(cmd_concat)
                except subprocess.CalledProcessError as e:
                    print(f"❌ Error al concatenar intro/outro en {nombre}: {e}")
                    continue
                if DEBUG:
                    # Dejar concat.txt para diagnóstico; si no, limpiar
                    pass
                else:
                    safe_unlink(concat_txt)

            # 5) Subir a Dropbox destino
            final_path = workdir / "output.mp4"
            try:
                with final_path.open("rb") as f:
                    dbx.files_upload(
                        f.read(),
                        ruta_destino,
                        mode=dropbox.files.WriteMode.overwrite
                    )
                print(f"✅ Subido a {ruta_destino}")
            except Exception as e:
                print(f"❌ Error subiendo a {ruta_destino}: {e}")
                continue

            # 6) Borrar original de Entrantes
            try:
                dbx.files_delete_v2(ruta_origen)
                print("🗑️  Eliminado original de Entrantes")
            except Exception as e:
                print(f"⚠️ No se pudo borrar el original {ruta_origen}: {e}")

        finally:
            # 7) Limpieza de temporales
            try:
                shutil.rmtree(workdir, ignore_errors=True)
            except Exception:
                pass

    print("\n🏁 Todos los videos han sido procesados.")

# =========================
#  Entrypoint
# =========================
if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        # Captura de errores de ffmpeg u otros comandos
        print(f"❌ Subproceso falló: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n⏹️ Cancelado por el usuario.")
        sys.exit(130)
