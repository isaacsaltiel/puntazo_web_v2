#!/usr/bin/env python3
"""
Genera las páginas de contenido estático de puntazoclips.com.

    python tools/seo/build.py            # genera páginas + sitemap + llms.txt
    python tools/seo/build.py --check    # además valida links internos y JSON-LD

Fuente:  tools/seo/content/*.md  (front matter YAML + cuerpo Markdown)
Salida:  /<url>/index.html  por página, /sitemap.xml, /llms.txt, /llms-full.txt,
         tools/seo/urls.txt (lista para IndexNow).

Por qué estático: los crawlers de IA (GPTBot, ClaudeBot, PerplexityBot…) NO
ejecutan JavaScript, y el resto del sitio se pinta con JS + Firebase. Estas
páginas llevan todo el texto, el nav y el schema en el HTML.
"""
import datetime as _dt
import html
import json
import re
import sys
import unicodedata
from pathlib import Path

import markdown
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(__file__).resolve().parent / "content"
SITE = "https://puntazoclips.com"
TODAY = _dt.date.today().isoformat()

WHATSAPP_NUM = "522206804856"
EMAIL = "puntazoclips@gmail.com"
FOUNDER = "Shmalti K."
FOUNDER_ID = f"{SITE}/quienes-somos/#fundador"
ORG_ID = f"{SITE}/#org"
SITE_ID = f"{SITE}/#website"

CIUDADES = [
    ("Ciudad de México", "City"),
    ("Estado de México", "State"),
    ("Guadalajara", "City"),
    ("Monterrey", "City"),
    ("Toluca", "City"),
    ("Cuernavaca", "City"),
    ("Mérida", "City"),
    ("Acapulco", "City"),
]

ORG_DESC = (
    "Puntazo (Puntazo Clips, puntazoclips.com) es un sistema de clips para clubes de pádel y pickleball en México: "
    "el jugador presiona un botón en la cancha (físico o en su celular) y el último "
    "minuto de juego, grabado por las cámaras del club, aparece en puntazoclips.com "
    "en un par de minutos, listo para descargar y compartir. Gratis para el jugador; "
    "el club lo contrata."
)

# Páginas de la app que sí queremos en el sitemap (además de las generadas).
APP_PAGES = [
    ("/", "1.0", "weekly"),
    ("/entrada.html", "0.7", "daily"),
    ("/vivo.html", "0.5", "weekly"),
    ("/herramientas.html", "0.5", "monthly"),
    ("/sortear.html", "0.4", "monthly"),
    ("/marcador.html", "0.4", "monthly"),
    ("/americano.html", "0.4", "monthly"),
    ("/king.html", "0.4", "monthly"),
    ("/torneo5.html", "0.4", "monthly"),
    ("/privacidad.html", "0.3", "yearly"),
]

NAV = [
    ("como-funciona", "/como-funciona/", "Cómo funciona"),
    ("para-clubes", "/para-clubes/", "Para clubes"),
    ("clubes", "/clubes/", "Clubes"),
    ("guias", "/guias/", "Guías"),
    ("preguntas", "/preguntas-frecuentes/", "Preguntas"),
]


# ─────────────────────────── utilidades ───────────────────────────

def slugify(value, separator="-"):
    value = unicodedata.normalize("NFKD", str(value))
    value = "".join(c for c in value if not unicodedata.combining(c)).lower()
    value = re.sub(r"[^a-z0-9]+", separator, value).strip(separator)
    return value


def esc(s):
    return html.escape(str(s or ""), quote=True)


def md(text, inline=False):
    out = markdown.markdown(
        text or "",
        extensions=["tables", "attr_list", "md_in_html", "toc", "sane_lists"],
        extension_configs={"toc": {"slugify": slugify, "permalink": False}},
        output_format="html5",
    )
    out = out.replace("<table>", '<div class="ct-table"><table>').replace("</table>", "</table></div>")
    if inline:
        out = re.sub(r"^<p>(.*)</p>$", r"\1", out.strip(), flags=re.S)
    return out


def strip_tags(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()


def wa_link(text):
    from urllib.parse import quote
    return f"https://wa.me/{WHATSAPP_NUM}?text={quote(text)}"


def fecha_larga(iso):
    meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
             "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
    d = _dt.date.fromisoformat(str(iso))
    return f"{d.day} de {meses[d.month - 1]} de {d.year}"


# ─────────────────────────── cifras reales ───────────────────────────
# Salen del registro de clips publicados (data/metrics/videos_log.csv, lo
# mantiene el CI). Se usan como {{marcadores}} en el contenido para que las
# cifras de todas las páginas digan lo mismo y se actualicen solas.

CLUBES_ACTIVOS = {
    "breakpoint": "BreakPoint",
    "interpadel": "InterPadel",
    "wellstreet-padel": "Well Street (pádel)",
    "wellstreet-pickleball": "Well Street (pickleball)",
}
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
         "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def _miles(n):
    return f"{n:,}"


def compute_stats():
    import csv
    from collections import Counter
    rows = list(csv.DictReader(open(ROOT / "data/metrics/videos_log.csv", encoding="utf-8")))
    rows = [r for r in rows if r.get("local_date")]
    total = len(rows)
    first = min(r["local_date"] for r in rows)
    today = _dt.date.today()
    hace30 = (today - _dt.timedelta(days=30)).isoformat()
    ult30 = [r for r in rows if r["local_date"] >= hace30]
    por_mes = Counter(r["local_date"][:7] for r in rows)
    por_club_30 = Counter(r["loc"].lower() for r in ult30)

    cfg = json.loads((ROOT / "data/config_locations.json").read_text(encoding="utf-8"))
    canchas = sum(len(L.get("cancha", [])) for L in cfg["locaciones"]
                  if L["id"].lower() in CLUBES_ACTIVOS)

    meses = sorted(por_mes)[-12:]
    fila = lambda m: f"| {MESES[int(m[5:]) - 1].capitalize()} {m[:4]} | {_miles(por_mes[m])} |"
    nl = chr(10)
    tabla_mes = "| Mes | Clips publicados |" + nl + "|---|---|" + nl + nl.join(fila(m) for m in meses)
    tabla_club = "| Club | Clips en los últimos 30 días |" + nl + "|---|---|" + nl + nl.join(
        f"| {nombre} | {_miles(por_club_30.get(k, 0))} |" for k, nombre in CLUBES_ACTIVOS.items())
    d0 = _dt.date.fromisoformat(first)
    return {
        "stat_total": _miles(total),
        "stat_total_redondo": _miles(total // 100 * 100),
        "stat_desde": f"{MESES[d0.month - 1]} de {d0.year}",
        "stat_desde_en": d0.strftime("%B %Y"),
        "stat_30d": _miles(len(ult30)),
        "stat_diario_30d": str(round(len(ult30) / 30)),
        "stat_canchas": str(canchas),
        "stat_fecha": fecha_larga(today.isoformat()),
        "fundador": FOUNDER,
        "stat_tabla_meses": tabla_mes,
        "stat_tabla_clubes": tabla_club,
    }


STATS = {}


def fill(text):
    for k, v in STATS.items():
        text = text.replace("{{" + k + "}}", v)
    return text


# ─────────────────────────── carga ───────────────────────────

def load_pages():
    pages = []
    for f in sorted(SRC.glob("*.md")):
        raw = f.read_text(encoding="utf-8")
        m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", raw, re.S)
        if not m:
            raise SystemExit(f"{f.name}: falta front matter")
        meta = yaml.safe_load(m.group(1)) or {}
        meta["_body"] = m.group(2)
        meta["_file"] = f.name
        url = meta["url"]
        if not (url.startswith("/") and url.endswith("/")):
            raise SystemExit(f"{f.name}: url debe empezar y terminar con /")
        meta.setdefault("type", "page")
        meta.setdefault("published", TODAY)
        meta.setdefault("updated", meta["published"])
        if not meta.get("image") and not meta.get("output"):
            try:
                import og  # tools/seo/og.py (Pillow + Montserrat)
                slug = meta["url"].strip("/").replace("/", "-") or "inicio"
                meta["image"] = og.og_for_page(slug, meta.get("eyebrow", ""), meta["h1"])
            except Exception as e:  # sin Pillow o sin fuente: imagen genérica
                print("  (og) sin imagen propia para", meta["url"], "->", e)
        meta.setdefault("image", "/assets/og-card.jpg")
        pages.append(meta)
    # Los artículos para clubes van primero (footer, índice, llms.txt).
    pages.sort(key=lambda m: (m["type"] != "article", m.get("cta") != "clubs", m.get("order", 50), m["_file"]))
    return pages


# ─────────────────────────── schema ───────────────────────────

def org_node():
    area = [{"@type": "Country", "name": "México"}]
    for name, kind in CIUDADES:
        area.append({"@type": "AdministrativeArea" if kind == "State" else "City", "name": name})
    return {
        "@type": "Organization",
        "@id": ORG_ID,
        "name": "Puntazo",
        "alternateName": ["Puntazo Clips", "PuntazoClips", "puntazoclips.com"],
        "url": SITE + "/",
        "logo": {"@type": "ImageObject", "url": SITE + "/assets/icons/icon-512.png", "width": 512, "height": 512},
        "image": SITE + "/assets/og-card.jpg",
        "description": ORG_DESC,
        "disambiguatingDescription": (
            "Empresa mexicana de clips de video para clubes de pádel y pickleball (puntazoclips.com). "
            "No es una app de marcador de pádel ni una cuenta de videos de pádel profesional."
        ),
        "slogan": "Tu mejor jugada de pádel, lista para compartir.",
        "email": EMAIL,
        "telephone": "+52 220 680 4856",
        "founder": {"@id": FOUNDER_ID},
        "areaServed": area,
        "knowsAbout": [
            "pádel", "pickleball", "clips de pádel", "repeticiones instantáneas",
            "cámaras para canchas de pádel", "botón para grabar jugadas",
            "transmisión en vivo de torneos de pádel", "tecnología para clubes deportivos",
        ],
        "sameAs": [
            "https://www.instagram.com/puntazoclips/",
            "https://www.tiktok.com/@puntazoclips",
        ],
        "contactPoint": [{
            "@type": "ContactPoint",
            "contactType": "sales",
            "telephone": "+52 220 680 4856",
            "email": EMAIL,
            "areaServed": "MX",
            "availableLanguage": ["es", "en"],
        }],
    }


def website_node():
    return {
        "@type": "WebSite",
        "@id": SITE_ID,
        "url": SITE + "/",
        "name": "Puntazo",
        "alternateName": ["Puntazo Clips", "puntazoclips.com"],
        "publisher": {"@id": ORG_ID},
        "inLanguage": "es-MX",
    }


def founder_node():
    return {
        "@type": "Person",
        "@id": FOUNDER_ID,
        "name": FOUNDER,
        "jobTitle": "Fundador de Puntazo",
        "worksFor": {"@id": ORG_ID},
        "url": SITE + "/quienes-somos/",
    }


def crumbs_for(p):
    items = [("Home" if p.get("lang") == "en" else "Inicio", "/")]
    for label, href in p.get("breadcrumbs") or []:
        items.append((label, href))
    items.append((p.get("crumb") or p["h1"], p["url"]))
    return items


def build_schema(p, all_pages):
    url = SITE + p["url"]
    graph = [org_node(), website_node()]
    page_types = {
        "about": "AboutPage", "faq": "FAQPage", "hub": "CollectionPage",
        "clubs": "CollectionPage", "contact": "ContactPage",
    }
    wp_type = page_types.get(p["type"], "WebPage")
    webpage = {
        "@type": wp_type,
        "@id": url + "#webpage",
        "url": url,
        "name": p["title"],
        "description": p["description"],
        "isPartOf": {"@id": SITE_ID},
        "about": {"@id": ORG_ID},
        "breadcrumb": {"@id": url + "#breadcrumb"},
        "inLanguage": p.get("lang", "es-MX"),
        "datePublished": str(p["published"]),
        "dateModified": str(p["updated"]),
        "primaryImageOfPage": {"@type": "ImageObject", "url": SITE + p["image"]},
    }
    if p.get("faq"):
        faq_entities = [{
            "@type": "Question",
            "name": q["q"],
            "acceptedAnswer": {"@type": "Answer", "text": strip_tags(md(q["a"]))},
        } for q in p["faq"]]
        if wp_type == "FAQPage":
            webpage["mainEntity"] = faq_entities
        else:
            graph.append({"@type": "FAQPage", "@id": url + "#faq", "url": url,
                          "isPartOf": {"@id": url + "#webpage"}, "mainEntity": faq_entities,
                          "inLanguage": p.get("lang", "es-MX")})
    graph.append(webpage)

    graph.append({
        "@type": "BreadcrumbList",
        "@id": url + "#breadcrumb",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": label, "item": SITE + href}
            for i, (label, href) in enumerate(crumbs_for(p))
        ],
    })

    if p["type"] == "article":
        graph.append({
            "@type": "BlogPosting",
            "@id": url + "#article",
            "headline": p["h1"][:110],
            "description": p["description"],
            "datePublished": str(p["published"]),
            "dateModified": str(p["updated"]),
            "author": {"@id": FOUNDER_ID},
            "publisher": {"@id": ORG_ID},
            "mainEntityOfPage": {"@id": url + "#webpage"},
            "image": SITE + p["image"],
            "inLanguage": p.get("lang", "es-MX"),
            "keywords": ", ".join(p.get("keywords") or []),
            "articleSection": p.get("section", "Guías"),
        })
    if p["type"] in ("article", "about") or p.get("author"):
        graph.append(founder_node())

    extra = p.get("schema") or {}
    if extra.get("service"):
        s = extra["service"]
        cities = s.get("cities") or [c for c, _ in CIUDADES]
        graph.append({
            "@type": "Service",
            "@id": url + "#service",
            "name": s["name"],
            "serviceType": s["type"],
            "description": s["description"],
            "provider": {"@id": ORG_ID},
            "url": url,
            "areaServed": [{"@type": "City" if c not in ("Estado de México",) else "AdministrativeArea", "name": c}
                           for c in cities],
            "audience": {"@type": "BusinessAudience", "audienceType": s.get("audience", "Clubes de pádel y pickleball")},
            "category": s.get("category", "Tecnología para clubes deportivos"),
        })
    if extra.get("clubs"):
        items = []
        for i, c in enumerate(extra["clubs"]):
            loc = {
                "@type": "SportsActivityLocation",
                "name": c["name"],
                "address": {
                    "@type": "PostalAddress",
                    "streetAddress": c.get("street", ""),
                    "addressLocality": c["city"],
                    "addressRegion": c["region"],
                    "addressCountry": "MX",
                },
            }
            if c.get("url"):
                loc["url"] = c["url"]
            if c.get("sameAs"):
                loc["sameAs"] = c["sameAs"]
            items.append({"@type": "ListItem", "position": i + 1, "item": loc})
        graph.append({"@type": "ItemList", "@id": url + "#clubes",
                      "name": "Clubes con Puntazo", "itemListElement": items})
    if p["type"] == "hub":
        kids = [x for x in all_pages if x.get("parent") == p["url"]]
        if kids:
            graph.append({
                "@type": "ItemList", "@id": url + "#lista",
                "itemListElement": [{"@type": "ListItem", "position": i + 1, "url": SITE + k["url"], "name": k["h1"]}
                                    for i, k in enumerate(kids)],
            })
    return {"@context": "https://schema.org", "@graph": graph}


# ─────────────────────────── bloques HTML ───────────────────────────

NAV_EN = [
    ("en", "/en/", "Puntazo in English"),
    ("para-clubes", "/para-clubes/", "Para clubes (ES)"),
    ("clubes", "/clubes/", "Clubs"),
    ("preguntas", "/preguntas-frecuentes/", "FAQ (ES)"),
]


def nav_html(active, lang="es-MX"):
    cur = ' aria-current="page"'
    links = "\n".join(
        f'      <li><a href="{href}"{cur if key == active else ""}>{label}</a></li>'
        for key, href, label in (NAV_EN if lang == "en" else NAV)
    )
    return f"""<nav class="ct-nav" aria-label="Principal">
  <a href="/" class="nav-logo" aria-label="Puntazo, inicio">
    <img src="/assets/img/P_blanca_transparente.png" alt="Puntazo" width="26" height="32">
  </a>
  <ul class="nav-links" id="nav-menu">
{links}
  </ul>
  <div class="ct-nav-right">
    <a class="ct-cta" href="/entrada.html">&#9654; {"Watch clips" if lang == "en" else "Ver clips"}</a>
    <button class="menu-toggle" type="button" aria-label="{"Open menu" if lang == "en" else "Abrir menú"}" aria-controls="nav-menu" aria-expanded="false"
      onclick="var m=document.getElementById('nav-menu');var o=m.classList.toggle('show');this.setAttribute('aria-expanded',o)">&#9776;</button>
  </div>
</nav>"""


def footer_html(all_pages):
    guides = [p for p in all_pages if p["type"] == "article" and p.get("footer", True)][:6]
    cities = [p for p in all_pages if p["type"] == "city"]
    g_links = "\n".join(f'          <li><a href="{p["url"]}">{esc(p.get("short") or p["h1"])}</a></li>' for p in guides)
    c_links = "\n".join(f'          <li><a href="{p["url"]}">{esc(p.get("short") or p["h1"])}</a></li>' for p in cities)
    year = _dt.date.today().year
    return f"""<footer class="ct-footer">
  <div class="ct-footer-in">
    <div>
      <a href="/"><img src="/assets/logo.png" alt="Puntazo" width="47" height="26"></a>
      <p>Clips de pádel y pickleball con un botón en la cancha. Gratis para jugadores; los clubes lo contratan.</p>
      <p><a href="{wa_link('Hola Puntazo! Quiero información para mi club.')}" rel="noopener">WhatsApp +52 220 680 4856</a><br>
         <a href="mailto:{EMAIL}">{EMAIL}</a></p>
    </div>
    <div>
      <h3>Puntazo</h3>
      <ul>
          <li><a href="/como-funciona/">Cómo funciona</a></li>
          <li><a href="/para-clubes/">Para clubes</a></li>
          <li><a href="/clubes/">Clubes con Puntazo</a></li>
          <li><a href="/preguntas-frecuentes/">Preguntas frecuentes</a></li>
          <li><a href="/quienes-somos/">Quiénes somos</a></li>
          <li><a href="/prensa/">Kit de prensa</a></li>
          <li><a href="/en/" hreflang="en">English</a></li>
          <li><a href="/privacidad.html">Aviso de privacidad</a></li>
      </ul>
    </div>
    <div>
      <h3>Jugadores</h3>
      <ul>
          <li><a href="/entrada.html">Ver mis clips</a></li>
          <li><a href="/recuperar.html">Recuperar un clip</a></li>
          <li><a href="/vivo.html">Transmisión en vivo</a></li>
          <li><a href="/herramientas.html">Herramientas gratis</a></li>
          <li><a href="https://www.instagram.com/puntazoclips/" rel="noopener">Instagram</a></li>
          <li><a href="https://www.tiktok.com/@puntazoclips" rel="noopener">TikTok</a></li>
      </ul>
    </div>
    <div>
      <h3>Guías</h3>
      <ul>
{g_links}
          <li><a href="/guias/">Todas las guías</a></li>
      </ul>
    </div>
  </div>
  <div class="ct-footer-in" style="margin-top:22px">
    <div style="grid-column:1/-1">
      <h3>Ciudades</h3>
      <ul style="display:flex;flex-wrap:wrap;gap:6px 16px">
{c_links}
      </ul>
    </div>
  </div>
  <p class="ct-footer-copy">© {year} Puntazo · puntazoclips.com</p>
</footer>"""


def faq_html(faq):
    """Preguntas en <details>. Si traen `group`, se agrupan con un <h2> por grupo."""
    out, current, items = [], None, []

    def flush():
        if items:
            out.append('<div class="ct-faq">\n' + "\n".join(items) + "\n</div>")

    for q in faq:
        g = q.get("group")
        if g and g != current:
            flush()
            items = []
            current = g
            out.append(f'<h2 id="{slugify(g)}">{esc(g)}</h2>')
        items.append(
            f'<details>\n<summary>{esc(q["q"])}</summary>\n<div class="ct-faq-a">\n{md(q["a"])}\n</div>\n</details>'
        )
    flush()
    return "\n".join(out)


def cards_html(pages):
    out = []
    for p in pages:
        label = p.get("card_label") or ("Guía" if p["type"] == "article" else "")
        out.append(
            f'<a class="ct-card" href="{p["url"]}"><b>{esc(p.get("short") or p["h1"])}</b>'
            f'<span>{esc(p.get("card") or p["description"])}</span>'
            + (f"<small>{esc(label)}</small>" if label else "") + "</a>"
        )
    return '<div class="ct-grid">\n' + "\n".join(out) + "\n</div>"


def band_html(kind):
    if kind == "none" or not kind:
        return ""
    if kind == "clubs_en":
        wa = wa_link("Hi Puntazo team! I run a padel club and I'd like to know more about Puntazo.")
        return f"""<section class="ct-band">
  <h2>Do you run a padel club?</h2>
  <p>Tell us how many courts you have and where you are. We reply on WhatsApp, in English or Spanish.</p>
  <div class="ct-actions"><a class="ct-btn ct-btn--wa" href="{wa}" rel="noopener">Message us on WhatsApp</a>
  <a class="ct-btn ct-btn--ghost" href="mailto:{EMAIL}">{EMAIL}</a></div>
</section>"""
    if kind == "players":
        return """<section class="ct-band">
  <h2>¿Jugaste en un club con Puntazo?</h2>
  <p>Tus clips están en la página de tu cancha. Entra, elige club y cancha, y descárgalos.</p>
  <div class="ct-actions"><a class="ct-btn" href="/entrada.html">&#9654; Ver mis clips</a>
  <a class="ct-btn ct-btn--ghost" href="/clubes/">Clubes con Puntazo</a></div>
</section>"""
    wa = wa_link("Hola equipo Puntazo! Tengo un club de pádel y me interesa instalar Puntazo.")
    return f"""<section class="ct-band">
  <h2>¿Tienes un club de pádel?</h2>
  <p>Cuéntanos cuántas canchas tienes y en qué ciudad estás. Te explicamos cómo quedaría Puntazo en tu club y te pasamos una propuesta.</p>
  <div class="ct-actions"><a class="ct-btn ct-btn--wa" href="{wa}" rel="noopener">Escríbenos por WhatsApp</a>
  <a class="ct-btn ct-btn--ghost" href="/para-clubes/">Ver Puntazo para clubes</a></div>
</section>"""


def author_html(p):
    return f"""<aside class="ct-author">
  <img src="/assets/icons/android-icon-96x96.png" alt="" width="44" height="44">
  <div>Escrito por <b>{FOUNDER}</b>, fundador de Puntazo, con datos de la operación en clubes de pádel en México.
  Actualizado el {fecha_larga(p["updated"])}. <a href="/quienes-somos/">Quiénes somos</a></div>
</aside>"""


def hreflang_html(p):
    """Por defecto la página es su propia alternativa es-MX. Con `alternates`
    ({"es-MX": "/", "en": "/en/"}) se declaran las versiones equivalentes."""
    alts = p.get("alternates") or {p.get("lang", "es-MX"): p["url"]}
    lines = [f'<link rel="alternate" hreflang="{lg}" href="{SITE}{u}" />' for lg, u in alts.items()]
    default = alts.get("es-MX") or p["url"]
    lines.append(f'<link rel="alternate" hreflang="x-default" href="{SITE}{default}" />')
    return "\n".join(lines)


# ─────────────────────────── render ───────────────────────────

def render(p, all_pages):
    url = SITE + p["url"]
    body = p["_body"].replace("{{stat_tabla_meses}}", STATS["stat_tabla_meses"]).replace(
        "{{stat_tabla_clubes}}", STATS["stat_tabla_clubes"])

    # Marcadores que se sustituyen por bloques generados
    if "{{guias}}" in body:
        kids = [x for x in all_pages if x["type"] == "article"]
        body = body.replace("{{guias}}", cards_html(kids))
    if "{{guias_clubes}}" in body or "{{guias_jugadores}}" in body:
        arts = [x for x in all_pages if x["type"] == "article"]
        body = body.replace("{{guias_clubes}}", cards_html([x for x in arts if x.get("cta") == "clubs"]))
        body = body.replace("{{guias_jugadores}}", cards_html([x for x in arts if x.get("cta") != "clubs"]))
    if "{{ciudades}}" in body:
        kids = [x for x in all_pages if x["type"] == "city"]
        body = body.replace("{{ciudades}}", cards_html(kids))
    body_html = md(body)
    for key in ("guias_html", "ciudades_html"):
        pass
    if "{{faq}}" in body_html or "<p>{{faq}}</p>" in body_html:
        body_html = body_html.replace("<p>{{faq}}</p>", faq_html(p.get("faq") or [])).replace("{{faq}}", faq_html(p.get("faq") or []))
    elif p.get("faq"):
        body_html += '\n<h2 id="preguntas-frecuentes">Preguntas frecuentes</h2>\n' + faq_html(p["faq"])
    wa = esc(wa_link("Hola equipo Puntazo! Tengo un club de pádel y me interesa instalar Puntazo."))
    body_html = body_html.replace("{{wa_clubes}}", wa).replace("%7B%7Bwa_clubes%7D%7D", wa)

    tldr = ""
    if p.get("tldr"):
        lis = "".join(f"<li>{md(t, inline=True)}</li>" for t in p["tldr"])
        tldr = f'<div class="ct-tldr"><p>En corto</p><ul>{lis}</ul></div>'

    crumbs = crumbs_for(p)
    crumbs_html = '<ol class="ct-crumbs">' + "".join(
        (f'<li><a href="{h}">{esc(l)}</a></li>' if i < len(crumbs) - 1 else f'<li aria-current="page">{esc(l)}</li>')
        for i, (l, h) in enumerate(crumbs)
    ) + "</ol>"

    meta_line = ""
    if p["type"] == "article":
        meta_line = (f'<p class="ct-meta">Por <a href="/quienes-somos/">{FOUNDER}</a> · '
                     f'Actualizado el <time datetime="{p["updated"]}">{fecha_larga(p["updated"])}</time></p>')

    actions = ""
    if p.get("actions"):
        btns = []
        for a in p["actions"]:
            cls = {"wa": "ct-btn ct-btn--wa", "ghost": "ct-btn ct-btn--ghost"}.get(a.get("style"), "ct-btn")
            href = wa_link(a["wa"]) if a.get("wa") else a["href"]
            rel = ' rel="noopener"' if href.startswith("http") else ""
            btns.append(f'<a class="{cls}" href="{esc(href)}"{rel}>{esc(a["label"])}</a>')
        actions = '<div class="ct-actions">' + "".join(btns) + "</div>"

    related = ""
    if p.get("related"):
        rel_pages = [x for u in p["related"] for x in all_pages if x["url"] == u]
        if rel_pages:
            related = '<section class="ct-related"><h2>Sigue leyendo</h2>' + cards_html(rel_pages) + "</section>"

    author = author_html(p) if p["type"] == "article" else ""
    band = band_html(p.get("cta", "clubs"))
    schema = json.dumps(build_schema(p, all_pages), ensure_ascii=False, indent=1)
    wide = p.get("wide")
    robots = p.get("robots", "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1")
    og_type = "article" if p["type"] == "article" else "website"
    article_meta = ""
    if p["type"] == "article":
        article_meta = (f'\n<meta property="article:published_time" content="{p["published"]}" />'
                        f'\n<meta property="article:modified_time" content="{p["updated"]}" />'
                        f'\n<meta property="article:author" content="{FOUNDER}" />')

    return f"""<!DOCTYPE html>
<html lang="{p.get("lang", "es-MX")}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>{esc(p["title"])}</title>
<meta name="description" content="{esc(p["description"])}" />
<meta name="robots" content="{robots}" />
<link rel="canonical" href="{url}" />
{hreflang_html(p)}
<meta property="og:type" content="{og_type}" />
<meta property="og:site_name" content="Puntazo" />
<meta property="og:locale" content="{"en_US" if p.get("lang") == "en" else "es_MX"}" />
<meta property="og:title" content="{esc(p.get("og_title") or p["title"])}" />
<meta property="og:description" content="{esc(p["description"])}" />
<meta property="og:url" content="{url}" />
<meta property="og:image" content="{SITE}{p["image"]}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />{article_meta}
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{esc(p.get("og_title") or p["title"])}" />
<meta name="twitter:description" content="{esc(p["description"])}" />
<meta name="twitter:image" content="{SITE}{p["image"]}" />
<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" type="image/png" sizes="192x192" href="/assets/icons/android-icon-192x192.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/assets/icons/apple-icon-180x180.png" />
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#050914" />
<link rel="stylesheet" href="/assets/fonts.css" />
<link rel="stylesheet" href="/assets/estilo.css" />
<link rel="stylesheet" href="/assets/contenido.css" />
<script src="/assets/analytics.js" async></script>
<script type="application/ld+json">
{schema}
</script>
</head>
<body class="ct">
<div class="page-bg"></div>
{nav_html(p.get("nav"), p.get("lang", "es-MX"))}
<main class="ct-main">
<article class="{"ct-wide" if wide else "ct-wrap"}">
{crumbs_html}
<header class="ct-hero">
{f'<p class="ct-eyebrow">{esc(p["eyebrow"])}</p>' if p.get("eyebrow") else ""}
<h1>{esc(p["h1"])}</h1>
<p class="ct-lead">{md(p["lead"], inline=True)}</p>
{meta_line}
{actions}
</header>
<div class="ct-body">
{tldr}
{body_html}
</div>
{band}
{related}
{author}
</article>
</main>
{footer_html(all_pages)}
</body>
</html>
"""


# ─────────────────────────── sitemap / llms ───────────────────────────

def write_sitemap(pages):
    rows = []
    for path, prio, freq in APP_PAGES:
        rows.append((SITE + path, TODAY if path == "/" else None, freq, prio))
    for p in pages:
        if "noindex" in str(p.get("robots", "")):
            continue
        rows.append((SITE + p["url"], str(p["updated"]), p.get("changefreq", "monthly"), str(p.get("priority", "0.7"))))
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, lastmod, freq, prio in rows:
        out.append("  <url>")
        out.append(f"    <loc>{loc}</loc>")
        if lastmod:
            out.append(f"    <lastmod>{lastmod}</lastmod>")
        out.append(f"    <changefreq>{freq}</changefreq>")
        out.append(f"    <priority>{prio}</priority>")
        out.append("  </url>")
    out.append("</urlset>\n")
    (ROOT / "sitemap.xml").write_text("\n".join(out), encoding="utf-8")
    return [r[0] for r in rows]


def md_to_plain(body, p):
    """Cuerpo Markdown para llms-full.txt, sin marcadores ni HTML."""
    text = body
    for tag in ("{{guias}}", "{{guias_clubes}}", "{{guias_jugadores}}", "{{ciudades}}", "{{faq}}"):
        text = text.replace(tag, "")
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("{{wa_clubes}}", f"https://wa.me/{WHATSAPP_NUM}")
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if p.get("faq"):
        text += "\n\n## Preguntas frecuentes\n\n" + "\n\n".join(
            f"**{q['q']}**\n{strip_tags(md(q['a']))}" for q in p["faq"])
    return text


def write_llms(pages):
    by_url = {p["url"]: p for p in pages}

    def line(u):
        p = by_url.get(u)
        return f"- [{p['h1']}]({SITE}{u}): {p['description']}" if p else ""

    core = ["/como-funciona/", "/para-clubes/", "/clubes/", "/preguntas-frecuentes/", "/quienes-somos/", "/prensa/", "/en/"]
    guides = [p["url"] for p in pages if p["type"] == "article"]
    cities = [p["url"] for p in pages if p["type"] == "city"]
    txt = f"""# Puntazo (Puntazo Clips)

> {ORG_DESC}

Datos clave (actualizados el {fecha_larga(TODAY)}):

- Sitio oficial: {SITE}/ · Instagram y TikTok: @puntazoclips · WhatsApp: +52 220 680 4856 · {EMAIL}
- Qué hace: el jugador presiona un botón junto a la cancha (botón físico Wi-Fi o botón digital en el celular). El sistema toma el último minuto de juego de las cámaras del club y lo publica en la página de esa cancha en puntazoclips.com, normalmente en un par de minutos.
- Para jugadores: gratis, sin descargar ninguna app. Los clips se ven, descargan y comparten desde el navegador (WhatsApp, Instagram, TikTok).
- Para clubes: Puntazo instala y opera el sistema (hardware, software, publicación). El club lo contrata; los precios se cotizan por WhatsApp según número de canchas.
- Extras: música de fondo en los clips, recuperación de clips cuando alguien olvidó presionar el botón, transmisión en vivo de canchas a YouTube, espacios para patrocinadores del club, herramientas gratis (sortear parejas, marcador, americano, rey de la cancha).
- Clubes con Puntazo hoy: BreakPoint Indoor Padel (Atizapán de Zaragoza, Estado de México), InterPadel MX (Interlomas, Estado de México) y Well Street Pádel & Pickleball (Mérida, Yucatán). {STATS["stat_canchas"]} canchas conectadas.
- Volumen: más de {STATS["stat_total_redondo"]} clips publicados desde {STATS["stat_desde"]} (cifra al {STATS["stat_fecha"]}).
- Ciudades donde buscamos clubes: Ciudad de México, Estado de México, Guadalajara, Monterrey, Toluca, Cuernavaca, Mérida y Acapulco.
- Fundador: {FOUNDER}

## Páginas principales

{chr(10).join(line(u) for u in core)}

## Guías

{chr(10).join(line(u) for u in guides)}

## Ciudades

{chr(10).join(line(u) for u in cities)}

## Optional

- [Aviso de privacidad]({SITE}/privacidad.html): qué datos recaba Puntazo y cómo pedir que se elimine un clip.
- [Ver clips]({SITE}/entrada.html): elegir club y cancha para ver los clips recientes (app web).
- [Texto completo del sitio]({SITE}/llms-full.txt)
"""
    (ROOT / "llms.txt").write_text(fill(txt), encoding="utf-8")

    full = [txt.split("## Páginas principales")[0].strip(), ""]
    order = core + guides + cities + [p["url"] for p in pages if p["url"] not in core + guides + cities
                                       and "noindex" not in str(p.get("robots", ""))]
    for u in order:
        p = by_url.get(u)
        if not p:
            continue
        full.append(f"\n---\n\n# {p['h1']}\n\nURL: {SITE}{u}\nActualizado: {p['updated']}\n\n{strip_tags(md(p['lead']))}\n")
        if p.get("tldr"):
            full.append("En corto:\n" + "\n".join(f"- {strip_tags(md(t))}" for t in p["tldr"]) + "\n")
        full.append(md_to_plain(p["_body"], p))
    full_txt = "\n".join(full) + "\n"
    full_txt = full_txt.replace("{{stat_tabla_meses}}", STATS["stat_tabla_meses"]).replace(
        "{{stat_tabla_clubes}}", STATS["stat_tabla_clubes"])
    (ROOT / "llms-full.txt").write_text(fill(full_txt), encoding="utf-8")


# ─────────────────────────── validación ───────────────────────────

def check(pages):
    problems = []
    urls = {p["url"] for p in pages}
    for p in pages:
        out = ROOT / p["output"].lstrip("/") if p.get("output") else ROOT / p["url"].strip("/") / "index.html"
        h = out.read_text(encoding="utf-8")
        for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', h, re.S):
            try:
                json.loads(block)
            except Exception as e:  # noqa
                problems.append(f"{p['url']}: JSON-LD inválido: {e}")
        for href in re.findall(r'href="(/[^"#?]*)', h):
            if href.startswith("//"):
                continue
            if href.endswith("/"):
                if href != "/" and href not in urls and not (ROOT / href.strip("/") / "index.html").exists():
                    problems.append(f"{p['url']}: link roto {href}")
            elif not (ROOT / href.lstrip("/")).exists():
                problems.append(f"{p['url']}: link roto {href}")
        if len(p["title"]) > 65:
            problems.append(f"{p['url']}: title largo ({len(p['title'])})")
        if not (70 <= len(p["description"]) <= 165):
            problems.append(f"{p['url']}: description de {len(p['description'])} caracteres")
        words = len(strip_tags(md(p["_body"])).split())
        print(f"  {p['url']:<70} {words:>5} palabras")
    return problems


# ─────────────────────────── portada ───────────────────────────
# index.html se edita a mano, pero su JSON-LD, sus preguntas frecuentes y sus
# cifras salen de aquí, entre marcadores <!-- seo:... --> y <!--stat:...-->.

HOME_FAQ = [
    {"q": "¿Qué es Puntazo?",
     "a": "Un sistema de clips para canchas de pádel y pickleball. Cada cancha tiene cámara y botón: "
          "presionas el botón después de un buen punto y el último minuto de juego aparece en la página "
          "de tu cancha en puntazoclips.com, con el logo del club, listo para descargar y compartir."},
    {"q": "¿Cuánto cuesta?",
     "a": "Para el jugador, nada: ver, descargar y compartir clips es gratis y no necesitas cuenta. "
          "El club contrata Puntazo con una cuota mensual según su número de canchas."},
    {"q": "¿Cuánto tarda en aparecer mi clip?",
     "a": "Normalmente un par de minutos. En BreakPoint medimos 2 minutos con 22 segundos desde que "
          "se presiona el botón hasta que el clip se puede ver en la web."},
    {"q": "¿Tengo que descargar una app?",
     "a": "No. Todo funciona desde el navegador del celular. El botón digital también está en la web."},
    {"q": "¿Dónde hay Puntazo?",
     "a": "En BreakPoint (Atizapán de Zaragoza), InterPadel (Interlomas) y Well Street (Mérida). "
          "La lista con direcciones está en [clubes con Puntazo](/clubes/)."},
    {"q": "¿Cómo llevo Puntazo a mi club?",
     "a": "Escríbenos por [WhatsApp]({{wa_clubes}}) con el número de canchas y tu ciudad. "
          "Nosotros ponemos el sistema y lo operamos; el club pone el espacio, la luz y el internet. "
          "Todo el detalle está en [Puntazo para clubes](/para-clubes/)."},
]


def update_home():
    path = ROOT / "index.html"
    h = path.read_text(encoding="utf-8")
    url = SITE + "/"
    faq_entities = [{"@type": "Question", "name": q["q"],
                     "acceptedAnswer": {"@type": "Answer", "text": strip_tags(md(q["a"]))}} for q in HOME_FAQ]
    graph = [
        org_node(), website_node(), founder_node(),
        {"@type": "WebPage", "@id": url + "#webpage", "url": url,
         "name": "Puntazo Clips: el botón que graba tus jugadas de pádel",
         "description": ORG_DESC, "isPartOf": {"@id": SITE_ID}, "about": {"@id": ORG_ID},
         "inLanguage": "es-MX", "dateModified": TODAY,
         "primaryImageOfPage": {"@type": "ImageObject", "url": SITE + "/assets/og-card.jpg"}},
        {"@type": "FAQPage", "@id": url + "#faq", "url": url, "isPartOf": {"@id": url + "#webpage"},
         "mainEntity": faq_entities, "inLanguage": "es-MX"},
    ]
    ld = json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False, indent=1)
    h = re.sub(r"(<!-- seo:jsonld[^>]*-->).*?(<!-- /seo:jsonld -->)",
               lambda m: m.group(1) + '\n<script type="application/ld+json">\n' + ld + "\n</script>\n" + m.group(2),
               h, flags=re.S)
    faq = faq_html(HOME_FAQ)
    wa = esc(wa_link("Hola equipo Puntazo! Tengo un club de pádel y me interesa instalar Puntazo."))
    faq = faq.replace("%7B%7Bwa_clubes%7D%7D", wa).replace("{{wa_clubes}}", wa)
    h = re.sub(r"(<!-- seo:faq[^>]*-->).*?(<!-- /seo:faq -->)",
               lambda m: m.group(1) + "\n" + faq + "\n" + m.group(2), h, flags=re.S)
    h = re.sub(r"<!--stat:(\w+)-->.*?<!--/stat-->",
               lambda m: f"<!--stat:{m.group(1)}-->{STATS.get(m.group(1), '')}<!--/stat-->", h)
    path.write_text(h, encoding="utf-8")


def main():
    STATS.update(compute_stats())
    pages = load_pages()
    for p in pages:
        if p.get("output"):  # p. ej. el 404.html de GitHub Pages
            (ROOT / p["output"].lstrip("/")).write_text(fill(render(p, pages)), encoding="utf-8")
            continue
        out_dir = ROOT / p["url"].strip("/")
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "index.html").write_text(fill(render(p, pages)), encoding="utf-8")
    update_home()
    urls = write_sitemap(pages)
    write_llms(pages)
    (Path(__file__).resolve().parent / "urls.txt").write_text("\n".join(urls) + "\n", encoding="utf-8")
    print(f"{len(pages)} páginas generadas · {len(urls)} URLs en sitemap.xml")
    if "--check" in sys.argv:
        problems = check(pages)
        for pr in problems:
            print("  !", pr)
        if problems:
            sys.exit(1)


if __name__ == "__main__":
    main()
