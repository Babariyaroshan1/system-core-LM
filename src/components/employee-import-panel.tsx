"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Check, FileSpreadsheet, LoaderCircle, Upload } from "lucide-react";
import type { DashboardOutlet } from "@/lib/ui-types";
import { AutoDismissNotice } from "@/components/auto-dismiss-notice";

type ImportField =
  | "employeeCode"
  | "fullName"
  | "dateOfJoining"
  | "designation"
  | "employmentType"
  | "mobile"
  | "monthlyBaseSalary"
  | "pfEnabled"
  | "employeePfPercent"
  | "employerPfPercent"
  | "esiEnabled"
  | "esiPercent"
  | "notes";

type Preview = {
  columns: Array<{ index: number; label: string }>;
  rows: Array<{
    values: Array<string | number | boolean | null>;
    formulaColumns: number[];
  }>;
};

const fields: Array<{
  key: ImportField;
  label: string;
  required: boolean;
  aliases: string[];
}> = [
  {
    key: "employeeCode",
    label: "Employee code",
    required: true,
    aliases: ["employee code", "employee id", "staff code", "code"],
  },
  {
    key: "fullName",
    label: "Full name",
    required: true,
    aliases: ["full name", "employee name", "staff name", "name"],
  },
  {
    key: "dateOfJoining",
    label: "Date of joining",
    required: true,
    aliases: ["date of joining", "joining date", "doj"],
  },
  {
    key: "designation",
    label: "Designation",
    required: true,
    aliases: ["designation", "job title", "position"],
  },
  {
    key: "employmentType",
    label: "Employment type",
    required: false,
    aliases: ["employment type", "employee type", "full-time part-time", "work type"],
  },
  {
    key: "mobile",
    label: "Mobile",
    required: true,
    aliases: ["mobile", "mobile number", "phone", "contact"],
  },
  {
    key: "monthlyBaseSalary",
    label: "Monthly base salary",
    required: false,
    aliases: ["monthly base salary", "base salary", "monthly salary", "salary"],
  },
  {
    key: "pfEnabled",
    label: "PF enabled",
    required: false,
    aliases: ["pf enabled", "pf"],
  },
  {
    key: "employeePfPercent",
    label: "Employee PF %",
    required: false,
    aliases: ["employee pf", "employee pf percent", "pf percent"],
  },
  {
    key: "employerPfPercent",
    label: "Employer PF %",
    required: false,
    aliases: ["employer pf", "employer pf percent"],
  },
  {
    key: "esiEnabled",
    label: "ESI enabled",
    required: false,
    aliases: ["esi enabled", "employee state insurance enabled", "esi"],
  },
  {
    key: "esiPercent",
    label: "Employee ESI %",
    required: false,
    aliases: ["employee esi", "employee esi percent", "esi percent"],
  },
  {
    key: "notes",
    label: "Notes",
    required: false,
    aliases: ["notes", "remarks"],
  },
];

const requiredFields = fields.filter((field) => field.required);

async function sendFile<T>(
  url: string,
  method: "POST" | "PUT",
  file: File,
  fieldsToSend?: Record<string, string>,
) {
  const body = new FormData();
  body.set("file", file);
  for (const [key, value] of Object.entries(fieldsToSend ?? {}))
    body.set(key, value);
  const response = await fetch(url, { method, body });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = Array.isArray(payload.details)
      ? payload.details
          .map((detail: { message?: string }) => detail.message)
          .filter(Boolean)
          .join(" ")
      : "";
    throw new Error(
      details
        ? `${payload.error ?? "Request failed."} ${details}`
        : (payload.error ?? "Request failed."),
    );
  }
  return payload as T;
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function detectMapping(preview: Preview) {
  return Object.fromEntries(
    fields.map((field) => {
      const header = preview.columns.find((column) =>
        field.aliases.includes(normalizeHeader(column.label)),
      );
      return [field.key, header ? String(header.index) : ""];
    }),
  ) as Record<ImportField, string>;
}

function numericValue(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(String(value).replace(/[₹,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function EmployeeImportPanel({
  outlets,
  selectedOutlet,
  onImported,
}: {
  outlets: DashboardOutlet[];
  selectedOutlet: string;
  onImported: () => Promise<void>;
}) {
  const [file, setFile] = useState<File>();
  const [fileInputKey, setFileInputKey] = useState(0);
  const [preview, setPreview] = useState<Preview>();
  const [mapping, setMapping] = useState<Record<ImportField, string>>();
  const [outletId, setOutletId] = useState(selectedOutlet);
  const [salaryMode, setSalaryMode] = useState<"" | "sheet" | "payroll">("");
  const [manualSalaries, setManualSalaries] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const missingSalaryRows = useMemo(() => {
    if (!preview || !mapping) return [];
    const salaryColumn = mapping.monthlyBaseSalary;
    return preview.rows.flatMap((row, rowIndex) => {
      if (
        salaryMode === "payroll" &&
        salaryColumn !== "" &&
        row.formulaColumns.includes(Number(salaryColumn))
      )
        return [rowIndex];
      const value =
        salaryColumn === ""
          ? undefined
          : numericValue(row.values[Number(salaryColumn)]);
      return value === undefined ? [rowIndex] : [];
    });
  }, [mapping, preview, salaryMode]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Choose a CSV or Excel .xlsx file first.");
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await sendFile<Preview>(
        "/api/employees/import",
        "POST",
        file,
      );
      setPreview(result);
      setMapping(detectMapping(result));
      setSalaryMode("");
      setManualSalaries({});
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to read this sheet.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function importSheet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !preview || !mapping || !salaryMode) return;
    if (
      requiredFields.some(
        (field) => mapping[field.key] === "",
      )
    ) {
      setError("Map every required employee column before importing.");
      return;
    }
    if (
      missingSalaryRows.some(
        (rowIndex) => manualSalaries[String(rowIndex)] === undefined,
      )
    ) {
      setError("Enter a salary for each row with a blank or missing formula result.");
      return;
    }
    const targetOutletId = outletId || selectedOutlet;
    if (!targetOutletId) {
      setError("Choose an active outlet for this import.");
      return;
    }
    if (
      !window.confirm(
        `Import ${preview.rows.length} employee rows into ${outlets.find((item) => item._id === targetOutletId)?.name ?? "the selected outlet"}? Matching employee codes will update existing workers.`,
      )
    )
      return;

    const mappedColumns = Object.fromEntries(
      Object.entries(mapping)
        .filter(([, value]) => value !== "")
        .map(([key, value]) => [key, Number(value)]),
    );
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await sendFile<{
        imported: number;
        added: number;
        updated: number;
      }>("/api/employees/import", "PUT", file, {
        outletId: targetOutletId,
        salaryMode,
        mapping: JSON.stringify(mappedColumns),
        manualSalaries: JSON.stringify(
          Object.fromEntries(
            Object.entries(manualSalaries).map(([key, value]) => [
              key,
              Number(value),
            ]),
          ),
        ),
      });
      setSuccess(
        `Imported ${result.imported} workers: ${result.added} added, ${result.updated} updated.`,
      );
      setPreview(undefined);
      setMapping(undefined);
      setFile(undefined);
      setFileInputKey((current) => current + 1);
      setSalaryMode("");
      setManualSalaries({});
      await onImported();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to import this sheet.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="panel form-panel employee-import-panel">
      <summary>
        <FileSpreadsheet size={17} /> Import employee sheet
      </summary>
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
      <form className="form-grid" onSubmit={upload}>
        <label className="field">
          <span>Employee spreadsheet (CSV or .xlsx, up to 5 MB)</span>
          <input
            key={fileInputKey}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => {
              setFile(event.target.files?.[0]);
              setPreview(undefined);
              setMapping(undefined);
              setError("");
              setSuccess("");
            }}
            required
          />
        </label>
        <div className="form-actions">
          <button className="button button-secondary" disabled={busy || !file}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Upload size={16} />
            )}
            Preview sheet
          </button>
        </div>
      </form>
      {preview && mapping && (
        <form className="form-grid import-mapping" onSubmit={importSheet}>
          <label className="field">
            <span>Import all workers into outlet</span>
            <select
              value={outletId || selectedOutlet}
              onChange={(event) => setOutletId(event.target.value)}
              required
            >
              <option value="">Choose outlet</option>
              {outlets
                .filter((outlet) => outlet.active)
                .map((outlet) => (
                  <option key={outlet._id} value={outlet._id}>
                    {outlet.code} · {outlet.name}
                  </option>
                ))}
            </select>
          </label>
          {fields.map((field) => (
            <label className="field" key={field.key}>
              <span>
                {field.label}
                {field.required ? " *" : " (optional)"}
              </span>
              <select
                value={mapping[field.key]}
                onChange={(event) =>
                  setMapping((current) =>
                    current
                      ? { ...current, [field.key]: event.target.value }
                      : current,
                  )
                }
                required={field.required}
              >
                <option value="">
                  {field.key === "monthlyBaseSalary"
                    ? "No salary column (enter each row below)"
                    : "Not mapped"}
                </option>
                {preview.columns.map((column) => (
                  <option key={column.index} value={column.index}>
                    {column.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <fieldset className="salary-mode-field">
            <legend>After uploading, how should salary be handled?</legend>
            <label>
              <input
                type="radio"
                name="salary-mode"
                value="sheet"
                checked={salaryMode === "sheet"}
                onChange={() => setSalaryMode("sheet")}
              />
              Use saved salary/formula results from the sheet
            </label>
            <label>
              <input
                type="radio"
                name="salary-mode"
                value="payroll"
                checked={salaryMode === "payroll"}
                onChange={() => setSalaryMode("payroll")}
              />
              Use this as monthly base salary; calculate payroll with app rules
            </label>
            <p>
              {salaryMode === "sheet"
                ? "Spreadsheet formulas are not executed during upload. Excel formula cells use their last saved result as the monthly base salary. Enter missing results manually."
                : "Formula cells are not used in this mode. Enter the monthly base salary manually for those rows; the app will calculate payroll from attendance and its existing rules."}
            </p>
          </fieldset>
          {!!missingSalaryRows.length && (
            <div className="import-manual-salaries">
              <strong>Enter missing monthly salaries</strong>
              {missingSalaryRows.map((rowIndex) => (
                <label className="field" key={rowIndex}>
                  <span>
                    Row {rowIndex + 2} ·{" "}
                    {mapping.employeeCode === ""
                      ? "Employee"
                      : String(
                          preview.rows[rowIndex].values[
                            Number(mapping.employeeCode)
                          ] ?? "Employee",
                        )}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={manualSalaries[String(rowIndex)] ?? ""}
                    onChange={(event) =>
                      setManualSalaries((current) => ({
                        ...current,
                        [String(rowIndex)]: event.target.value,
                      }))
                    }
                    required
                  />
                </label>
              ))}
            </div>
          )}
          <div className="import-preview-table">
            <strong>
              Preview · {preview.rows.length} employee row(s)
            </strong>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {preview.columns.map((column) => (
                      <th key={column.index}>{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 8).map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.values.map((value, columnIndex) => (
                        <td key={columnIndex}>
                          {value === null ? (
                            row.formulaColumns.includes(columnIndex) ? (
                              "Formula result missing"
                            ) : (
                              "—"
                            )
                          ) : (
                            String(value)
                          )}
                          {row.formulaColumns.includes(columnIndex) && value !== null
                            ? " · formula result"
                            : ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.rows.length > 8 && (
              <p>Showing the first 8 rows. All {preview.rows.length} rows will be validated before import.</p>
            )}
          </div>
          <div className="form-actions">
            <button
              className="button button-primary"
              disabled={busy || !outletId || !salaryMode}
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Check size={16} />
              )}
              Validate and import {preview.rows.length} rows
            </button>
          </div>
        </form>
      )}
    </details>
  );
}
