import admin from "firebase-admin";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Firebase Admin SDK
let adminApp;

const initializeFirebaseAdmin = () => {
  if (!adminApp) {
    try {
      // Check if we have a service account key file
      const serviceAccountPath = process.env.FIREBASE_ADMIN_SDK_PATH;

      if (serviceAccountPath) {
        try {
          // Method 1: Using service account key file
          const serviceAccountFile = join(__dirname, "..", serviceAccountPath);
          const serviceAccount = JSON.parse(
            readFileSync(serviceAccountFile, "utf8")
          );

          adminApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: process.env.FIREBASE_PROJECT_ID,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
          });
          console.log(
            "✅ Firebase Admin SDK initialized with service account file"
          );
        } catch (fileError) {
          console.warn(
            "⚠️  Service account file not found, trying environment variables..."
          );
          throw fileError;
        }
      } else {
        throw new Error("No service account path specified");
      }
    } catch (error) {
      try {
        // Method 2: Using environment variables (for production/deployment)
        if (
          process.env.FIREBASE_PRIVATE_KEY &&
          process.env.FIREBASE_CLIENT_EMAIL
        ) {
          const serviceAccount = {
            type: "service_account",
            project_id: process.env.FIREBASE_PROJECT_ID,
            private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
            private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(
              /\\n/g,
              "\n"
            ),
            client_email: process.env.FIREBASE_CLIENT_EMAIL,
            client_id: process.env.FIREBASE_CLIENT_ID,
            auth_uri: process.env.GOOGLE_AUTH_URI || "https://accounts.google.com/o/oauth2/auth",
            token_uri: process.env.GOOGLE_TOKEN_URI || "https://oauth2.googleapis.com/token",
            auth_provider_x509_cert_url: process.env.GOOGLE_CERT_URL || "https://www.googleapis.com/oauth2/v1/certs",
            client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL || `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.FIREBASE_CLIENT_EMAIL}`,
          };

          adminApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: process.env.FIREBASE_PROJECT_ID,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
          });
          console.log(
            "✅ Firebase Admin SDK initialized with environment variables"
          );
        } else {
          throw new Error("Missing Firebase Admin SDK credentials");
        }
      } catch (envError) {
        // Method 3: Fallback for development (Google Application Default Credentials)
        try {
          adminApp = admin.initializeApp({
            projectId: process.env.FIREBASE_PROJECT_ID,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
          });
          console.log(
            "✅ Firebase Admin SDK initialized with default credentials"
          );
        } catch (fallbackError) {
          console.error(
            "❌ All Firebase Admin SDK initialization methods failed"
          );
          console.error(
            "Please follow the setup instructions in FIREBASE_SETUP.md"
          );
          throw new Error(
            `Firebase Admin SDK initialization failed: ${fallbackError.message}`
          );
        }
      }
    }
  }
  return adminApp;
};

// Get Admin Firestore instance
const getAdminDB = () => {
  const app = initializeFirebaseAdmin();
  return admin.firestore(app);
};

// Get Admin Auth instance
const getAdminAuth = () => {
  const app = initializeFirebaseAdmin();
  return admin.auth(app);
};

export { initializeFirebaseAdmin, getAdminDB, getAdminAuth, admin };
