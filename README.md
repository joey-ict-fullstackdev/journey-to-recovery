# 🧠 Journey to Recovery — Stroke Rehabilitation Platform

This project is a full-stack web application that supports stroke survivors through their rehabilitation journey. It combines SMART goal setting, daily wellness tracking, a multi-dimensional wellness wheel assessment, and an AI-powered rehabilitation chatbot ("Camay") built on Google Gemini.

---

Demo: https://youtu.be/Lu6fg6V3H5Q?si=ZmevqsC-vFO1H6wD

---

## 📌 Project Scope & Features

### 1️⃣ Rehabilitation Platform

- User authentication & authorisation (JWT access + refresh tokens, refresh-token rotation, access-token blacklist on logout)
- SMART goal-setting wizard (goal, importance, motivation, confidence, reminders)
- Daily wellness check-ins (one entry per user per day)
- Multi-dimensional wellness wheel assessment (social, physical, environment, financial, work, spiritual, recreation, mental)
- AI rehabilitation chatbot ("Camay") powered by Google Gemini, including SMART-goal structuring and a risk-assessment score
- Persistent chat history, organised into conversations and messages

---

## 🛠️ Tech Stack

| Layer | Technologies Used |
| ----- | ------------------ |
| **Frontend** | React 19, Vite, TypeScript, Tailwind CSS 4, Radix UI, React Router DOM, React Hook Form, Zod |
| **Backend** | Bun runtime, Express 5, TypeScript |
| **Database** | MySQL (`mysql2/promise` connection pool, raw SQL — no ORM) |
| **AI** | Google Gemini 2.5 Flash (`@google/genai`) |
| **Auth** | JWT (1-day access / 7-day one-time-use refresh tokens), bcryptjs |
| **Monorepo tooling** | Bun workspaces, `concurrently` |

---

## 🗄️ Database Schema

The schema is a MySQL database with the following core tables (see `packages/server/db/migration.sql`):

### User Table

| Column | Type | Description |
| ------ | ---- | ----------- |
| id | VARCHAR(36) PRIMARY KEY | Unique user ID |
| email | VARCHAR(255) UNIQUE | User email address |
| password | VARCHAR(255) | bcrypt password hash |
| name | VARCHAR(32) | Display name |
| dob | DATE | Date of birth |
| gender | VARCHAR(50) | Gender |
| meditation_level | VARCHAR(50) | Meditation experience level |
| created_at | TIMESTAMP | Account creation timestamp |

### Daily_Checkin Table

| Column | Type | Description |
| ------ | ---- | ----------- |
| id | VARCHAR(36) PRIMARY KEY | Unique check-in ID |
| user_id | VARCHAR(36) | References User(id) |
| checkin_date | DATE | Date of the check-in |
| status | VARCHAR(50) | Wellness status recorded |
| created_at | TIMESTAMP | Created timestamp |

*Unique constraint on (user_id, checkin_date) — one check-in per user per day.*

### Goal Table

| Column | Type | Description |
| ------ | ---- | ----------- |
| id | VARCHAR(36) PRIMARY KEY | Unique goal ID |
| user_id | VARCHAR(36) | References User(id) |
| overall_goal | TEXT | High-level goal description |
| smart_goal | TEXT | Finalised SMART goal statement |
| importance | INT | Importance rating (e.g. 1–10) |
| motivation | TEXT | Motivation notes |
| confidence | INT | Confidence rating (e.g. 1–10) |
| confidence_reason | TEXT | Reason behind confidence rating |
| reminder_type | VARCHAR(50) | Reminder preference |
| created_at | TIMESTAMP | Created timestamp |

### Wellness_Wheel Table

| Column | Type | Description |
| ------ | ---- | ----------- |
| id | VARCHAR(36) PRIMARY KEY | Unique assessment ID |
| user_id | VARCHAR(36) | References User(id) |
| social / physical / environment / financial / work / spiritual / recreation / mental | INT + TEXT pairs | Rating (1–10) and free-text explanation per life dimension |
| focus_area | VARCHAR(255) | Chosen area of focus |
| strengths_values / strengths_good_at / strengths_overcome / strengths_valued_for | TEXT | Strengths-based reflection answers |
| created_at | TIMESTAMP | Created timestamp |

### Conversations / Messages / Chat_Goals Tables

| Table | Purpose |
| ----- | ------- |
| `conversations` | One row per chatbot session (`id`, `user_id`, `title`, `status` — active/completed, timestamps) |
| `messages` | Individual chat messages (`role` — user/bot, `content`, `created_at`), linked to a conversation |
| `chat_goals` | Structured SMART goal extracted by Camay once a conversation reaches goal completion — includes category, target activity, measurable metric/values, timeline, assistance level, the five SMART checks (specific/measurable/achievable/relevant/time-bound), and a calculated `risk_score` |

Two supporting tables handle auth mechanics: `refresh_token` (active refresh tokens, 7-day expiry) and `blacklisted_token` (access tokens invalidated on logout).

---

## 🔗 Architecture Diagram (Text Placeholder)

```
      +---------------------------+
      |  React 19 + Vite Frontend |
      +---------------------------+
                  |
        Axios (JWT + auto refresh)
                  |
                  v
+--------------------------------------+
|  Bun + Express 5 REST API (/api/*)   |
+--------------------------------------+
        |                     |
   mysql2 pool          Google Gemini AI
        |                (Camay chatbot)
        v
+----------------------+
|   MySQL Database      |
+----------------------+
```

---

## ⚙️ Environment Variables

The server expects a `.env` file in `packages/server/`:

| Variable | Purpose |
| -------- | ------- |
| `HOST`, `USER`, `PASSWORD`, `DB_NAME` | Local MySQL connection |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | JWT signing keys |
| `GEMINI_API_KEY` | Google GenAI API key |
| `NODE_ENV` | `development` or `production` |
| `MYSQLUSER`, `MYSQL_ROOT_PASSWORD`, `RAILWAY_TCP_PROXY_DOMAIN`, `RAILWAY_TCP_PROXY_PORT`, `MYSQL_DATABASE` | Railway MySQL config (production) |

---

## 🚀 Getting Started

```bash
# Install all dependencies (root + workspaces)
bun install

# Run both client and server together (from root)
bun run dev

# Or run them individually:
cd packages/client && bun run dev     # Vite dev server → http://localhost:5173
cd packages/server && bun run dev     # Express with --watch → http://localhost:3000
```

This project uses [Bun](https://bun.sh) as its package manager and runtime, and is structured as a Bun-workspaces monorepo with `packages/client` and `packages/server`.

---

## ☁️ Deployment

| Component | Platform |
| --------- | -------- |
| Frontend | Netlify |
| Backend + Database | Railway (Express server + MySQL) |
