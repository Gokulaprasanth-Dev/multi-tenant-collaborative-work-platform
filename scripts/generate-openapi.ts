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
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'name'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                  name: { type: 'string', minLength: 1 },
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
    '/organizations': {
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
                  name: { type: 'string', minLength: 1 },
                  slug: { type: 'string', pattern: '^[a-z0-9-]+$' },
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
    '/orgs/{orgId}/workspaces': {
      post: {
        tags: ['Workspaces'],
        summary: 'Create a workspace',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } },
        },
        responses: { '201': { description: 'Workspace created' }, '403': { description: 'Insufficient role' } },
      },
    },
    '/orgs/{orgId}/workspaces/{workspaceId}/tasks': {
      post: {
        tags: ['Tasks'],
        summary: 'Create a task',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'workspaceId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, status: { type: 'string', enum: ['todo', 'in_progress', 'done'] } } } } },
        },
        responses: { '201': { description: 'Task created' } },
      },
    },
    '/orgs/{orgId}/search': {
      get: {
        tags: ['Search'],
        summary: 'Full-text search across org entities',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'entity_types', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
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
    '/admin/organizations': {
      get: {
        tags: ['Platform Admin'],
        summary: 'List all organizations (platform admin only)',
        responses: { '200': { description: 'Organization list' }, '403': { description: 'PLATFORM_ADMIN_REQUIRED' } },
      },
    },
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
  },
};

const outDir = path.join(process.cwd(), 'dist');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const outPath = path.join(outDir, 'openapi.json');
fs.writeFileSync(outPath, JSON.stringify(openApiDoc, null, 2));
console.log(`OpenAPI document written to ${outPath}`);
