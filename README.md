# La Milano Attendance & Salary

Attendance, employee, advance, outlet, access, payroll, audit, and Excel-reporting workspace for La Milano Pizzeria's ten outlets.

## Requirements

- Node.js 22 or newer and npm
- MongoDB Atlas access for the configured database

## Install and Configure

```powershell
npm install
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

Fill in `.env.local`. The real database password and OAuth secrets must remain local; `.env.local` is ignored by Git.

```dotenv
MONGODB_URI=mongodb+srv://<USERNAME>:<URL_ENCODED_PASSWORD>@<CLUSTER_HOST>/<DATABASE_NAME>?retryWrites=true&w=majority&appName=la-milano-attendance
MONGODB_DB=your_database_name
AUTH_SECRET=<random-secret>
NEXTAUTH_URL=
ADMIN_USERNAME=<initial-admin-username>
ADMIN_PASSWORD=<unique-password-at-least-10-characters>
BOOTSTRAP_ADMIN_EMAIL=<admin-email-used-by-the-app>
BOOTSTRAP_ADMIN_NAME=<admin-display-name>
BUSINESS_TIMEZONE=Asia/Kolkata
```

Replace every MongoDB URI placeholder with your Atlas values, and keep its database name consistent with `MONGODB_DB`. Encode special characters in the MongoDB username and password for use in a URI. Set `NEXTAUTH_URL` to the local URL for development and to the canonical site URL in the deployment environment. Keep it server-side; do not expose it or database settings through `next.config.ts`'s `env` option or `NEXT_PUBLIC_` variables. Generate an Auth.js secret with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

The app uses a local username/email and password sign-in backed by MongoDB. Admin passwords are bcrypt-hashed before storage; the `ADMIN_PASSWORD` value is used only to initialize an admin without existing credentials. Keep `.env.local` private and choose a unique password.

## Safe Database Setup

The setup command connects only to the configured database. It does not drop collections or remove records. It normalizes existing email and employee-code values, adds query and uniqueness indexes, inserts default payroll settings only when absent, and inserts missing inactive `OUT01`-`OUT10` placeholders only when their code is absent.

```powershell
npm run setup:db
```

If a unique index conflicts with existing records, setup stops with the index name. Review and resolve duplicate data or an incompatible existing index manually; do not drop production data to make setup pass. Run setup again after correction. Confirm Atlas network access and grant the database user read/write access to the configured database.

The application uses the existing collections: `users`, `outlets`, `employees`, `attendance`, `advances`, `loans`, `salaryRecords`, `accessPermissions`, `auditLogs`, `settings`, and `roles`. Attendance is stored as one date/outlet document with employee entries; this supports an atomic submit/lock transition.

## Employee Sheet Import and Outlet Attendance

From **Employees → Import employee sheet**, a `MAIN_ADMIN` can preview and import CSV or `.xlsx` files (up to 5 MB and 500 workers). Map the sheet headings to employee fields and choose the destination outlet. Employee code is the unique match key: matching workers at that outlet are updated; new codes are added. Rows are fully validated before writes, and duplicate codes or codes owned by another outlet are rejected. The importer never evaluates spreadsheet formulas: in sheet mode it reads Excel's last saved formula result; missing results can be entered manually. In app-payroll mode, formula cells are ignored and their monthly base salary must be entered manually; the existing app payroll rules calculate pay from attendance and salary settings. CSV files contain values only. PDF and legacy `.xls` files are not supported.

For example, a sheet can include `Employee Code`, `Full Name`, `Date of Joining`, `Designation`, `Mobile`, and `Monthly Base Salary`; other supported optional headings include `PF Enabled`, `Employee PF %`, `Employer PF %`, `ESI Enabled`, `Employee ESI %`, and `Notes`. Salary calculations use the app's fixed 30-day basis.

Create an account from **Access management** using the person's email and password, assign its outlet or outlets, and select a designation or configure custom permissions. A `MAIN_ADMIN` can reset an account password from its **Password** action; the existing password cannot be viewed because credentials are stored as one-way hashes. An `OUTLET_USER` can be assigned one active outlet; other staff roles can be assigned multiple outlets. The permissions granted by a designation control which dashboard, attendance, employee, advances, salary, and report pages/actions the account can use. Updating a designation updates the permissions for all accounts assigned to it. Outlets, Access management, and global Settings remain `MAIN_ADMIN`-only. The confirmation on **Submit & lock** saves the outlet's attendance to the master attendance record; only an authorized administrator can unlock a submitted sheet.

## First Administrator

After filling in the database URI and the initial admin username/password, set the admin email and display name in `.env.local`, then run:

```powershell
npm run bootstrap:admin
```

This creates or promotes only that email's admin record and initializes its username/password on the first credential migration. It refuses to replace a different active `MAIN_ADMIN` and does not reset credentials on later runs. Sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD`. After sign-in, change them from **Settings → Admin login credentials**; changes are hashed and saved in MongoDB Atlas. Clear bootstrap and initial password values from deployment environments where they are not needed.

All subsequent invitations, designation templates, role/outlet assignments, and custom permissions are managed in **Access management** by a `MAIN_ADMIN`. Designations can be reused across accounts and outlets. Staff grants cannot include global settings, access management, outlet management, or audit permissions.

## Run and Check

```powershell
npm run dev
npm test
npm run lint
npm run build
```

Open `http://localhost:3000`. The sign-in page is available without database configuration, but sign-in and protected data require the environment above. The live dashboard is database-backed and respects assigned outlets. Dashboard users can choose an outlet and business date; Net payroll is accrued from submitted attendance through that date, including configured half-day/week-off rules and approved unclaimed advances. Missing or unsubmitted attendance is not counted as an absence. Employee attendance on the dashboard can be filtered by employee and this-month, last-month, or custom dates, then downloaded as Excel or CSV when report export is permitted. **Reports & exports** provides the same Excel and CSV formats for available report types.

## Payroll Policy

For the Monthly salary page workflow, statuses, permissions, and CSV download, see [Monthly Salary Page Guide](./MONTHLY-SALARY-GUIDE.md).

- All salary calculations use a fixed 30-day divisor, regardless of the calendar month's length: daily rate = monthly base salary ÷ 30.
- In a complete monthly settlement, an employee employed for the full month starts with 30 payable units even in a 28- or 29-day month. Each unpaid absence deducts one unit (1/30 of monthly base salary), and each half-day deducts half a unit. Every week-off is paid in full. Earnings are capped at the monthly base salary.
- For incomplete live periods, only submitted attendance is accrued; missing or unsubmitted dates are not treated as absences. Employees joining or leaving during a month are prorated for their eligible employment days.
- Current date and month defaults use `Asia/Kolkata`. For example, with a ₹15,000 monthly salary, the daily rate is ₹500 in every month: a present day and a week-off each pay ₹500, a half-day pays ₹250, and an unpaid absence deducts ₹500 in a complete monthly settlement.
- Employee PF is deducted from net pay only when enabled on that employee. Employer PF is tracked separately and is not deducted from employee net pay.
- Employee ESI is deducted only when enabled for that employee; the default employee contribution rate is 0.75%, and administrators can set the employee-specific rate. Employer ESI is not calculated.
- Only approved, unclaimed advances are deducted. Payroll generation claims advances in the same MongoDB transaction as salary record creation, and unique indexes prevent duplicate employee/month records.
- `MAIN_ADMIN` can record an employee/outlet loan and its outstanding balance on **Loans**. Loan repayment is entered manually as a draft payroll adjustment; it cannot exceed the outstanding amount and reduces the loan balance in the same transaction as the payroll deduction.
- Generated records snapshot employee inputs and policy rules. Draft adjustments require a reason and are audited; approved and paid records cannot be silently recalculated.
- No tax, statutory, or legal deduction assumptions are included. Configure the organization's approved policy with its payroll administrators.

## Roles and Data Boundaries

- `MAIN_ADMIN` can administer all outlets and features.
- `CO_ADMIN` accesses assigned outlets and only permissions explicitly granted to the account or through its designation.
- `OUTLET_USER` is assigned one active outlet and gets the dashboard/attendance permissions by default for legacy accounts without a designation; a custom permission set or designation controls its available pages and actions.
- Outlet and permission checks run on the server for each protected operation. Inactive outlets reject new attendance while historical records remain available to authorized administrators.

## Before Production

Never paste database credentials, admin passwords, or authentication secrets into source control or browser code. Atlas setup, initial admin bootstrap, and database-backed authentication require valid local environment values.