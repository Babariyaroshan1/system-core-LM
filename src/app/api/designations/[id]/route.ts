import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getActor } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { apiError } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import type { DesignationDocument, UserDocument } from "@/lib/models";

export async function DELETE(
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
    if (actor.role !== "MAIN_ADMIN")
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const { id } = await context.params;
    if (!ObjectId.isValid(id))
      return NextResponse.json(
        { error: "Invalid designation ID." },
        { status: 400 },
      );
    const db = await getDb();
    const objectId = new ObjectId(id);
    const designation = await db
      .collection<DesignationDocument>("designations")
      .findOne({ _id: objectId });
    if (!designation) throw new Error("NOT_FOUND");
    const assignedCount = await db
      .collection<UserDocument>("users")
      .countDocuments({ designationId: objectId });
    if (assignedCount)
      return NextResponse.json(
        {
          error: `This designation is assigned to ${assignedCount} account(s). Reassign those accounts before deleting it.`,
        },
        { status: 409 },
      );
    await db
      .collection<DesignationDocument>("designations")
      .deleteOne({ _id: objectId });
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "DESIGNATION_DELETED",
      entityType: "designation",
      entityId: id,
      changes: { name: { before: designation.name, after: null } },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
