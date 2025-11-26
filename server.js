import express from "express";
import multer from "multer";
import cors from "cors";
import { v2 as cloudinary } from "cloudinary";

const app = express();
app.use(cors());
app.use(express.json());

// -------------------------------
// CLOUDINARY CONFIG
// -------------------------------
cloudinary.config({
  cloud_name: "de4dxhmfp",
  api_key: "938512876421641",
  api_secret: "QlV1CxR7gcYky97toBTB-zccVPE",
});

// Multer → store PDF in memory
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Admin password
const ADMIN_PASSWORD = "123123123";

// Admin Auth middleware
const adminAuth = (req, res, next) => {
  const pass = req.headers["admin-password"];
  if (pass === ADMIN_PASSWORD) return next();
  return res.status(401).json({ error: "Unauthorized" });
};

// Upload PDF to Cloudinary (flagging it as PDF)
const uploadToCloudinary = (fileBuffer, user) => {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now();
    const public_id = `${user}_report_${timestamp}`;

    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        folder: "downloads",
        public_id,
        format: "pdf", // ✅ This forces Cloudinary to treat the file as PDF
        overwrite: false,
        overwrite: false,
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      }
    );

    stream.end(fileBuffer);
  });
};

// ------------------------------
// 1) UPLOAD PDF
// ------------------------------
app.post("/upload/:user", adminAuth, upload.single("file"), async (req, res) => {
  try {
    const user = req.params.user.toLowerCase();
    const file = req.file;

    if (!["gurdeep", "kulwinder"].includes(user)) {
      return res.status(400).json({ error: "Invalid user param" });
    }

    if (!file) {
      return res.status(400).json({ error: "No file received" });
    }

    if (file.mimetype !== "application/pdf") {
      return res.status(400).json({ error: "Only PDFs allowed" });
    }

    const uploaded = await uploadToCloudinary(file.buffer, user);

    const report = {
      public_id: uploaded.public_id,
      secure_url: uploaded.secure_url, // Cloudinary URL now ends in .pdf
      created_at: uploaded.created_at,
      resource_type: uploaded.resource_type,
    };

    return res.json({ message: "Uploaded", report });
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// 2) DOWNLOAD LATEST FILE → GURDEEP (always return PDF)
// ------------------------------
app.get("/download/gurdeep", async (req, res) => {
  try {
    const result = await cloudinary.search
      .expression('folder:downloads')
      .sort_by("created_at", "desc")
      .max_results(50)
      .execute();

    const files = result.resources;
    const targetFiles = files.filter(f => f.public_id.toLowerCase().includes("gurdeep"));

    if (targetFiles.length === 0) {
      return res.status(404).json({ error: "No Gurdeep PDF found" });
    }

    const latest = targetFiles[0];

    // ✅ Override headers so browser saves it as PDF
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="gurdeep_latest_report.pdf"`
    );

    // ✅ Fetch file and send it from server
    const fetchRes = await fetch(latest.secure_url);
    const arrayBuffer = await fetchRes.arrayBuffer();
    return res.end(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error("DOWNLOAD ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// 3) DOWNLOAD LATEST FILE → KULWINDER (always return PDF)
// ------------------------------
app.get("/download/kulwinder", async (req, res) => {
  try {
    const result = await cloudinary.search
      .expression('folder:downloads')
      .sort_by("created_at", "desc")
      .max_results(50)
      .execute();

    const files = result.resources;
    const targetFiles = files.filter(f => f.public_id.toLowerCase().includes("kulwinder"));

    if (targetFiles.length === 0) {
      return res.status(404).json({ error: "No Kulwinder PDF found" });
    }

    const latest = targetFiles[0];

    // ✅ Force PDF download with extension
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="kulwinder_latest_report.pdf"`
    );

    const fetchRes = await fetch(latest.secure_url);
    const arrayBuffer = await fetchRes.arrayBuffer();
    return res.end(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error("DOWNLOAD ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// 4) DELETE ALL FILES
// ------------------------------
app.delete("/delete-all", adminAuth, async (req, res) => {
  try {
    const result = await cloudinary.search
      .expression('folder:downloads')
      .max_results(100)
      .execute();

    const files = result.resources;
    if (!files || files.length === 0) {
      return res.status(404).json({ error: "No files to delete" });
    }

    const deletePromises = files.map(file =>
      cloudinary.uploader.destroy(file.public_id, {
        resource_type: "raw",
        invalidate: true,
      })
    );

    await Promise.all(deletePromises);

    return res.json({ message: "Deleted", count: files.length });
  } catch (err) {
    console.error("DELETE ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// 5) GET NAME FROM UPLOADED PDF FILES
// ------------------------------
app.get("/name", async (req, res) => {
  try {
    const result = await cloudinary.search
      .expression('folder:downloads')
      .sort_by("created_at", "desc")
      .max_results(50)
      .execute();

    const files = result.resources;

    const names = files.map(f => ({
      id: f.public_id,
      url: f.secure_url,
      uploaded: f.created_at
    }));

    return res.json({ total: names.length, names });
  } catch (err) {
    console.error("NAME FETCH ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// 6) HEALTH CHECK
// ------------------------------
app.get("/health", (req, res) =>
  res.json({ status: "OK", time: new Date().toISOString() })
);

// 404 Handler
app.use((req, res) => res.status(404).json({ error: "Route missing" }));

// ------------------------------
// START SERVER
// ------------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server active on ${PORT}`));
