import type { MonitoredClient } from "./types.js";

export const CLIENTS: MonitoredClient[] = [
  {
    clientId: "client_barber_01",
    name: "Barber he Studio",
    url: "https://barber-shop-template-ten.vercel.app",
    vercelProjectId: "prj_WPbUEboAIbVn9Z9Wazukaa9oV0pA",
    niche: "barberia",
    active: true,
  },
];

export function getActiveClients(): MonitoredClient[] {
  return CLIENTS.filter((c) => c.active);
}
