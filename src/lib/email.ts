import nodemailer from "nodemailer";
import { readFileSync } from "fs";
import dkim from "nodemailer-dkim";

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : undefined;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM;
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// DKIM Configuration (optional)
const DKIM_SELECTOR = process.env.DKIM_SELECTOR;
const DKIM_DOMAIN = process.env.DKIM_DOMAIN;
const DKIM_PRIVATE_KEY_FILE = process.env.DKIM_PRIVATE_KEY_FILE;

class Mailer {
  private transporter: any;
  private enabled: boolean;

  constructor() {
    // Check if SMTP is configured
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
      console.warn("SMTP not configured - email functionality disabled");
      this.enabled = false;
      return;
    }

    this.enabled = true;

    // Create SMTP transporter
    this.transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: false, // Use STARTTLS
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });

    // Add DKIM signing if configured
    if (DKIM_SELECTOR && DKIM_DOMAIN && DKIM_PRIVATE_KEY_FILE) {
      try {
        const dkimPrivateKey = readFileSync(DKIM_PRIVATE_KEY_FILE, "utf-8");
        this.transporter.use(
          "stream",
          dkim.signer({
            domainName: DKIM_DOMAIN,
            keySelector: DKIM_SELECTOR,
            privateKey: dkimPrivateKey,
            headerFieldNames: "from:to:subject:date:message-id",
          })
        );
        console.log("DKIM signing enabled");
      } catch (error) {
        console.warn("DKIM private key not found, emails will not be signed");
      }
    }
  }

  private async sendMail(
    to: string,
    subject: string,
    html: string,
    text: string
  ): Promise<void> {
    if (!this.enabled) {
      throw new Error("Email is not configured");
    }

    await this.transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      text,
      html,
      headers: {
        "X-Mailer": "Canvas MCP",
      },
    });
  }

  async sendMagicLink(email: string, token: string): Promise<void> {
    const magicLink = `${BASE_URL}/auth/verify?token=${token}`;

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    img { max-width: 100%; height: auto; }
  </style>
</head>
<body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 40px auto; padding: 20px;">
  <div>
    <h1 style="margin-bottom: 20px;">Sign in to Canvas MCP</h1>
    <p>Click this link to sign in:</p>
    <p><a href="${magicLink}" style="color: #0066cc;">${magicLink}</a></p>
    <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
    <p style="font-size: 12px; color: #999;">This link expires in 15 minutes. If you didn't request this, ignore it.</p>
  </div>
</body>
</html>`;

    const text = `Sign in to Canvas MCP

Click this link to sign in:
${magicLink}

This link expires in 15 minutes.
If you didn't request this, you can safely ignore it.`;

    await this.sendMail(email, "Sign in to Canvas MCP", html, text);
  }

  async sendOAuthConfirmation(
    email: string,
    canvasDomain: string
  ): Promise<void> {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    img { max-width: 100%; height: auto; }
  </style>
</head>
<body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 40px auto; padding: 20px;">
  <div>
    <h1 style="margin-bottom: 20px;">Canvas Account Connected</h1>
    <div style="background: #d4edda; color: #0a6640; padding: 16px; border-radius: 4px; margin: 20px 0;">
      Your Canvas account has been successfully connected!
    </div>
    <p><strong>Canvas Domain:</strong> <code style="background: #f5f5f5; padding: 2px 6px; border-radius: 3px;">${canvasDomain}</code></p>
    <p><a href="${BASE_URL}/dashboard" style="color: #0066cc;">View Dashboard →</a></p>
    <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
    <h2 style="font-size: 18px;">Next Steps</h2>
    <ol style="padding-left: 20px;">
      <li>Configure Claude Desktop with the MCP server URL</li>
      <li>Authorize Claude to access your Canvas data</li>
      <li>Start asking questions about your courses!</li>
    </ol>
  </div>
</body>
</html>`;

    const text = `Canvas Account Connected!

Your Canvas account (${canvasDomain}) has been successfully connected.

Visit your dashboard: ${BASE_URL}/dashboard

Next Steps:
1. Configure Claude Desktop with the MCP server URL
2. Authorize Claude to access your Canvas data
3. Start asking questions about your courses!`;

    await this.sendMail(
      email,
      "Canvas Account Connected - Canvas MCP",
      html,
      text
    );
  }
}

export default new Mailer();
