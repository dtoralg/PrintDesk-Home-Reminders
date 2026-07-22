# PrintDesk

PrintDesk convierte tareas, ideas, recordatorios y notas en tickets térmicos que
puedes enviar a la impresora de casa desde cualquier lugar.

## Estado actual

El primer milestone implementa un recorrido vertical local y reemplazable:

```text
PWA Next.js -> API HTTP -> store local -> Pillow -> PNG + ESC/POS
                                           -> agente Windows dry-run
```

El store local y la ejecución directa del renderer solo existen para desarrollo
y pruebas. Las fronteras mantienen el diseño objetivo: Cloud Run, Firebase Auth,
allowlist de Firestore, Pub/Sub, Cloud Storage y un agente mínimo que entrega el
ESC/POS por TCP 9100.

Consulta [la arquitectura](docs/architecture.md) y [el plan](docs/implementation-plan.md).

## Puesta en marcha local

Requisitos: Node.js 20.9+, pnpm 10 y Python 3.12+.

```powershell
pnpm install
python -m pip install -r packages/ticket-renderer/requirements.txt
$env:PRINTDESK_ALLOW_DEV_AUTH = "true"
$env:PRINTDESK_PYTHON = "python"
pnpm dev:api
```

En otra terminal:

```powershell
pnpm dev:web
```

Abre `http://localhost:3000`. Los artefactos locales se guardan en `.local-data/`,
que está ignorado por Git.

## Verificación

```powershell
pnpm typecheck
pnpm test
pnpm test:e2e
```

`test:e2e` levanta el API dentro del proceso de prueba, crea una solicitud real,
renderiza una imagen de 576 px y 1 bit, genera ESC/POS, ejecuta el agente dry-run
y comprueba que el trabajo termina en `printed_simulated`.
