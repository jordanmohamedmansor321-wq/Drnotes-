const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();

const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// اختبار الـ API
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "DrNotes API is working 🚀"
  });
});

// تشغيل ملفات الموقع الحالية
app.use(express.static(path.join(__dirname)));

// الصفحة الرئيسية
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// تشغيل السيرفر
app.listen(PORT, "0.0.0.0", () => {
  console.log(`DrNotes server running on port ${PORT}`);
});
