import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Home, BookOpen, User, MessageSquare, ClipboardList } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "../contexts/AuthContext";
import api from "../utilities/axiosConfig";

export function NavBar() {
  const { user } = useAuth();
  const location = useLocation();
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => {
    if (user?.role !== "clinician") return;
    api
      .get("/alerts/count")
      .then((r) => setAlertCount(r.data.count ?? 0))
      .catch(() => {});
  }, [user?.role, location.pathname]);

  return (
    <header className="sticky top-0 z-10 w-full bg-white shadow-sm">
      <nav className="flex justify-around items-center h-16 max-w-md mx-auto px-4">
        <NavLink to={"/"}>
          {({ isActive }) => (
            <Button
              variant="ghost"
              className={cn(
                "flex flex-col items-center space-y-1 h-auto p-2 cursor-pointer",
                isActive ? "text-blue-600" : "text-gray-500"
              )}
            >
              <Home className="h-6 w-6" />
              <span className="text-xs font-medium">Home</span>
            </Button>
          )}
        </NavLink>
        <NavLink to={"/explore"}>
          {({ isActive }) => (
            <Button
              variant="ghost"
              className={cn(
                "flex flex-col items-center space-y-1 h-auto p-2 cursor-pointer",
                isActive ? "text-blue-600" : "text-gray-500"
              )}
            >
              <BookOpen className="h-6 w-6" />
              <span className="text-xs font-medium">Explore</span>
            </Button>
          )}
        </NavLink>
        <NavLink to={"/chatbot"}>
          {({ isActive }) => (
            <Button
              variant="ghost"
              className={cn(
                "flex flex-col items-center space-y-1 h-auto p-2 cursor-pointer",
                isActive ? "text-blue-600" : "text-gray-500"
              )}
            >
              <MessageSquare className="h-6 w-6" />
              <span className="text-xs font-medium">Virtual Assistant</span>
            </Button>
          )}
        </NavLink>
        {user?.role === "clinician" && (
          <NavLink to={"/alerts"}>
            {({ isActive }) => (
              <Button
                variant="ghost"
                className={cn(
                  "flex flex-col items-center space-y-1 h-auto p-2 cursor-pointer",
                  isActive ? "text-blue-600" : "text-gray-500"
                )}
              >
                <div className="relative">
                  <ClipboardList className="h-6 w-6" />
                  {alertCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5">
                      {alertCount > 99 ? "99+" : alertCount}
                    </span>
                  )}
                </div>
                <span className="text-xs font-medium">Alerts</span>
              </Button>
            )}
          </NavLink>
        )}
        <NavLink to={"/profile"}>
          {({ isActive }) => (
            <Button
              variant="ghost"
              className={cn(
                "flex flex-col items-center space-y-1 h-auto p-2 cursor-pointer",
                isActive ? "text-blue-600" : "text-gray-500"
              )}
            >
              <User className="h-6 w-6" />
              <span className="text-xs font-medium">Me</span>
            </Button>
          )}
        </NavLink>
      </nav>
    </header>
  );
}
