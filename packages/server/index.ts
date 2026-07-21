import express from "express";
import authRoutes from "./routes/authRoutes";
import profileRoutes from "./routes/profileRoutes";
import checkinRoutes from "./routes/checkinRoutes";
import goalRoutes from "./routes/goalRoutes";
import wellnessRoutes from "./routes/wellnessRoutes";
import chatRoutes from "./routes/chatRoutes";
import alertRoutes from "./routes/alertRoutes";
import cors from "cors";
import cookieParser from "cookie-parser";

const corsOptions =
  process.env.NODE_ENV === "production"
    ? {
        origin: ["https://willowy-tartufo-ba9677.netlify.app"],
        methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
        credentials: true,
        optionsSuccessStatus: 204,
      }
    : {
        origin: ["http://localhost:5173"],
        methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
        credentials: true,
        optionsSuccessStatus: 204,
      };

const app = express();

const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(cors(corsOptions));
app.use("/api", authRoutes);
app.use("/api", profileRoutes);
app.use("/api", checkinRoutes);
app.use("/api", goalRoutes);
app.use("/api", wellnessRoutes);
app.use("/api", chatRoutes);
app.use("/api", alertRoutes);

app.listen(port, () => console.log(`Server is running on the port ${port}`));
