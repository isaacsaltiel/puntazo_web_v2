# Brief NUC — Margen configurable en recuperación puntual (`source="recovery"`)

**Para:** las NUCs de **BreakPoint**, **Interpadel** (y Scorpion si sigue activa).
**NO aplica a WellStreet** — ahí el flujo de recuperación es el de partido completo
(`match_full_recovery`, ver `worker-nuc-match-full-recovery-wellstreet.md`).

## Qué cambió en la web (ya desplegado)

`/recuperar.html` dejó de pedir la hora con un `datetime-local` suelto. Ahora usa
día + hora + **margen ±N minutos**, con N elegido por el usuario:

- **Default: ±1 min** (2 min totales)
- **Máximo: ±3 min** (6 min totales)

La web ya muestra al usuario el rango resultante ("Buscaremos de 8:39 PM a 8:41 PM").

## El problema a resolver

Hoy tu NUC toma `event_at` y aplica una ventana **fija ±90s** (heredada del flujo
Forms). Eso significa que **el margen que elige el usuario no surte efecto**: pida ±1
o ±3, siempre recibe 3 minutos. La web ya manda la información necesaria — falta que
la leas.

## Campos nuevos en el doc de `pending_pulses` (aditivos, opcionales)

```jsonc
{
  "source": "recovery",
  "event_at":  <Timestamp>,   // sin cambios — el momento del puntazo
  "margin_sec": 60,           // NUEVO — margen en segundos (60 | 120 | 180)
  "start_at":   <Timestamp>,  // NUEVO — event_at − margin_sec (ya calculado)
  "end_at":     <Timestamp>,  // NUEVO — event_at + margin_sec (ya calculado)
  // ...resto igual (club, cancha, lado, client_pulse_id, uid_creator, ...)
}
```

Son **opcionales**: si no vienen (cliente viejo, caché), sigue aplicando tu ±90s
actual. No rompas ese camino.

## Qué implementar

1. Al procesar `source == "recovery"`, si viene `start_at` **y** `end_at`, usa esa
   ventana exacta en vez del ±90s fijo. Si solo viene `margin_sec`, calcula
   `[event_at − margin_sec, event_at + margin_sec]`. Si no viene ninguno, ±90s como
   siempre.
2. **Clampea de forma autoritativa**: la NUC es la verdad. Ignora cualquier
   `margin_sec` mayor a **180 s** (el máximo que ofrece la web) — un cliente
   modificado no debe poder pedir 2 horas de video.
3. Respeta la retención del NVR igual que hoy (si `start_at` cae fuera, clampa al
   borde; si la ventana entera caducó, error con `error_reason`).
4. Todo lo demás **sin cambios**: mismo nombre de archivo, mismos `clip_states`,
   mismo `consumed_at`/`consumed_by`, misma dedup por `client_pulse_id`.

## Fuera de alcance

- No toques `web` / `mqtt_boton` / `match_full`.
- No cambies el formato del nombre del clip (la web lo parsea).

## Verificación

- Pedir una recuperación con margen **±1** → el clip dura ~2 min, no 3.
- Pedir una con margen **±3** → ~6 min.
- Forzar en Firestore un doc `recovery` **sin** `margin_sec`/`start_at`/`end_at` →
  sigue saliendo el clip de ±90s de siempre (no rompiste el camino viejo).
- Forzar `margin_sec: 7200` a mano → la NUC lo clampa a 180 s.

## Reglas

- No imprimir secretos (solo longitud + prefijo si hace falta).
- Cambios aditivos; ante la duda, dedup por `client_pulse_id`.
