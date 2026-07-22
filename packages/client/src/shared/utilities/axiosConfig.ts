import axios from "axios";

// Routes that render without a session — AuthProvider wraps these too (see
// Layout.tsx), so an anonymous visit always fails the initial /profile check.
// Redirecting to /login from there would just reload /login itself, forever.
const PUBLIC_PATHS = ["/login", "/signup", "/clinician-signup"];

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  //baseURL: "http://localhost:3000/api", "https://server-production-1696.up.railway.app/api"
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const isRefreshRequest = originalRequest?.url?.includes("/refresh-token");

    if (error.response?.status === 401 && !originalRequest._retry && !isRefreshRequest) {
      originalRequest._retry = true;

      try {
        await api.post("/refresh-token");
        return api(originalRequest);
      } catch (refreshError) {
        console.error("Refresh token failed", refreshError);
        if (!PUBLIC_PATHS.includes(window.location.pathname)) {
          window.location.href = "/login";
        }
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);

export default api;
