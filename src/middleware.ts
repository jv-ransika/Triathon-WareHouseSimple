import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

const PUBLIC = ["/login", "/register"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const userId = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const isPublic = PUBLIC.includes(pathname);

  if (!userId && !isPublic) return NextResponse.redirect(new URL("/login", req.url));
  if (userId && isPublic) return NextResponse.redirect(new URL("/dashboard", req.url));
  return NextResponse.next();
}

// API routes authenticate with API keys inside the handlers.
export const config = { matcher: ["/((?!api/|_next/|favicon.ico).*)"] };
