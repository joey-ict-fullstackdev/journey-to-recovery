import express from "express";
import type { Request, Response } from "express";
import { db } from "../db/connection";
// Aliased: this file uses `user`/`refreshToken` extensively as local
// variable names (a SELECT row, the signed JWT string), colliding with the
// schema table names of the same concept.
import {
  user as userTable,
  refreshToken as refreshTokenTable,
  blacklistedToken,
} from "../db/schema";
import { eq } from "drizzle-orm";
import { validateBody } from "../middleware/auth";
import {
  registerSchema,
  type RegisterInput,
  loginSchema,
  type LoginInput,
  clinicianRegisterSchema,
  type ClinicianRegisterInput,
} from "../utilities/schema";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Role, User } from "../utilities/types";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  authCookieOptions,
} from "../config/cookie.config";

const authRoutes = express.Router();

// Shared column list for the two places that need to re-derive a user's
// current id/email/role from the DB (login, and /refresh-token's re-fetch
// below) — login additionally selects `password` for the bcrypt check.
const AUTH_USER_FIELDS = {
  id: userTable.id,
  email: userTable.email,
  role: userTable.role,
} as const;

async function issueTokens(
  res: Response,
  payload: { id: string; email: string; role: Role },
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = jwt.sign(
    payload,
    process.env.JWT_ACCESS_SECRET as string,
    { expiresIn: "1d" },
  );
  const refreshToken = jwt.sign(
    payload,
    process.env.JWT_REFRESH_SECRET as string,
    { expiresIn: "7d" },
  );
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(refreshTokenTable).values({
    userId: payload.id,
    token: refreshToken,
    expiresAt,
  });
  const cookieOptions = authCookieOptions();
  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
    ...cookieOptions,
    maxAge: 24 * 60 * 60 * 1000,
  });
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  return { accessToken, refreshToken };
}

authRoutes.post(
  "/signup",
  validateBody(registerSchema),
  async (req: Request, res: Response) => {
    const { email, password }: RegisterInput = req.body;

    //Check the email exists
    try {
      const rows = await db
        .select({ email: userTable.email })
        .from(userTable)
        .where(eq(userTable.email, email));
      if (rows.length > 0) {
        return res.status(400).json({ message: "Email already exists." });
      }
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Server Error." });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Save the user to the db
    const userId: string = crypto.randomUUID();
    await db.insert(userTable).values({
      id: userId,
      email,
      password: hashedPassword,
    });

    // New accounts are always patients — there's no signup path for
    // creating a clinician account (see migration.sql for the manual seed
    // process); the DB column's own default is 'patient' too.
    await issueTokens(res, { id: userId, email, role: "patient" });

    res.status(201).json({ message: "Signup successful." });
  },
);

authRoutes.post(
  "/signup/clinician",
  validateBody(clinicianRegisterSchema),
  async (req: Request, res: Response) => {
    const { email, password, clinicCode }: ClinicianRegisterInput = req.body;

    if (clinicCode !== process.env.CLINICIAN_CODE) {
      return res.status(403).json({ message: "Invalid clinic code." });
    }

    try {
      const rows = await db
        .select({ email: userTable.email })
        .from(userTable)
        .where(eq(userTable.email, email));
      if (rows.length > 0) {
        return res.status(400).json({ message: "Email already exists." });
      }
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Server Error." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const userId = crypto.randomUUID();

    await db.insert(userTable).values({ id: userId, email, password: hashedPassword, role: "clinician" });
    await issueTokens(res, { id: userId, email, role: "clinician" });

    res.status(201).json({ message: "Clinician signup successful." });
  },
);

authRoutes.post(
  "/login",
  validateBody(loginSchema),
  async (req: Request, res: Response) => {
    const { email, password }: LoginInput = req.body;

    //Check the email exists
    const rows = await db
      .select({ ...AUTH_USER_FIELDS, password: userTable.password })
      .from(userTable)
      .where(eq(userTable.email, email));

    if (rows.length === 0) {
      return res.status(400).json({ message: "Email does not exist." });
    }

    //Check the password match
    const user: User = rows[0]!;
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid password." });
    }
    await issueTokens(res, {
      id: user.id,
      email: user.email,
      role: user.role,
    });

    res.status(200).json({ message: "Login successful." });
  },
);

authRoutes.post("/refresh-token", async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];

  if (!refreshToken) {
    return res.status(401).json({ message: "Refresh token not provided." });
  }

  let userInfo: { id: string };
  try {
    userInfo = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET as string,
    ) as { id: string };
  } catch (error) {
    return res
      .status(401)
      .json({ message: "Invalid or expired refresh token." });
  }

  try {
    // The delete (keyed on the refresh token string) and the re-fetch below
    // (keyed on userInfo.id, already known from the verified JWT) touch
    // different tables and don't depend on each other's data — only on the
    // delete's affectedRows to decide whether to proceed — so they run
    // concurrently rather than as two sequential round-trips.
    //
    // Re-fetching from the DB by id rather than trusting the decoded
    // refresh token's own payload: tokens issued before the `role` claim
    // existed have no role in them, and the DB is the source of truth if a
    // user's role changes after a token was already issued (e.g. the
    // manual clinician-seed UPDATE in migration.sql takes effect on this
    // user's next refresh instead of requiring a fresh login).
    const [[deleteResult], rows] = await Promise.all([
      db.delete(refreshTokenTable).where(eq(refreshTokenTable.token, refreshToken)),
      db.select(AUTH_USER_FIELDS).from(userTable).where(eq(userTable.id, userInfo.id)),
    ]);

    if (deleteResult.affectedRows === 0) {
      return res
        .status(401)
        .json({ message: "Invalid or already used refresh token." });
    }
    if (rows.length === 0) {
      return res.status(401).json({ message: "User not found." });
    }
    const currentUser = rows[0]!;

    await issueTokens(res, {
      id: currentUser.id,
      email: currentUser.email,
      role: currentUser.role,
    });

    res.status(200).json({ message: "Token refreshed." });
  } catch (error) {
    console.log("Refresh token error:", error);
    res.status(500).json({ message: "Server error during token refresh." });
  }
});

authRoutes.post("/logout", async (req: Request, res: Response) => {
  const token = req.cookies?.[ACCESS_TOKEN_COOKIE];
  const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];

  if (token) {
    try {
      const decoded = jwt.decode(token) as { exp: number };
      if (decoded && decoded.exp) {
        const expiresAt = new Date(decoded.exp * 1000);
        await db.insert(blacklistedToken).values({ token, expiresAt });
      }
    } catch (error) {
      console.log("Error blacklisting access token:", error);
    }
  }

  if (refreshToken) {
    try {
      await db
        .delete(refreshTokenTable)
        .where(eq(refreshTokenTable.token, refreshToken));
    } catch (error) {
      console.log("Error invalidating refresh token:", error);
    }
  }

  const cookieOptions = authCookieOptions();
  res.clearCookie(ACCESS_TOKEN_COOKIE, cookieOptions);
  res.clearCookie(REFRESH_TOKEN_COOKIE, cookieOptions);
  res.status(200).json({ message: "Logged out successfully." });
});

export default authRoutes;
