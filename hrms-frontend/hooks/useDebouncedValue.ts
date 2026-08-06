"use client";
import { useEffect, useState } from "react";

/**
 * Trailing-edge debounce for a changing value.
 *
 * Used by the async pickers so typing issues one request after the user pauses
 * rather than one per keystroke.
 */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return debounced;
}
