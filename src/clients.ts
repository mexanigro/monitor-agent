import type { MonitoredClient } from "./types.js";

export const CLIENTS: MonitoredClient[] = [
  {
    clientId: "demo-barber",
    name: "Demo Barbershop",
    url: "https://barber-shop-template-ten.vercel.app",
    vercelProjectId: "prj_XXXX",
    niche: "barberia",
    active: true,
  },
];

export function getActiveClients(): MonitoredClient[] {
  return CLIENTS.filter((c) => c.active);
}
