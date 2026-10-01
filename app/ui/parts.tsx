// Small shared UI pieces: status badge, avatar, stat card.
import type { ReactNode } from "react";
import { STATUS_LABELS, type Status } from "@/app/ui/types";

const STATUS_STYLES: Record<Status, { dot: string; badge: string }> = {
  running: { dot: "bg-sky-500 animate-pulse", badge: "bg-sky-50 text-sky-700 ring-sky-200" },
  waiting_for_reply: { dot: "bg-amber-500", badge: "bg-amber-50 text-amber-700 ring-amber-200" },
  waiting_for_approval: { dot: "bg-violet-500", badge: "bg-violet-50 text-violet-700 ring-violet-200" },
  resolved: { dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  failed: { dot: "bg-red-500", badge: "bg-red-50 text-red-700 ring-red-200" },
};

export function StatusDot({ status }: { status: Status }) {
  return <span className={`inline-block size-2 shrink-0 rounded-full ${STATUS_STYLES[status].dot}`} />;
}

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[status].badge}`}>
      <StatusDot status={status} />
      {STATUS_LABELS[status]}
    </span>
  );
}

// Initials on a soft colored circle, stable per name.
const AVATAR_COLORS = ["bg-amber-100 text-amber-800", "bg-sky-100 text-sky-800", "bg-emerald-100 text-emerald-800", "bg-rose-100 text-rose-800", "bg-violet-100 text-violet-800"];

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const color = AVATAR_COLORS[[...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  const dims = size === "sm" ? "size-7 text-[11px]" : "size-9 text-xs";
  return <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${dims} ${color}`}>{initials}</span>;
}

export function Stat({ label, value, icon }: { label: string; value: ReactNode; icon: ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tracking-tight text-zinc-900">{value}</div>
    </div>
  );
}

// The agent's avatar: Sticker Mule's mule in the brand orange, no background. It pulses while the agent works.
export function AgentOrb({ size = "md", active = false }: { size?: "sm" | "md"; active?: boolean }) {
  const dims = size === "sm" ? "size-7" : "size-8";
  return (
    <span className={`inline-flex shrink-0 items-center justify-center ${dims}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/agent-mule.svg" alt="" className={`size-[80%] ${active ? "animate-pulse" : ""}`} />
    </span>
  );
}

// Sticker Mule brand mark: their mule on the brand brown.
export function BrandMark() {
  return (
    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#4e2817]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/sticker-mule-logo.svg" alt="Sticker Mule" className="size-5" />
    </span>
  );
}
