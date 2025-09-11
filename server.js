import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
} from "firebase/firestore";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { initializeFirebaseAdmin } from "./config/firebase-admin.js";

// Load and validate environment variables
dotenv.config();

// Import validation (will exit if required vars are missing)
import "./validate-env.js";

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet());

// Enhanced CORS configuration to handle multiple origins
const allowedOrigins = [
  process.env.CLIENT_URL || "http://localhost:5173",
  process.env.FRONTEND_URL || "http://localhost:5173",
  "https://vocal-nougat-e6e714.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        console.log(`CORS blocked origin: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    preflightContinue: false,
    optionsSuccessStatus: 200,
  })
);

// Explicit OPTIONS handler for preflight requests
app.options("*", cors());

app.use(morgan("combined"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Firebase middleware - makes Firebase services available to all routes
app.use((req, res, next) => {
  req.firebase = { auth, db, storage };
  next();
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    cors_origins: [
      process.env.CLIENT_URL || "http://localhost:5173",
      process.env.FRONTEND_URL || "http://localhost:5173",
      "https://vocal-nougat-e6e714.netlify.app",
    ],
  });
});

// CORS debugging endpoint
app.get("/api/cors-test", (req, res) => {
  res.status(200).json({
    message: "CORS is working",
    origin: req.get("Origin"),
    timestamp: new Date().toISOString(),
  });
});

// Firebase configuration
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);
const storage = getStorage(firebaseApp);

// Initialize Firebase Admin SDK
try {
  initializeFirebaseAdmin();
  console.log("🔥 Firebase Admin SDK ready for server operations");
} catch (error) {
  console.error("❌ Failed to initialize Firebase Admin SDK:", error);
}

// Import routes
import authRoutes from "./routes/auth.js";
import ticketRoutes from "./routes/tickets.js";
import packageRoutes from "./routes/packages.js";
import reportRoutes from "./routes/reports.js";
import taskRouter from "./routes/task.js";

// Basic route
app.get("/", (req, res) => {
  res.json({
    message: "Spectrum358 Backend Server is running!",
    timestamp: new Date().toISOString(),
    projectId: firebaseConfig.projectId,
    version: "1.0.0",
    endpoints: {
      auth: "/api/auth",
      tickets: "/api/tickets",
      packages: "/api/packages",
      reports: "/api/reports",
    },
  });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    firebase: {
      projectId: firebaseConfig.projectId,
      connected: true,
    },
  });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/packages", packageRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/tasks", taskRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: "Something went wrong!",
    message:
      process.env.NODE_ENV === "production"
        ? "Internal Server Error"
        : err.message,
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Spectrum358 Backend Server running on port ${PORT}`);
  console.log(`📱 Project ID: ${firebaseConfig.projectId}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || "development"}`);
});

export { db, auth, storage };
