#!/usr/bin/env python3
import os
import re
import dropbox
import subprocess
import time

# === Configuración de Dropbox ===
DROPBOX_TOKEN = os.environ["DROPBOX_ACCESS_KEY"]
CARPETA_ENTRANTES = "/Puntazo/Entrantes"
CARPETA_RAIZ = "/Puntazo/Locaciones"
PATRON_VIDEO = re.compile(r"^(?P<loc>[^_]+)_(?P<can>[^_]+)_(?P<lado>[^_]+)_\d{8}_\d{6}\.mp4$")

dbx = dropbox.Dropbox(DROPBOX_TOKEN)

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

    # 1. Descargar archivo de Dropbox
    _, response = dbx.files_download(ruta_origen)
    with open("input.mp4", "wb") as f:
        f.write(response.content)

    # 2. Procesar con FFmpeg y ponerle el logo
    # Asegúrate de que exista un archivo logo.png en el mismo repo
    comando = [
        "ffmpeg", "-y", "-i", "input.mp4", "-i", f"{loc}.png",
        "-filter_complex", "overlay=10:10", "-c:a", "copy", "output.mp4"
    ]
    try:
        subprocess.run(comando, check=True)
    except subprocess.CalledProcessError:
        print(f"❌ Error al procesar {nombre} con FFmpeg.")
        continue

    # 3. Subir a Dropbox a carpeta final
    with open("output.mp4", "rb") as f:
        dbx.files_upload(f.read(), ruta_destino, mode=dropbox.files.WriteMode.overwrite)
    print(f"✅ Video subido a {ruta_destino}")

    # 4. Eliminar archivo original
    dbx.files_delete_v2(ruta_origen)
    print(f"🗑️ Original eliminado de Entrantes")

    # 5. Limpiar archivos locales
    os.remove("input.mp4")
    os.remove("output.mp4")

print("🏁 Todos los videos han sido procesados.")
