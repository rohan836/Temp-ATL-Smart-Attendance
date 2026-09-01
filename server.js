import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = "0.0.0.0";

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Disable caching for live terminal & dynamic changes
app.use((req, res, next) => {
  const p = req.path;
  if (p === "/" || p.endsWith(".html") || p.endsWith(".css") || p.endsWith(".js") || p.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

// Configure upload storage for images
const uploadDir = path.join(__dirname, "assets", "images", "students");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 2 * 1024 * 1024 }
});

// Timezone & Clock Helpers (IST = UTC + 5:30)
function getISTDateObj() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 5.5 * 3600000);
}

function todayIST() {
  const ist = getISTDateObj();
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, "0");
  const d = String(ist.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function nowTimeIST() {
  const ist = getISTDateObj();
  const hh = String(ist.getHours()).padStart(2, "0");
  const mm = String(ist.getMinutes()).padStart(2, "0");
  const ss = String(ist.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function nowIST() {
  const ist = getISTDateObj();
  return ist.toISOString();
}

function validateClock() {
  return { ok: true, msg: "Clock valid" };
}

// In-Memory Database
const defaultSettings = {
  schoolName: "ATL Model School",
  region: "Maharashtra",
  academicYear: "2026-27",
  schoolOpeningDate: "2026-06-15",
  attendanceStartDate: "2026-06-15",
  presentCutoff: "08:00",
  lateCutoff: "08:30",
  halfDayCutoff: "10:00",
  minPercent: 75,
  trajectoryLabels: "Jun,Jul,Aug,Sep,Oct,Nov,Dec,Jan,Feb,Mar,Apr",
  classes: ["Grade 10-A", "Grade 10-B", "Grade 9-A", "Grade 12-C"],
  batches: ["Morning", "Afternoon", "Robotics Batch A"],
  classSchedules: {},
  batchSchedules: {},
  schoolLogo: "assets/images/admin/logo.svg",
  planetImage: "assets/images/admin/planet.svg",
  heroImage: "",
  sensor: "sim",
  uart: "/dev/serial0",
  baud: 9600,
  adminPin: "",
  workingDays: { "0": false, "1": true, "2": true, "3": true, "4": true, "5": true, "6": true },
  holidays: [],
  overrides: [],
  imageGallery: []
};

let settings = { ...defaultSettings };
let nextStudentId = 1;
let nextSeq = 1;

let students = [
  {
    id: 1,
    name: "Aarav Sharma",
    roll: "10A-01",
    grade: "Grade 10-A",
    batch: "Morning",
    section: "A",
    parent: "Rajesh Sharma",
    phone: "9876543210",
    address: "B-102, Shanti Nagar, Mumbai",
    fingerId: 1,
    photo: "",
    active: 1,
    createdAt: "2026-06-15"
  },
  {
    id: 2,
    name: "Diya Patel",
    roll: "10A-02",
    grade: "Grade 10-A",
    batch: "Morning",
    section: "A",
    parent: "Kirit Patel",
    phone: "9823456789",
    address: "Flat 404, Green Heights, Pune",
    fingerId: 2,
    photo: "",
    active: 1,
    createdAt: "2026-06-15"
  },
  {
    id: 3,
    name: "Rohan Deshmukh",
    roll: "9A-01",
    grade: "Grade 9-A",
    batch: "Robotics Batch A",
    section: "A",
    parent: "Suresh Deshmukh",
    phone: "9811223344",
    address: "7, Shivaji Chowk, Nashik",
    fingerId: 3,
    photo: "",
    active: 1,
    createdAt: "2026-06-15"
  },
  {
    id: 4,
    name: "Ananya Iyer",
    roll: "12C-05",
    grade: "Grade 12-C",
    batch: "Afternoon",
    section: "C",
    parent: "Venkatesh Iyer",
    phone: "9899887766",
    address: "Plot 12, Lake View, Nagpur",
    fingerId: 4,
    photo: "",
    active: 1,
    createdAt: "2026-06-15"
  }
];
nextStudentId = 5;

let events = [];
let dailyMap = new Map(); // key: `${date}|${studentId}` -> daily record
let notifications = [];
let auditLogs = [];
let images = [];

let sensorProgress = {
  mode: "idle",
  step: 0,
  steps_total: 3,
  state: "idle",
  title: "",
  detail: "",
  timeout_sec: 0,
  deadline: 0,
  remain_sec: 0,
  finger: null,
  raw: "",
  text: ""
};

// Seed initial audit log
auditLogs.push({
  id: crypto.randomUUID(),
  at: nowIST(),
  action: "SYSTEM_INITIALIZED",
  details: "ATL Smart Attendance Service Started (Simulated Mode)"
});

// Scheduling & Validation Logic
function cleanWorkingDays(wd, defaults = null) {
  if (!wd || typeof wd !== "object") return { ...defaultSettings.workingDays };
  const base = defaults || { "0": false, "1": true, "2": true, "3": true, "4": true, "5": true, "6": true };
  const clean = {};
  for (let i = 0; i < 7; i++) {
    let v = wd[String(i)] !== undefined ? wd[String(i)] : wd[i];
    if (v === undefined) v = base[String(i)] !== undefined ? base[String(i)] : false;
    if (typeof v === "string") {
      clean[String(i)] = ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
    } else {
      clean[String(i)] = Boolean(v);
    }
  }
  return clean;
}

function parseHoliday(holidayStr) {
  const parts = String(holidayStr || "").split(":");
  const range = parts[0] ? parts[0].trim() : "";
  const kind = parts.length > 1 ? parts[1].trim().toLowerCase() : "holiday";
  if (range.includes("..")) {
    const [start, end] = range.split("..");
    return [start.trim(), end.trim(), kind];
  }
  return [range, range, kind];
}

function holidayContains(dateIso, start, end) {
  return dateIso >= start && dateIso <= end;
}

function overrideResult(dateIso, s) {
  for (const override of s.overrides || []) {
    let rawDate = "";
    let value = false;
    if (typeof override === "object" && override !== null) {
      rawDate = String(override.date || "").trim();
      const rawVal = override.working !== undefined ? override.working : override.value;
      if (typeof rawVal === "string") {
        value = ["1", "true", "yes", "on"].includes(rawVal.trim().toLowerCase());
      } else {
        value = Boolean(rawVal);
      }
    } else {
      const parts = String(override).split(":");
      rawDate = parts[0] ? parts[0].trim() : "";
      value = parts.length > 1 && ["1", "true", "yes", "on"].includes(parts[1].trim().toLowerCase());
    }
    if (rawDate === String(dateIso)) {
      return Boolean(value);
    }
  }
  return null;
}

function holidayResult(dateIso, s) {
  for (const holiday of s.holidays || []) {
    const [start, end, kind] = parseHoliday(holiday);
    if (holidayContains(dateIso, start, end)) {
      return kind === "exam"; // Exam days are working
    }
  }
  return null;
}

function isWorkingDay(dateIso, s) {
  const ov = overrideResult(dateIso, s);
  if (ov !== null) return ov;
  const hol = holidayResult(dateIso, s);
  if (hol !== null) return hol;

  try {
    const d = new Date(dateIso + "T00:00:00Z");
    const dayOfWeek = String(d.getUTCDay());
    const weekly = s.workingDays || defaultSettings.workingDays;
    return Boolean(weekly[dayOfWeek]);
  } catch {
    return false;
  }
}

function getWorkingDaysForStudent(student, s) {
  if (student) {
    const grade = (student.grade || student.class || "").trim();
    const batch = (student.batch || student.group || "").trim();
    const batchSchedules = s.batchSchedules || {};
    const classSchedules = s.classSchedules || {};

    if (grade && batch) {
      const key = `${grade}|${batch}`;
      if (batchSchedules[key]) {
        const v = batchSchedules[key];
        if (v && typeof v === "object" && v.workingDays) return v.workingDays;
        if (v && typeof v === "object") return v;
      }
    }
    if (batch && batchSchedules[batch]) {
      const v = batchSchedules[batch];
      if (v && typeof v === "object" && v.workingDays) return v.workingDays;
      if (v && typeof v === "object") return v;
    }
    if (grade && classSchedules[grade]) {
      const v = classSchedules[grade];
      if (v && typeof v === "object" && v.workingDays) return v.workingDays;
      if (v && typeof v === "object") return v;
    }
  }
  return s.workingDays || defaultSettings.workingDays;
}

function isStudentScheduled(dateIso, student, s) {
  const ov = overrideResult(dateIso, s);
  if (ov !== null) return ov;
  const hol = holidayResult(dateIso, s);
  if (hol !== null) return hol;

  try {
    const d = new Date(dateIso + "T00:00:00Z");
    const dayOfWeek = String(d.getUTCDay());
    const weekly = getWorkingDaysForStudent(student, s);
    return Boolean(weekly[dayOfWeek]);
  } catch {
    return false;
  }
}

function classifyTime(timeStr, s) {
  let p = s.presentCutoff || "08:00";
  if (p.length === 5) p += ":00";
  return timeStr <= p ? "PRESENT" : "LATE";
}

function ensureDaily(date, studentId) {
  const key = `${date}|${studentId}`;
  if (!dailyMap.has(key)) {
    const rec = {
      key,
      date,
      studentId,
      status: null,
      firstScan: null,
      lastScan: null
    };
    dailyMap.set(key, rec);
    return rec;
  }
  return dailyMap.get(key);
}

function nextFingerId() {
  const used = new Set(students.filter(s => s.active && s.fingerId !== null).map(s => s.fingerId));
  for (let i = 1; i <= 199; i++) {
    if (!used.has(i)) return i;
  }
  return null;
}

function publicSettings() {
  const s = { ...settings };
  delete s.sensor;
  delete s.uart;
  delete s.baud;
  delete s.db;
  delete s.host;
  delete s.port;
  delete s.imagesDir;
  return s;
}

// Compute student attendance rate
function getStudentAttendanceRate(studentId) {
  const s = settings;
  const start = s.attendanceStartDate || "2026-06-15";
  const end = todayIST();
  const stu = students.find(x => x.id === studentId);
  if (!stu) return 0;

  let totalScheduled = 0;
  let attended = 0;

  try {
    const curr = new Date(start + "T00:00:00Z");
    const endDate = new Date(end + "T00:00:00Z");
    while (curr <= endDate) {
      const iso = curr.toISOString().split("T")[0];
      if (isStudentScheduled(iso, stu, s)) {
        totalScheduled++;
        const rec = dailyMap.get(`${iso}|${studentId}`);
        if (rec && (rec.status === "PRESENT" || rec.status === "LATE")) {
          attended++;
        }
      }
      curr.setUTCDate(curr.getUTCDate() + 1);
    }
  } catch (e) {
    // fallback
  }

  return totalScheduled > 0 ? Math.round((attended / totalScheduled) * 100) : 0;
}

// Admin PIN helper
function requireAdmin(req, res, next) {
  const pin = settings.adminPin || process.env.ATL_ADMIN_PIN || "";
  if (!pin) return next();
  const got = (req.headers["x-admin-pin"] || req.query.pin || "").trim();
  if (got !== pin) {
    return res.status(401).json({ error: "admin pin required" });
  }
  next();
}

// --- API Endpoints ---

// 1. Health
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    status: "ok",
    sensor: "sim",
    sensor_detail: "Simulated sensor active in AI Studio Web environment",
    clock: nowIST(),
    db: "in-memory",
    db_ok: true,
    imagesDir: "assets/images/students",
    sensor_mode: "sim",
    settings: publicSettings()
  });
});

// 2. Settings
app.get("/api/settings", (req, res) => {
  res.json(publicSettings());
});

app.post("/api/settings", (req, res) => {
  const body = req.body || {};
  const whitelist = [
    "schoolName", "address", "region", "academicYear", "schoolOpeningDate",
    "attendanceStartDate", "presentCutoff", "lateCutoff", "halfDayCutoff", "minPercent",
    "classes", "batches", "holidays", "overrides", "workingDays",
    "classSchedules", "batchSchedules", "schoolLogo", "planetImage",
    "heroImage", "imageGallery", "trajectoryLabels"
  ];

  for (const k of whitelist) {
    if (body[k] !== undefined) {
      if (k === "workingDays") {
        settings.workingDays = cleanWorkingDays(body.workingDays, settings.workingDays);
      } else {
        settings[k] = body[k];
      }
    }
  }

  auditLogs.push({
    id: crypto.randomUUID(),
    at: nowIST(),
    action: "SETTINGS_UPDATED",
    details: "School settings updated"
  });

  res.json(publicSettings());
});

// Class Management endpoints
app.post("/api/classes", (req, res) => {
  const name = (req.body && req.body.name ? req.body.name : "").trim();
  if (!name) {
    return res.status(400).json({ error: "Class name is required" });
  }
  if (!settings.classes) settings.classes = [];
  if (settings.classes.some(c => c.toLowerCase() === name.toLowerCase())) {
    return res.status(400).json({ error: "Class already exists" });
  }
  settings.classes.push(name);
  auditLogs.push({
    id: crypto.randomUUID(),
    at: nowIST(),
    action: "CLASS_CREATED",
    details: `Added class ${name}`
  });
  res.status(201).json({ ok: true, name, classes: settings.classes });
});

app.delete("/api/classes/:name", (req, res) => {
  const className = decodeURIComponent(req.params.name || "").trim();
  if (!className) {
    return res.status(400).json({ error: "Class name is required" });
  }
  const assigned = students.filter(s => s.active && (s.grade || "").toLowerCase() === className.toLowerCase());
  if (assigned.length > 0) {
    return res.status(400).json({
      error: "Cannot delete class with active enrollments. Please reassign or delete the students in this class first.",
      studentsCount: assigned.length
    });
  }

  const beforeLen = (settings.classes || []).length;
  settings.classes = (settings.classes || []).filter(c => c.toLowerCase() !== className.toLowerCase());
  if (settings.classSchedules && settings.classSchedules[className]) {
    delete settings.classSchedules[className];
  }

  auditLogs.push({
    id: crypto.randomUUID(),
    at: nowIST(),
    action: "CLASS_DELETED",
    details: `Deleted class ${className}`
  });

  res.json({ ok: true, name: className, classes: settings.classes, removed: beforeLen !== settings.classes.length });
});

// 3. Students
app.get("/api/students", (req, res) => {
  const q = (req.query.q || "").toLowerCase().trim();
  const cls = (req.query.class || req.query.grade || "").toLowerCase().trim();
  const activeParam = req.query.active;

  let list = students.filter(s => {
    if (activeParam !== "all" && !s.active) return false;
    if (cls && (s.grade || "").toLowerCase() !== cls) return false;
    if (q) {
      const match = (s.name || "").toLowerCase().includes(q) ||
                    (s.roll || "").toLowerCase().includes(q) ||
                    (s.phone || "").includes(q);
      if (!match) return false;
    }
    return true;
  });

  const withRates = list.map(s => ({
    ...s,
    attendance_rate: getStudentAttendanceRate(s.id)
  }));

  res.json(withRates);
});

app.post("/api/students", (req, res) => {
  const { name, roll, grade, batch, section, parent, phone, address, photo, fingerId } = req.body || {};

  if (!name || name.trim().length < 1 || name.length > 80) {
    return res.status(400).json({ error: "name required (1-80 chars)" });
  }
  if (!roll || roll.trim().length < 1 || roll.length > 20) {
    return res.status(400).json({ error: "roll required (1-20 chars)" });
  }
  if (!grade || grade.trim().length < 1) {
    return res.status(400).json({ error: "grade/class required" });
  }

  const cleanRoll = roll.trim().toLowerCase();
  const dup = students.find(s => s.active && s.roll.toLowerCase() === cleanRoll);
  if (dup) {
    return res.status(400).json({ error: "roll number already in use" });
  }

  // Auto-add class/batch to settings if new
  if (grade && !settings.classes.includes(grade.trim())) {
    settings.classes.push(grade.trim());
  }
  if (batch && batch.trim() && !settings.batches.includes(batch.trim())) {
    settings.batches.push(batch.trim());
  }

  let fid = fingerId !== undefined && fingerId !== null ? parseInt(fingerId, 10) : nextFingerId();
  if (isNaN(fid)) fid = nextFingerId();

  const newStudent = {
    id: nextStudentId++,
    name: name.trim(),
    roll: roll.trim(),
    grade: grade.trim(),
    batch: (batch || "").trim(),
    section: (section || "").trim(),
    parent: (parent || "").trim(),
    phone: (phone || "").trim(),
    address: (address || "").trim(),
    fingerId: fid,
    photo: photo || "",
    active: 1,
    createdAt: todayIST()
  };

  students.push(newStudent);

  auditLogs.push({
    id: crypto.randomUUID(),
    at: nowIST(),
    action: "STUDENT_CREATED",
    details: `${newStudent.name} (${newStudent.roll}) enrolled in ${newStudent.grade}`
  });

  res.status(201).json(newStudent);
});

app.get("/api/students/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const stu = students.find(s => s.id === id);
  if (!stu) return res.status(404).json({ error: "not found" });

  const stuEvents = events.filter(e => e.studentId === id).slice(-500);
  const stuDaily = Array.from(dailyMap.values()).filter(d => d.studentId === id).slice(-500);

  let present = 0, late = 0, duplicate = 0, unknown = 0;
  for (const e of stuEvents) {
    if (e.status === "PRESENT") present++;
    else if (e.status === "LATE") late++;
    else if (e.status === "DUPLICATE") duplicate++;
    else if (e.status === "UNKNOWN") unknown++;
  }

  res.json({
    ...stu,
    attendance_rate: getStudentAttendanceRate(id),
    events: stuEvents,
    daily: stuDaily,
    stats: { present, late, duplicate, unknown }
  });
});

app.patch("/api/students/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const stu = students.find(s => s.id === id);
  if (!stu) return res.status(404).json({ error: "not found" });

  const body = req.body || {};
  const allowed = ["photo", "phone", "address", "name", "roll", "grade", "batch", "section", "parent", "active"];

  if (body.roll && body.roll.trim().toLowerCase() !== stu.roll.toLowerCase()) {
    const dup = students.find(s => s.id !== id && s.active && s.roll.toLowerCase() === body.roll.trim().toLowerCase());
    if (dup) return res.status(400).json({ error: "roll number already in use" });
  }

  for (const k of allowed) {
    if (body[k] !== undefined) {
      stu[k] = body[k];
    }
  }

  if (stu.grade && !settings.classes.includes(stu.grade)) {
    settings.classes.push(stu.grade);
  }
  if (stu.batch && !settings.batches.includes(stu.batch)) {
    settings.batches.push(stu.batch);
  }

  auditLogs.push({
    id: crypto.randomUUID(),
    at: nowIST(),
    action: "STUDENT_UPDATED",
    details: `Updated info for ${stu.name}`
  });

  res.json(stu);
});

app.delete("/api/students/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const permanent = req.query.permanent === "true" || req.query.permanent === "1";
  const idx = students.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ error: "not found" });
  const stu = students[idx];

  if (permanent) {
    students.splice(idx, 1);
    auditLogs.push({
      id: crypto.randomUUID(),
      at: nowIST(),
      action: "STUDENT_PERMANENTLY_DELETED",
      details: `Permanently deleted ${stu.name} (id ${id})`
    });
  } else {
    stu.active = 0;
    stu.fingerId = null;
    stu.roll = `${stu.roll}#d${id}`;

    auditLogs.push({
      id: crypto.randomUUID(),
      at: nowIST(),
      action: "STUDENT_DELETED",
      details: `Deleted ${stu.name} (id ${id})`
    });
  }

  res.json({ ok: true, id, permanent });
});

// 4. Enroll & Re-enroll
app.post("/api/students/:id/reenroll", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const stu = students.find(s => s.id === id);
  if (!stu) return res.status(404).json({ error: "not found" });

  const newFid = nextFingerId();
  stu.fingerId = newFid;

  sensorProgress = {
    mode: "enroll",
    step: 3,
    steps_total: 3,
    state: "success",
    title: "Fingerprint re-enrolled",
    detail: "New fingerprint slot assigned successfully",
    timeout_sec: 0,
    deadline: 0,
    remain_sec: 0,
    finger: newFid,
    raw: "OK",
    text: "Fingerprint re-enrolled"
  };

  auditLogs.push({
    id: crypto.randomUUID(),
    at: nowIST(),
    action: "STUDENT_REENROLLED",
    details: `${stu.name} re-enrolled with finger #${newFid}`
  });

  res.json({ ok: true, fingerId: newFid });
});

app.post("/api/enroll", (req, res) => {
  const { name, roll, grade, batch, section, parent, phone, address, photo } = req.body || {};

  if (!name || name.trim().length < 1 || name.length > 80) {
    return res.status(400).json({ error: "name required (1-80 chars)" });
  }
  if (!roll || roll.trim().length < 1 || roll.length > 20) {
    return res.status(400).json({ error: "roll required (1-20 chars)" });
  }
  if (!grade || grade.trim().length < 1) {
    return res.status(400).json({ error: "grade/class required" });
  }

  const cleanRoll = roll.trim().toLowerCase();
  const dup = students.find(s => s.active && s.roll.toLowerCase() === cleanRoll);
  if (dup) {
    return res.status(400).json({ error: "roll number already in use" });
  }

  const fid = nextFingerId();
  if (grade && !settings.classes.includes(grade.trim())) {
    settings.classes.push(grade.trim());
  }
  if (batch && batch.trim() && !settings.batches.includes(batch.trim())) {
    settings.batches.push(batch.trim());
  }

  const newStudent = {
    id: nextStudentId++,
    name: name.trim(),
    roll: roll.trim(),
    grade: grade.trim(),
    batch: (batch || "").trim(),
    section: (section || "").trim(),
    parent: (parent || "").trim(),
    phone: (phone || "").trim(),
    address: (address || "").trim(),
    fingerId: fid,
    photo: photo || "",
    active: 1,
    createdAt: todayIST()
  };

  students.push(newStudent);

  sensorProgress = {
    mode: "enroll",
    step: 3,
    steps_total: 3,
    state: "success",
    title: "Fingerprint enrolled",
    detail: "Saved in system memory",
    timeout_sec: 0,
    deadline: 0,
    remain_sec: 0,
    finger: fid,
    raw: "OK",
    text: "Fingerprint enrolled"
  };

  auditLogs.push({
    id: crypto.randomUUID(),
    at: nowIST(),
    action: "STUDENT_ENROLLED",
    details: `${newStudent.name} -> ${newStudent.grade} #${fid}`
  });

  res.json({ id: newStudent.id, fingerId: fid, grade: newStudent.grade });
});

// Sensor progress
app.get(["/api/sensor/progress", "/api/enroll/progress"], (req, res) => {
  res.json(sensorProgress);
});

// 5. Scan (Fingerprint Attendance)
app.post("/api/scan", (req, res) => {
  const body = req.body || {};
  let studentId = body.studentId;
  const isUnknown = Boolean(body.isUnknown);
  const date = todayIST();
  const time = nowTimeIST();

  if (isUnknown) {
    const eventId = crypto.randomUUID();
    const seq = nextSeq++;
    events.push({
      id: eventId,
      date,
      time,
      studentId: null,
      fingerId: null,
      result: "UNKNOWN",
      status: "UNKNOWN",
      source: "GT511C3",
      at: nowIST(),
      seq
    });

    auditLogs.push({
      id: crypto.randomUUID(),
      at: nowIST(),
      action: "UNKNOWN_FINGERPRINT",
      details: `${time} unknown scan`
    });

    return res.json({
      ok: false,
      reason: "UNKNOWN",
      date,
      time,
      fingerId: null,
      seq
    });
  }

  if (!studentId) {
    return res.status(400).json({
      ok: false,
      reason: "NEED_STUDENT_ID",
      detail: "sim mode: send studentId"
    });
  }

  const stu = students.find(s => s.id === parseInt(studentId, 10) && s.active);
  if (!stu) {
    return res.status(404).json({ ok: false, reason: "UNKNOWN" });
  }

  const scheduled = isStudentScheduled(date, stu, settings);
  if (!scheduled) {
    const reason = !isWorkingDay(date, settings) ? "NON_WORKING_DAY" : "NOT_SCHEDULED";
    const daily = ensureDaily(date, stu.id);
    if (!daily.status || daily.status === "ABSENT") {
      daily.status = "NOT_SCHEDULED";
      daily.firstScan = daily.firstScan || time;
      daily.lastScan = time;
    }

    const eventId = crypto.randomUUID();
    const seq = nextSeq++;
    events.push({
      id: eventId,
      date,
      time,
      studentId: stu.id,
      fingerId: stu.fingerId,
      result: "NOT_SCHEDULED",
      status: "NOT_SCHEDULED",
      source: "GT511C3",
      at: nowIST(),
      seq
    });

    auditLogs.push({
      id: crypto.randomUUID(),
      at: nowIST(),
      action: reason === "NON_WORKING_DAY" ? "NON_WORKING_DAY_SCAN" : "NOT_SCHEDULED_SCAN",
      details: `${stu.name} ${time} ${reason} ${stu.grade}/${stu.batch || ""}`
    });

    return res.json({
      ok: false,
      reason,
      status: "NOT_SCHEDULED",
      date,
      time,
      student: stu,
      seq
    });
  }

  const daily = ensureDaily(date, stu.id);
  if (daily.status && daily.status !== "ABSENT" && daily.status !== "NOT_SCHEDULED") {
    // Duplicate scan
    const eventId = crypto.randomUUID();
    const seq = nextSeq++;
    events.push({
      id: eventId,
      date,
      time,
      studentId: stu.id,
      fingerId: stu.fingerId,
      result: "MATCH",
      status: "DUPLICATE",
      source: "GT511C3",
      at: nowIST(),
      seq
    });

    auditLogs.push({
      id: crypto.randomUUID(),
      at: nowIST(),
      action: "DUPLICATE_SCAN",
      details: `${stu.name} ${time} already ${daily.status}`
    });

    return res.json({
      ok: false,
      reason: "DUPLICATE",
      status: "DUPLICATE",
      student: stu,
      date,
      time,
      seq
    });
  }

  const st = classifyTime(time, settings);
  daily.status = st;
  daily.firstScan = daily.firstScan || time;
  daily.lastScan = time;

  const eventId = crypto.randomUUID();
  const seq = nextSeq++;
  events.push({
    id: eventId,
    date,
    time,
    studentId: stu.id,
    fingerId: stu.fingerId,
    result: "MATCH",
    status: st,
    source: "GT511C3",
    at: nowIST(),
    seq
  });

  notifications.unshift({
    id: crypto.randomUUID(),
    studentId: stu.id,
    createdAt: nowIST(),
    status: "PENDING",
    message: `Attendance ${st} at ${time}`,
    attempts: 0
  });

  auditLogs.push({
    id: crypto.randomUUID(),
    at: nowIST(),
    action: "ATTENDANCE_RECORDED",
    details: `${stu.name} -> ${st} ${time}`
  });

  res.json({
    ok: true,
    student: stu,
    date,
    time,
    status: st,
    seq
  });
});

app.get("/api/scan/last", (req, res) => {
  const filtered = events.filter(e => e.source && e.source !== "RECONCILE");
  if (filtered.length === 0) {
    return res.json({ seq: 0 });
  }
  const lastEvent = filtered[filtered.length - 1];
  const stu = lastEvent.studentId ? students.find(s => s.id === lastEvent.studentId) : null;

  res.json({
    seq: lastEvent.seq || 0,
    result: lastEvent.result,
    status: lastEvent.status,
    date: lastEvent.date,
    time: lastEvent.time,
    fingerId: lastEvent.fingerId,
    student: stu || null
  });
});

// 6. Absence Reconciliation
app.post("/api/reconcile", (req, res) => {
  const date = (req.body && req.body.date) || todayIST();

  if (date === todayIST()) {
    const nowT = nowTimeIST();
    let late = settings.lateCutoff || "08:30";
    if (late.length === 5) late += ":00";
    if (nowT < late) {
      return res.json({
        working: true,
        marked: 0,
        notScheduled: 0,
        reason: "BEFORE_CUTOFF",
        cutoff: late,
        now: nowT
      });
    }
  }

  let marked = 0;
  let notScheduled = 0;

  const activeStudents = students.filter(s => s.active);
  for (const stu of activeStudents) {
    const key = `${date}|${stu.id}`;
    const cur = dailyMap.get(key);
    const scheduled = isStudentScheduled(date, stu, settings);

    if (!scheduled) {
      if (!cur || !cur.status || cur.status === "ABSENT") {
        const d = ensureDaily(date, stu.id);
        d.status = "NOT_SCHEDULED";
        d.firstScan = "--";
        d.lastScan = "--";

        events.push({
          id: crypto.randomUUID(),
          date,
          time: "00:00:00",
          studentId: stu.id,
          fingerId: null,
          result: "NOT_SCHEDULED",
          status: "NOT_SCHEDULED",
          source: "RECONCILE",
          at: nowIST(),
          seq: nextSeq++
        });
        notScheduled++;
      }
    } else {
      if (!cur || !cur.status) {
        const d = ensureDaily(date, stu.id);
        d.status = "ABSENT";
        d.firstScan = null;
        d.lastScan = null;

        events.push({
          id: crypto.randomUUID(),
          date,
          time: "23:59:59",
          studentId: stu.id,
          fingerId: null,
          result: "ABSENT",
          status: "ABSENT",
          source: "RECONCILE",
          at: nowIST(),
          seq: nextSeq++
        });

        notifications.unshift({
          id: crypto.randomUUID(),
          studentId: stu.id,
          createdAt: nowIST(),
          status: "PENDING",
          message: `Absent ${date}`,
          attempts: 0
        });

        marked++;
      }
    }
  }

  if (marked || notScheduled) {
    auditLogs.push({
      id: crypto.randomUUID(),
      at: nowIST(),
      action: "ABSENCE_RECONCILIATION",
      details: `${marked} absent, ${notScheduled} not_scheduled for ${date}`
    });
  }

  const anyScheduled = activeStudents.some(s => isStudentScheduled(date, s, settings));
  res.json({
    working: Boolean(anyScheduled || isWorkingDay(date, settings)),
    marked,
    notScheduled,
    date
  });
});

// 7. Attendance & Daily records
app.get("/api/attendance", (req, res) => {
  const date = req.query.date;
  const limit = Math.max(1, Math.min(parseInt(req.query.limit || "2000", 10), 2000));
  const offset = Math.max(0, parseInt(req.query.offset || "0", 10));

  let filtered = events;
  if (date) {
    filtered = events.filter(e => e.date === date);
  }

  const sorted = [...filtered].reverse();
  const paged = sorted.slice(offset, offset + limit);
  res.json(paged);
});

app.get("/api/daily", (req, res) => {
  const date = req.query.date;
  const limit = Math.max(1, Math.min(parseInt(req.query.limit || "5000", 10), 5000));
  const offset = Math.max(0, parseInt(req.query.offset || "0", 10));

  let all = Array.from(dailyMap.values());
  if (date) {
    all = all.filter(d => d.date === date);
  }

  const paged = all.slice(offset, offset + limit);
  res.json(paged);
});

// 8. KPIs & Analytics
app.get("/api/kpis", (req, res) => {
  const date = req.query.date || todayIST();
  const cls = (req.query.class || req.query.grade || "").toLowerCase().trim();
  const batch = (req.query.batch || "").toLowerCase().trim();

  let targetStudents = students.filter(s => s.active);
  if (cls) {
    targetStudents = targetStudents.filter(s => (s.grade || "").toLowerCase() === cls);
  }
  if (batch) {
    targetStudents = targetStudents.filter(s => (s.batch || "").toLowerCase() === batch);
  }

  const total = targetStudents.length;
  let scheduled = 0;
  let notScheduled = 0;
  let present = 0;
  let late = 0;
  let absent = 0;

  for (const stu of targetStudents) {
    if (isStudentScheduled(date, stu, settings)) {
      scheduled++;
      const rec = dailyMap.get(`${date}|${stu.id}`);
      if (rec) {
        if (rec.status === "PRESENT") present++;
        else if (rec.status === "LATE") late++;
        else if (rec.status === "ABSENT") absent++;
        else if (rec.status === "NOT_SCHEDULED") notScheduled++;
      }
    } else {
      notScheduled++;
    }
  }

  res.json({
    total,
    scheduled,
    present,
    late,
    absent,
    notScheduled,
    date
  });
});

// 9. Reports
app.get("/api/reports", (req, res) => {
  const sid = parseInt(req.query.studentId, 10);
  if (!sid) return res.status(400).json({ error: "studentId required" });

  const stu = students.find(s => s.id === sid);
  if (!stu) return res.status(404).json({ error: "not found" });

  const start = settings.attendanceStartDate || "2026-06-15";
  const end = todayIST();
  const buckets = Array.from({ length: 11 }, () => ({ attended: 0, total: 0 }));

  let present = 0;
  let late = 0;
  let absent = 0;

  try {
    const curr = new Date(start + "T00:00:00Z");
    const endDate = new Date(end + "T00:00:00Z");
    while (curr <= endDate) {
      const iso = curr.toISOString().split("T")[0];
      if (isStudentScheduled(iso, stu, settings)) {
        const m = curr.getUTCMonth(); // 0 = Jan .. 5 = Jun
        let idx = null;
        if (m >= 5) idx = m - 5; // Jun=0 .. Dec=6
        else if (m <= 3) idx = m + 7; // Jan=7 .. Apr=10

        if (idx !== null && idx >= 0 && idx < 11) {
          buckets[idx].total++;
          const rec = dailyMap.get(`${iso}|${sid}`);
          if (rec && (rec.status === "PRESENT" || rec.status === "LATE")) {
            buckets[idx].attended++;
          }
        }
      }
      curr.setUTCDate(curr.getUTCDate() + 1);
    }
  } catch (e) {
    // ignore
  }

  for (const d of dailyMap.values()) {
    if (d.studentId === sid) {
      if (d.status === "PRESENT") present++;
      else if (d.status === "LATE") late++;
      else if (d.status === "ABSENT") absent++;
    }
  }

  const eligible = buckets.reduce((sum, b) => sum + b.total, 0);
  const attended = buckets.reduce((sum, b) => sum + b.attended, 0);
  const rate = eligible > 0 ? Math.round((attended / eligible) * 100) : 0;

  res.json({
    present,
    late,
    absent,
    eligible,
    attended,
    rate,
    buckets
  });
});

// 10. Attendance Correction
app.post("/api/correction", (req, res) => {
  const { date, studentId, status, reason } = req.body || {};
  if (!date || !studentId || !status) {
    return res.status(400).json({ error: "missing fields" });
  }
  const allowedStatus = ["PRESENT", "LATE", "ABSENT", "NOT_SCHEDULED"];
  if (!allowedStatus.includes(status)) {
    return res.status(400).json({ error: "invalid status" });
  }

  const sid = parseInt(studentId, 10);
  const stu = students.find(s => s.id === sid);
  if (!stu) return res.status(404).json({ error: "student not found" });

  const daily = ensureDaily(date, sid);
  daily.status = status;

  events.push({
    id: crypto.randomUUID(),
    date,
    time: nowTimeIST(),
    studentId: sid,
    fingerId: stu.fingerId,
    result: "CORRECTION",
    status,
    source: "ADMIN_CORRECTION",
    at: nowIST(),
    seq: nextSeq++
  });

  auditLogs.push({
    id: crypto.randomUUID(),
    at: nowIST(),
    action: "ATTENDANCE_CORRECTED",
    details: `Student ${stu.name} (${date}) updated to ${status} — Reason: ${reason || "N/A"}`
  });

  res.json({ ok: true, studentId: sid, date, status });
});

// 11. CSV Export & Import
app.get("/api/export/csv", (req, res) => {
  const type = req.query.type || "students";
  if (type === "attendance") {
    let rows = [["Date", "Time", "Student ID", "Roll", "Name", "Class", "Status", "Result", "Source"]];
    for (const e of events) {
      const stu = e.studentId ? students.find(s => s.id === e.studentId) : null;
      rows.push([
        e.date,
        e.time,
        e.studentId || "",
        stu ? stu.roll : "",
        stu ? stu.name : "",
        stu ? stu.grade : "",
        e.status,
        e.result,
        e.source
      ]);
    }
    const csvStr = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="attendance.csv"');
    return res.send(csvStr);
  }

  let rows = [["ID", "Name", "Roll", "Class", "Batch", "Section", "Parent", "Phone", "Address", "Finger ID", "Rate", "Active", "Created"]];
  for (const s of students) {
    rows.push([
      s.id,
      s.name,
      s.roll,
      s.grade,
      s.batch || "",
      s.section || "",
      s.parent || "",
      s.phone || "",
      s.address || "",
      s.fingerId || "",
      `${getStudentAttendanceRate(s.id)}%`,
      s.active ? "Yes" : "No",
      s.createdAt
    ]);
  }
  const csvStr = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="students.csv"');
  res.send(csvStr);
});

app.post("/api/import/csv", upload.single("file"), (req, res) => {
  let csvText = "";
  if (req.file && fs.existsSync(req.file.path)) {
    csvText = fs.readFileSync(req.file.path, "utf-8");
    fs.unlinkSync(req.file.path);
  } else if (req.body && req.body.csv) {
    csvText = req.body.csv;
  }

  if (!csvText) {
    return res.status(400).json({ error: "no CSV content provided" });
  }

  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length <= 1) {
    return res.json({ count: 0, imported: 0, skipped: 0, errors: [] });
  }

  const header = lines[0].split(",").map(h => h.replace(/^["']|["']$/g, "").trim().toLowerCase());
  const nameIdx = header.findIndex(h => h.includes("name"));
  const rollIdx = header.findIndex(h => h.includes("roll"));
  const gradeIdx = header.findIndex(h => h.includes("class") || h.includes("grade"));
  const batchIdx = header.findIndex(h => h.includes("batch") || h.includes("group"));
  const secIdx = header.findIndex(h => h.includes("section") || h.includes("sec"));
  const parentIdx = header.findIndex(h => h.includes("parent") || h.includes("guardian"));
  const phoneIdx = header.findIndex(h => h.includes("phone") || h.includes("mobile"));
  const addrIdx = header.findIndex(h => h.includes("address"));

  let imported = 0;
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.replace(/^["']|["']$/g, "").trim());
    const name = nameIdx !== -1 ? cols[nameIdx] : "";
    const roll = rollIdx !== -1 ? cols[rollIdx] : "";
    const grade = gradeIdx !== -1 ? cols[gradeIdx] : "Grade 10-A";
    const batch = batchIdx !== -1 ? cols[batchIdx] : "";
    const section = secIdx !== -1 ? cols[secIdx] : "";
    const parent = parentIdx !== -1 ? cols[parentIdx] : "";
    const phone = phoneIdx !== -1 ? cols[phoneIdx] : "";
    const address = addrIdx !== -1 ? cols[addrIdx] : "";

    if (!name || !roll) {
      skipped++;
      continue;
    }

    const dup = students.find(s => s.active && s.roll.toLowerCase() === roll.toLowerCase());
    if (dup) {
      skipped++;
      continue;
    }

    if (grade && !settings.classes.includes(grade)) settings.classes.push(grade);
    if (batch && !settings.batches.includes(batch)) settings.batches.push(batch);

    students.push({
      id: nextStudentId++,
      name,
      roll,
      grade,
      batch,
      section,
      parent,
      phone,
      address,
      fingerId: nextFingerId(),
      photo: "",
      active: 1,
      createdAt: todayIST()
    });
    imported++;
  }

  auditLogs.push({
    id: crypto.randomUUID(),
    at: nowIST(),
    action: "CSV_IMPORTED",
    details: `Imported ${imported} students from CSV`
  });

  res.json({ count: lines.length - 1, imported, skipped, errors: [] });
});

// 12. Backup & Restore & Export All
app.get("/api/export", (req, res) => {
  res.json({
    exportedAt: nowIST(),
    source: "in-memory",
    settings,
    students,
    events: events.slice(-5000),
    daily: Array.from(dailyMap.values())
  });
});

app.get("/api/backup", (req, res) => {
  const backupData = {
    version: "1.0.0",
    backedUpAt: nowIST(),
    settings,
    students,
    events,
    daily: Array.from(dailyMap.values()),
    notifications,
    audit: auditLogs,
    images
  };
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="atl_backup_${todayIST()}.json"`);
  res.send(JSON.stringify(backupData, null, 2));
});

app.post("/api/restore", (req, res) => {
  try {
    const data = req.body;
    if (data && data.students && Array.isArray(data.students)) {
      students = data.students;
      nextStudentId = Math.max(...students.map(s => s.id), 0) + 1;
    }
    if (data && data.settings && typeof data.settings === "object") {
      settings = { ...defaultSettings, ...data.settings };
    }
    if (data && data.events && Array.isArray(data.events)) {
      events = data.events;
      nextSeq = Math.max(...events.map(e => e.seq || 0), 0) + 1;
    }
    if (data && data.daily && Array.isArray(data.daily)) {
      dailyMap.clear();
      for (const d of data.daily) {
        dailyMap.set(d.key || `${d.date}|${d.studentId}`, d);
      }
    }
    if (data && data.audit && Array.isArray(data.audit)) {
      auditLogs = data.audit;
    }

    auditLogs.push({
      id: crypto.randomUUID(),
      at: nowIST(),
      action: "DATABASE_RESTORED",
      details: "System state restored from backup"
    });

    res.json({ ok: true, message: "System state restored successfully" });
  } catch (err) {
    res.status(500).json({ error: `Restore failed: ${err.message}` });
  }
});

// 13. Image Management
app.get("/api/images", (req, res) => {
  const gal = settings.imageGallery || [];
  const combined = [...images, ...gal];
  res.json(combined.slice(0, 60));
});

app.delete("/api/images", requireAdmin, (req, res) => {
  images = [];
  settings.imageGallery = [];
  auditLogs.push({
    id: crypto.randomUUID(),
    at: nowIST(),
    action: "GALLERY_CLEARED",
    details: "All images cleared"
  });
  res.json({ ok: true });
});

app.delete("/api/images/:id", requireAdmin, (req, res) => {
  const iid = req.params.id;
  const idx = images.findIndex(img => String(img.id) === String(iid));
  if (idx !== -1) {
    images.splice(idx, 1);
    return res.json({ ok: true, id: iid });
  }
  const gal = settings.imageGallery || [];
  const nextGal = gal.filter(img => String(img.id) !== String(iid));
  if (nextGal.length !== gal.length) {
    settings.imageGallery = nextGal;
    return res.json({ ok: true, id: iid });
  }
  res.status(404).json({ error: "not found" });
});

app.post("/api/images/upload", requireAdmin, upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "no file" });
  }
  const name = req.file.originalname || `img_${Date.now()}.png`;
  const url = `/api/images/file/${req.file.filename}`;
  const iid = crypto.randomUUID();

  const record = {
    id: iid,
    url,
    name,
    category: "students",
    at: nowIST()
  };
  images.unshift(record);

  res.json({ url, name, id: iid });
});

app.get("/api/images/file/:name", (req, res) => {
  const filename = req.params.name;
  const filepath = path.join(uploadDir, filename);
  if (fs.existsSync(filepath)) {
    return res.sendFile(filepath);
  }
  res.status(404).json({ error: "not found" });
});

// 14. Notifications & Audit Logs
app.get("/api/notifications", (req, res) => {
  res.json(notifications.slice(0, 50));
});

app.get("/api/audit", (req, res) => {
  res.json([...auditLogs].reverse().slice(0, 500));
});

// --- Static Asset Serving & Production HTML Splice ---

const SCAN_BRIDGE_SCRIPT = `<script>
/* ATL scan bridge - injected by backend; drives the UI's handleRealScan from real sensor scans */
(function(){
  if (window.__ATL_BRIDGE__) return; window.__ATL_BRIDGE__ = true;
  var last = -1;
  function ensureStudent(stu, fid){
    try{
      if (typeof Students === 'undefined') return;
      var s = Students.find(function(x){ return x.fid === fid; });
      if (s) return;
      s = { id: stu.id, name: stu.name, roll: stu.roll, class: stu.grade || '', section: '',
            parent: '', phone: stu.phone || '', address: stu.address || '', photo: stu.photo || '',
            fid: fid, active: 1, enroll: stu.createdAt || '' };
      Students.push(s);
      try { saveStorage(); } catch(e){}
      try { renderClassFilters(); renderStudentList(); renderClasses(); } catch(e){}
    }catch(e){}
  }
  function poll(){
    fetch('/api/scan/last', {cache:'no-store'}).then(function(r){ return r.ok ? r.json() : null; }).then(function(d){
      if (!d || typeof d.seq !== 'number') return;
      if (last === -1){ last = d.seq; return; }
      if (d.seq <= last) return;
      last = d.seq;
      if (typeof window.handleRealScan !== 'function') return;
      if (d.student && d.fingerId !== null && d.fingerId !== undefined){
        var fid = 'F-' + d.fingerId;
        ensureStudent(d.student, fid);
        window.handleRealScan(fid, { status: d.status, result: d.result, time: d.time, date: d.date, seq: d.seq, student: d.student });
      } else if (d.status === 'UNKNOWN' || d.result === 'UNKNOWN'){
        window.handleRealScan('__unknown__' + d.seq, { seq: d.seq });
      }
    }).catch(function(){});
  }
  setInterval(poll, 2000);
  poll();
})();
</script>`;

function serveProduction(req, res) {
  try {
    const htmlPath = path.join(__dirname, "ATL-Smart-Attendance-Production.html");
    let html = fs.readFileSync(htmlPath, "utf-8");

    // Replace the inline application script in Production HTML with backend/ui_app.js
    const uiSourcePath = path.join(__dirname, "backend", "ui_app.js");
    if (fs.existsSync(uiSourcePath)) {
      const scriptRegex = /<script>[\s\S]*?<\/script>\s*<\/body>/i;
      const source = fs.readFileSync(uiSourcePath, "utf-8");
      if (scriptRegex.test(html)) {
        html = html.replace(scriptRegex, `<script>\n${source}\n</script>\n</body>`);
      }
    }

    if (html.includes("window.handleRealScan") && !html.includes("__ATL_BRIDGE__")) {
      const idx = html.lastIndexOf("</body>");
      if (idx !== -1) {
        html = html.substring(0, idx) + SCAN_BRIDGE_SCRIPT + html.substring(idx);
      }
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.send(html);
  } catch (err) {
    res.status(500).send("Error loading production interface: " + err.message);
  }
}

app.use("/assets", express.static(path.join(__dirname, "assets")));

app.get("/", serveProduction);

// Fallback route
app.use((req, res) => {
  const p = req.path;
  if (p.startsWith("/api/") || p.startsWith("/assets/") || p.startsWith("/backend/") || p.startsWith("/tools/") || p.startsWith("/pi/")) {
    return res.status(404).json({ error: "not found" });
  }
  return serveProduction(req, res);
});

app.listen(PORT, HOST, () => {
  console.log(`ATL Smart Attendance server running on http://${HOST}:${PORT}`);
});
