import { describe, it, expect, mock } from "bun:test";
// Importing _testUtils first ensures db/connection + openai are mocked (via
// mock.module) before middleware/auth.ts's own `import { db } from
// "../db/connection"` is resolved anywhere in the module graph — requireRole
// itself never touches the DB, but this keeps the import safe/consistent
// with every other test file's setup rather than hitting a real pool.
import "./_testUtils";
import { requireRole } from "../../middleware/auth";

function makeRes() {
  const res: any = {
    statusCode: undefined as number | undefined,
    body: undefined as any,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: any) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

describe("requireRole middleware", () => {
  it("calls next() when the authenticated user's role matches", () => {
    const req: any = { user: { id: "clinician-1", role: "clinician" } };
    const res = makeRes();
    const next = mock(() => {});

    requireRole("clinician")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
  });

  it("returns 403 when the authenticated user's role does not match", () => {
    const req: any = { user: { id: "patient-1", role: "patient" } };
    const res = makeRes();
    const next = mock(() => {});

    requireRole("clinician")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ message: "Forbidden." });
  });

  it("returns 403 rather than throwing when req.user is missing entirely", () => {
    const req: any = {};
    const res = makeRes();
    const next = mock(() => {});

    expect(() => requireRole("clinician")(req, res, next)).not.toThrow();
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});
