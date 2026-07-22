# Pruebas locales con emuladores

Estos son los únicos pasos que usan CLI. No crean ni modifican recursos reales
en Google Cloud.

## Requisitos

- Java 21. La máquina actual tiene Java 8 y debe actualizarse antes de iniciar
  Firestore/Storage Emulator.
- Google Cloud SDK con el componente `pubsub-emulator`.
- Dependencias del repositorio instaladas con `pnpm install`.

En PowerShell puede ser necesario invocar `gcloud.cmd` en lugar de `gcloud`
cuando la política de ejecución bloquee `gcloud.ps1`.

## Terminal 1 — Firestore y Storage

```powershell
pnpm dlx firebase-tools emulators:start --only firestore,storage --project printdesk-local
```

## Terminal 2 — Pub/Sub

La primera vez:

```powershell
gcloud.cmd components install pubsub-emulator
```

Después:

```powershell
gcloud.cmd beta emulators pubsub start --project=printdesk-local --host-port=127.0.0.1:8085
```

## Variables locales

En cada terminal que ejecute PrintDesk:

```powershell
$env:GOOGLE_CLOUD_PROJECT = "printdesk-local"
$env:GCLOUD_PROJECT = "printdesk-local"
$env:PUBSUB_PROJECT_ID = "printdesk-local"
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8081"
$env:FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199"
$env:PUBSUB_EMULATOR_HOST = "127.0.0.1:8085"
$env:PRINTDESK_STORAGE_BUCKET = "printdesk-local.appspot.com"
$env:PRINTDESK_REQUEST_CREATED_TOPIC = "request-created"
$env:PRINTDESK_PYTHON = (Resolve-Path ".\.venv\Scripts\python.exe").Path
$env:PRINTDESK_RUN_EMULATOR_TESTS = "true"
```

`FIREBASE_STORAGE_EMULATOR_HOST` no debe incluir `http://`.

## Crear recursos efímeros y probar

```powershell
pnpm --filter @printdesk/backend emulator:bootstrap
pnpm test:emulators
```

La prueba crea documentos con IDs únicos, publica `request.created`, renderiza,
sube PNG/ESC-POS, comprueba los bytes y entrega el mismo evento otra vez para
verificar la idempotencia. Todo desaparece al detener los emuladores.

Para probar la entrega push real, inicia `pnpm dev:render` con `PORT=8082` antes
de publicar eventos. El bootstrap configura la suscripción local hacia
`http://127.0.0.1:8082/events/request-created`.

Referencias oficiales:

- [Emulador de Firestore](https://cloud.google.com/firestore/docs/emulator)
- [Emulador de Pub/Sub](https://cloud.google.com/pubsub/docs/emulator)
- [Emulador de Storage](https://firebase.google.com/docs/emulator-suite/connect_storage)
