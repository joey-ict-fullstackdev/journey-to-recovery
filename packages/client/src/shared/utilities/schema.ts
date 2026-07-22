import { z } from "zod";

const registerBase = z.object({
  email: z.email({ message: "Invalid email address." }),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters long." })
    .max(32, { message: "Password cannot exceed 32 characters." })
    .regex(/[A-Z]/, {
      message: "Password must contain at least one uppercase letter.",
    })
    .regex(/[a-z]/, {
      message: "Password must contain at least one lowercase letter.",
    })
    .regex(/[0-9]/, { message: "Password must contain at least one number." })
    .regex(/[^a-zA-Z0-9]/, {
      message: "Password must contain at least one special character.",
    }),
  confirmPassword: z.string(),
});

const passwordsMatch = (data: { password: string; confirmPassword: string }) =>
  data.password === data.confirmPassword;
const passwordMatchError = { message: "Passwords do not match.", path: ["confirmPassword"] };

export const registerSchema = registerBase.refine(passwordsMatch, passwordMatchError);
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = registerBase
  .omit({ password: true, confirmPassword: true })
  .extend({
    password: z.string().nonempty({ message: "Password is required" }),
  });
export type LoginInput = z.infer<typeof loginSchema>;

export const clinicianRegisterSchema = registerBase
  .extend({ clinicCode: z.string().nonempty("Clinic code is required") })
  .refine(passwordsMatch, passwordMatchError);
export type ClinicianRegisterInput = z.infer<typeof clinicianRegisterSchema>;

export const profileFormSchema = z.object({
  displayName: z
    .string()
    .min(4, "Display name must be at least 4 characters.")
    .max(32, "Display name must be no more than 32 characters."),
  dateOfBirth: z.date({ message: "Please select a date." }),
  gender: z.string({}).min(1, "Please select a gender."),
  meditationExperience: z
    .string({})
    .min(1, "Please select an experience level."),
});

export type ProfileFormValues = z.infer<typeof profileFormSchema>;

export const strengthsFormSchema = z.object({
  values: z.string().min(1, "This question requires to answer"),
  goodAt: z.string().min(1, "This question requires to answer"),
  overcome: z.string().min(1, "This question requires to answer"),
  valuedFor: z.string().min(1, "This question requires to answer"),
});
export type StrengthsFormValues = z.infer<typeof strengthsFormSchema>;
