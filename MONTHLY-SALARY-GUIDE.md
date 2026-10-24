# Monthly Salary Page Guide

## What this page is for

The **Monthly salary** page is where authorized staff create and manage payroll payments for employee attendance periods within a selected month. It brings submitted attendance, the employee's salary settings, approved advances, and any payroll adjustments together so the payable amount can be reviewed before it is approved and marked as paid.

The page can show employees before payroll exists. This lets an administrator review attendance and start payroll for individual employees or for the selected outlet.

Employee profiles also include a **Full-time / Part-time** classification. It is for employee records and dashboard counts only; changing it does not alter salary, attendance, or payroll calculations. Existing profiles without this field are treated as Full-time.

On the dashboard, **Attendance Summary** shows the day's Present, Absent, Half-day, and Week-off counts. **Who's Away** lists employees with submitted Absent or Half-day attendance for the selected date range. It is an attendance view, not an approved-leave list, and can be exported as CSV when the account has report-export permission.

## Choosing the month and outlet

- Choose a month with the month selector.
- Choose an outlet from the outlet selector. **All accessible outlets** shows employees and saved payroll records in every outlet available to your account.
- The table and CSV download follow the selected month and outlet filter.

## Understanding the table

- **Days P / A / HD / WO** lists Present, Absent, Half-day, and Week-off attendance counts.
- **Days filled** is the total of those four counts. It indicates how many attendance entries are included for the employee; it is not necessarily the number of calendar days in the month.
- **Gross** is earnings for the selected payroll period before deductions. It is calculated from the employee's monthly base salary and attendance, so a part-month payment is normally less than the full monthly base salary.
- The employee details also show **Monthly base salary**, which is the fixed salary saved in the employee profile. The base is not the same as the period's gross earnings.
- **Advances** contains only approved advances included in the generated payroll.
- **Employee ESI** and **Employee PF (deduction)** are employee contributions deducted from net pay when enabled for the employee.
- **Employer PF (tracked)** is tracked separately and is not deducted from the employee's net pay.
- **Loan deduction** is any repayment entered as a payroll adjustment.
- **Net payable** is the resulting take-home amount.
- **Not generated** means the employee is eligible to appear for the selected month, but no payroll record has been created for that employee and month yet. Financial payroll columns are blank until generation.

## What Generate does

Select the month and outlet, then click **Generate** on an employee's row to open the payroll review modal. For employees who already have a payroll period in that month, use **Next period** on their latest payroll row.

Choose the attendance period in the modal and review the calculated earnings and deductions. The default dates cover the next submitted, uncovered attendance period. You can edit gross earnings, ESI, employee PF, employer PF, and the loan deduction before generating. Approved advances are included automatically and must match their approved, unclaimed balance. Loan deduction is entered per payroll by `MAIN_ADMIN` and cannot exceed the employee's outstanding loan balance.

Payroll can be generated before month-end. Every date the employee was eligible to work in the selected period must have submitted attendance, and the period cannot include future dates. A new employee can therefore be paid for their submitted days without waiting for the month to finish. Each saved payroll period records its start and end dates. Later payroll periods can cover the remaining, non-overlapping dates in the same month. Existing legacy full-month payroll records cannot be split retroactively.

After deploying this change, run `npm run setup:db` once so the database replaces the old one-record-per-month payroll index with the period-aware index. This preserves payroll records; it only updates the index that controls duplicate payroll periods.

**Generate draft** creates an editable **DRAFT** record. If you have approval permission, **Generate and approve this payroll** creates the record already **APPROVED**. Approval prevents further adjustments. Neither action marks the payroll as paid; use **Mark paid** after the employee has been paid. A partial payment does not prevent generating another period for the remaining dates.

## Reviewing and completing payroll

Depending on the permissions granted to your account, a generated draft may be adjusted with a reason, approved, or marked as paid:

1. Review the attendance counts and calculation breakdown.
2. If permitted, add any required adjustment to the draft and provide its reason.
3. Approve the draft when it is correct. Approved records can no longer be adjusted.
4. After payment, use **Mark paid** to record the payment.

The page requires `salary.read` to view payroll. The **Generate** action requires `salary.generate`; draft adjustments, approval, and payment require their respective `salary.adjust`, `salary.approve`, and `salary.pay` permissions. A **MAIN_ADMIN** can grant these permissions directly or through a designation in **Access management**.

All payroll actions are available from the row's **Manage** overlay. `MAIN_ADMIN` can correct a paid record's gross, advances, employee ESI, employee PF, employer PF, and loan deduction; the net payable is recalculated and the correction reason is written to the audit log. These are payroll corrections and do not rewrite the original advance records. A changed loan deduction also updates the outstanding loan balance; increasing it is limited to the available balance. `MAIN_ADMIN` can use **Mark as unpaid** to return a paid record to **APPROVED**, clearing its payment timestamp so it can be marked paid again. Enter a reason for either operation.

## CSV download

Click **CSV** to download the currently displayed month and outlet scope. The file contains generated payroll periods and employees whose payroll has not yet been generated, including outlet, period, attendance counts, days filled, salary and deduction columns, net payable, status, and monthly base salary. Financial values that do not exist yet are blank for **Not generated** employees; known approved advances and disabled PF/ESI values are shown as amounts.

CSV is a plain-text format and cannot retain cell colors or table formatting. Use **Excel** for a formatted workbook with a dark-highlighted header row and filterable table data.

The CSV may contain confidential salary information. Store and share it only with authorized people.
