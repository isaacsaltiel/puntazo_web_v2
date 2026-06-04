#!/usr/bin/env python3
"""
cleanup_pulses_ci.py — Housekeeping de pending_pulses.

Corre desde GitHub Actions cada hora (workflow cleanup_pulses.yml).
Borra docs de pending_pulses cuyo consumed_at lleva más de
CONSUMED_TTL_HOURS. Asunción: si la NUC consumió hace más de N horas,
el video YA fue procesado y subido a Dropbox; el doc en Firestore ya
no aporta info útil al usuario (videos_recientes.json y
videos_vitrina.json solo guardan ventanas cortas/limitadas, así que
cruzar con esos índices para pulsos viejos siempre falla).

Sin esta limpieza, los usuarios ven "Mis puntazos pendientes" lleno
de docs huérfanos que no se pueden vincular a su clip.

Reemplaza al cron-job equivalente que se hacía manual desde
/tmp/pulse-cleanup/delete-old-consumed.js.

ENV:
  FIREBASE_SERVICE_ACCOUNT  -> JSON del service account (string)
  CONSUMED_TTL_HOURS        -> opcional, default 24

Sale con código 0 siempre que la conexión a Firestore funcione (un
batch fallido no rompe el workflow — solo loguea).
"""
import os, json, time, sys

import firebase_admin
from firebase_admin import credentials, firestore


CONSUMED_TTL_HOURS = float(os.environ.get("CONSUMED_TTL_HOURS", "24"))
CONSUMED_TTL_MS = CONSUMED_TTL_HOURS * 3600 * 1000
COLLECTION = "pending_pulses"
PAGE_LIMIT = 500


def log(*a):
    print(*a, flush=True)


def main():
    sa = json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT"])
    firebase_admin.initialize_app(credentials.Certificate(sa))
    db = firestore.client()

    now_ms = time.time() * 1000
    total_seen = 0
    total_marked = 0
    total_deleted = 0
    pages = 0

    # Una sola pasada: leer hasta 500 docs. Firestore no tiene server-side
    # filter por "consumed_at < X días" sin índice compuesto; client-side
    # alcanza para volúmenes razonables (<10k docs).
    snap = db.collection(COLLECTION).limit(PAGE_LIMIT).get()
    pages += 1
    to_delete = []
    for d in snap:
        total_seen += 1
        data = d.to_dict() or {}
        consumed_at = data.get("consumed_at")
        if not consumed_at:
            continue
        try:
            consumed_ms = consumed_at.timestamp() * 1000  # firestore Timestamp
        except Exception:
            consumed_ms = 0
        if not consumed_ms:
            continue
        age_ms = now_ms - consumed_ms
        if age_ms > CONSUMED_TTL_MS:
            to_delete.append(d.reference)
            total_marked += 1

    log(f"page {pages}: seen={total_seen} marked={total_marked}")

    # Batch delete (límite 500 por batch en Firestore)
    if to_delete:
        for i in range(0, len(to_delete), 500):
            chunk = to_delete[i:i+500]
            batch = db.batch()
            for ref in chunk:
                batch.delete(ref)
            try:
                batch.commit()
                total_deleted += len(chunk)
                log(f"  batch {i//500 + 1}: deleted {len(chunk)}")
            except Exception as e:
                log(f"  batch {i//500 + 1}: ERROR {e}")

    log(f"\nDONE  seen={total_seen}  marked_to_delete={total_marked}  actually_deleted={total_deleted}  ttl_hours={CONSUMED_TTL_HOURS}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"FATAL: {e}")
        sys.exit(0)  # no romper el workflow, es housekeeping best-effort
