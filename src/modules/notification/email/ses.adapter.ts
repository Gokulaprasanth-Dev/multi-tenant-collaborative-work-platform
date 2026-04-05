import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { IEmailProvider, SendEmailOptions } from './email.provider';
import { emailBreaker } from '../../../shared/circuit-breaker';
import { config } from '../../../shared/config';
import { logger } from '../../../shared/observability/logger';

export class SesAdapter implements IEmailProvider {
  private client: SESClient;
  private fromEmail: string;

  constructor() {
    this.client = new SESClient({ region: config.awsSesRegion ?? 'us-east-1' });
    this.fromEmail = config.awsSesFromEmail ?? 'no-reply@example.com';
  }

  async send(options: SendEmailOptions): Promise<void> {
    await emailBreaker.fire(async () => {
      const command = new SendEmailCommand({
        Source: this.fromEmail,
        Destination: { ToAddresses: [options.to] },
        Message: {
          Subject: { Data: options.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: options.htmlBody, Charset: 'UTF-8' },
            Text: { Data: options.textBody, Charset: 'UTF-8' },
          },
        },
      });
      await this.client.send(command);
      logger.debug({ to: options.to, subject: options.subject }, 'SES: email sent');
    });
  }
}
