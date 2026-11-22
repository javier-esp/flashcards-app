# FlashStudy

App web de estudio con flashcards. Sin base de datos externa y **sin dependencias**: solo Node.js 18+.

## Ejecutar

```bash
cd flashcards-app
node server.js        # o: npm start
```

Abre http://localhost:3000 (cambia el puerto con `PORT=4000 node server.js`).

## Estructura

```text
flashcards-app/
├── server.js                 # API REST + archivos estáticos + persistencia JSON
├── package.json
├── data/
│   ├── flashcards.json       # id, sessionId, question, answer
│   ├── study_sessions.json   # id, name, description, createdAt
│   ├── review_sessions.json  # id, runId, sessionId, type (study|review), date, durationSec, results...
│   └── failed_questions.json # flashcardId, errorCount, reviewSessionIds, history, resolved
└── public/
    ├── index.html
    ├── style.css
    └── app.js                # vistas, cronómetro, estudio y repasos
```

Datos de demostración: 2 sesiones y 10 flashcards. Para empezar de cero, deja los cuatro archivos como `[]`.

## Cómo cumple las reglas

- **Cronómetro**: guarda `startedAt` y muestra `Date.now() - startedAt`; no usa un contador incremental.
- **Refresco de página**: la sesión en curso (índice, resultados, hora de inicio) se guarda en `localStorage` y se retoma desde el Dashboard o `#/study`.
- **Una pregunta, un resultado por sesión**: se valida en el cliente y en el servidor, y cada sesión tiene un `runId` único, así que reenviarla no la duplica.
- **Errores históricos**: `errorCount` nunca baja; al acertar en un repaso se marca `resolved: true` y se agrega una entrada a `history`.
- **Repasos vs. estudio**: `type` es `study` o `review`.
- **Integridad**: UUID en todas las entidades, validación de campos, preguntas duplicadas rechazadas, escrituras en cola con archivo temporal y `rename` atómico, y JSON corrupto respaldado como `*.corrupt-<fecha>` y recreado vacío.
- Al borrar una sesión o flashcard se borran sus fallidas asociadas; el historial de repasos se conserva.

## API

`GET /api/all` · `POST /api/sessions` · `DELETE /api/sessions/:id` · `POST /api/cards` · `PUT|DELETE /api/cards/:id` · `POST /api/reviews`
