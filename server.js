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

// File path for storing names
const NAMES_FILE = path.join(process.cwd(), 'saved_names.json');

// Helper function to read names from file
const readNamesFromFile = () => {
  try {
    if (fs.existsSync(NAMES_FILE)) {
      const data = fs.readFileSync(NAMES_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error reading names file:', error);
  }
  return { name1: "", name2: "" }; // Default empty names
};

// Helper function to write names to file
const writeNamesToFile = (names) => {
  try {
    fs.writeFileSync(NAMES_FILE, JSON.stringify(names, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing names file:', error);
    return false;
  }
};

// Upload PDF to Cloudinary
const uploadToCloudinary = (fileBuffer, user) => {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now();
    const public_id = `${user}_report_${timestamp}`;
    
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        folder: "downloads",
        public_id: public_id,
        type: "upload",
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

// Helper function to extract name from filename
const extractNameFromFilename = (filename) => {
  // Remove the "_report.pdf" part and get the name before it
  if (filename && typeof filename === 'string') {
    const match = filename.match(/^(.+)_report\.pdf$/i);
    return match ? match[1] : null;
  }
  return null;
};

// ------------------------------
// 1) UPLOAD PDF
// ------------------------------
app.post("/upload/:user", adminAuth, upload.single("file"), async (req, res) => {
  try {
    const user = req.params.user.toLowerCase();
    const file = req.file;

    if (!["gurdeep", "kulwinder"].includes(user))
      return res.status(400).json({ error: "Invalid user" });

    if (!file) return res.status(400).json({ error: "File missing" });

    if (file.mimetype !== "application/pdf") {
      return res.status(400).json({ error: "Only PDF files are allowed" });
    }

    const uploaded = await uploadToCloudinary(file.buffer, user);

    const report = {
      public_id: uploaded.public_id,
      secure_url: uploaded.secure_url,
      created_at: uploaded.created_at,
      resource_type: uploaded.resource_type
    };

    return res.json({ 
      message: "File uploaded successfully", 
      report: report 
    });
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// 2) GET NAME FROM UPLOADED PDF
// ------------------------------
app.get("/name", async (req, res) => {
  try {
    const result = await cloudinary.search
      .expression('folder:downloads AND resource_type:raw')
      .sort_by("created_at", "desc")
      .max_results(50)
      .execute();

    const files = result.resources;

    if (!files || files.length === 0)
      return res.status(404).json({ error: "No PDF files found" });

    // Extract names from all PDF files
    const pdfNames = files
      .filter(file => file.public_id.toLowerCase().endsWith('.pdf'))
      .map(file => {
        const filename = file.public_id.split('/').pop(); // Get just the filename part
        const name = extractNameFromFilename(filename);
        return {
          originalFilename: filename,
          extractedName: name,
          uploadedAt: file.created_at,
          secure_url: file.secure_url
        };
      })
      .filter(item => item.extractedName !== null); // Filter out files that don't match the pattern

    if (pdfNames.length === 0)
      return res.status(404).json({ error: "No properly named PDF files found" });

    return res.json({
      totalPdfFiles: pdfNames.length,
      names: pdfNames
    });

  } catch (err) {
    console.error("GET NAME ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// 3) NAMES API - GET & POST
// ------------------------------
app.route("/api/names")
  // GET - Retrieve saved names
  .get(adminAuth, (req, res) => {
    try {
      const names = readNamesFromFile();
      res.json({
        success: true,
        names: names
      });
    } catch (error) {
      console.error("GET NAMES ERROR:", error);
      res.status(500).json({ 
        success: false,
        error: "Failed to retrieve names" 
      });
    }
  })
  // POST - Save names
  .post(adminAuth, (req, res) => {
    try {
      const { name1, name2 } = req.body;

      if (!name1 || !name2) {
        return res.status(400).json({
          success: false,
          error: "Both name1 and name2 are required"
        });
      }

      const names = {
        name1: name1.trim(),
        name2: name2.trim(),
        lastUpdated: new Date().toISOString()
      };

      const success = writeNamesToFile(names);

      if (success) {
        res.json({
          success: true,
          message: "Names saved successfully",
          names: names
        });
      } else {
        res.status(500).json({
          success: false,
          error: "Failed to save names"
        });
      }
    } catch (error) {
      console.error("POST NAMES ERROR:", error);
      res.status(500).json({
        success: false,
        error: "Failed to save names"
      });
    }
  });

// ------------------------------
// 4) DOWNLOAD LATEST FILE - GURDEEP
// ------------------------------
app.get("/download/gurdeep", async (req, res) => {
  try {
    const result = await cloudinary.search
      .expression('folder:downloads')
      .sort_by("created_at", "desc")
      .max_results(30)
      .execute();

    const files = result.resources;

    if (!files || files.length === 0)
      return res.status(404).json({ error: "No files found in downloads folder" });

    // Filter files containing "gurdeep" in public_id
    const gurdeepFiles = files.filter(file => 
      file.public_id.toLowerCase().includes('gurdeep')
    );

    if (gurdeepFiles.length === 0)
      return res.status(404).json({ error: "No file found for Gurdeep" });

    const latest = gurdeepFiles[0];
    const downloadUrl = `${latest.secure_url}?fl_attachment`;

    return res.json({ 
      downloadUrl,
      fileName: latest.public_id,
      uploadedAt: latest.created_at
    });
  } catch (err) {
    console.error("DOWNLOAD GURDEEP ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// 5) DOWNLOAD LATEST FILE - KULWINDER
// ------------------------------
app.get("/download/kulwinder", async (req, res) => {
  try {
    const result = await cloudinary.search
      .expression('folder:downloads')
      .sort_by("created_at", "desc")
      .max_results(30)
      .execute();

    const files = result.resources;

    if (!files || files.length === 0)
      return res.status(404).json({ error: "No files found in downloads folder" });

    // Filter files containing "kulwinder" in public_id
    const kulwinderFiles = files.filter(file => 
      file.public_id.toLowerCase().includes('kulwinder')
    );

    if (kulwinderFiles.length === 0)
      return res.status(404).json({ error: "No file found for Kulwinder" });

    const latest = kulwinderFiles[0];
    const downloadUrl = `${latest.secure_url}?fl_attachment`;

    return res.json({ 
      downloadUrl,
      fileName: latest.public_id,
      uploadedAt: latest.created_at
    });
  } catch (err) {
    console.error("DOWNLOAD KULWINDER ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// 6) DELETE ALL FILES
// ------------------------------
app.delete("/delete-all", adminAuth, async (req, res) => {
  try {
    // Search all files in downloads folder
    const result = await cloudinary.search
      .expression('folder:downloads')
      .sort_by("created_at", "desc")
      .max_results(100)
      .execute();

    const files = result.resources;

    if (!files || files.length === 0)
      return res.status(404).json({ error: "No files to delete" });

    // Delete all files
    const deletePromises = files.map(file => 
      cloudinary.uploader.destroy(file.public_id, { 
        resource_type: "raw",
        invalidate: true 
      })
    );

    await Promise.all(deletePromises);

    return res.json({
      message: "All files deleted successfully",
      deletedCount: files.length,
    });
  } catch (err) {
    console.error("DELETE ALL ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// 7) GET ALL REPORTS (Optional - for debugging)
// ------------------------------
app.get("/reports", async (req, res) => {
  try {
    const result = await cloudinary.search
      .expression('folder:downloads')
      .sort_by("created_at", "desc")
      .max_results(50)
      .execute();

    const files = result.resources;

    // Organize files by user
    const organized = {
      gurdeep: files.filter(f => f.public_id.toLowerCase().includes('gurdeep')),
      kulwinder: files.filter(f => f.public_id.toLowerCase().includes('kulwinder')),
      other: files.filter(f => 
        !f.public_id.toLowerCase().includes('gurdeep') && 
        !f.public_id.toLowerCase().includes('kulwinder')
      )
    };

    return res.json({
      totalFiles: files.length,
      ...organized
    });
  } catch (err) {
    console.error("REPORTS ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// 8) HEALTH CHECK
// ------------------------------
app.get("/health", (req, res) => {
  res.json({ 
    status: "OK", 
    message: "Server is running",
    timestamp: new Date().toISOString()
  });
});

// ------------------------------
// ERROR HANDLING MIDDLEWARE
// ------------------------------
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err);
  res.status(500).json({ 
    error: "Internal server error",
    message: err.message 
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ------------------------------
// START SERVER
// ------------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} 🚀`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  
  // Initialize names file if it doesn't exist
  if (!fs.existsSync(NAMES_FILE)) {
    writeNamesToFile({ name1: "", name2: "" });
    console.log("Names file initialized");
  }
});
