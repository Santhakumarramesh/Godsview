import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | undefined | null) {
  if (value === undefined || value === null) return "-";
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(value: number | undefined | null, decimals = 2) {
  if (value === undefined || value === null) return "-";
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatPercent(value: number | undefined | null) {
  if (value === undefined || value === null) return "-";
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value / 100);
}

export function getStatusColor(status: string) {
  switch (status.toLowerCase()) {
    case 'approved':
    case 'win':
    case 'active':
    case 'healthy':
      return 'bg-success/20 text-success border-success/30';
    case 'rejected':
    case 'loss':
    case 'error':
    case 'degraded':
    case 'offline':
      return 'bg-destructive/20 text-destructive border-destructive/30';
    case 'pending':
    case 'open':
    case 'warning':
      return 'bg-warning/20 text-warning border-warning/30';
    case 'executed':
      return 'bg-primary/20 text-primary border-primary/30';
    default:
      return 'bg-muted text-muted-foreground border-muted';
  }
}
