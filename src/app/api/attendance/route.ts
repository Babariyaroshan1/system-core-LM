import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import {
  getActor,
  assertOutletAccess,
  scopedOutletQuery,
} from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { attendanceSchema } from "@/lib/validation/business";
import { dateOnlySchema } from "@/lib/validation/common";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import type {
  AttendanceDayDocument,
  EmployeeDocument,
  OutletDocument,
} from "@/lib/models";

export async function GET(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (!actor.permissions.includes("attendance.read"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const url = new URL(request.url);
    const outletId = url.searchParams.get("outletId");
    const date = url.searchParams.get("date");
    if (!date || !dateOnlySchema.safeParse(date).success)
      return NextResponse.json(
        { error: "A valid YYYY-MM-DD date is required." },
        { status: 400 },
      );
    const db = await getDb();
    if (!outletId) {
      const outlets = await db
        .collection<OutletDocument>("outlets")
        .find({ ...scopedOutletQuery(actor), active: true })
        .sort({ code: 1 })
        .toArray();
      const outletIds = outlets.map((outlet) => outlet._id);
      const days = await db
        .collection<AttendanceDayDocument>("attendance")
        .find({ outletId: { $in: outletIds }, date })
        .toArray();
      const historicalEmployeeIds = days.flatMap((day) =>
        day.entries.map((entry) => entry.employeeId),
      );
      const employees = outletIds.length
        ? await db
            .collection<EmployeeDocument>("employees")
            .find({
              outletId: { $in: outletIds },
              $or: [
                { active: true },
                { _id: { $in: historicalEmployeeIds } },
              ],
            })
            .sort({ outletId: 1, fullName: 1 })
            .toArray()
        : [];
      const outletById = new Map(
        outlets.map((outlet) => [outlet._id.toHexString(), outlet]),
      );
      const dayByOutletId = new Map(
        days.map((day) => [day.outletId.toHexString(), day]),
      );
      const counts = { P: 0, A: 0, WO: 0, HD: 0 };
      for (const day of days)
        for (const entry of day.entries) counts[entry.status] += 1;
      return NextResponse.json({
        counts,
        outletCount: outlets.length,
        submittedCount: days.filter((day) => day.status === "SUBMITTED").length,
        employees: employees.map((employee) => {
          const outlet = outletById.get(employee.outletId.toHexString());
          const day = dayByOutletId.get(employee.outletId.toHexString());
          const entry = day?.entries.find((item) =>
            item.employeeId.equals(employee._id),
          );
          return {
            _id: employee._id,
            employeeCode: employee.employeeCode,
            fullName: employee.fullName,
            designation: employee.designation,
            outletId: employee.outletId,
            outletCode: outlet?.code,
            outletName: outlet?.name,
            attendanceStatus: entry?.status ?? null,
            attendanceEntryExists: !!entry,
            attendanceSubmitted:
              !!entry &&
              day?.status === "SUBMITTED" &&
              entry.submitted !== false,
            attendanceCorrectionCount: entry?.correctionCount ?? 0,
          };
        }),
      });
    }
    if (!ObjectId.isValid(outletId))
      return NextResponse.json({ error: "Invalid outlet ID." }, { status: 400 });
    assertOutletAccess(actor, outletId);
    const outlet = await db
      .collection<OutletDocument>("outlets")
      .findOne({ _id: new ObjectId(outletId) });
    if (!outlet) throw new Error("NOT_FOUND");
    const day = await db
      .collection<AttendanceDayDocument>("attendance")
      .findOne({ outletId: outlet._id, date });
    const historicalEmployeeIds = (day?.entries ?? []).map(
      (entry) => entry.employeeId,
    );
    const employees = await db
      .collection<EmployeeDocument>("employees")
      .find({
        outletId: outlet._id,
        $or: [{ active: true }, { _id: { $in: historicalEmployeeIds } }],
      })
      .sort({ fullName: 1 })
      .toArray();
    const entries = new Map(
      (day?.entries ?? []).map((entry) => [
        entry.employeeId.toHexString(),
        entry,
      ]),
    );
    const counts = { P: 0, A: 0, WO: 0, HD: 0 };
    for (const entry of entries.values()) counts[entry.status] += 1;
    return NextResponse.json({
      outlet: { id: outlet._id, code: outlet.code, name: outlet.name },
      day,
      counts,
      employees: employees.map((employee) => ({
        _id: employee._id,
        employeeCode: employee.employeeCode,
        fullName: employee.fullName,
        designation: employee.designation,
        outletId: employee.outletId,
        outletCode: outlet.code,
        outletName: outlet.name,
        ...(actor.role === "OUTLET_USER" ? {} : { mobile: employee.mobile }),
        attendanceStatus:
          entries.get(employee._id.toHexString())?.status ?? null,
        attendanceEntryExists: entries.has(employee._id.toHexString()),
        attendanceSubmitted:
          !!entries.get(employee._id.toHexString()) &&
          day?.status === "SUBMITTED" &&
          entries.get(employee._id.toHexString())?.submitted !== false,
        attendanceCorrectionCount:
          entries.get(employee._id.toHexString())?.correctionCount ?? 0,
      })),
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
    if (!actor.permissions.includes("attendance.write"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const body = (await readJson<unknown>(request)) as { action?: string };
    const input = attendanceSchema.parse(body);
    if (body.action !== "SAVE" && body.action !== "SUBMIT")
      return NextResponse.json(
        { error: "Action must be SAVE or SUBMIT." },
        { status: 400 },
      );
    if (
      body.action === "SUBMIT" &&
      !actor.permissions.includes("attendance.submit")
    )
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const outletId = new ObjectId(input.outletId);
    assertOutletAccess(actor, outletId);
    const db = await getDb();
    const settings = await db
      .collection<{ _id: string; timezone?: string }>("settings")
      .findOne({ _id: "payroll" });
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone:
        settings?.timezone || process.env.BUSINESS_TIMEZONE || "Asia/Kolkata",
    }).format(new Date());
    if (input.date > today)
      return NextResponse.json(
        { error: "Attendance cannot be recorded for a future date." },
        { status: 400 },
      );
    const outlet = await db
      .collection<OutletDocument>("outlets")
      .findOne({ _id: outletId });
    if (!outlet)
      return NextResponse.json(
        { error: "Outlet is unavailable." },
        { status: 400 },
      );
    const collection = db.collection<AttendanceDayDocument>("attendance");
    const existingDay = await collection.findOne({
      outletId,
      date: input.date,
    });
    if (!outlet.active && (!existingDay || actor.role !== "MAIN_ADMIN"))
      return NextResponse.json(
        { error: "Inactive outlets cannot receive new attendance." },
        { status: 400 },
      );
    const historicalEmployeeIds = (existingDay?.entries ?? []).map(
      (entry) => entry.employeeId,
    );
    const employees = await db
      .collection<EmployeeDocument>("employees")
      .find(
        {
          outletId,
          $or: [{ active: true }, { _id: { $in: historicalEmployeeIds } }],
        },
        { projection: { _id: 1 } },
      )
      .toArray();
    const allowedEmployees = new Set(
      employees.map((employee) => employee._id.toHexString()),
    );
    const seen = new Set<string>();
    for (const entry of input.entries) {
      if (!allowedEmployees.has(entry.employeeId))
        return NextResponse.json(
          {
            error:
              "Every attendance employee must be active and belong to the selected outlet.",
          },
          { status: 400 },
        );
      if (seen.has(entry.employeeId))
        return NextResponse.json(
          { error: "An employee may appear only once per date." },
          { status: 400 },
        );
      seen.add(entry.employeeId);
    }
    const now = new Date();
    const wasUnlocked = existingDay?.corrections.at(-1)?.action === "UNLOCK";
    if (body.action === "SUBMIT" && input.entries.length === 0)
      return NextResponse.json(
        { error: "Mark at least one employee before submitting attendance." },
        { status: 400 },
      );
    const previousEntries = new Map(
      (existingDay?.entries ?? []).map((entry) => [
        entry.employeeId.toHexString(),
        entry,
      ]),
    );
    for (const entry of input.entries) {
      const previous = previousEntries.get(entry.employeeId);
      const isAlreadySubmitted =
        !!previous &&
        existingDay?.status === "SUBMITTED" &&
        previous.submitted !== false;
      if (
        isAlreadySubmitted &&
        previous &&
        previous.status !== entry.status
      )
        return NextResponse.json(
          {
            error:
              "Submitted employee attendance is locked. Ask MAIN_ADMIN to unlock it for correction.",
          },
          { status: 409 },
        );
      const correctionCount = previous?.correctionCount ?? 0;
      if (
        wasUnlocked &&
        actor.role !== "MAIN_ADMIN" &&
        previous?.status !== entry.status &&
        correctionCount >= 2
      )
        return NextResponse.json(
          {
            error: `An employee's attendance is locked after 2 changes for this date. Contact MAIN_ADMIN for further corrections.`,
          },
          { status: 409 },
        );
    }
    const entries = new Map(
      (existingDay?.entries ?? []).map((entry) => [
        entry.employeeId.toHexString(),
        {
          ...entry,
          correctionCount: entry.correctionCount ?? 0,
        },
      ]),
    );
    for (const entry of input.entries) {
      const previous = previousEntries.get(entry.employeeId);
      const changed = previous?.status !== entry.status;
      const isAlreadySubmitted =
        !!previous &&
        existingDay?.status === "SUBMITTED" &&
        previous.submitted !== false;
      if (isAlreadySubmitted) continue;
      entries.set(entry.employeeId, {
        employeeId: new ObjectId(entry.employeeId),
        status: entry.status,
        updatedAt: now,
        updatedBy: actor.id,
        correctionCount:
          wasUnlocked && previous && changed
            ? (previous?.correctionCount ?? 0) + 1
            : (previous?.correctionCount ?? 0),
        submitted: body.action === "SUBMIT",
      });
    }
    const hasSubmittedEntries = [...entries.values()].some(
      (entry) =>
        entry.submitted ||
        (existingDay?.status === "SUBMITTED" && entry.submitted !== false),
    );
    const shouldBeSubmitted =
      body.action === "SUBMIT" || hasSubmittedEntries;
    const update = {
      $set: {
        entries: [...entries.values()],
        updatedAt: now,
        updatedBy: actor.id,
        ...(shouldBeSubmitted
          ? {
              status: "SUBMITTED" as const,
              ...(body.action === "SUBMIT"
                ? { submittedAt: now, submittedBy: actor.id }
                : {}),
            }
          : { status: "DRAFT" as const }),
      },
      $setOnInsert: {
        _id: new ObjectId(),
        outletId,
        date: input.date,
        corrections: [],
        ...(!shouldBeSubmitted ? { status: "DRAFT" as const } : {}),
      },
      ...(body.action === "SUBMIT" && wasUnlocked
        ? {
            $push: {
              corrections: {
                at: now,
                actorId: actor.id,
                reason: "Attendance re-submitted after correction",
                action: "RELOCK" as const,
              },
            },
          }
        : {}),
    };
    let result;
    try {
      result = await collection.updateOne(
        {
          outletId,
          date: input.date,
          ...(existingDay
            ? { _id: existingDay._id, updatedAt: existingDay.updatedAt }
            : { status: { $ne: "SUBMITTED" } }),
        },
        update,
        { upsert: true },
      );
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        return NextResponse.json(
          {
            error:
              "Attendance is locked or was updated concurrently. Refresh before editing.",
          },
          { status: 409 },
        );
      throw error;
    }
    if (!result.matchedCount && !result.upsertedCount)
      return NextResponse.json(
        { error: "Attendance is locked." },
        { status: 409 },
      );
    const record = await db
      .collection<AttendanceDayDocument>("attendance")
      .findOne({ outletId, date: input.date });
    if (body.action === "SUBMIT" && record)
      await writeAudit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: "ATTENDANCE_SUBMITTED",
        entityType: "attendance",
        entityId: record._id.toHexString(),
        outletId,
      });
    return NextResponse.json({ day: record });
  } catch (error) {
    return apiError(error);
  }
}
