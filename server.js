const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();

const PORT = process.env.PORT || 10000;

// =========================================================
// DATABASE
// =========================================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// =========================================================
// MIDDLEWARE
// =========================================================

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =========================================================
// DATABASE INITIALIZATION
// =========================================================

async function initializeDatabase() {
  try {

    // -----------------------------------------------------
    // USERS
    // -----------------------------------------------------

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

    // -----------------------------------------------------
    // SUBJECTS
    // -----------------------------------------------------

    await pool.query(`
      CREATE TABLE IF NOT EXISTS subjects (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        description TEXT,
        image_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // -----------------------------------------------------
    // UNITS
    // -----------------------------------------------------

    await pool.query(`
      CREATE TABLE IF NOT EXISTS units (
        id SERIAL PRIMARY KEY,
        subject_id INTEGER NOT NULL
          REFERENCES subjects(id)
          ON DELETE CASCADE,
        name VARCHAR(150) NOT NULL,
        description TEXT,
        unit_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // -----------------------------------------------------
    // LESSONS
    // -----------------------------------------------------

    await pool.query(`
      CREATE TABLE IF NOT EXISTS lessons (
        id SERIAL PRIMARY KEY,
        unit_id INTEGER NOT NULL
          REFERENCES units(id)
          ON DELETE CASCADE,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        lesson_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // -----------------------------------------------------
    // LESSON CONTENT
    // شرح الدرس
    // -----------------------------------------------------

    await pool.query(`
      CREATE TABLE IF NOT EXISTS lesson_content (
        id SERIAL PRIMARY KEY,

        lesson_id INTEGER UNIQUE NOT NULL
          REFERENCES lessons(id)
          ON DELETE CASCADE,

        video_url TEXT,
        pdf_url TEXT,
        explanation TEXT,

        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // -----------------------------------------------------
    // LESSON SOLUTION
    // حل الدرس
    // فيديو + PDF
    // -----------------------------------------------------

    await pool.query(`
      CREATE TABLE IF NOT EXISTS lesson_solution (
        id SERIAL PRIMARY KEY,

        lesson_id INTEGER UNIQUE NOT NULL
          REFERENCES lessons(id)
          ON DELETE CASCADE,

        video_url TEXT,
        pdf_url TEXT,
        explanation TEXT,

        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // -----------------------------------------------------
    // QUIZZES
    // -----------------------------------------------------

    await pool.query(`
      CREATE TABLE IF NOT EXISTS quizzes (
        id SERIAL PRIMARY KEY,

        lesson_id INTEGER UNIQUE NOT NULL
          REFERENCES lessons(id)
          ON DELETE CASCADE,

        title VARCHAR(200) NOT NULL,

        description TEXT,

        passing_percentage INTEGER DEFAULT 50,

        questions_per_page INTEGER DEFAULT 10,

        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // -----------------------------------------------------
    // QUIZ QUESTIONS
    // -----------------------------------------------------

    await pool.query(`
      CREATE TABLE IF NOT EXISTS quiz_questions (
        id SERIAL PRIMARY KEY,

        quiz_id INTEGER NOT NULL
          REFERENCES quizzes(id)
          ON DELETE CASCADE,

        question_text TEXT NOT NULL,

        option_a TEXT NOT NULL,
        option_b TEXT NOT NULL,
        option_c TEXT NOT NULL,
        option_d TEXT NOT NULL,

        correct_answer VARCHAR(1) NOT NULL
          CHECK (
            correct_answer IN ('A', 'B', 'C', 'D')
          ),

        explanation TEXT,

        question_order INTEGER DEFAULT 0,

        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // -----------------------------------------------------
    // QUIZ ATTEMPTS
    // -----------------------------------------------------

    await pool.query(`
      CREATE TABLE IF NOT EXISTS quiz_attempts (
        id SERIAL PRIMARY KEY,

        user_id INTEGER NOT NULL
          REFERENCES users(id)
          ON DELETE CASCADE,

        quiz_id INTEGER NOT NULL
          REFERENCES quizzes(id)
          ON DELETE CASCADE,

        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

        finished_at TIMESTAMP,

        score INTEGER,

        total_questions INTEGER,

        percentage NUMERIC(5,2),

        passed BOOLEAN,

        status VARCHAR(20) DEFAULT 'started'
          CHECK (
            status IN (
              'started',
              'finished',
              'abandoned'
            )
          ),

        UNIQUE(user_id, quiz_id)
      );
    `);

    // -----------------------------------------------------
    // QUIZ ANSWERS
    // -----------------------------------------------------

    await pool.query(`
      CREATE TABLE IF NOT EXISTS quiz_answers (
        id SERIAL PRIMARY KEY,

        attempt_id INTEGER NOT NULL
          REFERENCES quiz_attempts(id)
          ON DELETE CASCADE,

        question_id INTEGER NOT NULL
          REFERENCES quiz_questions(id)
          ON DELETE CASCADE,

        selected_answer VARCHAR(1),

        is_correct BOOLEAN,

        answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

        UNIQUE(attempt_id, question_id)
      );
    `);

    console.log("Database tables are ready.");

  } catch (error) {

    console.error(
      "Database initialization failed:",
      error.message
    );

  }
}

// =========================================================
// JWT
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
// ADMIN AUTHENTICATION
// =========================================================

function requireAdmin(req, res, next) {

  try {

    const authHeader =
      req.headers.authorization;

    if (
      !authHeader ||
      !authHeader.startsWith("Bearer ")
    ) {

      return res.status(401).json({
        success: false,
        message: "غير مصرح بالوصول."
      });

    }

    const token =
      authHeader.substring(7);

    const decoded =
      jwt.verify(
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
      message:
        "جلسة المدير غير صالحة أو منتهية."
    });

  }

}

// =========================================================
// USER AUTHENTICATION
// =========================================================

function requireUser(req, res, next) {

  try {

    const authHeader =
      req.headers.authorization;

    if (
      !authHeader ||
      !authHeader.startsWith("Bearer ")
    ) {

      return res.status(401).json({
        success: false,
        message:
          "يجب تسجيل الدخول أولًا."
      });

    }

    const token =
      authHeader.substring(7);

    const decoded =
      jwt.verify(
        token,
        process.env.JWT_SECRET
      );

    if (decoded.role !== "user") {

      return res.status(403).json({
        success: false,
        message:
          "صلاحيات الطالب مطلوبة."
      });

    }

    req.user = decoded;

    next();

  } catch (error) {

    return res.status(401).json({
      success: false,
      message:
        "جلسة تسجيل الدخول غير صالحة أو منتهية."
    });

  }

}

// =========================================================
// HEALTH
// =========================================================

app.get(
  "/api/health",
  async (req, res) => {

    try {

      const result =
        await pool.query(
          "SELECT NOW()"
        );

      res.json({

        success: true,

        message:
          "DrNotes API is working 🚀",

        database:
          "connected",

        time:
          result.rows[0].now

      });

    } catch (error) {

      console.error(
        "Health error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "Database connection failed"

      });

    }

  }
);

// =========================================================
// REGISTER
// =========================================================

app.post(
  "/api/auth/register",
  async (req, res) => {

    try {

      const {
        name,
        email,
        grade,
        password
      } = req.body;

      if (
        !name ||
        !email ||
        !grade ||
        !password
      ) {

        return res.status(400).json({

          success: false,

          message:
            "جميع البيانات مطلوبة."

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

      const existingUser =
        await pool.query(
          "SELECT id FROM users WHERE email = $1",
          [normalizedEmail]
        );

      if (
        existingUser.rows.length > 0
      ) {

        return res.status(409).json({

          success: false,

          message:
            "هذا البريد الإلكتروني مستخدم بالفعل."

        });

      }

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      const result =
        await pool.query(
          `
          INSERT INTO users
          (
            name,
            email,
            grade,
            password_hash
          )
          VALUES ($1, $2, $3, $4)

          RETURNING
            id,
            name,
            email,
            grade,
            created_at
          `,
          [
            name.trim(),
            normalizedEmail,
            grade,
            passwordHash
          ]
        );

      const user =
        result.rows[0];

      const token =
        createUserToken(user);

      res.status(201).json({

        success: true,

        message:
          "تم إنشاء الحساب بنجاح.",

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

  }
);

// =========================================================
// USER LOGIN
// =========================================================

app.post(
  "/api/auth/login",
  async (req, res) => {

    try {

      const {
        email,
        password
      } = req.body;

      if (
        !email ||
        !password
      ) {

        return res.status(400).json({

          success: false,

          message:
            "البريد الإلكتروني وكلمة المرور مطلوبان."

        });

      }

      const normalizedEmail =
        email.trim().toLowerCase();

      const result =
        await pool.query(
          "SELECT * FROM users WHERE email = $1",
          [normalizedEmail]
        );

      if (
        result.rows.length === 0
      ) {

        return res.status(401).json({

          success: false,

          message:
            "البريد الإلكتروني أو كلمة المرور غير صحيحة."

        });

      }

      const user =
        result.rows[0];

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

      const token =
        createUserToken(user);

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

          created_at:
            user.created_at

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

  }
);

// =========================================================
// CURRENT USER
// =========================================================

app.get(
  "/api/auth/me",
  requireUser,
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT
            id,
            name,
            email,
            grade,
            created_at
          FROM users
          WHERE id = $1
          `,
          [req.user.id]
        );

      if (
        result.rows.length === 0
      ) {

        return res.status(404).json({

          success: false,

          message:
            "المستخدم غير موجود."

        });

      }

      res.json({

        success: true,

        user:
          result.rows[0]

      });

    } catch (error) {

      console.error(
        "Current user error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "تعذر التحقق من الحساب."

      });

    }

  }
);

// =========================================================
// ADMIN LOGIN
// =========================================================

app.post(
  "/api/admin/login",
  async (req, res) => {

    try {

      const {
        email,
        password
      } = req.body;

      if (
        !email ||
        !password
      ) {

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

      if (
        !adminEmail ||
        !adminPassword
      ) {

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

      if (
        password !== adminPassword
      ) {

        return res.status(401).json({

          success: false,

          message:
            "بيانات المدير غير صحيحة."

        });

      }

      const token =
        createAdminToken();

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

  }
);

// =========================================================
// ADMIN - GET USERS
// =========================================================

app.get(
  "/api/admin/users",
  requireAdmin,
  async (req, res) => {

    try {

      const result =
        await pool.query(`
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

        users:
          result.rows

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
// ADMIN - USERS COUNT
// =========================================================

app.get(
  "/api/admin/users/count",
  requireAdmin,
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT
            COUNT(*)::int AS count
          FROM users
          `
        );

      res.json({

        success: true,

        count:
          result.rows[0].count

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
// ADMIN - RESET PASSWORD
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

      if (
        !Number.isInteger(userId)
      ) {

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

      const result =
        await pool.query(
          `
          UPDATE users
          SET password_hash = $1
          WHERE id = $2
          RETURNING
            id,
            name,
            email
          `,
          [
            passwordHash,
            userId
          ]
        );

      if (
        result.rows.length === 0
      ) {

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

        user:
          result.rows[0]

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

      if (
        !Number.isInteger(userId)
      ) {

        return res.status(400).json({

          success: false,

          message:
            "معرف المستخدم غير صحيح."

        });

      }

      const result =
        await pool.query(
          `
          DELETE FROM users
          WHERE id = $1
          RETURNING
            id,
            name,
            email
          `,
          [userId]
        );

      if (
        result.rows.length === 0
      ) {

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

        user:
          result.rows[0]

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
// SUBJECTS
// =========================================================

app.get(
  "/api/subjects",
  async (req, res) => {

    try {

      const result =
        await pool.query(`
          SELECT
            id,
            name,
            description,
            image_url,
            created_at
          FROM subjects
          ORDER BY id ASC
        `);

      res.json({

        success: true,

        subjects:
          result.rows

      });

    } catch (error) {

      console.error(
        "Get subjects error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "تعذر تحميل المواد."

      });

    }

  }
);

// =========================================================
// ADMIN - ADD SUBJECT
// =========================================================

app.post(
  "/api/admin/subjects",
  requireAdmin,
  async (req, res) => {

    try {

      const {
        name,
        description,
        image_url
      } = req.body;

      if (!name) {

        return res.status(400).json({

          success: false,

          message:
            "اسم المادة مطلوب."

        });

      }

      const result =
        await pool.query(
          `
          INSERT INTO subjects
          (
            name,
            description,
            image_url
          )
          VALUES ($1, $2, $3)
          RETURNING *
          `,
          [
            name.trim(),
            description || null,
            image_url || null
          ]
        );

      res.status(201).json({

        success: true,

        subject:
          result.rows[0]

      });

    } catch (error) {

      console.error(
        "Create subject error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "تعذر إنشاء المادة."

      });

    }

  }
);

// =========================================================
// UNITS
// =========================================================

app.get(
  "/api/subjects/:subjectId/units",
  async (req, res) => {

    try {

      const subjectId =
        Number(req.params.subjectId);

      const result =
        await pool.query(
          `
          SELECT
            id,
            subject_id,
            name,
            description,
            unit_order,
            created_at
          FROM units
          WHERE subject_id = $1
          ORDER BY unit_order ASC, id ASC
          `,
          [subjectId]
        );

      res.json({

        success: true,

        units:
          result.rows

      });

    } catch (error) {

      console.error(
        "Get units error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "تعذر تحميل الوحدات."

      });

    }

  }
);

// =========================================================
// ADMIN - ADD UNIT
// =========================================================

app.post(
  "/api/admin/units",
  requireAdmin,
  async (req, res) => {

    try {

      const {
        subject_id,
        name,
        description,
        unit_order
      } = req.body;

      if (
        !subject_id ||
        !name
      ) {

        return res.status(400).json({

          success: false,

          message:
            "المادة واسم الوحدة مطلوبان."

        });

      }

      const result =
        await pool.query(
          `
          INSERT INTO units
          (
            subject_id,
            name,
            description,
            unit_order
          )
          VALUES ($1, $2, $3, $4)
          RETURNING *
          `,
          [
            subject_id,
            name.trim(),
            description || null,
            Number(unit_order) || 0
          ]
        );

      res.status(201).json({

        success: true,

        unit:
          result.rows[0]

      });

    } catch (error) {

      console.error(
        "Create unit error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "تعذر إنشاء الوحدة."

      });

    }

  }
);

// =========================================================
// LESSONS
// =========================================================

app.get(
  "/api/units/:unitId/lessons",
  async (req, res) => {

    try {

      const unitId =
        Number(req.params.unitId);

      const result =
        await pool.query(
          `
          SELECT
            id,
            unit_id,
            name,
            description,
            lesson_order,
            created_at
          FROM lessons
          WHERE unit_id = $1
          ORDER BY lesson_order ASC, id ASC
          `,
          [unitId]
        );

      res.json({

        success: true,

        lessons:
          result.rows

      });

    } catch (error) {

      console.error(
        "Get lessons error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "تعذر تحميل الدروس."

      });

    }

  }
);

// =========================================================
// ADMIN - ADD LESSON
// =========================================================

app.post(
  "/api/admin/lessons",
  requireAdmin,
  async (req, res) => {

    try {

      const {
        unit_id,
        name,
        description,
        lesson_order
      } = req.body;

      if (
        !unit_id ||
        !name
      ) {

        return res.status(400).json({

          success: false,

          message:
            "الوحدة واسم الدرس مطلوبان."

        });

      }

      const result =
        await pool.query(
          `
          INSERT INTO lessons
          (
            unit_id,
            name,
            description,
            lesson_order
          )
          VALUES ($1, $2, $3, $4)
          RETURNING *
          `,
          [
            unit_id,
            name.trim(),
            description || null,
            Number(lesson_order) || 0
          ]
        );

      res.status(201).json({

        success: true,

        lesson:
          result.rows[0]

      });

    } catch (error) {

      console.error(
        "Create lesson error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "تعذر إنشاء الدرس."

      });

    }

  }
);

// =========================================================
// GET COMPLETE LESSON
// =========================================================

app.get(
  "/api/lessons/:lessonId",
  async (req, res) => {

    try {

      const lessonId =
        Number(req.params.lessonId);

      const lessonResult =
        await pool.query(
          `
          SELECT
            l.id,
            l.unit_id,
            l.name,
            l.description,
            l.lesson_order,

            lc.video_url AS explanation_video_url,
            lc.pdf_url AS explanation_pdf_url,
            lc.explanation AS explanation_text,

            ls.video_url AS solution_video_url,
            ls.pdf_url AS solution_pdf_url,
            ls.explanation AS solution_text

          FROM lessons l

          LEFT JOIN lesson_content lc
            ON lc.lesson_id = l.id

          LEFT JOIN lesson_solution ls
            ON ls.lesson_id = l.id

          WHERE l.id = $1
          `,
          [lessonId]
        );

      if (
        lessonResult.rows.length === 0
      ) {

        return res.status(404).json({

          success: false,

          message:
            "الدرس غير موجود."

        });

      }

      const quizResult =
        await pool.query(
          `
          SELECT
            id,
            title,
            description,
            passing_percentage,
            questions_per_page
          FROM quizzes
          WHERE lesson_id = $1
          `,
          [lessonId]
        );

      res.json({

        success: true,

        lesson:
          lessonResult.rows[0],

        quiz:
          quizResult.rows[0] || null

      });

    } catch (error) {

      console.error(
        "Get lesson error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "تعذر تحميل الدرس."

      });

    }

  }
);

// =========================================================
// ADMIN - SAVE LESSON CONTENT
// شرح الدرس
// =========================================================

app.post(
  "/api/admin/lessons/:lessonId/content",
  requireAdmin,
  async (req, res) => {

    try {

      const lessonId =
        Number(req.params.lessonId);

      if (!Number.isInteger(lessonId)) {

        return res.status(400).json({

          success: false,

          message:
            "معرف الدرس غير صحيح."

        });

      }

      const {
        video_url,
        pdf_url,
        explanation
      } = req.body;

      const result =
        await pool.query(
          `
          INSERT INTO lesson_content
          (
            lesson_id,
            video_url,
            pdf_url,
            explanation
          )
          VALUES ($1, $2, $3, $4)

          ON CONFLICT (lesson_id)

          DO UPDATE SET
            video_url = EXCLUDED.video_url,
            pdf_url = EXCLUDED.pdf_url,
            explanation = EXCLUDED.explanation,
            updated_at = CURRENT_TIMESTAMP

          RETURNING *
          `,
          [
            lessonId,
            video_url || null,
            pdf_url || null,
            explanation || null
          ]
        );

      res.json({

        success: true,

        message:
          "تم حفظ شرح الدرس بنجاح.",

        content:
          result.rows[0]

      });

    } catch (error) {

      console.error(
        "Lesson content error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "تعذر حفظ محتوى الدرس."

      });

    }

  }
);

// =========================================================
// ADMIN - SAVE LESSON SOLUTION
// حل الدرس: فيديو + PDF
// =========================================================

app.post(
  "/api/admin/lessons/:lessonId/solution",
  requireAdmin,
  async (req, res) => {

    try {

      const lessonId =
        Number(req.params.lessonId);

      if (!Number.isInteger(lessonId)) {

        return res.status(400).json({

          success: false,

          message:
            "معرف الدرس غير صحيح."

        });

      }

      const {
        video_url,
        pdf_url,
        explanation
      } = req.body;

      const result =
        await pool.query(
          `
          INSERT INTO lesson_solution
          (
            lesson_id,
            video_url,
            pdf_url,
            explanation
          )

          VALUES ($1, $2, $3, $4)

          ON CONFLICT (lesson_id)

          DO UPDATE SET
            video_url = EXCLUDED.video_url,
            pdf_url = EXCLUDED.pdf_url,
            explanation = EXCLUDED.explanation,
            updated_at = CURRENT_TIMESTAMP

          RETURNING *
          `,
          [
            lessonId,
            video_url || null,
            pdf_url || null,
            explanation || null
          ]
        );

      res.json({

        success: true,

        message:
          "تم حفظ حل الدرس بنجاح.",

        solution:
          result.rows[0]

      });

    } catch (error) {

      console.error(
        "Lesson solution error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "تعذر حفظ حل الدرس."

      });

    }

  }
);

// =========================================================
// ADMIN - GET LESSON CONTENT
// =========================================================

app.get(
  "/api/admin/lessons/:lessonId/content",
  requireAdmin,
  async (req, res) => {

    try {

      const lessonId =
        Number(req.params.lessonId);

      const result =
        await pool.query(
          `
          SELECT
            l.id,
            l.name,

            lc.video_url AS explanation_video_url,
            lc.pdf_url AS explanation_pdf_url,
            lc.explanation AS explanation_text,

            ls.video_url AS solution_video_url,
            ls.pdf_url AS solution_pdf_url,
            ls.explanation AS solution_text

          FROM lessons l

          LEFT JOIN lesson_content lc
            ON lc.lesson_id = l.id

          LEFT JOIN lesson_solution ls
            ON ls.lesson_id = l.id

          WHERE l.id = $1
          `,
          [lessonId]
        );

      if (result.rows.length === 0) {

        return res.status(404).json({

          success: false,

          message:
            "الدرس غير موجود."

        });

      }

      res.json({

        success: true,

        content:
          result.rows[0]

      });

    } catch (error) {

      console.error(
        "Get admin lesson content error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "تعذر تحميل محتوى الدرس."

      });

    }

  }
);

// =========================================================
// ADMIN - CREATE / UPDATE QUIZ
// =========================================================

app.post(
  "/api/admin/quizzes",
  requireAdmin,
  async (req, res) => {

    try {

      const {
        lesson_id,
        title,
        description,
        passing_percentage,
        questions_per_page
      } = req.body;

      if (
        !lesson_id ||
        !title
      ) {

        return res.status(400).json({

          success: false,

          message:
            "الدرس واسم الاختبار مطلوبان."

        });

      }

      const passing =
        Number(passing_percentage) || 50;

      const perPage =
        Number(questions_per_page) || 10;

      const result =
        await pool.query(
          `
          INSERT INTO quizzes
          (
            lesson_id,
            title,
            description,
            passing_percentage,
            questions_per_page
          )
          VALUES ($1, $2, $3, $4, $5)

          ON CONFLICT (lesson_id)

          DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            passing_percentage =
              EXCLUDED.passing_percentage,
            questions_per_page =
              EXCLUDED.questions_per_page

          RETURNING *
          `,
          [
            lesson_id,
            title.trim(),
            description || null,
            passing,
            perPage
          ]
        );

      res.status(201).json({

        success: true,

        message:
          "تم إنشاء أو تحديث الاختبار بنجاح.",

        quiz:
          result.rows[0]

      });

    } catch (error) {

      console.error(
        "Create quiz error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "تعذر إنشاء الاختبار."

      });

    }

  }
);

// =========================================================
// ADMIN - ADD QUESTION
// =========================================================

app.post(
  "/api/admin/quizzes/:quizId/questions",
  requireAdmin,
  async (req, res) => {

    try {

      const quizId =
        Number(req.params.quizId);

      const {
        question_text,
        option_a,
        option_b,
        option_c,
        option_d,
        correct_answer,
        explanation,
        question_order
      } = req.body;

      const correct =
        String(correct_answer || "")
          .toUpperCase();

      if (
        !question_text ||
        !option_a ||
        !option_b ||
        !option_c ||
        !option_d ||
        !["A", "B", "C", "D"].includes(correct)
      ) {

        return res.status(400).json({

          success: false,

          message:
            "بيانات السؤال غير مكتملة."

        });

      }

      const result =
        await pool.query(
          `
          INSERT INTO quiz_questions
          (
            quiz_id,
            question_text,
            option_a,
            option_b,
            option_c,
            option_d,
            correct_answer,
            explanation,
            question_order
          )
          VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9)

          RETURNING *
          `,
          [
            quizId,
            question_text,
            option_a,
            option_b,
            option_c,
            option_d,
            correct,
            explanation || null,
            Number(question_order) || 0
          ]
        );

      res.status(201).json({

        success: true,

        message:
          "تمت إضافة السؤال بنجاح.",

        question:
          result.rows[0]

      });

    } catch (error) {

      console.error(
        "Create question error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "تعذر إضافة السؤال."

      });

    }

  }
);

// =========================================================
// START QUIZ
// =========================================================

app.post(
  "/api/quizzes/:quizId/start",
  requireUser,
  async (req, res) => {

    const client =
      await pool.connect();

    try {

      const quizId =
        Number(req.params.quizId);

      if (!Number.isInteger(quizId)) {

        return res.status(400).json({

          success: false,

          message:
            "معرف الاختبار غير صحيح."

        });

      }

      await client.query("BEGIN");

      const quizResult =
        await client.query(
          `
          SELECT
            id,
            title,
            description,
            passing_percentage,
            questions_per_page
          FROM quizzes
          WHERE id = $1
          `,
          [quizId]
        );

      if (
        quizResult.rows.length === 0
      ) {

        await client.query("ROLLBACK");

        return res.status(404).json({

          success: false,

          message:
            "الاختبار غير موجود."

        });

      }

      // -----------------------------------------------------
      // محاولة واحدة فقط
      // -----------------------------------------------------

      const existingAttempt =
        await client.query(
          `
          SELECT *
          FROM quiz_attempts
          WHERE user_id = $1
          AND quiz_id = $2
          `,
          [
            req.user.id,
            quizId
          ]
        );

      if (
        existingAttempt.rows.length > 0
      ) {

        await client.query("ROLLBACK");

        const attempt =
          existingAttempt.rows[0];

        return res.status(409).json({

          success: false,

          already_attempted: true,

          message:
            "لقد بدأت أو أنهيت هذا الاختبار من قبل، ولا يمكن فتحه مرة أخرى.",

          attempt: {

            id:
              attempt.id,

            status:
              attempt.status,

            score:
              attempt.score,

            total_questions:
              attempt.total_questions,

            percentage:
              attempt.percentage,

            passed:
              attempt.passed

          }

        });

      }

      const questionsResult =
        await client.query(
          `
          SELECT
            id,
            question_text,
            option_a,
            option_b,
            option_c,
            option_d,
            question_order

          FROM quiz_questions

          WHERE quiz_id = $1

          ORDER BY question_order ASC, id ASC
          `,
          [quizId]
        );

      if (
        questionsResult.rows.length === 0
      ) {

        await client.query("ROLLBACK");

        return res.status(400).json({

          success: false,

          message:
            "لا توجد أسئلة في هذا الاختبار."

        });

      }

      const attemptResult =
        await client.query(
          `
          INSERT INTO quiz_attempts
          (
            user_id,
            quiz_id,
            total_questions,
            status
          )

          VALUES
          ($1, $2, $3, 'started')

          RETURNING *
          `,
          [
            req.user.id,
            quizId,
            questionsResult.rows.length
          ]
        );

      const attempt =
        attemptResult.rows[0];

      await client.query("COMMIT");

      res.status(201).json({

        success: true,

        message:
          "تم بدء الاختبار.",

        attempt: {

          id:
            attempt.id,

          quiz_id:
            quizId,

          started_at:
            attempt.started_at,

          status:
            attempt.status

        },

        quiz:
          quizResult.rows[0],

        questions:
          questionsResult.rows

      });

    } catch (error) {

      try {
        await client.query("ROLLBACK");
      } catch (_) {}

      console.error(
        "Start quiz error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "تعذر بدء الاختبار."

      });

    } finally {

      client.release();

    }

  }
);

// =========================================================
// SUBMIT QUIZ
// =========================================================

app.post(
  "/api/quizzes/attempts/:attemptId/submit",
  requireUser,
  async (req, res) => {

    const client =
      await pool.connect();

    try {

      const attemptId =
        Number(req.params.attemptId);

      if (!Number.isInteger(attemptId)) {

        return res.status(400).json({

          success: false,

          message:
            "معرف المحاولة غير صحيح."

        });

      }

      const answers =
        Array.isArray(req.body.answers)
          ? req.body.answers
          : [];

      await client.query("BEGIN");

      const attemptResult =
        await client.query(
          `
          SELECT
            a.*,
            q.passing_percentage
          FROM quiz_attempts a
          JOIN quizzes q
            ON q.id = a.quiz_id
          WHERE a.id = $1
          AND a.user_id = $2
          FOR UPDATE
          `,
          [
            attemptId,
            req.user.id
          ]
        );

      if (
        attemptResult.rows.length === 0
      ) {

        await client.query("ROLLBACK");

        return res.status(404).json({

          success: false,

          message:
            "المحاولة غير موجودة."

        });

      }

      const attempt =
        attemptResult.rows[0];

      if (
        attempt.status !== "started"
      ) {

        await client.query("ROLLBACK");

        return res.status(409).json({

          success: false,

          message:
            "هذه المحاولة تم إرسالها بالفعل ولا يمكن إرسالها مرة أخرى."

        });

      }

      const questionsResult =
        await client.query(
          `
          SELECT
            id,
            question_text,
            option_a,
            option_b,
            option_c,
            option_d,
            correct_answer,
            explanation,
            question_order

          FROM quiz_questions

          WHERE quiz_id = $1

          ORDER BY question_order ASC, id ASC
          `,
          [attempt.quiz_id]
        );

      const questions =
        questionsResult.rows;

      if (questions.length === 0) {

        await client.query("ROLLBACK");

        return res.status(400).json({

          success: false,

          message:
            "لا توجد أسئلة لهذا الاختبار."

        });

      }

      if (answers.length !== questions.length) {

        await client.query("ROLLBACK");

        return res.status(400).json({

          success: false,

          message:
            `يجب الإجابة عن جميع الأسئلة قبل تسليم الاختبار. عدد الأسئلة: ${questions.length}`,

          required:
            questions.length,

          received:
            answers.length

        });

      }

      const answerMap =
        new Map();

      for (const item of answers) {

        const questionId =
          Number(item.question_id);

        const selected =
          String(
            item.selected_answer || ""
          ).toUpperCase();

        if (
          !Number.isInteger(questionId) ||
          !["A", "B", "C", "D"].includes(selected)
        ) {

          await client.query("ROLLBACK");

          return res.status(400).json({

            success: false,

            message:
              "يوجد جواب غير صحيح في البيانات المرسلة."

          });

        }

        if (answerMap.has(questionId)) {

          await client.query("ROLLBACK");

          return res.status(400).json({

            success: false,

            message:
              "تم إرسال السؤال أكثر من مرة."

          });

        }

        answerMap.set(
          questionId,
          selected
        );

      }

      for (const question of questions) {

        if (!answerMap.has(question.id)) {

          await client.query("ROLLBACK");

          return res.status(400).json({

            success: false,

            message:
              "يجب الإجابة عن جميع الأسئلة."

          });

        }

      }

      let score = 0;

      const results = [];

      for (const question of questions) {

        const selectedAnswer =
          answerMap.get(question.id);

        const isCorrect =
          selectedAnswer ===
          question.correct_answer;

        if (isCorrect) {
          score++;
        }

        await client.query(
          `
          INSERT INTO quiz_answers
          (
            attempt_id,
            question_id,
            selected_answer,
            is_correct
          )

          VALUES ($1, $2, $3, $4)

          ON CONFLICT
          (attempt_id, question_id)

          DO UPDATE SET
            selected_answer =
              EXCLUDED.selected_answer,

            is_correct =
              EXCLUDED.is_correct,

            answered_at =
              CURRENT_TIMESTAMP
          `,
          [
            attemptId,
            question.id,
            selectedAnswer,
            isCorrect
          ]
        );

        results.push({

          question_id:
            question.id,

          question_text:
            question.question_text,

          selected_answer:
            selectedAnswer,

          correct_answer:
            question.correct_answer,

          is_correct:
            isCorrect,

          explanation:
            isCorrect
              ? null
              : (
                  question.explanation ||
                  "لم تتم إضافة شرح لهذا السؤال بعد."
                )

        });

      }

      const totalQuestions =
        questions.length;

      const percentage =
        Number(
          (
            (score / totalQuestions) *
            100
          ).toFixed(2)
        );

      const passingPercentage =
        Number(attempt.passing_percentage) || 50;

      const passed =
        percentage >= passingPercentage;

      await client.query(
        `
        UPDATE quiz_attempts

        SET
          finished_at =
            CURRENT_TIMESTAMP,

          score =
            $1,

          total_questions =
            $2,

          percentage =
            $3,

          passed =
            $4,

          status =
            'finished'

        WHERE id = $5
        `,
        [
          score,
          totalQuestions,
          percentage,
          passed,
          attemptId
        ]
      );

      await client.query("COMMIT");

      res.json({

        success: true,

        message:
          passed
            ? "مبروك! نجحت في الاختبار 🎉"
            : "لم تصل إلى نسبة النجاح، راجع أخطاءك.",

        result: {

          attempt_id:
            attemptId,

          score,

          total_questions:
            totalQuestions,

          percentage,

          passing_percentage:
            passingPercentage,

          passed,

          status:
            "finished"

        },

        questions:
          results

      });

    } catch (error) {

      try {
        await client.query("ROLLBACK");
      } catch (_) {}

      console.error(
        "Submit quiz error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "تعذر تسليم الاختبار."

      });

    } finally {

      client.release();

    }

  }
);

// =========================================================
// GET ATTEMPT RESULT
// =========================================================

app.get(
  "/api/quizzes/attempts/:attemptId/result",
  requireUser,
  async (req, res) => {

    try {

      const attemptId =
        Number(req.params.attemptId);

      const attemptResult =
        await pool.query(
          `
          SELECT
            a.id,
            a.quiz_id,
            a.started_at,
            a.finished_at,
            a.score,
            a.total_questions,
            a.percentage,
            a.passed,
            a.status,
            q.title,
            q.passing_percentage

          FROM quiz_attempts a

          JOIN quizzes q
            ON q.id = a.quiz_id

          WHERE a.id = $1
          AND a.user_id = $2
          `,
          [
            attemptId,
            req.user.id
          ]
        );

      if (
        attemptResult.rows.length === 0
      ) {

        return res.status(404).json({

          success: false,

          message:
            "نتيجة الاختبار غير موجودة."

        });

      }

      const attempt =
        attemptResult.rows[0];

      const answersResult =
        await pool.query(
          `
          SELECT
            qa.question_id,
            qa.selected_answer,
            qa.is_correct,

            qq.question_text,
            qq.option_a,
            qq.option_b,
            qq.option_c,
            qq.option_d,
            qq.correct_answer,
            qq.explanation,
            qq.question_order

          FROM quiz_answers qa

          JOIN quiz_questions qq
            ON qq.id = qa.question_id

          WHERE qa.attempt_id = $1

          ORDER BY
            qq.question_order ASC,
            qq.id ASC
          `,
          [attemptId]
        );

      const questions =
        answersResult.rows.map(item => ({

          question_id:
            item.question_id,

          question_text:
            item.question_text,

          options: {

            A:
              item.option_a,

            B:
              item.option_b,

            C:
              item.option_c,

            D:
              item.option_d

          },

          selected_answer:
            item.selected_answer,

          correct_answer:
            item.correct_answer,

          is_correct:
            item.is_correct,

          explanation:
            item.explanation ||
            "لم تتم إضافة شرح لهذا السؤال بعد."

        }));

      res.json({

        success: true,

        result: {

          id:
            attempt.id,

          quiz_id:
            attempt.quiz_id,

          title:
            attempt.title,

          started_at:
            attempt.started_at,

          finished_at:
            attempt.finished_at,

          score:
            attempt.score,

          total_questions:
            attempt.total_questions,

          percentage:
            attempt.percentage,

          passing_percentage:
            attempt.passing_percentage,

          passed:
            attempt.passed,

          status:
            attempt.status

        },

        questions

      });

    } catch (error) {

      console.error(
        "Get attempt result error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "تعذر تحميل نتيجة الاختبار."

      });

    }

  }
);

// =========================================================
// GET USER QUIZ ATTEMPTS
// =========================================================

app.get(
  "/api/quizzes/my-attempts",
  requireUser,
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT
            a.id,
            a.quiz_id,
            q.title,
            a.started_at,
            a.finished_at,
            a.score,
            a.total_questions,
            a.percentage,
            a.passed,
            a.status

          FROM quiz_attempts a

          JOIN quizzes q
            ON q.id = a.quiz_id

          WHERE a.user_id = $1

          ORDER BY a.started_at DESC
          `,
          [req.user.id]
        );

      res.json({

        success: true,

        attempts:
          result.rows

      });

    } catch (error) {

      console.error(
        "Get my attempts error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "تعذر تحميل اختباراتك."

      });

    }

  }
);

// =========================================================
// GET QUIZ QUESTIONS FOR ADMIN
// =========================================================

app.get(
  "/api/admin/quizzes/:quizId/questions",
  requireAdmin,
  async (req, res) => {

    try {

      const quizId =
        Number(req.params.quizId);

      const result =
        await pool.query(
          `
          SELECT
            id,
            quiz_id,
            question_text,
            option_a,
            option_b,
            option_c,
            option_d,
            correct_answer,
            explanation,
            question_order,
            created_at

          FROM quiz_questions

          WHERE quiz_id = $1

          ORDER BY question_order ASC, id ASC
          `,
          [quizId]
        );

      res.json({

        success: true,

        questions:
          result.rows

      });

    } catch (error) {

      console.error(
        "Get admin questions error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "تعذر تحميل أسئلة الاختبار."

      });

    }

  }
);

// =========================================================
// ADMIN - GET QUIZZES
// =========================================================

app.get(
  "/api/admin/quizzes",
  requireAdmin,
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT
            q.id,
            q.lesson_id,
            q.title,
            q.description,
            q.passing_percentage,
            q.questions_per_page,
            q.created_at,

            l.name AS lesson_name

          FROM quizzes q

          JOIN lessons l
            ON l.id = q.lesson_id

          ORDER BY q.id DESC
          `
        );

      res.json({

        success: true,

        quizzes:
          result.rows

      });

    } catch (error) {

      console.error(
        "Get admin quizzes error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "تعذر تحميل الاختبارات."

      });

    }

  }
);

// =========================================================
// ADMIN - DELETE QUESTION
// =========================================================

app.delete(
  "/api/admin/quizzes/questions/:questionId",
  requireAdmin,
  async (req, res) => {

    try {

      const questionId =
        Number(req.params.questionId);

      if (!Number.isInteger(questionId)) {

        return res.status(400).json({

          success: false,

          message:
            "معرف السؤال غير صحيح."

        });

      }

      const result =
        await pool.query(
          `
          DELETE FROM quiz_questions
          WHERE id = $1
          RETURNING id
          `,
          [questionId]
        );

      if (result.rows.length === 0) {

        return res.status(404).json({

          success: false,

          message:
            "السؤال غير موجود."

        });

      }

      res.json({

        success: true,

        message:
          "تم حذف السؤال بنجاح."

      });

    } catch (error) {

      console.error(
        "Delete question error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "تعذر حذف السؤال."

      });

    }

  }
);

// =========================================================
// ADMIN - DELETE QUIZ
// =========================================================

app.delete(
  "/api/admin/quizzes/:quizId",
  requireAdmin,
  async (req, res) => {

    try {

      const quizId =
        Number(req.params.quizId);

      if (!Number.isInteger(quizId)) {

        return res.status(400).json({

          success: false,

          message:
            "معرف الاختبار غير صحيح."

        });

      }

      const result =
        await pool.query(
          `
          DELETE FROM quizzes
          WHERE id = $1
          RETURNING id
          `,
          [quizId]
        );

      if (result.rows.length === 0) {

        return res.status(404).json({

          success: false,

          message:
            "الاختبار غير موجود."

        });

      }

      res.json({

        success: true,

        message:
          "تم حذف الاختبار بنجاح."

      });

    } catch (error) {

      console.error(
        "Delete quiz error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "تعذر حذف الاختبار."

      });

    }

  }
);

// =========================================================
// STATIC WEBSITE
// =========================================================

app.use(
  express.static(
    path.join(__dirname)
  )
);

app.get(
  "/",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );

  }
);

// =========================================================
// 404 API
// =========================================================

app.use(
  "/api",
  (req, res) => {

    res.status(404).json({

      success: false,

      message:
        "API endpoint not found."

    });

  }
);

// =========================================================
// START SERVER
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
