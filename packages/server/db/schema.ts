import {
  mysqlTable,
  int,
  varchar,
  timestamp,
  date,
} from "drizzle-orm/mysql-core";

/**
 * Tables are added here incrementally, one router's worth at a time, as each
 * is migrated off raw mysql2 SQL onto Drizzle. See the migration plan.
 * Column shapes must match db/migration.sql exactly.
 */

export const blacklistedToken = mysqlTable("blacklisted_token", {
  id: int("id", { unsigned: true }).autoincrement().primaryKey(),
  token: varchar("token", { length: 512 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const dailyCheckin = mysqlTable("daily_checkin", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  // mode: "string" keeps this as a plain YYYY-MM-DD string, matching
  // getLocalYYYYMMDD()'s existing string-based date handling in
  // checkinRoutes.ts — no Date-object/timezone conversion involved.
  checkinDate: date("checkin_date", { mode: "string" }).notNull(),
  status: varchar("status", { length: 50 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
