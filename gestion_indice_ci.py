import os
import argparse
import dropbox
import json
import re
from datetime import datetime, timedelta, timezone
from github import Github

# Variables de entorno necesarias para autenticación
DROPBOX_APP_KEY = os.environ["DROPBOX_APP_KEY"]
DROPBOX_APP_SECRET = os.environ["DROPBOX_APP_SECRET"]
DROPBOX_REFRESH_TOKEN = os.environ["DROPBOX_REFRESH_TOKEN"]
GITHUB_TOKEN = os.environ.get("PAT_GITHUB")

# Configuraciones globales
VALID_SUFFIX = ".mp4"
RETENTION_HOURS = 24
DROPBOX_BASE = "/Puntazo/Locaciones"
GITHUB_REPO = "isaacsaltiel/puntazo_web_v2"

# Establece conexión con Dropbox
def connect_dropbox():
    print("[DEBUG] Conectando a Dropbox…")
    return dropbox.Dropbox(
        app_key=DROPBOX_APP_KEY,
        app_secret=DROPBOX_APP_SECRET,
        oauth2_refresh_token=DROPBOX_REFRESH_TOKEN
    )

# Genera un link público de Dropbox, manejando duplicados de forma segura
def generate_public_url(dbx, path):
    try:
        print(f"[DEBUG] Generando URL pública para: {path}")
        link = dbx.sharing_create_shared_link_with_settings(path)
    except dropbox.exceptions.ApiError as e:
        if e.error.is_shared_link_already_exists():
            links = dbx.sharing_list_shared_links(path=path, direct_only=True).links
            if links:
                link = links[0]
            else:
                print(f"[DEBUG] No se encontraron links existentes para {path}")
                return None
        else:
            print(f"[ERROR] al generar URL pública: {e}")
            return None
    return link.url.replace("www.dropbox.com", "dl.dropboxusercontent.com").split("?dl=")[0]

# Crea o actualiza un archivo JSON en GitHub con los datos de los videos recientes
def upload_to_github(json_data, github_path):
    if not GITHUB_TOKEN:
        print("[WARNING] No se encontró el PAT_GITHUB, omitiendo subida a GitHub.")
        return

    g = Github(GITHUB_TOKEN)
    repo = g.get_repo(GITHUB_REPO)

    try:
        contents = repo.get_contents(github_path, ref="master")
        repo.update_file(contents.path, "Actualizar videos_recientes.json desde CI", json_data, contents.sha, branch="master")
        print("[OK] videos_recientes.json actualizado en GitHub")
    except Exception as e:
        if "404" in str(e):
            try:
                repo.create_file(github_path, "Crear videos_recientes.json desde CI", json_data, branch="master")
                print("[OK] videos_recientes.json creado en GitHub")
            except Exception as inner:
                print(f"[ERROR] No se pudo crear el archivo en GitHub: {inner}")
        else:
            print(f"[ERROR] No se pudo subir a GitHub: {e}")

# Función principal del script

def main():
    # Leer parámetros desde línea de comandos
    parser = argparse.ArgumentParser()
    parser.add_argument("--loc", required=True)
    parser.add_argument("--can", required=True)
    parser.add_argument("--lado", required=True)
    args = parser.parse_args()

    # Construir ruta de Dropbox a revisar
    loc, can, lado = args.loc, args.can, args.lado
    folder_path = f"{DROPBOX_BASE}/{loc}/{can}/{lado}"
    print(f"[DEBUG] Carpeta objetivo: {folder_path}")

    dbx = connect_dropbox()

    # Listar archivos dentro de la carpeta
    try:
        result = dbx.files_list_folder(folder_path)
        print(f"[DEBUG] Archivos encontrados: {[e.name for e in result.entries]}")
    except dropbox.exceptions.ApiError as e:
        print("[ERROR] No se pudo acceder a la carpeta:", e)
        return

    cutoff = datetime.now(timezone.utc) - timedelta(hours=RETENTION_HOURS)
    print(f"[DEBUG] Umbral de retención: {cutoff.isoformat()}")

    videos = []
    nombres_base_vistos = set()  # Usado para detectar duplicados por nombre base

    for entry in result.entries:
        if isinstance(entry, dropbox.files.FileMetadata) and entry.name.endswith(VALID_SUFFIX):
            mod_time = entry.client_modified
            mod_time_utc = mod_time.replace(tzinfo=timezone.utc)

            # Detectar duplicados por nombre base (remueve " (1)", " (2)", etc.)
            nombre_sin_ext = entry.name[:-4]  # Quita ".mp4"
            nombre_base = re.sub(r" \(\d+\)$", "", nombre_sin_ext)

            if nombre_base in nombres_base_vistos:
                # Es un duplicado → eliminar
                try:
                    dbx.files_delete_v2(entry.path_lower)
                    print(f"[INFO] Eliminado duplicado: {entry.name}")
                except Exception as e:
                    print(f"[ERROR] No se pudo eliminar duplicado {entry.name}: {e}")
                continue

            if mod_time_utc > cutoff:
                # Video reciente y único → generar URL y agregar al JSON
                url = generate_public_url(dbx, entry.path_lower)
                if url:
                    videos.append({"nombre": entry.name, "url": url})
                    nombres_base_vistos.add(nombre_base)
            else:
                # Archivo es antiguo → eliminar
                try:
                    #dbx.files_delete_v2(entry.path_lower)
                    print(f"[INFO] Archivo eliminado por antigüedad: {entry.name}")
                except Exception as e:
                    print(f"[ERROR] No se pudo eliminar {entry.name}: {e}")

    # Ordenar y guardar los videos en archivo JSON
    videos.sort(key=lambda x: x["nombre"], reverse=True)

    output = {
        "videos": videos,
        "generado_el": datetime.now(timezone.utc).isoformat()
    }

    # Guardar JSON local
    local_path = f"data/Locaciones/{loc}/{can}/{lado}/videos_recientes.json"
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    with open(local_path, "w") as f:
        json.dump(output, f, indent=2)
    print(f"[DEBUG] JSON generado localmente con {len(videos)} videos")

    # Subir JSON a Dropbox
    with open(local_path, "rb") as f:
        dbx.files_upload(f.read(), folder_path + "/videos_recientes.json", mode=dropbox.files.WriteMode("overwrite"))
    print("[OK] videos_recientes.json actualizado en Dropbox")

    # Subir JSON a GitHub
    github_path = f"data/Locaciones/{loc}/{can}/{lado}/videos_recientes.json"
    upload_to_github(json.dumps(output, indent=2), github_path)

# Ejecutar script si se llama directamente
if __name__ == "__main__":
    main()
