"use client";
// Dashboard: headline numbers, then one row per real incident (like the call history of agent platforms).
import { useEffect, useState } from "react";
import { BadgeCheck, Clock, Coins, Mail, ThumbsUp, Truck } from "lucide-react";
import { Stat, StatusBadge } from "@/app/ui/parts";
import type { DashboardData } from "@/app/ui/types";

function minutes(m: number | null): string {
  if (m === null) return "—";
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

export function Dashboard({ onOpen }: { onOpen: (incidentId: number) => void }) {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) return <p className="p-10 text-sm text-zinc-500">Loading…</p>;
  const k = data.kpis;
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  return (
    <div className="max-w-6xl px-10 pb-40 pt-8">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Dashboard</h1>
      <p className="mt-1 text-sm text-zinc-500">Real incidents only. Scripted test scenarios are in their own tab.</p>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label="Incidents handled"
          icon={<BadgeCheck className="size-3.5" />}
          value={k.handled}
          note={k.handled ? `${k.successful} successful (${pct(k.successful / k.handled)})` : "No incident yet"}
        />
        <Stat label="Customers warned early" icon={<Mail className="size-3.5" />} value={k.warned_early} note="before their promised date" />
        <Stat label="Orders saved by an upgrade" icon={<Truck className="size-3.5" />} value={k.upgrades} note={`$${k.upgrade_spend} of upgrades`} />
        <Stat
          label="Support approval rate"
          icon={<ThumbsUp className="size-3.5" />}
          value={k.approval_rate === null ? "—" : pct(k.approval_rate)}
          note={`${k.decided} proposal${k.decided === 1 ? "" : "s"} decided`}
        />
        <Stat
          label="Avg time to brief support"
          icon={<Clock className="size-3.5" />}
          value={k.avg_minutes_to_support === null ? "—" : minutes(Math.round(k.avg_minutes_to_support))}
          note="from the alert"
        />
        <Stat
          label="Avg cost per incident"
          icon={<Coins className="size-3.5" />}
          value={k.avg_cost === null ? "—" : `$${k.avg_cost.toFixed(3)}`}
          note={k.avg_tokens === null ? "" : `~${Math.round(k.avg_tokens).toLocaleString()} tokens`}
        />
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <div className="border-b border-zinc-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-zinc-900">Incident history</h2>
        </div>
        {data.incidents.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-zinc-400">No incident yet. Simulate an alert from the Incidents tab.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                  {["#", "Date", "Cause", "Result", "Duration", "Messages", "Tool calls", "Human touches", "Late orders", "Tokens", "Cost"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.incidents.map((i) => (
                  <tr key={i.id} onClick={() => onOpen(i.id)} className="cursor-pointer text-zinc-700 transition hover:bg-zinc-50">
                    <td className="px-4 py-3 font-medium text-zinc-900">{i.id}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-500">
                      {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(i.created_at))}
                    </td>
                    <td className="max-w-56 truncate px-4 py-3" title={i.cause ?? undefined}>
                      {i.cause ?? <span className="text-zinc-400">Not entered</span>}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={i.status} />
                    </td>
                    <td className="px-4 py-3 tabular-nums">{minutes(i.duration_min)}</td>
                    <td className="px-4 py-3 tabular-nums">{i.messages}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {i.tool_calls}
                      {i.tool_errors > 0 && <span className="ml-1 text-xs text-red-600">({i.tool_errors} err)</span>}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{i.human_touches}</td>
                    <td className="px-4 py-3 tabular-nums">{i.late_orders === null ? "—" : `${i.late_orders} / ${i.affected_orders}`}</td>
                    <td className="px-4 py-3 tabular-nums">{i.tokens.toLocaleString()}</td>
                    <td className="px-4 py-3 tabular-nums">${i.cost.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
