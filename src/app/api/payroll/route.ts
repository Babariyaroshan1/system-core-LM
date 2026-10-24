import Decimal from "decimal.js";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import { getDb, getMongoClient } from "@/lib/mongodb";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { calculatePayroll } from "@/lib/payroll/calculate";
import { getMonthDates } from "@/lib/payroll/dates";
import {
  dateOnlySchema,
  monthSchema,
  objectIdSchema,
} from "@/lib/validation/common";
import type {
  AdvanceDocument,
  AttendanceDayDocument,
  EmployeeDocument,
  LoanDocument,
  OutletDocument,
  SalaryRecordDocument,
  SalarySettings,
} from "@/lib/models";
import { z } from "zod";

const generateSchema = z.object({
  month: monthSchema,
  outletId: objectIdSchema,
  employeeId: objectIdSchema.optional(),
  periodStart: dateOnlySchema,
  periodEnd: dateOnlySchema,
  advanceIds: z.array(objectIdSchema).optional(),
  approve: z.boolean().default(false),
  amounts: z
    .object({
      grossEarnings: z.number().finite().nonnegative().max(10_000_000),
      advances: z.number().finite().nonnegative().max(10_000_000),
      esi: z.number().finite().nonnegative().max(10_000_000),
      employeePf: z.number().finite().nonnegative().max(10_000_000),
      employerPf: z.number().finite().nonnegative().max(10_000_000),
      loanDeduction: z.number().finite().nonnegative().max(10_000_000),
    })
    .optional(),
});

export async function GET(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (!actor.permissions.includes("salary.read"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const url = new URL(request.url);
    const month = monthSchema.parse(url.searchParams.get("month"));
    const requested = url.searchParams.get("outletId");
    if (requested && !ObjectId.isValid(requested))
      return NextResponse.json({ error: "Invalid outlet ID." }, { status: 400 });
    if (requested && !ObjectId.isValid(requested))
      return NextResponse.json(
        { error: "Invalid outlet ID." },
        { status: 400 },
      );
    if (requested) assertOutletAccess(actor, requested);
    const outletIds =
      actor.role === "MAIN_ADMIN"
        ? requested
          ? [new ObjectId(requested)]
          : undefined
        : requested
          ? [new ObjectId(requested)]
          : actor.outletIds;
    const query = {
      month,
      ...(outletIds ? { outletId: { $in: outletIds } } : {}),
    };
    const db = await getDb();
    const [records, outlets, salaryEmployees] = await Promise.all([
      db
        .collection<SalaryRecordDocument>("salaryRecords")
        .find(query)
        .sort({ outletId: 1, employeeId: 1, periodEnd: 1 })
        .toArray(),
      db
        .collection<OutletDocument>("outlets")
        .find(outletIds ? { _id: { $in: outletIds } } : {})
        .toArray(),
      db
        .collection<EmployeeDocument>("employees")
        .find({
          ...(outletIds ? { outletId: { $in: outletIds } } : {}),
          dateOfJoining: {
            $lte: `${month}-${String(getMonthDates(month).daysInMonth).padStart(2, "0")}`,
          },
          $or: [
            { active: true },
            { deactivatedAt: { $gte: `${month}-01` } },
          ],
        })
        .sort({ fullName: 1 })
        .toArray(),
    ]);
    const employeeIds = salaryEmployees.map((employee) => employee._id);
    const outletById = new Map(
      outlets.map((outlet) => [outlet._id.toHexString(), outlet]),
    );
    const attendanceDays = employeeIds.length
      ? await db
          .collection<AttendanceDayDocument>("attendance")
          .find({
            ...(outletIds ? { outletId: { $in: outletIds } } : {}),
            date: {
              $gte: `${month}-01`,
              $lte: `${month}-${String(getMonthDates(month).daysInMonth).padStart(2, "0")}`,
            },
            status: "SUBMITTED",
          })
          .toArray()
      : [];
    const attendanceByEmployee = new Map<
      string,
      { P: number; A: number; HD: number; WO: number }
    >();
    const employeeById = new Map(
      salaryEmployees.map((employee) => [
        employee._id.toHexString(),
        employee,
      ]),
    );
    for (const day of attendanceDays) {
      for (const entry of day.entries) {
        const employeeId = entry.employeeId.toHexString();
        const employee = employeeById.get(employeeId);
        if (
          !employee ||
          day.date < employee.dateOfJoining ||
          (employee.deactivatedAt && day.date > employee.deactivatedAt)
        )
          continue;
        const counts = attendanceByEmployee.get(employeeId) ?? {
          P: 0,
          A: 0,
          HD: 0,
          WO: 0,
        };
        counts[entry.status] += 1;
        attendanceByEmployee.set(employeeId, counts);
      }
    }
    const recordsByEmployee = new Map<string, SalaryRecordDocument[]>();
    for (const record of records) {
      const employeeId = record.employeeId.toHexString();
      recordsByEmployee.set(employeeId, [
        ...(recordsByEmployee.get(employeeId) ?? []),
        record,
      ]);
    }
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-${String(getMonthDates(month).daysInMonth).padStart(2, "0")}`;
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: process.env.BUSINESS_TIMEZONE || "Asia/Kolkata",
    }).format(new Date());
    const lastAvailableDate = today < monthEnd ? today : monthEnd;
    const [approvedAdvances, loans] = await Promise.all([
      employeeIds.length
        ? db
            .collection<AdvanceDocument>("advances")
            .find({
              employeeId: { $in: employeeIds },
              status: "APPROVED",
              date: { $gte: monthStart, $lte: lastAvailableDate },
              payrollRecordId: { $exists: false },
            })
            .toArray()
        : Promise.resolve([]),
      actor.role === "MAIN_ADMIN" && employeeIds.length
        ? db
            .collection<LoanDocument>("loans")
            .find({
              employeeId: { $in: employeeIds },
              ...(outletIds ? { outletId: { $in: outletIds } } : {}),
              outstandingAmount: { $gt: 0 },
            })
            .toArray()
        : Promise.resolve([]),
    ]);
    const advanceByEmployee = new Map<string, number>();
    for (const advance of approvedAdvances) {
      const employeeId = advance.employeeId.toHexString();
      advanceByEmployee.set(
        employeeId,
        (advanceByEmployee.get(employeeId) ?? 0) + advance.amount,
      );
    }
    const loanByEmployee = new Map<string, number>();
    for (const loan of loans) {
      const employeeId = loan.employeeId.toHexString();
      loanByEmployee.set(
        employeeId,
        (loanByEmployee.get(employeeId) ?? 0) + loan.outstandingAmount,
      );
    }
    const submittedByDate = new Map(
      attendanceDays.map((day) => [
        `${day.outletId.toHexString()}:${day.date}`,
        day,
      ]),
    );
    const dateAfter = (date: string) => {
      const next = new Date(`${date}T00:00:00.000Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      return next.toISOString().slice(0, 10);
    };
    const payrollEmployees = salaryEmployees.map((employee) => ({
      _id: employee._id.toHexString(),
      outletId: employee.outletId.toHexString(),
      outletCode:
        outletById.get(employee.outletId.toHexString())?.code ?? "",
      fullName: employee.fullName,
      employeeCode: employee.employeeCode,
      designation: employee.designation,
      monthlyBaseSalary: employee.monthlyBaseSalary,
      attendance: attendanceByEmployee.get(employee._id.toHexString()) ?? {
        P: 0,
        A: 0,
        HD: 0,
        WO: 0,
      },
      payrollRecordId: recordsByEmployee
        .get(employee._id.toHexString())
        ?.at(-1)
        ?._id.toHexString(),
      latestPayrollRecordId: recordsByEmployee
        .get(employee._id.toHexString())
        ?.at(-1)
        ?._id.toHexString(),
      nextPeriodStart: (() => {
        const employeeRecords =
          recordsByEmployee.get(employee._id.toHexString()) ?? [];
        if (employeeRecords.some((record) => !record.periodStart))
          return undefined;
        const latestEnd = employeeRecords.reduce(
          (latest, record) =>
            record.periodEnd && record.periodEnd > latest
              ? record.periodEnd
              : latest,
          "",
        );
        const start = latestEnd
          ? dateAfter(latestEnd)
          : employee.dateOfJoining > monthStart
            ? employee.dateOfJoining
            : monthStart;
        return start <= lastAvailableDate ? start : undefined;
      })(),
      suggestedPeriodEnd: (() => {
        const employeeRecords =
          recordsByEmployee.get(employee._id.toHexString()) ?? [];
        if (employeeRecords.some((record) => !record.periodStart))
          return undefined;
        const latestEnd = employeeRecords.reduce(
          (latest, record) =>
            record.periodEnd && record.periodEnd > latest
              ? record.periodEnd
              : latest,
          "",
        );
        let cursor = latestEnd
          ? dateAfter(latestEnd)
          : employee.dateOfJoining > monthStart
            ? employee.dateOfJoining
            : monthStart;
        let completeEnd: string | undefined;
        while (cursor <= lastAvailableDate) {
          const day = submittedByDate.get(
            `${employee.outletId.toHexString()}:${cursor}`,
          );
          if (
            !day?.entries.some((entry) =>
              entry.employeeId.equals(employee._id),
            )
          )
            break;
          completeEnd = cursor;
          cursor = dateAfter(cursor);
        }
        return completeEnd;
      })(),
      approvedAdvanceTotal:
        advanceByEmployee.get(employee._id.toHexString()) ?? 0,
      outstandingLoanTotal:
        loanByEmployee.get(employee._id.toHexString()) ?? 0,
      hasLegacyPayroll: (recordsByEmployee.get(employee._id.toHexString()) ?? [])
        .some((record) => !record.periodStart),
    }));
    return NextResponse.json({ records, payrollEmployees });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (!actor.permissions.includes("salary.generate"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const input = generateSchema.parse(await readJson<unknown>(request));
    if (
      input.periodStart.slice(0, 7) !== input.month ||
      input.periodEnd.slice(0, 7) !== input.month ||
      input.periodStart > input.periodEnd
    )
      return NextResponse.json(
        { error: "Payroll dates must be an ordered range within the selected month." },
        { status: 400 },
      );
    if (input.approve && !actor.permissions.includes("salary.approve"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    if (
      !input.employeeId &&
      (input.amounts !== undefined || input.advanceIds !== undefined)
    )
      return NextResponse.json(
        { error: "Manual payroll review must target one employee at a time." },
        { status: 400 },
      );
    if (
      (input.amounts?.loanDeduction ?? 0) > 0 &&
      actor.role !== "MAIN_ADMIN"
    )
      return NextResponse.json(
        { error: "Only MAIN_ADMIN can record a loan repayment." },
        { status: 403 },
      );
    const outletId = new ObjectId(input.outletId);
    assertOutletAccess(actor, outletId);
    const db = await getDb();
    const outlet = await db
      .collection<OutletDocument>("outlets")
      .findOne({ _id: outletId });
    if (!outlet) throw new Error("NOT_FOUND");
    const monthStart = `${input.month}-01`;
    const lastDateInMonth = `${input.month}-${String(getMonthDates(input.month).daysInMonth).padStart(2, "0")}`;
    const employeeQuery = {
      outletId,
      dateOfJoining: { $lte: lastDateInMonth },
      $or: [{ active: true }, { deactivatedAt: { $gte: monthStart } }],
      ...(input.employeeId ? { _id: new ObjectId(input.employeeId) } : {}),
    };
    const employees = await db
      .collection<EmployeeDocument>("employees")
      .find(employeeQuery)
      .toArray();
    if (!employees.length)
      return NextResponse.json(
        { error: "No eligible active employees found." },
        { status: 400 },
      );
    const existingRecords = await db
      .collection<SalaryRecordDocument>("salaryRecords")
      .find(
        {
          outletId,
          month: input.month,
          employeeId: { $in: employees.map((employee) => employee._id) },
        },
        {
          projection: {
            employeeId: 1,
            periodStart: 1,
            periodEnd: 1,
          },
        },
      )
      .toArray();
    const overlap = existingRecords.find(
      (record) =>
        !record.periodStart ||
        !record.periodEnd ||
        (record.periodStart <= input.periodEnd &&
          record.periodEnd >= input.periodStart),
    );
    if (overlap)
      return NextResponse.json(
        {
          error:
            "This payroll period overlaps an existing record. Choose dates not already covered by payroll.",
        },
        { status: 409 },
      );
    const settings = await db
      .collection<SalarySettings & { _id: string }>("settings")
      .findOne({ _id: "payroll" });
    const rules: SalarySettings = {
      timezone:
        settings?.timezone ||
        process.env.BUSINESS_TIMEZONE ||
        "Asia/Kolkata",
      defaultSalaryMethod: "FIXED_30_DAYS",
      workingDaysDivisor: 30,
      paidAbsences: settings?.paidAbsences ?? 0,
      currency: "INR",
      advanceDeductionPolicy: "UNPAID_ONLY",
    };
    const { daysInMonth, dates } = getMonthDates(input.month);
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: rules.timezone,
    }).format(new Date());
    if (input.periodEnd > today)
      return NextResponse.json(
        {
          error: "Payroll cannot include future dates.",
        },
        { status: 400 },
      );
    const periodDates = dates.filter(
      (date) => date >= input.periodStart && date <= input.periodEnd,
    );
    const client = await getMongoClient();
    const session = client.startSession();
    const created: SalaryRecordDocument[] = [];
    try {
      await session.withTransaction(async () => {
        for (const employee of employees) {
          const applicableDates = periodDates.filter(
            (date) =>
              date >= employee.dateOfJoining &&
              (!employee.deactivatedAt || date <= employee.deactivatedAt),
          );
          const attendanceDays = await db
            .collection<AttendanceDayDocument>("attendance")
            .find(
              { outletId, date: { $in: applicableDates }, status: "SUBMITTED" },
              { session },
            )
            .toArray();
          const attendanceByDate = new Map(
            attendanceDays.map((day) => [day.date, day]),
          );
          const missing = applicableDates.filter(
            (date) => !attendanceByDate.has(date),
          );
          if (missing.length)
            throw new Error(
              `ATTENDANCE_MISSING:${employee.employeeCode}:${missing[0]}`,
            );
          const counts = { P: 0, A: 0, HD: 0, WO: 0 };
          for (const date of applicableDates) {
            const entry = attendanceByDate
              .get(date)
              ?.entries.find((item) => item.employeeId.equals(employee._id));
            if (!entry)
              throw new Error(
                `ATTENDANCE_ENTRY_MISSING:${employee.employeeCode}:${date}`,
              );
            counts[entry.status] += 1;
          }
          const firstDate = `${input.month}-01`;
          const advances = input.advanceIds
            ? await db
                .collection<AdvanceDocument>("advances")
                .find(
                  {
                    _id: { $in: input.advanceIds.map((id) => new ObjectId(id)) },
                    employeeId: employee._id,
                    status: "APPROVED",
                    date: { $gte: firstDate, $lte: input.periodEnd },
                    payrollRecordId: { $exists: false },
                  },
                  { session },
                )
                .toArray()
            : await db
                .collection<AdvanceDocument>("advances")
                .find(
                  {
                    employeeId: employee._id,
                    status: "APPROVED",
                    date: { $gte: firstDate, $lte: input.periodEnd },
                    payrollRecordId: { $exists: false },
                  },
                  { session },
                )
                .toArray();
          if (input.advanceIds && advances.length !== input.advanceIds.length)
            throw new Error(`ADVANCE_SELECTION_CHANGED:${employee.employeeCode}`);
          const advanceTotal = advances
            .reduce((sum, advance) => sum.plus(advance.amount), new Decimal(0))
            .toNumber();
          const computed = calculatePayroll({
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
              input.periodStart === firstDate &&
              input.periodEnd ===
                `${input.month}-${String(daysInMonth).padStart(2, "0")}` &&
              employee.dateOfJoining <= firstDate &&
              (!employee.deactivatedAt ||
                employee.deactivatedAt >= input.periodEnd)
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
          const now = new Date();
          const amounts = {
            grossEarnings:
              input.amounts?.grossEarnings ?? computed.grossEarnings,
            advances: input.amounts?.advances ?? computed.advances,
            esi: input.amounts?.esi ?? computed.esi,
            employeePf: input.amounts?.employeePf ?? computed.employeePf,
            employerPf: input.amounts?.employerPf ?? computed.employerPf,
            loanDeduction: input.amounts?.loanDeduction ?? 0,
          };
          if (new Decimal(amounts.advances).minus(advanceTotal).abs().greaterThan(0.009))
            throw new Error(`ADVANCE_AMOUNT_MISMATCH:${employee.employeeCode}`);
          if (amounts.loanDeduction > 0) {
            const loans = await db
              .collection<LoanDocument>("loans")
              .find(
                {
                  employeeId: employee._id,
                  outletId,
                  outstandingAmount: { $gt: 0 },
                },
                { session },
              )
              .sort({ createdAt: 1, _id: 1 })
              .toArray();
            const outstanding = loans.reduce(
              (sum, loan) => sum.plus(loan.outstandingAmount),
              new Decimal(0),
            );
            if (new Decimal(amounts.loanDeduction).greaterThan(outstanding))
              throw new Error(`LOAN_AMOUNT_EXCEEDS:${employee.employeeCode}`);
            let remaining = new Decimal(amounts.loanDeduction);
            for (const loan of loans) {
              if (remaining.lessThanOrEqualTo(0)) break;
              const applied = Decimal.min(
                new Decimal(loan.outstandingAmount),
                remaining,
              );
              const outstandingAmount = new Decimal(loan.outstandingAmount)
                .minus(applied)
                .toDecimalPlaces(2)
                .toNumber();
              const updatedLoan = await db
                .collection<LoanDocument>("loans")
                .updateOne(
                  {
                    _id: loan._id,
                    outstandingAmount: loan.outstandingAmount,
                  },
                  {
                    $set: {
                      outstandingAmount,
                      updatedBy: actor.id,
                      updatedAt: now,
                    },
                  },
                  { session },
                );
              if (!updatedLoan.modifiedCount)
                throw new Error("LOAN_CHANGED");
              remaining = remaining.minus(applied);
            }
          }
          const calculation = {
            ...computed,
            ...amounts,
            netPayable: new Decimal(amounts.grossEarnings)
              .plus(computed.overtime)
              .plus(computed.allowances)
              .minus(amounts.advances)
              .minus(amounts.esi)
              .minus(amounts.employeePf)
              .minus(amounts.loanDeduction)
              .minus(computed.otherDeductions)
              .toDecimalPlaces(2)
              .toNumber(),
          };
          const record: SalaryRecordDocument = {
            _id: new ObjectId(),
            employeeId: employee._id,
            outletId,
            month: input.month,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            status: input.approve ? "APPROVED" : "DRAFT",
            ...(input.approve
              ? { approvedBy: actor.id, approvedAt: now }
              : {}),
            inputSnapshot: {
              employee: {
                employeeCode: employee.employeeCode,
                fullName: employee.fullName,
                monthlyBaseSalary: employee.monthlyBaseSalary,
                salaryMethod: "FIXED_30_DAYS",
                pfEnabled: employee.pfEnabled,
                employeePfPercent: employee.employeePfPercent,
                employerPfPercent: employee.employerPfPercent,
                esiEnabled: employee.esiEnabled ?? false,
                esiPercent: employee.esiPercent ?? 0.75,
              },
              counts,
              advances: advances.map((advance) => ({
                id: advance._id,
                amount: advance.amount,
                reference: advance.reference,
              })),
              payrollPeriod: {
                start: input.periodStart,
                end: input.periodEnd,
              },
              manuallyEnteredAmounts: amounts,
              rules,
            },
            calculation: { ...calculation },
            adjustments: [],
            createdBy: actor.id,
            createdAt: now,
            updatedAt: now,
          };
          await db
            .collection<SalaryRecordDocument>("salaryRecords")
            .insertOne(record, { session });
          if (advances.length) {
            const claimed = await db
              .collection<AdvanceDocument>("advances")
              .updateMany(
                {
                  _id: { $in: advances.map((advance) => advance._id) },
                  status: "APPROVED",
                  payrollRecordId: { $exists: false },
                },
                { $set: { payrollRecordId: record._id, updatedAt: now } },
                { session },
              );
            if (claimed.modifiedCount !== advances.length)
              throw new Error("ADVANCE_CLAIM_CONFLICT");
          }
          created.push(record);
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (
        message.startsWith("ATTENDANCE_MISSING:") ||
        message.startsWith("ATTENDANCE_ENTRY_MISSING:")
      )
        return NextResponse.json(
          {
            error: `Payroll blocked because attendance is incomplete (${message.split(":").slice(1).join(":")}).`,
          },
          { status: 409 },
        );
      if (message.startsWith("ADVANCE_AMOUNT_MISMATCH:"))
        return NextResponse.json(
          {
            error: `The advances amount must match the approved, unclaimed balance for ${message.split(":")[1]}.`,
          },
          { status: 400 },
        );
      if (message.startsWith("ADVANCE_SELECTION_CHANGED:"))
        return NextResponse.json(
          {
            error: `An approved advance changed while generating payroll for ${message.split(":")[1]}. Refresh and try again.`,
          },
          { status: 409 },
        );
      if (message.startsWith("LOAN_AMOUNT_EXCEEDS:"))
        return NextResponse.json(
          {
            error: `The loan deduction entered exceeds the outstanding balance for ${message.split(":")[1]}.`,
          },
          { status: 400 },
        );
      if (message === "LOAN_CHANGED")
        return NextResponse.json(
          { error: "Loan balance changed concurrently. Refresh and try again." },
          { status: 409 },
        );
      if (
        message === "ADVANCE_CLAIM_CONFLICT" ||
        (error as { code?: number }).code === 11000
      )
        return NextResponse.json(
          {
            error:
              "Payroll already exists or an advance was claimed concurrently.",
          },
          { status: 409 },
        );
      throw error;
    } finally {
      await session.endSession();
    }
    for (const record of created)
      await writeAudit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: input.approve ? "SALARY_GENERATED_AND_APPROVED" : "SALARY_GENERATED",
        entityType: "salary",
        entityId: record._id.toHexString(),
        outletId,
        changes: {
          period: {
            before: null,
            after: `${record.periodStart} - ${record.periodEnd}`,
          },
          grossEarnings: {
            before: 0,
            after: Number(record.calculation.grossEarnings),
          },
          advances: {
            before: 0,
            after: Number(record.calculation.advances),
          },
          esi: { before: 0, after: Number(record.calculation.esi) },
          employeePf: {
            before: 0,
            after: Number(record.calculation.employeePf),
          },
          employerPf: {
            before: 0,
            after: Number(record.calculation.employerPf),
          },
          loanDeduction: {
            before: 0,
            after: Number(record.calculation.loanDeduction),
          },
          netPayable: {
            before: 0,
            after: Number(record.calculation.netPayable),
          },
        },
      });
    return NextResponse.json({ records: created }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
