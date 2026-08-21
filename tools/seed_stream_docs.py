#!/usr/bin/env python3
"""
seed_stream_docs.py — Crea los docs base del control de transmision.

    stream_control/{club}  → layout del mosaico (lo maneja /control-stream.html)
    stream_public/{club}   → lo que ve el publico en /vivo.html

Idempotente: usa merge, no pisa lo que ya haya.

Uso:
    python tools/seed_stream_docs.py BreakPoint
    python tools/seed_stream_docs.py BreakPoint --url "https://youtu.be/XXXX" --live
"""
import argparse

SA_PATH = r"C:\Users\Isaac\.puntazo-secrets\service_account.json"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("club", nargs="?", default="BreakPoint")
    ap.add_argument("--url", default=None, help="URL de YouTube de la transmision")
    ap.add_argument("--titulo", default="Torneo CPAM · BreakPoint")
    ap.add_argument("--live", action="store_true", help="Publicar como EN VIVO ya")
    ap.add_argument("--sa", default=SA_PATH)
    args = ap.parse_args()

    import firebase_admin
    from firebase_admin import credentials, firestore

    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(args.sa))
    db = firestore.client()
    club = args.club

    ctrl = db.collection("stream_control").document(club)
    if not ctrl.get().exists:
        ctrl.set({
            "club": club,
            "mode": "solo",
            "primary": "Cancha1",
            "secondaries": [],
            "rev": 0,
            "requested_at": firestore.SERVER_TIMESTAMP,
            "requested_by": "seed",
        })
        print(f"[OK] stream_control/{club} creado (solo · Cancha1 · rev 0)")
    else:
        print(f"[=] stream_control/{club} ya existia, intacto")

    pub = {
        "club": club,
        "titulo": args.titulo,
        "organizador": "CPAM",
        "updated_at": firestore.SERVER_TIMESTAMP,
        "updated_by": "seed",
    }
    if args.url is not None:
        pub["youtube_url"] = args.url
    pub["live"] = bool(args.live)

    doc = db.collection("stream_public").document(club)
    existed = doc.get().exists
    doc.set(pub, merge=True)
    print(f"[OK] stream_public/{club} {'actualizado' if existed else 'creado'} "
          f"(live={pub['live']}, url={pub.get('youtube_url', '(sin cambio)')})")


if __name__ == "__main__":
    main()
