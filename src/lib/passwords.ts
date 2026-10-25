import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";

const BCRYPT_ROUNDS = 12;
const MAX_PASSWORD_LENGTH = 1024;
const PASSWORD_HASH_PREFIX = "sha256$";

function preparePassword(password: string) {
  return createHash("sha256")
    .update("la-milano-attendance-password-v1\0")
    .update(password, "utf8")
    .digest("hex");
}

export async function hashPassword(password: string) {
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Password must not exceed ${MAX_PASSWORD_LENGTH} characters.`);
  }
  return `${PASSWORD_HASH_PREFIX}${await bcrypt.hash(
    preparePassword(password),
    BCRYPT_ROUNDS,
  )}`;
}

export async function verifyPassword(password: string, passwordHash: string) {
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  if (passwordHash.startsWith(PASSWORD_HASH_PREFIX)) {
    return bcrypt.compare(
      preparePassword(password),
      passwordHash.slice(PASSWORD_HASH_PREFIX.length),
    );
  }
  if (Buffer.byteLength(password, "utf8") > 72) return false;
  return bcrypt.compare(password, passwordHash);
}