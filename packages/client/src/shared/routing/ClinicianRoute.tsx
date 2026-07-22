import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const ClinicianRoute = () => {
  const { user } = useAuth();
  if (user?.role !== "clinician") return <Navigate to="/" replace />;
  return <Outlet />;
};

export default ClinicianRoute;
