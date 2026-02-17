import { randomBytes } from "crypto";
import DB from "./lib/db.js";
import { CanvasClient } from "./lib/canvas.js";
import {
  handleMcpRequest,
  getProtectedResourceMetadata,
} from "./lib/mcp-transport.js";

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
