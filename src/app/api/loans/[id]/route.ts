import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { apiError, readJson } from "@/lib/http";
import { getDb } from "@/lib/mongodb";
import type { LoanDocument } from "@/lib/models";
import { getActor } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { loanSchema } from "@/lib/validation/business";

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
    if (actor.role !== "MAIN_ADMIN")
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const { id } = await context.params;
    if (!ObjectId.isValid(id))
      return NextResponse.json({ error: "Invalid loan ID." }, { status: 400 });
    const current = await (await getDb())
      .collection<LoanDocument>("loans")
      .findOne({ _id: new ObjectId(id) });
    if (!current) throw new Error("NOT_FOUND");
    const input = loanSchema.parse({
      ...(await readJson<Record<string, unknown>>(request)),
      employeeId: current.employeeId.toHexString(),
      outletId: current.outletId.toHexString(),
    });
    const update = await (await getDb())
      .collection<LoanDocument>("loans")
      .updateOne(
        { _id: current._id, outstandingAmount: current.outstandingAmount },
        {
          $set: {
            totalAmount: input.totalAmount,
            outstandingAmount: input.outstandingAmount,
            notes: input.notes,
            updatedBy: actor.id,
            updatedAt: new Date(),
          },
        },
      );
    if (!update.modifiedCount)
      return NextResponse.json(
        { error: "Loan changed concurrently. Refresh and try again." },
        { status: 409 },
      );
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "EMPLOYEE_LOAN_UPDATED",
      entityType: "loan",
      entityId: id,
      outletId: current.outletId,
      changes: {
        totalAmount: { before: current.totalAmount, after: input.totalAmount },
        outstandingAmount: {
          before: current.outstandingAmount,
          after: input.outstandingAmount,
        },
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
