import express from "express";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  updatePassword,
  sendPasswordResetEmail,
} from "firebase/auth";
import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  query,
  where,
} from "firebase/firestore";
import { getAdminDB, getAdminAuth } from "../config/firebase-admin.js";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

// Register new user
router.post("/register", async (req, res) => {
  try {
    const {
      email,
      password,
      firstName,
      lastName,
      profilePicture = null,
      role = "user",
    } = req.body;

    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({
        error: "Email, password, first name, and last name are required",
      });
    }

    // Get Firebase services from request (set by middleware)
    const { auth, db } = req.firebase;

    // Create user with Firebase Auth
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );
    const user = userCredential.user;

    // Create display name from first and last name for Firebase Auth
    const displayName = `${firstName} ${lastName}`;

    // Update user profile with display name (avoid photoURL for base64 images)
    const profileUpdate = { displayName };
    // Only set photoURL if it's not a base64 data URL (too long for Firebase Auth)
    if (profilePicture && !profilePicture.startsWith("data:image/")) {
      profileUpdate.photoURL = profilePicture;
    }
    await updateProfile(user, profileUpdate);

    // Store additional user data in Firestore using admin SDK
    const adminDb = getAdminDB();
    const userDoc = await adminDb.collection("users").add({
      uid: user.uid,
      email: user.email,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      profilePicture: profilePicture || null,
      role: role,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true,
    });

    res.status(201).json({
      message: "User registered successfully",
      user: {
        uid: user.uid,
        email: user.email,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        profilePicture: profilePicture || null,
        role: role,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(400).json({
      error: error.message || "Registration failed",
    });
  }
});

// Login user
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password are required",
      });
    }

    const { auth, db } = req.firebase;

    const userCredential = await signInWithEmailAndPassword(
      auth,
      email,
      password
    );
    const user = userCredential.user;

    // Get additional user data from Firestore using admin SDK
    const adminDb = getAdminDB();
    const usersRef = adminDb.collection("users");
    const q = usersRef.where("uid", "==", user.uid);
    const querySnapshot = await q.get();

    let userData = {};
    if (!querySnapshot.empty) {
      userData = querySnapshot.docs[0].data();
    }

    // Check if user is active
    if (userData.isActive === false) {
      return res.status(403).json({
        error:
          "Your account has been deactivated. Please contact administrator.",
      });
    }

    res.status(200).json({
      message: "Login successful",
      user: {
        uid: user.uid,
        email: user.email,
        firstName: userData.firstName?.trim() || "",
        lastName: userData.lastName?.trim() || "",
        profilePicture: userData.profilePicture || user.photoURL || null,
        role: userData.role || "user",
        isActive: userData.isActive || true,
        createdAt: userData.createdAt || null,
        updatedAt: userData.updatedAt || null,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(401).json({
      error: error.message || "Login failed",
    });
  }
});

// Logout user
router.post("/logout", async (req, res) => {
  try {
    const { auth } = req.firebase;
    await signOut(auth);
    res.status(200).json({
      message: "Logout successful",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      error: error.message || "Logout failed",
    });
  }
});

// Get user profile
router.get("/profile/:uid", async (req, res) => {
  try {
    const { uid } = req.params;

    // Use admin SDK to bypass Firestore security rules
    const adminDb = getAdminDB();
    const usersRef = adminDb.collection("users");
    const q = usersRef.where("uid", "==", uid);
    const querySnapshot = await q.get();

    if (querySnapshot.empty) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const userData = querySnapshot.docs[0].data();

    // Return structured user data
    res.status(200).json({
      user: {
        uid: userData.uid,
        email: userData.email,
        firstName: userData.firstName?.trim() || "",
        lastName: userData.lastName?.trim() || "",
        profilePicture: userData.profilePicture || null,
        role: userData.role || "user",
        isActive: userData.isActive || true,
        createdAt: userData.createdAt || null,
        updatedAt: userData.updatedAt || null,
      },
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({
      error: error.message || "Failed to get user profile",
    });
  }
});

// Update user profile
router.put("/profile/:uid", async (req, res) => {
  try {
    const { uid } = req.params;
    const updates = req.body;
    const { db, auth } = req.firebase;

    // Validate required fields
    if (updates.firstName !== undefined && !updates.firstName.trim()) {
      return res.status(400).json({
        error: "First name cannot be empty",
      });
    }

    if (updates.lastName !== undefined && !updates.lastName.trim()) {
      return res.status(400).json({
        error: "Last name cannot be empty",
      });
    }

    // Validate email format if email is being updated
    if (updates.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(updates.email)) {
        return res.status(400).json({
          error: "Invalid email format",
        });
      }
    }

    // Validate profile picture if it's a base64 string
    if (updates.profilePicture && typeof updates.profilePicture === "string") {
      // Check if it's a base64 data URL
      if (updates.profilePicture.startsWith("data:image/")) {
        // Estimate file size from base64 string (rough calculation)
        const base64Data =
          updates.profilePicture.split(",")[1] || updates.profilePicture;
        const sizeInBytes = (base64Data.length * 3) / 4;
        const sizeInMB = sizeInBytes / (1024 * 1024);

        if (sizeInMB > 5) {
          return res.status(400).json({
            error: "Profile picture file size must be less than 5MB",
          });
        }
      }
    }

    // Use admin SDK to bypass Firestore security rules
    const adminDb = getAdminDB();
    const usersRef = adminDb.collection("users");
    const q = usersRef.where("uid", "==", uid);
    const querySnapshot = await q.get();

    if (querySnapshot.empty) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const userDocRef = querySnapshot.docs[0].ref;
    const currentUserData = querySnapshot.docs[0].data();

    // Prepare updates object with trimmed strings
    const firestoreUpdates = {
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    // Trim string fields
    if (firestoreUpdates.firstName) {
      firestoreUpdates.firstName = firestoreUpdates.firstName.trim();
    }
    if (firestoreUpdates.lastName) {
      firestoreUpdates.lastName = firestoreUpdates.lastName.trim();
    }
    if (firestoreUpdates.email) {
      firestoreUpdates.email = firestoreUpdates.email.trim();
    }

    // Update Firestore document
    await userDocRef.update(firestoreUpdates);

    // Update Firebase Auth profile if firstName/lastName changed
    // Note: We don't update photoURL in Firebase Auth for base64 images as they're too long
    if (updates.firstName || updates.lastName) {
      const currentUser = auth.currentUser;
      if (currentUser && currentUser.uid === uid) {
        const authUpdates = {};
        const newFirstName =
          updates.firstName || currentUserData.firstName || "";
        const newLastName = updates.lastName || currentUserData.lastName || "";
        authUpdates.displayName = `${newFirstName} ${newLastName}`.trim();

        try {
          await updateProfile(currentUser, authUpdates);
        } catch (authError) {
          console.error("Failed to update Firebase Auth profile:", authError);
          // Continue execution even if auth profile update fails
        }
      }
    }

    // Fetch updated user data to return
    const updatedSnapshot = await q.get();
    const updatedUserData = updatedSnapshot.docs[0].data();

    res.status(200).json({
      message: "Profile updated successfully",
      user: {
        uid: updatedUserData.uid,
        email: updatedUserData.email,
        firstName: updatedUserData.firstName?.trim() || "",
        lastName: updatedUserData.lastName?.trim() || "",
        profilePicture: updatedUserData.profilePicture || null,
        role: updatedUserData.role || "user",
        isActive: updatedUserData.isActive || true,
        createdAt: updatedUserData.createdAt || null,
        updatedAt: updatedUserData.updatedAt || null,
      },
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({
      error: error.message || "Failed to update profile",
    });
  }
});

// Get all users (admin only)
router.get("/users", async (req, res) => {
  try {
    const adminDb = getAdminDB();
    const usersRef = adminDb.collection("users");

    // Get all users from the database
    const querySnapshot = await usersRef.get();

    const users = [];
    querySnapshot.forEach((doc) => {
      const userData = doc.data();

      // Include ALL users - no filtering by role
      users.push({
        id: doc.id,
        uid: userData.uid,
        email: userData.email,
        firstName: userData.firstName?.trim() || "",
        lastName: userData.lastName?.trim() || "",
        phone: userData.phone || "",
        country: userData.country || "",
        state: userData.state || "",
        city: userData.city || "",
        businessCategory: userData.businessCategory || "",
        profilePicture: userData.profilePicture || null,
        role: userData.role || "user",
        isActive: userData.isActive !== false, // Default to true only if not explicitly false
        createdAt: userData.createdAt || null,
        updatedAt: userData.updatedAt || null,
        createdBy: userData.createdBy || null,
      });
    });

    res.status(200).json({
      users: users,
      totalUsers: users.length,
    });
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({
      error: error.message || "Failed to get users",
    });
  }
});

// Delete user (admin only)
router.delete("/users/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        error: "User ID is required",
      });
    }

    const adminDb = getAdminDB();
    const adminAuth = getAdminAuth();

    // Find user in Firestore
    const usersRef = adminDb.collection("users");
    const userQuery = usersRef.where("uid", "==", userId);
    const userSnapshot = await userQuery.get();

    if (userSnapshot.empty) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const userDoc = userSnapshot.docs[0];
    const userData = userDoc.data();

    // Prevent deletion of admin users (safety measure)
    if (userData.role === "admin") {
      return res.status(403).json({
        error: "Cannot delete admin users",
      });
    }

    try {
      // Delete user from Firebase Authentication
      await adminAuth.deleteUser(userId);
    } catch (authError) {
      console.error("Error deleting user from Auth:", authError);
      // Continue with Firestore deletion even if Auth deletion fails
      // (user might already be deleted from Auth but not from Firestore)
    }

    // Delete user document from Firestore
    await userDoc.ref.delete();

    res.status(200).json({
      message: "User deleted successfully",
      deletedUserId: userId,
    });
  } catch (error) {
    console.error("Delete user error:", error);
    res.status(500).json({
      error: error.message || "Failed to delete user",
    });
  }
});

// Update user (admin only)
router.put("/users/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const updates = req.body;

    if (!userId) {
      return res.status(400).json({
        error: "User ID is required",
      });
    }

    // Validate updates
    if (updates.firstName !== undefined && !updates.firstName.trim()) {
      return res.status(400).json({
        error: "First name cannot be empty",
      });
    }

    if (updates.lastName !== undefined && !updates.lastName.trim()) {
      return res.status(400).json({
        error: "Last name cannot be empty",
      });
    }

    if (updates.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(updates.email)) {
        return res.status(400).json({
          error: "Invalid email format",
        });
      }
    }

    const adminDb = getAdminDB();
    const adminAuth = getAdminAuth();

    // Find user in Firestore
    const usersRef = adminDb.collection("users");
    const userQuery = usersRef.where("uid", "==", userId);
    const userSnapshot = await userQuery.get();

    if (userSnapshot.empty) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const userDoc = userSnapshot.docs[0];
    const currentUserData = userDoc.data();

    // Prepare updates object
    const firestoreUpdates = {
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    // Trim string fields
    if (firestoreUpdates.firstName) {
      firestoreUpdates.firstName = firestoreUpdates.firstName.trim();
    }
    if (firestoreUpdates.lastName) {
      firestoreUpdates.lastName = firestoreUpdates.lastName.trim();
    }
    if (firestoreUpdates.email) {
      firestoreUpdates.email = firestoreUpdates.email.trim();
    }
    if (firestoreUpdates.phone) {
      firestoreUpdates.phone = firestoreUpdates.phone.trim();
    }

    // Update Firestore document
    await userDoc.ref.update(firestoreUpdates);

    // Update Firebase Auth profile if email, firstName, or lastName changed
    if (updates.email || updates.firstName || updates.lastName) {
      try {
        const authUpdates = {};

        if (updates.email && updates.email !== currentUserData.email) {
          authUpdates.email = updates.email.trim();
        }

        if (updates.firstName || updates.lastName) {
          const newFirstName =
            updates.firstName || currentUserData.firstName || "";
          const newLastName =
            updates.lastName || currentUserData.lastName || "";
          authUpdates.displayName = `${newFirstName} ${newLastName}`.trim();
        }

        if (Object.keys(authUpdates).length > 0) {
          await adminAuth.updateUser(userId, authUpdates);
        }
      } catch (authError) {
        console.error("Failed to update Firebase Auth profile:", authError);
        // Continue execution even if auth profile update fails
      }
    }

    // Fetch updated user data
    const updatedSnapshot = await userQuery.get();
    const updatedUserData = updatedSnapshot.docs[0].data();

    res.status(200).json({
      message: "User updated successfully",
      user: {
        id: updatedSnapshot.docs[0].id,
        uid: updatedUserData.uid,
        email: updatedUserData.email,
        firstName: updatedUserData.firstName?.trim() || "",
        lastName: updatedUserData.lastName?.trim() || "",
        phone: updatedUserData.phone || "",
        country: updatedUserData.country || "",
        state: updatedUserData.state || "",
        city: updatedUserData.city || "",
        businessCategory: updatedUserData.businessCategory || "",
        profilePicture: updatedUserData.profilePicture || null,
        role: updatedUserData.role || "user",
        isActive: updatedUserData.isActive || true,
        createdAt: updatedUserData.createdAt || null,
        updatedAt: updatedUserData.updatedAt || null,
        createdBy: updatedUserData.createdBy || null,
      },
    });
  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({
      error: error.message || "Failed to update user",
    });
  }
});

// Get current user (authenticated user's own profile)
router.get("/current-user", async (req, res) => {
  try {
    const { auth, db } = req.firebase;
    const currentUser = auth.currentUser;

    if (!currentUser) {
      return res.status(401).json({
        error: "No authenticated user found",
      });
    }

    // Get additional user data from Firestore
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("uid", "==", currentUser.uid));
    const querySnapshot = await getDocs(q);

    let userData = {};
    if (!querySnapshot.empty) {
      userData = querySnapshot.docs[0].data();
    }

    res.status(200).json({
      user: {
        uid: currentUser.uid,
        email: currentUser.email,
        firstName: userData.firstName?.trim() || "",
        lastName: userData.lastName?.trim() || "",
        profilePicture: userData.profilePicture || currentUser.photoURL || null,
        role: userData.role || "user",
        isActive: userData.isActive || true,
        createdAt: userData.createdAt || null,
        updatedAt: userData.updatedAt || null,
      },
    });
  } catch (error) {
    console.error("Get current user error:", error);
    res.status(500).json({
      error: error.message || "Failed to get current user",
    });
  }
});

// Configure nodemailer transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Verify email configuration on startup
transporter.verify((error, success) => {
  if (error) {
    console.error("❌ Email configuration error:", error);
    console.error("   Please check EMAIL_USER and EMAIL_PASS in .env file");
  } else {
    console.log("✅ Email configuration verified successfully");
    console.log(`   Using email: ${process.env.EMAIL_USER}`);
  }
});

// Generate random OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send forgot password OTP
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: "Email is required",
      });
    }

    // Use Admin SDK for server-side operations
    const adminDB = getAdminDB();

    // Check if user exists using Admin SDK
    const usersRef = adminDB.collection("users");
    const userSnapshot = await usersRef.where("email", "==", email).get();

    if (userSnapshot.empty) {
      return res.status(404).json({
        error: "User with this email does not exist",
      });
    }

    const userData = userSnapshot.docs[0].data();
    const userDisplayName =
      userData.displayName ||
      `${userData.firstName || ""} ${userData.lastName || ""}`.trim() ||
      "User";

    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

    // Store OTP in Firestore using Admin SDK (bypasses security rules)
    await adminDB.collection("otps").add({
      email: email,
      otp: otp,
      expiresAt: otpExpiry.toISOString(),
      used: false,
      createdAt: new Date().toISOString(),
    });

    // Send OTP via email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Password Reset OTP - Spectrum358",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333; text-align: center;">Password Reset Request</h2>
          <p>Hello ${userDisplayName},</p>
          <p>You have requested to reset your password for your Spectrum358 account.</p>
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; text-align: center; margin: 20px 0;">
            <h3 style="color: #007bff; margin: 0;">Your OTP Code:</h3>
            <h1 style="color: #007bff; font-size: 32px; letter-spacing: 5px; margin: 10px 0;">${otp}</h1>
          </div>
          <p><strong>Important:</strong></p>
          <ul>
            <li>This OTP is valid for 10 minutes only</li>
            <li>Do not share this code with anyone</li>
            <li>If you didn't request this, please ignore this email</li>
          </ul>
          <p>Best regards,<br>Spectrum358 Team</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({
      message: "OTP sent successfully to your email",
      email: email,
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({
      error: error.message || "Failed to send OTP",
    });
  }
});

// Verify OTP and send password reset email
router.post("/reset-password", async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        error: "Email and OTP are required",
      });
    }

    // Use Admin SDK for server-side operations
    const adminDB = getAdminDB();
    const { auth } = req.firebase; // Use client SDK for password reset

    // Find and verify OTP using Admin SDK
    const otpsRef = adminDB.collection("otps");
    const otpSnapshot = await otpsRef
      .where("email", "==", email)
      .where("otp", "==", otp)
      .where("used", "==", false)
      .get();

    if (otpSnapshot.empty) {
      return res.status(400).json({
        error: "Invalid or expired OTP",
      });
    }

    const otpDoc = otpSnapshot.docs[0];
    const otpData = otpDoc.data();

    // Check if OTP is expired
    const now = new Date();
    const expiryDate = new Date(otpData.expiresAt);
    if (now > expiryDate) {
      return res.status(400).json({
        error: "OTP has expired",
      });
    }

    // Find user using Admin SDK
    const usersRef = adminDB.collection("users");
    const userSnapshot = await usersRef.where("email", "==", email).get();

    if (userSnapshot.empty) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    try {
      // Use Firebase client SDK to send password reset email
      await sendPasswordResetEmail(auth, email);

      // Mark OTP as used
      await otpDoc.ref.update({
        used: true,
        usedAt: new Date().toISOString(),
      });

      res.status(200).json({
        message: "Password reset email has been sent to your email address.",
        success: true,
      });
    } catch (authError) {
      console.error("Password reset email error:", authError);
      res.status(500).json({
        error: "Failed to send password reset email. Please try again.",
      });
    }
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      error: error.message || "Failed to process password reset request",
    });
  }
});

// Update password after OTP verification
router.post("/update-password", async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({
        error: "Email and new password are required",
      });
    }

    // Use Admin SDK to find and update user password
    const adminAuth = getAdminAuth();

    try {
      // Get user by email
      const userRecord = await adminAuth.getUserByEmail(email);

      // Update password
      await adminAuth.updateUser(userRecord.uid, {
        password: newPassword,
      });

      res.status(200).json({
        message: "Password updated successfully",
        success: true,
      });
    } catch (authError) {
      console.error("Password update error:", authError);
      if (authError.code === "auth/user-not-found") {
        res.status(404).json({
          error: "User not found",
        });
      } else {
        res.status(500).json({
          error: "Failed to update password. Please try again.",
        });
      }
    }
  } catch (error) {
    console.error("Update password error:", error);
    res.status(500).json({
      error: error.message || "Failed to update password",
    });
  }
});

// Admin-only user registration with email notification
router.post("/admin/register-user", async (req, res) => {
  try {
    const {
      email,
      password,
      firstName,
      lastName,
      phone,
      country,
      state,
      city,
      businessCategory,
      role = "user",
    } = req.body;

    // Validate required fields
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({
        error: "Email, password, first name, and last name are required",
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: "Invalid email format",
      });
    }

    // Validate password strength (minimum requirements)
    if (password.length < 6) {
      return res.status(400).json({
        error: "Password must be at least 6 characters long",
      });
    }

    // Use Admin SDK to create user
    const adminAuth = getAdminAuth();
    const adminDb = getAdminDB();

    try {
      // Check if user already exists
      try {
        await adminAuth.getUserByEmail(email);
        return res.status(400).json({
          error: "User with this email already exists",
        });
      } catch (error) {
        if (error.code !== "auth/user-not-found") {
          throw error;
        }
        // User doesn't exist, proceed with creation
      }

      // Create user with Admin SDK
      const userRecord = await adminAuth.createUser({
        email: email,
        password: password,
        displayName: `${firstName.trim()} ${lastName.trim()}`,
        emailVerified: false,
      });

      // Set default profile picture using pravatar.cc (same as in frontend)
      const defaultProfilePicture = `${
        process.env.AVATAR_SERVICE_URL || "https://i.pravatar.cc"
      }/150?u=${email}`;

      // Store additional user data in Firestore using admin SDK
      const userDoc = await adminDb.collection("users").add({
        uid: userRecord.uid,
        email: email,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone || "",
        country: country || "",
        state: state || "",
        city: city || "",
        businessCategory: businessCategory || "",
        profilePicture: defaultProfilePicture,
        role: role,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isActive: true,
        createdBy: "admin", // Mark as admin-created
      });

      // Send welcome email with credentials
      const userDisplayName = `${firstName.trim()} ${lastName.trim()}`;

      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Welcome to Spectrum358 - Your Account Credentials",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #E5B700; margin: 0;">Welcome to Spectrum358!</h1>
            </div>
            
            <div style="background-color: #f8f9fa; padding: 25px; border-radius: 10px; margin: 20px 0;">
              <h2 style="color: #333; margin-top: 0;">Hello ${userDisplayName},</h2>
              <p style="color: #555; line-height: 1.6;">
                Your account has been created by our administrator. You can now access the Spectrum358 platform using the credentials below:
              </p>
              
              <div style="background-color: white; padding: 20px; border-radius: 8px; border-left: 4px solid #E5B700; margin: 20px 0;">
                <h3 style="color: #333; margin-top: 0;">Your Login Credentials:</h3>
                <p style="margin: 10px 0;"><strong>Email:</strong> ${email}</p>
                <p style="margin: 10px 0;"><strong>Password:</strong> ${password}</p>
              </div>
              
              <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; border: 1px solid #ffeaa7; margin: 20px 0;">
                <h4 style="color: #856404; margin-top: 0;">Important Security Notice:</h4>
                <ul style="color: #856404; margin: 10px 0; padding-left: 20px;">
                  <li>Please change your password after your first login</li>
                  <li>Keep your credentials secure and don't share them with anyone</li>
                  <li>Contact support if you have any issues accessing your account</li>
                </ul>
              </div>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${
                  process.env.FRONTEND_URL || "http://localhost:5173"
                }" 
                   style="background-color: #E5B700; color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; font-weight: bold; display: inline-block;">
                  Login to Your Account
                </a>
              </div>
              
              <p style="color: #555; line-height: 1.6;">
                If you have any questions or need assistance, please don't hesitate to contact our support team.
              </p>
              
              <p style="color: #555; margin-top: 30px;">
                Best regards,<br>
                <strong>The Spectrum358 Team</strong>
              </p>
            </div>
            
            <div style="text-align: center; color: #888; font-size: 12px; margin-top: 30px;">
              <p>This is an automated message. Please do not reply to this email.</p>
            </div>
          </div>
        `,
      };

      // Try to send welcome email with credentials
      let emailSent = false;
      let emailError = null;

      try {
        await transporter.sendMail(mailOptions);
        emailSent = true;
        console.log(`✅ Welcome email sent successfully to ${email}`);
      } catch (emailSendError) {
        emailError = emailSendError.message;
        console.error(
          `❌ Failed to send welcome email to ${email}:`,
          emailSendError
        );
        // Don't fail the entire user creation if email fails
      }

      res.status(201).json({
        message: emailSent
          ? "User created successfully and credentials sent via email"
          : "User created successfully but failed to send email",
        user: {
          uid: userRecord.uid,
          email: email,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone || "",
          country: country || "",
          state: state || "",
          city: city || "",
          businessCategory: businessCategory || "",
          profilePicture: defaultProfilePicture,
          role: role,
          isActive: true,
        },
        emailSent: emailSent,
        emailError: emailError,
      });
    } catch (authError) {
      console.error("Admin user creation error:", authError);
      if (authError.code === "auth/email-already-exists") {
        res.status(400).json({
          error: "User with this email already exists",
        });
      } else if (authError.code === "auth/invalid-email") {
        res.status(400).json({
          error: "Invalid email address",
        });
      } else if (authError.code === "auth/weak-password") {
        res.status(400).json({
          error: "Password is too weak",
        });
      } else {
        res.status(500).json({
          error: "Failed to create user account",
        });
      }
    }
  } catch (error) {
    console.error("Admin register user error:", error);
    res.status(500).json({
      error: error.message || "Failed to register user",
    });
  }
});

// Update user status (Active/Inactive)
router.put("/users/:userId/status", async (req, res) => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        error: "isActive must be a boolean value",
      });
    }

    const adminDb = getAdminDB();
    const usersRef = adminDb.collection("users");

    // Find user document by uid
    const q = usersRef.where("uid", "==", userId);
    const querySnapshot = await q.get();

    if (querySnapshot.empty) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    // Update user status
    const userDoc = querySnapshot.docs[0];
    await userDoc.ref.update({
      isActive: isActive,
      updatedAt: new Date().toISOString(),
    });

    res.status(200).json({
      message: `User ${isActive ? "activated" : "deactivated"} successfully`,
      userId: userId,
      isActive: isActive,
    });
  } catch (error) {
    console.error("Update user status error:", error);
    res.status(500).json({
      error: error.message || "Failed to update user status",
    });
  }
});

// Get user statistics
router.get("/users/stats", async (req, res) => {
  try {
    const adminDb = getAdminDB();
    const usersRef = adminDb.collection("users");

    // Get all users
    const querySnapshot = await usersRef.get();

    let totalUsers = 0;
    let activeUsers = 0;

    querySnapshot.forEach((doc) => {
      const userData = doc.data();
      totalUsers++;
      if (userData.isActive !== false) {
        // Default to active if isActive is not set
        activeUsers++;
      }
    });

    res.status(200).json({
      stats: {
        totalUsers,
        activeUsers,
        inactiveUsers: totalUsers - activeUsers,
      },
    });
  } catch (error) {
    console.error("Get user stats error:", error);
    res.status(500).json({
      error: error.message || "Failed to get user statistics",
    });
  }
});

export default router;
