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
    "/resignations/:path*",
    "/organizations/:path*",
    "/users/:path*",
    "/roles/:path*",
    "/settings/:path*",
  ],
};
