  import { ObjectId } from "mongodb";
  import { NextResponse } from "next/server";
  import { getActor, assertOutletAccess } from "@/lib/permissions";
  import { getDb } from "@/lib/mongodb";
  import { apiError } from "@/lib/http";
  import { calculatePayroll } from "@/lib/payroll/calculate";
  import { dateAfter, getMonthDates } from "@/lib/payroll/dates";
  import { dateOnlySchema, objectIdSchema } from "@/lib/validation/common";
  import type {
    AdvanceDocument,
    AttendanceDayDocument,
    AttendanceStatus,
    EmployeeDocument,
    OutletDocument,
    SalaryRecordDocument,
    SalarySettings,
  } from "@/lib/models";
  import { z } from "zod";

  const querySchema = z.object({
    from: dateOnlySchema,
    to: dateOnlySchema,
    outletId: objectIdSchema.optional(),
    employeeId: objectIdSchema.optional(),
  });

  const defaultRules: SalarySettings = {
    timezone: "Asia/Kolkata",
    defaultSalaryMethod: "FIXED_30_DAYS",
    workingDaysDivisor: 30,
    paidAbsences: 0,
    currency: "INR",
    advanceDeductionPolicy: "UNPAID_ONLY",
  };

  type StatusDates = Record<AttendanceStatus, string[]>;

  export async function GET(request: Request) {
    try {
      const actor = await getActor();
      if (!actor)
        return NextResponse.json(
          { error: "Authentication required." },
          { status: 401 },
        );
      if (
        !actor.permissions.includes("employees.read") &&
        !actor.permissions.includes("reports.export")
      )
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });

      const url = new URL(request.url);
      const query = querySchema.parse({
        from: url.searchParams.get("from"),
        to: url.searchParams.get("to"),
        outletId: url.searchParams.get("outletId") || undefined,
        employeeId: url.searchParams.get("employeeId") || undefined,
      });
      if (query.from > query.to)
        return NextResponse.json(
          { error: "Start date must be on or before end date." },
          { status: 400 },
        );
      const span =
        (Date.parse(`${query.to}T00:00:00Z`) -
          Date.parse(`${query.from}T00:00:00Z`)) /
        86_400_000;
      if (span > 366)
        return NextResponse.json(
          { error: "Report ranges are limited to 367 calendar days." },
          { status: 400 },
        );
      if (query.outletId) assertOutletAccess(actor, query.outletId);

      const db = await getDb();
      const outlets = await db
        .collection<OutletDocument>("outlets")
        .find({
          ...(query.outletId
            ? { _id: new ObjectId(query.outletId) }
            : actor.role === "MAIN_ADMIN"
              ? {}
              : { _id: { $in: actor.outletIds } }),
        })
        .sort({ code: 1 })
        .toArray();
      const outletById = new Map(
        outlets.map((outlet) => [outlet._id.toHexString(), outlet]),
      );
      const outletIds = outlets.map((outlet) => outlet._id);
      const [employees, days, settings] = await Promise.all([
        outletIds.length
          ? db
              .collection<EmployeeDocument>("employees")
              .find({ outletId: { $in: outletIds } })
              .sort({ fullName: 1 })
              .toArray()
          : Promise.resolve([]),
        outletIds.length
          ? db
              .collection<AttendanceDayDocument>("attendance")
              .find({
                outletId: { $in: outletIds },
                date: { $gte: query.from, $lte: query.to },
              })
              .sort({ date: 1 })
              .toArray()
          : Promise.resolve([]),
        db
          .collection<SalarySettings & { _id: string }>("settings")
          .findOne({ _id: "payroll" }),
      ]);
      if (query.outletId && !outlets.length) throw new Error("NOT_FOUND");
      const employeeById = new Map(
        employees.map((employee) => [employee._id.toHexString(), employee]),
      );
      const historicalEmployeeIds = new Set(
        days.flatMap((day) =>
          day.entries.map((entry) => entry.employeeId.toHexString()),
        ),
      );
      const employeeOptions = employees
        .filter(
          (employee) =>
            employee.active || historicalEmployeeIds.has(employee._id.toHexString()),
        )
        .map((employee) => ({
          id: employee._id.toHexString(),
          code: employee.employeeCode,
          name: employee.fullName,
          outletId: employee.outletId.toHexString(),
        }));
      if (
        query.employeeId &&
        !employeeById.has(query.employeeId)
      )
        return NextResponse.json(
          { error: "Employee is not available in the selected outlets." },
          { status: 404 },
        );

      const settingsRules = { ...defaultRules, ...settings };
      const daysByOutletAndDate = new Map(
        days.map((day) => [
          `${day.outletId.toHexString()}:${day.date}`,
          day,
        ]),
      );
      const employeeIds = employees.map((employee) => employee._id);
      const [advances, salaryRecords] = await Promise.all([
        actor.permissions.includes("salary.read") && employeeIds.length
          ? db
              .collection<AdvanceDocument>("advances")
              .find({
                employeeId: { $in: employeeIds },
                status: "APPROVED",
                date: { $gte: query.from, $lte: query.to },
                payrollRecordId: { $exists: false },
              })
              .toArray()
          : Promise.resolve([]),
        actor.permissions.includes("salary.read") && employeeIds.length
          ? db
              .collection<SalaryRecordDocument>("salaryRecords")
              .find({
                employeeId: { $in: employeeIds },
                month: {
                  $gte: query.from.slice(0, 7),
                  $lte: query.to.slice(0, 7),
                },
              })
              .toArray()
          : Promise.resolve([]),
      ]);
      const advancesByEmployee = groupBy(advances, (advance) =>
        advance.employeeId.toHexString(),
      );
      const salaryByEmployeeAndMonth = new Map(
        salaryRecords.map((record) => [
          `${record.employeeId.toHexString()}:${record.month}`,
          record,
        ]),
      );
      const rows = employees
        .filter(
          (employee) =>
            (!query.employeeId ||
              employee._id.toHexString() === query.employeeId) &&
            (employee.active ||
              historicalEmployeeIds.has(employee._id.toHexString())),
        )
        .map((employee) => {
          const outlet = outletById.get(employee.outletId.toHexString());
          const start = employee.dateOfJoining > query.from
            ? employee.dateOfJoining
            : query.from;
          const end = employee.deactivatedAt && employee.deactivatedAt < query.to
            ? employee.deactivatedAt
            : query.to;
          const dates: StatusDates = { P: [], A: [], HD: [], WO: [] };
          const submittedCounts = { P: 0, A: 0, HD: 0, WO: 0 };
          const missingDates: string[] = [];
          const unsubmittedDates: string[] = [];
          const monthCounts = new Map<
            string,
            {
              counts: typeof submittedCounts;
              eligibleDays: number;
              complete: boolean;
            }
          >();
          if (start <= end) {
            for (let date = start; date <= end; date = dateAfter(date, 1)) {
              const month = date.slice(0, 7);
              const monthData = getMonthCount(monthCounts, month);
              monthData.eligibleDays += 1;
              const day = daysByOutletAndDate.get(
                `${employee.outletId.toHexString()}:${date}`,
              );
              const entry = day?.entries.find((item) =>
                item.employeeId.equals(employee._id),
              );
              if (!day || !entry) {
                missingDates.push(date);
                monthData.complete = false;
                continue;
              }
              dates[entry.status].push(date);
              if (day.status !== "SUBMITTED") {
                unsubmittedDates.push(date);
                monthData.complete = false;
                continue;
              }
              submittedCounts[entry.status] += 1;
              monthData.counts[entry.status] += 1;
            }
          }

          let payableAmount: number | undefined;
          let payableLabel: string | undefined;
          const salaryDeductions = {
            advances: 0,
            esi: 0,
            employeePf: 0,
            employerPf: 0,
            loanDeduction: 0,
          };
          if (actor.permissions.includes("salary.read")) {
            payableAmount = 0;
            let hasLiveCalculation = false;
            let hasSavedPayroll = false;
            for (const [month, monthData] of monthCounts) {
              const { daysInMonth } = getMonthDates(month);
              const monthStart = `${month}-01`;
              const monthEnd = `${month}-${String(daysInMonth).padStart(2, "0")}`;
              const saved = salaryByEmployeeAndMonth.get(
                `${employee._id.toHexString()}:${month}`,
              );
              const completeMonthSelected =
                query.from <= monthStart && query.to >= monthEnd;
              if (saved && completeMonthSelected) {
                payableAmount += Number(saved.calculation.netPayable ?? 0);
                salaryDeductions.advances += Number(saved.calculation.advances ?? 0);
                salaryDeductions.esi += Number(saved.calculation.esi ?? 0);
                salaryDeductions.employeePf += Number(saved.calculation.employeePf ?? 0);
                salaryDeductions.employerPf += Number(saved.calculation.employerPf ?? 0);
                salaryDeductions.loanDeduction += Number(saved.calculation.loanDeduction ?? 0);
                hasSavedPayroll = true;
                continue;
              }
              hasLiveCalculation = true;
              const monthAdvances = (advancesByEmployee.get(
                employee._id.toHexString(),
              ) ?? [])
                .filter((advance) => advance.date.startsWith(`${month}-`))
                .reduce((sum, advance) => sum + advance.amount, 0);
              const calculation = calculatePayroll({
                monthlyBaseSalary: employee.monthlyBaseSalary,
                salaryMethod: "FIXED_30_DAYS",
                daysInMonth,
                workingDaysDivisor: 30,
                presentDays: monthData.counts.P,
                absentDays: monthData.counts.A,
                halfDays: monthData.counts.HD,
                weekOffs: monthData.counts.WO,
                paidAbsences: settingsRules.paidAbsences,
                settleMonthlySalary:
                  completeMonthSelected && monthData.complete,
                salaryEntitlementDays:
                  employee.dateOfJoining <= monthStart &&
                  (!employee.deactivatedAt || employee.deactivatedAt >= monthEnd)
                    ? 30
                    : monthData.eligibleDays,
                advances: monthAdvances,
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
              payableAmount += calculation.netPayable;
              salaryDeductions.advances += calculation.advances;
              salaryDeductions.esi += calculation.esi;
              salaryDeductions.employeePf += calculation.employeePf;
              salaryDeductions.employerPf += calculation.employerPf;
              salaryDeductions.loanDeduction += calculation.loanDeduction;
            }
            payableLabel = hasLiveCalculation
              ? "Live accrued · submitted days"
              : hasSavedPayroll
                ? "Payroll record"
                : "No submitted attendance";
          }

          return {
            employeeId: employee._id.toHexString(),
            employeeCode: employee.employeeCode,
            employeeName: employee.fullName,
            designation: employee.designation,
            outletCode: outlet?.code ?? "",
            outletName: outlet?.name ?? "",
            ...(actor.permissions.includes("salary.read")
              ? {
                  monthlyBaseSalary: employee.monthlyBaseSalary,
                  payableAmount,
                  payableLabel,
                  ...salaryDeductions,
                }
              : {}),
            presentDays: dates.P.length,
            absentDays: dates.A.length,
            halfDays: dates.HD.length,
            weekOffs: dates.WO.length,
            filledDays:
              dates.P.length +
              dates.A.length +
              dates.HD.length +
              dates.WO.length,
            missingDays: missingDates.length,
            unsubmittedDays: unsubmittedDates.length,
            statusDates: dates,
            missingDates,
            unsubmittedDates,
            reportStart: start <= end ? start : null,
            reportEnd: start <= end ? end : null,
          };
        });

      return NextResponse.json({
        from: query.from,
        to: query.to,
        employees: employeeOptions,
        rows,
        canReadSalary: actor.permissions.includes("salary.read"),
      });
    } catch (error) {
      return apiError(error);
    }
  }

  function groupBy<T>(items: T[], getKey: (item: T) => string) {
    const groups = new Map<string, T[]>();
    for (const item of items) {
      const key = getKey(item);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return groups;
  }

  function getMonthCount(
    months: Map<
      string,
      {
        counts: Record<AttendanceStatus, number>;
        eligibleDays: number;
        complete: boolean;
      }
    >,
    month: string,
  ) {
    let value = months.get(month);
    if (!value) {
      value = {
        counts: { P: 0, A: 0, HD: 0, WO: 0 },
        eligibleDays: 0,
        complete: true,
      };
      months.set(month, value);
    }
    return value;
  }
