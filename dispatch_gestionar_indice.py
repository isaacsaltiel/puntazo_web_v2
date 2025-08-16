#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import re
import sys
import json
import argparse
import requests

PATRON = re.compile(r"^(?P<loc>[^_]+)_(?P<can>[^_]+)_(?P<lado>[^_]+)_(\d{8})_(\d{6})\.mp4$")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--loc")
    ap.add_argument("--can")
    ap.add_argument("--lado")
    ap.add_argument("--dest", default="")
    ap.add_argument("--status", required=True)   # ok | fail
    ap.add_argument("--message", default="")
    args = ap.parse_args()

    m = PATRON.match(args.file)
    loc  = args.loc  or (m.group("loc")  if m else None)
    can  = args.can  or (m.group("can")  if m else None)
    lado = args.lado or (m.group("lado") if m else None)
    if not (loc and can and lado):
        print("⚠️  No se pudo extraer loc/can/lado; no se dispara gestionar_indice.")
        return 0

    repo = os.environ.get("GITHUB_REPOSITORY")  # owner/repo
    token = os.environ.get("PAT_GITHUB") or os.environ.get("GH_PAT")
    if not repo or not token:
        print("❌ Falta GITHUB_REPOSITORY o PAT_GITHUB/GH_PAT")
        return 1

    url = f"https://api.github.com/repos/{repo}/dispatches"
    payload = {
        "event_type": "gestionar_indice",
        "client_payload": {
            "loc": loc, "can": can, "lado": lado,
            "file": args.file, "dest": args.dest,
            "status": args.status, "message": args.message
        }
    }
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json"
    }
    r = requests.post(url, headers=headers, data=json.dumps(payload), timeout=30)
    if r.status_code >= 300:
        print(f"❌ repository_dispatch falló: {r.status_code} {r.text}")
        return 1
    print(f"📮 Disparado gestionar_indice → {loc}/{can}/{lado} (file={args.file}, status={args.status})")
    return 0

if __name__ == "__main__":
    sys.exit(main())
