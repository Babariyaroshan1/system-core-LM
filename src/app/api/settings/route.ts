import { NextResponse } from "next/server";
import { getActor } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import type { SalarySettings } from "@/lib/models";
import { z } from "zod";

const settingsSchema = z.object({
  timezone: z.string().min(1).max(80), defaultSalaryMethod: z.enum(["FIXED_30_DAYS", "CALENDAR_DAYS", "WORKING_DAYS_26"]),
  workingDaysDivisor: z.number().int().min(1).max(31), paidAbsences: z.number().int().min(0).max(31),
  currency: z.literal("INR"), advanceDeductionPolicy: z.literal("UNPAID_ONLY"),
});

export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (actor.role !== "MAIN_ADMIN" || !actor.permissions.includes("settings.manage")) return NextResponse.json({ error: "Only MAIN_ADMIN can read global payroll settings." }, { status: 403 });
    const settings = await (await getDb()).collection<SalarySettings & { _id: string }>("settings").findOne({ _id: "payroll" });
    return NextResponse.json({ settings });
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (actor.role !== "MAIN_ADMIN" || !actor.permissions.includes("settings.manage")) return NextResponse.json({ error: "Only MAIN_ADMIN can change payroll settings." }, { status: 403 });
    const settings = settingsSchema.parse(await readJson<unknown>(request));
    try { new Intl.DateTimeFormat("en", { timeZone: settings.timezone }); } catch { return NextResponse.json({ error: "Invalid business timezone." }, { status: 400 }); }
    const db = await getDb();
    await db.collection<SalarySettings & { _id: string }>("settings").updateOne({ _id: "payroll" }, { $set: { ...settings, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
    await writeAudit({ actorId: actor.id, actorEmail: actor.email, action: "PAYROLL_SETTINGS_UPDATED", entityType: "settings", entityId: "payroll" });
    return NextResponse.json({ settings });
  } catch (error) { return apiError(error); }
}