import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string) {
  if (Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("Password exceeds bcrypt's 72-byte limit.");
  }
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, passwordHash: string) {
  if (Buffer.byteLength(password, "utf8") > 72) return false;
  return bcrypt.compare(password, passwordHash);
}