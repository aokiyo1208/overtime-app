import Link from "next/link";
import { IconLeft } from "./icons";

/** 画面の左上に置く「戻る」ボタン。戻り先は画面ごとに固定する */
export function BackLink({ href, children = "戻る" }: { href: string; children?: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="row"
      style={{ gap: 2, alignSelf: "flex-start", minHeight: 44, marginLeft: -6, padding: "0 8px 0 2px", fontSize: 14, fontWeight: 700, textDecoration: "none", color: "var(--accent)" }}
    >
      <IconLeft size={18} />
      {children}
    </Link>
  );
}
