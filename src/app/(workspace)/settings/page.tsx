import { WorkspacePanel } from "@/components/workspace-panel";
import { requireActor } from "@/lib/permissions";
export default async function SettingsPage() { const actor = await requireActor("settings.manage"); return <WorkspacePanel section="settings" user={{ name: actor.name, email: actor.email, role: actor.role, permissions: actor.permissions }} />; }