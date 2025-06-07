# Puntazo Web v2

Este repositorio contiene el frontend estático del proyecto **Puntazo**, una solución que permite grabar y ver repeticiones de partidos en canchas de pádel mediante Raspberry Pi y Dropbox.

## Estructura del sitio

- `index.html`, `locacion.html`, `cancha.html`, `lado.html`: Páginas del sitio.
- `assets/`: Contiene CSS y JS.
- `data/config_locations.json`: Configuración central de todas las locaciones, canchas y lados.
- `agregar_lado.py`: Script para agregar nuevos lados al sistema fácilmente.

## ¿Cómo agregar un nuevo lado (cámara)?

1. Abre una terminal y corre:

```bash
python agregar_lado.py
¡Excelente! Vamos ahora con el último paso de esta fase:

---

## ✅ PASO 3.4 — Crear `README.md` con instrucciones claras

Esto te servirá para ti o cualquier colaborador que quiera entender y usar el sistema.

---

### 📄 Contenido sugerido para `README.md`

Guárdalo en la raíz de tu repositorio `puntazo_web_v2/`:

````markdown
# Puntazo Web v2

Este repositorio contiene el frontend estático del proyecto **Puntazo**, una solución que permite grabar y ver repeticiones de partidos en canchas de pádel mediante Raspberry Pi y Dropbox.

## Estructura del sitio

- `index.html`, `locacion.html`, `cancha.html`, `lado.html`: Páginas del sitio.
- `assets/`: Contiene CSS y JS.
- `data/config_locations.json`: Configuración central de todas las locaciones, canchas y lados.
- `agregar_lado.py`: Script para agregar nuevos lados al sistema fácilmente.

## ¿Cómo agregar un nuevo lado (cámara)?

1. Abre una terminal y corre:

```bash
python agregar_lado.py
````

2. Ingresa los siguientes datos cuando se te pidan:

   * ID y nombre del club
   * ID y nombre de la cancha
   * ID y nombre del lado

3. El script actualizará `data/config_locations.json` automáticamente.

4. Haz commit y push del cambio a GitHub:

```bash
git add data/config_locations.json
git commit -m "Agregado nuevo lado: ClubX/CanchaY/LadoZ"
git push
```

## Hosting

Este sitio puede ser desplegado directamente en GitHub Pages.

---

## Videos y JSON

Cada Raspberry sube sus videos a Dropbox. Desde el frontend, los videos se cargan leyendo el archivo `videos_recientes.json` generado por la Pi y almacenado en su carpeta correspondiente en Dropbox.

---

```

---

Cuando hayas creado ese archivo y lo hayas guardado, ¡ya tendremos completa la fase de organización!

¿Te gustaría que ahora hagamos pruebas (como correr `agregar_lado.py`) o pasamos a otra fase como automatizar Dropbox o hacer QR dinámicos?
```

