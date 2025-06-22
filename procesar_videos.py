#!/usr/bin/env python3
import os
import dropbox
import cloudinary
import cloudinary.uploader

# === Configuración desde variables de entorno ===
DROPBOX_TOKEN     = os.environ["DROPBOX_TOKEN"]
CLOUD_NAME        = os.environ["CLOUDINARY_CLOUD_NAME"]
API_KEY           = os.environ["CLOUDINARY_API_KEY"]
API_SECRET        = os.environ["CLOUDINARY_API_SECRET"]

# === Rutas en Dropbox ===
CARPETA_SIN_MARCA = "/Puntazo/Entrantes"
CARPETA_CON_MARCA = "/Puntazo/Procesados"

# === Inicializa clientes ===
dbx = dropbox.Dropbox(DROPBOX_TOKEN)
cloudinary.config(cloud_name=CLOUD_NAME, api_key=API_KEY, api_secret=API_SECRET)

# === Obtener lista de videos en carpeta Entrantes ===
res = dbx.files_list_folder(CARPETA_SIN_MARCA)
videos_nuevos = [
    entry for entry in res.entries
    if entry.name.endswith(".mp4")
]

if not videos_nuevos:
    print("✅ No hay videos nuevos por procesar.")
    exit()

# === Procesar cada video nuevo ===
for video in videos_nuevos:
    nombre = video.name
    ruta_origen  = f"{CARPETA_SIN_MARCA}/{nombre}"
    ruta_destino = f"{CARPETA_CON_MARCA}/{nombre}"

    print(f"🚀 Procesando: {nombre}")

    # === Paso 1: Obtener enlace temporal del video en Dropbox ===
    temp_link = dbx.files_get_temporary_link(ruta_origen).link

    # === Paso 2: Construir URL de Cloudinary con logo aplicado ===
    url_cloudinary = (
        f"https://res.cloudinary.com/{CLOUD_NAME}/video/upload"
        f"/l_puntazo_video,w_0.5/fl_layer_apply,g_north_west,x_10,y_10"
        f"/q_auto,f_mp4/videos_con_marca/{os.path.splitext(nombre)[0]}.mp4"
    )

    # === Paso 3: Subir video temporal a Cloudinary ===
    cloudinary.uploader.upload(
        temp_link,
        resource_type="video",
        public_id=f"videos_con_marca/{os.path.splitext(nombre)[0]}",
        overwrite=True
    )

    # === Paso 4: Usar save_url para guardar versión con marca en Dropbox ===
    dbx.files_save_url(ruta_destino, url_cloudinary)
    print(f"✅ Video procesado y enviado a: {ruta_destino}")

    # === Paso 5: Borrar el original de Entrantes ===
    dbx.files_delete_v2(ruta_origen)
    print(f"🗑️ Eliminado original de Entrantes: {ruta_origen}")

print("🏁 Todos los videos fueron procesados.")
