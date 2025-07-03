#!/usr/bin/env python3
import os
import requests
from base64 import b64encode

print("🛫 Iniciando script mínimo...")

# Variables mínimas para prueba
APP_KEY = os.environ.get("DROPBOX_APP_KEY")
APP_SECRET = os.environ.get("DROPBOX_APP_SECRET")
REFRESH_TOKEN = os.environ.get("DROPBOX_REFRESH_TOKEN")

if not (APP_KEY and APP_SECRET and REFRESH_TOKEN):
    print("❌ Faltan variables de entorno necesarias")
    exit(1)

print("🔐 Variables cargadas, generando token...")

try:
    auth_header = b64encode(f"{APP_KEY}:{APP_SECRET}".encode()).decode()
    res = requests.post(
        "https://api.dropbox.com/oauth2/token",
        headers={"Authorization": f"Basic {auth_header}"},
        data={
            "grant_type": "refresh_token",
            "refresh_token": REFRESH_TOKEN,
        },
    )
    res.raise_for_status()
    ACCESS_TOKEN = res.json()["access_token"]
    print("✅ Token obtenido exitosamente")
except Exception as e:
    print(f"❌ Error al obtener token: {e}")
    exit(1)
