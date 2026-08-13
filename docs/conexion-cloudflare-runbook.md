# Conexión global del sitio — post-mortem + runbook (Cloudflare)

**Última actualización:** 2026-08-13
**Estado:** ✅ Resuelto y verificado end-to-end (incl. confirmación humana desde WiM).

Documento de referencia sobre por qué usuarios no podían entrar a
`puntazoclips.com`, cómo se resolvió, cómo quedó montada la conexión, y cómo
operarla/diagnosticarla si algo reaparece.

---

## 1. TL;DR

Usuarios en Mérida y EE.UU. (y luego específicamente en **ciertas antenas
móviles**, p.ej. **WiM**) veían **pantalla en blanco / "nunca carga"**, y **con
VPN sí entraban**. No era un solo problema, eran **tres capas**:

1. **Terceros en la ruta crítica de render** (SDK de Firebase y Google Fonts
   cargados desde `gstatic.com`/`fonts.googleapis.com` como `<script>`/`<link>`
   bloqueantes). Si esos hosts se colgaban, el `<body>` ni se parseaba.
2. **Firestore en WebChannel** sin fallback: se cuelga sin dar error tras
   proxies/ISP/antivirus que inspecciona TLS.
3. **Las IPs de GitHub Pages (Fastly, `185.199.108-111.153`) no eran
   alcanzables de forma confiable desde ciertas redes móviles** (IPv6-only con
   NAT64 y ruteo intermitente a Fastly). Esta fue la causa de las "antenas".

Se arreglaron las tres. La #3, que era la persistente, se resolvió poniendo
**Cloudflare delante del sitio**: el usuario se conecta a las IPs de Cloudflare
(que su red sí alcanza), y Cloudflare trae el contenido de GitHub Pages por
detrás. El tramo roto (red-móvil → Fastly) sale del camino del usuario.

---

## 2. Cómo se diagnosticó (para reusar el método)

La clave fue **distinguir capas** con pruebas objetivas, no adivinar:

- **"Con VPN sí" + "algunas antenas no"** → apunta a ruteo/reputación de IP o
  IPv6/NAT64, no al sitio.
- **`octocat.github.io` (vive en las MISMAS IPs de Fastly que el sitio) cargaba
  una vez y al refrescar no** → probó que (a) NO es el sitio ni el DNS —octocat
  sufre igual—, y (b) NO es bloqueo total sino **ruta intermitente** a Fastly.
- **`discord.com` (en Cloudflare) aguantó refrescos en esa misma antena** →
  probó que Cloudflare **sí** es alcanzable de forma estable desde esa red, o
  sea que mover el sitio a Cloudflare lo arregla.

Comandos de diagnóstico DNS/IP reutilizables al final (§7).

---

## 3. Arquitectura de conexión (cómo quedó)

```
Navegador  ──HTTPS──►  Cloudflare (edge, IPs propias, PoP en México)
                              │  (origin fetch, HTTPS, SSL "Full")
                              ▼
                       GitHub Pages / Fastly  ◄── se despliega con git push
                       (origen real: 185.199.108-111.153)
```

- **Dominio:** `puntazoclips.com`, registrado en **GoDaddy**.
- **DNS:** gestionado por **Cloudflare** (plan Free).
  Nameservers: `ligia.ns.cloudflare.com`, `pranab.ns.cloudflare.com`
  (reemplazaron a `ns49/ns50.domaincontrol.com`).
- **Hosting/origen:** sigue siendo **GitHub Pages** (repo `puntazo_web_v2`).
  **No se movió el hosting** — el pipeline de CI que actualiza los JSON sigue
  intacto (git push → GitHub Pages). Cloudflare es solo la capa de red delante.
- **Por qué proxy-delante-de-GitHub y no Cloudflare Pages:** el CI pushea muy
  seguido; Cloudflare Pages reventaría el límite de 500 builds/mes del plan Free.

### Registros DNS

**Web — Proxied (nube NARANJA).** Son los que hacen que el usuario llegue a
Cloudflare. Vistos desde fuera, el apex resuelve a IPs de Cloudflare
(`104.21.66.216`, `172.67.164.174`); el origen real queda oculto detrás:

| Tipo | Nombre | Valor (origen) |
|------|--------|----------------|
| A ×4 | `@` | `185.199.108.153`, `.109`, `.110`, `.111` (GitHub Pages) |
| AAAA ×4 | `@` | `2606:50c0:8000::153` … `:8003::153` (GitHub Pages) |
| CNAME | `www` | `isaacsaltiel.github.io` |

**Correo/servicios (Microsoft 365) — DNS only (nube GRIS). NUNCA proxear:**
si alguno se pone naranja, se rompe el correo/Teams/enrollment.

| Tipo | Nombre | Valor |
|------|--------|-------|
| MX | `@` | `puntazoclips-com.mail.protection.outlook.com` (prio 0) |
| TXT | `@` | `v=spf1 include:spf.protection.outlook.com -all` |
| TXT | `_dmarc` | `v=DMARC1; p=reject; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` |
| CNAME | `autodiscover` | `autodiscover.outlook.com` |
| CNAME | `enterpriseenrollment` | `enterpriseenrollment-s.manage.microsoft.com` (Intune) |
| CNAME | `enterpriseregistration` | `enterpriseregistration.windows.net` (Intune) |
| SRV | `_sip._tls` | `sipdir.online.lync.com:443` (Teams/Skype) |
| SRV | `_sipfederationtls._tcp` | `sipfed.online.lync.com:5061` (Teams/Skype) |

> No hay DKIM (`selector1/2._domainkey`) — no está configurado en M365. El
> correo funciona por MX sin firma DKIM. Si algún día se habilita DKIM en el
> admin center, hay que agregar esos 2 CNAME (gris).

### Configuración de Cloudflare

- **SSL/TLS → Full** ⚠️ (NO Flexible: con GitHub Pages hace **bucle infinito**
  de redirección. NO Strict tampoco, por ahora — ver §6).
- **Always Use HTTPS → on.**
- **HTTP/3 → on.** (Brotli lo activa Cloudflare solo, no hay toggle.)
- **GitHub Pages:** "Enforce HTTPS" queda **on** — convive con Full sin bucle
  (Cloudflare habla HTTPS al origen). El archivo `CNAME` del repo = `puntazoclips.com`.

---

## 4. Fixes de código (capas #1 y #2) — commit `6f1c77a855`

Independientes de Cloudflare, ya en producción:

- **SDK de Firebase auto-hospedado** en `/assets/lib/firebase-9.23.0/`
  (SHA256 idéntico al de gstatic). Reemplazado en los HTML y en `header.js`
  (que lo cargaba dinámico en todas las páginas).
- **Montserrat auto-hospedado**: `/assets/fonts.css` + `/assets/lib/fonts/*.woff2`.
- **`experimentalAutoDetectLongPolling`** en `assets/firebase-core.js` (fallback
  de WebChannel → long-polling cuando la red lo rompe).
- **Guard de arranque** inline en el `<head>` de las páginas: a los 12 s sin
  botar, muestra un aviso con botón "Reintentar" en vez de pantalla blanca.
- **`sw.js`** cachea `/assets/lib/**` (cache-first). HTML y JSON NO se cachean
  a propósito (la ruta de `/assets/lib/` lleva la versión, así que no queda viejo).
- **`.nojekyll`**.

---

## 5. Runbook: si vuelve a fallar la conexión

1. **¿El sitio está arriba por Cloudflare?**
   `curl -sS -o /dev/null -w "%{http_code} %header{server}\n" https://puntazoclips.com/`
   Debe dar `200 cloudflare`. Si da error 5xx con `server: cloudflare`, es
   problema de **origen** (GitHub Pages caído o SSL) — revisar GitHub Pages.

2. **¿El proxy sigue activo?** El apex debe resolver a IPs de Cloudflare:
   `nslookup -type=A puntazoclips.com 1.1.1.1` → `104.x`/`172.x`.
   Si devuelve `185.199.x` (GitHub), **el registro se puso en gris** — volver a
   ponerlo NARANJA en Cloudflare → DNS. (Efecto en ~1-2 min, TTL bajo.)

3. **Reporte desde una red móvil concreta:** pedir que abran, sin VPN,
   `discord.com` (Cloudflare) y `octocat.github.io` (Fastly/GitHub). Si discord
   va y octocat no, es ruteo del operador a Fastly — pero el sitio ya está en
   Cloudflare, así que debería ir. Si **discord tampoco** va, es un problema más
   amplio de esa red (no del sitio).

4. **Un cambio del sitio no se refleja:** Cloudflare → **Caching → Purge
   Everything**. (Por default Cloudflare no cachea HTML, pero por si acaso.)

5. **Verificar que el correo sigue sano:**
   `nslookup -type=MX puntazoclips.com 1.1.1.1` → debe seguir apuntando a
   `...mail.protection.outlook.com`. Si diera IPs de Cloudflare, algún registro
   de correo se proxeó por error → ponerlo GRIS.

---

## 6. Cosas a vigilar / deuda

- **Cert de GitHub Pages detrás del proxy (~cada 90 días):** con el proxy activo,
  la validación ACME de GitHub puede fallar. **Cubierto por ahora:** como
  Cloudflare está en **Full** (no Strict), aunque el cert del origen expire,
  Cloudflare lo sigue aceptando y el sitio no se cae. Si se quisiera subir a
  **Full (Strict)** en el futuro, primero asegurar que GitHub pueda renovar
  (regla que haga bypass de `/.well-known/acme-challenge/*`).
- **`www`** sigue con CNAME a `isaacsaltiel.github.io` (proxied). Los links y QR
  usan el apex `puntazoclips.com`, no `www`.

---

## 7. Comandos de verificación (reutilizables)

```bash
# Delegación (debe ser ligia/pranab.ns.cloudflare.com)
nslookup -type=NS puntazoclips.com 1.1.1.1

# Proxy activo (apex debe dar 104.x/172.x de Cloudflare, no 185.199.x)
nslookup -type=A puntazoclips.com 1.1.1.1

# Sitio arriba por Cloudflare, sin bucle, TLS ok
curl -sS -o /dev/null -w "HTTP %{http_code} server=%header{server} redirects=%{num_redirects} TLS=%{ssl_verify_result}\n" -L https://puntazoclips.com/

# Correo intacto (MX a Outlook)
nslookup -type=MX  puntazoclips.com 1.1.1.1
nslookup -type=TXT puntazoclips.com 1.1.1.1   # SPF

# Conectividad directa por una IP concreta (sin depender del navegador)
curl -sS -o /dev/null -w "%{http_code}\n" --resolve "puntazoclips.com:443:[IP]" https://puntazoclips.com/
```

**Nota de diagnóstico:** mientras la zona estaba *pending* (nameservers aún no
cambiados), los NS de Cloudflare devolvían las IPs de GitHub para el apex aunque
el registro ya estuviera proxied. La verificación de que el proxy está activo
**solo es concluyente después de activar** (cambiar los nameservers).
