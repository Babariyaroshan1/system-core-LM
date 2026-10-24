import { ObjectId } from "mongodb";
import { connection, NextResponse } from "next/server";
import { getActor } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { apiError } from "@/lib/http";
import type { AuditLogDocument } from "@/lib/models";

export async function GET(request: Request) {
  try {
    await connection();
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (!actor.permissions.includes("audit.read"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const url = new URL(request.url);
    const page = Math.min(
      1000,
      Math.max(0, Number(url.searchParams.get("page") || 0)),
    );
    const outletId = url.searchParams.get("outletId");
    if (outletId && !ObjectId.isValid(outletId))
      return NextResponse.json(
        { error: "Invalid outlet ID." },
        { status: 400 },
      );
    if (
      outletId &&
      actor.role !== "MAIN_ADMIN" &&
      !actor.outletIds.some((id) => id.toHexString() === outletId)
    )
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const outletIds = actor.role === "MAIN_ADMIN" ? undefined : actor.outletIds;
    const query = {
      ...(outletId
        ? { outletId: new ObjectId(outletId) }
        : outletIds
          ? {
              $or: [
                { outletId: { $in: outletIds } },
                { outletId: { $exists: false } },
              ],
            }
          : {}),
    };
    const logs = await (
      await getDb()
    )
      .collection<AuditLogDocument>("auditLogs")
      .find(query)
      .sort({ at: -1 })
      .skip(page * 50)
      .limit(50)
      .toArray();
    return NextResponse.json({ logs, page, hasMore: logs.length === 50 });
  } catch (error) {
    return apiError(error);
  }
}
