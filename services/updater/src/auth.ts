import { timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "./types.js";
import { AppError } from "./errors.js";

function readBearer(c: Context<AppEnv>): string {
  const header = c.req.header("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}

export function requireAdmin(token: string | null, actor: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!token) {
      throw new AppError(
        503,
        "ADMIN_NOT_CONFIGURED",
        "Release administration is disabled because no admin token is configured.",
      );
    }
    const provided = readBearer(c);
    const expected = token;
    const left = Buffer.from(provided, "utf8");
    const right = Buffer.from(expected, "utf8");
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      c.header("WWW-Authenticate", 'Bearer realm="orderhub-updater-admin"');
      throw new AppError(401, "UNAUTHORIZED", "A valid release administration token is required.");
    }
    c.set("actor", actor);
    await next();
  };
}
