export type Role = "patient" | "clinician";

export interface User {
  id: string;
  email: string;
  password: string;
  role: Role;
}
