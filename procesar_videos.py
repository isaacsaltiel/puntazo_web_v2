#!/usr/bin/env python3
import os
import re
import requests
import dropbox
import cloudinary
import cloudinary.uploader
import cloudinary.api
import time
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

# === Selección dinámica de cuenta de Cloudinary ===
use_second = os.getenv("USE_SECOND_CLOUDINARY", "false").lower() == "true"
if use_second:
    CLOUD_NAME = os.environ["CLOUDINARY_CLOUD_NAME2"]
    API_KEY = os.environ["CLOUDINARY_API_KEY2"]
    API_SECRET = os.environ["CLOUDINARY_API_SECRET2"]
    print("🔁 Usando SEGUNDA cuenta de Cloudinary")
else:
    CLOUD_NAME = os.environ["CLOUDINARY_CLOUD_NAME"]
    API_KEY = os.environ["CLOUDINARY_API_KEY"]
    API_SECRET = os.environ["CLOUDINARY_API_SECRET"]
    print("✅ Usando cuenta PRINCIPAL de Cloudinary")

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

    # 2. Preparar URL Cloudinary con overlays
    logo_public_id = loc
    logo_overlay_id = loc

    segundo_logo_existe = True
    try:
        cloudinary.api.resource(logo_public_id)
    except Exception:
        segundo_logo_existe = False
        print(f"⚠️ Logo de \"{loc}\" no encontrado en Cloudinary. Se usará solo el logo principal.")

    base_name = os.path.splitext(nombre)[0]
    url_cloudinary = f"https://res.cloudinary.com/{CLOUD_NAME}/video/upload"
    url_cloudinary += f"/l_puntazo_video,w_0.40/fl_layer_apply,g_north_west,x_30,y_30"
    if segundo_logo_existe:
        url_cloudinary += f"/l_{logo_overlay_id},w_0.3/fl_layer_apply,g_north_east,x_50,y_50"
    url_cloudinary += f"/q_auto,f_mp4/videos_con_marca/{base_name}.mp4"

    # 3. Subir video a Cloudinary
    cloudinary.uploader.upload(
        temp_link,
        resource_type="video",
        public_id=f"videos_con_marca/{base_name}",
        overwrite=True
    )

    # 4. Guardar video procesado en carpeta final de Dropbox
    save_result = dbx.files_save_url(ruta_destino, url_cloudinary)
    print(f"✅ Video guardado en carpeta final: {ruta_destino}")

    if hasattr(save_result, "is_complete") and not save_result.is_complete():
        job_id = None
        try:
            job_id = save_result.get_async_job_id()
        except Exception:
            job_id = getattr(save_result, "async_job_id", None)
        if job_id:
            max_intentos = 180
            intentos = 0
            while intentos < max_intentos:
                status = dbx.files_save_url_check_job_status(job_id)
                if status.is_complete():
                    break
                if status.is_failed():
                    print(f"⚠️ Falló la descarga de {nombre} desde Cloudinary a Dropbox.")
                    cloudinary.uploader.destroy(f"videos_con_marca/{base_name}", resource_type="video")
                    print(f"🗑️ Eliminado de Cloudinary: videos_con_marca/{base_name}")
                    continue
                intentos += 1
                time.sleep(5)

    cloudinary.uploader.destroy(f"videos_con_marca/{base_name}", resource_type="video")
    print(f"🗑️ Eliminado de Cloudinary: videos_con_marca/{base_name}")

    dbx.files_delete_v2(ruta_origen)
    print(f"🗑️ Eliminado de Entrantes: {ruta_origen}")

print("🏁 Todos los videos fueron procesados y distribuidos.")
