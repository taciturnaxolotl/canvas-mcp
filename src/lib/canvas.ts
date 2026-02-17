// Simple in-memory cache with TTL
interface CacheEntry {
	data: any;
	expiresAt: number;
}

class SimpleCache {
	private cache = new Map<string, CacheEntry>();
	private pendingRequests = new Map<string, Promise<any>>();

	get(key: string): any | null {
		const entry = this.cache.get(key);
		if (!entry) return null;

		if (Date.now() > entry.expiresAt) {
			this.cache.delete(key);
			return null;
		}

		return entry.data;
	}

	set(key: string, data: any, ttlMs: number): void {
		this.cache.set(key, {
			data,
			expiresAt: Date.now() + ttlMs,
		});
	}

	getPendingRequest(key: string): Promise<any> | null {
		return this.pendingRequests.get(key) || null;
	}

	setPendingRequest(key: string, promise: Promise<any>): void {
		this.pendingRequests.set(key, promise);
		promise.finally(() => this.pendingRequests.delete(key));
	}

	clear(): void {
		this.cache.clear();
		this.pendingRequests.clear();
	}

	// Periodic cleanup of expired entries
	cleanup(): void {
		const now = Date.now();
		for (const [key, entry] of this.cache.entries()) {
			if (now > entry.expiresAt) {
				this.cache.delete(key);
			}
		}
	}
}

// Global cache instance (shared across all CanvasClient instances)
const globalCache = new SimpleCache();

// Cleanup expired cache entries every 5 minutes
setInterval(() => globalCache.cleanup(), 5 * 60 * 1000);

// Canvas API client
export class CanvasClient {
	private cache: SimpleCache;

	constructor(
		private domain: string,
		private accessToken: string,
		private cacheTTL: number = 5 * 60 * 1000, // Default: 5 minutes
	) {
		this.cache = globalCache;
	}

	private getCacheKey(path: string): string {
		// Include domain and user token hash in cache key for isolation
		const tokenHash = this.accessToken.slice(-8);
		return `${this.domain}:${tokenHash}:${path}`;
	}

	private async request(path: string, options?: RequestInit): Promise<any> {
		const url = `https://${this.domain}/api/v1${path}`;
		const cacheKey = this.getCacheKey(path);

		// Only cache GET requests
		const isGetRequest = !options?.method || options.method === "GET";

		if (isGetRequest) {
			// Check cache first
			const cached = this.cache.get(cacheKey);
			if (cached !== null) {
				return cached;
			}

			// Check if there's already a pending request for this path (request deduplication)
			const pending = this.cache.getPendingRequest(cacheKey);
			if (pending) {
				return pending;
			}
		}

		// Make the request
		const requestPromise = fetch(url, {
			...options,
			headers: {
				Authorization: `Bearer ${this.accessToken}`,
				"Content-Type": "application/json",
				...options?.headers,
			},
		}).then(async (response) => {
			if (!response.ok) {
				throw new Error(
					`Canvas API error: ${response.status} ${response.statusText}`,
				);
			}
			return response.json();
		});

		// Store pending request for deduplication
		if (isGetRequest) {
			this.cache.setPendingRequest(cacheKey, requestPromise);
		}

		try {
			const data = await requestPromise;

			// Cache the result
			if (isGetRequest) {
				this.cache.set(cacheKey, data, this.cacheTTL);
			}

			return data;
		} catch (error) {
			throw error;
		}
	}

	// Clear cache for this client (useful for testing or forcing refresh)
	clearCache(): void {
		// This clears the entire global cache - could be refined to only clear entries for this user
		this.cache.clear();
	}

	// Get cache statistics (for monitoring)
	static getCacheStats() {
		return {
			size: globalCache["cache"].size,
			pendingRequests: globalCache["pendingRequests"].size,
		};
	}

	async getCurrentUser() {
		return this.request("/users/self");
	}

	async listCourses(params?: { enrollment_state?: string }) {
		const query = new URLSearchParams(params as any).toString();
		const path = `/courses${query ? `?${query}` : ""}`;
		return this.request(path);
	}

	async searchAssignments(params?: {
		search_term?: string;
		course_ids?: number[];
	}) {
		// Get courses to search
		let courses: any[];
		if (params?.course_ids && params.course_ids.length > 0) {
			// Use specific course IDs
			courses = params.course_ids.map((id) => ({ id }));
		} else {
			// Get all active courses
			courses = await this.listCourses({ enrollment_state: "active" });
		}

		// Fetch assignments from all courses in parallel
		const assignmentPromises = courses.map((course) =>
			this.request(`/courses/${course.id}/assignments`)
				.then((assignments) => {
					// Add course info to each assignment
					assignments.forEach((assignment: any) => {
						assignment.course_id = course.id;
						assignment.course_name = course.name;
					});
					return assignments;
				})
				.catch((error) => {
					// Skip courses that fail (e.g., no permission)
					console.error(
						`Failed to fetch assignments for course ${course.id}:`,
						error,
					);
					return [];
				}),
		);

		const assignmentArrays = await Promise.all(assignmentPromises);
		const allAssignments = assignmentArrays.flat();

		// Filter by search term if provided
		if (params?.search_term) {
			const searchLower = params.search_term.toLowerCase();
			return allAssignments.filter(
				(assignment) =>
					assignment.name?.toLowerCase().includes(searchLower) ||
					assignment.description?.toLowerCase().includes(searchLower),
			);
		}

		return allAssignments;
	}

	async getAssignment(courseId: number, assignmentId: number) {
		return this.request(`/courses/${courseId}/assignments/${assignmentId}`);
	}

	async getUpcomingAssignments() {
		// Get upcoming assignments using the planner API
		const startDate = new Date().toISOString();
		const endDate = new Date(
			Date.now() + 30 * 24 * 60 * 60 * 1000,
		).toISOString(); // 30 days from now

		// Get all planner items without filter to see what Canvas shows in the planner
		return this.request(
			`/planner/items?start_date=${startDate}&end_date=${endDate}`,
		);
	}

	async getCourseAnnouncements(courseId?: number, limit: number = 10) {
		if (courseId) {
			// Get announcements for a specific course
			return this.request(
				`/courses/${courseId}/discussion_topics?only_announcements=true&per_page=${limit}`,
			);
		} else {
			// Get announcements across all courses in parallel
			const courses = await this.listCourses({ enrollment_state: "active" });

			const announcementPromises = courses.map((course) =>
				this.request(
					`/courses/${course.id}/discussion_topics?only_announcements=true&per_page=5`,
				)
					.then((announcements) => {
						announcements.forEach((announcement: any) => {
							announcement.course_id = course.id;
							announcement.course_name = course.name;
						});
						return announcements;
					})
					.catch((error) => {
						// Skip courses that fail
						console.error(
							`Failed to fetch announcements for course ${course.id}:`,
							error,
						);
						return [];
					}),
			);

			const announcementArrays = await Promise.all(announcementPromises);
			const allAnnouncements = announcementArrays.flat();

			// Sort by posted date (most recent first)
			allAnnouncements.sort(
				(a, b) =>
					new Date(b.posted_at || b.created_at).getTime() -
					new Date(a.posted_at || a.created_at).getTime(),
			);

			return allAnnouncements.slice(0, limit);
		}
	}

	async getGradesAndSubmissions(courseId?: number) {
		if (courseId) {
			// Get submissions for a specific course - parallelize these two requests
			const [enrollments, assignments] = await Promise.all([
				this.request(
					`/courses/${courseId}/enrollments?user_id=self&include[]=current_grading_period_scores&include[]=total_scores`,
				),
				this.request(`/courses/${courseId}/assignments?include[]=submission`),
			]);

			return {
				enrollments,
				assignments,
			};
		} else {
			// Get grades across all courses in parallel
			const courses = await this.listCourses({ enrollment_state: "active" });

			const gradePromises = courses.map((course) =>
				this.request(
					`/courses/${course.id}/enrollments?user_id=self&include[]=current_grading_period_scores&include[]=total_scores`,
				)
					.then((enrollments) => {
						return enrollments.map((enrollment: any) => ({
							course_id: course.id,
							course_name: course.name,
							course_code: course.course_code,
							current_grade: enrollment.grades?.current_grade,
							current_score: enrollment.grades?.current_score,
							final_grade: enrollment.grades?.final_grade,
							final_score: enrollment.grades?.final_score,
						}));
					})
					.catch((error) => {
						console.error(
							`Failed to fetch grades for course ${course.id}:`,
							error,
						);
						return [];
					}),
			);

			const gradeArrays = await Promise.all(gradePromises);
			return gradeArrays.flat();
		}
	}
}

// OAuth helpers
export interface CanvasOAuthConfig {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	canvasDomain: string;
}

export function getAuthorizationUrl(
	config: CanvasOAuthConfig,
	state: string,
): string {
	const params = new URLSearchParams({
		client_id: config.clientId,
		response_type: "code",
		redirect_uri: config.redirectUri,
		state,
		scope: "url:GET|/api/v1/courses url:GET|/api/v1/assignments",
	});

	return `https://${config.canvasDomain}/login/oauth2/auth?${params.toString()}`;
}

export async function exchangeCodeForToken(
	config: CanvasOAuthConfig,
	code: string,
): Promise<{
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	user: any;
}> {
	const response = await fetch(
		`https://${config.canvasDomain}/login/oauth2/token`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				grant_type: "authorization_code",
				client_id: config.clientId,
				client_secret: config.clientSecret,
				redirect_uri: config.redirectUri,
				code,
			}),
		},
	);

	if (!response.ok) {
		throw new Error(`OAuth token exchange failed: ${response.statusText}`);
	}

	const data = await response.json();

	// Get user info
	const client = new CanvasClient(config.canvasDomain, data.access_token);
	const user = await client.getCurrentUser();

	return {
		access_token: data.access_token,
		refresh_token: data.refresh_token,
		expires_in: data.expires_in,
		user,
	};
}

export async function refreshAccessToken(
	config: CanvasOAuthConfig,
	refreshToken: string,
): Promise<{ access_token: string; expires_in?: number }> {
	const response = await fetch(
		`https://${config.canvasDomain}/login/oauth2/token`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				grant_type: "refresh_token",
				client_id: config.clientId,
				client_secret: config.clientSecret,
				refresh_token: refreshToken,
			}),
		},
	);

	if (!response.ok) {
		throw new Error(`Token refresh failed: ${response.statusText}`);
	}

	return response.json();
}
