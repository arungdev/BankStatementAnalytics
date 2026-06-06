const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs-extra");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 4000;
const API_ROOT = "/api";

const DATA_FILE = path.join(__dirname, "data.json");
const UPLOAD_DIR = path.join(__dirname, "uploads");

fs.ensureDirSync(UPLOAD_DIR);

// Initialize data store if missing
if (!fs.existsSync(DATA_FILE)) {
  fs.writeJsonSync(
    DATA_FILE,
    {
      uploads: [],
      accounts: [
        { id: 1, accountNumber: "XXXXXXXX1234", bankName: "HDFC" },
        { id: 2, accountNumber: "XXXXXXXX5678", bankName: "ICICI" },
      ],
    },
    { spaces: 2 },
  );
}

function readData() {
  return fs.readJsonSync(DATA_FILE);
}
function writeData(data) {
  fs.writeJsonSync(DATA_FILE, data, { spaces: 2 });
}

app.use(cors());
app.use(express.json());
app.use(`${API_ROOT}/uploads`, express.static(UPLOAD_DIR));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const id = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, `${id}${ext}`);
  },
});
const upload = multer({ storage });

// GET accounts
app.get(`${API_ROOT}/statements/accounts`, (req, res) => {
  const data = readData();
  res.json(data.accounts);
});

// GET all uploads (history)
app.get(`${API_ROOT}/statements/uploads`, (req, res) => {
  const data = readData();
  res.json(data.uploads);
});

// Upload statement
app.post(`${API_ROOT}/statements/upload`, upload.single("file"), (req, res) => {
  try {
    const { accountId } = req.body;
    if (!req.file) return res.status(400).json({ message: "Missing file" });
    const data = readData();
    const entry = {
      id: uuidv4(),
      fileName: req.file.originalname,
      storedName: req.file.filename,
      accountId: accountId || null,
      path: `${API_ROOT}/uploads/${req.file.filename}`,
      time: Date.now(),
    };
    data.uploads.unshift(entry);
    writeData(data);
    res.json(entry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Upload failed" });
  }
});

// Revert (delete) uploaded statement
app.delete(`${API_ROOT}/statements/:id`, (req, res) => {
  try {
    const id = req.params.id;
    const data = readData();
    const idx = data.uploads.findIndex((u) => u.id === id);
    if (idx === -1) return res.status(404).json({ message: "Not found" });
    const entry = data.uploads[idx];
    // delete file
    const filePath = path.join(UPLOAD_DIR, entry.storedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    data.uploads.splice(idx, 1);
    writeData(data);
    res.json({ message: "Reverted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Revert failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
