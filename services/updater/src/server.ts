import { mkdirSync } from "node:fs";
import { serve } from "@hono/node-server";

// Optional local .env next to services/updater (or dist/../.env in a packaged
// deployment). Existing process environment variables take precedence.
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {
  // .env is optional; production supplies real environment variables.
}
import { createApp, cleanupUpdateEvents } from "./app.js";
import { loadConfig } from "./config.js";
import { closeDatabase, openDatabase } from "./db.js";

const config = loadConfig();
mkdirSync(config.artifactRoot, { recursive: true });
const db = openDatabase(config.dbPath);
const app = createApp({ db, config });

cleanupUpdateEvents(db, config.eventRetentionDays);
const cleanupTimer = setInterval(() => {
  try {
    const removed = cleanupUpdateEvents(db, config.eventRetentionDays);
    if (removed > 0) {
      console.log(JSON.stringify({ level: "info", event: "update_events_cleanup", removed }));
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "update_events_cleanup_failed",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}, 3600_000);
cleanupTimer.unref();

if (!config.adminToken) {
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "admin_auth_disabled",
      message: "ORDERHUB_UPDATER_ADMIN_TOKEN is not set; release administration returns 503.",
    }),
  );
}

const server = serve(
  {
    fetch: app.fetch,
    hostname: config.host,
    port: config.port,
  },
  (info) => {
    console.log(
      JSON.stringify({
        level: "info",
        event: "listening",
        host: config.host,
        port: info.port,
        artifact_root: config.artifactRoot,
        db: config.dbPath,
        admin_auth: Boolean(config.adminToken),
      }),
    );
  },
);

function shutdown(signal: string): void {
  console.log(JSON.stringify({ level: "info", event: "shutdown", signal }));
  clearInterval(cleanupTimer);
  server.close(() => {
    closeDatabase(db);
    process.exit(0);
  });
  setTimeout(() => {
    closeDatabase(db);
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
