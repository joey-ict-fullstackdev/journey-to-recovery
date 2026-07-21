import { z } from "zod";

export const registerSchema = z
  .object({
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
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = registerSchema
  .omit({ password: true, confirmPassword: true })
  .extend({
    password: z.string().nonempty({ message: "Password is required" }),
  });

export type LoginInput = z.infer<typeof loginSchema>;

export const profileFormSchema = z.object({
  displayName: z
    .string()
    .min(4, "Display name must be at least 4 characters.")
    .max(32, "Display name must be no more than 32 characters."),
  dateOfBirth: z.coerce.date({ message: "Please select a date." }),
  gender: z.string({}).min(1, "Please select a gender."),
  meditationExperience: z
    .string({})
    .min(1, "Please select an experience level."),
});

export type ProfileFormValues = z.infer<typeof profileFormSchema>;

export const checkInSchema = z.object({
  status: z.string().min(1, "Status is required."),
});

export const goalSchema = z.object({
  overallGoal: z.string().optional(),
  smartGoal: z.string().min(1, "SMART goal is required."),
  importance: z.number().optional(),
  motivation: z.string().optional(),
  confidence: z.number().optional(),
  confidenceReason: z.string().optional(),
  reminderType: z.string().optional(),
});

export const wellnessSchema = z.object({
  wellnessRatings: z.record(z.string(), z.number()),
  wellnessExplanations: z.record(z.string(), z.string()),
  focusArea: z.string().min(1, "Focus area is required."),
  strengths: z.object({
    values: z.string().min(1, "The answer is required."),
    goodAt: z.string().min(1, "The answer is required."),
    overcome: z.string().min(1, "The answer is required."),
    valuedFor: z.string().min(1, "The answer is required."),
  }),
});

export const chatSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(1, "Prompt is required.")
    .max(1000, "Prompt is too long (max 1000 characters)"),
  conversationId: z.string(),
});

// "open" excluded — clinicians may only advance an alert, not re-open it.
export const alertUpdateSchema = z.object({
  status: z.enum(["acknowledged", "resolved"]),
  clinicianNote: z.string().optional(),
});
