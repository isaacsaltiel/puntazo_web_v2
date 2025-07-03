#!/usr/bin/env python3
import os
import requests
import dropbox
from base64 import b64encode

print("🛫 Iniciando prueba Dropbox completa...")

APP_KEY = os.environ.get("DROPBOX_APP_KEY")
APP_SECRET = os.environ.get("DROPBOX_APP_SECRET")
REFRESH_TOKEN = os.environ.get("DROPBOX_REFRESH_TOKEN")

print("🔐 Generando token...")

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
print("✅ Token OK")

# === Ahora prueba conexión con Dropbox SDK ===
print("📦 Inicializando Dropbox client...")
dbx = dropbox.Dropbox(ACCESS_TOKEN)
print("📦 Cliente Dropbox inicializado correctamente.")

# === Ahora probamos listar carpeta ===
print("📂 Listando archivos en /Puntazo/Entrantes...")
try:
    carpeta = "/Puntazo/Entrantes"
    res = dbx.files_list_folder(carpeta)
    print(f"📋 Archivos encontrados: {len(res.entries)}")
    for entry in res.entries:
        print(f"  • {entry.name}")
except Exception as e:
    print(f"❌ Error al listar archivos de {carpeta}: {e}")
