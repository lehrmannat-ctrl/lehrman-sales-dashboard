import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Auth gate — runs before every page. This is the FIRST of two independent
 * permission layers (the second is Postgres RLS, supabase/migrations/
 * 0002_rls.sql). Never rely on this middleware alone: it protects page
 * navigation and UX, RLS protects the actual data no matter how a request
 * reaches Postgres.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoginPage = request.nextUrl.pathname.startsWith("/login");
  const isPublicApi = request.nextUrl.pathname.startsWith("/api/webhooks");

  if (!user && !isLoginPage && !isPublicApi) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("redirectedFrom", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && isLoginPage) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Owner-only page prefixes. A sales_associate hitting one of these is
  // redirected, not silently shown an empty page — RLS would return empty
  // data anyway, but a clear redirect is a better signal that this isn't a
  // bug, it's a permission boundary.
  const ownerOnlyPrefixes = ["/revenue", "/sources", "/calls", "/forecast", "/settings"];
  if (user && ownerOnlyPrefixes.some((p) => request.nextUrl.pathname.startsWith(p))) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "owner") {
      return NextResponse.redirect(new URL("/daily", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
