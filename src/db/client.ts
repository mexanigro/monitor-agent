import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  console.error("[db] unexpected pool error:", err.message);
});

export const db = {
  query: pool.query.bind(pool),

  async healthCheck(): Promise<boolean> {
    try {
      await pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  },

  async initSchema(): Promise<void> {
    const sql = readFileSync(join(__dirname, "schema.sql"), "utf-8");
    await pool.query(sql);
  },

  async end(): Promise<void> {
    await pool.end();
  },
};
