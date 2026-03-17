"""
gestion_indice_ci.py
Por cada loc/can/lado:
  - videos_recientes.json  → últimas 24 h (lógica original, sin cambios)
  - videos_vitrina.json    → videos más viejos para completar a MIN_VITRINA=5
                             Solo se generan links si recientes < MIN_VITRINA.
"""

import os
import argparse
import dropbox
import json
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse
from github import Github, Auth

# ──────────────────────────────────────────
# Config
# ──────────────────────────────────────────
DROPBOX_APP_KEY       = os.environ["DROPBOX_APP_KEY"]
DROPBOX_APP_SECRET    = os.environ["DROPBOX_APP_SECRET"]
DROPBOX_REFRESH_TOKEN = os.environ["DROPBOX_REFRESH_TOKEN"]
GITHUB_TOKEN          = os.environ.get("PAT_GITHUB")

VALID_SUFFIX         = ".mp4"
RETENTION_HOURS      = 24          # ventana para videos_recientes.json
VITRINA_LOOKBACK_DAYS = 14         # hasta cuántos días hacia atrás buscar para vitrina
MIN_VITRINA          = 5           # mínimo de videos que siempre debe haber
DROPBOX_BASE         = "/Puntazo/Locaciones"
GITHUB_REPO          = "isaacsaltiel/puntazo_web_v2"


# ──────────────────────────────────────────
# Dropbox helpers
# ──────────────────────────────────────────
def connect_dropbox():
    print("[DEBUG] Conectando a Dropbox…")
    return dropbox.Dropbox(
        app_key=DROPBOX_APP_KEY,
        app_secret=DROPBOX_APP_SECRET,
        oauth2_refresh_token=DROPBOX_REFRESH_TOKEN,
    )


def to_direct_dropbox_url(url: str, mode: str = "raw") -> str:
    u = urlparse(url)
    q = dict(parse_qsl(u.query, keep_blank_values=True))
    if mode == "dl":
        q.pop("raw", None); q["dl"] = "1"
    else:
        q.pop("dl", None); q["raw"] = "1"
    return urlunparse((u.scheme, u.netloc, u.path, u.params, urlencode(q), u.fragment))


def generate_public_url(dbx, path):
    """Obtiene (o reutiliza) un link público permanente de Dropbox."""
    try:
        link = dbx.sharing_create_shared_link_with_settings(path)
    except dropbox.exceptions.ApiError as e:
        if (hasattr(e, "error")
                and hasattr(e.error, "is_shared_link_already_exists")
                and e.error.is_shared_link_already_exists()):
            resp = dbx.sharing_list_shared_links(path=path, direct_only=True)
            if resp.links:
                link = resp.links[0]
            else:
                print(f"[WARN] No hay links existentes para {path}")
                return None
        else:
            print(f"[ERROR] al generar URL pública para {path}: {e}")
            return None
    return to_direct_dropbox_url(link.url, mode="raw")


# ──────────────────────────────────────────
# GitHub helpers
# ──────────────────────────────────────────
def upload_to_github(json_data: str, github_path: str, message: str = None):
    if not GITHUB_TOKEN:
        print("[WARN] Sin PAT_GITHUB — omitiendo subida a GitHub.")
        return
    g      = Github(auth=Auth.Token(GITHUB_TOKEN))
    repo   = g.get_repo(GITHUB_REPO)
    branch = repo.default_branch
    msg    = message or f"CI: actualizar {github_path.split('/')[-1]}"
    print(f"[DEBUG] Subiendo {github_path} → GitHub ({branch})")
    try:
        contents = repo.get_contents(github_path, ref=branch)
        repo.update_file(contents.path, msg, json_data, contents.sha, branch=branch)
        print(f"[OK] {github_path} actualizado")
    except Exception as e:
        if "404" in str(e):
            try:
                repo.create_file(github_path, msg, json_data, branch=branch)
                print(f"[OK] {github_path} creado")
            except Exception as inner:
                print(f"[ERROR] No se pudo crear {github_path}: {inner}")
        else:
            print(f"[ERROR] No se pudo subir {github_path}: {e}")


def save_and_upload(data: dict, local_path: str, github_path: str, label: str):
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    content = json.dumps(data, indent=2, ensure_ascii=False)
    with open(local_path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"[DEBUG] {label} guardado localmente → {local_path}")
    upload_to_github(content, github_path, f"CI: actualizar {label}")


# ──────────────────────────────────────────
# Helpers de fecha
# ──────────────────────────────────────────
def get_mod_time_utc(entry) -> datetime:
    t = entry.server_modified or entry.client_modified
    return t.replace(tzinfo=timezone.utc) if t.tzinfo is None else t.astimezone(timezone.utc)


def parse_fecha_from_nombre(nombre: str) -> str:
    """Extrae la fecha YYYY-MM-DD del nombre del archivo si sigue el patrón _YYYYMMDD_."""
    m = re.search(r"_(\d{4})(\d{2})(\d{2})_", nombre)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return ""


# ──────────────────────────────────────────
# Main
# ──────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--loc",  required=True)
    parser.add_argument("--can",  required=True)
    parser.add_argument("--lado", required=True)
    args = parser.parse_args()

    loc, can, lado = args.loc, args.can, args.lado
    folder_path = f"{DROPBOX_BASE}/{loc}/{can}/{lado}"
    print(f"[DEBUG] Carpeta objetivo: {folder_path}")

    dbx = connect_dropbox()
    now_utc = datetime.now(timezone.utc)

    # ── Listar carpeta con paginación ──────────────────────────
    try:
        result  = dbx.files_list_folder(folder_path)
        entries = list(result.entries)
        while result.has_more:
            result = dbx.files_list_folder_continue(result.cursor)
            entries.extend(result.entries)
        print(f"[DEBUG] Archivos encontrados: {len(entries)}")
    except dropbox.exceptions.ApiError as e:
        print(f"[ERROR] No se pudo acceder a {folder_path}: {e}")
        return

    cutoff_recientes = now_utc - timedelta(hours=RETENTION_HOURS)
    cutoff_vitrina   = now_utc - timedelta(days=VITRINA_LOOKBACK_DAYS)

    # ── Clasificar archivos ────────────────────────────────────
    # Sólo .mp4; descartar duplicados por nombre base
    nombres_base_vistos: set = set()
    recientes_entries  = []   # mod_time > cutoff_recientes
    vitrina_candidates = []   # cutoff_vitrina < mod_time <= cutoff_recientes

    for entry in entries:
        if not (isinstance(entry, dropbox.files.FileMetadata)
                and entry.name.endswith(VALID_SUFFIX)):
            continue

        mod_utc   = get_mod_time_utc(entry)
        nombre_b  = re.sub(r" \(\d+\)$", "",
                            entry.name[: -len(VALID_SUFFIX)])

        # Eliminar duplicados
        if nombre_b in nombres_base_vistos:
            try:
                dbx.files_delete_v2(entry.path_lower)
                print(f"[INFO] Eliminado duplicado: {entry.name}")
            except Exception as e2:
                print(f"[WARN] No se pudo eliminar duplicado {entry.name}: {e2}")
            continue
        nombres_base_vistos.add(nombre_b)

        if mod_utc > cutoff_recientes:
            recientes_entries.append(entry)
        elif mod_utc > cutoff_vitrina:
            vitrina_candidates.append(entry)
        # Si es más viejo que VITRINA_LOOKBACK_DAYS → ignorar

    # ── Ordenar: más reciente primero ─────────────────────────
    recientes_entries.sort(key=get_mod_time_utc, reverse=True)
    vitrina_candidates.sort(key=get_mod_time_utc, reverse=True)

    # ── Generar videos_recientes.json (lógica original) ───────
    videos_recientes = []
    for entry in recientes_entries:
        url = generate_public_url(dbx, entry.path_lower)
        if url:
            videos_recientes.append({
                "nombre": entry.name,
                "url":    url,
                "fecha":  parse_fecha_from_nombre(entry.name),
            })
        else:
            print(f"[WARN] Sin URL para {entry.name}")

    output_recientes = {
        "videos":       videos_recientes,
        "generado_el":  now_utc.isoformat(),
        "loc": loc, "can": can, "lado": lado,
    }
    local_rec   = f"data/Locaciones/{loc}/{can}/{lado}/videos_recientes.json"
    github_rec  = local_rec
    save_and_upload(output_recientes, local_rec, github_rec, "videos_recientes.json")

    # Subir también a Dropbox (comportamiento original)
    try:
        with open(local_rec, "rb") as f:
            dbx.files_upload(f.read(),
                             folder_path + "/videos_recientes.json",
                             mode=dropbox.files.WriteMode("overwrite"))
        print("[OK] videos_recientes.json actualizado en Dropbox")
    except Exception as e:
        print(f"[WARN] No se pudo subir videos_recientes.json a Dropbox: {e}")

    print(f"[DEBUG] Videos recientes: {len(videos_recientes)}")

    # ── Generar videos_vitrina.json si se necesita ────────────
    #
    # Solo si recientes < MIN_VITRINA necesitamos videos más viejos.
    # Los links de Dropbox son permanentes → reutilizamos si ya existen.
    #
    needed = max(0, MIN_VITRINA - len(videos_recientes))
    videos_vitrina = []

    if needed > 0:
        print(f"[DEBUG] Se necesitan {needed} videos más para la vitrina")
        for entry in vitrina_candidates[:needed * 2]:  # pedir el doble por si fallan URLs
            if len(videos_vitrina) >= needed:
                break
            url = generate_public_url(dbx, entry.path_lower)
            if url:
                videos_vitrina.append({
                    "nombre": entry.name,
                    "url":    url,
                    "fecha":  parse_fecha_from_nombre(entry.name),
                })
            else:
                print(f"[WARN] Sin URL vitrina para {entry.name}")
        print(f"[DEBUG] Videos vitrina obtenidos: {len(videos_vitrina)}")
    else:
        print(f"[DEBUG] Suficientes recientes ({len(videos_recientes)}); vitrina vacía")

    output_vitrina = {
        "videos":      videos_vitrina,
        "generado_el": now_utc.isoformat(),
        "loc": loc, "can": can, "lado": lado,
    }
    local_vit  = f"data/Locaciones/{loc}/{can}/{lado}/videos_vitrina.json"
    github_vit = local_vit
    save_and_upload(output_vitrina, local_vit, github_vit, "videos_vitrina.json")

    total = len(videos_recientes) + len(videos_vitrina)
    print(f"[OK] Total disponibles para vitrina: {total} videos "
          f"({len(videos_recientes)} recientes + {len(videos_vitrina)} históricos)")


if __name__ == "__main__":
    main()
