import { requireUser } from "@/lib/session";
import { projectedMonth } from "@/lib/payroll";
import { currentYm, todayYmd } from "@/lib/time";
import { Flash, one, type SP } from "@/components/flash";
import { RequestForm } from "@/components/request-form";
import { createRequest } from "../actions";

export const metadata = { title: "残業申請" };

export default async function RequestPage({ searchParams }: { searchParams: SP }) {
  const me = await requireUser();
  const sp = await searchParams;
  const ym = currentYm();
  const { totals, settings } = await projectedMonth(me.id, ym);

  return (
    <>
      <header className="m-head" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
        <h1>残業申請</h1>
        <p className="small muted">終業時刻までに申請してください</p>
      </header>
      <main className="m-main">
        <Flash msg={one(sp.msg)} err={one(sp.err)} />
        <RequestForm
          action={createRequest}
          today={todayYmd()}
          currentYm={ym}
          projectedMinutes={totals.statutoryMinutes}
          limitMinutes={settings.limitMonthMinutes}
          warnPercent={settings.warnPercent}
        />
      </main>
    </>
  );
}
