import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getDb } from "@/lib/mongodb";
import type { EmployeeDocument, OutletDocument } from "@/lib/models";
import { getActor } from "@/lib/permissions";
import { employeeSchema } from "@/lib/validation/business";

const maxFileBytes = 5 * 1024 * 1024;
const maxRows = 500;
const maxColumns = 40;
const fileSchema = z.object({
  file: z.instanceof(File),
});
const mappingSchema = z.object({
  employeeCode: z.number().int().min(0),
  fullName: z.number().int().min(0),
  dateOfJoining: z.number().int().min(0),
  designation: z.number().int().min(0),
  employmentType: z.number().int().min(0).optional(),
  mobile: z.number().int().min(0),
  monthlyBaseSalary: z.number().int().min(0).optional(),
  pfEnabled: z.number().int().min(0).optional(),
  employeePfPercent: z.number().int().min(0).optional(),
  employerPfPercent: z.number().int().min(0).optional(),
  esiEnabled: z.number().int().min(0).optional(),
  esiPercent: z.number().int().min(0).optional(),
  notes: z.number().int().min(0).optional(),
});
const manualSalarySchema = z.record(
  z.string().regex(/^\d+$/),
  z.number().finite().nonnegative(),
);
const importBodySchema = z.object({
  outletId: z.string().refine((value) => ObjectId.isValid(value), "Select a valid outlet."),
  salaryMode: z.enum(["sheet", "payroll"]),
});

type CellValue = string | number | boolean | null;
type ParsedImport = {
  columns: Array<{ index: number; label: string }>;
  rows: Array<{ values: CellValue[]; formulaColumns: number[] }>;
};

export async function POST(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (actor.role !== "MAIN_ADMIN")
      return NextResponse.json(
        { error: "Only MAIN_ADMIN can import employee sheets." },
        { status: 403 },
      );
    assertSameOrigin(request);
    const form = await request.formData();
    const { file } = fileSchema.parse({ file: form.get("file") });
    const parsed = await parseImportFile(file);
    return NextResponse.json(parsed);
  } catch (error) {
    if (error instanceof ImportRequestError)
      return NextResponse.json({ error: error.message }, { status: 400 });
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (actor.role !== "MAIN_ADMIN")
      return NextResponse.json(
        { error: "Only MAIN_ADMIN can import employee sheets." },
        { status: 403 },
      );
    assertSameOrigin(request);
    const form = await request.formData();
    const { file } = fileSchema.parse({ file: form.get("file") });
    const { outletId, salaryMode } = importBodySchema.parse({
      outletId: form.get("outletId"),
      salaryMode: form.get("salaryMode"),
    });
    const mapping = mappingSchema.parse(JSON.parse(String(form.get("mapping"))));
    const manualSalaries = manualSalarySchema.parse(
      JSON.parse(String(form.get("manualSalaries") || "{}")),
    );
    const parsed = await parseImportFile(file);
    if (!parsed.rows.length)
      return NextResponse.json(
        { error: "The uploaded sheet contains no employee rows." },
        { status: 400 },
      );

    const targetOutletId = new ObjectId(outletId);
    const db = await getDb();
    const outlet = await db.collection<OutletDocument>("outlets").findOne({
      _id: targetOutletId,
      active: true,
    });
    if (!outlet)
      return NextResponse.json(
        { error: "Select an active outlet for this import." },
        { status: 400 },
      );

    const employees: EmployeeDocument[] = [];
    const seenCodes = new Set<string>();
    const rowErrors: string[] = [];
    const now = new Date();
    for (const [rowIndex, row] of parsed.rows.entries()) {
      const rowNumber = rowIndex + 2;
      const mapped = (field: keyof z.infer<typeof mappingSchema>) => {
        const column = mapping[field];
        return column === undefined ? null : row.values[column] ?? null;
      };
      const employeeCode = stringValue(mapped("employeeCode"));
      const normalizedCode = employeeCode.trim().toUpperCase();
      if (!normalizedCode) {
        rowErrors.push(`Row ${rowNumber}: Employee code is required.`);
        continue;
      }
      if (seenCodes.has(normalizedCode)) {
        rowErrors.push(`Row ${rowNumber}: Employee code ${employeeCode} appears more than once.`);
        continue;
      }
      seenCodes.add(normalizedCode);

      const salaryColumn = mapping.monthlyBaseSalary;
      const salaryIsFormula =
        salaryColumn !== undefined && row.formulaColumns.includes(salaryColumn);
      const salaryValue =
        salaryMode === "payroll" && salaryIsFormula
          ? null
          : mapped("monthlyBaseSalary");
      const manualSalary = manualSalaries[String(rowIndex)];
      const monthlyBaseSalary =
        (salaryValue === null || salaryValue === ""
          ? undefined
          : numericValue(salaryValue)) ?? manualSalary;
      const pfEnabled = mapped("pfEnabled");
      const normalizedPfEnabled =
        pfEnabled === null || pfEnabled === ""
          ? false
          : booleanValue(pfEnabled);
      if (normalizedPfEnabled === undefined) {
        rowErrors.push(`Row ${rowNumber}: PF enabled must be Yes/No, true/false, or 1/0.`);
        continue;
      }
      const employeePf = mapped("employeePfPercent");
      const employerPf = mapped("employerPfPercent");
      const esiEnabled = mapped("esiEnabled");
      const normalizedEsiEnabled =
        esiEnabled === null || esiEnabled === ""
          ? false
          : booleanValue(esiEnabled);
      if (normalizedEsiEnabled === undefined) {
        rowErrors.push(`Row ${rowNumber}: ESI enabled must be Yes/No, true/false, or 1/0.`);
        continue;
      }
      const esiPercent = mapped("esiPercent");
      const rawEmploymentType = stringValue(mapped("employmentType"))
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
      const employmentType = rawEmploymentType
        ? rawEmploymentType === "PART_TIME"
          ? "PART_TIME"
          : rawEmploymentType === "FULL_TIME"
            ? "FULL_TIME"
            : null
        : "FULL_TIME";
      if (!employmentType) {
        rowErrors.push(
          `Row ${rowNumber}: Employment type must be Full-time or Part-time.`,
        );
        continue;
      }
      const input = employeeSchema.safeParse({
        employeeCode,
        fullName: stringValue(mapped("fullName")),
        dateOfJoining: dateValue(mapped("dateOfJoining")),
        designation: stringValue(mapped("designation")),
        employmentType,
        mobile: stringValue(mapped("mobile")),
        outletId,
        monthlyBaseSalary,
        salaryMethod: "FIXED_30_DAYS",
        pfEnabled: normalizedPfEnabled,
        employeePfPercent:
          employeePf === null || employeePf === ""
            ? 0
            : numericValue(employeePf),
        employerPfPercent:
          employerPf === null || employerPf === ""
            ? 0
            : numericValue(employerPf),
        esiEnabled: normalizedEsiEnabled,
        esiPercent:
          esiPercent === null || esiPercent === ""
            ? 0.75
            : numericValue(esiPercent),
        notes: stringValue(mapped("notes")),
      });
      if (!input.success) {
        rowErrors.push(
          `Row ${rowNumber}: ${input.error.issues
            .map((issue) => issue.message)
            .join(" ")}`,
        );
        continue;
      }
      employees.push({
        _id: new ObjectId(),
        ...input.data,
        employeeCodeNormalized: normalizedCode,
        outletId: targetOutletId,
        active: true,
        createdBy: actor.id,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (rowErrors.length)
      return NextResponse.json(
        {
          error: "Please fix the spreadsheet rows before importing.",
          details: rowErrors.slice(0, 20).map((message) => ({
            path: "",
            message,
          })),
          moreErrors: Math.max(0, rowErrors.length - 20),
        },
        { status: 400 },
      );

    const employeeCollection = db.collection<EmployeeDocument>("employees");
    const normalizedCodes = employees.map(
      (employee) => employee.employeeCodeNormalized,
    );
    const existingEmployees = await employeeCollection
      .find({ employeeCodeNormalized: { $in: normalizedCodes } })
      .toArray();
    const existingByCode = new Map(
      existingEmployees.map((employee) => [
        employee.employeeCodeNormalized,
        employee,
      ]),
    );
    const wrongOutlet = employees.find((employee) => {
      const existing = existingByCode.get(employee.employeeCodeNormalized);
      return existing && !existing.outletId.equals(targetOutletId);
    });
    if (wrongOutlet)
      return NextResponse.json(
        {
          error: `Employee code ${wrongOutlet.employeeCode} already belongs to another outlet. Reassign it manually before importing.`,
        },
        { status: 409 },
      );

    let updatedCount = 0;
    const operations = employees.map((employee) => {
      const existing = existingByCode.get(employee.employeeCodeNormalized);
      if (existing) {
        updatedCount += 1;
        const fields: Partial<EmployeeDocument> = { ...employee };
        delete fields._id;
        delete fields.createdBy;
        delete fields.createdAt;
        delete fields.active;
        delete fields.deactivatedAt;
        return {
          updateOne: {
            filter: { _id: existing._id, outletId: targetOutletId },
            update: { $set: fields },
          },
        };
      }
      return { insertOne: { document: employee } };
    });
    await employeeCollection.bulkWrite(operations, { ordered: true });
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "EMPLOYEE_SHEET_IMPORTED",
      entityType: "outlet",
      entityId: targetOutletId.toHexString(),
      outletId: targetOutletId,
      reason: `Imported ${employees.length} rows using ${salaryMode === "sheet" ? "saved sheet values" : "app payroll rules"}.`,
      changes: {
        added: { before: 0, after: employees.length - updatedCount },
        updated: { before: 0, after: updatedCount },
      },
    });
    return NextResponse.json({
      imported: employees.length,
      added: employees.length - updatedCount,
      updated: updatedCount,
      salaryMode,
    });
  } catch (error) {
    if (error instanceof ImportRequestError)
      return NextResponse.json({ error: error.message }, { status: 400 });
    return apiError(error);
  }
}

async function parseImportFile(file: File): Promise<ParsedImport> {
  if (file.size > maxFileBytes)
    throw new ImportRequestError("File is too large. Maximum supported size is 5 MB.");
  const extension = file.name.toLowerCase().split(".").at(-1);
  if (extension !== "csv" && extension !== "xlsx")
    throw new ImportRequestError("Upload a CSV or Excel .xlsx file. PDF and .xls are not supported.");
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  try {
    if (extension === "xlsx") await workbook.xlsx.load(buffer);
    else
      await workbook.csv.read(
        Readable.from([Buffer.from(buffer).toString("utf8")]),
      );
  } catch {
    throw new ImportRequestError("The selected file could not be read as a spreadsheet.");
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet)
    throw new ImportRequestError("The uploaded file does not contain a readable sheet.");
  const headerRow = worksheet.getRow(1);
  const columnCount = headerRow.cellCount;
  const columns = Array.from({ length: columnCount }, (_, index) => {
    const value = cellResult(headerRow.getCell(index + 1).value).value;
    return {
      index,
      label: stringValue(value).trim() || `Column ${index + 1}`,
    };
  });
  if (!columns.length)
    throw new ImportRequestError("The first row must contain column headings.");
  if (columns.length > maxColumns)
    throw new ImportRequestError(
      `The sheet has more than ${maxColumns} columns. Remove unrelated columns and try again.`,
    );
  const rows: ParsedImport["rows"] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const values: CellValue[] = [];
    const formulaColumns: number[] = [];
    for (const column of columns) {
      const cell = cellResult(row.getCell(column.index + 1).value);
      values.push(cell.value);
      if (cell.formula) formulaColumns.push(column.index);
    }
    if (values.every((value) => value === null || value === "")) continue;
    rows.push({ values, formulaColumns });
    if (rows.length > maxRows)
      throw new ImportRequestError(`The sheet exceeds the ${maxRows}-employee import limit.`);
  }
  return { columns, rows };
}

function cellResult(value: ExcelJS.CellValue): {
  value: CellValue;
  formula: boolean;
} {
  if (value === null || value === undefined) return { value: null, formula: false };
  if (value instanceof Date)
    return { value: value.toISOString().slice(0, 10), formula: false };
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return { value, formula: false };
  if (
    typeof value === "object" &&
    ("formula" in value || "sharedFormula" in value)
  ) {
    const result = value.result;
    if (result instanceof Date)
      return { value: result.toISOString().slice(0, 10), formula: true };
    if (
      typeof result === "string" ||
      typeof result === "number" ||
      typeof result === "boolean"
    )
      return { value: result, formula: true };
    return { value: null, formula: true };
  }
  if (typeof value === "object" && "text" in value)
    return { value: value.text, formula: false };
  if (typeof value === "object" && "richText" in value)
    return {
      value: value.richText.map((part) => part.text).join(""),
      formula: false,
    };
  return { value: String(value), formula: false };
}

function stringValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const cleaned = String(value).replace(/[₹,\s]/g, "");
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  const normalized = stringValue(value).toLowerCase();
  if (["yes", "true", "1", "on", "y"].includes(normalized)) return true;
  if (["no", "false", "0", "off", "n"].includes(normalized)) return false;
  return typeof value === "boolean" ? value : undefined;
}

function dateValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
    return Number.isNaN(date.valueOf()) ? "" : date.toISOString().slice(0, 10);
  }
  const input = stringValue(value);
  const dmy = input.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy)
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return input.slice(0, 10);
}

class ImportRequestError extends Error {}
