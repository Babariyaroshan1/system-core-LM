import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { AuditLogDocument } from "@/lib/models";

export async function writeAudit(input: Omit<AuditLogDocument, "_id" | "at">) {
  const db = await getDb();
  await db.collection<AuditLogDocument>("auditLogs").insertOne({ _id: new ObjectId(), ...input, at: new Date() });
}

export function idString(id: ObjectId | string) { return String(id); }