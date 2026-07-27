import { GoogleAuth } from "google-auth-library";
import {
  SkillRequestSignatureVerifier,
  TimestampVerifier,
} from "ask-sdk-express-adapter";
import { buildAlexaApp, type PrintDeskAlexaClient } from "./app.js";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_environment_variable:${name}`);
  return value;
}

function csv(name: string) {
  return new Set(required(name).split(",").map((value) => value.trim()).filter(Boolean));
}

const apiBaseUrl = required("PRINTDESK_API_BASE_URL").replace(/\/+$/, "");
const apiAudience = process.env.PRINTDESK_API_TOKEN_AUDIENCE?.trim() || apiBaseUrl;
const googleAuth = new GoogleAuth();
const client: PrintDeskAlexaClient = {
  async createFromText(text, idempotencyKey) {
    const identityClient = await googleAuth.getIdTokenClient(apiAudience);
    const headers = await identityClient.getRequestHeaders(apiBaseUrl);
    const authorization = headers.get("authorization");
    if (!authorization) throw new Error("printdesk_api_identity_token_unavailable");
    const response = await fetch(`${apiBaseUrl}/v1/integrations/alexa/requests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization,
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error(`printdesk_api_failed:${response.status}`);
    return await response.json();
  },
};

const signatureVerifier = new SkillRequestSignatureVerifier();
const timestampVerifier = new TimestampVerifier();
const app = buildAlexaApp({
  applicationId: required("ALEXA_APPLICATION_ID"),
  allowedUserIds: csv("ALEXA_ALLOWED_USER_IDS"),
  allowedDeviceIds: new Set(
    (process.env.ALEXA_ALLOWED_DEVICE_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  ),
  requireConfirmation: process.env.ALEXA_REQUIRE_CONFIRMATION === "true",
  rateLimitPerMinute: Number(process.env.ALEXA_RATE_LIMIT_PER_MINUTE ?? "10"),
}, {
  async verify(rawBody, headers) {
    await signatureVerifier.verify(rawBody, headers);
    await timestampVerifier.verify(rawBody);
  },
}, client);

const port = Number(process.env.PORT ?? "8080");
await app.listen({ host: "0.0.0.0", port });
