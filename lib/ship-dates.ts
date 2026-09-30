// Date rules of the simulated production and shipping systems.
// In real life these answers come from Sticker Mule's production system and the UPS API.
// Dates are 'YYYY-MM-DD' strings. Holidays are ignored.

export const UPS_PICKUP_HOUR = 17; // an order ready before 17:00 local time ships the same weekday

export const SHIPPING_METHODS = ["ups_ground", "ups_2nd_day_air", "ups_next_day_air"] as const;
export type ShippingMethod = (typeof SHIPPING_METHODS)[number];

// Simulated UPS answers: transit time in business days and extra cost versus ground.
export const TRANSIT_DAYS: Record<ShippingMethod, number> = {
  ups_ground: 3,
  ups_2nd_day_air: 2,
  ups_next_day_air: 1,
};
export const EXTRA_COST_USD: Record<ShippingMethod, number> = {
  ups_ground: 0,
  ups_2nd_day_air: 45,
  ups_next_day_air: 85,
};

// Local date and time of an instant in a site's timezone.
export function localParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour")}:${get("minute")}`;
  return { date, time, hour: Number(get("hour")), label: `${date} ${time}` };
}

export function isWeekday(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

// Adds n weekdays to a date (Saturday and Sunday are skipped).
export function addWeekdays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isWeekday(d.toISOString().slice(0, 10))) added++;
  }
  return d.toISOString().slice(0, 10);
}

// Ship date for an order that is ready at `readyAt`.
export function shipDateFor(readyAt: Date, timeZone: string): string {
  const { date, hour } = localParts(readyAt, timeZone);
  if (isWeekday(date) && hour < UPS_PICKUP_HOUR) return date;
  return addWeekdays(date, 1);
}

export function deliveryDateFor(shipDate: string, method: ShippingMethod): string {
  return addWeekdays(shipDate, TRANSIT_DAYS[method]);
}
