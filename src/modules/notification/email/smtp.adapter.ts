import nodemailer from 'nodemailer';
import { IEmailProvider, SendEmailOptions } from './email.provider';
import { emailBreaker } from '../../../shared/circuit-breaker';
import { config } from '../../../shared/config';
import { logger } from '../../../shared/observability/logger';

export class SmtpAdapter implements IEmailProvider {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: config.smtpUser
        ? { user: config.smtpUser, pass: config.smtpPass ?? '' }
        : undefined,
    });
  }

  async send(options: SendEmailOptions): Promise<void> {
    await emailBreaker.fire(async () => {
      await this.transporter.sendMail({
        from: config.smtpFromEmail,
        to: options.to,
        subject: options.subject,
        html: options.htmlBody,
        text: options.textBody,
        headers: options.headers,
      });
      logger.debug({ to: options.to, subject: options.subject }, 'SMTP: email sent');
    });
  }
}
