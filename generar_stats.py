"""
generar_stats.py
Corre al final de gestionar_indice (CI o manual).
Lee config_locations.json + todos los videos_recientes.json
y genera data/stats_summary.json en GitHub.
"""

import os
import json
import sys
from datetime import datetime, timezone
from github import Github, Auth

GITHUB_TOKEN = os.environ.get("PAT_GITHUB")
GITHUB_REPO  = "isaacsaltiel/puntazo_web_v2"
CONFIG_PATH  = "data/config_locations.json"
OUTPUT_PATH  = "data/stats_summary.json"


def upload_to_github(content: str, path: str, message: str):
    if not GITHUB_TOKEN:
        print("[WARN] Sin PAT_GITHUB — stats no se subirán a GitHub.")
        return
    g    = Github(auth=Auth.Token(GITHUB_TOKEN))
    repo = g.get_repo(GITHUB_REPO)
    branch = repo.default_branch
    try:
        existing = repo.get_contents(path, ref=branch)
        repo.update_file(existing.path, message, content, existing.sha, branch=branch)
        print(f"[OK] {path} actualizado en GitHub ({branch})")
    except Exception as e:
        if "404" in str(e):
            repo.create_file(path, message, content, branch=branch)
            print(f"[OK] {path} creado en GitHub ({branch})")
        else:
            print(f"[ERROR] GitHub upload: {e}")


def read_json_from_github(path: str):
    """Lee un archivo JSON del repo en GitHub."""
    if not GITHUB_TOKEN:
        # Fallback: leer local si existe
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        return None
    g    = Github(auth=Auth.Token(GITHUB_TOKEN))
    repo = g.get_repo(GITHUB_REPO)
    branch = repo.default_branch
    try:
        content = repo.get_contents(path, ref=branch)
        return json.loads(content.decoded_content.decode("utf-8"))
    except Exception as e:
        # También intentar local
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        print(f"[WARN] No se pudo leer {path}: {e}")
        return None


def main():
    print("[stats] Generando stats_summary.json…")

    config = read_json_from_github(CONFIG_PATH)
    if not config:
        print("[ERROR] No se pudo leer config_locations.json"); sys.exit(1)

    now_iso = datetime.now(timezone.utc).isoformat()

    summary = {
        "generado_el": now_iso,
        "totales":     { "videos": 0, "clubs": 0, "canchas": 0, "lados": 0 },
        "clubs": []
    }

    for loc in config.get("locaciones", []):
        loc_id     = loc.get("id")   or loc.get("nombre", "")
        loc_nombre = loc.get("nombre") or loc_id
        club_entry = {
            "id": loc_id, "nombre": loc_nombre,
            "total_videos": 0, "total_canchas": 0,
            "canchas": []
        }

        for cancha in loc.get("cancha", []):
            can_id     = cancha.get("id")   or cancha.get("nombre", "")
            can_nombre = cancha.get("nombre") or can_id
            cancha_entry = {
                "id": can_id, "nombre": can_nombre,
                "total_videos": 0,
                "lados": []
            }

            for lado in cancha.get("lados", []):
                lado_id     = lado.get("id")   or lado.get("nombre", "")
                lado_nombre = lado.get("nombre") or lado_id

                json_path = f"data/Locaciones/{loc_id}/{can_id}/{lado_id}/videos_recientes.json"
                data = read_json_from_github(json_path)

                videos   = data.get("videos", []) if data else []
                gen_el   = data.get("generado_el", "") if data else ""
                nombres  = [v.get("nombre", "") for v in videos]
                count    = len(nombres)

                lado_entry = {
                    "id":           lado_id,
                    "nombre":       lado_nombre,
                    "count":        count,
                    "generado_el":  gen_el,
                    "videos":       nombres,   # solo nombres, no URLs
                }
                cancha_entry["lados"].append(lado_entry)
                cancha_entry["total_videos"] += count
                summary["totales"]["lados"] += 1

            club_entry["canchas"].append(cancha_entry)
            club_entry["total_videos"]  += cancha_entry["total_videos"]
            club_entry["total_canchas"] += 1
            summary["totales"]["canchas"] += 1

        summary["clubs"].append(club_entry)
        summary["totales"]["videos"] += club_entry["total_videos"]
        summary["totales"]["clubs"]  += 1

    print(f"[stats] {summary['totales']['clubs']} clubs · {summary['totales']['canchas']} canchas · {summary['totales']['videos']} videos")

    content = json.dumps(summary, indent=2, ensure_ascii=False)

    # Guardar local
    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"[stats] Guardado local: {OUTPUT_PATH}")

    # Subir a GitHub
    upload_to_github(content, OUTPUT_PATH, f"[stats] Actualizar stats_summary.json — {now_iso[:16]}")


if __name__ == "__main__":
    main()
