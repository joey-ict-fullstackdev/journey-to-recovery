import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import {
  app,
  fakePool,
  fakeChatConnection,
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
    fakePool.execute.mockResolvedValueOnce([
      [{ id: "c1", title: "Chat 1" }],
      undefined,
    ]);

    const res = await fetch(`${baseUrl}/api/conversations`, {
      headers: authHeaders,
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([{ id: "c1", title: "Chat 1" }]);
  });

  it("returns 500 on a DB failure", async () => {
    mockAuthOk();
    fakePool.execute.mockImplementationOnce(async () => {
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
    fakePool.execute.mockResolvedValueOnce([[{ id: "c1" }], undefined]); // ownership check
    fakePool.query.mockResolvedValueOnce([
      [{ content: "hi", role: "user" }],
      undefined,
    ]);

    const res = await fetch(`${baseUrl}/api/conversations/c1`, {
      headers: authHeaders,
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([{ content: "hi", role: "user" }]);
  });

  it("returns 404 when the conversation doesn't belong to the user (or doesn't exist)", async () => {
    mockAuthOk();
    fakePool.execute.mockResolvedValueOnce([[], undefined]);

    const res = await fetch(`${baseUrl}/api/conversations/not-mine`, {
      headers: authHeaders,
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ message: "Conversation not found" });
    expect(fakePool.query).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/conversations/:id", () => {
  it("deletes an owned conversation and returns 200", async () => {
    mockAuthOk();
    fakePool.query.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);

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
    fakePool.query.mockResolvedValueOnce([{ affectedRows: 0 }, undefined]);

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
    mockAuthOk();
    fakeChatConnection.query.mockResolvedValueOnce([[], undefined]); // no existing conversation
    fakeChatConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // INSERT conversations
    fakeChatConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // INSERT user message
    fakeChatConnection.query.mockResolvedValueOnce([[], undefined]); // history
    fakeChatConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // INSERT bot message
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

    expect(fakeChatConnection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(fakeChatConnection.commit).toHaveBeenCalledTimes(1);
    expect(fakeChatConnection.rollback).not.toHaveBeenCalled();
    expect(fakeChatConnection.release).toHaveBeenCalledTimes(1);

    const [insertConvSql] = fakeChatConnection.query.mock.calls[1]!;
    expect(insertConvSql).toContain("INSERT INTO conversations");
  });

  it("updates updated_at instead of inserting when the conversation already exists", async () => {
    mockAuthOk();
    fakeChatConnection.query.mockResolvedValueOnce([[{ id: "c1" }], undefined]); // existing conversation
    fakeChatConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // UPDATE conversations
    fakeChatConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // INSERT user message
    fakeChatConnection.query.mockResolvedValueOnce([[], undefined]); // history
    fakeChatConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // INSERT bot message
    chatCompletionsCreate.mockResolvedValueOnce(
      aiResponse(baseSmartGoalResponse()),
    );

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "continuing", conversationId: "c1" }),
    });

    expect(res.status).toBe(200);
    const [updateConvSql] = fakeChatConnection.query.mock.calls[1]!;
    expect(updateConvSql).toContain("UPDATE conversations SET updated_at");
  });

  it("falls back to the raw AI text when the response isn't valid JSON, without crashing", async () => {
    mockAuthOk();
    fakeChatConnection.query.mockResolvedValueOnce([[], undefined]);
    fakeChatConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
    fakeChatConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
    fakeChatConnection.query.mockResolvedValueOnce([[], undefined]);
    fakeChatConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
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
    expect(fakeChatConnection.commit).toHaveBeenCalledTimes(1);
  });

  it("persists a chat_goals row and marks the conversation completed when conversation_state is goal_complete", async () => {
    mockAuthOk();
    fakeChatConnection.query.mockResolvedValueOnce([[], undefined]); // no existing conversation
    fakeChatConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // INSERT conversations
    fakeChatConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // INSERT user message
    fakeChatConnection.query.mockResolvedValueOnce([[], undefined]); // history
    fakeChatConnection.query.mockResolvedValueOnce([{ insertId: 1 }, undefined]); // INSERT chat_goals
    fakeChatConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // UPDATE conversations status
    fakeChatConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // INSERT bot message
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

    const [chatGoalsSql] = fakeChatConnection.query.mock.calls[4]!;
    expect(chatGoalsSql).toContain("INSERT INTO chat_goals");
    const [updateStatusSql] = fakeChatConnection.query.mock.calls[5]!;
    expect(updateStatusSql).toContain("UPDATE conversations SET status = 'completed'");
  });

  it("appends a risk warning to the message when risk_flag is true", async () => {
    mockAuthOk();
    fakeChatConnection.query.mockResolvedValueOnce([[], undefined]);
    fakeChatConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
    fakeChatConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
    fakeChatConnection.query.mockResolvedValueOnce([[], undefined]);
    fakeChatConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
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
    expect(fakePool.getConnection).not.toHaveBeenCalled();
  });

  it("returns 401 with no token", async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hi", conversationId: "c1" }),
    });
    expect(res.status).toBe(401);
    expect(fakePool.getConnection).not.toHaveBeenCalled();
  });

  it("rolls back the transaction and returns 500 when the AI call fails", async () => {
    mockAuthOk();
    fakeChatConnection.query.mockResolvedValueOnce([[], undefined]);
    fakeChatConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
    fakeChatConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
    fakeChatConnection.query.mockResolvedValueOnce([[], undefined]);
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
    expect(fakeChatConnection.rollback).toHaveBeenCalledTimes(1);
    expect(fakeChatConnection.commit).not.toHaveBeenCalled();
    expect(fakeChatConnection.release).toHaveBeenCalledTimes(1);
  });
});
