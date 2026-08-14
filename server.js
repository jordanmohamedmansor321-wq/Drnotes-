const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'drnotes_secret_key_2026';

// Middlewares
app.use(cors());
app.use(express.json());

// PostgreSQL Connection Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Middleware for Auth Check (Optional & Mandatory)
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'غير مصرح: يرجى تسجيل الدخول' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'جلسة انتهت أو رمز غير صالح' });
    req.user = user;
    next();
  });
};

const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    req.user = null;
    return next();
  }
  jwt.verify(token, JWT_SECRET, (err, user) => {
    req.user = err ? null : user;
    next();
  });
};

// Database Initialization Helper
const initDb = async () => {
  const queryText = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(50) DEFAULT 'student',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      image_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS units (
      id SERIAL PRIMARY KEY,
      subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS lessons (
      id SERIAL PRIMARY KEY,
      unit_id INTEGER REFERENCES units(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS lesson_content (
      id SERIAL PRIMARY KEY,
      lesson_id INTEGER UNIQUE REFERENCES lessons(id) ON DELETE CASCADE,
      youtube_url TEXT,
      pdf_url TEXT,
      text_content TEXT
    );

    CREATE TABLE IF NOT EXISTS lesson_solution (
      id SERIAL PRIMARY KEY,
      lesson_id INTEGER UNIQUE REFERENCES lessons(id) ON DELETE CASCADE,
      youtube_url TEXT,
      pdf_url TEXT,
      text_content TEXT
    );

    CREATE TABLE IF NOT EXISTS quizzes (
      id SERIAL PRIMARY KEY,
      lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      pass_score INTEGER DEFAULT 50,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quiz_questions (
      id SERIAL PRIMARY KEY,
      quiz_id INTEGER REFERENCES quizzes(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      option_a VARCHAR(255) NOT NULL,
      option_b VARCHAR(255) NOT NULL,
      option_c VARCHAR(255) NOT NULL,
      option_d VARCHAR(255) NOT NULL,
      correct_option CHAR(1) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      quiz_id INTEGER REFERENCES quizzes(id) ON DELETE CASCADE,
      score INTEGER NOT NULL,
      total INTEGER NOT NULL,
      passed BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await pool.query(queryText);
    console.log('✅ تم التحقق من جداول قاعدة البيانات بنجاح.');
  } catch (err) {
    console.error('❌ خطأ في تهيئة قاعدة البيانات:', err.message);
  }
};

initDb();

// ------------------------------------
// 1. Auth Endpoints
// ------------------------------------

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const userRole = role === 'admin' ? 'admin' : 'student';
    const result = await pool.query(
      'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
      [name, email.toLowerCase(), hashedPassword, userRole]
    );

    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ message: 'تم إنشاء الحساب بنجاح', token, user });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'البريد الإلكتروني مستخدم بالفعل' });
    }
    res.status(500).json({ error: 'خطأ في السيرفر عند التسجيل' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'البريد والكلمة مطلوبين' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'بيانات الدخول غير صحيحة' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'بيانات الدخول غير صحيحة' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في السيرفر عند تسجيل الدخول' });
  }
});

// ------------------------------------
// 2. Public / Student Content Endpoints
// ------------------------------------

// Get All Subjects
app.get('/api/subjects', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM subjects ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'فشل جلب المواد' });
  }
});

// Get Units for a Subject
app.get('/api/subjects/:subjectId/units', async (req, res) => {
  const { subjectId } = req.params;
  try {
    const result = await pool.query('SELECT * FROM units WHERE subject_id = $1 ORDER BY id ASC', [subjectId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'فشل جلب الوحدات' });
  }
});

// Get Lessons for a Unit (مع فحص حالة القفل للطالب بناءً على الامتحانات)
app.get('/api/units/:unitId/lessons', optionalAuth, async (req, res) => {
  const { unitId } = req.params;
  const userId = req.user ? req.user.id : null;

  try {
    const lessonsRes = await pool.query('SELECT * FROM lessons WHERE unit_id = $1 ORDER BY id ASC', [unitId]);
    const lessons = lessonsRes.rows;

    if (lessons.length === 0) return res.json([]);

    // إذا لم يكن طالب مسجلاً الدخول، يفتح الدرس الأول فقط
    if (!userId) {
      const formatted = lessons.map((lesson, idx) => ({
        ...lesson,
        is_locked: idx !== 0
      }));
      return res.json(formatted);
    }

    // فحص الاجتازات السابقة للامتحانات للمستخدم
    const result = [];
    for (let i = 0; i < lessons.length; i++) {
      const currentLesson = lessons[i];
      
      if (i === 0) {
        // الدرس الأول مفتوح دائماً
        result.push({ ...currentLesson, is_locked: false });
      } else {
        // الدرس الحالي يتطلب اجتياز امتحان الدرس السابق
        const previousLessonId = lessons[i - 1].id;
        
        // جلب امتحان الدرس السابق
        const quizRes = await pool.query('SELECT id FROM quizzes WHERE lesson_id = $1 LIMIT 1', [previousLessonId]);
        
        if (quizRes.rows.length === 0) {
          // إذا لم يكن هناك امتحان للدرس السابق، يفتح التلقائي
          result.push({ ...currentLesson, is_locked: false });
        } else {
          const quizId = quizRes.rows[0].id;
          // التحقق مما إذا حل الطالب هذا الامتحان بنجاح
          const attemptRes = await pool.query(
            'SELECT passed FROM quiz_attempts WHERE user_id = $1 AND quiz_id = $2 AND passed = true LIMIT 1',
            [userId, quizId]
          );

          const isPassed = attemptRes.rows.length > 0;
          result.push({ ...currentLesson, is_locked: !isPassed });
        }
      }
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'فشل جلب الدروس' });
  }
});

// Get Lesson Details with Content & Solution
app.get('/api/lessons/:lessonId', async (req, res) => {
  const { lessonId } = req.params;
  try {
    const lessonRes = await pool.query('SELECT * FROM lessons WHERE id = $1', [lessonId]);
    if (lessonRes.rows.length === 0) {
      return res.status(404).json({ error: 'الدرس غير موجود' });
    }

    const contentRes = await pool.query('SELECT * FROM lesson_content WHERE lesson_id = $1', [lessonId]);
    const solutionRes = await pool.query('SELECT * FROM lesson_solution WHERE lesson_id = $1', [lessonId]);

    res.json({
      lesson: lessonRes.rows[0],
      content: contentRes.rows[0] || null,
      solution: solutionRes.rows[0] || null
    });
  } catch (err) {
    res.status(500).json({ error: 'فشل جلب تفاصيل الدرس' });
  }
});

// ------------------------------------
// 3. Admin Endpoints (Manage Courses)
// ------------------------------------

// Add Subject
app.post('/api/admin/subjects', async (req, res) => {
  const { name, description, image_url } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم المادة مطلوب' });

  try {
    const result = await pool.query(
      'INSERT INTO subjects (name, description, image_url) VALUES ($1, $2, $3) RETURNING *',
      [name, description || '', image_url || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'فشل إضافة المادة' });
  }
});

// Add Unit
app.post('/api/admin/units', async (req, res) => {
  const { subject_id, title, description } = req.body;
  if (!subject_id || !title) {
    return res.status(400).json({ error: 'معرف المادة وعنوان الوحدة مطلوبين' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO units (subject_id, title, description) VALUES ($1, $2, $3) RETURNING *',
      [subject_id, title, description || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'فشل إضافة الوحدة' });
  }
});

// Add Lesson
app.post('/api/admin/lessons', async (req, res) => {
  const { unit_id, title } = req.body;
  if (!unit_id || !title) {
    return res.status(400).json({ error: 'معرف الوحدة وعنوان الدرس مطلوبين' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO lessons (unit_id, title) VALUES ($1, $2) RETURNING *',
      [unit_id, title]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'فشل إضافة الدرس' });
  }
});

// Fetch Content & Solution for Admin Editor
app.get('/api/admin/lessons/:lessonId/content', async (req, res) => {
  const { lessonId } = req.params;
  try {
    const contentRes = await pool.query('SELECT * FROM lesson_content WHERE lesson_id = $1', [lessonId]);
    const solutionRes = await pool.query('SELECT * FROM lesson_solution WHERE lesson_id = $1', [lessonId]);

    res.json({
      content: contentRes.rows[0] || { youtube_url: '', pdf_url: '', text_content: '' },
      solution: solutionRes.rows[0] || { youtube_url: '', pdf_url: '', text_content: '' }
    });
  } catch (err) {
    res.status(500).json({ error: 'فشل جلب بيانات محتوى الدرس' });
  }
});

// Save/Update Lesson Content & Solution
app.post('/api/admin/lessons/:lessonId/content', async (req, res) => {
  const { lessonId } = req.params;
  const { content, solution } = req.body;

  try {
    if (content) {
      await pool.query(
        `INSERT INTO lesson_content (lesson_id, youtube_url, pdf_url, text_content)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (lesson_id)
         DO UPDATE SET youtube_url = $2, pdf_url = $3, text_content = $4`,
        [lessonId, content.youtube_url || '', content.pdf_url || '', content.text_content || '']
      );
    }

    if (solution) {
      await pool.query(
        `INSERT INTO lesson_solution (lesson_id, youtube_url, pdf_url, text_content)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (lesson_id)
         DO UPDATE SET youtube_url = $2, pdf_url = $3, text_content = $4`,
        [lessonId, solution.youtube_url || '', solution.pdf_url || '', solution.text_content || '']
      );
    }

    res.json({ message: 'تم حفظ محتوى الدرس والحل بنجاح' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'فشل حفظ محتوى الدرس' });
  }
});

// ------------------------------------
// 4. Quizzes Endpoints & Attempt Submissions
// ------------------------------------

app.get('/api/lessons/:lessonId/quizzes', async (req, res) => {
  const { lessonId } = req.params;
  try {
    const quizzesRes = await pool.query('SELECT * FROM quizzes WHERE lesson_id = $1', [lessonId]);
    res.json(quizzesRes.rows);
  } catch (err) {
    res.status(500).json({ error: 'فشل جلب الاختبارات' });
  }
});

app.get('/api/quizzes/:quizId/questions', async (req, res) => {
  const { quizId } = req.params;
  try {
    const questionsRes = await pool.query('SELECT id, quiz_id, question, option_a, option_b, option_c, option_d FROM quiz_questions WHERE quiz_id = $1', [quizId]);
    res.json(questionsRes.rows);
  } catch (err) {
    res.status(500).json({ error: 'فشل جلب أسئلة الاختبار' });
  }
});

// تسليم نموذج إجابة الاختبار واحتساب الفتح التلقائي للدرس التالي
app.post('/api/quizzes/:quizId/submit', authenticateToken, async (req, res) => {
  const { quizId } = req.params;
  const { answers } = req.body; // { questionId: "A", ... }
  const userId = req.user.id;

  try {
    const questionsRes = await pool.query('SELECT id, correct_option FROM quiz_questions WHERE quiz_id = $1', [quizId]);
    const questions = questionsRes.rows;

    let score = 0;
    const total = questions.length;

    questions.forEach(q => {
      if (answers[q.id] && answers[q.id].toUpperCase() === q.correct_option.toUpperCase()) {
        score++;
      }
    });

    const percentage = total > 0 ? (score / total) * 100 : 0;
    const passed = percentage >= 50; // نسبة النجاح المطلوبة لفتح الدرس التالي (50%)

    const attemptRes = await pool.query(
      'INSERT INTO quiz_attempts (user_id, quiz_id, score, total, passed) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [userId, quizId, score, total, passed]
    );

    res.json({
      message: passed ? 'مبروك! لقد اجتزت الاختبار وتم فتح الدرس التالي.' : 'لم تجتاز الاختبار بحد أدنى 50%، يرجى المحاولة مجدداً.',
      score,
      total,
      percentage,
      passed
    });
  } catch (err) {
    res.status(500).json({ error: 'فشل إرسال إجابات الاختبار' });
  }
});

// Root Route Check
app.get('/', (req, res) => {
  res.send('DrNotes API Server with Automatic Locking is up and running!');
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
