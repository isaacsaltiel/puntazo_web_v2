#!/usr/bin/env python3
import os
import dropbox
import cloudinary
import cloudinary.uploader
import json
import requests

# === Configuración desde variables de entorno ===
DROPBOX_TOKEN  = os.environ["DROPBOX_TOKEN"]
CLOUD_NAME     = os.environ["CLOUDINARY_CLOUD_NAME"]
API_KEY        = os.environ["CLOUDINARY_API_KEY"]
API_SECRET     = os.environ["CLOUDINARY_API_SECRET"]
GITHUB_PAT     = os.environ["GITHUB_PAT"]
REPO           = "isaacsaltiel/puntazo_web_v2"

# === Rutas en Dropbox ===
CARPETA_ENTRADA   = "/Puntazo/Entrantes"
CARPETA_SALIDA    = "/Puntazo/Procesados"
PROCESADOS_FILE   = "procesados.txt"

# === Inicializa clientes ===
dbx = dropbox.Dropbox(DROPBOX_TOKEN)
cloudinary.config(cloud_name=CLOUD_NAME, api_key=API_KEY, api_secret=API_SECRET)

# === Lista de videos ya procesados ===
if os.path.exists(PROCESADOS_FILE):
    with open(PROCESADOS_FILE, "r") as f:
        procesados = set(f.read().splitlines())
else:
    procesados = set()

# === Obtener videos nuevos ===
res = dbx.files_list_folder(CARPETA_ENTRADA)
videos_nuevos = [
    entry for entry in res.entries
    if entry.name.endswith(".mp4") and entry.name not in procesados
]

if not videos_nuevos:
    print("✅ No hay videos nuevos por procesar.")
    exit()

# === Procesar videos ===
for video in videos_nuevos:
    nombre = video.name
    ruta_origen  = f"{CARPETA_ENTRADA}/{nombre}"
    ruta_destino = f"{CARPETA_SALIDA}/{nombre}"

    print(f"🚀 Procesando: {nombre}")
    temp_link = dbx.files_get_temporary_link(ruta_origen).link

    public_id = f"videos_con_marca/{os.path.splitext(nombre)[0]}"
    url_cloudinary = (
        f"https://res.cloudinary.com/{CLOUD_NAME}/video/upload"
        f"/l_puntazo_video,w_0.5/fl_layer_apply,g_north_west,x_10,y_10"
        f"/q_auto,f_mp4/{public_id}.mp4"
    )

    cloudinary.uploader.upload(
        temp_link,
        resource_type="video",
        public_id=public_id,
        overwrite=True
    )

    resp = dbx.files_save_url(ruta_destino, url_cloudinary)
    print(f"✅ Video guardado en Dropbox: {ruta_destino}")
    procesados.add(nombre)

# === Guardar lista actualizada ===
with open(PROCESADOS_FILE, "w") as f:
    f.write("\n".join(procesados))

# === Encadenar con distribución ===
url = f"https://api.github.com/repos/{REPO}/actions/workflows/distribuir_videos.yml/dispatches"
headers = {"Authorization": f"Bearer {GITHUB_PAT}"}
payload = {"ref": "master"}

resp = requests.post(url, headers=headers, json=payload)
if resp.status_code == 204:
    print("🔗 Se activó distribuir_videos.yml correctamente.")
else:
    print(f"⚠️ Error al activar workflow: {resp.status_code} - {resp.text}")

print("🏁 Todos los videos fueron procesados.")
