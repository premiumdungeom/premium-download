import express from "express";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import os from "os";
import rateLimit from "express-rate-limit";
import cors from "cors";
import validator from "validator";

const app = express();

// Configuration
const PORT = process.env.PORT || 3000;
const MAX_FILE_AGE = 1000 * 60 * 30; // 30 minutes
const YT_DLP_TIMEOUT = 1000 * 60 * 5; // 5 minutes

// Middleware
app.use(express.json());
app.use(cors({
  origin: process.env.CORS_ORIGIN || "*"
}));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to run yt-dlp with timeout
function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", args);
    let timeout = setTimeout(() => {
      proc.kill();
      reject(new Error("Operation timed out"));
    }, YT_DLP_TIMEOUT);

    let out = "";
    let err = "";
    
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    
    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(out);
      else reject(new Error(err || `Process exited with code ${code}`));
    });
  });
}

// Cleanup old temporary files
function cleanupTempFiles() {
  const tmpDir = os.tmpdir();
  fs.readdirSync(tmpDir)
    .filter(f => f.startsWith("dl-"))
    .forEach(f => {
      const filePath = path.join(tmpDir, f);
      const stat = fs.statSync(filePath);
      if (Date.now() - stat.mtimeMs > MAX_FILE_AGE) {
        fs.rmSync(filePath, { recursive: true, force: true });
      }
    });
}

// Validate YouTube URL
function isValidYouTubeUrl(url) {
  return validator.isURL(url, {
    protocols: ["http", "https"],
    host_whitelist: ["www.youtube.com", "youtube.com", "youtu.be"]
  });
}

// Inspect formats endpoint
app.get("/api/inspect", apiLimiter, async (req, res) => {
  try {
    const { url, kind = "ytv" } = req.query;
    
    if (!url || !isValidYouTubeUrl(url)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid YouTube URL is required"
      });
    }

    const info = await runYtDlp(["-J", url]);
    const json = JSON.parse(info);
    let formats = json.formats || [];

    // Filter formats based on requested type
    if (kind === "yta") {
      formats = formats.filter(f => 
        f.vcodec === "none" && /m4a|mp3|opus/i.test(f.ext)
      );
    } else {
      formats = formats.filter(f => 
        f.vcodec && f.height && [360, 480, 720, 1080].includes(f.height) && 
        /mp4|webm/i.test(f.ext)
      );
    }

    // Sort by quality (highest first)
    formats.sort((a, b) => (b.height || 0) - (a.height || 0));

    const cleaned = formats.map(f => ({
      format_id: f.format_id,
      ext: f.ext,
      resolution: f.height ? `${f.height}p` : null,
      audio_bitrate: f.abr || null,
      size: formatBytes(f.filesize || f.filesize_approx)
    }));

    res.json({ 
      success: true,
      title: json.title,
      thumbnail: json.thumbnail,
      duration: json.duration_string,
      formats: cleaned 
    });
  } catch (e) {
    res.status(500).json({ 
      success: false,
      error: "Failed to inspect video: " + e.message 
    });
  }
});

// Download endpoint
app.get("/api/download", apiLimiter, async (req, res) => {
  try {
    const { url, format_id, kind = "ytv" } = req.query;
    
    if (!url || !format_id || !isValidYouTubeUrl(url)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid YouTube URL and format_id are required"
      });
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-"));
    const outPath = path.join(tmpDir, "%(title).200B.%(ext)s");
    
    const args = [
      "-f", format_id,
      "--no-playlist",
      "--merge-output-format", kind === "yta" ? "m4a" : "mp4",
      "-o", outPath,
      url
    ];

    await runYtDlp(args);

    const files = fs.readdirSync(tmpDir);
    if (!files.length) {
      throw new Error("No file was downloaded");
    }

    const filePath = path.join(tmpDir, files[0]);
    const fileName = path.basename(filePath);

    res.download(filePath, fileName, (err) => {
      // Cleanup after download completes or fails
      fs.rmSync(tmpDir, { recursive: true, force: true });
      if (err) {
        console.error("Download failed:", err);
      }
    });

  } catch (e) {
    res.status(500).json({ 
      success: false,
      error: "Download failed: " + e.message 
    });
  }
});

// Helper to format bytes
function formatBytes(bytes) {
  if (!bytes) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(2)} ${units[i]}`;
}

// Regular cleanup
setInterval(cleanupTempFiles, 1000 * 60 * 60); // Run hourly

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  cleanupTempFiles(); // Initial cleanup
});    if (kind === "yta") {
      formats = formats.filter(f => f.vcodec === "none" && /m4a|mp3/i.test(f.ext));
    } else {
      formats = formats.filter(f => f.vcodec && f.height && [360,480,720].includes(f.height) && /mp4/i.test(f.ext));
    }

    const cleaned = formats.map(f => ({
      format_id: f.format_id,
      ext: f.ext,
      height: f.height || null,
      abr: f.abr || null,
      filesize: f.filesize || f.filesize_approx || null
    }));

    res.json({ title: json.title, formats: cleaned });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Download & return file path
app.get("/api/download", async (req, res) => {
  const { url, format_id, kind } = req.query;
  if (!url || !format_id) return res.status(400).json({ error: "url & format_id required" });

  try {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-"));
    const outPath = path.join(tmpDir, "%(title).200B.%(ext)s");
    const args = [
      "-f", format_id,
      "--no-playlist",
      "--merge-output-format", kind === "yta" ? "m4a" : "mp4",
      "-o", outPath,
      url
    ];

    await runYtDlp(args);

    const files = fs.readdirSync(tmpDir).map(f => path.join(tmpDir, f));
    if (!files.length) throw new Error("No file downloaded");
    const filePath = files[0];
    res.download(filePath, path.basename(filePath), (err) => {
      if (!err) fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(3000, () => console.log("Backend on :3000"));
