require("dotenv").config();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const mongoose = require("mongoose");
const { GridFSBucket } = require("mongodb");
const session = require("express-session");
const bcrypt = require("bcrypt");

const app = express();

const statsSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  webViews: { type: Number, default: 0 },
  blogViews: { type: Number, default: 0 }
});

const Stats = mongoose.model("Stats", statsSchema);

// ====== BASIC CONFIG ======
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// statické súbory z /public
app.use(express.static(path.join(__dirname, "public")));

// ====== SESSION (bez localStorage) ======
app.use(
  session({
    secret: process.env.SESSION_SECRET || "marsab_secret_key_CHANGE_ME",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // na Renderi dáme true (HTTPS) + trust proxy
      maxAge: 1000 * 60 * 60 * 12, // 12h
    },
  })
);

// ====== DB ======
const AdminSchema = new mongoose.Schema(
  {
    email: { type: String, unique: true, required: true },
    passwordHash: { type: String, required: true },

    // reset hesla
    resetTokenHash: { type: String, default: null },
    resetTokenExp: { type: Date, default: null },
  },
  { timestamps: true }
);
const SettingsSchema = new mongoose.Schema({
  accountantEmail: { type: String, default: "" },
  emailTemplate: { type: String, default: "" },
}, { timestamps: true });

const BlogSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, default: "" },
  image: { type: String, default: "" },
}, { timestamps: true });

const Blog = mongoose.model("Blog", BlogSchema);

const Settings = mongoose.model("Settings", SettingsSchema);

const Admin = mongoose.model("Admin", AdminSchema);

async function ensureAdminExists() {
  const email = process.env.ADMIN_EMAIL;
  const initialPassword = process.env.ADMIN_PASSWORD;

  if (!email || !initialPassword) {
    console.log(
      "⚠️ ADMIN_EMAIL alebo ADMIN_PASSWORD nie je v .env. Admin sa nevytvoril automaticky."
    );
    return;
  }

  const existing = await Admin.findOne({ email });
  if (existing) return;

  const passwordHash = await bcrypt.hash(initialPassword, 12);
  await Admin.create({ email, passwordHash });

  console.log("✅ Admin účet vytvorený v DB:", email);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.admin === true) return next();
  return res.status(401).json({ ok: false, error: "Neprihlásený." });
}
// ====== MULTER (PDF upload do pamäte) ======
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // max 10MB
});
// ====== ZOZNAM DOKLADOV ======
app.get("/api/admin/docs", requireAuth, async (req, res) => {
  try {
    const month = Number(req.query.month);
    const year = Number(req.query.year);

    if (!month || !year) {
      return res.status(400).json({ ok: false, error: "Chýba mesiac alebo rok." });
    }

    const files = await mongoose.connection.db
      .collection("doklady.files")
      .find({
        "metadata.month": month,
        "metadata.year": year,
      })
      .sort({ uploadDate: -1 })
      .toArray();

    const result = files.map(f => ({
      id: String(f._id),
      filename: f.filename,
      title: f.metadata?.title || "",
      note: f.metadata?.note || "",
      uploadedAt: f.uploadDate,
    }));

    res.json({ ok: true, items: result });

  } catch (e) {
    console.error("LIST ERROR:", e);
    res.status(500).json({ ok: false, error: "Chyba servera." });
  }
});
// ====== ROUTES ======
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/auth/me", (req, res) => {
  if (req.session && req.session.admin === true) return res.json({ ok: true, admin: true });
  return res.json({ ok: true, admin: false });
});

// LOGIN
app.post("/api/auth/login", async (req, res) => {
  try {
    const password = String(req.body.password || "");
    if (!password) return res.status(400).json({ ok: false, error: "Chýba heslo." });

    const email = process.env.ADMIN_EMAIL;
    if (!email) return res.status(500).json({ ok: false, error: "Chýba ADMIN_EMAIL v .env." });

    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(500).json({ ok: false, error: "Admin účet neexistuje v DB." });

    const match = await bcrypt.compare(password, admin.passwordHash);
    if (!match) return res.status(401).json({ ok: false, error: "Zlé heslo." });

    req.session.admin = true;
    return res.json({ ok: true });
  } catch (e) {
    console.error("LOGIN ERROR:", e);
    return res.status(500).json({ ok: false, error: "Chyba servera." });
  }
});
app.post("/api/stats/:type", async (req, res) => {
  const type = req.params.type;

  const update = {};

  if (type === "web") update.$inc = { webViews: 1 };
  if (type === "blog") update.$inc = { blogViews: 1 };

  if (!update.$inc) return res.json({ ok: false });

  await Stats.findOneAndUpdate(
    { key: "global" },
    update,
    { upsert: true, returnDocument: "after" }
  );

  res.json({ ok: true });
});
app.get("/api/stats", async (req, res) => {
  const stats = await Stats.findOne({ key: "global" });
  res.json(stats || { webViews: 0, blogViews: 0 });
});

// LOGOUT
app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// REQUEST RESET (email link) — zatiaľ link vypíšeme do konzoly
app.post("/api/auth/request-reset", async (req, res) => {
  try {
    const email = process.env.ADMIN_EMAIL;
    if (!email) return res.status(500).json({ ok: false, error: "Chýba ADMIN_EMAIL v .env." });

    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(500).json({ ok: false, error: "Admin účet neexistuje v DB." });

    // token + hash do DB
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    admin.resetTokenHash = tokenHash;
    admin.resetTokenExp = new Date(Date.now() + 1000 * 60 * 15); // 15 min
    await admin.save();

    const baseUrl = process.env.BASE_URL || "http://localhost:3000";
    const link = `${baseUrl}/admin_reset.html?token=${token}`;

    console.log("🔐 RESET LINK (do mailu):", link);
    // neskôr sem doplníme reálne odoslanie emailu (nodemailer)

    return res.json({ ok: true, message: "Reset link bol vytvorený (pozri konzolu servera)." });
  } catch (e) {
    console.error("REQUEST RESET ERROR:", e);
    return res.status(500).json({ ok: false, error: "Chyba servera." });
  }
});

// RESET PASSWORD (token)
app.post("/api/auth/reset", async (req, res) => {
  try {
    const token = String(req.body.token || "");
    const newPassword = String(req.body.newPassword || "");

    if (!token || !newPassword) {
      return res.status(400).json({ ok: false, error: "Chýba token alebo nové heslo." });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ ok: false, error: "Heslo musí mať aspoň 6 znakov." });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const admin = await Admin.findOne({
      email: process.env.ADMIN_EMAIL,
      resetTokenHash: tokenHash,
      resetTokenExp: { $gt: new Date() },
    });

    if (!admin) {
      return res.status(400).json({ ok: false, error: "Neplatný alebo expirovaný link." });
    }

    admin.passwordHash = await bcrypt.hash(newPassword, 12);
    admin.resetTokenHash = null;
    admin.resetTokenExp = null;
    await admin.save();

    return res.json({ ok: true });
  } catch (e) {
    console.error("RESET ERROR:", e);
    return res.status(500).json({ ok: false, error: "Chyba servera." });
  }
});
app.post("/api/contact", async (req, res) => {
  try {
    const { email, message } = req.body;

    if (!email || !message) {
      return res.status(400).json({ error: "Chýbajú údaje" });
    }

    // 1️⃣ Mail tebe
    await sendMail({
      to: "info@marsab.sk",
      subject: "Nová správa z marsab.sk",
      text: `
Nová správa z formulára:

Od: ${email}

Správa:
${message}
      `
    });

    // 2️⃣ Automatická odpoveď zákazníkovi
    await sendMail({
  to: email,
  subject: "MarSab – správa prijatá",
  text: `
Dobrý deň,

ďakujeme za Vašu správu.
Odpovieme Vám čo najskôr.

Marcel Šabla
MarSab, s.r.o
info@marsab.sk
`,
  html: `
    <p>Dobrý deň,</p>
    <p>ďakujeme za Vašu správu.</p>
    <p><strong>Odpovieme Vám čo najskôr.</strong></p>
    <br>
    <p>Marcel Šabla<br>MarSab, s.r.o<br>info@marsab.sk</p>
  `
});

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Chyba pri odosielaní" });
  }
});
// príklad chráneného endpointu (neskôr použijeme pri admin API)
app.get("/api/admin/secret", requireAuth, (req, res) => {
  res.json({ ok: true, data: "tajné dáta" });
});
let gridFSBucket;
// ====== UPLOAD DOKLADU ======
app.post(
  "/api/admin/docs",
  requireAuth,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, error: "Chýba PDF súbor." });
      }

      const { month, year, title, note } = req.body;

      if (!month || !year) {
        return res.status(400).json({ ok: false, error: "Chýba mesiac alebo rok." });
      }

      const uploadStream = gridFSBucket.openUploadStream(req.file.originalname, {
        metadata: {
          month: Number(month),
          year: Number(year),
          title: title || "",
          note: note || "",
          uploadedAt: new Date(),
        },
        contentType: req.file.mimetype,
      });

      uploadStream.end(req.file.buffer);

      uploadStream.on("finish", () => {
        return res.json({ ok: true });
      });

      uploadStream.on("error", (err) => {
        console.error("GRIDFS UPLOAD ERROR:", err);
        return res.status(500).json({ ok: false, error: "Chyba pri ukladaní." });
      });
    } catch (e) {
      console.error("UPLOAD ERROR:", e);
      return res.status(500).json({ ok: false, error: "Chyba servera." });
    }
  }
);
const blogUpload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, "public/uploads/blog");
    },
    filename: function (req, file, cb) {
      const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, unique + path.extname(file.originalname));
    }
  }),
});
// ===== DOWNLOAD DOKLADU =====
app.get("/api/admin/docs/:id/download", requireAuth, async (req, res) => {
  try {
    const { ObjectId } = require("mongodb");

    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ ok: false, error: "Neplatné ID." });
    }

    const fileId = new ObjectId(req.params.id);

    const files = await mongoose.connection.db
      .collection("doklady.files")
      .find({ _id: fileId })
      .toArray();

    if (!files || files.length === 0) {
      return res.status(404).json({ ok: false, error: "Súbor nenájdený." });
    }

    const file = files[0];

    res.set("Content-Type", file.contentType || "application/pdf");
    res.set("Content-Disposition", `attachment; filename="${file.filename}"`);

    const downloadStream = gridFSBucket.openDownloadStream(fileId);
    downloadStream.pipe(res);

  } catch (e) {
    console.error("DOWNLOAD ERROR:", e);
    res.status(500).json({ ok: false, error: "Chyba servera." });
  }
});
// ===== DELETE DOKLADU =====
app.delete("/api/admin/docs/:id", requireAuth, async (req, res) => {
  try {
    const { ObjectId } = require("mongodb");

    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ ok: false, error: "Neplatné ID." });
    }

    const fileId = new ObjectId(req.params.id);

    await gridFSBucket.delete(fileId);

    res.json({ ok: true });

  } catch (e) {
    console.error("DELETE ERROR:", e);
    res.status(500).json({ ok: false, error: "Chyba pri mazaní." });
  }
});
const { sendMail } = require("./mailer");

// ===== TEST MAIL =====
app.get("/api/admin/test-mail", requireAuth, async (req, res) => {
  try {
    await sendMail({
      to: process.env.SMTP_USER,
      subject: "Test MarSab Mailer",
      text: "Ak toto čítaš, SMTP funguje.",
      html: "<h2>SMTP funguje ✅</h2><p>Toto je testovací e-mail z MarSab.</p>",
    });

    res.json({ ok: true, message: "Test mail odoslaný." });
  } catch (err) {
    console.error("MAIL ERROR:", err);
    res.status(500).json({ ok: false, error: "Nepodarilo sa odoslať mail." });
  }
});
// ===== SEND MONTH TO ACCOUNTANT =====
app.post("/api/admin/send-month", requireAuth, async (req, res) => {
  try {
    const { month, year } = req.body;

    if (!month || !year) {
      return res.status(400).json({ ok: false, error: "Chýba mesiac alebo rok." });
    }

    // 1️⃣ načítaj nastavenia z DB (ak zatiaľ nemáš model, pošleme na info@marsab.sk)
    const accountantEmail = process.env.SMTP_USER; // dočasne
    const emailTemplate = `Dobrý deň,\n\nv prílohe posielam doklady za ${month}/${year}.\n\nMarSab`;

    // 2️⃣ nájdi súbory
    const files = await mongoose.connection.db
      .collection("doklady.files")
      .find({
        "metadata.month": Number(month),
        "metadata.year": Number(year),
      })
      .toArray();

    if (!files.length) {
      return res.status(400).json({ ok: false, error: "Žiadne doklady pre tento mesiac." });
    }

    // 3️⃣ načítaj každý súbor ako buffer
    const attachments = [];

    for (const file of files) {
      const chunks = [];
      const downloadStream = gridFSBucket.openDownloadStream(file._id);

      await new Promise((resolve, reject) => {
        downloadStream.on("data", chunk => chunks.push(chunk));
        downloadStream.on("end", resolve);
        downloadStream.on("error", reject);
      });

      attachments.push({
        filename: file.filename,
        content: Buffer.concat(chunks),
        contentType: file.contentType || "application/pdf",
      });
    }

    // 4️⃣ pošli mail
    await sendMail({
      to: accountantEmail,
      bcc: process.env.SMTP_USER, // kópia tebe
      subject: `Doklady ${month}/${year}`,
      text: emailTemplate,
      html: `<p>${emailTemplate.replace(/\n/g, "<br>")}</p>`,
      attachments,
    });

    res.json({ ok: true });

  } catch (err) {
    console.error("SEND MONTH ERROR:", err);
    res.status(500).json({ ok: false, error: "Chyba pri odosielaní." });
  }
});
// ===== SETTINGS =====

// GET settings
app.get("/api/admin/settings", requireAuth, async (req, res) => {
  try {
    let settings = await Settings.findOne();

    if (!settings) {
      settings = await Settings.create({});
    }

    res.json({
      accountantEmail: settings.accountantEmail,
      emailTemplate: settings.emailTemplate,
    });

  } catch (e) {
    console.error("GET SETTINGS ERROR:", e);
    res.status(500).json({ ok: false });
  }
});

// PUT settings
app.put("/api/admin/settings", requireAuth, async (req, res) => {
  try {
    const { accountantEmail, emailTemplate } = req.body;

    let settings = await Settings.findOne();

    if (!settings) {
      settings = await Settings.create({});
    }

    settings.accountantEmail = accountantEmail || "";
    settings.emailTemplate = emailTemplate || "";

    await settings.save();

    res.json({ ok: true });

  } catch (e) {
    console.error("PUT SETTINGS ERROR:", e);
    res.status(500).json({ ok: false });
  }
});
// ===== BLOG =====

// create
app.post("/api/admin/blog", requireAuth, blogUpload.single("image"), async (req, res) => {
  try {
    const { title, content } = req.body;

    const blog = await Blog.create({
      title,
      content,
      image: req.file ? "/uploads/blog/" + req.file.filename : ""
    });

    res.json({ ok: true, blog });
  } catch (e) {
    console.error("BLOG CREATE ERROR:", e);
    res.status(500).json({ ok: false });
  }
});

// list
app.get("/api/blog", async (req, res) => {
  const blogs = await Blog.find().sort({ createdAt: -1 });
  res.json(blogs);
});

// delete
app.delete("/api/admin/blog/:id", requireAuth, async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) {
      return res.status(404).json({ ok: false, error: "Blog neexistuje." });
    }

    // ak má blog obrázok
    if (blog.image) {
      const imagePath = path.join(__dirname, "public", blog.image);

      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
        console.log("🗑 Obrázok zmazaný:", imagePath);
      }
    }

    await Blog.findByIdAndDelete(req.params.id);

    res.json({ ok: true });

  } catch (err) {
    console.error("DELETE BLOG ERROR:", err);
    res.status(500).json({ ok: false, error: "Chyba pri mazaní." });
  }
});
// ====== START ======
const PORT = process.env.PORT || 3000;

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB pripojené");

    // ===== GRIDFS INIT =====
    gridFSBucket = new GridFSBucket(mongoose.connection.db, {
      bucketName: "doklady",
    });
    console.log("📂 GridFS bucket pripravený (doklady)");

    await ensureAdminExists();

    app.listen(PORT, () =>
      console.log(`Server beží na http://localhost:${PORT}`)
    );
  })