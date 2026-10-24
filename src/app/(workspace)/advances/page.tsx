import { WorkspacePanel } from "@/components/workspace-panel";
import { requireActor } from "@/lib/permissions";
export default async function AdvancesPage() { const actor = await requireActor("advances.read"); return <WorkspacePanel section="advances" user={{ name: actor.name, email: actor.email, role: actor.role, permissions: actor.permissions }} />; }