import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import type { EmployeeDocument } from "@/lib/models";
import { employeeSchema } from "@/lib/validation/business";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (!actor.permissions.includes("employees.read"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const { id } = await context.params;
    if (!ObjectId.isValid(id))
      return NextResponse.json(
        { error: "Invalid employee ID." },
        { status: 400 },
      );
    const employee = await (
      await getDb()
    )
      .collection<EmployeeDocument>("employees")
      .findOne({ _id: new ObjectId(id) });
    if (!employee) throw new Error("NOT_FOUND");
    assertOutletAccess(actor, employee.outletId);
    const visible = {
      ...employee,
      employmentType: employee.employmentType ?? "FULL_TIME",
      salaryMethod: "FIXED_30_DAYS",
    } as Record<string, unknown>;
    if (actor.role !== "MAIN_ADMIN")
      for (const field of [
        "monthlyBaseSalary",
        "salaryMethod",
        "pfEnabled",
        "employeePfPercent",
        "employerPfPercent",
        "esiEnabled",
        "esiPercent",
      ])
        delete visible[field];
    if (actor.role === "OUTLET_USER") delete visible.mobile;
    return NextResponse.json({ employee: visible });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    const { id } = await context.params;
    if (!ObjectId.isValid(id))
      return NextResponse.json(
        { error: "Invalid employee ID." },
        { status: 400 },
      );
    const db = await getDb();
    const current = await db
      .collection<EmployeeDocument>("employees")
      .findOne({ _id: new ObjectId(id) });
    if (!current) throw new Error("NOT_FOUND");
    assertOutletAccess(actor, current.outletId);
    const raw = await readJson<Record<string, unknown>>(request);
    if (raw.active === false) {
      if (
        actor.role !== "MAIN_ADMIN" ||
        !actor.permissions.includes("employees.deactivate")
      )
        return NextResponse.json(
          { error: "Only MAIN_ADMIN can deactivate employees." },
          { status: 403 },
        );
      const settings = await db
        .collection<{ _id: string; timezone?: string }>("settings")
        .findOne({ _id: "payroll" });
      const deactivatedAt = new Intl.DateTimeFormat("en-CA", {
        timeZone:
          settings?.timezone || process.env.BUSINESS_TIMEZONE || "Asia/Kolkata",
      }).format(new Date());
      await db
        .collection<EmployeeDocument>("employees")
        .updateOne(
          { _id: current._id },
          { $set: { active: false, deactivatedAt, updatedAt: new Date() } },
        );
      await writeAudit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: "EMPLOYEE_DEACTIVATED",
        entityType: "employee",
        entityId: id,
        outletId: current.outletId,
      });
      return NextResponse.json({ ok: true });
    }
    if (!actor.permissions.includes("employees.update"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    if (
      actor.role !== "MAIN_ADMIN" &&
      [
        "monthlyBaseSalary",
        "salaryMethod",
        "pfEnabled",
        "employeePfPercent",
        "employerPfPercent",
        "esiEnabled",
        "esiPercent",
      ].some(
        (field) =>
          field in raw &&
          raw[field] !== current[field as keyof EmployeeDocument],
      )
    ) {
      return NextResponse.json(
        {
          error: "Only MAIN_ADMIN can change employee salary and PF settings.",
        },
        { status: 403 },
      );
    }
    const input = employeeSchema.parse({
      ...current,
      outletId: current.outletId.toHexString(),
      ...raw,
    });
    if (input.outletId !== current.outletId.toHexString()) {
      if (actor.role !== "MAIN_ADMIN")
        return NextResponse.json(
          { error: "Only MAIN_ADMIN can reassign employees." },
          { status: 403 },
        );
      assertOutletAccess(actor, input.outletId);
    }
    await db
      .collection<EmployeeDocument>("employees")
      .updateOne(
        { _id: current._id },
        {
          $set: {
            ...input,
            employeeCodeNormalized: input.employeeCode.toUpperCase(),
            outletId: new ObjectId(input.outletId),
            updatedAt: new Date(),
          },
        },
      );
    const changes = Object.fromEntries(
      Object.entries({
        employeeCode: input.employeeCode,
        fullName: input.fullName,
        designation: input.designation,
        employmentType: input.employmentType,
        mobile: input.mobile,
        outletId: input.outletId,
        monthlyBaseSalary: input.monthlyBaseSalary,
        salaryMethod: input.salaryMethod,
        pfEnabled: input.pfEnabled,
        employeePfPercent: input.employeePfPercent,
        employerPfPercent: input.employerPfPercent,
        esiEnabled: input.esiEnabled,
        esiPercent: input.esiPercent,
      })
        .filter(
          ([key, after]) =>
            current[key as keyof EmployeeDocument]?.toString() !==
            after?.toString(),
        )
        .map(([key, after]) => [
          key,
          {
            before: String(current[key as keyof EmployeeDocument] ?? ""),
            after: String(after ?? ""),
          },
        ]),
    );
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "EMPLOYEE_UPDATED",
      entityType: "employee",
      entityId: id,
      outletId: current.outletId,
      changes,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
