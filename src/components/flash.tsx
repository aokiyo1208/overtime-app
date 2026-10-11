/** ?msg= / ?err= のクエリをメッセージとして表示する */
export function Flash({ msg, err }: { msg?: string; err?: string }) {
  if (err) return <p className="flash err" role="alert">{err}</p>;
  if (msg) return <p className="flash ok" role="status">{msg}</p>;
  return null;
}

export type SP = Promise<Record<string, string | string[] | undefined>>;

export function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
