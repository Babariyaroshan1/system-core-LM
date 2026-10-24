import { WorkspacePanel } from "@/components/workspace-panel";
import { requireActor } from "@/lib/permissions";
export default async function ReportsPage() { const actor = await requireActor("reports.export"); return <WorkspacePanel section="reports" user={{ name: actor.name, email: actor.email, role: actor.role, permissions: actor.permissions }} />; }