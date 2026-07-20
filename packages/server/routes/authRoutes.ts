import express from "express";
import type { Request, Response } from "express";
import connection from "../db/connection";
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

authRoutes.post(
  "/signup",
  validateBody(registerSchema),
  async (req: Request, res: Response) => {
    const { email, password }: RegisterInput = req.body;

    //Check the email exists
    try {
      const [rows] = await connection.execute(
        "SELECT email FROM user WHERE email=?",
        [email],
      );
      if ((rows as any).length > 0) {
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
    await connection.execute(
      "INSERT INTO user(id, email, password) VALUES(?, ?, ?)",
      [userId, email, hashedPassword],
    );

    // Sign the access token
    const accessToken = jwt.sign(
      { id: userId, email: email },
      process.env.JWT_ACCESS_SECRET as string,
      { expiresIn: "1d" },
    );

    // Create and store the refresh token
    const refreshToken = jwt.sign(
      { id: userId, email: email },
      process.env.JWT_REFRESH_SECRET as string,
      { expiresIn: "7d" },
    );

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await connection.execute(
      "INSERT INTO refresh_token (user_id, token, expires_at) VALUES (?, ?, ?)",
      [userId, refreshToken, expiresAt],
    );

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: false, //process.env.NODE_ENV === "production"
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

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
    const [rows] = await connection.execute(
      "SELECT id, email, password FROM user WHERE email = ?",
      [email],
    );

    if ((rows as any).length === 0) {
      return res.status(400).json({ message: "Email does not exist." });
    }

    //Check the password match
    const user: User = (rows as any)[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid password." });
    }
    // Sign the access token
    const accessToken = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_ACCESS_SECRET as string,
      { expiresIn: "1d" },
    );

    // Create and store the refresh token
    const refreshToken = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_REFRESH_SECRET as string,
      { expiresIn: "7d" },
    );

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await connection.execute(
      "INSERT INTO refresh_token (user_id, token, expires_at) VALUES (?, ?, ?)",
      [user.id, refreshToken, expiresAt],
    );

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: false, //process.env.NODE_ENV === "production"
      maxAge: 7 * 24 * 60 * 60 * 1000,
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

    const [deleteResult] = await connection.execute(
      "DELETE FROM refresh_token WHERE token = ?",
      [refreshToken],
    );

    if ((deleteResult as any).affectedRows === 0) {
      return res
        .status(401)
        .json({ message: "Invalid or already used refresh token." });
    }

    const newRefreshToken = jwt.sign(
      { id: userInfo.id, email: userInfo.email },
      process.env.JWT_REFRESH_SECRET as string,
      { expiresIn: "7d" },
    );

    const newAccessToken = jwt.sign(
      { id: userInfo.id, email: userInfo.email },
      process.env.JWT_ACCESS_SECRET as string,
      { expiresIn: "1d" },
    );

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await connection.execute(
      "INSERT INTO refresh_token (user_id, token, expires_at) VALUES (?, ?, ?)",
      [userInfo.id, newRefreshToken, expiresAt],
    );

    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: false, //process.env.NODE_ENV === "production"
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({ newAccessToken });
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
        await connection.execute(
          "INSERT INTO blacklisted_token (token, expires_at) VALUES (?, ?)",
          [token, expiresAt],
        );
      }
    } catch (error) {
      console.log("Error blacklisting access token:", error);
    }
  }

  if (refreshToken) {
    try {
      await connection.execute("DELETE FROM refresh_token WHERE token = ?", [
        refreshToken,
      ]);
    } catch (error) {
      console.log("Error invalidating refresh token:", error);
    }
  }

  res.status(200).json({ message: "Logged out successfully." });
});

export default authRoutes;
