import express from "express";
import ytdlp from "yt-dlp-exec"; // npm install yt-dlp-exec
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import os from "os";

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Inspect formats
app.get("/api/inspect", async (req, res) => {
  const { url, kind } = req.query;
  if (!url) return res.status(400).json({ error: "url required" });

  try {
    const json = await ytdlp(url, { dumpJson: true });

    let formats = json.formats || [];
    if (kind === "yta") {
      formats = formats.filter(f => f.vcodec === "none" && /m4a|mp3/i.test(f.ext));
    } else {
      formats = formats.filter(
        f => f.vcodec && f.height && [360, 480, 720].includes(f.height) && /mp4/i.test(f.ext)
      );
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

// Download & return file
app.get("/api/download", async (req, res) => {
  const { url, format_id, kind } = req.query;
  if (!url || !format_id) return res.status(400).json({ error: "url & format_id required" });

  try {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-"));
    const outPath = path.join(tmpDir, "%(title).200B.%(ext)s");

    await ytdlp(url, {
      format: format_id,
      noPlaylist: true,
      mergeOutputFormat: kind === "yta" ? "m4a" : "mp4",
      output: outPath
    });

    const files = fs.readdirSync(tmpDir).map(f => path.join(tmpDir, f));
    if (!files.length) throw new Error("No file downloaded");

    const filePath = files[0];
    res.download(filePath, path.basename(filePath), err => {
      if (!err) fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(3000, () => console.log("Backend running on :3000"));
