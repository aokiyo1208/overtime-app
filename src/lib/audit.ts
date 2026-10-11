import "server-only";
import { db, type Tx } from "./db";
import { changeLogs } from "@/db/schema";

/** 変更履歴を残す（誰が・いつ・何を） */
export async function logChange(
  tx: Tx | typeof db,
  args: { table: string; id: string; by: string; before?: unknown; after?: unknown; reason?: string },
) {
  const plain = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  await tx.insert(changeLogs).values({
    targetTable: args.table,
    targetId: args.id,
    changedById: args.by,
    before: plain(args.before),
    after: plain(args.after),
    reason: args.reason,
  });
}
