# Firebase Auth y allowlist desde la consola

Esta configuración se realiza únicamente desde Firebase Console y Google Cloud
Console. No utiliza Firebase CLI ni `gcloud`.

## 1. Activar Google Sign-In

1. Abre [Firebase Console](https://console.firebase.google.com/) y selecciona el
   proyecto de PrintDesk.
2. Ve a **Build > Authentication** y pulsa **Get started**.
3. En **Sign-in method**, abre **Google** y actívalo.
4. Elige tu correo como **Project support email** y guarda.
5. En **Settings > Authorized domains**, añade `localhost` si no aparece. El
   dominio definitivo de la PWA se añadirá cuando la despleguemos.

No habilites email/password, registro anónimo ni otros proveedores.

## 2. Configuración web local

En **Project settings > General > Your apps > PrintDesk Web**, copia el objeto de
configuración. Crea localmente `apps/web/.env.local` con estos valores:

```text
NEXT_PUBLIC_API_BASE_URL=<URL_DE_PRINTDESK_API>
NEXT_PUBLIC_FIREBASE_API_KEY=<apiKey>
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<authDomain>
NEXT_PUBLIC_FIREBASE_PROJECT_ID=printdesk-503214
NEXT_PUBLIC_FIREBASE_APP_ID=<appId>
```

La configuración web de Firebase identifica el proyecto y no es una credencial
privada. No descargues claves JSON ni credenciales de cuentas de servicio.

## 3. Crear el primer usuario autorizado

1. Inicia la PWA local y pulsa **Entrar con Google**. El primer acceso crea el
   usuario en Firebase Authentication, aunque la API todavía responda 401.
2. En **Authentication > Users**, copia su **User UID**.
3. Abre **Firestore Database > Data** y crea la colección:

   ```text
   authorized_users
   ```

4. Usa el UID exacto como **Document ID** y crea estos campos:

   | Field | Type | Value |
   | --- | --- | --- |
   | `enabled` | boolean | `true` |
   | `email` | string | el mismo correo de Google |
   | `displayName` | string | nombre que mostrará PrintDesk |

La PWA no puede leer esta colección porque las reglas de Firestore continúan en
`allow read, write: if false`. La API la consulta con la cuenta de servicio y
compara UID, estado y correo después de verificar criptográficamente el ID token.

Para revocar acceso sin borrar historial, cambia `enabled` a `false` y deshabilita
el usuario en **Authentication > Users** si necesitas cortar también nuevas
sesiones.

## 4. Desplegar `printdesk-api` en Cloud Run

La API debe permitir que las peticiones HTTPS alcancen el contenedor; la
autenticación de usuario se valida dentro de la aplicación mediante Firebase.
Esto es distinto de `printdesk-render`, que permanece privado mediante IAM.

1. Abre **Cloud Run > Deploy container**.
2. Imagen:

   ```text
   europe-southwest1-docker.pkg.dev/printdesk-503214/printdesk/printdesk-api:latest
   ```

3. Service name: `printdesk-api`; region: `europe-southwest1`.
4. Authentication: **Allow public access**; ingress: **All**.
5. En **Security**, selecciona:

   ```text
   printdesk-api@printdesk-503214.iam.gserviceaccount.com
   ```

6. Puerto `8080`, memoria `512 MiB`, timeout `60 s`, mínimo `0`, máximo `3`.
7. Variables:

   ```text
   NODE_ENV=production
   PRINTDESK_BACKEND=gcp
   GOOGLE_CLOUD_PROJECT=printdesk-503214
   PRINTDESK_FIRESTORE_DATABASE=(default)
   PRINTDESK_STORAGE_BUCKET=printdesk-prod-artifacts-1
   PRINTDESK_REQUEST_CREATED_TOPIC=request-created
   PRINTDESK_PUBLIC_BASE_URL=<URL_HTTPS_DE_ESTE_SERVICIO>
   ```

Si todavía no conoces la URL al crear el servicio, despliega primero y después
usa **Edit & deploy new revision** para establecer `PRINTDESK_PUBLIC_BASE_URL`.

## 5. Comprobación

- `GET /healthz` responde 200 sin token y solo expone estado básico.
- `POST /v1/requests` sin token responde 401.
- Un usuario de Firebase que no esté en `authorized_users` recibe 401.
- Un usuario habilitado puede crear el ticket y Pub/Sub entrega el evento al
  renderer privado.

