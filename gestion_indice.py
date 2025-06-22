#!/usr/bin/env python3
import os
import re
import subprocess
import json
import shutil
from datetime import datetime, timedelta

# —— CONFIGURACIÓN LOCAL ——
CONFIG_PATH   = "/home/isaac/PaquetePi/codigo_base/mi_config.json"
VIDEO_DIR     = "/home/isaac/PaquetePi/codigo_base/final_cam"
REGISTRO_PATH = "/home/isaac/PaquetePi/codigo_base/subidos.txt"
JSON_LOCAL    = "/home/isaac/PaquetePi/codigo_base/videos_recientes.json"
DROPBOX_BASE  = "dropbox:Puntazo/Locaciones"
REPO_PATH     = os.path.expanduser("~/puntazo_web_v2")
VALID_PATTERN   = re.compile(r'^video_final_\d{8}_\d{6}\.mp4$')
RETENTION_HOURS = 8


# Lee config local
cfg = json.load(open("/home/isaac/PaquetePi/codigo_base/mi_config.json"))
loc, can, lado = cfg["loc"], cfg["can"], cfg["lado"]

# Llama al workflow de GitHub
url = "https://api.github.com/repos/isaacsaltiel/puntazo_web_v2/actions/workflows/gestion_indice.yml/dispatches"
token = os.environ["GITHUB_PAT"]  # Token con scope repo+workflow
headers = {
    "Authorization": f"Bearer {token}",
    "Accept": "application/vnd.github+json"
}
data = {"ref": "master", "inputs": {"loc": loc, "can": can, "lado": lado}}
resp = requests.post(url, headers=headers, json=data)
print(resp.status_code, resp.text)

def load_config():
    with open(CONFIG_PATH) as f:
        return json.load(f)

def rclone_copy(src, dst):
    return subprocess.run(["rclone", "copy", src, dst]).returncode == 0

def rclone_copyto(src, dst):
    result = subprocess.run(
        ["rclone", "copyto", src, dst],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
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

def prune_old(cfg):
    cutoff = datetime.utcnow() - timedelta(hours=RETENTION_HOURS)
    loc, can, lado = cfg["loc"], cfg["can"], cfg["lado"]
    remote_folder = f"{DROPBOX_BASE}/{loc}/{can}/{lado}"
    remote_entries = dict(rclone_list_with_times(remote_folder))
    all_names = set(remote_entries.keys()) | set(
        f for f in os.listdir(VIDEO_DIR) if VALID_PATTERN.match(f)
    )
    for fname in all_names:
        local_path = os.path.join(VIDEO_DIR, fname)
        local_time = datetime.utcfromtimestamp(os.path.getmtime(local_path)) if os.path.exists(local_path) else None
        remote_time = remote_entries.get(fname)
        if (local_time and local_time < cutoff) or (remote_time and remote_time < cutoff):
            print(f"[CLEANUP] Eliminando {fname} (retención excedida)")
            if local_time:
                os.remove(local_path)
            rclone_delete(f"{remote_folder}/{fname}")
            if os.path.exists(REGISTRO_PATH):
                with open(REGISTRO_PATH) as f:
                    lines = [l.strip() for l in f if l.strip() != fname]
                with open(REGISTRO_PATH, 'w') as f:
                    f.write("\n".join(lines) + "\n")

def get_local_videos():
    return [f for f in os.listdir(VIDEO_DIR) if VALID_PATTERN.match(f)]

def run_git(cmd):
    return subprocess.run(cmd, cwd=REPO_PATH).returncode == 0

def setup_ssh_agent(key_path):
    agent = subprocess.run(["ssh-agent", "-s"], capture_output=True, text=True)
    for line in agent.stdout.splitlines():
        if line.startswith("SSH_") and "=" in line:
            key, rest = line.split("=", 1)
            val = rest.split(";")[0]
            os.environ[key] = val
    subprocess.run(["ssh-add", key_path])

def main():
    cfg = load_config()
    loc, can, lado = cfg["loc"], cfg["can"], cfg["lado"]
    remote_folder = f"{DROPBOX_BASE}/{loc}/{can}/{lado}"

    os.makedirs(VIDEO_DIR, exist_ok=True)
    if not os.path.exists(REGISTRO_PATH):
        open(REGISTRO_PATH, 'w').close()

    prune_old(cfg)

    cutoff = datetime.utcnow() - timedelta(hours=RETENTION_HOURS)
    with open(REGISTRO_PATH) as f:
        uploaded = set(l.strip() for l in f if l.strip())
    for fname in get_local_videos():
        path = os.path.join(VIDEO_DIR, fname)
        mtime = datetime.utcfromtimestamp(os.path.getmtime(path))
        if mtime < cutoff or fname in uploaded:
            continue
        print(f"[UPLOAD] Subiendo video local: {fname}")
        if rclone_copy(path, remote_folder):
            with open(REGISTRO_PATH, 'a') as f:
                f.write(fname + "\n")
            uploaded.add(fname)
            print(f"[OK] {fname} subido")

    entries = {}
    remote_entries = dict(rclone_list_with_times(remote_folder))
    for fname, rtime in remote_entries.items():
        if rtime < cutoff:
            continue
        url = rclone_link(f"{remote_folder}/{fname}")
        if url:
            entries[fname] = {"url": url, "time": rtime}
    for fname in get_local_videos():
        local_path = os.path.join(VIDEO_DIR, fname)
        ltime = datetime.utcfromtimestamp(os.path.getmtime(local_path))
        if ltime < cutoff or fname in entries:
            continue
        url = rclone_link(f"{remote_folder}/{fname}")
        if url:
            entries[fname] = {"url": url, "time": ltime}
    sorted_items = sorted(entries.items(), key=lambda i: i[1]["time"], reverse=True)
    data = {"videos": [], "generado_el": datetime.utcnow().isoformat() + "Z"}
    for fname, info in sorted_items:
        data["videos"].append({"nombre": fname, "url": info["url"]})

    with open(JSON_LOCAL, 'w') as jf:
        json.dump(data, jf, indent=2)
    print(f"[INFO] JSON actualizado localmente: {JSON_LOCAL}")
    if rclone_copyto(JSON_LOCAL, f"{remote_folder}/videos_recientes.json"):
        print("[OK] JSON actualizado en Dropbox (enlace intacto).")
    else:
        print("[ERROR] Falló la actualización del JSON en Dropbox.")

    setup_ssh_agent(os.path.expanduser("~/.ssh/id_rsa_git"))

    print("[GIT] Haciendo git pull --rebase --autostash origin master...")
    if run_git(["git", "pull", "--rebase", "--autostash", "origin", "master"]):
        print("[GIT] Pull exitoso (rebase) de origin/master.")
    else:
        print("[GIT ERROR] Falló git pull --rebase.")

    target_dir = os.path.join(REPO_PATH, "data", "Locaciones", loc, can, lado)
    os.makedirs(target_dir, exist_ok=True)
    target_file = os.path.join(target_dir, "videos_recientes.json")
    shutil.copy(JSON_LOCAL, target_file)
    print(f"[GIT] Copiado JSON al repo: {target_file}")
    os.utime(target_file, None)

    timestamp = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    if run_git(["git", "add", target_file]):
        msg = f"Actualiza JSON {loc}/{can}/{lado} {timestamp}"
        if run_git(["git", "commit", "-m", msg, "--allow-empty"]):
            print(f"[GIT] Commit creado: {msg}")
            if run_git(["git", "push", "origin", "master"]):
                print("[GIT] Push exitoso a GitHub.")
            else:
                print("[GIT ERROR] Falló al hacer push.")
        else:
            print("[GIT] No hubo cambios que commitear.")
    else:
        print("[GIT ERROR] Falló git add.")

if __name__ == "__main__":
    main()
