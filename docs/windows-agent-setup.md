# Agente Windows de PrintDesk

El agente recibe eventos `print-job.ready` mediante una suscripción pull de
Pub/Sub, obtiene un ID token Google para los endpoints privados del dispositivo
y entrega el ESC/POS por TCP. No necesita driver de impresora.

## Recursos en Google Cloud Console

Todos los recursos pertenecen al proyecto `printdesk-503214`.

1. En **Pub/Sub > Topics**, crea `print-job-ready` sin suscripción
   predeterminada, esquema, retención ni transformaciones.
2. Dentro del topic, crea una suscripción pull llamada
   `home-print-agent`:
   - Delivery type: `Pull`.
   - Message retention: `7 days`.
   - Expiration: `Never expires`.
   - Acknowledgement deadline: `60 seconds`.
   - Retry policy: `Retry after exponential backoff`, mínimo `10` y máximo
     `600` segundos.
   - Sin filtro, exactly-once ni ordering. Firestore hace idempotente el claim.
3. En **IAM & Admin > Service Accounts**, crea `printdesk-agent`.
4. En **IAM**, concede a `printdesk-agent` el rol
   **Pub/Sub Subscriber**. El API no le concede acceso a Firestore ni Storage.
5. En el topic `print-job-ready`, concede **Pub/Sub Publisher** a la cuenta de
   servicio usada por `printdesk-render`.
6. Edita `printdesk-render` y añade:

   ```text
   PRINTDESK_PRINT_JOB_READY_TOPIC=print-job-ready
   ```

7. Edita `printdesk-api` y añade:

   ```text
   PRINTDESK_AGENT_SERVICE_ACCOUNT=printdesk-agent@printdesk-503214.iam.gserviceaccount.com
   PRINTDESK_DEVICE_TOKEN_AUDIENCE=https://printdesk-api-128063282321.europe-southwest1.run.app
   ```

Cada cambio de variables crea una revisión; selecciona las imágenes ya
construidas por el commit que incorpora el agente.

## Credencial local

Para el MVP, crea desde la pestaña **Keys** de `printdesk-agent` una clave JSON.
No la copies al repositorio, OneDrive ni GitHub. Guárdala en:

```text
C:\ProgramData\PrintDesk\credentials.json
```

Restringe el archivo al usuario de Windows que ejecutará el agente. La clave se
eliminará cuando se sustituya por una identidad federada adecuada.

## Ejecución local

Desde la raíz del repositorio:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\ProgramData\PrintDesk\credentials.json"
$env:GOOGLE_CLOUD_PROJECT = "printdesk-503214"
$env:PRINTDESK_AGENT_SUBSCRIPTION = "home-print-agent"
$env:PRINTDESK_API_BASE_URL = "https://printdesk-api-128063282321.europe-southwest1.run.app"
$env:PRINTDESK_DEVICE_TOKEN_AUDIENCE = "https://printdesk-api-128063282321.europe-southwest1.run.app"
$env:PRINTDESK_PRINTER_ID = "home"
$env:PRINTDESK_PRINTER_HOST = "192.168.1.153"
$env:PRINTDESK_PRINTER_PORT = "9100"
$env:PRINTDESK_SPOOL_DIRECTORY = "C:\ProgramData\PrintDesk\spool"
pnpm --filter @printdesk/windows-print-agent agent
```

El proceso imprime un registro JSON al completar cada trabajo. Conserva una
copia local del ESC/POS para diagnóstico, pero nunca vuelve a enviar
automáticamente un trabajo cuyo resultado físico sea incierto.
