#!/usr/bin/env python3
import os
import requests
import dropbox
import cloudinary
import cloudinary.uploader
import subprocess
from base64 import b64encode
from distribuir_videos import distribuir_videos

# === Autenticación dinámica con refresh_token ===
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

# === Inicializa Dropbox con token renovado ===
dbx = dropbox.Dropbox(ACCESS_TOKEN)

# === Configuración Cloudinary ===
CLOUD_NAME = os.environ["CLOUDINARY_CLOUD_NAME"]
API_KEY = os.environ["CLOUDINARY_API_KEY"]
API_SECRET = os.environ["CLOUDINARY_API_SECRET"]
cloudinary.config(cloud_name=CLOUD_NAME, api_key=API_KEY, api_secret=API_SECRET)

# === Rutas en Dropbox ===
CARPETA_SIN_MARCA = "/Puntazo/Entrantes"
CARPETA_CON_MARCA = "/Puntazo/Procesados"

# === Lista de videos en Entrantes ===
res = dbx.files_list_folder(CARPETA_SIN_MARCA)
videos_nuevos = [entry for entry in res.entries if entry.name.endswith(".mp4")]

# === Procesar videos ===
for video in videos_nuevos:
    nombre = video.name
    ruta_origen = f"{CARPETA_SIN_MARCA}/{nombre}"
    ruta_destino = f"{CARPETA_CON_MARCA}/{nombre}"
    print(f"🚀 Procesando: {nombre}")

    # 1. Link temporal de Dropbox
    temp_link = dbx.files_get_temporary_link(ruta_origen).link

    # 2. URL Cloudinary con overlay
    url_cloudinary = (
        f"https://res.cloudinary.com/{CLOUD_NAME}/video/upload"
        f"/l_puntazo_video,w_0.5/fl_layer_apply,g_north_west,x_10,y_10"
        f"/q_auto,f_mp4/videos_con_marca/{os.path.splitext(nombre)[0]}.mp4"
    )

    # 3. Subir a Cloudinary
    cloudinary.uploader.upload(
        temp_link,
        resource_type="video",
        public_id=f"videos_con_marca/{os.path.splitext(nombre)[0]}",
        overwrite=True
    )

    # 4. Guardar procesado en Dropbox
    dbx.files_save_url(ruta_destino, url_cloudinary)
    print(f"✅ Video procesado en: {ruta_destino}")

    # 5. Eliminar original de Entrantes
    dbx.files_delete_v2(ruta_origen)
    print(f"🗑️ Eliminado de Entrantes: {ruta_origen}")

print("🏁 Todos los videos fueron procesados.")

# === Distribuir todos los videos que estén listos ===
print("📦 Iniciando distribución de videos…")
try:
    distribuir_videos(dbx)
    print("✅ Distribución completada.")
except Exception as e:
    print(f"❌ Error al distribuir videos: {e}")
