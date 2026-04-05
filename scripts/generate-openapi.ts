/**
 * TASK-106 — Generate OpenAPI 3.1 document from Zod schemas.
 * Writes to dist/openapi.json.
 * Usage: npm run generate:openapi
 */
import * as fs from 'fs';
import * as path from 'path';

const openApiDoc = {
  openapi: '3.1.0',
  info: {
    title: 'Multi-Tenant Collaborative Work Platform API',
    version: '1.0.0',
    description: 'REST API for the multi-tenant SaaS platform.',
    contact: { name: 'Platform Team' },
  },
  servers: [
    { url: 'http://localhost:3000/api/v1', description: 'Local development' },
    { url: 'https://api.example.com/api/v1', description: 'Production' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        required: ['success', 'code', 'message'],
        properties: {
          success: { type: 'boolean', example: false },
          code: { type: 'string', example: 'VALIDATION_ERROR' },
          message: { type: 'string' },
          errors: { type: 'array', items: { type: 'object' } },
        },
      },
      SuccessResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'object' },
          meta: { type: 'object' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    // ── Health ────────────────────────────────────────────────────────────
    '/live': {
      get: {
        tags: ['Health'],
        summary: 'Liveness probe — always 200',
        security: [],
        responses: { '200': { description: 'Alive' } },
      },
    },
    '/ready': {
      get: {
        tags: ['Health'],
        summary: 'Readiness probe — 503 during migrations, 200 after',
        security: [],
        responses: { '200': { description: 'Ready' }, '503': { description: 'Migrations in progress' } },
      },
    },
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check — DB and Redis status',
        security: [],
        responses: { '200': { description: 'All checks passing' }, '503': { description: 'One or more checks failing' } },
      },
    },

    // ── Auth ──────────────────────────────────────────────────────────────
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new user',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'name'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8, maxLength: 128 },
                  name: { type: 'string', minLength: 1, maxLength: 255 },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'User registered successfully' },
          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '409': { description: 'Email already registered' },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login with email and password',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                  orgId: { type: 'string', format: 'uuid' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Login successful — returns access and refresh tokens' },
          '401': { description: 'Invalid credentials' },
        },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Refresh access token',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['refreshToken'],
                properties: { refreshToken: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'New access token issued' },
          '401': { description: 'Invalid or expired refresh token' },
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Logout and revoke refresh token',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['refreshToken'],
                properties: { refreshToken: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Logged out' } },
      },
    },
    '/auth/verify-email': {
      get: {
        tags: ['Auth'],
        summary: 'Verify email address via token link',
        security: [],
        parameters: [{ name: 'token', in: 'query', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Email verified' },
          '400': { description: 'Invalid or expired token' },
        },
      },
    },
    '/auth/verify-email/resend': {
      post: {
        tags: ['Auth'],
        summary: 'Resend email verification link',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: { email: { type: 'string', format: 'email' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Verification email sent' } },
      },
    },
    '/auth/password-reset/request': {
      post: {
        tags: ['Auth'],
        summary: 'Request password reset email',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: { email: { type: 'string', format: 'email' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Reset email sent if account exists' } },
      },
    },
    '/auth/password-reset/confirm': {
      post: {
        tags: ['Auth'],
        summary: 'Confirm password reset with token',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token', 'newPassword'],
                properties: {
                  token: { type: 'string' },
                  newPassword: { type: 'string', minLength: 8, maxLength: 128 },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Password reset successfully' },
          '400': { description: 'Invalid or expired token' },
        },
      },
    },
    '/auth/oauth/google': {
      post: {
        tags: ['Auth'],
        summary: 'Login or register via Google OAuth',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['idToken'],
                properties: { idToken: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Authenticated — returns tokens' } },
      },
    },
    '/auth/magic-link/request': {
      post: {
        tags: ['Auth'],
        summary: 'Request a magic link login email',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  orgId: { type: 'string', format: 'uuid' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Magic link sent' } },
      },
    },
    '/auth/magic-link/verify': {
      post: {
        tags: ['Auth'],
        summary: 'Verify magic link token',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token'],
                properties: { token: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Authenticated — returns tokens' },
          '400': { description: 'Invalid or expired token' },
        },
      },
    },
    '/auth/saml/{orgId}/callback': {
      post: {
        tags: ['Auth'],
        summary: 'SAML SSO callback',
        security: [],
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'SAML authentication successful' } },
      },
    },

    // ── Users ─────────────────────────────────────────────────────────────
    '/me': {
      get: {
        tags: ['Users'],
        summary: 'Get current user profile',
        responses: {
          '200': { description: 'Current user', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
          '404': { description: 'User not found' },
        },
      },
    },

    // ── Organizations ─────────────────────────────────────────────────────
    '/orgs': {
      post: {
        tags: ['Organizations'],
        summary: 'Create a new organization',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'slug'],
                properties: {
                  name: { type: 'string', minLength: 1, maxLength: 255 },
                  slug: { type: 'string', pattern: '^[a-z0-9-]+$', minLength: 2, maxLength: 100 },
                  timezone: { type: 'string' },
                  locale: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Organization created' },
          '400': { description: 'Validation error' },
          '409': { description: 'Slug already taken' },
        },
      },
    },
    '/orgs/{orgId}': {
      get: {
        tags: ['Organizations'],
        summary: 'Get organization by ID',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Organization details' }, '404': { description: 'Not found' } },
      },
      patch: {
        tags: ['Organizations'],
        summary: 'Update organization settings',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['version'],
                properties: {
                  name: { type: 'string', minLength: 1, maxLength: 255 },
                  slug: { type: 'string', pattern: '^[a-z0-9-]+$' },
                  timezone: { type: 'string' },
                  locale: { type: 'string' },
                  mfa_required: { type: 'boolean' },
                  account_lockout_attempts: { type: 'integer', minimum: 3, maximum: 20 },
                  version: { type: 'integer', minimum: 1 },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Updated organization' }, '403': { description: 'Insufficient role' } },
      },
    },
    '/orgs/{orgId}/suspend': {
      post: {
        tags: ['Organizations'],
        summary: 'Suspend an organization',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reason'],
                properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } },
              },
            },
          },
        },
        responses: { '200': { description: 'Organization suspended' }, '403': { description: 'Insufficient role' } },
      },
    },
    '/orgs/{orgId}/reactivate': {
      post: {
        tags: ['Organizations'],
        summary: 'Reactivate a suspended organization',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Organization reactivated' }, '403': { description: 'Insufficient role' } },
      },
    },
    '/orgs/{orgId}/members': {
      get: {
        tags: ['Organizations'],
        summary: 'List organization members',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Member list' } },
      },
    },
    '/orgs/{orgId}/members/{userId}/role': {
      patch: {
        tags: ['Organizations'],
        summary: 'Update a member\'s role',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['role'],
                properties: { role: { type: 'string', enum: ['org_admin', 'member', 'guest'] } },
              },
            },
          },
        },
        responses: { '200': { description: 'Role updated' }, '403': { description: 'Insufficient role' }, '404': { description: 'Membership not found' } },
      },
    },
    '/orgs/{orgId}/members/{userId}': {
      delete: {
        tags: ['Organizations'],
        summary: 'Remove a member from organization',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Member removed' }, '403': { description: 'Insufficient role' } },
      },
    },
    '/orgs/{orgId}/invitations': {
      post: {
        tags: ['Organizations'],
        summary: 'Invite a user to the organization',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'role'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  role: { type: 'string', enum: ['org_admin', 'member', 'guest'] },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Invitation created' }, '403': { description: 'Insufficient role' } },
      },
    },
    '/orgs/{orgId}/invitations/{invitationId}': {
      delete: {
        tags: ['Organizations'],
        summary: 'Revoke an invitation',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'invitationId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Invitation revoked' }, '403': { description: 'Insufficient role' } },
      },
    },
    '/orgs/invitations/accept': {
      post: {
        tags: ['Organizations'],
        summary: 'Accept an invitation by token',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token'],
                properties: { token: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Invitation accepted' }, '400': { description: 'Invalid or expired token' } },
      },
    },

    // ── Workspaces ────────────────────────────────────────────────────────
    '/orgs/{orgId}/workspaces': {
      post: {
        tags: ['Workspaces'],
        summary: 'Create a workspace',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', minLength: 1, maxLength: 255 },
                  description: { type: 'string', maxLength: 1000, nullable: true },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Workspace created' }, '403': { description: 'Insufficient role' } },
      },
      get: {
        tags: ['Workspaces'],
        summary: 'List workspaces in organization',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Workspace list' } },
      },
    },
    '/orgs/{orgId}/workspaces/{workspaceId}': {
      get: {
        tags: ['Workspaces'],
        summary: 'Get workspace by ID',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'workspaceId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Workspace details' }, '404': { description: 'Not found' } },
      },
      patch: {
        tags: ['Workspaces'],
        summary: 'Update workspace',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'workspaceId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['version'],
                properties: {
                  name: { type: 'string', minLength: 1, maxLength: 255 },
                  description: { type: 'string', maxLength: 1000, nullable: true },
                  status: { type: 'string', enum: ['active', 'archived'] },
                  version: { type: 'integer', minimum: 1 },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Updated workspace' } },
      },
      delete: {
        tags: ['Workspaces'],
        summary: 'Delete workspace',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'workspaceId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Workspace deleted' } },
      },
    },

    // ── Tasks ─────────────────────────────────────────────────────────────
    '/orgs/{orgId}/tasks': {
      post: {
        tags: ['Tasks'],
        summary: 'Create a task',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['workspace_id', 'title'],
                properties: {
                  workspace_id: { type: 'string', format: 'uuid' },
                  board_id: { type: 'string', format: 'uuid', nullable: true },
                  parent_task_id: { type: 'string', format: 'uuid', nullable: true },
                  title: { type: 'string', minLength: 1, maxLength: 500 },
                  description: { type: 'object', nullable: true },
                  status: { type: 'string', enum: ['todo', 'in_progress', 'in_review', 'done', 'cancelled'] },
                  priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
                  due_date: { type: 'string', format: 'date-time', nullable: true },
                  labels: { type: 'array', items: { type: 'string' } },
                  assignee_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Task created' } },
      },
      get: {
        tags: ['Tasks'],
        summary: 'List tasks in organization',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'workspace_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'board_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['todo', 'in_progress', 'in_review', 'done', 'cancelled'] } },
        ],
        responses: { '200': { description: 'Task list' } },
      },
    },
    '/orgs/{orgId}/tasks/{taskId}': {
      get: {
        tags: ['Tasks'],
        summary: 'Get task by ID',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'taskId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Task details' }, '404': { description: 'Not found' } },
      },
      patch: {
        tags: ['Tasks'],
        summary: 'Update task',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'taskId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['version'],
                properties: {
                  title: { type: 'string', minLength: 1, maxLength: 500 },
                  description: { type: 'object', nullable: true },
                  status: { type: 'string', enum: ['todo', 'in_progress', 'in_review', 'done', 'cancelled'] },
                  priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
                  due_date: { type: 'string', format: 'date-time', nullable: true },
                  labels: { type: 'array', items: { type: 'string' } },
                  assignee_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
                  version: { type: 'integer', minimum: 1 },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Updated task' } },
      },
      delete: {
        tags: ['Tasks'],
        summary: 'Delete task',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'taskId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Task deleted' } },
      },
    },
    '/orgs/{orgId}/tasks/{taskId}/dependencies': {
      post: {
        tags: ['Tasks'],
        summary: 'Add a task dependency',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'taskId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['blocked_task_id'],
                properties: { blocked_task_id: { type: 'string', format: 'uuid' } },
              },
            },
          },
        },
        responses: { '201': { description: 'Dependency added' } },
      },
      get: {
        tags: ['Tasks'],
        summary: 'List task dependencies',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'taskId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Dependency list' } },
      },
    },
    '/orgs/{orgId}/tasks/dependencies/{dependencyId}': {
      delete: {
        tags: ['Tasks'],
        summary: 'Remove a task dependency',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'dependencyId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Dependency removed' } },
      },
    },
    '/orgs/{orgId}/tasks/bulk/status': {
      post: {
        tags: ['Tasks'],
        summary: 'Bulk update task status',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['task_ids', 'status'],
                properties: {
                  task_ids: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1, maxItems: 100 },
                  status: { type: 'string', enum: ['todo', 'in_progress', 'in_review', 'done', 'cancelled'] },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Bulk status updated' } },
      },
    },
    '/orgs/{orgId}/tasks/bulk': {
      delete: {
        tags: ['Tasks'],
        summary: 'Bulk delete tasks',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['task_ids'],
                properties: {
                  task_ids: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1, maxItems: 100 },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Tasks deleted' } },
      },
    },
    '/orgs/{orgId}/task-templates': {
      post: {
        tags: ['Tasks'],
        summary: 'Create a task template',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', minLength: 1, maxLength: 255 },
                  default_title: { type: 'string', maxLength: 500, nullable: true },
                  default_description: { type: 'object', nullable: true },
                  default_priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], nullable: true },
                  default_labels: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Template created' } },
      },
      get: {
        tags: ['Tasks'],
        summary: 'List task templates',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Template list' } },
      },
    },
    '/orgs/{orgId}/task-templates/{templateId}': {
      delete: {
        tags: ['Tasks'],
        summary: 'Delete a task template',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'templateId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Template deleted' } },
      },
    },
    '/orgs/{orgId}/tasks/{taskId}/comments': {
      post: {
        tags: ['Tasks'],
        summary: 'Add a comment to a task',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'taskId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['body'],
                properties: {
                  body: { type: 'object' },
                  parent_comment_id: { type: 'string', format: 'uuid', nullable: true },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Comment created' } },
      },
      get: {
        tags: ['Tasks'],
        summary: 'List comments on a task',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'taskId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Comment list' } },
      },
    },
    '/orgs/{orgId}/tasks/{taskId}/comments/{commentId}': {
      delete: {
        tags: ['Tasks'],
        summary: 'Delete a comment',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'taskId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'commentId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Comment deleted' } },
      },
    },
    '/orgs/{orgId}/tasks/{taskId}/activity': {
      get: {
        tags: ['Tasks'],
        summary: 'Get activity log for a task',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'taskId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Activity log' } },
      },
    },
    '/orgs/{orgId}/activity': {
      get: {
        tags: ['Tasks'],
        summary: 'Get organization-level activity log',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100, maximum: 200 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: { '200': { description: 'Activity log' } },
      },
    },

    // ── Chat ──────────────────────────────────────────────────────────────
    '/orgs/{orgId}/channels/direct': {
      post: {
        tags: ['Chat'],
        summary: 'Create or get a direct message channel',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['other_user_id'],
                properties: { other_user_id: { type: 'string', format: 'uuid' } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Existing DM channel returned' },
          '201': { description: 'New DM channel created' },
          '400': { description: 'Cannot create a direct message channel with yourself (CANNOT_DM_SELF)' },
        },
      },
    },
    '/orgs/{orgId}/channels/group': {
      post: {
        tags: ['Chat'],
        summary: 'Create a group channel',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'member_ids'],
                properties: {
                  name: { type: 'string', minLength: 1, maxLength: 255 },
                  member_ids: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 2 },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Group channel created' } },
      },
    },
    '/orgs/{orgId}/channels': {
      get: {
        tags: ['Chat'],
        summary: 'List channels in organization',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Channel list' } },
      },
    },
    '/orgs/{orgId}/channels/{channelId}': {
      get: {
        tags: ['Chat'],
        summary: 'Get channel by ID',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'channelId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Channel details' }, '404': { description: 'Not found' } },
      },
    },
    '/orgs/{orgId}/channels/{channelId}/messages': {
      post: {
        tags: ['Chat'],
        summary: 'Send a message to a channel',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'channelId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['body', 'client_message_id'],
                properties: {
                  body: { type: 'string', minLength: 1 },
                  body_parsed: { type: 'object', nullable: true },
                  client_message_id: { type: 'string', format: 'uuid' },
                  parent_message_id: { type: 'string', format: 'uuid', nullable: true },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Message sent' } },
      },
      get: {
        tags: ['Chat'],
        summary: 'List messages in a channel',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'channelId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
          { name: 'before_sequence', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'Message list' } },
      },
    },
    '/orgs/{orgId}/channels/{channelId}/messages/{messageId}': {
      delete: {
        tags: ['Chat'],
        summary: 'Delete a message',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'channelId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'messageId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Message deleted' } },
      },
    },

    // ── Notifications ─────────────────────────────────────────────────────
    '/orgs/{orgId}/notifications': {
      get: {
        tags: ['Notifications'],
        summary: 'List notifications for current user',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'unread_only', in: 'query', schema: { type: 'boolean' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: { '200': { description: 'Notification list' } },
      },
    },
    '/orgs/{orgId}/notifications/{notificationId}/read': {
      patch: {
        tags: ['Notifications'],
        summary: 'Mark a notification as read',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'notificationId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Marked as read' } },
      },
    },
    '/orgs/{orgId}/notifications/read-all': {
      post: {
        tags: ['Notifications'],
        summary: 'Mark all notifications as read',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'All notifications marked as read' } },
      },
    },
    '/orgs/{orgId}/notification-preferences': {
      get: {
        tags: ['Notifications'],
        summary: 'List notification preferences',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Preference list' } },
      },
    },
    '/orgs/{orgId}/notification-preferences/{eventType}': {
      patch: {
        tags: ['Notifications'],
        summary: 'Update notification preference for an event type',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'eventType', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  channel_inapp: { type: 'boolean' },
                  channel_email: { type: 'boolean' },
                  channel_push: { type: 'boolean' },
                  digest_mode: { type: 'string', enum: ['realtime', 'daily_digest'] },
                  quiet_hours_start: { type: 'string', nullable: true },
                  quiet_hours_end: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Preference updated' } },
      },
    },
    '/notifications/unsubscribe': {
      get: {
        tags: ['Notifications'],
        summary: 'Unsubscribe from email notifications (public email link)',
        security: [],
        parameters: [
          { name: 'token', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'userId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'orgId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'eventType', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Unsubscribed' }, '400': { description: 'Invalid token' } },
      },
    },

    // ── Files ─────────────────────────────────────────────────────────────
    '/orgs/{orgId}/files/upload-url': {
      post: {
        tags: ['Files'],
        summary: 'Request a presigned S3 upload URL',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['filename', 'mimeType', 'sizeBytes'],
                properties: {
                  filename: { type: 'string', minLength: 1, maxLength: 255 },
                  mimeType: { type: 'string' },
                  sizeBytes: { type: 'integer', minimum: 1 },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Upload URL and file record created' } },
      },
    },
    '/orgs/{orgId}/files': {
      get: {
        tags: ['Files'],
        summary: 'List files in organization',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: { '200': { description: 'File list' } },
      },
    },
    '/orgs/{orgId}/files/{fileId}': {
      get: {
        tags: ['Files'],
        summary: 'Get file metadata by ID',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'fileId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'File metadata' }, '404': { description: 'Not found' } },
      },
    },
    '/orgs/{orgId}/files/{fileId}/download-url': {
      get: {
        tags: ['Files'],
        summary: 'Get a presigned download URL for a file',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'fileId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Presigned download URL' },
          '202': { description: 'File scan in progress — retry after 30s' },
          '404': { description: 'Not found' },
        },
      },
    },

    // ── Webhooks ──────────────────────────────────────────────────────────
    '/orgs/{orgId}/webhooks': {
      post: {
        tags: ['Webhooks'],
        summary: 'Register a webhook endpoint',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['url', 'events'],
                properties: {
                  url: { type: 'string', format: 'uri' },
                  events: {
                    type: 'array',
                    items: {
                      type: 'string',
                      enum: ['task.created', 'task.updated', 'task.deleted', 'message.created', 'file.confirmed', 'payment.captured', 'payment.failed', 'member.invited', 'member.removed'],
                    },
                    minItems: 1,
                  },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Webhook registered' } },
      },
      get: {
        tags: ['Webhooks'],
        summary: 'List webhooks for organization',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Webhook list' } },
      },
    },
    '/orgs/{orgId}/webhooks/{webhookId}': {
      delete: {
        tags: ['Webhooks'],
        summary: 'Delete a webhook',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'webhookId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Webhook deleted' } },
      },
    },
    '/orgs/{orgId}/webhooks/{webhookId}/rotate-secret': {
      post: {
        tags: ['Webhooks'],
        summary: 'Rotate webhook signing secret',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'webhookId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'New secret returned' } },
      },
    },

    // ── Payments ──────────────────────────────────────────────────────────
    '/orgs/{orgId}/payments/orders': {
      post: {
        tags: ['Payments'],
        summary: 'Create a Razorpay payment order',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['plan_tier', 'billing_cycle'],
                properties: {
                  plan_tier: { type: 'string', enum: ['pro', 'business', 'enterprise'] },
                  billing_cycle: { type: 'string', enum: ['monthly', 'annual'] },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Razorpay order created' } },
      },
    },
    '/orgs/{orgId}/payments/verify': {
      post: {
        tags: ['Payments'],
        summary: 'Verify a Razorpay payment',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['razorpay_order_id', 'razorpay_payment_id', 'razorpay_signature'],
                properties: {
                  razorpay_order_id: { type: 'string' },
                  razorpay_payment_id: { type: 'string' },
                  razorpay_signature: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Payment verified' }, '400': { description: 'Signature mismatch' } },
      },
    },
    '/orgs/{orgId}/payments': {
      get: {
        tags: ['Payments'],
        summary: 'List payment history for organization',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: { '200': { description: 'Payment list' } },
      },
    },
    '/orgs/{orgId}/subscription': {
      get: {
        tags: ['Payments'],
        summary: 'Get current subscription for organization',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Subscription details' } },
      },
    },
    '/webhooks/razorpay': {
      post: {
        tags: ['Payments'],
        summary: 'Razorpay webhook receiver',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Event received' }, '400': { description: 'Invalid signature or payload' } },
      },
    },

    // ── Search ────────────────────────────────────────────────────────────
    '/orgs/{orgId}/search': {
      get: {
        tags: ['Search'],
        summary: 'Full-text search across org entities',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 1, maxLength: 200 } },
          { name: 'entity_types', in: 'query', schema: { type: 'string', description: 'Comma-separated: task,message,file,user' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          '200': {
            description: 'Search results. meta.search_degraded=true when using PostgresFTS fallback.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } },
          },
        },
      },
    },

    // ── GDPR ──────────────────────────────────────────────────────────────
    '/orgs/{orgId}/gdpr/export-request': {
      post: {
        tags: ['GDPR'],
        summary: 'Request a user data export (GDPR Art. 15)',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '202': { description: 'Export job enqueued — download link delivered by email' } },
      },
    },
    '/orgs/{orgId}/gdpr/erasure-request': {
      post: {
        tags: ['GDPR'],
        summary: 'Request user erasure (GDPR Art. 17) — requires re-authentication',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['password', 'confirm'],
                properties: {
                  password: { type: 'string' },
                  confirm: { type: 'string', enum: ['DELETE MY ACCOUNT'] },
                },
              },
            },
          },
        },
        responses: { '202': { description: 'Erasure job enqueued' }, '401': { description: 'Incorrect password' } },
      },
    },
    '/admin/orgs/{orgId}/gdpr/org-export': {
      post: {
        tags: ['GDPR'],
        summary: 'Platform admin: enqueue org-level data export',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '202': { description: 'Org export enqueued' }, '403': { description: 'PLATFORM_ADMIN_REQUIRED' } },
      },
    },
    '/admin/orgs/{orgId}/offboard': {
      post: {
        tags: ['GDPR'],
        summary: 'Platform admin: initiate org offboarding',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '202': { description: 'Offboarding initiated' }, '403': { description: 'PLATFORM_ADMIN_REQUIRED' } },
      },
    },

    // ── Platform Admin ────────────────────────────────────────────────────
    '/admin/organizations': {
      get: {
        tags: ['Platform Admin'],
        summary: 'List all organizations (platform admin only)',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: { '200': { description: 'Organization list' }, '403': { description: 'PLATFORM_ADMIN_REQUIRED' } },
      },
    },
    '/admin/organizations/{orgId}/suspend': {
      post: {
        tags: ['Platform Admin'],
        summary: 'Suspend an organization (platform admin)',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reason'],
                properties: { reason: { type: 'string', minLength: 1 } },
              },
            },
          },
        },
        responses: { '200': { description: 'Organization suspended' }, '403': { description: 'PLATFORM_ADMIN_REQUIRED' } },
      },
    },
    '/admin/organizations/{orgId}/reactivate': {
      post: {
        tags: ['Platform Admin'],
        summary: 'Reactivate an organization (platform admin)',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Organization reactivated' }, '403': { description: 'PLATFORM_ADMIN_REQUIRED' } },
      },
    },
    '/admin/organizations/{orgId}/offboard': {
      post: {
        tags: ['Platform Admin'],
        summary: 'Offboard an organization (platform admin)',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Offboarding initiated' }, '403': { description: 'PLATFORM_ADMIN_REQUIRED' } },
      },
    },
    '/admin/users/{userId}/unlock': {
      post: {
        tags: ['Platform Admin'],
        summary: 'Unlock a locked user account (platform admin)',
        parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'User unlocked' }, '403': { description: 'PLATFORM_ADMIN_REQUIRED' } },
      },
    },
    '/admin/users/{userId}/reset-mfa': {
      post: {
        tags: ['Platform Admin'],
        summary: 'Reset MFA for a user (platform admin)',
        parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'MFA reset' }, '403': { description: 'PLATFORM_ADMIN_REQUIRED' } },
      },
    },
    '/admin/organizations/{orgId}/trigger-payment-recovery': {
      post: {
        tags: ['Platform Admin'],
        summary: 'Trigger payment recovery for an organization (platform admin)',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '202': { description: 'Recovery job queued' }, '403': { description: 'PLATFORM_ADMIN_REQUIRED' } },
      },
    },
    '/admin/outbox/{eventId}/replay': {
      post: {
        tags: ['Platform Admin'],
        summary: 'Replay an outbox event (platform admin)',
        parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Event replayed' }, '403': { description: 'PLATFORM_ADMIN_REQUIRED' } },
      },
    },
    '/admin/queues/{queueName}/requeue-dlq': {
      post: {
        tags: ['Platform Admin'],
        summary: 'Requeue dead-letter queue jobs (platform admin)',
        parameters: [{ name: 'queueName', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Jobs requeued' }, '403': { description: 'PLATFORM_ADMIN_REQUIRED' } },
      },
    },
    '/admin/organizations/{orgId}/reindex-search': {
      post: {
        tags: ['Platform Admin'],
        summary: 'Trigger search reindex for an organization (platform admin)',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '202': { description: 'Reindex job queued' }, '403': { description: 'PLATFORM_ADMIN_REQUIRED' } },
      },
    },
    '/admin/jwt/rotate-keys': {
      post: {
        tags: ['Platform Admin'],
        summary: 'Rotate JWT signing keys (platform admin)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['publicKey', 'kid'],
                properties: {
                  publicKey: { type: 'string' },
                  kid: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Keys rotated' }, '403': { description: 'PLATFORM_ADMIN_REQUIRED' } },
      },
    },

    // ── Feature Flags ─────────────────────────────────────────────────────
    '/admin/feature-flags': {
      get: {
        tags: ['Feature Flags'],
        summary: 'List all feature flags (platform admin)',
        responses: { '200': { description: 'Feature flag list' }, '403': { description: 'PLATFORM_ADMIN_REQUIRED' } },
      },
      post: {
        tags: ['Feature Flags'],
        summary: 'Create a feature flag (platform admin)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['key'],
                properties: {
                  key: { type: 'string', minLength: 1, maxLength: 100 },
                  is_globally_enabled: { type: 'boolean' },
                  description: { type: 'string' },
                  enabled_org_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
                  disabled_org_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Feature flag created' }, '403': { description: 'PLATFORM_ADMIN_REQUIRED' } },
      },
    },
    '/admin/feature-flags/{id}': {
      patch: {
        tags: ['Feature Flags'],
        summary: 'Update a feature flag (platform admin)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  is_globally_enabled: { type: 'boolean' },
                  description: { type: 'string' },
                  enabled_org_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
                  disabled_org_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Feature flag updated' }, '404': { description: 'Not found' } },
      },
      delete: {
        tags: ['Feature Flags'],
        summary: 'Delete a feature flag (platform admin)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Feature flag deleted' }, '403': { description: 'PLATFORM_ADMIN_REQUIRED' } },
      },
    },
  },
};

const outDir = path.join(process.cwd(), 'dist');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const outPath = path.join(outDir, 'openapi.json');
fs.writeFileSync(outPath, JSON.stringify(openApiDoc, null, 2));
console.log(`OpenAPI document written to ${outPath}`);
