import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI;
const globalMongo = globalThis as typeof globalThis & { mongoClientPromise?: Promise<MongoClient> };

const clientPromise = uri
  ? globalMongo.mongoClientPromise ?? new MongoClient(uri, { appName: "la-milano-attendance" }).connect()
  : null;

if (clientPromise && process.env.NODE_ENV !== "production") globalMongo.mongoClientPromise = clientPromise;

export async function getDb(): Promise<Db> {
  const client = await getMongoClient();
  return client.db(process.env.MONGODB_DB ?? "attendance_payroll");
}

export async function getMongoClient(): Promise<MongoClient> {
  if (!clientPromise) throw new Error("MONGODB_URI is not configured.");
  return clientPromise;
}