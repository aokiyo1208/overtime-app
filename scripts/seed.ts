// 初期データ：設定・祝日・管理者。SEED_SAMPLE=false でなければ動作確認用のサンプル社員と残業も入れる。
// 何度実行しても重複しない（既にあるものは作らない）。
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import * as s from "../src/db/schema";
import { addDays, currentYm, jstDateTime, monthBounds, shiftYm, todayYmd, weekdayOf } from "../src/lib/time";

// 2026年の国民の祝日（所定休日として登録。来年以降はシステム設定画面で追加）
const HOLIDAYS_2026: [string, string][] = [
  ["2026-01-01", "元日"],
  ["2026-01-12", "成人の日"],
  ["2026-02-11", "建国記念の日"],
  ["2026-02-23", "天皇誕生日"],
  ["2026-03-20", "春分の日"],
  ["2026-04-29", "昭和の日"],
  ["2026-05-03", "憲法記念日"],
  ["2026-05-04", "みどりの日"],
  ["2026-05-05", "こどもの日"],
  ["2026-05-06", "振替休日"],
  ["2026-07-20", "海の日"],
  ["2026-08-11", "山の日"],
  ["2026-09-21", "敬老の日"],
  ["2026-09-22", "国民の休日"],
  ["2026-09-23", "秋分の日"],
  ["2026-10-12", "スポーツの日"],
  ["2026-11-03", "文化の日"],
  ["2026-11-23", "勤労感謝の日"],
];

const SAMPLE = [
  { name: "高橋 誠", local: "takahashi", pay: { payType: "MONTHLY" as const, basePay: 380000, includedAllowances: 30000 }, hours: [3, 3, 2] },
  { name: "佐藤 健一", local: "sato", pay: { payType: "MONTHLY" as const, basePay: 320000, includedAllowances: 20000 }, hours: [2, 2.5] },
  { name: "鈴木 美咲", local: "suzuki", pay: { payType: "MONTHLY" as const, basePay: 280000, includedAllowances: 0 }, hours: [1.5, 2] },
  { name: "伊藤 拓海", local: "ito", pay: { payType: "MONTHLY" as const, basePay: 300000, includedAllowances: 10000 }, hours: [1, 1.5] },
  { name: "田中 優", local: "tanaka", pay: { payType: "HOURLY" as const, hourlyWage: 1500 }, hours: [1, 2] },
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL が設定されていません（.env を確認してください）");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema: s });

  await db.insert(s.settings).values({ id: 1 }).onConflictDoNothing();
  await db.insert(s.holidays).values(HOLIDAYS_2026.map(([date, name]) => ({ date, name, isLegal: false }))).onConflictDoNothing();

  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "").toLowerCase().trim();
  if (adminEmail) {
    await db
      .insert(s.employees)
      .values({ name: process.env.SEED_ADMIN_NAME || "管理者", email: adminEmail, role: "ADMIN" })
      .onConflictDoUpdate({ target: s.employees.email, set: { role: "ADMIN", isActive: true } });
    console.log(`管理者を登録しました: ${adminEmail}`);
  } else {
    console.warn("SEED_ADMIN_EMAIL が空のため、管理者は登録していません");
  }

  if (process.env.SEED_SAMPLE !== "false") {
    const domain = process.env.ALLOWED_DOMAIN || "example.com";
    const holidaySet = new Set(HOLIDAYS_2026.map(([d]) => d));
    const today = todayYmd();
    const firstOfPrev = monthBounds(shiftYm(currentYm(), -1)).first;

    for (const p of SAMPLE) {
      const email = `${p.local}@${domain}`;
      const exists = await db.query.employees.findFirst({ where: eq(s.employees.email, email) });
      if (exists) continue;
      const [emp] = await db.insert(s.employees).values({ name: p.name, email, department: "工事部" }).returning();
      await db.insert(s.salaries).values({ employeeId: emp.id, effectiveFrom: "2026-04-01", ...p.pay });

      // 先月1日〜昨日の平日に、承認済み・打刻済みの残業を入れる
      let i = 0;
      for (let d = firstOfPrev; d < today; d = addDays(d, 1)) {
        const wd = weekdayOf(d);
        if (wd === 0 || wd === 6 || holidaySet.has(d)) continue;
        if ((i++ + p.local.length) % 2 === 1) continue; // 2日に1回程度
        const hours = p.hours[i % p.hours.length];
        const start = jstDateTime(d, "18:00");
        const end = new Date(start.getTime() + hours * 3600_000);
        const [req] = await db
          .insert(s.overtimeRequests)
          .values({
            employeeId: emp.id,
            workDate: d,
            plannedStart: start,
            plannedEnd: end,
            task: "施工計画書・書類作成",
            reason: "提出期限に間に合わせるため",
            status: "APPROVED",
            decidedAt: start,
          })
          .returning();
        await db.insert(s.timeRecords).values({ requestId: req.id, employeeId: emp.id, startedAt: start, endedAt: end });
      }
      // 今日の申請（承認待ち）
      await db.insert(s.overtimeRequests).values({
        employeeId: emp.id,
        workDate: today,
        plannedStart: jstDateTime(today, "18:00"),
        plannedEnd: jstDateTime(today, "20:00"),
        task: "見積書作成",
        reason: "明日の提出に間に合わせるため",
      });
      console.log(`サンプル社員を登録しました: ${p.name} <${email}>`);
    }
  }

  await pool.end();
  console.log("初期データの投入が終わりました");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
