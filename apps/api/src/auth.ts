import { Firestore } from "@google-cloud/firestore";
import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import type { CreatedBy } from "@printdesk/shared-models";

interface AuthorizedUserRecord {
  enabled?: boolean;
  displayName?: string;
  email?: string;
}

export interface AuthDependencies {
  verifyIdToken(token: string): Promise<DecodedIdToken>;
  getAuthorizedUser(uid: string): Promise<AuthorizedUserRecord | null>;
}

let firebaseApp: App | undefined;
let firestore: Firestore | undefined;

function projectId() {
  const value = process.env.GOOGLE_CLOUD_PROJECT;
  if (!value) throw new Error("missing_environment_variable:GOOGLE_CLOUD_PROJECT");
  return value;
}

function productionDependencies(): AuthDependencies {
  const id = projectId();
  firebaseApp ??= getApps().find((candidate) => candidate.name === "printdesk-auth")
    ?? initializeApp({ projectId: id }, "printdesk-auth");
  firestore ??= new Firestore({
    projectId: id,
    databaseId: process.env.PRINTDESK_FIRESTORE_DATABASE ?? "(default)",
  });
  return {
    verifyIdToken: (token) => getAuth(firebaseApp).verifyIdToken(token),
    async getAuthorizedUser(uid) {
      const snapshot = await firestore!.doc(`authorized_users/${uid}`).get();
      return snapshot.exists ? snapshot.data() as AuthorizedUserRecord : null;
    },
  };
}

export async function authenticateFirebase(
  authorization: string | undefined,
  dependencies: AuthDependencies,
): Promise<CreatedBy> {
  if (!authorization?.startsWith("Bearer ")) throw new Error("missing_bearer_token");
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) throw new Error("missing_bearer_token");
  const identity = await dependencies.verifyIdToken(token);
  const allowed = await dependencies.getAuthorizedUser(identity.uid);
  if (!allowed?.enabled) throw new Error("user_not_authorized");
  if (!identity.email) throw new Error("verified_email_required");
  if (allowed.email && allowed.email.toLowerCase() !== identity.email.toLowerCase()) {
    throw new Error("authorized_email_mismatch");
  }
  return {
    uid: identity.uid,
    email: identity.email,
    displayName: allowed.displayName?.trim() || identity.name?.trim() || identity.email,
  };
}

export function authenticate(authorization?: string): Promise<CreatedBy> {
  if (process.env.PRINTDESK_ALLOW_DEV_AUTH === "true" && process.env.NODE_ENV !== "production") {
    return Promise.resolve({ uid: "local-user", displayName: "Usuario local", email: "local@printdesk.test" });
  }
  return authenticateFirebase(authorization, productionDependencies());
}
