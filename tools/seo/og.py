"""
Imágenes para compartir (Open Graph, 1200x630) de puntazoclips.com.

    python tools/seo/og.py        # regenera assets/og-card.jpg (portada)

build.py llama a og_for_page() para crear assets/og/<slug>.jpg con el título
de cada página. Si la imagen ya existe con el mismo texto, no la rehace.
"""
import hashlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
FONT = Path(__file__).resolve().parent / "fonts" / "Montserrat-latin-var.ttf"
LOGO = ROOT / "assets" / "logo.png"          # paleta + PUNTAZO, blanco sobre transparente
MARK = ROOT / "assets" / "img" / "P_blanca_transparente.png"
W, H = 1200, 630


def font(size, weight):
    f = ImageFont.truetype(str(FONT), size)
    f.set_variation_by_axes([weight])
    return f


def background():
    img = Image.new("RGB", (W, H), "#050914")
    glow = Image.new("RGB", (W, H), "#050914")
    d = ImageDraw.Draw(glow)
    # resplandor azul de marca, abajo al centro y arriba a la derecha
    d.ellipse((W * 0.05, H * 0.45, W * 0.95, H * 1.6), fill="#0a3a9a")
    d.ellipse((W * 0.62, -H * 0.5, W * 1.25, H * 0.45), fill="#082c74")
    glow = glow.filter(ImageFilter.GaussianBlur(160))
    return Image.blend(img, glow, 0.85)


def wrap(draw, text, fnt, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        test = (cur + " " + w).strip()
        if draw.textlength(test, font=fnt) <= max_w:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def home_card(out=ROOT / "assets" / "og-card.jpg"):
    img = background()
    logo = Image.open(LOGO).convert("RGBA")
    lw = 560
    logo = logo.resize((lw, int(logo.height * lw / logo.width)), Image.LANCZOS)
    img.paste(logo, ((W - lw) // 2, 50), logo)
    d = ImageDraw.Draw(img)
    t1 = "Tu mejor jugada de pádel, lista para compartir."
    f1 = font(44, 800)
    d.text(((W - d.textlength(t1, font=f1)) // 2, 395), t1, font=f1, fill="#ffffff")
    t2 = "Presiona el botón en la cancha · sin apps · gratis para jugadores"
    f2 = font(27, 500)
    d.text(((W - d.textlength(t2, font=f2)) // 2, 462), t2, font=f2, fill="#a9c6f5")
    t3 = "puntazoclips.com"
    f3 = font(28, 800)
    d.text(((W - d.textlength(t3, font=f3)) // 2, 560), t3, font=f3, fill="#5aa2ff")
    img.save(out, "JPEG", quality=88, optimize=True, progressive=True)
    return out


def og_for_page(slug, eyebrow, title):
    """Crea assets/og/<slug>.jpg y devuelve su ruta pública."""
    out_dir = ROOT / "assets" / "og"
    out_dir.mkdir(parents=True, exist_ok=True)
    sig = hashlib.sha1(f"v2|{eyebrow}|{title}".encode("utf-8")).hexdigest()[:10]
    out = out_dir / f"{slug}.jpg"
    sig_dir = Path(__file__).resolve().parent / "og_sig"
    sig_dir.mkdir(exist_ok=True)
    stamp = sig_dir / f"{slug}.sig"
    if out.exists() and stamp.exists() and stamp.read_text() == sig:
        return f"/assets/og/{slug}.jpg"

    img = background()
    d = ImageDraw.Draw(img)
    mark = Image.open(MARK).convert("RGBA")
    mh = 64
    mark = mark.resize((int(mark.width * mh / mark.height), mh), Image.LANCZOS)
    img.paste(mark, (72, 60), mark)
    fb = font(30, 800)
    d.text((72 + mark.width + 18, 74), "Puntazo", font=fb, fill="#ffffff")

    if eyebrow:
        fe = font(24, 800)
        d.text((72, 190), eyebrow.upper(), font=fe, fill="#5aa2ff")

    size = 68
    while True:
        ft = font(size, 900)
        lines = wrap(d, title, ft, W - 144)
        if len(lines) <= 3 or size <= 46:
            break
        size -= 4
    y = 240
    for ln in lines[:4]:
        d.text((72, y), ln, font=ft, fill="#ffffff")
        y += int(size * 1.12)

    fd = font(26, 700)
    d.text((72, H - 78), "puntazoclips.com", font=fd, fill="#a9c6f5")
    pill = "Clips de pádel con un botón"
    fp = font(22, 800)
    pw = d.textlength(pill, font=fp) + 40
    d.rounded_rectangle((W - 72 - pw, H - 88, W - 72, H - 44), radius=22, fill="#0b7cff")
    d.text((W - 72 - pw + 20, H - 81), pill, font=fp, fill="#ffffff")

    img.save(out, "JPEG", quality=86, optimize=True, progressive=True)
    stamp.write_text(sig)
    return f"/assets/og/{slug}.jpg"


if __name__ == "__main__":
    print(home_card())
