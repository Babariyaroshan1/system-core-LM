import { WorkspacePanel } from "@/components/workspace-panel";
import { requireActor } from "@/lib/permissions";
export default async function EmployeesPage() { const actor = await requireActor("employees.read"); return <WorkspacePanel section="employees" user={{ name: actor.name, email: actor.email, role: actor.role, permissions: actor.permissions }} />; }