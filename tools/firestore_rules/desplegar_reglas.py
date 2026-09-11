"""
desplegar_reglas.py — Publica firestore.rules (el del repo) en producción por la
Rules API, con el service account. Es el camino de
docs/plans/firebase-admin-capabilities.md, hecho herramienta.

Uso (desde la raíz del repo):
  python tools/firestore_rules/desplegar_reglas.py --dry-run   # compila y compara; no publica
  python tools/firestore_rules/desplegar_reglas.py             # publica
  python tools/firestore_rules/desplegar_reglas.py --rollback projects/puntazo-clips/rulesets/<id>

Candados:
  1. Las reglas VIVAS tienen que ser iguales a `git show <--base>:firestore.rules`
     (HEAD por omisión). Si alguien las cambió en la consola, aborta: no se pisan
     cambios ajenos.
  2. La API compila las reglas antes de publicarlas; con un error responde 400 y
     no se publica nada.
  3. Imprime el ruleset anterior, para volver atrás con --rollback.
"""
import argparse
import subprocess
import sys

from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

SA = r"C:\Users\Isaac\.puntazo-secrets\service_account.json"
API = "https://firebaserules.googleapis.com/v1"
PROYECTO = "projects/puntazo-clips"
RELEASE = PROYECTO + "/releases/cloud.firestore"


def sesion():
    cred = service_account.Credentials.from_service_account_file(
        SA, scopes=["https://www.googleapis.com/auth/cloud-platform",
                    "https://www.googleapis.com/auth/firebase"])
    return AuthorizedSession(cred)


def reglas_vivas(s):
    rel = s.get(f"{API}/{RELEASE}")
    rel.raise_for_status()
    rel = rel.json()
    rs = s.get(f"{API}/{rel['rulesetName']}")
    rs.raise_for_status()
    return rel["rulesetName"], rs.json()["source"]["files"][0]["content"]


def norm(texto):
    return texto.replace("\r\n", "\n")


def publicar_release(s, ruleset):
    r = s.patch(f"{API}/{RELEASE}", json={"release": {"name": RELEASE, "rulesetName": ruleset}})
    r.raise_for_status()
    actual, _ = reglas_vivas(s)
    if actual != ruleset:
        sys.exit(f"ERROR: el release apunta a {actual}, no a {ruleset}")
    return actual


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--base", default="HEAD", help="commit con las reglas que deben estar vivas hoy")
    ap.add_argument("--rollback", metavar="RULESET")
    a = ap.parse_args()
    s = sesion()
    anterior, vivo = reglas_vivas(s)
    print("ruleset vivo:", anterior)

    if a.rollback:
        print("volviendo a:", publicar_release(s, a.rollback))
        return

    base = subprocess.run(["git", "show", f"{a.base}:firestore.rules"], capture_output=True,
                          text=True, encoding="utf-8", check=True).stdout
    if norm(base) != norm(vivo):
        sys.exit(f"ABORTO: las reglas vivas NO son las de {a.base}. Alguien las cambió en la "
                 "consola; revísalo antes de pisarlas.")
    nuevo = open("firestore.rules", encoding="utf-8").read()
    if norm(nuevo) == norm(vivo):
        print("sin cambios: nada que publicar")
        return

    # La API compila al crear el ruleset: con un error responde 400. Crear un
    # ruleset NO lo publica. El service account no tiene permiso para :test,
    # así que el dry-run compila de esta forma y deja el release donde está.
    fuente = {"source": {"files": [{"name": "firestore.rules", "content": nuevo}]}}
    r = s.post(f"{API}/{PROYECTO}/rulesets", json=fuente)
    if r.status_code != 200:
        sys.exit(f"NO COMPILA ({r.status_code}): {r.text[:800]}")
    nuevo_rs = r.json()["name"]
    print(f"compila OK: {nuevo_rs} ({len(nuevo)} caracteres; antes {len(vivo)})")
    if a.dry_run:
        print("dry-run: NO se publicó; el release sigue en", anterior)
        return
    print("PUBLICADO:", publicar_release(s, nuevo_rs))
    print("Para volver atrás:\n  python tools/firestore_rules/desplegar_reglas.py --rollback", anterior)


if __name__ == "__main__":
    main()
