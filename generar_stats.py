"""
generar_stats.py
Corre al final de cada ejecución de gestionar_indice.
Lee:
  - data/config_locations.json  → estructura clubs/canchas/lados
  - data/videos_log.csv         → histórico completo de videos (una fila por video)
  - data/Locaciones/.../videos_recientes.json → videos activos ahora (24h)

Genera data/stats_summary.json con:
  - totales globales (histórico)
  - historial: [{fecha, loc, can, lado, count}] agregado por día+loc+can+lado
  - clubs: estructura con videos activos ahora
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
CONFIG_PATH  = "data/metrics/config_locations.json"
LOG_PATH     = "data/metrics/videos_log.csv"
OUTPUT_PATH  = "data/metrics/stats_summary.json"


def get_repo():
    if not GITHUB_TOKEN:
        return None
    return Github(auth=Auth.Token(GITHUB_TOKEN)).get_repo(GITHUB_REPO)


def read_file_from_github(path: str, repo=None):
    """Lee un archivo del repo. Intenta GitHub primero, luego local."""
    if repo:
        try:
            content = repo.get_contents(path, ref=repo.default_branch)
            return content.decoded_content.decode("utf-8")
        except Exception as e:
            print(f"[WARN] GitHub read {path}: {e}")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return f.read()
    return None


def upload_to_github(content: str, path: str, message: str, repo=None):
    if not repo:
        print("[WARN] Sin repo GitHub — no se sube stats.")
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


def parse_log_csv(raw: str):
    """
    Lee videos_log.csv (loc,can,lado,local_date,local_hour)
    Devuelve lista de dicts y agregado por fecha+loc+can+lado.
    """
    rows = []
    try:
        reader = csv.DictReader(StringIO(raw))
        for row in reader:
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
    """
    Agrega por fecha+loc+can+lado → count.
    Devuelve lista ordenada por fecha desc.
    """
    counter = defaultdict(int)
    for r in rows:
        key = (r["fecha"], r["loc"], r["can"], r["lado"])
        counter[key] += 1

    result = []
    for (fecha, loc, can, lado), count in counter.items():
        result.append({
            "fecha": fecha,
            "loc":   loc,
            "can":   can,
            "lado":  lado,
            "count": count,
        })

    result.sort(key=lambda x: x["fecha"], reverse=True)
    return result


def main():
    print("[stats] Generando stats_summary.json…")
    repo = get_repo()

    now_iso = datetime.now(timezone.utc).isoformat()

    # ── 1. Leer config ────────────────────────────────────────
    cfg_raw = read_file_from_github(CONFIG_PATH, repo)
    if not cfg_raw:
        print("[ERROR] No se pudo leer config_locations.json")
        sys.exit(1)
    config = json.loads(cfg_raw)

    # ── 2. Leer videos_log.csv ────────────────────────────────
    log_raw = read_file_from_github(LOG_PATH, repo)
    if not log_raw:
        print("[WARN] videos_log.csv no encontrado — historial vacío")
        log_rows = []
    else:
        log_rows = parse_log_csv(log_raw)
        print(f"[stats] {len(log_rows)} filas en videos_log.csv")

    historial = aggregate_log(log_rows)

    # Totales históricos globales
    total_historico = len(log_rows)
    fechas_unicas   = len(set(r["fecha"] for r in log_rows))
    locs_unicas     = len(set(r["loc"]   for r in log_rows))

    # ── 3. Leer videos_recientes.json por cada lado ───────────
    summary = {
        "generado_el":    now_iso,
        "totales": {
            "videos_historico": total_historico,
            "dias_con_videos":  fechas_unicas,
            "clubs_activos":    locs_unicas,
            "clubs":   0,
            "canchas": 0,
            "lados":   0,
            "videos_activos": 0,  # en Dropbox ahora (24h)
        },
        "historial": historial,   # [{fecha,loc,can,lado,count}]
        "clubs": [],
    }

    for loc in config.get("locaciones", []):
        loc_id     = loc.get("id")     or loc.get("nombre", "")
        loc_nombre = loc.get("nombre") or loc_id
        club_entry = {
            "id": loc_id, "nombre": loc_nombre,
            "total_videos_activos": 0,
            "canchas": [],
        }

        for cancha in loc.get("cancha", []):
            can_id     = cancha.get("id")     or cancha.get("nombre", "")
            can_nombre = cancha.get("nombre") or can_id
            cancha_entry = {
                "id": can_id, "nombre": can_nombre,
                "total_videos_activos": 0,
                "lados": [],
            }

            for lado in cancha.get("lados", []):
                lado_id     = lado.get("id")     or lado.get("nombre", "")
                lado_nombre = lado.get("nombre") or lado_id

                json_path = f"data/Locaciones/{loc_id}/{can_id}/{lado_id}/videos_recientes.json"
                data_raw  = read_file_from_github(json_path, repo)
                data      = json.loads(data_raw) if data_raw else {}

                videos_activos = data.get("videos", []) if data else []
                nombres        = [v.get("nombre", "") for v in videos_activos]
                count          = len(nombres)

                lado_entry = {
                    "id":            lado_id,
                    "nombre":        lado_nombre,
                    "count_activos": count,
                    "generado_el":   data.get("generado_el", "") if data else "",
                    "videos":        nombres,
                }
                cancha_entry["lados"].append(lado_entry)
                cancha_entry["total_videos_activos"] += count
                summary["totales"]["lados"]         += 1
                summary["totales"]["videos_activos"] += count

            club_entry["canchas"].append(cancha_entry)
            club_entry["total_videos_activos"] += cancha_entry["total_videos_activos"]
            summary["totales"]["canchas"] += 1

        summary["clubs"].append(club_entry)
        summary["totales"]["clubs"] += 1

    print(f"[stats] Histórico: {total_historico} videos en {fechas_unicas} días · {locs_unicas} clubs")
    print(f"[stats] Activos ahora: {summary['totales']['videos_activos']} videos")

    content = json.dumps(summary, indent=2, ensure_ascii=False)

    # Guardar local
    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"[stats] Guardado local: {OUTPUT_PATH}")

    # Subir a GitHub
    upload_to_github(
        content, OUTPUT_PATH,
        f"[stats] Actualizar stats_summary.json — {now_iso[:16]}",
        repo,
    )


if __name__ == "__main__":
    main()
