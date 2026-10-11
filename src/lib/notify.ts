import "server-only";

/**
 * 承認・却下などの通知。
 * 現在はサーバーのログに出すだけ。Gmail API や SendGrid を使う場合はここを実装する。
 */
export async function notify(to: string, subject: string, body: string): Promise<void> {
  console.info(`[notify] to=${to} subject=${subject}\n${body}`);
}
