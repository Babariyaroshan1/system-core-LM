import type { Permission } from "@/lib/models";

export const designationPermissionGroups: Array<{
  title: string;
  permissions: Array<{ value: Permission; label: string }>;
}> = [
  {
    title: "Dashboard",
    permissions: [{ value: "dashboard.read", label: "View dashboard" }],
  },
  {
    title: "Attendance",
    permissions: [
      { value: "attendance.read", label: "View attendance" },
      { value: "attendance.write", label: "Mark attendance" },
      { value: "attendance.submit", label: "Submit and lock attendance" },
      { value: "attendance.unlock", label: "Unlock submitted attendance" },
    ],
  },
  {
    title: "Employees",
    permissions: [
      { value: "employees.read", label: "View employees" },
      { value: "employees.create", label: "Add employees" },
      { value: "employees.update", label: "Edit employees" },
      { value: "employees.deactivate", label: "Deactivate employees" },
    ],
  },
  {
    title: "Advances",
    permissions: [
      { value: "advances.read", label: "View advances" },
      { value: "advances.write", label: "Record advances" },
      { value: "advances.approve", label: "Approve advances" },
    ],
  },
  {
    title: "Monthly salary",
    permissions: [
      { value: "salary.read", label: "View salary and payroll" },
      { value: "salary.generate", label: "Generate payroll" },
      { value: "salary.adjust", label: "Adjust payroll" },
      { value: "salary.approve", label: "Approve payroll" },
      { value: "salary.pay", label: "Mark payroll as paid" },
    ],
  },
  {
    title: "Reports",
    permissions: [{ value: "reports.export", label: "View and export reports" }],
  },
];

export const staffPermissionValues = designationPermissionGroups.flatMap(
  (group) => group.permissions.map((permission) => permission.value),
) as [
  Permission,
  ...Permission[],
];

export const staffPermissionSet = new Set<Permission>(staffPermissionValues);

export const legacyOutletDefaultPermissions: Permission[] = [
  "dashboard.read",
  "attendance.read",
  "attendance.write",
  "attendance.submit",
];

export const adminOnlyPages = [
  { title: "Outlets", permission: "outlets.manage" },
  { title: "Access management", permission: "access.manage" },
  { title: "Settings", permission: "settings.manage" },
] as const;
