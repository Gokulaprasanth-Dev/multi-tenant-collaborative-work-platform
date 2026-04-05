export interface SendEmailOptions {
  to: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  headers?: Record<string, string>;
}

export interface IEmailProvider {
  send(options: SendEmailOptions): Promise<void>;
}
