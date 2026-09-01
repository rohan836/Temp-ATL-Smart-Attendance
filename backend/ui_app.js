// ============================================================
// ATL Smart Attendance — UI application script (DB-driven)
// Source: backend/ui_app.js  (spliced into the single-file HTML)
// LocalStorage is only an offline cache; SQLite /api is truth.
// ============================================================
const LS = {
  students:"atl_students", attendance:"atl_attendance", holidays:"atl_holidays",
  overrides:"atl_overrides", settings:"atl_settings", classes:"atl_classes",
  audit:"atl_audit", batches:"atl_batches",
  classSchedules:"atl_class_schedules", batchSchedules:"atl_batch_schedules"
};

// ---- state (mirrors backend SQLite) ----
let Students = [];      // mapped: id,name,roll,class,section,parent,phone,address,photo,fid,active,enroll,batch
let Attendance = [];    // mapped: id,studentId,date,time,status(UI),isDuplicate,fingerId
let Unknowns = [];      // {time, finger, note}
let Settings = {
  schoolName:"ATL Model School", academicYear:"", startDate:"", endDate:"",
  lateAfter:"08:30", presentCutoff:"08:00", address:"", workingDays:{0:false,1:true,2:true,3:true,4:true,5:true,6:true}
};
let Classes = [];
let Batches = [];
let Holidays = [];      // backend "YYYY-MM-DD:Reason" -> {start}/{name}
let Overrides = [];
let Audit = [];         // mapped from backend audit
let AllEvents = [];     // full event history (for reports + student detail)
let ClassSchedules = {}; // backend-persisted per-class weekly {class: {workingDays:{0..6}} or {0..6}}
let BatchSchedules = {}; // backend-persisted per-batch { "Grade|Batch": workingDays }
let Daily = [];         // from /api/daily
let Kpis = null;        // from /api/kpis
// backward compat alias for older cache key
let ClassSchedulesUI = ClassSchedules;
let _enrollPoll = null; let _enrollAbort = false; let _enrollCtrl = null;

// ---- helpers ----
function $(id){ return document.getElementById(id); }
function esc(s){ if(s==null) return ""; return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function toISODate(d){ if(!d) return ""; const dt=(d instanceof Date)?d:new Date(d); return dt.getFullYear()+"-"+String(dt.getMonth()+1).padStart(2,'0')+"-"+String(dt.getDate()).padStart(2,'0'); }
function todayISO(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,'0')+"-"+String(d.getDate()).padStart(2,'0'); }
function parseISO(s){ return new Date(s+"T00:00:00"); }
function fmtDate(d){ if(!d) return ""; const dt=parseISO(d); return dt.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }
function inRange(d,a,b){ return d>=a && d<=b; }
async function api(path, opts){
  opts = opts || {};
  opts.headers = Object.assign({"Content-Type":"application/json"}, opts.headers||{});
  try{
    const pin = sessionStorage.getItem("atl_admin_pin") || "";
    if(pin) opts.headers["X-Admin-Pin"] = pin;
  }catch(e){}
  opts.cache = "no-store";
  let r = await fetch(path, opts);
  let body = null;
  try{ body = await r.json(); }catch(e){}
  if(!r.ok && r.status===401 && !opts._pinRetry){
    const msg = (body&&(body.error||""))||"";
    if(msg.toLowerCase().includes("admin pin")){
      let pin = null;
      try{ pin = prompt("Admin PIN required"); }catch(e){}
      if(pin){
        try{ sessionStorage.setItem("atl_admin_pin", pin); }catch(e){}
        opts.headers = Object.assign({}, opts.headers, {"X-Admin-Pin": pin});
        opts._pinRetry = true;
        r = await fetch(path, opts);
        try{ body = await r.json(); }catch(e){ body=null; }
        if(r.ok) return body;
      }
    }
  }
  if(!r.ok){ const err = new Error((body&&(body.error||body.detail||body.reason))||("HTTP "+r.status)); err.status=r.status; err.body=body; throw err; }
  return body;
}
function statusUI(backendStatus){
  const m = {"PRESENT":"Present","LATE":"Late","ABSENT":"Absent","DUPLICATE":"Already recorded","UNKNOWN":"Unknown","NOT_SCHEDULED":"Not Scheduled"};
  return m[backendStatus] || backendStatus || "";
}
// ---- persisted cache (offline fallback) ----
function asBool(v){
  if(v===true || v===1) return true;
  if(v===false || v===0 || v==null) return false;
  if(typeof v==="string") return ["1","true","yes","on"].includes(v.trim().toLowerCase());
  return !!v;
}
function cacheSave(){
  try{
    const slim=Students.map(s=>{
      const o={}; for(const k in s){ if(k!=="photo") o[k]=s[k]; }
      return o;
    });
    localStorage.setItem(LS.students, JSON.stringify(slim));
    localStorage.setItem(LS.settings, JSON.stringify(Settings));
    localStorage.setItem(LS.classes, JSON.stringify(Classes));
    localStorage.setItem(LS.batches, JSON.stringify(Batches));
    localStorage.setItem(LS.holidays, JSON.stringify(Holidays));
    localStorage.setItem(LS.overrides, JSON.stringify(Overrides));
    localStorage.setItem(LS.audit, JSON.stringify(Audit));
    localStorage.setItem(LS.attendance, JSON.stringify(Attendance));
    localStorage.setItem(LS.classSchedules, JSON.stringify(ClassSchedules));
    localStorage.setItem(LS.batchSchedules, JSON.stringify(BatchSchedules));
    try{ localStorage.setItem("atl_daily", JSON.stringify(Daily)); }catch(e){}
    try{ localStorage.setItem("atl_kpis", JSON.stringify(Kpis)); }catch(e){}
  }catch(e){}
}
function cacheLoad(){
  try{
    const g=(k,f)=>{ const v=localStorage.getItem(k); if(v){ try{ return f(JSON.parse(v)); }catch(e){} } return null; };
    g(LS.students, v=>Students=v);
    g(LS.settings, v=>Settings=Object.assign(Settings,v));
    g(LS.classes, v=>Classes=v);
    g(LS.batches, v=>Batches=v||[]);
    g(LS.holidays, v=>Holidays=v);
    g(LS.overrides, v=>Overrides=v);
    g(LS.audit, v=>Audit=v);
    g(LS.attendance, v=>Attendance=v);
    g(LS.classSchedules, v=>{ ClassSchedules=v||{}; ClassSchedulesUI=ClassSchedules; });
    g(LS.batchSchedules, v=>BatchSchedules=v||{});
    g("atl_daily", v=>Daily=v||[]);
    g("atl_kpis", v=>Kpis=v);
    // migrate old UI-only key if present
    try{
      const old = localStorage.getItem("atl_class_schedules_ui");
      if(old && (!ClassSchedules || !Object.keys(ClassSchedules).length)){
        const parsed = JSON.parse(old);
        if(parsed && typeof parsed==="object"){ ClassSchedules=parsed; ClassSchedulesUI=parsed; }
      }
    }catch(e){}
  }catch(e){}
}

// ---- backend -> UI mappings ----
function mapStudent(b){
  return {
    id: b.id, name: b.name, roll: b.roll, class: b.grade||"", section: b.section||"",
    parent: b.parent||b.parent_name||"", phone: b.phone||"", address: b.address||"", batch: b.batch||b.group||"",
    photo: b.photo||"",
    fid: (b.fingerId!==null&&b.fingerId!==undefined) ? "F-"+b.fingerId : "",
    active: b.active!==0 && b.active!==false,
    enroll: b.createdAt||b.enroll_date||""
  };
}
function mapEvent(e){
  return {
    id: e.rowid||e.id||String(Math.random()), studentId: e.studentId,
    date: e.date, time: e.time,
    status: statusUI(e.status||e.result), isDuplicate: (e.status==="DUPLICATE"),
    fingerId: e.fingerId
  };
}
function mapHoliday(s){ return mapHolidayFromList(s); }

// ---- data load from backend ----
function mapOverride(s){
  const parts = s.split(":"); const date = parts[0] || "";
  const working = (parts[1] === "1");
  const note = parts.slice(2).join(":") || "";
  return {date, isWorking: working, note};
}
function mapHolidayFromList(s){
  if(s && typeof s === "object"){
    const start=String(s.start||s.date||"").slice(0,10), end=String(s.end||start).slice(0,10);
    return {name:String(s.name||"Holiday"), start, end, category:String(s.category||""), type:String(s.type||"holiday")};
  }
  s=String(s||"");
  const i=s.indexOf(":"), head=i>=0?s.slice(0,i):s, span=head.split(".."), start=span[0].slice(0,10), end=(span[1]||span[0]).slice(0,10);
  const rest=i>=0?s.slice(i+1):"Holiday", parts=rest.split(":");
  const typed=parts.length>1 && ["holiday","vacation","exam"].includes(parts[0].toLowerCase());
  return {name:typed?parts.slice(1).join(":"):(rest||"Holiday"), start, end, category:"", type:typed?parts[0].toLowerCase():"holiday"};
}
async function loadClassesHolidaysSettings(){
  try{
    const st = await api("/api/settings", {method:"GET"});
    Settings.schoolName = st.schoolName || Settings.schoolName;
    Settings.academicYear = st.academicYear || Settings.academicYear;
    Settings.startDate = st.attendanceStartDate || st.schoolOpeningDate || Settings.startDate;
    Settings.endDate = st.endDate || st.academicYearEnd || Settings.endDate;
    Settings.lateAfter = st.lateCutoff || Settings.lateAfter || "08:30";
    Settings.presentCutoff = st.presentCutoff || Settings.presentCutoff || "08:00";
    Settings.lateCutoff = st.lateCutoff || Settings.lateAfter || "08:30";
    Classes = (st.classes&&st.classes.length) ? st.classes.slice() : Classes;
    if(Array.isArray(st.batches)) Batches = st.batches.slice();
    else if(Array.isArray(st.classes)) Batches = Batches || [];
    if(st.classSchedules && typeof st.classSchedules==="object") { ClassSchedules = st.classSchedules; ClassSchedulesUI = ClassSchedules; }
    if(st.batchSchedules && typeof st.batchSchedules==="object") BatchSchedules = st.batchSchedules;
    if(Array.isArray(st.holidays)) Holidays = st.holidays.map(mapHolidayFromList).filter(Boolean);
    if(st.workingDays && typeof st.workingDays==="object"){
      const wd={}; for(let i=0;i<7;i++) wd[i]=asBool(st.workingDays[i] ?? st.workingDays[String(i)]); Settings.workingDays=wd;
    }
    if(Array.isArray(st.overrides)) Overrides = st.overrides.map(mapOverride).filter(o=>o.date);
    Settings.address = st.address || Settings.address;
    if(st.minPercent!=null) Settings.minPercent = st.minPercent;
    // populate settings inputs from the DB (auto-fill)
    const set=(id,v)=>{ const el=$(id); if(el&&v!=null) el.value=v; };
    set("setSchoolName", Settings.schoolName);
    set("setSchoolAddress", Settings.address);
    set("setPresentCutoff", Settings.presentCutoff || "08:00");
    set("setLateCutoff", Settings.lateCutoff || Settings.lateAfter || "08:30");
    set("setLateThreshold", Settings.lateCutoff || Settings.lateAfter || "08:30");
    set("setAcademicYear", Settings.academicYear);
    set("setAttendanceStart", Settings.startDate);
    // ensure calendars reflect persisted per-class/batch schedules
    cacheSave();
  }catch(e){ /* offline -> cache */ }
}
async function loadStudents(){
  try{
    const list = await api("/api/students?active=all", {method:"GET"});
    if(Array.isArray(list)){
      Students = list.map(mapStudent);
    }
  }catch(e){ /* offline -> cache */ }
}
async function loadHistory(){
  try{
    const ev = await api("/api/attendance", {method:"GET"});
    if(Array.isArray(ev)) AllEvents = ev.map(mapEvent);
  }catch(e){ /* offline */ }
}
async function loadTodayAttendance(){
  const t = todayISO();
  try{
    // reconcile today's attendance (marks ABSENT/NOT_SCHEDULED after lateCutoff; backend guards BEFORE_CUTOFF)
    if(!(typeof document!=="undefined" && document.hidden)){
      try{ await api("/api/reconcile",{method:"POST",body:JSON.stringify({date:t})}); }catch(e){}
    }
    const ev = await api("/api/attendance?date="+t, {method:"GET"});
    if(Array.isArray(ev)){
      Attendance = ev.map(mapEvent).filter(a=>a.studentId||a.status==="Unknown");
      Unknowns = ev.filter(e=>(e.result==="UNKNOWN"||e.status==="UNKNOWN")).map(e=>({time:e.time, finger:(e.fingerId!=null?"F-"+e.fingerId:"-"), note:"Unknown fingerprint"}));
    }
    try{
      const daily = await api("/api/daily?date="+t,{method:"GET"});
      if(Array.isArray(daily)) Daily = daily;
    }catch(e){}
    try{
      const k = await api("/api/kpis?date="+t,{method:"GET"});
      if(k && typeof k==="object" && "scheduled" in k) Kpis = k;
    }catch(e){}
    try{
      const au = await api("/api/audit", {method:"GET"});
      if(Array.isArray(au)) Audit = au.map(a=>({time:a.at, action:a.action, details:a.details, by:"Admin"}));
    }catch(e){}
  }catch(e){ /* offline */ }
}
async function loadAll(){
  await loadClassesHolidaysSettings();
  await loadStudents();
  await loadHistory();
  await loadTodayAttendance();
  cacheSave();
  renderAll();
}
// ---- DOM ----
const promptText=$("promptText"),
  scannerStageEl=$("scannerStage"),
  hologramCanvasContainer=$("hologramCanvasContainer"),
  hologramFPS=$("hologramFPS"),
  hologramSubtag=$("hologramSubtag"),
  themeCycleBtn=$("themeCycleBtn"),
  themeNameLabel=$("themeNameLabel"),
  scanParticleCanvasEl=$("scan-particle-canvas"),
  leftClock=$("leftClock"), idleLayer=$("idleLayer"),
  identityLayer=$("identityLayer"), unknownLayer=$("unknownLayer"),
  photoImg=$("photoImg"), photoFallback=$("photoFallback"),
  idName=$("idName"), idSub=$("idSub"), idStatus=$("idStatus"), idTime=$("idTime"),
  idDate=$("idDate"), idConfirm=$("idConfirm"), idConfirmTxt=$("idConfirm"),
  idRoll=$("idRoll"), idClass=$("idClass"), idGroup=$("idGroup"), idSid=$("idSid"),
  unknownTitleEl=$("unknownTitle"),
  adminLayer=$("adminLayer"), adminNav=$("adminNav"), adminTitle=$("adminTitle"),
  studentListEl=$("studentList"), searchInput=$("searchInput"), classFilter=$("classFilter"), batchFilter=$("batchFilter"), studentStatusFilter=$("studentStatusFilter"),
  detailScroll=$("detailScroll"),
  todayDateLabel=$("todayDateLabel"), todayClassFilter=$("todayClassFilter"),
  todayStatusFilter=$("todayStatusFilter"), todaySort=$("todaySort"),
  todayStats=$("todayStats"), todayTableBody=$("todayTableBody"), todayUnknownBody=$("todayUnknownBody"),
  reportScope=$("reportScope"), reportClass=$("reportClass"), reportStudent=$("reportStudent"),
  reportTime=$("reportTime"), reportFrom=$("reportFrom"), reportTo=$("reportTo"),
  reportStats=$("reportStats"), reportBody=$("reportBody"),
  holidayBody=$("holidayBody"), overrideBody=$("overrideBody"),
  calendarGrid=$("calendarGrid"), calMonthLabel=$("calMonthLabel"),
  classBody=$("classBody"), auditBody=$("auditBody"),
  enrollModal=$("enrollModal"), holidayModal=$("holidayModal"),
  overrideModal=$("overrideModal"), correctionModal=$("correctionModal"),
  confirmModal=$("confirmModal"), confirmModalTitle=$("confirmModalTitle"),
  confirmModalSub=$("confirmModalSub"), confirmModalBody=$("confirmModalBody"),
  enrollTitle=$("enrollTitle"), enrollSub=$("enrollSub"), enrollBody=$("enrollBody");

// ============================================================================
// EXACT 3D VOLUMETRIC FINGERPRINT HOLOGRAM ENGINE & GLSL SHADERS
// High-Density Biometric Point Cloud (38,000 pts), Chromatic Laser & Target Nodes
// ============================================================================
const FINGERPRINT_THEMES = [
  {
    id: 'cyber_optic',
    name: 'Cyber Optic',
    subtitle: 'High-density photonic biometric sensor with ultra-violet laser sweep and neural minutiae matching.',
    indexStr: '01/04',
    primaryColor: [0.0, 0.85, 1.0], // Cyan / Electric Blue
    accentColor: [0.35, 0.15, 1.0], // Deep Indigo / Purple
    laserColor: [0.0, 1.0, 0.85],
    glowIntensity: 1.2,
    ridgeDensity: 36,
    chromaticStrength: 0.8,
  },
  {
    id: 'solar_amber',
    name: 'Solar Resonance',
    subtitle: 'Infrared thermal dermal imaging with high-contrast chromatic dispersion across biometric ridges.',
    indexStr: '02/04',
    primaryColor: [1.0, 0.45, 0.05], // Neon Orange
    accentColor: [1.0, 0.8, 0.1], // Solar Gold
    laserColor: [1.0, 0.5, 0.0],
    glowIntensity: 1.35,
    ridgeDensity: 38,
    chromaticStrength: 0.95,
  },
  {
    id: 'quantum_emerald',
    name: 'Bio-Matrix',
    subtitle: 'Quantum resonant ledger scan analyzing 42,000 subcutaneous biometric point coordinates.',
    indexStr: '03/04',
    primaryColor: [0.1, 0.95, 0.55], // Neon Mint Emerald
    accentColor: [0.0, 0.5, 0.9], // Deep Aquamarine
    laserColor: [0.3, 1.0, 0.6],
    glowIntensity: 1.15,
    ridgeDensity: 40,
    chromaticStrength: 0.7,
  },
  {
    id: 'prismatic_monolith',
    name: 'Prismatic Silver',
    subtitle: 'Crystalline optical glass fingerprint scanning with full-spectrum rainbow dispersion glints.',
    indexStr: '04/04',
    primaryColor: [0.92, 0.94, 0.98], // Titanium White / Silver
    accentColor: [1.0, 0.35, 0.8], // Prismatic Magenta
    laserColor: [1.0, 0.9, 0.95],
    glowIntensity: 1.4,
    ridgeDensity: 36,
    chromaticStrength: 1.1,
  },
];

const FingerprintHologramEngine = (function(){
  const container = hologramCanvasContainer || $("hologramCanvasContainer");
  let activeThemeIndex = 0;
  try {
    const saved = localStorage.getItem("atl_hologram_theme");
    if(saved !== null){
      const idx = parseInt(saved, 10);
      if(!isNaN(idx) && idx >= 0 && idx < FINGERPRINT_THEMES.length) activeThemeIndex = idx;
    }
  } catch(e){}

  let renderer = null, scene = null, camera = null;
  let fingerprintMesh = null, laserBeamLine = null, laserBeamMat = null;
  let frameGroup = null, targetGroup = null, particles = null;
  let customShaderMaterial = null;
  let animId = null;
  let isScanning = false;
  let scanStartTime = 0;
  const SCAN_DURATION = 1800; // 1.8s scan sweep
  let dimFactor = 1.0;
  let targetDimFactor = 1.0;
  
  let targetMouseX = 0, targetMouseY = 0;
  let currentMouseX = 0, currentMouseY = 0;
  let scanPulse = 0;

  // FPS tracking
  let frameCount = 0;
  let fpsTimer = 0;

  // Vertex Shader for 3D Fingerprint Point Cloud & Ridges
  const vertexShader = `
    uniform float u_time;
    uniform float u_scanProgress;
    uniform float u_isScanning;
    uniform float u_scanPulse;
    uniform vec2 u_mouse;
    uniform float u_chromaticStrength;
    uniform float u_dimFactor;

    attribute float a_ridgeIndex;
    attribute float a_phase;
    attribute float a_minutiae;
    attribute float a_size;

    varying vec3 vPosition;
    varying float vScanDistance;
    varying float vMinutiae;
    varying float vPhase;
    varying float vRidgeIndex;
    varying float vScanProgress;
    varying float vPulse;

    void main() {
      vPhase = a_phase;
      vMinutiae = a_minutiae;
      vRidgeIndex = a_ridgeIndex;
      vScanProgress = u_scanProgress;

      vec3 pos = position;

      // Organic breathing wave across the 3D fingerprint bed
      float breath = sin(u_time * 1.5 + pos.y * 1.8 + pos.x * 2.2) * 0.04;
      pos.z += breath;

      // Scan Laser Sweep Plane (sweeps from top Y=+2.4 to bottom Y=-2.4)
      float laserY = 2.4 - u_scanProgress * 4.8;
      float distToLaser = abs(pos.y - laserY);
      vScanDistance = distToLaser;

      // If scanning, add an expanding shockwave pulse
      float shockDist = length(pos.xy) - (u_scanPulse * 3.5);
      float pulseEffect = exp(-abs(shockDist) * 3.0) * u_isScanning;
      vPulse = pulseEffect;

      pos.z += pulseEffect * 0.25;

      // Subtle 3D mouse parallax tilt
      pos.x += u_mouse.x * 0.25 * (1.0 - abs(pos.y) * 0.2);
      pos.y += u_mouse.y * 0.25;

      // Minutiae target jitter / lock pulsation
      if (a_minutiae > 0.5) {
        pos.z += sin(u_time * 6.0 + a_phase) * 0.08;
      }

      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      vPosition = mvPosition.xyz;

      // Dynamic point sizing based on distance, scan laser proximity, and minutiae
      float pointSize = a_size * (350.0 / -mvPosition.z);
      
      // Enlarge points right near the laser beam
      if (distToLaser < 0.25) {
        pointSize *= (1.0 + (0.25 - distToLaser) * 3.0);
      }
      if (a_minutiae > 0.5) {
        pointSize *= (1.4 + sin(u_time * 8.0) * 0.4);
      }

      gl_PointSize = pointSize;
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  // Fragment Shader for 3D Fingerprint Hologram
  const fragmentShader = `
    uniform float u_time;
    uniform vec3 u_primaryColor;
    uniform vec3 u_accentColor;
    uniform vec3 u_laserColor;
    uniform float u_glowIntensity;
    uniform float u_chromaticStrength;
    uniform float u_isScanning;
    uniform float u_dimFactor;

    varying vec3 vPosition;
    varying float vScanDistance;
    varying float vMinutiae;
    varying float vPhase;
    varying float vRidgeIndex;
    varying float vScanProgress;
    varying float vPulse;

    void main() {
      // Make particles circular with soft glow radial falloff
      vec2 coord = gl_PointCoord - vec2(0.5);
      float dist = length(coord);
      if (dist > 0.5) discard;

      // Soft gaussian-like circular gradient
      float alpha = smoothstep(0.5, 0.05, dist);

      // Color gradient across fingerprint height & depth
      vec3 baseColor = mix(u_accentColor, u_primaryColor, smoothstep(-2.0, 2.0, vPosition.y));

      // Dynamic ridge harmonic flow illumination
      float ridgeWave = sin(vRidgeIndex * 0.8 - u_time * 2.5 + vPhase) * 0.5 + 0.5;
      baseColor += u_primaryColor * ridgeWave * 0.35;

      // Laser Scanning Sweep Light Glow
      if (vScanDistance < 0.35) {
        float laserFactor = smoothstep(0.35, 0.0, vScanDistance);
        
        // Chromatic rainbow dispersion on laser leading edge
        vec3 laserRainbow = vec3(
          sin(vPhase * 3.0 + u_time * 4.0) * 0.5 + 0.5,
          sin(vPhase * 3.0 + u_time * 4.0 + 2.094) * 0.5 + 0.5,
          sin(vPhase * 3.0 + u_time * 4.0 + 4.188) * 0.5 + 0.5
        );

        vec3 sweepColor = mix(u_laserColor, laserRainbow, u_chromaticStrength * 0.6);
        baseColor = mix(baseColor, sweepColor * 1.8, laserFactor);
        alpha = min(1.0, alpha + laserFactor * 0.6);
      }

      // Minutiae Node Glowing Target Accent (golden dots)
      if (vMinutiae > 0.5) {
        vec3 minutiaeColor = vec3(1.0, 0.9, 0.2); // Golden target dot
        if (u_isScanning > 0.5) {
          minutiaeColor = vec3(0.1, 1.0, 0.5); // Turns green locked during scan
        }
        baseColor = mix(baseColor, minutiaeColor * 2.2, 0.7);
        alpha = 1.0;
      }

      // Pulse Wave flash
      baseColor += u_primaryColor * vPulse * 1.5;

      // Final color with glow multiplier
      vec3 finalColor = baseColor * u_glowIntensity;

      gl_FragColor = vec4(finalColor, alpha * 0.92 * u_dimFactor);
    }
  `;

  function initThreeScene(){
    if(!container || typeof THREE === "undefined") return false;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // Scene & Camera - positioned at z = 9.8, y = 0.1, FOV 40
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.z = 9.8;
    camera.position.y = 0.1;

    // WebGL Renderer with Alpha
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);

    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const activeTheme = FINGERPRINT_THEMES[activeThemeIndex];

    // ==========================================
    // 1. GENERATE AUTHENTIC 3D FINGERPRINT GEOMETRY (38,000 PTS)
    // ==========================================
    const pointCount = 38000;
    const positions = new Float32Array(pointCount * 3);
    const ridgeIndices = new Float32Array(pointCount);
    const phases = new Float32Array(pointCount);
    const minutiaeArray = new Float32Array(pointCount);
    const sizes = new Float32Array(pointCount);

    const totalRidges = activeTheme.ridgeDensity || 38;
    let ptr = 0;
    const minutiaeCandidates = [];

    for (let r = 1; r <= totalRidges; r++) {
      const radiusX = (r / totalRidges) * 1.85;
      const radiusY = (r / totalRidges) * 2.35;
      const pointsInRidge = Math.floor(450 + r * 35);

      for (let i = 0; i < pointsInRidge; i++) {
        if (ptr >= pointCount) break;

        const theta = (i / pointsInRidge) * Math.PI * 2;
        
        // Authentic Biometric Whorl/Loop Equation
        const coreDistort = Math.sin(theta * 2.0 + r * 0.15) * 0.12 * (1.0 - r / totalRidges);
        const archWave = Math.sin(theta * 3.0) * 0.08 * (r / totalRidges);
        const deltaSpiral = Math.cos(theta * 1.0 - r * 0.2) * 0.09;

        // Elliptical Base with Dermal Arch Curvature
        let x = Math.cos(theta) * (radiusX + coreDistort + deltaSpiral);
        let y = Math.sin(theta) * (radiusY + archWave) + (Math.pow(x, 2.0) * 0.12);

        // 3D Dermal Depth profile (convex fingerprint dome)
        const normalizedDist = Math.sqrt(Math.pow(x / 1.85, 2) + Math.pow(y / 2.35, 2));
        let z = 0;
        if (normalizedDist < 1.0) {
          z = Math.cos(normalizedDist * Math.PI * 0.5) * 0.45;
        } else {
          z = 0.0;
        }

        z += Math.sin(r * Math.PI * 1.8) * 0.04;

        // Subtle jitter
        const jitter = 0.015;
        x += (Math.random() - 0.5) * jitter;
        y += (Math.random() - 0.5) * jitter;
        z += (Math.random() - 0.5) * (jitter * 0.5);

        // Minutiae Node Determination
        let isMinutiae = 0;
        if (Math.random() < 0.0035 && r > 6 && r < totalRidges - 4) {
          isMinutiae = 1;
          minutiaeCandidates.push({ x, y, z });
        }

        positions[ptr * 3] = x;
        positions[ptr * 3 + 1] = y;
        positions[ptr * 3 + 2] = z;

        ridgeIndices[ptr] = r;
        phases[ptr] = theta;
        minutiaeArray[ptr] = isMinutiae;
        sizes[ptr] = isMinutiae > 0 ? 0.08 : (0.026 + (r / totalRidges) * 0.012);

        ptr++;
      }
    }

    const fingerprintGeo = new THREE.BufferGeometry();
    fingerprintGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    fingerprintGeo.setAttribute('a_ridgeIndex', new THREE.BufferAttribute(ridgeIndices, 1));
    fingerprintGeo.setAttribute('a_phase', new THREE.BufferAttribute(phases, 1));
    fingerprintGeo.setAttribute('a_minutiae', new THREE.BufferAttribute(minutiaeArray, 1));
    fingerprintGeo.setAttribute('a_size', new THREE.BufferAttribute(sizes, 1));

    customShaderMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        u_time: { value: 0 },
        u_scanProgress: { value: 0 },
        u_isScanning: { value: 0 },
        u_scanPulse: { value: 0 },
        u_mouse: { value: new THREE.Vector2(0, 0) },
        u_dimFactor: { value: 1.0 },
        u_primaryColor: { value: new THREE.Color(...activeTheme.primaryColor) },
        u_accentColor: { value: new THREE.Color(...activeTheme.accentColor) },
        u_laserColor: { value: new THREE.Color(...activeTheme.laserColor) },
        u_glowIntensity: { value: activeTheme.glowIntensity },
        u_chromaticStrength: { value: activeTheme.chromaticStrength }
      }
    });

    fingerprintMesh = new THREE.Points(fingerprintGeo, customShaderMaterial);
    scene.add(fingerprintMesh);

    // ==========================================
    // 2. BIOMETRIC RETICLE TARGETS & LASER LINE
    // ==========================================
    frameGroup = new THREE.Group();

    const laserBeamGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-2.2, 0, 0.3),
      new THREE.Vector3(2.2, 0, 0.3),
    ]);
    laserBeamMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(...activeTheme.laserColor),
      transparent: true,
      opacity: 0.75,
      linewidth: 2,
    });
    laserBeamLine = new THREE.Line(laserBeamGeo, laserBeamMat);
    laserBeamLine.position.y = 0;
    scene.add(laserBeamLine);

    // Minutiae Target Crosshairs (Glowing golden rings matching user reference image)
    const targetRingGeo = new THREE.RingGeometry(0.04, 0.06, 16);
    const targetRingMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });

    targetGroup = new THREE.Group();
    minutiaeCandidates.slice(0, 14).forEach((pt) => {
      const ring = new THREE.Mesh(targetRingGeo, targetRingMat);
      ring.position.set(pt.x, pt.y, pt.z + 0.05);
      targetGroup.add(ring);
    });
    scene.add(targetGroup);
    scene.add(frameGroup);

    // Ambient floating dust particles (120 pts)
    const particleCount = 120;
    const particleGeo = new THREE.BufferGeometry();
    const particlePos = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
      particlePos[i] = (Math.random() - 0.5) * 8;
      particlePos[i + 1] = (Math.random() - 0.5) * 8;
      particlePos[i + 2] = (Math.random() - 0.5) * 4;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
    const particleMat = new THREE.PointsMaterial({
      color: 0x88ccff,
      size: 0.02,
      transparent: true,
      opacity: 0.35,
    });
    particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    updateThemeUI();
    return true;
  }

  function updateThemeUI(){
    const t = FINGERPRINT_THEMES[activeThemeIndex];
    if(themeNameLabel) themeNameLabel.textContent = t.name.toUpperCase();
    if(hologramSubtag){
      hologramSubtag.textContent = isScanning ? "ANALYZING BIOMETRIC TOPOGRAPHY..." : t.subtitle ? t.subtitle.slice(0, 48).toUpperCase() : "3D BIOMETRIC SENSOR READY";
    }
  }

  function animate(now){
    animId = requestAnimationFrame(animate);

    // FPS Meter
    frameCount++;
    if (now - fpsTimer >= 1000) {
      if (hologramFPS) hologramFPS.textContent = Math.round((frameCount * 1000) / (now - fpsTimer)) + " FPS";
      frameCount = 0;
      fpsTimer = now;
    }

    const elapsedTime = now * 0.001;
    const theme = FINGERPRINT_THEMES[activeThemeIndex];

    dimFactor += (targetDimFactor - dimFactor) * 0.1;

    // Scan progress computation
    const sweepSpeed = isScanning ? 1.8 : 0.65;
    const scanT = (Math.sin(elapsedTime * sweepSpeed) * 0.5 + 0.5);

    if (customShaderMaterial && scene && camera && renderer) {
      customShaderMaterial.uniforms.u_time.value = elapsedTime;
      customShaderMaterial.uniforms.u_scanProgress.value = scanT;
      customShaderMaterial.uniforms.u_isScanning.value = isScanning ? 1.0 : 0.0;
      customShaderMaterial.uniforms.u_dimFactor.value = dimFactor;

      // Scan Laser sweep position
      const currentLaserY = 2.4 - scanT * 4.8;
      if (laserBeamLine && laserBeamMat) {
        laserBeamLine.position.y = currentLaserY;
        laserBeamMat.color.setRGB(theme.laserColor[0], theme.laserColor[1], theme.laserColor[2]);
        laserBeamMat.opacity = (isScanning ? 0.95 : 0.65) * dimFactor;
      }

      // Scanning shockwave expansion
      if (isScanning) {
        scanPulse = (scanPulse + 0.02) % 1.0;
        customShaderMaterial.uniforms.u_scanPulse.value = scanPulse;
      }

      // Smooth mouse interpolation
      currentMouseX += (targetMouseX - currentMouseX) * 0.05;
      currentMouseY += (targetMouseY - currentMouseY) * 0.05;
      customShaderMaterial.uniforms.u_mouse.value.set(currentMouseX, currentMouseY);

      // Subtle 3D perspective pitch and yaw
      if (fingerprintMesh) {
        fingerprintMesh.rotation.y = currentMouseX * 0.35;
        fingerprintMesh.rotation.x = -currentMouseY * 0.25;
      }
      if (frameGroup) {
        frameGroup.rotation.y = currentMouseX * 0.2;
        frameGroup.rotation.x = -currentMouseY * 0.15;
      }
      if (targetGroup) {
        targetGroup.rotation.y = currentMouseX * 0.35;
        targetGroup.rotation.x = -currentMouseY * 0.25;
        targetGroup.children.forEach((ring, idx) => {
          const s = 1.0 + Math.sin(elapsedTime * 4.0 + idx) * 0.25;
          ring.scale.set(s, s, s);
        });
      }

      // Dust particle slow drift
      if (particles) {
        particles.rotation.y = elapsedTime * 0.04;
        particles.rotation.x = Math.sin(elapsedTime * 0.05) * 0.1;
      }

      renderer.render(scene, camera);
    }
  }

  function resize(){
    if(!container || !renderer || !camera) return;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  }

  function triggerScan(callback){
    // Cycle holographic biometric theme automatically on every scan/touch
    cycleTheme();
    isScanning = true;
    scanStartTime = performance.now();
    updateThemeUI();
    setTimeout(()=>{
      isScanning = false;
      updateThemeUI();
      if(typeof callback === "function") callback();
    }, SCAN_DURATION);
  }

  function cycleTheme(){
    activeThemeIndex = (activeThemeIndex + 1) % FINGERPRINT_THEMES.length;
    try { localStorage.setItem("atl_hologram_theme", String(activeThemeIndex)); }catch(e){}
    const t = FINGERPRINT_THEMES[activeThemeIndex];
    if(customShaderMaterial){
      customShaderMaterial.uniforms.u_primaryColor.value = new THREE.Color(...t.primaryColor);
      customShaderMaterial.uniforms.u_accentColor.value = new THREE.Color(...t.accentColor);
      customShaderMaterial.uniforms.u_laserColor.value = new THREE.Color(...t.laserColor);
      customShaderMaterial.uniforms.u_glowIntensity.value = t.glowIntensity;
      customShaderMaterial.uniforms.u_chromaticStrength.value = t.chromaticStrength;
    }
    if(laserBeamMat){
      laserBeamMat.color.setRGB(...t.laserColor);
    }
    updateThemeUI();
  }

  function dim(){ targetDimFactor = 0.18; }
  function undim(){ targetDimFactor = 1.0; }

  // Parallax Event Listeners
  if(scannerStageEl){
    scannerStageEl.addEventListener("mousemove", (e)=>{
      const rect = scannerStageEl.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      targetMouseX = x;
      targetMouseY = y;
    });
    scannerStageEl.addEventListener("mouseleave", ()=>{
      targetMouseX = 0;
      targetMouseY = 0;
    });
    scannerStageEl.addEventListener("touchmove", (e)=>{
      if(e.touches && e.touches[0]){
        const rect = scannerStageEl.getBoundingClientRect();
        const x = ((e.touches[0].clientX - rect.left) / rect.width) * 2 - 1;
        const y = -(((e.touches[0].clientY - rect.top) / rect.height) * 2 - 1);
        targetMouseX = x;
        targetMouseY = y;
      }
    }, { passive: true });
    scannerStageEl.addEventListener("touchend", ()=>{
      targetMouseX = 0;
      targetMouseY = 0;
    });
  }

  if(themeCycleBtn){
    themeCycleBtn.addEventListener("click", (e)=>{
      e.stopPropagation();
      cycleTheme();
    });
  }

  window.addEventListener("resize", resize);
  setTimeout(()=>{
    if(initThreeScene()){
      fpsTimer = performance.now();
      requestAnimationFrame(animate);
    }
  }, 100);

  return {
    triggerScan,
    cycleTheme,
    dim,
    undim,
    resize,
    getTheme: () => FINGERPRINT_THEMES[activeThemeIndex]
  };
})();

// Alias for backward compatibility
const ParticleEngine = {
  trigger: () => FingerprintHologramEngine.triggerScan(),
  disperse: () => FingerprintHologramEngine.undim(),
  clear: () => FingerprintHologramEngine.undim(),
  resize: () => FingerprintHologramEngine.resize()
};

const Timers={ _ids:{}, set(n,id){ this.clear(n); this._ids[n]=id; },
  clear(n){ if(this._ids[n]){ clearTimeout(this._ids[n]); clearInterval(this._ids[n]); } delete this._ids[n]; },
  clearAll(){ Object.keys(this._ids).forEach(k=>{ clearTimeout(this._ids[k]); clearInterval(this._ids[k]); }); this._ids={}; } };
let currentTab="students", selectedStudentId=null, calendarMonth=new Date();

function openModal(m){ m.classList.add("open"); }
function closeModal(m){ m.classList.remove("open"); }
[enrollModal, holidayModal, overrideModal, correctionModal, confirmModal].forEach(m=>{
  if(!m) return;
  m.addEventListener("click", (e)=>{
    if(e.target!==m) return;
    if(m===enrollModal){ _enrollAbort=true; if(_enrollPoll) clearTimeout(_enrollPoll); }
    closeModal(m);
    if(m===enrollModal) resumeSensorScan();
  });
});

// ---- terminal ----
let _resultHold=false;
function setResultVisible(on){
  const t=$("terminal");
  if(t) t.classList.toggle("has-result", !!on);
}
function hidePrompt(){
  if(!promptText) return;
  promptText.classList.remove("scanning","identifying","detecting");
  promptText.classList.add("is-hidden");
  promptText.style.opacity="";
  promptText.style.transform="";
}
function groupLabel(student){
  const parts=[];
  if(student && student.section) parts.push(student.section);
  if(student && student.batch) parts.push(student.batch);
  return parts.length ? parts.join(" · ") : "—";
}
function setState(state){
  if(!promptText) return;
  promptText.classList.remove("scanning","identifying","detecting","is-hidden");
  promptText.style.opacity="";
  promptText.style.transform="";
  if(state==="identifying" || state==="detecting" || state==="scanning"){
    promptText.textContent="IDENTIFYING\u2026";
    promptText.classList.add("identifying");
  } else {
    promptText.textContent="PLACE YOUR FINGER";
  }
}
function showIdentity(student, status, time, dateStr){
  hidePrompt();
  setResultVisible(true);
  _resultHold=true;
  if(_scanLoopTimer){ clearTimeout(_scanLoopTimer); _scanLoopTimer=null; }
  Timers.clear("hold");
  Timers.clear("crossfade");
  Timers.clear("disperse");
  if(idleLayer) idleLayer.classList.add("hidden");
  if(unknownLayer) unknownLayer.classList.remove("visible");

  const norm = String(status||"").trim().toLowerCase();
  let displayStatus = "Present";
  if(norm==="late") displayStatus="Late";
  else if(norm==="already recorded" || norm==="duplicate") displayStatus="Duplicate";
  else if(norm==="not scheduled" || norm==="not_scheduled") displayStatus="Not Scheduled";
  else if(status) displayStatus=status;

  const resolvedTime = (time || "").slice(0,5) || new Date().toTimeString().slice(0,5);
  const resolvedDate = dateStr || new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  // 1. Populate real student information into crisp HTML ID Card elements
  if(idName) idName.textContent = student.name || "—";
  if(idRoll) idRoll.textContent = student.roll || "—";
  if(idClass) idClass.textContent = student.className || "—";
  if(idGroup) idGroup.textContent = groupLabel(student);
  if(idSid) idSid.textContent = student.sid || (student.id ? "ID-" + student.id : "—");
  if(idStatus){
    idStatus.textContent = displayStatus;
    idStatus.style.color = (norm === "late" ? "#E6D5B8" : (norm === "duplicate" ? "#9E9A91" : "#D8D2C4"));
  }
  if(idTime) idTime.textContent = resolvedTime + (resolvedDate ? " · " + resolvedDate : "");
  if(idConfirm){
    if(norm === "late"){
      idConfirm.textContent = "LATE ATTENDANCE RECORDED";
      idConfirm.style.color = "#E6D5B8";
    } else if(norm === "duplicate" || norm === "already recorded"){
      idConfirm.textContent = "ATTENDANCE ALREADY RECORDED";
      idConfirm.style.color = "#9E9A91";
    } else {
      idConfirm.textContent = "ATTENDANCE RECORDED";
      idConfirm.style.color = "#D8D2C4";
    }
  }

  // Set real student photo / fallback initials
  if(photoImg && photoFallback && photoWrap){
    if(student.photo){
      photoImg.src = student.photo;
      photoImg.style.display = "block";
      photoFallback.style.display = "none";
    } else {
      photoImg.style.display = "none";
      photoImg.removeAttribute("src");
      photoFallback.style.display = "flex";
      photoFallback.textContent = (student.name || "--").trim().slice(0,2).toUpperCase();
    }
  }

  // 2. Scan Trigger: 3D Volumetric Hologram high-speed scan sweep
  FingerprintHologramEngine.triggerScan();

  // 3. At 1.2s: Smoothly cross-fade and reveal the clean, sharp HTML student ID card
  Timers.set("crossfade", setTimeout(()=>{
    if(identityLayer) identityLayer.classList.add("visible");
    FingerprintHologramEngine.dim();
  }, 1200));

  // 4. The real student card stays fully visible & legible for 4.0s (1.2s + 4.0s = 5.2s)
  Timers.set("hold", setTimeout(()=>{
    if(identityLayer) identityLayer.classList.remove("visible");
    FingerprintHologramEngine.undim();
    if(idleLayer) idleLayer.classList.remove("hidden");
    setResultVisible(false);
    setState("ready");
    _resultHold=false;
    if(_scanLoopActive && adminLayer && !adminLayer.classList.contains("open") && enrollModal && !enrollModal.classList.contains("open")){
      _scanLoopTimer=setTimeout(sensorScanLoop, 180);
    }
  }, 5200));
}
function showUnknown(){
  hidePrompt();
  setResultVisible(true);
  _resultHold=true;
  if(_scanLoopTimer){ clearTimeout(_scanLoopTimer); _scanLoopTimer=null; }
  Timers.clear("hold");
  Timers.clear("crossfade");
  FingerprintHologramEngine.triggerScan();
  if(idleLayer) idleLayer.classList.add("hidden");
  identityLayer.classList.remove("visible");
  const _ut = unknownTitleEl || (unknownLayer && unknownLayer.querySelector(".unknown-title"));
  if(_ut) _ut.textContent="NOT RECOGNIZED";
  unknownLayer.classList.add("visible");
  Timers.set("hold", setTimeout(()=>{
    unknownLayer.classList.remove("visible");
    FingerprintHologramEngine.undim();
    if(idleLayer) idleLayer.classList.remove("hidden");
    setResultVisible(false);
    setState("ready");
    _resultHold=false;
    if(_scanLoopActive && adminLayer && !adminLayer.classList.contains("open") && enrollModal && !enrollModal.classList.contains("open")){
      _scanLoopTimer=setTimeout(sensorScanLoop, 180);
    }
  }, 2800));
}
function tickClock(){
  if(!leftClock) return;
  const n=new Date();
  leftClock.textContent=n.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'})+" · "+n.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
}
if(leftClock){ Timers.set("clock", setInterval(tickClock,1000)); tickClock(); }

// Real scan hook (called by the sensor loop and the injected backend bridge)
let _lastHandledScanSeq=0;
function upsertStudent(raw){
  if(!raw || raw.id==null) return null;
  const mapped=mapStudent(raw);
  const idx=Students.findIndex(x=>x.id===mapped.id);
  if(idx>=0){
    const merged=Object.assign({}, Students[idx]);
    Object.keys(mapped).forEach(k=>{
      if(mapped[k]!==undefined && mapped[k]!==null) merged[k]=mapped[k];
    });
    if(!merged.fid && Students[idx].fid) merged.fid=Students[idx].fid;
    if(!merged.photo && Students[idx].photo) merged.photo=Students[idx].photo;
    Students[idx]=merged;
  } else Students.push(mapped);
  return Students.find(x=>x.id===mapped.id);
}
function studentByFid(fid){
  const n=String(fid||"").replace(/^F-/i,"");
  if(!n) return null;
  return Students.find(x=>String(x.fid||"").replace(/^F-/i,"")===n) || null;
}
window.handleRealScan = async function(fid, info){
  info = info || {};
  const seq=Number(info.seq||0);
  if(seq && seq<=_lastHandledScanSeq) return;
  if(seq) _lastHandledScanSeq=seq;
  if(fid && String(fid).indexOf("__unknown__")===0){
    setState("identifying");
    await new Promise(r=>setTimeout(r, 180));
    if(seq && seq < _lastHandledScanSeq) return;
    showUnknown();
    loadTodayAttendance().then(()=>{ if(currentTab==="today") renderToday(); });
    return;
  }
  let s = info.student ? upsertStudent(info.student) : null;
  if(!s) s = studentByFid(fid);
  if(!s){
    try{
      if(!Students.length) await loadStudents();
      s = studentByFid(fid);
      if(!s && fid){
        const last = await api("/api/scan/last",{method:"GET"}).catch(()=>null);
        if(last && last.student) s = upsertStudent(last.student);
      }
    }catch(e){}
  }
  if(!s){
    setState("identifying");
    await new Promise(r=>setTimeout(r, 180));
    if(seq && seq < _lastHandledScanSeq) return;
    showUnknown();
    loadTodayAttendance().then(()=>{ if(currentTab==="today") renderToday(); });
    return;
  }
  setState("identifying");
  await new Promise(r=>setTimeout(r, 180));
  if(seq && seq < _lastHandledScanSeq) return;
  const status = info.status ? statusUI(info.status) : "Present";
  const time = info.time || new Date().toTimeString().slice(0,8);
  showIdentity(s, status, time, info.date ? fmtDate(info.date) : "");
  loadTodayAttendance().then(()=>{ if(currentTab==="today") renderToday(); });
};
let _scanLoopActive=true, _scanRequestInFlight=false, _scanLoopTimer=null;
function pauseSensorScan(){ _scanLoopActive=false; if(_scanLoopTimer){ clearTimeout(_scanLoopTimer); _scanLoopTimer=null; } if(promptText){ promptText.classList.remove("scanning","identifying","detecting","is-hidden"); } }
function resumeSensorScan(){
  _scanLoopActive=true;
  if(!_resultHold) setState("ready");
  if(_scanRequestInFlight){
    if(!_scanLoopTimer) _scanLoopTimer=setTimeout(sensorScanLoop, 400);
    return;
  }
  if(_scanLoopTimer){ clearTimeout(_scanLoopTimer); _scanLoopTimer=null; }
  sensorScanLoop();
}
function finishEnrollUi(){
  _enrollAbort=true;
  if(_enrollPoll){ clearTimeout(_enrollPoll); _enrollPoll=null; }
  if(enrollModal) closeModal(enrollModal);
}
function returnToFrontPage(rawStudent){
  finishEnrollUi();
  if(rawStudent) upsertStudent(rawStudent);
  try{ cacheSave(); }catch(e){}
  if(adminLayer) adminLayer.classList.remove("open");
  resumeSensorScan();
}
async function sensorScanLoop(){
  if(!_scanLoopActive || _scanRequestInFlight) return;
  if(_resultHold){ _scanLoopTimer=setTimeout(sensorScanLoop, 180); return; }
  if(adminLayer && adminLayer.classList.contains("open")){ _scanLoopTimer=setTimeout(sensorScanLoop,500); return; }
  if(enrollModal && enrollModal.classList.contains("open")){ _scanLoopTimer=setTimeout(sensorScanLoop,500); return; }
  _scanRequestInFlight=true;
  let nextDelay=150;
  try{
    const res=await api("/api/scan",{method:"POST",body:JSON.stringify({waitSec:2})});
    if(res && res.seq !== undefined && res.seq !== null){
      if(res.student){
        upsertStudent(res.student);
        cacheSave();
        const fidNum = (res.student.fingerId!=null && res.student.fingerId!==undefined) ? res.student.fingerId : res.fingerId;
        const fid = (fidNum!=null && fidNum!==undefined) ? "F-"+fidNum : ("__stu__"+res.student.id);
        await window.handleRealScan(fid,{status:res.status||res.reason,time:res.time,date:res.date,seq:res.seq,student:res.student});
      } else if(res.reason==="UNKNOWN" || res.status==="UNKNOWN"){
        await window.handleRealScan("__unknown__"+res.seq,{seq:res.seq});
      }
    }
  }catch(err){
    const reason=err.body&&err.body.reason;
    if(reason!=="NO_FINGER") nextDelay=2000;
    if(reason!=="NO_FINGER" && reason!=="SENSOR_BUSY" && reason!=="SENSOR_DISCONNECT") console.warn("Sensor scan:",err.message);
  }finally{
    _scanRequestInFlight=false;
    if(_scanLoopActive){
      if(_resultHold){
        // hold active — result visible, do not overwrite prompt or schedule duplicate
      } else {
        setState("ready");
        _scanLoopTimer=setTimeout(sensorScanLoop,nextDelay);
      }
    }
  }
}
// ---- render: Students ----
function populateScheduleSelector(){
  const calSel=$("calClassSelect");
  if(!calSel) return;
  const cur=calSel.value;
  const allBatches = [...new Set([...(Batches||[]), ...Students.map(s=>s.batch).filter(Boolean), ...(Settings.batches||[]), ...Object.keys(BatchSchedules||{})])].sort();
  
  let html = '<option value="">All classes (global)</option>';
  if(Classes.length){
    Classes.forEach(c => {
      const entry = ClassSchedules[c];
      const hasTime = entry && typeof entry === "object" && (entry.startTime || entry.endTime);
      const timeStr = hasTime ? ` (${entry.startTime || "--"}–${entry.endTime || "--"})` : "";
      html += `<option value="${esc(c)}" ${c===cur?'selected':''}>${esc(c)}${esc(timeStr)}</option>`;
    });
  }
  if(allBatches.length){
    allBatches.forEach(b => {
      const val = "batch:" + b;
      const entry = BatchSchedules[b];
      const hasTime = entry && typeof entry === "object" && (entry.startTime || entry.endTime);
      const timeStr = hasTime ? ` (${entry.startTime || "--"}–${entry.endTime || "--"})` : "";
      html += `<option value="${esc(val)}" ${(val===cur || b===cur)?'selected':''}>Batch: ${esc(b)}${esc(timeStr)}</option>`;
    });
  }
  calSel.innerHTML = html;
  syncCalClassCustomSelect();
}

function renderClassFilters(){
  const opts=['<option value="">All Classes</option>'].concat(Classes.map(c=>`<option>${esc(c)}</option>`)).join("");
  if(classFilter) classFilter.innerHTML=opts;
  if(todayClassFilter) todayClassFilter.innerHTML=opts;
  reportClass.innerHTML='<option value="">Select class</option>'+Classes.map(c=>`<option>${esc(c)}</option>`).join("");
  if(batchFilter){
    const batches=[...new Set([...(Batches||[]), ...Students.map(s=>s.batch).filter(Boolean), ...(Settings.batches||[])])].sort();
    const cur=batchFilter.value;
    batchFilter.innerHTML='<option value="">All Batches</option>'+batches.map(b=>`<option ${b===cur?'selected':''}>${esc(b)}</option>`).join("");
    if(!batches.includes(cur)) batchFilter.value="";
  }
  populateScheduleSelector();
  enhanceAllSelects();
}
function renderStudentList(){
  const q=(searchInput.value||"").toLowerCase(), cf=classFilter?classFilter.value:"", bf=batchFilter?batchFilter.value:"", sf=studentStatusFilter?studentStatusFilter.value:"active";
  let list=Students.filter(s=>{
    if(sf==="active" && !s.active) return false;
    if(sf==="inactive" && s.active) return false;
    if(cf && s.class!==cf) return false;
    if(bf && (s.batch||"")!==bf) return false;
    if(!q) return true;
    return (s.name+" "+s.roll+" "+s.class+" "+(s.batch||"")+" "+s.phone+" "+s.fid+" "+s.id+" "+(s.section||"")+" "+(s.parent||"")).toLowerCase().includes(q);
  });
  list.sort((a,b)=> (b.active - a.active) || a.name.localeCompare(b.name));
  if(!list.length){ studentListEl.innerHTML=`<div class="empty"><b>No students found</b>Try different search or add a new student.</div>`; return; }
  studentListEl.innerHTML=list.map(s=>{
    const initials=s.name.trim().split(" ").map(w=>w[0]).slice(0,2).join("").toUpperCase();
    const thumb=s.photo?`<img src="${esc(s.photo)}" alt="">`:`<div class="student-thumb-fallback">${esc(initials)}</div>`;
    const batchTxt=s.batch?` · ${esc(s.batch)}`:"";
    const inactiveBadge = s.active ? "" : `<span class="badge" style="margin-left:6px">Inactive</span>`;
    const rowStyle = s.active ? "" : ` style="opacity:0.6"`;
    return `<div class="student-row ${selectedStudentId===s.id?"active":""}" data-id="${s.id}"${rowStyle}><div class="student-thumb">${thumb}</div><div class="student-info"><div class="student-name">${esc(s.name)}${inactiveBadge}</div><div class="student-meta"><span>${esc(s.roll)}</span><span>${esc(s.class)}${batchTxt}</span><span class="student-roll">${esc(s.fid||"no fp")}</span></div></div></div>`;
  }).join("");
}
function studentStats(s){
  const start=Settings.startDate||todayISO(), today=todayISO();
  const rows=Attendance.filter(a=>a.studentId===s.id && a.date>=start && a.date<=today);
  const present=rows.filter(a=>a.status==="Present").length;
  const late=rows.filter(a=>a.status==="Late").length;
  const dup=rows.filter(a=>a.isDuplicate).length;
  const workdays=Math.max(1, 30); // backend-computed elsewhere; display today-recent
  const pct=rows.length?Math.round(((present+late)/(present+late+(rows.filter(a=>a.status==="Absent").length||0)))*100):100;
  return {present,late,absent:0,pct,working:workdays};
}
function renderStudentDetail(id){
  const s=Students.find(x=>x.id===id);
  if(!s){ detailScroll.innerHTML=`<div class="empty"><b>No student selected</b>Choose a student.</div>`; return; }
  const initials=s.name.trim().split(" ").map(w=>w[0]).slice(0,2).join("").toUpperCase();
  const photo=s.photo?`<img src="${esc(s.photo)}" alt="">`:`<div class="detail-photo-fallback">${esc(initials)}</div>`;
  const history=Attendance.filter(a=>a.studentId===s.id).slice(-60).reverse();
  const histRows=history.length?history.map(a=>`<tr><td>${esc(a.date)}</td><td>${esc(a.time)}</td><td><span class="badge ${a.status.toLowerCase().replace(" ","-")}">${esc(a.status)}</span></td><td>${esc(a.fingerId!=null?"F-"+a.fingerId:"")}</td><td><button class="btn" data-correct data-correct-sid="${s.id}" data-correct-date="${esc(a.date)}" data-correct-status="${esc(a.status)}" style="height:22px;padding:0 8px;font-size:9px">Correct</button></td></tr>`).join(""):`<tr><td colspan="5"><div class="empty"><b>No records</b>Scan results will appear here from the sensor.</div></td></tr>`;
  detailScroll.innerHTML=`
    <div class="detail-card">
      <div style="display:flex;gap:18px;flex-wrap:wrap">
        <div class="detail-photo">${photo}</div>
        <div style="flex:1 1 280px;min-width:0">
          <div style="font-family:var(--serif);font-size:30px;text-transform:uppercase;letter-spacing:-0.02em;line-height:0.95">${esc(s.name)}</div>
          <div style="margin-top:8px"><span class="badge ${s.active?'present':'not-scheduled'}">${esc(s.active?"Active":"Inactive")}</span>${s.batch?` <span class="badge">${esc(s.batch)}</span>`:""}</div>
          <div class="detail-grid">
            <div class="detail-field"><label>Roll</label><span>${esc(s.roll)}</span></div>
            <div class="detail-field"><label>Class</label><span>${esc(s.class)}</span></div>
            <div class="detail-field"><label>Batch / Group</label><span>${esc(s.batch||"—")}</span></div>
            <div class="detail-field"><label>Section</label><span>${esc(s.section||"—")}</span></div>
            <div class="detail-field"><label>Student ID</label><span>${esc(String(s.id))}</span></div>
            <div class="detail-field"><label>Parent</label><span>${esc(s.parent||"—")}</span></div>
            <div class="detail-field"><label>Phone</label><span>${esc(s.phone||"—")}</span></div>
            <div class="detail-field"><label>Address</label><span>${esc(s.address||"—")}</span></div>
            <div class="detail-field"><label>Fingerprint</label><span>${esc(s.fid||"—")} · ${s.active?"Active":"Inactive"}</span></div>
          </div>
          <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
            <button class="btn primary" data-action="edit" data-id="${s.id}">Edit information</button>
            <button class="btn" data-action="reenroll" data-id="${s.id}">Re-enroll fingerprint</button>
            <div style="display:inline-flex;align-items:center;gap:8px;padding:4px 10px;border:1px solid var(--line);background:var(--paper);border-radius:2px" title="Toggle student status (preserves fingerprint & record)">
              <span style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:var(--ink-2);font-weight:600">Status:</span>
              <div class="toggle ${s.active?'on':''}" data-action="toggle-status" data-id="${s.id}" role="switch" aria-checked="${s.active?'true':'false'}" style="cursor:pointer"></div>
              <span style="font-size:11px;font-weight:500;color:${s.active?'var(--ok)':'var(--ink-3)'}">${s.active?'Active':'Inactive'}</span>
            </div>
            <button class="btn danger" data-action="delete" data-id="${s.id}" title="Completely delete student record">Delete student</button>
            <button class="btn" data-action="print" data-id="${s.id}">Print profile</button>
            <button class="btn" data-correct data-correct-sid="${s.id}" data-correct-date="${esc(todayISO())}" data-correct-status="Present" style="border-style:dashed">Correct today</button>
          </div>
        </div>
      </div>
      <div class="table-wrap"><div style="padding:10px 12px;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;border-bottom:1px solid var(--line)"><span>Attendance history — recent scans</span></div><div class="table-scroll large"><table><thead><tr><th>Date</th><th>Time</th><th>Status</th><th>Fingerprint</th><th>Action</th></tr></thead><tbody>${histRows}</tbody></table></div></div>
    </div>`;
}
function selectStudent(id){ selectedStudentId=id; renderStudentList(); renderStudentDetail(id); }
// ---- render: Today ----
function renderToday(){
  const t=todayISO(), cf=todayClassFilter.value, sf=todayStatusFilter.value, sort=todaySort.value;
  const byId=new Map(Students.map(s=>[s.id,s]));
  let rows=Attendance.filter(a=>a.date===t && a.studentId).map(a=>{ const s=byId.get(a.studentId); return s?{a,s}:null; }).filter(Boolean);
  if(cf) rows=rows.filter(r=>r.s.class===cf);
  // backend-persisted schedule: determine scheduled vs not scheduled via per-student precedence
  const allActiveFiltered = Students.filter(s=>s.active && (!cf || s.class===cf));
  const scheduledFiltered = allActiveFiltered.filter(s=> isWorkingDayForStudent(t, s));
  const notScheduledFiltered = allActiveFiltered.filter(s=> !isWorkingDayForStudent(t, s));
  const isGlobalWorking = isWorkingDayUI(t);
  if(sf){
    if(sf==="Duplicate") rows=rows.filter(r=>r.a.isDuplicate);
    else if(sf==="Unknown") rows=rows.filter(r=>false);
    else if(sf==="Not Scheduled"){
      // show not-scheduled students as muted rows (UI preview)
      rows = notScheduledFiltered.map(s=>({a:{status:"Not Scheduled", time:"—", isDuplicate:false, fingerId:s.fid?parseInt(String(s.fid).replace("F-","")):null, date:t}, s}));
    }
    else if(sf==="Absent"){
      const presentIds = new Set(rows.filter(r=>r.a.status==="Present"||r.a.status==="Late").map(r=>r.s.id));
      const absentStudents = scheduledFiltered.filter(s=> !presentIds.has(s.id));
      rows = absentStudents.map(s=>({a:{status:"Absent", time:"—", isDuplicate:false, fingerId:null, date:t}, s}));
    }
    else rows=rows.filter(r=>r.a.status===sf);
  }
  rows.sort((x,y)=>{
    if(sort==="time_desc") return (y.a.time||"").localeCompare(x.a.time||"");
    if(sort==="time_asc") return (x.a.time||"").localeCompare(y.a.time||"");
    if(sort==="name_asc") return x.s.name.localeCompare(y.s.name);
    if(sort==="roll_asc") return x.s.roll.localeCompare(y.s.roll);
    if(sort==="class_asc") return x.s.class.localeCompare(y.s.class);
    return 0;
  });
  const total= allActiveFiltered.length;
  const scheduledTotal = scheduledFiltered.length;
  const notScheduled = notScheduledFiltered.length;
  // Prefer backend KPI if available for authoritative counts (scheduled never includes Not Scheduled)
  let presentAll, lateAll, absentAll, pct;
  if(Kpis && Kpis.date===t && !cf && typeof Kpis.scheduled==="number"){
    presentAll = Kpis.present||0;
    lateAll = Kpis.late||0;
    absentAll = Kpis.absent||Math.max(0, (Kpis.scheduled||scheduledTotal) - presentAll - lateAll);
    pct = Kpis.scheduled ? Math.round((presentAll+lateAll)/Kpis.scheduled*100) : 0;
  } else {
    presentAll = Attendance.filter(a=>a.date===t && a.studentId).map(a=>{const s=byId.get(a.studentId); return s&& (!cf||s.class===cf) && isWorkingDayForStudent(t, s) ? a:null}).filter(a=>a&&a.status==="Present").length;
    lateAll = Attendance.filter(a=>a.date===t && a.studentId).map(a=>{const s=byId.get(a.studentId); return s&& (!cf||s.class===cf) && isWorkingDayForStudent(t, s) ? a:null}).filter(a=>a&&a.status==="Late").length;
    absentAll = Math.max(0, scheduledTotal - presentAll - lateAll);
    pct = scheduledTotal?Math.round((presentAll+lateAll)/scheduledTotal*100):0;
  }
  const present = sf ? rows.filter(r=>r.a.status==="Present").length : presentAll;
  const late = sf ? rows.filter(r=>r.a.status==="Late").length : lateAll;
  const absent = sf ? (sf==="Absent" ? rows.length : (sf==="Not Scheduled" ? 0 : absentAll)) : absentAll;
  const dup=rows.filter(r=>r.a.isDuplicate).length;
  const workingLabel = isGlobalWorking ? "Working day" : "Holiday";
  const schedInfo = cf ? `${cf} — ${scheduledTotal} scheduled, ${notScheduled} not scheduled` : `${scheduledTotal} scheduled, ${notScheduled} not scheduled`;
  todayDateLabel.textContent=`${fmtDate(t)} — ${workingLabel} — ${schedInfo}`;
  todayStats.innerHTML=`
    <div class="stat"><b>${t}</b><label>Date</label></div>
    <div class="stat"><b>${total}</b><label>Total students</label></div>
    <div class="stat"><b>${present}</b><label>Present</label></div>
    <div class="stat"><b>${late}</b><label>Late</label></div>
    <div class="stat"><b>${absent}</b><label>Absent</label></div>
    <div class="stat"><b>${notScheduled}</b><label>Not Scheduled</label></div>
    <div class="stat"><b>${Unknowns.length}</b><label>Unknown scans</label></div>
    <div class="stat"><b>${dup}</b><label>Duplicate scans</label></div>
    <div class="stat"><b>${pct}%</b><label>Attendance %</label></div>`;
  if(!rows.length){ todayTableBody.innerHTML=`<tr><td colspan="6"><div class="empty"><b>No attendance recorded today</b>Place a finger on the scanner — results appear here from the database.</div></td></tr>`; }
  else todayTableBody.innerHTML=rows.map(r=>`<tr data-student="${r.s.id}"><td>${esc(r.a.time)}</td><td>${esc(r.s.name)}</td><td>${esc(r.s.roll)}</td><td>${esc(r.s.class)}</td><td><span class="badge ${r.a.status.toLowerCase().replace(" ","-")}">${esc(r.a.status)}</span>${r.a.isDuplicate?' <span class="badge">Duplicate</span>':''} <button class="btn" data-correct data-correct-sid="${r.s.id}" data-correct-date="${esc(r.a.date||t)}" data-correct-status="${esc(r.a.status)}" style="height:20px;padding:0 6px;font-size:9px;margin-left:6px">Correct</button></td><td>${esc(r.a.fingerId!=null?"F-"+r.a.fingerId:"")}</td></tr>`).join("");
  todayUnknownBody.innerHTML=Unknowns.length?Unknowns.map(u=>`<tr><td>${esc(u.time)}</td><td>${esc(u.finger)}</td><td>${esc(u.note)}</td></tr>`).join(""):`<tr><td colspan="3"><div class="empty"><b>No unknown scans today</b></div></td></tr>`;
}
// ---- render: Reports (backend-aware: handles NOT_SCHEDULED, batch schedules, and per-student KPI) ----
async function renderReports(){
  const scope=reportScope.value, cls=reportClass.value, time=reportTime.value;
  let from,to; const today=todayISO();
  if(time==="today"){from=today;to=today;}
  else if(time==="week"){const d=new Date();d.setDate(d.getDate()-6);from=toISODate(d);to=today;}
  else if(time==="month"){const d=new Date();d.setDate(1);from=toISODate(d);to=today;}
  else if(time==="academic"){from=Settings.startDate||today;to=Settings.endDate||today;}
  else if(time==="custom"){
    from=reportFrom.value||""; to=reportTo.value||"";
    if(!from||!to||from>to){ reportStats.innerHTML=`<div class="inline-error">Invalid date range — Start must be before End.</div>`; reportBody.innerHTML=`<tr><td colspan="7"><div class="empty"><b>Invalid range</b>Choose a valid custom range.</div></td></tr>`; return; }
  }
  else {from=Settings.startDate||today;to=today;}
  // For single student scope, fetch authoritative KPI from backend
  if(scope==="student"){
    const sid=parseInt(reportStudent.value);
    if(sid){
      try{
        const rpt = await api("/api/reports?studentId="+sid, {method:"GET"});
        if(rpt && typeof rpt==="object" && "eligible" in rpt){
          reportStats.innerHTML=`<div class="stat"><b>${rpt.eligible}</b><label>Eligible days</label></div><div class="stat"><b>${rpt.attended}</b><label>Attended</label></div><div class="stat"><b>${rpt.present}</b><label>Present</label></div><div class="stat"><b>${rpt.late}</b><label>Late</label></div><div class="stat"><b>${rpt.absent}</b><label>Absent</label></div><div class="stat"><b>${rpt.rate}%</b><label>Rate</label></div><div class="stat"><b>${from} → ${to}</b><label>Range</label></div>`;
        }
      }catch(e){}
    }
  }
  let ev=[]; try{ ev=await api("/api/attendance",{method:"GET"}); }catch(e){ ev=Attendance; }
  let list=ev.filter(a=>a.date>=from&&a.date<=to).map(mapEvent);
  if(scope==="class"&&cls) list=list.filter(a=>{const s=Students.find(x=>x.id===a.studentId); return s&&s.class===cls;});
  if(scope==="student"){const sid=parseInt(reportStudent.value); if(sid) list=list.filter(a=>a.studentId===sid);}
  list.sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)).reverse();
  const present=list.filter(a=>a.status==="Present").length, late=list.filter(a=>a.status==="Late").length;
  const absent=list.filter(a=>a.status==="Absent").length, notScheduled=list.filter(a=>a.status==="Not Scheduled").length;
  const duplicate=list.filter(a=>a.isDuplicate).length;
  // For non-student scope, build stats with backend-aware counts (absent never includes Not Scheduled)
  if(scope!=="student"){
    const rate = (present+late+absent) ? Math.round((present+late)/(present+late+absent)*100) : 0;
    reportStats.innerHTML=`<div class="stat"><b>${list.length}</b><label>Records</label></div><div class="stat"><b>${present}</b><label>Present</label></div><div class="stat"><b>${late}</b><label>Late</label></div><div class="stat"><b>${absent}</b><label>Absent</label></div><div class="stat"><b>${notScheduled}</b><label>Not Scheduled</label></div><div class="stat"><b>${duplicate}</b><label>Duplicate</label></div><div class="stat"><b>${rate}%</b><label>Rate</label></div><div class="stat"><b>${from} → ${to}</b><label>Range</label></div>`;
  }
  if(!list.length){ reportBody.innerHTML=`<tr><td colspan="7"><div class="empty"><b>No records</b>Adjust scope or time range.</div></td></tr>`; return; }
  reportBody.innerHTML=list.map(a=>{
    const s=Students.find(x=>x.id===a.studentId);
    // working-day? column shows scheduled vs not scheduled for that student/date
    let working="—";
    if(s && a.date){
      working = isWorkingDayForStudent(a.date, s) ? "Scheduled" : "Not Scheduled";
      if(a.status==="Not Scheduled") working="Not Scheduled";
      else if(a.status==="Absent" && !isWorkingDayForStudent(a.date, s)) working="Not Scheduled";
    }
    return `<tr><td>${esc(a.date)}</td><td>${esc(a.time)}</td><td>${esc(s?s.name:"Unknown")}</td><td>${esc(s?s.roll:"")}</td><td>${esc(s?s.class:"")}</td><td><span class="badge ${a.status.toLowerCase().replace(" ","-")}">${esc(a.status)}</span></td><td>${esc(working)}${a.isDuplicate?" · Duplicate":""}</td></tr>`;
  }).join("");
}
// ---- render: Calendar (holidays/weekly/overrides persisted in backend settings) ----
function isHoliday(d){ return Holidays.find(h=>inRange(d,h.start,h.end))||null; }
function getOverride(d){ return Overrides.find(o=>o.date===d)||null; }
function isWorkingDayUI(d){
  const ov=getOverride(d);
  if(ov) return ov.isWorking;
  const hol=isHoliday(d);
  if(hol){
    const type=String(hol.type||"holiday").toLowerCase();
    return type==="exam";
  }
  const day=new Date(d+"T00:00:00").getDay();
  return asBool(Settings.workingDays[day] ?? Settings.workingDays[String(day)]);
}
function getWorkingDaysForClass(grade){
  if(grade && ClassSchedules[grade]){
    const v=ClassSchedules[grade];
    if(v && typeof v==="object" && v.workingDays) return v.workingDays;
    if(v && typeof v==="object" && !v.startTime) return v;
  }
  // fallback to legacy UI key for offline
  if(grade && ClassSchedulesUI && ClassSchedulesUI[grade]){
    const v=ClassSchedulesUI[grade];
    if(v && v.workingDays) return v.workingDays;
    if(v && typeof v==="object" && !v.startTime) return v;
  }
  return Settings.workingDays;
}
function getWorkingDaysForBatch(batch){
  if(batch && BatchSchedules[batch]){
    const v=BatchSchedules[batch];
    if(v && typeof v==="object" && v.workingDays) return v.workingDays;
    if(v && typeof v==="object" && !v.startTime) return v;
  }
  return Settings.workingDays;
}
function getWorkingDaysForStudent(student){
  if(!student) return Settings.workingDays;
  const grade=(student.class||student.grade||"").trim();
  const batch=(student.batch||student.group||"").trim();
  if(grade && batch){
    const key=grade+"|"+batch;
    if(BatchSchedules[key]){
      const v=BatchSchedules[key];
      if(v && typeof v==="object" && v.workingDays) return v.workingDays;
      if(v && typeof v==="object" && !v.startTime) return v;
    }
  }
  if(batch && BatchSchedules[batch]){
    const v=BatchSchedules[batch];
    if(v && typeof v==="object" && v.workingDays) return v.workingDays;
    if(v && typeof v==="object" && !v.startTime) return v;
  }
  if(grade && ClassSchedules[grade]){
    const v=ClassSchedules[grade];
    if(v && typeof v==="object" && v.workingDays) return v.workingDays;
    if(v && typeof v==="object" && !v.startTime) return v;
  }
  return Settings.workingDays;
}
function getScheduleTimingForStudent(student){
  const fallback = {
    startTime: Settings.presentCutoff || "08:00",
    endTime: Settings.lateCutoff || Settings.lateAfter || "08:30",
    isCustom: false,
    source: "global"
  };
  if(!student) return fallback;
  const grade=(student.class||student.grade||"").trim();
  const batch=(student.batch||student.group||"").trim();

  // Precedence: 1. Grade|Batch -> 2. Batch -> 3. Class -> 4. Global fallback
  if(grade && batch){
    const key=grade+"|"+batch;
    const v=BatchSchedules[key];
    if(v && typeof v==="object" && (v.startTime || v.endTime)){
      return {
        startTime: v.startTime || fallback.startTime,
        endTime: v.endTime || fallback.endTime,
        isCustom: true,
        source: key
      };
    }
  }
  if(batch && BatchSchedules[batch]){
    const v=BatchSchedules[batch];
    if(v && typeof v==="object" && (v.startTime || v.endTime)){
      return {
        startTime: v.startTime || fallback.startTime,
        endTime: v.endTime || fallback.endTime,
        isCustom: true,
        source: batch
      };
    }
  }
  if(grade && ClassSchedules[grade]){
    const v=ClassSchedules[grade];
    if(v && typeof v==="object" && (v.startTime || v.endTime)){
      return {
        startTime: v.startTime || fallback.startTime,
        endTime: v.endTime || fallback.endTime,
        isCustom: true,
        source: grade
      };
    }
  }
  return fallback;
}
function isWorkingDayForClass(d, grade){
  const ov=getOverride(d);
  if(ov) return ov.isWorking;
  const hol=isHoliday(d);
  if(hol){
    const type=String(hol.type||"holiday").toLowerCase();
    return type==="exam";
  }
  const day=new Date(d+"T00:00:00").getDay();
  const wd=getWorkingDaysForClass(grade);
  return asBool(wd[day] ?? wd[String(day)]);
}
function isWorkingDayForBatch(d, batch){
  const ov=getOverride(d);
  if(ov) return ov.isWorking;
  const hol=isHoliday(d);
  if(hol){
    const type=String(hol.type||"holiday").toLowerCase();
    return type==="exam";
  }
  const day=new Date(d+"T00:00:00").getDay();
  const wd=getWorkingDaysForBatch(batch);
  return asBool(wd[day] ?? wd[String(day)]);
}
function isWorkingDayForStudent(d, student){
  const ov=getOverride(d);
  if(ov) return ov.isWorking;
  const hol=isHoliday(d);
  if(hol){
    const type=String(hol.type||"holiday").toLowerCase();
    return type==="exam";
  }
  const day=new Date(d+"T00:00:00").getDay();
  const wd=getWorkingDaysForStudent(student);
  return asBool(wd[day] ?? wd[String(day)]);
}
function isScheduledToday(student){
  if(!student) return true;
  return isWorkingDayForStudent(todayISO(), student);
}
function holidaysToBackend(){ return Holidays.map(h=>{
  const span=h.start===h.end?h.start:(h.start+".."+h.end);
  return span+":"+(h.type||"holiday")+":"+(h.name||"Holiday");
}); }
function overridesToBackend(){ return Overrides.map(o=>o.date+(o.isWorking?":1":":0")+":"+o.note); }
function classSchedulesToBackend(){
  // normalize to backend expected format: {class: {workingDays, startTime, endTime}}
  const out={};
  Object.keys(ClassSchedules).forEach(k=>{
    const v=ClassSchedules[k];
    if(!v) return;
    if(typeof v==="object" && v.workingDays){
      out[k]={
        workingDays: v.workingDays,
        startTime: v.startTime || "",
        endTime: v.endTime || ""
      };
    } else {
      out[k]=v;
    }
  });
  return out;
}
function batchSchedulesToBackend(){
  const out={};
  Object.keys(BatchSchedules).forEach(k=>{
    const v=BatchSchedules[k];
    if(!v) return;
    if(typeof v==="object" && v.workingDays){
      out[k]={
        workingDays: v.workingDays,
        startTime: v.startTime || "",
        endTime: v.endTime || ""
      };
    } else {
      out[k]=v;
    }
  });
  return out;
}
async function persistCalendar(){
  try{
    await api("/api/settings",{method:"POST",body:JSON.stringify({
      holidays: holidaysToBackend(), overrides: overridesToBackend(), workingDays: Settings.workingDays,
      classSchedules: classSchedulesToBackend(), batchSchedules: batchSchedulesToBackend()
    })});
    cacheSave();
    return true;
  }catch(e){ alert("Failed to save calendar: "+e.message); }
  return false;
}
function renderHolidays(){
  const countEl = $("holidayCountBadge");
  if(countEl) countEl.textContent = String(Holidays.length);
  const listEl = $("holidayList") || $("holidayBody");
  if(!listEl) return;
  if(!Holidays.length){
    listEl.innerHTML = `<div class="schedule-empty-state"><span class="schedule-empty-icon">📅</span><span>No holidays or vacations configured. Click <b>+ Add holiday</b> to schedule.</span></div>`;
    return;
  }
  const sorted = Holidays.slice().sort((a,b)=>a.start.localeCompare(b.start));
  listEl.innerHTML = sorted.map(h=>{
    const isSingle = !h.end || h.start === h.end;
    let dateStr = fmtDate(h.start);
    if(!isSingle){
      try {
        const d1 = parseISO(h.start), d2 = parseISO(h.end);
        const diffDays = Math.round((d2 - d1)/(1000*60*60*24)) + 1;
        dateStr = `${fmtDate(h.start)} → ${fmtDate(h.end)} · ${diffDays} days`;
      } catch(e){
        dateStr = `${h.start} → ${h.end}`;
      }
    }
    const t = (h.type || "holiday").toLowerCase();
    let badgeCls = "holiday";
    let badgeText = "Holiday";
    if(t === "vacation"){ badgeCls = "vacation"; badgeText = "Vacation"; }
    else if(t === "exam"){ badgeCls = "exam"; badgeText = "Exam (Working)"; }

    return `<div class="schedule-item-card">
      <div class="schedule-item-info">
        <div class="schedule-item-top">
          <span class="schedule-item-badge ${badgeCls}">${esc(badgeText)}</span>
          <span class="schedule-item-name">${esc(h.name)}</span>
        </div>
        <div class="schedule-item-meta">
          <span class="schedule-item-date">${esc(dateStr)}</span>
        </div>
      </div>
      <div class="schedule-item-actions">
        <button class="btn" data-edit-holiday="${esc(h.start)}" title="Edit holiday">Edit</button>
        <button class="btn danger" data-del-holiday="${esc(h.start)}" title="Remove holiday">Remove</button>
      </div>
    </div>`;
  }).join("");
}

function renderOverrides(){
  const countEl = $("overrideCountBadge");
  if(countEl) countEl.textContent = String(Overrides.length);
  const listEl = $("overrideList") || $("overrideBody");
  if(!listEl) return;
  if(!Overrides.length){
    listEl.innerHTML = `<div class="schedule-empty-state"><span class="schedule-empty-icon">⚡</span><span>No date overrides configured. Click <b>+ Add override</b> for single-day exceptions.</span></div>`;
    return;
  }
  const sorted = Overrides.slice().sort((a,b)=>a.date.localeCompare(b.date));
  listEl.innerHTML = sorted.map(o=>{
    let dayName = "";
    try {
      dayName = parseISO(o.date).toLocaleDateString('en-GB', {weekday:'short'});
    } catch(e){}
    const isWk = !!o.isWorking;
    const badgeCls = isWk ? "working" : "off";
    const badgeText = isWk ? "Working Day" : "Holiday / Off";
    const dateFormatted = `${fmtDate(o.date)}${dayName ? ` (${dayName})` : ''}`;

    return `<div class="schedule-item-card">
      <div class="schedule-item-info">
        <div class="schedule-item-top">
          <span class="schedule-item-badge ${badgeCls}">${esc(badgeText)}</span>
          <span class="schedule-item-name">${esc(o.note || (isWk ? "Special Working Day" : "Institutional Holiday"))}</span>
        </div>
        <div class="schedule-item-meta">
          <span class="schedule-item-date">${esc(dateFormatted)}</span>
        </div>
      </div>
      <div class="schedule-item-actions">
        <button class="btn" data-edit-override="${esc(o.date)}" title="Edit override">Edit</button>
        <button class="btn danger" data-del-override="${esc(o.date)}" title="Remove override">Remove</button>
      </div>
    </div>`;
  }).join("");
}
function renderWeekly(){
  const sel=$("calClassSelect");
  const selectedTarget = sel ? sel.value : "";
  let wd = Settings.workingDays;
  let timing = {
    startTime: Settings.presentCutoff || "08:00",
    endTime: Settings.lateCutoff || Settings.lateAfter || "08:30",
    isCustom: false,
    source: "global"
  };

  if(selectedTarget){
    if(selectedTarget.startsWith("batch:")){
      const batchName = selectedTarget.slice(6);
      const entry = BatchSchedules[batchName];
      if(entry && typeof entry==="object" && entry.workingDays) wd = entry.workingDays;
      else if(entry && typeof entry==="object" && !entry.startTime) wd = entry;
      if(entry && typeof entry==="object" && (entry.startTime || entry.endTime)){
        timing = {
          startTime: entry.startTime || "",
          endTime: entry.endTime || "",
          isCustom: true,
          source: batchName
        };
      }
    } else {
      const className = selectedTarget.startsWith("class:") ? selectedTarget.slice(6) : selectedTarget;
      wd = getWorkingDaysForClass(className);
      const entry = ClassSchedules[className];
      if(entry && typeof entry==="object" && (entry.startTime || entry.endTime)){
        timing = {
          startTime: entry.startTime || "",
          endTime: entry.endTime || "",
          isCustom: true,
          source: className
        };
      }
    }
  }

  const days=[
    {name:"Sunday", short:"Sun"},
    {name:"Monday", short:"Mon"},
    {name:"Tuesday", short:"Tue"},
    {name:"Wednesday", short:"Wed"},
    {name:"Thursday", short:"Thu"},
    {name:"Friday", short:"Fri"},
    {name:"Saturday", short:"Sat"}
  ];
  const grid=$("weeklyScheduleGrid");
  if(grid){
    grid.innerHTML=days.map((d,idx)=>{
      const on=asBool(wd[idx] ?? wd[String(idx)]);
      return `<div class="day-card ${on?'is-working':'is-off'}" data-day="${idx}" role="button" tabindex="0" title="Click to toggle ${d.name} (${on?'Working — click for Off':'Off — click for Working'})">
        <span class="day-short">${d.short}</span>
        <span class="day-sub">${on?'Working':'Off'}</span>
      </div>`;
    }).join("");
  }
  const tbody=document.querySelector("#weeklyTable tbody");
  if(tbody){
    tbody.innerHTML=days.map((d,idx)=>{
      const on=asBool(wd[idx] ?? wd[String(idx)]);
      return `<tr><td>${d.name}</td><td><div class="toggle ${on?"on":""}" data-day="${idx}"></div></td></tr>`;
    }).join("");
  }

  // Update Schedule Timing Bar Controls
  const startInput = $("schedStartTime");
  const endInput = $("schedEndTime");
  const saveTimeBtn = $("schedSaveTimeBtn");
  const clearTimeBtn = $("schedClearTimeBtn");
  const timingBadge = $("schedTimingBadge");

  if(startInput && endInput){
    if(!selectedTarget){
      startInput.value = Settings.presentCutoff || "08:00";
      endInput.value = Settings.lateCutoff || Settings.lateAfter || "08:30";
      startInput.disabled = true;
      endInput.disabled = true;
      if(saveTimeBtn) saveTimeBtn.style.display = "none";
      if(clearTimeBtn) clearTimeBtn.style.display = "none";
      if(timingBadge){
        timingBadge.className = "badge";
        timingBadge.style.cssText = "font-size:9px;background:#F6F4EF;color:var(--ink-2);border-color:#E2DFD7";
        timingBadge.textContent = "Global Fallback (Configured in Attendance Rules)";
      }
    } else {
      startInput.disabled = false;
      endInput.disabled = false;
      if(saveTimeBtn) saveTimeBtn.style.display = "";
      if(clearTimeBtn) clearTimeBtn.style.display = "";

      if(timing.isCustom){
        startInput.value = timing.startTime || "";
        endInput.value = timing.endTime || "";
        if(timingBadge){
          timingBadge.className = "badge";
          timingBadge.style.cssText = "font-size:9px;background:#0A0A0A;color:#FFFFFF;border-color:#0A0A0A;font-weight:600";
          timingBadge.textContent = `Custom Timing: ${timing.startTime || "--"} – ${timing.endTime || "--"}`;
        }
      } else {
        startInput.value = "";
        endInput.value = "";
        startInput.placeholder = Settings.presentCutoff || "08:00";
        endInput.placeholder = Settings.lateCutoff || Settings.lateAfter || "08:30";
        if(timingBadge){
          timingBadge.className = "badge";
          timingBadge.style.cssText = "font-size:9px;background:#F6F4EF;color:var(--ink-2);border-color:#E2DFD7";
          timingBadge.textContent = `Using Global Fallback (${Settings.presentCutoff || "08:00"} – ${Settings.lateCutoff || Settings.lateAfter || "08:30"})`;
        }
      }
    }
  }

  syncCalClassCustomSelect();
}
// ---- Universal Custom Select Dropdown Engine (Eliminating OS Blue-bar Popups & Clipping) ----
let _activeOpenSelect = null;

function closeAllCustomSelects(){
  if(_activeOpenSelect){
    const { wrap, trigger, menu } = _activeOpenSelect;
    if(wrap) wrap.classList.remove("is-open");
    if(trigger) trigger.setAttribute("aria-expanded", "false");
    if(menu){
      menu.classList.remove("is-portal-open");
      menu.style.display = "none";
      if(menu.parentNode !== wrap && wrap){
        wrap.appendChild(menu);
      }
    }
    _activeOpenSelect = null;
  }
  document.querySelectorAll(".custom-select-wrap.is-open").forEach(w => {
    w.classList.remove("is-open");
    const t = w.querySelector(".custom-select-trigger");
    if(t) t.setAttribute("aria-expanded", "false");
    const m = w.querySelector(".custom-select-menu");
    if(m) {
      m.classList.remove("is-portal-open");
      m.style.display = "none";
    }
  });
}

function openCustomSelect(wrap, trigger, menu, sel){
  if(_activeOpenSelect && _activeOpenSelect.wrap === wrap){
    closeAllCustomSelects();
    return;
  }
  closeAllCustomSelects();

  wrap.classList.add("is-open");
  trigger.setAttribute("aria-expanded", "true");

  // Move menu to document.body so no parent overflow:hidden / contain rule can clip it
  document.body.appendChild(menu);
  menu.classList.add("is-portal-open");
  menu.style.display = "block";

  const rect = trigger.getBoundingClientRect();
  const menuWidth = Math.max(rect.width, 140);
  menu.style.minWidth = menuWidth + "px";
  menu.style.maxWidth = "340px";

  // Calculate vertical position
  const menuHeight = menu.offsetHeight || 180;
  const spaceBelow = window.innerHeight - rect.bottom;
  if(spaceBelow < menuHeight + 10 && rect.top > menuHeight + 10){
    // Open above
    menu.style.top = Math.max(8, rect.top - menuHeight - 4) + "px";
  } else {
    // Open below
    menu.style.top = (rect.bottom + 4) + "px";
  }

  // Calculate horizontal position
  let left = rect.left;
  if(left + menu.offsetWidth > window.innerWidth - 10){
    left = window.innerWidth - menu.offsetWidth - 10;
  }
  menu.style.left = Math.max(8, left) + "px";

  _activeOpenSelect = { wrap, trigger, menu, sel };
}

function enhanceSelect(sel){
  if(!sel || sel.tagName!=="SELECT") return;
  sel.classList.add("visually-hidden-select");
  sel.setAttribute("tabindex", "-1");

  let wrap = sel._customWrap || sel.closest(".custom-select-wrap");
  if(!wrap){
    wrap = document.createElement("div");
    wrap.className = "custom-select-wrap";
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
  }
  sel._customWrap = wrap;

  let trigger = wrap.querySelector(".custom-select-trigger");
  if(!trigger){
    trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "custom-select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.innerHTML = `<span class="custom-select-label"></span>`;
    wrap.appendChild(trigger);
  }

  let menu = sel._customMenu || wrap.querySelector(".custom-select-menu");
  if(!menu){
    menu = document.createElement("div");
    menu.className = "custom-select-menu";
    menu.setAttribute("role", "listbox");
    wrap.appendChild(menu);
  }
  sel._customMenu = menu;

  if(!sel._customInitialized){
    sel._customInitialized = true;

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      openCustomSelect(wrap, trigger, menu, sel);
    });

    menu.addEventListener("click", (e) => {
      const item = e.target.closest(".custom-select-item");
      if(!item) return;
      e.stopPropagation();
      const val = item.dataset.val ?? "";
      const prevVal = sel.value;
      sel.value = val;
      syncCustomSelect(sel);
      closeAllCustomSelects();
      if(prevVal !== val || true){
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        if(typeof sel.onchange === "function") sel.onchange(new Event("change"));
      }
    });

    const syncVisibility = () => {
      if(sel.style.display === "none"){
        wrap.style.display = "none";
      } else {
        wrap.style.display = "";
      }
    };
    syncVisibility();

    try {
      const obs = new MutationObserver(() => {
        syncVisibility();
        syncCustomSelect(sel);
      });
      obs.observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "disabled"] });
      sel._customObserver = obs;
    } catch(e){}
  }

  syncCustomSelect(sel);
}

function syncCustomSelect(sel){
  if(!sel || sel.tagName!=="SELECT") return;
  const wrap = sel._customWrap || sel.closest(".custom-select-wrap");
  if(!wrap) return;
  const label = wrap.querySelector(".custom-select-label") || wrap.querySelector("#calClassSelectLabel");
  const menu = sel._customMenu || wrap.querySelector(".custom-select-menu") || (_activeOpenSelect && _activeOpenSelect.sel === sel ? _activeOpenSelect.menu : null);
  if(!menu) return;

  const curVal = sel.value;
  const opts = Array.from(sel.options);
  let selectedOpt = opts.find(o => o.value === curVal || (!o.value && o.text === curVal));
  if(!selectedOpt && opts.length > 0){
    selectedOpt = opts[sel.selectedIndex >= 0 ? sel.selectedIndex : 0];
  }

  if(label){
    label.textContent = selectedOpt ? selectedOpt.text : (opts[0] ? opts[0].text : "Select");
  }

  menu.innerHTML = opts.map(o => {
    const val = o.value !== undefined ? o.value : o.text;
    const isSel = (o === selectedOpt) || (val === curVal);
    return `<div class="custom-select-item ${isSel ? 'is-selected' : ''}" data-val="${esc(val)}" role="option" aria-selected="${isSel}">
      <span>${esc(o.text)}</span>
      ${isSel ? '<span class="custom-select-check">✓</span>' : ''}
    </div>`;
  }).join("");
}

function enhanceAllSelects(root = document){
  if(!root) return;
  const selects = root.querySelectorAll ? root.querySelectorAll("select") : [];
  selects.forEach(s => {
    enhanceSelect(s);
  });
}

function syncCalClassCustomSelect(){
  syncCustomSelect($("calClassSelect"));
}
function renderCalendarMonth(){
  if(!calendarGrid) return;
  const y=calendarMonth.getFullYear(), m=calendarMonth.getMonth();
  calMonthLabel.textContent=calendarMonth.toLocaleDateString('en-GB',{month:'long',year:'numeric'});
  const sel=$("calClassSelect");
  const selectedTarget = sel ? sel.value : "";
  const first=new Date(y,m,1).getDay(), last=new Date(y,m+1,0).getDate();
  let html=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div class="calendar-cell head">${d}</div>`).join("");
  for(let i=0;i<first;i++) html+=`<div class="calendar-cell empty"></div>`;
  for(let d=1;d<=last;d++){
    const iso=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const hol=isHoliday(iso), ov=getOverride(iso), todayCls=iso===todayISO()?" today":"";
    let working;
    if(!selectedTarget){
      working = isWorkingDayUI(iso);
    } else if(selectedTarget.startsWith("batch:")){
      working = isWorkingDayForBatch(iso, selectedTarget.slice(6));
    } else {
      const cName = selectedTarget.startsWith("class:") ? selectedTarget.slice(6) : selectedTarget;
      working = isWorkingDayForClass(iso, cName);
    }
    const stateCls = working ? "working" : "non-working";
    let extraCls = "";
    if(ov) extraCls = " override";
    else if(hol) extraCls = hol.type === "vacation" ? " vacation" : " holiday";

    let tag = "";
    if(ov) tag = esc(ov.note || (working ? "Working Override" : "Holiday Override"));
    else if(hol) tag = esc(hol.name);
    else tag = working ? "Working" : "Non-working";

    html+=`<div class="calendar-cell ${stateCls}${extraCls}${todayCls}"><span class="day">${d}</span><span class="tag" title="${tag}">${tag}</span></div>`;
  }
  calendarGrid.innerHTML=html;
}
function renderClasses(){
  if(!Classes.length){ classBody.innerHTML=`<tr><td colspan="3" style="padding:14px 10px"><div class="empty" style="padding:10px 4px"><b style="font-size:13px;margin-bottom:2px">No classes configured</b><span style="font-size:10px">Add a class below.</span></div></td></tr>`; return; }
  classBody.innerHTML=Classes.map(c=>{
    const n=Students.filter(s=>s.active && s.class===c).length;
    return `<tr><td style="padding:6px 10px;font-size:11.5px;font-weight:500">${esc(c)}</td><td style="padding:6px 10px;font-size:11.5px;font-family:var(--mono)">${n}</td><td style="text-align:right;padding:6px 10px"><button class="btn danger" data-del-class="${esc(c)}" data-students="${n}" style="height:22px;padding:0 8px;font-size:9px">Delete</button></td></tr>`;
  }).join("");
}
function renderAudit(){
  if(!Audit.length){ auditBody.innerHTML=`<tr><td colspan="4"><div class="empty"><b>No audit history</b>Changes appear here.</div></td></tr>`; return; }
  auditBody.innerHTML=Audit.map(a=>`<tr><td>${esc(a.time)}</td><td>${esc(a.action)}</td><td>${esc(a.details)}</td><td>${esc(a.by)}</td></tr>`).join("");
}
function renderAll(){
  renderClassFilters();
  renderStudentList();
  renderWeekly();
  renderHolidays();
  renderOverrides();
  renderCalendarMonth();
  renderClasses();
  renderAudit();
  if(currentTab==="today") renderToday();
  if(currentTab==="reports") renderReports();
  enhanceAllSelects();
}
// ---- ENROLL: information + real fingerprint scan ----
async function pollEnrollProgress(stepEl, labelEl){
  if(_enrollAbort) return;
  try{
    const p=await api("/api/sensor/progress",{method:"GET"});
    if(p&&labelEl){
      const st=p.state, step=p.step||0;
      if(stepEl) stepEl.textContent=step+"/3";
      if(st==="place") labelEl.textContent="Place your finger — press it flat on the glass";
      else if(st==="hold") labelEl.textContent="Hold still — capturing";
      else if(st==="capturing") labelEl.textContent="Scanning — keep still";
      else if(st==="enroll_1") labelEl.textContent="First capture done — lift your finger";
      else if(st==="enroll_2") labelEl.textContent="Second capture — place the same finger";
      else if(st==="enroll_3") labelEl.textContent="Third capture — place the same finger";
    }
  }catch(e){}
  if(!_enrollAbort) _enrollPoll=setTimeout(()=>pollEnrollProgress(stepEl,labelEl),700);
}
function fingerprintScanUI(title, subtitle, onStart, onSuccess){
  setState("ready");
  enrollTitle.textContent=title;
  enrollSub.textContent=subtitle;
  enrollBody.innerHTML=`
    <div class="enroll-scan-box">
      <div class="enroll-scan-count" id="scanCount">0 / 3</div>
      <div class="enroll-scan-label" id="scanLabel">Place your finger on the sensor</div>
      <div class="finger-visual"><div class="finger-line"></div></div>
      <div class="lift-hint">Keep the same finger flat. The sensor light stays on.</div>
      <div style="margin-top:12px;display:flex;gap:8px;justify-content:center"><button class="btn primary" id="scanStartBtn">Start scan</button><button class="btn" id="scanCancelBtn">Cancel</button></div>
      <div class="inline-error" id="scanErr" style="display:none"></div>
    </div>`;
  openModal(enrollModal);
  $("scanCancelBtn").onclick=()=>{ finishEnrollUi(); resumeSensorScan(); };
  $("scanStartBtn").onclick=async()=>{
    $("scanStartBtn").disabled=true;
    _enrollAbort=false;
    const stepEl=$("scanCount"), labelEl=$("scanLabel");
    pollEnrollProgress(stepEl,labelEl);
    try{
      const res=await onStart();
      try{ onSuccess(res); }catch(e){}
      returnToFrontPage();
    }catch(err){
      _enrollAbort=true;
      if(_enrollPoll) clearTimeout(_enrollPoll);
      const e=$("scanErr"); e.style.display="block";
      e.textContent=err.message||"Scan failed. Check the sensor and try again.";
      $("scanStartBtn").disabled=false;
    }
  };
}

function renderPhotoUploaderHTML(containerId, inputId, initialPhotoUrl, titleText, descText){
  const hasPhoto = !!initialPhotoUrl;
  return `
    <div class="form-field full">
      <label>Student photograph</label>
      <input type="file" id="${inputId}" accept="image/*" style="display:none">
      <div class="photo-uploader" id="${containerId}" tabindex="0" role="button" aria-label="Upload student photo">
        <div class="photo-uploader-thumb" id="${containerId}Thumb">
          ${hasPhoto ? `<img src="${esc(initialPhotoUrl)}" alt="Photo preview">` : `
            <div class="photo-uploader-fallback">
              <svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
            </div>
          `}
        </div>
        <div class="photo-uploader-body">
          <div class="photo-uploader-title" id="${containerId}Title">
            ${hasPhoto ? 'Photograph attached' : (titleText || 'Upload student photo')}
          </div>
          <div class="photo-uploader-desc" id="${containerId}Desc">
            ${hasPhoto ? 'Click or drop to replace • JPG, PNG max 2MB' : (descText || 'Drag & drop image here, or click to browse (max 2MB)')}
          </div>
          <div class="photo-uploader-actions">
            <button type="button" class="photo-btn-subtle" id="${containerId}BrowseBtn">${hasPhoto ? 'Change photo' : 'Browse photo'}</button>
            <button type="button" class="photo-btn-subtle danger" id="${containerId}RemoveBtn" style="${hasPhoto ? '' : 'display:none'}">Remove</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function wirePhotoUploader(containerId, inputId, onFileLoaded, onFileRemoved){
  const dropzone = $(containerId);
  const input = $(inputId);
  const thumb = $(containerId + "Thumb");
  const title = $(containerId + "Title");
  const desc = $(containerId + "Desc");
  const browseBtn = $(containerId + "BrowseBtn");
  const removeBtn = $(containerId + "RemoveBtn");
  if(!dropzone || !input) return;

  function updatePreview(dataUrl, fileName){
    if(dataUrl){
      if(thumb) thumb.innerHTML = `<img src="${dataUrl}" alt="Preview">`;
      if(title) title.textContent = fileName || "Photo attached";
      if(desc) desc.textContent = "Click or drop to replace • JPG, PNG max 2MB";
      if(browseBtn) browseBtn.textContent = "Change photo";
      if(removeBtn) removeBtn.style.display = "";
    } else {
      if(thumb) thumb.innerHTML = `
        <div class="photo-uploader-fallback">
          <svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
        </div>`;
      if(title) title.textContent = "Upload student photo";
      if(desc) desc.textContent = "Drag & drop image here, or click to browse (max 2MB)";
      if(browseBtn) browseBtn.textContent = "Browse photo";
      if(removeBtn) removeBtn.style.display = "none";
    }
  }

  function handleFile(file){
    if(!file) return;
    if(file.size > 2 * 1024 * 1024){
      alert("Photo file is too large. Maximum file size is 2MB.");
      return;
    }
    const r = new FileReader();
    r.onload = (e)=>{
      updatePreview(e.target.result, file.name);
      if(onFileLoaded) onFileLoaded(e.target.result, file);
    };
    r.readAsDataURL(file);
  }

  dropzone.onclick = (e)=>{
    if(e.target === removeBtn) return;
    input.click();
  };

  input.onchange = (e)=>{
    const file = e.target.files && e.target.files[0];
    if(file) handleFile(file);
  };

  if(removeBtn){
    removeBtn.onclick = (e)=>{
      e.stopPropagation();
      input.value = "";
      updatePreview(null);
      if(onFileRemoved) onFileRemoved();
    };
  }

  ["dragenter", "dragover"].forEach(ev=>{
    dropzone.addEventListener(ev, (e)=>{ e.preventDefault(); e.stopPropagation(); dropzone.classList.add("dragover"); });
  });
  ["dragleave", "drop"].forEach(ev=>{
    dropzone.addEventListener(ev, (e)=>{ e.preventDefault(); e.stopPropagation(); dropzone.classList.remove("dragover"); });
  });
  dropzone.addEventListener("drop", (e)=>{
    if(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length){
      handleFile(e.dataTransfer.files[0]);
    }
  });
}

function openNewStudent(){
  pauseSensorScan();
  enrollTitle.textContent="New student enrollment";
  enrollSub.textContent="Enter the student details and attach photo. Click continue to scan fingerprint 3 times.";
  
  let newStudentPhoto = "";

  enrollBody.innerHTML=`
    <div class="form-grid">
      <div class="form-field"><label>Full name *</label><input id="nsName" placeholder="e.g. Aarav Sharma"></div>
      <div class="form-field"><label>Roll number *</label><input id="nsRoll" placeholder="e.g. 10A-08"></div>
      <div class="form-field"><label>Class *</label><select id="nsGrade">${Classes.map(c=>`<option>${esc(c)}</option>`).join("")||'<option>Grade 10-A</option>'}</select></div>
      <div class="form-field"><label>Batch / Group</label><input id="nsBatch" placeholder="e.g. Morning"></div>
      <div class="form-field"><label>Section</label><input id="nsSection" placeholder="e.g. A"></div>
      <div class="form-field"><label>Parent / Guardian</label><input id="nsParent" placeholder="e.g. Suresh Sharma"></div>
      <div class="form-field full"><label>Parent phone</label><input id="nsPhone" placeholder="e.g. 9876543210"></div>
      <div class="form-field full"><label>Address</label><input id="nsAddress" placeholder="e.g. Shikrapur, Pune"></div>
      ${renderPhotoUploaderHTML('nsPhotoDropzone', 'nsPhoto', '', 'Upload photo (optional)', 'Drag & drop image here, or click to browse (max 2MB)')}
      <div class="inline-error" id="nsErr" style="display:none"></div>
      <div class="form-field full form-actions">
        <button class="btn" id="nsCancel">Cancel</button>
        <button class="btn primary" id="nsSave">Continue to fingerprint scan</button>
      </div>
    </div>`;

  openModal(enrollModal);
  enhanceAllSelects(enrollModal);
  $("nsCancel").onclick=()=>{ if(_enrollPoll) clearTimeout(_enrollPoll); closeModal(enrollModal); resumeSensorScan(); };

  wirePhotoUploader('nsPhotoDropzone', 'nsPhoto',
    (dataUrl)=>{ newStudentPhoto = dataUrl; },
    ()=>{ newStudentPhoto = ""; }
  );

  $("nsSave").onclick=()=>{
    const name=$("nsName").value.trim(), roll=$("nsRoll").value.trim(),
          grade=$("nsGrade").value.trim(), batch=$("nsBatch").value.trim(),
          section=$("nsSection").value.trim(), parent=$("nsParent").value.trim(),
          phone=$("nsPhone").value.trim(), address=$("nsAddress").value.trim();
    const err=$("nsErr");
    if(!name||!roll||!grade){ err.textContent="Name, roll and class are required."; err.style.display="block"; return; }
    err.style.display="none";

    const form={name,roll,grade,batch,section,parent,phone,address,photo:newStudentPhoto||""};
    closeModal(enrollModal);
    fingerprintScanUI("Enroll fingerprint — "+name, "Click Start scan once. Then place and lift the same finger three times; do not click between captures.",
      ()=>apiEnrollStudent(form),
      (res)=>{
        if(res && res.id){
          upsertStudent({
            id:res.id, name:name, roll:roll, grade:grade, batch:batch, section:section,
            parent:parent, phone:phone, address:address, photo:form.photo||"",
            fingerId:res.fingerId, active:1
          });
          cacheSave();
        }
        loadAll();
      });
  };
}

function openEditStudent(id){
  const s=Students.find(x=>x.id===id); if(!s) return;
  enrollTitle.textContent="Edit student information";
  enrollSub.textContent="Update profile information and photograph. Changes save directly to SQLite.";
  
  let currentPhotoData = s.photo || "";
  let photoCleared = false;
  let newPhotoData = null;

  enrollBody.innerHTML=`
    <div class="form-grid">
      <div class="form-field"><label>Full name *</label><input id="edName" value="${esc(s.name)}"></div>
      <div class="form-field"><label>Roll number *</label><input id="edRoll" value="${esc(s.roll)}"></div>
      <div class="form-field"><label>Class *</label><select id="edGrade">${Classes.map(c=>`<option ${c===s.class?"selected":""}>${esc(c)}</option>`).join("")}</select></div>
      <div class="form-field"><label>Batch / Group</label><input id="edBatch" value="${esc(s.batch||'')}"></div>
      <div class="form-field"><label>Section</label><input id="edSection" value="${esc(s.section||'')}"></div>
      <div class="form-field"><label>Status</label><select id="edActive"><option value="1" ${s.active?"selected":""}>Active</option><option value="0" ${!s.active?"selected":""}>Inactive</option></select></div>
      <div class="form-field"><label>Parent / Guardian</label><input id="edParent" value="${esc(s.parent||'')}"></div>
      <div class="form-field"><label>Phone</label><input id="edPhone" value="${esc(s.phone||'')}"></div>
      <div class="form-field full"><label>Address</label><input id="edAddress" value="${esc(s.address||'')}"></div>
      ${renderPhotoUploaderHTML('edPhotoDropzone', 'edPhoto', s.photo, 'Student photograph', 'Drag & drop image or click to replace (max 2MB)')}
      <div class="inline-error" id="edErr" style="display:none"></div>
      <div class="form-field full form-actions">
        <button class="btn" id="edCancel">Cancel</button>
        <button class="btn primary" id="edSave">Save changes</button>
      </div>
    </div>`;

  openModal(enrollModal);
  enhanceAllSelects(enrollModal);
  $("edCancel").onclick=()=>closeModal(enrollModal);

  wirePhotoUploader('edPhotoDropzone', 'edPhoto', 
    (dataUrl, file)=>{ newPhotoData = dataUrl; photoCleared = false; },
    ()=>{ newPhotoData = ""; photoCleared = true; }
  );

  $("edSave").onclick=async()=>{
    const err=$("edErr");
    const name=$("edName").value.trim(), roll=$("edRoll").value.trim(), grade=$("edGrade").value.trim(),
          batch=$("edBatch").value.trim(), section=$("edSection").value.trim(), parentEl=$("edParent").value.trim(),
          phone=$("edPhone").value.trim(), address=$("edAddress").value.trim(), active=$("edActive").value==="1";

    if(!name || !roll || !grade){
      err.textContent = "Full name, roll number, and class are required.";
      err.style.display = "block";
      return;
    }

    const btn = $("edSave");
    btn.disabled = true;
    btn.textContent = "Saving…";

    try{
      const payload={name,roll,grade,batch,section,parent:parentEl,phone,address,active};
      if(photoCleared) payload.photo = "";
      else if(newPhotoData !== null) payload.photo = newPhotoData;
      
      await api("/api/students/"+id,{method:"PATCH",body:JSON.stringify(payload)});
      closeModal(enrollModal);
      await loadAll();
      selectStudent(id);
    }catch(e){
      err.style.display="block";
      err.textContent=e.message || "Failed to save student changes.";
      btn.disabled = false;
      btn.textContent = "Save changes";
    }
  };
}
function openReEnroll(id){
  const s=Students.find(x=>x.id===id); if(!s) return;
  pauseSensorScan();
  fingerprintScanUI("Re-enroll fingerprint — "+s.name, "Click Start scan once. Then place and lift the same finger three times; do not click between captures.",
    ()=>api("/api/students/"+id+"/reenroll",{method:"POST",body:"{}"}),
    (res)=>{
      const fid = res && res.fingerId!=null ? res.fingerId : null;
      upsertStudent({
        id:s.id, name:s.name, roll:s.roll, grade:s.class||s.grade, batch:s.batch, section:s.section,
        parent:s.parent, phone:s.phone, address:s.address, photo:s.photo||"",
        fingerId:fid, active:1
      });
      cacheSave();
      loadAll();
    });
}
function showDeleteClassDialog(className, onConfirm){
  if(!confirmModal) return;
  confirmModalTitle.textContent = "Delete Class";
  confirmModalSub.textContent = `Are you sure you want to delete ${className}?`;
  confirmModalBody.innerHTML = `
    <div style="font-size:12px;line-height:1.6;color:var(--ink-2);margin-bottom:14px;background:var(--paper);border:1px solid var(--line);padding:12px">
      <div><b>Class:</b> ${esc(className)}</div>
      <div><b>Active Students:</b> 0</div>
    </div>
    <div style="font-size:11px;color:var(--ink-2);line-height:1.5;margin-bottom:16px">
      Deleting this class will remove it from the school class list, dropdowns, and schedule settings.
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" id="confirmClassCancel">Cancel</button>
      <button class="btn danger" id="confirmClassSubmit">Delete class</button>
    </div>
  `;
  openModal(confirmModal);
  $("confirmClassCancel").onclick = () => closeModal(confirmModal);
  $("confirmClassSubmit").onclick = async () => {
    $("confirmClassSubmit").disabled = true;
    $("confirmClassSubmit").textContent = "Deleting…";
    try {
      await onConfirm();
      closeModal(confirmModal);
    } catch(err) {
      alert("Delete failed: " + (err.message || err));
      closeModal(confirmModal);
    }
  };
}

function showClassHasStudentsDialog(className, count){
  if(!confirmModal) {
    alert("Cannot delete class with active enrollments. Please reassign or delete the students in this class first.");
    return;
  }
  confirmModalTitle.textContent = "Cannot Delete Class";
  confirmModalSub.textContent = `${className} has active enrollments`;
  confirmModalBody.innerHTML = `
    <div style="font-size:12px;line-height:1.6;color:var(--ink-2);margin-bottom:14px;background:var(--paper);border:1px solid var(--line);padding:12px">
      <div><b>Class:</b> ${esc(className)}</div>
      <div><b>Active Students:</b> ${count}</div>
    </div>
    <div class="inline-error" style="margin:0 0 16px 0;background:#FFF9F8;border-color:var(--danger);color:var(--danger);font-size:11px;line-height:1.5">
      Cannot delete class with active enrollments. Please reassign or delete the students in this class first.
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn primary" id="confirmClassClose">Understood</button>
    </div>
  `;
  openModal(confirmModal);
  $("confirmClassClose").onclick = () => closeModal(confirmModal);
}

async function deleteClass(className){
  if(!className) return;
  const count = Students.filter(s=>s.active && s.class===className).length;
  if(count > 0){
    showClassHasStudentsDialog(className, count);
    return;
  }
  showDeleteClassDialog(className, async () => {
    await api("/api/classes/" + encodeURIComponent(className), { method: "DELETE" });
    await loadClassesHolidaysSettings();
    renderAll();
  });
}

function showDeleteConfirmDialog(s, isPermanent, onConfirm){
  if(!confirmModal) return;
  confirmModalTitle.textContent = isPermanent ? "Permanent Delete Student" : "Delete Enrolled Student";
  confirmModalSub.textContent = `Confirm deletion for ${s.name}`;
  confirmModalBody.innerHTML = `
    <div style="font-size:12px;line-height:1.6;color:var(--ink-2);margin-bottom:14px;background:var(--paper);border:1px solid var(--line);padding:12px">
      <div><b>Student:</b> ${esc(s.name)}</div>
      <div><b>Roll:</b> ${esc(s.roll)} · <b>Class:</b> ${esc(s.class)}${s.batch ? ` · <b>Batch:</b> ${esc(s.batch)}` : ""}</div>
      <div><b>Fingerprint Slot:</b> ${esc(s.fid || "None")}</div>
    </div>
    <div class="inline-error" style="margin:0 0 16px 0;background:#FFF9F8;border-color:var(--danger);color:var(--danger);font-size:11px;line-height:1.5">
      ${isPermanent
        ? "Warning: This permanently removes all student records from the database. This action cannot be undone."
        : `Deleting will remove <b>${esc(s.name)}</b> from enrolled students, free fingerprint slot <b>${esc(s.fid || "None")}</b>, and release roll number <b>${esc(s.roll)}</b>.`
      }
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" id="confirmDeleteCancel">Cancel</button>
      <button class="btn danger" id="confirmDeleteSubmit">${isPermanent ? "Delete permanently" : "Delete student"}</button>
    </div>
  `;
  openModal(confirmModal);
  $("confirmDeleteCancel").onclick = () => closeModal(confirmModal);
  $("confirmDeleteSubmit").onclick = async () => {
    $("confirmDeleteSubmit").disabled = true;
    $("confirmDeleteSubmit").textContent = "Deleting…";
    try {
      await onConfirm();
    } catch(err) {
      alert("Delete failed: " + (err.message || err));
      closeModal(confirmModal);
    }
  };
}

function showPostDeleteQuestion(deletedName, deletedRoll){
  if(!confirmModal) return;
  confirmModalTitle.textContent = "Enrollment Deleted";
  confirmModalSub.textContent = `${deletedName} (${deletedRoll}) has been deleted.`;
  confirmModalBody.innerHTML = `
    <div style="background:var(--paper);border:1px solid var(--line);padding:14px;margin-bottom:16px;font-size:12px;line-height:1.5">
      <div style="font-weight:600;margin-bottom:6px;font-size:13px">What would you like to do next?</div>
      <div style="color:var(--ink-2);margin-bottom:4px">Would you like to enroll a new student in the freed slot now, or return to the student directory?</div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" id="postDeleteDone">Close (View students)</button>
      <button class="btn primary" id="postDeleteNewEnroll">Enroll new student</button>
    </div>
  `;
  openModal(confirmModal);
  $("postDeleteDone").onclick = () => closeModal(confirmModal);
  $("postDeleteNewEnroll").onclick = () => {
    closeModal(confirmModal);
    openNewStudent();
  };
}

async function deleteStudent(id){
  const s=Students.find(x=>x.id===id); if(!s) return;
  showDeleteConfirmDialog(s, false, async () => {
    await api("/api/students/"+id, {method:"DELETE"});
    await loadAll();
    renderStudentDetail(-1);
    showPostDeleteQuestion(s.name, s.roll);
  });
}

async function deletePermanentStudent(id){
  const s=Students.find(x=>x.id===id); if(!s) return;
  showDeleteConfirmDialog(s, true, async () => {
    await api("/api/students/"+id+"?permanent=true", {method:"DELETE"});
    await loadAll();
    renderStudentDetail(-1);
    showPostDeleteQuestion(s.name, s.roll);
  });
}
async function toggleStudentStatus(id){
  const s=Students.find(x=>x.id===id); if(!s) return;
  const newActive = s.active ? 0 : 1;
  try{
    await api("/api/students/"+id, {
      method:"PATCH",
      body:JSON.stringify({active: newActive})
    });
    await loadAll();
    selectStudent(id);
  }catch(e){
    alert("Status update failed: "+e.message);
  }
}

async function reactivateStudent(id){
  const s=Students.find(x=>x.id===id); if(!s) return;
  try{ await api("/api/students/"+id,{method:"PATCH",body:JSON.stringify({active:1})}); await loadAll(); selectStudent(id); }catch(e){ alert("Failed: "+e.message); }
}
function apiEnrollStudent(form){
  return api("/api/enroll",{method:"POST",body:JSON.stringify(form)});
}
// ---- print / CSV ----
function downloadFile(content, filename, type){
  const blob=new Blob([content],{type:type||'text/plain'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=filename; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>{ try{URL.revokeObjectURL(url);}catch(e){} },1500);
}
function exportCSV(rows, filename){
  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  downloadFile(csv, filename, 'text/csv');
}

const PRINT_COMMON_CSS = `<style>
  @page { size: A4 portrait; margin: 10mm 12mm 10mm 12mm; }
  *, *::before, *::after { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
  html, body { background: #FFFFFF !important; color: #0A0A0A !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important; line-height: 1.35; margin: 0; padding: 0; font-size: 9pt; }
  .print-doc { max-width: 100%; margin: 0 auto; background: #FFFFFF; }
  .print-header { border-bottom: 2px solid #0A0A0A; padding-bottom: 8px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: flex-start; page-break-inside: avoid; break-inside: avoid; }
  .print-school-name { font-family: 'Newsreader', Georgia, serif; font-size: 20px; font-weight: 700; letter-spacing: -0.01em; color: #0A0A0A; text-transform: uppercase; margin: 0 0 2px 0; line-height: 1.15; }
  .print-school-sub { font-size: 9.5px; letter-spacing: 0.12em; text-transform: uppercase; color: #555555; font-weight: 600; margin: 0 0 2px 0; }
  .print-school-meta { font-size: 9px; color: #666666; line-height: 1.3; }
  .print-badge-official { font-size: 8.5px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; padding: 3px 8px; border: 1px solid #0A0A0A; border-radius: 3px; background: #F6F4EF; color: #0A0A0A; display: inline-block; white-space: nowrap; }
  .print-doc-title { font-family: 'Newsreader', Georgia, serif; font-size: 14px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #0A0A0A; margin-top: 3px; text-align: right; }
  .print-meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 10px; background: #FAF9F6; border: 1px solid #E2DFD7; border-radius: 4px; padding: 6px 10px; margin-bottom: 10px; page-break-inside: avoid; break-inside: avoid; }
  .print-meta-item { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .print-meta-label { font-size: 7.5px; letter-spacing: 0.12em; text-transform: uppercase; color: #777777; font-weight: 600; }
  .print-meta-val { font-size: 10px; font-weight: 600; color: #0A0A0A; word-break: break-word; }
  .print-kpi-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin-bottom: 10px; page-break-inside: avoid; break-inside: avoid; }
  .print-kpi-box { border: 1px solid #D6D2C8; background: #FFFFFF; border-radius: 3px; padding: 5px 6px; text-align: center; display: flex; flex-direction: column; justify-content: center; align-items: center; }
  .print-kpi-box.highlight { background: #F4F2EB; border-color: #0A0A0A; }
  .print-kpi-num { font-size: 15px; font-weight: 700; color: #0A0A0A; line-height: 1.1; font-family: ui-monospace, "SF Mono", monospace; }
  .print-kpi-label { font-size: 7.5px; letter-spacing: 0.1em; text-transform: uppercase; color: #666666; font-weight: 600; margin-top: 2px; white-space: nowrap; }
  .print-section-title { font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 700; color: #0A0A0A; margin: 10px 0 5px 0; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #E2DFD7; padding-bottom: 3px; page-break-inside: avoid; break-inside: avoid; }
  .print-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 8.5pt; page-break-inside: auto; }
  .print-table thead { display: table-header-group; }
  .print-table tfoot { display: table-footer-group; }
  .print-table tbody { display: table-row-group; }
  .print-table tr { page-break-inside: avoid; break-inside: avoid; page-break-after: auto; }
  .print-table th { background: #F0EEE9; border: 1px solid #D0CDC7; color: #0A0A0A; font-size: 7.5pt; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; padding: 4px 6px; text-align: left; white-space: nowrap; }
  .print-table td { border: 1px solid #E2DFD7; padding: 4px 6px; color: #0A0A0A; vertical-align: middle; word-break: break-word; }
  .print-table tr:nth-child(even) td { background: #FAF9F6; }
  .print-badge { display: inline-block; font-size: 7pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 2px 5px; border-radius: 2px; line-height: 1.2; white-space: nowrap; }
  .print-badge.present { background: #EAF4EC; color: #2F5D34; border: 1px solid #BCDBC0; }
  .print-badge.late { background: #FFF8E6; color: #8C6200; border: 1px solid #EAD49B; }
  .print-badge.absent { background: #FDF2F2; color: #8A3A3A; border: 1px solid #E8C4C4; }
  .print-badge.not-scheduled { background: #F4F2EB; color: #777777; border: 1px solid #D6D2C8; }
  .print-badge.duplicate { background: #F5F2EB; color: #444444; border: 1px solid #CCCCCC; }
  .print-signature-section { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 16px; padding-top: 6px; page-break-inside: avoid; break-inside: avoid; }
  .print-signature-box { display: flex; flex-direction: column; gap: 2px; }
  .print-sig-line { border-bottom: 1px solid #0A0A0A; height: 26px; margin-bottom: 3px; }
  .print-sig-title { font-size: 8px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #0A0A0A; }
  .print-sig-sub { font-size: 7.5px; color: #777777; }
  .print-footer-bar { margin-top: 12px; padding-top: 5px; border-top: 1px dashed #D6D2C8; display: flex; justify-content: space-between; align-items: center; font-size: 7.5pt; color: #777777; page-break-inside: avoid; break-inside: avoid; }
  .print-student-card { display: flex; gap: 14px; padding: 10px 12px; border: 1px solid #E2DFD7; background: #FAF9F6; border-radius: 4px; margin-bottom: 10px; page-break-inside: avoid; break-inside: avoid; }
  .print-student-photo { width: 68px; height: 84px; border: 1px solid #D0CDC7; border-radius: 3px; background: #FFFFFF; overflow: hidden; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px; color: #666; flex-shrink: 0; }
  .print-student-photo img { width: 100%; height: 100%; object-fit: cover; }
  .print-detail-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px 10px; flex: 1; }
  .print-detail-field { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .print-detail-label { font-size: 7px; letter-spacing: 0.1em; text-transform: uppercase; color: #777777; font-weight: 600; }
  .print-detail-val { font-size: 9.5pt; font-weight: 600; color: #0A0A0A; word-break: break-word; }
</style>`;

function printDocument(innerHtml, docTitle){
  docTitle = docTitle || "ATL Attendance Document";
  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${esc(docTitle)}</title>
  ${PRINT_COMMON_CSS}
</head>
<body>
  <div class="print-doc">
    ${innerHtml}
  </div>
</body>
</html>`;

  const root = $("printRoot");
  if(root){
    root.innerHTML = `<div class="print-doc">${innerHtml}</div>`;
  }

  // Trigger standard window.print()
  try {
    const origTitle = document.title;
    document.title = docTitle;
    window.print();
    setTimeout(()=>{ document.title = origTitle; }, 1500);
  } catch(e) {
    try {
      const w = window.open('', '_blank');
      if(w){
        w.document.write(fullHtml);
        w.document.close();
        setTimeout(()=>{ w.print(); }, 250);
      }
    } catch(e2){}
  }
}

function printTodayAttendance(){
  const t = todayISO();
  const school = Settings.schoolName || "ATL Model School";
  const address = Settings.address || "Main Academic Campus";
  const academicYear = Settings.academicYear || "Academic Session 2026–2027";
  const cf = todayClassFilter ? todayClassFilter.value : "";
  const sf = todayStatusFilter ? todayStatusFilter.value : "";
  const sort = todaySort ? todaySort.value : "time_desc";

  const byId = new Map(Students.map(s=>[s.id, s]));
  const allActiveFiltered = Students.filter(s=>s.active && (!cf || s.class===cf));
  const scheduledFiltered = allActiveFiltered.filter(s=> isWorkingDayForStudent(t, s));
  const notScheduledFiltered = allActiveFiltered.filter(s=> !isWorkingDayForStudent(t, s));
  const isGlobalWorking = isWorkingDayUI(t);
  const workingLabel = isGlobalWorking ? "Working Day" : "Institutional Holiday / Non-Working";

  let scannedRows = Attendance.filter(a=>a.date===t && a.studentId).map(a=>{ const s=byId.get(a.studentId); return s?{a,s}:null; }).filter(Boolean);
  if(cf) scannedRows = scannedRows.filter(r=>r.s.class===cf);

  const scannedStudentIds = new Set(scannedRows.map(r=>r.s.id));
  const presentStudentIds = new Set(scannedRows.filter(r=>r.a.status==="Present" || r.a.status==="Late").map(r=>r.s.id));

  // Determine full roster for print matching the admin's filter
  let fullRoster = [];
  if(sf === "Duplicate"){
    fullRoster = scannedRows.filter(r=>r.a.isDuplicate);
  } else if(sf === "Not Scheduled"){
    fullRoster = notScheduledFiltered.map(s=>({a:{status:"Not Scheduled", time:"—", isDuplicate:false, fingerId:s.fid?parseInt(String(s.fid).replace("F-","")):null, date:t}, s}));
  } else if(sf === "Absent"){
    const absentStudents = scheduledFiltered.filter(s=> !presentStudentIds.has(s.id));
    fullRoster = absentStudents.map(s=>({a:{status:"Absent", time:"—", isDuplicate:false, fingerId:null, date:t}, s}));
  } else if(sf){
    fullRoster = scannedRows.filter(r=>r.a.status===sf);
  } else {
    // Complete official daily sheet: Scanned records + scheduled absentees + not scheduled
    fullRoster = scannedRows.slice();
    const absentStudents = scheduledFiltered.filter(s=> !scannedStudentIds.has(s.id));
    absentStudents.forEach(s=>{
      fullRoster.push({a:{status:"Absent", time:"—", isDuplicate:false, fingerId:null, date:t}, s});
    });
    notScheduledFiltered.forEach(s=>{
      if(!scannedStudentIds.has(s.id)){
        fullRoster.push({a:{status:"Not Scheduled", time:"—", isDuplicate:false, fingerId:s.fid?parseInt(String(s.fid).replace("F-","")):null, date:t}, s});
      }
    });
  }

  fullRoster.sort((x,y)=>{
    if(sort==="time_desc") return (y.a.time||"").localeCompare(x.a.time||"");
    if(sort==="time_asc") return (x.a.time||"").localeCompare(y.a.time||"");
    if(sort==="name_asc") return x.s.name.localeCompare(y.s.name);
    if(sort==="roll_asc") return x.s.roll.localeCompare(y.s.roll);
    if(sort==="class_asc") return x.s.class.localeCompare(y.s.class);
    return 0;
  });

  const scheduledTotal = scheduledFiltered.length;
  const notScheduledTotal = notScheduledFiltered.length;
  const presentCount = Attendance.filter(a=>a.date===t && a.studentId).map(a=>{const s=byId.get(a.studentId); return s&& (!cf||s.class===cf) && isWorkingDayForStudent(t, s) ? a:null}).filter(a=>a&&a.status==="Present").length;
  const lateCount = Attendance.filter(a=>a.date===t && a.studentId).map(a=>{const s=byId.get(a.studentId); return s&& (!cf||s.class===cf) && isWorkingDayForStudent(t, s) ? a:null}).filter(a=>a&&a.status==="Late").length;
  const absentCount = Math.max(0, scheduledTotal - presentCount - lateCount);
  const attPct = scheduledTotal ? Math.round(((presentCount + lateCount) / scheduledTotal) * 100) : 0;
  const dupCount = Attendance.filter(a=>a.date===t && a.isDuplicate && (!cf || (byId.get(a.studentId)&&byId.get(a.studentId).class===cf))).length;

  const now = new Date();
  const printGenTime = now.toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'}) + ' at ' + now.toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit',hour12:true});

  let tableRowsHtml = "";
  if(!fullRoster.length){
    tableRowsHtml = `<tr><td colspan="9" style="text-align:center;padding:16px 12px;color:#666;font-style:italic">No attendance records found matching the selected class and status filters.</td></tr>`;
  } else {
    tableRowsHtml = fullRoster.map((r, idx)=>{
      const s = r.s, a = r.a;
      const stClass = a.status.toLowerCase().replace(/\s+/g, '-');
      const batchTxt = s.batch ? ` · ${esc(s.batch)}` : "";
      const contactTxt = s.phone || s.parent || "—";
      const methodTxt = a.fingerId != null ? `Biometric (F-${a.fingerId})` : (a.status === "Present" || a.status === "Late" ? "Biometric Scan" : "—");
      return `<tr>
        <td style="width:28px;text-align:center;font-weight:600;color:#555">${idx + 1}</td>
        <td style="width:70px;font-family:ui-monospace,monospace;font-weight:600">${esc(s.roll)}</td>
        <td style="font-weight:600">${esc(s.name)}</td>
        <td style="width:105px">${esc(s.class)}${batchTxt}</td>
        <td style="font-size:8pt;color:#555">${esc(contactTxt)}</td>
        <td style="width:68px;font-family:ui-monospace,monospace">${esc(a.time)}</td>
        <td style="width:105px"><span class="print-badge ${stClass}">${esc(a.status)}</span>${a.isDuplicate?' <span class="print-badge duplicate">Dup</span>':''}</td>
        <td style="width:95px;font-size:8pt;color:#666">${esc(methodTxt)}</td>
        <td style="width:80px;text-align:center;color:#CCC">________</td>
      </tr>`;
    }).join("");
  }

  let unknownSectionHtml = "";
  if(Unknowns && Unknowns.length > 0){
    const uRows = Unknowns.map((u, i)=>`<tr>
      <td style="width:28px;text-align:center;color:#666">${i+1}</td>
      <td style="width:80px;font-family:ui-monospace,monospace">${esc(u.time)}</td>
      <td style="width:100px;font-weight:600">${esc(u.finger)}</td>
      <td>${esc(u.note || "Unrecognized fingerprint scanned at terminal")}</td>
      <td style="width:120px;font-size:8pt;color:#8A3A3A;font-weight:600">Access Denied</td>
    </tr>`).join("");

    unknownSectionHtml = `
      <div class="print-section-title">
        <span>Unrecognized & Anomaly Biometric Scans (${Unknowns.length})</span>
        <span style="font-size:8px;font-weight:500;color:#8A3A3A">Automated Security Log</span>
      </div>
      <table class="print-table">
        <thead>
          <tr>
            <th style="width:28px;text-align:center">#</th>
            <th style="width:80px">Time</th>
            <th style="width:100px">Sensor Match</th>
            <th>Diagnostic Note</th>
            <th style="width:120px">Action Taken</th>
          </tr>
        </thead>
        <tbody>
          ${uRows}
        </tbody>
      </table>`;
  }

  const html = `
    <div class="print-header">
      <div class="print-header-left">
        <div class="print-school-name">${esc(school)}</div>
        <div class="print-school-sub">ATL Smart Biometric Attendance Terminal · Daily Master Sheet</div>
        <div class="print-school-meta">${esc(address)} &nbsp;|&nbsp; ${esc(academicYear)}</div>
      </div>
      <div class="print-header-right">
        <span class="print-badge-official">Official Attendance Document</span>
        <div class="print-doc-title">Daily Attendance Register</div>
      </div>
    </div>

    <div class="print-meta-grid">
      <div class="print-meta-item">
        <span class="print-meta-label">Session Date</span>
        <span class="print-meta-val">${fmtDate(t)} (${parseISO(t).toLocaleDateString('en-GB',{weekday:'long'})})</span>
      </div>
      <div class="print-meta-item">
        <span class="print-meta-label">Schedule Type</span>
        <span class="print-meta-val">${esc(workingLabel)}</span>
      </div>
      <div class="print-meta-item">
        <span class="print-meta-label">Class Scope</span>
        <span class="print-meta-val">${esc(cf || "All Classes (School-wide)")}</span>
      </div>
      <div class="print-meta-item">
        <span class="print-meta-label">Filter Applied</span>
        <span class="print-meta-val">${esc(sf || "All Records (Complete Day Roster)")}</span>
      </div>
    </div>

    <div class="print-kpi-grid">
      <div class="print-kpi-box">
        <div class="print-kpi-num">${allActiveFiltered.length}</div>
        <div class="print-kpi-label">Total Enrolled</div>
      </div>
      <div class="print-kpi-box">
        <div class="print-kpi-num">${scheduledTotal}</div>
        <div class="print-kpi-label">Scheduled Today</div>
      </div>
      <div class="print-kpi-box">
        <div class="print-kpi-num" style="color:#2F5D34">${presentCount}</div>
        <div class="print-kpi-label">Present</div>
      </div>
      <div class="print-kpi-box">
        <div class="print-kpi-num" style="color:#8C6200">${lateCount}</div>
        <div class="print-kpi-label">Late Arrivals</div>
      </div>
      <div class="print-kpi-box">
        <div class="print-kpi-num" style="color:#8A3A3A">${absentCount}</div>
        <div class="print-kpi-label">Absences</div>
      </div>
      <div class="print-kpi-box highlight">
        <div class="print-kpi-num">${attPct}%</div>
        <div class="print-kpi-label">Attendance Rate</div>
      </div>
    </div>

    <div class="print-section-title">
      <span>Student Attendance Roster (${fullRoster.length} Records)</span>
      <span style="font-size:8px;font-weight:500;color:#666">Generated on ${esc(printGenTime)}</span>
    </div>

    <table class="print-table">
      <thead>
        <tr>
          <th style="width:28px;text-align:center">#</th>
          <th style="width:70px">Roll No</th>
          <th>Student Name</th>
          <th style="width:105px">Class / Batch</th>
          <th>Parent / Contact</th>
          <th style="width:68px">Time</th>
          <th style="width:105px">Status</th>
          <th style="width:95px">Method</th>
          <th style="width:80px;text-align:center">Sign / Initials</th>
        </tr>
      </thead>
      <tbody>
        ${tableRowsHtml}
      </tbody>
    </table>

    ${unknownSectionHtml}

    <div class="print-signature-section">
      <div class="print-signature-box">
        <div class="print-sig-line"></div>
        <div class="print-sig-title">Class Teacher / Proctor</div>
        <div class="print-sig-sub">Name & Signature / Date</div>
      </div>
      <div class="print-signature-box">
        <div class="print-sig-line"></div>
        <div class="print-sig-title">Biometric Attendance Officer</div>
        <div class="print-sig-sub">Terminal Operator / Verification</div>
      </div>
      <div class="print-signature-box">
        <div class="print-sig-line"></div>
        <div class="print-sig-title">Principal / Administrator</div>
        <div class="print-sig-sub">Official Stamp & Signature</div>
      </div>
    </div>

    <div class="print-footer-bar">
      <span>ATL Smart Attendance Biometric Terminal — Secure Database Ledger</span>
      <span>Document Ref: ATT-${t}-${(cf||"ALL").replace(/[^a-zA-Z0-9]/g,"")} &nbsp;|&nbsp; Page 1 of 1</span>
    </div>
  `;

  printDocument(html, `Attendance_${t}_${cf||'School'}`);
}

async function printReportDocument(){
  const school = Settings.schoolName || "ATL Model School";
  const address = Settings.address || "Main Academic Campus";
  const academicYear = Settings.academicYear || "Academic Session 2026–2027";
  const scope = reportScope ? reportScope.value : "school";
  const cls = reportClass ? reportClass.value : "";
  const time = reportTime ? reportTime.value : "today";
  const today = todayISO();
  let from, to;
  if(time==="today"){from=today;to=today;}
  else if(time==="week"){const d=new Date();d.setDate(d.getDate()-6);from=toISODate(d);to=today;}
  else if(time==="month"){const d=new Date();d.setDate(1);from=toISODate(d);to=today;}
  else if(time==="academic"){from=Settings.startDate||today;to=Settings.endDate||today;}
  else if(time==="custom"){from=(reportFrom&&reportFrom.value)?reportFrom.value:today; to=(reportTo&&reportTo.value)?reportTo.value:today;}
  else {from=Settings.startDate||today;to=today;}

  let scopeLabel = "Entire School (All Classes)";
  let targetStudent = null;
  if(scope === "class") scopeLabel = `Class: ${cls || "All Classes"}`;
  else if(scope === "student"){
    const sid = parseInt(reportStudent ? reportStudent.value : "");
    targetStudent = Students.find(x=>x.id===sid);
    scopeLabel = targetStudent ? `Student: ${targetStudent.name} (${targetStudent.roll} · ${targetStudent.class})` : "Single Student";
  }

  // Retrieve attendance events
  let ev = [];
  try {
    ev = await api("/api/attendance", {method:"GET"});
    if(!Array.isArray(ev)) ev = Attendance;
  } catch(e){
    ev = Attendance;
  }

  let list = ev.filter(a=>a.date>=from && a.date<=to).map(mapEvent);
  if(scope==="class" && cls) list = list.filter(a=>{ const s=Students.find(x=>x.id===a.studentId); return s && s.class===cls; });
  if(scope==="student" && targetStudent) list = list.filter(a=>a.studentId===targetStudent.id);
  list.sort((a,b)=> (b.date||"").localeCompare(a.date||"") || (b.time||"").localeCompare(a.time||""));

  const presentCount = list.filter(a=>a.status==="Present").length;
  const lateCount = list.filter(a=>a.status==="Late").length;
  const absentCount = list.filter(a=>a.status==="Absent").length;
  const notScheduledCount = list.filter(a=>a.status==="Not Scheduled").length;
  const duplicateCount = list.filter(a=>a.isDuplicate).length;
  const totalRecords = list.length;

  let kpiBoxesHtml = "";
  if(scope === "student" && targetStudent){
    const stats = studentStats(targetStudent);
    kpiBoxesHtml = `
      <div class="print-kpi-grid">
        <div class="print-kpi-box">
          <div class="print-kpi-num">${stats.working}</div>
          <div class="print-kpi-label">Recorded Days</div>
        </div>
        <div class="print-kpi-box">
          <div class="print-kpi-num" style="color:#2F5D34">${presentCount}</div>
          <div class="print-kpi-label">Present</div>
        </div>
        <div class="print-kpi-box">
          <div class="print-kpi-num" style="color:#8C6200">${lateCount}</div>
          <div class="print-kpi-label">Late Arrivals</div>
        </div>
        <div class="print-kpi-box">
          <div class="print-kpi-num" style="color:#8A3A3A">${absentCount}</div>
          <div class="print-kpi-label">Absences</div>
        </div>
        <div class="print-kpi-box">
          <div class="print-kpi-num">${duplicateCount}</div>
          <div class="print-kpi-label">Duplicates</div>
        </div>
        <div class="print-kpi-box highlight">
          <div class="print-kpi-num">${stats.pct}%</div>
          <div class="print-kpi-label">Attendance Rate</div>
        </div>
      </div>
    `;
  } else {
    // School or Class scope - exactly 6 clean KPI boxes
    const rate = (presentCount + lateCount + absentCount) > 0 ? Math.round(((presentCount + lateCount) / (presentCount + lateCount + absentCount)) * 100) : (totalRecords > 0 ? 100 : 0);
    kpiBoxesHtml = `
      <div class="print-kpi-grid">
        <div class="print-kpi-box">
          <div class="print-kpi-num">${totalRecords}</div>
          <div class="print-kpi-label">Total Records</div>
        </div>
        <div class="print-kpi-box">
          <div class="print-kpi-num" style="color:#2F5D34">${presentCount}</div>
          <div class="print-kpi-label">Present</div>
        </div>
        <div class="print-kpi-box">
          <div class="print-kpi-num" style="color:#8C6200">${lateCount}</div>
          <div class="print-kpi-label">Late Arrivals</div>
        </div>
        <div class="print-kpi-box">
          <div class="print-kpi-num" style="color:#8A3A3A">${absentCount}</div>
          <div class="print-kpi-label">Absences</div>
        </div>
        <div class="print-kpi-box">
          <div class="print-kpi-num">${notScheduledCount}</div>
          <div class="print-kpi-label">Not Scheduled</div>
        </div>
        <div class="print-kpi-box highlight">
          <div class="print-kpi-num">${rate}%</div>
          <div class="print-kpi-label">Attendance Rate</div>
        </div>
      </div>
    `;
  }

  let tableRowsHtml = "";
  if(!list.length){
    tableRowsHtml = `<tr><td colspan="8" style="text-align:center;padding:16px 12px;color:#666;font-style:italic">No attendance records found matching the selected filter criteria and date range.</td></tr>`;
  } else {
    tableRowsHtml = list.map((a, idx)=>{
      const s = Students.find(x=>x.id===a.studentId);
      let schedTxt = "—";
      if(s && a.date){
        schedTxt = isWorkingDayForStudent(a.date, s) ? "Scheduled" : "Non-Working / Off";
        if(a.status === "Not Scheduled") schedTxt = "Not Scheduled";
      }
      const stClass = (a.status||"").toLowerCase().replace(/\s+/g, '-');
      const dupBadge = a.isDuplicate ? ' <span class="print-badge duplicate">Dup</span>' : '';
      return `<tr>
        <td style="width:28px;text-align:center;font-weight:600;color:#555">${idx + 1}</td>
        <td style="width:80px;font-family:ui-monospace,monospace">${esc(fmtDate(a.date))}</td>
        <td style="width:68px;font-family:ui-monospace,monospace">${esc(a.time||"—")}</td>
        <td style="font-weight:600">${esc(s ? s.name : "Unknown / Unassigned")}</td>
        <td style="width:70px;font-family:ui-monospace,monospace">${esc(s ? s.roll : "—")}</td>
        <td style="width:90px">${esc(s ? s.class : "—")}</td>
        <td style="width:110px"><span class="print-badge ${stClass}">${esc(a.status||"—")}</span>${dupBadge}</td>
        <td style="width:105px;font-size:8pt;color:#666">${esc(schedTxt)}</td>
      </tr>`;
    }).join("");
  }

  const now = new Date();
  const printGenTime = now.toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'}) + ' at ' + now.toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit',hour12:true});

  const html = `
    <div class="print-header">
      <div class="print-header-left">
        <div class="print-school-name">${esc(school)}</div>
        <div class="print-school-sub">ATL Smart Attendance System · Official Analytics & Audit</div>
        <div class="print-school-meta">${esc(address)} &nbsp;|&nbsp; ${esc(academicYear)}</div>
      </div>
      <div class="print-header-right">
        <span class="print-badge-official">Official Audit Report</span>
        <div class="print-doc-title">Attendance Report</div>
      </div>
    </div>

    <div class="print-meta-grid">
      <div class="print-meta-item">
        <span class="print-meta-label">Report Scope</span>
        <span class="print-meta-val">${esc(scopeLabel)}</span>
      </div>
      <div class="print-meta-item">
        <span class="print-meta-label">Date Range</span>
        <span class="print-meta-val">${fmtDate(from)} → ${fmtDate(to)}</span>
      </div>
      <div class="print-meta-item">
        <span class="print-meta-label">Time Period</span>
        <span class="print-meta-val">${esc(time.toUpperCase())}</span>
      </div>
      <div class="print-meta-item">
        <span class="print-meta-label">Generated On</span>
        <span class="print-meta-val">${esc(printGenTime)}</span>
      </div>
    </div>

    ${kpiBoxesHtml}

    <div class="print-section-title">
      <span>Attendance Records Breakdown (${list.length} Records)</span>
      <span style="font-size:8px;font-weight:500;color:#666">Audit Trail Verified</span>
    </div>

    <table class="print-table">
      <thead>
        <tr>
          <th style="width:28px;text-align:center">#</th>
          <th style="width:80px">Date</th>
          <th style="width:68px">Time</th>
          <th>Student</th>
          <th style="width:70px">Roll</th>
          <th style="width:90px">Class</th>
          <th style="width:110px">Status</th>
          <th style="width:105px">Schedule Type</th>
        </tr>
      </thead>
      <tbody>
        ${tableRowsHtml}
      </tbody>
    </table>

    <div class="print-signature-section">
      <div class="print-signature-box">
        <div class="print-sig-line"></div>
        <div class="print-sig-title">Report Prepared By</div>
        <div class="print-sig-sub">Attendance Clerk / Administrator</div>
      </div>
      <div class="print-signature-box">
        <div class="print-sig-line"></div>
        <div class="print-sig-title">Audited & Verified By</div>
        <div class="print-sig-sub">Academic Supervisor</div>
      </div>
      <div class="print-signature-box">
        <div class="print-sig-line"></div>
        <div class="print-sig-title">Principal Approval</div>
        <div class="print-sig-sub">Official Stamp & Signature</div>
      </div>
    </div>

    <div class="print-footer-bar">
      <span>ATL Smart Attendance Biometric Terminal — Certified Database Extract</span>
      <span>Report Ref: RPT-${from}-${to} &nbsp;|&nbsp; Page 1 of 1</span>
    </div>
  `;

  printDocument(html, `Attendance_Report_${from}_to_${to}`);
}

function printStudentProfileDocument(studentId){
  const s = Students.find(x=>x.id===studentId);
  if(!s) return;
  const school = Settings.schoolName || "ATL Model School";
  const address = Settings.address || "Main Academic Campus";
  const academicYear = Settings.academicYear || "Academic Session 2026–2027";

  const initials = s.name.trim().split(" ").map(w=>w[0]).slice(0,2).join("").toUpperCase();
  const photoHtml = s.photo ? `<img src="${esc(s.photo)}" alt="">` : initials;

  const history = Attendance.filter(a=>a.studentId===s.id).slice(-40).reverse();
  const histRows = history.length ? history.map((a, i)=>`<tr>
    <td style="width:28px;text-align:center;color:#666">${i+1}</td>
    <td style="width:85px;font-family:ui-monospace,monospace">${esc(fmtDate(a.date))}</td>
    <td style="width:75px;font-family:ui-monospace,monospace">${esc(a.time)}</td>
    <td style="width:110px"><span class="print-badge ${a.status.toLowerCase().replace(/\s+/g,'-')}">${esc(a.status)}</span></td>
    <td style="width:90px">${esc(a.fingerId!=null?"F-"+a.fingerId:"—")}</td>
    <td>Verified via Biometric Terminal</td>
  </tr>`).join("") : `<tr><td colspan="6" style="text-align:center;padding:14px 12px;color:#666;font-style:italic">No scan history recorded.</td></tr>`;

  const stats = studentStats(s);

  const html = `
    <div class="print-header">
      <div class="print-header-left">
        <div class="print-school-name">${esc(school)}</div>
        <div class="print-school-sub">ATL Smart Attendance System · Student Dossier & Biometrics</div>
        <div class="print-school-meta">${esc(address)} &nbsp;|&nbsp; ${esc(academicYear)}</div>
      </div>
      <div class="print-header-right">
        <span class="print-badge-official">Student Profile & Ledger</span>
        <div class="print-doc-title">Official Student Record</div>
      </div>
    </div>

    <div class="print-student-card">
      <div class="print-student-photo">${photoHtml}</div>
      <div class="print-detail-grid">
        <div class="print-detail-field" style="grid-column:1 / -1">
          <span class="print-detail-label">Full Name</span>
          <span class="print-detail-val" style="font-size:15px;font-family:'Newsreader',Georgia,serif">${esc(s.name)}</span>
        </div>
        <div class="print-detail-field">
          <span class="print-detail-label">Roll Number</span>
          <span class="print-detail-val">${esc(s.roll)}</span>
        </div>
        <div class="print-detail-field">
          <span class="print-detail-label">Class / Grade</span>
          <span class="print-detail-val">${esc(s.class)}</span>
        </div>
        <div class="print-detail-field">
          <span class="print-detail-label">Batch / Section</span>
          <span class="print-detail-val">${esc(s.batch || s.section || "—")}</span>
        </div>
        <div class="print-detail-field">
          <span class="print-detail-label">Parent / Guardian</span>
          <span class="print-detail-val">${esc(s.parent || "—")}</span>
        </div>
        <div class="print-detail-field">
          <span class="print-detail-label">Contact Phone</span>
          <span class="print-detail-val">${esc(s.phone || "—")}</span>
        </div>
        <div class="print-detail-field">
          <span class="print-detail-label">Status</span>
          <span class="print-detail-val"><span class="print-badge ${s.active?'present':'absent'}">${s.active?'ACTIVE STUDENT':'INACTIVE'}</span></span>
        </div>
        <div class="print-detail-field" style="grid-column:1 / -1">
          <span class="print-detail-label">Residential Address</span>
          <span class="print-detail-val">${esc(s.address || "—")}</span>
        </div>
        <div class="print-detail-field">
          <span class="print-detail-label">Fingerprint Sensor ID</span>
          <span class="print-detail-val">${esc(s.fid || "Not Enrolled")}</span>
        </div>
        <div class="print-detail-field">
          <span class="print-detail-label">Enrollment Date</span>
          <span class="print-detail-val">${esc(fmtDate(s.enroll) || "—")}</span>
        </div>
        <div class="print-detail-field">
          <span class="print-detail-label">Internal System ID</span>
          <span class="print-detail-val">#${esc(String(s.id))}</span>
        </div>
      </div>
    </div>

    <div class="print-kpi-grid">
      <div class="print-kpi-box">
        <div class="print-kpi-num">${stats.working}</div>
        <div class="print-kpi-label">Recorded Days</div>
      </div>
      <div class="print-kpi-box">
        <div class="print-kpi-num" style="color:#2F5D34">${stats.present}</div>
        <div class="print-kpi-label">Present</div>
      </div>
      <div class="print-kpi-box">
        <div class="print-kpi-num" style="color:#8C6200">${stats.late}</div>
        <div class="print-kpi-label">Late</div>
      </div>
      <div class="print-kpi-box">
        <div class="print-kpi-num" style="color:#8A3A3A">${stats.absent}</div>
        <div class="print-kpi-label">Absent</div>
      </div>
      <div class="print-kpi-box highlight" style="grid-column: span 2">
        <div class="print-kpi-num">${stats.pct}%</div>
        <div class="print-kpi-label">Cumulative Attendance</div>
      </div>
    </div>

    <div class="print-section-title">
      <span>Recent Attendance Audit Trail</span>
      <span style="font-size:8px;font-weight:500;color:#666">Biometric Timestamp Verified</span>
    </div>

    <table class="print-table">
      <thead>
        <tr>
          <th style="width:28px;text-align:center">#</th>
          <th style="width:85px">Date</th>
          <th style="width:75px">Time</th>
          <th style="width:110px">Status</th>
          <th style="width:90px">Fingerprint</th>
          <th>Verification Note</th>
        </tr>
      </thead>
      <tbody>
        ${histRows}
      </tbody>
    </table>

    <div class="print-signature-section">
      <div class="print-signature-box">
        <div class="print-sig-line"></div>
        <div class="print-sig-title">Class Teacher Signature</div>
        <div class="print-sig-sub">Verified & Approved</div>
      </div>
      <div class="print-signature-box">
        <div class="print-sig-line"></div>
        <div class="print-sig-title">Parent / Guardian Signature</div>
        <div class="print-sig-sub">Acknowledged</div>
      </div>
      <div class="print-signature-box">
        <div class="print-sig-line"></div>
        <div class="print-sig-title">Principal / Office Seal</div>
        <div class="print-sig-sub">Institution Seal</div>
      </div>
    </div>

    <div class="print-footer-bar">
      <span>ATL Smart Attendance System — Biometric Profile Record</span>
      <span>Student ID: ${s.id} &nbsp;|&nbsp; Generated on ${fmtDate(todayISO())}</span>
    </div>
  `;

  printDocument(html, `Student_Profile_${s.roll}_${s.name.replace(/\s+/g,'_')}`);
}
function printHTML(htmlContent){
  printDocument(htmlContent, "Attendance Report");
}

// ---- events ----
function openAdmin(){
  const titles={students:"Students", today:"Today — Attendance", reports:"Reports", setup:"Setup — School Configuration & Schedule", calendar:"Setup", settings:"Setup", backup:"Backup — Audit"};
  if(adminTitle) adminTitle.textContent=titles[currentTab]||"Admin";
  // show loading briefly while data refreshes
  let activeTab = currentTab;
  if(activeTab === "calendar" || activeTab === "settings") activeTab = "setup";
  const pane=document.getElementById("pane-"+activeTab);
  if(pane) pane.style.opacity="0.6";
  pauseSensorScan(); adminLayer.classList.add("open"); renderAll();
  setTimeout(()=>{ if(pane) pane.style.opacity=""; updateTabs(); }, 80);
}
function updateTabs(){
  document.querySelectorAll(".admin-pane").forEach(p=>p.classList.add("hidden"));
  let activeTab = currentTab;
  if(activeTab === "calendar" || activeTab === "settings") activeTab = "setup";
  const pane=document.getElementById("pane-"+activeTab); if(pane){ pane.classList.remove("hidden"); pane.style.opacity=""; }
  const titles={students:"Students", today:"Today — Attendance", reports:"Reports", setup:"Setup — School Configuration & Schedule", calendar:"Setup", settings:"Setup", backup:"Backup — Audit"};
  if(adminTitle) adminTitle.textContent=titles[activeTab]||"Admin";
  if(activeTab==="today") renderToday();
  if(activeTab==="reports") renderReports();
  if(activeTab==="setup" || activeTab==="calendar" || activeTab==="settings"){
    renderClasses();
    renderWeekly();
    renderHolidays();
    renderOverrides();
    renderCalendarMonth();
    const set=(id,v)=>{ const el=$(id); if(el&&v!=null) el.value=v; };
    set("setSchoolName", Settings.schoolName);
    set("setSchoolAddress", Settings.address);
    set("setPresentCutoff", Settings.presentCutoff || "08:00");
    set("setLateCutoff", Settings.lateCutoff || Settings.lateAfter || "08:30");
    set("setLateThreshold", Settings.lateCutoff || Settings.lateAfter || "08:30");
    set("setAcademicYear", Settings.academicYear);
    set("setAttendanceStart", Settings.startDate);
  }
  if(activeTab==="backup") renderAudit();
}
document.getElementById("openAdminBtn").onclick=openAdmin;
const _frontEnrollBtn=document.getElementById("openEnrollBtn"); if(_frontEnrollBtn) _frontEnrollBtn.onclick=openNewStudent;
const _newToolbarBtn=document.getElementById("newStudentToolbarBtn"); if(_newToolbarBtn) _newToolbarBtn.onclick=openNewStudent;
document.getElementById("adminClose").onclick=()=>{
  finishEnrollUi();
  adminLayer.classList.remove("open");
  resumeSensorScan();
};
adminNav.onclick=(e)=>{
  if(e.target.tagName!=="BUTTON") return;
  [...adminNav.children].forEach(b=>b.classList.remove("active")); e.target.classList.add("active");
  currentTab=e.target.dataset.tab; updateTabs();
};
// CSV import (backend) — Import CSV beside Export CSV (static in HTML, dynamic fallback)
(function(){
  const toolbar = document.querySelector('#pane-students .tab-toolbar');
  if(!toolbar) return;
  let impBtn = $("importStudentsBtn");
  if(!impBtn){
    impBtn = document.createElement('button');
    impBtn.className='btn';
    impBtn.id='importStudentsBtn';
    impBtn.textContent='Import CSV';
    const expBtn = $("exportStudentsBtn");
    if(expBtn && expBtn.parentNode===toolbar) toolbar.insertBefore(impBtn, expBtn);
    else toolbar.appendChild(impBtn);
  }
  let fileInput = $("importStudentsFile");
  if(!fileInput){
    fileInput = document.createElement('input');
    fileInput.type='file'; fileInput.accept='.csv,text/csv'; fileInput.style.display='none'; fileInput.id='importStudentsFile';
    toolbar.appendChild(fileInput);
  }
  if(impBtn._csvWired) return;
  impBtn._csvWired = true;
  impBtn.onclick=()=>fileInput.click();
  fileInput.onchange=async(e)=>{
      const file=e.target.files&&e.target.files[0]; if(!file) return;
      const text=await file.text();
      // try backend import via file upload first
      try{
        const form=new FormData(); form.append('file', file);
        const pinHeaders={}; try{ const pin=sessionStorage.getItem("atl_admin_pin")||""; if(pin) pinHeaders["X-Admin-Pin"]=pin; }catch(e){}
        const r=await fetch('/api/import/csv',{method:'POST',body:form,cache:'no-store', headers:pinHeaders});
        const body=await r.json().catch(()=>({}));
        if(!r.ok) throw new Error(body.error||('HTTP '+r.status));
        alert(`Imported ${body.added||0} students, skipped ${body.skipped||0}` + (body.errors&&body.errors.length ? `\n${body.errors.slice(0,3).join('\n')}` : ''));
        await loadAll();
      }catch(err){
        // fallback: try JSON csv text
        try{
          const r2=await api('/api/import/csv',{method:'POST',body:JSON.stringify({csv:text})});
          alert(`Imported ${r2.added||0} students`);
          await loadAll();
        }catch(e2){
          alert('Import failed: '+(err.message||e2.message));
        }
      }
      e.target.value='';
    };
})();
$("exportStudentsBtn").onclick=async()=>{
  // Prefer backend export (includes batch/section/parent/attendance_rate)
  try{
    const r=await fetch('/api/export/csv?type=students',{cache:'no-store'});
    if(r.ok){
      const blob=await r.blob();
      const url=URL.createObjectURL(blob), a=document.createElement('a');
      const cd=r.headers.get('Content-Disposition')||'';
      let fn="students_"+todayISO()+".csv";
      const m=cd.match(/filename="?([^"]+)"?/); if(m) fn=m[1];
      a.href=url; a.download=fn; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1500);
      return;
    }
  }catch(e){}
  // offline fallback: export currently filtered view
  const q=(searchInput.value||"").toLowerCase(), cf=classFilter?classFilter.value:"", bf=batchFilter?batchFilter.value:"", sf=studentStatusFilter?studentStatusFilter.value:"active";
  let list=Students.filter(s=>{
    if(sf==="active" && !s.active) return false;
    if(sf==="inactive" && s.active) return false;
    if(cf && s.class!==cf) return false;
    if(bf && (s.batch||"")!==bf) return false;
    if(q && !(s.name+" "+s.roll+" "+s.class+" "+(s.batch||"")+" "+s.phone+" "+s.fid+" "+s.id+" "+(s.section||"")+" "+(s.parent||"")).toLowerCase().includes(q)) return false;
    return true;
  });
  const rows=[["ID","Name","Roll","Class","Batch","Section","Parent","Phone","Address","Fingerprint","Status"]].concat(list.map(s=>[s.id,s.name,s.roll,s.class,s.batch||"",s.section||"",s.parent||"",s.phone||"",s.address||"",s.fid||"",s.active?"Active":"Inactive"]));
  exportCSV(rows,"students_"+todayISO()+".csv");
};
$("todayRefreshBtn").onclick=async()=>{
  const btn=$("todayRefreshBtn");
  const prev=btn?btn.textContent:"";
  if(btn){ btn.textContent="Loading…"; btn.disabled=true; }
  try{ await loadTodayAttendance(); renderToday(); }
  finally{ if(btn){ btn.textContent=prev; btn.disabled=false; } }
};
$("todayPrintBtn").onclick=()=>{
  printTodayAttendance();
};
$("todayExportBtn").onclick=async()=>{
  const t=todayISO(), cf=todayClassFilter?todayClassFilter.value:"";
  // Prefer backend export (includes reconciled ABSENT/NOT_SCHEDULED)
  try{
    let url="/api/export/csv?type=attendance&date="+encodeURIComponent(t);
    if(cf) url+="&class="+encodeURIComponent(cf);
    const sf=todayStatusFilter?todayStatusFilter.value:"";
    if(sf && ["Present","Late","Absent","Not Scheduled","Duplicate","Unknown"].includes(sf)) url+="&status="+encodeURIComponent(sf.toUpperCase().replace(" ","_"));
    const r=await fetch(url,{cache:"no-store"});
    if(r.ok){
      const blob=await r.blob();
      const url2=URL.createObjectURL(blob), a=document.createElement('a');
      a.href=url2; a.download="today-"+t+(cf?"-"+cf:"")+".csv"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url2),1500);
      return;
    }
  }catch(e){}
  // fallback: include virtual Not Scheduled / Absent rows as shown in UI (backend schedule-aware)
  const allActiveFiltered = Students.filter(s=>s.active && (!cf || s.class===cf));
  const scheduledFiltered = allActiveFiltered.filter(s=> isWorkingDayForStudent(t, s));
  const rowsVisible = (()=> {
    const sf=todayStatusFilter?todayStatusFilter.value:"";
    if(sf==="Not Scheduled"){
      const notSched=allActiveFiltered.filter(s=> !isWorkingDayForStudent(t, s));
      return notSched.map(s=>["—",s.name,s.roll,s.class,"Not Scheduled",s.fid||""]);
    }
    if(sf==="Absent"){
      const presentIds=new Set(Attendance.filter(a=>a.date===t&&(a.status==="Present"||a.status==="Late")).map(a=>a.studentId));
      const abs=scheduledFiltered.filter(s=> !Attendance.some(a=>a.date===t&&a.studentId===s.id&&(a.status==="Present"||a.status==="Late")));
      return abs.map(s=>["—",s.name,s.roll,s.class,"Absent",""]);
    }
    return Attendance.filter(a=>a.date===t&&a.studentId).filter(a=>{ const s=Students.find(x=>x.id===a.studentId); return s&& (!cf||s.class===cf); }).map(a=>{ const s=Students.find(x=>x.id===a.studentId); return [a.time,s?s.name:"",s?s.roll:"",s?s.class:"",a.status,a.fingerId!=null?"F-"+a.fingerId:""]; });
  })();
  const rows=[["Time","Student","Roll","Class","Status","Fingerprint"]].concat(rowsVisible);
  exportCSV(rows,"today-"+t+(cf?"-"+cf:"")+".csv");
};
$("reportApplyBtn").onclick=renderReports;
$("reportPrintBtn").onclick=()=>printReportDocument();
$("reportCsvBtn").onclick=async()=>{
  const scope=reportScope.value, cls=reportClass.value;
  let from,to; const today=todayISO();
  const time=reportTime.value;
  if(time==="today"){from=today;to=today;}
  else if(time==="week"){const d=new Date();d.setDate(d.getDate()-6);from=toISODate(d);to=today;}
  else if(time==="month"){const d=new Date();d.setDate(1);from=toISODate(d);to=today;}
  else if(time==="academic"){from=Settings.startDate||today;to=Settings.endDate||today;}
  else if(time==="custom"){from=reportFrom.value||""; to=reportTo.value||"";}
  else {from=Settings.startDate||today;to=today;}
  try{
    let url="/api/export/csv?type=attendance";
    if(from) url+="&start="+encodeURIComponent(from);
    if(to) url+="&end="+encodeURIComponent(to);
    if(scope==="class"&&cls) url+="&class="+encodeURIComponent(cls);
    if(scope==="student"){const sid=parseInt(reportStudent.value); if(sid) url+="&studentId="+encodeURIComponent(sid);}
    const r=await fetch(url,{cache:"no-store"});
    if(r.ok){
      const blob=await r.blob();
      const url2=URL.createObjectURL(blob), a=document.createElement('a');
      a.href=url2; a.download="report-"+(from||today)+"_"+(to||today)+".csv"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url2),1500);
      return;
    }
  }catch(e){}
  const rows=[["Date","Time","Student","Status"]].concat([...reportBody.querySelectorAll("tr")].map(tr=>[...tr.querySelectorAll("td")].map(td=>td.textContent)).filter(r=>r.length>1));
  exportCSV(rows,"report-"+todayISO()+".csv");
};
$("calPrevBtn").onclick=()=>{ calendarMonth.setMonth(calendarMonth.getMonth()-1); renderCalendarMonth(); };
$("calNextBtn").onclick=()=>{ calendarMonth.setMonth(calendarMonth.getMonth()+1); renderCalendarMonth(); };
if($("calTodayBtn")) $("calTodayBtn").onclick=()=>{ calendarMonth=new Date(); renderCalendarMonth(); };
$("addHolidayBtn").onclick=()=>{
  if($("holidayModalTitle")) $("holidayModalTitle").textContent="Add holiday";
  const today=todayISO();
  $("holidayModalBody").innerHTML=`<div class="form-grid">
    <div class="form-field full"><label>Holiday / Event Name *</label><input id="holidayName" placeholder="e.g. Diwali Vacation, National Day"></div>
    <div class="form-field"><label>Start date *</label><input type="date" id="holidayStart" value="${today}"></div>
    <div class="form-field"><label>End date *</label><input type="date" id="holidayEnd" value="${today}"></div>
    <div class="form-field full"><label>Type</label><select id="holidayType"><option value="holiday">Holiday (Non-working, not marked absent)</option><option value="vacation">Vacation (Multi-day school closed)</option><option value="exam">Exam day (Working day)</option></select></div>
    <div class="form-field full" id="holidayErrWrap" style="display:none"><div class="inline-error" id="holidayErr"></div></div>
    <div class="form-field full form-actions" style="margin-top:4px">
      <button class="btn" id="holidayCancel">Cancel</button>
      <button class="btn primary" id="holidaySave">Save holiday</button>
    </div>
  </div>`;
  openModal(holidayModal);
  enhanceAllSelects(holidayModal);
  const startEl=$("holidayStart"), endEl=$("holidayEnd"), nameEl=$("holidayName"), errWrap=$("holidayErrWrap"), errEl=$("holidayErr");
  let lastStart = startEl.value;
  startEl.oninput=()=>{
    if(!endEl.value || endEl.value===lastStart) endEl.value=startEl.value;
    lastStart=startEl.value;
    if(errWrap) errWrap.style.display="none";
  };
  endEl.oninput=()=>{ if(errWrap) errWrap.style.display="none"; };
  nameEl.oninput=()=>{ if(errWrap) errWrap.style.display="none"; };
  $("holidayCancel").onclick=()=>closeModal(holidayModal);
  $("holidaySave").onclick=async()=>{
    const name=nameEl.value.trim(), start=startEl.value, end=endEl.value||start;
    if(!name){ errEl.textContent="Please enter a holiday name."; errWrap.style.display="block"; return; }
    if(!start){ errEl.textContent="Please select a start date."; errWrap.style.display="block"; return; }
    if(end < start){ errEl.textContent="End date cannot be earlier than start date."; errWrap.style.display="block"; return; }
    errWrap.style.display="none";
    const saveBtn=$("holidaySave"); saveBtn.disabled=true; saveBtn.textContent="Saving…";
    Holidays.push({name,start,end,category:"",type:$("holidayType").value});
    if(await persistCalendar()){
      closeModal(holidayModal);
      renderHolidays();
      renderCalendarMonth();
      if(currentTab==="today") renderToday();
      if(currentTab==="reports") renderReports();
    } else {
      Holidays.pop();
      saveBtn.disabled=false;
      saveBtn.textContent="Save holiday";
    }
  };
};
$("addOverrideBtn").onclick=()=>{
  if($("overrideModalTitle")) $("overrideModalTitle").textContent="Add special date override";
  const today=todayISO();
  $("overrideModalBody").innerHTML=`<div class="form-grid">
    <div class="form-field"><label>Date *</label><input type="date" id="overrideDate" value="${today}"></div>
    <div class="form-field"><label>Becomes</label><select id="overrideWorking"><option value="1">Working day</option><option value="0">Holiday / Non-working</option></select></div>
    <div class="form-field full"><label>Note / Reason *</label><input id="overrideNote" placeholder="e.g. Special working Saturday"></div>
    <div class="form-field full" id="overrideErrWrap" style="display:none"><div class="inline-error" id="overrideErr"></div></div>
    <div class="form-field full form-actions" style="margin-top:4px">
      <button class="btn" id="overrideCancel">Cancel</button>
      <button class="btn primary" id="overrideSave">Save override</button>
    </div>
  </div>`;
  openModal(overrideModal);
  enhanceAllSelects(overrideModal);
  const dateEl=$("overrideDate"), noteEl=$("overrideNote"), errWrap=$("overrideErrWrap"), errEl=$("overrideErr");
  dateEl.oninput=()=>{ if(errWrap) errWrap.style.display="none"; };
  noteEl.oninput=()=>{ if(errWrap) errWrap.style.display="none"; };
  $("overrideCancel").onclick=()=>closeModal(overrideModal);
  $("overrideSave").onclick=async()=>{
    const date=dateEl.value, note=noteEl.value.trim();
    if(!date){ errEl.textContent="Please choose a date."; errWrap.style.display="block"; return; }
    if(!note){ errEl.textContent="Please enter a note / reason for this override."; errWrap.style.display="block"; return; }
    errWrap.style.display="none";
    const saveBtn=$("overrideSave"); saveBtn.disabled=true; saveBtn.textContent="Saving…";
    const prevOverrides = Overrides.slice();
    Overrides=Overrides.filter(o=>o.date!==date);
    Overrides.push({date,isWorking:$("overrideWorking").value==="1",note});
    if(await persistCalendar()){
      closeModal(overrideModal);
      renderOverrides();
      renderCalendarMonth();
      if(currentTab==="today") renderToday();
      if(currentTab==="reports") renderReports();
    } else {
      Overrides = prevOverrides;
      saveBtn.disabled=false;
      saveBtn.textContent="Save override";
    }
  };
};
async function handleWeeklyDayToggle(day){
  const sel=$("calClassSelect");
  const selectedTarget = sel ? sel.value : "";
  if(!selectedTarget){
    Settings.workingDays[day]=!Settings.workingDays[day];
    Settings.workingDays[String(day)]=Settings.workingDays[day];
    if(await persistCalendar()){ renderWeekly(); renderCalendarMonth(); renderToday(); renderReports(); }
    return;
  }

  if(selectedTarget.startsWith("batch:")){
    const batchName = selectedTarget.slice(6);
    let entry = BatchSchedules[batchName];
    let wd;
    if(entry && typeof entry==="object" && entry.workingDays) wd={...entry.workingDays};
    else if(entry && typeof entry==="object" && !entry.startTime) wd={...entry};
    else wd={...Settings.workingDays};
    wd[day]=!wd[day];
    wd[String(day)]=wd[day];
    BatchSchedules[batchName] = {
      workingDays: wd,
      startTime: (entry && entry.startTime) || "",
      endTime: (entry && entry.endTime) || ""
    };
    if(await persistCalendar()){ renderWeekly(); renderCalendarMonth(); renderToday(); renderReports(); }
    return;
  }

  const className = selectedTarget.startsWith("class:") ? selectedTarget.slice(6) : selectedTarget;
  let entry = ClassSchedules[className];
  let wd;
  if(entry && typeof entry==="object" && entry.workingDays) wd={...entry.workingDays};
  else if(entry && typeof entry==="object" && !entry.startTime) wd={...entry};
  else wd={...Settings.workingDays};
  wd[day]=!wd[day];
  wd[String(day)]=wd[day];
  ClassSchedules[className] = {
    workingDays: wd,
    startTime: (entry && entry.startTime) || "",
    endTime: (entry && entry.endTime) || ""
  };
  ClassSchedulesUI = ClassSchedules;
  if(await persistCalendar()){ renderWeekly(); renderCalendarMonth(); renderToday(); renderReports(); }
}
if($("weeklyScheduleGrid")){
  $("weeklyScheduleGrid").addEventListener("click",(e)=>{
    const toggle=e.target.closest("[data-day]"); if(!toggle) return;
    handleWeeklyDayToggle(String(toggle.dataset.day));
  });
  $("weeklyScheduleGrid").addEventListener("keydown",(e)=>{
    if(e.key==="Enter" || e.key===" "){
      const toggle=e.target.closest("[data-day]"); if(!toggle) return;
      e.preventDefault();
      handleWeeklyDayToggle(String(toggle.dataset.day));
    }
  });
}
if($("weeklyTable")){
  $("weeklyTable").addEventListener("click",(e)=>{
    const toggle=e.target.closest("[data-day]"); if(!toggle) return;
    handleWeeklyDayToggle(String(toggle.dataset.day));
  });
}
if($("calClassSelect")) $("calClassSelect").onchange=()=>{ renderWeekly(); renderCalendarMonth(); if(currentTab==="today") renderToday(); };

// Schedule Timing Save & Clear Handlers
if($("schedSaveTimeBtn")){
  $("schedSaveTimeBtn").onclick = async () => {
    const sel = $("calClassSelect");
    const selectedTarget = sel ? sel.value : "";
    if(!selectedTarget){
      alert("Please select a specific class or batch to configure custom schedule timing.");
      return;
    }
    const start = ($("schedStartTime").value || "").trim();
    const end = ($("schedEndTime").value || "").trim();

    if(selectedTarget.startsWith("batch:")){
      const batchName = selectedTarget.slice(6);
      const entry = BatchSchedules[batchName] || {};
      const wd = (entry && entry.workingDays) ? { ...entry.workingDays } : (entry && typeof entry==="object" && !entry.startTime ? { ...entry } : { ...Settings.workingDays });
      BatchSchedules[batchName] = {
        workingDays: wd,
        startTime: start,
        endTime: end
      };
    } else {
      const className = selectedTarget.startsWith("class:") ? selectedTarget.slice(6) : selectedTarget;
      const entry = ClassSchedules[className] || {};
      const wd = (entry && entry.workingDays) ? { ...entry.workingDays } : (entry && typeof entry==="object" && !entry.startTime ? { ...entry } : { ...Settings.workingDays });
      ClassSchedules[className] = {
        workingDays: wd,
        startTime: start,
        endTime: end
      };
      ClassSchedulesUI = ClassSchedules;
    }

    if(await persistCalendar()){
      populateScheduleSelector();
      renderWeekly();
    }
  };
}

if($("schedClearTimeBtn")){
  $("schedClearTimeBtn").onclick = async () => {
    const sel = $("calClassSelect");
    const selectedTarget = sel ? sel.value : "";
    if(!selectedTarget) return;

    if(selectedTarget.startsWith("batch:")){
      const batchName = selectedTarget.slice(6);
      const entry = BatchSchedules[batchName] || {};
      const wd = (entry && entry.workingDays) ? { ...entry.workingDays } : (entry && typeof entry==="object" && !entry.startTime ? { ...entry } : { ...Settings.workingDays });
      BatchSchedules[batchName] = {
        workingDays: wd,
        startTime: "",
        endTime: ""
      };
    } else {
      const className = selectedTarget.startsWith("class:") ? selectedTarget.slice(6) : selectedTarget;
      const entry = ClassSchedules[className] || {};
      const wd = (entry && entry.workingDays) ? { ...entry.workingDays } : (entry && typeof entry==="object" && !entry.startTime ? { ...entry } : { ...Settings.workingDays });
      ClassSchedules[className] = {
        workingDays: wd,
        startTime: "",
        endTime: ""
      };
      ClassSchedulesUI = ClassSchedules;
    }

    if(await persistCalendar()){
      populateScheduleSelector();
      renderWeekly();
    }
  };
}

document.addEventListener("click",(e)=>{
  if(!e.target.closest(".custom-select-wrap") && !e.target.closest(".custom-select-menu")){
    closeAllCustomSelects();
  }
});
document.addEventListener("keydown",(e)=>{
  if(e.key==="Escape"){
    closeAllCustomSelects();
  }
});
window.addEventListener("resize",()=>{ closeAllCustomSelects(); });
window.addEventListener("scroll",()=>{ closeAllCustomSelects(); }, true);
$("calResetWeekBtn").onclick=async()=>{
  const sel=$("calClassSelect");
  const selectedTarget = sel ? sel.value : "";
  const standardWd = {0:false,1:true,2:true,3:true,4:true,5:true,6:true};
  if(!selectedTarget){
    Settings.workingDays = standardWd;
    if(await persistCalendar()){ renderWeekly(); renderCalendarMonth(); renderToday(); renderReports(); }
    return;
  }
  if(selectedTarget.startsWith("batch:")){
    const batchName = selectedTarget.slice(6);
    const prev = BatchSchedules[batchName] || {};
    BatchSchedules[batchName] = {
      workingDays: standardWd,
      startTime: prev.startTime || "",
      endTime: prev.endTime || ""
    };
    if(await persistCalendar()){ renderWeekly(); renderCalendarMonth(); renderToday(); renderReports(); }
    return;
  }
  const className = selectedTarget.startsWith("class:") ? selectedTarget.slice(6) : selectedTarget;
  const prev = ClassSchedules[className] || {};
  ClassSchedules[className] = {
    workingDays: standardWd,
    startTime: prev.startTime || "",
    endTime: prev.endTime || ""
  };
  ClassSchedulesUI = ClassSchedules;
  if(await persistCalendar()){ renderWeekly(); renderCalendarMonth(); renderToday(); renderReports(); }
};

function handleHolidayItemClick(e){
  const edit=e.target.closest("[data-edit-holiday]");
  if(edit){
    const origStart=edit.dataset.editHoliday;
    const h=Holidays.find(x=>x.start===origStart); if(!h) return;
    if($("holidayModalTitle")) $("holidayModalTitle").textContent="Edit holiday";
    $("holidayModalBody").innerHTML=`<div class="form-grid">
      <div class="form-field full"><label>Holiday / Event Name *</label><input id="holidayName" value="${esc(h.name)}"></div>
      <div class="form-field"><label>Start date *</label><input type="date" id="holidayStart" value="${esc(h.start)}"></div>
      <div class="form-field"><label>End date *</label><input type="date" id="holidayEnd" value="${esc(h.end)}"></div>
      <div class="form-field full"><label>Type</label><select id="holidayType"><option value="holiday" ${h.type==="holiday"?"selected":""}>Holiday (Non-working, not marked absent)</option><option value="vacation" ${h.type==="vacation"?"selected":""}>Vacation (Multi-day school closed)</option><option value="exam" ${h.type==="exam"?"selected":""}>Exam day (Working day)</option></select></div>
      <div class="form-field full" id="holidayErrWrap" style="display:none"><div class="inline-error" id="holidayErr"></div></div>
      <div class="form-field full form-actions" style="margin-top:4px">
        <button class="btn" id="holidayCancel">Cancel</button>
        <button class="btn primary" id="holidaySave">Save changes</button>
      </div>
    </div>`;
    openModal(holidayModal);
    enhanceAllSelects(holidayModal);
    const startEl=$("holidayStart"), endEl=$("holidayEnd"), nameEl=$("holidayName"), errWrap=$("holidayErrWrap"), errEl=$("holidayErr");
    startEl.oninput=()=>{ if(errWrap) errWrap.style.display="none"; };
    endEl.oninput=()=>{ if(errWrap) errWrap.style.display="none"; };
    nameEl.oninput=()=>{ if(errWrap) errWrap.style.display="none"; };
    $("holidayCancel").onclick=()=>closeModal(holidayModal);
    $("holidaySave").onclick=async()=>{
      const name=nameEl.value.trim(), start=startEl.value, end=endEl.value||start;
      if(!name){ errEl.textContent="Please enter a holiday name."; errWrap.style.display="block"; return; }
      if(!start){ errEl.textContent="Please select a start date."; errWrap.style.display="block"; return; }
      if(end < start){ errEl.textContent="End date cannot be earlier than start date."; errWrap.style.display="block"; return; }
      errWrap.style.display="none";
      const saveBtn=$("holidaySave"); saveBtn.disabled=true; saveBtn.textContent="Saving…";
      const prevHolidays=Holidays.slice();
      const updated=Holidays.filter(x=>x.start!==origStart);
      updated.push({name,start,end,category:"",type:$("holidayType").value});
      Holidays=updated;
      if(await persistCalendar()){
        closeModal(holidayModal);
        renderHolidays();
        renderCalendarMonth();
        if(currentTab==="today") renderToday();
        if(currentTab==="reports") renderReports();
      } else {
        Holidays=prevHolidays;
        saveBtn.disabled=false;
        saveBtn.textContent="Save changes";
      }
    };
    return;
  }
  const btn=e.target.closest("[data-del-holiday]"); if(!btn) return;
  const delStart=btn.dataset.delHoliday;
  const prevHolidays=Holidays.slice();
  Holidays=Holidays.filter(h=>h.start!==delStart);
  persistCalendar().then(ok=>{
    if(ok){
      renderHolidays();
      renderCalendarMonth();
      if(currentTab==="today") renderToday();
      if(currentTab==="reports") renderReports();
    } else {
      Holidays=prevHolidays;
      renderHolidays();
    }
  });
}

function handleOverrideItemClick(e){
  const edit=e.target.closest("[data-edit-override]");
  if(edit){
    const origDate=edit.dataset.editOverride;
    const o=Overrides.find(x=>x.date===origDate); if(!o) return;
    if($("overrideModalTitle")) $("overrideModalTitle").textContent="Edit special date override";
    $("overrideModalBody").innerHTML=`<div class="form-grid">
      <div class="form-field"><label>Date *</label><input type="date" id="overrideDate" value="${esc(o.date)}"></div>
      <div class="form-field"><label>Becomes</label><select id="overrideWorking"><option value="1" ${o.isWorking?"selected":""}>Working day</option><option value="0" ${!o.isWorking?"selected":""}>Holiday / Non-working</option></select></div>
      <div class="form-field full"><label>Note / Reason *</label><input id="overrideNote" value="${esc(o.note)}"></div>
      <div class="form-field full" id="overrideErrWrap" style="display:none"><div class="inline-error" id="overrideErr"></div></div>
      <div class="form-field full form-actions" style="margin-top:4px">
        <button class="btn" id="overrideCancel">Cancel</button>
        <button class="btn primary" id="overrideSave">Save changes</button>
      </div>
    </div>`;
    openModal(overrideModal);
    enhanceAllSelects(overrideModal);
    const dateEl=$("overrideDate"), noteEl=$("overrideNote"), errWrap=$("overrideErrWrap"), errEl=$("overrideErr");
    dateEl.oninput=()=>{ if(errWrap) errWrap.style.display="none"; };
    noteEl.oninput=()=>{ if(errWrap) errWrap.style.display="none"; };
    $("overrideCancel").onclick=()=>closeModal(overrideModal);
    $("overrideSave").onclick=async()=>{
      const date=dateEl.value, note=noteEl.value.trim();
      if(!date){ errEl.textContent="Please choose a date."; errWrap.style.display="block"; return; }
      if(!note){ errEl.textContent="Please enter a note / reason for this override."; errWrap.style.display="block"; return; }
      errWrap.style.display="none";
      const saveBtn=$("overrideSave"); saveBtn.disabled=true; saveBtn.textContent="Saving…";
      const prevOverrides=Overrides.slice();
      const updated=Overrides.filter(x=>x.date!==origDate && x.date!==date);
      updated.push({date,isWorking:$("overrideWorking").value==="1",note});
      Overrides=updated;
      if(await persistCalendar()){
        closeModal(overrideModal);
        renderOverrides();
        renderCalendarMonth();
        if(currentTab==="today") renderToday();
        if(currentTab==="reports") renderReports();
      } else {
        Overrides=prevOverrides;
        saveBtn.disabled=false;
        saveBtn.textContent="Save changes";
      }
    };
    return;
  }
  const btn=e.target.closest("[data-del-override]"); if(!btn) return;
  const delDate=btn.dataset.delOverride;
  const prevOverrides=Overrides.slice();
  Overrides=Overrides.filter(o=>o.date!==delDate);
  persistCalendar().then(ok=>{
    if(ok){
      renderOverrides();
      renderCalendarMonth();
      if(currentTab==="today") renderToday();
      if(currentTab==="reports") renderReports();
    } else {
      Overrides=prevOverrides;
      renderOverrides();
    }
  });
}

if($("holidayList")) $("holidayList").addEventListener("click", handleHolidayItemClick);
if($("holidayBody")) $("holidayBody").addEventListener("click", handleHolidayItemClick);
if($("overrideList")) $("overrideList").addEventListener("click", handleOverrideItemClick);
if($("overrideBody")) $("overrideBody").addEventListener("click", handleOverrideItemClick);
if($("classBody")){
  $("classBody").addEventListener("click", (e)=>{
    const btn = e.target.closest("[data-del-class]");
    if(!btn) return;
    const cls = btn.dataset.delClass;
    if(cls) deleteClass(cls);
  });
}
$("addClassBtn").onclick=async()=>{
  const input=$("newClassName"), name=input.value.trim();
  if(!name) return;
  if(Classes.some(c=>c.toLowerCase()===name.toLowerCase())){ alert("That class already exists."); return; }
  try{ await api("/api/classes",{method:"POST",body:JSON.stringify({name})}); input.value=""; await loadClassesHolidaysSettings(); renderAll(); }
  catch(e){ alert("Failed to add class: "+e.message); }
};
$("settingsSaveBtn").onclick=async()=>{
  try{
    const start=$("setAttendanceStart")?$("setAttendanceStart").value:"";
    const presentVal = $("setPresentCutoff") ? $("setPresentCutoff").value : (Settings.presentCutoff || "08:00");
    const lateVal = $("setLateCutoff") ? $("setLateCutoff").value : ($("setLateThreshold") ? $("setLateThreshold").value : (Settings.lateCutoff || "08:30"));
    await api("/api/settings",{method:"POST",body:JSON.stringify({
      schoolName:$("setSchoolName").value.trim(),
      address:$("setSchoolAddress").value.trim(),
      presentCutoff: presentVal || "08:00",
      lateCutoff: lateVal || "08:30",
      academicYear:$("setAcademicYear").value,
      attendanceStartDate: start || undefined,
      schoolOpeningDate: start || undefined
    })});
    alert("Settings saved to database.");
    await loadClassesHolidaysSettings(); renderAll();
  }catch(e){ alert("Failed: "+e.message); }
};
$("settingsExportBtn").onclick=()=>{
  const presentVal = $("setPresentCutoff") ? $("setPresentCutoff").value : (Settings.presentCutoff || "08:00");
  const lateVal = $("setLateCutoff") ? $("setLateCutoff").value : ($("setLateThreshold") ? $("setLateThreshold").value : (Settings.lateCutoff || "08:30"));
  exportCSV([
    ["Field","Value"],
    ["School name",$("setSchoolName").value],
    ["Address",$("setSchoolAddress").value],
    ["Present cutoff",presentVal],
    ["Late cutoff",lateVal],
    ["Academic year",$("setAcademicYear").value],
    ["Attendance start date",$("setAttendanceStart")?$("setAttendanceStart").value:""]
  ],"school-settings.csv");
};
$("backupDownloadBtn").onclick=()=>{
  fetch("/api/backup",{cache:"no-store"}).then(r=>{ if(!r.ok) throw 0; return r.blob(); }).then(b=>{
    const url=URL.createObjectURL(b), a=document.createElement('a'); a.href=url; a.download="atl-backup-"+todayISO()+".db"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1500);
  }).catch(()=>alert("Backup failed"));
};
$("backupFileInput").onchange=async(e)=>{
  const file=e.target.files&&e.target.files[0]; if(!file) return;
  const status=$("backupStatus"); status.textContent="Restoring…";
  try{
    const form=new FormData(); form.append("file",file);
    const r=await fetch("/api/restore",{method:"POST",body:form,cache:"no-store"});
    const body=await r.json(); if(!r.ok) throw new Error(body.error||("HTTP "+r.status));
    status.textContent="Restore complete. Reloading data…"; await loadAll();
  }catch(err){ status.textContent="Restore failed: "+err.message; }
  e.target.value="";
};
if($("auditExportBtn")) $("auditExportBtn").onclick=()=>{
  const rows=[["Time","Action","Details","By"]].concat(Audit.map(a=>[a.time,a.action,a.details,a.by||"Admin"]));
  exportCSV(rows,"audit_"+todayISO()+".csv");
};
$("auditClearBtn").onclick=()=>alert("Clear audit is managed on the backend.");
if($("calSaveBtn")) $("calSaveBtn").onclick=async()=>{
  try{
    const el=(id)=>$(id);
    await api("/api/settings",{method:"POST",body:JSON.stringify({
      schoolName:el("calSchoolName")?el("calSchoolName").value.trim():Settings.schoolName,
      academicYear:el("calAcademicYear")?el("calAcademicYear").value:Settings.academicYear,
      schoolOpeningDate:el("calStart")?el("calStart").value:Settings.startDate,
      attendanceStartDate:el("calStart")?el("calStart").value:Settings.startDate,
      lateCutoff:el("calLateAfter")?(el("calLateAfter").value||"08:30"):Settings.lateAfter
    })});
    await loadClassesHolidaysSettings(); renderAll(); alert("Saved.");
  }catch(e){ alert("Failed: "+e.message); }
};
detailScroll.addEventListener("click",(e)=>{
  const toggleEl = e.target.closest('[data-action="toggle-status"]');
  if(toggleEl){
    const id = parseInt(toggleEl.dataset.id||selectedStudentId);
    if(id) toggleStudentStatus(id);
    return;
  }
  const btn=e.target.closest("button"); if(!btn) return;
  const action=btn.dataset.action, id=parseInt(btn.dataset.id||selectedStudentId);
  if(action==="edit") openEditStudent(id);
  else if(action==="reenroll") openReEnroll(id);
  else if(action==="delete") deleteStudent(id);
  else if(action==="delete-permanent") deletePermanentStudent(id);
  else if(action==="reactivate") reactivateStudent(id);
  else if(action==="toggle-status") toggleStudentStatus(id);
  else if(action==="print"){
    printStudentProfileDocument(id);
  }
});
studentListEl.addEventListener("click",(e)=>{ const row=e.target.closest(".student-row"); if(!row) return; const id=parseInt(row.dataset.id); if(id) selectStudent(id); });
searchInput.addEventListener("input",()=>{ Timers.clear("search"); Timers.set("search", setTimeout(renderStudentList,260)); });
classFilter.addEventListener("change",renderStudentList);
if(batchFilter) batchFilter.addEventListener("change",renderStudentList);
if(studentStatusFilter) studentStatusFilter.addEventListener("change",renderStudentList);
todayClassFilter.addEventListener("change",renderToday);
todayStatusFilter.addEventListener("change",renderToday);
todaySort.addEventListener("change",renderToday);
reportScope.addEventListener("change",()=>{
  const sc=reportScope.value;
  reportClass.style.display=(sc==="class")?"":"none";
  reportStudent.style.display=sc==="student"?"":"none";
  if(sc==="student") reportStudent.innerHTML='<option value="">Select</option>'+Students.filter(s=>s.active).map(s=>`<option value="${s.id}">${esc(s.name)} — ${esc(s.roll)}</option>`).join("");
  enhanceSelect(reportClass);
  enhanceSelect(reportStudent);
  if(reportClass._customWrap) reportClass._customWrap.style.display = (sc==="class")?"":"none";
  if(reportStudent._customWrap) reportStudent._customWrap.style.display = (sc==="student")?"":"none";
});
reportTime.addEventListener("change",()=>{ const show=reportTime.value==="custom"; reportFrom.style.display=show?"":"none"; reportTo.style.display=show?"":"none"; });
todayTableBody.addEventListener("click",(e)=>{
  // if correction badge clicked, handle correction first
  const corr = e.target.closest("[data-correct]");
  if(corr){
    e.stopPropagation();
    const sid=parseInt(corr.dataset.correctSid), date=corr.dataset.correctDate, old=corr.dataset.correctStatus;
    openCorrection(sid, date, old);
    return;
  }
  const tr=e.target.closest("tr"); if(!tr) return; const sid=parseInt(tr.dataset.student);
  if(sid){ adminNav.querySelector('[data-tab="students"]').click(); setTimeout(()=>selectStudent(sid),120); }
});
// ---- correction (POST /api/correction) ----
function openCorrection(studentId, date, oldStatus){
  const s=Students.find(x=>x.id===studentId);
  if(!s) return;
  const body=$("correctionModalBody");
  if(!body) return;
  body.innerHTML=`
    <div class="form-grid">
      <div class="form-field"><label>Student</label><input value="${esc(s.name)} — ${esc(s.roll)} — ${esc(s.class)}" disabled></div>
      <div class="form-field"><label>Date</label><input value="${esc(date)}" disabled></div>
      <div class="form-field"><label>Current status</label><input value="${esc(oldStatus||"—")}" disabled></div>
      <div class="form-field"><label>New status *</label><select id="corrStatus"><option value="PRESENT">Present</option><option value="LATE">Late</option><option value="ABSENT">Absent</option><option value="NOT_SCHEDULED">Not Scheduled</option></select></div>
      <div class="form-field full"><label>Reason * (3-300 chars)</label><textarea id="corrReason" placeholder="e.g., Late arrival verified, fingerprint misread"></textarea></div>
      <div class="form-field full" id="corrErrWrap" style="display:none"><div class="inline-error" id="corrErr"></div></div>
      <div class="form-field full form-actions" style="margin-top:4px">
        <button class="btn" id="corrCancel">Cancel</button>
        <button class="btn primary" id="corrSave">Save correction</button>
      </div>
    </div>`;
  // preselect oldStatus if matches
  try{ const sel=$("corrStatus"); if(sel && oldStatus) { const up=String(oldStatus).toUpperCase(); for(let o of sel.options){ if(o.value===up) sel.value=o.value; } } }catch(e){}
  openModal(correctionModal);
  enhanceAllSelects(correctionModal);
  const errWrap=$("corrErrWrap"), err=$("corrErr"), reasonEl=$("corrReason");
  reasonEl.oninput=()=>{ if(errWrap) errWrap.style.display="none"; };
  $("corrCancel").onclick=()=>closeModal(correctionModal);
  $("corrSave").onclick=async()=>{
    const newStatus=$("corrStatus").value, reason=reasonEl.value.trim();
    if(!newStatus || !reason || reason.length<3 || reason.length>300){
      err.textContent="Status and reason (3-300 chars) required.";
      errWrap.style.display="block";
      return;
    }
    errWrap.style.display="none";
    const btn=$("corrSave"); const prev=btn.textContent; btn.textContent="Saving…"; btn.disabled=true;
    try{
      await api("/api/correction",{method:"POST",body:JSON.stringify({date, studentId, status:newStatus, reason})});
      closeModal(correctionModal);
      // reload authoritative data
      await loadTodayAttendance();
      await loadHistory();
      // reload student detail daily for single student
      try{
        const det=await api("/api/students/"+studentId,{method:"GET"});
        if(det && det.daily){ /* update Daily cache for that student if needed */ }
      }catch(e){}
      renderAll();
      if(selectedStudentId) renderStudentDetail(selectedStudentId);
      alert("Correction saved. Audit preserved.");
    }catch(ex){
      err.textContent=ex.message||"Failed to save correction"; errWrap.style.display="block";
    }finally{ btn.textContent=prev; btn.disabled=false; }
  };
}
// allow correction from student history (detailScroll)
detailScroll.addEventListener("click",(e)=>{
  const c=e.target.closest("[data-correct]");
  if(!c) return;
  e.stopPropagation();
  openCorrection(parseInt(c.dataset.correctSid), c.dataset.correctDate, c.dataset.correctStatus);
});
// ---- Interactive scan trigger for kiosk preview & testing ----
let _simScanIdx = 0;
async function triggerSimulatedScan(){
  if(_resultHold) return;
  if(adminLayer && adminLayer.classList.contains("open")) return;
  if(enrollModal && enrollModal.classList.contains("open")) return;
  if(!Students.length) await loadStudents();
  const activeStudents = Students.filter(s=>s.active);
  if(!activeStudents.length) return;
  const s = activeStudents[_simScanIdx % activeStudents.length];
  _simScanIdx++;
  const fid = (s.fid!=null && s.fid!=="") ? s.fid : ("F-"+s.id);
  const now = new Date();
  const time = now.toTimeString().slice(0, 8);
  const date = todayISO();
  window.handleRealScan(fid, { status: "Present", time, date, student: s });
}

if(scannerStageEl){
  scannerStageEl.addEventListener("click", (e)=>{
    if(!_resultHold) triggerSimulatedScan();
  });
}
if(promptText){
  promptText.addEventListener("click", (e)=>{
    if(!_resultHold) triggerSimulatedScan();
  });
}

document.addEventListener("keydown",(e)=>{
  if(e.key==="Escape"){
    if(enrollModal && enrollModal.classList.contains("open")){
      finishEnrollUi();
      if(adminLayer && adminLayer.classList.contains("open")) return;
      resumeSensorScan();
    }
    else if(holidayModal && holidayModal.classList.contains("open")) closeModal(holidayModal);
    else if(overrideModal && overrideModal.classList.contains("open")) closeModal(overrideModal);
    else if(correctionModal && correctionModal.classList.contains("open")) closeModal(correctionModal);
    else if(adminLayer && adminLayer.classList.contains("open")){
      finishEnrollUi();
      adminLayer.classList.remove("open");
      resumeSensorScan();
    }
  } else if((e.key===" " || e.key==="Enter") && document.activeElement && document.activeElement.tagName!=="INPUT" && document.activeElement.tagName!=="TEXTAREA" && document.activeElement.tagName!=="SELECT"){
    if(!_resultHold && (!adminLayer || !adminLayer.classList.contains("open")) && (!enrollModal || !enrollModal.classList.contains("open"))){
      e.preventDefault();
      triggerSimulatedScan();
    }
  }
});
// ---- init ----
cacheLoad();
renderAll();
setState("ready");
loadAll().then(()=>{ setTimeout(sensorScanLoop,300); });
setInterval(()=>{
  if(typeof document!=="undefined" && document.hidden) return;
  loadTodayAttendance().then(()=>{ if(currentTab==="today") renderToday(); });
}, 15000);
// alias used by the injected backend bridge
function saveStorage(){ return cacheSave(); }
