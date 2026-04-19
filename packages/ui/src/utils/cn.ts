import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Compose tailwind classes with clsx + dedup via tailwind-merge. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
