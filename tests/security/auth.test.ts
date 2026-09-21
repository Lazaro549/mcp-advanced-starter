import { describe, it, expect, beforeEach } from "vitest";
import { DemoInMemoryAuthProvider, DemoInMemoryClientsStore } from "../../src/server/auth.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { Response } from "express";

const MOCK_CLIENT: OAuthClientInformationFull = {
  client_id: "test-client-id",
  client_name: "Test Client",
  redirect_uris: ["http://localhost:9999/callback"],
  grant_types: ["authorization_code"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
};

function captureCode(provider: DemoInMemoryAuthProvider, params: Partial<AuthorizationParams> = {}): Promise<string> {
  return new Promise<string>((resolve) => {
    const res = {
      redirect: (url: string) => resolve(new URL(url).searchParams.get("code")!),
    } as unknown as Response;
    void provider.authorize(MOCK_CLIENT, {
      redirectUri: "http://localhost:9999/callback",
      codeChallenge: "test-challenge",
      scopes: ["mcp:tools"],
      ...params,
    }, res);
  });
}

describe("DemoInMemoryClientsStore", () => {
  let clientsStore: DemoInMemoryClientsStore;

  beforeEach(() => {
    clientsStore = new DemoInMemoryClientsStore();
  });

  it("registers and retrieves a client", async () => {
    await clientsStore.registerClient(MOCK_CLIENT);
    const retrieved = await clientsStore.getClient(MOCK_CLIENT.client_id);
    expect(retrieved).toEqual(MOCK_CLIENT);
  });

  it("returns undefined for unknown client", async () => {
    expect(await clientsStore.getClient("unknown-id")).toBeUndefined();
  });
});

describe("DemoInMemoryAuthProvider", () => {
  let provider: DemoInMemoryAuthProvider;

  beforeEach(() => {
    provider = new DemoInMemoryAuthProvider();
  });

  it("verifies a valid token after full code exchange", async () => {
    const code = await captureCode(provider);
    const tokens = await provider.exchangeAuthorizationCode(MOCK_CLIENT, code);

    expect(tokens.access_token).toBeTruthy();
    expect(tokens.token_type).toBe("bearer");

    const authInfo = await provider.verifyAccessToken(tokens.access_token);
    expect(authInfo.clientId).toBe(MOCK_CLIENT.client_id);
    expect(authInfo.scopes).toEqual(["mcp:tools"]);
  });

  it("rejects an invalid token", async () => {
    await expect(provider.verifyAccessToken("invalid-token")).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const code = await captureCode(provider);
    const tokens = await provider.exchangeAuthorizationCode(MOCK_CLIENT, code);

    // Simulate expiry via internal state
    const providerAny = provider as unknown as { tokens: Map<string, { expiresAt: number }> };
    const stored = providerAny.tokens.get(tokens.access_token);
    if (stored) stored.expiresAt = Date.now() - 1000;

    await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toThrow();
  });

  it("rejects reuse of an authorization code", async () => {
    const code = await captureCode(provider);
    await provider.exchangeAuthorizationCode(MOCK_CLIENT, code);
    await expect(provider.exchangeAuthorizationCode(MOCK_CLIENT, code)).rejects.toThrow();
  });

  it("rejects exchange with wrong client", async () => {
    const code = await captureCode(provider);
    const wrongClient: OAuthClientInformationFull = { ...MOCK_CLIENT, client_id: "wrong-client" };
    await expect(provider.exchangeAuthorizationCode(wrongClient, code)).rejects.toThrow();
  });

  it("enforces resource validation when validator is provided", async () => {
    const strictProvider = new DemoInMemoryAuthProvider(
      (resource) => !!resource && resource.toString() === "http://localhost:3000/mcp"
    );
    const code = await captureCode(strictProvider, { resource: new URL("http://wrong-resource.com") });
    await expect(strictProvider.exchangeAuthorizationCode(MOCK_CLIENT, code)).rejects.toThrow("Invalid resource");
  });

  it("allows exchange when resource matches validator", async () => {
    const strictProvider = new DemoInMemoryAuthProvider(
      (resource) => !!resource && resource.toString() === "http://localhost:3000/mcp"
    );
    const code = await captureCode(strictProvider, { resource: new URL("http://localhost:3000/mcp") });
    const tokens = await strictProvider.exchangeAuthorizationCode(MOCK_CLIENT, code);
    expect(tokens.access_token).toBeTruthy();
  });

  it("throws on refresh token exchange (not implemented)", async () => {
    await expect(provider.exchangeRefreshToken(MOCK_CLIENT, "any-refresh-token")).rejects.toThrow();
  });

  it("challengeForAuthorizationCode returns the stored code challenge", async () => {
    const code = await captureCode(provider, { codeChallenge: "my-challenge" });
    const challenge = await provider.challengeForAuthorizationCode(MOCK_CLIENT, code);
    expect(challenge).toBe("my-challenge");
  });

  it("authorize redirects with state when provided", async () => {
    let redirectUrl = "";
    const res = { redirect: (url: string) => { redirectUrl = url; } } as unknown as Response;
    await provider.authorize(MOCK_CLIENT, {
      redirectUri: "http://localhost:9999/callback",
      codeChallenge: "c",
      state: "my-state",
      scopes: [],
    }, res);
    expect(new URL(redirectUrl).searchParams.get("state")).toBe("my-state");
  });

  it("authorize rejects unregistered redirect_uri", async () => {
    const res = { redirect: () => {} } as unknown as Response;
    await expect(
      provider.authorize(MOCK_CLIENT, {
        redirectUri: "http://evil.com/callback",
        codeChallenge: "c",
        scopes: [],
      }, res)
    ).rejects.toThrow("redirect_uri");
  });
});
