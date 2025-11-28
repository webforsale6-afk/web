// server.js
const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const cors = require("cors");
const { v2: cloudinary } = require("cloudinary");
const https = require("https"); // <-- to stream file from Cloudinary
require("dotenv").config();

const app = express();

// ======= MIDDLEWARE =======
app.use(cors());
app.use(express.json());

// ======= CLOUDINARY CONFIG =======
cloudinary.config({
  cloud_name: "de4dxhmfp",
  api_key: "938512876421641",
  api_secret: "QlV1CxR7gcYky97toBTB-zccVPE",
});

// ======= MONGOOSE SETUP =======
mongoose
  .connect("mongodb+srv://webforsale6_db_user:JeXMkEK7w4MP0y6C@cluster0.tf1grcl.mongodb.net/?appName=Cluster0")
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// ======= MONGOOSE MODEL =======
// We only have 2 “slots”: user1 and user2
const userFileSchema = new mongoose.Schema({
  slot: {
    type: String,
    enum: ["user1", "user2"],
    required: true,
    unique: true, // only one record per slot
  },
  name: {
    type: String,
    required: true,
  },
  pdfUrl: {
    type: String,
    required: true,
  },
  publicId: {
    type: String,
    required: true,
  },
  originalName: {
    type: String,
    required: true, // store original uploaded filename
  },
  uploadedAt: {
    type: Date,
    default: Date.now,
  },
});

const UserFile = mongoose.model("UserFile", userFileSchema);

// ======= MULTER (FILE UPLOAD) SETUP =======
const storage = multer.memoryStorage(); // keep file in memory buffer
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
});

// ======= HELPER: UPLOAD TO CLOUDINARY =======
function uploadPdfToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw", // better for pdfs
        folder: "user-pdfs",
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}

// ======= ROUTES =======

// Simple health check
app.get("/", (req, res) => {
  res.json({ message: "Backend is running 🚀" });
});

// 1) ADMIN: UPLOAD / UPDATE PDF FOR USER1 OR USER2
// Endpoint: POST /api/upload/user1
//           POST /api/upload/user2
// Form fields:
//   - name: string (user name to show on site)
//   - pdf: file (PDF)
app.post("/api/upload/:slot", upload.single("pdf"), async (req, res) => {
  try {
    const { slot } = req.params; // "user1" or "user2"
    const { name } = req.body;

    if (!["user1", "user2"].includes(slot)) {
      return res
        .status(400)
        .json({ error: "Invalid slot, must be user1 or user2" });
    }

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "PDF file is required" });
    }

    // Original filename from client (e.g. "my-report.pdf")
    let originalName = req.file.originalname || "file.pdf";
    if (!originalName.toLowerCase().endsWith(".pdf")) {
      originalName = originalName + ".pdf";
    }

    // Upload new pdf to Cloudinary
    const uploadResult = await uploadPdfToCloudinary(req.file.buffer);

    // Check if there is already a file for this slot
    let existing = await UserFile.findOne({ slot });

    // If existing, delete old file from Cloudinary
    if (existing) {
      try {
        await cloudinary.uploader.destroy(existing.publicId, {
          resource_type: "raw",
        });
      } catch (err) {
        console.warn(
          "Failed to delete old file from Cloudinary:",
          err.message
        );
      }

      existing.name = name;
      existing.pdfUrl = uploadResult.secure_url;
      existing.publicId = uploadResult.public_id;
      existing.originalName = originalName;
      existing.uploadedAt = new Date();
      await existing.save();

      return res.json({
        message: "File updated successfully",
        file: existing,
      });
    }

    // Create new record
    const newFile = await UserFile.create({
      slot,
      name,
      pdfUrl: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      originalName,
    });

    res.json({
      message: "File uploaded successfully",
      file: newFile,
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 2) PUBLIC: GET ALL USER FILES (for main website to show names + download buttons)
// Endpoint: GET /api/files
// Response example:
// [
//   { slot: "user1", name: "Ali", pdfUrl: "...", originalName: "AliReport.pdf", ... },
//   { slot: "user2", name: "Usman", pdfUrl: "...", originalName: "UsmanReport.pdf", ... }
// ]
app.get("/api/files", async (req, res) => {
  try {
    const files = await UserFile.find().sort({ slot: 1 });
    res.json(files);
  } catch (err) {
    console.error("Get files error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 3) PUBLIC: DOWNLOAD ENDPOINT FOR A SPECIFIC SLOT
// Endpoint: GET /api/files/user1/download
//           GET /api/files/user2/download
// This streams the file and forces the original filename.
app.get("/api/files/:slot/download", async (req, res) => {
  try {
    const { slot } = req.params;

    if (!["user1", "user2"].includes(slot)) {
      return res.status(400).json({ error: "Invalid slot" });
    }

    const file = await UserFile.findOne({ slot });
    if (!file) {
      return res.status(404).json({ error: "No file found for this user" });
    }

    // Ensure filename is safe & has .pdf extension
    let filename = file.originalName || "file.pdf";
    if (!filename.toLowerCase().endsWith(".pdf")) {
      filename = filename + ".pdf";
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(filename)}"`
    );

    // Stream from Cloudinary to the client
    https
      .get(file.pdfUrl, (fileStream) => {
        fileStream.on("error", (err) => {
          console.error("Error streaming from Cloudinary:", err);
          res.status(500).end("Error downloading file");
        });
        fileStream.pipe(res);
      })
      .on("error", (err) => {
        console.error("HTTPS get error:", err);
        res.status(500).end("Error downloading file");
      });
  } catch (err) {
    console.error("Download error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 4) ADMIN: DELETE ALL FILES (from DB + Cloudinary)
// Endpoint: DELETE /api/files
app.delete("/api/files", async (req, res) => {
  try {
    const files = await UserFile.find();

    // Delete from Cloudinary
    await Promise.all(
      files.map((f) =>
        cloudinary.uploader
          .destroy(f.publicId, { resource_type: "raw" })
          .catch((err) =>
            console.warn("Failed to delete:", f.publicId, err.message)
          )
      )
    );

    // Delete from MongoDB
    await UserFile.deleteMany({});

    res.json({ message: "All PDF files deleted from Cloudinary and database" });
  } catch (err) {
    console.error("Delete all error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ======= START SERVER =======
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
