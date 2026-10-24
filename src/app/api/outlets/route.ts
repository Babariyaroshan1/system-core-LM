import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getActor, scopedOutletQuery } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { outletSchema } from "@/lib/validation/business";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import type { OutletDocument } from "@/lib/models";
import { z } from "zod";

const outletCreateSchema = z.object({
  outletNumber: z.number().int().min(1).max(99),
  name: z.string().trim().min(2).max(100),
  address: z.string().trim().max(300).default(""),
  city: z.string().trim().max(100).default("Ahmedabad"),
  managerName: z.string().trim().max(120).default(""),
  contactPhone: z.string().trim().max(20).default(""),
  active: z.boolean().default(true),
});

export async function GET(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    const outletReadPermissions = new Set([
      "dashboard.read",
      "employees.read",
      "attendance.read",
      "advances.read",
      "salary.read",
      "reports.export",
      "outlets.manage",
    ]);
    if (
      !actor.permissions.some((permission) =>
        outletReadPermissions.has(permission),
      )
    )
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const requestedId =
      new URL(request.url).searchParams.get("id") ?? undefined;
    if (requestedId && !ObjectId.isValid(requestedId))
      return NextResponse.json(
        { error: "Invalid outlet ID." },
        { status: 400 },
      );
    const db = await getDb();
    const outlets = await db
      .collection<OutletDocument>("outlets")
      .find(scopedOutletQuery(actor, requestedId))
      .sort({ code: 1 })
      .toArray();
    if (actor.role !== "MAIN_ADMIN") return NextResponse.json({ outlets });
    const users = await db
      .collection("users")
      .find(
        {
          active: true,
          outletIds: { $in: outlets.map((outlet) => outlet._id) },
        },
        { projection: { name: 1, emailNormalized: 1, role: 1, outletIds: 1 } },
      )
      .toArray();
    const assigned = new Map(
      outlets.map((outlet) => [
        outlet._id.toHexString(),
        users
          .filter((user) =>
            user.outletIds?.some((id: ObjectId) => id.equals(outlet._id)),
          )
          .map((user) => ({
            name: user.name,
            email: user.emailNormalized,
            role: user.role,
          })),
      ]),
    );
    return NextResponse.json({
      outlets: outlets.map((outlet) => ({
        ...outlet,
        assignedUsers: assigned.get(outlet._id.toHexString()) ?? [],
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
      return NextResponse.json(
        { error: "Only MAIN_ADMIN can manage outlets." },
        { status: 403 },
      );

    const input = outletCreateSchema.parse(await readJson<unknown>(request));
    const db = await getDb();
    const outlets = db.collection<
      OutletDocument & { outletCode?: string; outlet_code?: string }
    >("outlets");
    const existing = await outlets
      .find({}, { projection: { code: 1, outletCode: 1, outlet_code: 1 } })
      .toArray();
    const usedCodes = new Set(
      existing.flatMap((outlet) =>
        [outlet.code, outlet.outletCode, outlet.outlet_code].filter(
          (code): code is string => typeof code === "string",
        ).map((code) => code.trim().toUpperCase()),
      ),
    );
    const code = `OUT${String(input.outletNumber).padStart(2, "0")}`;
    if (usedCodes.has(code))
      return NextResponse.json(
        {
          error: `${code} is already assigned to an outlet. Choose an unused outlet number.`,
        },
        { status: 409 },
      );

    const outlet = {
      _id: new ObjectId(),
      ...outletSchema.parse({
        ...input,
        code,
      }),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await outlets.insertOne(outlet);
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "OUTLET_CREATED",
      entityType: "outlet",
      entityId: outlet._id.toHexString(),
      changes: {
        code: { before: null, after: outlet.code },
        name: { before: null, after: outlet.name },
        city: { before: null, after: outlet.city },
      },
    });
    return NextResponse.json({ outlet }, { status: 201 });
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
      return NextResponse.json(
        { error: "Only MAIN_ADMIN can manage outlets." },
        { status: 403 },
      );
    const db = await getDb();
    const body = await readJson<unknown>(request);
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return NextResponse.json(
        { error: "Outlet details must be sent as an object." },
        { status: 400 },
      );
    const payload = body as Record<string, unknown>;
    const outletId = payload.outletId ?? payload._id;
    const outletCollection = db.collection<
      OutletDocument & { outletCode?: string; outlet_code?: string }
    >("outlets");
    const before =
      typeof outletId === "string" && ObjectId.isValid(outletId)
        ? await outletCollection.findOne({ _id: new ObjectId(outletId) })
        : typeof payload.code === "string"
          ? await outletCollection.findOne({ code: payload.code })
          : null;
    if (!before) throw new Error("NOT_FOUND");
    const code =
      before.code ?? before.outletCode ?? before.outlet_code ?? payload.code;
    if (typeof code !== "string")
      return NextResponse.json(
        { error: "This outlet is missing its outlet code. Contact support." },
        { status: 400 },
      );
    const currentActive =
      typeof before.active === "boolean" ? before.active : false;
    const parsed = outletSchema.parse({
      code,
      name: typeof payload.name === "string" ? payload.name : before.name || code,
      address:
        typeof payload.address === "string"
          ? payload.address
          : before.address ?? "",
      city: typeof payload.city === "string" ? payload.city : before.city ?? "",
      managerName:
        typeof payload.managerName === "string"
          ? payload.managerName
          : before.managerName ?? "",
      contactPhone:
        typeof payload.contactPhone === "string"
          ? payload.contactPhone
          : before.contactPhone ?? "",
      active:
        typeof payload.active === "boolean" ? payload.active : currentActive,
    });
    await db
      .collection<OutletDocument>("outlets")
      .updateOne(
        { _id: before._id },
        { $set: { ...parsed, updatedAt: new Date() } },
      );
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "OUTLET_UPDATED",
      entityType: "outlet",
      entityId: before._id.toHexString(),
      changes: {
        active: { before: before.active, after: parsed.active },
        name: { before: before.name, after: parsed.name },
        address: { before: before.address, after: parsed.address },
        city: { before: before.city, after: parsed.city },
        managerName: { before: before.managerName, after: parsed.managerName },
        contactPhone: {
          before: before.contactPhone,
          after: parsed.contactPhone,
        },
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
