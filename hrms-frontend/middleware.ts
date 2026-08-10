import { withAuth } from "next-auth/middleware";

// Protect all dashboard app routes. Unauthenticated users are redirected to
// /login (our custom sign-in page).
export default withAuth({
  pages: {
    signIn: "/login",
  },
});

export const config = {
  matcher: [
    "/onboarding",
    "/dashboard/:path*",
    "/employees/:path*",
    "/departments/:path*",
    "/attendance/:path*",
    "/leave/:path*",
    "/regularization/:path*",
    "/payroll/:path*",
    "/work-schedules/:path*",
    // Covers the admin page at /kiosks, not the tablet screen at /kiosk — that
    // one has no login by design and authenticates as a device.
    "/kiosks/:path*",
    "/resignations/:path*",
    "/loans/:path*",
    "/salary-increments/:path*",
    "/organizations/:path*",
    "/users/:path*",
    "/roles/:path*",
    "/settings/:path*",
  ],
};
