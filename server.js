const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'drnotes_secret_key_2026';

// ----------------------------------------------------
// Database Connection & Initialization
// ----------------------------------------------------
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
    try {
        // 1. جدول المستخدمين (الطلاب والأدمن)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                fullname VARCHAR(255) NOT NULL,
                username VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(20) DEFAULT 'student',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. جدول الدروس (شامل جزئية الشرح والحل)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS lessons (
                id SERIAL PRIMARY KEY,
                subject_name VARCHAR(100) NOT NULL,
                unit_name VARCHAR(150) NOT NULL,
                lesson_name VARCHAR(150) NOT NULL,
                video_url TEXT,
                pdf_url TEXT,
                solution_video_url TEXT,
                solution_pdf_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(subject_name, unit_name, lesson_name)
            );
        `);

        // 3. جدول الامتحانات (Quizzes)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS quizzes (
                id SERIAL PRIMARY KEY,
                lesson_id INT REFERENCES lessons(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                pass_score INT DEFAULT 50,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 4. جدول أسئلة الكويز
        await pool.query(`
            CREATE TABLE IF NOT EXISTS quiz_questions (
                id SERIAL PRIMARY KEY,
                quiz_id INT REFERENCES quizzes(id) ON DELETE CASCADE,
                question_text TEXT NOT NULL,
                option_a TEXT NOT NULL,
                option_b TEXT NOT NULL,
                option_c TEXT NOT NULL,
                option_d TEXT NOT NULL,
                correct_option CHAR(1) NOT NULL
            );
        `);

        // 5. جدول محاولات واجتياز الكويزات للطالب
        await pool.query(`
            CREATE TABLE IF NOT EXISTS quiz_attempts (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                quiz_id INT REFERENCES quizzes(id) ON DELETE CASCADE,
                score INT NOT NULL,
                passed BOOLEAN DEFAULT FALSE,
                attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log("✅ Database initialized successfully!");
    } catch (err) {
        console.error("❌ Database initialization error:", err);
    }
}

initDB();

// ----------------------------------------------------
// Middlewares
// ----------------------------------------------------
function verifyToken(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ error: 'لم يتم توفير رمز التوثيق' });

    const bearer = token.split(' ')[1] || token;
    jwt.verify(bearer, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'جلسة غير صالحة أو منتهية' });
        req.user = decoded;
        next();
    });
}

function verifyAdmin(req, res, next) {
    verifyToken(req, res, () => {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'غير مصرح لك بالوصول، هذه المنطقة للمدير فقط' });
        }
        next();
    });
}

// ----------------------------------------------------
// Authentication Routes
// ----------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
    const { fullname, username, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (fullname, username, password, role) VALUES ($1, $2, $3, $4) RETURNING id, fullname, username, role',
            [fullname, username, hashedPassword, 'student']
        );
        res.status(201).json({ message: 'تم إنشاء حساب الطالب بنجاح', user: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ error: 'اسم المستخدم مستخدم بالفعل' });
        }
        res.status(500).json({ error: 'خطأ أثناء إنشاء الحساب' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) return res.status(400).json({ error: 'بيانات الدخول غير صحيحة' });

        const user = result.rows[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: 'بيانات الدخول غير صحيحة' });

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ message: 'تم تسجيل الدخول بنجاح', token, role: user.role, fullname: user.fullname });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في عملية تسجيل الدخول' });
    }
});

// ----------------------------------------------------
// Public / Shared Routes (المواد، الوحدات، الدروس)
// ----------------------------------------------------

// جلب جميع المواد المتاحة واجهة الطالب/الأدمن
app.get('/api/subjects', async (req, res) => {
    try {
        const result = await pool.query('SELECT DISTINCT subject_name FROM lessons ORDER BY subject_name ASC');
        let subjects = result.rows.map(row => row.subject_name);
        
        // إذا كانت قاعدة البيانات فارغة، ارجاع مواد افتراضية
        if (subjects.length === 0) {
            subjects = ['الأحياء', 'الكيمياء', 'الفيزياء'];
        }
        res.json(subjects);
    } catch (err) {
        res.status(500).json({ error: 'خطأ أثناء جلب قائمة المواد' });
    }
});

// جلب الوحدات التابعة لمادة معينة
app.get('/api/subjects/:subject/units', async (req, res) => {
    const { subject } = req.params;
    try {
        const result = await pool.query(
            'SELECT DISTINCT unit_name FROM lessons WHERE subject_name = $1 ORDER BY unit_name ASC',
            [subject]
        );
        res.json(result.rows.map(r => r.unit_name));
    } catch (err) {
        res.status(500).json({ error: 'خطأ أثناء جلب الوحدات' });
    }
});

// جلب الدروس التابعة لمادة ووحدة معينة
app.get('/api/subjects/:subject/units/:unit/lessons', async (req, res) => {
    const { subject, unit } = req.params;
    try {
        const result = await pool.query(
            'SELECT id, lesson_name, video_url, pdf_url, solution_video_url, solution_pdf_url FROM lessons WHERE subject_name = $1 AND unit_name = $2 ORDER BY id ASC',
            [subject, unit]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'خطأ أثناء جلب الدروس' });
    }
});

// جلب تفاصيل درس معين بجميع أقسامه
app.get('/api/lessons/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const lessonRes = await pool.query('SELECT * FROM lessons WHERE id = $1', [id]);
        if (lessonRes.rows.length === 0) return res.status(404).json({ error: 'الدرس غير موجود' });

        const quizRes = await pool.query('SELECT id, title, pass_score FROM quizzes WHERE lesson_id = $1', [id]);
        
        res.json({
            lesson: lessonRes.rows[0],
            quiz: quizRes.rows[0] || null
        });
    } catch (err) {
        res.status(500).json({ error: 'خطأ أثناء تحميل بيانات الدرس' });
    }
});

// ----------------------------------------------------
// Quiz & Progression Routes (الكويز وقفل الدرس التالي)
// ----------------------------------------------------

// جلب أسئلة الكويز الخاص بدرس معين
app.get('/api/quiz/:quizId', verifyToken, async (req, res) => {
    const { quizId } = req.params;
    try {
        const quizRes = await pool.query('SELECT * FROM quizzes WHERE id = $1', [quizId]);
        if (quizRes.rows.length === 0) return res.status(404).json({ error: 'الكويز غير موجود' });

        const questionsRes = await pool.query('SELECT id, question_text, option_a, option_b, option_c, option_d FROM quiz_questions WHERE quiz_id = $1', [quizId]);
        
        res.json({
            quiz: quizRes.rows[0],
            questions: questionsRes.rows
        });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في جلب بيانات الكويز' });
    }
});

// إرسال حل الكويز وفحص الاجتياز
app.post('/api/quiz/:quizId/submit', verifyToken, async (req, res) => {
    const { quizId } = req.params;
    const { answers } = req.body; // { question_id: 'a', ... }
    const userId = req.user.id;

    try {
        const questionsRes = await pool.query('SELECT id, correct_option FROM quiz_questions WHERE quiz_id = $1', [quizId]);
        const quizRes = await pool.query('SELECT pass_score FROM quizzes WHERE id = $1', [quizId]);

        if (questionsRes.rows.length === 0) {
            return res.status(400).json({ error: 'لا توجد أسئلة لهذا الامتحان' });
        }

        let correctCount = 0;
        const total = questionsRes.rows.length;

        questionsRes.rows.forEach(q => {
            if (answers[q.id] && answers[q.id].toLowerCase() === q.correct_option.toLowerCase()) {
                correctCount++;
            }
        });

        const scorePercent = Math.round((correctCount / total) * 100);
        const passScore = quizRes.rows[0]?.pass_score || 50;
        const passed = scorePercent >= passScore;

        await pool.query(
            'INSERT INTO quiz_attempts (user_id, quiz_id, score, passed) VALUES ($1, $2, $3, $4)',
            [userId, quizId, scorePercent, passed]
        );

        res.json({
            score: scorePercent,
            passed,
            message: passed ? '🎉 مبروك! لقد اجتزت الامتحان بنجاح وتم فتح الدرس التالي.' : '❌ لم تتجاوز نسبة النجاح المطلوبة، حاول مرة أخرى.'
        });
    } catch (err) {
        res.status(500).json({ error: 'خطأ أثناء تقييم الإجابات' });
    }
});

// التحقق من حالة فتح الدرس التالي للطالب
app.get('/api/lessons/:lessonId/access-status', verifyToken, async (req, res) => {
    const { lessonId } = req.params;
    const userId = req.user.id;

    try {
        // معرفة ترتيب الدرس الحالي
        const currentLessonRes = await pool.query('SELECT * FROM lessons WHERE id = $1', [lessonId]);
        if (currentLessonRes.rows.length === 0) return res.status(404).json({ error: 'الدرس غير موجود' });

        const currentLesson = currentLessonRes.rows[0];

        // جلب الدرس السابق في نفس الوحدة والمادة
        const prevLessonRes = await pool.query(
            'SELECT id FROM lessons WHERE subject_name = $1 AND unit_name = $2 AND id < $3 ORDER BY id DESC LIMIT 1',
            [currentLesson.subject_name, currentLesson.unit_name, lessonId]
        );

        // إذا لم يكن هناك درس سابق، فالدرس مفتوح مباشرة
        if (prevLessonRes.rows.length === 0) {
            return res.json({ unlocked: true });
        }

        const prevLessonId = prevLessonRes.rows[0].id;

        // التحقق مما إذا كان للدرس السابق كويز
        const prevQuizRes = await pool.query('SELECT id FROM quizzes WHERE lesson_id = $1', [prevLessonId]);
        if (prevQuizRes.rows.length === 0) {
            return res.json({ unlocked: true }); // لا يوجد كويز للدرس السابق، يفتح تلقائياً
        }

        const prevQuizId = prevQuizRes.rows[0].id;

        // التحقق هل قام الطالب باجتياز كويز الدرس السابق
        const attemptRes = await pool.query(
            'SELECT passed FROM quiz_attempts WHERE user_id = $1 AND quiz_id = $2 AND passed = TRUE LIMIT 1',
            [userId, prevQuizId]
        );

        const isUnlocked = attemptRes.rows.length > 0;
        res.json({ unlocked: isUnlocked });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في فحص صيانة قفل الدروس' });
    }
});

// ----------------------------------------------------
// Admin Routes (إدارة المحتوى والطلاب)
// ----------------------------------------------------

// حفظ أو تحديث درس كامل (شرح + حل)
app.post('/api/admin/lessons/save', verifyAdmin, async (req, res) => {
    const {
        subject_name,
        unit_name,
        lesson_name,
        video_url,
        pdf_url,
        solution_video_url,
        solution_pdf_url
    } = req.body;

    if (!subject_name || !unit_name || !lesson_name) {
        return res.status(400).json({ error: 'يرجى إدخال اسم المادة والوحدة والدرس' });
    }

    try {
        const query = `
            INSERT INTO lessons (subject_name, unit_name, lesson_name, video_url, pdf_url, solution_video_url, solution_pdf_url)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (subject_name, unit_name, lesson_name)
            DO UPDATE SET
                video_url = EXCLUDED.video_url,
                pdf_url = EXCLUDED.pdf_url,
                solution_video_url = EXCLUDED.solution_video_url,
                solution_pdf_url = EXCLUDED.solution_pdf_url
            RETURNING *;
        `;
        const result = await pool.query(query, [
            subject_name, unit_name, lesson_name,
            video_url || null, pdf_url || null,
            solution_video_url || null, solution_pdf_url || null
        ]);

        res.json({ message: 'تم حفظ وتحديث الدرس بنجاح', lesson: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'خطأ أثناء حفظ بيانات الدرس' });
    }
});

// حفظ الكويز والأسئلة لدرس معين
app.post('/api/admin/quiz/save', verifyAdmin, async (req, res) => {
    const { lesson_id, title, pass_score, questions } = req.body;

    if (!lesson_id || !questions || !Array.isArray(questions)) {
        return res.status(400).json({ error: 'بيانات الامتحان غير مكتملة' });
    }

    try {
        // إنشاء الكويز أو جلب الكويز الحالي للدرس
        let quizRes = await pool.query('SELECT id FROM quizzes WHERE lesson_id = $1', [lesson_id]);
        let quizId;

        if (quizRes.rows.length === 0) {
            const newQuiz = await pool.query(
                'INSERT INTO quizzes (lesson_id, title, pass_score) VALUES ($1, $2, $3) RETURNING id',
                [lesson_id, title || 'امتحان الدرس', pass_score || 50]
            );
            quizId = newQuiz.rows[0].id;
        } else {
            quizId = quizRes.rows[0].id;
            await pool.query('UPDATE quizzes SET title = $1, pass_score = $2 WHERE id = $3', [title || 'امتحان الدرس', pass_score || 50, quizId]);
            // مسح الأسئلة القديمة وإعادة إدراج الجديدة
            await pool.query('DELETE FROM quiz_questions WHERE quiz_id = $1', [quizId]);
        }

        // إضافة الأسئلة
        for (const q of questions) {
            await pool.query(
                'INSERT INTO quiz_questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                [quizId, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option]
            );
        }

        res.json({ message: 'تم حفظ أسئلة الامتحان بنجاح', quizId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'خطأ أثناء حفظ أسئلة الامتحان' });
    }
});

// جلب قائمة جميع الطلاب للمدير
app.get('/api/admin/students', verifyAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, fullname, username, created_at FROM users WHERE role = $1 ORDER BY id DESC',
            ['student']
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'خطأ أثناء جلب قائمة الطلاب' });
    }
});

// حذف طالب من قبل الأدمن
app.delete('/api/admin/students/:id', verifyAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM users WHERE id = $1 AND role = $2', [id, 'student']);
        res.json({ message: 'تم حذف الطالب بنجاح' });
    } catch (err) {
        res.status(500).json({ error: 'خطأ أثناء حذف الطالب' });
    }
});

// ----------------------------------------------------
// Fallback Route & Server Start
// ----------------------------------------------------
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
