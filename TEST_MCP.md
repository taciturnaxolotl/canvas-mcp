# Testing the MCP Server

## Method 1: Direct JSON-RPC Test (Quick)

Test the MCP endpoint directly with curl:

```bash
# Set your MCP token (get this from the dashboard)
TOKEN="cmcp_your_token_here"

# Test: List available tools
curl -X POST https://canvas.bore.dunkirk.sh/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'

# Test: List courses
curl -X POST https://canvas.bore.dunkirk.sh/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "list_courses",
      "arguments": {
        "enrollment_state": "active"
      }
    }
  }'
```

## Method 2: Claude Desktop (Real Usage)

1. Get your MCP token from the dashboard
2. Open Claude Desktop config:
   - Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

3. Add this configuration:

```json
{
  "mcpServers": {
    "canvas": {
      "url": "https://canvas.bore.dunkirk.sh/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_TOKEN_HERE"
      }
    }
  }
}
```

4. Restart Claude Desktop

5. Test by asking Claude:
   - "What courses am I enrolled in?"
   - "What assignments do I have due this week?"
   - "Show me details about assignment ID 12345 in course 6789"

## Method 3: MCP Inspector (Visual Debugging)

```bash
# Install MCP Inspector
npm install -g @modelcontextprotocol/inspector

# Create a config file
cat > mcp-config.json <<EOF
{
  "mcpServers": {
    "canvas": {
      "url": "https://canvas.bore.dunkirk.sh/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_TOKEN_HERE"
      }
    }
  }
}
EOF

# Run inspector
mcp-inspector mcp-config.json
```

## Expected Responses

### tools/list
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "list_courses",
        "description": "List Canvas courses...",
        "inputSchema": {...}
      },
      {
        "name": "search_assignments",
        ...
      },
      {
        "name": "get_assignment",
        ...
      }
    ]
  }
}
```

### tools/call (list_courses)
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "[{\"id\": 123, \"name\": \"Biology 101\", ...}]"
      }
    ]
  }
}
```

## Troubleshooting

**Error: "Missing session token"**
- Make sure you're including the `Authorization: Bearer YOUR_TOKEN` header

**Error: "Invalid or expired session token"**
- Your MCP token expired or was regenerated
- Get a new token from the dashboard

**Error: "Not authenticated"**
- The MCP token doesn't match any user in the database
- Log in again via the web interface

**Error: "Unknown tool"**
- Check the tool name spelling (case-sensitive)
- Run `tools/list` to see available tools

**Error: Canvas API errors**
- Your Canvas Personal Access Token may have expired (max 120 days)
- Generate a new Canvas token and update via the web interface
