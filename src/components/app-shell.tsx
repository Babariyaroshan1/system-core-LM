"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState } from "react";
import { Activity, Banknote, Building2, CalendarDays, ClipboardList, FileSpreadsheet, LayoutDashboard, LogOut, Menu, Settings2, ShieldCheck, Users, Wallet, X, HandCoins } from "lucide-react";
import type { Permission, UserRole } from "@/lib/models";

const navigation: Array<{ href: string; label: string; icon: typeof LayoutDashboard; permission: Permission; mainAdminOnly?: boolean }> = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard.read" },
  { href: "/attendance", label: "Attendance", icon: CalendarDays, permission: "attendance.read" },
  { href: "/salary", label: "Monthly salary", icon: Banknote, permission: "salary.read" },
  { href: "/employees", label: "Employees", icon: Users, permission: "employees.read" },
  { href: "/advances", label: "Advances", icon: Wallet, permission: "advances.read" },
  { href: "/loans", label: "Loans", icon: HandCoins, permission: "salary.read", mainAdminOnly: true },
  { href: "/outlets", label: "Outlets", icon: Building2, permission: "outlets.manage" },
  { href: "/access", label: "Access management", icon: ShieldCheck, permission: "access.manage" },
  { href: "/reports", label: "Reports & exports", icon: FileSpreadsheet, permission: "reports.export" },
  { href: "/active-logs", label: "Active logs", icon: ClipboardList, permission: "audit.read" },
  { href: "/settings", label: "Settings", icon: Settings2, permission: "settings.manage" },
];

export function AppShell({ children, user }: { children: React.ReactNode; user: { name: string; email: string; role: UserRole; permissions: Permission[] } }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = navigation.filter((item) => (user.role === "MAIN_ADMIN" || (!item.mainAdminOnly && user.permissions.includes(item.permission))));
  return (
    <div className="app-frame">
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="brand-lockup"><Image className="brand-logo" src="/logo.png" alt="LA MILANO Pizzeria logo" width={768} height={785} /><div><strong>LA MILANO</strong><span>ATTENDANCE MANAGEMENT SYSTEM by Roshan</span></div></div>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="nav-list" aria-label="Main navigation">
          {items.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === href : pathname.startsWith(href);
            return <Link key={href} href={href} onClick={() => setOpen(false)} className={`nav-link ${active ? "nav-active" : ""}`}><Icon size={18} strokeWidth={1.8} /><span>{label}</span>{active && <i />}</Link>;
          })}
        </nav>
        <div className="sidebar-bottom"><div className="system-status"><span className="status-dot" /> Workspace secured</div><div className="user-block"><div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div><div className="user-info"><strong>{user.name}</strong><span>{user.role.replaceAll("_", " ")}</span></div><button className="icon-button logout-button" title="Sign out" aria-label="Sign out" onClick={() => signOut({ callbackUrl: "/login" })}><LogOut size={17} /></button></div></div>
      </aside>
      {open && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setOpen(false)} />}
      <main className="main-column"><header className="topbar"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setOpen(!open)}>{open ? <X size={20} /> : <Menu size={20} />}</button><div className="breadcrumb"><Activity size={15} /><span>Operations</span><b>/</b><strong>{navigation.find((item) => item.href === pathname)?.label ?? "Workspace"}</strong></div><div className="topbar-right"><span className="topbar-date">ATTENDANCE MANAGEMENT SYSTEM by Roshan</span><span className="topbar-avatar">{user.name.slice(0, 1).toUpperCase()}</span></div></header>{children}</main>
    </div>
  );
}