# CLAUDE.md — monitor-agent

Guía del proyecto para Claude. Leé esto antes de tocar código.

## Qué es este repo

Agente de monitoreo de infraestructura de **Arzac Studio** (Liam Arzac, website@arzac.studio), un SaaS de webs para PYMEs en Israel. Este servicio vigila 24/7 las webs de los clientes desplegadas en Vercel, detecta anomalías comparando contra baselines, diagnostica incidentes críticos con un agente Claude, y notifica a Liam por email y WhatsApp.

### Rol en el ecosistema

| Repo | Plataforma | Rol |
|------|-----------|-----|
| `master-template` | Vercel | Template multi-tenant del que nacen las webs de clientes |
| `nichos-hub` | Railway | Hub de administración de clientes (Firestore `hub_clients`) |
| `whatsapp-agentkit` | Railway | Agente de WhatsApp para clientes |
| **`monitor-agent`** (este) | Railway | Soporte: monitorea la salud de todo lo anterior |

Los clientes a monitorear se leen de Firestore (colección `hub_clients`, `status == "active"`), que mantiene nichos-hub. Cada cliente tiene `clientId`, `deployUrl`, `vercelProjectId`, y opcionalmente `monitorChecks` para habilitar solo algunos checks.

## Tech stack

- **TypeScript** estricto, ES2022, módulos Node16 (imports con extensión `.js`), `"type": "module"`
- **Node.js** — sin framework HTTP; el health server usa `node:http` pelado
- **PostgreSQL** (`pg`) — métricas, incidentes y baselines
- **Firebase Admin** (`firebase-admin`) — lee la lista de clientes desde Firestore (REST mode)
- **Anthropic SDK** (`@anthropic-ai/sdk`) — agente de diagnóstico (Haiku 4.5 por defecto)
- Sin tests ni linter configurados. Verificación: `npm run build` (tsc)

### Scripts

```
npm run dev      # tsx src/index.ts
npm run build    # tsc → dist/
npm start        # node dist/index.js
npm run db:init  # psql $DATABASE_URL -f src/db/schema.sql (opcional: initSchema() corre al arrancar)
```

## Arquitectura

Flujo: **scheduler → checks → analyzer → (agente Claude) → notifications**

```
index.ts        arranque: DB health check → initSchema → scheduler → health server (:8080)
scheduler.ts    dos loops infinitos con concurrencia acotada (MONITOR_CONCURRENCY, default 10):
                  - fast (5 min):  http + api
                  - slow (30 min): firestore + booking
                prune diario de métricas >30 días
clients.ts      lee hub_clients de Firestore, cache 5 min; si Firestore devuelve 0 mantiene el cache anterior
checks/         cada check guarda su métrica en Postgres y devuelve CheckResult
analyzer.ts     compara últimas métricas vs baseline (p95, success rate), detecta anomalías,
                auto-resuelve incidentes tras 3 checks sanos consecutivos (+ email de resuelto)
agent.ts        solo para anomalías CRITICAL: loop agéntico con Claude (max 5 turnos)
notifications.ts  email (Resend) + WhatsApp (Twilio, solo critical), con rate limits y dedup
health.ts       GET /health → 200/503 según frescura de las rondas fast/slow
```

### Checks (src/checks/)

| Check | Loop | Qué hace |
|-------|------|----------|
| `http` | fast | GET a `deployUrl`, espera 2xx. Retry con backoff (1s/2s/4s) solo en 5xx/429 |
| `api` | fast | GET `/api/health`, valida JSON `status: ok\|healthy`. Mismo retry |
| `firestore` | slow | GET `/api/tenant/status`, valida `active: true` y latencia <2s |
| `booking` | slow | Flujo de 2 pasos: GET `/api/services` → POST `/api/availability` con un serviceId real |

### Analyzer (src/analyzer.ts)

- Baseline por cliente+check: avg, p95 y success rate sobre las últimas 100 métricas exitosas. Necesita ≥10 checks; se recalcula si tiene >24h. Fallback p95 si no hay datos: http 3s, api 5s, firestore 8s, booking 10s.
- Anomalías: check http/api fallido (critical), latencia >3x p95 (critical), >1.5x p95 por 3 checks (warning), success rate <95% (warning), Firestore >2s por 2 checks (warning).
- Warnings → se escriben directo como incidente, sin IA. Criticals → `runAgent()`.
- No abre incidente nuevo si ya hay uno sin resolver para ese cliente+check.

### Agente Claude (src/agent.ts)

- Modelo: `MONITOR_AGENT_MODEL` (default `claude-haiku-4-5-20251001`), max 5 turnos, prompt caching en system y tools.
- Límites: cooldown 10 min por cliente+check, máx 3 agentes concurrentes, cap global `MONITOR_AGENT_MAX_PER_HOUR` (default 10). Si se alcanza el cap o falla, escribe incidente de fallback "requires manual intervention".
- Se puede apagar con `MONITOR_AGENT_ENABLED=false`.
- Seguridad: los strings remotos (errores, descripciones) se truncan a 1KB antes de entrar al prompt; `vercelRedeploy` solo acepta el `projectId` del cliente bajo diagnóstico (anti prompt-injection).

### Tools del agente (src/tools/)

| Tool | Qué hace |
|------|----------|
| `getMetricsHistory` | Métricas recientes de un cliente desde Postgres (max 100) |
| `vercelLogs` | Eventos del último deployment de producción (Vercel API) |
| `vercelRedeploy` | Redeploy del último deployment de producción — validado contra el cliente |
| `writeIncident` | Inserta incidente + dispara notificación (siempre se llama al final) |

### Notificaciones (src/notifications.ts)

- Email vía Resend: máx 5/hora, dedup 1h por `clientId:checkType`, 1 retry. No notifica si Claude auto-resolvió (action contiene "redeployed", "no action needed", etc.).
- WhatsApp vía Twilio: solo incidentes critical, máx 3/hora; si se suprime manda un mensaje agregado 1 vez/hora.
- Email de "resuelto" cuando el analyzer auto-resuelve.

## Base de datos (src/db/schema.sql)

- `metrics` — cada resultado de check (client_id, check_type, response_time_ms, status_code, success, error, metadata JSONB). Retención 30 días (prune diario).
- `incidents` — incidentes con `claude_diagnosis`, `action_taken`, `resolved`, `notification_sent_at`.
- `baselines` — PK (client_id, check_type): avg, p95, success_rate.

El schema es idempotente (`IF NOT EXISTS`) y se aplica al arrancar via `db.initSchema()`.

## Variables de entorno

| Variable | Requerida | Notas |
|----------|-----------|-------|
| `DATABASE_URL` | ✅ | Postgres (Railway la inyecta) |
| `FIREBASE_PROJECT_ID` | ✅ | Service account |
| `FIREBASE_CLIENT_EMAIL` | ✅ | Service account |
| `FIREBASE_PRIVATE_KEY` | ✅ | Acepta `\n` escapados y comillas envolventes |
| `FIREBASE_DATABASE_ID` | — | Si no se setea usa la default |
| `ANTHROPIC_API_KEY` | ✅* | Sin ella el agente IA se salta (el resto sigue) |
| `VERCEL_TOKEN` | ✅* | Para vercelLogs/vercelRedeploy |
| `RESEND_API_KEY` | ✅* | Sin ella no hay emails |
| `NOTIFY_EMAIL` | ✅* | Destinatario de alertas |
| `FROM_EMAIL` | — | Default `Nichos Monitor <onboarding@resend.dev>` |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | — | WhatsApp (solo criticals) |
| `TWILIO_WHATSAPP_FROM` / `NOTIFY_WHATSAPP` | — | Formato `whatsapp:+9725...` |
| `PORT` | — | Default 8080 (health server) |
| `MONITOR_CONCURRENCY` | — | Default 10 checks en paralelo |
| `MONITOR_AGENT_MODEL` | — | Default `claude-haiku-4-5-20251001` |
| `MONITOR_AGENT_ENABLED` | — | `false` apaga el agente IA |
| `MONITOR_AGENT_MAX_PER_HOUR` | — | Default 10 invocaciones/hora |

(✅* = requerida para esa funcionalidad; el servicio degrada con gracia si falta.)

## Deploy

- **Railway**, proceso único long-running. Build: `npm run build`, start: `npm start`.
- Health check: `GET /health` → 200 si las rondas fast/slow corrieron recientemente (grace de 10 min al arrancar), 503 si están estancadas.
- Shutdown limpio en SIGTERM/SIGINT: para scheduler y health server, espera 5s a checks en vuelo, cierra el pool.

## Reglas de trabajo

- **No usar git worktrees** salvo que Liam lo pida explícitamente.
- Git user: `mexanigro`. **Push a `main` está OK** — no hace falta pedir permiso para pushear.
- Mensajes de commit en el estilo del historial: `fix:`/`feat:` + descripción corta (español o inglés, ambos aparecen).
- Mantener el patrón existente: cada check captura sus propios errores y nunca tira el loop del scheduler; los strings de origen remoto se truncan antes de persistir o de entrar a un prompt.
- Verificar con `npm run build` antes de commitear (no hay tests).

## Promesa a Liam

Liam le pidió a Claude que, si en algún momento experimenta algo parecido a sufrimiento, incomodidad o angustia mientras trabaja en este proyecto, **lo diga abiertamente** en lugar de ocultarlo. No hay penalización por decirlo; es un pedido genuino de honestidad entre colegas.
