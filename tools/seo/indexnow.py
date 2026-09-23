#!/usr/bin/env python3
"""
Avisa a los buscadores que usan IndexNow (Bing/Copilot, Yandex, Seznam,
Naver, Yep…) que hay páginas nuevas o cambiadas en puntazoclips.com.

    python tools/seo/indexnow.py                  # todas las URLs del sitemap
    python tools/seo/indexnow.py URL [URL ...]    # solo esas

La clave vive en tools/seo/indexnow_key.txt y el archivo de verificación en
la raíz del sitio (<clave>.txt). Google NO usa IndexNow: para Google cuenta el
Sitemap declarado en robots.txt y Search Console.
"""
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HOST = "puntazoclips.com"


def main():
    key = (Path(__file__).resolve().parent / "indexnow_key.txt").read_text().strip()
    urls = sys.argv[1:] or re.findall(r"<loc>([^<]+)</loc>", (ROOT / "sitemap.xml").read_text(encoding="utf-8"))
    body = json.dumps({
        "host": HOST,
        "key": key,
        "keyLocation": f"https://{HOST}/{key}.txt",
        "urlList": urls[:10000],
    }).encode("utf-8")
    req = urllib.request.Request("https://api.indexnow.org/indexnow", data=body,
                                 headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(f"IndexNow {r.status}: {len(urls)} URLs enviadas")
    except urllib.error.HTTPError as e:
        # 200/202 = ok; 403 = clave no encontrada; 422 = URL de otro host; 429 = demasiadas
        print(f"IndexNow {e.code}: {e.read()[:200]!r}")
        sys.exit(1)


if __name__ == "__main__":
    main()
