export interface MonitoredClient {
  clientId: string;
  name: string;
  url: string;
  vercelProjectId: string;
  niche: string;
  active: boolean;
  checks?: CheckType[];
}

export interface CheckResult {
  clientId: string;
  checkType: CheckType;
  success: boolean;
  responseTimeMs: number;
  statusCode?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export type CheckType = "http" | "api" | "firestore" | "booking";

export type Severity = "warning" | "critical";

export interface Incident {
  clientId: string;
  severity: Severity;
  checkType: CheckType;
  description: string;
  claudeDiagnosis?: string;
  actionTaken?: string;
}

export interface MetricRow {
  id: number;
  client_id: string;
  check_type: CheckType;
  response_time_ms: number | null;
  status_code: number | null;
  success: boolean;
  error: string | null;
  metadata: Record<string, unknown> | null;
  checked_at: Date;
}

export interface BaselineRow {
  client_id: string;
  check_type: CheckType;
  avg_response_time_ms: number;
  p95_response_time_ms: number;
  success_rate: number;
  computed_at: Date;
}

export interface Anomaly {
  clientId: string;
  checkType: CheckType;
  severity: Severity;
  description: string;
}
