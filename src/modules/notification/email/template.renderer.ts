import * as path from 'path';
import * as fs from 'fs';
import Handlebars from 'handlebars';
import mjml2html from 'mjml';

const TEMPLATES_DIR = path.join(__dirname, 'templates');

/**
 * Renders an email template.
 * Pipeline (audit issue 4.2 fix):
 *   1. Handlebars compile — resolves {{variable}} tokens
 *   2. MJML render — converts MJML markup to HTML
 *
 * Templates are `.mjml.hbs` files containing BOTH MJML tags and Handlebars variables.
 */
export async function renderTemplate(
  templateName: string,
  data: Record<string, unknown>
): Promise<{ html: string; text: string }> {
  const templatePath = path.join(TEMPLATES_DIR, `${templateName}.mjml.hbs`);

  let templateSource: string;
  try {
    templateSource = fs.readFileSync(templatePath, 'utf-8');
  } catch {
    throw new Error(`Email template not found: ${templateName}`);
  }

  // Step 1: Handlebars — resolve {{variable}} tokens in the MJML source
  const hbsCompiled = Handlebars.compile(templateSource)(data);

  // Step 2: MJML — render Handlebars-resolved MJML to HTML
  const mjmlResult = mjml2html(hbsCompiled, { validationLevel: 'soft' });

  if (mjmlResult.errors.length > 0) {
    // Non-fatal: log but continue (validationLevel: 'soft')
    mjmlResult.errors.forEach((e: { message: string }) => {
      process.stderr.write(`MJML warning [${templateName}]: ${e.message}\n`);
    });
  }

  // Generate plain-text fallback by stripping HTML tags
  const text = mjmlResult.html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { html: mjmlResult.html, text };
}
