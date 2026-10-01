// The two demo alerts, shared by the web app and the scripts. An alert only says which order is stuck
// at which stage: the cause is whatever the tester answers as factory staff.
import type { AlertEvent } from "@/lib/agent/run";

export const SCENARIOS = {
  // Night shift. The scripted story (scripts, evals) is a laminating machine down.
  night: {
    label: "Order stuck at laminating",
    // At lamination since 22:10 for a 1h30 step: 4h there, 2h30 past plan.
    alert: { type: "order_overdue", order_id: "SM-10401", stage: "laminate", job_started: true, planned_stage_minutes: 90, overdue_minutes: 150, detected_at: "2026-10-02T02:10:00-04:00" },
  },
  // Day shift. The scripted story is a material delivery that has not arrived; the buyer knows the date.
  day: {
    label: "Order not started at printing",
    // Waiting since 06:40 to be printed, never started, for a 1h20 step: 4h there, 2h40 past plan.
    alert: { type: "order_overdue", order_id: "SM-10501", stage: "print", job_started: false, planned_stage_minutes: 80, overdue_minutes: 160, detected_at: "2026-10-01T10:40:00-04:00" },
  },
} satisfies Record<string, { label: string; alert: AlertEvent }>;

export type ScenarioId = keyof typeof SCENARIOS;
