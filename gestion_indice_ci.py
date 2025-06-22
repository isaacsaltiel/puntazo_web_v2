import os
import argparse
import dropbox
import json
from datetime import datetime, timedelta, timezone

DROPBOX_APP_KEY = os.environ["DROPBOX_APP_KEY"]
DROPBOX_APP_SECRET = os.environ["DROPBOX_APP_SECRET"]
DROPBOX_REFRESH_TOKEN = os.environ["DROPBOX_REFRESH_TOKEN"]

VALID_SUFFIX = ".mp4"
RETENTION_HOURS = 8
JSON_LOCAL = "videos_recientes.json"
DROPBOX_BASE = "/Puntazo/Locaciones"

def connect_dropbox():
    return dropbox.Dropbox(
        app_key=DROPBOX_APP_KEY,
        app_secret=DROPBOX_APP_SECRET,
        oauth2_refresh_token=DROPBOX_REFRESH_TOKEN
    )

def generate_public_url(dbx, path):
    try:
        link = dbx.sharing_create_shared_link_with_settings(path)
    except dropbox.exceptions.ApiError as e:
        if e.error.is_shared_link_already_exists():
            links = dbx.sharing_list_shared_links(path=path, direct_only=True).links
            if links:
                link = links[0]
            else:
                return None
        else:
            print(f"[ERROR] al generar URL pública: {e}")
            return None
    return link.url.replace("www.dropbox.com", "dl.dropboxusercontent.com").split("?dl=")[0]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--loc", required=True)
    parser.add_argument("--can", required=True)
    parser.add_argument("--lado", required=True)
    args = parser.parse_args()

    loc, can, lado = args.loc, args.can, args.lado
    folder_path = f"{DROPBOX_BASE}/{loc}/{can}/{lado}"
    dbx = connect_dropbox()

    try:
        result = dbx.files_list_folder(folder_path)
    except dropbox.exceptions.ApiError as e:
        print("[ERROR] No se pudo acceder a la carpeta:", e)
        return

    cutoff = datetime.now(timezone.utc) - timedelta(hours=RETENTION_HOURS)
    videos = []

    for entry in result.entries:
        if isinstance(entry, dropbox.files.FileMetadata) and entry.name.endswith(VALID_SUFFIX):
            mod_time = entry.client_modified
            if mod_time.replace(tzinfo=timezone.utc) > cutoff:
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

    with open(JSON_LOCAL, "rb") as f:
        dbx.files_upload(f.read(), folder_path + "/videos_recientes.json", mode=dropbox.files.WriteMode("overwrite"))
    print("[OK] videos_recientes.json actualizado en Dropbox")

if __name__ == "__main__":
    main()
