import "server-only";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { employees } from "@/db/schema";
import { db } from "./db";

export async function findEmployeeByEmail(email: string) {
  return db.query.employees.findFirst({ where: eq(employees.email, email.toLowerCase()) });
}

/** ログイン中の社員。権限は毎回DBから読む（退職・ロール変更を即時に反映するため） */
export async function requireUser() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/login");
  const emp = await findEmployeeByEmail(email);
  if (!emp || !emp.isActive) redirect("/login?error=not_registered");
  return emp;
}

export async function requireAdmin() {
  const emp = await requireUser();
  if (emp.role !== "ADMIN") redirect("/");
  return emp;
}
