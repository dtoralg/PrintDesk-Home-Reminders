import { describe, expect, it, vi } from "vitest";
import {
  AUTHORIZED_USERS_COLLECTION,
  authenticateFirebase,
  type AuthDependencies,
} from "../src/auth.js";

function dependencies(enabled = true): AuthDependencies {
  return {
    verifyIdToken: vi.fn(async () => ({
      uid: "firebase-uid",
      aud: "printdesk-test",
      auth_time: 0,
      exp: 0,
      firebase: { identities: {}, sign_in_provider: "google.com" },
      iat: 0,
      iss: "https://securetoken.google.com/printdesk-test",
      sub: "firebase-uid",
      email: "owner@example.com",
      name: "Daniel",
    })),
    getAuthorizedUser: vi.fn(async () => ({ enabled, email: "owner@example.com" })),
  };
}

describe("Firebase authentication", () => {
  it("uses the established Firestore allowlist collection", () => {
    expect(AUTHORIZED_USERS_COLLECTION).toBe("authorized_users");
  });

  it("accepts a verified token present in the allowlist", async () => {
    await expect(authenticateFirebase("Bearer valid-token", dependencies())).resolves.toEqual({
      uid: "firebase-uid",
      email: "owner@example.com",
      displayName: "Daniel",
    });
  });

  it("rejects missing bearer tokens and disabled users", async () => {
    await expect(authenticateFirebase(undefined, dependencies())).rejects.toThrow("missing_bearer_token");
    await expect(authenticateFirebase("Bearer valid-token", dependencies(false))).rejects.toThrow("user_not_authorized");
  });
});
