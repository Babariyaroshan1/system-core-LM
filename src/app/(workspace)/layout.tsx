import { connection } from "next/server";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getActor } from "@/lib/permissions";

export const instant = false;

export default async function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection();
  const actor = await getActor();
  if (!actor) redirect("/login");
  return <AppShell user={{ name: actor.name, email: actor.email, role: actor.role, permissions: actor.permissions }}>{children}</AppShell>;
}