import os
import argparse
import dropbox
import json
import re
from datetime import datetime, timedelta, timezone
from github import Github
from zoneinfo import ZoneInfo
import hashlib
import base64

# =========================
# Variables de entorno
# =========================
DROPBOX_APP_KEY = os.environ["DROPBOX_APP_KEY"]
DROPBOX_APP_SECRET = os.environ["DROPBOX_APP_SECRET"]
DROPBOX_REFRESH_TOKEN = os.environ["DROPBOX_REFRESH_TOKEN"]
GITHUB_TOKEN = os.environ.get("PAT_GITHUB")

# =========================
# Configuraciones globales
# =========================
VALID_SUFFIX = ".mp4"
RETENTION_HOURS = 24
DROPBOX_BASE = "/Puntazo/Locaciones"
GITHUB_REPO = "isaacsaltiel/puntazo_web_v2"

# Rutas métricas (repo) y Dropbox
METRICS_CSV_PATH = "data/metrics/videos_log.csv"  # SOLO columnas pedidas
METRICS_JSON_PATH = "data/metrics/videos_stats.json"
SEEN_IDS_PATH = "data/metrics/videos_seen_ids.txt"  # índice para evitar duplicados (no es columna)
DROPBOX_METRICS_DIR = "/Puntazo/Entrantes/metrics"

# =========================
# Conexión Dropbox
# =========================
def connect_dropbox():
    print("[DEBUG] Conectando a Dropbox…")
    return dropbox.Dropbox(
        app_key=DROPBOX_APP_KEY,
        app_secret=DROPBOX_APP_SECRET,
        oauth2_refresh_token=DROPBOX_REFRESH_TOKEN
    )

# =========================
# Links públicos Dropbox
# =========================
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

# =========================
# Utilidades GitHub
# =========================
def github_get_text(repo, path):
    try:
        contents = repo.get_contents(path, ref="master")
        return base64.b64decode(contents.content).decode("utf-8"), contents.sha
    except Exception:
        return None, None

def github_put_text(repo, path, text, sha=None, message="Actualizar"):
    if sha:
        repo.update_file(path, message, text, sha, branch="master")
    else:
        repo.create_file(path, message, text, branch="master")

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

# =========================
# Utilidades comunes
# =========================
def ensure_local_path(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)

def dropbox_upload_bytes(dbx, content_bytes, path):
    dbx.files_upload(content_bytes, path, mode=dropbox.files.WriteMode("overwrite"))

def stable_id(loc, can, lado, nombre):
    base = f"{loc}|{can}|{lado}|{nombre}".lower()
    return hashlib.sha1(base.encode("utf-8")).hexdigest()[:16]

def read_seen_ids_local_then_github():
    # 1) Local
    if os.path.exists(SEEN_IDS_PATH):
        with open(SEEN_IDS_PATH, "r", encoding="utf-8") as f:
            return set([ln.strip() for ln in f if ln.strip()])
    # 2) GitHub
    if GITHUB_TOKEN:
        g = Github(GITHUB_TOKEN)
        repo = g.get_repo(GITHUB_REPO)
        txt, _ = github_get_text(repo, SEEN_IDS_PATH)
        if txt is not None:
            return set([ln.strip() for ln in txt.splitlines() if ln.strip()])
    # 3) Vacío
    return set()

def write_seen_ids(dbx, ids_set):
    text = "\n".join(sorted(ids_set)) + ("\n" if ids_set else "")
    ensure_local_path(SEEN_IDS_PATH)
    with open(SEEN_IDS_PATH, "w", encoding="utf-8") as f:
        f.write(text)
    # Dropbox
    dropbox_upload_bytes(dbx, text.encode("utf-8"), f"{DROPBOX_METRICS_DIR}/videos_seen_ids.txt")
    # GitHub
    if GITHUB_TOKEN:
        g = Github(GITHUB_TOKEN)
        repo = g.get_repo(GITHUB_REPO)
        _, sha = github_get_text(repo, SEEN_IDS_PATH)
        github_put_text(repo, SEEN_IDS_PATH, text, sha, message="Actualizar videos_seen_ids.txt")

def read_metrics_csv_local_then_github():
    header = "loc,can,lado,local_date,local_hour\n"
    # 1) Local
    if os.path.exists(METRICS_CSV_PATH):
        with open(METRICS_CSV_PATH, "r", encoding="utf-8") as f:
            return f.read() or header
    # 2) GitHub
    if GITHUB_TOKEN:
        g = Github(GITHUB_TOKEN)
        repo = g.get_repo(GITHUB_REPO)
        txt, _ = github_get_text(repo, METRICS_CSV_PATH)
        if txt is not None:
            return txt or header
    # 3) Vacío
    return header

def write_metrics_csv(dbx, text):
    ensure_local_path(METRICS_CSV_PATH)
    with open(METRICS_CSV_PATH, "w", encoding="utf-8") as f:
        f.write(text)
    # Dropbox
    dropbox_upload_bytes(dbx, text.encode("utf-8"), f"{DROPBOX_METRICS_DIR}/videos_log.csv")
    # GitHub
    if GITHUB_TOKEN:
        g = Github(GITHUB_TOKEN)
        repo = g.get_repo(GITHUB_REPO)
        _, sha = github_get_text(repo, METRICS_CSV_PATH)
        github_put_text(repo, METRICS_CSV_PATH, text, sha, message="Actualizar videos_log.csv")

def compute_stats_from_csv(csv_text):
    """
    A partir del CSV (loc,can,lado,local_date,local_hour) genera:
      - by_day_per_cancha: lista [{loc, can, date, count}], ordenada desc
      - by_hour_per_cancha: lista [{loc, can, hour, count}], ordenada desc
      - lado_balance_per_day: lista [{loc, can, date, counts_por_lado:{lado:count}, diff}], ordenada por diff desc
    """
    lines = [ln for ln in csv_text.splitlines() if ln.strip()]
    if len(lines) <= 1:
        return {
            "by_day_per_cancha": [],
            "by_hour_per_cancha": [],
            "lado_balance_per_day": [],
            "generated_at_utc": datetime.now(timezone.utc).isoformat()
        }
    header = lines[0].split(",")
    idx = {name: i for i, name in enumerate(header)}

    # Acumuladores
    per_day = {}           # (loc, can, date) -> count
    per_hour = {}          # (loc, can, hour) -> count
    per_day_lado = {}      # (loc, can, date) -> {lado: count}

    for ln in lines[1:]:
        parts = ln.split(",")
        try:
            loc = parts[idx["loc"]]
            can = parts[idx["can"]]
            lado = parts[idx["lado"]]
            date = parts[idx["local_date"]]
            hour = parts[idx["local_hour"]]
        except Exception:
            continue

        key_day = (loc, can, date)
        key_hour = (loc, can, hour)

        per_day[key_day] = per_day.get(key_day, 0) + 1
        per_hour[key_hour] = per_hour.get(key_hour, 0) + 1

        if key_day not in per_day_lado:
            per_day_lado[key_day] = {}
        per_day_lado[key_day][lado] = per_day_lado[key_day].get(lado, 0) + 1

    # Estructuras ordenadas
    by_day_per_cancha = [
        {"loc": k[0], "can": k[1], "date": k[2], "count": v}
        for k, v in per_day.items()
    ]
    by_day_per_cancha.sort(key=lambda x: x["count"], reverse=True)

    by_hour_per_cancha = [
        {"loc": k[0], "can": k[1], "hour": k[2], "count": v}
        for k, v in per_hour.items()
    ]
    by_hour_per_cancha.sort(key=lambda x: x["count"], reverse=True)

    lado_balance_per_day = []
    for (loc, can, date), counts in per_day_lado.items():
        # diff = diferencia máxima entre lados (si hay 2 lados, mide el desbalance)
        values = list(counts.values())
        max_c = max(values) if values else 0
        min_c = min(values) if values else 0
        diff = max_c - min_c
        lado_balance_per_day.append({
            "loc": loc,
            "can": can,
            "date": date,
            "counts_por_lado": counts,
            "diff": diff
        })
    lado_balance_per_day.sort(key=lambda x: x["diff"], reverse=True)

    return {
        "by_day_per_cancha": by_day_per_cancha,
        "by_hour_per_cancha": by_hour_per_cancha,
        "lado_balance_per_day": lado_balance_per_day,
        "generated_at_utc": datetime.now(timezone.utc).isoformat()
    }

def write_metrics_stats(dbx, stats_obj):
    text = json.dumps(stats_obj, ensure_ascii=False, indent=2)
    ensure_local_path(METRICS_JSON_PATH)
    with open(METRICS_JSON_PATH, "w", encoding="utf-8") as f:
        f.write(text)
    # Dropbox
    dropbox_upload_bytes(dbx, text.encode("utf-8"), f"{DROPBOX_METRICS_DIR}/videos_stats.json")
    # GitHub
    if GITHUB_TOKEN:
        g = Github(GITHUB_TOKEN)
        repo = g.get_repo(GITHUB_REPO)
        _, sha = github_get_text(repo, METRICS_JSON_PATH)
        github_put_text(repo, METRICS_JSON_PATH, text, sha, message="Actualizar videos_stats.json")

# =========================
# Script principal original + métricas
# =========================
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

    # --------- PASADA PRINCIPAL: mantener tu flujo -----------
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
                # Archivo es antiguo → eliminar (dejado en no-op para auditoría)
                try:
                    # dbx.files_delete_v2(entry.path_lower)
                    print(f"[INFO] Archivo eliminado por antigüedad: {entry.name}")
                except Exception as e:
                    print(f"[ERROR] No se pudo eliminar {entry.name}: {e}")

    # Ordenar y guardar los videos en archivo JSON de recientes
    videos.sort(key=lambda x: x["nombre"], reverse=True)

    output = {
        "videos": videos,
        "generado_el": datetime.now(timezone.utc).isoformat()
    }

    # Guardar JSON local
    local_path = f"data/Locaciones/{loc}/{can}/{lado}/videos_recientes.json"
    ensure_local_path(local_path)
    with open(local_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"[DEBUG] JSON generado localmente con {len(videos)} videos")

    # Subir JSON a Dropbox
    with open(local_path, "rb") as f:
        dbx.files_upload(f.read(), folder_path + "/videos_recientes.json", mode=dropbox.files.WriteMode("overwrite"))
    print("[OK] videos_recientes.json actualizado en Dropbox")

    # Subir JSON a GitHub
    github_path = f"data/Locaciones/{loc}/{can}/{lado}/videos_recientes.json"
    upload_to_github(json.dumps(output, indent=2, ensure_ascii=False), github_path)

    # =========================
    #   MÉTRICAS (solo columnas pedidas)
    # =========================
    # Prepara mapa name->entry para recuperar fechas locales por video
    name_to_entry = {e.name: e for e in result.entries if isinstance(e, dropbox.files.FileMetadata)}
    tz_mx = ZoneInfo("America/Mexico_City")

    # Carga índice de videos ya vistos para no duplicar filas
    seen_ids = read_seen_ids_local_then_github()

    # Prepara nuevas filas
    new_rows = []  # cada row es una tupla (loc,can,lado,local_date,local_hour)
    new_ids = set()

    for v in videos:
        e = name_to_entry.get(v["nombre"])
        if not e:
            continue
        vid_id = stable_id(loc, can, lado, v["nombre"])
        if vid_id in seen_ids:
            continue  # ya registrado en corridas anteriores

        mod_utc = e.client_modified.replace(tzinfo=timezone.utc)
        local_dt = mod_utc.astimezone(tz_mx)
        local_date = local_dt.strftime("%Y-%m-%d")
        local_hour = local_dt.strftime("%H")

        new_rows.append((loc, can, lado, local_date, local_hour))
        new_ids.add(vid_id)

    # Si no hay filas nuevas, igual recalculamos stats desde el CSV existente
    existing_csv = read_metrics_csv_local_then_github()
    header = "loc,can,lado,local_date,local_hour"
    lines = [ln for ln in existing_csv.splitlines() if ln.strip()]
    if not lines or lines[0] != header:
        lines = [header] + [ln for ln in lines if ln != header]

    if new_rows:
        # Agregar nuevas líneas (una por video nuevo)
        for (a, b, c, d, e_) in new_rows:
            lines.append(f"{a},{b},{c},{d},{e_}")

        merged_csv_text = "\n".join(lines) + "\n"

        # Escribir CSV (local, Dropbox, GitHub)
        write_metrics_csv(dbx, merged_csv_text)

        # Actualizar índice de vistos (local, Dropbox, GitHub)
        seen_ids.update(new_ids)
        write_seen_ids(dbx, seen_ids)

        csv_for_stats = merged_csv_text
        print(f"[OK] Métricas CSV actualizado: +{len(new_rows)} eventos.")
    else:
        # No filas nuevas → usar el existente para stats
        csv_for_stats = "\n".join(lines) + "\n"
        print("[INFO] No hay nuevos videos para registrar en métricas. Recalculando stats con CSV existente.")

    # Generar y escribir stats JSON (derivado del CSV)
    stats = compute_stats_from_csv(csv_for_stats)
    write_metrics_stats(dbx, stats)

    print("[OK] Stats listas: by_day_per_cancha / by_hour_per_cancha / lado_balance_per_day (ordenadas).")

# Ejecutar script si se llama directamente
if __name__ == "__main__":
    main()
