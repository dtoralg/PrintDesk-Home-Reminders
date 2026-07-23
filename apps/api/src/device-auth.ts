import { OAuth2Client } from "google-auth-library";

export interface DeviceAuthenticator {
  authenticate(authorization: string | undefined): Promise<{ email: string; subject: string }>;
}

let verifier: OAuth2Client | undefined;

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_environment_variable:${name}`);
  return value;
}

export function productionDeviceAuthenticator(): DeviceAuthenticator {
  return {
    async authenticate(authorization) {
      if (!authorization?.startsWith("Bearer ")) throw new Error("missing_device_bearer_token");
      const idToken = authorization.slice("Bearer ".length).trim();
      if (!idToken) throw new Error("missing_device_bearer_token");
      const expectedEmail = required("PRINTDESK_AGENT_SERVICE_ACCOUNT").toLowerCase();
      const audience = required("PRINTDESK_DEVICE_TOKEN_AUDIENCE");
      const ticket = await (verifier ??= new OAuth2Client()).verifyIdToken({ idToken, audience });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email || payload.email.toLowerCase() !== expectedEmail || payload.email_verified !== true) {
        throw new Error("device_not_authorized");
      }
      return { email: payload.email, subject: payload.sub };
    },
  };
}
