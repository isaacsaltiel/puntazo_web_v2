#!/usr/bin/env python3
"""
grant_stream_op.py — Marca flags.isStreamOp=true en users/{uid} para una cuenta.

Es el permiso MINIMO para usar /control-stream.html (layout del mosaico del
stream + publicar el link de YouTube en /vivo.html). NO da acceso a admin.html
ni a nada mas: las reglas solo lo aceptan en stream_control/ y stream_public/.

Pensado para prestarle el control a un tercero (p.ej. el administrador del
torneo CPAM) sin volverlo admin de Puntazo.

Uso:
    python tools/grant_stream_op.py correo@delorganizador.com
    python tools/grant_stream_op.py correo@delorganizador.com --revoke

IMPORTANTE: la persona debe haber entrado AL MENOS UNA VEZ al sitio con Google
(si no, no existe en Firebase Auth y esto falla).

Requiere el service account de puntazo-clips:
    C:\\Users\\Isaac\\.puntazo-secrets\\service_account.json
"""
import sys
import argparse

SA_PATH = r"C:\Users\Isaac\.puntazo-secrets\service_account.json"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("email", help="Email de la cuenta Google (Firebase Auth)")
    ap.add_argument("--revoke", action="store_true", help="Poner isStreamOp=false")
    ap.add_argument("--sa", default=SA_PATH, help="Ruta al service_account.json")
    args = ap.parse_args()

    import firebase_admin
    from firebase_admin import credentials, auth, firestore

    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(args.sa))
    db = firestore.client()

    try:
        user = auth.get_user_by_email(args.email)
    except Exception as e:
        print(f"[X] No se encontro la cuenta {args.email} en Firebase Auth: {e}")
        print("    Pidele que entre una vez a puntazoclips.com con Google y reintenta.")
        sys.exit(1)
    uid = user.uid

    value = not args.revoke
    db.collection("users").document(uid).set(
        {"uid": uid, "flags": {"isStreamOp": value}}, merge=True
    )
    snap = db.collection("users").document(uid).get()
    flags = (snap.to_dict() or {}).get("flags", {})
    print(f"[OK] {args.email} (uid={uid}) -> flags.isStreamOp = {flags.get('isStreamOp')}")


if __name__ == "__main__":
    main()
