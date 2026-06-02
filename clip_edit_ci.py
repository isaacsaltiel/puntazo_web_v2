#!/usr/bin/env python3
"""
clip_edit_ci.py — Render de ediciones de clip EN LA NUBE (GitHub Actions).

Procesa la cola Firestore `clip_edits/` (status="pending"): recorta (trim) y,
opcionalmente, reencuadra (crop dinámico tipo "sigue la jugada" / vertical reel)
con ffmpeg, sube el resultado a Dropbox en la carpeta del club/cancha/lado y
dispara la reindexación para que aparezca en la web. Marca status done|error.

NO corre en la NUC. Reusa el patrón de gestion_indice_ci.py (Dropbox + PAT).

Env (GitHub Actions secrets):
  FIREBASE_SERVICE_ACCOUNT  -> JSON del service account (string)
  DROPBOX_APP_KEY / DROPBOX_APP_SECRET / DROPBOX_REFRESH_TOKEN
  PAT_GITHUB                -> para repository_dispatch (reindexar)

Diseño de reframe v1: crop de tamaño CONSTANTE (tomado del 1er keyframe) con
paneo x/y interpolado entre keyframes (ffmpeg exige dimensiones de salida
constantes, así que el zoom variable queda como mejora futura; el paneo cubre
el caso "seguir la jugada"). 1 keyframe = encuadre fijo.
"""
import os, sys, json, re, subprocess, tempfile, datetime, urllib.parse

import requests
import dropbox
import firebase_admin
from firebase_admin import credentials, firestore

DROPBOX_BASE = "/Puntazo/Locaciones"
GITHUB_REPO = "isaacsaltiel/puntazo_web_v2"
MAX_PER_RUN = 8
EVEN = lambda n: int(n) - (int(n) % 2)


def log(*a): print(*a, flush=True)


# ── Firestore ──────────────────────────────────────────────
def init_firestore():
    sa = json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT"])
    firebase_admin.initialize_app(credentials.Certificate(sa))
    return firestore.client()


# ── Dropbox ────────────────────────────────────────────────
def connect_dropbox():
    return dropbox.Dropbox(
        app_key=os.environ["DROPBOX_APP_KEY"],
        app_secret=os.environ["DROPBOX_APP_SECRET"],
        oauth2_refresh_token=os.environ["DROPBOX_REFRESH_TOKEN"],
    )


def dbx_upload(dbx, local_path, dropbox_path):
    with open(local_path, "rb") as f:
        dbx.files_upload(f.read(), dropbox_path,
                         mode=dropbox.files.WriteMode("overwrite"))
    try:
        link = dbx.sharing_create_shared_link_with_settings(dropbox_path)
        url = link.url
    except dropbox.exceptions.ApiError as e:
        if hasattr(e.error, "is_shared_link_already_exists") and e.error.is_shared_link_already_exists():
            links = dbx.sharing_list_shared_links(path=dropbox_path, direct_only=True).links
            url = links[0].url if links else ""
        else:
            url = ""
    if url:
        u = urllib.parse.urlparse(url)
        q = dict(urllib.parse.parse_qsl(u.query)); q.pop("dl", None); q["raw"] = "1"
        url = urllib.parse.urlunparse((u.scheme, u.netloc, u.path, u.params, urllib.parse.urlencode(q), u.fragment))
    return url


# ── ffmpeg helpers ─────────────────────────────────────────
def ffprobe_dims(path):
    out = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", path
    ]).decode().strip()
    w, h = out.split("x")[:2]
    return int(w), int(h)


def lerp_expr(points, var="t"):
    """points: [(t_i, val_i)] ordenados. Devuelve expresión ffmpeg piecewise-lineal."""
    if len(points) == 1:
        return str(round(points[0][1], 2))
    expr = str(round(points[-1][1], 2))  # default: último
    for i in range(len(points) - 1, 0, -1):
        t0, v0 = points[i - 1]; t1, v1 = points[i]
        dt = max(0.001, t1 - t0)
        seg = "(%.2f+(%.2f)*(%s-%.3f)/%.3f)" % (v0, (v1 - v0), var, t0, dt)
        expr = "if(lt(%s,%.3f),%s,%s)" % (var, t1, seg, expr)
    # antes del primer punto: v0
    t_first, v_first = points[0]
    expr = "if(lt(%s,%.3f),%s,%s)" % (var, t_first, round(v_first, 2), expr)
    return expr


def build_vf(reframe, trim_in, inW, inH):
    """Construye el filtro -vf (crop dinámico + scale al aspecto)."""
    if not reframe or not reframe.get("enabled") or not reframe.get("keyframes"):
        # Sin reframe: limita a 1920 de ancho máx, par.
        if inW > 1920:
            return "scale=1920:-2"
        return None

    kfs = sorted(reframe["keyframes"], key=lambda k: k.get("t", 0))
    # Tamaño de crop CONSTANTE (1er keyframe), en px pares.
    cw = EVEN(max(16, round(kfs[0]["w"] * inW)))
    ch = EVEN(max(16, round(kfs[0]["h"] * inH)))
    cw = min(cw, EVEN(inW)); ch = min(ch, EVEN(inH))

    # Paneo x/y interpolado (tiempo relativo al recorte).
    xs = [(max(0.0, k.get("t", 0) - trim_in), k["x"] * inW) for k in kfs]
    ys = [(max(0.0, k.get("t", 0) - trim_in), k["y"] * inH) for k in kfs]
    x_expr = lerp_expr(xs); y_expr = lerp_expr(ys)
    # Clamp dentro del frame.
    x_clamped = "max(0\\,min(%d-%d\\,%s))" % (inW, cw, x_expr)
    y_clamped = "max(0\\,min(%d-%d\\,%s))" % (inH, ch, y_expr)
    crop = "crop=%d:%d:'%s':'%s'" % (cw, ch, x_clamped, y_clamped)

    # Escala al aspecto destino con resolución estándar.
    aspect = reframe.get("aspect", "free")
    target = {"9:16": (1080, 1920), "1:1": (1080, 1080), "16:9": (1920, 1080)}.get(aspect)
    if target:
        scale = "scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,setsar=1" % (
            target[0], target[1], target[0], target[1])
        return crop + "," + scale
    # free: escala el crop a máx 1920 de ancho.
    return crop + ",scale='min(1920,iw)':-2"


def render(src_path, out_path, trim_in, trim_out, reframe):
    inW, inH = ffprobe_dims(src_path)
    vf = build_vf(reframe, trim_in, inW, inH)
    dur = max(0.1, trim_out - trim_in)
    cmd = ["ffmpeg", "-y", "-i", src_path, "-ss", "%.3f" % trim_in, "-t", "%.3f" % dur]
    if vf:
        cmd += ["-vf", vf]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out_path]
    log("ffmpeg:", " ".join(cmd))
    subprocess.run(cmd, check=True)


# ── Indexación (reusa el workflow existente) ───────────────
def dispatch_index(loc, can, lado):
    pat = os.environ.get("PAT_GITHUB")
    if not pat:
        log("[WARN] sin PAT_GITHUB; omito dispatch de índice"); return
    requests.post(
        f"https://api.github.com/repos/{GITHUB_REPO}/dispatches",
        headers={"Authorization": "token " + pat, "Accept": "application/vnd.github+json"},
        json={"event_type": "gestionar_indice", "client_payload": {"loc": loc, "can": can, "lado": lado}},
        timeout=30,
    )


# ── Main ───────────────────────────────────────────────────
def process_doc(db, dbx, doc):
    d = doc.to_dict() or {}
    ref = doc.reference
    ref.update({"status": "processing", "state_updated_at": firestore.SERVER_TIMESTAMP})
    club = d.get("club"); court = d.get("court") or ("Cancha" + str(d.get("cancha") or ""))
    lado = d.get("lado") or "LadoA"
    trim = d.get("trim") or {}; tin = float(trim.get("in") or 0); tout = float(trim.get("out") or 0)
    if not (tout > tin):
        ref.update({"status": "error", "error_reason": "invalid_trim"}); return
    src_url = d.get("source_url")
    if not src_url:
        ref.update({"status": "error", "error_reason": "no_source"}); return

    tmp = tempfile.mkdtemp()
    src = os.path.join(tmp, "src.mp4"); out = os.path.join(tmp, "out.mp4")
    try:
        r = requests.get(src_url, timeout=120); r.raise_for_status()
        with open(src, "wb") as f: f.write(r.content)
        render(src, out, tin, tout, d.get("reframe") or {})

        now = datetime.datetime.now()
        tag = "PUNTAZO" if d.get("kind") == "puntazo" else "EDIT"
        eid = (d.get("client_edit_id") or doc.id)[-8:]
        name = f"{club}_{court}_{lado}_{tag}_{eid}_{now:%d%m%Y_%H%M%S}.mp4"
        dpath = f"{DROPBOX_BASE}/{club}/{court}/{lado}/{name}"
        url = dbx_upload(dbx, out, dpath)
        ref.update({"status": "done", "result_video_url": url, "result_name": name,
                    "consumed_at": firestore.SERVER_TIMESTAMP,
                    "state_updated_at": firestore.SERVER_TIMESTAMP})
        dispatch_index(club, court, lado)
        log(f"[OK] {doc.id} -> {name}")
    except subprocess.CalledProcessError as e:
        ref.update({"status": "error", "error_reason": "ffmpeg_failed"}); log("[ERR] ffmpeg", e)
    except Exception as e:
        ref.update({"status": "error", "error_reason": str(e)[:140]}); log("[ERR]", e)


def main():
    db = init_firestore(); dbx = connect_dropbox()
    q = db.collection("clip_edits").where("status", "==", "pending").limit(MAX_PER_RUN)
    docs = list(q.stream())
    log(f"pending clip_edits: {len(docs)}")
    for doc in docs:
        try:
            process_doc(db, dbx, doc)
        except Exception as e:
            log("[ERR doc]", doc.id, e)
    log("done")


if __name__ == "__main__":
    main()
