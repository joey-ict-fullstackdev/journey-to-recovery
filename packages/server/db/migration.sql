-- ============================================================
-- Journey to Recovery — Complete Database Schema
-- ============================================================
-- Run this file on a fresh database to create the full schema.
-- For upgrading an existing database, see Section 2 (ALTER TABLE).
--
-- Table creation order respects foreign-key dependencies:
--   user → refresh_token, blacklisted_token, daily_checkin,
--          goal, wellness_wheel, conversations
--   conversations → messages, chat_goals
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- SECTION 1: CREATE TABLES
-- ─────────────────────────────────────────────────────────────


-- ── 1. user ──────────────────────────────────────────────────
-- Core account table. Created on sign-up; profile fields filled
-- in a separate step after registration.
CREATE TABLE IF NOT EXISTS user (
  id                VARCHAR(36)   NOT NULL,
  email             VARCHAR(255)  NOT NULL,
  password          VARCHAR(255)  NOT NULL,          -- bcrypt hash
  name              VARCHAR(32)   NULL DEFAULT NULL,
  dob               DATE          NULL DEFAULT NULL,
  gender            VARCHAR(50)   NULL DEFAULT NULL,
  meditation_level  VARCHAR(50)   NULL DEFAULT NULL,
  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_email (email)
);


-- ── 2. refresh_token ─────────────────────────────────────────
-- Stores active refresh tokens (7-day expiry, one-time use).
-- A token is deleted on use and replaced with a new one.
CREATE TABLE IF NOT EXISTS refresh_token (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id     VARCHAR(36)   NOT NULL,
  token       VARCHAR(512)  NOT NULL,
  expires_at  TIMESTAMP     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_refresh_token_token   (token(255)),
  KEY idx_refresh_token_user_id (user_id),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);


-- ── 3. blacklisted_token ─────────────────────────────────────
-- Access tokens added here on logout so they cannot be reused
-- before their natural expiry.
CREATE TABLE IF NOT EXISTS blacklisted_token (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  token       VARCHAR(512)  NOT NULL,
  expires_at  TIMESTAMP     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_blacklisted_token (token(255))
);


-- ── 4. daily_checkin ─────────────────────────────────────────
-- One row per user per day. The unique constraint prevents
-- duplicate check-ins on the same date.
CREATE TABLE IF NOT EXISTS daily_checkin (
  id            VARCHAR(36)  NOT NULL,
  user_id       VARCHAR(36)  NOT NULL,
  checkin_date  DATE         NOT NULL,
  status        VARCHAR(50)  NOT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_checkin_user_date (user_id, checkin_date),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);


-- ── 5. goal ──────────────────────────────────────────────────
-- Goals created through the SMART goal wizard (not the chatbot).
-- Several fields are optional because the wizard is multi-step.
CREATE TABLE IF NOT EXISTS goal (
  id                VARCHAR(36)  NOT NULL,
  user_id           VARCHAR(36)  NOT NULL,
  overall_goal      TEXT         NULL DEFAULT NULL,
  smart_goal        TEXT         NOT NULL,
  importance        INT          NULL DEFAULT NULL,  -- e.g. 1–10 scale
  motivation        TEXT         NULL DEFAULT NULL,
  confidence        INT          NULL DEFAULT NULL,  -- e.g. 1–10 scale
  confidence_reason TEXT         NULL DEFAULT NULL,
  reminder_type     VARCHAR(50)  NOT NULL DEFAULT 'none',
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_goal_user_id (user_id),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);


-- ── 6. wellness_wheel ────────────────────────────────────────
-- Stores the results of the multi-dimensional wellness wheel
-- assessment. Ratings are integers (e.g. 1–10); explanations
-- and strengths answers are free text.
CREATE TABLE IF NOT EXISTS wellness_wheel (
  id                      VARCHAR(36)   NOT NULL,
  user_id                 VARCHAR(36)   NOT NULL,
  social_rating           INT           NULL DEFAULT NULL,
  social_explanation      TEXT          NULL DEFAULT NULL,
  physical_rating         INT           NULL DEFAULT NULL,
  physical_explanation    TEXT          NULL DEFAULT NULL,
  environment_rating      INT           NULL DEFAULT NULL,
  environment_explanation TEXT          NULL DEFAULT NULL,
  financial_rating        INT           NULL DEFAULT NULL,
  financial_explanation   TEXT          NULL DEFAULT NULL,
  work_rating             INT           NULL DEFAULT NULL,
  work_explanation        TEXT          NULL DEFAULT NULL,
  spiritual_rating        INT           NULL DEFAULT NULL,
  spiritual_explanation   TEXT          NULL DEFAULT NULL,
  recreation_rating       INT           NULL DEFAULT NULL,
  recreation_explanation  TEXT          NULL DEFAULT NULL,
  mental_rating           INT           NULL DEFAULT NULL,
  mental_explanation      TEXT          NULL DEFAULT NULL,
  focus_area              VARCHAR(255)  NOT NULL,
  strengths_values        TEXT          NULL DEFAULT NULL,
  strengths_good_at       TEXT          NULL DEFAULT NULL,
  strengths_overcome      TEXT          NULL DEFAULT NULL,
  strengths_valued_for    TEXT          NULL DEFAULT NULL,
  created_at              TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_wellness_user_id (user_id),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);


-- ── 7. conversations ─────────────────────────────────────────
-- One row per chatbot conversation session. The title is the
-- first 30 characters of the opening message. updated_at is
-- refreshed on every new message so the sidebar stays sorted.
-- status is set to 'completed' when a SMART goal is confirmed.
CREATE TABLE IF NOT EXISTS conversations (
  id          VARCHAR(36)                NOT NULL,
  user_id     VARCHAR(36)                NOT NULL,
  title       VARCHAR(255)               NOT NULL,
  status      ENUM('active','completed') NOT NULL DEFAULT 'active',
  created_at  TIMESTAMP                  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP                  NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                   ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_conversations_user_id (user_id),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);


-- ── 8. messages ──────────────────────────────────────────────
-- Every individual chat message (user or bot) within a
-- conversation. Ordered by created_at ASC for display,
-- DESC LIMIT n for building the AI history window.
CREATE TABLE IF NOT EXISTS messages (
  id                INT UNSIGNED                NOT NULL AUTO_INCREMENT,
  conversation_id   VARCHAR(36)                 NOT NULL,
  role              ENUM('user', 'bot')         NOT NULL,
  content           TEXT                        NOT NULL,
  created_at        TIMESTAMP                   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_messages_conversation_id (conversation_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);


-- ── 9. chat_goals ────────────────────────────────────────────
-- Structured SMART goals persisted when the chatbot conversation
-- reaches goal_complete state. Stores every field from the AI's
-- JSON schema plus the server-calculated risk assessment.
CREATE TABLE IF NOT EXISTS chat_goals (
  id                       VARCHAR(36)   NOT NULL,
  conversation_id          VARCHAR(36)   NOT NULL,
  user_id                  VARCHAR(36)   NOT NULL,
  goal_summary             TEXT          NOT NULL,
  goal_category            ENUM(
                             'mobility',
                             'upper_limb',
                             'balance',
                             'adl',
                             'strength',
                             'communication',
                             'other'
                           )             NOT NULL,
  target_activity          TEXT          NOT NULL,
  current_ability          TEXT          NOT NULL,
  measurement_metric       VARCHAR(100)  NOT NULL,
  measurement_current_val  FLOAT         NULL DEFAULT NULL,
  measurement_target_val   FLOAT         NULL DEFAULT NULL,
  measurement_unit         VARCHAR(50)   NOT NULL,
  frequency                VARCHAR(200)  NOT NULL DEFAULT '',
  timeline_weeks           INT           NOT NULL DEFAULT 0,
  assistance_level         TINYINT       NOT NULL DEFAULT 1,  -- 1=full help, 2=device, 3=supervision, 4=independent
  is_specific              BOOLEAN       NOT NULL DEFAULT FALSE,
  is_measurable            BOOLEAN       NOT NULL DEFAULT FALSE,
  is_achievable            BOOLEAN       NOT NULL DEFAULT FALSE,
  is_relevant              BOOLEAN       NOT NULL DEFAULT FALSE,
  is_time_bound            BOOLEAN       NOT NULL DEFAULT FALSE,
  risk_score               FLOAT         NOT NULL DEFAULT 0,
  risk_level               ENUM('LOW','MODERATE','HIGH') NOT NULL DEFAULT 'LOW',
  requires_approval        BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_chat_goals_user_id          (user_id),
  KEY idx_chat_goals_conversation_id  (conversation_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)         REFERENCES user(id)          ON DELETE CASCADE
);


-- ─────────────────────────────────────────────────────────────
-- SECTION 2: ALTER TABLE (schema changes over time)
-- Run these only when upgrading an existing database.
-- Skip if you ran Section 1 on a fresh database — the column
-- is already included in the CREATE TABLE above.
-- ─────────────────────────────────────────────────────────────


-- ── Sprint 2: Add conversation status ────────────────────────
-- Tracks whether a conversation reached goal_complete.
-- Added alongside the chat_goals table.
-- NOTE: "IF NOT EXISTS" here was confirmed NOT supported by this
-- project's actual MySQL 9.4.0 server (ERROR 1064) — this statement is
-- NOT idempotent as written. Only run it if `conversations.status`
-- doesn't already exist (check with `SHOW COLUMNS FROM conversations;`
-- first) — running it when the column is already present fails with a
-- duplicate-column error.
ALTER TABLE conversations
  ADD COLUMN status ENUM('active', 'completed') NOT NULL DEFAULT 'active';


-- ── Sync: bring an existing DB in line with Section 1 exactly ──
-- Written and applied 2026-07-20 after diffing a live mysqldump against
-- this file found significant drift (missing columns/constraints, wrong
-- types/lengths, FKs without ON DELETE CASCADE). Applied against a
-- database confirmed empty first (COUNT(*) = 0 on all 9 tables via the
-- local mysql client) — the data-safety caveats that would otherwise
-- apply (see below) didn't, so every item ran as one full pass,
-- including the previously-deferred blacklisted_token.expires_at
-- conversion and the two optional index/column cleanups. Verified
-- correct afterward via SHOW CREATE TABLE on all 9 tables.
--
-- This whole block is ONE-TIME, not safe to blindly re-run on a DB it's
-- already been applied to (the ADD KEY/CONSTRAINT/UNIQUE KEY/DROP
-- INDEX/DROP COLUMN lines error on a second run — no confirmed MySQL 8/9
-- "IF NOT EXISTS" support for ADD INDEX/ADD CONSTRAINT the way there is
-- for ADD COLUMN, and "ADD COLUMN IF NOT EXISTS" itself was confirmed
-- NOT supported on this project's actual MySQL 9.4.0 server either —
-- ERROR 1064 regardless of syntax variant tried, despite being
-- documented as supported since 8.0.29. Don't trust that clause without
-- testing against your own server first).
--
-- If you're applying this to a DIFFERENT existing database that already
-- has data in it:
--   1. Re-run the pre-flight checks from the original chat discussion
--      (row-length checks, NULL checks, checkin_date format/duplicate
--      checks, and inspect blacklisted_token.expires_at's actual values
--      before converting it — if they're Unix-epoch numbers, a blind
--      MODIFY produces garbage dates, not an error).
--   2. Back up first (mysqldump) — several of these are not reversible
--      without a restore.
--   3. Phase 1 below (dropping every FK touching user.id/conversations.id)
--      is required — MySQL refuses to MODIFY a column that's an active
--      FK target, discovered the hard way when Phase 2 failed partway
--      through on the first attempt.

-- Phase 1: drop every existing FK that references user.id or
-- conversations.id, since both get resized VARCHAR(255)->VARCHAR(36)
-- below and MySQL will not allow that while an FK targets them.
ALTER TABLE refresh_token DROP FOREIGN KEY refresh_token_ibfk_1;
ALTER TABLE goal DROP FOREIGN KEY goal_ibfk_1;
ALTER TABLE wellness_wheel DROP FOREIGN KEY wellness_wheel_ibfk_1;
ALTER TABLE conversations DROP FOREIGN KEY conversations_ibfk_1;
ALTER TABLE chat_goals DROP FOREIGN KEY chat_goals_ibfk_2;
ALTER TABLE messages DROP FOREIGN KEY messages_ibfk_1;
ALTER TABLE chat_goals DROP FOREIGN KEY chat_goals_ibfk_1;

-- Phase 2: column/index changes, now unblocked.

-- user
-- "ADD COLUMN IF NOT EXISTS" doesn't work on this server (see note
-- above) — plain ADD COLUMN, safe since this table was confirmed not to
-- have the column yet.
ALTER TABLE user ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE user MODIFY id VARCHAR(36) NOT NULL;
ALTER TABLE user MODIFY gender VARCHAR(50) NULL DEFAULT NULL;
ALTER TABLE user MODIFY meditation_level VARCHAR(50) NULL DEFAULT NULL;

-- blacklisted_token
ALTER TABLE blacklisted_token MODIFY token VARCHAR(512) NOT NULL;
ALTER TABLE blacklisted_token ADD KEY idx_blacklisted_token (token(255));
-- expires_at DECIMAL(20,2) -> TIMESTAMP: safe as a direct MODIFY only
-- because the table was confirmed empty (no existing values to reinterpret).
ALTER TABLE blacklisted_token MODIFY expires_at TIMESTAMP NOT NULL;

-- refresh_token
ALTER TABLE refresh_token MODIFY user_id VARCHAR(36) NOT NULL;
ALTER TABLE refresh_token MODIFY token VARCHAR(512) NOT NULL;
ALTER TABLE refresh_token MODIFY expires_at TIMESTAMP NOT NULL; -- was DATETIME
ALTER TABLE refresh_token ADD KEY idx_refresh_token_token (token(255));

-- daily_checkin
ALTER TABLE daily_checkin MODIFY id VARCHAR(36) NOT NULL;
ALTER TABLE daily_checkin MODIFY user_id VARCHAR(36) NOT NULL;
ALTER TABLE daily_checkin MODIFY checkin_date DATE NOT NULL;
ALTER TABLE daily_checkin MODIFY status VARCHAR(50) NOT NULL;
ALTER TABLE daily_checkin ADD UNIQUE KEY uq_checkin_user_date (user_id, checkin_date);

-- goal
ALTER TABLE goal MODIFY reminder_type VARCHAR(50) NOT NULL DEFAULT 'none';
ALTER TABLE goal MODIFY created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- wellness_wheel
ALTER TABLE wellness_wheel MODIFY focus_area VARCHAR(255) NOT NULL;
ALTER TABLE wellness_wheel MODIFY created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- conversations
ALTER TABLE conversations MODIFY id VARCHAR(36) NOT NULL;
ALTER TABLE conversations MODIFY user_id VARCHAR(36) NOT NULL;
ALTER TABLE conversations MODIFY title VARCHAR(255) NOT NULL;
ALTER TABLE conversations MODIFY created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE conversations
  MODIFY updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ON UPDATE CURRENT_TIMESTAMP;

-- messages
ALTER TABLE messages MODIFY created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Cleanup — not required for the app to work, only for the live schema
-- to match this file exactly. Safe here because every table was empty.
ALTER TABLE user DROP INDEX usercol_UNIQUE;       -- unintended UNIQUE on password
ALTER TABLE user DROP INDEX id_UNIQUE;            -- redundant with PRIMARY KEY
ALTER TABLE daily_checkin DROP INDEX id_UNIQUE;   -- redundant with PRIMARY KEY
ALTER TABLE refresh_token DROP COLUMN created_at; -- not in this file's schema

-- Phase 3: re-add every FK dropped in Phase 1, all with ON DELETE
-- CASCADE (matching Section 1's intent), plus the new FK on
-- daily_checkin that never existed before.
ALTER TABLE refresh_token
  ADD CONSTRAINT refresh_token_ibfk_1
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE;
ALTER TABLE goal
  ADD CONSTRAINT goal_ibfk_1
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE;
ALTER TABLE wellness_wheel
  ADD CONSTRAINT wellness_wheel_ibfk_1
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_ibfk_1
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE;
ALTER TABLE chat_goals
  ADD CONSTRAINT chat_goals_ibfk_2
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE;
ALTER TABLE messages
  ADD CONSTRAINT messages_ibfk_1
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
ALTER TABLE chat_goals
  ADD CONSTRAINT chat_goals_ibfk_1
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
ALTER TABLE daily_checkin
  ADD CONSTRAINT daily_checkin_ibfk_1
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE;
