import express from "express";
import Stripe from "stripe";
import { getAdminDB } from "../config/firebase-admin.js";

const router = express.Router();

// Initialize Stripe with error handling
if (!process.env.STRIPE_SECRET_KEY) {
  console.error('STRIPE_SECRET_KEY is not set in environment variables');
  throw new Error('STRIPE_SECRET_KEY is required');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

// Create payment intent
router.post("/create-payment-intent", async (req, res) => {
  try {
    const { amount, currency = "usd", packageId, userId } = req.body;

    if (amount === undefined || amount === null || !packageId || !userId) {
      return res.status(400).json({
        error: "Amount, packageId, and userId are required",
      });
    }

    // Handle free packages (price = 0)
    if (parseFloat(amount) === 0) {
      const db = getAdminDB();
      
      // Get package details
      const packageSnapshot = await db.collection("packages")
        .where("packageId", "==", packageId)
        .get();
      
      if (packageSnapshot.empty) {
        return res.status(400).json({
          error: "Package not found",
        });
      }

      const packageData = packageSnapshot.docs[0].data();
      
      // Find user document first
      const usersRef = db.collection("users");
      let userQuery = usersRef.where("user_id", "==", userId);
      let userSnapshot = await userQuery.get();
      
      if (userSnapshot.empty) {
        try {
          const userDoc = await usersRef.doc(userId).get();
          if (userDoc.exists) {
            userSnapshot = { docs: [userDoc], empty: false };
          }
        } catch (docError) {
          console.log('Error finding user:', docError.message);
        }
      }
      
      if (userSnapshot.empty) {
        return res.status(400).json({
          error: "User not found",
        });
      }

      const userDoc = userSnapshot.docs[0];
      const userData = userDoc.data();
      
      // Check if user already used trial package
      if (userData.trialPackage === true) {
        return res.status(400).json({
          error: "You have already used your trial package",
        });
      }
      
      // Calculate expiry date
      const currentDate = new Date();
      let expiryDate = new Date(currentDate);
      
      const duration = packageData.duration || "1 year";
      if (duration.includes("year")) {
        const years = parseInt(duration.match(/\d+/)?.[0] || "1");
        expiryDate.setFullYear(expiryDate.getFullYear() + years);
      } else if (duration.includes("month")) {
        const months = parseInt(duration.match(/\d+/)?.[0] || "1");
        expiryDate.setMonth(expiryDate.getMonth() + months);
      } else if (duration.includes("day")) {
        const days = parseInt(duration.match(/\d+/)?.[0] || "30");
        expiryDate.setDate(expiryDate.getDate() + days);
      } else {
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);
      }

      const packageLimit = packageData.packageLimit ? parseInt(packageData.packageLimit) : null;
      const storage = packageData.storage ? parseInt(packageData.storage) : 0;
      const maxGroup = packageData.maxGroup ? parseInt(packageData.maxGroup) : 0;
      
      // Update user with free subscription and mark trial as used
      await userDoc.ref.update({
        subscriptionStatus: "active",
        packageId: packageId,
        subscriptionDate: new Date().toISOString(),
        expiryDate: expiryDate.toISOString(),
        remainingPosts: packageLimit,
        remainingPrompts: packageLimit,
        storage: storage,
        maxGroup: maxGroup,
        trialPackage: true,
        updatedAt: new Date().toISOString(),
      });

      // Create subscription record
      await db.collection("subscriptions").add({
        packageId,
        userId,
        paymentIntentId: null,
        status: "active",
        createdAt: new Date().toISOString(),
        expiryDate: expiryDate.toISOString(),
        amount: 0,
        currency: currency,
      });

      return res.status(200).json({
        success: true,
        message: "Trial package activated successfully",
        isFree: true,
      });
    }

    // Handle paid packages
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never',
      },
      metadata: {
        packageId,
        userId,
      },
    });

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      isFree: false,
    });
  } catch (error) {
    console.error("Create payment intent error:", error);
    res.status(500).json({
      error: error.message || "Failed to create payment intent",
    });
  }
});

// Check payment status
router.get("/payment-status/:paymentIntentId", async (req, res) => {
  try {
    const { paymentIntentId } = req.params;

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    res.status(200).json({
      status: paymentIntent.status,
      amount: paymentIntent.amount / 100,
      currency: paymentIntent.currency,
      metadata: paymentIntent.metadata,
    });
  } catch (error) {
    console.error("Payment status error:", error);
    res.status(500).json({
      error: error.message || "Failed to retrieve payment status",
    });
  }
});

// Confirm payment and update database
router.post("/confirm-payment", async (req, res) => {
  try {
    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({
        error: "Payment intent ID is required",
      });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    console.log('Payment Intent Metadata:', paymentIntent.metadata);
    console.log('Payment Intent Status:', paymentIntent.status);

    if (paymentIntent.status === "succeeded" || paymentIntent.status === "requires_capture") {
      const db = getAdminDB();
      const { packageId, userId } = paymentIntent.metadata;
      
      if (!packageId || !userId) {
        return res.status(400).json({
          error: "Missing packageId or userId in payment metadata",
          metadata: paymentIntent.metadata,
        });
      }

      // Get package details to calculate expiry and limits
      console.log('Looking for packageId:', packageId);
      const packageSnapshot = await db.collection("packages")
        .where("packageId", "==", packageId)
        .get();
      
      console.log('Package query result:', packageSnapshot.size, 'documents found');
      
      if (packageSnapshot.empty) {
        // Try to find by document ID as fallback
        try {
          const packageDoc = await db.collection("packages").doc(packageId).get();
          if (packageDoc.exists) {
            const packageData = packageDoc.data();
            console.log('Found package by doc ID:', packageData);
          } else {
            console.log('Package not found by doc ID either');
          }
        } catch (docError) {
          console.log('Error finding by doc ID:', docError.message);
        }
        
        return res.status(400).json({
          error: "Package not found",
          packageId: packageId,
        });
      }

      const packageData = packageSnapshot.docs[0].data();
      
      // Calculate expiry date based on package duration
      const currentDate = new Date();
      let expiryDate = new Date(currentDate);
      
      // Parse duration and add to current date
      const duration = packageData.duration || "1 year";
      if (duration.includes("year")) {
        const years = parseInt(duration.match(/\d+/)?.[0] || "1");
        expiryDate.setFullYear(expiryDate.getFullYear() + years);
      } else if (duration.includes("month")) {
        const months = parseInt(duration.match(/\d+/)?.[0] || "1");
        expiryDate.setMonth(expiryDate.getMonth() + months);
      } else if (duration.includes("day")) {
        const days = parseInt(duration.match(/\d+/)?.[0] || "30");
        expiryDate.setDate(expiryDate.getDate() + days);
      } else {
        // Default to 1 year if duration format is unclear
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);
      }

      // Save payment record
      await db.collection("payments").add({
        paymentIntentId,
        packageId,
        userId,
        amount: paymentIntent.amount / 100,
        currency: paymentIntent.currency,
        status: "completed",
        createdAt: new Date().toISOString(),
      });

      // Create subscription record
      await db.collection("subscriptions").add({
        packageId,
        userId,
        paymentIntentId,
        status: "active",
        createdAt: new Date().toISOString(),
        expiryDate: expiryDate.toISOString(),
      });

      // Find user document by uid or user_id
      const usersRef = db.collection("users");
      console.log('Looking for userId:', userId);
      
      let userQuery = usersRef.where("user_id", "==", userId);
      let userSnapshot = await userQuery.get();
      
      // If not found by uid, try user_id field
      if (userSnapshot.empty) {
        console.log('User not found by user_id, trying document ID');
        userQuery = usersRef.where("user_id", "==", userId);
        userSnapshot = await userQuery.get();
      }
      
      // If still not found, try document ID
      if (userSnapshot.empty) {
        console.log('User not found by user_id, trying document ID');
        try {
          const userDoc = await usersRef.doc(userId).get();
          if (userDoc.exists) {
            userSnapshot = { docs: [userDoc], empty: false };
          }
        } catch (docError) {
          console.log('Error finding by doc ID:', docError.message);
        }
      }
      
      if (userSnapshot.empty) {
        return res.status(400).json({
          error: "User not found",
          userId: userId,
        });
      }

      const userDoc = userSnapshot.docs[0];
      console.log('Found user:', userDoc.data());
      
      // Parse package limits (handle both string and number)
      const packageLimit = packageData.packageLimit ? parseInt(packageData.packageLimit) : null;
      const storage = packageData.storage ? parseInt(packageData.storage) : 0;
      const maxGroup = packageData.maxGroup ? parseInt(packageData.maxGroup) : 0;
      
      // Update user with subscription details, expiry date, and remaining posts/prompts
      await userDoc.ref.update({
        subscriptionStatus: "active",
        packageId: packageId,
        subscriptionDate: new Date().toISOString(),
        expiryDate: expiryDate.toISOString(),
        remainingPosts: packageLimit,
        remainingPrompts: packageLimit,
        storage: storage,
        maxGroup: maxGroup,
        updatedAt: new Date().toISOString(),
      });

      res.status(200).json({
        success: true,
        message: "Payment confirmed and subscription created",
        paymentStatus: paymentIntent.status,
      });
    } else {
      // Handle different payment statuses
      let message = "Payment not completed";
      if (paymentIntent.status === "requires_payment_method") {
        message = "Payment requires a payment method";
      } else if (paymentIntent.status === "requires_confirmation") {
        message = "Payment requires confirmation";
      } else if (paymentIntent.status === "processing") {
        message = "Payment is being processed";
      } else if (paymentIntent.status === "canceled") {
        message = "Payment was canceled";
      }
      
      res.status(400).json({
        success: false,
        message: message,
        paymentStatus: paymentIntent.status,
      });
    }
  } catch (error) {
    console.error("Confirm payment error:", error);
    res.status(500).json({
      error: error.message || "Failed to confirm payment",
    });
  }
});

// Test endpoint to simulate payment completion (for testing only)
router.post("/test-complete-payment", async (req, res) => {
  try {
    const { paymentIntentId } = req.body;
    
    // Confirm the payment intent with test card
    const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
      payment_method: 'pm_card_visa',
      return_url: 'https://your-website.com/return',
    });
    
    res.status(200).json({
      success: true,
      status: paymentIntent.status,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error("Test payment error:", error);
    res.status(500).json({
      error: error.message || "Failed to complete test payment",
    });
  }
});

// Debug endpoint to list all packages
router.get("/debug/packages", async (req, res) => {
  try {
    const db = getAdminDB();
    const packagesSnapshot = await db.collection("packages").get();
    
    const packages = [];
    packagesSnapshot.forEach(doc => {
      const data = doc.data();
      packages.push({
        docId: doc.id,
        packageId: data.packageId,
        name: data.name,
      });
    });
    
    res.json({ packages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;