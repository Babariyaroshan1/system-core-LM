import { WorkspacePanel } from "@/components/workspace-panel";
import { requireActor } from "@/lib/permissions";

export const instant = false;

export default async function AccessPage() {
  const actor = await requireActor("access.manage");
  return <WorkspacePanel section="access" user={{ name: actor.name, email: actor.email, role: actor.role, permissions: actor.permissions }} />;
}