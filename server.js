const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();

const PORT = process.env.PORT || 10000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// =========================================================
// Middleware
// =========================================================

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =========================================================
// Database
// =========================================================

async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        grade VARCHAR(50) NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("Users table is ready.");
  } catch (error) {
    console.error(
      "Database initialization failed:",
      error.message
    );
  }
}

// =========================================================
// JWT helpers
// =========================================================

function createUserToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: "user"
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d"
    }
  );
}

function createAdminToken() {
  return jwt.sign(
    {
      role: "admin"
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d"
    }
  );
}

// =========================================================
// Admin authentication middleware
// =========================================================

function requireAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "غير مصرح بالوصول."
      });
    }

    const token = authHeader.substring(7);

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    if (decoded.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "صلاحيات المدير مطلوبة."
      });
    }

    req.admin = decoded;

    next();

  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "جلسة المدير غير صالحة أو منتهية."
    });
  }
}

// =========================================================
// Health Check
// =========================================================

app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.json({
      success: true,
      message: "DrNotes API is working 🚀",
      database: "connected",
      time: result.rows[0].now
    });

  } catch (error) {

    console.error("Health error:", error);

    res.status(500).json({
      success: false,
      message: "Database connection failed"
    });
  }
});

// =========================================================
// Register
// =========================================================

app.post("/api/auth/register", async (req, res) => {
  try {

    const {
      name,
      email,
      grade,
      password
    } = req.body;

    if (!name || !email || !grade || !password) {
      return res.status(400).json({
        success: false,
        message: "جميع البيانات مطلوبة."
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message:
          "كلمة المرور يجب أن تكون 6 أحرف على الأقل."
      });
    }

    const normalizedEmail =
      email.trim().toLowerCase();

    const existingUser = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message:
          "هذا البريد الإلكتروني مستخدم بالفعل."
      });
    }

    const passwordHash =
      await bcrypt.hash(password, 12);

    const result = await pool.query(
      `
      INSERT INTO users
      (name, email, grade, password_hash)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, email, grade, created_at
      `,
      [
        name.trim(),
        normalizedEmail,
        grade,
        passwordHash
      ]
    );

    const user = result.rows[0];

    const token = createUserToken(user);

    res.status(201).json({
      success: true,
      message: "تم إنشاء الحساب بنجاح.",
      token,
      user
    });

  } catch (error) {

    console.error(
      "Register error:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "حدث خطأ أثناء إنشاء الحساب."
    });
  }
});

// =========================================================
// Login
// =========================================================

app.post("/api/auth/login", async (req, res) => {
  try {

    const {
      email,
      password
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message:
          "البريد الإلكتروني وكلمة المرور مطلوبان."
      });
    }

    const normalizedEmail =
      email.trim().toLowerCase();

    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message:
          "البريد الإلكتروني أو كلمة المرور غير صحيحة."
      });
    }

    const user = result.rows[0];

    const passwordMatch =
      await bcrypt.compare(
        password,
        user.password_hash
      );

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message:
          "البريد الإلكتروني أو كلمة المرور غير صحيحة."
      });
    }

    const token = createUserToken(user);

    res.json({
      success: true,
      message:
        "تم تسجيل الدخول بنجاح.",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        grade: user.grade,
        created_at: user.created_at
      }
    });

  } catch (error) {

    console.error(
      "Login error:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "حدث خطأ أثناء تسجيل الدخول."
    });
  }
});

// =========================================================
// ADMIN LOGIN
// =========================================================

app.post("/api/admin/login", async (req, res) => {
  try {

    const {
      email,
      password
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message:
          "البريد الإلكتروني وكلمة المرور مطلوبان."
      });
    }

    const adminEmail =
      process.env.ADMIN_EMAIL;

    const adminPassword =
      process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      console.error(
        "ADMIN_EMAIL or ADMIN_PASSWORD is missing."
      );

      return res.status(500).json({
        success: false,
        message:
          "إعدادات المدير غير مكتملة على الخادم."
      });
    }

    if (
      email.trim().toLowerCase() !==
      adminEmail.trim().toLowerCase()
    ) {
      return res.status(401).json({
        success: false,
        message:
          "بيانات المدير غير صحيحة."
      });
    }

    if (password !== adminPassword) {
      return res.status(401).json({
        success: false,
        message:
          "بيانات المدير غير صحيحة."
      });
    }

    const token = createAdminToken();

    res.json({
      success: true,
      message:
        "تم تسجيل دخول المدير بنجاح.",
      token
    });

  } catch (error) {

    console.error(
      "Admin login error:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "حدث خطأ أثناء تسجيل دخول المدير."
    });
  }
});

// =========================================================
// ADMIN - GET USERS
// =========================================================

app.get(
  "/api/admin/users",
  requireAdmin,
  async (req, res) => {

    try {

      const result = await pool.query(`
        SELECT
          id,
          name,
          email,
          grade,
          created_at
        FROM users
        ORDER BY created_at DESC
      `);

      res.json({
        success: true,
        users: result.rows
      });

    } catch (error) {

      console.error(
        "Get users error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر تحميل المستخدمين."
      });
    }
  }
);

// =========================================================
// ADMIN - GET USERS COUNT
// =========================================================

app.get(
  "/api/admin/users/count",
  requireAdmin,
  async (req, res) => {

    try {

      const result = await pool.query(
        "SELECT COUNT(*)::int AS count FROM users"
      );

      res.json({
        success: true,
        count: result.rows[0].count
      });

    } catch (error) {

      console.error(
        "Users count error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر الحصول على عدد المستخدمين."
      });
    }
  }
);

// =========================================================
// ADMIN - RESET USER PASSWORD
// =========================================================

app.post(
  "/api/admin/users/:id/reset-password",
  requireAdmin,
  async (req, res) => {

    try {

      const userId =
        Number(req.params.id);

      const {
        newPassword
      } = req.body;

      if (!Number.isInteger(userId)) {
        return res.status(400).json({
          success: false,
          message:
            "معرف المستخدم غير صحيح."
        });
      }

      if (
        !newPassword ||
        newPassword.length < 6
      ) {
        return res.status(400).json({
          success: false,
          message:
            "كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل."
        });
      }

      const passwordHash =
        await bcrypt.hash(
          newPassword,
          12
        );

      const result = await pool.query(
        `
        UPDATE users
        SET password_hash = $1
        WHERE id = $2
        RETURNING id, name, email
        `,
        [
          passwordHash,
          userId
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message:
            "المستخدم غير موجود."
        });
      }

      res.json({
        success: true,
        message:
          "تم تغيير كلمة مرور المستخدم بنجاح.",
        user: result.rows[0]
      });

    } catch (error) {

      console.error(
        "Reset password error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر تغيير كلمة المرور."
      });
    }
  }
);

// =========================================================
// ADMIN - DELETE USER
// =========================================================

app.delete(
  "/api/admin/users/:id",
  requireAdmin,
  async (req, res) => {

    try {

      const userId =
        Number(req.params.id);

      if (!Number.isInteger(userId)) {
        return res.status(400).json({
          success: false,
          message:
            "معرف المستخدم غير صحيح."
        });
      }

      const result = await pool.query(
        `
        DELETE FROM users
        WHERE id = $1
        RETURNING id, name, email
        `,
        [userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message:
            "المستخدم غير موجود."
        });
      }

      res.json({
        success: true,
        message:
          "تم حذف المستخدم بنجاح.",
        user: result.rows[0]
      });

    } catch (error) {

      console.error(
        "Delete user error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر حذف المستخدم."
      });
    }
  }
);

// =========================================================
// Static Website
// =========================================================

app.use(
  express.static(
    path.join(__dirname)
  )
);

app.get("/", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "index.html"
    )
  );
});

// =========================================================
// Start Server
// =========================================================

app.listen(
  PORT,
  "0.0.0.0",
  async () => {

    console.log(
      `DrNotes server running on port ${PORT}`
    );

    await initializeDatabase();
  }
);
