import os
import argparse
import dropbox
import json
from datetime import datetime, timedelta, timezone
from github import Github

DROPBOX_APP_KEY = os.environ["DROPBOX_APP_KEY"]
DROPBOX_APP_SECRET = os.environ["DROPBOX_APP_SECRET"]
DROPBOX_REFRESH_TOKEN = os.environ["DROPBOX_REFRESH_TOKEN"]
GITHUB_TOKEN = os.environ.get("PAT_GITHUB")

VALID_SUFFIX = ".mp4"
RETENTION_HOURS = 8
JSON_LOCAL = "videos_recientes.json"
DROPBOX_BASE = "/Puntazo/Locaciones"
GITHUB_REPO = "isaacsaltiel/puntazo_web_v2"
GITHUB_PATH = "data/videos_recientes.json"

def connect_dropbox():
    print("[DEBUG] Conectando a Dropbox…")
    return dropbox.Dropbox(
        app_key=DROPBOX_APP_KEY,
        app_secret=DROPBOX_APP_SECRET,
        oauth2_refresh_token=DROPBOX_REFRESH_TOKEN
    )

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

def upload_to_github(json_data):
    if not GITHUB_TOKEN:
        print("[WARNING] No se encontró el PAT_GITHUB, omitiendo subida a GitHub.")
        return

    g = Github(GITHUB_TOKEN)
    repo = g.get_repo(GITHUB_REPO)

    try:
        contents = repo.get_contents(GITHUB_PATH)
        repo.update_file(contents.path, "Actualizar videos_recientes.json desde CI", json_data, contents.sha, branch="main")
        print("[OK] videos_recientes.json actualizado en GitHub")
    except Exception as e:
        print(f"[ERROR] No se pudo subir a GitHub: {e}")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--loc", required=True)
    parser.add_argument("--can", required=True)
    parser.add_argument("--lado", required=True)
    args = parser.parse_args()

    loc, can, lado = args.loc, args.can, args.lado
    folder_path = f"{DROPBOX_BASE}/{loc}/{can}/{lado}"
    print(f"[DEBUG] Carpeta objetivo: {folder_path}")
    dbx = connect_dropbox()

    try:
        result = dbx.files_list_folder(folder_path)
        print(f"[DEBUG] Archivos encontrados: {[e.name for e in result.entries]}")
    except dropbox.exceptions.ApiError as e:
        print("[ERROR] No se pudo acceder a la carpeta:", e)
        return

    cutoff = datetime.now(timezone.utc) - timedelta(hours=RETENTION_HOURS)
    print(f"[DEBUG] Umbral de retención: {cutoff.isoformat()}")
    videos = []

    for entry in result.entries:
        if isinstance(entry, dropbox.files.FileMetadata) and entry.name.endswith(VALID_SUFFIX):
            mod_time = entry.client_modified
            incluir = mod_time.replace(tzinfo=timezone.utc) > cutoff
            print(f"[DEBUG] {entry.name} | modificado: {mod_time} | incluir: {incluir}")
            if incluir:
                url = generate_public_url(dbx, entry.path_lower)
                if url:
                    videos.append({"nombre": entry.name, "url": url})

    videos.sort(key=lambda x: x["nombre"], reverse=True)

    output = {
        "videos": videos,
        "generado_el": datetime.now(timezone.utc).isoformat()
    }

    with open(JSON_LOCAL, "w") as f:
        json.dump(output, f, indent=2)
    print(f"[DEBUG] JSON generado localmente con {len(videos)} videos")

    with open(JSON_LOCAL, "rb") as f:
        dbx.files_upload(f.read(), folder_path + "/videos_recientes.json", mode=dropbox.files.WriteMode("overwrite"))
    print("[OK] videos_recientes.json actualizado en Dropbox")

    upload_to_github(json.dumps(output, indent=2))

if __name__ == "__main__":
    main()
