import { randomBytes } from "crypto";
import DB from "./lib/db.js";
import { CanvasClient } from "./lib/canvas.js";
import {
  handleMcpRequest,
  getProtectedResourceMetadata,
} from "./lib/mcp-transport.js";
import Mailer from "./lib/email.js";

// Import HTML pages
import indexPage from "./public/index.html";
import dashboardPage from "./public/dashboard.html";

// Configuration
const PORT = parseInt(process.env.PORT || "3000");
const HOST = process.env.HOST || "localhost";
const BASE_URL = process.env.BASE_URL || `http://${HOST}:${PORT}`;

// Generate session cookie
function generateSessionId(): string {
  return randomBytes(32).toString("base64url");
}

// Get session from cookie
function getSession(req: Request) {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;

  const sessionCookie = cookie
    .split(";")
    .find((c) => c.trim().startsWith("session="));
  if (!sessionCookie) return null;

  const sessionId = sessionCookie.split("=")[1];
  return DB.getSession(sessionId);
}

// Routes
const routes = {
  // Web pages
  "/": indexPage,
  "/dashboard": dashboardPage,

  // Favicon
  "/favicon.ico": {
    GET() {
      const file = Bun.file("src/public/favicon.ico");
      return new Response(file, {
        headers: { "Content-Type": "image/x-icon" },
      });
    },
  },

  // MCP Protocol endpoint (Streamable HTTP)
  "/mcp": {
    async POST(req: Request) {
      // Extract Bearer token from Authorization header
      const authHeader = req.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7)
        : undefined;

      return handleMcpRequest(req, token);
    },
  },

  // Protected Resource Metadata (OAuth discovery)
  "/.well-known/oauth-protected-resource": {
    GET() {
      return Response.json(getProtectedResourceMetadata(BASE_URL));
    },
  },

  // Protected Resource Metadata with MCP path
  "/.well-known/oauth-protected-resource/mcp": {
    GET() {
      return Response.json(getProtectedResourceMetadata(BASE_URL));
    },
  },

  // Authorization Server Metadata (at root for discovery)
  "/.well-known/oauth-authorization-server/auth": {
    GET() {
      return Response.json({
        issuer: `${BASE_URL}/auth`,
        authorization_endpoint: `${BASE_URL}/auth/authorize`,
        token_endpoint: `${BASE_URL}/auth/token`,
        code_challenge_methods_supported: ["S256"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        response_types_supported: ["code"],
        scopes_supported: [
          "canvas:read",
          "canvas:courses:read",
          "canvas:assignments:read",
          "canvas:grades:read",
          "canvas:announcements:read",
        ],
        token_endpoint_auth_methods_supported: ["none"],
        client_id_metadata_document_supported: true,
      });
    },
  },

  // OpenID Connect Discovery (some clients look for this)
  "/.well-known/openid-configuration/auth": {
    GET() {
      return Response.json({
        issuer: `${BASE_URL}/auth`,
        authorization_endpoint: `${BASE_URL}/auth/authorize`,
        token_endpoint: `${BASE_URL}/auth/token`,
        code_challenge_methods_supported: ["S256"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        response_types_supported: ["code"],
        scopes_supported: [
          "canvas:read",
          "canvas:courses:read",
          "canvas:assignments:read",
          "canvas:grades:read",
          "canvas:announcements:read",
        ],
        token_endpoint_auth_methods_supported: ["none"],
      });
    },
  },

  "/auth/.well-known/openid-configuration": {
    GET() {
      return Response.json({
        issuer: `${BASE_URL}/auth`,
        authorization_endpoint: `${BASE_URL}/auth/authorize`,
        token_endpoint: `${BASE_URL}/auth/token`,
        code_challenge_methods_supported: ["S256"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        response_types_supported: ["code"],
        scopes_supported: [
          "canvas:read",
          "canvas:courses:read",
          "canvas:assignments:read",
          "canvas:grades:read",
          "canvas:announcements:read",
        ],
        token_endpoint_auth_methods_supported: ["none"],
      });
    },
  },

  // Dynamic client registration (return 501 Not Implemented for now)
  "/register": {
    POST() {
      return Response.json(
        { error: "dynamic_registration_not_supported", error_description: "Use Client ID Metadata Documents instead" },
        { status: 501 }
      );
    },
  },

  // OAuth authorization endpoint
  "/auth/authorize": {
    async GET(req: Request) {
      const url = new URL(req.url);
      const client_id = url.searchParams.get("client_id");
      const redirect_uri = url.searchParams.get("redirect_uri");
      const code_challenge = url.searchParams.get("code_challenge");
      const code_challenge_method = url.searchParams.get("code_challenge_method");
      const resource = url.searchParams.get("resource");
      const scope = url.searchParams.get("scope") || "canvas:read";
      const state = url.searchParams.get("state") || "";
      const response_type = url.searchParams.get("response_type");

      // Validate required parameters
      if (!client_id || !redirect_uri || !code_challenge || !response_type) {
        return new Response("Missing required OAuth parameters", { status: 400 });
      }

      if (response_type !== "code") {
        return new Response("Only authorization_code flow is supported", { status: 400 });
      }

      if (code_challenge_method !== "S256") {
        return new Response("Only S256 PKCE method is supported", { status: 400 });
      }

      // Check if user is logged in
      const session = getSession(req);
      if (!session?.user_id) {
        // Redirect to login, preserving OAuth params
        return new Response(null, {
          status: 302,
          headers: {
            Location: `/?oauth_redirect=${encodeURIComponent(req.url)}`,
          },
        });
      }

      // Check if user has Canvas connected
      const user = DB.raw
        .query("SELECT * FROM users WHERE id = ?")
        .get(session.user_id) as any;

      if (!user || !user.canvas_domain) {
        return new Response(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect Canvas First</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      line-height: 1.6;
      max-width: 600px;
      margin: 4rem auto;
      padding: 2rem;
      color: #111;
    }
    main {
      padding: 2rem;
      border: 1px solid #ddd;
      border-radius: 4px;
    }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; font-weight: 600; }
    p { color: #555; margin-bottom: 1.5rem; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <main>
    <h1>Connect Canvas First</h1>
    <p>You need to connect your Canvas account before authorizing AI access.</p>
    <p><a href="/dashboard">Go to Dashboard →</a></p>
  </main>
</body>
</html>`, { headers: { "Content-Type": "text/html" }});
      }

      // Show consent page
      const consentHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize Access</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      line-height: 1.6;
      max-width: 600px;
      margin: 4rem auto;
      padding: 2rem;
      color: #111;
    }
    main {
      padding: 2rem;
      border: 1px solid #ddd;
      border-radius: 4px;
    }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; font-weight: 600; }
    p { color: #555; margin-bottom: 1.5rem; }
    .scopes {
      background: #f9f9f9;
      padding: 1rem;
      border-radius: 4px;
      margin: 1.5rem 0;
    }
    .scope-item {
      padding: 0.5rem 0;
      border-bottom: 1px solid #eee;
    }
    .scope-item:last-child { border-bottom: none; }
    .buttons {
      display: flex;
      gap: 1rem;
      margin-top: 1.5rem;
    }
    button {
      flex: 1;
      padding: 0.75rem;
      border: none;
      border-radius: 4px;
      font-size: 1rem;
      cursor: pointer;
    }
    .approve { background: #0066cc; color: white; }
    .deny { background: #666; color: white; }
  </style>
</head>
<body>
  <main>
    <h1>Authorize Access</h1>
    <p><strong>${client_id.split('/')[2]}</strong> wants to access your Canvas data.</p>

    <div class="scopes">
      <strong>Requested permissions:</strong>
      ${scope.split(" ").map(s => `
        <div class="scope-item">
          ${s.replace("canvas:", "").replace(/:read$/, "").replace(/_/g, " ")}
        </div>
      `).join("")}
    </div>

    <form method="POST" action="/auth/consent">
      <input type="hidden" name="client_id" value="${client_id}">
      <input type="hidden" name="redirect_uri" value="${redirect_uri}">
      <input type="hidden" name="code_challenge" value="${code_challenge}">
      <input type="hidden" name="code_challenge_method" value="${code_challenge_method}">
      <input type="hidden" name="scope" value="${scope}">
      <input type="hidden" name="state" value="${state}">

      <div class="buttons">
        <button type="submit" name="action" value="deny" class="deny">Deny</button>
        <button type="submit" name="action" value="approve" class="approve">Authorize</button>
      </div>
    </form>
  </main>
</body>
</html>`;

      return new Response(consentHTML, {
        headers: { "Content-Type": "text/html" },
      });
    },
  },

  // OAuth consent handler
  "/auth/consent": {
    async POST(req: Request) {
      const session = getSession(req);
      if (!session?.user_id) {
        return Response.json({ error: "Not authenticated" }, { status: 401 });
      }

      const formData = await req.formData();
      const action = formData.get("action");
      const client_id = formData.get("client_id") as string;
      const redirect_uri = formData.get("redirect_uri") as string;
      const code_challenge = formData.get("code_challenge") as string;
      const code_challenge_method = formData.get("code_challenge_method") as string;
      const scope = formData.get("scope") as string;
      const state = formData.get("state") as string;

      if (action === "deny") {
        return new Response(null, {
          status: 302,
          headers: {
            Location: `${redirect_uri}?error=access_denied&state=${state}`,
          },
        });
      }

      // Generate authorization code
      const authCode = randomBytes(32).toString("base64url");

      // Store auth code in database
      DB.raw.run(
        `INSERT INTO auth_codes (code, user_id, client_id, redirect_uri, code_challenge, code_challenge_method, scope, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          authCode,
          session.user_id,
          client_id,
          redirect_uri,
          code_challenge,
          code_challenge_method,
          scope,
          Date.now() + 10 * 60 * 1000, // 10 minutes
        ]
      );

      // Redirect back with code
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${redirect_uri}?code=${authCode}&state=${state}`,
        },
      });
    },
  },

  // OAuth token endpoint
  "/auth/token": {
    async POST(req: Request) {
      // OAuth 2.0 token requests use application/x-www-form-urlencoded
      const contentType = req.headers.get("content-type") || "";
      let grant_type, code, redirect_uri, code_verifier, client_id, resource;

      if (contentType.includes("application/x-www-form-urlencoded")) {
        const formData = await req.formData();
        grant_type = formData.get("grant_type") as string;
        code = formData.get("code") as string;
        redirect_uri = formData.get("redirect_uri") as string;
        code_verifier = formData.get("code_verifier") as string;
        client_id = formData.get("client_id") as string;
        resource = formData.get("resource") as string;
      } else {
        // Fall back to JSON for backwards compatibility
        const body = await req.json();
        ({ grant_type, code, redirect_uri, code_verifier, client_id, resource } = body);
      }

      if (grant_type !== "authorization_code") {
        return Response.json(
          { error: "unsupported_grant_type" },
          { status: 400 }
        );
      }

      if (!code || !code_verifier || !client_id) {
        return Response.json(
          { error: "invalid_request", error_description: "Missing required parameters" },
          { status: 400 }
        );
      }

      // Look up auth code
      const authData = DB.raw
        .query("SELECT * FROM auth_codes WHERE code = ? AND expires_at > ?")
        .get(code, Date.now()) as any;

      if (!authData) {
        return Response.json(
          { error: "invalid_grant", error_description: "Invalid or expired authorization code" },
          { status: 400 }
        );
      }

      // Verify PKCE
      const hash = require("crypto").createHash("sha256").update(code_verifier).digest("base64url");
      if (hash !== authData.code_challenge) {
        DB.raw.run("DELETE FROM auth_codes WHERE code = ?", [code]);
        return Response.json(
          { error: "invalid_grant", error_description: "PKCE validation failed" },
          { status: 400 }
        );
      }

      // Verify client_id and redirect_uri match
      if (client_id !== authData.client_id || redirect_uri !== authData.redirect_uri) {
        return Response.json(
          { error: "invalid_grant", error_description: "Client ID or redirect URI mismatch" },
          { status: 400 }
        );
      }

      // Generate OAuth access token
      const accessToken = DB.createOAuthToken(authData.user_id, authData.scope, 86400000);

      // Delete used auth code
      DB.raw.run("DELETE FROM auth_codes WHERE code = ?", [code]);

      return Response.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 86400, // 24 hours
        scope: authData.scope,
      });
    },
  },

  // Auth endpoints
  "/api/auth/token-login": {
    async POST(req: Request) {
      try {
        const { canvas_domain, access_token } = await req.json();

        if (!canvas_domain || !access_token) {
          return Response.json(
            { error: "Canvas domain and access token are required" },
            { status: 400 },
          );
        }

        // Verify the token by making a test API call
        const client = new CanvasClient(canvas_domain, access_token);

        let canvasUser;
        try {
          canvasUser = await client.getCurrentUser();
        } catch (error: any) {
          return Response.json(
            {
              error:
                "Invalid access token or Canvas domain. Please check your credentials and try again.",
            },
            { status: 401 },
          );
        }

        // Check if user is already logged in (via magic link)
        const session = getSession(req);
        if (session?.user_id) {
          // Update existing magic link user with Canvas credentials
          const { apiKey } = await DB.updateUserCanvas(
            session.user_id,
            canvasUser.id.toString(),
            canvas_domain,
            access_token
          );

          // Store API key in session if just generated (so user can see it)
          if (apiKey) {
            DB.updateSession(session.id, { api_key: apiKey });
          }

          return Response.json({ success: true });
        }

        // Create or update user
        const { user, apiKey, isNewUser } = await DB.createOrUpdateUser({
          canvas_user_id: canvasUser.id.toString(),
          canvas_domain,
          email: canvasUser.primary_email || canvasUser.login_id,
          canvas_access_token: access_token,
        });

        // Create session with MCP token (only for new users)
        const sessionId = generateSessionId();
        DB.createSession(sessionId, {
          canvas_domain,
          state: "",
          user_id: user.id,
          api_key: isNewUser ? apiKey : undefined,
          maxAge: 2592000, // 30 days
        });

        return Response.json(
          { success: true },
          {
            headers: {
              "Set-Cookie": `session=${sessionId}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax${
                BASE_URL.startsWith("https") ? "; Secure" : ""
              }`,
            },
          },
        );
      } catch (error: any) {
        console.error("Token login error:", error);
        return Response.json(
          { error: error.message || "Login failed" },
          { status: 500 },
        );
      }
    },
  },

  "/api/auth/logout": {
    async POST(req: Request) {
      const session = getSession(req);
      if (session) {
        DB.deleteSession(session.id);
      }

      return Response.json(
        { success: true },
        {
          headers: {
            "Set-Cookie": "session=; HttpOnly; Path=/; Max-Age=0",
          },
        },
      );
    },
  },

  // Magic link authentication
  "/api/auth/request-magic-link": {
    async POST(req: Request) {
      try {
        const { email } = await req.json();

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return Response.json(
            { error: "Valid email is required" },
            { status: 400 }
          );
        }

        // Rate limiting: 1 email per minute per address
        const cooldownMs = 60 * 1000; // 1 minute
        if (!DB.canSendMagicLink(email, cooldownMs)) {
          const lastSent = DB.getLastMagicLinkTime(email);
          const waitTime = lastSent
            ? Math.ceil((lastSent + cooldownMs - Date.now()) / 1000)
            : 60;

          return Response.json(
            {
              error: `Please wait ${waitTime} seconds before requesting another link`,
            },
            { status: 429 }
          );
        }

        // Generate magic link token
        const token = randomBytes(32).toString("base64url");
        const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

        // Store magic link
        DB.createMagicLink(email, token, expiresAt);

        // Send email
        try {
          await Mailer.sendMagicLink(email, token);
        } catch (error: any) {
          console.error("Failed to send magic link email:", error);
          return Response.json(
            { error: "Failed to send email. Please try again." },
            { status: 500 }
          );
        }

        return Response.json({
          success: true,
          message: "Check your email for a sign-in link",
        });
      } catch (error: any) {
        console.error("Magic link error:", error);
        return Response.json(
          { error: "Failed to send magic link" },
          { status: 500 }
        );
      }
    },
  },

  "/auth/verify": {
    async GET(req: Request) {
      const url = new URL(req.url);
      const token = url.searchParams.get("token");

      if (!token) {
        return new Response("Missing token", { status: 400 });
      }

      const magicLink = DB.getMagicLink(token);
      if (!magicLink) {
        return new Response(
          `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invalid Link - Canvas MCP</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      line-height: 1.6;
      max-width: 600px;
      margin: 4rem auto;
      padding: 2rem;
      color: #111;
    }
    main {
      padding: 2rem;
      border: 1px solid #ddd;
      border-radius: 4px;
    }
    h1 {
      font-size: 1.5rem;
      margin-bottom: 1rem;
      font-weight: 600;
    }
    p {
      color: #555;
      margin-bottom: 1.5rem;
    }
    a {
      color: #0066cc;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <main>
    <h1>Invalid or Expired Link</h1>
    <p>This sign-in link is invalid or has expired.</p>
    <p><a href="/">Request a new link</a></p>
  </main>
</body>
</html>`,
          { headers: { "Content-Type": "text/html" } }
        );
      }

      // Mark as used
      DB.markMagicLinkUsed(token);

      // Check if user exists
      let user = DB.getUserByEmail(magicLink.email);

      // If no user, create a placeholder (they'll add Canvas later)
      if (!user) {
        const result = DB.raw
          .prepare(
            "INSERT INTO users (email) VALUES (?)"
          )
          .run(magicLink.email);
        user = { id: Number(result.lastInsertRowid), email: magicLink.email };
      }

      // Create session
      const sessionId = generateSessionId();
      DB.createSession(sessionId, {
        canvas_domain: user.canvas_domain || "",
        state: "",
        user_id: user.id,
        maxAge: 2592000, // 30 days
      });

      return new Response(null, {
        status: 302,
        headers: {
          Location: "/dashboard",
          "Set-Cookie": `session=${sessionId}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax${
            BASE_URL.startsWith("https") ? "; Secure" : ""
          }`,
        },
      });
    },
  },

  // User endpoints
  "/api/user/me": {
    async GET(req: Request) {
      const session = getSession(req);
      if (!session?.user_id) {
        return Response.json({ error: "Not authenticated" }, { status: 401 });
      }

      const userData = DB.raw
        .query("SELECT * FROM users WHERE id = ?")
        .get(session.user_id) as any;

      if (!userData) {
        return Response.json({ error: "User not found" }, { status: 404 });
      }

      // Get usage stats
      const allUsage = DB.getUsageStats(userData.id);
      const last24h = DB.getUsageStats(
        userData.id,
        Date.now() - 24 * 60 * 60 * 1000,
      );
      const last7d = DB.getUsageStats(
        userData.id,
        Date.now() - 7 * 24 * 60 * 60 * 1000,
      );

      // Get MCP token from session (if just created) or hide it
      const apiKey = session.api_key || null;

      // Clear token from session after first view
      if (session.api_key) {
        DB.clearApiKeyFromSession(session.id);
      }

      return Response.json({
        canvas_domain: userData.canvas_domain,
        email: userData.email,
        created_at: userData.created_at,
        last_used_at: userData.last_used_at,
        api_key: apiKey,
        usage_stats: {
          total_requests: allUsage.length,
          requests_24h: last24h.length,
          requests_7d: last7d.length,
        },
      });
    },
  },

  "/api/user/regenerate-key": {
    async POST(req: Request) {
      const session = getSession(req);
      if (!session?.user_id) {
        return Response.json({ error: "Not authenticated" }, { status: 401 });
      }

      const newApiKey = await DB.regenerateApiKey(session.user_id);

      return Response.json({ api_key: newApiKey });
    },
  },
};

// Start server
const server = Bun.serve({
  port: PORT,
  routes,
  development: Bun.env.NODE_ENV !== "production",

  fetch(req) {
    console.log(`${req.method} ${new URL(req.url).pathname}`);
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Canvas MCP Server running at ${BASE_URL}`);
console.log(`Dashboard: ${BASE_URL}/dashboard`);
console.log(`MCP Endpoint: ${BASE_URL}/mcp`);
