import { WorkspacePanel } from "@/components/workspace-panel";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/permissions";

export const instant = false;

export default async function DashboardPage() {
  await connection();
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (!actor.permissions.includes("dashboard.read")) {
    const firstAllowed = [
      ["attendance.read", "/attendance"], ["salary.read", "/salary"],
      ["employees.read", "/employees"], ["advances.read", "/advances"],
      ["outlets.manage", "/outlets"], ["access.manage", "/access"],
      ["reports.export", "/reports"], ["audit.read", "/active-logs"],
      ["settings.manage", "/settings"],
    ].find(([permission]) => actor.permissions.includes(permission as never));
    if (firstAllowed) redirect(firstAllowed[1]);
    redirect("/unauthorized");
  }
  return <WorkspacePanel section="dashboard" user={{ name: actor.name, email: actor.email, role: actor.role, permissions: actor.permissions }} />;
}