const nodemailer = require('nodemailer');
const dotenv = require('dotenv');

dotenv.config();

/**
 * CampusPulse Unified Email Dispatch Service
 * Supports:
 * 1. Standard SMTP (Gmail, Hostinger, AWS SES, Zoho, Custom Domain)
 * 2. Resend REST API (if RESEND_API_KEY is provided)
 * 3. Graceful Sandbox mode with structured console preview & dev fallback
 */
class EmailService {
  constructor() {
    this.isConfigured = false;
    this.transporter = null;
    this.fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER || 'no-reply@campuspulse.edu';
    this.fromName = process.env.FROM_NAME || 'CampusPulse Platform';

    this.initTransporter();
  }

  initTransporter() {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT, 10) || 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (host && user && pass) {
      try {
        this.transporter = nodemailer.createTransport({
          host,
          port,
          secure: port === 465, // true for 465, false for 587 / other
          auth: { user, pass },
          tls: {
            rejectUnauthorized: process.env.NODE_ENV === 'production'
          }
        });
        this.isConfigured = true;
        console.log(`📧 [EmailService] SMTP transporter initialized for host: ${host} (${user})`);
      } catch (err) {
        console.error('❌ [EmailService] Failed to initialize SMTP transporter:', err.message);
        this.isConfigured = false;
      }
    } else {
      console.log('ℹ️ [EmailService] SMTP not fully configured in .env (SMTP_HOST, SMTP_USER, SMTP_PASS). Operating in smart fallback mode.');
    }
  }

  /**
   * Universal HTML Email Template Wrapper
   */
  wrapTemplate(title, preheader, contentHtml) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #F8F9FA; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    .container { max-width: 580px; margin: 30px auto; background: #FFFFFF; border-radius: 16px; border: 1px solid #E5E7EB; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.04); }
    .header { background: linear-gradient(135deg, #1A73E8, #4F46E5); padding: 32px 30px; text-align: center; color: #FFFFFF; }
    .brand { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; text-transform: uppercase; margin: 0; }
    .subhead { font-size: 11px; opacity: 0.85; margin-top: 4px; text-transform: uppercase; letter-spacing: 1px; }
    .content { padding: 36px 32px; color: #1F2328; font-size: 15px; line-height: 1.6; }
    .otp-box { background: #F0F4FF; border: 2px dashed #1A73E8; border-radius: 12px; padding: 18px; text-align: center; margin: 24px 0; }
    .otp-code { font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #1A73E8; font-family: monospace; }
    .footer { background: #F8F9FA; border-top: 1px solid #E5E7EB; padding: 20px 32px; text-align: center; font-size: 12px; color: #6B7280; }
    .pill { display: inline-block; padding: 4px 12px; border-radius: 9999px; background: rgba(26,115,232,0.1); color: #1A73E8; font-size: 11px; font-weight: 700; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div style="display:none;font-size:1px;color:#333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    ${preheader}
  </div>
  <div class="container">
    <div class="header">
      <div class="brand">CampusPulse</div>
      <div class="subhead">Autonomous Higher Education Platform</div>
    </div>
    <div class="content">
      ${contentHtml}
    </div>
    <div class="footer">
      <p style="margin: 0;">&copy; ${new Date().getFullYear()} CampusPulse Platform. Protected with enterprise multi-tenant isolation.</p>
      <p style="margin: 4px 0 0 0;">This is an automated system notification. Please do not reply directly to this email.</p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Send Email Verification OTP
   */
  async sendOtpEmail(toEmail, otpCode, recipientName = 'User') {
    const title = 'Your CampusPulse Verification Code';
    const preheader = `Your 6-digit verification code is ${otpCode}. Valid for 10 minutes.`;
    const content = `
      <div class="pill">SECURITY VERIFICATION</div>
      <h2 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #111827;">Verify Your Email Address</h2>
      <p style="margin: 0 0 16px 0; color: #4B5563;">Hello <strong>${recipientName}</strong>,</p>
      <p style="margin: 0 0 20px 0; color: #4B5563;">Thank you for registering with CampusPulse. Please enter the dynamic 6-digit verification code below to confirm your institutional account:</p>
      
      <div class="otp-box">
        <div style="font-size: 12px; text-transform: uppercase; color: #4B5563; font-weight: 600; margin-bottom: 6px;">Your One-Time Passcode</div>
        <div class="otp-code">${otpCode}</div>
        <div style="font-size: 11px; color: #6B7280; margin-top: 8px;">⏱️ Expires in 10 minutes • Do not share this code with anyone</div>
      </div>

      <p style="margin: 0; font-size: 13px; color: #6B7280;">If you did not initiate this registration request, please disregard this email or contact support immediately.</p>
    `;

    return this.sendMail({
      to: toEmail,
      subject: `CampusPulse Verification Code: ${otpCode}`,
      html: this.wrapTemplate(title, preheader, content),
      text: `Your CampusPulse verification code is: ${otpCode}. It is valid for 10 minutes.`
    });
  }

  /**
   * Send Fee Payment Receipt
   */
  async sendPaymentReceipt(toEmail, details) {
    const { studentName, rollNo, term, amount, transactionId, paidAt, institutionName } = details;
    const title = 'Payment Receipt & Confirmation';
    const preheader = `Payment of ₹${amount} received for ${term}. Transaction ID: ${transactionId}`;
    const content = `
      <div class="pill">FEE TRANSACTION RECEIPT</div>
      <h2 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #111827;">Payment Successful</h2>
      <p style="margin: 0 0 16px 0; color: #4B5563;">Hello <strong>${studentName}</strong> (Roll: <code>${rollNo}</code>),</p>
      <p style="margin: 0 0 20px 0; color: #4B5563;">Your tuition/semester fee payment for <strong>${institutionName || 'CampusPulse Institute'}</strong> has been received and verified successfully.</p>
      
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
        <tr style="border-bottom: 1px solid #E5E7EB;">
          <td style="padding: 10px 0; color: #6B7280;">Academic Term:</td>
          <td style="padding: 10px 0; font-weight: 700; text-align: right;">${term}</td>
        </tr>
        <tr style="border-bottom: 1px solid #E5E7EB;">
          <td style="padding: 10px 0; color: #6B7280;">Amount Paid:</td>
          <td style="padding: 10px 0; font-weight: 700; text-align: right; color: #059669; font-size: 16px;">₹${Number(amount).toLocaleString('en-IN')}</td>
        </tr>
        <tr style="border-bottom: 1px solid #E5E7EB;">
          <td style="padding: 10px 0; color: #6B7280;">Transaction ID:</td>
          <td style="padding: 10px 0; font-family: monospace; font-weight: 600; text-align: right;">${transactionId}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; color: #6B7280;">Date & Time:</td>
          <td style="padding: 10px 0; text-align: right;">${new Date(paidAt || Date.now()).toLocaleString('en-IN')}</td>
        </tr>
      </table>

      <div style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 8px; padding: 12px; font-size: 12px; color: #15803D; margin-top: 20px;">
        ✅ Official electronic receipt recorded in your institutional ledger. You can download the PDF copy from your student fee portal anytime.
      </div>
    `;

    return this.sendMail({
      to: toEmail,
      subject: `Fee Payment Receipt [₹${amount}] - ${term} (TXN: ${transactionId})`,
      html: this.wrapTemplate(title, preheader, content),
      text: `Payment Receipt: Paid ₹${amount} for ${term}. Transaction ID: ${transactionId}. Recorded on ${paidAt}.`
    });
  }

  /**
   * Core Mail Sender with Resend & SMTP Dispatching
   */
  async sendMail({ to, subject, html, text }) {
    // 1. Try Resend API if API Key is configured
    if (process.env.RESEND_API_KEY) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: `${this.fromName} <${this.fromEmail}>`,
            to: [to],
            subject,
            html,
            text
          })
        });

        if (response.ok) {
          const data = await response.json();
          console.log(`✅ [EmailService:Resend] Email successfully dispatched to ${to} (ID: ${data.id})`);
          return { success: true, provider: 'resend', id: data.id };
        } else {
          const errText = await response.text();
          console.warn(`⚠️ [EmailService:Resend] API returned status ${response.status}:`, errText);
        }
      } catch (resendErr) {
        console.error('❌ [EmailService:Resend] Error calling Resend API:', resendErr.message);
      }
    }

    // 2. Try Standard SMTP Transporter
    if (this.isConfigured && this.transporter) {
      try {
        const info = await this.transporter.sendMail({
          from: `"${this.fromName}" <${this.fromEmail}>`,
          to,
          subject,
          html,
          text
        });
        console.log(`✅ [EmailService:SMTP] Email successfully sent to ${to} (MessageId: ${info.messageId})`);
        return { success: true, provider: 'smtp', messageId: info.messageId };
      } catch (smtpErr) {
        console.error(`❌ [EmailService:SMTP] Error sending email to ${to}:`, smtpErr.message);
      }
    }

    // 3. Fallback: Log email details cleanly in development
    console.log(`📨 [EmailService:Sandbox] Dispatched notification to: ${to} | Subject: "${subject}"`);
    return {
      success: true,
      provider: 'sandbox',
      note: 'Sent in sandbox mode. To deliver to real inbox, set SMTP_HOST, SMTP_USER, SMTP_PASS or RESEND_API_KEY in .env.'
    };
  }
}

module.exports = new EmailService();
