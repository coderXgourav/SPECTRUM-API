import express from "express";
import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  query,
  orderBy,
  where,
} from "firebase/firestore";

const router = express.Router();

// Get all reports
router.get("/", async (req, res) => {
  try {
    const { db } = req.firebase;
    const reportsRef = collection(db, "reports");
    const q = query(reportsRef, orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);

    const reports = [];
    querySnapshot.forEach((doc) => {
      reports.push({ id: doc.id, ...doc.data() });
    });

    res.status(200).json({
      reports: reports,
      total: reports.length,
    });
  } catch (error) {
    console.error("Get reports error:", error);
    res.status(500).json({
      error: error.message || "Failed to get reports",
    });
  }
});

// Get report by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { db } = req.firebase;
    const reportDoc = await getDoc(doc(db, "reports", id));

    if (!reportDoc.exists()) {
      return res.status(404).json({
        error: "Report not found",
      });
    }

    res.status(200).json({
      report: { id: reportDoc.id, ...reportDoc.data() },
    });
  } catch (error) {
    console.error("Get report error:", error);
    res.status(500).json({
      error: error.message || "Failed to get report",
    });
  }
});

// Create new report
router.post("/", async (req, res) => {
  try {
    const { title, type, data, description, generatedBy, dateRange } = req.body;

    if (!title || !type || !data) {
      return res.status(400).json({
        error: "Title, type, and data are required",
      });
    }

    const { db } = req.firebase;

    const reportData = {
      title,
      type, // 'user-analytics', 'ticket-summary', 'package-performance', etc.
      data,
      description: description || "",
      generatedBy: generatedBy || "system",
      dateRange: dateRange || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const docRef = await addDoc(collection(db, "reports"), reportData);

    res.status(201).json({
      message: "Report created successfully",
      report: { id: docRef.id, ...reportData },
    });
  } catch (error) {
    console.error("Create report error:", error);
    res.status(500).json({
      error: error.message || "Failed to create report",
    });
  }
});

// Update report
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const { db } = req.firebase;

    const reportRef = doc(db, "reports", id);
    const reportDoc = await getDoc(reportRef);

    if (!reportDoc.exists()) {
      return res.status(404).json({
        error: "Report not found",
      });
    }

    await updateDoc(reportRef, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });

    res.status(200).json({
      message: "Report updated successfully",
    });
  } catch (error) {
    console.error("Update report error:", error);
    res.status(500).json({
      error: error.message || "Failed to update report",
    });
  }
});

// Delete report
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { db } = req.firebase;

    const reportRef = doc(db, "reports", id);
    const reportDoc = await getDoc(reportRef);

    if (!reportDoc.exists()) {
      return res.status(404).json({
        error: "Report not found",
      });
    }

    await deleteDoc(reportRef);

    res.status(200).json({
      message: "Report deleted successfully",
    });
  } catch (error) {
    console.error("Delete report error:", error);
    res.status(500).json({
      error: error.message || "Failed to delete report",
    });
  }
});

// Generate user analytics report
router.post("/generate/user-analytics", async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    const { db } = req.firebase;

    // Get users data
    const usersRef = collection(db, "users");
    const usersSnapshot = await getDocs(usersRef);

    let totalUsers = 0;
    let activeUsers = 0;
    let usersByRole = {};

    usersSnapshot.forEach((doc) => {
      const userData = doc.data();
      totalUsers++;

      if (userData.isActive) activeUsers++;

      const role = userData.role || "user";
      usersByRole[role] = (usersByRole[role] || 0) + 1;
    });

    const reportData = {
      title: "User Analytics Report",
      type: "user-analytics",
      data: {
        totalUsers,
        activeUsers,
        inactiveUsers: totalUsers - activeUsers,
        usersByRole,
        generatedAt: new Date().toISOString(),
      },
      description: `User analytics report from ${startDate || "beginning"} to ${
        endDate || "now"
      }`,
      generatedBy: "system",
      dateRange: { startDate, endDate },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const docRef = await addDoc(collection(db, "reports"), reportData);

    res.status(201).json({
      message: "User analytics report generated successfully",
      report: { id: docRef.id, ...reportData },
    });
  } catch (error) {
    console.error("Generate user analytics error:", error);
    res.status(500).json({
      error: error.message || "Failed to generate user analytics report",
    });
  }
});

// Generate ticket summary report
router.post("/generate/ticket-summary", async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    const { db } = req.firebase;

    // Get tickets data
    const ticketsRef = collection(db, "tickets");
    const ticketsSnapshot = await getDocs(ticketsRef);

    let totalTickets = 0;
    let ticketsByStatus = {};
    let ticketsByPriority = {};

    ticketsSnapshot.forEach((doc) => {
      const ticketData = doc.data();
      totalTickets++;

      const status = ticketData.status || "open";
      const priority = ticketData.priority || "medium";

      ticketsByStatus[status] = (ticketsByStatus[status] || 0) + 1;
      ticketsByPriority[priority] = (ticketsByPriority[priority] || 0) + 1;
    });

    const reportData = {
      title: "Ticket Summary Report",
      type: "ticket-summary",
      data: {
        totalTickets,
        ticketsByStatus,
        ticketsByPriority,
        generatedAt: new Date().toISOString(),
      },
      description: `Ticket summary report from ${startDate || "beginning"} to ${
        endDate || "now"
      }`,
      generatedBy: "system",
      dateRange: { startDate, endDate },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const docRef = await addDoc(collection(db, "reports"), reportData);

    res.status(201).json({
      message: "Ticket summary report generated successfully",
      report: { id: docRef.id, ...reportData },
    });
  } catch (error) {
    console.error("Generate ticket summary error:", error);
    res.status(500).json({
      error: error.message || "Failed to generate ticket summary report",
    });
  }
});

export default router;
