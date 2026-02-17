import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "./mcp-server.js";
import DB from "./db.js";

// Handle MCP Streamable HTTP requests
export async function handleMcpRequest(
  req: Request,
  apiToken?: string
): Promise<Response> {
  // Validate API token
  if (!apiToken) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Missing API token. Please authenticate first.",
        },
        id: null,
      }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": `Bearer realm="Canvas MCP Server"`,
        },
      }
    );
  }

  // Look up user by API key
  const user = await DB.getUserByApiKey(apiToken);
  if (!user) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Invalid or expired API token",
        },
        id: null,
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  try {
    // Create stateless transport (new transport per request)
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
    });

    // Create MCP server instance with user context
    const server = createMcpServer(user.id);

    // Connect server to transport
    await server.connect(transport);

    // Handle the request through transport
    return await transport.handleRequest(req);
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: error.message || "Internal server error",
        },
        id: null,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// Protected Resource Metadata for OAuth discovery
export function getProtectedResourceMetadata(baseUrl: string) {
  return {
    resource: baseUrl,
    authorization_servers: [`${baseUrl}/auth`],
    bearer_methods_supported: ["header"],
    scopes_supported: ["canvas:read"],
  };
}
