import {
  mysqlTable,
  int,
  varchar,
  timestamp,
  date,
  text,
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

export const goal = mysqlTable("goal", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  overallGoal: text("overall_goal"),
  smartGoal: text("smart_goal").notNull(),
  importance: int("importance"),
  motivation: text("motivation"),
  confidence: int("confidence"),
  confidenceReason: text("confidence_reason"),
  reminderType: varchar("reminder_type", { length: 50 })
    .notNull()
    .default("none"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const wellnessWheel = mysqlTable("wellness_wheel", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  socialRating: int("social_rating"),
  socialExplanation: text("social_explanation"),
  physicalRating: int("physical_rating"),
  physicalExplanation: text("physical_explanation"),
  environmentRating: int("environment_rating"),
  environmentExplanation: text("environment_explanation"),
  financialRating: int("financial_rating"),
  financialExplanation: text("financial_explanation"),
  workRating: int("work_rating"),
  workExplanation: text("work_explanation"),
  spiritualRating: int("spiritual_rating"),
  spiritualExplanation: text("spiritual_explanation"),
  recreationRating: int("recreation_rating"),
  recreationExplanation: text("recreation_explanation"),
  mentalRating: int("mental_rating"),
  mentalExplanation: text("mental_explanation"),
  focusArea: varchar("focus_area", { length: 255 }).notNull(),
  strengthsValues: text("strengths_values"),
  strengthsGoodAt: text("strengths_good_at"),
  strengthsOvercome: text("strengths_overcome"),
  strengthsValuedFor: text("strengths_valued_for"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const user = mysqlTable("user", {
  id: varchar("id", { length: 36 }).primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
  name: varchar("name", { length: 32 }),
  // Default (Date-object) mode — matches profileFormSchema's z.coerce.date(),
  // which already produces a JS Date before this reaches the route handler.
  dob: date("dob"),
  gender: varchar("gender", { length: 50 }),
  meditationLevel: varchar("meditation_level", { length: 50 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const refreshToken = mysqlTable("refresh_token", {
  id: int("id", { unsigned: true }).autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  token: varchar("token", { length: 512 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});
