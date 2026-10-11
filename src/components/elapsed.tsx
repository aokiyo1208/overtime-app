"use client";

import { useEffect, useState } from "react";

/** 開始時刻からの経過時間（H:MM）を毎分更新して表示 */
export function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const min = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000));
  return (
    <span className="mono" suppressHydrationWarning>
      {Math.floor(min / 60)}:{String(min % 60).padStart(2, "0")}
    </span>
  );
}
