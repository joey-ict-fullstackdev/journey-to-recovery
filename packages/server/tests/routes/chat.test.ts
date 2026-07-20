import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import {
  app,
  fakeDb,
  dbSelectWhereResult,
  dbSelectOrderByResult,
  dbSelectLimitResult,
  dbInsertResult,
  dbUpdateResult,
  dbDeleteResult,
  dbTransactionCommit,
  dbTransactionRollback,
  chatCompletionsCreate,
  startServer,
  stopServer,
  signTestAccessToken,
  mockAuthOk,
  resetMocks,
} from "./_testUtils";

let server: Awaited<ReturnType<typeof startServer>>["server"];
let baseUrl: string;

beforeAll(async () => {
  const started = await startServer();
  server = started.server;
  baseUrl = started.baseUrl;
});

afterAll(async () => {
  await stopServer(server);
});

afterEach(() => {
  resetMocks();
});

const token = signTestAccessToken({ id: "user-1", email: "test@example.com" });
const authHeaders = { Authorization: `Bearer ${token}` };

function aiResponse(parsed: Record<string, unknown>) {
  return { choices: [{ message: { content: JSON.stringify(parsed) } }] };
}

function baseSmartGoalResponse(overrides: Record<string, unknown> = {}) {
  return {
    goal_summary: "Walk 100m to the park using a cane in 4 weeks",
    smart_data: {
      goal_category: "mobility",
      target_activity: "walk to the park",
      current_ability: "can walk 20 metres with a cane",
      measurement: {
        metric: "distance",
        current_value: 20,
        target_value: 100,
        unit: "meters",
      },
      frequency: "twice a day",
      timeline_weeks: 4,
      assistance_level: 2,
      smart_assessment: {
        is_specific: true,
        is_measurable: true,
        is_achievable: true,
        is_relevant: true,
        is_time_bound: true,
      },
    },
    conversation_state: "gathering_info",
    user_communication: {
      message: "That is a wonderful goal.",
      question: "Does this goal feel right to you?",
    },
    missing_info: [],
    risk_flag: false,
    ...overrides,
  };
}

describe("GET /api/conversations", () => {
  it("returns the raw array of conversations (not wrapped in an object)", async () => {
    mockAuthOk();
    dbSelectOrderByResult.mockResolvedValueOnce([{ id: "c1", title: "Chat 1" }]);

    const res = await fetch(`${baseUrl}/api/conversations`, {
      headers: authHeaders,
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([{ id: "c1", title: "Chat 1" }]);
  });

  it("returns 500 on a DB failure", async () => {
    mockAuthOk();
    dbSelectOrderByResult.mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    const res = await fetch(`${baseUrl}/api/conversations`, {
      headers: authHeaders,
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ message: "Failed to fetch history" });
  });
});

describe("GET /api/conversations/:id", () => {
  it("returns the raw array of messages when the conversation is owned by the user", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockResolvedValueOnce([{ id: "c1" }]); // ownership check
    dbSelectOrderByResult.mockResolvedValueOnce([{ content: "hi", role: "user" }]);

    const res = await fetch(`${baseUrl}/api/conversations/c1`, {
      headers: authHeaders,
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([{ content: "hi", role: "user" }]);
  });

  it("returns 404 when the conversation doesn't belong to the user (or doesn't exist)", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockResolvedValueOnce([]);

    const res = await fetch(`${baseUrl}/api/conversations/not-mine`, {
      headers: authHeaders,
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ message: "Conversation not found" });
    expect(dbSelectOrderByResult).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/conversations/:id", () => {
  it("deletes an owned conversation and returns 200", async () => {
    mockAuthOk();
    dbDeleteResult.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);

    const res = await fetch(`${baseUrl}/api/conversations/c1`, {
      method: "DELETE",
      headers: authHeaders,
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: "Conversation deleted" });
  });

  it("returns 404 when nothing was deleted", async () => {
    mockAuthOk();
    dbDeleteResult.mockResolvedValueOnce([{ affectedRows: 0 }, undefined]);

    const res = await fetch(`${baseUrl}/api/conversations/not-mine`, {
      method: "DELETE",
      headers: authHeaders,
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ message: "Conversation not found or not authorized" });
  });
});

describe("POST /api/chat", () => {
  it("starts a new conversation, calls the AI, and returns the parsed response", async () => {
    mockAuthOk(); // consumes dbSelectLimitResult #1 (auth check)
    dbSelectWhereResult.mockResolvedValueOnce([]); // no existing conversation
    dbInsertResult.mockResolvedValueOnce({}); // INSERT conversations
    dbInsertResult.mockResolvedValueOnce({}); // INSERT user message
    dbSelectLimitResult.mockResolvedValueOnce([]); // history fetch (orderBy+limit) — empty
    dbInsertResult.mockResolvedValueOnce({}); // INSERT bot message
    chatCompletionsCreate.mockResolvedValueOnce(
      aiResponse(baseSmartGoalResponse()),
    );

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "I want to walk again", conversationId: "c1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.conversationState).toBe("gathering_info");
    expect(body.goalData).toBeNull();
    expect(body.generatedText).toContain("That is a wonderful goal.");
    expect(body.generatedText).toContain("Does this goal feel right to you?");

    expect(fakeDb.transaction).toHaveBeenCalledTimes(1);
    expect(dbTransactionCommit).toHaveBeenCalledTimes(1);
    expect(dbTransactionRollback).not.toHaveBeenCalled();
    expect(dbInsertResult).toHaveBeenCalledTimes(3); // conversation, user msg, bot msg

    const [insertConvValues] = dbInsertResult.mock.calls[0]!;
    expect(insertConvValues.id).toBe("c1");
    expect(insertConvValues.userId).toBe("user-1");
  });

  it("updates updated_at instead of inserting when the conversation already exists", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockResolvedValueOnce([{ id: "c1" }]); // existing conversation
    dbUpdateResult.mockResolvedValueOnce({}); // UPDATE conversations
    dbInsertResult.mockResolvedValueOnce({}); // INSERT user message
    dbSelectLimitResult.mockResolvedValueOnce([]); // history
    dbInsertResult.mockResolvedValueOnce({}); // INSERT bot message
    chatCompletionsCreate.mockResolvedValueOnce(
      aiResponse(baseSmartGoalResponse()),
    );

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "continuing", conversationId: "c1" }),
    });

    expect(res.status).toBe(200);
    expect(dbUpdateResult).toHaveBeenCalledTimes(1);
    const [updateValues] = dbUpdateResult.mock.calls[0]!;
    expect(updateValues.updatedAt).toBeInstanceOf(Date);
    expect(dbInsertResult).toHaveBeenCalledTimes(2); // user msg, bot msg only — no conversation insert
  });

  it("falls back to the raw AI text when the response isn't valid JSON, without crashing", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockResolvedValueOnce([]);
    dbInsertResult.mockResolvedValueOnce({});
    dbInsertResult.mockResolvedValueOnce({});
    dbSelectLimitResult.mockResolvedValueOnce([]);
    dbInsertResult.mockResolvedValueOnce({});
    chatCompletionsCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "not valid json at all" } }],
    });

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hello", conversationId: "c1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.generatedText).toBe("not valid json at all");
    expect(body.conversationState).toBe("gathering_info");
    expect(body.goalData).toBeNull();
    expect(dbTransactionCommit).toHaveBeenCalledTimes(1);
  });

  it("persists a chat_goals row and marks the conversation completed when conversation_state is goal_complete", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockResolvedValueOnce([]); // no existing conversation
    dbInsertResult.mockResolvedValueOnce({}); // INSERT conversations
    dbInsertResult.mockResolvedValueOnce({}); // INSERT user message
    dbSelectLimitResult.mockResolvedValueOnce([]); // history
    dbInsertResult.mockResolvedValueOnce({}); // INSERT chat_goals
    dbUpdateResult.mockResolvedValueOnce({}); // UPDATE conversations status
    dbInsertResult.mockResolvedValueOnce({}); // INSERT bot message
    chatCompletionsCreate.mockResolvedValueOnce(
      aiResponse(baseSmartGoalResponse({ conversation_state: "goal_complete" })),
    );

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "yes that's perfect", conversationId: "c1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.conversationState).toBe("goal_complete");
    expect(body.goalData).not.toBeNull();
    expect(body.goalData.summary).toBe(baseSmartGoalResponse().goal_summary);

    expect(dbInsertResult).toHaveBeenCalledTimes(4); // conversation, user msg, chat_goals, bot msg
    const [chatGoalsValues] = dbInsertResult.mock.calls[2]!;
    expect(chatGoalsValues.goalSummary).toBe(baseSmartGoalResponse().goal_summary);
    expect(chatGoalsValues.conversationId).toBe("c1");

    expect(dbUpdateResult).toHaveBeenCalledTimes(1);
    const [statusUpdateValues] = dbUpdateResult.mock.calls[0]!;
    expect(statusUpdateValues.status).toBe("completed");
  });

  it("appends a risk warning to the message when risk_flag is true", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockResolvedValueOnce([]);
    dbInsertResult.mockResolvedValueOnce({});
    dbInsertResult.mockResolvedValueOnce({});
    dbSelectLimitResult.mockResolvedValueOnce([]);
    dbInsertResult.mockResolvedValueOnce({});
    chatCompletionsCreate.mockResolvedValueOnce(
      aiResponse(baseSmartGoalResponse({ risk_flag: true })),
    );

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "I feel chest pain but let's continue", conversationId: "c1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.generatedText).toContain(
      "This goal seems quite challenging. We will proceed carefully",
    );
  });

  it("returns 400 on an empty prompt and never opens a DB transaction", async () => {
    mockAuthOk();

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "", conversationId: "c1" }),
    });

    expect(res.status).toBe(400);
    expect(fakeDb.transaction).not.toHaveBeenCalled();
  });

  it("returns 401 with no token", async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hi", conversationId: "c1" }),
    });
    expect(res.status).toBe(401);
    expect(fakeDb.transaction).not.toHaveBeenCalled();
  });

  it("rolls back the transaction and returns 500 when the AI call fails", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockResolvedValueOnce([]);
    dbInsertResult.mockResolvedValueOnce({});
    dbInsertResult.mockResolvedValueOnce({});
    dbSelectLimitResult.mockResolvedValueOnce([]);
    chatCompletionsCreate.mockImplementationOnce(async () => {
      throw new Error("upstream AI failure");
    });

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hi", conversationId: "c1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ message: "Error communicating with AI." });
    expect(dbTransactionRollback).toHaveBeenCalledTimes(1);
    expect(dbTransactionCommit).not.toHaveBeenCalled();
    // No bot message or chat_goals insert should have happened — the error
    // is thrown before the 3rd dbInsertResult call (bot message) is reached.
    expect(dbInsertResult).toHaveBeenCalledTimes(2);
  });
});
