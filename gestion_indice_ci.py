import os
import argparse
import dropbox
import json
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse
from github import Github, Auth

# =========================
# Config y variables de entorno
# =========================
DROPBOX_APP_KEY = os.environ["DROPBOX_APP_KEY"]
DROPBOX_APP_SECRET = os.environ["DROPBOX_APP_SECRET"]
DROPBOX_REFRESH_TOKEN = os.environ["DROPBOX_REFRESH_TOKEN"]
GITHUB_TOKEN = os.environ.get("PAT_GITHUB")

VALID_SUFFIX = ".mp4"
RETENTION_HOURS = 24
DROPBOX_BASE = "/Puntazo/Locaciones"
GITHUB_REPO = "isaacsaltiel/puntazo_web_v2"

# =========================
# Helpers
# =========================
def connect_dropbox():
    print("[DEBUG] Conectando a Dropbox…")
    return dropbox.Dropbox(
        app_key=DROPBOX_APP_KEY,
        app_secret=DROPBOX_APP_SECRET,
        oauth2_refresh_token=DROPBOX_REFRESH_TOKEN
    )

def to_direct_dropbox_url(url: str, mode: str = "raw") -> str:
    """
    Devuelve un enlace directo que funciona con /s/ y /scl/fi/, conservando tokens (p. ej. rlkey).
    mode='raw' para reproducir en navegador/etiqueta <video>, 'dl' para forzar descarga.
    No toquemos el host ni el path; solo ajustamos el query.
    """
    u = urlparse(url)
    q = dict(parse_qsl(u.query, keep_blank_values=True))
    if mode == "dl":
        q.pop("raw", None)
        q["dl"] = "1"
    else:
        q.pop("dl", None)
        q["raw"] = "1"
    new_query = urlencode(q)
    return urlunparse((u.scheme, u.netloc, u.path, u.params, new_query, u.fragment))

def generate_public_url(dbx, path):
    try:
        print(f"[DEBUG] Generando URL pública para: {path}")
        link = dbx.sharing_create_shared_link_with_settings(path)
    except dropbox.exceptions.ApiError as e:
        # Si ya existe, la listamos
        if hasattr(e, "error") and hasattr(e.error, "is_shared_link_already_exists") and e.error.is_shared_link_already_exists():
            resp = dbx.sharing_list_shared_links(path=path, direct_only=True)
            if resp.links:
                link = resp.links[0]
            else:
                print(f"[DEBUG] No se encontraron links existentes para {path}")
                return None
        else:
            print(f"[ERROR] al generar URL pública: {e}")
            return None
    # Conservamos query (p. ej. rlkey) y solo agregamos raw=1
    return to_direct_dropbox_url(link.url, mode="raw")

def upload_to_github(json_data, github_path):
    if not GITHUB_TOKEN:
        print("[WARNING] No se encontró PAT_GITHUB; omitiendo subida a GitHub.")
        return

    g = Github(auth=Auth.Token(GITHUB_TOKEN))
    repo = g.get_repo(GITHUB_REPO)
    branch = repo.default_branch  # 'main' o 'master', según el repo
    print(f"[DEBUG] Subiendo a GitHub repo={GITHUB_REPO} branch={branch} path={github_path}")

    try:
        contents = repo.get_contents(github_path, ref=branch)
        repo.update_file(
            contents.path,
            "Actualizar videos_recientes.json desde CI",
            json_data,
            contents.sha,
            branch=branch
        )
        print(f"[OK] videos_recientes.json actualizado en GitHub ({branch})")
    except Exception as e:
        if "404" in str(e):
            try:
                repo.create_file(
                    github_path,
                    "Crear videos_recientes.json desde CI",
                    json_data,
                    branch=branch
                )
                print(f"[OK] videos_recientes.json creado en GitHub ({branch})")
            except Exception as inner:
                print(f"[ERROR] No se pudo crear el archivo en GitHub: {inner}")
        else:
            print(f"[ERROR] No se pudo subir a GitHub: {e}")

# =========================
# Main
# =========================
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

    # Listado con paginación
    try:
        result = dbx.files_list_folder(folder_path)
        entries = list(result.entries)
        while result.has_more:
            result = dbx.files_list_folder_continue(result.cursor)
            entries.extend(result.entries)
        print(f"[DEBUG] Archivos encontrados: {len(entries)}")
    except dropbox.exceptions.ApiError as e:
        print("[ERROR] No se pudo acceder a la carpeta:", e)
        return

    cutoff = datetime.now(timezone.utc) - timedelta(hours=RETENTION_HOURS)
    print(f"[DEBUG] Umbral de retención: {cutoff.isoformat()}")

    videos = []
    nombres_base_vistos = set()

    for entry in entries:
        if isinstance(entry, dropbox.files.FileMetadata) and entry.name.endswith(VALID_SUFFIX):
            # Fecha robusta
            mod_time = entry.server_modified or entry.client_modified
            if mod_time.tzinfo is None:
                mod_time_utc = mod_time.replace(tzinfo=timezone.utc)
            else:
                mod_time_utc = mod_time.astimezone(timezone.utc)

            # Duplicados por nombre base (quita " (1)", " (2)", etc.)
            nombre_sin_ext = entry.name[:-len(VALID_SUFFIX)]
            nombre_base = re.sub(r" \(\d+\)$", "", nombre_sin_ext)

            if nombre_base in nombres_base_vistos:
                try:
                    dbx.files_delete_v2(entry.path_lower)
                    print(f"[INFO] Eliminado duplicado: {entry.name}")
                except Exception as e:
                    print(f"[ERROR] No se pudo eliminar duplicado {entry.name}: {e}")
                continue

            if mod_time_utc > cutoff:
                url = generate_public_url(dbx, entry.path_lower)
                if url:
                    videos.append({"nombre": entry.name, "url": url})
                    nombres_base_vistos.add(nombre_base)
                else:
                    print(f"[WARN] No se pudo generar URL para {entry.name}")
            else:
                # Si quieres borrarlos por antigüedad, descomenta:
                # try:
                #     dbx.files_delete_v2(entry.path_lower)
                #     print(f"[INFO] Archivo eliminado por antigüedad: {entry.name}")
                # except Exception as e:
                #     print(f"[ERROR] No se pudo eliminar {entry.name}: {e}")
                pass

    # Orden original por nombre (desc) para no romper el front
    videos.sort(key=lambda x: x["nombre"], reverse=True)
    print(f"[DEBUG] Videos elegibles: {len(videos)} de {len(entries)} archivos")

    output = {
        "videos": videos,
        "generado_el": datetime.now(timezone.utc).isoformat()
    }

    # Guardar JSON local (estructura igual que antes)
    local_path = f"data/Locaciones/{loc}/{can}/{lado}/videos_recientes.json"
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    with open(local_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"[DEBUG] JSON generado localmente con {len(videos)} videos -> {local_path}")

    # Subir JSON a Dropbox (siempre overwrite, como antes)
    try:
        with open(local_path, "rb") as f:
            dbx.files_upload(
                f.read(),
                folder_path + "/videos_recientes.json",
                mode=dropbox.files.WriteMode("overwrite")
            )
        print("[OK] videos_recientes.json actualizado en Dropbox")
    except Exception as e:
        print(f"[ERROR] No se pudo subir a Dropbox: {e}")

    # Subir JSON a GitHub (usa rama por defecto)
    github_path = f"data/Locaciones/{loc}/{can}/{lado}/videos_recientes.json"
    upload_to_github(json.dumps(output, indent=2, ensure_ascii=False), github_path)

if __name__ == "__main__":
    main()

