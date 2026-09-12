import type { NextFunction, Request, Response } from "express";
import { getSessionUser, SESSION_COOKIE_NAME, type SessionUser } from "../lib/auth";
import { isAdmin } from "../lib/authorization";

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  const user = await getSessionUser(token);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.user = user;
  next();
}

// Authorization, not authentication — must run AFTER requireAuth (needs
// req.user already populated). A route protected by both only ever reaches
// here once the caller is a confirmed, active WorkTruth user; this then
// asks the separate question of whether their role permits the action.
// Used to protect the entire admin user-management API server-side — never
// relies on the frontend hiding a button or route.
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || !isAdmin(req.user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
