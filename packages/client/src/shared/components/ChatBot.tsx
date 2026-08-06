import { useEffect, useState } from "react";
import popSound from "@/assets/sounds/pop.mp3";
import notificationSound from "@/assets/sounds/notification.mp3";
import ChatInput, { type ChatFormData } from "./ChatInput";
import type { Message } from "./ChatMessages";
import ChatMessages from "./ChatMessages";
import TypingIndicator from "./TypingIndicator";
import { Menu } from "lucide-react";
import ChatSidebar from "./ChatSidebar";
import api from "../utilities/axiosConfig";

const popAudio = new Audio(popSound);
popAudio.volume = 0.2;

const notificationAudio = new Audio(notificationSound);
notificationAudio.volume = 0.2;

type SmartAssessment = {
  is_specific: boolean;
  is_measurable: boolean;
  is_achievable: boolean;
  is_relevant: boolean;
  is_time_bound: boolean;
};

type GoalData = {
  summary: string;
  smartData: {
    goal_category: string;
    target_activity: string;
    current_ability: string;
    measurement: {
      metric: string;
      current_value: number | null;
      target_value: number | null;
      unit: string;
    };
    frequency: string;
    timeline_weeks: number;
    assistance_level: number;
    smart_assessment: SmartAssessment;
  };
  riskAssessment: {
    score: number;
    level: "LOW" | "MODERATE" | "HIGH";
    requires_approval: boolean;
  };
};

type ChatResponse = {
  generatedText: string;
  conversationState: "gathering_info" | "drafting_goal" | "refining_goal" | "goal_complete" | "emergency_closed";
  goalData: GoalData | null;
};

type Conversation = {
  id: string;
  title: string;
  updated_at: string;
  status: "active" | "completed" | "emergency_closed";
};

const SMART_LABELS: Record<keyof SmartAssessment, string> = {
  is_specific: "Specific",
  is_measurable: "Measurable",
  is_achievable: "Achievable",
  is_relevant: "Relevant",
  is_time_bound: "Time-bound",
};

const RISK_COLOURS: Record<string, string> = {
  LOW: "text-green-600",
  MODERATE: "text-amber-600",
  HIGH: "text-red-600",
};

/** "upper_limb" → "Upper Limb",  "adl" → "ADL" */
function formatCategory(s: string): string {
  return s
    .split("_")
    .map((w) => (w === "adl" ? "ADL" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Capitalise the first letter of a sentence from the AI. */
function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** "scale_1_to_5" → "Scale 1 to 5",  "meters" → "Meters" */
function formatUnit(s: string): string {
  return s
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const ChatBot = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [error, setError] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>(
    crypto.randomUUID()
  );
  const [isConversationComplete, setIsConversationComplete] = useState(false);
  const [completedGoalData, setCompletedGoalData] = useState<GoalData | null>(null);
  const [isEmergencyClosed, setIsEmergencyClosed] = useState(false);

  useEffect(() => {
    fetchConversations();
  }, []);

  const fetchConversations = async () => {
    try {
      const { data } = await api.get<Conversation[]>("/conversations");
      setConversations(data);
    } catch (err) {
      console.error("Failed to load history", err);
    }
  };

  const handleNewChat = () => {
    const newId = crypto.randomUUID();
    setActiveConversationId(newId);
    setMessages([]);
    setError("");
    setIsConversationComplete(false);
    setCompletedGoalData(null);
    setIsEmergencyClosed(false);
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const handleSelectConversation = async (id: string) => {
    try {
      setActiveConversationId(id);
      setError("");
      setCompletedGoalData(null);
      setIsEmergencyClosed(false);
      const { data } = await api.get<Message[]>(`/conversations/${id}`);
      setMessages(data);
      const conv = conversations.find((c) => c.id === id);
      const closed = conv?.status === "completed" || conv?.status === "emergency_closed";
      setIsConversationComplete(closed);
      setIsEmergencyClosed(conv?.status === "emergency_closed");
      if (window.innerWidth < 768) setIsSidebarOpen(false);
    } catch (err) {
      console.error("Failed to load chat", err);
      setError("Could not load this conversation.");
    }
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      await api.delete(`/conversations/${id}`);

      setConversations((prev) => prev.filter((c) => c.id !== id));

      if (id === activeConversationId) {
        handleNewChat();
      }
    } catch (err) {
      console.error("Failed to delete chat", err);
      setError("Could not delete conversation");
    }
  };
  const onSubmit = async ({ prompt }: ChatFormData) => {
    try {
      const newMsg: Message = { content: prompt, role: "user" };
      setMessages((prev) => [...prev, newMsg]);
      setIsBotTyping(true);
      setError("");
      popAudio.play();

      const { data } = await api.post<ChatResponse>("/chat", {
        prompt,
        conversationId: activeConversationId,
      });

      const botMsg: Message = { content: data.generatedText, role: "bot" };
      setMessages((prev) => [...prev, botMsg]);
      notificationAudio.play();

      if (data.conversationState === "goal_complete") {
        setIsConversationComplete(true);
        setCompletedGoalData(data.goalData);
      } else if (data.conversationState === "emergency_closed") {
        setIsConversationComplete(true);
        setIsEmergencyClosed(true);
      }

      fetchConversations();
    } catch (error) {
      console.error(error);
      setError("Something went wrong, try again!");
    } finally {
      setIsBotTyping(false);
    }
  };

  return (
    <div className="relative flex h-[calc(100vh-4.5rem)] w-full bg-white overflow-hidden">
      <ChatSidebar
        isOpen={isSidebarOpen}
        conversations={conversations}
        activeId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
        onDeleteConversation={handleDeleteConversation}
      />

      <div className="flex-1 flex flex-col h-full min-w-0">
        <div className="flex items-center p-2 md:p-4">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 rounded-md text-gray-600 hover:bg-gray-100 transition-colors focus:outline-none"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="ml-4 font-medium text-gray-700">
            Camay Rehabilitation Assistant
          </span>
        </div>

        <div className="flex flex-col flex-1 p-4 overflow-hidden max-w-3xl w-full mx-auto">
          <div className="flex flex-col flex-1 gap-3 mb-5 overflow-y-auto">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <p className="text-xl">
                  Hello, how can I help with your recovery today?
                </p>
              </div>
            ) : (
              <ChatMessages messages={messages} />
            )}

            {isBotTyping && <TypingIndicator />}
            {error && <p className="text-red-500 text-center">{error}</p>}

            {isConversationComplete && isEmergencyClosed && (
              <div className="border-2 border-red-300 bg-red-50 rounded-xl p-4 mt-2 text-center">
                <p className="text-red-700 font-semibold text-sm mb-1">
                  This conversation was closed after a safety concern.
                </p>
                <p className="text-gray-600 text-xs mb-3">
                  Please contact your care team. Start a new conversation when you are safe and have seen a doctor.
                </p>
                <button
                  onClick={handleNewChat}
                  className="py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                >
                  Start New Conversation
                </button>
              </div>
            )}

            {isConversationComplete && completedGoalData && (
              <div className="border-2 border-green-300 bg-green-50 rounded-xl p-4 mt-2">
                <h3 className="font-semibold text-green-800 text-base mb-1">
                  Goal saved
                </h3>
                <p className="text-gray-700 text-sm mb-3">
                  {completedGoalData.summary}
                </p>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 mb-3">
                  <div>
                    <span className="font-medium">Category:</span>{" "}
                    {formatCategory(completedGoalData.smartData.goal_category)}
                  </div>
                  <div>
                    <span className="font-medium">Timeline:</span>{" "}
                    {completedGoalData.smartData.timeline_weeks} weeks
                  </div>
                  <div className="col-span-2">
                    <span className="font-medium">Activity:</span>{" "}
                    {capitalise(completedGoalData.smartData.target_activity)}
                  </div>
                  <div>
                    <span className="font-medium">Frequency:</span>{" "}
                    {completedGoalData.smartData.frequency
                      ? capitalise(completedGoalData.smartData.frequency)
                      : "Not specified"}
                  </div>
                  {completedGoalData.smartData.measurement.target_value !== null && (
                    <div>
                      <span className="font-medium">Target:</span>{" "}
                      {completedGoalData.smartData.measurement.current_value !== null && (
                        <span className="text-gray-400">
                          {completedGoalData.smartData.measurement.current_value} →{" "}
                        </span>
                      )}
                      {completedGoalData.smartData.measurement.target_value}{" "}
                      <span className="text-gray-400">
                        ({formatUnit(completedGoalData.smartData.measurement.unit)})
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex gap-1 flex-wrap mb-3">
                  {(
                    Object.entries(
                      completedGoalData.smartData.smart_assessment,
                    ) as [keyof SmartAssessment, boolean][]
                  ).map(([key, value]) => (
                    <span
                      key={key}
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        value
                          ? "bg-green-200 text-green-800"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {SMART_LABELS[key]} {value ? "✓" : "✗"}
                    </span>
                  ))}
                </div>

                <p
                  className={`text-xs font-medium mb-3 ${RISK_COLOURS[completedGoalData.riskAssessment.level]}`}
                >
                  Risk level: {completedGoalData.riskAssessment.level} (score:{" "}
                  {completedGoalData.riskAssessment.score})
                  {completedGoalData.riskAssessment.requires_approval &&
                    " — therapist review recommended"}
                </p>

                <button
                  onClick={handleNewChat}
                  className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                >
                  Start New Conversation
                </button>
              </div>
            )}

            {isConversationComplete && !completedGoalData && (
              <div className="border border-green-200 bg-green-50 rounded-xl p-4 mt-2 text-center">
                <p className="text-green-700 font-medium text-sm mb-3">
                  This conversation has been completed.
                </p>
                <button
                  onClick={handleNewChat}
                  className="py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                >
                  Start New Conversation
                </button>
              </div>
            )}
          </div>

          <div className="w-full">
            <ChatInput onSubmit={onSubmit} disabled={isConversationComplete} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatBot;
