/** P-04 D-P4-4 — el agente con IA sólo corre si MONITOR_AGENT_ENABLED === "true"; por defecto apagado. */
import test from "node:test";
import assert from "node:assert/strict";
import { isAgentEnabled } from "./agent.js";

test("apagado por defecto; sólo la cadena literal true lo enciende", () => {
  assert.equal(isAgentEnabled({}), false);
  assert.equal(isAgentEnabled({ MONITOR_AGENT_ENABLED: "false" }), false);
  assert.equal(isAgentEnabled({ MONITOR_AGENT_ENABLED: "1" }), false);
  assert.equal(isAgentEnabled({ MONITOR_AGENT_ENABLED: "true" }), true);
});
