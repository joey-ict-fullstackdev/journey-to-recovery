import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { clinicianRegisterSchema, type ClinicianRegisterInput } from "../utilities/schema";
import api from "../utilities/axiosConfig";
import axios from "axios";
import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const ClinicianSignup = () => {
  const { refetchUser } = useAuth();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClinicianRegisterInput>({ resolver: zodResolver(clinicianRegisterSchema) });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>();

  const onSubmit = async (data: ClinicianRegisterInput) => {
    setLoading(true);
    setError(null);
    try {
      await api.post("/signup/clinician", {
        email: data.email,
        password: data.password,
        confirmPassword: data.confirmPassword,
        clinicCode: data.clinicCode,
      });
      await refetchUser();
      navigate("/profile");
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        setError(err.response.data.message || "Registration failed.");
      } else {
        setError("An unexpected error occurred.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-purple-50">
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 bg-white shadow-2xl rounded-2xl overflow-hidden">
        <div className="bg-purple-800 text-white p-12 flex flex-col justify-center items-center text-center">
          <h2 className="text-4xl font-bold mb-4">Welcome, Clinician!</h2>
          <p className="mb-8 max-w-xs">
            Already have a clinician account? Sign in to access the alert queue.
          </p>
          <NavLink to="/login">
            <Button
              variant="outline"
              className="bg-transparent border-white text-white rounded-md
                       hover:bg-white hover:text-purple-800 transition-colors cursor-pointer"
            >
              SIGN IN
            </Button>
          </NavLink>
          <p className="mt-6 text-sm text-purple-300">
            Patient?{" "}
            <NavLink to="/signup" className="underline text-white">
              Sign up here
            </NavLink>
          </p>
        </div>

        <div className="p-12">
          <h2 className="text-3xl font-bold mb-2 text-purple-800">
            Clinician Sign Up
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            You'll need a clinic code from your administrator.
          </p>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div>
              <Label
                htmlFor="email"
                className="block text-sm font-medium text-gray-600"
              >
                Email
              </Label>
              <Input
                id="email"
                type="email"
                className="mt-1"
                {...register("email")}
              />
              {errors.email && (
                <p className="text-red-600 text-sm">{errors.email.message}</p>
              )}
            </div>

            <div>
              <Label
                htmlFor="password"
                className="block text-sm font-medium text-gray-600"
              >
                Password
              </Label>
              <Input
                id="password"
                type="password"
                className="mt-1"
                {...register("password")}
              />
              {errors.password && (
                <p className="text-red-600 text-sm">{errors.password.message}</p>
              )}
            </div>

            <div>
              <Label
                htmlFor="confirm-password"
                className="block text-sm font-medium text-gray-600"
              >
                Confirm Password
              </Label>
              <Input
                id="confirm-password"
                type="password"
                className="mt-1"
                {...register("confirmPassword")}
              />
              {errors.confirmPassword && (
                <p className="text-red-600 text-sm">
                  {errors.confirmPassword.message}
                </p>
              )}
            </div>

            <div>
              <Label
                htmlFor="clinic-code"
                className="block text-sm font-medium text-gray-600"
              >
                Clinic Code
              </Label>
              <Input
                id="clinic-code"
                type="password"
                className="mt-1"
                placeholder="Provided by your administrator"
                {...register("clinicCode")}
              />
              {errors.clinicCode && (
                <p className="text-red-600 text-sm">{errors.clinicCode.message}</p>
              )}
            </div>

            {error && (
              <p className="text-red-600 text-sm text-center">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full bg-purple-800 hover:bg-purple-900 text-white rounded-md mt-4 cursor-pointer"
              disabled={loading}
            >
              {loading ? "REGISTERING..." : "REGISTER AS CLINICIAN"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ClinicianSignup;
