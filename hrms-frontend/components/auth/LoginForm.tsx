"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { loginSchema, type LoginFormValues } from "@/lib/validations/authSchema";
import { useLogin } from "@/hooks/useAuth";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "./AuthShell";

const enter = "animate-in fade-in-0 slide-in-from-bottom-3 duration-500 fill-mode-both ease-out";

function LoginFormInner() {
  const searchParams = useSearchParams();
  const login = useLogin();
  const { status } = useSession();
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Where to go once signed in.
   *
   * The middleware appends `?callbackUrl=` when it bounces someone off a
   * protected page, so honouring it puts people back where they were heading
   * instead of always dumping them on the dashboard. Only same-origin paths are
   * accepted — a callbackUrl is attacker-supplied, and following it anywhere
   * else is an open redirect.
   */
  const target = (() => {
    const raw = searchParams.get("callbackUrl");
    if (!raw) return "/dashboard";
    try {
      const url = new URL(raw, window.location.origin);
      if (url.origin !== window.location.origin) return "/dashboard";
      return url.pathname === "/login" ? "/dashboard" : url.pathname + url.search;
    } catch {
      return "/dashboard";
    }
  })();

  /**
   * Leave the sign-in page with a full document load, not a client-side one.
   *
   * This is the fix for "I typed the wrong password, then the right one, and
   * nothing happened until I reloaded". Next's client router caches the result
   * of visiting a route, and a protected route visited without a session caches
   * as the middleware's bounce back to /login. That happens whenever somebody's
   * session dies while the app is open, or a stale session sends them at the
   * dashboard before signing in. `router.replace("/dashboard")` afterwards is
   * then answered from that cache and lands them straight back on the form,
   * with a session that is perfectly valid — which is exactly why reloading
   * "fixed" it.
   *
   * A full load cannot be served from that cache and re-runs the middleware
   * against the cookie that now exists. One page load on sign-in is a fair
   * price for it always working.
   */
  const leaveToApp = () => window.location.assign(target);

  // /login isn't behind the middleware, so an already-signed-in user would
  // otherwise sit here looking signed out.
  useEffect(() => {
    if (status === "authenticated") leaveToApp();
    // leaveToApp closes over `target`, which is derived from the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (data: LoginFormValues) => {
    setSubmitting(true);
    try {
      await login(data.email, data.password);
      toast.success("Welcome back!");
      // Left spinning on purpose — no `finally` resetting it. The full load is
      // already on its way, and flipping back to "Log In" makes a sign-in that
      // worked look like one that failed for the half second before the page
      // changes.
      leaveToApp();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      if (message.toLowerCase().includes("set a new password")) {
        toast.info("Please activate your account first");
        window.location.assign(`/set-password?email=${encodeURIComponent(getValues("email"))}`);
        return;
      }
      toast.error(message);
      setSubmitting(false);
    }
  };

  return (
    <AuthShell>
      <div className={enter}>
        {/* Heading */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-neutral-900">Welcome Back</h1>
          <p className="mt-3 text-sm text-neutral-500">
            Enter your email and password to access your account.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Email */}
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-neutral-700">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              className="h-12 rounded-lg border-neutral-200 bg-white"
              {...register("email")}
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-neutral-700">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                autoComplete="current-password"
                className="h-12 rounded-lg border-neutral-200 bg-white pr-11"
                {...register("password")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-neutral-400 transition-colors hover:text-neutral-700"
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>

          {/* Submit */}
          <Button
            type="submit"
            disabled={submitting}
            className="h-12 w-full rounded-lg text-sm font-semibold"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : (
              "Log In"
            )}
          </Button>

          {/* Activate account (admin-invited users) */}
          <p className="text-center text-sm text-neutral-500">
            First time here?{" "}
            <Link href="/set-password" className="font-semibold text-primary hover:underline">
              Activate your account
            </Link>
          </p>
        </form>
      </div>
    </AuthShell>
  );
}

/**
 * `useSearchParams` needs a Suspense boundary or Next refuses to prerender the
 * route at build time — the same shape the documents and approvals pages use.
 */
export function LoginForm() {
  return (
    <Suspense fallback={<AuthShell><div /></AuthShell>}>
      <LoginFormInner />
    </Suspense>
  );
}
