import type { Request, Response, NextFunction } from "express";
import { ZodError, type ZodType } from "zod";
import jwt from "jsonwebtoken";
import { db } from "../db/connection";
import { blacklistedToken } from "../db/schema";
import { eq } from "drizzle-orm";
import { ACCESS_TOKEN_COOKIE } from "../config/cookie.config";

function validateBody(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ details: error.issues });
      }
      next(error);
    }
  };
}

async function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[ACCESS_TOKEN_COOKIE];

  if (!token) {
    return res.status(401).json({ message: "No token provided." });
  }

  try {
    const rows = await db
      .select()
      .from(blacklistedToken)
      .where(eq(blacklistedToken.token, token))
      .limit(1);
    if (rows.length > 0) {
      return res.status(403).json({ message: 'Token has been invalidated.' })
    }

    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET as string);
    (req as any).user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ message: "Invalid token." });
  }
}

export { validateBody, authenticateToken };
