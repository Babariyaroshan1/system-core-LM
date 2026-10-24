import type { ObjectId } from "mongodb";

export type UserRole = "MAIN_ADMIN" | "CO_ADMIN" | "OUTLET_USER";
export type Permission =
  | "dashboard.read" | "outlets.manage" | "employees.read" | "employees.create" | "employees.update"
  | "employees.deactivate" | "attendance.read" | "attendance.write" | "attendance.submit"
  | "attendance.unlock" | "advances.read" | "advances.write" | "salary.read" | "salary.generate"
  | "advances.approve" | "salary.adjust" | "salary.approve" | "salary.pay" | "settings.manage" | "access.manage"
  | "reports.export" | "audit.read";

export interface UserDocument {
  _id: ObjectId;
  email: string;
  emailNormalized: string;
  username?: string;
  usernameNormalized?: string;
  name: string;
  passwordHash?: string;
  image?: string;
  role: UserRole;
  outletIds: ObjectId[];
  permissions: Permission[];
  permissionsCustomized?: boolean;
  designationId?: ObjectId;
  designationName?: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DesignationDocument {
  _id: ObjectId;
  name: string;
  nameNormalized: string;
  description: string;
  color: string;
  permissions: Permission[];
  createdAt: Date;
  updatedAt: Date;
}

export interface OutletDocument {
  _id: ObjectId;
  code: string;
  name: string;
  address: string;
  city: string;
  managerName: string;
  contactPhone: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type SalaryMethod =
  | "FIXED_30_DAYS"
  | "CALENDAR_DAYS"
  | "WORKING_DAYS_26";
export type EmploymentType = "FULL_TIME" | "PART_TIME";
export interface EmployeeDocument {
  _id: ObjectId;
  employeeCode: string;
  employeeCodeNormalized: string;
  fullName: string;
  dateOfJoining: string;
  designation: string;
  employmentType?: EmploymentType;
  mobile: string;
  outletId: ObjectId;
  monthlyBaseSalary: number;
  salaryMethod: SalaryMethod;
  pfEnabled: boolean;
  employeePfPercent: number;
  employerPfPercent: number;
  esiEnabled?: boolean;
  esiPercent?: number;
  active: boolean;
  deactivatedAt?: string;
  notes?: string;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type AttendanceStatus = "P" | "A" | "WO" | "HD";
export interface AttendanceEntry { employeeId: ObjectId; status: AttendanceStatus; updatedAt: Date; updatedBy: ObjectId; correctionCount?: number; submitted?: boolean }
export interface AttendanceDayDocument {
  _id: ObjectId;
  outletId: ObjectId;
  date: string;
  entries: AttendanceEntry[];
  status: "DRAFT" | "SUBMITTED";
  submittedAt?: Date;
  submittedBy?: ObjectId;
  corrections: Array<{ at: Date; actorId: ObjectId; reason: string; action: "UNLOCK" | "RELOCK" }>;
  updatedAt: Date;
  updatedBy: ObjectId;
}

export interface AdvanceDocument {
  _id: ObjectId;
  employeeId: ObjectId;
  outletId: ObjectId;
  date: string;
  amount: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  editCount?: number;
  givenBy: string;
  reference: string;
  notes?: string;
  payrollRecordId?: ObjectId;
  createdBy: ObjectId;
  updatedBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoanDocument {
  _id: ObjectId;
  employeeId: ObjectId;
  outletId: ObjectId;
  totalAmount: number;
  outstandingAmount: number;
  notes: string;
  createdBy: ObjectId;
  updatedBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface SalarySettings {
  timezone: string;
  defaultSalaryMethod: SalaryMethod;
  workingDaysDivisor: number;
  paidAbsences: number;
  currency: "INR";
  advanceDeductionPolicy: "UNPAID_ONLY";
}

export interface SalaryRecordDocument {
  _id: ObjectId;
  employeeId: ObjectId;
  outletId: ObjectId;
  month: string;
  periodStart?: string;
  periodEnd?: string;
  status: "DRAFT" | "APPROVED" | "PAID";
  inputSnapshot: Record<string, unknown>;
  calculation: Record<string, number | string>;
  adjustments: Array<{ label: string; amount: number; reason: string; actorId: ObjectId; at: Date }>;
  approvedBy?: ObjectId;
  approvedAt?: Date;
  paidBy?: ObjectId;
  paidAt?: Date;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLogDocument {
  _id: ObjectId;
  actorId: ObjectId;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  outletId?: ObjectId;
  at: Date;
  reason?: string;
  changes?: Record<string, { before: unknown; after: unknown }>;
}

export interface LoginAttemptDocument {
  _id: string;
  attempts: number;
  windowStartedAt: Date;
  blockedUntil?: Date;
  expiresAt: Date;
}