# Plan de implementación

## Milestone 1 — recorrido vertical local (implementado)

- PWA App Router monocroma, responsive e instalable.
- Contrato estricto compartido para los cuatro tipos de ticket.
- API HTTP con autenticación local explícita y fallo cerrado por defecto.
- Store local sustituible, renderer Pillow 576 px/1-bit, QR y ESC/POS.
- Agente dry-run que reclama, descarga, persiste y completa un job.
- Pruebas de contratos, renderer y recorrido E2E real.

Criterio: `pnpm test:e2e` termina el trabajo en `printed_simulated` y conserva
una copia no vacía del ESC/POS descargado.

## Milestone 2 — persistencia y eventos Google Cloud (implementado)

- Interfaces de repositorio y bus con adaptadores Firestore/Pub/Sub.
- Cloud Storage privado y URLs firmadas breves.
- Render service idempotente y estados con precondiciones/transacciones.
- Emuladores y test de reentrega del evento.

El API escribe request, job y comando idempotente en una transacción. Pub/Sub
entrega un evento a `render-service`, que usa un lease recuperable, publica
artefactos inmutables y tolera reentregas. La configuración productiva se hace
desde la consola siguiendo `docs/gcp-console-setup.md`.

## Milestone 3 — identidad y experiencia

- Firebase Auth con Google y allowlist `authorized-users/{uid}` (implementado).
- Sesión PWA y seguimiento autenticado del job (implementado).
- Historial, página viva y detalle de solicitudes (implementado).
- Comprobación TCP bajo demanda y último resultado persistente (implementado).

## Milestone 4 — impresora y agente

- Suscripción StreamingPull, evento `print-job.ready`, identidad Google del
  dispositivo, lease idempotente y cola persistente (implementado).
- Transporte TCP 9100 con timeout y reintentos seguros antes del envío (implementado).
- Impresora virtual, captura byte a byte y validador ESC/POS (implementado).
- Prueba física de TCP 9100, avance y corte en PcCom Essential
  `PCCES-TIP-U1W1B0L0-B` (implementado).

## Milestone 5 — Vertex AI y Notion

- Interpretación estructurada y editable del modo simple.
- Evaluaciones de fechas relativas y fallback al modo avanzado.
- Worker unilateral de Notion y redirect interno seguro.

## Milestone 6 — MCP, infraestructura y entrega

- MCP remoto con OAuth, confirmaciones y auditoría `source: mcp`.
- Terraform para IAM, servicios, datos, secretos y budgets.
- Cloud Build desde GitHub a Artifact Registry y Cloud Run.
- Build versionado del agente Windows; sin autoactualización en el MVP.

## Milestone 7 — Alexa doméstica

- Custom Skill `es-ES` privada y permanentemente en modo Development.
- Adaptador Cloud Run aislado con verificación criptográfica de Alexa.
- Allowlist de aplicación, usuario y dispositivos Echo domésticos.
- Texto libre con `AMAZON.SearchQuery` y estructuración mediante Vertex AI.
- Confirmación verbal configurable e idempotencia basada en `requestId`.
- Creación restringida a `source: alexa` y `printerId: home`.

El diseño completo y sus criterios de aceptación están en
`docs/alexa-integration.md`.
