"""
Revisa que las transmisiones anteriores de cada club se puedan ver en YouTube
y marca `disponible: false` en las que no (stream_public/{club}.past_streams).

Por qué: YouTube no guarda la grabación de transmisiones de más de 12 h y a
veces la quita; la página decía "5 transmisiones" y una no se podía ver.
vivo.html y el Inicio ocultan las marcadas (2026-09-30).

Uso:
    python tools/stream_check.py            # solo revisa y muestra
    python tools/stream_check.py --aplicar  # además marca en Firestore

Credencial: C:/Users/Isaac/.puntazo-secrets/service_account.json
"""
import re
import sys
import urllib.request

from google.oauth2 import service_account
import google.cloud.firestore as fs

CRED = r"C:/Users/Isaac/.puntazo-secrets/service_account.json"


def estado(video_id):
    """'OK' | 'UNPLAYABLE' | 'ERROR' | ... según la página de YouTube."""
    req = urllib.request.Request(
        "https://www.youtube.com/watch?v=" + video_id + "&hl=es",
        headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "es-MX"})
    html = urllib.request.urlopen(req, timeout=20).read().decode("utf8", "ignore")
    m = re.search(r'"playabilityStatus":\{"status":"(\w+)"(?:,"reason":"([^"]*)")?', html)
    return (m.group(1), m.group(2)) if m else ("DESCONOCIDO", None)


def main():
    aplicar = "--aplicar" in sys.argv
    cred = service_account.Credentials.from_service_account_file(CRED)
    db = fs.Client(project="puntazo-clips", credentials=cred)
    for doc in db.collection("stream_public").stream():
        data = doc.to_dict() or {}
        lista = data.get("past_streams") or []
        cambio = False
        for p in lista:
            m = re.search(r"(?:live/|v=|youtu\.be/)([\w-]{11})", p.get("url") or "")
            if not m:
                continue
            st, motivo = estado(m.group(1))
            ok = st == "OK"
            print(doc.id, p.get("fecha"), m.group(1), st, motivo or "")
            if p.get("disponible", True) != ok:
                p["disponible"] = ok
                cambio = True
        if cambio and aplicar:
            doc.reference.update({"past_streams": lista})
            print("  -> actualizado", doc.id)
        elif cambio:
            print("  -> hay cambios (usa --aplicar para guardarlos)")


if __name__ == "__main__":
    main()
