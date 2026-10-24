import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getActor } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { userProvisionSchema } from "@/lib/validation/business";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import type { DesignationDocument, UserDocument } from "@/lib/models";
import { hashPassword } from "@/lib/passwords";

export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (actor.role !== "MAIN_ADMIN") return NextResponse.json({ error: "Only MAIN_ADMIN can manage users." }, { status: 403 });
    const users = await (await getDb()).collection<UserDocument>("users").find({}, { projection: { email: 1, emailNormalized: 1, name: 1, role: 1, outletIds: 1, permissions: 1, permissionsCustomized: 1, designationId: 1, designationName: 1, active: 1, createdAt: 1, updatedAt: 1 } }).sort({ emailNormalized: 1 }).toArray();
    return NextResponse.json({
      users: users.map((user) => ({
        ...user,
        _id: user._id.toHexString(),
        outletIds: user.outletIds.map((outletId) => outletId.toHexString()),
        designationId: user.designationId?.toHexString(),
      })),
    });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (actor.role !== "MAIN_ADMIN") return NextResponse.json({ error: "Only MAIN_ADMIN can provision users." }, { status: 403 });
    const input = userProvisionSchema.parse(await readJson<unknown>(request));
    if (!input.password) return NextResponse.json({ error: "Set an initial password for this account." }, { status: 400 });
    const db = await getDb();
    const outletIds = input.outletIds.map((id) => new ObjectId(id));
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
    const validOutlets = await db.collection("outlets").countDocuments({ _id: { $in: outletIds } });
    if (validOutlets !== new Set(input.outletIds).size) return NextResponse.json({ error: "Every assigned outlet must exist." }, { status: 400 });
    if (input.role === "MAIN_ADMIN" && input.email.trim().toLowerCase() !== actor.email && !await db.collection<UserDocument>("users").findOne({ role: "MAIN_ADMIN", active: true })) {
      return NextResponse.json({ error: "Use the documented bootstrap command to create the first MAIN_ADMIN." }, { status: 403 });
    }
    const emailNormalized = input.email.trim().toLowerCase();
    const now = new Date();
    const user: UserDocument = { _id: new ObjectId(), email: input.email.trim(), emailNormalized, name: input.name, passwordHash: await hashPassword(input.password), role: input.role, outletIds, permissions: designation?.permissions ?? (input.role !== "MAIN_ADMIN" ? input.permissions : []), permissionsCustomized: !!designation || (input.role !== "MAIN_ADMIN" && input.permissions.length > 0), ...(designation ? { designationId: designation._id, designationName: designation.name } : {}), active: input.active, createdAt: now, updatedAt: now };
    await db.collection<UserDocument>("users").insertOne(user);
    await writeAudit({ actorId: actor.id, actorEmail: actor.email, action: "USER_PROVISIONED", entityType: "user", entityId: user._id.toHexString(), changes: { role: { before: null, after: input.role }, active: { before: null, after: input.active }, passwordSet: { before: false, after: true } } });
    return NextResponse.json({ user: { id: user._id, email: user.email, name: user.name, role: user.role, outletIds: user.outletIds, permissions: user.permissions, designationId: user.designationId, designationName: user.designationName, active: user.active } }, { status: 201 });
  } catch (error) { return apiError(error); }
}