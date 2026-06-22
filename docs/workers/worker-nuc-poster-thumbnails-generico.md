# Brief genérico NUC — Miniaturas (poster_url) para previews de video

**Mismo prompt para las 3 NUCs (BreakPoint / WellStreet / Interpadel).**

> ⚠️ **Corrección de arquitectura (importante).** El JSON por lado (`videos[]`) NO lo
> escribe la NUC: lo arma el **indexador CI** (`gestion_indice_ci.py`) en el repo web,
> listando Dropbox. La URL de cada archivo es un **share-link de Dropbox con token por
> archivo**, así que NO se puede derivar la URL del `.jpg` cambiando la extensión.
>
> **Por eso el reparto es:**
> - **NUC (esto):** generar `CLIP.jpg` y subirlo **junto a `CLIP.mp4`**, misma carpeta de
>   Dropbox, mismo nombre base. **Nada más.** No tocas JSON ni Firestore ni creas links.
> - **Repo web (YA HECHO):** el indexador detecta la `.jpg` hermana, le genera su propio
>   link público y emite `poster_url`; la web lo usa como `poster=`. Ya está desplegado
>   (web) e implementado (indexador). En cuanto suba la jpg, aparece solo.

---

## Contexto / por qué

Hoy la "imagen preview" de cada clip NO es una imagen: el navegador baja el primer
frame del `.mp4` desde Dropbox y lo decodifica. En redes lentas, ahorro de datos o modo
bajo consumo (iOS Low Power / Chrome Lite / navegador in-app), se queda en **rectángulo
negro**. Un usuario del club ya lo reportó. La miniatura JPEG (~20–40 KB) se ve al
instante en cualquier dispositivo, sin bajar el video.

## Convención (NO negociable)

**Sibling .jpg, mismo nombre, misma carpeta de Dropbox.**
Para el clip `…/Locaciones/{loc}/{can}/{lado}/CLIP.mp4`, sube
`…/Locaciones/{loc}/{can}/{lado}/CLIP.jpg`. El indexador lo empareja por nombre base
(`CLIP.mp4` ↔ `CLIP.jpg`) y emite `poster_url`. Si no hay jpg hermana, el clip queda sin
`poster_url` y la web cae al método actual (no se rompe nada).

## Pasos (NUC)

1. **Descubre tu pipeline** y repórtame antes de editar: dónde produces el `.mp4` final
   y **dónde/cómo lo subes a Dropbox** (función/SDK, carpeta destino). El `.jpg` se sube
   con ESE mismo mecanismo y a ESA misma carpeta.

2. **Genera la miniatura** justo antes de subir el clip (ya tienes el `.mp4` local):
   ```bash
   ffmpeg -y -ss 00:00:00.5 -i "CLIP.mp4" -frames:v 1 \
     -vf "scale=640:-2:flags=bicubic" -q:v 6 "CLIP.jpg"
   ```
   - `-ss 0.5`: portada estable (ajusta si quieres un frame de la acción).
   - `scale=640:-2`: ~640 px ancho, alto par automático.
   - `-q:v 6`: JPEG ≈ 20–40 KB. JPEG por compatibilidad universal (incluye iOS viejo).

3. **Sube `CLIP.jpg`** a la **misma carpeta** de Dropbox que `CLIP.mp4`, con el mismo
   nombre base. Idealmente **antes o junto** con el `.mp4` (y antes de disparar el
   indexador, si lo disparas tú). Si el `.mp4` se sube primero y la jpg llega después, el
   siguiente barrido del indexador (cada 8 h) la recoge igual.

4. **Idempotencia:** si la `CLIP.jpg` ya existe en Dropbox, no la regeneres/re-subas.

5. **Backfill (opcional).** Los clips rotan rápido (recientes = 24 h; vitrina = 14 días),
   así que en ≤1 día casi todo tendrá poster solo. Si quieres acelerar la vitrina vieja:
   para cada `.mp4` en Dropbox sin `.jpg` hermana dentro de los últimos 14 días, bájalo,
   saca el frame, sube la `.jpg` y borra el `.mp4` temporal. En lotes, con log de
   progreso, idempotente.

## Verificación (antes de cerrar)

- En Dropbox, la carpeta del lado tiene `CLIP.jpg` junto a cada `CLIP.mp4` reciente.
- Dispara el indexador (o espera el barrido) y confirma que el `videos_recientes.json`
  servido trae `poster_url` no vacío en esos clips. *(Puedo verificarlo yo del lado web.)*
- Peso del JPEG ~10–60 KB (si pesa cientos de KB, revisa `scale`/`-q:v`).

## Reglas

- **No imprimas secretos** (tokens/PAT/credenciales Dropbox): solo longitud + prefijo.
- Cambios **aditivos**: no toques el `.mp4` ni el flujo de subida existente; solo agregas
  la `.jpg` hermana. Si ffmpeg falla en un clip, súbelo sin jpg (la web cae al método
  actual) — nunca subas una jpg corrupta/vacía.

## Reporte final

- Función/módulo de subida a Dropbox tocado + carpeta destino confirmada.
- Comando ffmpeg final + peso típico del JPEG.
- # de clips nuevos con `.jpg` hermana subida (y backfill si lo hiciste) por lado.
- Confirmación de que la `.jpg` quedó en la MISMA carpeta que el `.mp4`.
