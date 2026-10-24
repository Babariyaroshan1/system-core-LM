import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getActor } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import type { UserDocument } from "@/lib/models";
import { hashPassword } from "@/lib/passwords";
import { z } from "zod";

const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9._-]+$/, "Use letters, numbers, dots, underscores, or hyphens."),
  password: z.string().min(10).max(72).optional(),
});

export async function GET() {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (actor.role !== "MAIN_ADMIN")
      return NextResponse.json(
        { error: "Only MAIN_ADMIN can manage admin credentials." },
        { status: 403 },
      );
    const user = await (await getDb())
      .collection<UserDocument>("users")
      .findOne({ _id: actor.id, active: true, role: "MAIN_ADMIN" });
    if (!user)
      return NextResponse.json(
        { error: "Administrator account not found." },
        { status: 404 },
      );
    return NextResponse.json({
      username: user.username ?? user.usernameNormalized ?? "",
    });
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
    if (
      actor.role !== "MAIN_ADMIN" ||
      !actor.permissions.includes("settings.manage")
    )
      return NextResponse.json(
        { error: "Only MAIN_ADMIN can change admin credentials." },
        { status: 403 },
      );

    const input = credentialsSchema.parse(await readJson<unknown>(request));
    if (
      input.password &&
      Buffer.byteLength(input.password, "utf8") > 72
    )
      return NextResponse.json(
        { error: "Password must not exceed 72 UTF-8 bytes." },
        { status: 400 },
      );

    const usernameNormalized = input.username.toLowerCase();
    const db = await getDb();
    const users = db.collection<UserDocument>("users");
    const currentUser = await users.findOne({
      _id: actor.id,
      active: true,
      role: "MAIN_ADMIN",
    });
    if (!currentUser)
      return NextResponse.json(
        { error: "Administrator account not found." },
        { status: 404 },
      );
    const existing = await users.findOne({
      _id: { $ne: new ObjectId(actor.id) },
      usernameNormalized,
    });
    if (existing)
      return NextResponse.json(
        { error: "That username is already in use." },
        { status: 409 },
      );

    const changes: Partial<UserDocument> = {
      username: input.username,
      usernameNormalized,
      updatedAt: new Date(),
    };
    if (input.password)
      changes.passwordHash = await hashPassword(input.password);
    const updated = await users.updateOne(
      { _id: actor.id, active: true, role: "MAIN_ADMIN" },
      { $set: changes },
    );
    if (!updated.matchedCount)
      return NextResponse.json(
        { error: "Administrator account not found." },
        { status: 404 },
      );

    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "ADMIN_CREDENTIALS_UPDATED",
      entityType: "user",
      entityId: actor.id.toHexString(),
      changes: {
        username: {
          before: currentUser.username ?? null,
          after: input.username,
        },
        passwordUpdated: { before: false, after: Boolean(input.password) },
      },
    });
    return NextResponse.json({ username: input.username });
  } catch (error) {
    return apiError(error);
  }
}
