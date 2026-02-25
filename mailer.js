const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true", // true pre 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendMail({ to, bcc, subject, text, html, attachments = [] }) {
  return transporter.sendMail({
    from: process.env.SMTP_USER,
    to,
    bcc,
    subject,
    text,
    html,
    attachments,
  });
}

module.exports = { sendMail };