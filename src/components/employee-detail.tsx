"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Check, LoaderCircle } from "lucide-react";
import type { EmployeeView } from "@/lib/ui-types";
import { AutoDismissNotice } from "@/components/auto-dismiss-notice";

export function EmployeeDetail({
  id,
  canEdit,
  mainAdmin,
}: {
  id: string;
  canEdit: boolean;
  mainAdmin: boolean;
}) {
  const [employee, setEmployee] = useState<EmployeeView | null>(null);
  const [outlets, setOutlets] = useState<
    Array<{ _id: string; code: string; name: string }>
  >([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([
      fetch(`/api/employees/${id}`).then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? "Unable to load employee.");
        setEmployee(body.employee);
      }),
      fetch("/api/outlets").then(async (response) => {
        if (response.ok) setOutlets((await response.json()).outlets);
      }),
    ]).catch((caught) =>
      setError(
        caught instanceof Error ? caught.message : "Unable to load employee.",
      ),
    );
  }, [id]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employee) return;
    const values = new FormData(event.currentTarget);
    const input: Record<string, unknown> = {
      employeeCode: values.get("employeeCode"),
      fullName: values.get("fullName"),
      dateOfJoining: values.get("dateOfJoining"),
      designation: values.get("designation"),
      employmentType: values.get("employmentType"),
      mobile: values.get("mobile"),
      outletId: values.get("outletId"),
    };
    if (mainAdmin)
      Object.assign(input, {
        monthlyBaseSalary: Number(values.get("monthlyBaseSalary")),
        salaryMethod: values.get("salaryMethod"),
        pfEnabled: values.get("pfEnabled") === "true",
        employeePfPercent: Number(values.get("employeePfPercent")),
        employerPfPercent: Number(values.get("employerPfPercent")),
        esiEnabled: values.get("esiEnabled") === "true",
        esiPercent: Number(values.get("esiPercent")),
        notes: values.get("notes"),
      });
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/employees/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Unable to save employee.");
      setSuccess("Employee details saved.");
      setEmployee((current) =>
        current
          ? ({
              ...current,
              ...input,
              monthlyBaseSalary: mainAdmin
                ? Number(input.monthlyBaseSalary)
                : current.monthlyBaseSalary,
            } as EmployeeView)
          : current,
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to save employee.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!employee)
    return (
      <main className="content-area">
        <Link className="back-link" href="/employees">
          <ArrowLeft size={16} /> Employees
        </Link>
        {error ? (
          <AutoDismissNotice
            key={`error:${error}`}
            message={error}
            variant="error"
          />
        ) : (
          <div className="loading-state">
            <LoaderCircle className="spin" size={20} />
            Loading employee
          </div>
        )}
      </main>
    );

  return (
    <main className="content-area employee-detail-page">
      <Link className="back-link" href="/employees">
        <ArrowLeft size={16} /> Employees
      </Link>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            EMPLOYEE RECORD / {employee.employeeCode}
          </div>
          <h1>{employee.fullName}</h1>
          <p>
            {employee.designation} · {employee.active ? "Active" : "Inactive"}
          </p>
        </div>
        <span
          className={`badge ${employee.active ? "badge-green" : "badge-muted"}`}
        >
          {employee.active ? "Active employee" : "Historical record"}
        </span>
      </div>
      {error && (
        <AutoDismissNotice
          key={`error:${error}`}
          message={error}
          variant="error"
        />
      )}
      {success && (
        <AutoDismissNotice
          key={`success:${success}`}
          message={success}
          variant="success"
        />
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Employee details</h2>
            <p>Edits are scoped to your assigned outlet.</p>
          </div>
        </div>
        <form className="form-grid detail-form" onSubmit={save}>
          <label className="field">
            <span>Employee code</span>
            <input
              name="employeeCode"
              defaultValue={employee.employeeCode}
              required
              disabled={!canEdit}
            />
          </label>
          <label className="field">
            <span>Full name</span>
            <input
              name="fullName"
              defaultValue={employee.fullName}
              required
              disabled={!canEdit}
            />
          </label>
          <label className="field">
            <span>Date of joining</span>
            <input
              name="dateOfJoining"
              type="date"
              defaultValue={employee.dateOfJoining}
              required
              disabled={!canEdit}
            />
          </label>
          <label className="field">
            <span>Designation</span>
            <input
              name="designation"
              defaultValue={employee.designation}
              required
              disabled={!canEdit}
            />
          </label>
          <label className="field">
            <span>Employment type</span>
            <select
              name="employmentType"
              defaultValue={employee.employmentType ?? "FULL_TIME"}
              disabled={!canEdit}
            >
              <option value="FULL_TIME">Full-time</option>
              <option value="PART_TIME">Part-time</option>
            </select>
          </label>
          <label className="field">
            <span>Mobile</span>
            <input
              name="mobile"
              defaultValue={employee.mobile}
              required
              disabled={!canEdit}
            />
          </label>
          <label className="field">
            <span>Outlet</span>
            <select
              name="outletId"
              defaultValue={employee.outletId}
              disabled={!canEdit || !mainAdmin}
            >
              {outlets.map((outlet) => (
                <option key={outlet._id} value={outlet._id}>
                  {outlet.code} · {outlet.name}
                </option>
              ))}
            </select>
          </label>
          {mainAdmin && (
            <>
              <label className="field">
                <span>Monthly base salary (INR)</span>
                <input
                  name="monthlyBaseSalary"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={employee.monthlyBaseSalary}
                  required
                />
              </label>
              <input
                type="hidden"
                name="salaryMethod"
                value="FIXED_30_DAYS"
              />
              <div className="field">
                <span>Salary calculation</span>
                <p className="policy-note">
                  Fixed 30-day basis: monthly base salary ÷ 30.
                </p>
              </div>
              <label className="field">
                <span>PF enabled</span>
                <select
                  name="pfEnabled"
                  defaultValue={String(employee.pfEnabled)}
                >
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </label>
              <label className="field">
                <span>Employee PF %</span>
                <input
                  name="employeePfPercent"
                  type="number"
                  min="0"
                  max="100"
                  defaultValue={employee.employeePfPercent}
                  required
                />
              </label>
              <label className="field">
                <span>Employer PF %</span>
                <input
                  name="employerPfPercent"
                  type="number"
                  min="0"
                  max="100"
                  defaultValue={employee.employerPfPercent}
                  required
                />
              </label>
              <label className="field">
                <span>ESI enabled</span>
                <select
                  name="esiEnabled"
                  defaultValue={String(employee.esiEnabled ?? false)}
                >
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </label>
              <label className="field">
                <span>Employee ESI %</span>
                <input
                  name="esiPercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue={employee.esiPercent ?? 0.75}
                  required
                />
              </label>
              <label className="field">
                <span>Notes</span>
                <input name="notes" defaultValue={employee.notes ?? ""} />
              </label>
            </>
          )}
          {canEdit && (
            <div className="form-actions">
              <button className="button button-primary" disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Check size={16} />
                )}{" "}
                Save employee
              </button>
            </div>
          )}
        </form>
      </section>
      {mainAdmin && employee.monthlyBaseSalary !== undefined && (
        <section className="panel detail-salary">
          <span>Monthly base salary</span>
          <strong>
            {new Intl.NumberFormat("en-IN", {
              style: "currency",
              currency: "INR",
            }).format(employee.monthlyBaseSalary)}
          </strong>
          <span>
            {employee.pfEnabled ? "PF enabled" : "PF not enabled"}
            {" · "}
            {employee.esiEnabled
              ? `ESI enabled · ${employee.esiPercent ?? 0.75}%`
              : "ESI not enabled"}
          </span>
        </section>
      )}
    </main>
  );
}
