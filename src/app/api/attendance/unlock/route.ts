import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getActor } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import type { AttendanceDayDocument } from "@/lib/models";
import { dateOnlySchema } from "@/lib/validation/common";
import { z } from "zod";

const schema = z.object({
  outletId: z.string().regex(/^[a-f\d]{24}$/i),
  date: dateOnlySchema,
  reason: z.string().trim().max(500).optional(),
});

export async function POST(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (
      actor.role !== "MAIN_ADMIN" ||
      !actor.permissions.includes("attendance.unlock")
    )
      return NextResponse.json(
        { error: "Only MAIN_ADMIN can unlock submitted attendance." },
        { status: 403 },
      );
    const input = schema.parse(await readJson<unknown>(request));
    const outletId = new ObjectId(input.outletId);
    const db = await getDb();
    const day = await db
      .collection<AttendanceDayDocument>("attendance")
      .findOne({ outletId, date: input.date, status: "SUBMITTED" });
    if (!day) throw new Error("NOT_FOUND");
    const reason = input.reason || "Unlocked by MAIN_ADMIN";
    await db.collection<AttendanceDayDocument>("attendance").updateOne(
      { _id: day._id, status: "SUBMITTED" },
      {
        $set: {
          status: "DRAFT",
          entries: day.entries.map((entry) => ({
            ...entry,
            submitted: false,
          })),
          updatedAt: new Date(),
          updatedBy: actor.id,
        },
        $push: {
          corrections: {
            at: new Date(),
            actorId: actor.id,
            reason,
            action: "UNLOCK",
          },
        },
      },
    );
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "ATTENDANCE_UNLOCKED",
      entityType: "attendance",
      entityId: day._id.toHexString(),
      outletId,
      reason,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
