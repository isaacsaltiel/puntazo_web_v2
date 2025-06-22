#!/usr/bin/env python3
import os
import re
import dropbox

def distribuir_videos(dbx):
    CARPETA_PROCESADOS = "/Puntazo/Procesados"
    CARPETA_DESTINO_RAIZ = "/Puntazo/Locaciones"

    # === Patrón de nombre esperado ===
    PATRON_VIDEO = re.compile(r"^(?P<loc>[^_]+)_(?P<can>[^_]+)_(?P<lado>[^_]+)_\d{8}_\d{6}\.mp4$")

    # === Obtener lista de videos en carpeta Procesados ===
    res = dbx.files_list_folder(CARPETA_PROCESADOS)
    videos = [entry for entry in res.entries if entry.name.endswith(".mp4")]

    print(f"📁 Carpeta actual: {os.getcwd()}")
    print(f"🔍 Videos encontrados: {[v.name for v in videos]}")

    if not videos:
        print("✅ No hay videos por distribuir.")
        return

    # === Procesar cada video ===
    for video in videos:
        nombre = video.name
        print(f"📄 Procesando archivo: {nombre}")
        match = PATRON_VIDEO.match(nombre)

        if not match:
            print(f"⚠️ Nombre no válido: {nombre}")
            continue

        loc, can, lado = match.group("loc"), match.group("can"), match.group("lado")
        destino = f"{CARPETA_DESTINO_RAIZ}/{loc}/{can}/{lado}/{nombre}"

        print(f"📦 Extraído: loc={loc}, can={can}, lado={lado}")
        print(f"➡️ Destino propuesto: {destino}")

        try:
            dbx.files_get_metadata(destino)
            print(f"ℹ️ Ya existe en destino: {nombre}")
            continue
        except dropbox.exceptions.ApiError:
            pass

        # Mover video
        origen = f"{CARPETA_PROCESADOS}/{nombre}"
        try:
            dbx.files_move_v2(origen, destino)
            print(f"✅ Movido exitosamente: {nombre} → {destino}")
        except Exception as e:
            print(f"❌ Error al mover {nombre}: {e}")

    print("🏁 Distribución completa.")
