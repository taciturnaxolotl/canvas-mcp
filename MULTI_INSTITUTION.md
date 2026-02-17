# Multi-Institution Support - How It Works

## Your Question: "Can we make the Canvas thing work at any institution?"

**Answer: Yes!** ✅

The server is designed to work with **any Canvas institution**. Here's how:

---

## How Multi-Institution Support Works

### 1. **User-Provided Domain**

When users visit the login page, they enter their Canvas domain (e.g., `canvas.harvard.edu`, `canvas.mit.edu`, `instructure.university.edu`).

The server:
- Accepts **any valid Canvas domain**
- Uses that domain for the OAuth flow
- Stores the user's specific Canvas instance in the database
- Makes API calls to **their** Canvas instance (not a shared one)

### 2. **OAuth Configuration Options**

You have three ways to configure OAuth:

#### Option A: **Global/Wildcard** (Simplest)
```bash
CANVAS_CLIENT_ID=xxx
CANVAS_CLIENT_SECRET=yyy
```

This uses **one set of OAuth credentials for all institutions**.

✅ **Works if**:
- You have a Canvas Cloud account with inherited developer keys
- Your OAuth app is registered as a "global" developer key
- All institutions in your consortium share OAuth apps

#### Option B: **Per-Institution** (Most Flexible)
```bash
CANVAS_INSTITUTIONS='[
  {"domain":"canvas.harvard.edu","clientId":"aaa","clientSecret":"bbb"},
  {"domain":"canvas.mit.edu","clientId":"ccc","clientSecret":"ddd"}
]'
```

This allows **different OAuth credentials per institution**.

✅ **Use when**:
- Each institution requires separate OAuth app registration
- You want fine-grained control per school
- Supporting multiple independent Canvas instances

#### Option C: **Hybrid** (Recommended)
```bash
# Global fallback
CANVAS_CLIENT_ID=global_id
CANVAS_CLIENT_SECRET=global_secret

# Specific overrides
CANVAS_INSTITUTIONS='[
  {"domain":"canvas.special-school.edu","clientId":"xxx","clientSecret":"yyy"}
]'
```

This supports **most institutions with fallback + specific overrides**.

---

## The OAuth Challenge

The **only requirement** is that each Canvas institution must have your OAuth application registered.

### Who Registers the OAuth App?

**Option 1: Canvas Administrators**
- Each institution's Canvas admin registers your app
- Provides you with Client ID and Client Secret
- You add these to your server config

**Option 2: Canvas Cloud Inherited Keys**
- Some Canvas Cloud consortiums support "inherited" developer keys
- One registration works across multiple institutions
- Ask Canvas support if this is available

**Option 3: User Self-Registration** (Not common)
- Some Canvas instances allow users to create their own OAuth apps
- Users would need to configure their own MCP server instance
- Not practical for a shared service

---

## Practical Deployment Strategy

### For a Public Service (like canvas.dunkirk.sh):

**Phase 1: Start with Major Institutions**
```bash
CANVAS_INSTITUTIONS='[
  {"domain":"canvas.harvard.edu","clientId":"...","clientSecret":"..."},
  {"domain":"canvas.mit.edu","clientId":"...","clientSecret":"..."},
  {"domain":"canvas.stanford.edu","clientId":"...","clientSecret":"..."}
]'
```

**Phase 2: Add Institutions on Request**
- Users request support for their institution
- Contact their Canvas admin to register OAuth app
- Add credentials to `CANVAS_INSTITUTIONS`

**Phase 3: Global Fallback** (if possible)
- Get a Canvas Cloud global developer key
- Set as `CANVAS_CLIENT_ID` + `CANVAS_CLIENT_SECRET`
- All institutions automatically supported

---

## User Experience

1. **User visits** `https://canvas.dunkirk.sh`
2. **Enters domain**: `canvas.myschool.edu`
3. **Server checks**: Is this domain configured?
   - ✅ Yes → Redirect to Canvas OAuth
   - ❌ No → Show error: "Contact admin to add your institution"
4. **After OAuth**: User gets an API key specific to their institution
5. **MCP calls**: Go to **their specific Canvas instance** (not shared)

---

## Technical Flow

```
User (canvas.harvard.edu)
    ↓
Server checks OAuth config for "canvas.harvard.edu"
    ↓
Redirects to https://canvas.harvard.edu/login/oauth2/auth
    ↓
Harvard Canvas authenticates user
    ↓
Redirects back with code
    ↓
Server exchanges code for token (at Harvard's Canvas)
    ↓
Stores Harvard token (encrypted) + generates API key
    ↓
MCP client uses API key
    ↓
Server proxies requests to canvas.harvard.edu with user's token
```

**Key point**: Each user's API calls go to **their own institution's Canvas instance**, using **their own OAuth token**.

---

## What You Need to Support "Any Institution"

### Technically:
✅ **Already built!** The server accepts any domain and handles per-institution OAuth.

### Practically:
You need OAuth credentials for each institution. Options:

1. **Contact Canvas Cloud** → Ask about global developer keys
2. **Start with your institution** → Get it working for one school first
3. **Add institutions incrementally** → As users request support
4. **Open registration** → Allow users to provide their own OAuth credentials (advanced)

---

## Recommendation

**Start with Option A** (Global/Wildcard) if possible:
- Contact Canvas support about Cloud global keys
- Mention you're building a cross-institution MCP service
- Ask if inherited developer keys are available

**If not available**, use **Option B** (Per-Institution):
- Start with your own Canvas instance
- Add others as requested
- Build a self-service OAuth registration flow (future feature)

---

## Summary

✅ **Yes, the server works with any Canvas institution**
✅ **Users can enter any Canvas domain**
✅ **Server handles institution-specific OAuth**
✅ **Each user's API calls go to their own Canvas instance**

❓ **Only requirement**: OAuth app must be registered with each institution
💡 **Solution**: Start with global config, add institutions as needed, or contact Canvas about Cloud global keys
