"""
probar_metricas.py — Prueba EN PRODUCCIÓN las reglas de metricas_marcas tal como
las ve un navegador: sin login, con la API key pública del sitio, escribiendo
igual que el SDK (set con merge + increment). Usa el sujeto "prueba-reglas" y al
final borra lo creado con el service account.

Uso (desde la raíz del repo, DESPUÉS de publicar las reglas):
  python tools/firestore_rules/probar_metricas.py
"""
import re
import sys

import firebase_admin
import requests
from firebase_admin import credentials, firestore

SA = r"C:\Users\Isaac\.puntazo-secrets\service_account.json"
PROYECTO = "puntazo-clips"
DOCS = f"projects/{PROYECTO}/databases/(default)/documents"
BASE = f"https://firestore.googleapis.com/v1/{DOCS}"
KEY = re.search(r'apiKey:\s*"([^"]+)"', open("assets/firebase-core.js", encoding="utf-8").read()).group(1)
SUJETO = "prueba-reglas"


def escritura(doc_id, campos, incrementar=True, n_fijo=None):
    """Lo mismo que manda el SDK para set({...}, {merge: true})."""
    fields = {k: {"stringValue": v} for k, v in campos.items()}
    mascara = list(campos)
    if n_fijo is not None:
        fields["n"] = {"integerValue": str(n_fijo)}
        mascara.append("n")
    w = {"update": {"name": f"{DOCS}/metricas_marcas/{doc_id}", "fields": fields},
         "updateMask": {"fieldPaths": mascara},
         "updateTransforms": [{"fieldPath": "updatedAt", "setToServerValue": "REQUEST_TIME"}]}
    if incrementar:
        w["updateTransforms"].append({"fieldPath": "n", "increment": {"integerValue": "1"}})
    return w


def commit(w):
    return requests.post(f"{BASE}:commit?key={KEY}", json={"writes": [w]}, timeout=20).status_code


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    campos = {"sujeto": SUJETO, "metrica": "vista.feed_top", "club": "BreakPoint", "fecha": "2026-09-11"}
    doc_id = f"{SUJETO}__vista.feed_top__BreakPoint__2026-09-11"
    casos = [
        ("crear con n = 1", 200, lambda: commit(escritura(doc_id, campos))),
        ("sumar 1 otra vez", 200, lambda: commit(escritura(doc_id, campos))),
        ("poner n = 50 de golpe", 403, lambda: commit(escritura(doc_id, campos, incrementar=False, n_fijo=50))),
        ("métrica inventada", 403, lambda: commit(escritura(
            f"{SUJETO}__hack.x__BreakPoint__2026-09-11", dict(campos, metrica="hack.x")))),
        ("id que no corresponde a los campos", 403, lambda: commit(escritura(f"{SUJETO}__otro", campos))),
        ("campo extra", 403, lambda: commit(escritura(
            f"{SUJETO}__vista.card_inline__BreakPoint__2026-09-11",
            dict(campos, metrica="vista.card_inline", extra="x")))),
        ("leer sin login", 403, lambda: requests.get(
            f"{BASE}/metricas_marcas/{doc_id}?key={KEY}", timeout=20).status_code),
        ("borrar", 403, lambda: requests.post(f"{BASE}:commit?key={KEY}", json={
            "writes": [{"delete": f"{DOCS}/metricas_marcas/{doc_id}"}]}, timeout=20).status_code),
    ]
    fallas = 0
    for nombre, esperado, fn in casos:
        obtenido = fn()
        ok = obtenido == esperado
        fallas += not ok
        print(f"{'OK ' if ok else 'MAL'} {nombre}: esperado {esperado}, obtenido {obtenido}")

    firebase_admin.initialize_app(credentials.Certificate(SA))
    db = firestore.client()
    d = db.collection("metricas_marcas").document(doc_id).get()
    n = (d.to_dict() or {}).get("n")
    print(f"{'OK ' if n == 2 else 'MAL'} el contador quedó en {n} (esperado 2)")
    fallas += n != 2
    borrados = 0
    for doc in db.collection("metricas_marcas").where("sujeto", "==", SUJETO).stream():
        doc.reference.delete()
        borrados += 1
    print(f"limpieza: {borrados} doc(s) de prueba borrados")
    sys.exit(1 if fallas else 0)


if __name__ == "__main__":
    main()
