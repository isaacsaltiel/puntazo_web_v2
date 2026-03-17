"""
generar_stats.py
Corre al final de cada ejecución de gestionar_indice.
Lee:
  - data/config_locations.json
  - data/metrics/videos_log.csv
  - data/Locaciones/.../videos_recientes.json  (24h)
  - data/Locaciones/.../videos_vitrina.json    (histórico vitrina)

Genera:
  - data/metrics/stats_summary.json  (dashboard admin)
  - data/videos_index.json           (índice global plano para clip.html)
"""

import os
import csv
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from io import StringIO
from github import Github, Auth

GITHUB_TOKEN = os.environ.get("PAT_GITHUB")
GITHUB_REPO  = "isaacsaltiel/puntazo_web_v2"
CONFIG_PATH  = "data/config_locations.json"
LOG_PATH     = "data/metrics/videos_log.csv"
STATS_PATH   = "data/metrics/stats_summary.json"
INDEX_PATH   = "data/videos_index.json"


# ── GitHub helpers ────────────────────────────────────────────
def get_repo():
    if not GITHUB_TOKEN:
        return None
    return Github(auth=Auth.Token(GITHUB_TOKEN)).get_repo(GITHUB_REPO)


def read_file_from_github(path: str, repo=None) -> str | None:
    if repo:
        try:
            c = repo.get_contents(path, ref=repo.default_branch)
            return c.decoded_content.decode("utf-8")
        except Exception as e:
            print(f"[WARN] GitHub read {path}: {e}")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return f.read()
    return None


def upload_to_github(content: str, path: str, message: str, repo=None):
    if not repo:
        print("[WARN] Sin repo GitHub — no se sube archivo.")
        return
    branch = repo.default_branch
    try:
        existing = repo.get_contents(path, ref=branch)
        repo.update_file(existing.path, message, content, existing.sha, branch=branch)
        print(f"[OK] {path} actualizado")
    except Exception as e:
        if "404" in str(e):
            repo.create_file(path, message, content, branch=branch)
            print(f"[OK] {path} creado")
        else:
            print(f"[ERROR] upload {path}: {e}")


def save_local_and_upload(content: str, local_path: str, github_path: str, msg: str, repo=None):
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    with open(local_path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"[DEBUG] Guardado local: {local_path}")
    upload_to_github(content, github_path, msg, repo)


# ── CSV helper ────────────────────────────────────────────────
def parse_log_csv(raw: str):
    rows = []
    try:
        for row in csv.DictReader(StringIO(raw)):
            fecha = (row.get("local_date") or "").strip()
            loc   = (row.get("loc")        or "").strip()
            can   = (row.get("can")        or "").strip()
            lado  = (row.get("lado")       or "").strip()
            if fecha and loc and can and lado:
                rows.append({"fecha": fecha, "loc": loc, "can": can, "lado": lado})
    except Exception as e:
        print(f"[WARN] parse log CSV: {e}")
    return rows


def aggregate_log(rows):
    counter = defaultdict(int)
    for r in rows:
        counter[(r["fecha"], r["loc"], r["can"], r["lado"])] += 1
    result = [{"fecha": f, "loc": l, "can": c, "lado": la, "count": n}
              for (f, l, c, la), n in counter.items()]
    result.sort(key=lambda x: x["fecha"], reverse=True)
    return result


# ── Main ──────────────────────────────────────────────────────
def main():
    print("[stats] Generando stats_summary.json y videos_index.json…")
    repo     = get_repo()
    now_iso  = datetime.now(timezone.utc).isoformat()

    # ── 1. Config ────────────────────────────────────────────
    cfg_raw = read_file_from_github(CONFIG_PATH, repo)
    if not cfg_raw:
        print("[ERROR] No se pudo leer config_locations.json"); sys.exit(1)
    config = json.loads(cfg_raw)

    # ── 2. Log CSV (histórico) ────────────────────────────────
    log_raw = read_file_from_github(LOG_PATH, repo)
    log_rows = parse_log_csv(log_raw) if log_raw else []
    historial = aggregate_log(log_rows)
    print(f"[stats] {len(log_rows)} filas en videos_log.csv")

    totals_log = {
        "videos_historico": len(log_rows),
        "dias_con_videos":  len(set(r["fecha"] for r in log_rows)),
        "clubs_activos":    len(set(r["loc"]   for r in log_rows)),
    }

    # ── 3. Recorrer lados → leer recientes + vitrina ──────────
    #
    # videos_index: {nombre_mp4: {url, club, cancha, lado, fecha}}
    # Es el índice GLOBAL que usa clip.html para resolver URLs.
    #
    videos_index: dict[str, dict] = {}

    summary = {
        "generado_el": now_iso,
        "totales": {
            **totals_log,
            "clubs": 0, "canchas": 0, "lados": 0,
            "videos_activos": 0,   # en videos_recientes.json (24h)
            "videos_vitrina": 0,   # en videos_vitrina.json
        },
        "historial": historial,
        "clubs": [],
    }

    for loc in config.get("locaciones", []):
        loc_id     = loc.get("id")     or loc.get("nombre", "")
        loc_nombre = loc.get("nombre") or loc_id
        club_entry = {"id": loc_id, "nombre": loc_nombre,
                      "total_videos_activos": 0, "canchas": []}

        for cancha in loc.get("cancha", []):
            can_id     = cancha.get("id")     or cancha.get("nombre", "")
            can_nombre = cancha.get("nombre") or can_id
            cancha_entry = {"id": can_id, "nombre": can_nombre,
                            "total_videos_activos": 0, "lados": []}

            for lado in cancha.get("lados", []):
                lado_id     = lado.get("id")     or lado.get("nombre", "")
                lado_nombre = lado.get("nombre") or lado_id
                base_path   = f"data/Locaciones/{loc_id}/{can_id}/{lado_id}"

                # Leer recientes
                rec_raw  = read_file_from_github(f"{base_path}/videos_recientes.json", repo)
                rec_data = json.loads(rec_raw) if rec_raw else {}
                rec_vids = rec_data.get("videos", [])

                # Leer vitrina
                vit_raw  = read_file_from_github(f"{base_path}/videos_vitrina.json", repo)
                vit_data = json.loads(vit_raw) if vit_raw else {}
                vit_vids = vit_data.get("videos", [])

                # Poblar videos_index con TODOS (recientes + vitrina)
                for v in rec_vids + vit_vids:
                    nombre = v.get("nombre", "")
                    url    = v.get("url", "")
                    if nombre and url and nombre not in videos_index:
                        videos_index[nombre] = {
                            "url":    url,
                            "club":   loc_nombre,
                            "cancha": can_nombre,
                            "lado":   lado_nombre,
                            "fecha":  v.get("fecha", ""),
                            "loc_id": loc_id,
                            "can_id": can_id,
                            "lado_id": lado_id,
                        }

                lado_entry = {
                    "id": lado_id, "nombre": lado_nombre,
                    "count_activos": len(rec_vids),
                    "count_vitrina": len(vit_vids),
                    "generado_el":   rec_data.get("generado_el", ""),
                    "videos":        [v.get("nombre","") for v in rec_vids],
                    "videos_vitrina":[v.get("nombre","") for v in vit_vids],
                }
                cancha_entry["lados"].append(lado_entry)
                cancha_entry["total_videos_activos"] += len(rec_vids)
                summary["totales"]["lados"]           += 1
                summary["totales"]["videos_activos"]  += len(rec_vids)
                summary["totales"]["videos_vitrina"]  += len(vit_vids)

            club_entry["canchas"].append(cancha_entry)
            club_entry["total_videos_activos"] += cancha_entry["total_videos_activos"]
            summary["totales"]["canchas"] += 1

        summary["clubs"].append(club_entry)
        summary["totales"]["clubs"] += 1

    print(f"[stats] videos_index: {len(videos_index)} videos")

    # ── 4. Guardar stats_summary.json ─────────────────────────
    stats_content = json.dumps(summary, indent=2, ensure_ascii=False)
    save_local_and_upload(
        stats_content, STATS_PATH, STATS_PATH,
        f"[stats] Actualizar stats_summary.json — {now_iso[:16]}", repo,
    )

    # ── 5. Guardar videos_index.json (índice global) ──────────
    index_data = {
        "generado_el": now_iso,
        "total":       len(videos_index),
        "videos":      videos_index,
    }
    index_content = json.dumps(index_data, indent=2, ensure_ascii=False)
    save_local_and_upload(
        index_content, INDEX_PATH, INDEX_PATH,
        f"[index] Actualizar videos_index.json — {now_iso[:16]}", repo,
    )

    print(f"[stats] OK — {summary['totales']['videos_activos']} recientes "
          f"+ {summary['totales']['videos_vitrina']} vitrina "
          f"= {len(videos_index)} videos indexados")


if __name__ == "__main__":
    main()
