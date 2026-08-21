#!/usr/bin/env python3
"""
stream_token.py — Links secretos para el panel de control de transmision.

En vez de darle cuenta a nadie, se le manda por WhatsApp un link con clave:

    https://puntazoclips.com/control-stream.html?k=<TOKEN>

El token vive en Firestore (stream_tokens/{token}) y las reglas lo validan en
cada escritura a stream_control. Si se ve movimiento raro: --revoke y se emite
otro. El link viejo deja de servir al instante, sin tocar codigo ni deploy.

Uso:
    python tools/stream_token.py new --club BreakPoint --label "Admin CPAM"
    python tools/stream_token.py list
    python tools/stream_token.py revoke <TOKEN>
    python tools/stream_token.py rotate --club BreakPoint --label "Admin CPAM"
        (revoca TODOS los del club y emite uno nuevo — el boton de panico)

Requiere el service account de puntazo-clips:
    C:\\Users\\Isaac\\.puntazo-secrets\\service_account.json
"""
import argparse
import secrets

SA_PATH = r"C:\Users\Isaac\.puntazo-secrets\service_account.json"
BASE_URL = "https://puntazoclips.com/control-stream.html"


def get_db(sa):
    import firebase_admin
    from firebase_admin import credentials, firestore
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(sa))
    return firestore.client(), firestore


def cmd_new(db, fs, club, label):
    token = secrets.token_urlsafe(24)  # ~32 chars, imposible de adivinar
    db.collection("stream_tokens").document(token).set({
        "club": club,
        "active": True,
        "label": label or "",
        "created_at": fs.SERVER_TIMESTAMP,
    })
    print(f"[OK] Token nuevo para {club}" + (f" ({label})" if label else ""))
    print()
    print(f"    {BASE_URL}?k={token}")
    print()
    print("    Mandaselo por WhatsApp. Para matarlo:")
    print(f"    python tools/stream_token.py revoke {token}")
    return token


def cmd_list(db):
    docs = list(db.collection("stream_tokens").stream())
    if not docs:
        print("(no hay tokens)")
        return
    for d in docs:
        x = d.to_dict() or {}
        estado = "ACTIVO " if x.get("active") else "revocado"
        print(f"  [{estado}] {x.get('club','?'):<22} {x.get('label','') or '-':<20} {d.id}")


def cmd_revoke(db, token):
    ref = db.collection("stream_tokens").document(token)
    if not ref.get().exists:
        print(f"[X] No existe el token {token}")
        return
    ref.set({"active": False}, merge=True)
    print(f"[OK] Token revocado. El link deja de funcionar de inmediato.")


def cmd_rotate(db, fs, club, label):
    n = 0
    for d in db.collection("stream_tokens").where("club", "==", club).stream():
        if (d.to_dict() or {}).get("active"):
            d.reference.set({"active": False}, merge=True)
            n += 1
    print(f"[OK] {n} token(s) de {club} revocados.")
    cmd_new(db, fs, club, label)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("accion", choices=["new", "list", "revoke", "rotate"])
    ap.add_argument("token", nargs="?", help="token (solo para revoke)")
    ap.add_argument("--club", default="BreakPoint")
    ap.add_argument("--label", default="", help="para acordarte de quien es")
    ap.add_argument("--sa", default=SA_PATH)
    args = ap.parse_args()

    db, fs = get_db(args.sa)

    if args.accion == "new":
        cmd_new(db, fs, args.club, args.label)
    elif args.accion == "list":
        cmd_list(db)
    elif args.accion == "revoke":
        if not args.token:
            print("[X] Falta el token: stream_token.py revoke <TOKEN>")
            return
        cmd_revoke(db, args.token)
    elif args.accion == "rotate":
        cmd_rotate(db, fs, args.club, args.label)


if __name__ == "__main__":
    main()
