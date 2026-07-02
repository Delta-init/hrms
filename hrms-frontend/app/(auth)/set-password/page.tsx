import { Suspense } from "react";
import { SetPasswordForm } from "@/components/auth/SetPasswordForm";

export const metadata = {
  title: "Activate account · Delta HRMS",
};

export default function SetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <SetPasswordForm />
    </Suspense>
  );
}
