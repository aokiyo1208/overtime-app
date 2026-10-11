import "server-only";
import nodemailer from "nodemailer";

/**
 * 承認・却下などのメール通知。
 * SMTP_HOST が設定されていればSMTPで送信し、未設定ならサーバーのログに出すだけ。
 * 送信に失敗しても、承認・却下の処理自体は止めない。
 */
let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  transporter ??= nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
  });
  return transporter;
}

export async function notify(to: string, subject: string, body: string): Promise<void> {
  const tr = getTransporter();
  if (!tr) {
    console.info(`[notify] (SMTP未設定のためログのみ) to=${to} subject=${subject}\n${body}`);
    return;
  }
  try {
    await tr.sendMail({ from: process.env.MAIL_FROM ?? process.env.SMTP_USER, to, subject, text: body });
  } catch (e) {
    console.error(`[notify] 送信に失敗しました to=${to} subject=${subject}`, e);
  }
}
