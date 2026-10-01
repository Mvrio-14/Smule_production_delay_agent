// The two demo alerts, shared by the web app and the scripts.
import type { AlertEvent } from "@/lib/agent/run";

export const SCENARIOS = {
  // Night shift: a machine stops. The supervisor knows the cause and how long.
  night: {
    label: "Machine stops at night",
    // At lamination since 22:10 for a 1h30 step: 4h there, 2h30 past plan.
    alert: { type: "order_overdue", order_id: "SM-10401", stage: "laminate", planned_stage_minutes: 90, overdue_minutes: 150, detected_at: "2026-10-02T02:10:00-04:00" },
  },
  // Day shift: a material delivery has not arrived. Only the buyer knows the new date.
  day: {
    label: "Material delivery missing",
    // Waiting at print since 06:40 for a 1h20 step: 4h there, 2h40 past plan.
    alert: { type: "order_overdue", order_id: "SM-10501", stage: "print", planned_stage_minutes: 80, overdue_minutes: 160, detected_at: "2026-10-01T10:40:00-04:00" },
  },
} satisfies Record<string, { label: string; alert: AlertEvent }>;

export type ScenarioId = keyof typeof SCENARIOS;
