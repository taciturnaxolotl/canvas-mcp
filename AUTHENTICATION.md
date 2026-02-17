# Canvas MCP Authentication

The Canvas MCP Server supports two authentication methods:

## 1. Personal Access Tokens (Recommended for Students)

**Best for:** Individual students, anyone without Canvas admin access

### How it works:
1. Users generate their own Personal Access Token from Canvas
2. Paste it into the web app
3. Get an MCP API key instantly
4. No admin access required

### Setup Instructions:

**For Users:**
1. Log in to your Canvas account
2. Go to **Account → Settings**
3. Scroll to **"Approved Integrations"**
4. Click **"+ New Access Token"**
5. Fill in:
   - **Purpose:** "MCP Server" (or anything you want)
   - **Expires:** (optional - max 120 days, leave blank for 120 days)
6. Click **"Generate Token"**
7. **Copy the token** (you won't see it again!)
8. Paste it into the Canvas MCP login page

**Security Notes:**
- Personal Access Tokens have the same permissions as your Canvas account
- The token is encrypted before being stored in the database
- You can revoke the token anytime from Canvas Settings
- Canvas limits token expiration to a maximum of 120 days
- When your token expires, just generate a new one and update it on the dashboard

---

## 2. OAuth 2.1 (For Institution-Wide Deployment)

**Best for:** Canvas administrators deploying for entire institution

### How it works:
1. Admin registers OAuth application in Canvas
2. Users click "Sign in with Canvas"
3. Canvas OAuth flow handles authentication
4. Server stores encrypted tokens

### Setup Instructions:

**For Canvas Administrators:**

See [SETUP.md](./SETUP.md) for detailed OAuth configuration instructions.

**Quick summary:**
1. Go to Canvas Admin → Developer Keys → "+ API Key"
2. Set redirect URI: `https://canvas.dunkirk.sh/api/auth/callback`
3. Request scopes: courses, assignments, users (read)
4. Copy Client ID and Client Secret
5. Add to server `.env` file

---

## Comparison

| Feature | Personal Access Token | OAuth |
|---------|----------------------|-------|
| **Setup Complexity** | Simple (2 minutes) | Complex (requires admin) |
| **Who Can Use** | Any Canvas user | Requires admin setup |
| **Token Management** | User manages their own | Server manages via refresh tokens |
| **Expiration** | Max 120 days (user sets) | Typically 1 hour (auto-refreshed) |
| **Revocation** | User revokes in Canvas | User revokes in Canvas |
| **Best For** | Individual students | Institution-wide deployment |

---

## Hybrid Deployment

The server supports **both methods simultaneously**:

- Students can use Personal Access Tokens (no admin needed)
- Institutions can set up OAuth for easier onboarding
- Users choose their preferred method on login

This provides maximum flexibility.

---

## Security

Both methods are secure:

**Personal Access Tokens:**
- Encrypted at rest using AES-256-GCM
- Never logged or exposed in API responses
- Only decrypted when making Canvas API calls

**OAuth Tokens:**
- Encrypted at rest using AES-256-GCM
- Automatically refreshed before expiration
- Follow OAuth 2.1 best practices with PKCE

**MCP API Keys:**
- Hashed using Argon2id before storage
- Cannot be recovered (only verified)
- Can be regenerated anytime by user

---

## Which Method Should I Use?

**Use Personal Access Tokens if:**
- You're a student or individual user
- You don't have Canvas admin access
- You want to get started in 2 minutes
- You're okay managing your own token

**Use OAuth if:**
- You're deploying for an entire institution
- You have Canvas admin access
- You want users to have a simpler login flow (just click a button)
- You want tokens to auto-refresh

**Recommendation:** Start with Personal Access Tokens. They're simpler and work for everyone.
