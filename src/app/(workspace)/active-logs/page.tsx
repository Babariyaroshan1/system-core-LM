import { WorkspacePanel } from "@/components/workspace-panel";
import { requireActor } from "@/lib/permissions";

export default async function ActiveLogsPage() {
  const actor = await requireActor("audit.read");
  return (
    <WorkspacePanel
      section="activeLogs"
      user={{
        name: actor.name,
        email: actor.email,
        role: actor.role,
        permissions: actor.permissions,
      }}
    />
  );
}
