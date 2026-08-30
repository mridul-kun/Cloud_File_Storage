const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const crypto = require("crypto");
const archiverPkg = require("archiver");
const archiver = typeof archiverPkg === "function" ? archiverPkg : archiverPkg.default;

if (typeof archiver !== "function") {
    console.error("\n❌ The 'archiver' package didn't load correctly (got:", typeof archiver, ").");
    console.error("   Try: npm install archiver@7\n");
    process.exit(1);
} const unzipper = require("unzipper");

const app = express();
const PORT = process.env.PORT || 4000;

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const STORAGE_DIR = path.join(ROOT, "storage");
const TMP_DIR = path.join(DATA_DIR, "tmp");
const BACKUPS_DIR = path.join(DATA_DIR, "backups");
const DB_FILE = path.join(DATA_DIR, "db.json");
const PUBLIC_DIR = path.join(ROOT, "public");
const QUOTA_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB mock quota

// ---- ensure folders / db file exist on boot ----
[DATA_DIR, STORAGE_DIR, TMP_DIR, BACKUPS_DIR].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ items: [], backups: [] }, null, 2));
}

function readDB() {
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    try {
        const db = JSON.parse(raw);
        if (!Array.isArray(db.items)) db.items = [];
        if (!Array.isArray(db.backups)) db.backups = [];
        return db;
    } catch (err) {
        // db.json got corrupted (partial write / file lock interrupted a save).
        // Don't crash every route — back up the bad file and start fresh
        // so the app keeps working instead of every request 500-ing.
        console.error("db.json was corrupted, resetting. Bad copy saved as db.json.corrupt:", err.message);
        try { fs.writeFileSync(DB_FILE + ".corrupt", raw); } catch { }
        const fresh = { items: [], backups: [] };
        fs.writeFileSync(DB_FILE, JSON.stringify(fresh, null, 2));
        return fresh;
    }
}
function writeDB(db) {
    const tmp = DB_FILE + ".tmp";
    const data = JSON.stringify(db, null, 2);
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            fs.writeFileSync(tmp, data);
            fs.renameSync(tmp, DB_FILE);
            return;
        } catch (err) {
            if (attempt === maxAttempts) throw err;
            // Windows / cloud-synced folders (OneDrive etc.) can briefly lock
            // the file right after a write — back off a moment and retry
            // instead of silently losing the metadata write.
            const waitTill = Date.now() + 80 * attempt;
            while (Date.now() < waitTill) { /* brief synchronous backoff */ }
        }
    }
}
function uid() {
    return crypto.randomBytes(9).toString("hex");
}
function nowISO() {
    return new Date().toISOString();
}

app.use(express.json());
app.use(express.static(PUBLIC_DIR, {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    },
}));

/* ---------------- Uploads ---------------- */

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, STORAGE_DIR),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname);
            cb(null, uid() + ext); // File ab random-id.jpg ke naam se save hogi
        },
    }),
    limits: { fileSize: 5 * 1024 * 1024 * 1024 },
});

function fixName(originalname) {
    // multer gives latin1-decoded names for non-ascii filenames; repair to utf8
    return Buffer.from(originalname, "latin1").toString("utf8");
}

/* ---------------- Helpers ---------------- */

function getDescendantIds(db, rootId) {
    const stack = [rootId];
    const result = [];
    while (stack.length) {
        const cur = stack.pop();
        db.items.filter((i) => i.parentId === cur).forEach((k) => {
            result.push(k.id);
            stack.push(k.id);
        });
    }
    return result;
}

function pathForItem(db, item) {
    const parts = [item.name];
    let p = item.parentId ? db.items.find((i) => i.id === item.parentId) : null;
    while (p) {
        parts.unshift(p.name);
        p = p.parentId ? db.items.find((i) => i.id === p.parentId) : null;
    }
    return parts.join("/");
}

/* ---------------- Routes: items ---------------- */

app.get("/api/items", (req, res) => {
    res.json(readDB().items);
});

app.get("/api/storage", (req, res) => {
    const db = readDB();
    const used = db.items
        .filter((i) => i.type === "file" && !i.trashed)
        .reduce((s, i) => s + (i.size || 0), 0);
    res.json({ used, quota: QUOTA_BYTES });
});

app.post("/api/folder", (req, res) => {
    const { name, parentId } = req.body;
    const db = readDB();
    const item = {
        id: uid(),
        type: "folder",
        name: (name || "Untitled folder").trim(),
        parentId: parentId || null,
        size: 0,
        dateAdded: nowISO(),
        dateModified: nowISO(),
        trashed: false,
        trashedAt: null,
    };
    db.items.push(item);
    writeDB(db);
    res.json(item);
});

app.post("/api/upload", upload.array("files"), (req, res) => {
    try {
        const parentId = req.body.parentId === "null" || !req.body.parentId ? null : req.body.parentId;
        const db = readDB();
        const created = [];
        (req.files || []).forEach((f) => {
            const item = {
                id: f.filename,
                type: "file",
                name: fixName(f.originalname),
                parentId,
                size: f.size,
                mimeType: f.mimetype,
                storedName: f.filename,
                dateAdded: nowISO(),
                dateModified: nowISO(),
                trashed: false,
                trashedAt: null,
            };
            db.items.push(item);
            created.push(item);
        });
        writeDB(db);
        res.json(created);
    } catch (err) {
        console.error("Upload save failed:", err);
        // Don't leave orphan files on disk with no matching metadata entry
        (req.files || []).forEach((f) => {
            const p = path.join(STORAGE_DIR, f.filename);
            fs.existsSync(p) && fs.unlink(p, () => { });
        });
        res.status(500).json({ error: "Could not save the uploaded file(s). Please try again." });
    }
});

app.patch("/api/rename/:id", (req, res) => {
    const db = readDB();
    const item = db.items.find((i) => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: "not found" });
    item.name = String(req.body.name || item.name).trim();
    item.dateModified = nowISO();
    writeDB(db);
    res.json(item);
});

app.post("/api/trash/:id", (req, res) => {
    const db = readDB();
    const item = db.items.find((i) => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: "not found" });
    const ids = new Set([item.id, ...getDescendantIds(db, item.id)]);
    const stamp = nowISO();
    db.items.forEach((i) => {
        if (ids.has(i.id)) {
            i.trashed = true;
            i.trashedAt = stamp;
        }
    });
    writeDB(db);
    res.json({ ok: true });
});

app.post("/api/restore/:id", (req, res) => {
    const db = readDB();
    const item = db.items.find((i) => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: "not found" });
    const ids = new Set([item.id, ...getDescendantIds(db, item.id)]);
    db.items.forEach((i) => {
        if (ids.has(i.id)) {
            i.trashed = false;
            i.trashedAt = null;
        }
    });
    writeDB(db);
    res.json({ ok: true });
});

app.delete("/api/delete/:id", async (req, res) => {
    const db = readDB();
    const item = db.items.find((i) => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: "not found" });
    const ids = new Set([item.id, ...getDescendantIds(db, item.id)]);
    const filesToRemove = db.items.filter((i) => ids.has(i.id) && i.type === "file");
    for (const f of filesToRemove) {
        const p = path.join(STORAGE_DIR, f.storedName);
        if (fs.existsSync(p)) await fsp.unlink(p).catch(() => { });
    }
    db.items = db.items.filter((i) => !ids.has(i.id));
    writeDB(db);
    res.json({ ok: true });
});

/* ---------------- Routes: file bytes ---------------- */

// Inline (for image thumbnails / previews)
app.get("/api/file/:id", (req, res) => {
    const db = readDB();
    const item = db.items.find((i) => i.id === req.params.id && i.type === "file");
    if (!item) return res.status(404).end();
    const p = path.join(STORAGE_DIR, item.storedName);
    if (!fs.existsSync(p)) return res.status(404).end();
    res.sendFile(p);
});

// Forced download
app.get("/api/download/:id", (req, res) => {
    const db = readDB();
    const item = db.items.find((i) => i.id === req.params.id && i.type === "file");
    if (!item) return res.status(404).end();
    const p = path.join(STORAGE_DIR, item.storedName);
    if (!fs.existsSync(p)) return res.status(404).end();
    res.download(p, item.name);
});

/* ---------------- Routes: backups ---------------- */

app.get("/api/backups", (req, res) => {
    try {
        const db = readDB();

        if (!Array.isArray(db.backups)) {
            db.backups = [];
            writeDB(db);
        }

        res.json(db.backups);
    } catch (err) {
        console.error("Backups API error:", err);
        res.status(500).json({
            error: "Could not load backups"
        });
    }
});

app.get("/api/backup/export", async (req, res) => {
    const filename = `haven-backup-${Date.now()}.zip`;
    const zipPath = path.join(BACKUPS_DIR, filename);

    try {
        const db = readDB();

        const files = db.items.filter(
            (item) => item.type === "file" && !item.trashed
        );

        const output = fs.createWriteStream(zipPath);
        const archive = archiver("zip", {
            zlib: { level: 9 }
        });

        archive.on("warning", (err) => {
            console.warn("Backup warning:", err);
        });

        await new Promise((resolve, reject) => {
            output.on("close", resolve);
            output.on("error", reject);
            archive.on("error", reject);

            archive.pipe(output);

            for (const file of files) {
                const filePath = path.join(
                    STORAGE_DIR,
                    file.storedName
                );

                if (fs.existsSync(filePath)) {
                    archive.file(filePath, {
                        name: pathForItem(db, file)
                    });
                }
            }

            const manifest = {
                app: "Safe Haven",
                exportedAt: nowISO(),
                items: files.map((file) => ({
                    path: pathForItem(db, file),
                    size: file.size || 0,
                    mimeType: file.mimeType || "application/octet-stream"
                }))
            };

            archive.append(
                JSON.stringify(manifest, null, 2),
                {
                    name: "haven-manifest.json"
                }
            );

            archive.finalize();
        });

        // Record successful backup
        const dbUpdated = readDB();

        if (!Array.isArray(dbUpdated.backups)) {
            dbUpdated.backups = [];
        }

        dbUpdated.backups.push({
            id: uid(),
            name: filename,
            dateISO: nowISO(),
            itemCount: files.length
        });

        writeDB(dbUpdated);

        // Download the ZIP — keep it on disk (in BACKUPS_DIR) so it can be
        // re-downloaded, restored, or deleted later from Backup history.
        res.download(zipPath, filename, (err) => {
            if (err) console.error("Backup download error:", err);
        });

    } catch (err) {
        console.error("BACKUP EXPORT ERROR:", err);

        try {
            if (fs.existsSync(zipPath)) {
                await fsp.unlink(zipPath);
            }
        } catch { }

        if (!res.headersSent) {
            res.status(500).json({
                error: "Could not build backup",
                detail: err.message || String(err)
            });
        }
    }
});

const importUpload = multer({ dest: TMP_DIR });

async function importZipIntoVault(zipPath, parentId) {
    const db = readDB();
    const directory = await unzipper.Open.file(zipPath);
    const folderCache = new Map();
    let count = 0;

    for (const entry of directory.files) {
        if (entry.type === "Directory") continue;
        if (entry.path === "haven-manifest.json") continue;

        const parts = entry.path.split("/").filter(Boolean);
        const fileName = parts.pop();
        let curParent = parentId;
        let pathAcc = "";

        for (const part of parts) {
            pathAcc += "/" + part;
            if (folderCache.has(pathAcc)) {
                curParent = folderCache.get(pathAcc);
            } else {
                const folder = {
                    id: uid(), type: "folder", name: part, parentId: curParent, size: 0,
                    dateAdded: nowISO(), dateModified: nowISO(), trashed: false, trashedAt: null,
                };
                db.items.push(folder);
                folderCache.set(pathAcc, folder.id);
                curParent = folder.id;
            }
        }

        const buffer = await entry.buffer();
        const storedName = uid();
        await fsp.writeFile(path.join(STORAGE_DIR, storedName), buffer);
        db.items.push({
            id: storedName, type: "file", name: fileName, parentId: curParent, size: buffer.length,
            mimeType: "application/octet-stream", storedName,
            dateAdded: nowISO(), dateModified: nowISO(), trashed: false, trashedAt: null,
        });
        count++;
    }

    writeDB(db);
    return count;
}

app.post("/api/backup/import", importUpload.single("backup"), async (req, res) => {
    const parentId = req.body.parentId === "null" || !req.body.parentId ? null : req.body.parentId;
    if (!req.file) return res.status(400).json({ error: "no file" });

    try {
        const count = await importZipIntoVault(req.file.path, parentId);
        await fsp.unlink(req.file.path).catch(() => { });
        res.json({ ok: true, count });
    } catch (err) {
        console.error(err);
        await fsp.unlink(req.file.path).catch(() => { });
        res.status(500).json({ error: "Could not read that backup file" });
    }
});

// Re-download a backup that's already recorded in Backup history
app.get("/api/backup/download/:id", (req, res) => {
    try {
        const db = readDB();
        const backup = (db.backups || []).find((b) => b.id === req.params.id);
        if (!backup) return res.status(404).json({ error: "not found" });
        const p = path.join(BACKUPS_DIR, backup.name);
        if (!fs.existsSync(p)) return res.status(404).json({ error: "That backup file is no longer on disk" });
        res.download(p, backup.label ? `${backup.label}.zip` : backup.name);
    } catch (err) {
        console.error("Backup download error:", err);
        if (!res.headersSent) res.status(500).json({ error: "Could not download that backup" });
    }
});

// Restore a backup from history straight back into My Files
app.post("/api/backup/restore/:id", async (req, res) => {
    try {
        const parentId = req.body.parentId === "null" || !req.body.parentId ? null : req.body.parentId;
        const db = readDB();
        const backup = (db.backups || []).find((b) => b.id === req.params.id);
        if (!backup) return res.status(404).json({ error: "not found" });
        const zipPath = path.join(BACKUPS_DIR, backup.name);
        if (!fs.existsSync(zipPath)) return res.status(404).json({ error: "That backup file is no longer on disk" });

        const count = await importZipIntoVault(zipPath, parentId);
        res.json({ ok: true, count });
    } catch (err) {
        console.error("Backup restore error:", err);
        if (!res.headersSent) res.status(500).json({ error: "Could not restore that backup" });
    }
});

// Rename a backup's display label
app.patch("/api/backup/:id", (req, res) => {
    try {
        const db = readDB();
        const backup = (db.backups || []).find((b) => b.id === req.params.id);
        if (!backup) return res.status(404).json({ error: "not found" });
        backup.label = String(req.body.label || backup.label || backup.name).trim();
        writeDB(db);
        res.json(backup);
    } catch (err) {
        console.error("Backup rename error:", err);
        if (!res.headersSent) res.status(500).json({ error: "Could not rename that backup" });
    }
});

// Delete a backup entry and its zip file
app.delete("/api/backup/:id", async (req, res) => {
    try {
        const db = readDB();
        const idx = (db.backups || []).findIndex((b) => b.id === req.params.id);
        if (idx === -1) return res.status(404).json({ error: "not found" });
        const backup = db.backups[idx];
        const p = path.join(BACKUPS_DIR, backup.name);
        if (fs.existsSync(p)) await fsp.unlink(p).catch(() => { });
        db.backups.splice(idx, 1);
        writeDB(db);
        res.json({ ok: true });
    } catch (err) {
        console.error("Backup delete error:", err);
        if (!res.headersSent) res.status(500).json({ error: "Could not delete that backup" });
    }
});

/* ---------------- Fallback to SPA ---------------- */

app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// Surface upload errors (oversized files, bad fields, etc.) as clear JSON
// instead of a generic crash page.
app.use((err, req, res, next) => {
    if (err && err.name === "MulterError") {
        console.error("Upload error:", err);
        return res.status(400).json({ error: err.message });
    }
    next(err);
});

app.listen(PORT, () => {
    console.log(`\n  Safe Haven is running → http://localhost:${PORT}`);
    console.log(`  Files are stored in: ${STORAGE_DIR}`);
    console.log(`  Metadata is stored in: ${DB_FILE}\n`);
});