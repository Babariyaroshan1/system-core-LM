import { WorkspacePanel } from "@/components/workspace-panel";
import { requireActor } from "@/lib/permissions";
export default async function AttendancePage() { const actor = await requireActor("attendance.read"); return <WorkspacePanel section="attendance" user={{ name: actor.name, email: actor.email, role: actor.role, permissions: actor.permissions }} />; }