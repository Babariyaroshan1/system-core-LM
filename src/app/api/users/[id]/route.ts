import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getActor } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { userProvisionSchema } from "@/lib/validation/business";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import type { DesignationDocument, UserDocument } from "@/lib/models";
import { hashPassword } from "@/lib/passwords";

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
      return NextResponse.json(
        { error: "Only MAIN_ADMIN can manage users." },
        { status: 403 },
      );
    const { id } = await context.params;
    if (!ObjectId.isValid(id))
      return NextResponse.json({ error: "Invalid user ID." }, { status: 400 });
    const input = userProvisionSchema.parse(await readJson<unknown>(request));
    const db = await getDb();
    const targetId = new ObjectId(id);
    const designation = input.designationId
      ? await db
          .collection<DesignationDocument>("designations")
          .findOne({ _id: new ObjectId(input.designationId) })
      : null;
    if (input.designationId && !designation)
      return NextResponse.json(
        { error: "The selected designation no longer exists." },
        { status: 400 },
      );
    const current = await db
      .collection<UserDocument>("users")
      .findOne({ _id: targetId });
    if (!current) throw new Error("NOT_FOUND");
    if (
      current._id.equals(actor.id) &&
      (!input.active || input.role !== "MAIN_ADMIN")
    )
      return NextResponse.json(
        { error: "You cannot revoke your own MAIN_ADMIN access." },
        { status: 400 },
      );
    if (
      current.role === "MAIN_ADMIN" &&
      (!input.active || input.role !== "MAIN_ADMIN")
    ) {
      const admins = await db
        .collection<UserDocument>("users")
        .countDocuments({ role: "MAIN_ADMIN", active: true });
      if (admins <= 1)
        return NextResponse.json(
          {
            error:
              "The last active MAIN_ADMIN cannot be deactivated or demoted.",
          },
          { status: 409 },
        );
    }
    const outletIds = input.outletIds.map((outletId) => new ObjectId(outletId));
    const outletCount = await db
      .collection("outlets")
      .countDocuments({ _id: { $in: outletIds } });
    if (outletCount !== new Set(input.outletIds).size)
      return NextResponse.json(
        { error: "Every assigned outlet must exist." },
        { status: 400 },
      );
    if (input.role === "OUTLET_USER" && input.outletIds.length !== 1)
      return NextResponse.json(
        { error: "Assign an OUTLET_USER to exactly one outlet." },
        { status: 400 },
      );
    if (
      input.role === "OUTLET_USER" &&
      !(await db
        .collection("outlets")
        .findOne({ _id: outletIds[0], active: true }, { projection: { _id: 1 } }))
    )
      return NextResponse.json(
        { error: "Assign the OUTLET_USER to an active outlet." },
        { status: 400 },
      );
    const passwordHash = input.password ? await hashPassword(input.password) : undefined;
    await db.collection<UserDocument>("users").updateOne(
      { _id: targetId },
      {
        $set: {
          email: input.email.trim(),
          emailNormalized: input.email.trim().toLowerCase(),
          name: input.name,
          role: input.role,
          outletIds,
          permissions:
            designation?.permissions ??
            (input.role !== "MAIN_ADMIN" ? input.permissions : []),
          permissionsCustomized: input.role !== "MAIN_ADMIN",
          ...(designation
            ? {
                designationId: designation._id,
                designationName: designation.name,
              }
            : {}),
          active: input.active,
          ...(passwordHash ? { passwordHash } : {}),
          updatedAt: new Date(),
        },
        ...(designation ? {} : { $unset: { designationId: "", designationName: "" } }),
      },
    );
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "USER_ACCESS_UPDATED",
      entityType: "user",
      entityId: id,
      reason: "Admin-managed user access change",
      changes: {
        role: { before: current.role, after: input.role },
        active: { before: current.active, after: input.active },
        outletIds: {
          before: current.outletIds.map(String),
          after: input.outletIds,
        },
        permissions: {
          before: current.permissions,
          after: designation?.permissions ?? input.permissions,
        },
        designation: {
          before: current.designationName ?? null,
          after: designation?.name ?? null,
        },
        ...(passwordHash ? { passwordReset: { before: false, after: true } } : {}),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
