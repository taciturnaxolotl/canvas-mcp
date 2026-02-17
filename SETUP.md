# Canvas MCP Server Setup

This guide explains how to set up the Canvas MCP server to work with your Canvas LMS institution(s).

## Multi-Institution Support

The server supports three configuration modes:

### 1. **Global/Wildcard Configuration** (Easiest)

If your Canvas instance supports OAuth applications that work across different domains, or if you're only supporting one institution:

```bash
CANVAS_CLIENT_ID=your_client_id
CANVAS_CLIENT_SECRET=your_client_secret
```

This will accept logins from **any Canvas domain** using the same OAuth credentials.

### 2. **Multiple Specific Institutions**

If you need different OAuth credentials for different institutions:

```bash
CANVAS_INSTITUTIONS='[
  {
    "domain": "canvas.harvard.edu",
    "clientId": "xxx",
    "clientSecret": "yyy",
    "name": "Harvard University"
  },
  {
    "domain": "canvas.mit.edu",
    "clientId": "aaa",
    "clientSecret": "bbb",
    "name": "MIT"
  }
]'
```

---

## How to Get Canvas OAuth Credentials

Each Canvas institution must register your MCP server as an OAuth application. Here's how:

### For Canvas Administrators:

1. **Go to Canvas Admin Panel**
   - Navigate to: Admin → Developer Keys

2. **Create a new Developer Key**
   - Click "+ Developer Key" → "+ API Key"

3. **Fill in the details:**
   - **Key Name**: Canvas MCP Server
   - **Owner Email**: Your email
   - **Redirect URIs**: `https://canvas.dunkirk.sh/api/auth/callback`
   - **Scopes**: Select the following:
     - `url:GET|/api/v1/courses`
     - `url:GET|/api/v1/assignments`
     - `url:GET|/api/v1/users/self`

4. **Save and Enable**
   - Copy the **Client ID** and **Client Secret**
   - Set the key state to "On"

5. **Provide credentials to the server**
   - Add the Client ID and Client Secret to your `.env` file

### For Users (Self-Service):

If you don't have admin access to your Canvas instance:

1. Contact your Canvas LMS administrator
2. Ask them to register an OAuth application with the redirect URI: `https://canvas.dunkirk.sh/api/auth/callback`
3. Request the Client ID and Client Secret
4. Provide these to the Canvas MCP server administrator

---

## Canvas Cloud & Inherited Developer Keys

Some Canvas Cloud institutions support **inherited developer keys** across a consortium. If your institution is part of a Canvas Cloud consortium, a single OAuth application might work across multiple domains.

Ask your Canvas administrator if this is available.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

### Required Variables:

```bash
# Server
PORT=3000
HOST=localhost
BASE_URL=https://canvas.dunkirk.sh

# Encryption key (generate with: openssl rand -base64 32)
ENCRYPTION_KEY=your_encryption_key_here

# Canvas OAuth (choose one of the options above)
CANVAS_CLIENT_ID=your_client_id
CANVAS_CLIENT_SECRET=your_client_secret

# Database
DATABASE_PATH=./canvas-mcp.db
```

---

## Installation

```bash
# Install dependencies
bun install

# Run development server
bun dev

# Build for production
bun run build

# Run production server
bun start
```

---

## Usage

1. **Users visit**: `https://canvas.dunkirk.sh`
2. **Enter their Canvas domain**: e.g., `canvas.harvard.edu`
3. **Authenticate via Canvas OAuth**
4. **Receive an MCP API key** on their dashboard
5. **Configure their MCP client** with the API key

---

## MCP Client Configuration

After getting an API key, users should add this to their MCP client config:

```json
{
  "mcpServers": {
    "canvas": {
      "command": "bunx",
      "args": ["canvas-mcp-client"],
      "env": {
        "CANVAS_MCP_API_KEY": "cmcp_...",
        "CANVAS_MCP_URL": "https://canvas.dunkirk.sh"
      }
    }
  }
}
```

---

## Security Notes

- **API keys are hashed** before storage using Argon2id
- **Canvas tokens are encrypted** at rest using AES-256-GCM
- **OAuth state parameters** prevent CSRF attacks
- **HTTPS required** in production
- **Session cookies** are HttpOnly and SameSite=Lax

---

## Deployment

Deploy to any platform that supports Bun:

- **Railway**: `railway up`
- **Fly.io**: `fly launch`
- **Docker**: See Dockerfile
- **VPS**: Run with systemd or PM2

Make sure to:
- Set `BASE_URL` to your production domain
- Use HTTPS (required for OAuth)
- Set a strong `ENCRYPTION_KEY`
- Configure Canvas OAuth redirect URI to your production URL

---

## Troubleshooting

### "Canvas domain is not configured"

The server doesn't have OAuth credentials for that Canvas instance. Either:
- Use a global wildcard configuration (`CANVAS_CLIENT_ID` + `CANVAS_CLIENT_SECRET`)
- Add the specific domain to `CANVAS_INSTITUTIONS`

### "OAuth token exchange failed"

- Verify the Client ID and Client Secret are correct
- Check that the redirect URI in Canvas matches exactly: `https://canvas.dunkirk.sh/api/auth/callback`
- Ensure the Canvas domain is correct (no `https://`, just `canvas.university.edu`)

### "Invalid API key"

- The API key might have been regenerated
- Copy the new API key from the dashboard
- Update your MCP client configuration
