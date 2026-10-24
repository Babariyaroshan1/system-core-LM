import { MongoClient, ObjectId } from "mongodb";
import bcrypt from "bcryptjs";

const uri = process.env.MONGODB_URI;
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim();
const username = process.env.ADMIN_USERNAME?.trim();
const password = process.env.ADMIN_PASSWORD;
if (!uri || !email || !name || !username || !password) throw new Error("Set MONGODB_URI, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME, ADMIN_USERNAME, and ADMIN_PASSWORD in .env.local.");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("BOOTSTRAP_ADMIN_EMAIL must be a valid email address.");
if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) throw new Error("ADMIN_USERNAME must be 3-32 letters, numbers, dots, underscores, or hyphens.");
if (password.length < 10 || Buffer.byteLength(password, "utf8") > 72) throw new Error("ADMIN_PASSWORD must be at least 10 characters and no more than 72 UTF-8 bytes.");

const client = new MongoClient(uri, { appName: "la-milano-attendance-bootstrap" });
try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "attendance_payroll");
  const users = db.collection("users");
  await users.createIndex(
    { usernameNormalized: 1 },
    {
      unique: true,
      partialFilterExpression: { usernameNormalized: { $type: "string" } },
      name: "users_username_normalized_unique",
    },
  );
  const existingAdmin = await users.findOne({ role: "MAIN_ADMIN", active: true });
  if (existingAdmin && existingAdmin.emailNormalized !== email) throw new Error("An active MAIN_ADMIN already exists for another email. Bootstrap will not replace or demote that account.");
  const now = new Date();
  const existingUser = await users.findOne({ emailNormalized: email });
  const passwordHash = await bcrypt.hash(password, 12);
  if (existingUser) {
    if (existingUser.usernameNormalized) {
      const usernameOwner = await users.findOne({
        usernameNormalized: existingUser.usernameNormalized,
        _id: { $ne: existingUser._id },
      });
      if (usernameOwner) throw new Error("The existing administrator username conflicts with another user.");
    } else {
      const usernameOwner = await users.findOne({ usernameNormalized: username.toLowerCase() });
      if (usernameOwner) throw new Error("ADMIN_USERNAME is already assigned to another user.");
    }
    const set = { role: "MAIN_ADMIN", active: true, updatedAt: now };
    const firstCredentialBootstrap = !existingUser.usernameNormalized;
    if (firstCredentialBootstrap) {
      set.username = username;
      set.usernameNormalized = set.username.toLowerCase();
    }
    if (firstCredentialBootstrap || !existingUser.passwordHash) set.passwordHash = passwordHash;
    await users.updateOne({ _id: existingUser._id }, { $set: set });
  } else {
    if (await users.findOne({ usernameNormalized: username.toLowerCase() })) throw new Error("ADMIN_USERNAME is already assigned to another user.");
    await users.insertOne({
      _id: new ObjectId(),
      email,
      emailNormalized: email,
      username,
      usernameNormalized: username.toLowerCase(),
      name,
      passwordHash,
      role: "MAIN_ADMIN",
      outletIds: [],
      permissions: [],
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  console.log("MAIN_ADMIN credential account is ready. Existing credentials were preserved.");
} finally { await client.close(); }
