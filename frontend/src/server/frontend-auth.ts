import "server-only";
import { cookies } from "next/headers";
import type { AuthUser } from "@voltronix/crm-contracts";
import { frontendBackend } from "./config/frontend-backend";
import { parseWebConfig } from "./config/web";
import { ExpressReadError, isAuthUser, readExpress } from "./express-bridge";

export function webConfig() { return parseWebConfig(process.env); }

export async function currentUser(): Promise<AuthUser | null> {
  if (frontendBackend(process.env).mode === "nextjs") return (await import("./web-auth")).currentUser();
  try {
    const value = await readExpress<{ user: unknown }>("/api/auth/me", (await cookies()).toString(), process.env);
    if (!isAuthUser(value?.user)) throw new ExpressReadError(503);
    return value.user;
  } catch (error) {
    if (error instanceof ExpressReadError && error.status === 401) return null;
    throw new ExpressReadError(503);
  }
}
