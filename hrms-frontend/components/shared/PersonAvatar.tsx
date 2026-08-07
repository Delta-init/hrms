"use client";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { getInitials, cn } from "@/lib/utils";

interface Props {
  name: string;
  /** Servable photo URL. Absent or empty falls back to initials. */
  photoUrl?: string | null;
  className?: string;
  /** Styles the initials tile — size classes belong on `className`. */
  fallbackClassName?: string;
}

/**
 * A person's face, or their initials when there isn't one.
 *
 * Photos were being stored and never shown: every avatar in the app drew
 * initials because the employee record carried a storage key rather than
 * something a browser could render. Radix's Avatar handles the fallback, so a
 * broken or slow image degrades to initials rather than an empty circle.
 */
export function PersonAvatar({ name, photoUrl, className, fallbackClassName }: Props) {
  return (
    <Avatar className={cn("h-10 w-10", className)}>
      {photoUrl ? <AvatarImage src={photoUrl} alt={name} className="object-cover" /> : null}
      <AvatarFallback className={cn("bg-primary font-bold text-primary-foreground", fallbackClassName)}>
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
