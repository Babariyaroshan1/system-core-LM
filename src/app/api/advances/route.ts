import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { advanceSchema } from "@/lib/validation/business";
import { monthSchema, paginationSchema } from "@/lib/validation/common";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import type { AdvanceDocument, EmployeeDocument } from "@/lib/models";

export async function GET(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (!actor.permissions.includes("advances.read"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const url = new URL(request.url);
    const page = paginationSchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      q: undefined,
    });
    const requested = url.searchParams.get("outletId");
    if (requested && !ObjectId.isValid(requested))
      return NextResponse.json({ error: "Invalid outlet ID." }, { status: 400 });
    if (requested) assertOutletAccess(actor, requested);
    const outletIds =
      actor.role === "MAIN_ADMIN"
        ? requested
          ? [new ObjectId(requested)]
          : undefined
        : actor.outletIds;
    const month = url.searchParams.get("month");
    if (month) monthSchema.parse(month);
    const requestedStatus = url.searchParams.get("status");
    if (
      requestedStatus &&
      requestedStatus !== "PENDING" &&
      requestedStatus !== "APPROVED" &&
      requestedStatus !== "REJECTED"
    )
      return NextResponse.json(
        { error: "Invalid advance status filter." },
        { status: 400 },
      );
    const status: AdvanceDocument["status"] | undefined =
      requestedStatus === "PENDING"
        ? "PENDING"
        : requestedStatus === "APPROVED"
          ? "APPROVED"
          : requestedStatus === "REJECTED"
            ? "REJECTED"
            : undefined;
    const query = {
      ...(outletIds ? { outletId: { $in: outletIds } } : {}),
      ...(month ? { date: { $regex: `^${month}` } } : {}),
      ...(status ? { status } : {}),
    };
    const db = await getDb();
    const [advances, total] = await Promise.all([
      db
        .collection<AdvanceDocument>("advances")
        .find(query)
        .sort({ date: -1, createdAt: -1 })
        .skip((page.page - 1) * page.pageSize)
        .limit(page.pageSize)
        .toArray(),
      db.collection<AdvanceDocument>("advances").countDocuments(query),
    ]);
    const pendingCount = await db.collection<AdvanceDocument>("advances")
      .countDocuments({
        ...(outletIds ? { outletId: { $in: outletIds } } : {}),
        status: "PENDING",
      });
    const employeeIds = [
      ...new Set(advances.map((advance) => advance.employeeId.toHexString())),
    ].map((id) => new ObjectId(id));
    const employees = await db
      .collection<EmployeeDocument>("employees")
      .find(
        { _id: { $in: employeeIds } },
        { projection: { employeeCode: 1, fullName: 1 } },
      )
      .toArray();
    const employeeById = new Map(
      employees.map((employee) => [employee._id.toHexString(), employee]),
    );
    return NextResponse.json({
      advances: advances.map((advance) => ({
        ...advance,
        employeeName:
          employeeById.get(advance.employeeId.toHexString())?.fullName ??
          "Unknown employee",
        employeeCode:
          employeeById.get(advance.employeeId.toHexString())?.employeeCode ??
          "",
      })),
      total,
      page: page.page,
      pendingCount,
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
    if (!actor.permissions.includes("advances.write"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const input = advanceSchema.parse(await readJson<unknown>(request));
    const employeeId = new ObjectId(input.employeeId);
    const outletId = new ObjectId(input.outletId);
    assertOutletAccess(actor, outletId);
    const db = await getDb();
    const employee = await db
      .collection<EmployeeDocument>("employees")
      .findOne({ _id: employeeId, outletId, active: true });
    if (!employee)
      return NextResponse.json(
        { error: "Employee is inactive or does not belong to this outlet." },
        { status: 400 },
      );
    const now = new Date();
    const advance: AdvanceDocument = {
      _id: new ObjectId(),
      ...input,
      employeeId,
      outletId,
      status: actor.role === "MAIN_ADMIN" ? "APPROVED" : "PENDING",
      editCount: 0,
      createdBy: actor.id,
      updatedBy: actor.id,
      createdAt: now,
      updatedAt: now,
    };
    await db.collection<AdvanceDocument>("advances").insertOne(advance);
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action:
        advance.status === "APPROVED"
          ? "ADVANCE_CREATED_AND_APPROVED"
          : "ADVANCE_CREATED",
      entityType: "advance",
      entityId: advance._id.toHexString(),
      outletId,
    });
    return NextResponse.json({ advance }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
