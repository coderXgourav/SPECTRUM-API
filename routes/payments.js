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

    if (paymentIntent.status === "succeeded") {
      const db = getAdminDB();
      const { packageId, userId } = paymentIntent.metadata;

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
      });

      // Update user status to premium/paid
      await db.collection("users").doc(userId).update({
        subscriptionStatus: "active",
        packageId: packageId,
        subscriptionDate: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      res.status(200).json({
        success: true,
        message: "Payment confirmed and subscription created",
        paymentStatus: paymentIntent.status,
      });
    } else {
      res.status(400).json({
        success: false,
        message: "Payment not completed",
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

export default router;