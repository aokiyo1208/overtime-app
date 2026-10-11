import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { findEmployeeByEmail } from "@/lib/session";
import { monthSummaries } from "@/lib/payroll";
import { isValidYm } from "@/lib/time";

/** 月次の社員別残業時間・残業代をCSVで出力（Excelで開けるようBOM付きUTF-8） */
export async function GET(req: Request) {
  const session = await auth();
  const me = session?.user?.email ? await findEmployeeByEmail(session.user.email) : null;
  if (!me || !me.isActive || me.role !== "ADMIN") return new NextResponse("forbidden", { status: 403 });

  const ym = new URL(req.url).searchParams.get("m");
  if (!isValidYm(ym)) return new NextResponse("bad request", { status: 400 });

  const { closed, rows } = await monthSummaries(ym);
  const h = (min: number) => (min / 60).toFixed(2);
  const esc = (v: string | number) => {
    let s = String(v);
    // 先頭が = + - @ のセルは、Excelで数式として実行されないよう無害化する
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = ["対象月", "状態", "社員名", "メールアドレス", "法定内残業(時間)", "時間外(時間)", "深夜(時間)", "法定休日(時間)", "60時間超(時間)", "時間単価(円)", "残業代(円)"];
  const lines = [header.map(esc).join(",")];
  for (const r of rows) {
    lines.push(
      [
        ym,
        closed ? "確定" : "見込み",
        r.employee.name,
        r.employee.email,
        h(r.totals.innerMinutes),
        h(r.totals.statutoryMinutes),
        h(r.totals.nightMinutes),
        h(r.totals.holidayMinutes),
        h(r.totals.over60Minutes),
        r.hourlyRate === null ? "" : r.hourlyRate.toFixed(2),
        r.amount ?? "",
      ]
        .map(esc)
        .join(","),
    );
  }
  return new NextResponse("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="overtime-${ym}.csv"`,
      "cache-control": "no-store",
    },
  });
}
