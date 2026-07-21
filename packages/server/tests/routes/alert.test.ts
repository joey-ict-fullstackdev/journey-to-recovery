import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import {
  startServer,
  stopServer,
  signTestAccessToken,
  authCookie,
  mockAuthOk,
  resetMocks,
  dbSelectWhereResult,
  dbSelectOrderByResult,
  dbUpdateResult,
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

const clinicianToken = signTestAccessToken({
  id: "clinician-1",
  email: "clinician@example.com",
  role: "clinician",
});
const patientToken = signTestAccessToken({
  id: "patient-1",
  email: "patient@example.com",
  role: "patient",
});

const ALERT_FIXTURE = {
  id: "alert-1",
  userId: "patient-1",
  conversationId: "conv-1",
  chatGoalId: null,
  triggerType: "high_risk_goal",
  riskScore: 150,
  riskLevel: "HIGH",
  triggerMessageSnippet: "Walk 2km in 1 week",
  status: "open",
  clinicianNote: null,
  acknowledgedBy: null,
  createdAt: new Date(),
  acknowledgedAt: null,
  resolvedAt: null,
  updatedAt: new Date(),
};

describe("GET /api/alerts", () => {
  it("returns open alerts for a clinician", async () => {
    mockAuthOk();
    dbSelectOrderByResult.mockResolvedValueOnce([ALERT_FIXTURE]);
    const res = await fetch(`${baseUrl}/api/alerts`, {
      headers: authCookie(clinicianToken),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe("alert-1");
  });

  it("returns 403 for a patient", async () => {
    mockAuthOk();
    const res = await fetch(`${baseUrl}/api/alerts`, {
      headers: authCookie(patientToken),
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 with no token", async () => {
    const res = await fetch(`${baseUrl}/api/alerts`);
    expect(res.status).toBe(401);
  });

  it("returns 500 on DB failure", async () => {
    mockAuthOk();
    dbSelectOrderByResult.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    const res = await fetch(`${baseUrl}/api/alerts`, {
      headers: authCookie(clinicianToken),
    });
    expect(res.status).toBe(500);
  });
});

describe("GET /api/alerts/:id", () => {
  it("returns the alert detail for a clinician", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockResolvedValueOnce([ALERT_FIXTURE]);
    const res = await fetch(`${baseUrl}/api/alerts/alert-1`, {
      headers: authCookie(clinicianToken),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe("alert-1");
    expect(data.triggerType).toBe("high_risk_goal");
  });

  it("returns 404 when alert not found", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockResolvedValueOnce([]);
    const res = await fetch(`${baseUrl}/api/alerts/nonexistent`, {
      headers: authCookie(clinicianToken),
    });
    expect(res.status).toBe(404);
  });

  it("returns 403 for a patient", async () => {
    mockAuthOk();
    const res = await fetch(`${baseUrl}/api/alerts/alert-1`, {
      headers: authCookie(patientToken),
    });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/alerts/:id", () => {
  it("acknowledges an alert and sets acknowledgedBy/acknowledgedAt", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockResolvedValueOnce([ALERT_FIXTURE]);
    const res = await fetch(`${baseUrl}/api/alerts/alert-1`, {
      method: "PATCH",
      headers: {
        ...authCookie(clinicianToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "acknowledged", clinicianNote: "Reviewed with patient" }),
    });
    expect(res.status).toBe(200);
    // dbUpdateResult is called with the .set() argument
    const updateValues = dbUpdateResult.mock.calls[0]?.[0] as any;
    expect(updateValues.status).toBe("acknowledged");
    expect(updateValues.acknowledgedBy).toBe("clinician-1");
    expect(updateValues.acknowledgedAt).toBeInstanceOf(Date);
    expect(updateValues.clinicianNote).toBe("Reviewed with patient");
  });

  it("resolves an alert and sets resolvedAt", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockResolvedValueOnce([ALERT_FIXTURE]);
    const res = await fetch(`${baseUrl}/api/alerts/alert-1`, {
      method: "PATCH",
      headers: {
        ...authCookie(clinicianToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "resolved" }),
    });
    expect(res.status).toBe(200);
    const updateValues = dbUpdateResult.mock.calls[0]?.[0] as any;
    expect(updateValues.status).toBe("resolved");
    expect(updateValues.resolvedAt).toBeInstanceOf(Date);
    // acknowledged* columns must NOT be set on a direct open→resolved skip
    expect(updateValues.acknowledgedBy).toBeUndefined();
    expect(updateValues.acknowledgedAt).toBeUndefined();
  });

  it("returns 404 when alert not found", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockResolvedValueOnce([]);
    const res = await fetch(`${baseUrl}/api/alerts/nonexistent`, {
      method: "PATCH",
      headers: {
        ...authCookie(clinicianToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "acknowledged" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 for an invalid status value", async () => {
    mockAuthOk();
    const res = await fetch(`${baseUrl}/api/alerts/alert-1`, {
      method: "PATCH",
      headers: {
        ...authCookie(clinicianToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "banana" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 for a patient", async () => {
    mockAuthOk();
    const res = await fetch(`${baseUrl}/api/alerts/alert-1`, {
      method: "PATCH",
      headers: {
        ...authCookie(patientToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "acknowledged" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 500 on DB failure", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    const res = await fetch(`${baseUrl}/api/alerts/alert-1`, {
      method: "PATCH",
      headers: {
        ...authCookie(clinicianToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "acknowledged" }),
    });
    expect(res.status).toBe(500);
  });
});
