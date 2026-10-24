import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getActor } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import type { DesignationDocument, UserDocument } from "@/lib/models";
import { designationSchema } from "@/lib/validation/business";

export async function GET() {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (actor.role !== "MAIN_ADMIN")
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const db = await getDb();
    const designations = await db
      .collection<DesignationDocument>("designations")
      .find({})
      .sort({ nameNormalized: 1 })
      .toArray();
    const assignedCounts = await Promise.all(
      designations.map((designation) =>
        db
          .collection<UserDocument>("users")
          .countDocuments({ designationId: designation._id }),
      ),
    );
    return NextResponse.json({
      designations: designations.map((designation, index) => ({
        ...designation,
        _id: designation._id.toHexString(),
        assignedCount: assignedCounts[index],
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
    const input = designationSchema.parse(await readJson<unknown>(request));
    const db = await getDb();
    const nameNormalized = input.name.toLocaleLowerCase("en");
    if (
      await db
        .collection<DesignationDocument>("designations")
        .findOne({ nameNormalized })
    )
      return NextResponse.json(
        { error: "A designation with this name already exists." },
        { status: 409 },
      );
    const now = new Date();
    const designation: DesignationDocument = {
      _id: new ObjectId(),
      ...input,
      nameNormalized,
      createdAt: now,
      updatedAt: now,
    };
    await db
      .collection<DesignationDocument>("designations")
      .insertOne(designation);
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "DESIGNATION_CREATED",
      entityType: "designation",
      entityId: designation._id.toHexString(),
      changes: { name: { before: null, after: designation.name } },
    });
    return NextResponse.json({ designation }, { status: 201 });
  } catch (error) {
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
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const body = await readJson<unknown>(request);
    if (
      !body ||
      typeof body !== "object" ||
      !("id" in body) ||
      typeof body.id !== "string" ||
      !ObjectId.isValid(body.id)
    )
      return NextResponse.json(
        { error: "A valid designation ID is required." },
        { status: 400 },
      );
    const input = designationSchema.parse(body);
    const db = await getDb();
    const collection = db.collection<DesignationDocument>("designations");
    const id = new ObjectId(body.id);
    const current = await collection.findOne({ _id: id });
    if (!current) throw new Error("NOT_FOUND");
    const nameNormalized = input.name.toLocaleLowerCase("en");
    if (
      await collection.findOne({
        _id: { $ne: id },
        nameNormalized,
      })
    )
      return NextResponse.json(
        { error: "A designation with this name already exists." },
        { status: 409 },
      );
    const updatedAt = new Date();
    await collection.updateOne(
      { _id: id },
      { $set: { ...input, nameNormalized, updatedAt } },
    );
    await db.collection<UserDocument>("users").updateMany(
      { designationId: id },
      {
        $set: {
          permissions: input.permissions,
          permissionsCustomized: true,
          designationName: input.name,
          updatedAt,
        },
      },
    );
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "DESIGNATION_UPDATED",
      entityType: "designation",
      entityId: id.toHexString(),
      changes: {
        name: { before: current.name, after: input.name },
        permissions: {
          before: current.permissions,
          after: input.permissions,
        },
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
