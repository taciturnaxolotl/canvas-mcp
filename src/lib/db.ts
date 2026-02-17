import { Database } from "bun:sqlite";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const db = new Database(process.env.DATABASE_PATH || "./canvas-mcp.db");

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canvas_user_id TEXT UNIQUE NOT NULL,
    canvas_domain TEXT NOT NULL,
    email TEXT,
    canvas_access_token TEXT NOT NULL,
    canvas_refresh_token TEXT,
    mcp_api_key TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    token_expires_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    canvas_domain TEXT NOT NULL,
    state TEXT,
    api_key TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(mcp_api_key);
  CREATE INDEX IF NOT EXISTS idx_users_canvas_id ON users(canvas_user_id);
  CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`);

// Encryption utilities
const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY || "", "base64");
const ALGORITHM = "aes-256-gcm";

function encrypt(text: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // Return: iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

function decrypt(encryptedData: string): string {
  const [ivHex, authTagHex, encrypted] = encryptedData.split(":");

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

// Generate secure API key
function generateApiKey(): string {
  return `cmcp_${randomBytes(32).toString("base64url")}`;
}

// Hash API key for storage
async function hashApiKey(apiKey: string): Promise<string> {
  return await Bun.password.hash(apiKey, {
    algorithm: "argon2id",
    memoryCost: 19456,
    timeCost: 2,
  });
}

// Verify API key
async function verifyApiKey(apiKey: string, hash: string): Promise<boolean> {
  return await Bun.password.verify(apiKey, hash);
}

export interface User {
  id: number;
  canvas_user_id: string;
  canvas_domain: string;
  email?: string;
  canvas_access_token: string;
  canvas_refresh_token?: string;
  mcp_api_key: string;
  created_at: number;
  last_used_at?: number;
  token_expires_at?: number;
}

export const DB = {
  // Raw database access
  raw: db,

  // Create or update user after OAuth
  async createOrUpdateUser(data: {
    canvas_user_id: string;
    canvas_domain: string;
    email?: string;
    canvas_access_token: string;
    canvas_refresh_token?: string;
    token_expires_at?: number;
  }): Promise<{ user: User; apiKey: string | null; isNewUser: boolean }> {
    const encryptedToken = encrypt(data.canvas_access_token);
    const encryptedRefreshToken = data.canvas_refresh_token
      ? encrypt(data.canvas_refresh_token)
      : null;

    // Check if user exists
    const existing = db
      .query("SELECT * FROM users WHERE canvas_user_id = ?")
      .get(data.canvas_user_id) as User | null;

    if (existing) {
      // Update existing user
      db.run(
        `UPDATE users SET
          canvas_access_token = ?,
          canvas_refresh_token = ?,
          token_expires_at = ?,
          last_used_at = ?
        WHERE canvas_user_id = ?`,
        [
          encryptedToken,
          encryptedRefreshToken,
          data.token_expires_at,
          Date.now(),
          data.canvas_user_id,
        ]
      );

      const user = db
        .query("SELECT * FROM users WHERE canvas_user_id = ?")
        .get(data.canvas_user_id) as User;

      // Return null for existing users - they need to regenerate if they lost it
      // We can't return the plaintext key since it's hashed in the database
      return { user, apiKey: null, isNewUser: false };
    } else {
      // Create new user with API key
      const apiKey = generateApiKey();
      const hashedApiKey = await hashApiKey(apiKey);

      const result = db.run(
        `INSERT INTO users (
          canvas_user_id, canvas_domain, email,
          canvas_access_token, canvas_refresh_token,
          mcp_api_key, created_at, token_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.canvas_user_id,
          data.canvas_domain,
          data.email,
          encryptedToken,
          encryptedRefreshToken,
          hashedApiKey,
          Date.now(),
          data.token_expires_at,
        ]
      );

      const user = db
        .query("SELECT * FROM users WHERE id = ?")
        .get(result.lastInsertRowid) as User;

      return { user, apiKey, isNewUser: true };
    }
  },

  // Get user by API key
  async getUserByApiKey(apiKey: string): Promise<User | null> {
    const users = db.query("SELECT * FROM users").all() as User[];

    for (const user of users) {
      if (await verifyApiKey(apiKey, user.mcp_api_key)) {
        return user;
      }
    }

    return null;
  },

  // Get user by Canvas user ID
  getUserByCanvasId(canvas_user_id: string): User | null {
    return db
      .query("SELECT * FROM users WHERE canvas_user_id = ?")
      .get(canvas_user_id) as User | null;
  },

  // Get decrypted Canvas token for user
  getCanvasToken(user: User): string {
    return decrypt(user.canvas_access_token);
  },

  // Get decrypted refresh token
  getRefreshToken(user: User): string | null {
    return user.canvas_refresh_token
      ? decrypt(user.canvas_refresh_token)
      : null;
  },

  // Log API usage
  logUsage(userId: number, endpoint: string) {
    db.run(
      "INSERT INTO usage_logs (user_id, endpoint, timestamp) VALUES (?, ?, ?)",
      [userId, endpoint, Date.now()]
    );
  },

  // Get usage stats for user
  getUsageStats(userId: number, since?: number) {
    const query = since
      ? "SELECT * FROM usage_logs WHERE user_id = ? AND timestamp >= ?"
      : "SELECT * FROM usage_logs WHERE user_id = ?";

    const params = since ? [userId, since] : [userId];
    return db.query(query).all(...params);
  },

  // Update last used timestamp
  updateLastUsed(userId: number) {
    db.run("UPDATE users SET last_used_at = ? WHERE id = ?", [
      Date.now(),
      userId,
    ]);
  },

  // Regenerate API key
  async regenerateApiKey(userId: number): Promise<string> {
    const newApiKey = generateApiKey();
    const hashedApiKey = await hashApiKey(newApiKey);

    db.run("UPDATE users SET mcp_api_key = ? WHERE id = ?", [
      hashedApiKey,
      userId,
    ]);

    return newApiKey;
  },

  // Session management
  createSession(sessionId: string, data: {
    user_id?: number;
    canvas_domain: string;
    state: string;
    api_key?: string;
    maxAge: number; // in seconds
  }) {
    const now = Date.now();
    db.run(
      `INSERT INTO sessions (id, user_id, canvas_domain, state, api_key, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        data.user_id || null,
        data.canvas_domain,
        data.state,
        data.api_key || null,
        now,
        now + data.maxAge * 1000,
      ]
    );
  },

  getSession(sessionId: string) {
    // Clean up expired sessions
    db.run("DELETE FROM sessions WHERE expires_at < ?", [Date.now()]);

    return db
      .query("SELECT * FROM sessions WHERE id = ? AND expires_at > ?")
      .get(sessionId, Date.now()) as any;
  },

  updateSession(sessionId: string, data: Partial<{ user_id: number; api_key: string }>) {
    const updates: string[] = [];
    const values: any[] = [];

    if (data.user_id !== undefined) {
      updates.push("user_id = ?");
      values.push(data.user_id);
    }
    if (data.api_key !== undefined) {
      updates.push("api_key = ?");
      values.push(data.api_key);
    }

    if (updates.length > 0) {
      values.push(sessionId);
      db.run(
        `UPDATE sessions SET ${updates.join(", ")} WHERE id = ?`,
        values
      );
    }
  },

  deleteSession(sessionId: string) {
    db.run("DELETE FROM sessions WHERE id = ?", [sessionId]);
  },

  clearApiKeyFromSession(sessionId: string) {
    db.run("UPDATE sessions SET api_key = NULL WHERE id = ?", [sessionId]);
  },

  // Get session by API key (for MCP authentication)
  getSessionByToken(token: string) {
    // Clean up expired sessions
    db.run("DELETE FROM sessions WHERE expires_at < ?", [Date.now()]);

    return db
      .query("SELECT * FROM sessions WHERE api_key = ? AND expires_at > ?")
      .get(token, Date.now()) as any;
  },
};

export default DB;
