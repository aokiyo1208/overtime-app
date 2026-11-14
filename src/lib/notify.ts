import "server-only";
import nodemailer from "nodemailer";

/**
 * 承認・却下などの通知。
 * SMTP_HOST が設定されていればメールで送信し、SLACK_WEBHOOK_URL が設定されていればSlackにも投稿する。
 * どちらも未設定ならサーバーのログに出すだけ。
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

async function notifySlack(to: string, subject: string, body: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `*${subject}*\n宛先: ${to}\n${body}` }),
    });
    if (!res.ok) console.error(`[notify] Slack投稿に失敗しました status=${res.status} subject=${subject}`);
  } catch (e) {
    console.error(`[notify] Slack投稿に失敗しました subject=${subject}`, e);
  }
}

export async function notify(to: string, subject: string, body: string): Promise<void> {
  const tr = getTransporter();
  const slack = Boolean(process.env.SLACK_WEBHOOK_URL);
  if (!tr && !slack) {
    console.info(`[notify] (SMTP・Slack未設定のためログのみ) to=${to} subject=${subject}\n${body}`);
    return;
  }
  if (tr) {
    try {
      await tr.sendMail({ from: process.env.MAIL_FROM ?? process.env.SMTP_USER, to, subject, text: body });
    } catch (e) {
      console.error(`[notify] 送信に失敗しました to=${to} subject=${subject}`, e);
    }
  }
  await notifySlack(to, subject, body);
}
