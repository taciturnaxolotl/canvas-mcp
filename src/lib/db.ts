import { Database } from "bun:sqlite";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const db = new Database(process.env.DATABASE_PATH || "./canvas-mcp.db");

// In-memory cache for verified API keys
interface ApiKeyCacheEntry {
	userId: number;
	verifiedAt: number;
}

const apiKeyCache = new Map<string, ApiKeyCacheEntry>();
const CACHE_TTL = parseInt(process.env.API_KEY_CACHE_TTL || "900000"); // 15 minutes default

// Cache cleanup interval (runs every 5 minutes)
setInterval(
	() => {
		const now = Date.now();
		for (const [key, entry] of apiKeyCache.entries()) {
			if (now - entry.verifiedAt > CACHE_TTL) {
				apiKeyCache.delete(key);
			}
		}
	},
	5 * 60 * 1000,
);

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canvas_user_id TEXT,
    canvas_domain TEXT,
    email TEXT,
    canvas_access_token TEXT,
    canvas_refresh_token TEXT,
    mcp_api_key TEXT UNIQUE,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
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

  CREATE TABLE IF NOT EXISTS magic_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS auth_codes (
    code TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    code_challenge_method TEXT NOT NULL,
    scope TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS oauth_tokens (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    scope TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(mcp_api_key);
  CREATE INDEX IF NOT EXISTS idx_users_canvas_id ON users(canvas_user_id);
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_magic_links_token ON magic_links(token);
  CREATE INDEX IF NOT EXISTS idx_magic_links_email ON magic_links(email);
  CREATE INDEX IF NOT EXISTS idx_auth_codes_code ON auth_codes(code);
  CREATE INDEX IF NOT EXISTS idx_oauth_tokens_token ON oauth_tokens(token);
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

		// Check if user exists by canvas_user_id or email
		let existing = db
			.query("SELECT * FROM users WHERE canvas_user_id = ?")
			.get(data.canvas_user_id) as User | null;

		// If not found by canvas_user_id, check by email (for magic link users)
		if (!existing && data.email) {
			existing = db
				.query("SELECT * FROM users WHERE email = ? AND canvas_user_id IS NULL")
				.get(data.email) as User | null;
		}

		if (existing) {
			// Check if user needs an API key (magic link users)
			let apiKey: string | null = null;
			let hashedApiKey = existing.mcp_api_key;

			if (!hashedApiKey) {
				// Generate API key for magic link users connecting Canvas for first time
				apiKey = generateApiKey();
				hashedApiKey = await hashApiKey(apiKey);
			}

			// Update existing user (might not have canvas_user_id if from magic link)
			db.run(
				`UPDATE users SET
          canvas_user_id = ?,
          canvas_domain = ?,
          canvas_access_token = ?,
          canvas_refresh_token = ?,
          token_expires_at = ?,
          last_used_at = ?,
          mcp_api_key = ?
        WHERE id = ?`,
				[
					data.canvas_user_id,
					data.canvas_domain,
					encryptedToken,
					encryptedRefreshToken,
					data.token_expires_at,
					Date.now(),
					hashedApiKey,
					existing.id,
				],
			);

			const user = db
				.query("SELECT * FROM users WHERE id = ?")
				.get(existing.id) as User;

			// Return API key only if we just generated it (for magic link users)
			const isNewUser = apiKey !== null;
			return { user, apiKey, isNewUser };
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
				],
			);

			const user = db
				.query("SELECT * FROM users WHERE id = ?")
				.get(result.lastInsertRowid) as User;

			return { user, apiKey, isNewUser: true };
		}
	},

	// Get user by API key (with caching for performance)
	async getUserByApiKey(apiKey: string): Promise<User | null> {
		// Check cache first for O(1) lookup
		const cached = apiKeyCache.get(apiKey);
		if (cached && Date.now() - cached.verifiedAt < CACHE_TTL) {
			// Cache hit - fast path
			const user = db
				.query("SELECT * FROM users WHERE id = ?")
				.get(cached.userId) as User | null;

			if (user) {
				return user;
			}
			// User was deleted - invalidate cache entry
			apiKeyCache.delete(apiKey);
		}

		// Cache miss - perform full verification (slow path)
		const users = db
			.query("SELECT * FROM users WHERE mcp_api_key IS NOT NULL")
			.all() as User[];

		for (const user of users) {
			if (await verifyApiKey(apiKey, user.mcp_api_key)) {
				// Cache the verified key for future requests
				apiKeyCache.set(apiKey, {
					userId: user.id,
					verifiedAt: Date.now(),
				});
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
			[userId, endpoint, Date.now()],
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
		// Invalidate all cached entries for this user
		for (const [key, entry] of apiKeyCache.entries()) {
			if (entry.userId === userId) {
				apiKeyCache.delete(key);
			}
		}

		const newApiKey = generateApiKey();
		const hashedApiKey = await hashApiKey(newApiKey);

		db.run("UPDATE users SET mcp_api_key = ? WHERE id = ?", [
			hashedApiKey,
			userId,
		]);

		return newApiKey;
	},

	// Session management
	createSession(
		sessionId: string,
		data: {
			user_id?: number;
			canvas_domain: string;
			state: string;
			api_key?: string;
			maxAge: number; // in seconds
		},
	) {
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
			],
		);
	},

	getSession(sessionId: string) {
		return db
			.query("SELECT * FROM sessions WHERE id = ? AND expires_at > ?")
			.get(sessionId, Date.now()) as any;
	},

	updateSession(
		sessionId: string,
		data: Partial<{ user_id: number; api_key: string }>,
	) {
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
			db.run(`UPDATE sessions SET ${updates.join(", ")} WHERE id = ?`, values);
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
		return db
			.query("SELECT * FROM sessions WHERE api_key = ? AND expires_at > ?")
			.get(token, Date.now()) as any;
	},

	// Magic link authentication
	createMagicLink(email: string, token: string, expiresAt: number) {
		return db.run(
			"INSERT INTO magic_links (email, token, expires_at) VALUES (?, ?, ?)",
			[email, token, expiresAt],
		);
	},

	getMagicLink(token: string) {
		return db
			.query(
				"SELECT * FROM magic_links WHERE token = ? AND expires_at > ? AND used = 0",
			)
			.get(token, Date.now()) as any;
	},

	markMagicLinkUsed(token: string) {
		return db.run("UPDATE magic_links SET used = 1 WHERE token = ?", [token]);
	},

	getUserByEmail(email: string) {
		return db.query("SELECT * FROM users WHERE email = ?").get(email) as any;
	},

	// Update user with Canvas credentials (for magic link users)
	async updateUserCanvas(
		userId: number,
		canvasUserId: string,
		canvasDomain: string,
		canvasToken: string,
	): Promise<{ apiKey: string | null }> {
		const existing = db
			.query("SELECT * FROM users WHERE id = ?")
			.get(userId) as User | null;

		if (!existing) {
			throw new Error("User not found");
		}

		const encryptedToken = encrypt(canvasToken);

		// Generate API key if user doesn't have one
		let apiKey: string | null = null;
		let hashedApiKey = existing.mcp_api_key;

		if (!hashedApiKey) {
			apiKey = generateApiKey();
			hashedApiKey = await hashApiKey(apiKey);
		}

		// Update user with Canvas credentials
		db.run(
			`UPDATE users SET
        canvas_user_id = ?,
        canvas_domain = ?,
        canvas_access_token = ?,
        mcp_api_key = ?,
        last_used_at = ?
      WHERE id = ?`,
			[
				canvasUserId,
				canvasDomain,
				encryptedToken,
				hashedApiKey,
				Date.now(),
				userId,
			],
		);

		return { apiKey };
	},

	// Rate limiting for magic links
	canSendMagicLink(email: string, cooldownMs: number = 60000): boolean {
		// Check if a magic link was sent recently (within cooldown period)
		const recent = db
			.query(
				"SELECT * FROM magic_links WHERE email = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1",
			)
			.get(email, Date.now() - cooldownMs) as any;

		return !recent;
	},

	getLastMagicLinkTime(email: string): number | null {
		const recent = db
			.query(
				"SELECT created_at FROM magic_links WHERE email = ? ORDER BY created_at DESC LIMIT 1",
			)
			.get(email) as any;

		return recent ? recent.created_at : null;
	},

	// OAuth tokens
	createOAuthToken(
		userId: number,
		scope: string,
		expiresIn: number = 86400000,
	): string {
		const token = generateApiKey(); // Reuse the API key generator
		const expiresAt = Date.now() + expiresIn;

		db.run(
			"INSERT INTO oauth_tokens (token, user_id, scope, expires_at) VALUES (?, ?, ?, ?)",
			[token, userId, scope, expiresAt],
		);

		return token;
	},

	getUserByOAuthToken(token: string): User | null {
		const tokenData = db
			.query("SELECT * FROM oauth_tokens WHERE token = ? AND expires_at > ?")
			.get(token, Date.now()) as any;

		if (!tokenData) {
			return null;
		}

		return db
			.query("SELECT * FROM users WHERE id = ?")
			.get(tokenData.user_id) as User | null;
	},

	// Cache management utilities
	clearApiKeyCache() {
		apiKeyCache.clear();
	},

	invalidateUserCache(userId: number) {
		for (const [key, entry] of apiKeyCache.entries()) {
			if (entry.userId === userId) {
				apiKeyCache.delete(key);
			}
		}
	},

	getApiKeyCacheStats() {
		return {
			size: apiKeyCache.size,
			ttl: CACHE_TTL,
		};
	},

	// Background cleanup operations (run these periodically, not on request path)
	cleanupExpiredSessions(): number {
		const result = db.run("DELETE FROM sessions WHERE expires_at < ?", [
			Date.now(),
		]);
		return result.changes;
	},

	cleanupExpiredMagicLinks(): number {
		const result = db.run("DELETE FROM magic_links WHERE expires_at < ?", [
			Date.now(),
		]);
		return result.changes;
	},

	cleanupExpiredAuthCodes(): number {
		const result = db.run("DELETE FROM auth_codes WHERE expires_at < ?", [
			Date.now(),
		]);
		return result.changes;
	},

	cleanupExpiredOAuthTokens(): number {
		const result = db.run("DELETE FROM oauth_tokens WHERE expires_at < ?", [
			Date.now(),
		]);
		return result.changes;
	},

	// Clean up old usage logs (keep last 90 days)
	cleanupOldUsageLogs(retentionDays: number = 90): number {
		const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
		const result = db.run("DELETE FROM usage_logs WHERE timestamp < ?", [
			cutoffTime,
		]);
		return result.changes;
	},

	// Run all cleanup operations
	runAllCleanups(): { [key: string]: number } {
		const results = {
			sessions: this.cleanupExpiredSessions(),
			magicLinks: this.cleanupExpiredMagicLinks(),
			authCodes: this.cleanupExpiredAuthCodes(),
			oauthTokens: this.cleanupExpiredOAuthTokens(),
			usageLogs: this.cleanupOldUsageLogs(),
		};

		console.log("[Cleanup] Removed expired records:", results);
		return results;
	},
};

export default DB;
