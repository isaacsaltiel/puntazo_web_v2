#!/usr/bin/env python3
import os
import re
import subprocess
import json
import shutil
import argparse
from datetime import datetime, timedelta

# === CONFIGURACION PARA GITHUB ACTIONS ===
VIDEO_DIR     = "videos_temp"
REGISTRO_PATH = "subidos_ci.txt"
JSON_LOCAL    = "videos_recientes.json"
DROPBOX_BASE  = "dropbox:Puntazo/Locaciones"
REPO_PATH     = os.getcwd()

VALID_PATTERN   = re.compile(r'^video_final_\d{8}_\d{6}\.mp4$')
RETENTION_HOURS = 8

def rclone_copy(src, dst):
    return subprocess.run(["rclone", "copy", src, dst]).returncode == 0

def rclone_copyto(src, dst):
    result = subprocess.run(["rclone", "copyto", src, dst], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return result.returncode == 0

def rclone_delete(remote_path):
    return subprocess.run(["rclone", "delete", remote_path]).returncode == 0

def rclone_link(remote_file):
    res = subprocess.run(["rclone", "link", remote_file], capture_output=True, text=True)
    if res.returncode != 0:
        return None
    link = res.stdout.strip()
    link = link.replace("www.dropbox.com", "dl.dropboxusercontent.com")
    return re.sub(r'([&?])dl=[^&]*', r'\\1raw=1', link)

def rclone_list_with_times(remote_folder):
    res = subprocess.run(["rclone", "lsl", remote_folder], capture_output=True, text=True)
    if res.returncode != 0:
        return []
    entries = []
    for line in res.stdout.splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        fname = parts[3]
        if not VALID_PATTERN.match(fname):
            continue
        date_str, time_str = parts[1], parts[2]
        try:
            mtime = datetime.fromisoformat(f"{date_str}T{time_str}")
        except ValueError:
            try:
                mtime = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M:%S")
            except ValueError:
                continue
        entries.append((fname, mtime))
    return entries

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--loc", required=True)
    parser.add_argument("--can", required=True)
    parser.add_argument("--lado", required=True)
    args = parser.parse_args()

    loc, can, lado = args.loc, args.can, args.lado
    remote_folder = f"{DROPBOX_BASE}/{loc}/{can}/{lado}"

    os.makedirs(VIDEO_DIR, exist_ok=True)
    if not os.path.exists(REGISTRO_PATH):
        open(REGISTRO_PATH, 'w').close()

    # 1. Generar listado de videos recientes
    cutoff = datetime.utcnow() - timedelta(hours=RETENTION_HOURS)
    entries = {}
    remote_entries = dict(rclone_list_with_times(remote_folder))
    for fname, rtime in remote_entries.items():
        if rtime < cutoff:
            continue
        url = rclone_link(f"{remote_folder}/{fname}")
        if url:
            entries[fname] = {"url": url, "time": rtime}

    sorted_items = sorted(entries.items(), key=lambda i: i[1]["time"], reverse=True)
    data = {"videos": [], "generado_el": datetime.utcnow().isoformat() + "Z"}
    for fname, info in sorted_items:
        data["videos"].append({"nombre": fname, "url": info["url"]})

    # 2. Guardar y subir JSON
    with open(JSON_LOCAL, 'w') as jf:
        json.dump(data, jf, indent=2)
    print(f"[INFO] JSON generado: {JSON_LOCAL}")

    if rclone_copyto(JSON_LOCAL, f"{remote_folder}/videos_recientes.json"):
        print("[OK] JSON actualizado en Dropbox.")
    else:
        print("[ERROR] Fallo al actualizar JSON en Dropbox.")

if __name__ == "__main__":
    main()
