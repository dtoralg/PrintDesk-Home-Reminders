import type { CreatedBy } from "@printdesk/shared-models";

export async function authenticate(authorization?: string): Promise<CreatedBy> {
  if (process.env.PRINTDESK_ALLOW_DEV_AUTH === "true" && process.env.NODE_ENV !== "production") {
    return { uid: "local-user", displayName: "Usuario local", email: "local@printdesk.test" };
  }
  if (!authorization?.startsWith("Bearer ")) throw new Error("missing_bearer_token");
  // Firebase Admin + authorized_users/{uid} se conecta en el milestone de identidad.
  // Fallar cerrado evita que un token sin verificar llegue al store local.
  throw new Error("firebase_auth_not_configured");
}
