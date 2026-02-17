// Canvas API client
export class CanvasClient {
  constructor(
    private domain: string,
    private accessToken: string
  ) {}

  private async request(path: string, options?: RequestInit): Promise<any> {
    const url = `https://${this.domain}/api/v1${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Canvas API error: ${response.status} ${response.statusText}`
      );
    }

    return response.json();
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
      courses = params.course_ids.map(id => ({ id }));
    } else {
      // Get all active courses
      courses = await this.listCourses({ enrollment_state: "active" });
    }

    // Fetch assignments from each course
    const allAssignments: any[] = [];
    for (const course of courses) {
      try {
        const assignments = await this.request(`/courses/${course.id}/assignments`);
        // Add course info to each assignment
        assignments.forEach((assignment: any) => {
          assignment.course_id = course.id;
          assignment.course_name = course.name;
        });
        allAssignments.push(...assignments);
      } catch (error) {
        // Skip courses that fail (e.g., no permission)
        console.error(`Failed to fetch assignments for course ${course.id}:`, error);
      }
    }

    // Filter by search term if provided
    if (params?.search_term) {
      const searchLower = params.search_term.toLowerCase();
      return allAssignments.filter(assignment =>
        assignment.name?.toLowerCase().includes(searchLower) ||
        assignment.description?.toLowerCase().includes(searchLower)
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
    const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days from now

    // Get all planner items without filter to see what Canvas shows in the planner
    return this.request(`/planner/items?start_date=${startDate}&end_date=${endDate}`);
  }

  async getCourseAnnouncements(courseId?: number, limit: number = 10) {
    if (courseId) {
      // Get announcements for a specific course
      return this.request(`/courses/${courseId}/discussion_topics?only_announcements=true&per_page=${limit}`);
    } else {
      // Get announcements across all courses
      const courses = await this.listCourses({ enrollment_state: "active" });
      const allAnnouncements: any[] = [];

      for (const course of courses) {
        try {
          const announcements = await this.request(`/courses/${course.id}/discussion_topics?only_announcements=true&per_page=5`);
          announcements.forEach((announcement: any) => {
            announcement.course_id = course.id;
            announcement.course_name = course.name;
          });
          allAnnouncements.push(...announcements);
        } catch (error) {
          // Skip courses that fail
          console.error(`Failed to fetch announcements for course ${course.id}:`, error);
        }
      }

      // Sort by posted date (most recent first)
      allAnnouncements.sort((a, b) =>
        new Date(b.posted_at || b.created_at).getTime() - new Date(a.posted_at || a.created_at).getTime()
      );

      return allAnnouncements.slice(0, limit);
    }
  }

  async getGradesAndSubmissions(courseId?: number) {
    if (courseId) {
      // Get submissions for a specific course
      const enrollments = await this.request(`/courses/${courseId}/enrollments?user_id=self&include[]=current_grading_period_scores&include[]=total_scores`);
      const assignments = await this.request(`/courses/${courseId}/assignments?include[]=submission`);

      return {
        enrollments,
        assignments
      };
    } else {
      // Get grades across all courses
      const courses = await this.listCourses({ enrollment_state: "active" });
      const allGrades: any[] = [];

      for (const course of courses) {
        try {
          const enrollments = await this.request(`/courses/${course.id}/enrollments?user_id=self&include[]=current_grading_period_scores&include[]=total_scores`);

          enrollments.forEach((enrollment: any) => {
            allGrades.push({
              course_id: course.id,
              course_name: course.name,
              course_code: course.course_code,
              current_grade: enrollment.grades?.current_grade,
              current_score: enrollment.grades?.current_score,
              final_grade: enrollment.grades?.final_grade,
              final_score: enrollment.grades?.final_score
            });
          });
        } catch (error) {
          console.error(`Failed to fetch grades for course ${course.id}:`, error);
        }
      }

      return allGrades;
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

export function getAuthorizationUrl(config: CanvasOAuthConfig, state: string): string {
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
  code: string
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
    }
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
  refreshToken: string
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
    }
  );

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.statusText}`);
  }

  return response.json();
}
