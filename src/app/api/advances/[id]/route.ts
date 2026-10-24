import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { advanceSchema } from "@/lib/validation/business";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import type { AdvanceDocument, EmployeeDocument } from "@/lib/models";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (!actor.permissions.includes("advances.write") && !actor.permissions.includes("advances.approve")) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const { id } = await context.params;
    if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid advance ID." }, { status: 400 });
    const db = await getDb();
    const current = await db.collection<AdvanceDocument>("advances").findOne({ _id: new ObjectId(id) });
    if (!current) throw new Error("NOT_FOUND");
    assertOutletAccess(actor, current.outletId);
    const raw = await readJson<Record<string, unknown>>(request);
    if (
      raw.action === "APPROVE" ||
      raw.action === "REJECT" ||
      raw.action === "RESTORE" ||
      raw.action === "RESTORE_AND_APPROVE"
    ) {
      if (!actor.permissions.includes("advances.approve"))
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      const transitions = {
        APPROVE: {
          from: "PENDING",
          to: "APPROVED",
          auditAction: "ADVANCE_APPROVED",
        },
        REJECT: {
          from: ["PENDING", "APPROVED"],
          to: "REJECTED",
          auditAction: "ADVANCE_REJECTED",
        },
        RESTORE: {
          from: "REJECTED",
          to: "PENDING",
          auditAction: "ADVANCE_RESTORED",
        },
        RESTORE_AND_APPROVE: {
          from: "REJECTED",
          to: "APPROVED",
          auditAction: "ADVANCE_RESTORED_AND_APPROVED",
        },
      } as const;
      const transition = transitions[raw.action];
      const result = await db.collection<AdvanceDocument>("advances").updateOne(
        {
          _id: current._id,
          status: Array.isArray(transition.from)
            ? { $in: transition.from }
            : transition.from,
          payrollRecordId: { $exists: false },
        },
        {
          $set: {
            status: transition.to,
            updatedBy: actor.id,
            updatedAt: new Date(),
          },
        },
      );
      if (!result.modifiedCount)
        return NextResponse.json(
          { error: "This advance is no longer in a status that allows this action, or it has already been included in payroll." },
          { status: 409 },
        );
      await writeAudit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: transition.auditAction,
        entityType: "advance",
        entityId: id,
        outletId: current.outletId,
        changes: {
          status: { before: current.status, after: transition.to },
        },
      });
      return NextResponse.json({ ok: true });
    }
    if (!actor.permissions.includes("advances.write")) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    if (current.payrollRecordId) return NextResponse.json({ error: "This advance is already assigned to payroll and cannot be edited." }, { status: 409 });
    if (current.status === "APPROVED" && actor.role !== "MAIN_ADMIN") return NextResponse.json({ error: "Only MAIN_ADMIN can change an approved advance." }, { status: 403 });
    const isOutletUser = actor.role === "OUTLET_USER";
    if (isOutletUser && (current.editCount ?? 0) >= 2)
      return NextResponse.json(
        { error: "Outlet users can edit an advance no more than twice." },
        { status: 409 },
      );
    const input = advanceSchema.parse(raw);
    const employeeId = new ObjectId(input.employeeId);
    const outletId = new ObjectId(input.outletId);
    assertOutletAccess(actor, outletId);
    const employee = await db.collection<EmployeeDocument>("employees").findOne({ _id: employeeId, outletId });
    if (!employee) return NextResponse.json({ error: "Employee does not belong to this outlet." }, { status: 400 });
    const nextStatus = current.status === "APPROVED" ? "PENDING" : current.status;
    const editLimitQuery = isOutletUser
      ? {
          $or: [
            { editCount: { $lt: 2 } },
            { editCount: { $exists: false } },
          ],
        }
      : {};
    const result = await db.collection<AdvanceDocument>("advances").updateOne(
      {
        _id: current._id,
        payrollRecordId: { $exists: false },
        ...editLimitQuery,
      },
      {
        $set: { ...input, employeeId, outletId, status: nextStatus, updatedBy: actor.id, updatedAt: new Date() },
        ...(isOutletUser ? { $inc: { editCount: 1 } } : {}),
      },
    );
    if (!result.modifiedCount) return NextResponse.json({ error: "Advance was changed concurrently or claimed by payroll." }, { status: 409 });
    await writeAudit({ actorId: actor.id, actorEmail: actor.email, action: "ADVANCE_UPDATED", entityType: "advance", entityId: id, outletId, changes: { amount: { before: current.amount, after: input.amount }, status: { before: current.status, after: nextStatus } } });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}