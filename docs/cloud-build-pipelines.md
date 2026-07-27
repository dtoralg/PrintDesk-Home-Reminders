# Pipelines segmentados y despliegue continuo

PrintDesk utiliza seis triggers independientes sobre `main`. Un cambio de
documentación no construye imágenes; un cambio compartido activa únicamente
los componentes que dependen de él.

| Trigger | Configuración | Resultado |
| --- | --- | --- |
| `printdesk-api-main` | `cloudbuild.api.yaml` | Prueba, construye, publica y despliega `printdesk-api` |
| `printdesk-render-main` | `cloudbuild.render.yaml` | Prueba, construye, publica y despliega `printdesk-render` |
| `printdesk-web-main` | `cloudbuild.web.yaml` | Comprueba, construye, publica y despliega `printdesk-web` |
| `printdesk-notion-main` | `cloudbuild.notion.yaml` | Prueba, construye, publica y despliega `printdesk-notion` |
| `printdesk-alexa-main` | `cloudbuild.alexa.yaml` | Prueba, construye, publica y despliega `printdesk-alexa` |
| `printdesk-agent-main` | `cloudbuild.agent.yaml` | Comprueba el agente Windows; no modifica Cloud Run |

Los despliegues usan `$SHORT_SHA`. La etiqueta `latest` se actualiza únicamente
después de que Cloud Run haya aceptado la nueva revisión.

## Permisos de la cuenta de Cloud Build

En **Cloud Build > Settings > Permissions**, selecciona la misma cuenta de
servicio que usan los triggers y habilita:

- **Cloud Run Admin**;
- **Artifact Registry Writer**;
- **Logs Writer**.

Cloud Build necesita además **Service Account User** sobre cada identidad de
ejecución de Cloud Run. Desde **IAM & Admin > Service Accounts**, abre
sucesivamente las cuentas usadas por `printdesk-api`, `printdesk-render`,
`printdesk-web`, `printdesk-notion` y `printdesk-alexa`; en
**Principals with access**, concede a
la cuenta de Cloud Build el rol **Service Account User**.

No cambies las identidades de ejecución de los servicios. Este permiso permite
a Cloud Build conservarlas al crear revisiones, no ejecutar el código con la
cuenta de build.

## Trigger de API

- Evento: push a rama.
- Rama: `^main$`.
- Tipo: archivo de configuración del repositorio.
- Ruta: `cloudbuild.api.yaml`.
- Cuenta: la cuenta de Cloud Build configurada arriba.
- Included files:

  ```text
  apps/api/**
  packages/backend/**
  packages/shared-models/**
  cloudbuild.api.yaml
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  tsconfig.base.json
  .dockerignore
  ```

## Trigger de renderer

- Evento y rama: push a `^main$`.
- Ruta: `cloudbuild.render.yaml`.
- Included files:

  ```text
  apps/render-service/**
  packages/backend/**
  packages/shared-models/**
  packages/ticket-renderer/**
  cloudbuild.render.yaml
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  tsconfig.base.json
  .dockerignore
  ```

## Trigger de web

- Evento y rama: push a `^main$`.
- Ruta: `cloudbuild.web.yaml`.
- Included files:

  ```text
  apps/web/**
  packages/shared-models/**
  cloudbuild.web.yaml
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  tsconfig.base.json
  .dockerignore
  ```

Añade al trigger las sustituciones reales que ya tenía el pipeline monolítico:

```text
_WEB_API_BASE_URL
_WEB_FIREBASE_API_KEY
_WEB_FIREBASE_AUTH_DOMAIN
_WEB_FIREBASE_PROJECT_ID
_WEB_FIREBASE_APP_ID
```

Los valores del archivo para API key y App ID son marcadores y deben seguir
sobrescribiéndose en el trigger.

## Trigger de Notion

- Evento y rama: push a `^main$`.
- Ruta: `cloudbuild.notion.yaml`.
- Included files:

  ```text
  apps/notion-service/**
  packages/backend/**
  packages/shared-models/**
  cloudbuild.notion.yaml
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  tsconfig.base.json
  .dockerignore
  ```

## Trigger del agente

- Evento y rama: push a `^main$`.
- Ruta: `cloudbuild.agent.yaml`.
- Included files:

  ```text
  agents/windows-print-agent/**
  packages/shared-models/**
  cloudbuild.agent.yaml
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  tsconfig.base.json
  ```

## Trigger de Alexa

- Evento y rama: push a `^main$`.
- Ruta: `cloudbuild.alexa.yaml`.
- Included files:

  ```text
  apps/alexa-service/**
  packages/shared-models/**
  cloudbuild.alexa.yaml
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  tsconfig.base.json
  .dockerignore
  ```

El servicio acepta tráfico público porque Alexa no puede obtener identidad de
Google. La aplicación verifica criptográficamente la firma y el timestamp de
Alexa antes de leer el comando. Cloud Build necesita **Service Account User**
sobre la identidad `printdesk-alexa`.

## Migración del trigger existente

1. Sube primero los seis archivos `cloudbuild.*.yaml`; el trigger antiguo
   puede ejecutar todavía `cloudbuild.yaml` durante ese primer merge.
2. Edita el trigger existente y conviértelo en `printdesk-api-main`, cambiando
   la ruta y los filtros según la sección de API.
3. Crea los otros cinco triggers.
4. Comprueba que no queda ningún trigger activo apuntando a `cloudbuild.yaml`;
   de lo contrario reconstruirá los tres servicios en cada push.
5. Ejecuta manualmente cada trigger una vez desde **Run**.
6. En Cloud Run comprueba que la revisión activa termina con una imagen
   etiquetada con el SHA mostrado por la build.

Los parámetros, secretos, IAM, ingress y cuentas de ejecución ya configurados
en Cloud Run se conservan: el pipeline solo cambia la imagen de la revisión.
