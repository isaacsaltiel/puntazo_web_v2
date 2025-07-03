#!/usr/bin/env python3
import os
import re
import requests
import dropbox
import cloudinary
import cloudinary.uploader
import cloudinary.api       # ✅ Importamos cloudinary.api para consultar recursos
import time                 # ✅ Importamos time para poder hacer pausas
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

    # 2. Preparar URL Cloudinary con overlays
    # Logo secundario dinámico según 'loc'
    logo_public_id = loc
    logo_overlay_id = loc

    segundo_logo_existe = True
    try:
        cloudinary.api.resource(logo_public_id)
    except Exception:
        segundo_logo_existe = False
        print(f"⚠️ Logo de \"{loc}\" no encontrado en Cloudinary. Se usará solo el logo principal.")

    # Construir URL de Cloudinary con uno o dos overlays según corresponda
    base_name = os.path.splitext(nombre)[0]
    url_cloudinary = f"https://res.cloudinary.com/{CLOUD_NAME}/video/upload"
    url_cloudinary += f"/l_puntazo_video,w_0.40/fl_layer_apply,g_north_west,x_30,y_30"
    if segundo_logo_existe:
        url_cloudinary += f"/l_{logo_overlay_id},w_0.3/fl_layer_apply,g_north_east,x_50,y_50"
    url_cloudinary += f"/q_auto,f_mp4/videos_con_marca/{base_name}.mp4"

    # 3. Subir video a Cloudinary (recurso base sin procesar)
    cloudinary.uploader.upload(
        temp_link,
        resource_type="video",
        public_id=f"videos_con_marca/{base_name}",
        overwrite=True
    )

    # 4. Guardar video procesado (con marca) en carpeta final de Dropbox
    save_result = dbx.files_save_url(ruta_destino, url_cloudinary)
    print(f"✅ Video guardado en carpeta final: {ruta_destino}")

    # 4.1 Esperar finalización de la descarga si es asíncrona
    if hasattr(save_result, "is_complete") and not save_result.is_complete():
        # Obtener ID de job asíncrono y consultar hasta completar
        job_id = None
        try:
            job_id = save_result.get_async_job_id()  # ID de la tarea de Dropbox
        except Exception:
            # En algunos casos SaveUrlResult puede exponer async_job_id directamente
            job_id = getattr(save_result, "async_job_id", None)
        if job_id:
            # Polling del estado de la descarga
            max_intentos = 180   # (hasta ~15 minutos)
            intentos = 0
            while intentos < max_intentos:
                status = dbx.files_save_url_check_job_status(job_id)
                if status.is_complete():
                    break  # completó antes de 15 minutos
                if status.is_failed():
                    print(f"⚠️ Falló la descarga de {nombre} desde Cloudinary a Dropbox.")
                    # Borrar video de Cloudinary aunque falló, para reintentar en el siguiente ciclo
                    cloudinary.uploader.destroy(f"videos_con_marca/{base_name}", resource_type="video")
                    print(f"🗑️ Eliminado de Cloudinary: videos_con_marca/{base_name}")
                    # Nota: No borramos el original de Entrantes, para intentar reprocesarlo luego.
                    continue  # saltar a próximo video
                intentos += 1
                time.sleep(5)
            # (Si salió del while sin complete, se asume completado o agotado el tiempo)
    # 5. Eliminar video de Cloudinary ya procesado
    cloudinary.uploader.destroy(f"videos_con_marca/{base_name}", resource_type="video")
    print(f"🗑️ Eliminado de Cloudinary: videos_con_marca/{base_name}")

    # 6. Eliminar original de Entrantes en Dropbox
    dbx.files_delete_v2(ruta_origen)
    print(f"🗑️ Eliminado de Entrantes: {ruta_origen}")

print("🏁 Todos los videos fueron procesados y distribuidos.")
