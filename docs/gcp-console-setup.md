# Configuración de Google Cloud desde la consola

Esta guía no utiliza `gcloud`, Cloud Shell ni Terraform para crear recursos.
Todas las acciones productivas se realizan desde
[Google Cloud Console](https://console.cloud.google.com/). Los únicos comandos
de CLI de este documento arrancan emuladores locales.

## 1. Proyecto, facturación y APIs

1. Abre **IAM y administración > Gestionar recursos** y pulsa **Crear proyecto**.
2. Usa un ID estable, por ejemplo `printdesk-prod`, y vincula una cuenta de
   facturación desde **Facturación > Mis proyectos**.
3. Abre **APIs y servicios > Biblioteca** y habilita:
   - Cloud Firestore API
   - Cloud Pub/Sub API
   - Cloud Storage API
   - Cloud Run Admin API
   - Artifact Registry API
   - Cloud Build API
   - IAM Service Account Credentials API

No descargues claves JSON. Cloud Run obtiene credenciales automáticamente a
través de la cuenta de servicio asignada al servicio.

## 2. Firestore

1. Abre **Firestore > Bases de datos** y pulsa **Crear base de datos**.
2. Selecciona **Firestore en modo Native/Standard**; no selecciones Datastore.
3. Usa el ID `(default)`.
4. Selecciona `europe-southwest1 (Madrid)`. La ubicación no se puede cambiar
   después de crear la base.
5. Elige reglas restrictivas/denegar por defecto para clientes web y móviles.
6. Activa la protección contra eliminación si la consola la ofrece.

No es necesario crear colecciones a mano. El API creará `commands`, `requests`,
`print_jobs` y `printer_checks` cuando reciba las primeras operaciones válidas. `commands` conserva la clave de
idempotencia y el evento original para que un reintento no duplique el ticket.

## 3. Bucket privado

1. Abre **Cloud Storage > Buckets** y pulsa **Crear**.
2. Elige un nombre globalmente único, por ejemplo
   `printdesk-prod-artifacts-<sufijo>`; guárdalo como `PRINTDESK_STORAGE_BUCKET`.
3. Tipo de ubicación: **Región**; ubicación: `europe-southwest1 (Madrid)`.
4. Clase predeterminada: **Standard**.
5. Control de acceso: **Uniforme**.
6. Activa **Impedir acceso público**.
7. Conserva soft delete durante 7 días inicialmente. Ajustaremos retención y
   reglas de ciclo de vida cuando conozcamos el volumen real.

No añadas `allUsers` ni `allAuthenticatedUsers`. Los objetos se sirven mediante
el API o URLs firmadas de corta duración en un milestone posterior.

## 4. Pub/Sub

### Topic y dead-letter topic

1. Abre **Pub/Sub > Topics** y pulsa **Crear topic**.
2. ID: `request-created`.
3. No crees una suscripción predeterminada.
4. Crea un segundo topic con ID `request-created-dead-letter` y una suscripción
   pull asociada llamada `request-created-dead-letter-inspect`; sin suscripción,
   los mensajes enviados al topic no se conservarían para inspección.
5. Crea un tercer topic con ID `printer-check-requested`, sin suscripción
   predeterminada, esquema, retención ni transformaciones. Este topic nunca
   transporta tickets: solo IDs de comprobaciones TCP.

La suscripción push se crea después de desplegar `printdesk-render`, porque se
necesita su URL HTTPS.

## 5. Cuentas de servicio e IAM

Abre **IAM y administración > Cuentas de servicio** y crea estas cuentas con
**Crear cuenta de servicio**. No generes claves.

### `printdesk-api`

Asigna en el proyecto:

- **Cloud Datastore User** (`roles/datastore.user`)
- **Pub/Sub Publisher** (`roles/pubsub.publisher`)

En el bucket, pestaña **Permisos**, concede solo:

- **Storage Object Viewer** (`roles/storage.objectViewer`)

### `printdesk-render`

Asigna en el proyecto:

- **Cloud Datastore User** (`roles/datastore.user`)

En el bucket concede:

- **Storage Object Creator** (`roles/storage.objectCreator`)

### `printdesk-notion`

Créala sin claves y concede:

- **Cloud Datastore User** (`roles/datastore.user`), para leer solicitudes y
  guardar el estado de la sincronización en Firestore.
- **Secret Manager Secret Accessor** (`roles/secretmanager.secretAccessor`)
  únicamente sobre `printdesk-notion-token`, descrito en el paso 10.

### `printdesk-pubsub-push`

Créala sin roles de proyecto. Después de crear el servicio Cloud Run
`printdesk-render`, abre dicho servicio > **Permisos** y concede a esta cuenta:

- **Cloud Run Invoker** (`roles/run.invoker`)

En **IAM y administración > IAM**, activa **Incluir concesiones de roles
proporcionadas por Google**. Busca el agente
`service-<PROJECT_NUMBER>@gcp-sa-pubsub.iam.gserviceaccount.com` y concédele
**Service Account Token Creator** sobre `printdesk-pubsub-push`. Esto permite
que Pub/Sub emita el token OIDC que Cloud Run validará.

### `printdesk-web`

Créala sin roles de proyecto y sin claves. El frontend no accede directamente
a Firestore, Storage ni Pub/Sub; el navegador invoca `printdesk-api`.

## 6. Artifact Registry y Cloud Build

1. Abre **Artifact Registry > Repositories > Crear repositorio**.
2. Nombre: `printdesk`.
3. Formato: **Docker**; modo: **Standard**.
4. Región: `europe-southwest1`.
5. Cifrado administrado por Google. Mantén el análisis de vulnerabilidades
   desactivado inicialmente si quieres evitar su coste adicional.
6. Configura los cinco triggers segmentados y sus permisos siguiendo
   `docs/cloud-build-pipelines.md`.

Los triggers de API, renderer y web ejecutan pruebas específicas, publican una
imagen etiquetada con el SHA del commit y despliegan automáticamente una nueva
revisión. El agente tiene un trigger de validación independiente.

## 7. Cloud Run: render service

Cuando exista una imagen de `printdesk-render` en Artifact Registry:

1. Abre **Cloud Run > Desplegar contenedor**.
2. Selecciona **Desplegar una revisión desde una imagen existente**.
3. Servicio: `printdesk-render`; región: `europe-southwest1`.
4. Autenticación: **Requerir autenticación**.
5. Ingress: **Todo**; Pub/Sub necesita alcanzar el endpoint HTTPS, que continúa
   protegido por IAM.
6. Cuenta de servicio: `printdesk-render`.
7. Puerto: `8080`; memoria inicial: `512 MiB`; timeout: `60 s`; instancias
   mínimas: `0`; máximas: `3`.
8. Variables:

   ```text
   GOOGLE_CLOUD_PROJECT=<PROJECT_ID>
   PRINTDESK_FIRESTORE_DATABASE=(default)
   PRINTDESK_STORAGE_BUCKET=<BUCKET>
   PRINTDESK_PYTHON=/opt/printdesk-venv/bin/python
   ```

9. Crea el servicio y copia su URL.

## 8. Suscripción push autenticada

1. Abre **Pub/Sub > Suscripciones > Crear suscripción**.
2. ID: `render-request-created`; topic: `request-created`.
3. Tipo de entrega: **Push**.
4. Endpoint: `<URL_RENDER>/events/request-created`.
5. Activa **Autenticación** y selecciona `printdesk-pubsub-push`.
6. Audience: deja la URL base de Cloud Run (`<URL_RENDER>`), sin el path.
7. Ack deadline: `60 segundos`.
8. Política de reintentos: mínimo `10 s`, máximo `600 s`.
9. Dead lettering: topic `request-created-dead-letter`; máximo `5` intentos.
10. Retención: 7 días. Crea la suscripción.
11. Abre la suscripción creada > pestaña **Dead lettering**. Resuelve las dos
    acciones sugeridas por la consola: **Grant publisher role** y
    **Grant subscriber role**. Conceden al agente de servicio de Pub/Sub permiso
    para publicar en el dead-letter topic y confirmar el mensaje original.

No habilites payload unwrapping: `render-service` valida el sobre estándar
`message.data` de Pub/Sub.

## 9. Firebase Auth, allowlist y Cloud Run: API

El código ya verifica el ID token de Firebase y exige
`authorized_users/{uid}.enabled == true`. Activa Google Sign-In, crea el primer
usuario autorizado y despliega `printdesk-api` siguiendo la guía completa
`docs/firebase-auth-setup.md`.

La API usa **Allow public access** en Cloud Run para que los ID tokens de usuarios
finales lleguen al contenedor. Todas las operaciones de usuario siguen protegidas
por Firebase y la allowlist. `printdesk-render` permanece privado mediante IAM.

En la revisión de `printdesk-api`, añade:

```text
PRINTDESK_PRINTER_CHECK_TOPIC=printer-check-requested
```

La cuenta `printdesk-api` debe tener **Pub/Sub Publisher** sobre ese topic. Si ya
le concediste el rol a nivel de proyecto no añadas otra concesión duplicada.

## 10. Notion unilateral

Esta integración es independiente del renderer: un fallo de Notion nunca
bloquea la impresión.

1. En Notion, crea una integración interna con capacidades **Read content** e
   **Insert content**. No necesita leer información de usuarios porque los IDs
   de responsables se configuran de forma explícita.
2. En `Torospace`, conecta la integración tanto a **Tasks Manager** como a la
   fuente relacionada **Project**. La relación `Project` no puede escribirse si
   la integración no tiene acceso a ambas fuentes.
3. Estos son los identificadores actuales de Torospace; no son secretos:

   ```text
   Tasks Manager data source: 11e8fbfd-5551-817d-b66f-000b6db26176
   Proyecto PrintDesk page:    3aa8fbfd-5551-8055-9787-e5ae9dc76364
   Responsable Daniel T:       fffd872b-594c-814b-882e-000283c18ed9
   ```

4. En **Secret Manager > Crear secreto**, crea `printdesk-notion-token` con el
   token de la integración como valor.
5. Abre el secreto, entra en **Permisos** y concede **Secret Manager Secret
   Accessor** a `printdesk-notion`.
6. El worker valida el esquema real antes de escribir. El mapeo es:

   | PrintDesk | Tasks Manager |
   | --- | --- |
   | Título | `Name` |
   | Fecha opcional | `Due Date ` |
   | Estado fijo | `Status = To-Do` |
   | Prioridad fija | `Priority  = Medium Priority` |
   | Proyecto | `Project  = PrintDesk` |
   | Creador | `Responsable` |

   `Complete ` es una fórmula de solo lectura: no se envía a la API y Notion
   calcula automáticamente el 0 % a partir del estado `To-Do`.
7. Crea el trigger segmentado que usa `cloudbuild.notion.yaml`. Sus archivos
   incluidos son:

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

8. Ejecuta el trigger después de que estos cambios estén en `main`. El pipeline
   construye `printdesk-notion`, lo publica en Artifact Registry y crea o
   actualiza automáticamente el servicio privado de Cloud Run
   `printdesk-notion` en `europe-southwest1`, puerto 8080, con la cuenta
   `printdesk-notion`.
9. En la revisión creada, comprueba que el pipeline haya configurado:

   ```text
   GOOGLE_CLOUD_PROJECT=<PROJECT_ID>
   PRINTDESK_FIRESTORE_DATABASE=(default)
   PRINTDESK_NOTION_TOKEN=<secreto printdesk-notion-token:1>
   PRINTDESK_NOTION_DATA_SOURCE_ID=11e8fbfd-5551-817d-b66f-000b6db26176
   PRINTDESK_NOTION_PROJECT_PAGE_ID=3aa8fbfd-5551-8055-9787-e5ae9dc76364
   PRINTDESK_NOTION_DEFAULT_RESPONSIBLE_USER_ID=fffd872b-594c-814b-882e-000283c18ed9
   ```

   Solo `PRINTDESK_NOTION_TOKEN` usa **Reference a secret**, fijada en la
   versión `1`. Los IDs restantes son variables normales. No hace falta crear
   manualmente un contenedor o una revisión inicial.

   Si se autorizan más usuarios, añade opcionalmente un mapa por UID de
   Firebase o correo. El valor debe ser JSON en una sola línea:

   ```text
   PRINTDESK_NOTION_RESPONSIBLE_USER_MAP={"<firebase-uid>":"<notion-user-id>","persona@example.com":"<notion-user-id>"}
   ```

   El mapa tiene prioridad sobre el responsable predeterminado.
10. En **Permisos** del servicio concede **Cloud Run Invoker** a
   `printdesk-pubsub-push`.
11. Crea una segunda suscripción push sobre el topic `request-created`:
   - ID: `notion-request-created`.
   - Endpoint: `<URL_NOTION>/events/request-created`.
   - Autenticación: `printdesk-pubsub-push`.
   - Audience: `<URL_NOTION>`.
   - Ack deadline: 60 segundos.
   - Reintentos: 10–600 segundos.
   - Dead-letter topic: `request-created-dead-letter`, máximo 5 intentos.
12. Tras la primera solicitud, Firestore creará `notion_syncs/{requestId}`.
    Cuando el estado sea `ready`, `/r/<shortCode>` redirigirá a Notion;
    `/r/<shortCode>?view=live` siempre mostrará la copia viva de PrintDesk. La
    PWA recibe además la URL directa de la tarea y la utiliza en **Ver en
    Notion**.

## Comprobación visual

Desde la consola verifica:

- Firestore contiene `commands`, `requests`, `print_jobs` y, después de la
  primera prueba manual, `printer_checks` y `notion_syncs`.
- Pub/Sub muestra mensajes confirmados y cero mensajes antiguos sin confirmar.
- El bucket contiene `print-jobs/<requestId>/preview.png` y `ticket.escpos`.
- Los logs de `printdesk-render` muestran respuestas HTTP 204.
- Ningún bucket, servicio interno o cuenta tiene claves públicas o miembros
  `allUsers`.

## Referencias oficiales

- [Crear y gestionar Firestore](https://cloud.google.com/firestore/docs/manage-databases)
- [Ubicaciones de Firestore](https://cloud.google.com/firestore/docs/locations)
- [Crear un bucket](https://cloud.google.com/storage/docs/creating-buckets)
- [Acceso uniforme al bucket](https://cloud.google.com/storage/docs/uniform-bucket-level-access)
- [Crear suscripciones push](https://cloud.google.com/pubsub/docs/create-push-subscription)
- [Autenticar suscripciones push](https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions)
- [Crear cuentas de servicio](https://cloud.google.com/iam/docs/service-accounts-create)
- [Desplegar imágenes en Cloud Run](https://cloud.google.com/run/docs/deploying)
- [Triggers de Cloud Build con GitHub](https://cloud.google.com/build/docs/automate-builds)
