import { mysqlTable, int, varchar, timestamp } from "drizzle-orm/mysql-core";

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
