import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI;
const globalMongo = globalThis as typeof globalThis & { mongoClientPromise?: Promise<MongoClient> };

let clientPromise: Promise<MongoClient> | undefined;

function getClientPromise(): Promise<MongoClient> {
  if (!uri) throw new Error("MONGODB_URI is not configured.");

  const cachedPromise =
    process.env.NODE_ENV !== "production"
      ? globalMongo.mongoClientPromise
      : clientPromise;
  if (cachedPromise) return cachedPromise;

  const connection = new MongoClient(uri, {
    appName: "la-milano-attendance",
  }).connect();
  const entry: { promise?: Promise<MongoClient> } = {};
  const retryableConnection = connection.catch((error: unknown) => {
    if (clientPromise === entry.promise) clientPromise = undefined;
    if (globalMongo.mongoClientPromise === entry.promise)
      delete globalMongo.mongoClientPromise;
    throw error;
  });
  entry.promise = retryableConnection;

  clientPromise = retryableConnection;
  if (process.env.NODE_ENV !== "production")
    globalMongo.mongoClientPromise = retryableConnection;
  return retryableConnection;
}

export async function getDb(): Promise<Db> {
  const client = await getMongoClient();
  return client.db(process.env.MONGODB_DB ?? "attendance_payroll");
}

export async function getMongoClient(): Promise<MongoClient> {
  return getClientPromise();
}