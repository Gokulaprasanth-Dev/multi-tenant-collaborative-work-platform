/**
 * Unit tests for email template renderer
 *
 * Covers:
 * - renders task-assigned template with required fields
 * - renders invitation template
 * - renders email-verification template
 * - renderTemplate: handles optional fields (e.g. taskDueDate absent)
 * - renderTemplate: throws on unknown template name
 * - output includes both html and text fallback
 * - text fallback strips HTML tags
 */

import { renderTemplate } from '../../../src/modules/notification/email/template.renderer';

describe('renderTemplate', () => {
  it('renders task-assigned template and returns html + text', async () => {
    const result = await renderTemplate('task-assigned', {
      recipientName: 'Alice',
      actorName: 'Bob',
      taskTitle: 'Fix the bug',
      taskDueDate: '2025-12-31',
      taskUrl: 'https://app.example.com/tasks/123',
    });

    expect(result).toHaveProperty('html');
    expect(result).toHaveProperty('text');
    expect(typeof result.html).toBe('string');
    expect(typeof result.text).toBe('string');
    expect(result.html.length).toBeGreaterThan(0);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('interpolates Handlebars variables into the output', async () => {
    const result = await renderTemplate('task-assigned', {
      recipientName: 'TestRecipient',
      actorName: 'TestActor',
      taskTitle: 'UniqueTaskTitle-XYZ',
      taskUrl: 'https://example.com/t/1',
    });

    // Variables should be resolved — not present as raw {{...}} syntax
    expect(result.html).not.toContain('{{recipientName}}');
    expect(result.html).not.toContain('{{taskTitle}}');
    // The actual values should appear in HTML
    expect(result.html).toContain('TestActor');
    expect(result.html).toContain('UniqueTaskTitle-XYZ');
  });

  it('omits optional block when taskDueDate is absent', async () => {
    const withDue = await renderTemplate('task-assigned', {
      recipientName: 'Alice',
      actorName: 'Bob',
      taskTitle: 'Task',
      taskDueDate: '2025-01-01',
      taskUrl: 'https://example.com',
    });

    const withoutDue = await renderTemplate('task-assigned', {
      recipientName: 'Alice',
      actorName: 'Bob',
      taskTitle: 'Task',
      taskUrl: 'https://example.com',
    });

    // With date: "Due:" appears; without date: it shouldn't
    expect(withDue.html).toContain('2025-01-01');
    expect(withoutDue.html).not.toContain('Due:');
  });

  it('renders invitation template', async () => {
    const result = await renderTemplate('invitation', {
      recipientEmail: 'bob@example.com',
      orgName: 'Acme Corp',
      inviterName: 'Alice',
      role: 'member',
      inviteUrl: 'https://example.com/invite/abc',
      expiresAt: '2025-12-31',
    });

    expect(result.html.length).toBeGreaterThan(100);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('renders email-verification template', async () => {
    const result = await renderTemplate('email-verification', {
      recipientName: 'Charlie',
      verificationUrl: 'https://example.com/verify/token123',
    });

    expect(result.html.length).toBeGreaterThan(100);
    expect(result.html).not.toContain('{{verificationUrl}}');
  });

  it('throws on unknown template name', async () => {
    await expect(renderTemplate('nonexistent-template', {})).rejects.toThrow(
      'Email template not found: nonexistent-template'
    );
  });

  it('text fallback does not contain HTML tags', async () => {
    const result = await renderTemplate('task-assigned', {
      recipientName: 'Alice',
      actorName: 'Bob',
      taskTitle: 'Test Task',
      taskUrl: 'https://example.com',
    });

    // Text should not contain any HTML tags like <div>, <span>, etc.
    expect(result.text).not.toMatch(/<[^>]+>/);
  });
});
