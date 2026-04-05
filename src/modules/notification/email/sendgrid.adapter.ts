import sgMail from '@sendgrid/mail';
import { IEmailProvider, SendEmailOptions } from './email.provider';
import { emailBreaker } from '../../../shared/circuit-breaker';
import { config } from '../../../shared/config';
import { logger } from '../../../shared/observability/logger';

export class SendGridAdapter implements IEmailProvider {
  private fromEmail: string;

  constructor() {
    sgMail.setApiKey(config.sendgridApiKey ?? '');
    this.fromEmail = config.awsSesFromEmail ?? 'no-reply@example.com';
  }

  async send(options: SendEmailOptions): Promise<void> {
    await emailBreaker.fire(async () => {
      await sgMail.send({
        to: options.to,
        from: this.fromEmail,
        subject: options.subject,
        html: options.htmlBody,
        text: options.textBody,
        headers: options.headers,
      });
      logger.debug({ to: options.to, subject: options.subject }, 'SendGrid: email sent');
    });
  }
}
