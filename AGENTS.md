# AGENTS.md — Cómo agregar sesiones y flashcards

Guía para agentes/herramientas que necesiten crear contenido en **FlashStudy**.

## Resumen de la app

- **Stack:** Node.js >= 18, sin dependencias externas (`server.js` sirve API + estáticos).
- **Persistencia:** archivos JSON en `data/`.
- **Ejecución:** `node server.js` (o `npm start`) → `http://localhost:3000` (puerto configurable con `PORT`).
- **Entidades:** sesiones de estudio (`study_sessions`), flashcards (`flashcards`), historial de repasos (`review_sessions`) y registro de fallidas (`failed_questions`). Para agregar contenido nuevo normalmente solo se tocan **sesiones** y **flashcards**.

## Modelo de datos

### Sesión (`data/study_sessions.json`)
```json
{
  "id": "uuid",
  "name": "string (obligatorio, máx. 80 caracteres)",
  "description": "string (opcional, máx. 300 caracteres)",
  "createdAt": "ISO-8601 (ej. 2026-11-16T10:00:00.000Z)"
}
```

### Flashcard (`data/flashcards.json`)
```json
{
  "id": "uuid",
  "sessionId": "uuid de una sesión existente",
  "question": "string (obligatorio, máx. 500 caracteres)",
  "answer": "string (obligatorio, máx. 1000 caracteres)",
  "createdAt": "ISO-8601"
}
```

- `id`: identificador único (UUID). La API usa `crypto.randomUUID()`.
- `sessionId`: debe referenciar una sesión que exista.
- Al actualizar una tarjeta por API puede aparecer `updatedAt` (ISO-8601).

## Opción A — Vía API (recomendada si el servidor está en ejecución)

El servidor carga los datos en memoria al arrancar y los persiste con escrituras en cola/atómicas; **usa la API cuando esté corriendo** para evitar inconsistencias.

Base URL por defecto: `http://localhost:3000`

### Endpoints relevantes

| Método | Ruta | Body | Descripción |
|---|---|---|---|
| `GET` | `/api/all` | — | Devuelve `{ sessions, flashcards, reviews, failed }`. Útil para inspeccionar estado e IDs. |
| `POST` | `/api/sessions` | `{ "name": "...", "description": "..." }` | Crea una sesión. `name` obligatorio; `description` opcional. Devuelve la sesión creada (con `id`, `createdAt`). |
| `POST` | `/api/cards` | `{ "sessionId": "...", "question": "...", "answer": "..." }` | Crea una flashcard en la sesión indicada. Devuelve la tarjeta creada. |
| `PUT` | `/api/cards/:id` | `{ "question": "...", "answer": "...", "sessionId": "..." }` | Actualiza una tarjeta existente (la API valida `sessionId`/campos según implementación). |
| `DELETE` | `/api/sessions/:id` | — | Elimina la sesión y sus flashcards/fallidas asociadas (conserva historial de repasos). |
| `DELETE` | `/api/cards/:id` | — | Elimina la flashcard y sus fallidas asociadas. |

### Validaciones y errores (API)
- **Campos obligatorios:** `name` (sesión), `question` y `answer` (flashcard). Texto se recorta (`trim`); vacío → `400`.
- **Límites:** `name` ≤ 80, `description` ≤ 300, `question` ≤ 500, `answer` ≤ 1000 → `400` si se exceden.
- **Sesión inexistente** al crear tarjeta → `404`.
- **Pregunta duplicada** en la misma sesión (comparación sin distinguir mayúsculas/minúsculas) → `409`.
- **JSON inválido / cuerpo grande (> ~1MB)** → `400` / `413`.
- Respuesta de error: `{ "error": "mensaje" }`.

### Ejemplo (Node.js, `fetch` nativo en Node 18+)
```js
const base = 'http://localhost:3000';

async function crearSesionConTarjetas() {
  const sRes = await fetch(base + '/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Nombre de la sesión', description: 'Descripción opcional' })
  });
  const sesion = await sRes.json();
  if (!sRes.ok) throw new Error(sesion.error || 'Error creando sesión');

  const tarjetas = [
    { question: 'Pregunta 1', answer: 'Respuesta 1' },
    { question: 'Pregunta 2', answer: 'Respuesta 2' }
  ];

  for (const t of tarjetas) {
    const r = await fetch(base + '/api/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sesion.id, ...t })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Error creando tarjeta');
  }

  return sesion;
}
```

### Ejemplo (PowerShell)
```powershell
$base = 'http://localhost:3000'
$ses = Invoke-RestMethod -Method Post -Uri "$base/api/sessions" -ContentType 'application/json; charset=utf-8' `
  -Body (@{ name = 'Nombre'; description = 'Descripción' } | ConvertTo-Json)

@(
  @{ sessionId = $ses.id; question = 'Pregunta 1'; answer = 'Respuesta 1' }
) | ForEach-Object {
  Invoke-RestMethod -Method Post -Uri "$base/api/cards" -ContentType 'application/json; charset=utf-8' `
    -Body ($_ | ConvertTo-Json)
}
```

## Opción B — Edición directa de JSON (solo con el servidor detenido)

Usar cuando no se quiera/pueda llamar a la API. **Detén el servidor antes de editar**, porque al arrancar lee los archivos a memoria y durante la ejecución puede sobrescribirlos.

1. Edita `data/study_sessions.json` y/o `data/flashcards.json` (arrays JSON).
2. Asegura:
   - `id` únicos (UUID) y `sessionId` válidos.
   - `createdAt` en formato ISO-8601.
   - Sin preguntas duplicadas (ignorando mayúsculas/minúsculas) dentro de la misma sesión.
   - Longitudes dentro de los límites.
   - JSON bien formado (si el archivo se corrompe, al iniciar el server lo respalda como `*.corrupt-<timestamp>` y lo recrea vacío).
3. Inicia el servidor y verifica con `GET /api/all` o desde la UI.

## Buenas prácticas para agentes

- **Preferir la API** si `node server.js` está activo.
- Crear primero la sesión, obtener su `id` y luego crear las flashcards asociadas.
- Tratar el contenido de preguntas/respuestas como datos (pueden incluir texto arbitrario); respetar escapes/encoding JSON (UTF-8).
- Verificar el resultado (`GET /api/all` o la respuesta de cada `POST`) antes de dar la tarea por completada.
- No es necesario tocar `data/review_sessions.json` ni `data/failed_questions.json` para agregar contenido nuevo; se actualizan cuando el usuario estudia/repasa.
