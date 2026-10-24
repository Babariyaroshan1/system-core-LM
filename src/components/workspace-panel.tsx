  "use client";

  import {
    useEffect,
    useEffectEvent,
    useRef,
    useState,
    type FormEvent,
  } from "react";
  import Link from "next/link";
  import {
    ArrowDownToLine,
    Bell,
    Check,
    ChevronLeft,
    ChevronRight,
    Eye,
    EyeOff,
    FileSpreadsheet,
    FileText,
    Info,
    HandCoins,
    LoaderCircle,
    Plus,
    RefreshCw,
    Search,
    Send,
    SlidersHorizontal,
    X,
  } from "lucide-react";
  import type {
    AttendanceStatus,
    Permission,
    SalarySettings,
    UserRole,
  } from "@/lib/models";
  import type {
    AttendanceCounts,
    DashboardOutlet,
    DesignationView,
    EmployeeView,
    EmployeeAttendanceReport,
    EmployeeAttendanceReportRow,
    LoanView,
    PayrollEmployeeView,
    SalaryView,
    UserView,
    WhoIsAwayView,
    WorkspaceData,
  } from "@/lib/ui-types";
  import {
    adminOnlyPages,
    designationPermissionGroups,
    legacyOutletDefaultPermissions,
  } from "@/lib/access-control";
  import { EmployeeImportPanel } from "@/components/employee-import-panel";
  import { AutoDismissNotice } from "@/components/auto-dismiss-notice";
  import { getIndiaDate, getIndiaMonth } from "@/lib/payroll/dates";
  import { formatDate, formatDateTime } from "@/lib/date-format";
  import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Legend,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
  } from "recharts";

  type Section =
    | "dashboard"
    | "attendance"
    | "salary"
    | "employees"
    | "advances"
    | "loans"
    | "outlets"
    | "access"
    | "reports"
    | "activeLogs"
    | "settings";
  type Outlet = DashboardOutlet;
  type Employee = EmployeeView;

  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const details = Array.isArray(payload.details)
        ? payload.details
            .map((detail: { path?: string; message?: string }) =>
              [detail.path, detail.message].filter(Boolean).join(": "),
            )
            .filter(Boolean)
            .join(" ")
        : typeof payload.details === "string"
          ? payload.details
          : "";
      throw new Error(
        details
          ? `${payload.error ?? "Request failed."} ${details}`
          : (payload.error ?? "Request failed."),
      );
    }
    return payload as T;
  }

  type ExportFormat = "xlsx" | "csv";

  async function downloadReport(url: string, format: ExportFormat) {
    const response = await fetch(url);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? "Report export failed.");
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (
      format === "csv"
        ? !contentType.includes("text/csv")
        : !contentType.includes(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          )
    )
      throw new Error("The server returned an unexpected report file.");

    const blob = await response.blob();
    if (!blob.size) throw new Error("The exported report is empty.");
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download =
      response.headers
        .get("content-disposition")
        ?.match(/filename="([^"]+)"/)?.[1] ??
      `attendance-report.${format}`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  function PageHead({
    title,
    description,
    action,
  }: {
    title: string;
    description: string;
    action?: React.ReactNode;
  }) {
    return (
      <div className="page-head">
        <div>
          <div className="eyebrow">LA MILANO / OPERATIONS</div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {action}
      </div>
    );
  }

  function Notice({ error, success }: { error: string; success: string }) {
    if (error)
      return (
        <AutoDismissNotice
          key={`error:${error}`}
          message={error}
          variant="error"
        />
      );
    if (success)
      return (
        <AutoDismissNotice
          key={`success:${success}`}
          message={success}
          variant="success"
        />
      );
    return null;
  }

  function Loading() {
    return (
      <div className="loading-state">
        <LoaderCircle className="spin" size={20} />
        Loading records
      </div>
    );
  }

  export function WorkspacePanel({
    section,
    user,
  }: {
    section: Section;
    user: {
      name: string;
      email: string;
      role: UserRole;
      permissions: Permission[];
    };
  }) {
    const [outlets, setOutlets] = useState<Outlet[]>([]);
    const employeeOutlets = outlets.filter((outlet) => outlet.active);
    const [selectedOutlet, setSelectedOutlet] = useState("");
    const [newEmployeeOutletId, setNewEmployeeOutletId] = useState("");
    const attendanceOutlets = outlets.filter((outlet) => outlet.active);
    const attendanceOutletId =
      attendanceOutlets.length === 1 ? attendanceOutlets[0]._id : selectedOutlet;
    const attendanceAllOutlets =
      attendanceOutlets.length > 1 && !selectedOutlet;
    const today = getIndiaDate();
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const attendanceReloadId = useRef(0);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [data, setData] = useState<WorkspaceData>({});
    const [date, setDate] = useState(() => getIndiaDate());
    const [month, setMonth] = useState(() => getIndiaMonth());
    const [dashboardDate, setDashboardDate] = useState(() => getIndiaDate());
    const [dashboardFrom, setDashboardFrom] = useState(
      () => `${getIndiaMonth()}-01`,
    );
    const [dashboardTo, setDashboardTo] = useState(() => getIndiaDate());
    const [dashboardPreset, setDashboardPreset] = useState("This Month");
    const [dashboardEmployeeId, setDashboardEmployeeId] = useState("");
    const [dashboardExportBusy, setDashboardExportBusy] =
      useState<ExportFormat | null>(null);
    const [awayPeriod, setAwayPeriod] = useState("TODAY");
    const [awayFrom, setAwayFrom] = useState(() => `${getIndiaMonth()}-01`);
    const [awayTo, setAwayTo] = useState(() => getIndiaDate());
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [advanceStatus, setAdvanceStatus] = useState<
      "ALL" | "PENDING" | "APPROVED" | "REJECTED"
    >("ALL");
    const [isAdvanceFormOpen, setIsAdvanceFormOpen] = useState(false);
    const [isAttendanceUnlockOpen, setIsAttendanceUnlockOpen] = useState(false);
    const [attendanceUnlockReason, setAttendanceUnlockReason] = useState("");
    const [isAttendanceConfirmOpen, setIsAttendanceConfirmOpen] =
      useState(false);
    const [attendanceSubmitConfirmation, setAttendanceSubmitConfirmation] =
      useState(true);
    const [newUserRole, setNewUserRole] = useState<UserRole>("OUTLET_USER");
    const [newDesignationId, setNewDesignationId] = useState("");
    const [salaryGenerateEmployee, setSalaryGenerateEmployee] =
      useState<PayrollEmployeeView | null>(null);
    const [salaryManageRecord, setSalaryManageRecord] =
      useState<SalaryView | null>(null);

    async function reload() {
      const reloadId = ++attendanceReloadId.current;
      setLoading(true);
      setError("");
      try {
        if (section === "dashboard") {
          const dashboardParams = new URLSearchParams({ date: dashboardDate });
          const awayDates = getAwayDateRange(
            awayPeriod,
            awayFrom,
            awayTo,
            today,
          );
          dashboardParams.set("awayFrom", awayDates.from);
          dashboardParams.set("awayTo", awayDates.to);
          if (selectedOutlet) dashboardParams.set("outletId", selectedOutlet);
          const dashboardUrl = `/api/dashboard?${dashboardParams.toString()}`;
          const dashboard = await request<WorkspaceData>(dashboardUrl);
          if (user.permissions.includes("employees.read")) {
            const reportParams = new URLSearchParams({
              from: dashboardFrom,
              to: dashboardTo,
            });
            if (selectedOutlet) reportParams.set("outletId", selectedOutlet);
            if (dashboardEmployeeId)
              reportParams.set("employeeId", dashboardEmployeeId);
            const reportUrl = `/api/reports/employee-attendance?${reportParams.toString()}`;
            const employeeAttendance =
              await request<EmployeeAttendanceReport>(reportUrl);
            setData({ ...dashboard, employeeAttendance });
          } else {
            setData(dashboard);
          }
        }
        if (section === "attendance") {
          if (attendanceOutletId) {
            const attendanceData = await request<WorkspaceData>(
                `/api/attendance?outletId=${attendanceOutletId}&date=${date}`,
              );
            if (reloadId === attendanceReloadId.current)
              setData(attendanceData);
          } else if (attendanceOutlets.length > 1) {
            const attendanceData = await request<WorkspaceData>(
              `/api/attendance?date=${date}`,
            );
            if (reloadId === attendanceReloadId.current)
              setData(attendanceData);
          } else if (reloadId === attendanceReloadId.current) {
            setData({});
          }
        }
        if (section === "employees")
          setData(
            await request<WorkspaceData>(
              `/api/employees?page=${page}&pageSize=20&q=${encodeURIComponent(search)}${selectedOutlet ? `&outletId=${selectedOutlet}` : ""}`,
            ),
          );
        if (section === "advances") {
          const advanceParams = new URLSearchParams({ page: String(page) });
          if (selectedOutlet) advanceParams.set("outletId", selectedOutlet);
          if (advanceStatus !== "ALL")
            advanceParams.set("status", advanceStatus);
          const [advances, employees, outlets] = await Promise.all([
            request<WorkspaceData>(
              `/api/advances?${advanceParams.toString()}`,
            ),
            request<WorkspaceData>(
              `/api/employees?pageSize=100${selectedOutlet ? `&outletId=${selectedOutlet}` : ""}`,
            ),
            request<WorkspaceData>("/api/outlets"),
          ]);
          setData({
            ...advances,
            employees: employees.employees,
            outlets: outlets.outlets,
          });
        }
        if (section === "loans")
          setData(
            await request<WorkspaceData>(
              `/api/loans${selectedOutlet ? `?outletId=${selectedOutlet}` : ""}`,
            ),
          );
        if (section === "salary" && month)
          setData(
            await request<WorkspaceData>(
              `/api/payroll?month=${month}${selectedOutlet ? `&outletId=${selectedOutlet}` : ""}`,
            ),
          );
        if (section === "outlets")
          setData(await request<WorkspaceData>("/api/outlets"));
        if (section === "access") {
          const [users, designations] = await Promise.all([
            request<WorkspaceData>("/api/users"),
            request<{ designations: DesignationView[] }>("/api/designations"),
          ]);
          setData({ ...users, designations: designations.designations });
        }
        if (section === "activeLogs") {
          const params = new URLSearchParams({ page: "0" });
          if (selectedOutlet) params.set("outletId", selectedOutlet);
          setData(
            await request<WorkspaceData>(
              `/api/audit?${params.toString()}`,
            ),
          );
        }
        if (section === "settings")
          setData(await request<WorkspaceData>("/api/settings"));
      } catch (caught) {
        if (reloadId === attendanceReloadId.current)
          setError(
            caught instanceof Error ? caught.message : "Unable to load records.",
          );
      } finally {
        if (reloadId === attendanceReloadId.current) setLoading(false);
      }
    }

    const reloadCurrentView = useEffectEvent(() => {
      void reload();
    });
    useEffect(() => {
      let cancelled = false;
      void request<{ outlets: Outlet[] }>("/api/outlets")
        .then((result) => {
          if (cancelled) return;
          setOutlets(result.outlets);
          if (result.outlets.length === 1)
            setSelectedOutlet(result.outlets[0]._id);
        })
        .catch((caught) => {
          if (!cancelled)
            setError(
              caught instanceof Error
                ? caught.message
                : "Unable to load outlets.",
            );
        });
      return () => {
        cancelled = true;
      };
    }, []);
    useEffect(() => {
      if (user.role !== "MAIN_ADMIN") return;
      const savedPreference = window.localStorage.getItem(
        `attendance-submit-confirmation:${user.email}`,
      );
      if (savedPreference !== null)
        void Promise.resolve().then(() =>
          setAttendanceSubmitConfirmation(savedPreference === "true"),
        );
    }, [user.email, user.role]);
    useEffect(() => {
      void Promise.resolve().then(() => reloadCurrentView());
    }, [
      section,
      selectedOutlet,
      attendanceOutletId,
      attendanceOutlets.length,
      date,
      month,
      dashboardDate,
      dashboardFrom,
      dashboardTo,
      dashboardEmployeeId,
      awayPeriod,
      awayFrom,
      awayTo,
      search,
      page,
      advanceStatus,
    ]);

    function applyDashboardPreset(value: string) {
      setDashboardPreset(value);
      if (value === "Custom") return;
      const end = new Date(`${today}T00:00:00.000Z`);
      const start = new Date(end);
      if (value === "This Month") start.setUTCDate(1);
      if (value === "Last Month") {
        start.setUTCDate(1);
        start.setUTCMonth(start.getUTCMonth() - 1);
        end.setUTCDate(0);
      }
      setDashboardFrom(start.toISOString().slice(0, 10));
      setDashboardTo(end.toISOString().slice(0, 10));
      setDashboardEmployeeId("");
    }

    async function exportDashboardAttendance(format: ExportFormat) {
      setDashboardExportBusy(format);
      setError("");
      try {
        const params = new URLSearchParams({
          type: "attendance",
          from: dashboardFrom,
          to: dashboardTo,
          format,
        });
        if (selectedOutlet) params.set("outletId", selectedOutlet);
        if (dashboardEmployeeId)
          params.set("employeeId", dashboardEmployeeId);
        await downloadReport(
          `/api/reports/export?${params.toString()}`,
          format,
        );
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to export attendance.",
        );
      } finally {
        setDashboardExportBusy(null);
      }
    }

    async function exportWhoIsAway(format: ExportFormat) {
      setDashboardExportBusy(format);
      setError("");
      try {
        const rows = data.whoIsAway ?? [];
        if (!rows.length) {
          setError(
            "There are no absent or half-day attendance records to export.",
          );
          return;
        }
        const range = getAwayDateRange(awayPeriod, awayFrom, awayTo, today);
        const params = new URLSearchParams({
          type: "away",
          format,
          from: range.from,
          to: range.to,
        });
        if (selectedOutlet) params.set("outletId", selectedOutlet);
        await downloadReport(
          `/api/reports/export?${params.toString()}`,
          format,
        );
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to export attendance records.",
        );
      } finally {
        setDashboardExportBusy(null);
      }
    }

    async function submit(
      event: FormEvent<HTMLFormElement>,
      url: string,
      method = "POST",
      after = reload,
    ) {
      event.preventDefault();
      setBusy(true);
      setError("");
      setSuccess("");
      try {
        const form = event.currentTarget;
        const formData = new FormData(form);
        const body = normalizeForm(Object.fromEntries(formData.entries()));
        if (body.designationId === "") delete body.designationId;
        for (const key of ["outletIds", "permissions"])
          if (formData.has(key)) body[key] = formData.getAll(key).map(String);
        if (
          url === "/api/users" &&
          !window.confirm(
            "Provision this account with the selected role and outlet access?",
          )
        )
          return;
        await request(url, { method, body: JSON.stringify(body) });
        setSuccess("Changes saved.");
        form.reset();
        await after();
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Unable to save changes.",
        );
      } finally {
        setBusy(false);
      }
    }

    async function mutate(
      url: string,
      body: unknown,
      method = "POST",
      successMessage = "Changes saved.",
    ) {
      setBusy(true);
      setError("");
      setSuccess("");
      try {
        await request(url, { method, body: JSON.stringify(body) });
        setSuccess(successMessage);
        await reload();
        return true;
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Unable to save changes.",
        );
        return false;
      } finally {
        setBusy(false);
      }
    }

    const outletSelect = (
      <select
        value={selectedOutlet}
        onChange={(event) => {
          setSelectedOutlet(event.target.value);
          setDashboardEmployeeId("");
        }}
        aria-label="Select outlet"
      >
        {outlets.length !== 1 && (
          <option value="">All accessible outlets</option>
        )}
        {outlets.map((outlet) => (
          <option key={outlet._id} value={outlet._id}>
            {outlet.code} · {outlet.name}
          </option>
        ))}
      </select>
    );
    const toolbar = (
      <div className="toolbar">
        {outletSelect}
        {section === "dashboard" && (
          <input
            type="date"
            aria-label="Dashboard date"
            value={dashboardDate}
            max={today}
            onChange={(event) => setDashboardDate(event.target.value)}
          />
        )}
        <button
          className="icon-button"
          title="Refresh"
          aria-label="Refresh"
          onClick={() => void reload()}
        >
          <RefreshCw size={17} />
        </button>
      </div>
    );

    if (section === "dashboard")
      return (
        <div className="content-area">
          <PageHead
            title="Good service starts with a good team."
            description={`Live operations snapshot for ${data.today ?? "today"}.`}
            action={toolbar}
          />
          <Notice error={error} success={success} />
          {loading ? (
            <Loading />
          ) : (
            <>
              <div className="metric-grid">
                <Metric
                  title="Active employees"
                  value={data.metrics?.activeEmployees ?? 0}
                  accent="red"
                />
                <Metric
                  title="Full-time"
                  value={data.metrics?.fullTimeEmployees ?? "—"}
                  detail="Active team members"
                  accent="green"
                />
                <Metric
                  title="Part-time"
                  value={data.metrics?.partTimeEmployees ?? "—"}
                  detail="Active team members"
                  accent="gold"
                />
                <Metric
                  title="Active outlets"
                  value={data.metrics?.activeOutlets ?? 0}
                  accent="green"
                />
                <Metric
                  title="Attendance today"
                  value={Object.values(data.metrics?.attendance ?? {}).reduce(
                    (sum, count) => sum + count,
                    0,
                  )}
                  detail={`${data.metrics?.missingSubmissions ?? 0} outlets not submitted`}
                  accent="gold"
                />
                <Metric
                  title="Net payroll"
                  value={
                    data.metrics?.netPayable == null
                      ? "—"
                      : currency(data.metrics.netPayable)
                  }
                  detail={
                    data.metrics?.netPayable == null
                      ? "Salary permission required"
                      : `Accrued through ${dashboardDate} · ${data.metrics.pendingApprovals ?? 0} pending approvals`
                  }
                  accent="ink"
                />
              </div>
              <div className="dashboard-charts">
                <AttendanceStatusChart
                  attendance={
                    data.metrics?.attendance ?? { P: 0, A: 0, HD: 0, WO: 0 }
                  }
                />
                <OutletChart outlets={data.outlets ?? []} />
              </div>
              {user.permissions.includes("attendance.read") && (
                <WhoIsAwayPanel
                  employees={data.whoIsAway ?? []}
                  period={awayPeriod}
                  customFrom={awayFrom}
                  customTo={awayTo}
                  canExport={user.permissions.includes("reports.export")}
                  exportBusy={dashboardExportBusy}
                  onPeriodChange={setAwayPeriod}
                  onCustomFromChange={setAwayFrom}
                  onCustomToChange={setAwayTo}
                  onExport={(format) => void exportWhoIsAway(format)}
                />
              )}
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Outlet operations</h2>
                    <p>Attendance and submission progress for {dashboardDate}</p>
                  </div>
                  <span className="live-tag">
                    <i /> LIVE
                  </span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Outlet</th>
                        <th>Active team</th>
                        <th>Present</th>
                        <th>Absent</th>
                        <th>Half day</th>
                        <th>Submission</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.outlets ?? []).map((outlet: DashboardOutlet) => (
                        <tr key={outlet.id}>
                          <td>
                            <strong>{outlet.code}</strong>
                            <span className="sub-cell">{outlet.name}</span>
                          </td>
                          <td>{outlet.employees}</td>
                          <td>{outlet.attendance?.P ?? 0}</td>
                          <td>{outlet.attendance?.A ?? 0}</td>
                          <td>{outlet.attendance?.HD ?? 0}</td>
                          <td>
                            <span
                              className={`badge ${outlet.submitted ? "badge-green" : "badge-red"}`}
                            >
                              {outlet.submitted ? "Submitted" : "Missing"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.outlets?.length && (
                    <Empty>No outlets are assigned to this account.</Empty>
                  )}
                </div>
              </section>
              {user.permissions.includes("employees.read") && (
                <EmployeeAttendanceTable
                  rows={data.employeeAttendance?.rows ?? []}
                  canReadSalary={user.permissions.includes("salary.read")}
                  from={dashboardFrom}
                  to={dashboardTo}
                  preset={dashboardPreset}
                  employeeId={dashboardEmployeeId}
                  employees={data.employeeAttendance?.employees ?? []}
                  canExport={user.permissions.includes("reports.export")}
                  exportBusy={dashboardExportBusy}
                  onPresetChange={applyDashboardPreset}
                  onFromChange={(value) => {
                    setDashboardPreset("Custom");
                    setDashboardFrom(value);
                  }}
                  onToChange={(value) => {
                    setDashboardPreset("Custom");
                    setDashboardTo(value);
                  }}
                  onEmployeeChange={setDashboardEmployeeId}
                  onExport={(format) =>
                    void exportDashboardAttendance(format)
                  }
                  title={
                    dashboardPreset === "This Month"
                      ? "Employee attendance this month"
                      : dashboardPreset === "Last Month"
                        ? "Employee attendance last month"
                        : "Employee attendance by date"
                  }
                  description="Choose a period and employee to review or download the submitted attendance report."
                />
              )}
            </>
          )}
        </div>
      );

    const attendanceEmployees = data.employees ?? [];
    const markedAttendanceCount = attendanceEmployees.filter(
      (employee) => employee.attendanceStatus,
    ).length;
    const submittedAttendanceCount = attendanceEmployees.filter(
      (employee) => employee.attendanceSubmitted,
    ).length;
    const allAttendanceSubmitted =
      attendanceEmployees.length > 0 &&
      submittedAttendanceCount === attendanceEmployees.length;
    const hasMarkedUnsubmittedAttendance = attendanceEmployees.some(
      (employee) =>
        employee.attendanceStatus && !employee.attendanceSubmitted,
    );
    const hasUnsubmittedEmployees = attendanceEmployees.some(
      (employee) => !employee.attendanceSubmitted,
    );

    if (section === "attendance")
      return (
        <div className="content-area">
          <PageHead
            title="Daily attendance"
            description="Review all outlets or choose one outlet to record attendance. Submit locks marked employees; blank employees remain editable."
            action={
              <div className="toolbar attendance-toolbar">
                {user.role === "MAIN_ADMIN" && (
                  <label className="attendance-confirmation-toggle">
                    <input
                      type="checkbox"
                      checked={attendanceSubmitConfirmation}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setAttendanceSubmitConfirmation(enabled);
                        window.localStorage.setItem(
                          `attendance-submit-confirmation:${user.email}`,
                          String(enabled),
                        );
                      }}
                    />
                    <span>Alert</span>
                  </label>
                )}
                <input
                  type="date"
                  value={date}
                  max={today}
                  onChange={(event) => {
                    if (event.target.value && event.target.value <= today)
                      setDate(event.target.value);
                  }}
                  aria-label="Attendance date"
                />
                {attendanceOutlets.length === 1 ? (
                  <span className="attendance-single-outlet">
                    {attendanceOutlets[0].name}
                  </span>
                ) : attendanceOutlets.length > 1 ? (
                  <select
                    value={selectedOutlet}
                    onChange={(event) => setSelectedOutlet(event.target.value)}
                    aria-label="Select outlet"
                  >
                    {attendanceOutlets.length !== 1 && (
                      <option value="">All accessible outlets</option>
                    )}
                    {attendanceOutlets.map((outlet) => (
                      <option key={outlet._id} value={outlet._id}>
                        {outlet.code} · {outlet.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="attendance-single-outlet">
                    No active outlets available
                  </span>
                )}
              </div>
            }
          />
          <Notice error={error} success={success} />
          {loading ? (
            <Loading />
          ) : (
            <section className="panel attendance-panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    {data.outlet?.code ??
                      (attendanceAllOutlets
                        ? "All accessible outlets"
                        : "Select an outlet")}{" "}
                    <span className="muted">/ {formatDate(date)}</span>
                  </h2>
                  <p>
                    {attendanceAllOutlets
                      ? `${data.submittedCount ?? 0} of ${data.outletCount ?? 0} outlets have submissions`
                      : submittedAttendanceCount > 0
                        ? allAttendanceSubmitted
                          ? data.day?.submittedAt
                            ? `All employees submitted ${formatDateTime(data.day.submittedAt)}`
                            : "All employees submitted"
                          : `${submittedAttendanceCount} of ${attendanceEmployees.length} employees submitted · remaining employees are not locked`
                        : "Draft · not submitted"}
                  </p>
                  {data.day?.updatedAt && (
                    <p className="sub-cell">
                      Last updated {formatDateTime(data.day.updatedAt)}
                    </p>
                  )}
                  {!!data.day?.corrections?.length && (
                    <p className="sub-cell">
                      {data.day.corrections.length} correction event(s) · latest:{" "}
                      {data.day.corrections.at(-1)?.reason}
                    </p>
                  )}
                </div>
                <div className="toolbar">
                  <span className="count-chip">P {data.counts?.P ?? 0}</span>
                  <span className="count-chip">A {data.counts?.A ?? 0}</span>
                  <span className="count-chip">WO {data.counts?.WO ?? 0}</span>
                  <span className="count-chip">HD {data.counts?.HD ?? 0}</span>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {attendanceAllOutlets && <th>Outlet</th>}
                      <th>Employee</th>
                      <th>Designation</th>
                      <th>Status</th>
                      <th>Submission Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.employees ?? []).map((employee: Employee) => (
                      <tr key={employee._id}>
                        {attendanceAllOutlets && (
                          <td>
                            <strong>{employee.outletCode}</strong>
                            <span className="sub-cell">{employee.outletName}</span>
                          </td>
                        )}
                        <td>
                          <strong>{employee.fullName}</strong>
                          <span className="sub-cell">
                            {employee.employeeCode}
                          </span>
                        </td>
                        <td>{employee.designation}</td>
                        <td>
                          <select
                            className={`attendance-status-select${employee.attendanceSubmitted || attendanceAllOutlets ? " attendance-locked" : ""}`}
                            disabled={
                              !attendanceOutletId ||
                              attendanceAllOutlets ||
                              employee.attendanceSubmitted ||
                              (user.role !== "MAIN_ADMIN" &&
                                (employee.attendanceCorrectionCount ?? 0) >= 2)
                            }
                            value={employee.attendanceStatus ?? ""}
                            onChange={(event) =>
                              setData((old) => ({
                                ...old,
                                employees: (old.employees ?? []).map((item) =>
                                  item._id === employee._id
                                    ? {
                                        ...item,
                                        attendanceStatus: event.target.value
                                          ? (event.target
                                              .value as AttendanceStatus)
                                          : null,
                                      }
                                    : item,
                                ),
                              }))
                            }
                          >
                            <option
                              value=""
                              disabled={
                                data.day?.corrections?.at(-1)?.action ===
                                  "UNLOCK" && !!employee.attendanceStatus
                              }
                            >
                              Choose
                            </option>
                            <option value="P">P · Present</option>
                            <option value="A">A · Absent</option>
                            <option value="WO">WO · Week off</option>
                            <option value="HD">HD · Half day</option>
                          </select>
                          {user.role !== "MAIN_ADMIN" &&
                            (employee.attendanceCorrectionCount ?? 0) >= 2 && (
                              <span className="sub-cell attendance-correction-lock">
                                Locked after 2 changes. Contact MAIN_ADMIN.
                              </span>
                            )}
                        </td>
                        <td>
                          <span
                            className={`badge ${employee.attendanceSubmitted ? "badge-green" : "badge-muted"}`}
                          >
                            {employee.attendanceSubmitted
                              ? "Submitted"
                              : employee.attendanceStatus
                                ? "Draft"
                                : "Not marked"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.employees?.length && (
                  <Empty>
                    {attendanceOutletId
                      ? "No active employees at this outlet."
                      : attendanceAllOutlets
                        ? "No active employees or attendance records are available for these outlets."
                        : "No active outlets available."}
                  </Empty>
                )}
              </div>
              <div className="panel-footer">
                <span>
                  {markedAttendanceCount} of {attendanceEmployees.length} marked
                </span>
                <div className="toolbar">
                  {attendanceAllOutlets ? (
                    <span className="sub-cell">
                      Choose an outlet above to edit or submit attendance.
                    </span>
                  ) : (
                    <>
                      {data.day?.status === "SUBMITTED" &&
                        user.permissions.includes("attendance.unlock") && (
                          <button
                            className="button button-secondary"
                            disabled={busy}
                            onClick={() => setIsAttendanceUnlockOpen(true)}
                          >
                            Unlock for correction
                          </button>
                        )}
                      {(data.day?.status !== "SUBMITTED" ||
                        !allAttendanceSubmitted) && (
                        <>
                          <button
                            disabled={
                              busy ||
                              !attendanceOutletId ||
                              !hasUnsubmittedEmployees
                            }
                            className="button button-secondary"
                            onClick={() => saveAttendance("SAVE")}
                          >
                            <Check size={16} /> Save draft
                          </button>
                          <button
                            disabled={
                              busy ||
                              !attendanceOutletId ||
                              !hasMarkedUnsubmittedAttendance
                            }
                            className="button button-primary"
                            onClick={() => saveAttendance("SUBMIT")}
                          >
                            <Send size={16} /> Submit & lock
                          </button>
                        </>
                      )}
                      {allAttendanceSubmitted &&
                        data.day?.status === "SUBMITTED" &&
                        !user.permissions.includes("attendance.unlock") && (
                          <span className="sub-cell">
                            Attendance submitted and locked.
                          </span>
                        )}
                    </>
                  )}
                </div>
              </div>
            </section>
          )}
          {isAttendanceUnlockOpen && (
            <div className="advance-modal-backdrop">
              <section
                className="advance-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="attendance-unlock-title"
              >
                <header className="advance-modal-heading">
                  <div>
                    <h2 id="attendance-unlock-title">
                      Unlock attendance for correction
                    </h2>
                    <p>
                      Attendance for {data.outlet?.name ?? "this outlet"} on{" "}
                      {formatDate(date)} will unlock immediately. A reason is optional.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Close unlock dialog"
                    disabled={busy}
                    onClick={() => {
                      setIsAttendanceUnlockOpen(false);
                      setAttendanceUnlockReason("");
                    }}
                  >
                    <X size={18} />
                  </button>
                </header>
                <form className="advance-edit-form" onSubmit={unlockAttendance}>
                  <label className="field">
                    <span>Reason (optional)</span>
                    <textarea
                      value={attendanceUnlockReason}
                      onChange={(event) =>
                        setAttendanceUnlockReason(event.target.value)
                      }
                      maxLength={500}
                      rows={3}
                      placeholder="Add a reason for the audit log"
                    />
                  </label>
                  <div className="toolbar">
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() => {
                        setIsAttendanceUnlockOpen(false);
                        setAttendanceUnlockReason("");
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="button button-primary"
                      disabled={busy}
                    >
                      Unlock now
                    </button>
                  </div>
                </form>
              </section>
            </div>
          )}
          {isAttendanceConfirmOpen && (
            <div className="advance-modal-backdrop">
              <section
                className="advance-modal attendance-confirm-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="attendance-submit-title"
              >
                <header className="advance-modal-heading">
                  <div>
                    <h2 id="attendance-submit-title">
                      Confirm attendance submission
                    </h2>
                    <p>
                      Confirm attendance for{" "}
                      {data.outlet?.name ?? data.outlet?.code ?? "this outlet"}{" "}
                      on {formatDate(date)}? This will save and lock only the
                      marked employees. Unmarked employees will remain
                      editable. For any changes, contact KULDEEP YADAV.
                    </p>
                  </div>
                </header>
                <div className="toolbar attendance-confirm-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() => setIsAttendanceConfirmOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={busy}
                    onClick={() => {
                      setIsAttendanceConfirmOpen(false);
                      void submitAttendance();
                    }}
                  >
                    Confirm
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      );

    async function saveAttendance(action: "SAVE" | "SUBMIT") {
      if (
        action === "SUBMIT" &&
        (user.role !== "MAIN_ADMIN" || attendanceSubmitConfirmation)
      ) {
        setIsAttendanceConfirmOpen(true);
        return;
      }
      await submitAttendance(action);
    }

    async function submitAttendance(action: "SAVE" | "SUBMIT" = "SUBMIT") {
      const entries = (data.employees ?? [])
        .filter((employee: Employee) => employee.attendanceStatus)
        .map((employee: Employee) => ({
          employeeId: employee._id,
          status: employee.attendanceStatus,
        }));
      await mutate(
        "/api/attendance",
        { outletId: attendanceOutletId, date, entries, action },
        "PUT",
        action === "SUBMIT"
          ? "Attendance submitted successfully."
          : "Attendance draft saved.",
      );
    }

    async function unlockAttendance(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (!attendanceOutletId) return;
      const unlocked = await mutate("/api/attendance/unlock", {
        outletId: attendanceOutletId,
        date,
        reason: attendanceUnlockReason.trim() || undefined,
      });
      if (unlocked) {
        setIsAttendanceUnlockOpen(false);
        setAttendanceUnlockReason("");
      }
    }

    if (section === "employees")
      return (
        <div className="content-area">
          <PageHead
            title="Employees"
            description="Manage your team records and salary settings."
            action={
              <div className="toolbar">
                <label className="search-field">
                  <Search size={16} />
                  <input
                    value={search}
                    onChange={(event) => {
                      setPage(1);
                      setSearch(event.target.value);
                    }}
                    placeholder="Search employees"
                  />
                </label>
                {toolbar}
              </div>
            }
          />
          <Notice error={error} success={success} />
          {user.permissions.includes("employees.create") && (
            <details className="panel form-panel">
              <summary>
                <Plus size={17} /> Add employee
              </summary>
              <form
                className="form-grid"
                onSubmit={(event) => submit(event, "/api/employees")}
              >
                <EmployeeCodeField
                  key={
                    newEmployeeOutletId ||
                    selectedOutlet ||
                    employeeOutlets[0]?._id ||
                    "no-outlet"
                  }
                  outletId={
                    newEmployeeOutletId ||
                    selectedOutlet ||
                    employeeOutlets[0]?._id ||
                    ""
                  }
                  outletPrefix={
                    outletCodePrefix(
                      employeeOutlets.find(
                        (outlet) =>
                          outlet._id ===
                          (newEmployeeOutletId ||
                            selectedOutlet ||
                            employeeOutlets[0]?._id),
                      )?.name ?? "",
                    )
                  }
                />
                <Field label="Full name" name="fullName" required />
                <Field
                  label="Date of joining"
                  name="dateOfJoining"
                  type="date"
                  required
                />
                <Field label="Designation" name="designation" required />
                <label className="field">
                  <span>Employment type</span>
                  <select name="employmentType" defaultValue="FULL_TIME">
                    <option value="FULL_TIME">Full-time</option>
                    <option value="PART_TIME">Part-time</option>
                  </select>
                </label>
                <Field label="Mobile" name="mobile" required />
                <Field
                  label="Monthly base salary"
                  name="monthlyBaseSalary"
                  type="number"
                  min="0"
                  required
                />
                <label className="field">
                  <span>Outlet</span>
                  <select
                    name="outletId"
                    value={
                      newEmployeeOutletId ||
                      selectedOutlet ||
                      employeeOutlets[0]?._id ||
                      ""
                    }
                    onChange={(event) =>
                      setNewEmployeeOutletId(event.target.value)
                    }
                    required
                  >
                    {employeeOutlets.map((outlet) => (
                      <option key={outlet._id} value={outlet._id}>
                        {outlet.code} · {outlet.name}
                      </option>
                    ))}
                  </select>
                </label>
                <input
                  type="hidden"
                  name="salaryMethod"
                  value="FIXED_30_DAYS"
                />
                <label className="field">
                  <span>PF enabled</span>
                  <select name="pfEnabled">
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </select>
                  </label>
                <Field
                  label="Employee PF %"
                  name="employeePfPercent"
                  type="number"
                  min="0"
                  max="100"
                  defaultValue="0"
                />
                <Field
                  label="Employer PF %"
                  name="employerPfPercent"
                  type="number"
                  min="0"
                  max="100"
                  defaultValue="0"
                />
                <label className="field">
                  <span>ESI enabled</span>
                  <select name="esiEnabled" defaultValue="false">
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </select>
                </label>
                <Field
                  label="Employee ESI %"
                  name="esiPercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue="0.75"
                />
                <div className="form-actions">
                  <button className="button button-primary" disabled={busy}>
                    <Plus size={16} /> Create employee
                  </button>
                </div>
              </form>
            </details>
          )}
          {user.role === "MAIN_ADMIN" && (
            <EmployeeImportPanel
              outlets={outlets}
              selectedOutlet={selectedOutlet}
              onImported={reload}
            />
          )}
          {loading ? (
            <Loading />
          ) : (
            <DataTable
              headers={[
                "Employee",
                "Outlet",
                "Designation",
                ...(user.role === "OUTLET_USER" ? [] : ["Mobile"]),
                ...(user.role === "MAIN_ADMIN" ? ["Base salary"] : []),
                "Status",
                "Actions",
              ]}
              rows={(data.employees ?? []).map((employee: Employee) => {
                const cells: React.ReactNode[] = [
                  <span key="name">
                    <Link
                      className="employee-row-link"
                      href={`/employees/${employee._id}`}
                    >
                      <strong>{employee.fullName}</strong>
                    </Link>
                    <span className="sub-cell">{employee.employeeCode}</span>
                  </span>,
                  outlets.find((outlet) => outlet._id === employee.outletId)
                    ?.code ?? "—",
                  employee.designation,
                ];
                if (user.role !== "OUTLET_USER")
                  cells.push(employee.mobile ?? "—");
                if (user.role === "MAIN_ADMIN")
                  cells.push(currency(employee.monthlyBaseSalary));
                cells.push(
                  <span
                    key="status"
                    className={`badge ${employee.active ? "badge-green" : "badge-muted"}`}
                  >
                    {employee.active ? "Active" : "Inactive"}
                  </span>,
                );
                cells.push(
                  user.role === "MAIN_ADMIN" && employee.active ? (
                    <button
                      key="deactivate"
                      className="button button-small"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Deactivate ${employee.fullName}? Historical attendance and salary will remain.`,
                          )
                        )
                          void mutate(
                            `/api/employees/${employee._id}`,
                            { active: false },
                            "PATCH",
                          );
                      }}
                    >
                      Deactivate
                    </button>
                  ) : (
                    "—"
                  ),
                );
                return cells;
              })}
              empty="No employees match this search."
              page={page}
              pageSize={20}
              total={data.total ?? 0}
              onPageChange={setPage}
            />
          )}
        </div>
      );

    if (section === "advances")
      return (
        <div className="content-area">
          <PageHead
            title="Advances"
            description="Record staff advances. Approved items are deducted once during payroll generation."
            action={toolbar}
          />
          <Notice error={error} success={success} />
          {(data.pendingCount ?? 0) > 0 && (
            <div className="notice notice-warning pending-advance-notice">
              <Bell size={18} />
              <span>
                {data.pendingCount} advance(s) need approval. Review the
                employee, amount, and reference below.
              </span>
            </div>
          )}
          <div className="advance-controls-row">
            <button
              type="button"
              className="button button-primary advance-record-trigger"
              onClick={() => setIsAdvanceFormOpen(true)}
            >
                <Plus size={16} /> Record advance
            </button>
            <label className="field advance-status-filter">
              <span>Filter advances</span>
              <select
                value={advanceStatus}
                onChange={(event) => {
                  setAdvanceStatus(
                    event.target.value as
                      | "ALL"
                      | "PENDING"
                      | "APPROVED"
                      | "REJECTED",
                  );
                  setPage(1);
                }}
              >
                <option value="ALL">All advances</option>
                <option value="PENDING">Pending approval</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </label>
          </div>
          {isAdvanceFormOpen && (
            <div className="advance-modal-backdrop">
              <section
                className="advance-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="record-advance-title"
              >
                <header className="advance-modal-heading">
                  <div>
                    <h2 id="record-advance-title">Record advance</h2>
                    <p>Add an advance to an employee’s record.</p>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Close record advance"
                    onClick={() => setIsAdvanceFormOpen(false)}
                  >
                    <X size={18} />
                  </button>
                </header>
                <form
                  className="form-grid"
                  onSubmit={(event) => submit(event, "/api/advances")}
                >
                <label className="field">
                  <span>Outlet</span>
                  <select
                    name="outletId"
                    defaultValue={
                      selectedOutlet || data.outlets?.[0]?._id || ""
                    }
                    required
                  >
                    {(data.outlets ?? []).map((outlet: Outlet) => (
                      <option key={outlet._id} value={outlet._id}>
                        {outlet.code} · {outlet.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Employee</span>
                  <select name="employeeId" required>
                    {(data.employees ?? []).map((employee: Employee) => (
                      <option key={employee._id} value={employee._id}>
                        {employee.employeeCode} · {employee.fullName} ·{" "}
                        {data.outlets?.find(
                          (outlet: Outlet) =>
                            outlet._id === employee.outletId,
                        )?.code ?? "Outlet"}
                      </option>
                    ))}
                  </select>
                </label>
                <Field
                  label="Date"
                  name="date"
                  type="date"
                  defaultValue={date}
                  required
                />
                <Field
                  label="Amount (INR)"
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                />
                <Field label="Given by" name="givenBy" required />
                <Field
                  label="Reference / transaction"
                  name="reference"
                  required
                />
                <Field label="Notes" name="notes" />
                <div className="form-actions">
                  <button
                    className="button button-primary"
                    disabled={busy || !(data.outlets ?? []).length}
                  >
                    <Plus size={16} /> Save advance
                  </button>
                </div>
                </form>
              </section>
            </div>
          )}
          {loading ? (
            <Loading />
          ) : (
            <DataTable
              headers={[
                "Date",
                "Employee",
                "Amount",
                "Given by",
                "Reference",
                "Status",
                "Actions",
              ]}
              rows={(data.advances ?? []).map((item) => [
                item.date,
                item.employeeName ?? String(item.employeeId),
                currency(item.amount),
                item.givenBy,
                item.reference,
                <span
                  key="status"
                  className={`badge ${item.status === "APPROVED" ? "badge-green" : item.status === "REJECTED" ? "badge-red" : "badge-gold"}`}
                >
                  {item.status === "APPROVED"
                    ? "Approved"
                    : item.status === "REJECTED"
                      ? "Rejected"
                      : "Pending"}
                </span>,
                <div key="actions" className="toolbar">
                  {!item.payrollRecordId &&
                    user.permissions.includes("advances.write") &&
                    (item.status === "PENDING" || user.role === "MAIN_ADMIN") && (
                      <AdvanceEdit
                        item={item}
                        busy={busy}
                        userRole={user.role}
                        onSave={(input) =>
                          mutate(`/api/advances/${item._id}`, input, "PATCH")
                        }
                      />
                    )}
                  {(item.status === "PENDING" ||
                    item.status === "APPROVED") &&
                    !item.payrollRecordId &&
                    user.permissions.includes("advances.approve") && (
                      <>
                        {item.status === "PENDING" && (
                          <button
                            className="button button-small advance-approve-button"
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Approve this advance for one-time payroll deduction?",
                                )
                              )
                                void mutate(
                                  `/api/advances/${item._id}`,
                                  { action: "APPROVE" },
                                  "PATCH",
                                );
                            }}
                          >
                            <Check size={14} /> Approve
                          </button>
                        )}
                        <button
                          className="button button-small advance-reject-button"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                item.status === "APPROVED"
                                  ? "Mark this approved advance as rejected? It will no longer be included in payroll."
                                  : "Reject this advance? It will not be included in payroll.",
                              )
                            )
                              void mutate(
                                `/api/advances/${item._id}`,
                                { action: "REJECT" },
                                "PATCH",
                              );
                          }}
                        >
                          <X size={14} />{" "}
                          {item.status === "APPROVED"
                            ? "Mark as rejected"
                            : "Reject"}
                        </button>
                      </>
                    )}
                  {item.status === "REJECTED" &&
                    user.permissions.includes("advances.approve") && (
                      <>
                        <button
                          className="button button-small advance-restore-button"
                          disabled={busy || Boolean(item.payrollRecordId)}
                          title="Restore to pending approvals"
                          onClick={() =>
                            void mutate(
                              `/api/advances/${item._id}`,
                              { action: "RESTORE" },
                              "PATCH",
                            )
                          }
                        >
                          Restore
                        </button>
                        <button
                          className="button button-small advance-approve-button"
                          disabled={busy || Boolean(item.payrollRecordId)}
                          title="Restore and approve for payroll deduction"
                          onClick={() => {
                            if (
                              window.confirm(
                                "Restore and approve this advance for one-time payroll deduction?",
                              )
                            )
                              void mutate(
                                `/api/advances/${item._id}`,
                                { action: "RESTORE_AND_APPROVE" },
                                "PATCH",
                              );
                          }}
                        >
                          <Check size={14} /> Restore &amp; approve
                        </button>
                      </>
                    )}
                  {item.payrollRecordId && (
                    <span className="sub-cell">Claimed</span>
                  )}
                </div>,
              ])}
              empty="No advances recorded for this period."
              page={page}
              pageSize={25}
              total={data.total ?? 0}
              onPageChange={setPage}
            />
          )}
        </div>
      );

    if (section === "loans")
      return (
        <div className="content-area">
          <PageHead
            title="Employee loans"
            description="Record original loan amounts and current outstanding balances by employee and outlet. Repayments are entered manually in payroll."
            action={toolbar}
          />
          <Notice error={error} success={success} />
          <section className="panel form-panel">
            <form
              className="form-grid"
              onSubmit={(event) => submit(event, "/api/loans")}
            >
              <label className="field">
                <span>Outlet</span>
                <select
                  name="outletId"
                  defaultValue={
                    selectedOutlet || data.outlets?.[0]?._id || ""
                  }
                  required
                >
                  {(data.outlets ?? []).map((outlet: Outlet) => (
                    <option key={outlet._id} value={outlet._id}>
                      {outlet.code} · {outlet.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Employee</span>
                <select name="employeeId" required>
                  {(data.employees ?? [])
                    .map((employee) => (
                      <option key={employee._id} value={employee._id}>
                        {employee.employeeCode} · {employee.fullName} ·{" "}
                        {data.outlets?.find(
                          (outlet: Outlet) => outlet._id === employee.outletId,
                        )?.code ?? "Outlet"}
                      </option>
                    ))}
                </select>
              </label>
              <Field
                label="Total loan (INR)"
                name="totalAmount"
                type="number"
                min="0.01"
                step="0.01"
                required
              />
              <Field
                label="Current outstanding (INR)"
                name="outstandingAmount"
                type="number"
                min="0"
                step="0.01"
                required
              />
              <Field label="Notes" name="notes" />
              <div className="form-actions">
                <button
                  className="button button-primary"
                  disabled={busy || !(data.outlets ?? []).length}
                >
                  <HandCoins size={16} /> Save loan
                </button>
              </div>
            </form>
          </section>
          {loading ? (
            <Loading />
          ) : (
            <DataTable
              headers={[
                "Employee",
                "Outlet",
                "Original loan",
                "Outstanding",
                "Notes",
                "Actions",
              ]}
              rows={(data.loans ?? []).map((loan: LoanView) => [
                <span key="employee">
                  <strong>{loan.employeeName}</strong>
                  <span className="sub-cell">{loan.employeeCode}</span>
                </span>,
                loan.outletCode ?? "",
                currency(loan.totalAmount),
                currency(loan.outstandingAmount),
                loan.notes || "—",
                <details key="edit" className="salary-adjust">
                  <summary className="button button-small">Edit balance</summary>
                  <form
                    className="salary-adjust-form"
                    onSubmit={(event) =>
                      submit(
                        event,
                        `/api/loans/${loan._id}`,
                        "PATCH",
                      )
                    }
                  >
                    <Field
                      label="Total loan (INR)"
                      name="totalAmount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      defaultValue={String(loan.totalAmount)}
                      required
                    />
                    <Field
                      label="Outstanding (INR)"
                      name="outstandingAmount"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={String(loan.outstandingAmount)}
                      required
                    />
                    <Field
                      label="Notes"
                      name="notes"
                      defaultValue={loan.notes}
                    />
                    <button className="button button-small" disabled={busy}>
                      Save balance
                    </button>
                  </form>
                </details>,
              ])}
              empty="No loans recorded."
            />
          )}
        </div>
      );

    if (section === "salary") {
      const payrollEmployees = data.payrollEmployees ?? [];
      return (
        <div className="content-area">
          <PageHead
            title="Monthly salary"
            description="Generate, review, adjust, approve and record payroll payments."
            action={
              <div className="toolbar">
                <input
                  type="month"
                  value={month}
                  onChange={(event) => {
                    setSalaryGenerateEmployee(null);
                    setMonth(event.target.value);
                  }}
                  aria-label="Payroll month"
                />
                {toolbar}
                {user.permissions.includes("reports.export") &&
                  user.permissions.includes("salary.read") && (
                    (["xlsx", "csv"] as const).map((format) => (
                      <button
                        key={format}
                        className="button"
                        disabled={loading}
                        title={
                          format === "csv"
                            ? "CSV contains plain tabular data; use Excel for formatting."
                            : "Download a formatted Excel workbook."
                        }
                        onClick={() => {
                          const params = new URLSearchParams({
                            type: "salary",
                            format,
                            from: `${month}-01`,
                            to: `${month}-${String(getMonthDatesLocal(month)).padStart(2, "0")}`,
                          });
                          if (selectedOutlet)
                            params.set("outletId", selectedOutlet);
                          void downloadReport(
                            `/api/reports/export?${params.toString()}`,
                            format,
                          ).catch((caught) =>
                            setError(
                              caught instanceof Error
                                ? caught.message
                                : `Unable to export salary ${format.toUpperCase()}.`,
                            ),
                          );
                        }}
                      >
                        {format === "xlsx" ? (
                          <FileSpreadsheet size={16} />
                        ) : (
                          <FileText size={16} />
                        )}
                        {format === "xlsx" ? "Excel" : "CSV"}
                      </button>
                    ))
                )}
              </div>
            }
          />
          <Notice error={error} success={success} />
          {loading ? (
            <Loading />
          ) : (
            <>
            <DataTable
              headers={[
                "Employee",
                "Period",
                "Days P / A / HD / WO",
                "Days filled",
                "Gross",
                "Advances",
                "Employee ESI",
                "Employee PF (deduction)",
                "Employer PF (tracked)",
                "Loan deduction",
                "Net payable",
                "Status",
                "Actions",
              ]}
              rows={[
                ...(data.records ?? []).map((record: SalaryView) => [
                <div key="employee">
                  <strong>{record.inputSnapshot.employee.fullName}</strong>
                  <span className="sub-cell">
                    {record.inputSnapshot.employee.employeeCode}
                  </span>
                  {record.inputSnapshot.employee.monthlyBaseSalary !==
                    undefined && (
                    <span className="sub-cell">
                      Monthly base:{" "}
                      {currency(
                        record.inputSnapshot.employee.monthlyBaseSalary,
                      )}
                    </span>
                  )}
                  <details className="salary-breakdown">
                    <summary>Calculation breakdown</summary>
                    <dl>
                      <dt>Daily rate</dt>
                      <dd>{currency(record.calculation.dailyRate)}</dd>
                      <dt>Half-day deduction</dt>
                      <dd>
                        {currency(
                          record.calculation.halfDayDeduction ??
                            (record.calculation.dailyRate *
                              record.calculation.halfDays) /
                              2,
                        )}
                      </dd>
                      <dt>Paid day units</dt>
                      <dd>{record.calculation.payableDayUnits}</dd>
                      <dt>Paid absences</dt>
                      <dd>{record.calculation.paidAbsenceDays}</dd>
                      <dt>Paid week-offs</dt>
                      <dd>{record.calculation.weekOffs}</dd>
                      <dt>Overtime / allowances</dt>
                      <dd>
                        {currency(record.calculation.overtime)} /{" "}
                        {currency(record.calculation.allowances)}
                      </dd>
                      <dt>Other deductions</dt>
                      <dd>{currency(record.calculation.otherDeductions)}</dd>
                      <dt>Payroll state</dt>
                      <dd>
                        {record.status}
                        {record.paidAt
                          ? ` · paid ${formatDate(record.paidAt)}`
                          : ""}
                      </dd>
                    </dl>
                  </details>
                </div>,
                record.periodStart && record.periodEnd
                  ? `${formatDate(record.periodStart)} – ${formatDate(record.periodEnd)}`
                  : "Full month (legacy)",
                `${record.calculation.presentDays} / ${record.calculation.absentDays} / ${record.calculation.halfDays} / ${record.calculation.weekOffs}`,
                record.calculation.presentDays +
                  record.calculation.absentDays +
                  record.calculation.halfDays +
                  record.calculation.weekOffs,
                currency(record.calculation.grossEarnings),
                currency(record.calculation.advances),
                currency(record.calculation.esi ?? 0),
                currency(record.calculation.employeePf),
                currency(record.calculation.employerPf ?? 0),
                currency(record.calculation.loanDeduction ?? 0),
                <strong key="net">
                  {currency(record.calculation.netPayable)}
                </strong>,
                <span
                  key="status"
                  className={`badge ${record.status === "PAID" ? "badge-green" : record.status === "APPROVED" ? "badge-gold" : "badge-muted"}`}
                >
                  {record.status}
                </span>,
                <SalaryActions
                  key={record._id}
                  record={record}
                  permissions={user.permissions}
                  busy={busy}
                  employee={payrollEmployees.find(
                    (employee) =>
                      employee.latestPayrollRecordId === record._id,
                  )}
                  onGenerate={() =>
                    setSalaryGenerateEmployee(
                      payrollEmployees.find(
                        (employee) =>
                          employee.latestPayrollRecordId === record._id,
                      ) ?? null,
                    )
                  }
                  onManage={() => setSalaryManageRecord(record)}
                />,
                ]),
                ...payrollEmployees
                  .filter((employee) => !employee.payrollRecordId)
                  .map((employee) => [
                    <div key={employee._id}>
                      <strong>{employee.fullName}</strong>
                      <span className="sub-cell">
                        {employee.employeeCode} · {employee.designation} ·{" "}
                        {employee.outletCode}
                      </span>
                      <span className="sub-cell">
                        Monthly base: {currency(employee.monthlyBaseSalary)}
                      </span>
                      {employee.suggestedPeriodEnd ? (
                        <span className="sub-cell">
                          Ready through {employee.suggestedPeriodEnd}
                        </span>
                      ) : (
                        <span className="sub-cell">
                          Submit attendance for the next uncovered dates to generate payroll.
                        </span>
                      )}
                      {employee.outstandingLoanTotal > 0 && (
                        <span className="sub-cell">
                          Outstanding loan:{" "}
                          {currency(employee.outstandingLoanTotal)}
                        </span>
                      )}
                    </div>,
                    "—",
                    `${employee.attendance.P} / ${employee.attendance.A} / ${employee.attendance.HD} / ${employee.attendance.WO}`,
                    employee.attendance.P +
                      employee.attendance.A +
                      employee.attendance.HD +
                      employee.attendance.WO,
                    "—",
                    currency(employee.approvedAdvanceTotal),
                    currency(0),
                    currency(0),
                    currency(0),
                    currency(0),
                    "—",
                    <span key="status" className="badge badge-muted">
                      Not generated
                    </span>,
                    user.permissions.includes("salary.generate") &&
                    employee.suggestedPeriodEnd &&
                    !employee.hasLegacyPayroll ? (
                      <button
                        key="generate"
                        className="button button-small"
                        disabled={busy}
                        onClick={() => setSalaryGenerateEmployee(employee)}
                      >
                        <Plus size={14} /> Generate
                      </button>
                    ) : (
                      "—"
                    ),
                  ]),
              ]}
              empty="No eligible employees or payroll records for this month."
            />
            {salaryGenerateEmployee && (
              <SalaryGenerateModal
                key={`${salaryGenerateEmployee._id}:${month}`}
                employee={salaryGenerateEmployee}
                month={month}
                canApprove={user.permissions.includes("salary.approve")}
                canDeductLoan={user.role === "MAIN_ADMIN"}
                busy={busy}
                onClose={() => setSalaryGenerateEmployee(null)}
                onSubmit={async (payload) => {
                  const ok = await mutate("/api/payroll", payload);
                  if (ok) setSalaryGenerateEmployee(null);
                }}
              />
            )}
            {salaryManageRecord && (
              <SalaryManageModal
                key={`${salaryManageRecord._id}:${salaryManageRecord.updatedAt ?? salaryManageRecord.status}`}
                record={salaryManageRecord}
                isMainAdmin={user.role === "MAIN_ADMIN"}
                permissions={user.permissions}
                busy={busy}
                onClose={() => setSalaryManageRecord(null)}
                onAction={async (action) => {
                  const ok = await mutate(
                    `/api/payroll/${salaryManageRecord._id}`,
                    action,
                  );
                  if (ok) setSalaryManageRecord(null);
                  return ok;
                }}
              />
            )}
            </>
          )}
        </div>
      );
    }

    if (section === "outlets")
      return (
        <div className="content-area">
          <PageHead
            title="Outlets"
            description="Manage your outlet details and control active attendance operations."
            action={toolbar}
          />
          <Notice error={error} success={success} />
          {user.role === "MAIN_ADMIN" && (
            <details className="panel form-panel outlet-create-panel">
              <summary>
                <Plus size={17} /> Add new outlet
              </summary>
              <form
                key={nextAvailableOutletNumber(data.outlets ?? [])}
                className="form-grid"
                onSubmit={(event) => submit(event, "/api/outlets")}
              >
                <Field
                  label="Outlet number"
                  name="outletNumber"
                  type="number"
                  min="1"
                  max="99"
                  step="1"
                  defaultValue={String(nextAvailableOutletNumber(data.outlets ?? []))}
                  required
                  infoText="Choose an outlet number from 1 to 99. The next unused number is selected by default; numbers already assigned to existing outlets cannot be reused."
                />
                <Field label="Outlet name" name="name" required />
                <Field label="Address" name="address" />
                <Field
                  label="City"
                  name="city"
                  defaultValue="Ahmedabad"
                  required
                />
                <Field label="Manager" name="managerName" />
                <Field label="Contact phone" name="contactPhone" />
                <label className="field">
                  <span>Status</span>
                  <select name="active" defaultValue="true">
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </label>
                <div className="form-actions">
                  <button
                    className="button button-primary"
                    type="submit"
                    disabled={busy}
                  >
                    <Plus size={16} /> {busy ? "Adding..." : "Add outlet"}
                  </button>
                </div>
              </form>
            </details>
          )}
          {loading ? (
            <Loading />
          ) : (
            <div className="outlet-grid">
              {(data.outlets ?? []).map((outlet: Outlet) => (
                <OutletCard
                  key={outlet._id}
                  outlet={outlet}
                  onSave={(fields) =>
                    mutate(
                      "/api/outlets",
                      { outletId: outlet._id, ...fields },
                      "PUT",
                    )
                  }
                  disabled={user.role !== "MAIN_ADMIN" || busy}
                />
              ))}
            </div>
          )}
        </div>
      );

    if (section === "access")
      return (
        <div className="content-area">
          <PageHead
            title="Access management"
            description="Create reusable designations with page permissions, then assign them to accounts and outlets."
          />
          <Notice error={error} success={success} />
          <DesignationManager
            designations={data.designations ?? []}
            onChanged={reload}
          />
          <details className="panel form-panel">
            <summary>
              <Plus size={17} /> Provision account
            </summary>
            <form
              className="form-grid"
              onSubmit={(event) => submit(event, "/api/users")}
            >
              <Field
                label="Account email"
                name="email"
                type="email"
                required
              />
              <Field label="Display name" name="name" required />
              <label className="field">
                <span>Initial password (at least 10 characters)</span>
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  required
                />
              </label>
              <label className="field">
                <span>Role · outlet users see only assigned outlet workers</span>
                <select
                  name="role"
                  value={newUserRole}
                  onChange={(event) =>
                    setNewUserRole(event.target.value as UserRole)
                  }
                >
                  <option value="OUTLET_USER">OUTLET_USER</option>
                  <option value="CO_ADMIN">CO_ADMIN</option>
                  <option value="MAIN_ADMIN">MAIN_ADMIN</option>
                </select>
              </label>
              <label className="field">
                <span>
                  {newUserRole === "OUTLET_USER"
                    ? "Assigned outlet · choose one"
                    : "Assigned outlets"}
                </span>
                <select
                  name="outletIds"
                  multiple={newUserRole !== "OUTLET_USER"}
                  size={newUserRole === "OUTLET_USER" ? 1 : 4}
                  required
                >
                  {outlets.map((outlet) => (
                    <option key={outlet._id} value={outlet._id}>
                      {outlet.code} · {outlet.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Designation · reusable permission profile</span>
                <select
                  name="designationId"
                  value={newDesignationId}
                  onChange={(event) =>
                    setNewDesignationId(event.target.value)
                  }
                  disabled={newUserRole === "MAIN_ADMIN"}
                >
                  <option value="">No designation · use manual permissions</option>
                  {(data.designations ?? []).map((designation) => (
                    <option key={designation._id} value={designation._id}>
                      {designation.name}
                    </option>
                  ))}
                </select>
                {newDesignationId && (
                  <small>
                    This account receives the designation permissions. Editing the
                    designation will update all assigned accounts.
                  </small>
                )}
              </label>
              <label className="field">
                <span>Manual permissions (used when no designation is selected)</span>
                <select
                  name="permissions"
                  multiple
                  size={5}
                  disabled={newUserRole === "MAIN_ADMIN" || !!newDesignationId}
                >
                  {designationPermissionGroups.flatMap((group) =>
                    group.permissions.map((permission) => (
                      <option key={permission.value} value={permission.value}>
                        {group.title} · {permission.label}
                      </option>
                    )),
                  )}
                </select>
              </label>
              <input type="hidden" name="active" value="true" />
              <div className="form-actions">
                <button className="button button-primary" disabled={busy}>
                  <Plus size={16} /> Provision user
                </button>
              </div>
            </form>
          </details>
          {loading ? (
            <Loading />
          ) : (
            <DataTable
              className="access-table"
              headers={[
                "Account",
                "Role",
                "Outlets",
                "Permissions",
                "Status",
                "Actions",
              ]}
              rows={(data.users ?? []).map((item: UserView) => [
                <span key="account">
                  <strong>{item.name}</strong>
                  <span className="sub-cell">{item.email}</span>
                  {item.designationName && (
                    <span className="sub-cell">
                      Designation: {item.designationName}
                    </span>
                  )}
                </span>,
                item.role,
                (item.outletIds ?? []).length,
                item.permissions?.join(", ") || "Role defaults",
                <span
                  key="status"
                  className={`badge ${item.active ? "badge-green" : "badge-muted"}`}
                >
                  {item.active ? "Active" : "Revoked"}
                </span>,
                <div
                  key={`${item._id}-${item.designationId ?? ""}-${item.permissions.join("|")}`}
                  className="user-action-buttons"
                >
                  <UserAccessControl
                    item={item}
                    outlets={outlets}
                    designations={data.designations ?? []}
                    onSave={(input) =>
                      mutate(`/api/users/${item._id}`, input, "PATCH")
                    }
                  />
                  <UserPasswordControl item={item} />
                </div>,
              ])}
              empty="No provisioned users."
            />
          )}
        </div>
      );

    if (section === "reports")
      return <ReportsPanel outlets={outlets} />;
    if (section === "activeLogs")
      return (
        <div className="content-area">
          <PageHead
            title="Active logs"
            description="Review the latest account and operations activity."
            action={toolbar}
          />
          <Notice error={error} success={success} />
          {loading ? (
            <Loading />
          ) : (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Recent activity</h2>
                  <p>Latest 50 changes visible to your account</p>
                </div>
              </div>
              <DataTable
                headers={["Time", "Actor", "Action", "Entity", "Reason"]}
                rows={(data.logs ?? []).map((log) => [
                  formatDateTime(log.at),
                  log.actorEmail,
                  log.action,
                  `${log.entityType} · ${log.entityId}`,
                  log.reason ?? "—",
                ])}
                empty="No audit activity recorded."
              />
            </section>
          )}
        </div>
      );
    if (section === "settings")
      return (
        <SettingsPanel
          data={data.settings}
          loading={loading}
          busy={busy}
          error={error}
          success={success}
          user={user}
          onSave={(settings) => mutate("/api/settings", settings, "PUT")}
        />
      );
    return null;
  }

  function AdvanceEdit({
    item,
    busy,
    userRole,
    onSave,
  }: {
    item: NonNullable<WorkspaceData["advances"]>[number];
    busy: boolean;
    userRole: UserRole;
    onSave: (input: Record<string, unknown>) => Promise<boolean>;
  }) {
    const [isOpen, setIsOpen] = useState(false);
    const editLimitReached =
      userRole === "OUTLET_USER" && (item.editCount ?? 0) >= 2;

    function submitEdit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      void onSave({
        employeeId: item.employeeId,
        outletId: item.outletId,
        date: values.get("date"),
        amount: Number(values.get("amount")),
        givenBy: values.get("givenBy"),
        reference: values.get("reference"),
        notes: values.get("notes"),
      });
    }
    return (
      <>
        <button
          type="button"
          className="button button-small"
          disabled={editLimitReached}
          title={
            editLimitReached
              ? "Outlet users can edit an advance no more than twice."
              : undefined
          }
          onClick={() => setIsOpen(true)}
        >
          Edit
        </button>
        {isOpen && (
          <div className="advance-modal-backdrop">
            <section
              className="advance-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby={`advance-edit-title-${item._id}`}
            >
              <header className="advance-modal-heading">
                <div>
                  <h2 id={`advance-edit-title-${item._id}`}>Edit advance</h2>
                  <p>
                    {item.employeeName ?? "Employee"} ·{" "}
                    {item.editCount ?? 0} edit(s) used
                  </p>
                </div>
                <button
                  type="button"
                  className="button button-small"
                  aria-label="Close edit advance"
                  onClick={() => setIsOpen(false)}
                >
                  <X size={16} />
                </button>
              </header>
              <form
                key={item.updatedAt ?? String(item.editCount ?? 0)}
                className="advance-edit-form"
                onSubmit={submitEdit}
              >
                <label className="field">
                  <span>Date</span>
                  <input name="date" type="date" defaultValue={item.date} required />
                </label>
                <label className="field">
                  <span>Amount (INR)</span>
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    defaultValue={item.amount}
                    required
                  />
                </label>
                <label className="field">
                  <span>Given by</span>
                  <input name="givenBy" defaultValue={item.givenBy} required />
                </label>
                <label className="field">
                  <span>Reference</span>
                  <input name="reference" defaultValue={item.reference} required />
                </label>
                <label className="field">
                  <span>Notes</span>
                  <input name="notes" defaultValue={item.notes ?? ""} />
                </label>
                <button className="button button-primary" disabled={busy}>
                  Save advance
                </button>
              </form>
            </section>
          </div>
        )}
      </>
    );
  }

  function SalaryActions({
    record,
    permissions,
    busy,
    employee,
    onGenerate,
    onManage,
  }: {
    record: SalaryView;
    permissions: Permission[];
    busy: boolean;
    employee?: PayrollEmployeeView;
    onGenerate: () => void;
    onManage: () => void;
  }) {
    return (
      <div className="salary-actions">
        <button
          className="button button-small"
          disabled={busy}
          onClick={onManage}
        >
          Manage
        </button>
        {record.status === "PAID" &&
          employee?.suggestedPeriodEnd &&
          !employee.hasLegacyPayroll &&
          permissions.includes("salary.generate") && (
            <button
              className="button button-small"
              disabled={busy}
              onClick={onGenerate}
              title="Generate payroll for the next uncovered attendance period"
            >
              <Plus size={14} /> Next period
            </button>
          )}
      </div>
    );
  }

  function SalaryManageModal({
    record,
    isMainAdmin,
    permissions,
    busy,
    onClose,
    onAction,
  }: {
    record: SalaryView;
    isMainAdmin: boolean;
    permissions: Permission[];
    busy: boolean;
    onClose: () => void;
    onAction: (action: Record<string, unknown>) => Promise<boolean>;
  }) {
    const [amounts, setAmounts] = useState({
      grossEarnings: record.calculation.grossEarnings,
      advances: record.calculation.advances,
      esi: record.calculation.esi ?? 0,
      employeePf: record.calculation.employeePf,
      employerPf: record.calculation.employerPf ?? 0,
      loanDeduction: record.calculation.loanDeduction ?? 0,
    });
    const [correctionReason, setCorrectionReason] = useState("");
    const [unpaidReason, setUnpaidReason] = useState("");
    const [adjustmentKind, setAdjustmentKind] = useState("OVERTIME");
    const [adjustmentLabel, setAdjustmentLabel] = useState("");
    const [adjustmentAmount, setAdjustmentAmount] = useState("");
    const [adjustmentReason, setAdjustmentReason] = useState("");
    const netPayable =
      Number(amounts.grossEarnings) +
      Number(record.calculation.overtime ?? 0) +
      Number(record.calculation.allowances ?? 0) -
      Number(amounts.advances) -
      Number(amounts.esi) -
      Number(amounts.employeePf) -
      Number(amounts.loanDeduction) -
      Number(record.calculation.otherDeductions ?? 0);

    async function submitPaidCorrection(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      await onAction({
        action: "EDIT_PAID",
        amounts,
        reason: correctionReason,
      });
    }

    async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      await onAction({
        action: "ADJUST",
        kind: adjustmentKind,
        label: adjustmentLabel,
        amount: Number(adjustmentAmount),
        reason: adjustmentReason,
      });
    }

    return (
      <div className="advance-modal-backdrop">
        <section
          className="advance-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`salary-manage-title-${record._id}`}
        >
          <header className="advance-modal-heading">
            <div>
              <h2 id={`salary-manage-title-${record._id}`}>Manage payroll</h2>
              <p>
                {record.inputSnapshot.employee.fullName} ·{" "}
                {record.inputSnapshot.employee.employeeCode} · {record.month} ·{" "}
                {record.status}
              </p>
            </div>
            <button
              type="button"
              className="button button-small"
              aria-label="Close payroll management"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </header>
          <div className="salary-manage-content">
            {record.status === "PAID" && (
              <>
                <form className="advance-edit-form" onSubmit={submitPaidCorrection}>
                  <p className="sub-cell">
                    Paid payroll corrections are limited to the main
                    administrator and are recorded in the audit log.
                  </p>
                  <AmountField
                    label="Gross (INR)"
                    value={Number(amounts.grossEarnings)}
                    disabled={!isMainAdmin}
                    onChange={(grossEarnings) =>
                      setAmounts((current) => ({ ...current, grossEarnings }))
                    }
                  />
                  <AmountField
                    label="Advances (INR)"
                    value={Number(amounts.advances)}
                    disabled={!isMainAdmin}
                    onChange={(advances) =>
                      setAmounts((current) => ({ ...current, advances }))
                    }
                  />
                  <AmountField
                    label="Employee ESI (INR)"
                    value={Number(amounts.esi)}
                    disabled={!isMainAdmin}
                    onChange={(esi) =>
                      setAmounts((current) => ({ ...current, esi }))
                    }
                  />
                  <AmountField
                    label="Employee PF deduction (INR)"
                    value={Number(amounts.employeePf)}
                    disabled={!isMainAdmin}
                    onChange={(employeePf) =>
                      setAmounts((current) => ({ ...current, employeePf }))
                    }
                  />
                  <AmountField
                    label="Employer PF tracked (INR)"
                    value={Number(amounts.employerPf)}
                    disabled={!isMainAdmin}
                    onChange={(employerPf) =>
                      setAmounts((current) => ({ ...current, employerPf }))
                    }
                  />
                  <AmountField
                    label="Loan deduction (INR)"
                    value={Number(amounts.loanDeduction)}
                    disabled={!isMainAdmin}
                    onChange={(loanDeduction) =>
                      setAmounts((current) => ({ ...current, loanDeduction }))
                    }
                  />
                  <div className="salary-preview-net">
                    <span>Net payable</span>
                    <strong>{currency(netPayable)}</strong>
                  </div>
                  {isMainAdmin && (
                    <>
                      <label className="field">
                        <span>Correction reason</span>
                        <input
                          value={correctionReason}
                          onChange={(event) =>
                            setCorrectionReason(event.target.value)
                          }
                          minLength={5}
                          maxLength={500}
                          required
                        />
                      </label>
                      <button
                        className="button button-primary"
                        disabled={busy}
                      >
                        Save paid payroll changes
                      </button>
                    </>
                  )}
                </form>
                {isMainAdmin && (
                  <div className="salary-manage-actions">
                    <label className="field">
                      <span>Reason for marking unpaid</span>
                      <input
                        value={unpaidReason}
                        onChange={(event) =>
                          setUnpaidReason(event.target.value)
                        }
                        minLength={5}
                        maxLength={500}
                      />
                    </label>
                    <button
                      className="button button-secondary"
                      disabled={busy || unpaidReason.trim().length < 5}
                      onClick={() =>
                        window.confirm(
                          "Mark this payroll payment as unpaid? It will return to Approved.",
                        ) &&
                        void onAction({
                          action: "UNPAY",
                          reason: unpaidReason,
                        })
                      }
                    >
                      Mark as unpaid
                    </button>
                  </div>
                )}
              </>
            )}
            {record.status === "APPROVED" &&
              permissions.includes("salary.pay") && (
                <button
                  className="button button-primary"
                  disabled={busy}
                  onClick={() =>
                    window.confirm("Mark this salary as paid?") &&
                    void onAction({ action: "PAY" })
                  }
                >
                  Mark paid
                </button>
              )}
            {record.status === "DRAFT" &&
              permissions.includes("salary.adjust") && (
                <form
                  className="advance-edit-form"
                  onSubmit={submitAdjustment}
                >
                  <label className="field">
                    <span>Adjustment</span>
                    <select
                      value={adjustmentKind}
                      onChange={(event) => setAdjustmentKind(event.target.value)}
                    >
                      <option value="OVERTIME">Overtime</option>
                      <option value="ALLOWANCE">Allowance</option>
                      <option value="DEDUCTION">Deduction</option>
                      {isMainAdmin && <option value="LOAN">Loan repayment</option>}
                    </select>
                  </label>
                  <label className="field">
                    <span>Label</span>
                    <input
                      value={adjustmentLabel}
                      onChange={(event) => setAdjustmentLabel(event.target.value)}
                      minLength={2}
                      maxLength={100}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Amount (INR)</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={adjustmentAmount}
                      onChange={(event) => setAdjustmentAmount(event.target.value)}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Reason</span>
                    <input
                      value={adjustmentReason}
                      onChange={(event) => setAdjustmentReason(event.target.value)}
                      minLength={5}
                      maxLength={500}
                      required
                    />
                  </label>
                  <button className="button button-primary" disabled={busy}>
                    Apply adjustment
                  </button>
                </form>
              )}
            {record.status === "DRAFT" &&
              permissions.includes("salary.approve") && (
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() =>
                    void onAction({ action: "APPROVE" })
                  }
                >
                  Approve payroll
                </button>
              )}
            {record.status === "PAID" && !isMainAdmin && (
              <p className="sub-cell">
                Only MAIN_ADMIN can correct or reverse a paid payroll record.
              </p>
            )}
          </div>
        </section>
      </div>
    );
  }

  function SalaryGenerateModal({
    employee,
    month,
    canApprove,
    canDeductLoan,
    busy,
    onClose,
    onSubmit,
  }: {
    employee: PayrollEmployeeView;
    month: string;
    canApprove: boolean;
    canDeductLoan: boolean;
    busy: boolean;
    onClose: () => void;
    onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  }) {
    type Amounts = {
      grossEarnings: number;
      advances: number;
      esi: number;
      employeePf: number;
      employerPf: number;
      loanDeduction: number;
    };
    type Preview = {
      counts: AttendanceCounts;
      amounts: Amounts;
      outstandingLoanTotal: number;
      advances: Array<{
        _id: string;
        date: string;
        amount: number;
        reference: string;
      }>;
    };
    const [periodStart, setPeriodStart] = useState(
      employee.nextPeriodStart ?? `${month}-01`,
    );
    const [periodEnd, setPeriodEnd] = useState(
      employee.suggestedPeriodEnd ?? "",
    );
    const [preview, setPreview] = useState<Preview | null>(null);
    const [amounts, setAmounts] = useState<Amounts | null>(null);
    const [advanceIds, setAdvanceIds] = useState<string[]>([]);
    const [previewError, setPreviewError] = useState("");
    const [approveNow, setApproveNow] = useState(false);
    const loadingPreview =
      Boolean(periodStart && periodEnd) && !preview && !previewError;

    useEffect(() => {
      if (!periodStart || !periodEnd) {
        return;
      }
      let current = true;
      const params = new URLSearchParams({
        month,
        outletId: employee.outletId,
        employeeId: employee._id,
        periodStart,
        periodEnd,
      });
      void request<Preview>(`/api/payroll/preview?${params.toString()}`)
        .then((result) => {
          if (!current) return;
          setPreview(result);
          setAmounts(result.amounts);
          setAdvanceIds(result.advances.map((advance) => advance._id));
        })
        .catch((caught) => {
          if (!current) return;
          setPreviewError(
            caught instanceof Error ? caught.message : "Unable to prepare payroll preview.",
          );
        });
      return () => {
        current = false;
      };
    }, [employee._id, employee.outletId, month, periodEnd, periodStart]);

    const netPayable = amounts
      ? amounts.grossEarnings -
        amounts.advances -
        amounts.esi -
        amounts.employeePf -
        amounts.loanDeduction
      : 0;
    function submit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (!amounts || !periodEnd) return;
      void onSubmit({
        month,
        outletId: employee.outletId,
        employeeId: employee._id,
        periodStart,
        periodEnd,
        advanceIds,
        approve: approveNow,
        amounts,
      });
    }

    return (
      <div className="advance-modal-backdrop">
        <section
          className="advance-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="salary-generate-title"
        >
          <header className="advance-modal-heading">
            <div>
              <h2 id="salary-generate-title">Review payroll</h2>
              <p>
                {employee.fullName} · {employee.employeeCode} ·{" "}
                {employee.outletCode}
              </p>
            </div>
            <button
              type="button"
              className="button button-small"
              aria-label="Close payroll review"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </header>
          {loadingPreview ? (
            <Loading />
          ) : previewError ? (
            <div className="notice notice-error">{previewError}</div>
          ) : (
            <form className="advance-edit-form" onSubmit={submit}>
              <label className="field">
                <span>Period from</span>
                <input
                  type="date"
                  value={periodStart}
                  min={`${month}-01`}
                  max={`${month}-${String(getMonthDatesLocal(month)).padStart(2, "0")}`}
                  onChange={(event) => {
                    setPreview(null);
                    setAmounts(null);
                    setPreviewError("");
                    setPeriodStart(event.target.value);
                  }}
                  required
                />
              </label>
              <label className="field">
                <span>Period through</span>
                <input
                  type="date"
                  value={periodEnd}
                  min={periodStart}
                  max={employee.suggestedPeriodEnd ?? periodEnd}
                  onChange={(event) => {
                    setPreview(null);
                    setAmounts(null);
                    setPreviewError("");
                    setPeriodEnd(event.target.value);
                  }}
                  required
                />
              </label>
              {preview && (
                <>
                  <p className="sub-cell">
                    Attendance P / A / HD / WO: {preview.counts.P} /{" "}
                    {preview.counts.A} / {preview.counts.HD} /{" "}
                    {preview.counts.WO}. Monthly base salary:{" "}
                    {currency(employee.monthlyBaseSalary)}.
                  </p>
                  <AmountField
                    label="Gross earnings (INR)"
                    value={amounts?.grossEarnings ?? 0}
                    onChange={(value) =>
                      setAmounts((current) =>
                        current ? { ...current, grossEarnings: value } : current,
                      )
                    }
                  />
                  <AmountField
                    label="Approved advances (INR)"
                    value={amounts?.advances ?? 0}
                    disabled
                    onChange={() => {}}
                    help="Select which approved advances to deduct below."
                  />
                  {preview.advances.map((advance) => (
                    <label className="field" key={advance._id}>
                      <span>
                        <input
                          type="checkbox"
                          checked={advanceIds.includes(advance._id)}
                          onChange={(event) => {
                            const nextIds = event.target.checked
                              ? [...advanceIds, advance._id]
                              : advanceIds.filter((id) => id !== advance._id);
                            const nextTotal = preview.advances
                              .filter((item) => nextIds.includes(item._id))
                              .reduce((sum, item) => sum + item.amount, 0);
                            setAdvanceIds(nextIds);
                            setAmounts((current) =>
                              current
                                ? { ...current, advances: nextTotal }
                                : current,
                            );
                          }}
                        />{" "}
                        {formatDate(advance.date)} · {advance.reference || "Advance"} ·{" "}
                        {currency(advance.amount)}
                      </span>
                    </label>
                  ))}
                  <AmountField
                    label="Employee ESI (INR)"
                    value={amounts?.esi ?? 0}
                    onChange={(value) =>
                      setAmounts((current) =>
                        current ? { ...current, esi: value } : current,
                      )
                    }
                  />
                  <AmountField
                    label="Employee PF deduction (INR)"
                    value={amounts?.employeePf ?? 0}
                    onChange={(value) =>
                      setAmounts((current) =>
                        current ? { ...current, employeePf: value } : current,
                      )
                    }
                  />
                  <AmountField
                    label="Employer PF tracked (INR)"
                    value={amounts?.employerPf ?? 0}
                    onChange={(value) =>
                      setAmounts((current) =>
                        current ? { ...current, employerPf: value } : current,
                      )
                    }
                  />
                  <AmountField
                    label="Loan deduction (INR)"
                    value={amounts?.loanDeduction ?? 0}
                    max={preview.outstandingLoanTotal}
                    disabled={!canDeductLoan || preview.outstandingLoanTotal <= 0}
                    onChange={(value) =>
                      setAmounts((current) =>
                        current ? { ...current, loanDeduction: value } : current,
                      )
                    }
                    help={
                      canDeductLoan
                        ? `Outstanding balance: ${currency(preview.outstandingLoanTotal)}`
                        : "Only the main administrator can enter loan repayments."
                    }
                  />
                  <div className="salary-preview-net">
                    <span>Net payable</span>
                    <strong>{currency(netPayable)}</strong>
                  </div>
                  {canApprove && (
                    <label className="field">
                      <span>
                        <input
                          type="checkbox"
                          checked={approveNow}
                          onChange={(event) =>
                            setApproveNow(event.target.checked)
                          }
                        />{" "}
                        Generate and approve this payroll
                      </span>
                    </label>
                  )}
                  <button
                    className="button button-primary"
                    disabled={busy || loadingPreview || !amounts}
                  >
                    {approveNow ? "Generate & approve" : "Generate draft"}
                  </button>
                </>
              )}
            </form>
          )}
        </section>
      </div>
    );
  }

  function AmountField({
    label,
    value,
    onChange,
    max,
    disabled = false,
    help,
  }: {
    label: string;
    value: number;
    onChange: (value: number) => void;
    max?: number;
    disabled?: boolean;
    help?: string;
  }) {
    return (
      <label className="field">
        <span>{label}</span>
        <input
          type="number"
          min="0"
          max={max}
          step="0.01"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          required
        />
        {help && <small>{help}</small>}
      </label>
    );
  }

  function getMonthDatesLocal(month: string) {
    const [year, monthNumber] = month.split("-").map(Number);
    return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  }

  function getAwayDateRange(
    period: string,
    customFrom: string,
    customTo: string,
    today: string,
  ) {
    if (period === "CUSTOM") return { from: customFrom, to: customTo };
    if (period === "ALL_TIME") return { from: "0001-01-01", to: today };
    const end = new Date(`${today}T00:00:00.000Z`);
    const start = new Date(end);
    if (period === "THIS_MONTH") start.setUTCDate(1);
    if (period === "LAST_WEEK") start.setUTCDate(start.getUTCDate() - 6);
    if (period === "LAST_MONTH") {
      start.setUTCDate(1);
      start.setUTCMonth(start.getUTCMonth() - 1);
      end.setUTCDate(0);
    }
    return {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    };
  }

  function WhoIsAwayPanel({
    employees,
    period,
    customFrom,
    customTo,
    canExport,
    exportBusy,
    onPeriodChange,
    onCustomFromChange,
    onCustomToChange,
    onExport,
  }: {
    employees: WhoIsAwayView[];
    period: string;
    customFrom: string;
    customTo: string;
    canExport: boolean;
    exportBusy: ExportFormat | null;
    onPeriodChange: (value: string) => void;
    onCustomFromChange: (value: string) => void;
    onCustomToChange: (value: string) => void;
    onExport: (format: ExportFormat) => void;
  }) {
    return (
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Who’s Away</h2>
            <p>Submitted attendance marked Absent or Half-day.</p>
          </div>
          <div className="toolbar">
            <label className="field">
            <span>Range</span>
              <select
                aria-label="Attendance date range"
                value={period}
                onChange={(event) => onPeriodChange(event.target.value)}
              >
                <option value="TODAY">Today</option>
                <option value="THIS_MONTH">This month</option>
                <option value="LAST_WEEK">Last 7 days</option>
                <option value="LAST_MONTH">Last month</option>
                <option value="ALL_TIME">All time</option>
                <option value="CUSTOM">Custom range</option>
              </select>
            </label>
            {period === "CUSTOM" && (
              <>
                <input
                  aria-label="Attendance start date"
                  type="date"
                  value={customFrom}
                  onChange={(event) => onCustomFromChange(event.target.value)}
                />
                <input
                  aria-label="Attendance end date"
                  type="date"
                  value={customTo}
                  onChange={(event) => onCustomToChange(event.target.value)}
                />
              </>
            )}
            {canExport &&
              (["xlsx", "csv"] as const).map((format) => (
                <button
                  key={format}
                  className="button button-secondary"
                  onClick={() => onExport(format)}
                  disabled={!employees.length || exportBusy !== null}
                  title={
                    format === "csv"
                      ? "CSV is plain tabular data; use Excel for formatting."
                      : "Download a formatted Excel workbook."
                  }
                >
                  {exportBusy === format ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : format === "xlsx" ? (
                    <FileSpreadsheet size={15} />
                  ) : (
                    <FileText size={15} />
                  )}
                  {format === "xlsx" ? "Excel" : "CSV"}
                </button>
              ))}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Outlet</th>
                <th>Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={`${employee.employeeId}-${employee.date}`}>
                  <td>
                    <strong>{employee.employeeName}</strong>
                    <span className="sub-cell">{employee.employeeCode}</span>
                  </td>
                  <td>{employee.outletCode}</td>
                  <td>{formatDate(employee.date)}</td>
                  <td>
                    <span
                      className="badge badge-muted"
                    >
                      {employee.status === "A" ? "Absent" : "Half-day"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!employees.length && (
            <Empty>No submitted absent or half-day records for this range.</Empty>
          )}
        </div>
      </section>
    );
  }

  function OutletChart({ outlets }: { outlets: DashboardOutlet[] }) {
    return (
      <section className="panel chart-panel">
        <div className="panel-heading">
          <div>
            <h2>Attendance by outlet</h2>
            <p>Present, absent and half-day counts for today</p>
          </div>
        </div>
        <div className="chart-area">
          {outlets.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={outlets}
                margin={{ top: 8, right: 16, left: -18, bottom: 0 }}
              >
                <CartesianGrid stroke="#eceee9" vertical={false} />
                <XAxis
                  dataKey="code"
                  tick={{ fill: "#777b74", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "#f8f8f5" }}
                  contentStyle={{
                    border: "1px solid #e6e7e2",
                    borderRadius: 5,
                    fontSize: 11,
                  }}
                />
                <Bar
                  dataKey="attendance.P"
                  name="Present"
                  fill="#4b8a6e"
                  radius={[3, 3, 0, 0]}
                />
                <Bar
                  dataKey="attendance.A"
                  name="Absent"
                  fill="#cc6556"
                  radius={[3, 3, 0, 0]}
                />
                <Bar
                  dataKey="attendance.HD"
                  name="Half day"
                  fill="#d2a34d"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty>No accessible outlets.</Empty>
          )}
        </div>
      </section>
    );
  }

  function AttendanceStatusChart({
    attendance,
  }: {
    attendance: AttendanceCounts;
  }) {
    const data = [
      { name: "Present", value: attendance.P, color: "#4b8a6e" },
      { name: "Absent", value: attendance.A, color: "#cc6556" },
      { name: "Half day", value: attendance.HD, color: "#d2a34d" },
      { name: "Week off", value: attendance.WO, color: "#7485b8" },
    ].filter((item) => item.value > 0);

    return (
      <section className="panel chart-panel">
        <div className="panel-heading">
          <div>
            <h2>Attendance Summary</h2>
            <p>Today’s marked staff by attendance status</p>
          </div>
        </div>
        <div className="chart-area">
          {data.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="52%"
                  outerRadius="76%"
                  paddingAngle={3}
                >
                  {data.map((item) => (
                    <Cell key={item.name} fill={item.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend
                  verticalAlign="bottom"
                  height={30}
                  wrapperStyle={{ fontSize: 10 }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <Empty>No attendance has been marked for this date.</Empty>
          )}
        </div>
      </section>
    );
  }

  function AttendanceTrendChart({
    rows,
    from,
    to,
  }: {
    rows: EmployeeAttendanceReportRow[];
    from: string;
    to: string;
  }) {
    const groupByMonth =
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000 >
      62;
    const periods = new Map<
      string,
      { period: string; present: number; absent: number; halfDay: number; weekOff: number }
    >();
    for (const row of rows) {
      for (const [status, dates] of Object.entries(row.statusDates) as [
        AttendanceStatus,
        string[],
      ][]) {
        for (const date of dates) {
          const period = groupByMonth ? date.slice(0, 7) : date;
          const counts = periods.get(period) ?? {
            period,
            present: 0,
            absent: 0,
            halfDay: 0,
            weekOff: 0,
          };
          if (status === "P") counts.present += 1;
          if (status === "A") counts.absent += 1;
          if (status === "HD") counts.halfDay += 1;
          if (status === "WO") counts.weekOff += 1;
          periods.set(period, counts);
        }
      }
    }
    const data = [...periods.values()].sort((left, right) =>
      left.period.localeCompare(right.period),
    );

    return (
      <section className="panel chart-panel report-attendance-chart">
        <div className="panel-heading">
          <div>
            <h2>Attendance trend</h2>
            <p>
              {groupByMonth
                ? "Monthly marked attendance"
                : "Daily marked attendance"}{" "}
              · {formatDate(from)} to {formatDate(to)}
            </p>
          </div>
        </div>
        <div className="chart-area">
          {data.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                margin={{ top: 8, right: 16, left: -18, bottom: 0 }}
              >
                <CartesianGrid stroke="#eceee9" vertical={false} />
                <XAxis
                  dataKey="period"
                  tickFormatter={(period: string) =>
                    groupByMonth
                      ? new Intl.DateTimeFormat("en-GB", {
                          month: "short",
                          year: "numeric",
                          timeZone: "UTC",
                        }).format(new Date(`${period}-01T00:00:00Z`))
                      : formatDate(period)
                  }
                  tick={{ fill: "#777b74", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={14}
                />
                <Tooltip
                  labelFormatter={(period) =>
                    groupByMonth
                      ? `Month ${new Intl.DateTimeFormat("en-GB", {
                          month: "long",
                          year: "numeric",
                          timeZone: "UTC",
                        }).format(new Date(`${period}-01T00:00:00Z`))}`
                      : `Date ${formatDate(String(period))}`
                  }
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="present" name="Present" stackId="attendance" fill="#4b8a6e" />
                <Bar dataKey="absent" name="Absent" stackId="attendance" fill="#cc6556" />
                <Bar dataKey="halfDay" name="Half day" stackId="attendance" fill="#d2a34d" />
                <Bar dataKey="weekOff" name="Week off" stackId="attendance" fill="#7485b8" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty>No attendance data is available for this date range.</Empty>
          )}
        </div>
      </section>
    );
  }

  function Metric({
    title,
    value,
    detail,
    accent,
  }: {
    title: string;
    value: string | number;
    detail?: string;
    accent: string;
  }) {
    return (
      <article className={`metric-card metric-${accent}`}>
        <div className="metric-top">
          <span>{title}</span>
          <i />
        </div>
        <strong>{value}</strong>
        <small>{detail ?? "Current period"}</small>
      </article>
    );
  }

  function DataTable({
    className,
    headers,
    rows,
    empty,
    page = 1,
    pageSize = 25,
    total,
    onPageChange,
  }: {
    className?: string;
    headers: string[];
    rows: React.ReactNode[][];
    empty: string;
    page?: number;
    pageSize?: number;
    total?: number;
    onPageChange?: (page: number) => void;
  }) {
    const pageCount =
      total === undefined ? 1 : Math.max(1, Math.ceil(total / pageSize));
    return (
      <section className={`panel ${className ?? ""}`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <Empty>{empty}</Empty>}
        </div>
        <div className="panel-footer">
          <span>
            {total ?? rows.length} records · page {page} of {pageCount}
          </span>
          <div className="pagination">
            <button
              className="icon-button"
              aria-label="Previous page"
              title="Previous page"
              disabled={!onPageChange || page <= 1}
              onClick={() => onPageChange?.(page - 1)}
            >
              <ChevronLeft size={17} />
            </button>
            <span>1</span>
            <button
              className="icon-button"
              aria-label="Next page"
              title="Next page"
              disabled={!onPageChange || page >= pageCount}
              onClick={() => onPageChange?.(page + 1)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      </section>
    );
  }

  function Field({
    label,
    name,
    type = "text",
    required,
    min,
    max,
    step,
    defaultValue,
    infoText,
    disabled,
  }: {
    label: string;
    name: string;
    type?: string;
    required?: boolean;
    min?: string;
    max?: string;
    step?: string;
    defaultValue?: string;
    infoText?: string;
    disabled?: boolean;
  }) {
    return (
      <div className="field">
        <div className="field-label-row">
          <label htmlFor={`field-${name}`}>{label}</label>
          {infoText && <InfoTip text={infoText} />}
        </div>
        <input
          id={`field-${name}`}
          name={name}
          type={type}
          required={required}
          min={min}
          max={max}
          step={step}
          defaultValue={defaultValue}
          disabled={disabled}
        />
      </div>
    );
  }

  function InfoTip({ text }: { text: string }) {
    const [open, setOpen] = useState(false);
    const [hovered, setHovered] = useState(false);
    const visible = open || hovered;
    return (
      <span
        className={`field-info${open ? " field-info-open" : ""}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <button
          type="button"
          className="field-info-button"
          aria-label="More information"
          aria-expanded={open}
          title={text}
          onClick={() => setOpen((current) => !current)}
        >
          <Info size={14} />
        </button>
        <span
          className="field-info-tooltip"
          role="tooltip"
          hidden={!visible}
        >
          {text}
        </span>
      </span>
    );
  }

  function Empty({ children }: { children: React.ReactNode }) {
    return (
      <div className="empty-state">
        <span className="empty-mark">
          <SlidersHorizontal size={20} />
        </span>
        <strong>{children}</strong>
      </div>
    );
  }

  function EmployeeCodeField({
    outletId,
    outletPrefix,
  }: {
    outletId: string;
    outletPrefix: string;
  }) {
    const [code, setCode] = useState("");
    const [autoGenerated, setAutoGenerated] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState("");

    async function generateCode() {
      setGenerating(true);
      setError("");
      try {
        const result = await request<{ employeeCode: string }>(
          `/api/employees?nextCode=true&outletId=${encodeURIComponent(outletId)}`,
        );
        setCode(result.employeeCode);
        setAutoGenerated(true);
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to generate an employee code.",
        );
      } finally {
        setGenerating(false);
      }
    }

    return (
      <div
        className="field"
        onReset={() => {
          setCode("");
          setAutoGenerated(false);
        }}
      >
        <div className="field-label-row">
          <label htmlFor="new-employee-code">
            Employee code ({outletPrefix || "outlet"} + 4 digits)
          </label>
        </div>
        <div className="employee-code-input">
          <input
            id="new-employee-code"
            name="employeeCode"
            type="text"
            value={code}
            inputMode="text"
            pattern={`${outletPrefix}[0-9]{4}`}
            maxLength={outletPrefix.length + 4}
            title={`Enter ${outletPrefix} followed by exactly 4 digits.`}
            required
            onChange={(event) => {
              setCode(event.target.value.toUpperCase());
              setAutoGenerated(false);
            }}
          />
          <input type="hidden" name="autoGenerate" value={String(autoGenerated)} readOnly />
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void generateCode()}
            disabled={generating || !outletId || outletPrefix.length !== 3}
          >
            {generating ? "Generating..." : "Auto-generate"}
          </button>
        </div>
        <small>
          {outletPrefix
            ? `Code uses ${outletPrefix} from the selected outlet name, followed by a 4-digit number.`
            : "Select an outlet with a name of at least 3 letters."}
        </small>
        {error && <small className="employee-code-error">{error}</small>}
      </div>
    );
  }

  function outletCodePrefix(name: string) {
    return name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z]/gi, "")
      .slice(0, 3)
      .toUpperCase();
  }

  function currency(value: number | undefined) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(Number(value) || 0);
  }

  function normalizeForm(values: Record<string, FormDataEntryValue>) {
    const body: Record<string, unknown> = { ...values };
    for (const key of [
      "monthlyBaseSalary",
      "employeePfPercent",
      "employerPfPercent",
      "esiPercent",
      "amount",
      "totalAmount",
      "outstandingAmount",
      "outletNumber",
    ]) {
      if (key in body) body[key] = Number(body[key]);
    }
    for (const key of ["pfEnabled", "esiEnabled", "active"]) {
      if (key in body) body[key] = body[key] === "true";
    }
    for (const key of ["outletIds", "permissions"]) {
      if (typeof body[key] === "string")
        body[key] = String(body[key])
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
    }
    return body;
  }

  function nextAvailableOutletNumber(outlets: Outlet[]) {
    const usedNumbers = new Set(
      outlets
        .map((outlet) => /^OUT(\d{2})$/.exec(outlet.code)?.[1])
        .filter((value): value is string => value !== undefined)
        .map(Number),
    );
    return Array.from({ length: 99 }, (_, index) => index + 1).find(
      (number) => !usedNumbers.has(number),
    ) ?? 1;
  }

  function OutletCard({
    outlet,
    onSave,
    disabled,
  }: {
    outlet: Outlet;
    onSave: (fields: Partial<Outlet>) => void;
    disabled: boolean;
  }) {
    const [name, setName] = useState(outlet.name ?? outlet.code);
    const [active, setActive] = useState(outlet.active ?? false);
    const [address, setAddress] = useState(outlet.address ?? "");
    const [city, setCity] = useState(outlet.city ?? "");
    const [managerName, setManagerName] = useState(outlet.managerName ?? "");
    const [contactPhone, setContactPhone] = useState(outlet.contactPhone ?? "");
    const changed =
      name !== outlet.name ||
      active !== outlet.active ||
      address !== (outlet.address ?? "") ||
      city !== (outlet.city ?? "") ||
      managerName !== (outlet.managerName ?? "") ||
      contactPhone !== (outlet.contactPhone ?? "");
    return (
      <article className="outlet-card">
        <div className="outlet-card-head">
          <span className="outlet-code">{outlet.code}</span>
          <span className={`badge ${active ? "badge-green" : "badge-muted"}`}>
            {active ? "Active" : "Inactive"}
          </span>
        </div>
        <label className="field">
          <span>Outlet name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={disabled}
          />
        </label>
        <label className="field">
          <span>Address</span>
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            disabled={disabled}
          />
        </label>
        <label className="field">
          <span>City</span>
          <input
            value={city}
            onChange={(event) => setCity(event.target.value)}
            disabled={disabled}
          />
        </label>
        <label className="field">
          <span>Manager</span>
          <input
            value={managerName}
            onChange={(event) => setManagerName(event.target.value)}
            disabled={disabled}
          />
        </label>
        <label className="field">
          <span>Contact phone</span>
          <input
            value={contactPhone}
            onChange={(event) => setContactPhone(event.target.value)}
            disabled={disabled}
          />
        </label>
        {!!outlet.assignedUsers?.length && (
          <div className="assigned-users">
            <span>Assigned users</span>
            {outlet.assignedUsers.map((user) => (
              <small key={user.email}>
                {user.name} · {user.role.replaceAll("_", " ")}
              </small>
            ))}
          </div>
        )}
        <label className="toggle-row">
          <span>Available for operations</span>
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
            disabled={disabled}
          />
        </label>
        <button
          className="button button-secondary button-full"
          disabled={disabled || !changed}
          onClick={() => {
            if (
              outlet.active &&
              !active &&
              !window.confirm(
                `Deactivate ${outlet.code}? Historical records remain accessible.`,
              )
            )
              return;
            onSave({ name, active, address, city, managerName, contactPhone });
          }}
        >
          <Check size={15} /> Save outlet
        </button>
      </article>
    );
  }

  function DesignationManager({
    designations,
    onChanged,
  }: {
    designations: DesignationView[];
    onChanged: () => Promise<void>;
  }) {
    const [editingId, setEditingId] = useState("");
    const [isOpen, setIsOpen] = useState(false);
    const selected = designations.find((item) => item._id === editingId);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [color, setColor] = useState("#635bdb");
    const [permissions, setPermissions] = useState<Permission[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const colors = [
      "#635bdb",
      "#201f58",
      "#ef43b4",
      "#e91e63",
      "#a46526",
      "#3b82f6",
    ];

    function beginEdit(id: string) {
      const designation = designations.find((item) => item._id === id);
      setIsOpen(true);
      setEditingId(id);
      setName(designation?.name ?? "");
      setDescription(designation?.description ?? "");
      setColor(designation?.color ?? "#635bdb");
      setPermissions(designation?.permissions ?? []);
      setError("");
    }

    function closeEditor() {
      setIsOpen(false);
      setEditingId("");
      setName("");
      setDescription("");
      setColor("#635bdb");
      setPermissions([]);
      setError("");
    }

    async function save(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      setBusy(true);
      setError("");
      try {
        const body = { name, description, color, permissions };
        await request(
          "/api/designations",
          {
            method: editingId ? "PUT" : "POST",
            body: JSON.stringify(editingId ? { id: editingId, ...body } : body),
          },
        );
        await onChanged();
        closeEditor();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to save the designation.",
        );
      } finally {
        setBusy(false);
      }
    }

    async function remove() {
      if (!editingId || selected?.assignedCount) return;
      if (!window.confirm(`Delete the ${selected?.name} designation?`)) return;
      setBusy(true);
      setError("");
      try {
        await request(`/api/designations/${editingId}`, { method: "DELETE" });
        await onChanged();
        closeEditor();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to delete the designation.",
        );
      } finally {
        setBusy(false);
      }
    }

    return (
      <section className="panel designation-panel">
        <div className="panel-heading">
          <div>
            <h2>Designations</h2>
            <p>
              Save a permission profile once and assign it to staff across outlets.
              Updating a profile updates every account using it.
            </p>
          </div>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => beginEdit("")}
          >
            <Plus size={15} /> New designation
          </button>
        </div>
        {!!designations.length && (
          <div className="designation-picker">
            <label className="field">
              <span>Edit a designation</span>
              <select
                value={editingId}
                onChange={(event) => beginEdit(event.target.value)}
                aria-label="Choose a designation to edit"
              >
                <option value="">Choose a designation to edit…</option>
                {designations.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.name} · {item.assignedCount ?? 0} assigned account(s)
                  </option>
                ))}
              </select>
            </label>
            <small>
              Select a designation to edit its permissions or remove it.
              Changes apply to every assigned account.
            </small>
          </div>
        )}
        {isOpen && <div className="access-modal-backdrop">
          <section
            className="access-modal designation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="designation-modal-title"
          >
            <div className="access-modal-heading">
              <div>
                <h2 id="designation-modal-title">
                  {editingId ? "Edit designation" : "New designation"}
                </h2>
                <p>Set page access and save this reusable permission profile.</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close designation editor"
                disabled={busy}
                onClick={closeEditor}
              >
                <X size={18} />
              </button>
            </div>
            <Notice error={error} success="" />
            <form className="designation-form" onSubmit={save}>
          <div className="form-grid">
            <label className="field">
              <span>Designation name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Outlet Manager"
                minLength={2}
                maxLength={80}
                required
              />
            </label>
            <label className="field">
              <span>Description</span>
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What this role can do"
                maxLength={240}
              />
            </label>
            <fieldset className="designation-colors">
              <legend>Color accent</legend>
              <div>
                {colors.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={`Choose color ${value}`}
                    aria-pressed={color === value}
                    style={{ backgroundColor: value }}
                    onClick={() => setColor(value)}
                  />
                ))}
              </div>
            </fieldset>
          </div>
          <div className="designation-permissions">
            <div className="designation-permissions-heading">
              <strong>App page and action permissions</strong>
              <span>
                {permissions.length} selected · applies to assigned users
              </span>
            </div>
            {designationPermissionGroups.map((group) => (
              <fieldset key={group.title}>
                <legend>{group.title}</legend>
                <div className="permission-toggle-grid">
                  {group.permissions.map((permission) => (
                    <label key={permission.value}>
                      <input
                        type="checkbox"
                        checked={permissions.includes(permission.value)}
                        onChange={(event) =>
                          setPermissions((current) =>
                            event.target.checked
                              ? [...current, permission.value]
                              : current.filter(
                                  (value) => value !== permission.value,
                                ),
                          )
                        }
                      />
                      <span>{permission.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <fieldset className="admin-only-permissions">
              <legend>Admin-only pages</legend>
              {adminOnlyPages.map((page) => (
                <div key={page.permission}>
                  <span>{page.title}</span>
                  <small>MAIN_ADMIN only</small>
                </div>
              ))}
            </fieldset>
          </div>
          <div className="form-actions">
            <button className="button button-primary" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
              {editingId ? "Save designation" : "Create designation"}
            </button>
            {editingId && (
              <button
                className="button button-secondary"
                type="button"
                disabled={busy || (selected?.assignedCount ?? 0) > 0}
                title={
                  (selected?.assignedCount ?? 0) > 0
                    ? "Reassign users before deleting this designation."
                    : undefined
                }
                onClick={remove}
              >
                Delete
              </button>
            )}
          </div>
            </form>
          </section>
        </div>}
      </section>
    );
  }

  function UserAccessControl({
    item,
    outlets,
    designations,
    onSave,
  }: {
    item: UserView;
    outlets: Outlet[];
    designations: DesignationView[];
    onSave: (input: Record<string, unknown>) => Promise<boolean>;
  }) {
    const [role, setRole] = useState(item.role as UserRole);
    const [isOpen, setIsOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [outletIds, setOutletIds] = useState<string[]>(
      (item.outletIds ?? []).map(String),
    );
    const [permissions, setPermissions] = useState<string[]>(
      item.designationId || item.permissionsCustomized
        ? item.permissions ?? []
        : item.role === "OUTLET_USER"
            ? legacyOutletDefaultPermissions
            : item.permissions ?? [],
    );
    const [designationId, setDesignationId] = useState(item.designationId ?? "");
    const [active, setActive] = useState(Boolean(item.active));
    const selectedRoleValue = designationId
      ? `designation:${designationId}`
      : role;

    function openEditor() {
      setRole(item.role);
      setOutletIds((item.outletIds ?? []).map(String));
      setPermissions(
        item.designationId || item.permissionsCustomized
          ? item.permissions ?? []
          : item.role === "OUTLET_USER"
            ? legacyOutletDefaultPermissions
            : item.permissions ?? [],
      );
      setDesignationId(item.designationId ?? "");
      setActive(Boolean(item.active));
      setIsOpen(true);
    }

    return (
      <div className="access-edit">
        <button
          className="button button-secondary access-manage-button"
          type="button"
          onClick={openEditor}
        >
          Manage
        </button>
        {isOpen && (
        <div className="access-modal-backdrop">
          <section
            className="access-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`access-modal-title-${item._id}`}
          >
            <div className="access-modal-heading">
              <div>
                <h2 id={`access-modal-title-${item._id}`}>Manage access</h2>
                <p>{item.name} · {item.email}</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close access editor"
                onClick={() => setIsOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="access-edit-body">
          <label className="field">
            <span>Role</span>
            <select
              value={selectedRoleValue}
              onChange={(event) => {
                const nextValue = event.target.value;
                if (nextValue.startsWith("designation:")) {
                  const nextDesignationId = nextValue.slice("designation:".length);
                  setDesignationId(nextDesignationId);
                  const selected = designations.find(
                    (designation) => designation._id === nextDesignationId,
                  );
                  if (selected) setPermissions([...selected.permissions]);
                  if (role === "MAIN_ADMIN") setRole("OUTLET_USER");
                  return;
                }
                const nextRole = nextValue as UserRole;
                setRole(nextRole);
                setDesignationId("");
                if (nextRole === "OUTLET_USER")
                  setOutletIds((current) => current.slice(0, 1));
              }}
            >
              <option value="OUTLET_USER">OUTLET_USER</option>
              <option value="CO_ADMIN">CO_ADMIN</option>
              <option value="MAIN_ADMIN">MAIN_ADMIN</option>
              {designations.map((designation) => (
                <option
                  key={designation._id}
                  value={`designation:${designation._id}`}
                >
                  Designation · {designation.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Assigned outlets</span>
            <select
              multiple={role !== "OUTLET_USER"}
              size={role === "OUTLET_USER" ? 1 : 3}
              value={role === "OUTLET_USER" ? outletIds[0] ?? "" : outletIds}
              onChange={(event) =>
                setOutletIds(
                  role === "OUTLET_USER"
                    ? [event.target.value].filter(Boolean)
                    : Array.from(
                        event.target.selectedOptions,
                        (option) => option.value,
                      ),
                )
              }
            >
              {outlets
                .filter((outlet) => role !== "OUTLET_USER" || outlet.active)
                .map((outlet) => (
                <option key={outlet._id} value={outlet._id}>
                  {outlet.code} · {outlet.name}
                </option>
                ))}
            </select>
          </label>
          {designationId && (
            <small>
              {designations.find((designation) => designation._id === designationId)?.name}
              {" "}permissions sync automatically when the designation is edited.
            </small>
          )}
          {!designationId && role !== "MAIN_ADMIN" && (
            <div className="user-permission-groups">
              {designationPermissionGroups.map((group) => (
                <fieldset key={group.title}>
                  <legend>{group.title}</legend>
                  {group.permissions.map((permission) => (
                    <label key={permission.value}>
                      <input
                        type="checkbox"
                        checked={permissions.includes(permission.value)}
                        onChange={(event) =>
                          setPermissions((current) =>
                            event.target.checked
                              ? [...current, permission.value]
                              : current.filter(
                                  (value) => value !== permission.value,
                                ),
                          )
                        }
                      />
                      {permission.label}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          )}
          <label className="toggle-row">
            <span>Account active</span>
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
          </label>
          <button
            className="button button-primary button-full"
            type="button"
            disabled={isSaving}
            onClick={async () => {
              if (
                !window.confirm(
                  `Confirm this access change for ${item.email}? Grants take effect immediately.`,
                )
              )
                return;
              setIsSaving(true);
              try {
                const saved = await onSave({
                  email: item.email,
                  name: item.name,
                  role,
                  outletIds,
                  permissions: role !== "MAIN_ADMIN" ? permissions : [],
                  ...(designationId && role !== "MAIN_ADMIN"
                    ? { designationId }
                    : {}),
                  active,
                });
                if (saved) setIsOpen(false);
              } finally {
                setIsSaving(false);
              }
            }}
          >
            {isSaving ? "Saving..." : "Save access"}
          </button>
        </div>
          </section>
        </div>
        )}
      </div>
    );
  }

  function UserPasswordControl({ item }: { item: UserView }) {
    const [isOpen, setIsOpen] = useState(false);
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    function close() {
      setIsOpen(false);
      setPassword("");
      setConfirmPassword("");
      setShowPassword(false);
      setError("");
    }

    async function savePassword(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      setError("");
      setSuccess("");
      if (password !== confirmPassword) {
        setError("The passwords do not match.");
        return;
      }
      setBusy(true);
      try {
        await request(`/api/users/${item._id}/password`, {
          method: "PATCH",
          body: JSON.stringify({ password }),
        });
        setSuccess("Password changed. Share the new password securely.");
        setPassword("");
        setConfirmPassword("");
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to change password.",
        );
      } finally {
        setBusy(false);
      }
    }

    return (
      <>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => {
            setError("");
            setSuccess("");
            setIsOpen(true);
          }}
        >
          Password
        </button>
        {isOpen && (
          <div className="access-modal-backdrop">
            <section
              className="access-modal user-password-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby={`user-password-title-${item._id}`}
            >
              <div className="access-modal-heading">
                <div>
                  <h2 id={`user-password-title-${item._id}`}>
                    Change account password
                  </h2>
                  <p>
                    {item.name} · {item.email}
                  </p>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Close password dialog"
                  onClick={close}
                >
                  <X size={18} />
                </button>
              </div>
              <p className="password-hash-note">
                Current password cannot be viewed: passwords are stored as
                secure one-way hashes. Set a new password below.
              </p>
              {error && <Notice error={error} success="" />}
              {success && <Notice error="" success={success} />}
              <form
                className="form-grid user-password-form"
                onSubmit={savePassword}
              >
                <label className="field">
                  <span>New password (at least 10 characters)</span>
                  <span className="password-input">
                    <input
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      minLength={10}
                      maxLength={72}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                    />
                    <button
                      className="password-toggle"
                      type="button"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      onClick={() => setShowPassword((visible) => !visible)}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </span>
                </label>
                <label className="field">
                  <span>Confirm new password</span>
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    minLength={10}
                    maxLength={72}
                    value={confirmPassword}
                    onChange={(event) =>
                      setConfirmPassword(event.target.value)
                    }
                    required
                  />
                </label>
                <div className="form-actions">
                  <button className="button button-primary" disabled={busy}>
                    {busy ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Check size={16} />
                    )}
                    Save new password
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </>
    );
  }

  function EmployeeAttendanceTable({
    rows,
    canReadSalary,
    from = "",
    to = "",
    preset = "Custom",
    employeeId = "",
    employees = [],
    canExport = false,
    exportBusy = null,
    onPresetChange,
    onFromChange,
    onToChange,
    onEmployeeChange,
    onExport,
    title,
    description,
  }: {
    rows: EmployeeAttendanceReportRow[];
    canReadSalary: boolean;
    from?: string;
    to?: string;
    preset?: string;
    employeeId?: string;
    employees?: EmployeeAttendanceReport["employees"];
    canExport?: boolean;
    exportBusy?: ExportFormat | null;
    onPresetChange?: (value: string) => void;
    onFromChange?: (value: string) => void;
    onToChange?: (value: string) => void;
    onEmployeeChange?: (value: string) => void;
    onExport?: (format: ExportFormat) => void;
    title: string;
    description: string;
  }) {
    return (
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <div className="toolbar dashboard-report-toolbar">
            {onPresetChange && (
              <select
                aria-label="Attendance report period"
                value={preset}
                onChange={(event) => onPresetChange(event.target.value)}
              >
                <option>This Month</option>
                <option>Last Month</option>
                <option>Custom</option>
              </select>
            )}
            {onEmployeeChange && (
              <select
                aria-label="Attendance report employee"
                value={employeeId}
                onChange={(event) => onEmployeeChange(event.target.value)}
              >
                <option value="">All employees</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.code} · {employee.name}
                  </option>
                ))}
              </select>
            )}
            {onFromChange && (
              <input
                type="date"
                aria-label="Attendance report from date"
                value={from}
                onChange={(event) => onFromChange(event.target.value)}
              />
            )}
            {onToChange && (
              <input
                type="date"
                aria-label="Attendance report to date"
                value={to}
                onChange={(event) => onToChange(event.target.value)}
              />
            )}
            {canExport && onExport && (
              <>
                <button
                  className="button button-secondary"
                  type="button"
                  aria-label="Download Excel"
                  disabled={exportBusy !== null || from > to}
                  onClick={() => onExport("xlsx")}
                >
                  {exportBusy === "xlsx" ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <FileSpreadsheet size={15} />
                  )}
                  Excel
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  aria-label="Download CSV"
                  disabled={exportBusy !== null || from > to}
                  onClick={() => onExport("csv")}
                >
                  {exportBusy === "csv" ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <FileText size={15} />
                  )}
                  CSV
                </button>
              </>
            )}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Present</th>
                <th>Absent</th>
                <th>Half day</th>
                <th>Week off</th>
                <th>Filled days</th>
                <th>Not marked</th>
                {canReadSalary && <th>Fixed salary</th>}
                {canReadSalary && <th>Advances</th>}
                {canReadSalary && <th>Employee ESI</th>}
                {canReadSalary && <th>Employee PF</th>}
                {canReadSalary && <th>Employer PF</th>}
                {canReadSalary && <th>Loan</th>}
                {canReadSalary && <th>Payable</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.employeeId}>
                  <td>
                    <strong>{row.employeeName}</strong>
                    <span className="sub-cell">
                      {row.employeeCode} · {row.outletCode}
                    </span>
                    {row.presentDays > 0 && (
                      <span className="sub-cell">
                        Present: {row.statusDates.P.join(", ")}
                      </span>
                    )}
                    {row.absentDays > 0 && (
                      <span className="sub-cell">
                        Absent: {row.statusDates.A.join(", ")}
                      </span>
                    )}
                    {row.weekOffs > 0 && (
                      <span className="sub-cell">
                        Week off: {row.statusDates.WO.join(", ")}
                      </span>
                    )}
                    {row.halfDays > 0 && (
                      <span className="sub-cell">
                        Half day: {row.statusDates.HD.join(", ")}
                      </span>
                    )}
                    {row.unsubmittedDays > 0 && (
                      <span className="sub-cell">
                        Pending submission: {row.unsubmittedDays} day(s)
                      </span>
                    )}
                  </td>
                  <td>{row.presentDays}</td>
                  <td>{row.absentDays}</td>
                  <td>{row.halfDays}</td>
                  <td>{row.weekOffs}</td>
                  <td>
                    {row.filledDays ??
                      row.presentDays +
                        row.absentDays +
                        row.halfDays +
                        row.weekOffs}
                  </td>
                  <td>{row.missingDays}</td>
                  {canReadSalary && (
                    <td>{currency(row.monthlyBaseSalary ?? 0)}</td>
                  )}
                  {canReadSalary && <td>{currency(row.advances ?? 0)}</td>}
                  {canReadSalary && <td>{currency(row.esi ?? 0)}</td>}
                  {canReadSalary && (
                    <td>{currency(row.employeePf ?? 0)}</td>
                  )}
                  {canReadSalary && (
                    <td>{currency(row.employerPf ?? 0)}</td>
                  )}
                  {canReadSalary && (
                    <td>{currency(row.loanDeduction ?? 0)}</td>
                  )}
                  {canReadSalary && (
                    <td>
                      {currency(row.payableAmount ?? 0)}
                      <span className="sub-cell">{row.payableLabel}</span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <Empty>No employee attendance records match this period.</Empty>
          )}
        </div>
      </section>
    );
  }

  function ReportsPanel({ outlets }: { outlets: Outlet[] }) {
    const [kind, setKind] = useState("attendance");
    const [outletId, setOutletId] = useState("");
    const selectedOutletId =
      outlets.length === 1 ? outlets[0]._id : outletId;
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
    }).format(new Date());
    const monthStart = `${today.slice(0, 7)}-01`;
    const [from, setFrom] = useState(monthStart);
    const [to, setTo] = useState(today);
    const [preset, setPreset] = useState("This Month");
    const [busy, setBusy] = useState<ExportFormat | null>(null);
    const [error, setError] = useState("");
    const [employeeReport, setEmployeeReport] =
      useState<EmployeeAttendanceReport | null>(null);
    const [employeeId, setEmployeeId] = useState("");
    const [loadedReportKey, setLoadedReportKey] = useState("");
    const reportKey = `${from}|${to}|${selectedOutletId}|${employeeId}`;
    useEffect(() => {
      if (kind !== "attendance") return;
      let active = true;
      const params = new URLSearchParams({ from, to });
      if (selectedOutletId) params.set("outletId", selectedOutletId);
      if (employeeId) params.set("employeeId", employeeId);
      void request<EmployeeAttendanceReport>(
        `/api/reports/employee-attendance?${params.toString()}`,
      )
        .then((result) => {
          if (active) {
            setEmployeeReport(result);
            setLoadedReportKey(reportKey);
            setError("");
          }
        })
        .catch((caught) => {
          if (active) {
            setEmployeeReport(null);
            setLoadedReportKey(reportKey);
            setError(
              caught instanceof Error
                ? caught.message
                : "Unable to load employee attendance.",
            );
          }
        });
      return () => {
        active = false;
      };
    }, [kind, from, to, selectedOutletId, employeeId, reportKey]);
    function applyPreset(value: string) {
      setPreset(value);
      if (value === "Custom") return;
      const end = new Date(`${today}T00:00:00.000Z`);
      const start = new Date(end);
      if (value === "Yesterday") start.setUTCDate(start.getUTCDate() - 1);
      if (value === "This Week")
        start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
      if (value === "This Month") start.setUTCDate(1);
      if (value === "Last Month") {
        start.setUTCDate(1);
        start.setUTCMonth(start.getUTCMonth() - 1);
        end.setUTCDate(0);
      }
      if (value === "This Year") {
        start.setUTCMonth(0, 1);
      }
      setFrom(start.toISOString().slice(0, 10));
      setTo(end.toISOString().slice(0, 10));
    }
    async function exportFile(format: ExportFormat) {
      setBusy(format);
      setError("");
      try {
        const params = new URLSearchParams({ type: kind, from, to, format });
        if (selectedOutletId) params.set("outletId", selectedOutletId);
        if (kind === "attendance" && employeeId)
          params.set("employeeId", employeeId);
        await downloadReport(
          `/api/reports/export?${params.toString()}`,
          format,
        );
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Report export failed.",
        );
      } finally {
        setBusy(null);
      }
    }
    return (
      <div className="content-area">
        <PageHead
          title="Reports & exports"
          description="Download permission-checked Excel and CSV reports from live records."
        />
        <Notice error={error} success="" />
        <section className="panel report-panel">
          <div className="report-icon">
            <ArrowDownToLine size={22} />
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Date range</span>
              <select
                value={preset}
                onChange={(event) => applyPreset(event.target.value)}
              >
                {[
                  "Today",
                  "Yesterday",
                  "This Week",
                  "This Month",
                  "Last Month",
                  "This Year",
                  "Custom",
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Report</span>
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="attendance">Attendance</option>
                <option value="salary">Monthly salary</option>
                <option value="employees">Employee list</option>
                <option value="advances">Advances</option>
                <option value="audit">Audit log</option>
              </select>
            </label>
            <label className="field">
              <span>Outlet</span>
              <select
                value={selectedOutletId}
                onChange={(event) => {
                  setOutletId(event.target.value);
                  setEmployeeId("");
                }}
              >
                {outlets.length !== 1 && (
                  <option value="">All accessible outlets</option>
                )}
                {outlets.map((outlet) => (
                  <option key={outlet._id} value={outlet._id}>
                    {outlet.code} · {outlet.name}
                  </option>
                ))}
              </select>
            </label>
            {kind === "attendance" && (
              <label className="field">
                <span>Employee</span>
                <select
                  value={employeeId}
                  onChange={(event) => setEmployeeId(event.target.value)}
                >
                  <option value="">All employees</option>
                  {(employeeReport?.employees ?? []).map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.code} · {employee.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              <span>From</span>
              <input
                type="date"
                value={from}
                onChange={(event) => {
                  setPreset("Custom");
                  setFrom(event.target.value);
                }}
              />
            </label>
            <label className="field">
              <span>To</span>
              <input
                type="date"
                value={to}
                onChange={(event) => {
                  setPreset("Custom");
                  setTo(event.target.value);
                }}
              />
            </label>
          </div>
          <div className="toolbar">
            <button
              className="button button-primary"
              aria-label="Export Excel workbook"
              disabled={busy !== null || from > to}
              onClick={() => void exportFile("xlsx")}
            >
              {busy === "xlsx" ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <FileSpreadsheet size={16} />
              )}
              Excel
            </button>
            <button
              className="button button-secondary"
              aria-label="Export CSV file"
              disabled={busy !== null || from > to}
              onClick={() => void exportFile("csv")}
            >
              {busy === "csv" ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <FileText size={16} />
              )}
              CSV
            </button>
          </div>
        </section>
        {kind === "attendance" &&
          (loadedReportKey !== reportKey ? (
            <Loading />
          ) : (
            <>
              {employeeReport?.canReadSalary && (
                <p className="sub-cell">
                  Payable shows live accrued salary from submitted attendance for
                  the selected dates. Missing or unsubmitted days are not treated
                  as absences.
                </p>
              )}
              <AttendanceTrendChart
                rows={employeeReport?.rows ?? []}
                from={from}
                to={to}
              />
              <EmployeeAttendanceTable
                rows={employeeReport?.rows ?? []}
                canReadSalary={employeeReport?.canReadSalary ?? false}
                title="Employee-wise attendance"
                description={`${formatDate(from)} to ${formatDate(to)} · Counts, status dates, and salary details when permitted.`}
              />
            </>
          ))}
      </div>
    );
  }

  function SettingsPanel({
    data,
    loading,
    busy,
    error,
    success,
    user,
    onSave,
  }: {
    data?: Partial<SalarySettings>;
    loading: boolean;
    busy: boolean;
    error: string;
    success: string;
    user: { role: UserRole };
    onSave: (settings: Record<string, unknown>) => void;
  }) {
    const settings = data ?? {};
    if (loading)
      return (
        <div className="content-area">
          <PageHead
            title="Payroll settings"
            description="Configure salary calculation policy."
          />
          <Loading />
        </div>
      );
    return (
      <div className="content-area">
        <PageHead
          title="Payroll settings"
          description="Configure salary divisor, paid absences, and business timezone. Week-offs always receive full-day pay."
        />
        <Notice error={error} success={success} />
        <form
          className="panel settings-panel"
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            onSave({
              timezone: String(values.get("timezone") ?? ""),
              defaultSalaryMethod: "FIXED_30_DAYS",
              workingDaysDivisor: 30,
              paidAbsences: Number(values.get("paidAbsences")),
              currency: "INR",
              advanceDeductionPolicy: "UNPAID_ONLY",
            });
          }}
        >
          <div className="form-grid">
            <Field
              label="Business timezone"
              name="timezone"
              defaultValue={settings.timezone ?? "Asia/Kolkata"}
            />
            <label className="field">
              <span>Salary divisor</span>
              <input value="30 days (fixed)" readOnly />
            </label>
            <Field
              label="Paid absences per month"
              name="paidAbsences"
              type="number"
              min="0"
              max="31"
              defaultValue={String(settings.paidAbsences ?? 0)}
            />
          </div>
          <p className="policy-note">
            Present and week-off days receive full daily pay; half-days receive
            half and unpaid absences deduct a full day. PF is configured per
            employee. Approved advances are deducted once when payroll is
            generated. No statutory tax rules are assumed.
          </p>
          <button
            className="button button-primary"
            type="submit"
            disabled={user.role !== "MAIN_ADMIN" || busy}
          >
            <Check size={16} /> {busy ? "Saving..." : "Save settings"}
          </button>
        </form>
        {user.role === "MAIN_ADMIN" && <AdminCredentialsPanel />}
      </div>
    );
  }

  function AdminCredentialsPanel() {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    useEffect(() => {
      let cancelled = false;
      void request<{ username: string }>("/api/settings/admin-credentials")
        .then((result) => {
          if (!cancelled) setUsername(result.username);
        })
        .catch((caught) => {
          if (!cancelled)
            setError(
              caught instanceof Error
                ? caught.message
                : "Unable to load admin credentials.",
            );
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, []);

    async function save(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      setError("");
      setSuccess("");
      if (password !== confirmPassword) {
        setError("The passwords do not match.");
        return;
      }
      setBusy(true);
      try {
        const result = await request<{ username: string }>(
          "/api/settings/admin-credentials",
          {
            method: "PUT",
            body: JSON.stringify({ username, password: password || undefined }),
          },
        );
        setUsername(result.username);
        setPassword("");
        setConfirmPassword("");
        setSuccess(
          password
            ? "Admin username and password updated in MongoDB."
            : "Admin username updated in MongoDB.",
        );
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to update admin credentials.",
        );
      } finally {
        setBusy(false);
      }
    }

    return (
      <section className="panel credential-panel">
        <div className="panel-heading">
          <div>
            <h2>Admin login credentials</h2>
            <p>Update the username and password used to sign in.</p>
          </div>
        </div>
        {error && <Notice error={error} success="" />}
        {success && <Notice error="" success={success} />}
        {loading ? (
          <Loading />
        ) : (
          <form className="form-grid" onSubmit={save}>
            <label className="field">
              <span>Admin username</span>
              <input
                name="admin-username"
                type="text"
                autoComplete="username"
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9._-]+"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>New password (optional; at least 10 characters)</span>
              <span className="password-input">
                <input
                  name="admin-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  minLength={10}
                  maxLength={72}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  className="password-toggle"
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </label>
            <label className="field">
              <span>Confirm new password</span>
              <input
                name="confirm-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                minLength={10}
                maxLength={72}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            <div className="credential-actions">
              <button
                className="button button-primary"
                type="submit"
                disabled={busy}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Check size={16} />
                )}
                Save admin credentials
              </button>
            </div>
          </form>
        )}
      </section>
    );
  }
