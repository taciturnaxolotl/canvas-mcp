# Canvas MCP Server

This is a stream http transport Canvas LMS mcp server. A nice fancy bit of goblygook that just means its a remote integration you can plug into chatgpt, claude, poke, or anywhere else that supports mcp. If you want to try the hosted version its over at [canvas.dunkirk.sh](https://canvas.dunkirk.sh) or feel free to self host!

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

## Security

- Canvas tokens encrypted with AES-256-GCM before storage
- MCP tokens hashed with Argon2id (cannot be retrieved after creation)
- No Canvas tokens exposed to MCP clients

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
