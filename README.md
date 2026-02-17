# Canvas MCP Server

A proper MCP (Model Context Protocol) server that connects Canvas LMS to AI assistants like Claude Desktop.

## Features

- **Proper MCP Protocol**: Implements Streamable HTTP transport with JSON-RPC
- **Personal Access Token Auth**: Students set up in 2 minutes (no admin access needed)
- **Multi-Institution Support**: Works with any Canvas instance
- **Encrypted Storage**: Canvas tokens encrypted at rest with AES-256-GCM
- **Session Persistence**: Sessions survive server restarts (stored in SQLite)
- **Built with Bun**: Fast, modern TypeScript using `@modelcontextprotocol/sdk`

## Quick Start

```bash
# Install dependencies
bun install

# Generate encryption key
bun run generate-key

# Copy and configure environment
cp .env.example .env
# Add the generated encryption key to .env

# Run development server
bun dev
```

Visit `http://localhost:3000` to connect your Canvas account.

## How It Works

1. **Web Interface**: Students enter Canvas domain + Personal Access Token
2. **Verification**: Server validates token by calling Canvas API
3. **Token Storage**: Canvas token encrypted and stored server-side
4. **MCP Token**: User receives an MCP connection token for their AI client
5. **MCP Protocol**: AI client connects to `/mcp` endpoint with Bearer token
6. **Canvas Proxy**: Server proxies tool calls to Canvas using stored token

## MCP Tools

- `list_courses`: List Canvas courses with enrollment filtering
- `search_assignments`: Search assignments across courses
- `get_assignment`: Get detailed assignment information

## Client Configuration

After connecting your Canvas account, add this to Claude Desktop config:

```json
{
  "mcpServers": {
    "canvas": {
      "url": "https://canvas.dunkirk.sh/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_TOKEN_HERE"
      }
    }
  }
}
```

## Architecture

- **MCP Server**: `@modelcontextprotocol/sdk` with Streamable HTTP transport
- **Web Dashboard**: Bun.serve with HTML/CSS/JS (no frameworks)
- **Database**: SQLite with encrypted Canvas tokens and persistent sessions
- **Transport**: JSON-RPC over HTTP POST at `/mcp` endpoint

## Security

- Canvas tokens encrypted with AES-256-GCM before storage
- MCP tokens hashed with Argon2id (cannot be retrieved after creation)
- Sessions stored in database (survive restarts)
- HTTPS enforced in production
- No Canvas tokens exposed to MCP clients

## Deployment

Deployed at: `https://canvas.dunkirk.sh`

The canonical repo is hosted on tangled at [`knot.dunkirk.sh/canvas-mcp`](https://tangled.org/knot.dunkirk.sh/canvas-mcp)

<p align="center">
    <img src="https://raw.githubusercontent.com/taciturnaxolotl/carriage/main/.github/images/line-break.svg" />
</p>

<p align="center">
    <i><code>&copy; 2026-present <a href="https://dunkirk.sh">Kieran Klukas</a></code></i>
</p>

<p align="center">
    <a href="https://tangled.org/knot.dunkirk.sh/canvas-mcp/blob/main/LICENSE.md"><img src="https://img.shields.io/static/v1.svg?style=for-the-badge&label=License&message=O'Saasy&logoColor=d9e0ee&colorA=363a4f&colorB=b7bdf8"/></a>
</p>
