import ExcelJS from "exceljs";
import { ObjectId } from "mongodb";
import { connection, NextResponse } from "next/server";
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
  AuditLogDocument,
  EmployeeDocument,
  OutletDocument,
  SalaryRecordDocument,
  SalarySettings,
} from "@/lib/models";
import { z } from "zod";

const querySchema = z.object({
  type: z.enum(["attendance", "salary", "employees", "advances", "audit", "away"]),
  format: z.enum(["xlsx", "csv"]).default("xlsx"),
  from: dateOnlySchema,
  to: dateOnlySchema,
  outletId: objectIdSchema.optional(),
  employeeId: objectIdSchema.optional(),
});

type ExportRow = Record<string, string | number | boolean | null>;
const defaultSalaryRules: SalarySettings = {
  timezone: "Asia/Kolkata",
  defaultSalaryMethod: "FIXED_30_DAYS",
  workingDaysDivisor: 30,
  paidAbsences: 0,
  currency: "INR",
  advanceDeductionPolicy: "UNPAID_ONLY",
};

export async function GET(request: Request) {
  try {
    await connection();
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (!actor.permissions.includes("reports.export"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const url = new URL(request.url);
    const query = querySchema.parse({
      type: url.searchParams.get("type"),
      format: url.searchParams.get("format") ?? "xlsx",
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
    if (query.type !== "away" && span > 366)
      return NextResponse.json(
        { error: "Export ranges are limited to 367 calendar days." },
        { status: 400 },
      );
    if (query.type === "away" && span > 36_525)
      return NextResponse.json(
        { error: "Who’s Away exports are limited to 100 years." },
        { status: 400 },
      );
    if (query.type === "audit" && !actor.permissions.includes("audit.read"))
      return NextResponse.json(
        { error: "Audit export requires audit access." },
        { status: 403 },
      );
    if (
      query.type === "salary" &&
      !actor.permissions.includes("salary.read")
    )
      return NextResponse.json(
        { error: "Salary export requires payroll access." },
        { status: 403 },
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
    if (query.outletId && !outlets.length) throw new Error("NOT_FOUND");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "La Milano Attendance Management System";
    workbook.created = new Date();
    workbook.subject = `${query.type} export ${query.from} to ${query.to}`;
    workbook.views = [
      {
        x: 0,
        y: 0,
        width: 16000,
        height: 9000,
        firstSheet: 0,
        activeTab: 0,
        visibility: "visible",
      },
    ];
    const byOutlet: Array<{ outlet: OutletDocument; rows: ExportRow[] }> = [];
    for (const outlet of outlets)
      byOutlet.push({
        outlet,
        rows: await getRows(
          query.type,
          query.from,
          query.to,
          outlet,
          db,
          query.employeeId,
          actor.permissions.includes("salary.read"),
        ),
      });
    const globalAuditRows: ExportRow[] =
      query.type === "audit" && actor.role === "MAIN_ADMIN" && !query.outletId
        ? (
            await db
              .collection<AuditLogDocument>("auditLogs")
              .find({
                outletId: { $exists: false },
                at: {
                  $gte: new Date(`${query.from}T00:00:00.000Z`),
                  $lte: new Date(`${query.to}T23:59:59.999Z`),
                },
              })
              .sort({ at: 1 })
              .toArray()
          ).map((log) => ({
            Timestamp: log.at.toISOString(),
            Actor: log.actorEmail,
            Action: log.action,
            Entity: log.entityType,
            "Entity ID": log.entityId,
            Reason: log.reason ?? "",
          }))
        : [];

    if (query.format === "csv") {
      const rows: ExportRow[] = byOutlet.flatMap(({ outlet, rows }) =>
        rows.map((row) => ({ "Outlet Name": outlet.name, ...row })),
      );
      if (globalAuditRows.length)
        rows.push(
          ...globalAuditRows.map((row) => ({
            "Outlet Name": "GLOBAL",
            ...row,
          })),
        );
      const headers = rows.length
        ? [...new Set(rows.flatMap((row) => Object.keys(row)))]
        : emptyHeaders(query.type, actor.permissions.includes("salary.read"));
      const csv = [
        headers.map(csvCell).join(","),
        ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
      ].join("\r\n");
      const filename = `la-milano-${query.type}-${query.from}-to-${query.to}.csv`;
      return new NextResponse(`\uFEFF${csv}`, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    for (const item of byOutlet) {
      const sheet = workbook.addWorksheet(
        sheetName(`${item.outlet.code} ${item.outlet.name}`, workbook),
      );
      const headers = item.rows.length
        ? Object.keys(item.rows[0])
        : emptyHeaders(query.type, actor.permissions.includes("salary.read"));
      sheet.addRow(headers);
      if (!item.rows.length)
        sheet.addRow(["No records found for this outlet and date range."]);
      for (const row of item.rows)
        sheet.addRow(headers.map((header) => safeCell(row[header])));
      styleSheet(sheet, true);
    }
    if (globalAuditRows.length) {
      const sheet = workbook.addWorksheet(sheetName("Global audit", workbook));
      const headers = Object.keys(globalAuditRows[0]);
      sheet.addRow(headers);
      for (const row of globalAuditRows)
        sheet.addRow(headers.map((header) => safeCell(row[header])));
      styleSheet(sheet, true);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `la-milano-${query.type}-${query.from}-to-${query.to}.xlsx`;
    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

function addAttendanceSummary(
  sheet: ExcelJS.Worksheet,
  byOutlet: Array<{ outlet: OutletDocument; rows: ExportRow[] }>,
  from: string,
  to: string,
  canReadSalary: boolean,
) {
  sheet.addRow(["LA MILANO", "Employee-wise Attendance & Payable"]);
  sheet.addRow(["Period", from, "to", to]);
  sheet.addRow(["Generated", new Date().toISOString()]);
  sheet.addRow([]);
  const headers = [
    "Outlet",
    "Outlet Name",
    "Employee Code",
    "Employee",
    "Designation",
    "Present Days",
    "Absent Days",
    "Half Days",
    "Week Offs",
    "Attendance Filled Days",
    "Present Dates",
    "Absent Dates",
    "Half Day Dates",
    "Week Off Dates",
    "Missing Dates",
    "Unsubmitted Dates",
    ...(canReadSalary
      ? [
          "Fixed Monthly Salary INR",
          "Daily Rate INR",
          "Payable Day Units",
          "Gross Earnings INR",
          "Advance Deduction INR",
          "Employee ESI INR",
          "Employee PF INR",
          "Employer PF INR",
          "Loan Deduction INR",
          "Other Deductions INR",
          "Net Payable INR",
          "Payable Type",
        ]
      : []),
  ];
  sheet.addRow(headers);
  let recordCount = 0;
  for (const item of byOutlet) {
    for (const row of item.rows) {
      recordCount += 1;
      sheet.addRow(
        headers.map((header) =>
          safeCell(
            header === "Outlet Name"
              ? item.outlet.name
              : header === "Present Days"
                ? row.Present
                : header === "Absent Days"
                  ? row.Absent
                  : header === "Half Days"
                    ? row["Half Days"]
                    : header === "Week Offs"
                      ? row["Week Offs"]
                      : header === "Attendance Filled Days"
                        ? row["Attendance Filled Days"]
                        : row[header],
          ),
        ),
      );
    }
  }
  if (recordCount === 0) {
    sheet.addRow(["No employees found for the selected outlet and period."]);
  }
  sheet.addRow([]);
  sheet.addRow(["Outlet summary"]);
  sheet.addRow(["Outlet", "Code", "Employee Records"]);
  for (const item of byOutlet)
    sheet.addRow([
      safeCell(item.outlet.name),
      safeCell(item.outlet.code),
      item.rows.length,
    ]);

  sheet.views = [
    {
      state: "frozen",
      xSplit: 0,
      ySplit: 5,
      topLeftCell: "A6",
    },
  ];
  sheet.views[0].showGridLines = true;
  sheet.views[0].zoomScale = 80;
  sheet.getRow(1).font = { bold: true, size: 16, color: { argb: "FF30312E" } };
  sheet.getRow(5).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  sheet.getRow(5).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF30312E" },
  };
  for (const rowNumber of [recordCount + 8, recordCount + 9]) {
    sheet.getRow(rowNumber).font = { bold: true };
    if (rowNumber === recordCount + 9)
      sheet.getRow(rowNumber).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFECE9E2" },
      };
  }
  sheet.columns.forEach((column) => {
    column.width = Math.min(
      40,
      Math.max(
        14,
        ...(column.values ?? []).map(
          (value) => String(value ?? "").length + 2,
        ),
      ),
    );
  });
  for (let column = 1; column <= headers.length; column += 1) {
    if (!headers[column - 1].includes("INR")) continue;
    for (let row = 6; row <= recordCount + 5; row += 1) {
      const cell = sheet.getRow(row).getCell(column);
      if (typeof cell.value === "number") cell.numFmt = "₹#,##0.00";
    }
  }
  sheet.autoFilter = {
    from: { row: 5, column: 1 },
    to: { row: 5, column: headers.length },
  };
  sheet.eachRow((row) => {
    row.alignment = { vertical: "middle" };
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFD5D7D2" } },
        left: { style: "thin", color: { argb: "FFD5D7D2" } },
        bottom: { style: "thin", color: { argb: "FFD5D7D2" } },
        right: { style: "thin", color: { argb: "FFD5D7D2" } },
      };
    });
  });
}

async function getRows(
  type: string,
  from: string,
  to: string,
  outlet: OutletDocument,
  db: Awaited<ReturnType<typeof getDb>>,
  employeeId?: string,
  canReadSalary = false,
): Promise<ExportRow[]> {
  const employees = await db
    .collection<EmployeeDocument>("employees")
    .find({
      outletId: outlet._id,
      ...(employeeId ? { _id: new ObjectId(employeeId) } : {}),
    })
    .toArray();
  const employeeById = new Map(
    employees.map((employee) => [employee._id.toHexString(), employee]),
  );
  if (type === "employees")
    return employees.map((employee) => ({
      Code: employee.employeeCode,
      Name: employee.fullName,
      Designation: employee.designation,
      "Employment Type":
        employee.employmentType === "PART_TIME" ? "Part-time" : "Full-time",
      Mobile: employee.mobile,
      "Date Joined": employee.dateOfJoining,
      "Base Salary INR": employee.monthlyBaseSalary,
      "Salary Method": "Fixed 30-day",
      "PF Enabled": employee.pfEnabled ? "Yes" : "No",
      "Employee PF %": employee.employeePfPercent ?? 0,
      "Employer PF %": employee.employerPfPercent ?? 0,
      "ESI Enabled": employee.esiEnabled ? "Yes" : "No",
      "Employee ESI %": employee.esiEnabled ? employee.esiPercent ?? 0.75 : 0,
      Active: employee.active ? "Yes" : "No",
    }));
  if (type === "away") {
    const days = await db
      .collection<AttendanceDayDocument>("attendance")
      .find({
        outletId: outlet._id,
        date: { $gte: from, $lte: to },
        status: "SUBMITTED",
        "entries.status": { $in: ["A", "HD"] },
      })
      .sort({ date: -1 })
      .toArray();
    const rows: ExportRow[] = [];
    for (const day of days) {
      for (const entry of day.entries) {
        if (entry.status !== "A" && entry.status !== "HD") continue;
        const employee = employeeById.get(entry.employeeId.toHexString());
        if (
          !employee ||
          day.date < employee.dateOfJoining ||
          (employee.deactivatedAt && day.date > employee.deactivatedAt)
        )
          continue;
        rows.push({
          Employee: employee.fullName,
          "Employee Code": employee.employeeCode,
          Outlet: outlet.code,
          Date: day.date,
          Status: entry.status === "A" ? "Absent" : "Half-day",
        });
      }
    }
    return rows;
  }
  if (type === "attendance") {
    const days = await db
      .collection<AttendanceDayDocument>("attendance")
      .find({ outletId: outlet._id, date: { $gte: from, $lte: to } })
      .sort({ date: 1 })
      .toArray();
    const dayByDate = new Map(days.map((day) => [day.date, day]));
    const salaryRules = {
      ...defaultSalaryRules,
      ...(await db
        .collection<SalarySettings & { _id: string }>("settings")
        .findOne({ _id: "payroll" })),
    };
    const employeeIds = employees.map((employee) => employee._id);
    const [advances, salaryRecords] = canReadSalary
      ? await Promise.all([
          db
            .collection<AdvanceDocument>("advances")
            .find({
              employeeId: { $in: employeeIds },
              outletId: outlet._id,
              status: "APPROVED",
              date: { $gte: from, $lte: to },
              payrollRecordId: { $exists: false },
            })
            .toArray(),
          db
            .collection<SalaryRecordDocument>("salaryRecords")
            .find({
              employeeId: { $in: employeeIds },
              outletId: outlet._id,
              month: {
                $gte: from.slice(0, 7),
                $lte: to.slice(0, 7),
              },
            })
            .toArray(),
        ])
      : [[], []];
    const advancesByEmployee = new Map<string, AdvanceDocument[]>();
    for (const advance of advances) {
      const key = advance.employeeId.toHexString();
      advancesByEmployee.set(key, [
        ...(advancesByEmployee.get(key) ?? []),
        advance,
      ]);
    }
    const payrollByEmployeeMonth = new Map(
      salaryRecords.map((record) => [
        `${record.employeeId.toHexString()}:${record.month}`,
        record,
      ]),
    );
    return employees.map((employee) => {
      const start =
        employee.dateOfJoining > from ? employee.dateOfJoining : from;
      const end =
        employee.deactivatedAt && employee.deactivatedAt < to
          ? employee.deactivatedAt
          : to;
      const statusDates: Record<AttendanceStatus, string[]> = {
        P: [],
        A: [],
        HD: [],
        WO: [],
      };
      const missingDates: string[] = [];
      const unsubmittedDates: string[] = [];
      const monthCounts = new Map<
        string,
        {
          counts: Record<AttendanceStatus, number>;
          eligibleDays: number;
          complete: boolean;
        }
      >();
      if (start <= end) {
        for (let date = start; date <= end; date = dateAfter(date, 1)) {
          const month = date.slice(0, 7);
          let monthData = monthCounts.get(month);
          if (!monthData) {
            monthData = {
              counts: { P: 0, A: 0, HD: 0, WO: 0 },
              eligibleDays: 0,
              complete: true,
            };
            monthCounts.set(month, monthData);
          }
          monthData.eligibleDays += 1;
          const day = dayByDate.get(date);
          const entry = day?.entries.find((item) =>
            item.employeeId.equals(employee._id),
          );
          if (!day || !entry) {
            missingDates.push(date);
            monthData.complete = false;
            continue;
          }
          statusDates[entry.status].push(date);
          if (day.status !== "SUBMITTED") {
            unsubmittedDates.push(date);
            monthData.complete = false;
            continue;
          }
          monthData.counts[entry.status] += 1;
        }
      }
      const counts = {
        P: statusDates.P.length,
        A: statusDates.A.length,
        HD: statusDates.HD.length,
        WO: statusDates.WO.length,
      };
      const result: ExportRow = {
        Outlet: outlet.code,
        "Employee Code": employee.employeeCode,
        Employee: employee.fullName,
        Designation: employee.designation,
        Present: counts.P,
        Absent: counts.A,
        "Half Days": counts.HD,
        "Week Offs": counts.WO,
        "Attendance Filled Days":
          counts.P + counts.A + counts.HD + counts.WO,
        "Present Dates": statusDates.P.join(", "),
        "Absent Dates": statusDates.A.join(", "),
        "Half Day Dates": statusDates.HD.join(", "),
        "Week Off Dates": statusDates.WO.join(", "),
        "Missing Dates": missingDates.join(", "),
        "Unsubmitted Dates": unsubmittedDates.join(", "),
      };
      if (canReadSalary) {
        let dailyRate = 0;
        let payableDayUnits = 0;
        let grossEarnings = 0;
        let advanceDeduction = 0;
        let employeeEsi = 0;
        let employeePf = 0;
        let employerPf = 0;
        let loanDeduction = 0;
        let otherDeductions = 0;
        let netPayable = 0;
        let hasLiveCalculation = false;
        let hasSavedPayroll = false;
        for (const [month, monthDayCounts] of monthCounts) {
          const { daysInMonth } = getMonthDates(month);
          const saved = payrollByEmployeeMonth.get(
            `${employee._id.toHexString()}:${month}`,
          );
          const fullMonthSelected =
            from <= `${month}-01` &&
            to >= `${month}-${String(daysInMonth).padStart(2, "0")}`;
          if (saved && fullMonthSelected) {
            dailyRate = Number(saved.calculation.dailyRate ?? dailyRate);
            payableDayUnits += Number(
              saved.calculation.payableDayUnits ?? 0,
            );
            grossEarnings += Number(saved.calculation.grossEarnings ?? 0);
            advanceDeduction += Number(saved.calculation.advances ?? 0);
            employeeEsi += Number(saved.calculation.esi ?? 0);
            employeePf += Number(saved.calculation.employeePf ?? 0);
            employerPf += Number(saved.calculation.employerPf ?? 0);
            loanDeduction += Number(saved.calculation.loanDeduction ?? 0);
            otherDeductions += Number(
              saved.calculation.otherDeductions ?? 0,
            );
            netPayable += Number(saved.calculation.netPayable ?? 0);
            hasSavedPayroll = true;
            continue;
          }
          hasLiveCalculation = true;
          const advanceAmount = (advancesByEmployee.get(
            employee._id.toHexString(),
          ) ?? [])
            .filter((advance) => advance.date.startsWith(`${month}-`))
            .reduce((sum, advance) => sum + advance.amount, 0);
          const calculation = calculatePayroll({
            monthlyBaseSalary: employee.monthlyBaseSalary,
            salaryMethod: "FIXED_30_DAYS",
            daysInMonth,
            workingDaysDivisor: 30,
            presentDays: monthDayCounts.counts.P,
            absentDays: monthDayCounts.counts.A,
            halfDays: monthDayCounts.counts.HD,
            weekOffs: monthDayCounts.counts.WO,
            paidAbsences: salaryRules.paidAbsences,
            settleMonthlySalary:
              fullMonthSelected && monthDayCounts.complete,
            salaryEntitlementDays:
              employee.dateOfJoining <= `${month}-01` &&
              (!employee.deactivatedAt ||
                employee.deactivatedAt >=
                  `${month}-${String(daysInMonth).padStart(2, "0")}`)
                ? 30
                : monthDayCounts.eligibleDays,
            advances: advanceAmount,
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
          dailyRate = calculation.dailyRate;
          payableDayUnits += calculation.payableDayUnits;
          grossEarnings += calculation.grossEarnings;
          advanceDeduction += calculation.advances;
          employeeEsi += calculation.esi;
          employeePf += calculation.employeePf;
          employerPf += calculation.employerPf;
          loanDeduction += calculation.loanDeduction;
          otherDeductions += calculation.otherDeductions;
          netPayable += calculation.netPayable;
        }
        result["Fixed Monthly Salary INR"] = employee.monthlyBaseSalary;
        result["Daily Rate INR"] = dailyRate;
        result["Payable Day Units"] = payableDayUnits;
        result["Gross Earnings INR"] = grossEarnings;
        result["Advance Deduction INR"] = advanceDeduction;
        result["Employee ESI INR"] = employeeEsi;
        result["Employee PF INR"] = employeePf;
        result["Employer PF INR"] = employerPf;
        result["Loan Deduction INR"] = loanDeduction;
        result["Other Deductions INR"] = otherDeductions;
        result["Net Payable INR"] = netPayable;
        result["Payable Type"] = hasLiveCalculation
          ? "Live accrued · submitted days"
          : hasSavedPayroll
            ? "Payroll record"
            : "No submitted attendance";
      }
      return result;
    });
  }
  if (type === "salary") {
    const fromMonth = from.slice(0, 7);
    const toMonth = to.slice(0, 7);
    const records = await db
      .collection<SalaryRecordDocument>("salaryRecords")
      .find({ outletId: outlet._id, month: { $gte: fromMonth, $lte: toMonth } })
      .sort({ month: 1 })
      .toArray();
    const generatedEmployeeIds = new Set(
      records.map((record) => record.employeeId.toHexString()),
    );
    const monthEnd = `${toMonth}-${String(getMonthDates(toMonth).daysInMonth).padStart(2, "0")}`;
    const monthStart = `${fromMonth}-01`;
    const attendanceDays = await db
      .collection<AttendanceDayDocument>("attendance")
      .find({
        outletId: outlet._id,
        date: { $gte: monthStart, $lte: monthEnd },
        status: "SUBMITTED",
      })
      .toArray();
    const countsByEmployee = new Map<
      string,
      { P: number; A: number; HD: number; WO: number }
    >();
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
        const counts = countsByEmployee.get(employeeId) ?? {
          P: 0,
          A: 0,
          HD: 0,
          WO: 0,
        };
        counts[entry.status] += 1;
        countsByEmployee.set(employeeId, counts);
      }
    }
    const unclaimedAdvances = await db
      .collection<AdvanceDocument>("advances")
      .find({
        outletId: outlet._id,
        status: "APPROVED",
        date: { $gte: monthStart, $lte: monthEnd },
        payrollRecordId: { $exists: false },
      })
      .toArray();
    const advancesByEmployee = new Map<string, number>();
    for (const advance of unclaimedAdvances) {
      const employeeId = advance.employeeId.toHexString();
      advancesByEmployee.set(
        employeeId,
        (advancesByEmployee.get(employeeId) ?? 0) + advance.amount,
      );
    }
    return [
      ...records.map((record) => {
        const employee = employeeById.get(record.employeeId.toHexString());
        const present = Number(record.calculation.presentDays ?? 0);
        const absent = Number(record.calculation.absentDays ?? 0);
        const halfDays = Number(record.calculation.halfDays ?? 0);
        const weekOffs = Number(record.calculation.weekOffs ?? 0);
        return {
          Month: record.month,
          "Outlet Code": outlet.code,
          "Employee Code": employee?.employeeCode ?? "Unknown",
          Employee: employee?.fullName ?? "Unknown",
          Designation: employee?.designation ?? "",
          Period:
            record.periodStart && record.periodEnd
              ? `${record.periodStart} - ${record.periodEnd}`
              : "Full month",
          "Days P / A / HD / WO": `${present} / ${absent} / ${halfDays} / ${weekOffs}`,
          "Days filled": present + absent + halfDays + weekOffs,
          "Monthly base salary INR": employee?.monthlyBaseSalary ?? 0,
          "Gross INR": Number(record.calculation.grossEarnings ?? 0),
          "Advances INR": Number(record.calculation.advances ?? 0),
          "Employee ESI INR": Number(record.calculation.esi ?? 0),
          "Employee PF (deduction) INR": Number(
            record.calculation.employeePf ?? 0,
          ),
          "Employer PF (tracked) INR": Number(
            record.calculation.employerPf ?? 0,
          ),
          "Loan deduction INR": Number(record.calculation.loanDeduction ?? 0),
          "Net payable INR": Number(record.calculation.netPayable ?? 0),
          Status: record.status,
        };
      }),
      ...(fromMonth === toMonth
        ? employees
            .filter(
              (employee) =>
                employee.dateOfJoining <= monthEnd &&
                (!employee.deactivatedAt ||
                  employee.deactivatedAt >= monthStart) &&
                !generatedEmployeeIds.has(employee._id.toHexString()),
            )
            .map((employee) => {
          const counts = countsByEmployee.get(employee._id.toHexString()) ?? {
            P: 0,
            A: 0,
            HD: 0,
            WO: 0,
          };
          return {
            Month: fromMonth,
            "Outlet Code": outlet.code,
            "Employee Code": employee.employeeCode,
            Employee: employee.fullName,
            Designation: employee.designation,
            Period: "",
            "Days P / A / HD / WO": `${counts.P} / ${counts.A} / ${counts.HD} / ${counts.WO}`,
            "Days filled": counts.P + counts.A + counts.HD + counts.WO,
            "Monthly base salary INR": employee.monthlyBaseSalary,
            "Gross INR": "",
            "Advances INR":
              advancesByEmployee.get(employee._id.toHexString()) ?? 0,
            "Employee ESI INR": 0,
            "Employee PF (deduction) INR": 0,
            "Employer PF (tracked) INR": 0,
            "Loan deduction INR": 0,
            "Net payable INR": "",
            Status: "Not generated",
          };
            })
        : []),
    ];
  }
  if (type === "advances") {
    const advances = await db
      .collection<AdvanceDocument>("advances")
      .find({ outletId: outlet._id, date: { $gte: from, $lte: to } })
      .sort({ date: 1 })
      .toArray();
    return advances.map((advance) => ({
      Date: advance.date,
      "Employee Code":
        employeeById.get(advance.employeeId.toHexString())?.employeeCode ??
        "Unknown",
      Employee:
        employeeById.get(advance.employeeId.toHexString())?.fullName ??
        "Unknown",
      "Amount INR": advance.amount,
      "Given By": advance.givenBy,
      Reference: advance.reference,
      Status: advance.status,
      "Payroll Claimed": advance.payrollRecordId ? "Yes" : "No",
    }));
  }
  const logs = await db
    .collection<AuditLogDocument>("auditLogs")
    .find({
      outletId: outlet._id,
      at: {
        $gte: new Date(`${from}T00:00:00.000Z`),
        $lte: new Date(`${to}T23:59:59.999Z`),
      },
    })
    .sort({ at: 1 })
    .toArray();
  return logs.map((log) => ({
    Timestamp: log.at.toISOString(),
    Actor: log.actorEmail,
    Action: log.action,
    Entity: log.entityType,
    "Entity ID": log.entityId,
    Reason: log.reason ?? "",
  }));
}

function safeCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  const text = String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function styleSheet(sheet: ExcelJS.Worksheet, hasHeaders = false) {
  sheet.views = [
    {
      state: "frozen",
      xSplit: 0,
      ySplit: hasHeaders ? 1 : 4,
      topLeftCell: hasHeaders ? "A2" : "A5",
    },
  ];
  sheet.views[0].showGridLines = true;
  sheet.views[0].zoomScale = 80;
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF30312E" },
  };
  if (!hasHeaders) {
    sheet.getRow(5).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(5).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF30312E" },
    };
  }
  sheet.columns.forEach((column) => {
    column.width = Math.min(
      36,
      Math.max(
        14,
        ...(column.values ?? []).map((value) => String(value ?? "").length + 2),
      ),
    );
  });
  sheet.autoFilter =
    hasHeaders && sheet.rowCount > 1
      ? {
          from: { row: 1, column: 1 },
          to: { row: 1, column: sheet.columnCount },
        }
      : undefined;
  const headerRow = hasHeaders ? 1 : 5;
  for (let column = 1; column <= sheet.columnCount; column += 1) {
    const heading = String(sheet.getRow(headerRow).getCell(column).value ?? "");
    if (!heading.includes("INR")) continue;
    for (let row = headerRow + 1; row <= sheet.rowCount; row += 1) {
      const cell = sheet.getRow(row).getCell(column);
      if (typeof cell.value === "number") cell.numFmt = "₹#,##0.00";
    }
  }
  sheet.eachRow((row) => {
    row.alignment = { vertical: "middle" };
  });
}

function sheetName(value: string, workbook: ExcelJS.Workbook) {
  const base =
    value
      .replace(/[\\/?*\[\]:]/g, " ")
      .trim()
      .slice(0, 31) || "Outlet";
  let name = base;
  let suffix = 2;
  while (workbook.getWorksheet(name)) {
    name = `${base.slice(0, 27)} ${suffix}`;
    suffix += 1;
  }
  return name;
}

function emptyHeaders(type: string, canReadSalary = false): string[] {
  if (type === "away")
    return ["Employee", "Employee Code", "Outlet", "Date", "Status"];
  if (type === "attendance") {
    const headers = [
      "Outlet",
      "Employee Code",
      "Employee",
      "Designation",
      "Present",
      "Absent",
      "Half Days",
      "Week Offs",
      "Attendance Filled Days",
      "Present Dates",
      "Absent Dates",
      "Half Day Dates",
      "Week Off Dates",
      "Missing Dates",
      "Unsubmitted Dates",
    ];
    if (canReadSalary)
      headers.push(
        "Fixed Monthly Salary INR",
        "Daily Rate INR",
        "Payable Day Units",
        "Gross Earnings INR",
        "Advance Deduction INR",
        "Employee ESI INR",
        "Employee PF INR",
        "Employer PF INR",
        "Loan Deduction INR",
        "Other Deductions INR",
        "Net Payable INR",
        "Payable Type",
      );
    return headers;
  }
  if (type === "salary")
    return [
      "Month",
      "Outlet Code",
      "Employee Code",
      "Employee",
      "Designation",
      "Period",
      "Days P / A / HD / WO",
      "Days filled",
      "Monthly base salary INR",
      "Gross INR",
      "Advances INR",
      "Employee ESI INR",
      "Employee PF (deduction) INR",
      "Employer PF (tracked) INR",
      "Loan deduction INR",
      "Net payable INR",
      "Status",
    ];
  if (type === "employees")
    return [
      "Code",
      "Name",
      "Designation",
      "Employment Type",
      "Mobile",
      "Date Joined",
      "Base Salary INR",
      "Salary Method",
      "PF Enabled",
      "Employee PF %",
      "Employer PF %",
      "ESI Enabled",
      "Employee ESI %",
      "Active",
    ];
  if (type === "advances")
    return [
      "Date",
      "Employee Code",
      "Employee",
      "Amount INR",
      "Given By",
      "Reference",
      "Status",
      "Payroll Claimed",
    ];
  return ["Timestamp", "Actor", "Action", "Entity", "Entity ID", "Reason"];
}

function label(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
