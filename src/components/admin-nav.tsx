"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin/approvals", label: "承認待ち", badge: true },
  { href: "/admin/monthly", label: "月次集計" },
  { href: "/admin/employees", label: "社員" },
  { href: "/admin/salary", label: "給与マスタ" },
  { href: "/admin/settings", label: "システム設定" },
];

export function AdminNav({ pending }: { pending: number }) {
  const path = usePathname();
  return (
    <nav aria-label="管理メニュー">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} aria-current={path.startsWith(i.href) ? "page" : undefined}>
          {i.label}
          {i.badge && pending > 0 && <span className="count">{pending}</span>}
        </Link>
      ))}
    </nav>
  );
}
