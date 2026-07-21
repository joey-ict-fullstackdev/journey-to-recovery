import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { AuthContextType, User } from "../utilities/types";
import { useNavigate } from "react-router-dom";
import api from "../utilities/axiosConfig";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  const fetchUser = useCallback(async () => {
    try {
      const response = await api.get("/profile");
      setUser(response.data.userInfo); // You had .user, but your backend sends .userInfo
    } catch (error) {
      setUser(null);
      console.error("Failed to fetch user", error);
    }
  }, []);

  // The access token is an httpOnly cookie now, invisible to JS — there's no
  // local signal for "is there a session" to check before asking the server.
  useEffect(() => {
    const checkAuthStatus = async () => {
      await fetchUser();
      setIsLoading(false);
    };
    checkAuthStatus();
  }, [fetchUser]);

  // Login function
  const login = useCallback(
    async (email: string, password: string) => {
      try {
        await api.post("/login", { email, password });
        await fetchUser();
        navigate("/");
      } catch (err) {
        console.error("Login failed:", err);
        throw err;
      }
    },
    [navigate]
  );

  // Signup function
  const signup = useCallback(
    async (email: string, password: string, confirmPassword: string) => {
      try {
        await api.post("/signup", { email, password, confirmPassword });
        await fetchUser();
        navigate("/profile");
      } catch (err) {
        console.error("Signup failed:", err);
        throw err;
      }
    },
    [navigate]
  );

  // Logout function
  const logout = useCallback(async () => {
    try {
      await api.post("/logout");
    } catch (error) {
      console.error("Logout API call failed:", error);
    } finally {
      setUser(null);
      navigate("/login");
    }
  }, [navigate]);

  const value = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    signup,
    logout,
    refetchUser: fetchUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {!isLoading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

export default AuthContext;
