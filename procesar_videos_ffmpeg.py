import os
import subprocess
import json
import re

# --------------- CONFIGURACIÓN LOCAL ---------------
CONFIG_PATH = "/home/isaac/PUNTAZO/mi_config.json"
VIDEO_DIR = "final_cam"
REGISTRO_PATH = "subidos.txt"
DROPBOX_BASE = "dropbox:Puntazo/Locaciones"
ANIMACION_PATH = "logos/puntazo.mp4"

# --------------- FUNCIONES AUXILIARES ---------------
def load_config():
    with open(CONFIG_PATH, "r") as f:
        conf = json.load(f)
    return conf["loc"], conf["can"], conf["lado"]

def ya_esta_subido(nombre_archivo):
    if not os.path.exists(REGISTRO_PATH):
        return False
    with open(REGISTRO_PATH, "r") as f:
        return nombre_archivo in f.read()

def marcar_como_subido(nombre_archivo):
    with open(REGISTRO_PATH, "a") as f:
        f.write(nombre_archivo + "\n")

# --------------- FLUJO PRINCIPAL ---------------
loc, can, lado = load_config()
print(f"🚀 Procesando videos en {VIDEO_DIR}...")

for archivo in os.listdir(VIDEO_DIR):
    if not archivo.endswith(".mp4"):
        continue

    if ya_esta_subido(archivo):
        continue

    ruta_entrada = os.path.join(VIDEO_DIR, archivo)
    print(f"🚀 Procesando {archivo}...")

    # 1. Aplicar logos si existen
    existe_logo_loc = os.path.exists(f"logos/{loc}.png")
    if existe_logo_loc:
        comando = [
            "ffmpeg", "-y", "-i", ruta_entrada,
            "-i", "logos/puntazo.png",
            "-i", f"logos/{loc}.png",
            "-filter_complex",
            "[0:v][1:v]overlay=30:30[tmp1];[tmp1][2:v]overlay=W-w-15:15",
            "-c:a", "copy", "with_logos.mp4"
        ]
    else:
        comando = [
            "ffmpeg", "-y", "-i", ruta_entrada,
            "-i", "logos/puntazo.png",
            "-filter_complex", "overlay=30:30",
            "-c:a", "copy", "with_logos.mp4"
        ]
    subprocess.run(comando, check=True)

    # 2. Asegurar que tenga pista de audio silenciosa (si no tiene audio)
    print("🔇 Asegurando pista de audio silenciosa si es necesario...")
    result = subprocess.run([
        "ffprobe", "-v", "error", "-select_streams", "a",
        "-show_entries", "stream=codec_type", "-of", "default=noprint_wrappers=1:nokey=1",
        "with_logos.mp4"
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    tiene_audio = any("audio" in line for line in result.stdout.splitlines())

    if not tiene_audio:
        subprocess.run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", "with_logos.mp4",
            "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-c:v", "copy", "-c:a", "aac", "-shortest",
            "with_logos_audio_silencioso.mp4"
        ], check=True)
    else:
        os.rename("with_logos.mp4", "with_logos_audio_silencioso.mp4")

    # 3. Concatenar con animación al final (que tiene audio)
    print("➕ Concatenando animación al final...")
    try:
        subprocess.run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", "with_logos_audio_silencioso.mp4",
            "-i", ANIMACION_PATH,
            "-filter_complex",
            "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[outv][outa]",
            "-map", "[outv]", "-map", "[outa]",
            "-c:v", "libx264", "-c:a", "aac", "-shortest",
            "output_final.mp4"
        ], check=True)
    except subprocess.CalledProcessError:
        print(f"❌ Error al concatenar animación para {archivo}.")
        continue

    # 4. Subir a Dropbox
    dropbox_destino = f"{DROPBOX_BASE}/{loc}/{can}/{lado}/{archivo}"
    subprocess.run(["rclone", "copyto", "output_final.mp4", dropbox_destino], check=True)
    print(f"✅ Subido a {dropbox_destino}")

    # 5. Limpiar y registrar
    os.remove(ruta_entrada)
    print(f"🗑️ Eliminado original de Entrantes")
    marcar_como_subido(archivo)

print("🌟 Todos los videos han sido procesados.")
