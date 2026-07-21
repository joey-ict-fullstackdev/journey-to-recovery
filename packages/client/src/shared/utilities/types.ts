export interface User {
  id: string;
  name: string | undefined; // Name can be null if not set
  email: string | undefined;
  dob: Date | undefined;
  gender: string | undefined;
  meditation_level: string | undefined;
  role: "patient" | "clinician";
}

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, confirmPassword: string) => Promise<void>;
  logout: () => void;
  refetchUser: () => Promise<void>;
}