import { OAuth2Client } from "google-auth-library";
import type { CreatedBy } from "@printdesk/shared-models";

export interface IntegrationAuthenticator {
  authenticate(authorization: string | undefined): Promise<CreatedBy>;
}

let verifier: OAuth2Client | undefined;

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_environment_variable:${name}`);
  return value;
}

export function productionIntegrationAuthenticator(): IntegrationAuthenticator {
  return {
    async authenticate(authorization) {
      if (!authorization?.startsWith("Bearer ")) throw new Error("missing_integration_bearer_token");
      const idToken = authorization.slice("Bearer ".length).trim();
      if (!idToken) throw new Error("missing_integration_bearer_token");
      const expectedEmail = required("PRINTDESK_ALEXA_SERVICE_ACCOUNT").toLowerCase();
      const audience = required("PRINTDESK_INTEGRATION_TOKEN_AUDIENCE");
      const ticket = await (verifier ??= new OAuth2Client()).verifyIdToken({ idToken, audience });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email || payload.email.toLowerCase() !== expectedEmail || payload.email_verified !== true) {
        throw new Error("integration_not_authorized");
      }
      return {
        uid: `alexa:${payload.sub}`,
        email: payload.email,
        displayName: "Alexa",
      };
    },
  };
}
