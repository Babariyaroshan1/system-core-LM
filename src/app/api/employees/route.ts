import { ObjectId, type Collection } from "mongodb";
import { NextResponse } from "next/server";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { employeeSchema } from "@/lib/validation/business";
import { paginationSchema } from "@/lib/validation/common";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import type { EmployeeDocument, OutletDocument } from "@/lib/models";
import { z } from "zod";

const employeeCreateSchema = employeeSchema.extend({
  employeeCode: z
    .string()
    .regex(/^[A-Z]{3}\d{4}$/, "Employee code must be a 3-letter outlet prefix followed by 4 digits."),
});

export async function GET(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    const url = new URL(request.url);
    const wantsNextCode = url.searchParams.get("nextCode") === "true";
    if (
      (wantsNextCode && !actor.permissions.includes("employees.create")) ||
      (!wantsNextCode &&
        !actor.permissions.includes("employees.read") &&
      !actor.permissions.includes("attendance.read") &&
        !actor.permissions.includes("advances.read"))
    )
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    if (wantsNextCode) {
      const outletId = url.searchParams.get("outletId");
      if (!outletId || !ObjectId.isValid(outletId))
        return NextResponse.json(
          { error: "Choose an outlet before generating an employee code." },
          { status: 400 },
        );
      assertOutletAccess(actor, outletId);
      const db = await getDb();
      const outlet = await db
        .collection<OutletDocument>("outlets")
        .findOne({ _id: new ObjectId(outletId), active: true });
      if (!outlet)
        return NextResponse.json(
          { error: "Outlet is inactive or unavailable." },
          { status: 400 },
        );
      const prefix = getEmployeeCodePrefix(outlet.name);
      if (prefix.length !== 3)
        return NextResponse.json(
          { error: "Outlet name must contain at least 3 letters to generate an employee code." },
          { status: 400 },
        );
      const employeeCode = await getNextEmployeeCode(
        db.collection<EmployeeDocument>("employees"),
        prefix,
      );
      if (!employeeCode)
        return NextResponse.json(
          { error: "No employee codes are available for this outlet." },
          { status: 409 },
        );
      return NextResponse.json({ employeeCode });
    }
    const page = paginationSchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
    });
    const requested = url.searchParams.get("outletId");
    if (requested && !ObjectId.isValid(requested))
      return NextResponse.json(
        { error: "Invalid outlet ID." },
        { status: 400 },
      );
    if (
      actor.role !== "MAIN_ADMIN" &&
      url.searchParams.get("active") &&
      url.searchParams.get("active") !== "true"
    )
      return NextResponse.json(
        { error: "Only MAIN_ADMIN can view inactive employees." },
        { status: 403 },
      );
    const db = await getDb();
    const allowed =
      actor.role === "MAIN_ADMIN"
        ? requested
          ? [new ObjectId(requested)]
          : undefined
        : actor.outletIds;
    if (requested) assertOutletAccess(actor, requested);
    const query = {
      ...(allowed ? { outletId: { $in: allowed } } : {}),
      ...(url.searchParams.get("active") === "all"
        ? {}
        : {
            active: url.searchParams.get("active") === "false" ? false : true,
          }),
      ...(page.q
        ? {
            $or: [
              { fullName: { $regex: escapeRegex(page.q), $options: "i" } },
              { employeeCode: { $regex: escapeRegex(page.q), $options: "i" } },
            ],
          }
        : {}),
    };
    const [employees, total] = await Promise.all([
      db
        .collection<EmployeeDocument>("employees")
        .find(query)
        .sort({ fullName: 1 })
        .skip((page.page - 1) * page.pageSize)
        .limit(page.pageSize)
        .toArray(),
      db.collection<EmployeeDocument>("employees").countDocuments(query),
    ]);
    const visibleEmployees = employees.map((employee) =>
      employeeResponse(
        employee,
        actor.role === "MAIN_ADMIN",
        actor.role !== "OUTLET_USER",
      ),
    );
    return NextResponse.json({
      employees: visibleEmployees,
      total,
      page: page.page,
      pageSize: page.pageSize,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (!actor.permissions.includes("employees.create"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const body = await readJson<unknown>(request);
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return NextResponse.json(
        { error: "Employee details must be sent as an object." },
        { status: 400 },
      );
    const payload = body as Record<string, unknown>;
    if (typeof payload.outletId !== "string" || !ObjectId.isValid(payload.outletId))
      return NextResponse.json(
        { error: "Choose a valid outlet before creating an employee." },
        { status: 400 },
      );
    const outletId = new ObjectId(payload.outletId);
    assertOutletAccess(actor, outletId);
    const db = await getDb();
    const outlet = await db.collection<OutletDocument>("outlets").findOne({
      _id: outletId,
      active: true,
    });
    if (!outlet)
      return NextResponse.json(
        { error: "Outlet is inactive or unavailable." },
        { status: 400 },
      );
    const prefix = getEmployeeCodePrefix(outlet.name);
    if (prefix.length !== 3)
      return NextResponse.json(
        { error: "Outlet name must contain at least 3 letters to generate an employee code." },
        { status: 400 },
      );
    const employeeCode =
      payload.autoGenerate === true || payload.autoGenerate === "true"
        ? await getNextEmployeeCode(
            db.collection<EmployeeDocument>("employees"),
            prefix,
          )
        : payload.employeeCode;
    if (!employeeCode)
      return NextResponse.json(
        { error: `No employee codes are available for ${prefix}.` },
        { status: 409 },
      );
    if (
      typeof employeeCode !== "string" ||
      !new RegExp(`^${prefix}\\d{4}$`).test(employeeCode.toUpperCase())
    )
      return NextResponse.json(
        {
          error: `Employee code must start with ${prefix} and end with 4 digits.`,
        },
        { status: 400 },
      );
    const input = employeeCreateSchema.parse({
      ...payload,
      employeeCode: employeeCode.toUpperCase(),
    });
    const now = new Date();
    const document: EmployeeDocument = {
      _id: new ObjectId(),
      ...input,
      employeeCodeNormalized: input.employeeCode.trim().toUpperCase(),
      outletId,
      active: true,
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
    };
    await db.collection<EmployeeDocument>("employees").insertOne(document);
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "EMPLOYEE_CREATED",
      entityType: "employee",
      entityId: document._id.toHexString(),
      outletId,
    });
    const employee = employeeResponse(
      document,
      actor.role === "MAIN_ADMIN",
      actor.role !== "OUTLET_USER",
    );
    return NextResponse.json({ employee }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

async function getNextEmployeeCode(
  employees: Collection<EmployeeDocument>,
  prefix: string,
) {
  const rows = await employees
    .find(
      { employeeCode: { $regex: new RegExp(`^${prefix}\\d{4}$`, "i") } },
      { projection: { employeeCode: 1 } },
    )
    .toArray();
  const maximum = rows.reduce((highest, employee) => {
    const value = Number(employee.employeeCode.slice(prefix.length));
    return Number.isInteger(value) ? Math.max(highest, value) : highest;
  }, 0);
  return maximum < 9999
    ? `${prefix}${String(maximum + 1).padStart(4, "0")}`
    : null;
}

function getEmployeeCodePrefix(outletName: string) {
  return outletName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/gi, "")
    .slice(0, 3)
    .toUpperCase();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function employeeResponse(
  employee: EmployeeDocument,
  canViewCompensation: boolean,
  canViewContact: boolean,
) {
  if (canViewCompensation && canViewContact)
    return {
      ...employee,
      employmentType: employee.employmentType ?? "FULL_TIME",
      salaryMethod: "FIXED_30_DAYS",
    };
  const visible = {
    ...employee,
    employmentType: employee.employmentType ?? "FULL_TIME",
    salaryMethod: "FIXED_30_DAYS",
  } as Record<string, unknown>;
  if (!canViewCompensation)
    for (const key of [
    "monthlyBaseSalary",
    "salaryMethod",
    "pfEnabled",
    "employeePfPercent",
    "employerPfPercent",
    "esiEnabled",
    "esiPercent",
    ])
      delete visible[key];
  if (!canViewContact) delete visible.mobile;
  return visible;
}
