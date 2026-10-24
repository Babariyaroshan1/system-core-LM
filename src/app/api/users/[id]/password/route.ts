import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { apiError, readJson } from "@/lib/http";
import { getDb } from "@/lib/mongodb";
import { getActor } from "@/lib/permissions";
import { hashPassword } from "@/lib/passwords";
import type { UserDocument } from "@/lib/models";

const passwordSchema = z.object({
  password: z
    .string()
    .min(10, "Password must be at least 10 characters.")
    .max(72, "Password is too long.")
    .refine(
      (password) => new TextEncoder().encode(password).length <= 72,
      "Password is too long.",
    ),
});

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
        { error: "Only MAIN_ADMIN can reset user passwords." },
        { status: 403 },
      );

    const { id } = await context.params;
    if (!ObjectId.isValid(id))
      return NextResponse.json(
        { error: "Invalid user ID." },
        { status: 400 },
      );
    const { password } = passwordSchema.parse(await readJson<unknown>(request));
    const db = await getDb();
    const userId = new ObjectId(id);
    const user = await db
      .collection<UserDocument>("users")
      .findOne({ _id: userId }, { projection: { _id: 1 } });
    if (!user) throw new Error("NOT_FOUND");

    const passwordHash = await hashPassword(password);
    await db
      .collection<UserDocument>("users")
      .updateOne(
        { _id: userId },
        { $set: { passwordHash, updatedAt: new Date() } },
      );
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "USER_PASSWORD_RESET",
      entityType: "user",
      entityId: id,
      reason: "Admin-managed user password reset",
      changes: { passwordReset: { before: false, after: true } },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
