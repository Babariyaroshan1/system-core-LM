import { ObjectId } from "mongodb";
import { connection, NextResponse } from "next/server";
import { assertOutletAccess, getActor } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { apiError } from "@/lib/http";
import { calculatePayroll } from "@/lib/payroll/calculate";
import { getMonthDates } from "@/lib/payroll/dates";
import { dateOnlySchema } from "@/lib/validation/common";
import type {
  AdvanceDocument,
  AttendanceDayDocument,
  EmployeeDocument,
  OutletDocument,
  SalaryRecordDocument,
  SalarySettings,
} from "@/lib/models";

export async function GET(request: Request) {
  try {
    await connection();
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (!actor.permissions.includes("dashboard.read"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const db = await getDb();
    const settings = await db
      .collection<SalarySettings & { _id: string }>("settings")
      .findOne({ _id: "payroll" });
    const timezone =
      settings?.timezone ?? process.env.BUSINESS_TIMEZONE ?? "Asia/Kolkata";
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
    }).format(new Date());
    const url = new URL(request.url);
    const requestedDate = url.searchParams.get("date") ?? today;
    const dateResult = dateOnlySchema.safeParse(requestedDate);
    if (!dateResult.success || requestedDate > today)
      return NextResponse.json(
        { error: "Dashboard date must be a valid date no later than today." },
        { status: 400 },
      );
    const dashboardDate = dateResult.data;
    const requestedAwayFrom = url.searchParams.get("awayFrom") ?? dashboardDate;
    const requestedAwayTo = url.searchParams.get("awayTo") ?? dashboardDate;
    const awayFromResult = dateOnlySchema.safeParse(requestedAwayFrom);
    const awayToResult = dateOnlySchema.safeParse(requestedAwayTo);
    if (
      !awayFromResult.success ||
      !awayToResult.success ||
      requestedAwayFrom > requestedAwayTo ||
      requestedAwayTo > today
    )
      return NextResponse.json(
        { error: "Who’s Away date range must be valid and no later than today." },
        { status: 400 },
      );
    const awayFrom = awayFromResult.data;
    const awayTo = awayToResult.data;
    const month = dashboardDate.slice(0, 7);
    const monthStart = `${month}-01`;
    const { daysInMonth } = getMonthDates(month);
    const monthEnd = `${month}-${String(daysInMonth).padStart(2, "0")}`;
    const requestedOutlet =
      url.searchParams.get("outletId") ?? undefined;
    if (requestedOutlet && !ObjectId.isValid(requestedOutlet))
      return NextResponse.json(
        { error: "Invalid outlet ID." },
        { status: 400 },
      );
    if (requestedOutlet) assertOutletAccess(actor, requestedOutlet);
    const allowed =
      actor.role === "MAIN_ADMIN"
        ? requestedOutlet
          ? [new ObjectId(requestedOutlet)]
          : undefined
        : requestedOutlet
          ? [new ObjectId(requestedOutlet)]
          : actor.outletIds;
    const canReadSalary = actor.permissions.includes("salary.read");
    const canReviewAdvances = actor.permissions.includes("advances.approve");
    const outlets = await db
      .collection<OutletDocument>("outlets")
      .find({ ...(allowed ? { _id: { $in: allowed } } : {}), active: true })
      .sort({ code: 1 })
      .toArray();
    const outletIds = outlets.map((outlet) => outlet._id);
    const [activeEmployees, fullTimeEmployees, partTimeEmployees, todayDays, salaryRecords, pendingAdvances, employees, monthDays] =
      await Promise.all([
        db
          .collection<EmployeeDocument>("employees")
          .countDocuments({ active: true, outletId: { $in: outletIds } }),
        db
          .collection<EmployeeDocument>("employees")
          .countDocuments({
            active: true,
            outletId: { $in: outletIds },
            employmentType: { $ne: "PART_TIME" },
          }),
        db
          .collection<EmployeeDocument>("employees")
          .countDocuments({
            active: true,
            outletId: { $in: outletIds },
            employmentType: "PART_TIME",
          }),
        db
          .collection<AttendanceDayDocument>("attendance")
          .find({ date: dashboardDate, outletId: { $in: outletIds } })
          .toArray(),
        canReadSalary
          ? db
              .collection<SalaryRecordDocument>("salaryRecords")
              .find({ month, outletId: { $in: outletIds } })
              .toArray()
          : Promise.resolve([]),
        canReviewAdvances
          ? db.collection("advances").countDocuments({
              status: "PENDING",
              outletId: { $in: outletIds },
            })
          : Promise.resolve(0),
        canReadSalary && outletIds.length
            ? db
                .collection<EmployeeDocument>("employees")
                .find({ outletId: { $in: outletIds } })
                .toArray()
            : Promise.resolve([]),
        canReadSalary && outletIds.length
            ? db
                .collection<AttendanceDayDocument>("attendance")
                .find({
                  outletId: { $in: outletIds },
                  date: { $gte: monthStart, $lte: dashboardDate },
                  status: "SUBMITTED",
                })
                .toArray()
            : Promise.resolve([]),
      ]);
    const whoIsAway: Array<{
      employeeId: string;
      employeeName: string;
      employeeCode: string;
      outletCode: string;
      date: string;
      status: "A" | "HD";
    }> = [];
    if (actor.permissions.includes("attendance.read") && outletIds.length) {
      const [awayDays, awayEmployees] = await Promise.all([
        db
          .collection<AttendanceDayDocument>("attendance")
          .find({
            outletId: { $in: outletIds },
            date: { $gte: awayFrom, $lte: awayTo },
            status: "SUBMITTED",
            "entries.status": { $in: ["A", "HD"] },
          })
          .sort({ date: -1 })
          .toArray(),
        db
          .collection<EmployeeDocument>("employees")
          .find({
            outletId: { $in: outletIds },
            dateOfJoining: { $lte: awayTo },
            $or: [
              { deactivatedAt: { $exists: false } },
              { deactivatedAt: { $gte: awayFrom } },
            ],
          })
          .toArray(),
      ]);
      const employeeById = new Map(
        awayEmployees.map((employee) => [
          employee._id.toHexString(),
          employee,
        ]),
      );
      const outletCodeById = new Map(
        outlets.map((outlet) => [outlet._id.toHexString(), outlet.code]),
      );
      for (const day of awayDays) {
        for (const entry of day.entries) {
          if (entry.status !== "A" && entry.status !== "HD") continue;
          const employee = employeeById.get(entry.employeeId.toHexString());
          if (
            !employee ||
            day.date < employee.dateOfJoining ||
            (employee.deactivatedAt && day.date > employee.deactivatedAt)
          )
            continue;
          whoIsAway.push({
            employeeId: employee._id.toHexString(),
            employeeName: employee.fullName,
            employeeCode: employee.employeeCode,
            outletCode: outletCodeById.get(day.outletId.toHexString()) ?? "",
            date: day.date,
            status: entry.status,
          });
        }
      }
    }
    let liveGrossSalary = 0;
    let liveNetPayable = 0;
    if (canReadSalary) {
      const activePayrollEmployees = employees.filter(
        (employee) =>
            employee.dateOfJoining <= dashboardDate &&
            (!employee.deactivatedAt || employee.deactivatedAt >= monthStart),
      );
      const employeeIds = activePayrollEmployees.map((employee) => employee._id);
      const approvedAdvances = employeeIds.length
        ? await db
              .collection<AdvanceDocument>("advances")
              .find({
                employeeId: { $in: employeeIds },
                status: "APPROVED",
                date: { $gte: monthStart, $lte: dashboardDate },
                payrollRecordId: { $exists: false },
              })
              .toArray()
        : [];
      const advanceTotals = new Map<string, number>();
      for (const advance of approvedAdvances) {
        const employeeId = advance.employeeId.toHexString();
        advanceTotals.set(
            employeeId,
            (advanceTotals.get(employeeId) ?? 0) + advance.amount,
        );
      }
      const attendanceCounts = new Map<
        string,
        { P: number; A: number; HD: number; WO: number }
      >();
      const markedDaysByEmployee = new Map<string, number>();
      const employeeById = new Map(
        activePayrollEmployees.map((employee) => [
            employee._id.toHexString(),
            employee,
        ]),
      );
      for (const day of monthDays) {
        for (const entry of day.entries) {
            const employeeId = entry.employeeId.toHexString();
            const employee = employeeById.get(employeeId);
            if (
              !employee ||
              day.date < employee.dateOfJoining ||
              (employee.deactivatedAt && day.date > employee.deactivatedAt)
            )
              continue;
            const counts = attendanceCounts.get(employeeId) ?? {
              P: 0,
              A: 0,
              HD: 0,
              WO: 0,
            };
            counts[entry.status] += 1;
            attendanceCounts.set(employeeId, counts);
            markedDaysByEmployee.set(
              employeeId,
              (markedDaysByEmployee.get(employeeId) ?? 0) + 1,
            );
        }
      }
      const salaryRecordByEmployee = new Map(
        salaryRecords.map((record) => [
            record.employeeId.toHexString(),
            record,
        ]),
      );
      const fullMonthSelected = dashboardDate >= monthEnd;
      for (const employee of activePayrollEmployees) {
        const savedRecord = salaryRecordByEmployee.get(
            employee._id.toHexString(),
        );
        if (fullMonthSelected && savedRecord) {
            liveGrossSalary += Number(
              savedRecord.calculation.grossEarnings ?? 0,
            );
            liveNetPayable += Number(savedRecord.calculation.netPayable ?? 0);
            continue;
        }
        const counts =
            attendanceCounts.get(employee._id.toHexString()) ?? {
              P: 0,
              A: 0,
              HD: 0,
              WO: 0,
            };
        const employedStart =
          employee.dateOfJoining > monthStart
            ? employee.dateOfJoining
            : monthStart;
        const employedEnd =
          employee.deactivatedAt && employee.deactivatedAt < monthEnd
            ? employee.deactivatedAt
            : monthEnd;
        const eligibleCalendarDays =
          employedStart > employedEnd
            ? 0
            : (Date.parse(`${employedEnd}T00:00:00Z`) -
                Date.parse(`${employedStart}T00:00:00Z`)) /
                86_400_000 +
              1;
        const employedFullMonth =
          employee.dateOfJoining <= monthStart &&
          (!employee.deactivatedAt || employee.deactivatedAt >= monthEnd);
        const completeAttendance =
          fullMonthSelected &&
          (markedDaysByEmployee.get(employee._id.toHexString()) ?? 0) >=
            eligibleCalendarDays;
        const calculation = calculatePayroll({
            monthlyBaseSalary: employee.monthlyBaseSalary,
            salaryMethod:
              employee.salaryMethod || settings?.defaultSalaryMethod || "FIXED_30_DAYS",
            daysInMonth,
            workingDaysDivisor: 30,
            presentDays: counts.P,
            absentDays: counts.A,
            halfDays: counts.HD,
            weekOffs: counts.WO,
            paidAbsences: settings?.paidAbsences ?? 0,
            settleMonthlySalary: completeAttendance,
            salaryEntitlementDays: employedFullMonth
              ? 30
              : eligibleCalendarDays,
            advances: advanceTotals.get(employee._id.toHexString()) ?? 0,
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
        liveGrossSalary += calculation.grossEarnings;
        liveNetPayable += calculation.netPayable;
      }
    }
    const attendance = { P: 0, A: 0, WO: 0, HD: 0 };
    for (const day of todayDays)
      for (const entry of day.entries) attendance[entry.status] += 1;
    const submittedOutlets = new Set(
      todayDays
        .filter((day) => day.status === "SUBMITTED")
        .map((day) => day.outletId.toHexString()),
    );
    const outletSummaries = await Promise.all(
      outlets.map(async (outlet) => {
        const employeeCount = await db
          .collection<EmployeeDocument>("employees")
          .countDocuments({ outletId: outlet._id, active: true });
        const day = todayDays.find((item) => item.outletId.equals(outlet._id));
        const counts = { P: 0, A: 0, WO: 0, HD: 0 };
        if (day) for (const entry of day.entries) counts[entry.status] += 1;
        return {
          id: outlet._id.toHexString(),
          _id: outlet._id.toHexString(),
          code: outlet.code,
          name: outlet.name,
          active: outlet.active,
          employees: employeeCount,
          attendance: counts,
          submitted: submittedOutlets.has(outlet._id.toHexString()),
        };
      }),
    );
    return NextResponse.json({
      today: dashboardDate,
      month,
      metrics: {
        activeEmployees,
        fullTimeEmployees,
        partTimeEmployees,
        activeOutlets: outlets.length,
        attendance,
        missingSubmissions: outlets.length - submittedOutlets.size,
        payrollCount: canReadSalary ? salaryRecords.length : null,
        pendingPayroll: canReadSalary
          ? salaryRecords.filter((record) => record.status === "DRAFT").length
          : null,
        pendingApprovals:
          (canReadSalary
            ? salaryRecords.filter((record) => record.status === "DRAFT").length
            : 0) + pendingAdvances,
        grossSalary: canReadSalary ? liveGrossSalary : null,
        netPayable: canReadSalary ? liveNetPayable : null,
      },
      outlets: outletSummaries,
      whoIsAway,
    });
  } catch (error) {
    return apiError(error);
  }
}
