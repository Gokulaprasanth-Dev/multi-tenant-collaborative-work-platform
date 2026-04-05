import { IEmailProvider, SendEmailOptions } from './email.provider';
import { SesAdapter } from './ses.adapter';
import { SendGridAdapter } from './sendgrid.adapter';
import { SmtpAdapter } from './smtp.adapter';
import { renderTemplate } from './template.renderer';
import { config } from '../../../shared/config';
import { logger } from '../../../shared/observability/logger';
import { withSpan } from '../../../shared/observability/tracer';

let primaryProvider: IEmailProvider;
let secondaryProvider: IEmailProvider | null;

function buildProviders(): void {
  if (config.emailProvider === 'smtp') {
    // Dev / local: SMTP (Mailpit) only — no fallback needed
    primaryProvider = new SmtpAdapter();
    secondaryProvider = null;
  } else if (config.emailProvider === 'ses') {
    primaryProvider = new SesAdapter();
    secondaryProvider = new SendGridAdapter();
  } else {
    primaryProvider = new SendGridAdapter();
    secondaryProvider = new SesAdapter();
  }
}

// Lazy initialise on first use to avoid startup errors if creds are missing
function getProviders(): { primary: IEmailProvider; secondary: IEmailProvider | null } {
  if (!primaryProvider) buildProviders();
  return { primary: primaryProvider, secondary: secondaryProvider };
}

/**
 * Sends an email using the configured primary provider.
 * On primary circuit breaker open: falls back to secondary provider.
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
  return withSpan('email.send', async () => {
    const { primary, secondary } = getProviders();
    try {
      await primary.send(options);
    } catch (err) {
      if (!secondary) throw err;
      logger.warn({ err, to: options.to }, 'emailService: primary provider failed, trying secondary');
      await secondary.send(options);
    }
  }, { 'email.to': options.to, 'email.subject': options.subject ?? '' });
}

/**
 * Renders a template and sends the email.
 * templateName must be a key in the templates directory without extension.
 */
export async function sendTemplateEmail(
  to: string,
  subject: string,
  templateName: string,
  data: Record<string, unknown>
): Promise<void> {
  const { html, text } = await renderTemplate(templateName, data);
  await sendEmail({ to, subject, htmlBody: html, textBody: text });
}
