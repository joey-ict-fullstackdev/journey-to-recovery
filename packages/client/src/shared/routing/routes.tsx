import { createBrowserRouter } from "react-router-dom";
import Signup from "../components/Signup";
import Login from "../components/Login";
import ProfileForm from "../components/ProfileForm";
import Dashboard from "../components/DashBoard";
import PrivateRoutes from "./PrivateRoutes";
import ClinicianRoute from "./ClinicianRoute";
import Layout from "../routing/Layout";
import ExplorePage from "../components/ExplorePage";
import DailyCheckinPage from "../components/DailyCheckinPage";
import CheckinConfirmationPage from "../components/CheckinConfirmationPage";
import WelcomePage from "../components/WelcomePage";
import GoalSettingPage from "../components/GoalSettingPage";
import GettingStartedPage from "../components/GettingStartedPage.tsx";
import GoalPromptPage from "../components/GoalPromptPage.tsx";
import ExistingGoalPage from "../components/ExistingGoalPage.tsx";
import SmartGoalPage from "../components/SmartGoalPage.tsx";
import SmartGoalExamplesPage from "../components/SmartGoalExamplesPage.tsx";
import SmartGoalFormIntroPage from "../components/SmartGoalFormIntroPage.tsx";
import SmartGoalFormPage from "../components/SmartGoalFormPage.tsx";
import SmartGoalConfirmPage from "../components/SmartGoalConfirmPage.tsx";
import MotivationIntroPage from "../components/MotivationIntroPage.tsx";
import MotivationPromptPage from "../components/MotivationPromptPage.tsx";
import ImportanceRulerPage from "../components/ImportanceRulerPage.tsx";
import ImportanceResultPage from "../components/ImportanceResultPage.tsx";
import MotivationWhyPage from "../components/MotivationWhyPage.tsx";
import ConfidenceIntroPage from "../components/ConfidenceIntroPage.tsx";
import ConfidenceRulerPage from "../components/ConfidenceRulerPage.tsx";
import ConfidenceResultPage from "../components/ConfidenceResultPage.tsx";
import ConfidenceWhyPage from "../components/ConfidenceWhyPage.tsx";
import GoalSummaryPage from "../components/GoalSummaryPage.tsx";
import SetReminderPage from "../components/SetReminderPage.tsx";
import ReminderSchedulePage from "../components/ReminderSchedulePage.tsx";
import DailyReminderPage from "../components/DailyReminderPage.tsx";
import GoalConfirmationPage from "../components/GoalConfirmationPage.tsx";
import WeeklyReminderPage from "../components/WeeklyReminderPage.tsx";
import StrengthsIntroPage from "../components/StrengthsIntroPage.tsx";
import StrengthsFormPage from "../components/StrengthsFormPage.tsx";
import StrengthsSummaryPage from "../components/StrengthsSummaryPage.tsx";
import WellnessWheelIntroPage from "../components/WellnessWheelIntroPage.tsx";
import WellnessWheelInstructionsPage from "../components/WellnessWheelInstructionsPage.tsx";
import WellnessWheelFormPage from "../components/WellnessWheelFormPage.tsx";
import WellnessWheelSummaryPage from "../components/WellnessWheelSummaryPage.tsx";
import NewGoalIntroPage from "../components/NewGoalIntroPage.tsx";
import GoalOptionsPage from "../components/GoalOptionsPage.tsx";
import ChatBot from "../components/ChatBot.tsx";
import AlertQueuePage from "../components/AlertQueuePage.tsx";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { path: "signup", element: <Signup /> },
      { path: "login", element: <Login /> },
      {
        element: <PrivateRoutes />,
        children: [
          { index: true, element: <Dashboard /> },
          { path: "profile", element: <ProfileForm /> },
          { path: "explore", element: <ExplorePage /> },
          { path: "check-in", element: <DailyCheckinPage /> },
          { path: "check-in/confirm", element: <CheckinConfirmationPage /> },
          { path: "welcome", element: <WelcomePage /> },
          { path: "goal-setting", element: <GoalSettingPage /> },
          { path: "getting-started", element: <GettingStartedPage /> },
          { path: "goal-prompt", element: <GoalPromptPage /> },
          { path: "existing-goal", element: <ExistingGoalPage /> },
          { path: "strengths-intro", element: <StrengthsIntroPage /> },
          { path: "strengths-form", element: <StrengthsFormPage /> },
          { path: "strengths-summary", element: <StrengthsSummaryPage /> },
          { path: "wellness-intro", element: <WellnessWheelIntroPage /> },
          { path: "wellness-instructions", element: <WellnessWheelInstructionsPage /> },
          { path: "wellness-wheel-form", element: <WellnessWheelFormPage /> },
          { path: "wellness-summary", element: <WellnessWheelSummaryPage /> },
          { path: "new-goal-intro", element: <NewGoalIntroPage /> },
          { path: "smart-goal", element: <SmartGoalPage /> },
          { path: "smart-goal-examples", element: <SmartGoalExamplesPage /> },
          { path: "smart-goal-intro", element: <SmartGoalFormIntroPage /> },
          { path: "smart-goal-form", element: <SmartGoalFormPage /> },
          { path: "smart-goal-confirm", element: <SmartGoalConfirmPage /> },
          { path: "motivation-intro", element: <MotivationIntroPage /> },
          { path: "motivation-prompt", element: <MotivationPromptPage /> },
          { path: "importance-ruler", element: <ImportanceRulerPage /> },
          { path: "importance-result", element: <ImportanceResultPage /> },
          { path: "motivation-why", element: <MotivationWhyPage /> },
          { path: "confidence-intro", element: <ConfidenceIntroPage /> },
          { path: "confidence-ruler", element: <ConfidenceRulerPage /> },
          { path: "confidence-result", element: <ConfidenceResultPage /> },
          { path: "confidence-why", element: <ConfidenceWhyPage /> },
          { path: "goal-summary", element: <GoalSummaryPage /> },
          { path: "set-reminder", element: <SetReminderPage /> },
          { path: "reminder-schedule", element: <ReminderSchedulePage /> },
          { path: "daily-reminder", element: <DailyReminderPage /> },
          { path: "weekly-reminder", element: <WeeklyReminderPage /> },
          { path: "goal-confirmation", element: <GoalConfirmationPage /> },
          { path: "goal-options", element: <GoalOptionsPage /> },
          { path: "chatbot", element: <ChatBot /> },
          {
            element: <ClinicianRoute />,
            children: [{ path: "alerts", element: <AlertQueuePage /> }],
          },
        ],
      },
    ],
  },
]);
