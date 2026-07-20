import express from "express";
import authRoutes from "./routes/authRoutes";
import profileRoutes from "./routes/profileRoutes";
import checkinRoutes from "./routes/checkinRoutes";
import userRoutes from "./routes/userRoutes";
import cors from "cors";

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
app.use(cors(corsOptions));
app.use("/api", authRoutes);
app.use("/api", profileRoutes);
app.use("/api", checkinRoutes);
app.use("/api", userRoutes);

app.listen(port, () => console.log(`Server is running on the port ${port}`));
