import { WorkspacePanel } from "@/components/workspace-panel";
import { requireActor } from "@/lib/permissions";

export default async function LoansPage() {
  const actor = await requireActor("salary.read");
  if (actor.role !== "MAIN_ADMIN") return null;
  return (
    <WorkspacePanel
      section="loans"
      user={{
        name: actor.name,
        email: actor.email,
        role: actor.role,
        permissions: actor.permissions,
      }}
    />
  );
}
