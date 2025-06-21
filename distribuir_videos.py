#!/usr/bin/env python3
import os
import re
import dropbox

# === Configuración desde secretos de entorno ===
DROPBOX_TOKEN = os.environ["DROPBOX_TOKEN"]
CARPETA_PROCESADOS = "/Puntazo/Procesados"
CARPETA_DESTINO_RAIZ = "/Puntazo/Locaciones"

# === Inicializa cliente Dropbox ===
dbx = dropbox.Dropbox(DROPBOX_TOKEN)

# === Patrón de nombre esperado ===
PATRON_VIDEO = re.compile(r"^(?P<loc>[^_]+)_(?P<can>[^_]+)_(?P<lado>[^_]+)_\d{8}_\d{6}\.mp4$")

# === Obtener lista de videos en carpeta Procesados ===
res = dbx.files_list_folder(CARPETA_PROCESADOS)
videos = [entry for entry in res.entries if entry.name.endswith(".mp4")]

if not videos:
    print("✅ No hay videos por distribuir.")
    exit()

# === Procesar cada video ===
for video in videos:
    nombre = video.name
    match = PATRON_VIDEO.match(nombre)

    if not match:
        print(f"⚠️ Nombre no válido: {nombre}")
        continue

    loc, can, lado = match.group("loc"), match.group("can"), match.group("lado")
    destino = f"{CARPETA_DESTINO_RAIZ}/{loc}/{can}/{lado}/{nombre}"

    try:
        # Verificar si ya existe
        dbx.files_get_metadata(destino)
        print(f"ℹ️ Ya existe en destino: {nombre}")
        continue
    except dropbox.exceptions.ApiError:
        pass  # No existe, seguimos

    # Mover video
    origen = f"{CARPETA_PROCESADOS}/{nombre}"
    print(f"🚚 Moviendo {nombre} → {destino}")
    dbx.files_move_v2(origen, destino)

print("🏁 Distribución completa.")
