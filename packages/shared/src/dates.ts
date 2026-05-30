import { format, formatDistanceToNow, differenceInSeconds } from "date-fns";
import { fr } from "date-fns/locale";
import type { ISODateString } from "./types";

export function formatTimestamp(ts: number, pattern: string = "HH:mm"): string {
  return format(new Date(ts * 1000), pattern, { locale: fr });
}

export function formatTimestampDate(ts: number): string {
  return format(new Date(ts * 1000), "dd MMM", { locale: fr });
}

export function formatTimestampFull(ts: number): string {
  return format(new Date(ts * 1000), "dd MMM yyyy HH:mm", { locale: fr });
}

export function formatRelativeTime(iso: ISODateString): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: fr });
}

export function unixTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

export function secondsAgo(seconds: number): number {
  return unixTimestamp() - seconds;
}

export function computeWindow(rangeSeconds: number): number {
  if (rangeSeconds <= 3600) return 0;
  if (rangeSeconds <= 21600) return 60;
  if (rangeSeconds <= 86400) return 300;
  if (rangeSeconds <= 604800) return 3600;
  if (rangeSeconds <= 2592000) return 21600;
  return 86400;
}
