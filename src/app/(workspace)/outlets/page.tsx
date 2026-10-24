import { WorkspacePanel } from "@/components/workspace-panel";
import { requireActor } from "@/lib/permissions";
export default async function OutletsPage() { const actor = await requireActor("outlets.manage"); return <WorkspacePanel section="outlets" user={{ name: actor.name, email: actor.email, role: actor.role, permissions: actor.permissions }} />; }