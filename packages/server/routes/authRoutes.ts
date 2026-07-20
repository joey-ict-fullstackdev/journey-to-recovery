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
} from "../utilities/schema";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { User } from "../utilities/types";

const authRoutes = express.Router();

async function issueTokens(
  res: Response,
  payload: { id: string; email: string },
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
  const isProduction = process.env.NODE_ENV === "production";
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
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

    const { accessToken } = await issueTokens(res, { id: userId, email });

    //return tokens
    res.status(201).json({ accessToken });
  },
);

authRoutes.post(
  "/login",
  validateBody(loginSchema),
  async (req: Request, res: Response) => {
    const { email, password }: LoginInput = req.body;

    //Check the email exists
    const rows = await db
      .select({
        id: userTable.id,
        email: userTable.email,
        password: userTable.password,
      })
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
    const { accessToken } = await issueTokens(res, {
      id: user.id,
      email: user.email,
    });

    res.status(200).json({ accessToken });
  },
);

authRoutes.post("/refresh-token", async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ message: "Refresh token not provided." });
  }

  try {
    const userInfo = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET as string,
    ) as { id: string; email: string };

    const [deleteResult] = await db
      .delete(refreshTokenTable)
      .where(eq(refreshTokenTable.token, refreshToken));

    if (deleteResult.affectedRows === 0) {
      return res
        .status(401)
        .json({ message: "Invalid or already used refresh token." });
    }

    const { accessToken } = await issueTokens(res, {
      id: userInfo.id,
      email: userInfo.email,
    });

    res.status(200).json({ accessToken });
  } catch (error) {
    console.log("Refresh token error:", error);
    res.status(500).json({ message: "Server error during token refresh." });
  }
});

authRoutes.post("/logout", async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1];
  const refreshToken = req.cookies?.refreshToken;

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

  res.status(200).json({ message: "Logged out successfully." });
});

export default authRoutes;
