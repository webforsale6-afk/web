import express from "express";
import multer from "multer";
import cors from "cors";
import { v2 as cloudinary } from "cloudinary";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json());

// -------------------------------
// CLOUDINARY CONFIG (unchanged keys)
// -------------------------------
cloudinary.config({
  cloud_name: "de4dxhmfp",
  api_key: "938512876421641",
  api_secret: "QlV1CxR7gcYky97toBTB-zccVPE",
});

// Multer → store PDF in memory
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Admin password (unchanged)
const ADMIN_PASSWORD = "123123123";

// Admin Auth middleware (unchanged)
const adminAuth = (req, res, next) => {
  const pass = req.headers["admin-password"];
  if (pass === ADMIN_PASSWORD) return next();
  return res.status(401).json({ error: "Unauthorized" });
};

// File path for storing names (unchanged)
const NAMES_FILE = path.join(process.cwd(), 'saved_names.json');

// Helper: Read names
const readNamesFromFile = () => {
  try {
    if (fs.existsSync(NAMES_FILE)) {
      const data = fs.readFileSync(NAMES_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error reading names file:', error);
  }
  return { name1: "", name2: "" };
};

// Helper: Write names
const writeNamesToFile = (names) => {
  try {
    fs.writeFileSync(NAMES_FILE, JSON.stringify(names, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing names file:', error);
    return false;
  }
};

// ✅ Updated Cloudinary PDF uploader (keeps same name but cleans it for unsigned upload safety)
const uploadToCloudinary = (fileBuffer, filename) => {
  return new Promise((resolve, reject) => {
    const cleanName = path.parse(filename).name.replace(/[^a-zA-Z0-9_\-]/g, "");
    const finalName = cleanName || `file_${Date.now()}`;

    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        folder: "downloads",
        public_id: finalName,
        format: "pdf",
        type: "upload",
        overwrite: false,
      },
      (err, result) => {
        if (err) {
          console.error("CLOUDINARY UPLOAD ERROR:", err);
          reject(err);
        } else {
          resolve(result);
        }
      }
    );

    stream.end(fileBuffer);
  });
};

// ------------------------------
// 1) UPLOAD PDF (2 options, name stays same)
// ------------------------------
app.post("/upload/:user", adminAuth, upload.fields([{ name: 'file1' }, { name: 'file2' }]), async (req, res) => {
  try {
    const user = req.params.user.toLowerCase();

    if (!["gurdeep", "kulwinder"].includes(user))
      return res.status(400).json({ error: "Invalid user" });

    const files = [...(req.files?.file1 || []), ...(req.files?.file2 || [])];
    if (!files.length) return res.status(400).json({ error: "At least one PDF is required" });

    const uploadedReports = [];

    for (const file of files) {
      if (file.mimetype !== "application/pdf") continue;

      try {
        const uploaded = await uploadToCloudinary(file.buffer, file.originalname);
        uploadedReports.push({
          public_id: uploaded.public_id,
          secure_url: uploaded.secure_url,
          created_at: uploaded.created_at,
          resource_type: uploaded.resource_type,
          originalName: file.originalname
        });
      } catch (uploadErr) {
        console.log("Skipping failed upload but continuing...");
      }
    }

    return res.json({
      message: "File uploaded successfully",
      reports: uploadedReports
    });

  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// 2) GET NAME FROM UPLOADED PDF (unchanged)
// ------------------------------
app.get("/name", async (req, res) => {
  try {
    const result = await cloudinary.search
      .expression('folder:downloads AND resource_type:raw')
      .sort_by("created_at", "desc")
      .max_results(50)
      .execute();

    const files = result.resources;
    if (!files || !files.length) return res.status(404).json({ error: "No PDF files found" });

    return res.json({ totalFiles: files.length, files });

  } catch (err) {
    console.error("GET NAME ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// 3) SAVE/GET NAMES API (unchanged)
// ------------------------------
app.route("/api/names")
  .get(adminAuth, (req, res) => {
    const names = readNamesFromFile();
    res.json({ success: true, names });
  })
  .post(adminAuth, (req, res) => {
    const { name1, name2 } = req.body;
    if (!name1 || !name2) return res.status(400).json({ success: false, error: "Both names are required" });

    const names = {
      name1: name1.trim(),
      name2: name2.trim(),
      lastUpdated: new Date().toISOString()
    };

    const success = writeNamesToFile(names);
    if (success) res.json({ success: true, message: "Names saved", names });
    else res.status(500).json({ success: false, error: "Failed to save" });
  });

// ------------------------------
// 4) DOWNLOAD LATEST FILE - GURDEEP (only extension fix added)
// ------------------------------
app.get("/download/gurdeep", async (req, res) => {
  try {
    const result = await cloudinary.search
      .expression('folder:downloads')
      .sort_by("created_at", "desc")
      .max_results(30)
      .execute();

    const gurdeepFiles = result.resources.filter(file =>
      file.public_id.toLowerCase().includes('gurdeep')
    );

    if (!gurdeepFiles.length) return res.status(404).json({ error: "No file found for Gurdeep" });

    const latest = gurdeepFiles[0];
    const originalName = latest.public_id.split('/').pop();
    const downloadUrl = `${latest.secure_url}?fl_attachment:attachment;filename=${originalName}.pdf`;

    return res.json({
      downloadUrl,
      fileName: `${originalName}.pdf`,
      uploadedAt: latest.created_at
    });

  } catch (err) {
    console.error("DOWNLOAD GURDEEP ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// 5) DOWNLOAD LATEST FILE - KULWINDER (only extension fix added)
// ------------------------------
app.get("/download/kulwinder", async (req, res) => {
  try {
    const result = await cloudinary.search
      .expression('folder:downloads')
      .sort_by("created_at", "desc")
      .max_results(30)
      .execute();

    const kulwinderFiles = result.resources.filter(file =>
      file.public_id.toLowerCase().includes('kulwinder')
    );

    if (!kulwinderFiles.length) return res.status(404).json({ error: "No file found for Kulwinder" });

    const latest = kulwinderFiles[0];
    const originalName = latest.public_id.split('/').pop();
    const downloadUrl = `${latest.secure_url}?fl_attachment:attachment;filename=${originalName}.pdf`;

    return res.json({
      downloadUrl,
      fileName: `${originalName}.pdf`,
      uploadedAt: latest.created_at
    });

  } catch (err) {
    console.error("DOWNLOAD KULWINDER ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// 6) DELETE ALL FILES (unchanged)
// ------------------------------
app.delete("/delete-all", adminAuth, async (req, res) => {
  try {
    const result = await cloudinary.search
      .expression('folder:downloads')
      .max_results(100)
      .execute();

    const files = result.resources;
    if (!files || !files.length) return res.status(404).json({ error: "No files to delete" });

    await Promise.all(files.map(file =>
      cloudinary.uploader.destroy(file.public_id, { resource_type: "raw", invalidate: true })
    ));

    return res.json({ message: "All files deleted successfully", deletedCount: files.length });

  } catch (err) {
    console.error("DELETE ALL ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// 7) PUBLIC NAMES ROUTE (unchanged)
// ------------------------------
app.get("/public/names", async (req, res) => {
  try {
    const names = readNamesFromFile();
    res.json({ success: true, names });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to retrieve names" });
  }
});

// ------------------------------
// 8) GET ALL REPORTS (unchanged)
// ------------------------------
app.get("/reports", async (req, res) => {
  try {
    const result = await cloudinary.search
      .expression('folder:downloads')
      .sort_by("created_at", "desc")
      .max_results(50)
      .execute();
    const files = result.resources;

    const organized = {
      gurdeep: files.filter(f => f.public_id.toLowerCase().includes('gurdeep')),
      kulwinder: files.filter(f => f.public_id.toLowerCase().includes('kulwinder')),
      other: files.filter(f =>
        !f.public_id.toLowerCase().includes('gurdeep') && !f.public_id.toLowerCase().includes('kulwinder')
      )
    };
    return res.json({ totalFiles: files.length, ...organized });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// 9) HEALTH CHECK (unchanged)
// ------------------------------
app.get("/health", (req, res) => {
  res.json({ status: "OK", message: "Server running", timestamp: new Date().toISOString() });
});

// ------------------------------
// ERROR HANDLING (unchanged)
// ------------------------------
app.use((err, req, res, next) => {
  res.status(500).json({ error: "Internal server error", message: err.message });
});

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// START SERVER (unchanged)
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} 🚀`);
  console.log(`Health check: http://localhost:${PORT}/health`);

  if (!fs.existsSync(NAMES_FILE)) {
    writeNamesToFile({ name1: "", name2: "" });
    console.log("Names file initialized");
  }
});
