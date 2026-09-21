import { randomUUID } from "node:crypto";
import express from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import { InvalidRequestError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { createOAuthMetadata, mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { resourceUrlFromServerUrl } from "@modelcontextprotocol/sdk/shared/auth-utils.js";
import type { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * ============================================================================
 *  DEMO ONLY — do not deploy this authorization server as-is.
 * ============================================================================
 * This is an adaptation of the reference OAuth provider bundled with the
 * official MCP TypeScript SDK (@modelcontextprotocol/sdk examples). It
 * implements a real, spec-correct OAuth 2.1 + PKCE flow with dynamic client
 * registration, which is exactly what `src/server/http.ts --oauth` needs to
 * demonstrate MCP's authorization model end-to-end. What it deliberately
 * skips, and what a production deployment must add back:
 *
 *   - Persistent storage. Codes and tokens live in memory and vanish on
 *     restart or in a second process (this won't work behind >1 server
 *     replica without a shared store).
 *   - Real user authentication. `authorize()` below logs everyone in as
 *     "demo_user" without checking a password, passkey, or SSO session.
 *   - Rate limiting / abuse protection on the token and authorize endpoints.
 *   - Secret rotation and token revocation (`revokeToken` is left unimplemented).
 *
 * In most real deployments you would not write an authorization server at
 * all — you'd point `verifyAccessToken` at your existing IdP (Auth0, WorkOS,
 * Okta, Clerk, your own OIDC provider) and let the MCP SDK's
 * `requireBearerAuth` middleware handle enforcement. This file exists purely
 * so the full flow can be exercised locally without any third-party account.
 */

export class DemoInMemoryClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return this.clients.get(clientId);
  }

  async registerClient(clientMetadata: OAuthClientInformationFull): Promise<OAuthClientInformationFull> {
    this.clients.set(clientMetadata.client_id, clientMetadata);
    return clientMetadata;
  }
}

interface StoredCode {
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
}

interface StoredToken {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource?: URL;
}

export class DemoInMemoryAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new DemoInMemoryClientsStore();
  private codes = new Map<string, StoredCode>();
  private tokens = new Map<string, StoredToken>();

  constructor(private validateResource?: (resource?: URL) => boolean) {}

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: express.Response): Promise<void> {
    if (!client.redirect_uris.includes(params.redirectUri)) {
      throw new InvalidRequestError("Unregistered redirect_uri");
    }

    // A real provider shows a login/consent screen here. This demo "logs in"
    // an implicit demo_user and moves straight to issuing a code.
    const code = randomUUID();
    this.codes.set(code, { client, params });

    const target = new URL(params.redirectUri);
    target.searchParams.set("code", code);
    if (params.state !== undefined) target.searchParams.set("state", params.state);
    res.redirect(target.toString());
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const stored = this.codes.get(authorizationCode);
    if (!stored) throw new Error("Invalid authorization code");
    return stored.params.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<OAuthTokens> {
    // Note: the code_verifier (PKCE) itself is checked upstream by the SDK's
    // token endpoint handler before this is called — that's why it's unused here.
    const stored = this.codes.get(authorizationCode);
    if (!stored) throw new Error("Invalid authorization code");
    if (stored.client.client_id !== client.client_id) {
      throw new Error(
        `Authorization code was not issued to this client (${stored.client.client_id} != ${client.client_id})`
      );
    }
    if (this.validateResource && !this.validateResource(stored.params.resource)) {
      throw new Error(`Invalid resource: ${stored.params.resource}`);
    }
    this.codes.delete(authorizationCode);

    const token = randomUUID();
    this.tokens.set(token, {
      token,
      clientId: client.client_id,
      scopes: stored.params.scopes ?? [],
      expiresAt: Date.now() + 3_600_000, // 1 hour
      resource: stored.params.resource,
    });

    return {
      access_token: token,
      token_type: "bearer",
      expires_in: 3600,
      scope: (stored.params.scopes ?? []).join(" "),
    };
  }

  async exchangeRefreshToken(): Promise<OAuthTokens> {
    throw new Error("Refresh tokens are not implemented in this demo provider");
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const stored = this.tokens.get(token);
    if (!stored || stored.expiresAt < Date.now()) {
      throw new Error("Invalid or expired token");
    }
    return {
      token,
      clientId: stored.clientId,
      scopes: stored.scopes,
      expiresAt: Math.floor(stored.expiresAt / 1000),
      resource: stored.resource,
    };
  }
}

/**
 * Spins up a *separate* Authorization Server app (its own port) plus a
 * `/introspect` endpoint, and returns the OAuth metadata document that the
 * resource server (src/server/http.ts) needs to verify tokens against it.
 *
 * Keeping the authorization server and the MCP resource server as two
 * separate processes mirrors how most real deployments are shaped — you
 * rarely want your data server also acting as your identity provider.
 */
export function setupAuthServer({
  authServerUrl,
  mcpServerUrl,
  strictResource,
}: {
  authServerUrl: URL;
  mcpServerUrl: URL;
  strictResource: boolean;
}) {
  // RFC 8707 resource-indicator checking: when strict, refuse to issue or
  // accept tokens that weren't scoped to *this* MCP server. Skipping this is
  // the classic "confused deputy" risk in multi-service OAuth setups — a
  // token minted for service A gets replayed against service B.
  const validateResource = strictResource
    ? (resource?: URL) => !!resource && resource.toString() === resourceUrlFromServerUrl(mcpServerUrl).toString()
    : undefined;

  const provider = new DemoInMemoryAuthProvider(validateResource);
  const authApp = express();
  authApp.use(express.json());
  authApp.use(express.urlencoded({ extended: false }));

  authApp.use(mcpAuthRouter({ provider, issuerUrl: authServerUrl, scopesSupported: ["mcp:tools"] }));

  authApp.post("/introspect", async (req, res) => {
    try {
      const { token } = req.body as { token?: string };
      if (!token) {
        res.status(400).json({ error: "Token is required" });
        return;
      }
      const info = await provider.verifyAccessToken(token);
      res.json({
        active: true,
        client_id: info.clientId,
        scope: info.scopes.join(" "),
        exp: info.expiresAt,
        aud: info.resource,
      });
    } catch (error) {
      res.status(401).json({ active: false, error: "Unauthorized", error_description: String(error) });
    }
  });

  authApp.listen(Number(authServerUrl.port), () => {
    console.log(`OAuth Authorization Server listening on ${authServerUrl.origin}`);
  });

  const metadata = createOAuthMetadata({ provider, issuerUrl: authServerUrl, scopesSupported: ["mcp:tools"] });
  metadata.introspection_endpoint = new URL("/introspect", authServerUrl).href;

  // The resource server (src/server/http.ts) needs this exact provider
  // instance — not a new one — to verify tokens this authorization server
  // issued. Two separate in-memory providers would never agree on a token.
  return { metadata, provider };
}
