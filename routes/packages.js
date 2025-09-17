import express from "express";
import { getAdminDB } from "../config/firebase-admin.js";
import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";

// Create a DOM window for DOMPurify
const window = new JSDOM("").window;
const createDOMPurify = DOMPurify(window);

const router = express.Router();

// Helper function to sanitize HTML content
const sanitizeHTML = (content) => {
  if (!content || typeof content !== "string") return content;

  // First, convert common markdown patterns to HTML if they exist
  const markdownToHtml = (text) => {
    let html = text
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") // Bold
      .replace(/\*(.*?)\*/g, "<em>$1</em>") // Italic
      .replace(/### (.*?)(\n|$)/g, "<h3>$1</h3>") // H3
      .replace(/## (.*?)(\n|$)/g, "<h2>$1</h2>") // H2
      .replace(/# (.*?)(\n|$)/g, "<h1>$1</h1>") // H1
      .replace(/^\- (.*?)$/gm, "<li>$1</li>") // Bullet points
      .replace(/^\d+\.\s+(.*?)$/gm, "<li>$1</li>") // Numbered list
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
      ) // Links
      .replace(/^> (.*?)$/gm, "<blockquote>$1</blockquote>") // Quotes
      .replace(/`(.*?)`/g, "<code>$1</code>") // Inline code
      .replace(/\n/g, "<br>"); // Line breaks

    // Improved list wrapping - handle consecutive list items properly
    html = html.replace(/(<li>.*?<\/li>)(\s*<li>.*?<\/li>)*/g, "<ul>$&</ul>");

    return html;
  };

  // Check if content contains markdown patterns
  const hasMarkdown =
    /(\*\*.*?\*\*|\*.*?\*|#{1,6}\s|`.*?`|\[.*?\]\(.*?\)|^[\-\d+\.]\s|^>\s)/m.test(
      content
    );

  // Convert markdown to HTML if needed
  let processedContent = hasMarkdown ? markdownToHtml(content) : content;

  // Allow basic HTML tags for rich text content
  const allowedTags = [
    "p",
    "br",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "code",
    "pre",
    "a",
    "hr",
  ];

  const allowedAttributes = {
    a: ["href", "title", "target", "rel"],
    "*": ["class"],
  };

  return createDOMPurify.sanitize(processedContent, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: ["href", "title", "target", "rel", "class"],
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    KEEP_CONTENT: true,
  });
};

// Helper function to generate package ID
const generatePackageId = () => {
  const prefix = "PKG-";
  const randomNum = Math.floor(Math.random() * 900000) + 100000;
  return prefix + randomNum;
};



// Helper function to get subscriber count for a package
const getSubscriberCount = async (db, packageId) => {
  try {
    const subscriptionsRef = db.collection("subscriptions");
    const querySnapshot = await subscriptionsRef
      .where("packageId", "==", packageId)
      .get();
    return querySnapshot.size;
  } catch (error) {
    console.error("Error getting subscriber count:", error);
    return 0;
  }
};

// Helper function to format package data for frontend
const formatPackageForFrontend = async (db, packageDoc) => {
  const data = packageDoc.data();
  const subscriberCount = await getSubscriberCount(db, data.packageId);

  return {
    id: data.packageId, // Use packageId as the main ID for frontend display
    packageId: data.packageId,
    name: data.name,
    description: data.description,
    price: `$${data.price.toFixed(2)}`, // Ensure 2 decimal places
    duration: data.duration,
    features: data.features || [],
    isActive: data.isActive,
    totalUser: subscriberCount.toLocaleString(), // Properly formatted with commas
    packageLimit: data.packageLimit || null,
    trialDays: data.trialDays || 0,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
};

// Get all packages with formatted data for frontend
router.get("/", async (req, res) => {
  try {
    console.log('GET /packages - Starting request');
    const db = getAdminDB();
    const packagesRef = db.collection("packages");
    const querySnapshot = await packagesRef.orderBy("createdAt", "desc").get();
    
    console.log('Found', querySnapshot.size, 'packages in database');

    const packages = [];
    for (const doc of querySnapshot.docs) {
      const formattedPackage = await formatPackageForFrontend(db, doc);
      packages.push(formattedPackage);
    }

    // Calculate stats
    const activePackages = packages.filter(
      (pkg) => pkg.isActive
    ).length;
    const totalRevenue = packages.reduce((sum, pkg) => {
      const price = parseFloat(pkg.price.replace("$", ""));
      const users = parseInt(pkg.totalUser.replace(/,/g, ""));
      return sum + price * users;
    }, 0);

    const response = {
      packages: packages,
      total: packages.length,
      stats: {
        activePackages,
        totalPackages: packages.length,
        totalRevenue: `$${totalRevenue.toLocaleString()}`,
      },
    };
    
    console.log('Sending response:', JSON.stringify(response, null, 2));
    res.status(200).json(response);
  } catch (error) {
    console.error("Get packages error:", error);
    res.status(500).json({
      error: error.message || "Failed to get packages",
    });
  }
});

// Get package by ID with formatted data
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const db = getAdminDB();

    // Try to find by document ID first, then by packageId
    let packageDoc = await db.collection("packages").doc(id).get();

    if (!packageDoc.exists) {
      // Try to find by packageId field
      const querySnapshot = await db
        .collection("packages")
        .where("packageId", "==", id)
        .get();

      if (querySnapshot.empty) {
        return res.status(404).json({
          error: "Package not found",
        });
      }

      packageDoc = querySnapshot.docs[0];
    }

    const formattedPackage = await formatPackageForFrontend(db, packageDoc);

    res.status(200).json({
      package: formattedPackage,
    });
  } catch (error) {
    console.error("Get package error:", error);
    res.status(500).json({
      error: error.message || "Failed to get package",
    });
  }
});

// Create new package
router.post("/", async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      duration,
      features,
      isActive = true,
      packageLimit,
      trialDays = 0,
    } = req.body;

    console.log('Create package request body:', req.body);
    console.log('packageLimit:', packageLimit, 'type:', typeof packageLimit);
    console.log('trialDays:', trialDays, 'type:', typeof trialDays);
    
    if (!name || !description || !price) {
      return res.status(400).json({
        error: "Name, description, and price are required",
      });
    }

    const db = getAdminDB();
    const packageId = generatePackageId();



    const packageData = {
      packageId,
      name: name.trim(),
      description: sanitizeHTML(description),
      price: parseFloat(price),
      duration: duration || "1 year",
      features: features || [],
      isActive,
      packageLimit: packageLimit && packageLimit !== '' ? parseInt(packageLimit) : null,
      trialDays: trialDays && trialDays !== '' ? parseInt(trialDays) : 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const docRef = await db.collection("packages").add(packageData);
    const formattedPackage = await formatPackageForFrontend(db, {
      id: docRef.id,
      data: () => packageData,
    });

    res.status(201).json({
      message: "Package created successfully",
      package: formattedPackage,
    });
  } catch (error) {
    console.error("Create package error:", error);
    res.status(500).json({
      error: error.message || "Failed to create package",
    });
  }
});

// Update package
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const db = getAdminDB();

    // Try to find by document ID first, then by packageId
    let packageRef = db.collection("packages").doc(id);
    let packageDoc = await packageRef.get();

    if (!packageDoc.exists) {
      // Try to find by packageId field
      const querySnapshot = await db
        .collection("packages")
        .where("packageId", "==", id)
        .get();

      if (querySnapshot.empty) {
        return res.status(404).json({
          error: "Package not found",
        });
      }

      packageDoc = querySnapshot.docs[0];
      packageRef = db.collection("packages").doc(packageDoc.id);
    }

    // Convert price to number if provided
    if (updates.price) {
      updates.price = parseFloat(updates.price);
    }

    // Sanitize description if provided
    if (updates.description) {
      updates.description = sanitizeHTML(updates.description);
    }

    // Trim name if provided
    if (updates.name) {
      updates.name = updates.name.trim();
    }

    // Convert packageLimit to number if provided
    if (updates.packageLimit !== undefined) {
      updates.packageLimit = updates.packageLimit && updates.packageLimit !== '' ? parseInt(updates.packageLimit) : null;
    }

    // Convert trialDays to number if provided
    if (updates.trialDays !== undefined) {
      updates.trialDays = updates.trialDays && updates.trialDays !== '' ? parseInt(updates.trialDays) : 0;
    }

    const updateData = {
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await packageRef.update(updateData);

    // Get updated package data
    const updatedDoc = await packageRef.get();
    const formattedPackage = await formatPackageForFrontend(db, updatedDoc);

    res.status(200).json({
      message: "Package updated successfully",
      package: formattedPackage,
    });
  } catch (error) {
    console.error("Update package error:", error);
    res.status(500).json({
      error: error.message || "Failed to update package",
    });
  }
});

// Delete package
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const db = getAdminDB();

    // Try to find by document ID first, then by packageId
    let packageRef = db.collection("packages").doc(id);
    let packageDoc = await packageRef.get();

    if (!packageDoc.exists) {
      // Try to find by packageId field
      const querySnapshot = await db
        .collection("packages")
        .where("packageId", "==", id)
        .get();

      if (querySnapshot.empty) {
        return res.status(404).json({
          error: "Package not found",
        });
      }

      packageDoc = querySnapshot.docs[0];
      packageRef = db.collection("packages").doc(packageDoc.id);
    }

    await packageRef.delete();

    res.status(200).json({
      message: "Package deleted successfully",
    });
  } catch (error) {
    console.error("Delete package error:", error);
    res.status(500).json({
      error: error.message || "Failed to delete package",
    });
  }
});

// Get active packages only
router.get("/active/list", async (req, res) => {
  try {
    const db = getAdminDB();
    const querySnapshot = await db
      .collection("packages")
      .where("isActive", "==", true)
      .orderBy("createdAt", "desc")
      .get();

    const packages = [];
    for (const doc of querySnapshot.docs) {
      const formattedPackage = await formatPackageForFrontend(db, doc);
      packages.push(formattedPackage);
    }

    res.status(200).json({
      packages: packages,
      total: packages.length,
    });
  } catch (error) {
    console.error("Get active packages error:", error);
    res.status(500).json({
      error: error.message || "Failed to get active packages",
    });
  }
});

// Get package statistics
router.get("/stats/overview", async (req, res) => {
  try {
    const db = getAdminDB();
    const querySnapshot = await db.collection("packages").get();

    const packages = [];
    for (const doc of querySnapshot.docs) {
      const formattedPackage = await formatPackageForFrontend(db, doc);
      packages.push(formattedPackage);
    }

    const stats = {
      activePackages: packages.filter((pkg) => pkg.isActive).length,
      totalPackages: packages.length,
      totalRevenue: packages.reduce((sum, pkg) => {
        const price = parseFloat(pkg.price.replace("$", ""));
        const users = parseInt(pkg.totalUser.replace(/,/g, ""));
        return sum + price * users;
      }, 0),
    };

    stats.totalRevenue = `$${stats.totalRevenue.toLocaleString()}`;

    res.status(200).json({ stats });
  } catch (error) {
    console.error("Get package stats error:", error);
    res.status(500).json({
      error: error.message || "Failed to get package statistics",
    });
  }
});

export default router;
