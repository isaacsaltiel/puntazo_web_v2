#!/usr/bin/env python3
"""
grant_admin.py — Marca flags.isAdmin=true en users/{uid} para una cuenta.

Necesario porque las reglas de stream_commands (y cualquier acción admin
server-gated) verifican users/{uid}.flags.isAdmin == true. Ese flag es
SERVER-ONLY: el cliente NO puede escribirlo (lo bloquean las reglas de
users/{uid}); solo el Admin SDK / Service Account.

Uso:
    python tools/grant_admin.py isaacsaltiel@gmail.com
    python tools/grant_admin.py isaacsaltiel@gmail.com --revoke   # quitar

Requiere el service account de puntazo-clips (mismo de los NUCs):
    C:\\Users\\Isaac\\.puntazo-secrets\\service_account.json
"""
import sys
import argparse

SA_PATH = r"C:\Users\Isaac\.puntazo-secrets\service_account.json"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("email", help="Email de la cuenta Google (Firebase Auth)")
    ap.add_argument("--revoke", action="store_true", help="Poner isAdmin=false")
    ap.add_argument("--sa", default=SA_PATH, help="Ruta al service_account.json")
    args = ap.parse_args()

    import firebase_admin
    from firebase_admin import credentials, auth, firestore

    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(args.sa))
    db = firestore.client()

    # uid desde Auth (el doc users/{uid} usa el uid de Auth como id)
    try:
        user = auth.get_user_by_email(args.email)
    except Exception as e:
        print(f"[X] No se encontró la cuenta {args.email} en Firebase Auth: {e}")
        sys.exit(1)
    uid = user.uid

    value = not args.revoke
    db.collection("users").document(uid).set(
        {"uid": uid, "flags": {"isAdmin": value}}, merge=True
    )
    # Verificar
    snap = db.collection("users").document(uid).get()
    flags = (snap.to_dict() or {}).get("flags", {})
    print(f"[OK] {args.email} (uid={uid}) -> flags.isAdmin = {flags.get('isAdmin')}")


if __name__ == "__main__":
    main()
