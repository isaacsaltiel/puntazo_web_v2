#!/usr/bin/env python3
import os
import re
import requests
import dropbox
import cloudinary
import cloudinary.uploader
from base64 import b64encode

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
CARPETA_ENTRANTES = "/Puntazo/Entrantes"
CARPETA_RAIZ = "/Puntazo/Locaciones"

# === Patrón para extraer loc, can, lado ===
PATRON_VIDEO = re.compile(r"^(?P<loc>[^_]+)_(?P<can>[^_]+)_(?P<lado>[^_]+)_\d{8}_\d{6}\.mp4$")

# === Lista de videos en Entrantes ===
res = dbx.files_list_folder(CARPETA_ENTRANTES)
videos_nuevos = [entry for entry in res.entries if entry.name.endswith(".mp4")]

if not videos_nuevos:
    print("✅ No hay videos nuevos por procesar.")
    exit()

# === Procesar videos ===
for video in videos_nuevos:
    nombre = video.name
    match = PATRON_VIDEO.match(nombre)

    if not match:
        print(f"⚠️ Nombre no válido: {nombre}")
        continue

    loc, can, lado = match.group("loc"), match.group("can"), match.group("lado")
    ruta_origen = f"{CARPETA_ENTRANTES}/{nombre}"
    ruta_destino = f"{CARPETA_RAIZ}/{loc}/{can}/{lado}/{nombre}"

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

    # 4. Guardar procesado en carpeta final
    dbx.files_save_url(ruta_destino, url_cloudinary)
    print(f"✅ Video guardado en carpeta final: {ruta_destino}")

    # 5. Eliminar original de Entrantes
    dbx.files_delete_v2(ruta_origen)
    print(f"🗑️ Eliminado de Entrantes: {ruta_origen}")

print("🏁 Todos los videos fueron procesados y distribuidos.")
