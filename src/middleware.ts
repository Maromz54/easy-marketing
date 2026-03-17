import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     * - /r/* (link redirect edge routes — handled separately)
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|r/).*)",
  ],
};
