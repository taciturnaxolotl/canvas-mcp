import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CanvasClient } from "./canvas.js";
import DB from "./db.js";

// Create MCP Server instance with user context
export function createMcpServer(userId: number): Server {
  const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

  const server = new Server(
    {
      name: "canvas-mcp",
      version: "1.0.0",
      title: "Canvas LMS",
      description: "Access your Canvas courses, assignments, grades, and announcements",
      websiteUrl: BASE_URL,
      icons: [
        {
          src: `${BASE_URL}/favicon.ico`,
          mimeType: "image/x-icon",
          sizes: ["32x32"],
        },
      ],
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register handlers with user context
  registerHandlers(server, userId);

  return server;
}

function registerHandlers(mcpServer: Server, userId: number) {

// Define tool schemas
const listCoursesSchema = z.object({
  enrollment_state: z
    .enum(["active", "completed", "invited", "rejected"])
    .optional(),
});

const getAssignmentSchema = z.object({
  course_id: z.number(),
  assignment_id: z.number(),
});

const getAnnouncementsSchema = z.object({
  course_id: z.number().optional(),
  limit: z.number().min(1).max(50).optional(),
});

const getGradesSchema = z.object({
  course_id: z.number().optional(),
});

// Tool definitions
const tools: Tool[] = [
  {
    name: "list_courses",
    description:
      "List Canvas courses for the authenticated user. Can filter by enrollment state (active, completed, invited, rejected).",
    inputSchema: {
      type: "object",
      properties: {
        enrollment_state: {
          type: "string",
          enum: ["active", "completed", "invited", "rejected"],
          description: "Filter courses by enrollment state",
        },
      },
    },
  },
  {
    name: "get_assignment",
    description:
      "Get detailed information about a specific assignment including description, due date, points, and submission details.",
    inputSchema: {
      type: "object",
      properties: {
        course_id: {
          type: "number",
          description: "The Canvas course ID",
        },
        assignment_id: {
          type: "number",
          description: "The Canvas assignment ID",
        },
      },
      required: ["course_id", "assignment_id"],
    },
  },
  {
    name: "get_upcoming_assignments",
    description:
      "Get upcoming assignments and deadlines for the next 30 days across all courses. Returns assignments with due dates, to-do items, and calendar events.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_announcements",
    description:
      "Get course announcements. Can retrieve announcements from a specific course or across all courses, sorted by most recent first.",
    inputSchema: {
      type: "object",
      properties: {
        course_id: {
          type: "number",
          description: "Optional course ID to get announcements from a specific course. If not provided, returns announcements from all courses.",
        },
        limit: {
          type: "number",
          description: "Maximum number of announcements to return (1-50). Default is 10.",
        },
      },
    },
  },
  {
    name: "get_grades",
    description:
      "Get grades and submission information. Can retrieve grades for a specific course (including individual assignment submissions) or overall grades across all courses.",
    inputSchema: {
      type: "object",
      properties: {
        course_id: {
          type: "number",
          description: "Optional course ID to get detailed grades and submissions for a specific course. If not provided, returns summary grades for all courses.",
        },
      },
    },
  },
];

  // Register list_tools handler
  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  // Register call_tool handler
  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Get user and Canvas token from database
    const userData = DB.raw
      .query("SELECT * FROM users WHERE id = ?")
      .get(userId) as any;

    if (!userData) {
      throw new Error("User not found");
    }

    const canvasToken = DB.getCanvasToken(userData);
    const client = new CanvasClient(userData.canvas_domain, canvasToken);

    // Log usage
    DB.logUsage(userId, name);
    DB.updateLastUsed(userId);

  try {
    switch (name) {
      case "list_courses": {
        const params = listCoursesSchema.parse(args);
        const courses = await client.listCourses(params);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(courses, null, 2),
            },
          ],
        };
      }

      case "get_assignment": {
        const params = getAssignmentSchema.parse(args);
        const assignment = await client.getAssignment(
          params.course_id,
          params.assignment_id
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(assignment, null, 2),
            },
          ],
        };
      }

      case "get_upcoming_assignments": {
        const upcoming = await client.getUpcomingAssignments();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(upcoming, null, 2),
            },
          ],
        };
      }

      case "get_announcements": {
        const params = getAnnouncementsSchema.parse(args);
        const announcements = await client.getCourseAnnouncements(
          params.course_id,
          params.limit
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(announcements, null, 2),
            },
          ],
        };
      }

      case "get_grades": {
        const params = getGradesSchema.parse(args);
        const grades = await client.getGradesAndSubmissions(params.course_id);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(grades, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
  });
}
