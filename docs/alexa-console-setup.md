# Configuración de Alexa para PrintDesk

Esta guía crea una Custom Skill doméstica en `Development`. No usa Account
Linking, no se publica y no abre la API principal. Toda la configuración de
Google Cloud se realiza desde la consola web.

## Resultado

```text
Echo -> POST público y firmado /integrations/alexa
     -> printdesk-alexa valida firma, timestamp y allowlists
     -> OIDC de la cuenta printdesk-alexa
     -> API PrintDesk /v1/integrations/alexa/requests
     -> Vertex -> Firestore -> Pub/Sub -> renderer -> agente -> impresora
```

La API fija `source: alexa` y `printerId: home`. El `requestId` de Alexa se
convierte en la clave de idempotencia.

## 1. Crear la Custom Skill

1. Abre [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask).
2. Pulsa **Create Skill**.
3. Nombre: `PrintDesk`.
4. Primary locale: **Spanish (ES)**.
5. Experience: **Other**.
6. Model: **Custom**.
7. Hosting: **Provision your own**.
8. En **Build > JSON Editor**, sustituye el contenido por
   `apps/alexa-service/skill-package/interactionModels/custom/es-ES.json`.
9. Pulsa **Save Model** y después **Build Skill**.
10. Copia el **Skill ID**, con formato `amzn1.ask.skill...`. Este será
    `ALEXA_APPLICATION_ID`.

No configures Account Linking, permisos personales, distribución ni
certificación.

## 2. Crear la identidad de Cloud Run

En Google Cloud Console:

1. Ve a **IAM & Admin > Service Accounts > Create service account**.
2. Nombre e ID: `printdesk-alexa`.
3. No le concedas Vertex AI, Firestore, Storage ni Pub/Sub. El adaptador solo
   invoca la API.
4. Abre la cuenta recién creada.
5. En **Principals with access > Grant access**, añade como principal la cuenta
   usada por Cloud Build:

   ```text
   printdesk-cloud-build@printdesk-503214.iam.gserviceaccount.com
   ```

6. Rol: **Service Account User**.

Si `printdesk-api` exige autenticación IAM de Cloud Run, selecciona el servicio
en la lista de Cloud Run, abre su panel **Permissions**, añade
`printdesk-alexa@printdesk-503214.iam.gserviceaccount.com` y concede
**Cloud Run Invoker**. Si el servicio permite tráfico no autenticado y protege
las rutas en la aplicación, este rol no es necesario.

## 3. Crear secretos

Ve a **Security > Secret Manager**:

1. Crea `printdesk-alexa-application-id`.
   - Valor: el Skill ID copiado de Amazon.
2. Crea `printdesk-alexa-user-ids`.
   - Para el primer despliegue usa `bootstrap-deny`.
3. En cada secreto, abre **Permissions > Grant access**.
4. Principal:

   ```text
   printdesk-alexa@printdesk-503214.iam.gserviceaccount.com
   ```

5. Rol: **Secret Manager Secret Accessor**.

No guardes estos valores en GitHub ni como sustituciones visibles del trigger.

## 4. Preparar la API

Después de que `printdesk-api-main` haya desplegado el nuevo endpoint:

1. Abre **Cloud Run > printdesk-api > Edit and deploy new revision**.
2. En **Containers > Variables & Secrets**, añade:

   ```text
   PRINTDESK_ALEXA_SERVICE_ACCOUNT=printdesk-alexa@printdesk-503214.iam.gserviceaccount.com
   PRINTDESK_INTEGRATION_TOKEN_AUDIENCE=https://printdesk-api-128063282321.europe-southwest1.run.app
   ```

3. Conserva el resto de variables, secretos, cuenta de servicio y puertos.
4. Despliega la revisión.

La segunda variable debe ser la URL base exacta de `printdesk-api`, sin ruta y
sin barra final.

## 5. Crear el trigger de Alexa

En **Cloud Build > Triggers > Create trigger**:

1. Name: `printdesk-alexa-main`.
2. Event: push to branch.
3. Branch: `^main$`.
4. Configuration: Cloud Build configuration file.
5. Location: repository.
6. File:

   ```text
   cloudbuild.alexa.yaml
   ```

7. Service account: `printdesk-cloud-build`.
8. Included files, uno por línea:

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

Guarda y ejecuta **Run** manualmente la primera vez. El pipeline crea la imagen
`printdesk-alexa`, despliega el servicio con autenticación pública y limita el
escalado a una instancia para que el rate limit doméstico sea coherente.

## 6. Configurar el endpoint de Amazon

Cuando Cloud Run termine:

1. Copia la URL de `printdesk-alexa`.
2. En Alexa Developer Console ve a **Build > Custom > Endpoint**.
3. Tipo: **HTTPS**.
4. Default Region:

   ```text
   https://<URL-DE-PRINTDESK-ALEXA>/integrations/alexa
   ```

5. Certificado: **My development endpoint is a sub-domain of a domain that has
   a wildcard certificate from a certificate authority**.
6. Guarda y vuelve a construir la skill.

Cloud Run ya proporciona HTTPS con un certificado wildcard público válido
emitido por Google Trust Services; no hace falta generar ni subir certificados.

## 7. Obtener y cerrar las allowlists

1. En la pestaña **Test**, activa **Development**.
2. Ejecuta:

   ```text
   dile a print desk que imprima una prueba
   ```

3. La primera llamada será rechazada porque el usuario permitido todavía es
   `bootstrap-deny`, pero el simulador mostrará el JSON enviado.
4. Copia:
   - `context.System.user.userId`;
   - `context.System.device.deviceId`, si aparece.
5. En Secret Manager abre `printdesk-alexa-user-ids` y crea una nueva versión
   cuyo valor sea el `userId`. Para varios usuarios, sepáralos por comas.
6. En el trigger de Cloud Build cambia temporalmente
   `_USER_IDS_SECRET_VERSION` a la versión recién creada, o actualiza la
   sustitución antes de ejecutar de nuevo el trigger.
7. Para bloquear también los Echo, crea el secreto
   `printdesk-alexa-device-ids`, concede **Secret Manager Secret Accessor** a
   `printdesk-alexa` y, en **Cloud Run > printdesk-alexa > Edit and deploy new
   revision > Variables & Secrets**, expón ese secreto como:

   ```text
   ALEXA_ALLOWED_DEVICE_IDS
   ```

   Usa una lista separada por comas si hay varios Echo.

No escribas IDs completos en logs de aplicación. El simulador de Amazon es el
lugar apropiado para copiarlos.

## 8. Probar con el Echo

El Echo debe estar registrado con la misma cuenta usada en Amazon Developer y
configurado en español de España. En la app Alexa, habilita la skill desde
**Skills & Games > Your Skills > Dev** si no aparece automáticamente.

Frases recomendadas:

```text
Alexa, dile a PrintDesk que imprima que hay que comprar huevos, leche y pan.
Alexa, dile a PrintDesk que imprima una nota sobre el evento de mañana.
Alexa, abre PrintDesk.
```

Después de «Alexa, abre PrintDesk», responde directamente con el contenido.
Decir únicamente «Alexa, imprime…» no garantiza que Amazon seleccione esta
Custom Skill, porque puede resolverlo como una función nativa.

## 9. Añadir el acceso corto «Alexa, imprime»

Este acceso convive con las frases que mencionan PrintDesk. No cambia el
backend ni crea otro ticket: la rutina abre la misma skill, que pregunta por el
contenido y continúa mediante `CaptureIntent`.

En la aplicación móvil de Alexa:

1. Ve a **Más > Rutinas** y pulsa **+**.
2. Nombre: `Imprimir con PrintDesk`.
3. En **Cuando ocurra**, selecciona **Voz**.
4. Frase: `imprime`.
5. En **Añadir acción**, selecciona **Skills > Tus Skills > PrintDesk**.
6. Elige la acción predeterminada para abrir la skill.
7. Selecciona el Echo desde el que responderá Alexa y guarda la rutina.

El diálogo resultante es:

```text
Usuario: Alexa, imprime.
Alexa: Dime qué quieres imprimir.
Usuario: Comprar huevos, leche y pan.
Alexa: He enviado a imprimir: Comprar huevos, leche y pan.
```

La rutina no puede capturar texto variable añadido después de «imprime». Para
hacerlo en un solo turno hay que usar la invocación explícita:

```text
Alexa, dile a PrintDesk que imprima comprar huevos, leche y pan.
```

## Confirmación opcional

El despliegue inicial usa:

```text
ALEXA_REQUIRE_CONFIRMATION=false
```

Para confirmar cada ticket verbalmente, cambia la variable a `true` en el
trigger o en Cloud Run. Alexa repetirá el texto y solo imprimirá después de
recibir `AMAZON.YesIntent`.

## Límites de la primera versión

Vertex conoce el texto hablado, la fecha actual y la zona `Europe/Madrid`. No
consulta Google Calendar. «El evento de mañana» se conserva y se redacta como
nota, pero PrintDesk no puede añadir los detalles reales del evento hasta que
se implemente explícitamente una fuente de calendario.
