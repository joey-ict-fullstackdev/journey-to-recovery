import { useEffect, useState } from "react";
import api from "../utilities/axiosConfig";

interface Alert {
  id: string;
  userId: string;
  triggerType: "high_risk_goal" | "risk_flag_message";
  riskLevel: string;
  riskScore: number;
  triggerMessageSnippet: string | null;
  status: string;
  clinicianNote: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  patientName: string | null;
  patientEmail: string;
}

const TRIGGER_LABELS: Record<string, string> = {
  high_risk_goal: "High-risk goal",
  risk_flag_message: "Safety flag",
};

const LEVEL_COLORS: Record<string, string> = {
  HIGH: "bg-red-100 text-red-700",
  VERY_HIGH: "bg-red-200 text-red-800",
  MODERATE: "bg-yellow-100 text-yellow-700",
  LOW: "bg-gray-100 text-gray-600",
};

const STATUS_COLORS: Record<string, string> = {
  acknowledged: "bg-yellow-100 text-yellow-700",
  resolved: "bg-green-100 text-green-700",
};

function AlertCard({ alert }: { alert: Alert }) {
  return (
    <div className="border rounded-xl p-4 space-y-2 bg-white shadow-sm">
      <div className="flex items-center justify-between">
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            LEVEL_COLORS[alert.riskLevel] ?? "bg-gray-100 text-gray-600"
          }`}
        >
          {alert.riskLevel}
        </span>
        <span className="text-xs text-gray-400">
          {new Date(alert.createdAt).toLocaleString()}
        </span>
      </div>
      <p className="text-sm font-medium text-gray-700">
        {TRIGGER_LABELS[alert.triggerType] ?? alert.triggerType}
      </p>
      {alert.triggerMessageSnippet && (
        <p className="text-sm text-gray-500 italic">"{alert.triggerMessageSnippet}"</p>
      )}
      <p className="text-xs text-gray-400">
        Patient: {alert.patientName ?? alert.patientEmail}
      </p>
    </div>
  );
}

export default function AlertQueuePage() {
  const [view, setView] = useState<"open" | "history">("open");
  const [openAlerts, setOpenAlerts] = useState<Alert[]>([]);
  const [historyAlerts, setHistoryAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const endpoint = view === "open" ? "/alerts" : "/alerts/history";
    api
      .get(endpoint)
      .then((r) => {
        if (view === "open") setOpenAlerts(r.data);
        else setHistoryAlerts(r.data);
        setError(null);
      })
      .catch(() => setError("Failed to load alerts."))
      .finally(() => setLoading(false));
  }, [view]);

  const handleUpdate = async (id: string, status: "acknowledged" | "resolved") => {
    setUpdating(id);
    try {
      await api.patch(`/alerts/${id}`, {
        status,
        ...(notes[id]?.trim() && { clinicianNote: notes[id].trim() }),
      });
      setOpenAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch {
      setError("Failed to update alert. Please try again.");
    } finally {
      setUpdating(null);
    }
  };

  const displayed = view === "open" ? openAlerts : historyAlerts;

  return (
    <div className="max-w-md mx-auto px-4 py-6 space-y-4">
      <h1 className="text-xl font-semibold text-gray-800">Alert Review Queue</h1>

      {/* Tab toggle */}
      <div className="flex rounded-lg border overflow-hidden text-sm">
        {(["open", "history"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex-1 py-1.5 cursor-pointer transition-colors ${
              view === v
                ? "bg-blue-600 text-white font-medium"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {v === "open" ? "Open" : "History"}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {loading && (
        <div className="flex justify-center items-center min-h-20 text-gray-500 text-sm">
          Loading…
        </div>
      )}

      {!loading && displayed.length === 0 && !error && (
        <p className="text-gray-500 text-sm">
          {view === "open" ? "No open alerts." : "No history yet."}
        </p>
      )}

      {!loading &&
        view === "open" &&
        openAlerts.map((alert) => (
          <div key={alert.id} className="border rounded-xl p-4 space-y-3 bg-white shadow-sm">
            <div className="flex items-center justify-between">
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  LEVEL_COLORS[alert.riskLevel] ?? "bg-gray-100 text-gray-600"
                }`}
              >
                {alert.riskLevel}
              </span>
              <span className="text-xs text-gray-400">
                {new Date(alert.createdAt).toLocaleString()}
              </span>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">
                {TRIGGER_LABELS[alert.triggerType] ?? alert.triggerType}
              </p>
              {alert.triggerMessageSnippet && (
                <p className="text-sm text-gray-500 mt-1 italic">
                  "{alert.triggerMessageSnippet}"
                </p>
              )}
              <p className="text-xs text-gray-400 mt-1">
                Patient: {alert.patientName ?? alert.patientEmail}
              </p>
            </div>
            <textarea
              className="w-full text-sm border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
              rows={2}
              placeholder="Add a clinician note (optional)…"
              value={notes[alert.id] ?? ""}
              onChange={(e) => setNotes((prev) => ({ ...prev, [alert.id]: e.target.value }))}
            />
            <div className="flex gap-2">
              <button
                disabled={updating === alert.id}
                onClick={() => handleUpdate(alert.id, "acknowledged")}
                className="flex-1 text-sm py-1.5 rounded-lg bg-yellow-50 text-yellow-700 border border-yellow-200 hover:bg-yellow-100 disabled:opacity-50 cursor-pointer"
              >
                Acknowledge
              </button>
              <button
                disabled={updating === alert.id}
                onClick={() => handleUpdate(alert.id, "resolved")}
                className="flex-1 text-sm py-1.5 rounded-lg bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 disabled:opacity-50 cursor-pointer"
              >
                Resolve
              </button>
            </div>
          </div>
        ))}

      {!loading &&
        view === "history" &&
        historyAlerts.map((alert) => (
          <div key={alert.id} className="space-y-1">
            <AlertCard alert={alert} />
            <div className="px-1 flex items-center gap-2">
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  STATUS_COLORS[alert.status] ?? "bg-gray-100 text-gray-600"
                }`}
              >
                {alert.status}
              </span>
              {alert.clinicianNote && (
                <p className="text-xs text-gray-500 italic truncate">"{alert.clinicianNote}"</p>
              )}
            </div>
          </div>
        ))}
    </div>
  );
}
