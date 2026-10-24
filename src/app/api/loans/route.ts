import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { apiError, readJson } from "@/lib/http";
import { getDb } from "@/lib/mongodb";
import type { EmployeeDocument, LoanDocument, OutletDocument } from "@/lib/models";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { loanSchema } from "@/lib/validation/business";

export async function GET(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (actor.role !== "MAIN_ADMIN")
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const requestedOutlet = new URL(request.url).searchParams.get("outletId");
    if (requestedOutlet && !ObjectId.isValid(requestedOutlet))
      return NextResponse.json({ error: "Invalid outlet ID." }, { status: 400 });
    const db = await getDb();
    const [loans, employees, outlets] = await Promise.all([
      db.collection<LoanDocument>("loans")
        .find(requestedOutlet ? { outletId: new ObjectId(requestedOutlet) } : {})
        .sort({ createdAt: -1 })
        .toArray(),
      db.collection<EmployeeDocument>("employees")
        .find(requestedOutlet ? { outletId: new ObjectId(requestedOutlet) } : {})
        .project({ employeeCode: 1, fullName: 1, outletId: 1 })
        .toArray(),
      db.collection<OutletDocument>("outlets")
        .find({})
        .project({ code: 1, name: 1 })
        .toArray(),
    ]);
    const employeesById = new Map(
      employees.map((employee) => [employee._id.toHexString(), employee]),
    );
    const outletsById = new Map(
      outlets.map((outlet) => [outlet._id.toHexString(), outlet]),
    );
    return NextResponse.json({
      loans: loans.map((loan) => ({
        ...loan,
        _id: loan._id.toHexString(),
        employeeId: loan.employeeId.toHexString(),
        outletId: loan.outletId.toHexString(),
        employeeName:
          employeesById.get(loan.employeeId.toHexString())?.fullName ??
          "Unknown employee",
        employeeCode:
          employeesById.get(loan.employeeId.toHexString())?.employeeCode ?? "",
        outletCode: outletsById.get(loan.outletId.toHexString())?.code ?? "",
      })),
      employees: employees.map((employee) => ({
        _id: employee._id.toHexString(),
        employeeCode: employee.employeeCode,
        fullName: employee.fullName,
        outletId: employee.outletId.toHexString(),
      })),
      outlets: outlets.map((outlet) => ({
        _id: outlet._id.toHexString(),
        code: outlet.code,
        name: outlet.name,
      })),
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
    if (actor.role !== "MAIN_ADMIN")
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const input = loanSchema.parse(await readJson<unknown>(request));
    const employeeId = new ObjectId(input.employeeId);
    const outletId = new ObjectId(input.outletId);
    assertOutletAccess(actor, outletId);
    const db = await getDb();
    const employee = await db.collection<EmployeeDocument>("employees").findOne({
      _id: employeeId,
      outletId,
    });
    if (!employee)
      return NextResponse.json(
        { error: "Employee does not belong to the selected outlet." },
        { status: 400 },
      );
    const now = new Date();
    const loan: LoanDocument = {
      _id: new ObjectId(),
      employeeId,
      outletId,
      totalAmount: input.totalAmount,
      outstandingAmount: input.outstandingAmount,
      notes: input.notes,
      createdBy: actor.id,
      updatedBy: actor.id,
      createdAt: now,
      updatedAt: now,
    };
    await db.collection<LoanDocument>("loans").insertOne(loan);
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "EMPLOYEE_LOAN_CREATED",
      entityType: "loan",
      entityId: loan._id.toHexString(),
      outletId,
      changes: {
        totalAmount: { before: 0, after: loan.totalAmount },
        outstandingAmount: { before: 0, after: loan.outstandingAmount },
      },
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
