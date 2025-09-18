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

    if (!amount || !packageId || !userId) {
      return res.status(400).json({
        error: "Amount, packageId, and userId are required",
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency,
      metadata: {
        packageId,
        userId,
      },
    });

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
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
      const packageSnapshot = await db.collection("packages")
        .where("packageId", "==", packageId)
        .get();
      
      if (packageSnapshot.empty) {
        return res.status(400).json({
          error: "Package not found",
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

      // Find user document by uid
      const usersRef = db.collection("users");
      const userQuery = usersRef.where("uid", "==", userId);
      const userSnapshot = await userQuery.get();
      
      if (userSnapshot.empty) {
        return res.status(400).json({
          error: "User not found",
        });
      }

      const userDoc = userSnapshot.docs[0];
      
      // Update user with subscription details, expiry date, and remaining posts/prompts
      await userDoc.ref.update({
        subscriptionStatus: "active",
        packageId: packageId,
        subscriptionDate: new Date().toISOString(),
        expiryDate: expiryDate.toISOString(),
        remainingPosts: packageData.packageLimit || null,
        remainingPrompts: packageData.packageLimit || null,
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
      payment_method: 'pm_card_visa', // Test payment method
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

export default router;