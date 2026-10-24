import Decimal from "decimal.js";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { apiError } from "@/lib/http";
import { calculatePayroll } from "@/lib/payroll/calculate";
import { getMonthDates } from "@/lib/payroll/dates";
import type {
  AdvanceDocument,
  AttendanceDayDocument,
  EmployeeDocument,
  LoanDocument,
  SalarySettings,
} from "@/lib/models";
import {
  dateOnlySchema,
  monthSchema,
  objectIdSchema,
} from "@/lib/validation/common";
import { z } from "zod";

const previewSchema = z.object({
  month: monthSchema,
  outletId: objectIdSchema,
  employeeId: objectIdSchema,
  periodStart: dateOnlySchema,
  periodEnd: dateOnlySchema,
});

export async function GET(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (
      !actor.permissions.includes("salary.read") ||
      !actor.permissions.includes("salary.generate")
    )
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const url = new URL(request.url);
    const input = previewSchema.parse({
      month: url.searchParams.get("month"),
      outletId: url.searchParams.get("outletId"),
      employeeId: url.searchParams.get("employeeId"),
      periodStart: url.searchParams.get("periodStart"),
      periodEnd: url.searchParams.get("periodEnd"),
    });
    if (
      input.periodStart.slice(0, 7) !== input.month ||
      input.periodEnd.slice(0, 7) !== input.month ||
      input.periodStart > input.periodEnd
    )
      return NextResponse.json(
        { error: "Payroll dates must be an ordered range within the selected month." },
        { status: 400 },
      );
    const outletId = new ObjectId(input.outletId);
    assertOutletAccess(actor, outletId);
    const { daysInMonth, dates } = getMonthDates(input.month);
    const timezone = process.env.BUSINESS_TIMEZONE || "Asia/Kolkata";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
      new Date(),
    );
    if (input.periodEnd > today)
      return NextResponse.json(
        { error: "Payroll cannot include future dates." },
        { status: 400 },
      );
    const db = await getDb();
    const employee = await db
      .collection<EmployeeDocument>("employees")
      .findOne({
        _id: new ObjectId(input.employeeId),
        outletId,
        dateOfJoining: { $lte: input.periodEnd },
        $or: [
          { active: true },
          { deactivatedAt: { $gte: `${input.month}-01` } },
        ],
      });
    if (!employee)
      return NextResponse.json(
        { error: "Employee is not eligible for the selected payroll period." },
        { status: 404 },
      );
    const monthStart = `${input.month}-01`;
    const previousRecords = await db
      .collection("salaryRecords")
      .find({
        employeeId: employee._id,
        month: input.month,
      })
      .toArray();
    const overlap = previousRecords.some(
      (record) =>
        !record.periodStart ||
        !record.periodEnd ||
        (record.periodStart <= input.periodEnd &&
          record.periodEnd >= input.periodStart),
    );
    if (overlap)
      return NextResponse.json(
        { error: "This payroll period overlaps an existing record." },
        { status: 409 },
      );
    const applicableDates = dates.filter(
      (date) =>
        date >= input.periodStart &&
        date <= input.periodEnd &&
        date >= employee.dateOfJoining &&
        (!employee.deactivatedAt || date <= employee.deactivatedAt),
    );
    if (!applicableDates.length)
      return NextResponse.json(
        { error: "No eligible employment dates are included in this period." },
        { status: 400 },
      );
    const attendanceDays = await db
      .collection<AttendanceDayDocument>("attendance")
      .find({
        outletId,
        date: { $in: applicableDates },
        status: "SUBMITTED",
      })
      .toArray();
    const attendanceByDate = new Map(
      attendanceDays.map((day) => [day.date, day]),
    );
    const counts = { P: 0, A: 0, HD: 0, WO: 0 };
    for (const date of applicableDates) {
      const entry = attendanceByDate
        .get(date)
        ?.entries.find((item) => item.employeeId.equals(employee._id));
      if (!entry)
        return NextResponse.json(
          {
            error: `Submitted attendance is required for ${date} before payroll can be generated.`,
          },
          { status: 409 },
        );
      counts[entry.status] += 1;
    }
    const settings = await db
      .collection<SalarySettings & { _id: string }>("settings")
      .findOne({ _id: "payroll" });
    const rules: SalarySettings = {
      timezone: settings?.timezone || timezone,
      defaultSalaryMethod: "FIXED_30_DAYS",
      workingDaysDivisor: 30,
      paidAbsences: settings?.paidAbsences ?? 0,
      currency: "INR",
      advanceDeductionPolicy: "UNPAID_ONLY",
    };
    const advances = await db
      .collection<AdvanceDocument>("advances")
      .find({
        employeeId: employee._id,
        status: "APPROVED",
        date: { $gte: monthStart, $lte: input.periodEnd },
        payrollRecordId: { $exists: false },
      })
      .toArray();
    const advanceTotal = advances
      .reduce((sum, advance) => sum.plus(advance.amount), new Decimal(0))
      .toNumber();
    const loans =
      actor.role === "MAIN_ADMIN"
        ? await db
            .collection<LoanDocument>("loans")
            .find({
              employeeId: employee._id,
              outletId,
              outstandingAmount: { $gt: 0 },
            })
            .toArray()
        : [];
    const loanBalance = loans
      .reduce((sum, loan) => sum.plus(loan.outstandingAmount), new Decimal(0))
      .toNumber();
    const monthEnd = `${input.month}-${String(daysInMonth).padStart(2, "0")}`;
    const calculation = calculatePayroll({
      monthlyBaseSalary: employee.monthlyBaseSalary,
      salaryMethod: "FIXED_30_DAYS",
      daysInMonth,
      workingDaysDivisor: 30,
      presentDays: counts.P,
      absentDays: counts.A,
      halfDays: counts.HD,
      weekOffs: counts.WO,
      paidAbsences: rules.paidAbsences,
      settleMonthlySalary: true,
      salaryEntitlementDays:
        input.periodStart === monthStart &&
        input.periodEnd === monthEnd &&
        employee.dateOfJoining <= monthStart &&
        (!employee.deactivatedAt || employee.deactivatedAt >= monthEnd)
          ? 30
          : applicableDates.length,
      advances: advanceTotal,
      loanDeduction: 0,
      overtime: 0,
      allowances: 0,
      otherDeductions: 0,
      pfEnabled: employee.pfEnabled,
      employeePfPercent: employee.employeePfPercent,
      employerPfPercent: employee.employerPfPercent,
      esiEnabled: employee.esiEnabled ?? false,
      esiPercent: employee.esiPercent ?? 0.75,
    });
    return NextResponse.json({
      employee: {
        _id: employee._id.toHexString(),
        fullName: employee.fullName,
        employeeCode: employee.employeeCode,
        monthlyBaseSalary: employee.monthlyBaseSalary,
      },
      period: { start: input.periodStart, end: input.periodEnd },
      counts,
      amounts: {
        grossEarnings: calculation.grossEarnings,
        advances: advanceTotal,
        esi: calculation.esi,
        employeePf: calculation.employeePf,
        employerPf: calculation.employerPf,
        loanDeduction: 0,
      },
      advances: advances.map((advance) => ({
        _id: advance._id.toHexString(),
        date: advance.date,
        amount: advance.amount,
        reference: advance.reference,
      })),
      outstandingLoanTotal: loanBalance,
      calculation,
    });
  } catch (error) {
    return apiError(error);
  }
}
