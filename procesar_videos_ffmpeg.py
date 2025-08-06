#!/usr/bin/env python3
import os
import re
import requests
import dropbox
import subprocess

from base64 import b64encode

APP_KEY = os.environ["DROPBOX_APP_KEY"]
APP_SECRET = os.environ["DROPBOX_APP_SECRET"]
REFRESH_TOKEN = os.environ["DROPBOX_REFRESH_TOKEN"]

auth_header = b64encode(f"{APP_KEY}:{APP_SECRET}".encode()).decode()
res = requests.post(
    "https://api.dropbox.com/oauth2/token",
    headers={"Authorization": f"Basic {auth_header}"},
    data={
        "grant_type": "refresh_token",
        "refresh_token": REFRESH_TOKEN,
    },
)
res.raise_for_status()
ACCESS_TOKEN = res.json()["access_token"]

# === Inicializa Dropbox ===
dbx = dropbox.Dropbox(ACCESS_TOKEN)

# === Configuración general ===
CARPETA_ENTRANTES = "/Puntazo/Entrantes"
CARPETA_RAIZ = "/Puntazo/Locaciones"
PATRON_VIDEO = re.compile(r"^(?P<loc>[^_]+)_(?P<can>[^_]+)_(?P<lado>[^_]+)_\d{8}_\d{6}\.mp4$")

# === Obtener lista de videos nuevos ===
res = dbx.files_list_folder(CARPETA_ENTRANTES)
videos_nuevos = [entry for entry in res.entries if entry.name.endswith(".mp4")]

if not videos_nuevos:
    print("✅ No hay videos nuevos por procesar.")
    exit()

# === Procesar cada video ===
for video in videos_nuevos:
    nombre = video.name
    match = PATRON_VIDEO.match(nombre)
    if not match:
        print(f"⚠️ Nombre inválido: {nombre}")
        continue

    loc, can, lado = match.group("loc"), match.group("can"), match.group("lado")
    ruta_origen = f"{CARPETA_ENTRANTES}/{nombre}"
    ruta_destino = f"{CARPETA_RAIZ}/{loc}/{can}/{lado}/{nombre}"

    print(f"🚀 Procesando {nombre}...")

    # 1. Descargar video original
    _, response = dbx.files_download(ruta_origen)
    with open("input.mp4", "wb") as f:
        f.write(response.content)

    # 2. Verificar existencia de logos
    existe_logo_loc = os.path.exists(f"logos/{loc}.png")
    if not existe_logo_loc:
        print(f"⚠️ No se encontró logo para {loc}, se usará solo el de Puntazo.")

    # 3. Generar comando FFmpeg con 1 o 2 logos escalados
    if existe_logo_loc:
        comando_logo = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", "input.mp4",
            "-i", "logos/puntazo.png",
            "-i", f"logos/{loc}.png",
            "-filter_complex",
            "[1:v]scale=200:-1[logo1]; [2:v]scale=300:-1[logo2]; "
            "[0:v][logo1]overlay=30:30[tmp1]; [tmp1][logo2]overlay=W-w-15:15",
            "-an", "output.mp4"
        ]
    else:
        comando_logo = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", "input.mp4",
            "-i", "logos/puntazo.png",
            "-filter_complex",
            "[1:v]scale=200:-1[logo]; [0:v][logo]overlay=30:30",
            "-an", "output.mp4"
        ]

    try:
        subprocess.run(comando_logo, check=True)
    except subprocess.CalledProcessError:
        print(f"❌ Error al aplicar logos a {nombre}.")
        continue

    # 4. Concatenar con animación
    print("➕ Concatenando animación al final...")
    try:
        subprocess.run([
            "ffmpeg", "-y",
            "-i", "output.mp4",
            "-i", "logos/puntazo.mp4",
            "-filter_complex",
            "[0:v:0][1:v:0]scale2ref=oh=ih:ow=ow[scaled1][scaled2]; \
            [scaled1][scaled2]concat=n=2:v=1:a=0[outv]",
            "-map", "[outv]", "final_output.mp4"
        ], check=True)
    except subprocess.CalledProcessError:
        print(f"❌ Error al concatenar animación para {nombre}.")
        continue

    # 5. Subir video procesado a Dropbox
    with open("final_output.mp4", "rb") as f:
        dbx.files_upload(f.read(), ruta_destino, mode=dropbox.files.WriteMode.overwrite)
    print(f"✅ Subido a {ruta_destino}")

    # 6. Eliminar video original de Entrantes
    dbx.files_delete_v2(ruta_origen)
    print(f"🗑️ Eliminado original de Entrantes")

    # 7. Limpiar archivos temporales
    for archivo in ["input.mp4", "output.mp4", "final_output.mp4"]:
        if os.path.exists(archivo):
            os.remove(archivo)

print("🌟 Todos los videos han sido procesados.")
