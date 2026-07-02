"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import axios from "axios";
import { setPasswordSchema, type SetPasswordFormValues } from "@/lib/validations/authSchema";
import { useLogin } from "@/hooks/useAuth";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "./AuthShell";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5055/api/v1";
const enter = "animate-in fade-in-0 slide-in-from-bottom-3 duration-500 fill-mode-both ease-out";

export function SetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const login = useLogin();
  const [showNew, setShowNew] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SetPasswordFormValues>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: {
      email: params.get("email") ?? "",
      temporaryPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (data: SetPasswordFormValues) => {
    setSubmitting(true);
    try {
      await axios.post(`${API_URL}/auth/set-password`, {
        email: data.email,
        temporaryPassword: data.temporaryPassword,
        newPassword: data.newPassword,
      });
      toast.success("Account activated!");
      await login(data.email, data.newPassword);
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err instanceof Error ? err.message : "Could not activate account");
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = "h-12 rounded-lg border-neutral-200 bg-white";

  return (
    <AuthShell>
      <div className={enter}>
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-neutral-900">Activate Account</h1>
          <p className="mt-3 text-sm text-neutral-500">
            Set your own password using the temporary one your admin gave you.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-neutral-700">Email</Label>
            <Input id="email" type="email" placeholder="you@company.com" className={inputCls} {...register("email")} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="temporaryPassword" className="text-neutral-700">Temporary Password</Label>
            <Input
              id="temporaryPassword"
              type="password"
              placeholder="The password your admin issued"
              className={inputCls}
              {...register("temporaryPassword")}
            />
            {errors.temporaryPassword && (
              <p className="text-xs text-destructive">{errors.temporaryPassword.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="newPassword" className="text-neutral-700">New Password</Label>
            <div className="relative">
              <Input
                id="newPassword"
                type={showNew ? "text" : "password"}
                placeholder="Min 8 chars, upper, lower, number"
                className={`${inputCls} pr-11`}
                {...register("newPassword")}
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-neutral-400 transition-colors hover:text-neutral-700"
                tabIndex={-1}
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.newPassword && <p className="text-xs text-destructive">{errors.newPassword.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword" className="text-neutral-700">Confirm New Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="Re-enter your new password"
              className={inputCls}
              {...register("confirmPassword")}
            />
            {errors.confirmPassword && (
              <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
            )}
          </div>

          <Button
            type="submit"
            disabled={submitting}
            className="h-12 w-full rounded-lg text-sm font-semibold"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Activating...
              </>
            ) : (
              "Activate & Sign In"
            )}
          </Button>

          <p className="text-center text-sm text-neutral-500">
            Already activated?{" "}
            <Link href="/login" className="font-semibold text-primary hover:underline">
              Back to sign in
            </Link>
          </p>
        </form>
      </div>
    </AuthShell>
  );
}
