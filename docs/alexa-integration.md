# Integración con Alexa

## Alcance

PrintDesk incorpora una **Custom Skill privada** para crear tickets por voz.
Permanecerá en modo `Development`: no se publicará ni se enviará a certificación
en Alexa Skills Store. Estará disponible en los Echo asociados a la cuenta de
Amazon Developer utilizada durante el desarrollo.

No habrá reconocimiento individual de voz, PIN ni Account Linking. Cualquier
persona con acceso físico a un Echo doméstico autorizado podrá utilizarla.

Ejemplo:

```text
“Alexa, dile a PrintDesk que imprima comprar leche mañana”.
```

## Flujo

```text
Alexa -> printdesk-alexa (Cloud Run público y aislado)
      -> Vertex AI estructura el texto
      -> API PrintDesk autenticada
      -> Firestore -> Pub/Sub -> renderer
      -> agente Windows -> TCP 9100 -> impresora
```

`printdesk-alexa` será un adaptador sin acceso directo a la impresora. Invocará
la API principal mediante identidad de servicio y fijará internamente
`printerId: home` y `source: alexa`; la petición de Alexa no podrá modificarlos.

La implementación y el modelo `es-ES` están en `apps/alexa-service`. La
configuración paso a paso está en `docs/alexa-console-setup.md`.

## Modelo de interacción

- Locale: español de España (`es-ES`).
- Un intent de creación captura texto libre con `AMAZON.SearchQuery`.
- Vertex AI propone `type`, `title`, `body`, `important` y `dueAt`.
- La salida se valida con el mismo esquema estricto utilizado por PWA y MCP.
- La confirmación verbal antes de imprimir será breve y configurable.
- Si hay confirmación, el adaptador conservará el comando pendiente en la sesión
  y reutilizará su clave de idempotencia al recibir la respuesta afirmativa.

## Seguridad

El único endpoint público será `POST /integrations/alexa` en un servicio Cloud
Run separado. La API principal continuará protegida.

Cada solicitud deberá:

1. Verificar la firma de Alexa, la cadena de certificados, su URL permitida y la
   fecha de la petición con la tolerancia recomendada por Amazon.
2. Comparar `applicationId` con el valor configurado en Secret Manager.
3. Comprobar el `userId` esperado y, cuando esté disponible, el `deviceId` contra
   una allowlist de dispositivos domésticos.
4. Aplicar límites de frecuencia por aplicación, usuario, dispositivo e IP.
5. Usar un identificador derivado del `requestId` de Alexa como clave de
   idempotencia para que los reintentos no creen tickets duplicados.

La allowlist de dispositivos limita el origen, pero no identifica a la persona
que habla. Esta es una decisión consciente para una skill doméstica.

## Configuración y secretos

- `ALEXA_APPLICATION_ID`: identificador exacto de la skill.
- `ALEXA_ALLOWED_USER_IDS`: usuarios de Alexa permitidos.
- `ALEXA_ALLOWED_DEVICE_IDS`: Echo permitidos cuando Alexa proporcione el ID.
- Cuenta de servicio exclusiva `printdesk-alexa` con permiso para invocar la API.
- Secret Manager para valores de validación; no se guardarán secretos en GitHub.

No se utilizará Account Linking ni OAuth mientras la skill siga siendo privada
y doméstica. Si se publica o se habilita para otras cuentas, el modelo de
identidad deberá revisarse antes del cambio.

## Criterios de aceptación

- Una frase válida crea exactamente un ticket con `source: alexa` y
  `printerId: home`.
- Una firma, timestamp, aplicación, usuario o dispositivo no autorizado recibe
  rechazo sin invocar Vertex AI ni la API principal.
- Repetir el mismo `requestId` no crea un segundo ticket.
- Una interpretación ambigua pide confirmación o aclaración y no imprime aún.
- Los logs no contienen audio, tokens, firmas completas ni texto sensible sin
  necesidad operativa.
