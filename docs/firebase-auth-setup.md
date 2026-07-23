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
   authorized-users
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

- `GET /health` responde 200 sin token y solo expone estado básico.
- `POST /v1/requests` sin token responde 401.
- Un usuario de Firebase que no esté en `authorized-users` recibe 401.
- Un usuario habilitado puede crear el ticket y Pub/Sub entrega el evento al
  renderer privado.

## 6. Desplegar `printdesk-web` en Cloud Run

Cloud Build publica la imagen `printdesk-web` en Artifact Registry. Next.js
incorpora la configuración pública `NEXT_PUBLIC_*` al bundle durante el build.

1. Antes del primer build, abre **Cloud Build > Triggers**, edita el trigger de
   `main` y añade estas sustituciones con los valores de **Firebase Console >
   Project settings > General > Your apps > PrintDesk Web**:

   ```text
   _WEB_API_BASE_URL=https://printdesk-api-128063282321.europe-southwest1.run.app
   _WEB_FIREBASE_API_KEY=<apiKey>
   _WEB_FIREBASE_AUTH_DOMAIN=<authDomain>
   _WEB_FIREBASE_PROJECT_ID=printdesk-503214
   _WEB_FIREBASE_APP_ID=<appId>
   ```

2. En **IAM y administración > Cuentas de servicio**, crea `printdesk-web` sin
   roles y sin claves.
3. Cuando Cloud Build termine, abre **Cloud Run > Deploy container**.
4. Selecciona la imagen:

   ```text
   europe-southwest1-docker.pkg.dev/printdesk-503214/printdesk/printdesk-web:<COMMIT>
   ```

5. Service name: `printdesk-web`; region: `europe-southwest1`.
6. Authentication: **Allow public access**; ingress: **All**.
7. En **Security**, selecciona:

   ```text
   printdesk-web@printdesk-503214.iam.gserviceaccount.com
   ```

8. Puerto `8080`, memoria `512 MiB`, timeout `60 s`, mínimo `0`, máximo `3`.
   No necesita variables de entorno ni acceso directo a servicios de GCP.
9. Despliega y copia el hostname de la URL, sin `https://` ni `/`.
10. En **Firebase Console > Authentication > Settings > Authorized domains**,
    añade ese hostname.
11. Abre la PWA desplegada, inicia sesión y crea un ticket de prueba.
