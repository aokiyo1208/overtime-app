/** ALLOWED_DOMAIN はカンマ区切りで複数指定できる（例: "kenzo.tech,gmail.com"） */
export function allowedDomains(): string[] {
  return (process.env.ALLOWED_DOMAIN ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

/** ドメイン制限が無い場合は常に true */
export function isAllowedEmail(email: string): boolean {
  const list = allowedDomains();
  if (list.length === 0) return true;
  const e = email.toLowerCase();
  return list.some((d) => e.endsWith(`@${d}`));
}

/** 画面表示用: "@kenzo.tech / @gmail.com" */
export function domainsLabel(): string {
  return allowedDomains().map((d) => `@${d}`).join(" / ");
}
