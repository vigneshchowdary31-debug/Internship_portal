import nodemailer from 'nodemailer';

export class EmailService {
  private static transporter: nodemailer.Transporter | null = null;

  static initialize() {
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = parseInt(process.env.SMTP_PORT || '587', 10);

    if (!user || !pass) {
      console.warn('⚠️ SMTP credentials not provided. Real emails will NOT be sent.');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // true for 465, false for other ports
      auth: {
        user,
        pass,
      },
      family: 4, // Force IPv4 to avoid ENETUNREACH with IPv6 on Render
      connectionTimeout: 10000,
      socketTimeout: 15000,
      greetingTimeout: 5000,
    } as any);

    // Verify transporter initialization
    this.transporter.verify((error, success) => {
      if (error) {
        console.error('❌ SMTP Connection Error:', error);
      } else {
        console.log('✅ SMTP Connected successfully. Server is ready to take our messages.');
      }
    });
  }

  private static getTransporter() {
    if (!this.transporter) {
      this.initialize();
    }
    return this.transporter;
  }

  static async sendSessionNotification(
    emails: string[],
    sessionTitle: string,
    startTime: Date,
    meetLink: string,
    instructorName: string,
    batchName: string
  ) {
    const transporter = this.getTransporter();

    if (!emails || emails.length === 0) {
      console.warn('⚠️ No recipients provided for session notification email.');
      return;
    }

    const formattedDate = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(startTime);

    const subject = `Upcoming Class: ${sessionTitle}`;
    const text = `
Hello,

You have a new class scheduled!

Title: ${sessionTitle}
Batch: ${batchName}
Instructor: ${instructorName}
Date & Time: ${formattedDate}
Google Meet Link: ${meetLink}

Please ensure you join on time.

Best Regards,
Student Training Portal
    `;

    if (!transporter) {
      console.warn('⚠️ Cannot send email: No valid SMTP transporter configured.');
      return;
    }

    console.log(`\n📧 Sending Email...`);
    console.log(`Recipients: ${emails.length} users`);
    console.log(`Subject: ${subject}`);

    try {
      const info = await transporter.sendMail({
        from: `"Student Training Portal" <${process.env.SMTP_USER}>`,
        to: emails.join(', '),
        subject,
        text,
      });
      console.log(`✅ Session notification emails sent successfully. MessageId: ${info.messageId}`);
    } catch (error) {
      console.error('❌ Failed to send session notification emails:', error);
    }
  }

  static async sendCancellationNotification(
    emails: string[],
    sessionTitle: string,
    startTime: Date,
    instructorName: string,
    batchName: string
  ) {
    const transporter = this.getTransporter();

    if (!emails || emails.length === 0) {
      console.warn('⚠️ No recipients provided for cancellation email.');
      return;
    }

    const formattedDate = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(startTime);

    const subject = `CANCELLED: ${sessionTitle}`;
    const text = `
Hello,

Please note that the following class has been CANCELLED:

Title: ${sessionTitle}
Batch: ${batchName}
Instructor: ${instructorName}
Date & Time: ${formattedDate}

You do not need to attend this session.

Best Regards,
Student Training Portal
    `;

    if (!transporter) {
      console.warn('⚠️ Cannot send email: No valid SMTP transporter configured.');
      return;
    }

    console.log(`\n📧 Sending Cancellation Email...`);
    console.log(`Recipients: ${emails.length} users`);
    console.log(`Subject: ${subject}`);

    try {
      const info = await transporter.sendMail({
        from: `"Student Training Portal" <${process.env.SMTP_USER}>`,
        to: emails.join(', '),
        subject,
        text,
      });
      console.log(`✅ Session cancellation emails sent successfully. MessageId: ${info.messageId}`);
    } catch (error) {
      console.error('❌ Failed to send session cancellation emails:', error);
    }
  }

  static async sendSessionUpdateNotification(
    emails: string[],
    sessionTitle: string,
    startTime: Date,
    meetLink: string,
    instructorName: string,
    batchName: string
  ) {
    const transporter = this.getTransporter();

    if (!emails || emails.length === 0) {
      console.warn('⚠️ No recipients provided for update email.');
      return;
    }

    const formattedDate = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(startTime);

    const subject = `UPDATED: ${sessionTitle}`;
    const text = `
Hello,

Please note that the details for the following class have been UPDATED:

Title: ${sessionTitle}
Batch: ${batchName}
Instructor: ${instructorName}
Date & Time: ${formattedDate}
Google Meet Link: ${meetLink}

Please check the portal for any additional changes and ensure you join on time.

Best Regards,
Student Training Portal
    `;

    if (!transporter) {
      console.warn('⚠️ Cannot send email: No valid SMTP transporter configured.');
      return;
    }

    console.log(`\n📧 Sending Update Email...`);
    console.log(`Recipients: ${emails.length} users`);
    console.log(`Subject: ${subject}`);

    try {
      const info = await transporter.sendMail({
        from: `"Student Training Portal" <${process.env.SMTP_USER}>`,
        to: emails.join(', '),
        subject,
        text,
      });
      console.log(`✅ Session update emails sent successfully. MessageId: ${info.messageId}`);
    } catch (error) {
      console.error('❌ Failed to send session update emails:', error);
    }
  }
}

// Initialize on load if env vars are present
EmailService.initialize();
