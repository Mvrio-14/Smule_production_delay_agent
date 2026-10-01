// Deterministic seed: no randomness, fixed ids and dates. Running it twice gives the same data.
// resetDatabase() drops everything, recreates the schema and inserts the seed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "@/lib/db";
import { deliveryDateFor } from "@/lib/ship-dates";

// All seeded times are in October 2026, New York time (EDT, UTC-4).
const TZ_OFFSET = "-04:00";

const sites = [
  { id: "amsterdam", name: "Amsterdam, NY", timezone: "America/New_York" },
  { id: "gaffney", name: "Gaffney, SC", timezone: "America/New_York" },
];

const staff = [
  { id: "ams-supervisor-1st", name: "Dana Whitfield", role: "production_supervisor", site_id: "amsterdam", chat_handle: "@dana.whitfield" },
  { id: "ams-supervisor-2nd", name: "Luis Ortega", role: "production_supervisor", site_id: "amsterdam", chat_handle: "@luis.ortega" },
  { id: "ams-supervisor-3rd", name: "Mike Kowalski", role: "production_supervisor", site_id: "amsterdam", chat_handle: "@mike.kowalski" },
  { id: "ams-factory-manager", name: "Karen Doyle", role: "factory_manager", site_id: "amsterdam", chat_handle: "@karen.doyle" },
  { id: "gaf-supervisor-1st", name: "Tasha Greene", role: "production_supervisor", site_id: "gaffney", chat_handle: "@tasha.greene" },
  { id: "gaf-supervisor-2nd", name: "Brian Holt", role: "production_supervisor", site_id: "gaffney", chat_handle: "@brian.holt" },
  { id: "gaf-supervisor-3rd", name: "Jamal Reed", role: "production_supervisor", site_id: "gaffney", chat_handle: "@jamal.reed" },
  { id: "gaf-factory-manager", name: "Steve Carter", role: "factory_manager", site_id: "gaffney", chat_handle: "@steve.carter" },
  // Purchasing sits at the factory (Sticker Mule has a Purchasing Manager in Amsterdam, NY). Office hours.
  { id: "ams-buyer", name: "Rachel Morgan", role: "buyer", site_id: "amsterdam", chat_handle: "@rachel.morgan" },
  { id: "gaf-buyer", name: "Owen Brooks", role: "buyer", site_id: "gaffney", chat_handle: "@owen.brooks" },
  { id: "support-1", name: "Emma Novak", role: "support_agent", site_id: null, chat_handle: "@emma.novak" },
  { id: "support-2", name: "Ravi Patel", role: "support_agent", site_id: null, chat_handle: "@ravi.patel" },
];

// Shift pattern from Sticker Mule's job postings:
// 1st Mon-Fri 06:00-14:00, 2nd Mon-Fri 14:00-22:00, 3rd Sun-Thu 22:00-06:00.
function shiftAssignments() {
  const rows = [];
  for (let day = 27; day <= 34; day++) {
    // 2026-09-27 (Sunday) to 2026-10-04 (Sunday)
    const d = new Date(Date.UTC(2026, 8, day));
    const date = d.toISOString().slice(0, 10);
    const next = new Date(Date.UTC(2026, 8, day + 1)).toISOString().slice(0, 10);
    const weekday = d.getUTCDay(); // 0 = Sunday
    for (const site of ["amsterdam", "gaffney"]) {
      const prefix = site === "amsterdam" ? "ams" : "gaf";
      if (weekday >= 1 && weekday <= 5) {
        rows.push({ site_id: site, shift: "1st", starts_at: `${date}T06:00:00${TZ_OFFSET}`, ends_at: `${date}T14:00:00${TZ_OFFSET}`, supervisor_id: `${prefix}-supervisor-1st` });
        rows.push({ site_id: site, shift: "2nd", starts_at: `${date}T14:00:00${TZ_OFFSET}`, ends_at: `${date}T22:00:00${TZ_OFFSET}`, supervisor_id: `${prefix}-supervisor-2nd` });
      }
      if (weekday >= 0 && weekday <= 4) {
        rows.push({ site_id: site, shift: "3rd", starts_at: `${date}T22:00:00${TZ_OFFSET}`, ends_at: `${next}T06:00:00${TZ_OFFSET}`, supervisor_id: `${prefix}-supervisor-3rd` });
      }
    }
  }
  return rows;
}

type ShippingMethod = "ups_ground" | "ups_2nd_day_air" | "ups_next_day_air";

type OrderInput = {
  id: string;
  customer_name: string;
  product: string;
  quantity: number;
  site_id: string;
  stage: string;
  machine_id: string;
  stage_started_at: string;
  remaining_minutes: number;
  planned_ship_date: string; // ship date of the original plan
  shipping_method?: ShippingMethod; // default: ground
};

// The promise to the customer is the delivery date of the original plan.
function order({ planned_ship_date, shipping_method = "ups_ground", ...o }: OrderInput) {
  const delivery = deliveryDateFor(planned_ship_date, shipping_method);
  return {
    ...o,
    shipping_method,
    promised_delivery_date: delivery,
    estimated_ship_date: planned_ship_date,
    estimated_delivery_date: delivery,
  };
}

const FRI = "2026-10-02";
const MON = "2026-10-05";
const lam2 = { site_id: "amsterdam", stage: "laminate", machine_id: "laminator-2" };

// The demo scenario: 8 orders on laminator-2 in Amsterdam. SM-10401 is running, the other 7 are queued.
// remaining_minutes comes from the production plan, so it grows with the position in the queue.
// The alert fires on Friday 2026-10-02 at 02:10: SM-10401 has been laminating since 22:10, 4h for a 1h30 step.
// With a 180 min delay from 02:25 (machine back 05:25):
// - 6 orders still arrive on time
// - SM-10407 ships Monday instead of Friday; by ground it arrives late, by 2nd Day Air (+$45) on time: recoverable
// - SM-10408 already ships Next Day Air; it slips to Monday and nothing faster exists: late
const scenarioOrders = [
  order({ id: "SM-10401", customer_name: "Brightside Coffee", product: "Die cut stickers", quantity: 500, ...lam2, stage_started_at: `2026-10-01T22:10:00${TZ_OFFSET}`, remaining_minutes: 300, planned_ship_date: FRI }),
  order({ id: "SM-10402", customer_name: "Northpeak Outfitters", product: "Kiss cut stickers", quantity: 1000, ...lam2, stage_started_at: `2026-10-01T21:40:00${TZ_OFFSET}`, remaining_minutes: 540, planned_ship_date: FRI }),
  order({ id: "SM-10403", customer_name: "Loop Records", product: "Holographic stickers", quantity: 250, ...lam2, stage_started_at: `2026-10-01T22:15:00${TZ_OFFSET}`, remaining_minutes: 650, planned_ship_date: FRI }),
  order({ id: "SM-10404", customer_name: "Fern & Co", product: "Sticker sheets", quantity: 300, ...lam2, stage_started_at: `2026-10-02T00:30:00${TZ_OFFSET}`, remaining_minutes: 900, planned_ship_date: MON }),
  order({ id: "SM-10405", customer_name: "Pixel Forge Games", product: "Die cut stickers", quantity: 2000, ...lam2, stage_started_at: `2026-10-01T22:50:00${TZ_OFFSET}`, remaining_minutes: 400, planned_ship_date: FRI }),
  order({ id: "SM-10406", customer_name: "Tidewater Brewing", product: "Roll labels", quantity: 5000, ...lam2, stage_started_at: `2026-10-02T01:20:00${TZ_OFFSET}`, remaining_minutes: 1000, planned_ship_date: MON }),
  order({ id: "SM-10407", customer_name: "Summit Run Club", product: "Die cut stickers", quantity: 3000, ...lam2, stage_started_at: `2026-10-01T23:45:00${TZ_OFFSET}`, remaining_minutes: 760, planned_ship_date: FRI }),
  order({ id: "SM-10408", customer_name: "Harbor Books", product: "Clear stickers", quantity: 5000, ...lam2, stage_started_at: `2026-10-02T00:10:00${TZ_OFFSET}`, remaining_minutes: 820, planned_ship_date: FRI, shipping_method: "ups_next_day_air" }),
];

// Decoys: same stage, but another machine or another site. They must not be affected.
const decoyOrders = [
  order({ id: "SM-10411", customer_name: "Juniper Yoga", product: "Die cut stickers", quantity: 200, site_id: "amsterdam", stage: "laminate", machine_id: "laminator-1", stage_started_at: `2026-10-02T00:40:00${TZ_OFFSET}`, remaining_minutes: 500, planned_ship_date: FRI }),
  order({ id: "SM-10412", customer_name: "Copper Kettle Diner", product: "Roll labels", quantity: 1000, site_id: "amsterdam", stage: "laminate", machine_id: "laminator-1", stage_started_at: `2026-10-02T01:10:00${TZ_OFFSET}`, remaining_minutes: 700, planned_ship_date: MON }),
  order({ id: "SM-10413", customer_name: "Atlas Cycling", product: "Kiss cut stickers", quantity: 400, site_id: "amsterdam", stage: "laminate", machine_id: "laminator-1", stage_started_at: `2026-10-02T01:35:00${TZ_OFFSET}`, remaining_minutes: 650, planned_ship_date: FRI }),
  order({ id: "SM-10421", customer_name: "Blue Heron Farms", product: "Roll labels", quantity: 2500, site_id: "gaffney", stage: "laminate", machine_id: "laminator-2", stage_started_at: `2026-10-02T00:20:00${TZ_OFFSET}`, remaining_minutes: 600, planned_ship_date: FRI }),
  order({ id: "SM-10422", customer_name: "Nova Robotics", product: "Die cut stickers", quantity: 800, site_id: "gaffney", stage: "laminate", machine_id: "laminator-2", stage_started_at: `2026-10-02T01:50:00${TZ_OFFSET}`, remaining_minutes: 450, planned_ship_date: MON }),
];

// Filler: 37 orders spread over the other machines of both sites, generated by formula.
function fillerOrders() {
  const machines = [
    { site_id: "amsterdam", stage: "print", machine_id: "printer-1" },
    { site_id: "amsterdam", stage: "print", machine_id: "printer-2" },
    { site_id: "amsterdam", stage: "cut", machine_id: "cutter-1" },
    { site_id: "amsterdam", stage: "cut", machine_id: "cutter-2" },
    { site_id: "amsterdam", stage: "pack", machine_id: "packing-1" },
    { site_id: "gaffney", stage: "print", machine_id: "printer-1" },
    { site_id: "gaffney", stage: "laminate", machine_id: "laminator-1" },
    { site_id: "gaffney", stage: "cut", machine_id: "cutter-1" },
    { site_id: "gaffney", stage: "pack", machine_id: "packing-1" },
  ];
  const customers = ["Maple Street Bakery", "Redline Auto Club", "Quiet Pines Camp", "Lumen Labs", "Saltwater Surf Shop", "Oak & Iron Barbers", "Bright Path Tutoring", "Riverbend Market", "Starlight Theater", "Granite Peak Gym", "Golden Hive Honey", "Echo Podcast Studio"];
  const products = ["Die cut stickers", "Kiss cut stickers", "Sticker sheets", "Roll labels", "Clear stickers", "Holographic stickers"];
  const quantities = [100, 250, 500, 1000, 2000, 5000];
  const plannedShip = ["2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"];
  const methods: ShippingMethod[] = ["ups_ground", "ups_ground", "ups_2nd_day_air", "ups_ground", "ups_next_day_air"];

  return Array.from({ length: 37 }, (_, i) => {
    const m = machines[i % machines.length];
    // Work left depends on the stage: less for orders further down the line.
    const base = m.stage === "print" ? 600 : m.stage === "laminate" ? 450 : m.stage === "cut" ? 300 : 60;
    // Reached the current stage between 20:00 and 01:00 the night before the alert.
    const startedAt = new Date(Date.parse(`2026-10-01T20:00:00${TZ_OFFSET}`) + ((i * 47) % 300) * 60_000);
    return order({
      id: `SM-${10431 + i}`,
      customer_name: customers[i % customers.length],
      product: products[i % products.length],
      quantity: quantities[(i * 5) % quantities.length],
      ...m,
      stage_started_at: startedAt.toISOString(),
      remaining_minutes: base + ((i * 37) % 240),
      planned_ship_date: plannedShip[i % plannedShip.length],
      shipping_method: methods[i % methods.length],
    });
  });
}

// Second scenario, during the day: the holographic vinyl delivery due this morning has not arrived.
// The alert fires on Thursday 2026-10-01 at 10:40: SM-10501 waits on printer-1 in Amsterdam since 06:40, 4h for a 1h20 step.
// Only the holographic orders are blocked; the other orders on printer-1 run normally.
// If the buyer says the delivery comes tomorrow at 8:00 (a 1,260 min delay from an 11:00 reply):
// - SM-10501 ships Friday instead of Thursday; 2nd Day Air (+$45) keeps the promised date: recoverable
// - SM-10502 already ships Next Day Air; it arrives Monday instead of Friday: late
// - SM-10503 and SM-10504 still arrive on time
const THU = "2026-10-01";
const ams1 = { site_id: "amsterdam", stage: "print", machine_id: "printer-1" };
const supplierScenarioOrders = [
  order({ id: "SM-10501", customer_name: "Neon Arcade Bar", product: "Holographic stickers", quantity: 1000, ...ams1, stage_started_at: `2026-10-01T06:40:00${TZ_OFFSET}`, remaining_minutes: 240, planned_ship_date: THU }),
  order({ id: "SM-10502", customer_name: "Stellar Skate Co", product: "Holographic stickers", quantity: 500, ...ams1, stage_started_at: `2026-10-01T08:25:00${TZ_OFFSET}`, remaining_minutes: 300, planned_ship_date: THU, shipping_method: "ups_next_day_air" }),
  order({ id: "SM-10503", customer_name: "Moonlight Bakery", product: "Holographic stickers", quantity: 250, ...ams1, stage_started_at: `2026-10-01T09:00:00${TZ_OFFSET}`, remaining_minutes: 400, planned_ship_date: FRI }),
  order({ id: "SM-10504", customer_name: "Riverside Music Fest", product: "Holographic stickers", quantity: 3000, ...ams1, stage_started_at: `2026-10-01T09:30:00${TZ_OFFSET}`, remaining_minutes: 600, planned_ship_date: MON }),
];

export const allOrders = [...scenarioOrders, ...decoyOrders, ...supplierScenarioOrders, ...fillerOrders()];

export async function resetDatabase() {
  if (process.env.DB_SCHEMA) await sql.unsafe(`create schema if not exists ${process.env.DB_SCHEMA}`);
  await sql.unsafe(readFileSync(join(process.cwd(), "db", "schema.sql"), "utf8"));
  await sql`insert into sites ${sql(sites)}`;
  await sql`insert into staff ${sql(staff)}`;
  await sql`insert into shift_assignments ${sql(shiftAssignments())}`;
  await sql`insert into orders ${sql(allOrders)}`;
}

// Puts every order back to its seed state without touching incidents (used by "Simulate alert" in the app,
// so past incidents stay visible).
export async function resetOrders() {
  await sql`
    update orders o set
      shipping_method = v.shipping_method,
      estimated_ship_date = v.estimated_ship_date::date,
      estimated_delivery_date = v.estimated_delivery_date::date,
      estimate_reason = null
    from jsonb_to_recordset(${sql.json(allOrders as never)})
      as v(id text, shipping_method text, estimated_ship_date text, estimated_delivery_date text)
    where o.id = v.id`;
}
