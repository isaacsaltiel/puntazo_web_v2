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
from cloudinary.exceptions import Error as CloudinaryError

print("🛫 Iniciando script...")

# === Autenticación Dropbox ===
APP_KEY = os.environ["DROPBOX_APP_KEY"]
APP_SECRET = os.environ["DROPBOX_APP_SECRET"]
REFRESH_TOKEN = os.environ["DROPBOX_REFRESH_TOKEN"]

auth_header = b64encode(f"{APP_KEY}:{APP_SECRET}".encode()).decode()
res = requests.post(
    "https://api.dropbox.com/oauth2/token",
    headers={"Authorization": f"Basic {auth_header}"},
    data={"grant_type": "refresh_token", "refresh_token": REFRESH_TOKEN},
)
res.raise_for_status()
ACCESS_TOKEN = res.json()["access_token"]
print("🔑 Token de Dropbox obtenido")

dbx = dropbox.Dropbox(ACCESS_TOKEN)
print("📦 Cliente Dropbox inicializado")

# === Configuración Cloudinary ===
CLOUD_NAME = os.environ["CLOUDINARY_CLOUD_NAME"]
API_KEY = os.environ["CLOUDINARY_API_KEY"]
API_SECRET = os.environ["CLOUDINARY_API_SECRET"]

CLOUD_NAME2 = os.environ["CLOUDINARY_CLOUD_NAME2"]
API_KEY2 = os.environ["CLOUDINARY_API_KEY2"]
API_SECRET2 = os.environ["CLOUDINARY_API_SECRET2"]

def configurar_cloudinary(cloud_name, api_key, api_secret):
    cloudinary.config(cloud_name=cloud_name, api_key=api_key, api_secret=api_secret)

configurar_cloudinary(CLOUD_NAME, API_KEY, API_SECRET)
print("☁️ Cloudinary cuenta principal configurada")

CARPETA_ENTRANTES = "/Puntazo/Entrantes"
CARPETA_RAIZ = "/Puntazo/Locaciones"
PATRON_VIDEO = re.compile(r"^(?P<loc>[^_]+)_(?P<can>[^_]+)_(?P<lado>[^_]+)_\d{8}_\d{6}\.mp4$")

print("📂 Buscando videos...")
res = dbx.files_list_folder(CARPETA_ENTRANTES)
videos_nuevos = [entry for entry in res.entries if entry.name.endswith(".mp4")]
print(f"🎞️ Videos encontrados: {len(videos_nuevos)}")

if not videos_nuevos:
    print("✅ No hay videos por procesar.")
    exit()

for video in videos_nuevos:
    nombre = video.name
    print(f"🚀 Procesando: {nombre}")
    match = PATRON_VIDEO.match(nombre)
    if not match:
        print(f"⚠️ Nombre no válido: {nombre}")
        continue

    loc, can, lado = match.group("loc"), match.group("can"), match.group("lado")
    ruta_origen = f"{CARPETA_ENTRANTES}/{nombre}"
    ruta_destino = f"{CARPETA_RAIZ}/{loc}/{can}/{lado}/{nombre}"
    base_name = os.path.splitext(nombre)[0]

    temp_link = dbx.files_get_temporary_link(ruta_origen).link

    # Construir URL
    url_cloudinary = f"https://res.cloudinary.com/{CLOUD_NAME}/video/upload"
    url_cloudinary += f"/l_puntazo_video,w_0.40/fl_layer_apply,g_north_west,x_30,y_30"

    segundo_logo_existe = True
    try:
        cloudinary.api.resource(loc)
    except Exception:
        segundo_logo_existe = False
        print(f"⚠️ Logo '{loc}' no encontrado")

    if segundo_logo_existe:
        url_cloudinary += f"/l_{loc},w_0.3/fl_layer_apply,g_north_east,x_50,y_50"

    url_cloudinary += f"/q_auto,f_mp4/videos_con_marca/{base_name}.mp4"

    # Subida con fallback
    try:
        cloudinary.uploader.upload(
            temp_link,
            resource_type="video",
            public_id=f"videos_con_marca/{base_name}",
            overwrite=True,
        )
        print("☁️ Subido con cuenta principal")
    except CloudinaryError as e:
        if e.http_status in (403, 420):
            print("⚠️ Créditos agotados. Cambiando a cuenta de respaldo...")
            configurar_cloudinary(CLOUD_NAME2, API_KEY2, API_SECRET2)
            try:
                cloudinary.uploader.upload(
                    temp_link,
                    resource_type="video",
                    public_id=f"videos_con_marca/{base_name}",
                    overwrite=True,
                )
                print("☁️ Subido con cuenta de respaldo")
                url_cloudinary = url_cloudinary.replace(CLOUD_NAME, CLOUD_NAME2)
            except Exception as e2:
                print("❌ Falló también la cuenta de respaldo")
                raise e2
        else:
            raise

    # Guardar en Dropbox
    result = dbx.files_save_url(ruta_destino, url_cloudinary)
    print(f"✅ Guardado en: {ruta_destino}")

    # Esperar si es async
    if hasattr(result, "is_complete") and not result.is_complete():
        job_id = getattr(result, "async_job_id", None)
        for i in range(60):
            status = dbx.files_save_url_check_job_status(job_id)
            if status.is_complete():
                break
            if status.is_failed():
                print(f"❌ Falló la descarga en Dropbox")
                cloudinary.uploader.destroy(f"videos_con_marca/{base_name}", resource_type="video")
                break
            time.sleep(5)

    # Limpiar
    cloudinary.uploader.destroy(f"videos_con_marca/{base_name}", resource_type="video")
    dbx.files_delete_v2(ruta_origen)
    print(f"🗑️ Limpieza completada de {nombre}")

print("🏁 Proceso completado")
