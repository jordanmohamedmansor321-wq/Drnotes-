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

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =========================================================
// DATABASE INITIALIZATION
// =========================================================

async function initializeDatabase() {
  try {

    // =====================================================
    // USERS
    // =====================================================

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        grade VARCHAR(50) NOT NULL,
        password_hash TEXT NOT NULL,
        wallet_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // =====================================================
    // WALLET MIGRATION
    // =====================================================

    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS wallet_balance
      NUMERIC(12,2) NOT NULL DEFAULT 0;
    `);

    // =====================================================
    // WALLET TRANSACTIONS
    // =====================================================

    await pool.query(`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id SERIAL PRIMARY KEY,

        user_id INTEGER NOT NULL
          REFERENCES users(id)
          ON DELETE CASCADE,

        amount NUMERIC(12,2) NOT NULL,

        balance_before NUMERIC(12,2) NOT NULL,

        balance_after NUMERIC(12,2) NOT NULL,

        transaction_type VARCHAR(30) NOT NULL
          CHECK (
            transaction_type IN (
              'admin_add',
              'admin_remove',
              'purchase',
              'admin_reset'
            )
          ),

        description TEXT,

        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // =====================================================
    // SUBJECTS
    // =====================================================

    await pool.query(`
      CREATE TABLE IF NOT EXISTS subjects (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        description TEXT,
        image_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // =====================================================
    // UNITS
    // =====================================================

    await pool.query(`
      CREATE TABLE IF NOT EXISTS units (
        id SERIAL PRIMARY KEY,

        subject_id INTEGER NOT NULL
          REFERENCES subjects(id)
          ON DELETE CASCADE,

        name VARCHAR(150) NOT NULL,

        description TEXT,

        unit_order INTEGER DEFAULT 0,

        is_free BOOLEAN NOT NULL DEFAULT TRUE,

        price NUMERIC(12,2) NOT NULL DEFAULT 0,

        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // =====================================================
    // UNIT PAYMENT MIGRATION
    // =====================================================

    await pool.query(`
      ALTER TABLE units
      ADD COLUMN IF NOT EXISTS is_free
      BOOLEAN NOT NULL DEFAULT TRUE;
    `);

    await pool.query(`
      ALTER TABLE units
      ADD COLUMN IF NOT EXISTS price
      NUMERIC(12,2) NOT NULL DEFAULT 0;
    `);

    // =====================================================
    // LESSONS
    // =====================================================

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

    // =====================================================
    // LESSON CONTENT
    // =====================================================

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

    // =====================================================
    // LESSON SOLUTION
    // =====================================================

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

    // =====================================================
    // QUIZZES
    // =====================================================

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

    // =====================================================
    // QUIZ QUESTIONS
    // =====================================================

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

    // =====================================================
    // QUIZ ATTEMPTS
    // =====================================================

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

    // =====================================================
    // QUIZ ANSWERS
    // =====================================================

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

    // =====================================================
    // LESSON PROGRESS
    // =====================================================

    await pool.query(`
      CREATE TABLE IF NOT EXISTS lesson_progress (
        id SERIAL PRIMARY KEY,

        user_id INTEGER NOT NULL
          REFERENCES users(id)
          ON DELETE CASCADE,

        lesson_id INTEGER NOT NULL
          REFERENCES lessons(id)
          ON DELETE CASCADE,

        opened BOOLEAN DEFAULT FALSE,

        completed BOOLEAN DEFAULT FALSE,

        last_opened_at TIMESTAMP,

        completed_at TIMESTAMP,

        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

        UNIQUE(user_id, lesson_id)
      );
    `);

    // =====================================================
    // FAVORITES
    // =====================================================

    await pool.query(`
      CREATE TABLE IF NOT EXISTS favorites (
        id SERIAL PRIMARY KEY,

        user_id INTEGER NOT NULL
          REFERENCES users(id)
          ON DELETE CASCADE,

        lesson_id INTEGER NOT NULL
          REFERENCES lessons(id)
          ON DELETE CASCADE,

        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

        UNIQUE(user_id, lesson_id)
      );
    `);

    // =====================================================
    // UNIT SUBSCRIPTIONS
    // =====================================================

    await pool.query(`
      CREATE TABLE IF NOT EXISTS unit_subscriptions (
        id SERIAL PRIMARY KEY,

        user_id INTEGER NOT NULL
          REFERENCES users(id)
          ON DELETE CASCADE,

        unit_id INTEGER NOT NULL
          REFERENCES units(id)
          ON DELETE CASCADE,

        price_paid NUMERIC(12,2) NOT NULL DEFAULT 0,

        subscribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

        UNIQUE(user_id, unit_id)
      );
    `);

    // =====================================================
    // DEFAULT SUBJECTS
    // =====================================================

    await pool.query(`
      INSERT INTO subjects
        (name, description)
      SELECT *
      FROM (
        VALUES
          ('الفيزياء', 'مادة الفيزياء'),
          ('الكيمياء', 'مادة الكيمياء'),
          ('الأحياء', 'مادة الأحياء'),
          ('العربي', 'مادة اللغة العربية'),
          ('الإنجليزي', 'مادة اللغة الإنجليزية'),
          ('الحاسوب', 'مادة الحاسوب')
      ) AS default_subjects(name, description)

      WHERE NOT EXISTS (
        SELECT 1
        FROM subjects s
        WHERE LOWER(TRIM(s.name)) =
              LOWER(TRIM(default_subjects.name))
      );
    `);

    // =====================================================
    // SUBJECT MIGRATION
    // =====================================================

    const unhamzaBiology =
      await pool.query(`
        SELECT id
        FROM subjects
        WHERE TRIM(name) = 'الاحياء'
        ORDER BY id ASC
      `);

    const statisticsExists =
      await pool.query(`
        SELECT id
        FROM subjects
        WHERE TRIM(name) = 'الإحصاء'
        ORDER BY id ASC
      `);

    if (
      unhamzaBiology.rows.length > 0 &&
      statisticsExists.rows.length === 0
    ) {

      await pool.query(`
        UPDATE subjects
        SET
          name = 'الإحصاء',
          description = 'مادة الإحصاء'
        WHERE TRIM(name) = 'الاحياء'
      `);

      console.log(
        'Migration: تم تحويل "الاحياء" إلى "الإحصاء".'
      );

    } else if (
      unhamzaBiology.rows.length > 0 &&
      statisticsExists.rows.length > 0
    ) {

      for (const row of unhamzaBiology.rows) {

        const unitsCheck =
          await pool.query(
            `
            SELECT COUNT(*)::int AS count
            FROM units
            WHERE subject_id = $1
            `,
            [row.id]
          );

        if (unitsCheck.rows[0].count === 0) {

          await pool.query(
            `
            DELETE FROM subjects
            WHERE id = $1
            `,
            [row.id]
          );

        } else {

          const statisticsId =
            statisticsExists.rows[0].id;

          await pool.query(
            `
            UPDATE units
            SET subject_id = $1
            WHERE subject_id = $2
            `,
            [
              statisticsId,
              row.id
            ]
          );

          await pool.query(
            `
            DELETE FROM subjects
            WHERE id = $1
            `,
            [row.id]
          );
        }
      }
    }

    console.log(
      "Database tables are ready."
    );

  } catch (error) {

    console.error(
      "Database initialization failed:",
      error
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
// ADMIN AUTH
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
        message:
          "غير مصرح بالوصول."
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
        message:
          "صلاحيات المدير مطلوبة."
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
// USER AUTH
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
// UNIT ACCESS CHECK
// =========================================================

async function checkUnitAccess(
  userId,
  unitId
) {

  const result =
    await pool.query(
      `
      SELECT
        u.id,
        u.name,
        u.is_free,
        u.price,

        CASE
          WHEN u.is_free = TRUE
            THEN TRUE
          WHEN us.id IS NOT NULL
            THEN TRUE
          ELSE FALSE
        END AS has_access

      FROM units u

      LEFT JOIN unit_subscriptions us
        ON us.unit_id = u.id
        AND us.user_id = $1

      WHERE u.id = $2
      `,
      [
        userId,
        unitId
      ]
    );

  return result.rows[0] || null;
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
          `
          SELECT id
          FROM users
          WHERE email = $1
          `,
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
            password_hash,
            wallet_balance
          )
          VALUES
          ($1, $2, $3, $4, 0)

          RETURNING
            id,
            name,
            email,
            grade,
            wallet_balance,
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
// LOGIN
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
          `
          SELECT *
          FROM users
          WHERE email = $1
          `,
          [normalizedEmail]
        );

      if (result.rows.length === 0) {
        return res.status(401).json({
          success: false,
          message:
            "البريد الإلكتروني أو كلمة المرور غير صحيحة."
        });
      }

      const user =
        result.rows[0];

      const validPassword =
        await bcrypt.compare(
          password,
          user.password_hash
        );

      if (!validPassword) {
        return res.status(401).json({
          success: false,
          message:
            "البريد الإلكتروني أو كلمة المرور غير صحيحة."
        });
      }

      const token =
        createUserToken(user);

      delete user.password_hash;

      res.json({
        success: true,
        message:
          "تم تسجيل الدخول بنجاح.",
        token,
        user
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
            "بيانات المدير غير مضبوطة في السيرفر."
        });
      }

      if (
        email.trim().toLowerCase() !==
        adminEmail.trim().toLowerCase() ||
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
          "تم تسجيل دخول المدير.",
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
          "تعذر تسجيل دخول المدير."
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
            wallet_balance,
            created_at
          FROM users
          WHERE id = $1
          `,
          [req.user.id]
        );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message:
            "الحساب غير موجود."
        });
      }

      res.json({
        success: true,
        user:
          result.rows[0]
      });

    } catch (error) {

      console.error(
        "Get current user error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر تحميل بيانات الحساب."
      });
    }
  }
);

// =========================================================
// USER WALLET
// =========================================================

app.get(
  "/api/wallet",
  requireUser,
  async (req, res) => {

    try {

      const userResult =
        await pool.query(
          `
          SELECT
            id,
            wallet_balance
          FROM users
          WHERE id = $1
          `,
          [req.user.id]
        );

      if (
        userResult.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "الحساب غير موجود."
        });
      }

      const transactions =
        await pool.query(
          `
          SELECT
            id,
            amount,
            balance_before,
            balance_after,
            transaction_type,
            description,
            created_at
          FROM wallet_transactions
          WHERE user_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT 100
          `,
          [req.user.id]
        );

      res.json({
        success: true,

        wallet: {
          balance:
            userResult.rows[0].wallet_balance
        },

        transactions:
          transactions.rows
      });

    } catch (error) {

      console.error(
        "Get wallet error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر تحميل المحفظة."
      });
    }
  }
);

// =========================================================
// USER SUBSCRIPTIONS
// =========================================================

app.get(
  "/api/subscriptions",
  requireUser,
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT
            us.id,
            us.unit_id,
            us.price_paid,
            us.subscribed_at,

            u.name AS unit_name,
            u.description AS unit_description,

            s.id AS subject_id,
            s.name AS subject_name

          FROM unit_subscriptions us

          JOIN units u
            ON u.id = us.unit_id

          JOIN subjects s
            ON s.id = u.subject_id

          WHERE us.user_id = $1

          ORDER BY
            us.subscribed_at DESC
          `,
          [req.user.id]
        );

      res.json({
        success: true,
        subscriptions:
          result.rows
      });

    } catch (error) {

      console.error(
        "Get subscriptions error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر تحميل الاشتراكات."
      });
    }
  }
);

// =========================================================
// BUY UNIT
// =========================================================

app.post(
  "/api/units/:unitId/purchase",
  requireUser,
  async (req, res) => {

    const client =
      await pool.connect();

    try {

      const unitId =
        Number(req.params.unitId);

      if (!Number.isInteger(unitId)) {
        return res.status(400).json({
          success: false,
          message:
            "معرف الوحدة غير صحيح."
        });
      }

      await client.query("BEGIN");

      const unitResult =
        await client.query(
          `
          SELECT
            id,
            name,
            is_free,
            price
          FROM units
          WHERE id = $1
          FOR UPDATE
          `,
          [unitId]
        );

      if (
        unitResult.rows.length === 0
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          success: false,
          message:
            "الوحدة غير موجودة."
        });
      }

      const unit =
        unitResult.rows[0];

      const existing =
        await client.query(
          `
          SELECT
            id,
            price_paid,
            subscribed_at
          FROM unit_subscriptions
          WHERE user_id = $1
          AND unit_id = $2
          `,
          [
            req.user.id,
            unitId
          ]
        );

      if (
        existing.rows.length > 0
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(409).json({
          success: false,
          already_subscribed: true,
          message:
            "أنت مشترك بالفعل في هذه الوحدة.",
          subscription:
            existing.rows[0]
        });
      }

      if (unit.is_free) {

        const subscription =
          await client.query(
            `
            INSERT INTO unit_subscriptions
            (
              user_id,
              unit_id,
              price_paid
            )
            VALUES
            ($1, $2, 0)
            RETURNING *
            `,
            [
              req.user.id,
              unitId
            ]
          );

        await client.query(
          "COMMIT"
        );

        return res.status(201).json({
          success: true,
          message:
            "تم الاشتراك في الوحدة المجانية.",
          subscription:
            subscription.rows[0],
          balance:
            null
        });
      }

      const price =
        Number(unit.price);

      if (
        !Number.isFinite(price) ||
        price < 0
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          success: false,
          message:
            "سعر الوحدة غير صحيح."
        });
      }

      const userResult =
        await client.query(
          `
          SELECT
            id,
            wallet_balance
          FROM users
          WHERE id = $1
          FOR UPDATE
          `,
          [req.user.id]
        );

      const balance =
        Number(
          userResult.rows[0].wallet_balance
        );

      if (balance < price) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          success: false,
          insufficient_balance: true,
          message:
            "رصيدك غير كافٍ لشراء هذه الوحدة.",
          price,
          balance
        });
      }

      const newBalance =
        Number(
          (
            balance - price
          ).toFixed(2)
        );

      await client.query(
        `
        UPDATE users
        SET wallet_balance = $1
        WHERE id = $2
        `,
        [
          newBalance,
          req.user.id
        ]
      );

      const subscription =
        await client.query(
          `
          INSERT INTO unit_subscriptions
          (
            user_id,
            unit_id,
            price_paid
          )
          VALUES
          ($1, $2, $3)
          RETURNING *
          `,
          [
            req.user.id,
            unitId,
            price
          ]
        );

      await client.query(
        `
        INSERT INTO wallet_transactions
        (
          user_id,
          amount,
          balance_before,
          balance_after,
          transaction_type,
          description
        )
        VALUES
        ($1, $2, $3, $4, 'purchase', $5)
        `,
        [
          req.user.id,
          -price,
          balance,
          newBalance,
          `شراء الوحدة: ${unit.name}`
        ]
      );

      await client.query(
        "COMMIT"
      );

      res.status(201).json({
        success: true,
        message:
          "تم شراء الوحدة بنجاح.",
        subscription:
          subscription.rows[0],
        balance:
          newBalance
      });

    } catch (error) {

      try {
        await client.query(
          "ROLLBACK"
        );
      } catch (_) {}

      console.error(
        "Purchase unit error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر شراء الوحدة."
      });

    } finally {

      client.release();
    }
  }
);

// =========================================================
// GET SUBJECTS
// =========================================================

app.get(
  "/api/subjects",
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT
            id,
            name,
            description,
            image_url,
            created_at
          FROM subjects
          ORDER BY id ASC
          `
        );

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
// GET UNITS
// =========================================================

app.get(
  "/api/subjects/:subjectId/units",
  async (req, res) => {

    try {

      const subjectId =
        Number(
          req.params.subjectId
        );

      if (
        !Number.isInteger(subjectId)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "معرف المادة غير صحيح."
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            u.id,
            u.subject_id,
            u.name,
            u.description,
            u.unit_order,
            u.is_free,
            u.price,
            u.created_at

          FROM units u

          WHERE u.subject_id = $1

          ORDER BY
            u.unit_order ASC,
            u.id ASC
          `,
          [subjectId]
        );

      let units =
        result.rows;

      if (req.headers.authorization) {

        try {

          const token =
            req.headers.authorization
              .substring(7);

          const decoded =
            jwt.verify(
              token,
              process.env.JWT_SECRET
            );

          if (
            decoded.role === "user"
          ) {

            const subscriptions =
              await pool.query(
                `
                SELECT unit_id
                FROM unit_subscriptions
                WHERE user_id = $1
                `,
                [decoded.id]
              );

            const subscribedIds =
              new Set(
                subscriptions.rows.map(
                  row => row.unit_id
                )
              );

            units =
              units.map(unit => ({
                ...unit,

                has_access:
                  unit.is_free ||
                  subscribedIds.has(unit.id)
              }));
          }

        } catch (_) {}
      }

      res.json({
        success: true,
        units
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
// GET LESSON
// =========================================================

app.get(
  "/api/lessons/:lessonId",
  requireUser,
  async (req, res) => {

    try {

      const lessonId =
        Number(
          req.params.lessonId
        );

      if (
        !Number.isInteger(lessonId)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "معرف الدرس غير صحيح."
        });
      }

      const lessonResult =
        await pool.query(
          `
          SELECT
            l.id,
            l.name,
            l.description,
            l.lesson_order,

            u.id AS unit_id,
            u.name AS unit_name,
            u.is_free,
            u.price,

            s.id AS subject_id,
            s.name AS subject_name

          FROM lessons l

          JOIN units u
            ON u.id = l.unit_id

          JOIN subjects s
            ON s.id = u.subject_id

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

      const lesson =
        lessonResult.rows[0];

      const access =
        await checkUnitAccess(
          req.user.id,
          lesson.unit_id
        );

      if (
        !access ||
        !access.has_access
      ) {
        return res.status(403).json({
          success: false,
          requires_subscription: true,
          unit_id: lesson.unit_id,
          unit_name: lesson.unit_name,
          price: lesson.price,
          message:
            lesson.is_free
              ? "لا يمكن الوصول إلى هذه الوحدة."
              : "يجب شراء الوحدة أولًا للوصول إلى محتواها."
        });
      }

      const contentResult =
        await pool.query(
          `
          SELECT
            video_url,
            pdf_url,
            explanation
          FROM lesson_content
          WHERE lesson_id = $1
          `,
          [lessonId]
        );

      const solutionResult =
        await pool.query(
          `
          SELECT
            video_url,
            pdf_url,
            explanation
          FROM lesson_solution
          WHERE lesson_id = $1
          `,
          [lessonId]
        );

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

        lesson,

        content:
          contentResult.rows[0] || null,

        solution:
          solutionResult.rows[0] || null,

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
// ADMIN - GET STUDENTS
// =========================================================

app.get(
  "/api/admin/users",
  requireAdmin,
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
            wallet_balance,
            created_at
          FROM users
          ORDER BY id DESC
          `
        );

      res.json({
        success: true,
        users:
          result.rows
      });

    } catch (error) {

      console.error(
        "Get admin users error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر تحميل الطلاب."
      });
    }
  }
);

// =========================================================
// ADMIN - GET STUDENT WALLET
// =========================================================

app.get(
  "/api/admin/users/:userId/wallet",
  requireAdmin,
  async (req, res) => {

    try {

      const userId =
        Number(
          req.params.userId
        );

      if (
        !Number.isInteger(userId)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "معرف الطالب غير صحيح."
        });
      }

      const userResult =
        await pool.query(
          `
          SELECT
            id,
            name,
            email,
            wallet_balance
          FROM users
          WHERE id = $1
          `,
          [userId]
        );

      if (
        userResult.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "الطالب غير موجود."
        });
      }

      const transactions =
        await pool.query(
          `
          SELECT *
          FROM wallet_transactions
          WHERE user_id = $1
          ORDER BY
            created_at DESC,
            id DESC
          `,
          [userId]
        );

      res.json({
        success: true,

        user:
          userResult.rows[0],

        transactions:
          transactions.rows
      });

    } catch (error) {

      console.error(
        "Admin wallet error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر تحميل محفظة الطالب."
      });
    }
  }
);

// =========================================================
// ADMIN - ADD BALANCE
// =========================================================

app.post(
  "/api/admin/users/:userId/wallet/add",
  requireAdmin,
  async (req, res) => {

    const client =
      await pool.connect();

    try {

      const userId =
        Number(
          req.params.userId
        );

      const amount =
        Number(req.body.amount);

      if (
        !Number.isInteger(userId)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "معرف الطالب غير صحيح."
        });
      }

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "مبلغ الرصيد غير صحيح."
        });
      }

      await client.query(
        "BEGIN"
      );

      const userResult =
        await client.query(
          `
          SELECT
            id,
            wallet_balance
          FROM users
          WHERE id = $1
          FOR UPDATE
          `,
          [userId]
        );

      if (
        userResult.rows.length === 0
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          success: false,
          message:
            "الطالب غير موجود."
        });
      }

      const before =
        Number(
          userResult.rows[0].wallet_balance
        );

      const after =
        Number(
          (
            before + amount
          ).toFixed(2)
        );

      await client.query(
        `
        UPDATE users
        SET wallet_balance = $1
        WHERE id = $2
        `,
        [
          after,
          userId
        ]
      );

      await client.query(
        `
        INSERT INTO wallet_transactions
        (
          user_id,
          amount,
          balance_before,
          balance_after,
          transaction_type,
          description
        )
        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          'admin_add',
          $5
        )
        `,
        [
          userId,
          amount,
          before,
          after,
          req.body.description ||
            "إضافة رصيد من الإدارة"
        ]
      );

      await client.query(
        "COMMIT"
      );

      res.json({
        success: true,
        message:
          "تمت إضافة الرصيد بنجاح.",
        balance:
          after
      });

    } catch (error) {

      try {
        await client.query(
          "ROLLBACK"
        );
      } catch (_) {}

      console.error(
        "Admin add balance error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر إضافة الرصيد."
      });

    } finally {

      client.release();
    }
  }
);

// =========================================================
// ADMIN - RESET STUDENT BALANCE
// =========================================================

app.delete(
  "/api/admin/users/:userId/wallet",
  requireAdmin,
  async (req, res) => {

    const client =
      await pool.connect();

    try {

      const userId =
        Number(
          req.params.userId
        );

      if (
        !Number.isInteger(userId)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "معرف الطالب غير صحيح."
        });
      }

      await client.query(
        "BEGIN"
      );

      const userResult =
        await client.query(
          `
          SELECT
            id,
            wallet_balance
          FROM users
          WHERE id = $1
          FOR UPDATE
          `,
          [userId]
        );

      if (
        userResult.rows.length === 0
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          success: false,
          message:
            "الطالب غير موجود."
        });
      }

      const before =
        Number(
          userResult.rows[0].wallet_balance
        );

      if (before !== 0) {

        await client.query(
          `
          INSERT INTO wallet_transactions
          (
            user_id,
            amount,
            balance_before,
            balance_after,
            transaction_type,
            description
          )
          VALUES
          (
            $1,
            $2,
            $3,
            0,
            'admin_reset',
            'تصفير رصيد الطالب من الإدارة'
          )
          `,
          [
            userId,
            -before,
            before
          ]
        );
      }

      await client.query(
        `
        UPDATE users
        SET wallet_balance = 0
        WHERE id = $1
        `,
        [userId]
      );

      await client.query(
        "COMMIT"
      );

      res.json({
        success: true,
        message:
          "تم تصفير رصيد الطالب.",
        balance:
          0
      });

    } catch (error) {

      try {
        await client.query(
          "ROLLBACK"
        );
      } catch (_) {}

      console.error(
        "Reset wallet error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر تصفير رصيد الطالب."
      });

    } finally {

      client.release();
    }
  }
);

// =========================================================
// ADMIN - GET SUBSCRIPTIONS
// =========================================================

app.get(
  "/api/admin/subscriptions",
  requireAdmin,
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT
            us.id,
            us.user_id,
            us.unit_id,
            us.price_paid,
            us.subscribed_at,

            u.name AS unit_name,

            s.name AS subject_name,

            usr.name AS user_name,
            usr.email AS user_email

          FROM unit_subscriptions us

          JOIN users usr
            ON usr.id = us.user_id

          JOIN units u
            ON u.id = us.unit_id

          JOIN subjects s
            ON s.id = u.subject_id

          ORDER BY
            us.subscribed_at DESC
          `
        );

      res.json({
        success: true,
        subscriptions:
          result.rows
      });

    } catch (error) {

      console.error(
        "Get admin subscriptions error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر تحميل الاشتراكات."
      });
    }
  }
);

// =========================================================
// ADMIN - DELETE ONE SUBSCRIPTION
// =========================================================

app.delete(
  "/api/admin/subscriptions/:subscriptionId",
  requireAdmin,
  async (req, res) => {

    try {

      const subscriptionId =
        Number(
          req.params.subscriptionId
        );

      if (
        !Number.isInteger(
          subscriptionId
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "معرف الاشتراك غير صحيح."
        });
      }

      const result =
        await pool.query(
          `
          DELETE FROM unit_subscriptions
          WHERE id = $1
          RETURNING id
          `,
          [subscriptionId]
        );

      if (
        result.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "الاشتراك غير موجود."
        });
      }

      res.json({
        success: true,
        message:
          "تم حذف الاشتراك."
      });

    } catch (error) {

      console.error(
        "Delete subscription error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر حذف الاشتراك."
      });
    }
  }
);

// =========================================================
// ADMIN - DELETE ALL SUBSCRIPTIONS
// =========================================================

app.delete(
  "/api/admin/subscriptions",
  requireAdmin,
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          DELETE FROM unit_subscriptions
          RETURNING id
          `
        );

      res.json({
        success: true,
        message:
          "تم حذف جميع الاشتراكات.",
        deleted_count:
          result.rowCount
      });

    } catch (error) {

      console.error(
        "Delete all subscriptions error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر حذف جميع الاشتراكات."
      });
    }
  }
);

// =========================================================
// ADMIN - CREATE UNIT
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
        unit_order,
        is_free,
        price
      } = req.body;

      const subjectId =
        Number(subject_id);

      if (
        !Number.isInteger(subjectId) ||
        !name ||
        !name.trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            "المادة واسم الوحدة مطلوبان."
        });
      }

      const subjectCheck =
        await pool.query(
          `
          SELECT id
          FROM subjects
          WHERE id = $1
          `,
          [subjectId]
        );

      if (
        subjectCheck.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "المادة غير موجودة."
        });
      }

      const free =
        is_free === false ||
        is_free === "false"
          ? false
          : true;

      let unitPrice =
        Number(price);

      if (
        !Number.isFinite(unitPrice) ||
        unitPrice < 0
      ) {
        unitPrice = 0;
      }

      if (free) {
        unitPrice = 0;
      }

      const order =
        Number(unit_order);

      const result =
        await pool.query(
          `
          INSERT INTO units
          (
            subject_id,
            name,
            description,
            unit_order,
            is_free,
            price
          )
          VALUES
          ($1,$2,$3,$4,$5,$6)
          RETURNING *
          `,
          [
            subjectId,
            name.trim(),
            description || null,
            Number.isFinite(order)
              ? order
              : 0,
            free,
            unitPrice
          ]
        );

      res.status(201).json({
        success: true,
        message:
          "تم إنشاء الوحدة.",
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
// ADMIN - UPDATE UNIT
// =========================================================

app.put(
  "/api/admin/units/:unitId",
  requireAdmin,
  async (req, res) => {

    try {

      const unitId =
        Number(
          req.params.unitId
        );

      if (
        !Number.isInteger(unitId)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "معرف الوحدة غير صحيح."
        });
      }

      const {
        name,
        description,
        unit_order,
        is_free,
        price
      } = req.body;

      const current =
        await pool.query(
          `
          SELECT *
          FROM units
          WHERE id = $1
          `,
          [unitId]
        );

      if (
        current.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "الوحدة غير موجودة."
        });
      }

      const old =
        current.rows[0];

      const finalName =
        name !== undefined
          ? String(name).trim()
          : old.name;

      if (!finalName) {
        return res.status(400).json({
          success: false,
          message:
            "اسم الوحدة مطلوب."
        });
      }

      const free =
        is_free === undefined
          ? old.is_free
          : !(
              is_free === false ||
              is_free === "false"
            );

      let finalPrice =
        price === undefined
          ? Number(old.price)
          : Number(price);

      if (
        !Number.isFinite(finalPrice) ||
        finalPrice < 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "سعر الوحدة غير صحيح."
        });
      }

      if (free) {
        finalPrice = 0;
      }

      const order =
        unit_order === undefined
          ? old.unit_order
          : Number(unit_order);

      const result =
        await pool.query(
          `
          UPDATE units
          SET
            name = $1,
            description = $2,
            unit_order = $3,
            is_free = $4,
            price = $5
          WHERE id = $6
          RETURNING *
          `,
          [
            finalName,
            description === undefined
              ? old.description
              : description,
            Number.isFinite(order)
              ? order
              : 0,
            free,
            finalPrice,
            unitId
          ]
        );

      res.json({
        success: true,
        message:
          "تم تحديث الوحدة.",
        unit:
          result.rows[0]
      });

    } catch (error) {

      console.error(
        "Update unit error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر تحديث الوحدة."
      });
    }
  }
);

// =========================================================
// ADMIN - DELETE UNIT
// =========================================================

app.delete(
  "/api/admin/units/:unitId",
  requireAdmin,
  async (req, res) => {

    try {

      const unitId =
        Number(
          req.params.unitId
        );

      if (
        !Number.isInteger(unitId)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "معرف الوحدة غير صحيح."
        });
      }

      const result =
        await pool.query(
          `
          DELETE FROM units
          WHERE id = $1
          RETURNING id
          `,
          [unitId]
        );

      if (
        result.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "الوحدة غير موجودة."
        });
      }

      res.json({
        success: true,
        message:
          "تم حذف الوحدة وجميع محتوياتها المرتبطة."
      });

    } catch (error) {

      console.error(
        "Delete unit error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر حذف الوحدة."
      });
    }
  }
);

// =========================================================
// ADMIN - DELETE ALL UNITS
// =========================================================

app.delete(
  "/api/admin/units",
  requireAdmin,
  async (req, res) => {

    const client =
      await pool.connect();

    try {

      await client.query(
        "BEGIN"
      );

      const countResult =
        await client.query(
          `
          SELECT COUNT(*)::int AS count
          FROM units
          `
        );

      const count =
        countResult.rows[0].count;

      await client.query(
        `
        DELETE FROM units
        `
      );

      await client.query(
        "COMMIT"
      );

      res.json({
        success: true,
        message:
          "تم حذف جميع الوحدات وجميع محتوياتها المرتبطة.",
        deleted_count:
          count
      });

    } catch (error) {

      try {
        await client.query(
          "ROLLBACK"
        );
      } catch (_) {}

      console.error(
        "Delete all units error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر حذف جميع الوحدات."
      });

    } finally {

      client.release();
    }
  }
);

// =========================================================
// ADMIN - DELETE STUDENT
// =========================================================

app.delete(
  "/api/admin/users/:userId",
  requireAdmin,
  async (req, res) => {

    try {

      const userId =
        Number(
          req.params.userId
        );

      if (
        !Number.isInteger(userId)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "معرف الطالب غير صحيح."
        });
      }

      const result =
        await pool.query(
          `
          DELETE FROM users
          WHERE id = $1
          RETURNING id
          `,
          [userId]
        );

      if (
        result.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "الطالب غير موجود."
        });
      }

      res.json({
        success: true,
        message:
          "تم حذف حساب الطالب وجميع بياناته المرتبطة."
      });

    } catch (error) {

      console.error(
        "Delete student error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر حذف حساب الطالب."
      });
    }
  }
);

// =========================================================
// ADMIN - DELETE ALL STUDENTS
// =========================================================

app.delete(
  "/api/admin/users",
  requireAdmin,
  async (req, res) => {

    const client =
      await pool.connect();

    try {

      await client.query(
        "BEGIN"
      );

      const countResult =
        await client.query(
          `
          SELECT COUNT(*)::int AS count
          FROM users
          `
        );

      const count =
        countResult.rows[0].count;

      await client.query(
        `
        DELETE FROM users
        `
      );

      await client.query(
        "COMMIT"
      );

      res.json({
        success: true,
        message:
          "تم حذف جميع حسابات الطلاب وجميع بياناتهم المرتبطة.",
        deleted_count:
          count
      });

    } catch (error) {

      try {
        await client.query(
          "ROLLBACK"
        );
      } catch (_) {}

      console.error(
        "Delete all students error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر حذف جميع حسابات الطلاب."
      });

    } finally {

      client.release();
    }
  }
);

// =========================================================
// ADMIN - LESSON CRUD
// =========================================================

app.get(
  "/api/admin/units/:unitId/lessons",
  requireAdmin,
  async (req, res) => {
    try {
      const unitId = Number(req.params.unitId);
      if (!Number.isInteger(unitId)) {
        return res.status(400).json({ success: false, message: "معرف الوحدة غير صحيح." });
      }
      const result = await pool.query(
        `SELECT l.id, l.unit_id, l.name, l.description, l.lesson_order, l.created_at
         FROM lessons l
         WHERE l.unit_id = $1
         ORDER BY l.lesson_order ASC, l.id ASC`,
        [unitId]
      );
      res.json({ success: true, lessons: result.rows });
    } catch (error) {
      console.error("Admin get lessons error:", error);
      res.status(500).json({ success: false, message: "تعذر تحميل الدروس." });
    }
  }
);

app.post(
  "/api/admin/lessons",
  requireAdmin,
  async (req, res) => {
    try {
      const unitId = Number(req.body.unit_id);
      const name = String(req.body.name || "").trim();
      const description = String(req.body.description || "").trim();
      const lessonOrder = Number(req.body.lesson_order) || 0;

      if (!Number.isInteger(unitId) || !name) {
        return res.status(400).json({ success: false, message: "الوحدة واسم الدرس مطلوبان." });
      }

      const unitCheck = await pool.query("SELECT id FROM units WHERE id = $1", [unitId]);
      if (!unitCheck.rows.length) {
        return res.status(404).json({ success: false, message: "الوحدة غير موجودة." });
      }

      const result = await pool.query(
        `INSERT INTO lessons (unit_id, name, description, lesson_order)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [unitId, name, description || null, lessonOrder]
      );

      res.status(201).json({ success: true, message: "تمت إضافة الدرس بنجاح.", lesson: result.rows[0] });
    } catch (error) {
      console.error("Admin create lesson error:", error);
      res.status(500).json({ success: false, message: "تعذر إضافة الدرس." });
    }
  }
);

app.get(
  "/api/admin/lessons/:lessonId",
  requireAdmin,
  async (req, res) => {
    try {
      const lessonId = Number(req.params.lessonId);
      if (!Number.isInteger(lessonId)) {
        return res.status(400).json({ success: false, message: "معرف الدرس غير صحيح." });
      }

      const result = await pool.query(
        `SELECT l.id, l.unit_id, l.name, l.description, l.lesson_order,
                lc.video_url AS explanation_video_url,
                lc.pdf_url AS explanation_pdf_url,
                lc.explanation AS explanation_text,
                ls.video_url AS solution_video_url,
                ls.pdf_url AS solution_pdf_url,
                ls.explanation AS solution_text
         FROM lessons l
         LEFT JOIN lesson_content lc ON lc.lesson_id = l.id
         LEFT JOIN lesson_solution ls ON ls.lesson_id = l.id
         WHERE l.id = $1`,
        [lessonId]
      );

      if (!result.rows.length) {
        return res.status(404).json({ success: false, message: "الدرس غير موجود." });
      }

      const quizResult = await pool.query(
        `SELECT id, title, description, passing_percentage, questions_per_page
         FROM quizzes WHERE lesson_id = $1 ORDER BY id DESC LIMIT 1`,
        [lessonId]
      );

      res.json({ success: true, lesson: result.rows[0], quiz: quizResult.rows[0] || null });
    } catch (error) {
      console.error("Admin get lesson error:", error);
      res.status(500).json({ success: false, message: "تعذر تحميل بيانات الدرس." });
    }
  }
);

app.put(
  "/api/admin/lessons/:lessonId",
  requireAdmin,
  async (req, res) => {
    try {
      const lessonId = Number(req.params.lessonId);
      const name = String(req.body.name || "").trim();
      const description = String(req.body.description || "").trim();
      const lessonOrder = Number(req.body.lesson_order) || 0;

      if (!Number.isInteger(lessonId) || !name) {
        return res.status(400).json({ success: false, message: "معرف الدرس واسم الدرس مطلوبان." });
      }

      const result = await pool.query(
        `UPDATE lessons
         SET name = $1, description = $2, lesson_order = $3
         WHERE id = $4
         RETURNING *`,
        [name, description || null, lessonOrder, lessonId]
      );

      if (!result.rows.length) {
        return res.status(404).json({ success: false, message: "الدرس غير موجود." });
      }

      res.json({ success: true, message: "تم تعديل الدرس بنجاح.", lesson: result.rows[0] });
    } catch (error) {
      console.error("Admin update lesson error:", error);
      res.status(500).json({ success: false, message: "تعذر تعديل الدرس." });
    }
  }
);

app.delete(
  "/api/admin/lessons/:lessonId",
  requireAdmin,
  async (req, res) => {
    try {
      const lessonId = Number(req.params.lessonId);
      if (!Number.isInteger(lessonId)) {
        return res.status(400).json({ success: false, message: "معرف الدرس غير صحيح." });
      }

      const result = await pool.query("DELETE FROM lessons WHERE id = $1 RETURNING id", [lessonId]);
      if (!result.rows.length) {
        return res.status(404).json({ success: false, message: "الدرس غير موجود." });
      }

      res.json({ success: true, message: "تم حذف الدرس بنجاح." });
    } catch (error) {
      console.error("Admin delete lesson error:", error);
      res.status(500).json({ success: false, message: "تعذر حذف الدرس. تأكد من قيود قاعدة البيانات." });
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
        Number(
          req.params.lessonId
        );

      if (
        !Number.isInteger(lessonId)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "معرف الدرس غير صحيح."
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            l.id,
            l.name,
            l.description,

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
        result.rows.length === 0
      ) {
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
// ADMIN - SAVE LESSON CONTENT
// =========================================================

app.post(
  "/api/admin/lessons/:lessonId/content",
  requireAdmin,
  async (req, res) => {

    try {

      const lessonId =
        Number(
          req.params.lessonId
        );

      if (
        !Number.isInteger(lessonId)
      ) {
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

      const lessonCheck =
        await pool.query(
          `
          SELECT id
          FROM lessons
          WHERE id = $1
          `,
          [lessonId]
        );

      if (
        lessonCheck.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "الدرس غير موجود."
        });
      }

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
          VALUES
          ($1, $2, $3, $4)

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
// =========================================================

app.post(
  "/api/admin/lessons/:lessonId/solution",
  requireAdmin,
  async (req, res) => {

    try {

      const lessonId =
        Number(
          req.params.lessonId
        );

      if (
        !Number.isInteger(lessonId)
      ) {
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

      const lessonCheck =
        await pool.query(
          `
          SELECT id
          FROM lessons
          WHERE id = $1
          `,
          [lessonId]
        );

      if (
        lessonCheck.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "الدرس غير موجود."
        });
      }

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
          VALUES
          ($1, $2, $3, $4)

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

      const lessonId =
        Number(lesson_id);

      if (
        !Number.isInteger(lessonId) ||
        !title ||
        !title.trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            "الدرس واسم الاختبار مطلوبان."
        });
      }

      const lessonCheck =
        await pool.query(
          `
          SELECT id
          FROM lessons
          WHERE id = $1
          `,
          [lessonId]
        );

      if (
        lessonCheck.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "الدرس غير موجود."
        });
      }

      let passing =
        Number(
          passing_percentage
        );

      if (
        !Number.isFinite(passing) ||
        passing < 0 ||
        passing > 100
      ) {
        passing = 50;
      }

      let perPage =
        Number(
          questions_per_page
        );

      if (
        !Number.isFinite(perPage) ||
        perPage < 1
      ) {
        perPage = 10;
      }

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
          VALUES
          ($1, $2, $3, $4, $5)

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
            lessonId,
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

          ORDER BY
            q.id DESC
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
// ADMIN - ADD QUESTION
// =========================================================

app.post(
  "/api/admin/quizzes/:quizId/questions",
  requireAdmin,
  async (req, res) => {

    try {

      const quizId =
        Number(
          req.params.quizId
        );

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
        String(
          correct_answer || ""
        ).toUpperCase();

      if (
        !Number.isInteger(quizId) ||
        !question_text ||
        !option_a ||
        !option_b ||
        !option_c ||
        !option_d ||
        !["A", "B", "C", "D"].includes(
          correct
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "بيانات السؤال غير مكتملة."
        });
      }

      const quizCheck =
        await pool.query(
          `
          SELECT id
          FROM quizzes
          WHERE id = $1
          `,
          [quizId]
        );

      if (
        quizCheck.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "الاختبار غير موجود."
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
// ADMIN - GET QUESTIONS
// =========================================================

app.get(
  "/api/admin/quizzes/:quizId/questions",
  requireAdmin,
  async (req, res) => {

    try {

      const quizId =
        Number(
          req.params.quizId
        );

      if (
        !Number.isInteger(quizId)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "معرف الاختبار غير صحيح."
        });
      }

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

          ORDER BY
            question_order ASC,
            id ASC
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
// ADMIN - DELETE QUESTION
// =========================================================

app.delete(
  "/api/admin/quizzes/questions/:questionId",
  requireAdmin,
  async (req, res) => {

    try {

      const questionId =
        Number(
          req.params.questionId
        );

      if (
        !Number.isInteger(questionId)
      ) {
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

      if (
        result.rows.length === 0
      ) {
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
        Number(
          req.params.quizId
        );

      if (
        !Number.isInteger(quizId)
      ) {
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

      if (
        result.rows.length === 0
      ) {
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
// PROGRESS - DASHBOARD
// =========================================================

app.get(
  "/api/progress/dashboard",
  requireUser,
  async (req, res) => {

    try {

      const userId =
        req.user.id;

      const totalLessonsResult =
        await pool.query(`
          SELECT COUNT(*)::int AS count
          FROM lessons
        `);

      const completedLessonsResult =
        await pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM lesson_progress
          WHERE user_id = $1
          AND completed = TRUE
          `,
          [userId]
        );

      const completedQuizzesResult =
        await pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM quiz_attempts
          WHERE user_id = $1
          AND status = 'finished'
          `,
          [userId]
        );

      const favoritesResult =
        await pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM favorites
          WHERE user_id = $1
          `,
          [userId]
        );

      const totalLessons =
        totalLessonsResult.rows[0].count;

      const completedLessons =
        completedLessonsResult.rows[0].count;

      const completedQuizzes =
        completedQuizzesResult.rows[0].count;

      const favorites =
        favoritesResult.rows[0].count;

      const overallPercentage =
        totalLessons > 0
          ? Math.round(
              (
                completedLessons /
                totalLessons
              ) * 100
            )
          : 0;

      const lastLessonResult =
        await pool.query(
          `
          SELECT
            lp.lesson_id AS id,
            l.name,
            lp.opened,
            lp.completed,
            lp.last_opened_at,
            lp.completed_at,
            u.name AS unit_name,
            s.id AS subject_id,
            s.name AS subject_name

          FROM lesson_progress lp

          JOIN lessons l
            ON l.id = lp.lesson_id

          JOIN units u
            ON u.id = l.unit_id

          JOIN subjects s
            ON s.id = u.subject_id

          WHERE lp.user_id = $1

          ORDER BY
            lp.last_opened_at DESC NULLS LAST,
            lp.updated_at DESC

          LIMIT 1
          `,
          [userId]
        );

      const recentLessonsResult =
        await pool.query(
          `
          SELECT
            lp.lesson_id AS id,
            l.name,
            lp.completed,
            lp.completed_at,
            u.name AS unit_name,
            s.name AS subject_name

          FROM lesson_progress lp

          JOIN lessons l
            ON l.id = lp.lesson_id

          JOIN units u
            ON u.id = l.unit_id

          JOIN subjects s
            ON s.id = u.subject_id

          WHERE lp.user_id = $1

          ORDER BY
            lp.updated_at DESC

          LIMIT 10
          `,
          [userId]
        );

      const latestQuizResult =
        await pool.query(
          `
          SELECT
            a.id,
            a.quiz_id,
            q.title,
            a.score,
            a.total_questions,
            a.percentage,
            a.passed,
            a.finished_at

          FROM quiz_attempts a

          JOIN quizzes q
            ON q.id = a.quiz_id

          WHERE a.user_id = $1
          AND a.status = 'finished'

          ORDER BY
            a.finished_at DESC

          LIMIT 1
          `,
          [userId]
        );

      res.json({
        success: true,

        progress: {
          completed_lessons:
            completedLessons,

          total_lessons:
            totalLessons,

          overall_percentage:
            overallPercentage,

          completed_quizzes:
            completedQuizzes,

          favorites,

          last_lesson:
            lastLessonResult.rows[0] ||
            null,

          recent_lessons:
            recentLessonsResult.rows,

          latest_quiz:
            latestQuizResult.rows[0] ||
            null
        }
      });

    } catch (error) {

      console.error(
        "Progress dashboard error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر تحميل تقدمك الدراسي."
      });
    }
  }
);

// =========================================================
// PROGRESS - GET ALL USER LESSON PROGRESS
// =========================================================

app.get(
  "/api/progress/lessons",
  requireUser,
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT
            lp.lesson_id,
            lp.opened,
            lp.completed,
            lp.last_opened_at,
            lp.completed_at,

            l.name AS lesson_name,
            l.unit_id,

            u.name AS unit_name,
            u.subject_id,

            s.name AS subject_name

          FROM lesson_progress lp

          JOIN lessons l
            ON l.id = lp.lesson_id

          JOIN units u
            ON u.id = l.unit_id

          JOIN subjects s
            ON s.id = u.subject_id

          WHERE lp.user_id = $1

          ORDER BY
            lp.updated_at DESC
          `,
          [req.user.id]
        );

      res.json({
        success: true,
        progress:
          result.rows
      });

    } catch (error) {

      console.error(
        "Get lesson progress error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر تحميل تقدم الدروس."
      });
    }
  }
);

// =========================================================
// PROGRESS - GET SINGLE LESSON
// =========================================================

app.get(
  "/api/progress/lessons/:lessonId",
  requireUser,
  async (req, res) => {

    try {

      const lessonId =
        Number(
          req.params.lessonId
        );

      if (
        !Number.isInteger(lessonId)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "معرف الدرس غير صحيح."
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            lp.lesson_id,
            lp.opened,
            lp.completed,
            lp.last_opened_at,
            lp.completed_at

          FROM lesson_progress lp

          WHERE lp.user_id = $1
          AND lp.lesson_id = $2
          `,
          [
            req.user.id,
            lessonId
          ]
        );

      res.json({
        success: true,

        progress:
          result.rows[0] || {
            lesson_id:
              lessonId,
            opened:
              false,
            completed:
              false,
            last_opened_at:
              null,
            completed_at:
              null
          }
      });

    } catch (error) {

      console.error(
        "Get single lesson progress error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر تحميل حالة الدرس."
      });
    }
  }
);

// =========================================================
// PROGRESS - OPEN LESSON
// =========================================================

app.post(
  "/api/progress/lessons/:lessonId/open",
  requireUser,
  async (req, res) => {

    try {

      const lessonId =
        Number(
          req.params.lessonId
        );

      if (
        !Number.isInteger(lessonId)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "معرف الدرس غير صحيح."
        });
      }

      const lessonCheck =
        await pool.query(
          `
          SELECT
            l.id,
            l.name,
            u.id AS unit_id,
            u.is_free

          FROM lessons l

          JOIN units u
            ON u.id = l.unit_id

          WHERE l.id = $1
          `,
          [lessonId]
        );

      if (
        lessonCheck.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "الدرس غير موجود."
        });
      }

      const lesson =
        lessonCheck.rows[0];

      const access =
        await checkUnitAccess(
          req.user.id,
          lesson.unit_id
        );

      if (
        !access ||
        !access.has_access
      ) {
        return res.status(403).json({
          success: false,
          requires_subscription:
            true,
          message:
            "يجب شراء الوحدة أولًا."
        });
      }

      const result =
        await pool.query(
          `
          INSERT INTO lesson_progress
          (
            user_id,
            lesson_id,
            opened,
            last_opened_at,
            updated_at
          )

          VALUES
          (
            $1,
            $2,
            TRUE,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )

          ON CONFLICT
          (user_id, lesson_id)

          DO UPDATE SET
            opened = TRUE,
            last_opened_at =
              CURRENT_TIMESTAMP,
            updated_at =
              CURRENT_TIMESTAMP

          RETURNING *
          `,
          [
            req.user.id,
            lessonId
          ]
        );

      res.json({
        success: true,
        message:
          "تم تسجيل فتح الدرس.",
        progress:
          result.rows[0]
      });

    } catch (error) {

      console.error(
        "Open lesson progress error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر تسجيل فتح الدرس."
      });
    }
  }
);

// =========================================================
// PROGRESS - COMPLETE LESSON
// =========================================================

app.post(
  "/api/progress/lessons/:lessonId/complete",
  requireUser,
  async (req, res) => {

    try {

      const lessonId =
        Number(
          req.params.lessonId
        );

      if (
        !Number.isInteger(lessonId)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "معرف الدرس غير صحيح."
        });
      }

      const lessonCheck =
        await pool.query(
          `
          SELECT
            l.id,
            l.name,
            u.id AS unit_id

          FROM lessons l

          JOIN units u
            ON u.id = l.unit_id

          WHERE l.id = $1
          `,
          [lessonId]
        );

      if (
        lessonCheck.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "الدرس غير موجود."
        });
      }

      const access =
        await checkUnitAccess(
          req.user.id,
          lessonCheck.rows[0].unit_id
        );

      if (
        !access ||
        !access.has_access
      ) {
        return res.status(403).json({
          success: false,
          requires_subscription:
            true,
          message:
            "يجب شراء الوحدة أولًا."
        });
      }

      const result =
        await pool.query(
          `
          INSERT INTO lesson_progress
          (
            user_id,
            lesson_id,
            opened,
            completed,
            last_opened_at,
            completed_at,
            updated_at
          )

          VALUES
          (
            $1,
            $2,
            TRUE,
            TRUE,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )

          ON CONFLICT
          (user_id, lesson_id)

          DO UPDATE SET
            opened = TRUE,
            completed = TRUE,
            last_opened_at =
              CURRENT_TIMESTAMP,
            completed_at =
              COALESCE(
                lesson_progress.completed_at,
                CURRENT_TIMESTAMP
              ),
            updated_at =
              CURRENT_TIMESTAMP

          RETURNING *
          `,
          [
            req.user.id,
            lessonId
          ]
        );

      const totalResult =
        await pool.query(`
          SELECT COUNT(*)::int AS count
          FROM lessons
        `);

      const completedResult =
        await pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM lesson_progress
          WHERE user_id = $1
          AND completed = TRUE
          `,
          [req.user.id]
        );

      const total =
        totalResult.rows[0].count;

      const completed =
        completedResult.rows[0].count;

      const percentage =
        total > 0
          ? Math.round(
              (
                completed /
                total
              ) * 100
            )
          : 0;

      res.json({
        success: true,

        message:
          "تم إكمال الدرس بنجاح 🎉",

        progress:
          result.rows[0],

        dashboard: {
          completed_lessons:
            completed,

          total_lessons:
            total,

          overall_percentage:
            percentage
        }
      });

    } catch (error) {

      console.error(
        "Complete lesson progress error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر تسجيل إكمال الدرس."
      });
    }
  }
);

// =========================================================
// FAVORITES - GET
// =========================================================

app.get(
  "/api/favorites",
  requireUser,
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT
            f.id,
            f.lesson_id,
            f.created_at,

            l.name AS lesson_name,
            u.name AS unit_name,
            s.name AS subject_name

          FROM favorites f

          JOIN lessons l
            ON l.id = f.lesson_id

          JOIN units u
            ON u.id = l.unit_id

          JOIN subjects s
            ON s.id = u.subject_id

          WHERE f.user_id = $1

          ORDER BY
            f.created_at DESC
          `,
          [req.user.id]
        );

      res.json({
        success: true,
        favorites:
          result.rows
      });

    } catch (error) {

      console.error(
        "Get favorites error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر تحميل المفضلة."
      });
    }
  }
);

// =========================================================
// FAVORITES - ADD
// =========================================================

app.post(
  "/api/favorites/:lessonId",
  requireUser,
  async (req, res) => {

    try {

      const lessonId =
        Number(
          req.params.lessonId
        );

      if (
        !Number.isInteger(lessonId)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "معرف الدرس غير صحيح."
        });
      }

      const lessonCheck =
        await pool.query(
          `
          SELECT
            l.id,
            u.id AS unit_id

          FROM lessons l

          JOIN units u
            ON u.id = l.unit_id

          WHERE l.id = $1
          `,
          [lessonId]
        );

      if (
        lessonCheck.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "الدرس غير موجود."
        });
      }

      const access =
        await checkUnitAccess(
          req.user.id,
          lessonCheck.rows[0].unit_id
        );

      if (
        !access ||
        !access.has_access
      ) {
        return res.status(403).json({
          success: false,
          requires_subscription:
            true,
          message:
            "يجب شراء الوحدة أولًا."
        });
      }

      const result =
        await pool.query(
          `
          INSERT INTO favorites
          (
            user_id,
            lesson_id
          )

          VALUES
          ($1, $2)

          ON CONFLICT
          (user_id, lesson_id)

          DO NOTHING

          RETURNING *
          `,
          [
            req.user.id,
            lessonId
          ]
        );

      const countResult =
        await pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM favorites
          WHERE user_id = $1
          `,
          [req.user.id]
        );

      res.json({
        success: true,

        message:
          "تمت إضافة الدرس إلى المفضلة.",

        favorite:
          result.rows[0] || null,

        count:
          countResult.rows[0].count
      });

    } catch (error) {

      console.error(
        "Add favorite error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر إضافة الدرس إلى المفضلة."
      });
    }
  }
);

// =========================================================
// FAVORITES - DELETE
// =========================================================

app.delete(
  "/api/favorites/:lessonId",
  requireUser,
  async (req, res) => {

    try {

      const lessonId =
        Number(
          req.params.lessonId
        );

      if (
        !Number.isInteger(lessonId)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "معرف الدرس غير صحيح."
        });
      }

      await pool.query(
        `
        DELETE FROM favorites

        WHERE user_id = $1
        AND lesson_id = $2
        `,
        [
          req.user.id,
          lessonId
        ]
      );

      const countResult =
        await pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM favorites
          WHERE user_id = $1
          `,
          [req.user.id]
        );

      res.json({
        success: true,

        message:
          "تمت إزالة الدرس من المفضلة.",

        count:
          countResult.rows[0].count
      });

    } catch (error) {

      console.error(
        "Delete favorite error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر إزالة الدرس من المفضلة."
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
        Number(
          req.params.quizId
        );

      if (
        !Number.isInteger(quizId)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "معرف الاختبار غير صحيح."
        });
      }

      await client.query(
        "BEGIN"
      );

      const quizResult =
        await client.query(
          `
          SELECT
            q.id,
            q.lesson_id,
            q.title,
            q.description,
            q.passing_percentage,
            q.questions_per_page,

            u.id AS unit_id,
            u.name AS unit_name,
            u.is_free,
            u.price

          FROM quizzes q

          JOIN lessons l
            ON l.id = q.lesson_id

          JOIN units u
            ON u.id = l.unit_id

          WHERE q.id = $1
          `,
          [quizId]
        );

      if (
        quizResult.rows.length === 0
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          success: false,
          message:
            "الاختبار غير موجود."
        });
      }

      const quiz =
        quizResult.rows[0];

      const accessResult =
        await client.query(
          `
          SELECT
            u.is_free,

            CASE
              WHEN u.is_free = TRUE
                THEN TRUE

              WHEN us.id IS NOT NULL
                THEN TRUE

              ELSE FALSE
            END AS has_access

          FROM units u

          LEFT JOIN unit_subscriptions us
            ON us.unit_id = u.id
            AND us.user_id = $1

          WHERE u.id = $2
          `,
          [
            req.user.id,
            quiz.unit_id
          ]
        );

      if (
        accessResult.rows.length === 0 ||
        !accessResult.rows[0].has_access
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(403).json({
          success: false,
          requires_subscription:
            true,
          message:
            "يجب شراء الوحدة أولًا لبدء الاختبار."
        });
      }

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

        await client.query(
          "ROLLBACK"
        );

        const attempt =
          existingAttempt.rows[0];

        return res.status(409).json({
          success: false,
          already_attempted:
            true,

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

          ORDER BY
            question_order ASC,
            id ASC
          `,
          [quizId]
        );

      if (
        questionsResult.rows.length === 0
      ) {

        await client.query(
          "ROLLBACK"
        );

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

      await client.query(
        `
        INSERT INTO lesson_progress
        (
          user_id,
          lesson_id,
          opened,
          last_opened_at,
          updated_at
        )

        VALUES
        (
          $1,
          $2,
          TRUE,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )

        ON CONFLICT
        (user_id, lesson_id)

        DO UPDATE SET
          opened = TRUE,
          last_opened_at =
            CURRENT_TIMESTAMP,
          updated_at =
            CURRENT_TIMESTAMP
        `,
        [
          req.user.id,
          quiz.lesson_id
        ]
      );

      await client.query(
        "COMMIT"
      );

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

        quiz: {
          id:
            quiz.id,

          lesson_id:
            quiz.lesson_id,

          title:
            quiz.title,

          description:
            quiz.description,

          passing_percentage:
            quiz.passing_percentage,

          questions_per_page:
            quiz.questions_per_page
        },

        questions:
          questionsResult.rows
      });

    } catch (error) {

      try {
        await client.query(
          "ROLLBACK"
        );
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
        Number(
          req.params.attemptId
        );

      if (
        !Number.isInteger(attemptId)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "معرف المحاولة غير صحيح."
        });
      }

      const answers =
        Array.isArray(
          req.body.answers
        )
          ? req.body.answers
          : [];

      await client.query(
        "BEGIN"
      );

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

        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          success: false,
          message:
            "المحاولة غير موجودة."
        });
      }

      const attempt =
        attemptResult.rows[0];

      if (
        attempt.status !==
        "started"
      ) {

        await client.query(
          "ROLLBACK"
        );

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

          ORDER BY
            question_order ASC,
            id ASC
          `,
          [attempt.quiz_id]
        );

      const questions =
        questionsResult.rows;

      if (
        questions.length === 0
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          success: false,
          message:
            "لا توجد أسئلة لهذا الاختبار."
        });
      }

      if (
        answers.length !==
        questions.length
      ) {

        await client.query(
          "ROLLBACK"
        );

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

      for (
        const item of answers
      ) {

        const questionId =
          Number(
            item.question_id
          );

        const selected =
          String(
            item.selected_answer ||
            ""
          ).toUpperCase();

        if (
          !Number.isInteger(
            questionId
          ) ||
          ![
            "A",
            "B",
            "C",
            "D"
          ].includes(selected)
        ) {

          await client.query(
            "ROLLBACK"
          );

          return res.status(400).json({
            success: false,
            message:
              "يوجد جواب غير صحيح في البيانات المرسلة."
          });
        }

        if (
          answerMap.has(
            questionId
          )
        ) {

          await client.query(
            "ROLLBACK"
          );

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

      for (
        const question of questions
      ) {

        if (
          !answerMap.has(
            question.id
          )
        ) {

          await client.query(
            "ROLLBACK"
          );

          return res.status(400).json({
            success: false,
            message:
              "يجب الإجابة عن جميع الأسئلة."
          });
        }
      }

      let score = 0;

      const results = [];

      for (
        const question of questions
      ) {

        const selectedAnswer =
          answerMap.get(
            question.id
          );

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

          VALUES
          ($1, $2, $3, $4)

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
            (
              score /
              totalQuestions
            ) * 100
          ).toFixed(2)
        );

      const passingPercentage =
        Number(
          attempt.passing_percentage
        ) || 50;

      const passed =
        percentage >=
        passingPercentage;

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

      const quizLessonResult =
        await client.query(
          `
          SELECT lesson_id
          FROM quizzes
          WHERE id = $1
          `,
          [attempt.quiz_id]
        );

      if (
        quizLessonResult.rows.length >
          0 &&
        quizLessonResult.rows[0]
          .lesson_id
      ) {

        const lessonId =
          quizLessonResult
            .rows[0]
            .lesson_id;

        await client.query(
          `
          INSERT INTO lesson_progress
          (
            user_id,
            lesson_id,
            opened,
            completed,
            last_opened_at,
            completed_at,
            updated_at
          )

          VALUES
          (
            $1,
            $2,
            TRUE,
            TRUE,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )

          ON CONFLICT
          (user_id, lesson_id)

          DO UPDATE SET
            opened = TRUE,
            completed = TRUE,

            last_opened_at =
              CURRENT_TIMESTAMP,

            completed_at =
              COALESCE(
                lesson_progress.completed_at,
                CURRENT_TIMESTAMP
              ),

            updated_at =
              CURRENT_TIMESTAMP
          `,
          [
            req.user.id,
            lessonId
          ]
        );
      }

      await client.query(
        "COMMIT"
      );

      const totalLessonsResult =
        await pool.query(`
          SELECT COUNT(*)::int AS count
          FROM lessons
        `);

      const completedLessonsResult =
        await pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM lesson_progress
          WHERE user_id = $1
          AND completed = TRUE
          `,
          [req.user.id]
        );

      const completedQuizzesResult =
        await pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM quiz_attempts
          WHERE user_id = $1
          AND status = 'finished'
          `,
          [req.user.id]
        );

      const totalLessons =
        totalLessonsResult
          .rows[0]
          .count;

      const completedLessons =
        completedLessonsResult
          .rows[0]
          .count;

      const completedQuizzes =
        completedQuizzesResult
          .rows[0]
          .count;

      const overallPercentage =
        totalLessons > 0
          ? Math.round(
              (
                completedLessons /
                totalLessons
              ) * 100
            )
          : 0;

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

        progress: {
          completed_lessons:
            completedLessons,

          total_lessons:
            totalLessons,

          overall_percentage:
            overallPercentage,

          completed_quizzes:
            completedQuizzes
        },

        questions:
          results
      });

    } catch (error) {

      try {
        await client.query(
          "ROLLBACK"
        );
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
        Number(
          req.params.attemptId
        );

      if (
        !Number.isInteger(
          attemptId
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "معرف المحاولة غير صحيح."
        });
      }

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
        answersResult.rows.map(
          item => ({
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
          })
        );

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

          ORDER BY
            a.started_at DESC
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
// ADMIN - DASHBOARD
// =========================================================

app.get(
  "/api/admin/dashboard",
  requireAdmin,
  async (req, res) => {

    try {

      const students =
        await pool.query(`
          SELECT COUNT(*)::int AS count
          FROM users
        `);

      const subjects =
        await pool.query(`
          SELECT COUNT(*)::int AS count
          FROM subjects
        `);

      const units =
        await pool.query(`
          SELECT COUNT(*)::int AS count
          FROM units
        `);

      const lessons =
        await pool.query(`
          SELECT COUNT(*)::int AS count
          FROM lessons
        `);

      const subscriptions =
        await pool.query(`
          SELECT COUNT(*)::int AS count
          FROM unit_subscriptions
        `);

      const wallet =
        await pool.query(`
          SELECT
            COALESCE(
              SUM(wallet_balance),
              0
            ) AS total
          FROM users
        `);

      res.json({
        success: true,

        stats: {
          students:
            students.rows[0].count,

          subjects:
            subjects.rows[0].count,

          units:
            units.rows[0].count,

          lessons:
            lessons.rows[0].count,

          subscriptions:
            subscriptions.rows[0].count,

          total_wallet_balance:
            wallet.rows[0].total
        }
      });

    } catch (error) {

      console.error(
        "Admin dashboard error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "تعذر تحميل لوحة الإدارة."
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
