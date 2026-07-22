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
  it("returns open alerts with patient name for a clinician", async () => {
    mockAuthOk();
    dbSelectOrderByResult.mockResolvedValueOnce([
      { ...ALERT_FIXTURE, patientName: "Alice Smith", patientEmail: "alice@example.com" },
    ]);
    const res = await fetch(`${baseUrl}/api/alerts`, {
      headers: authCookie(clinicianToken),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe("alert-1");
    expect(data[0].patientName).toBe("Alice Smith");
  });

  it("returns null patientName when the patient has not set a display name", async () => {
    mockAuthOk();
    dbSelectOrderByResult.mockResolvedValueOnce([
      { ...ALERT_FIXTURE, patientName: null, patientEmail: "alice@example.com" },
    ]);
    const res = await fetch(`${baseUrl}/api/alerts`, {
      headers: authCookie(clinicianToken),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data[0].patientName).toBeNull();
    expect(data[0].patientEmail).toBe("alice@example.com");
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

describe("GET /api/alerts/history", () => {
  const ACKNOWLEDGED_FIXTURE = {
    ...ALERT_FIXTURE,
    status: "acknowledged",
    patientName: "Alice Smith",
    patientEmail: "alice@example.com",
    acknowledgedBy: "clinician-1",
    acknowledgedAt: new Date(),
    resolvedAt: null,
  };

  it("returns acknowledged and resolved alerts for a clinician", async () => {
    mockAuthOk();
    dbSelectOrderByResult.mockResolvedValueOnce([ACKNOWLEDGED_FIXTURE]);
    const res = await fetch(`${baseUrl}/api/alerts/history`, {
      headers: authCookie(clinicianToken),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].status).toBe("acknowledged");
    expect(data[0].patientName).toBe("Alice Smith");
  });

  it("returns 403 for a patient", async () => {
    mockAuthOk();
    const res = await fetch(`${baseUrl}/api/alerts/history`, {
      headers: authCookie(patientToken),
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 with no token", async () => {
    const res = await fetch(`${baseUrl}/api/alerts/history`);
    expect(res.status).toBe(401);
  });

  it("returns 500 on DB failure", async () => {
    mockAuthOk();
    dbSelectOrderByResult.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    const res = await fetch(`${baseUrl}/api/alerts/history`, {
      headers: authCookie(clinicianToken),
    });
    expect(res.status).toBe(500);
  });
});

describe("GET /api/alerts/count", () => {
  it("returns the count of open alerts for a clinician", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockResolvedValueOnce([{ total: 3 }]);
    const res = await fetch(`${baseUrl}/api/alerts/count`, {
      headers: authCookie(clinicianToken),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBe(3);
  });

  it("returns 403 for a patient", async () => {
    mockAuthOk();
    const res = await fetch(`${baseUrl}/api/alerts/count`, {
      headers: authCookie(patientToken),
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 with no token", async () => {
    const res = await fetch(`${baseUrl}/api/alerts/count`);
    expect(res.status).toBe(401);
  });

  it("returns 500 on DB failure", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    const res = await fetch(`${baseUrl}/api/alerts/count`, {
      headers: authCookie(clinicianToken),
    });
    expect(res.status).toBe(500);
  });
});

describe("GET /api/alerts/:id", () => {
  it("returns the alert detail with patient name for a clinician", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockResolvedValueOnce([
      { ...ALERT_FIXTURE, patientName: "Alice Smith", patientEmail: "alice@example.com" },
    ]);
    const res = await fetch(`${baseUrl}/api/alerts/alert-1`, {
      headers: authCookie(clinicianToken),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe("alert-1");
    expect(data.triggerType).toBe("high_risk_goal");
    expect(data.patientName).toBe("Alice Smith");
    expect(data.patientEmail).toBe("alice@example.com");
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

  it("returns 500 on DB failure", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    const res = await fetch(`${baseUrl}/api/alerts/alert-1`, {
      headers: authCookie(clinicianToken),
    });
    expect(res.status).toBe(500);
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

  it("returns 400 for status:open (forward-only policy)", async () => {
    mockAuthOk();
    const res = await fetch(`${baseUrl}/api/alerts/alert-1`, {
      method: "PATCH",
      headers: {
        ...authCookie(clinicianToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "open" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when re-acknowledging a resolved alert (backward transition)", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockResolvedValueOnce([{ ...ALERT_FIXTURE, status: "resolved" }]);
    const res = await fetch(`${baseUrl}/api/alerts/alert-1`, {
      method: "PATCH",
      headers: {
        ...authCookie(clinicianToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "acknowledged" }),
    });
    expect(res.status).toBe(400);
  });

  it("updates only clinicianNote without changing status when status is omitted", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockResolvedValueOnce([ALERT_FIXTURE]);
    const res = await fetch(`${baseUrl}/api/alerts/alert-1`, {
      method: "PATCH",
      headers: {
        ...authCookie(clinicianToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ clinicianNote: "Note added" }),
    });
    expect(res.status).toBe(200);
    const updateValues = dbUpdateResult.mock.calls[0]?.[0] as any;
    expect(updateValues.status).toBeUndefined();
    expect(updateValues.clinicianNote).toBe("Note added");
    expect(updateValues.acknowledgedBy).toBeUndefined();
  });

  it("does not overwrite acknowledgedBy on a second acknowledge", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockResolvedValueOnce([{
      ...ALERT_FIXTURE,
      status: "acknowledged",
      acknowledgedBy: "original-clinician",
    }]);
    const res = await fetch(`${baseUrl}/api/alerts/alert-1`, {
      method: "PATCH",
      headers: {
        ...authCookie(clinicianToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "acknowledged", clinicianNote: "Second note" }),
    });
    expect(res.status).toBe(200);
    const updateValues = dbUpdateResult.mock.calls[0]?.[0] as any;
    expect(updateValues.acknowledgedBy).toBeUndefined();
    expect(updateValues.acknowledgedAt).toBeUndefined();
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
