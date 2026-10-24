import { WorkspacePanel } from "@/components/workspace-panel";
import { requireActor } from "@/lib/permissions";
export default async function SalaryPage() { const actor = await requireActor("salary.read"); return <WorkspacePanel section="salary" user={{ name: actor.name, email: actor.email, role: actor.role, permissions: actor.permissions }} />; }