"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconClock, IconList, IconPlus } from "./icons";

const ITEMS = [
  { href: "/", label: "打刻", Icon: IconClock },
  { href: "/request", label: "申請", Icon: IconPlus },
  { href: "/history", label: "履歴", Icon: IconList },
];

export function MemberNav() {
  const path = usePathname();
  return (
    <nav className="m-nav" aria-label="メニュー">
      {ITEMS.map(({ href, label, Icon }) => (
        <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>
          <Icon size={22} />
          {label}
        </Link>
      ))}
    </nav>
  );
}
