import test from "node:test";
import assert from "node:assert/strict";
import { calculatePayroll } from "../src/lib/payroll/calculate.ts";
import { getIndiaDate, getIndiaMonth, getMonthDates } from "../src/lib/payroll/dates.ts";
import { findExistingPayrollEmployees } from "../src/lib/payroll/duplicate.ts";
import { hashPassword, verifyPassword } from "../src/lib/passwords.ts";

const base = {
  monthlyBaseSalary: 30000,
  salaryMethod: "CALENDAR_DAYS",
  workingDaysDivisor: 26,
  presentDays: 25,
  absentDays: 0,
  halfDays: 2,
  weekOffs: 0,
  paidAbsences: 0,
  advances: 0,
  overtime: 0,
  allowances: 0,
  otherDeductions: 0,
  pfEnabled: false,
  employeePfPercent: 12,
  employerPfPercent: 12,
};

test("calendar divisor handles 28, 29, 30, and 31-day months including leap years", () => {
  assert.deepEqual(
    ["2025-02", "2024-02", "2025-04", "2025-01"].map(
      (month) => getMonthDates(month).daysInMonth,
    ),
    [28, 29, 30, 31],
  );
});

test("default business date and month follow India time", () => {
  const nearMidnightUtc = new Date("2026-01-01T20:00:00.000Z");
  assert.equal(getIndiaDate(nearMidnightUtc), "2026-01-02");
  assert.equal(getIndiaMonth(nearMidnightUtc), "2026-01");
});

test("30-day salary divisor pays every present and week-off day", () => {
  const { daysInMonth } = getMonthDates("2026-01");
  const result = calculatePayroll({
    ...base,
    monthlyBaseSalary: 31000,
    daysInMonth,
    presentDays: 26,
    absentDays: 2,
    halfDays: 0,
    weekOffs: 3,
  });
  assert.equal(result.dailyRate, 1033.33);
  assert.equal(result.payableDayUnits, 29);
  assert.equal(result.grossEarnings, 29966.67);
});

test("February full-month settlement pays full salary despite a 28-day month", () => {
  const { daysInMonth } = getMonthDates("2025-02");
  const result = calculatePayroll({
    ...base,
    monthlyBaseSalary: 20000,
    daysInMonth,
    presentDays: 25,
    absentDays: 0,
    halfDays: 0,
    weekOffs: 3,
    settleMonthlySalary: true,
    salaryEntitlementDays: 30,
  });
  assert.equal(result.dailyRate, 666.67);
  assert.equal(result.halfDayDeduction, 0);
  assert.equal(result.weekOffs, 3);
  assert.equal(result.payableDayUnits, 30);
  assert.equal(result.grossEarnings, 20000);
});

test("a complete 30-day month earns the full monthly salary with paid week-offs", () => {
  const result = calculatePayroll({
    ...base,
    daysInMonth: 30,
    presentDays: 27,
    absentDays: 0,
    halfDays: 0,
    weekOffs: 3,
    settleMonthlySalary: true,
    salaryEntitlementDays: 30,
  });
  assert.equal(result.payableDayUnits, 30);
  assert.equal(result.grossEarnings, 30000);
});

test("each absence deducts one 30th of monthly salary and each half-day deducts half", () => {
  const result = calculatePayroll({
    ...base,
    monthlyBaseSalary: 15000,
    daysInMonth: 30,
    presentDays: 1,
    absentDays: 1,
    halfDays: 1,
    weekOffs: 1,
    settleMonthlySalary: true,
    salaryEntitlementDays: 30,
  });
  assert.equal(result.dailyRate, 500);
  assert.equal(result.halfDayDeduction, 250);
  assert.equal(result.payableDayUnits, 28.5);
  assert.equal(result.grossEarnings, 14250);
});

test("half days earn half a day using decimal-safe INR rounding", () => {
  const result = calculatePayroll({ ...base, daysInMonth: 30 });
  assert.equal(result.halfDayDeduction, 1000);
  assert.equal(result.grossEarnings, 26000);
  assert.equal(result.netPayable, 26000);
});

test("a 31-day month cannot increase full-month base salary above its monthly amount", () => {
  const result = calculatePayroll({
    ...base,
    daysInMonth: 31,
    presentDays: 28,
    halfDays: 0,
    weekOffs: 3,
    settleMonthlySalary: true,
    salaryEntitlementDays: 30,
  });
  assert.equal(result.weekOffs, 3);
  assert.equal(result.payableDayUnits, 30);
  assert.equal(result.grossEarnings, 30000);
});

test("salary divisor remains 30 even for legacy 26-day employee settings", () => {
  const result = calculatePayroll({
    ...base,
    salaryMethod: "WORKING_DAYS_26",
    daysInMonth: 31,
    presentDays: 26,
    halfDays: 0,
  });
  assert.equal(result.dailyRate, 1000);
  assert.equal(result.grossEarnings, 26000);
});

test("full-month settlement deducts an absence in a 31-day month", () => {
  const result = calculatePayroll({
    ...base,
    salaryMethod: "WORKING_DAYS_26",
    daysInMonth: 31,
    presentDays: 27,
    absentDays: 1,
    halfDays: 0,
    weekOffs: 3,
    settleMonthlySalary: true,
    salaryEntitlementDays: 30,
  });
  assert.equal(result.payableDayUnits, 29);
  assert.equal(result.grossEarnings, 29000);
});

test("full-month salary is prorated for an employee who joined partway through the month", () => {
  const result = calculatePayroll({
    ...base,
    monthlyBaseSalary: 20000,
    daysInMonth: 28,
    presentDays: 13,
    absentDays: 1,
    halfDays: 0,
    weekOffs: 0,
    settleMonthlySalary: true,
    salaryEntitlementDays: 14,
  });
  assert.equal(result.dailyRate, 666.67);
  assert.equal(result.payableDayUnits, 13);
  assert.equal(result.grossEarnings, 8666.67);
});

test("full-month week-offs cannot raise base earnings above monthly salary", () => {
  const result = calculatePayroll({
    ...base,
    salaryMethod: "WORKING_DAYS_26",
    daysInMonth: 30,
    presentDays: 26,
    halfDays: 0,
    weekOffs: 3,
    settleMonthlySalary: true,
  });
  assert.equal(result.payableDayUnits, 30);
  assert.equal(result.grossEarnings, 30000);
});

test("partial-month calculations accrue only submitted paid attendance units", () => {
  const result = calculatePayroll({ ...base, salaryMethod: "WORKING_DAYS_26", daysInMonth: 30, presentDays: 20, halfDays: 0, weekOffs: 5 });
  assert.equal(result.dailyRate, 1000);
  assert.equal(result.payableDayUnits, 25);
  assert.equal(result.grossEarnings, 25000);
});

test("an incomplete month does not settle full salary or infer absences", () => {
  const result = calculatePayroll({
    ...base,
    monthlyBaseSalary: 20000,
    daysInMonth: 28,
    presentDays: 25,
    absentDays: 0,
    halfDays: 0,
    weekOffs: 2,
    settleMonthlySalary: false,
  });
  assert.equal(result.payableDayUnits, 27);
  assert.equal(result.grossEarnings, 18000);
});

test("PF is optional and employer PF is reported separately from take-home", () => {
  const result = calculatePayroll({
    ...base,
    daysInMonth: 30,
    pfEnabled: true,
    employeePfPercent: 12,
    employerPfPercent: 13,
  });
  assert.equal(result.employeePf, 3120);
  assert.equal(result.employerPf, 3380);
  assert.equal(result.netPayable, 22880);
});

test("enabled ESI defaults to 0.75 percent and reduces take-home pay", () => {
  const result = calculatePayroll({
    ...base,
    daysInMonth: 30,
    esiEnabled: true,
    esiPercent: 0.75,
  });
  assert.equal(result.esi, 195);
  assert.equal(result.netPayable, 25805);
});

test("loan repayments and ESI are included in take-home deductions", () => {
  const result = calculatePayroll({
    ...base,
    daysInMonth: 30,
    loanDeduction: 1200,
    esiEnabled: true,
    esiPercent: 0.75,
  });
  assert.equal(result.loanDeduction, 1200);
  assert.equal(result.esi, 195);
  assert.equal(result.netPayable, 24605);
});

test("approved advances, other deductions, overtime, and allowances reconcile", () => {
  const result = calculatePayroll({
    ...base,
    daysInMonth: 30,
    advances: 3000,
    overtime: 500,
    allowances: 200,
    otherDeductions: 100,
  });
  assert.equal(result.netPayable, 23600);
});

test("uses the 30-day divisor and rounds half paise upward consistently", () => {
  const result = calculatePayroll({
    ...base,
    monthlyBaseSalary: 1000,
    daysInMonth: 28,
    presentDays: 1,
    halfDays: 0,
  });
  assert.equal(result.dailyRate, 33.33);
  assert.equal(result.grossEarnings, 33.33);
});

test("duplicate payroll runs are detected for employees already generated", () => {
  assert.deepEqual(
    findExistingPayrollEmployees(["employee-a"], ["employee-a", "employee-b"]),
    ["employee-a"],
  );
  assert.deepEqual(findExistingPayrollEmployees([], ["employee-a"]), []);
});

test("passwords are salted hashes and verify only against the original password", async () => {
  const password = "Fresh-Admin-Pass-2026";
  const hash = await hashPassword(password);
  assert.notEqual(hash, password);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("different-password", hash), false);
});
