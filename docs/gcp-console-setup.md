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

No es necesario crear colecciones a mano. El API creará `commands`, `requests`
y `print_jobs` en su primera solicitud válida. `commands` conserva la clave de
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

### `printdesk-pubsub-push`

Créala sin roles de proyecto. Después de crear el servicio Cloud Run
`printdesk-render`, abre dicho servicio > **Permisos** y concede a esta cuenta:

- **Cloud Run Invoker** (`roles/run.invoker`)

En **IAM y administración > IAM**, activa **Incluir concesiones de roles
proporcionadas por Google**. Busca el agente
`service-<PROJECT_NUMBER>@gcp-sa-pubsub.iam.gserviceaccount.com` y concédele
**Service Account Token Creator** sobre `printdesk-pubsub-push`. Esto permite
que Pub/Sub emita el token OIDC que Cloud Run validará.

## 6. Artifact Registry y Cloud Build

1. Abre **Artifact Registry > Repositories > Crear repositorio**.
2. Nombre: `printdesk`.
3. Formato: **Docker**; modo: **Standard**.
4. Región: `europe-southwest1`.
5. Cifrado administrado por Google. Mantén el análisis de vulnerabilidades
   desactivado inicialmente si quieres evitar su coste adicional.
6. Abre **Cloud Build > Triggers > Crear trigger**.
7. Conecta GitHub mediante la aplicación oficial de Cloud Build y selecciona
   este repositorio.
8. Evento: push a rama; expresión `^main$`.
9. Configuración: archivo de configuración de Cloud Build del repositorio;
   ruta `cloudbuild.yaml`.
10. Sustituciones: `_REGION=europe-southwest1` y `_AR_REPOSITORY=printdesk`.

El trigger ejecuta la matriz de pruebas y publica `printdesk-api` y
`printdesk-render` en Artifact Registry con las etiquetas del commit y `latest`.
Despliega ahora únicamente `printdesk-render`; el API todavía falla cerrado
intencionadamente hasta completar Firebase Auth.

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

## 9. Cloud Run: API

No despliegues `printdesk-api` públicamente hasta completar Firebase Auth y la
allowlist. El código de producción rechaza deliberadamente todas las solicitudes
sin identidad verificada. Cuando implementemos ese milestone, se creará desde
la consola con la cuenta `printdesk-api` y estas variables:

```text
NODE_ENV=production
PRINTDESK_BACKEND=gcp
GOOGLE_CLOUD_PROJECT=<PROJECT_ID>
PRINTDESK_FIRESTORE_DATABASE=(default)
PRINTDESK_STORAGE_BUCKET=<BUCKET>
PRINTDESK_REQUEST_CREATED_TOPIC=request-created
PRINTDESK_PUBLIC_BASE_URL=<URL_API>
```

## Comprobación visual

Desde la consola verifica:

- Firestore contiene `commands`, `requests` y `print_jobs`.
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
