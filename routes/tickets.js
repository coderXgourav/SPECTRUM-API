import express from "express";
import { getAdminDB } from "../config/firebase-admin.js";

const router = express.Router();

// Enums aligned with TicketManagement.jsx UI
const ALLOWED_STATUSES = ["In Progress", "Resolved", "Closed"];
const ALLOWED_PRIORITIES = ["High", "Medium", "Low"];

// Get all tickets (supports optional filters: status, priority, assignee)
router.get("/", async (req, res) => {
  try {
    const { status, priority, assignee } = req.query;
    const db = getAdminDB();

    let q = db.collection("tickets");
    if (status) q = q.where("status", "==", status);
    if (priority) q = q.where("priority", "==", priority);
    if (assignee) q = q.where("assignee", "==", assignee);
    q = q.orderBy("createdAt", "desc");

    const snapshot = await q.get();
    
    const tickets = [];
    snapshot.forEach((doc) => {
      tickets.push({ id: doc.id, ...doc.data() });
    });

    res.status(200).json({
      tickets,
      total: tickets.length,
    });
  } catch (error) {
    console.error("Get tickets error:", error);
    res.status(500).json({
      error: error.message || "Failed to get tickets",
    });
  }
});

// Ticket summary stats for dashboard cards
router.get("/stats", async (req, res) => {
  try {
    const db = getAdminDB();
    const snapshot = await db.collection("tickets").get();

    let total = 0;
    let inProgress = 0;
    let resolved = 0;
    let closed = 0;

    snapshot.forEach((doc) => {
      total += 1;
      const data = doc.data();
      if (data.status === "In Progress") inProgress += 1;
      if (data.status === "Resolved") resolved += 1;
      if (data.status === "Closed") closed += 1;
    });

    res.status(200).json({
      total,
      active: inProgress, // maps to "Active Ticket" in UI
      resolved,
      closed,
    });
  } catch (error) {
    console.error("Get ticket stats error:", error);
    res.status(500).json({
      error: error.message || "Failed to get ticket stats",
    });
  }
});

// Get ticket by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const db = getAdminDB();
    const ticketDoc = await db.collection("tickets").doc(id).get();

    if (!ticketDoc.exists) {
      return res.status(404).json({
        error: "Ticket not found",
      });
    }

    res.status(200).json({
      ticket: { id: ticketDoc.id, ...ticketDoc.data() },
    });
  } catch (error) {
    console.error("Get ticket error:", error);
    res.status(500).json({
      error: error.message || "Failed to get ticket",
    });
  }
});

// Create new ticket aligned with TicketManagement.jsx fields
router.post("/", async (req, res) => {
  try {
    const {
      ticketId, // e.g. "#10021"
      subject,
      status,
      priority,
      lastUpdate,
      assignee,
      description,
      userId,
      userEmail,
    } = req.body;

    if (!ticketId || !subject) {
      return res
        .status(400)
        .json({ error: "ticketId and subject are required" });
    }

    if (status && !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Allowed: ${ALLOWED_STATUSES.join(", ")}`,
      });
    }
    if (priority && !ALLOWED_PRIORITIES.includes(priority)) {
      return res.status(400).json({
        error: `Invalid priority. Allowed: ${ALLOWED_PRIORITIES.join(", ")}`,
      });
    }

    const db = getAdminDB();
    const nowIso = new Date().toISOString();

    const ticketData = {
      ticketId,
      subject,
      description: description || "",
      status: status || "In Progress",
      priority: priority || "Medium",
      assignee: assignee || null,
      lastUpdate: lastUpdate || nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
      userId: userId || null,
      userEmail: userEmail || null,
      comments: [],
    };

    const docRef = await db.collection("tickets").add(ticketData);

    res.status(201).json({
      message: "Ticket created successfully",
      ticket: { id: docRef.id, ...ticketData },
    });
  } catch (error) {
    console.error("Create ticket error:", error);
    res.status(500).json({
      error: error.message || "Failed to create ticket",
    });
  }
});

// Update ticket (validates enums and maintains lastUpdate)
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const db = getAdminDB();

    const ticketRef = db.collection("tickets").doc(id);
    const ticketDoc = await ticketRef.get();

    if (!ticketDoc.exists) {
      return res.status(404).json({
        error: "Ticket not found",
      });
    }

    if (updates.status && !ALLOWED_STATUSES.includes(updates.status)) {
      return res.status(400).json({
        error: `Invalid status. Allowed: ${ALLOWED_STATUSES.join(", ")}`,
      });
    }
    if (updates.priority && !ALLOWED_PRIORITIES.includes(updates.priority)) {
      return res.status(400).json({
        error: `Invalid priority. Allowed: ${ALLOWED_PRIORITIES.join(", ")}`,
      });
    }

    const nowIso = new Date().toISOString();
    const shouldTouchLastUpdate = Boolean(
      updates.status ||
        updates.priority ||
        updates.assignee ||
        updates.description
    );

    await ticketRef.update({
      ...updates,
      updatedAt: nowIso,
      ...(shouldTouchLastUpdate
        ? { lastUpdate: updates.lastUpdate || nowIso }
        : {}),
    });

    res.status(200).json({
      message: "Ticket updated successfully",
    });
  } catch (error) {
    console.error("Update ticket error:", error);
    res.status(500).json({
      error: error.message || "Failed to update ticket",
    });
  }
});

// Delete ticket
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const db = getAdminDB();

    const ticketRef = db.collection("tickets").doc(id);
    const ticketDoc = await ticketRef.get();

    if (!ticketDoc.exists) {
      return res.status(404).json({
        error: "Ticket not found",
      });
    }

    await ticketRef.delete();

    res.status(200).json({
      message: "Ticket deleted successfully",
    });
  } catch (error) {
    console.error("Delete ticket error:", error);
    res.status(500).json({
      error: error.message || "Failed to delete ticket",
    });
  }
});

// Add comment to ticket
router.post("/:id/comments", async (req, res) => {
  try {
    const { id } = req.params;
    const { comment, userId, userEmail } = req.body;

    if (!comment) {
      return res.status(400).json({
        error: "Comment is required",
      });
    }

    const db = getAdminDB();

    const ticketRef = db.collection("tickets").doc(id);
    const ticketDoc = await ticketRef.get();

    if (!ticketDoc.exists) {
      return res.status(404).json({
        error: "Ticket not found",
      });
    }

    const ticketData = ticketDoc.data();
    const newComment = {
      id: Date.now().toString(),
      comment,
      userId: userId || null,
      userEmail: userEmail || null,
      createdAt: new Date().toISOString(),
    };

    const updatedComments = [...(ticketData.comments || []), newComment];

    const nowIso = new Date().toISOString();
    await ticketRef.update({
      comments: updatedComments,
      updatedAt: nowIso,
      lastUpdate: nowIso,
    });

    res.status(201).json({
      message: "Comment added successfully",
      comment: newComment,
    });
  } catch (error) {
    console.error("Add comment error:", error);
    res.status(500).json({
      error: error.message || "Failed to add comment",
    });
  }
});

// Get tickets by user
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const db = getAdminDB();
    const q = db
      .collection("tickets")
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc");
    const querySnapshot = await q.get();

    const tickets = [];
    querySnapshot.forEach((doc) => {
      tickets.push({ id: doc.id, ...doc.data() });
    });

    res.status(200).json({
      tickets: tickets,
      total: tickets.length,
    });
  } catch (error) {
    console.error("Get user tickets error:", error);
    res.status(500).json({
      error: error.message || "Failed to get user tickets",
    });
  }
});

export default router;
