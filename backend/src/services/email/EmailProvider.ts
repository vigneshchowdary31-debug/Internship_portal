export interface EmailProvider {
  sendEmail(options: {
    to: string[];
    subject: string;
    text: string;
  }): Promise<void>;
}
