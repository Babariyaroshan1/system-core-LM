import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";

export function apiError(error: unknown) {
  unstable_rethrow(error);
  if (error instanceof ZodError)
    return NextResponse.json(
      {
        error: "Invalid request.",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  if (error instanceof SyntaxError)
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  if (error instanceof Error && error.message === "OUTLET_FORBIDDEN")
    return NextResponse.json(
      { error: "You do not have access to this outlet." },
      { status: 403 },
    );
  if (error instanceof Error && error.message === "CSRF_REJECTED")
    return NextResponse.json(
      { error: "Cross-site request rejected." },
      { status: 403 },
    );
  if (error instanceof Error && error.message === "NOT_FOUND")
    return NextResponse.json({ error: "Record not found." }, { status: 404 });
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  )
    return NextResponse.json(
      { error: "A record with this unique value already exists." },
      { status: 409 },
    );
  const errorDetails =
    error instanceof Error
      ? { name: error.name, message: error.message }
      : error;
  console.error("API request failed", errorDetails);
  return NextResponse.json(
    {
      error: "The request could not be completed.",
      ...(process.env.NODE_ENV === "development" && error instanceof Error
        ? { details: error.message }
        : {}),
    },
    { status: 500 },
  );
}

export async function readJson<T>(request: Request): Promise<T> {
  assertSameOrigin(request);
  return (await request.json()) as T;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) throw new Error("CSRF_REJECTED");
  const expected = process.env.NEXTAUTH_URL
    ? new URL(process.env.NEXTAUTH_URL).origin
    : new URL(request.url).origin;
  let received: string;
  try {
    received = new URL(origin).origin;
  } catch {
    throw new Error("CSRF_REJECTED");
  }
  if (received !== expected) throw new Error("CSRF_REJECTED");
}
