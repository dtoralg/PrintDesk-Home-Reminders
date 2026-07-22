# Arquitectura de PrintDesk

## Principios

PrintDesk es Google-first. La PWA y el MCP usan la misma API de Cloud Run;
Firestore conserva el estado autorizado, Vertex AI estructura el modo simple,
Cloud Storage conserva artefactos inmutables y Pub/Sub desacopla los workers y
el agente Windows. Notion recibe una copia unilateral: nunca vuelve a escribir
el snapshot que se imprimió.

```text
PWA Next.js ───────┐
                   ├─> API Cloud Run ─> Firestore
ChatGPT -> MCP ────┘         │              │
                             │              ├─> Pub/Sub -> Notion worker
                             │              └─> Pub/Sub -> render service
                             │                               │
                             └─> /r/{code}                   v
                                                   Cloud Storage
                                                   PNG + ESC/POS
                                                         │
                                                         v
                                               agente Windows mínimo
                                                         │ TCP 9100
                                                         v
                                                    impresora Wi-Fi
```

## Fronteras de seguridad

- La PWA usa Firebase Auth con Google. El API verifica el ID token y la entrada
  `authorized_users/{uid}`; el navegador no decide identidad, timestamps,
  estados ni rutas de Storage.
- Vertex AI solo propone `type`, `title`, `body`, `important` y `dueAt`; la
  salida pasa por el mismo esquema estricto del modo avanzado.
- El bucket es privado y los nombres de objeto derivan de IDs del servidor.
- El agente usa identidad de dispositivo separada. Solo reclama un job,
  descarga bytes ya renderizados, comprueba TCP 9100 y los entrega.
- `/r/{code}` redirigirá únicamente a hosts HTTPS permitidos de Notion.
- Todas las transiciones que cruzan Pub/Sub son idempotentes y auditables.

## Modelo mínimo

`RequestInput` es el snapshot inmutable aceptado del cliente. `StoredRequest`
añade identidad, fuente, fecha y URL corta. `PrintJob` avanza por:

```text
rendering -> queued -> claimed -> checking_printer -> printing -> printed
                      └──────────────────────────────> printed_simulated (solo local)
```

`printed` solo significa que el agente entregó todos los bytes sin error; no
afirma que el papel saliera salvo que una impresora soporte confirmación fiable.

## Adaptadores del milestone 1

El recorrido local usa un store de archivos y llama al renderer como subproceso.
Ambos son adaptadores deliberadamente locales, no equivalentes productivos de
Firestore, Pub/Sub o Cloud Storage. Los endpoints de claim/artefacto se cierran
fuera de `PRINTDESK_ALLOW_DEV_AUTH=true` hasta incorporar identidad de dispositivo.
La autenticación también falla cerrada fuera del modo local.

## Integraciones posteriores

- El worker de Notion crea una página una sola vez y completa el redirect; no
  escucha ediciones de Notion.
- El MCP remoto aplica OAuth y scopes mínimos sobre las mismas operaciones.
- GitHub es la fuente; Cloud Build ejecuta tests, crea imágenes en Artifact
  Registry y despliega servicios de Cloud Run desde `main`.
- Secret Manager contiene credenciales. No se admiten claves JSON en GitHub.
