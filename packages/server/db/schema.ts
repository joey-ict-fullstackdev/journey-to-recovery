import {
  mysqlTable,
  int,
  varchar,
  timestamp,
  date,
  text,
  mysqlEnum,
  float,
  tinyint,
  boolean,
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

export const conversations = mysqlTable("conversations", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["active", "completed"])
    .notNull()
    .default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const messages = mysqlTable("messages", {
  id: int("id", { unsigned: true }).autoincrement().primaryKey(),
  conversationId: varchar("conversation_id", { length: 36 }).notNull(),
  role: mysqlEnum("role", ["user", "bot"]).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const chatGoals = mysqlTable("chat_goals", {
  id: varchar("id", { length: 36 }).primaryKey(),
  conversationId: varchar("conversation_id", { length: 36 }).notNull(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  goalSummary: text("goal_summary").notNull(),
  goalCategory: mysqlEnum("goal_category", [
    "mobility",
    "upper_limb",
    "balance",
    "adl",
    "strength",
    "communication",
    "other",
  ]).notNull(),
  targetActivity: text("target_activity").notNull(),
  currentAbility: text("current_ability").notNull(),
  measurementMetric: varchar("measurement_metric", { length: 100 }).notNull(),
  measurementCurrentVal: float("measurement_current_val"),
  measurementTargetVal: float("measurement_target_val"),
  measurementUnit: varchar("measurement_unit", { length: 50 }).notNull(),
  frequency: varchar("frequency", { length: 200 }).notNull().default(""),
  timelineWeeks: int("timeline_weeks").notNull().default(0),
  assistanceLevel: tinyint("assistance_level").notNull().default(1),
  isSpecific: boolean("is_specific").notNull().default(false),
  isMeasurable: boolean("is_measurable").notNull().default(false),
  isAchievable: boolean("is_achievable").notNull().default(false),
  isRelevant: boolean("is_relevant").notNull().default(false),
  isTimeBound: boolean("is_time_bound").notNull().default(false),
  riskScore: float("risk_score").notNull().default(0),
  riskLevel: mysqlEnum("risk_level", ["LOW", "MODERATE", "HIGH"])
    .notNull()
    .default("LOW"),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
