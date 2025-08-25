#!/usr/bin/env python3
import os, re, json, hashlib, base64
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import dropbox
from github import Github

# ========= Configuración =========
DROPBOX_APP_KEY = os.environ["DROPBOX_APP_KEY"]
DROPBOX_APP_SECRET = os.environ["DROPBOX_APP_SECRET"]
DROPBOX_REFRESH_TOKEN = os.environ["DROPBOX_REFRESH_TOKEN"]
GITHUB_TOKEN = os.environ.get("PAT_GITHUB")  # requerido para subir al repo

DROPBOX_BASE = "/Puntazo/Locaciones"
GITHUB_REPO = "isaacsaltiel/puntazo_web_v2"

METRICS_CSV_PATH  = "data/metrics/videos_log.csv"        # SOLO loc,can,lado,local_date,local_hour
METRICS_JSON_PATH = "data/metrics/videos_stats.json"
SEEN_IDS_PATH     = "data/metrics/videos_seen_ids.txt"   # índice para deduplicar (no es columna)
DROPBOX_METRICS_DIR = "/Puntazo/Entrantes/metrics"

TZ_MX = ZoneInfo("America/Mexico_City")

# ========= Helpers comunes =========
def ensure_local_path(path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)

def connect_dropbox():
    return dropbox.Dropbox(
        app_key=DROPBOX_APP_KEY,
        app_secret=DROPBOX_APP_SECRET,
        oauth2_refresh_token=DROPBOX_REFRESH_TOKEN
    )

def dropbox_upload_bytes(dbx, content_bytes: bytes, path: str):
    dbx.files_upload(content_bytes, path, mode=dropbox.files.WriteMode("overwrite"))

def gh_repo():
    if not GITHUB_TOKEN: return None
    g = Github(GITHUB_TOKEN)
    return g.get_repo(GITHUB_REPO)

def gh_get_text(repo, path):
    try:
        c = repo.get_contents(path, ref="master")
        return base64.b64decode(c.content).decode("utf-8"), c.sha
    except Exception:
        return None, None

def gh_put_text(repo, path, text, sha=None, message="Actualizar"):
    if sha:
        repo.update_file(path, message, text, sha, branch="master")
    else:
        repo.create_file(path, message, text, branch="master")

def read_seen_ids():
    # local -> GitHub -> vacío
    if os.path.exists(SEEN_IDS_PATH):
        with open(SEEN_IDS_PATH, "r", encoding="utf-8") as f:
            return set(ln.strip() for ln in f if ln.strip())
    repo = gh_repo()
    if repo:
        txt, _ = gh_get_text(repo, SEEN_IDS_PATH)
        if txt is not None:
            return set(ln.strip() for ln in txt.splitlines() if ln.strip())
    return set()

def write_seen_ids(dbx, ids_set):
    text = "\n".join(sorted(ids_set)) + ("\n" if ids_set else "")
    ensure_local_path(SEEN_IDS_PATH)
    with open(SEEN_IDS_PATH, "w", encoding="utf-8") as f:
        f.write(text)
    dropbox_upload_bytes(dbx, text.encode("utf-8"), f"{DROPBOX_METRICS_DIR}/videos_seen_ids.txt")
    repo = gh_repo()
    if repo:
        _, sha = gh_get_text(repo, SEEN_IDS_PATH)
        gh_put_text(repo, SEEN_IDS_PATH, text, sha, "Actualizar videos_seen_ids.txt")

def read_metrics_csv():
    header = "loc,can,lado,local_date,local_hour\n"
    if os.path.exists(METRICS_CSV_PATH):
        with open(METRICS_CSV_PATH, "r", encoding="utf-8") as f:
            return f.read() or header
    repo = gh_repo()
    if repo:
        txt, _ = gh_get_text(repo, METRICS_CSV_PATH)
        if txt is not None:
            return txt or header
    return header

def write_metrics_csv(dbx, text):
    ensure_local_path(METRICS_CSV_PATH)
    with open(METRICS_CSV_PATH, "w", encoding="utf-8") as f:
        f.write(text)
    dropbox_upload_bytes(dbx, text.encode("utf-8"), f"{DROPBOX_METRICS_DIR}/videos_log.csv")
    repo = gh_repo()
    if repo:
        _, sha = gh_get_text(repo, METRICS_CSV_PATH)
        gh_put_text(repo, METRICS_CSV_PATH, text, sha, "Actualizar videos_log.csv")

def compute_stats_from_csv(csv_text: str):
    """
    A partir del CSV (loc,can,lado,local_date,local_hour) genera:
      - by_day_per_cancha: [{loc, can, date, count}] desc
      - by_hour_per_cancha: [{loc, can, hour, count}] desc
      - lado_balance_per_day: [{loc, can, date, counts_por_lado:{lado:count}, diff}] desc
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

    per_day, per_hour, per_day_lado = {}, {}, {}

    for ln in lines[1:]:
        parts = ln.split(",")
        try:
            loc  = parts[idx["loc"]]
            can  = parts[idx["can"]]
            lado = parts[idx["lado"]]
            date = parts[idx["local_date"]]
            hour = parts[idx["local_hour"]]
        except Exception:
            continue

        kday  = (loc, can, date)
        khour = (loc, can, hour)
        per_day[kday]  = per_day.get(kday, 0) + 1
        per_hour[khour]= per_hour.get(khour, 0) + 1
        per_day_lado.setdefault(kday, {})
        per_day_lado[kday][lado] = per_day_lado[kday].get(lado, 0) + 1

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
        vals = list(counts.values())
        diff = (max(vals) - min(vals)) if vals else 0
        lado_balance_per_day.append({
            "loc": loc, "can": can, "date": date,
            "counts_por_lado": counts, "diff": diff
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
    dropbox_upload_bytes(dbx, text.encode("utf-8"), f"{DROPBOX_METRICS_DIR}/videos_stats.json")
    repo = gh_repo()
    if repo:
        _, sha = gh_get_text(repo, METRICS_JSON_PATH)
        gh_put_text(repo, METRICS_JSON_PATH, text, sha, "Actualizar videos_stats.json")

def stable_id(loc, can, lado, nombre):
    base = f"{loc}|{can}|{lado}|{nombre}".lower()
    return hashlib.sha1(base.encode("utf-8")).hexdigest()[:16]

# ========= Lógica principal =========
def main():
    dbx = connect_dropbox()

    # 1) Listado completo (recursivo) bajo /Puntazo/Locaciones
    print("[INFO] Listando Dropbox recursivamente…")
    res = dbx.files_list_folder(DROPBOX_BASE, recursive=True)
    entries = res.entries[:]
    while res.has_more:
        res = dbx.files_list_folder_continue(res.cursor)
        entries += res.entries

    # 2) Filtrar solo archivos .mp4 en hojas /{loc}/{can}/{lado}/file.mp4
    mp4s = []
    pat = re.compile(r"^/Puntazo/Locaciones/([^/]+)/([^/]+)/([^/]+)/([^/]+\.mp4)$", re.IGNORECASE)
    for e in entries:
        if isinstance(e, dropbox.files.FileMetadata) and e.name.lower().endswith(".mp4"):
            m = pat.match(e.path_lower)
            if not m: 
                continue
            loc, can, lado, _fname = m.group(1), m.group(2), m.group(3), m.group(4)
            mp4s.append((loc, can, lado, e))

    print(f"[INFO] Videos detectados en Dropbox: {len(mp4s)}")

    # 3) Cargar CSV e índice
    existing_csv = read_metrics_csv()
    header = "loc,can,lado,local_date,local_hour"
    lines = [ln for ln in existing_csv.splitlines() if ln.strip()]
    if not lines or lines[0] != header:
        lines = [header] + [ln for ln in lines if ln != header]

    seen_ids = read_seen_ids()

    # 4) Construir nuevas filas sin duplicar
    new_ids = set()
    new_rows = []
    for loc, can, lado, meta in mp4s:
        vid = stable_id(loc, can, lado, meta.name)
        if vid in seen_ids:
            continue
        local_dt = meta.client_modified.replace(tzinfo=timezone.utc).astimezone(TZ_MX)
        local_date = local_dt.strftime("%Y-%m-%d")
        local_hour = local_dt.strftime("%H")
        new_rows.append(f"{loc},{can},{lado},{local_date},{local_hour}")
        new_ids.add(vid)

    if new_rows:
        lines.extend(new_rows)
        merged_csv = "\n".join(lines) + "\n"
        write_metrics_csv(dbx, merged_csv)
        seen_ids.update(new_ids)
        write_seen_ids(dbx, seen_ids)
        csv_for_stats = merged_csv
        print(f"[OK] CSV actualizado: +{len(new_rows)} filas nuevas")
    else:
        csv_for_stats = "\n".join(lines) + "\n"
        print("[INFO] No hay filas nuevas; recalculando stats sobre CSV existente.")

    # 5) Stats ordenadas y publicación
    stats = compute_stats_from_csv(csv_for_stats)
    write_metrics_stats(dbx, stats)
    print("[OK] Métricas generadas y publicadas (CSV + JSON).")

if __name__ == "__main__":
    main()
