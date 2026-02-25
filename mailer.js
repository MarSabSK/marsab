const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,          // 👈 musí byť false pre 587
  requireTLS: true,       // 👈 pridaj
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
transporter.verify(function (error, success) {
  if (error) {
    console.log("❌ SMTP chyba:", error);
  } else {
    console.log("✅ SMTP server pripravený");
  }
});