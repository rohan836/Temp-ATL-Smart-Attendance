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
let Unknowns = [];      // {date, time, finger, note}
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
let sdMonth = null;     // student-detail timeline month (Date, first of month)
let sdStatus = "";      // student-detail records status filter
let sdNewest = true;    // student-detail records time order
let sdMode = "month";   // "month" or "range" — last date-control action wins
let sdDatePreset = "current"; // compact dropdown truth
let sdCustomFrom = ""; // custom range start (YYYY-MM-DD)
let sdCustomTo = "";   // custom range end (YYYY-MM-DD)
let sdStudentSort = "name"; // student-list sort preset
let ClassSchedules = {}; // backend-persisted per-class weekly {class: {workingDays:{0..6}} or {0..6}}
let BatchSchedules = {}; // backend-persisted per-batch { "Grade|Batch": workingDays }
let Daily = [];         // from /api/daily
let Kpis = null;        // from /api/kpis
// backward compat alias for older cache key
let ClassSchedulesUI = ClassSchedules;
let _enrollPoll = null; let _enrollAbort = false; let _enrollCtrl = null;
// Month tables live at the top: boot-path formatters (holidays, overrides,
// corrections) run before later sections finish evaluating.
const MONTHS_S=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_L=["January","February","March","April","May","June","July","August","September","October","November","December"];

// ---- helpers ----
function $(id){ return document.getElementById(id); }
function esc(s){ if(s==null) return ""; return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function todayISO(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,'0')+"-"+String(d.getDate()).padStart(2,'0'); }
function toLocalISO(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,'0')+"-"+String(d.getDate()).padStart(2,'0'); }
function parseISO(s){ return new Date(s+"T00:00:00"); }
function fmtDate(d){ if(!d) return ""; const dt=parseISO(d); return dt.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }
function inRange(d,a,b){ return d>=a && d<=b; }
/* Hold-to-repeat (user order): a single tap steps once, holding past
   HOLD_START_MS repeats on an interval that eases toward HOLD_FLOOR_MS so
   long runs are quick but still land on exact values. Pointer events cover
   mouse, touch and pen in one path, and setPointerCapture keeps the stream
   on the button even if the finger drifts off it. fn(isRepeat) gets true
   from the first repeat tick onward, so a caller can skip work that only
   belongs to the initial tap. */
const HOLD_START_MS=400, HOLD_FAST_MS=170, HOLD_FLOOR_MS=55;
/* One shared window-blur hook: these buttons are rebuilt often (each month
   grid redraw makes new ones), so a per-element blur listener would leak. */
const _holdStops=new Set();
let _holdBlurBound=false;
function holdRepeat(el, fn){
  if(!el) return;
  let timer=null, delay=HOLD_FAST_MS, ranRepeat=false;
  const stop=()=>{ if(timer){ clearTimeout(timer); timer=null; } };
  _holdStops.add(stop);
  if(!_holdBlurBound){ _holdBlurBound=true; window.addEventListener("blur",()=>{ _holdStops.forEach(f=>{ try{ f(); }catch(e){} }); }); }
  const fire=(rep)=>{ ranRepeat=ranRepeat||rep; try{ fn(rep); }catch(e){} };
  const tick=()=>{
    fire(true);
    /* Ease toward the floor so long runs stay quick, then hold steady.
       setTimeout (not setInterval) so the interval can actually change. */
    delay=Math.max(HOLD_FLOOR_MS,Math.round(delay*0.85));
    timer=setTimeout(tick,delay);
  };
  el.addEventListener("pointerdown",(e)=>{
    if(e.button!==undefined && e.button!==0) return;
    stop();
    ranRepeat=false;
    fire(false);                       /* the tap itself: exactly one step */
    timer=setTimeout(tick,HOLD_START_MS);
    try{ el.setPointerCapture(e.pointerId); }catch(_){}
    e.preventDefault();
  });
  ["pointerup","pointercancel","pointerleave","lostpointercapture"].forEach(ev=>
    el.addEventListener(ev,stop));
  el.addEventListener("contextmenu",e=>e.preventDefault());
  /* The browser still synthesises a click after a hold. Swallow it so one
     press is never counted twice by any onclick still bound elsewhere. */
  el.addEventListener("click",(e)=>{
    if(ranRepeat){ e.stopPropagation(); e.preventDefault(); ranRepeat=false; }
  },true);
}
/* Delegated hold-to-repeat (user order): the same tap-steps-once /
   hold-runs-with-easing behavior as holdRepeat, but the listener lives on
   a stable ancestor and the target is resolved per event — so it survives
   innerHTML rebuilds of the buttons themselves. Built for the
   student-detail month arrows, which renderStudentDetail recreates on
   every step (a direct holdRepeat would lose its pointer capture with the
   discarded node after the first tick). The single tap is left to the
   existing click handler; only repeat ticks fire here, and the trailing
   click after a hold is swallowed. Deliberately no pointer capture: the
   repeat timer is setTimeout-driven and cannot break, while capturing on
   the container would retarget the trailing click onto it. Window-level
   release hooks stop a run even if the pointer leaves the panel mid-hold. */
function holdRepeatDelegate(container, match, fn, opts){
  if(!container||typeof match!=="function"||typeof fn!=="function") return;
  opts=opts||{};
  const startMs=opts.startMs||HOLD_START_MS, fastMs=opts.fastMs||HOLD_FAST_MS, floorMs=opts.floorMs||HOLD_FLOOR_MS;
  let timer=null, delay=fastMs, cur=null, ranRepeat=false, lastFire=0;
  const stop=()=>{ if(timer){ clearTimeout(timer); timer=null; } };
  _holdStops.add(stop);
  const fire=()=>{ ranRepeat=true; lastFire=Date.now(); try{ fn(cur); }catch(e){} };
  const tick=()=>{
    fire();
    /* Ease toward the floor so long runs stay quick, then hold steady. */
    delay=Math.max(floorMs,Math.round(delay*0.85));
    timer=setTimeout(tick,delay);
  };
  container.addEventListener("pointerdown",(e)=>{
    if(e.button!==undefined && e.button!==0) return;
    let t=null;
    try{ t=match(e); }catch(_){ t=null; }
    if(!t) return;
    stop();
    cur=t; ranRepeat=false; delay=fastMs;
    timer=setTimeout(tick,startMs);
  });
  ["pointerup","pointercancel","pointerleave"].forEach(ev=>
    container.addEventListener(ev,stop));
  /* No setPointerCapture here: capturing on the container would retarget
     the trailing click onto it, so single taps would land on the container
     (dead taps) and the suppressor below could never match the button. */
  window.addEventListener("pointerup",stop);
  window.addEventListener("pointercancel",stop);
  container.addEventListener("contextmenu",(e)=>{
    let t=null;
    try{ t=match(e); }catch(_){ t=null; }
    if(t) e.preventDefault();
  });
  /* Swallow only the trailing click of a real hold (keyboard Enter fires
     click with no pointerdown, so the time window keeps it working). */
  container.addEventListener("click",(e)=>{
    if(!ranRepeat||Date.now()-lastFire>750) return;
    let t=null;
    try{ t=match(e); }catch(_){ t=null; }
    if(t){ e.stopPropagation(); e.preventDefault(); ranRepeat=false; }
  },true);
}
async function api(path, opts){
  opts = opts || {};
  // Don't set JSON content-type for FormData (browser sets multipart boundary)
  const isFormData = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  if(!isFormData && !opts.headers?.["Content-Type"]){
    opts.headers = Object.assign({"Content-Type":"application/json"}, opts.headers||{});
  } else {
    opts.headers = Object.assign({}, opts.headers||{});
  }
  try{
    const pin = sessionStorage.getItem("atl_admin_pin") || "";
    if(pin) opts.headers["X-Admin-Pin"] = pin;
  }catch(e){}
  opts.cache = "no-store";
  let r = await fetch(path, opts);
  // blob response for backup/download
  if(opts.responseType === 'blob'){
    if(!r.ok && r.status===401 && !opts._pinRetry && !opts._noPrompt){
      let body = null;
      try{ body = await r.clone().json(); }catch(e){}
      const msg = (body&&(body.error||""))||"";
      if(msg.toLowerCase().includes("admin pin")){
        let pin = null;
        try{ pin = prompt("Admin PIN required"); }catch(e){}
        if(pin){
          try{ sessionStorage.setItem("atl_admin_pin", pin); }catch(e){}
          opts.headers = Object.assign({}, opts.headers, {"X-Admin-Pin": pin});
          opts._pinRetry = true;
          r = await fetch(path, opts);
          if(r.ok) return r.blob();
          try{ body = await r.json(); }catch(e){ body=null; }
          if(r.ok) return r.blob();
          const err = new Error((body&&(body.error||body.detail||body.reason))||("HTTP "+r.status)); err.status=r.status; err.body=body; throw err;
        }
      }
    }
    if(!r.ok){
      let body = null;
      try{ body = await r.json(); }catch(e){}
      const err = new Error((body&&(body.error||body.detail||body.reason))||("HTTP "+r.status)); err.status=r.status; err.body=body; throw err;
    }
    return r.blob();
  }
  let body = null;
  try{ body = await r.json(); }catch(e){}
  if(!r.ok && r.status===401 && !opts._pinRetry && !opts._noPrompt){
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
  const m=/@([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)/.exec(String(s||""));
  const startTime=m?m[1]+":"+m[2]:"", endTime=m?m[3]+":"+m[4]:"";
  const core=m?String(s).slice(0,m.index)+String(s).slice(m.index+m[0].length):String(s||"");
  const parts = core.split(":"); const date = (parts[0] || "").split("@")[0].trim();
  const working = (parts[1] === "1");
  const note = parts.slice(2).join(":") || "";
  return {date, isWorking: working, note, startTime, endTime};
}
/* Intra-day hours (user order): optional @HH:MM-HH:MM records on
   holidays/overrides — stored, displayed, editable; resolution
   stays day-granular. Empty = all-day (today's behavior). */
function fmtTimes(r){ return (r&&(r.startTime||r.endTime))?(" · "+(r.startTime||"00:00")+"-"+(r.endTime||"23:59")):""; }
function isHHMM(v){ return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v||"")); }
function normTimes(st,en){ st=String(st||""); en=String(en||""); if(!st&&!en) return ["",""]; return [st||"00:00",en||"23:59"]; }
function mapHolidayFromList(s){
  if(s && typeof s === "object"){
    const start=String(s.start||s.date||"").slice(0,10), end=String(s.end||start).slice(0,10);
    return {name:String(s.name||"Holiday"), start, end, startTime:String(s.startTime||s.start_time||""), endTime:String(s.endTime||s.end_time||""), category:String(s.category||""), type:String(s.type||"holiday")};
  }
  s=String(s||"");
  const tm=/@([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)/.exec(s);
  const startTime=tm?tm[1]+":"+tm[2]:"", endTime=tm?tm[3]+":"+tm[4]:"";
  if(tm) s=s.slice(0,tm.index)+s.slice(tm.index+tm[0].length);
  const i=s.indexOf(":"), head=i>=0?s.slice(0,i):s, span=head.split(".."), start=span[0].slice(0,10), end=(span[1]||span[0]).slice(0,10);
  const rest=i>=0?s.slice(i+1):"Holiday", parts=rest.split(":");
  const typed=parts.length>1 && ["holiday","vacation","exam"].includes(parts[0].toLowerCase());
  return {name:typed?parts.slice(1).join(":"):(rest||"Holiday"), start, end, startTime, endTime, category:"", type:typed?parts[0].toLowerCase():"holiday"};
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
    if(st.classSchedules && typeof st.classSchedules==="object") {
      Object.keys(st.classSchedules).forEach(k => {
        ClassSchedules[k] = Object.assign({}, ClassSchedules[k] || {}, st.classSchedules[k]);
      });
      ClassSchedulesUI = ClassSchedules;
    }
    if(st.batchSchedules && typeof st.batchSchedules==="object") {
      Object.keys(st.batchSchedules).forEach(k => {
        BatchSchedules[k] = Object.assign({}, BatchSchedules[k] || {}, st.batchSchedules[k]);
      });
    }
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
    set("setLateThreshold", Settings.lateAfter);
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
    // background reconcile must not prompt — use _noPrompt so public idle does not spam PIN
    if(!(typeof document!=="undefined" && document.hidden)){
      try{ await api("/api/reconcile",{method:"POST",body:JSON.stringify({date:t}), _noPrompt:true}); }catch(e){}
    }
    const ev = await api("/api/attendance?date="+t, {method:"GET"});
    if(Array.isArray(ev)){
      Attendance = ev.map(mapEvent).filter(a=>a.studentId||a.status==="Unknown");
      Unknowns = ev.filter(e=>(e.result==="UNKNOWN"||e.status==="UNKNOWN")).map(e=>({date:t, time:e.time, finger:(e.fingerId!=null?"F-"+e.fingerId:"-"), note:"Unknown fingerprint"}));
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
  ensureFirstStudent();
  renderAll();
}
/* First student is always selected — never an empty detail pane */
function ensureFirstStudent(){
  if(!Students.length){ selectedStudentId=null; return; }
  if(!Students.some(s=>s.id===selectedStudentId)){
    const sorted=[...Students].sort((a,b)=>((b.active-a.active)||String(a.name).localeCompare(String(b.name))));
    selectedStudentId=sorted[0].id;
  }
  try{ renderStudentDetail(selectedStudentId); }catch(e){}
}
// ---- DOM ----
const promptText=$("promptText"),
  idleLayer=$("idleLayer"),
  identityLayer=$("identityLayer"), unknownLayer=$("unknownLayer"),
  photoImg=$("photoImg"), photoFallback=$("photoFallback"),
  idName=$("idName"), idStatus=$("idStatus"), idTime=$("idTime"),
  idDate=$("idDate"), idConfirm=$("idConfirm"), idConfirmTxt=$("idConfirm"),
  idRoll=$("idRoll"), idClass=$("idClass"), idGroup=$("idGroup"), idSid=$("idSid"),
  unknownTitleEl=$("unknownTitle"),
  adminLayer=$("adminLayer"), adminNav=$("adminNav"), adminTitle=$("adminTitle"),
  studentListEl=$("studentList"), searchInput=$("searchInput"), classFilter=$("classFilter"), batchFilter=$("batchFilter"), studentStatusFilter=$("studentStatusFilter"),
  detailScroll=$("detailScroll"),
  attDatePreset=$("attDatePreset"), attSingleDate=$("attSingleDate"),
  attFromDate=$("attFromDate"), attToDate=$("attToDate"),
  attClassFilter=$("attClassFilter"), attBatchFilter=$("attBatchFilter"), attStudentFilter=$("attStudentFilter"),
  attStatusFilter=$("attStatusFilter"), attSort=$("attSort"),
  attRefreshBtn=$("attRefreshBtn"), attPrintBtn=$("attPrintBtn"), attExportBtn=$("attExportBtn"),
  attModeBadge=$("attModeBadge"), attStats=$("attStats"),
  attTableHead=$("attTableHead"), attTableBody=$("attTableBody"),
  attUnknownCount=$("attUnknownCount"), attUnknownBody=$("attUnknownBody"),
  holidayBody=$("holidayBody"), overrideBody=$("overrideBody"),
  calendarGrid=$("calendarGrid"), calendarHeadGrid=$("calendarHeadGrid"), calMonthLabel=$("calMonthLabel"),
  classCubes=$("classCubes"), auditBody=$("auditBody"),
  enrollModal=$("enrollModal"), holidayModal=$("holidayModal"),
  overrideModal=$("overrideModal"), holidayViewModal=$("holidayViewModal"),
  overrideViewModal=$("overrideViewModal"), correctionModal=$("correctionModal"),
  daySheetModal=$("daySheetModal"), daySheetTitle=$("daySheetTitle"), daySheetBody=$("daySheetBody"),
  schoolInfoModal=$("schoolInfoModal"),
  schedModal=$("schedModal"), schedModalTitle=$("schedModalTitle"),
  schedModalSub=$("schedModalSub"), schedModalBody=$("schedModalBody"),
  enrollTitle=$("enrollTitle"), enrollSub=$("enrollSub"), enrollBody=$("enrollBody");

const Timers={ _ids:{}, set(n,id){ this.clear(n); this._ids[n]=id; },
  clear(n){ if(this._ids[n]){ clearTimeout(this._ids[n]); clearInterval(this._ids[n]); } delete this._ids[n]; },
  clearAll(){ Object.keys(this._ids).forEach(k=>{ clearTimeout(this._ids[k]); clearInterval(this._ids[k]); }); this._ids={}; } };
let currentTab="students", selectedStudentId=null, calendarMonth=new Date();
/* Refresh persistence (testing convenience): remember the last admin
   tab; after the normal PIN unlock the admin reopens there instead of
   the default. The PIN gate itself is untouched. */
try{ const _t=localStorage.getItem("atl_admin_tab"); const _t2=_t==="setup2"?"setup":_t; if(["students","attendance","setup","backup","today","reports","calendar","settings"].indexOf(_t2)>=0) currentTab=_t2; }catch(e){}
/* Academic-year override span (null = follow Settings); set by the year popup */
let attAcadFrom=null, attAcadTo=null;

/* Body fade is conditional: no mask when content fits; top fade only when
   scrolled off the top edge, bottom fade only when more sits below. */
function paintModalFade(body){
  if(!body||!body.scrollHeight) return;
  const max=body.scrollHeight-body.clientHeight;
  const over=max>4, st=body.scrollTop;
  let mask="none";
  if(over&&st>4&&st<max-4) mask="linear-gradient(transparent,#000 16px,#000 calc(100% - 16px),transparent)";
  else if(over&&st>=max-4) mask="linear-gradient(transparent,#000 16px,#000 100%)";
  else if(over) mask="linear-gradient(#000 calc(100% - 16px),transparent)";
  body.style.webkitMaskImage=mask; body.style.maskImage=mask;
}
function wireModalFade(body){
  if(!body||body._fadeWired) return; body._fadeWired=true;
  body.addEventListener("scroll",()=>paintModalFade(body),{passive:true});
}
/* Bottom fade for scroll containers (no native scrollbars anywhere):
   16px fade while there is more below, none when the content fits.
   GATED ON REAL SCROLLABILITY, and that gate is load-bearing: a CSS mask is
   painted only inside the element's own border box, so masking a box that does
   NOT scroll hides everything that overflows it. Backup was masked here while
   it no longer scrolled — its content spilled below the box and the fade
   painted the whole audit history transparent (user report: the history was
   laid out but never visible). Same latent trap on .dt (Students), which is
   overflow:visible. A stale mask is cleared, not just skipped. */
function paintFadeBottom(el){
  if(!el||el.scrollHeight==null) return;
  /* Setup 2 lists must cut cleanly at their bottom edge (user order): no
     gradient is ever written to them. Guarded HERE rather than in
     repaintFades(), because the document scroll listener and the
     MutationObserver below also call this — skipping only the repaint pass
     would re-stamp the mask on the next scroll. A mask already stamped on
     such a list is cleared, not just skipped. */
  if(el.closest&&el.closest("#setupLists")){
    if(el.style.maskImage||el.style.webkitMaskImage){
      el.style.webkitMaskImage=""; el.style.maskImage="";
    }
    return;
  }
  const scrolls=/(auto|scroll)/.test(getComputedStyle(el).overflowY)
    && el.scrollHeight-el.clientHeight>4;
  if(!scrolls){
    if(el.style.maskImage||el.style.webkitMaskImage){
      el.style.webkitMaskImage=""; el.style.maskImage="";
    }
    return;
  }
  const more=el.scrollHeight-el.clientHeight-el.scrollTop>4;
  const mask=more?"linear-gradient(#000 calc(100% - 16px),transparent)":"none";
  el.style.webkitMaskImage=mask; el.style.maskImage=mask;
}
function repaintFades(){
  try{ document.querySelectorAll(".rows,.ros,.dt,.bk,.cmd-pal").forEach(paintFadeBottom); }catch(e){}
}
try{
  document.addEventListener("scroll",(e)=>{
    const t=e.target;
    if(t&&t.nodeType===1&&t.matches&&t.matches(".rows,.ros,.dt,.bk,.cmd-pal")) paintFadeBottom(t);
  },true);
  const _fadeObs=new MutationObserver((muts)=>{
    muts.forEach(m=>{
      const t=m.target;
      if(!t||t.nodeType!==1) return;
      if(t.matches&&t.matches(".rows,.ros,.dt,.bk,.cmd-pal")) paintFadeBottom(t);
      else if(t.closest){ const c=t.closest(".rows,.ros,.dt,.bk,.cmd-pal"); if(c) paintFadeBottom(c); }
    });
  });
  _fadeObs.observe(document.body,{childList:true,subtree:true});
  document.querySelectorAll(".rows,.ros,.dt,.bk,.cmd-pal").forEach(paintFadeBottom);
}catch(e){}
if(!window._modalFadeResize){ window._modalFadeResize=true; window.addEventListener("resize",()=>{ try{ document.querySelectorAll('.scrim.open .mod>div[id$="Body"]').forEach(paintModalFade); }catch(e){} try{ document.querySelectorAll(".rows,.ros,.dt,.bk,.cmd-pal").forEach(paintFadeBottom); }catch(e){} }); }
function openModal(m){ m.classList.add("open"); try{ if(window.__closeGselPop) window.__closeGselPop(); }catch(e){} try{ if(typeof closeDtPops==="function") closeDtPops(); }catch(e){} try{ m.querySelectorAll('.mod>div[id$="Body"]').forEach(b=>{ wireModalFade(b); paintModalFade(b); }); }catch(e){} }
function closeModal(m){ m.classList.remove("open"); }
[enrollModal, holidayModal, overrideModal, holidayViewModal, overrideViewModal, correctionModal, daySheetModal, schoolInfoModal, schedModal].forEach(m=>{
  if(!m) return;
  /* Veil dismiss needs press AND release on the veil: a drag that
     starts inside (e.g. finishing a text selection outside the card)
     fires click targeting m but must never close the window. */
  m.addEventListener("mousedown", (e)=>{ m._veilDown=(e.target===m); });
  m.addEventListener("click", (e)=>{
    if(e.target!==m || !m._veilDown) return;
    m._veilDown=false;
    /* Global explicit-dismiss law (user order): NO popup in the app
       closes from a backdrop click — every window leaves only via its
       own buttons or keys. (Notices never had veil-dismiss.) */
    return;
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
  if(idleLayer) idleLayer.classList.add("hidden");
  if(unknownLayer) unknownLayer.classList.remove("visible");
  if(student.photo){ photoImg.src=student.photo; photoImg.style.display="block"; photoFallback.style.display="none"; }
  else { photoImg.style.display="none"; photoFallback.style.display="flex"; photoFallback.textContent=(student.name||"").trim().split(" ").map(w=>w[0]).filter(Boolean).slice(0,2).join("").toUpperCase()||"—"; }
  if(idName) idName.textContent=student.name||"—";
  if(idRoll) idRoll.textContent=student.roll||"—";
  if(idClass) idClass.textContent=student.class||student.grade||"—";
  if(idGroup) idGroup.textContent=groupLabel(student);
  if(idSid) idSid.textContent=student.id!=null?String(student.id):"—";
  const norm = String(status||"").trim().toLowerCase();
  let displayStatus = status;
  let footer = "ATTENDANCE RECORDED";
  let muted = false;
  let holdMs = 4000;
  if(norm==="present"){
    displayStatus="Present";
    footer="ATTENDANCE RECORDED";
  } else if(norm==="late"){
    displayStatus="Late";
    footer="ATTENDANCE RECORDED";
  } else if(norm==="already recorded" || norm==="duplicate"){
    displayStatus="Already recorded";
    footer="ALREADY RECORDED";
    muted=true;
    holdMs=3200;
  } else if(norm==="not scheduled" || norm==="not_scheduled"){
    displayStatus="Not Scheduled";
    footer="NOT SCHEDULED";
    muted=true;
    holdMs=3200;
  } else {
    displayStatus=status||"—";
  }
  if(idStatus){
    idStatus.textContent=displayStatus;
    idStatus.style.color = muted ? "var(--ink-2)" : "var(--ink)";
  }
  if(idTime) idTime.textContent=(time||"").slice(0,5)||"—";
  if(idDate) idDate.textContent=dateStr||"";
  if(idConfirm){
    idConfirm.textContent=footer;
    idConfirm.classList.toggle("is-muted", muted);
    idConfirm.style.color="";
    idConfirm.style.display="";
  }
  identityLayer.classList.add("visible");
  Timers.set("hold", setTimeout(()=>{
    identityLayer.classList.remove("visible");
    if(idleLayer) idleLayer.classList.remove("hidden");
    setResultVisible(false);
    setState("ready");
    _resultHold=false;
    if(_scanLoopActive && adminLayer && !adminLayer.classList.contains("open") && enrollModal && !enrollModal.classList.contains("open")){
      _scanLoopTimer=setTimeout(sensorScanLoop, 180);
    }
  }, holdMs));
}
function showUnknown(){
  hidePrompt();
  setResultVisible(true);
  _resultHold=true;
  if(_scanLoopTimer){ clearTimeout(_scanLoopTimer); _scanLoopTimer=null; }
  Timers.clear("hold");
  if(idleLayer) idleLayer.classList.add("hidden");
  identityLayer.classList.remove("visible");
  const _ut = unknownTitleEl || (unknownLayer && unknownLayer.querySelector(".unknown-title"));
  if(_ut) _ut.textContent="NOT RECOGNIZED";
  unknownLayer.classList.add("visible");
  Timers.set("hold", setTimeout(()=>{
    unknownLayer.classList.remove("visible");
    if(idleLayer) idleLayer.classList.remove("hidden");
    setResultVisible(false);
    setState("ready");
    _resultHold=false;
    if(_scanLoopActive && adminLayer && !adminLayer.classList.contains("open") && enrollModal && !enrollModal.classList.contains("open")){
      _scanLoopTimer=setTimeout(sensorScanLoop, 180);
    }
  }, 2800));
}

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
  const isAdminOpen = typeof adminLayer !== "undefined" && adminLayer && adminLayer.classList.contains("open");
  if(fid && String(fid).indexOf("__unknown__")===0){
    if(!isAdminOpen){
      setState("identifying");
      await new Promise(r=>setTimeout(r, 180));
      if(seq && seq < _lastHandledScanSeq) return;
      showUnknown();
    }
    loadTodayAttendance().then(()=>{ if(currentTab==="attendance") renderAttendance(); });
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
    if(!isAdminOpen){
      setState("identifying");
      await new Promise(r=>setTimeout(r, 180));
      if(seq && seq < _lastHandledScanSeq) return;
      showUnknown();
    }
    loadTodayAttendance().then(()=>{ if(currentTab==="attendance") renderAttendance(); });
    return;
  }
  if(!isAdminOpen){
    setState("identifying");
    await new Promise(r=>setTimeout(r, 180));
    if(seq && seq < _lastHandledScanSeq) return;
    const status = info.status ? statusUI(info.status) : "Present";
    const time = info.time || new Date().toTimeString().slice(0,8);
    showIdentity(s, status, time, info.date ? fmtDate(info.date) : "");
  }
  loadTodayAttendance().then(()=>{ if(currentTab==="attendance") renderAttendance(); });
};
let _scanLoopActive=true, _scanRequestInFlight=false, _scanLoopTimer=null;
function pauseSensorScan(){ _scanLoopActive=false; if(_scanLoopTimer){ clearTimeout(_scanLoopTimer); _scanLoopTimer=null; } if(promptText){ promptText.classList.remove("scanning","identifying","detecting","is-hidden"); } }
function resumeSensorScan(){
  _scanLoopActive=true;
  if(!_resultHold && (!adminLayer || !adminLayer.classList.contains("open"))) setState("ready");
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
  const isEnrollOpen = (enrollModal && enrollModal.classList.contains("open"));
  if(isEnrollOpen){ _scanLoopTimer=setTimeout(sensorScanLoop,500); return; }
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
        if(!adminLayer || !adminLayer.classList.contains("open")) setState("ready");
        _scanLoopTimer=setTimeout(sensorScanLoop,nextDelay);
      }
    }
  }
}
// ---- render: Students ----
function renderClassFilters(){
  const opts=['<option value="">All classes</option>'].concat(Classes.map(c=>`<option>${esc(c)}</option>`)).join("");
  if(classFilter) classFilter.innerHTML=opts;
  if(attClassFilter) attClassFilter.innerHTML=opts;
  const batches=[...new Set([...(Batches||[]), ...Students.map(s=>s.batch).filter(Boolean)])].sort();
  if(batchFilter){
    const cur=batchFilter.value;
    batchFilter.innerHTML='<option value="">All batches</option>'+batches.map(b=>`<option ${b===cur?'selected':''}>${esc(b)}</option>`).join("");
    if(!batches.includes(cur)) batchFilter.value="";
  }
  if(attBatchFilter){
    const cur=attBatchFilter.value;
    attBatchFilter.innerHTML='<option value="">All batches</option>'+batches.map(b=>`<option ${b===cur?'selected':''}>${esc(b)}</option>`).join("");
    if(!batches.includes(cur)) attBatchFilter.value="";
  }
  populateAttStudents();
  // also populate schedule context selector (Global, Classes, Batches)
  populateScheduleSelector();
  try{ paintFlt(); }catch(e){}
}
function populateAttStudents(){
  if(!attStudentFilter) return;
  const cur = attStudentFilter.value;
  const cf = attClassFilter ? attClassFilter.value : "";
  const bf = attBatchFilter ? attBatchFilter.value : "";
  const inScope = Students.filter(s => s.active && (!cf || s.class === cf) && (!bf || (s.batch || "") === bf));
  inScope.sort((a,b) => (a.name||"").localeCompare(b.name||""));
  let html = '<option value="">All students</option>';
  html += inScope.map(s => `<option value="${s.id}" ${String(s.id)===cur?'selected':''}>${esc(s.name)} (${esc(s.roll||"—")})</option>`).join("");
  attStudentFilter.innerHTML = html;
  if(cur && !inScope.some(s => String(s.id)===cur)) attStudentFilter.value = "";
}
function renderStudentList(){
  var _rs=$("rosterSearch"); if(_rs&&document.activeElement!==_rs&&searchInput) _rs.value=searchInput.value||"";
  const q=(searchInput.value||"").toLowerCase(), cf=classFilter?classFilter.value:"", bf=batchFilter?batchFilter.value:"", sf=studentStatusFilter?studentStatusFilter.value:"all";
  let list=Students.filter(s=>{
    if(sf==="active" && !s.active) return false;
    if(sf==="inactive" && s.active) return false;
    if(cf && s.class!==cf) return false;
    if(bf && (s.batch||"")!==bf) return false;
    if(!q) return true;
    return (s.name+" "+s.roll+" "+s.class+" "+(s.batch||"")+" "+s.phone+" "+s.fid+" "+s.id+" "+(s.section||"")+" "+(s.parent||"")).toLowerCase().includes(q);
  });
  if(sdStudentSort==="name_desc"){ list.sort((a,b)=>b.name.localeCompare(a.name)); }
  else if(sdStudentSort==="roll"){ list.sort((a,b)=>String(a.roll||"").localeCompare(String(b.roll||""))); }
  else if(sdStudentSort==="class"){ list.sort((a,b)=>String(a.class||"").localeCompare(String(b.class||""))||a.name.localeCompare(b.name)); }
  else if(sdStudentSort==="active"){ list.sort((a,b)=>(b.active-a.active)||a.name.localeCompare(b.name)); }
  else { list.sort((a,b)=>a.name.localeCompare(b.name)); }
  const sc=$("scount"); if(sc) sc.textContent=Students.length+(Students.length===1?" enrolled":" enrolled");
  const rc=$("roCount"); if(rc) rc.textContent="STUDENTS ("+Students.length+")";
  try{
    const hc=$("fltHideCount");
    if(hc){
      if(sf==="active"){
        const n=Students.filter(s=>!s.active&&(!cf||s.class===cf)&&(!bf||(s.batch||"")===bf)&&(!q||(s.name+" "+s.roll+" "+s.class+" "+(s.batch||"")+" "+s.phone+" "+s.fid+" "+s.id+" "+(s.section||"")+" "+(s.parent||"")).toLowerCase().includes(q))).length;
        hc.textContent=n+" inactive hidden"; hc.hidden=n===0;
      } else hc.hidden=true;
    }
  }catch(e){}
  if(!list.length){ studentListEl.innerHTML=`<p class="none">No students match these filters.</p>`; return; }
  studentListEl.innerHTML=list.map((s,ix)=>{
    const batchTxt=s.batch?` · ${esc(s.batch)}`:"";
    const sub=`${esc(s.roll)} · ${esc(s.class)}${batchTxt}${s.active?"":" · Inactive"}`;
    return `<button class="ri${selectedStudentId===s.id?" on":""}" data-id="${s.id}"><span class="ri-num" aria-hidden="true">${String(ix+1).padStart(2,"0")}</span><div><span>${esc(s.name)}</span><small>${sub}</small><small class="ri-status"><i class="ri-dot${s.active?"":" off"}"></i>${s.active?"Active":"Inactive"}</small></div><span class="ri-arrow"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></span></button>`;
  }).join("");
}
function renderStudentDetail(id){
  const s=Students.find(x=>x.id===id);
  if(!s){ detailScroll.innerHTML=`<div class="empty"><b>No student selected</b>Choose a student.</div>`; return; }
  const initials=studentInitials(s.name);
  const mono=s.photo?`<div class="mono has-photo"><img src="${esc(s.photo)}" alt=""></div>`:`<div class="mono">${esc(initials)}</div>`;
  const history=(AllEvents.filter(a=>a.studentId===s.id).slice(-60).reverse()); // quick UI list fallback
  const _allHistory=AllEvents.filter(a=>a.studentId===s.id);
  const stCls=a=>({Present:"P",Late:"L",Absent:"A"})[a]||"X";
  const _fd=iso=>{ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||""); if(!m) return iso||"—"; return (+m[3])+" "+MONTHS_S[+m[2]-1]+" "+m[1]; };
  const _ft=t=>{ if(t==="23:59:59"||t==="00:00:00") return "—"; const m=/^(\d{1,2}):(\d{2})/.exec(t||""); if(!m) return "—"; let h=+m[1]; const ap=h>=12?"PM":"AM"; h=h%12; if(h===0)h=12; return h+":"+m[2]+" "+ap; };
  const _stName=a=>a==="Not Scheduled"?"Not scheduled":a;
  const _rows=Attendance.filter(a=>a.studentId===s.id);
  const _p=_rows.filter(a=>a.status==="Present").length;
  const _l=_rows.filter(a=>a.status==="Late").length;
  const _a=_rows.filter(a=>a.status==="Absent").length;
  const _t=_p+_l+_a;
  /* 3-week rate: present-or-late days over scheduled days in the trailing
     21 days (today included). Not-scheduled days never count. */
  const _d0=new Date(); _d0.setHours(0,0,0,0);
  const _iso=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  const _from=(()=>{ const d=new Date(_d0); d.setDate(d.getDate()-20); return _iso(d); })();
  const _to=_iso(_d0);
  const _plDays=new Set();
  (AllEvents||[]).forEach(a=>{ if(a.studentId===s.id&&(a.status==="Present"||a.status==="Late")&&a.date>=_from&&a.date<=_to) _plDays.add(a.date); });
  let _sched=0;
  for(let i=0;i<21;i++){ const d=new Date(_d0); d.setDate(d.getDate()-i); try{ if(isWorkingDayForStudent(_iso(d),s)) _sched++; }catch(e){} }
  const _rate=_sched?Math.round(100*_plDays.size/_sched):null;
  /* Active date controls: an explicit month pick or the compact dropdown.
     Last action sets sdMode; records and the month-day timeline use the
     same local-date window (no UTC conversion). */
  const _todayD=new Date(); _todayD.setHours(0,0,0,0);
  if(!sdMonth){ sdMonth=new Date(_todayD.getFullYear(),_todayD.getMonth(),1); }
  let _activeFrom, _activeTo, _activeDaysIn=0;
  if(sdMode==="range"){
    const _t0=new Date(_todayD);
    if(sdDatePreset==="today"){ _activeFrom=new Date(_t0); _activeTo=new Date(_t0); }
    else if(sdDatePreset==="last7"){ _activeFrom=new Date(_t0); _activeFrom.setDate(_activeFrom.getDate()-6); _activeTo=new Date(_t0); }
    else if(sdDatePreset==="last30"){ _activeFrom=new Date(_t0); _activeFrom.setDate(_activeFrom.getDate()-29); _activeTo=new Date(_t0); }
    else{ _activeFrom=(sdCustomFrom?parseISO(sdCustomFrom):new Date(_t0)); _activeTo=(sdCustomTo?parseISO(sdCustomTo):_activeFrom); }
    _activeFrom.setHours(0,0,0,0); _activeTo.setHours(0,0,0,0);
    if(_activeFrom>_activeTo){ const _tmp=_activeFrom; _activeFrom=_activeTo; _activeTo=_tmp; }
    _activeDaysIn=Math.round((_activeTo-_activeFrom)/(1000*60*60*24))+1;
  }else{
    _activeFrom=new Date(sdMonth.getFullYear(),sdMonth.getMonth(),1);
    _activeTo=new Date(sdMonth.getFullYear(),sdMonth.getMonth()+1,0);
    _activeDaysIn=_activeTo.getDate();
  }
  const monthName=_activeFrom.toLocaleDateString('en-GB',{month:'long',year:'numeric'});
  const monthShort=_activeFrom.toLocaleDateString('en-GB',{month:'short',year:'numeric'});
  const _byDate={};
  (AllEvents||[]).forEach(a=>{ if(a.studentId===s.id&&a.date&&!_byDate[a.date]) _byDate[a.date]=a.status; });
  const _WD=["S","M","T","W","T","F","S"];
  const _sqCls=iso=>{ const st=_byDate[iso]; return st==="Present"?"P":st==="Late"?"L":st==="Absent"?"A":st==="Not Scheduled"?"N":"X"; };
  let tlNums="", tlWk="", tlSq="";
  for(let i=0;i<_activeDaysIn;i++){
    const d=new Date(_activeFrom); d.setDate(_activeFrom.getDate()+i);
    const iso=_iso(d), dow=d.getDay();
    tlNums+=`<span class="sd-n">${d.getDate()}</span>`;
    tlWk+=`<span class="sd-w">${_WD[dow]}</span>`;
    tlSq+=`<span class="sd-cell"><i class="sd-sq ${_sqCls(iso)}"></i></span>`;
  }
  const _fromISO=_iso(_activeFrom), _toISO=_iso(_activeTo);
  const _filtered=sdStatus?_allHistory.filter(a=>a.date>=_fromISO&&a.date<=_toISO&&a.status===sdStatus):_allHistory.filter(a=>a.date>=_fromISO&&a.date<=_toISO);
  const _ordered=sdNewest?[..._filtered].reverse():_filtered;
  const recRows=_ordered.length?_ordered.map(a=>`<tr><td>${esc(_fd(a.date))}</td><td>${esc(_ft(a.time))}</td><td class="s-${stCls(a.status)}">${esc(_stName(a.status))}${a.fixed?" · corrected":""}</td><td>${esc(a.fingerId!=null?"F-"+a.fingerId:"—")}</td><td class="act"><button type="button" data-correct data-correct-sid="${s.id}" data-correct-date="${esc(a.date)}" data-correct-status="${esc(a.status)}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>Correct</button></td></tr>`).join(""):`<tr><td colspan="5" class="sub" style="padding:12px 0">No records. Scan results will appear here from the sensor.</td></tr>`;
  detailScroll.innerHTML=`
    <div class="sd-top">
    <div class="sd-headrow">
    <div class="dh">${mono}<div><h2>${esc(s.name)}</h2><div class="sub">${esc(s.active?"Active":"Inactive")} · ${esc(s.batch||"—")}</div></div></div>
    <div class="acts">
      <button data-action="edit" data-id="${s.id}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>Edit information</button>
      <button data-action="reenroll" data-id="${s.id}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>Re-enroll fingerprint</button>
      ${s.active ? `` : `<button data-action="reactivate" data-id="${s.id}">Re-activate</button>`}
      <button data-action="print" data-id="${s.id}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Print profile</button>
      <button data-correct data-correct-sid="${s.id}" data-correct-date="${esc(todayISO())}" data-correct-status="Present"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>Correct today</button>
      ${s.active ? `<button data-action="delete" data-id="${s.id}" aria-label="Deactivate">Delete</button>` : ``}
    </div>
    </div>
    <div class="facts">
      <div><small>Today</small>${_t?`<span class="s-${_p?"P":"A"}">${_p}P · ${_l}L · ${_a}A</span>`:"No scan"}</div>
      <div><small>Attendance, 3 weeks</small>${_rate==null?"No data":_rate+"%"}</div>
      <div><small>Fingerprint</small>${esc(s.fid||"—")}</div>
      <div><small>Roll</small>${esc(s.roll)}</div>
      <div><small>Class</small>${esc(s.class)} · ${esc(s.section||"—")}</div>
      <div><small>Parent</small>${esc(s.parent||"—")}</div>
      <div><small>Phone</small>${esc(s.phone||"—")}</div>
      <div><small>Address</small>${esc(s.address||"—")}</div>
    </div>
    <div class="sd-head">
      <h3>Recent attendance</h3>
      <div class="sd-month"><button type="button" id="sdPrev" aria-label="Previous month">‹</button><span>${esc(monthName)}</span><button type="button" id="sdNext" aria-label="Next month">›</button></div>
      <select id="sdDatePreset" class="sd-range" style="width:140px" aria-label="Date range">
        <option value="current"${sdDatePreset==="current"?" selected":""}>Current month</option>
        <option value="today"${sdDatePreset==="today"?" selected":""}>Today</option>
        <option value="last7"${sdDatePreset==="last7"?" selected":""}>Last 7 days</option>
        <option value="last30"${sdDatePreset==="last30"?" selected":""}>Last 30 days</option>
        <option value="custom"${sdDatePreset==="custom"?" selected":""}>Custom range</option>
      </select>
      <span class="sd-view">${sdMode==="month"?"Calendar month":"Rolling range"}</span>
    </div>
    <div class="sd-tl">
      <div class="sd-tl-row"><span class="sd-tl-lab">${esc(monthShort)}</span>${tlNums}</div>
      <div class="sd-tl-row"><span class="sd-tl-lab">Date</span>${tlWk}</div>
      <div class="sd-tl-row"><span class="sd-tl-lab">Status</span>${tlSq}</div>
    </div>
    <div class="sd-legend">
      <span><i class="sd-sq P"></i>Present</span>
      <span><i class="sd-sq A"></i>Absent</span>
      <span><i class="sd-sq L"></i>Late</span>
      <span><i class="sd-sq N"></i>Not scheduled</span>
      <span><i class="sd-sq X"></i>No record</span>
    </div>
    </div>
    <div class="sd-recs">
    <div class="sd-rec-head">
      <h3>Attendance records</h3>
      <select id="sdStatusFilter" aria-label="All status">
        <option value=""${sdStatus===""?" selected":""}>All status</option>
        <option value="Present"${sdStatus==="Present"?" selected":""}>Present</option>
        <option value="Absent"${sdStatus==="Absent"?" selected":""}>Absent</option>
        <option value="Late"${sdStatus==="Late"?" selected":""}>Late</option>
        <option value="Not Scheduled"${sdStatus==="Not Scheduled"?" selected":""}>Not scheduled</option>
      </select>
      <div class="sd-rec-tools">
        <button type="button" id="sdTimeToggle">Time: <span class="sd-time-word">${sdNewest?"Newest":"Oldest"}</span></button>
        <button type="button" data-action="refresh" data-id="${s.id}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>Refresh</button>
        <button type="button" data-action="print" data-id="${s.id}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Print</button>
        <button type="button" data-action="export" data-id="${s.id}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Export CSV</button>
      </div>
    </div>
    <table class="sd-tbl">
      <thead><tr><th>Date</th><th>Time</th><th>Status</th><th>Finger</th><th class="act">Action</th></tr></thead>
      <tbody>${recRows}</tbody>
    </table>
    </div>`;
}
function selectStudent(id){ selectedStudentId=id; try{localStorage.setItem("atl_student",String(id));}catch(_){} renderStudentList(); renderStudentDetail(id); }
// ---- render: Unified Attendance Workspace (Live Today + Historical) ----
/* Preset → {from,to}: single truth for render/print/export.
   Academic popup override (attAcadFrom/To) applies to the live view
   only; print/export resolve from Settings. */
function resolveAttRange(preset, acad){
  const today=todayISO();
  let from=today, to=today;
  if(preset==="today"){ from=today; to=today; }
  else if(preset==="yesterday"){ const d=new Date(); d.setDate(d.getDate()-1); from=toLocalISO(d); to=from; }
  else if(preset==="custom_day"){ from=(attSingleDate&&attSingleDate.value)||today; to=from; }
  else if(preset==="custom_range"){ from=(attFromDate&&attFromDate.value)||today; to=(attToDate&&attToDate.value)||today; }
  else if(preset==="week"){ const d=new Date(); d.setDate(d.getDate()-6); from=toLocalISO(d); to=today; }
  else if(preset==="month"){ const d=new Date(); d.setDate(1); from=toLocalISO(d); to=today; }
  else if(preset==="academic"){ from=(acad&&acad.from)||Settings.startDate||Settings.schoolOpeningDate||"2026-06-15"; to=(acad&&acad.to)||Settings.endDate||today; }
  return {from, to};
}
/* Inclusive day count for a YYYY-MM-DD span */
function rangeDays(from,to){
  try{ return Math.round((new Date(to+"T00:00:00")-new Date(from+"T00:00:00"))/(1000*60*60*24))+1; }
  catch(e){ return 1; }
}
async function renderAttendance(){
  const attPane = document.getElementById("pane-attendance");
  if(!attPane) return;
  const preset = (attDatePreset && attDatePreset.value) ? attDatePreset.value : "today";
  const today = todayISO();

  // Custom-date inputs: visible only for their preset; seed empty ones
  if(attSingleDate){ attSingleDate.style.display = preset==="custom_day" ? "" : "none"; if(preset==="custom_day" && !attSingleDate.value) attSingleDate.value = today; }
  if(attFromDate){ attFromDate.style.display = preset==="custom_range" ? "" : "none"; if(preset==="custom_range" && !attFromDate.value) attFromDate.value = today; }
  if(attToDate){ attToDate.style.display = preset==="custom_range" ? "" : "none"; if(preset==="custom_range" && !attToDate.value) attToDate.value = today; }
  const {from, to} = resolveAttRange(preset, {from:attAcadFrom, to:attAcadTo});
  if(preset === "custom_range" && from > to){
    attStats.innerHTML = `<div class="err">Invalid date range — Start date must be before End date.</div>`;
    attTableBody.innerHTML = `<tr><td colspan="7"><div class="empty"><b>Invalid range</b>Choose a valid custom date range.</div></td></tr>`;
    return;
  }

  const isSingleDay = (from === to);
  const isToday = (from === today);
  const cf = attClassFilter ? attClassFilter.value : "";
  const bf = attBatchFilter ? attBatchFilter.value : "";
  const sf = attStatusFilter ? attStatusFilter.value : "";
  const sort = attSort ? attSort.value : "time_desc";
  const sid = (attStudentFilter && attStudentFilter.value) ? parseInt(attStudentFilter.value) : null;
  const selStudent = sid ? Students.find(s => s.id === sid) : null;

  // Filter active students by class & batch or single student
  const studentsInScope = selStudent ? [selStudent] : Students.filter(s => s.active && (!cf || s.class === cf) && (!bf || (s.batch || "") === bf));
  const totalStudents = studentsInScope.length;
  const byId = new Map(Students.map(s => [s.id, s]));

  // Clear appears at the end of the filter group only while a filter is set
  try{
    const cb=$("attClearBrick");
    if(cb) cb.hidden=!attFilterActive();
  }catch(e){}
  try{ paintTimeToggle(); }catch(e){}

  // Fetch events (Attendance cache is already mapped — map fresh fetches only;
  // remapping mapped rows would lose isDuplicate and break Duplicate counts)
  let ev = [];
  if(isToday && !selStudent){
    ev = Attendance;
  } else {
    try {
      ev = (await api("/api/attendance", {method:"GET"})).map(mapEvent);
    } catch(e){
      ev = Attendance;
    }
  }

  // Filter events in date range
  let list = ev.filter(a => a.date >= from && a.date <= to);
  if(selStudent) list = list.filter(a => a.studentId === sid);
  else {
    if(cf) list = list.filter(a => { const s = byId.get(a.studentId); return s && s.class === cf; });
    if(bf) list = list.filter(a => { const s = byId.get(a.studentId); return s && (s.batch || "") === bf; });
  }

  // Fetch authoritative metrics for single-student scope
  let rpt = null;
  if(selStudent){
    try {
      rpt = await api("/api/reports?studentId=" + sid, {method: "GET"});
    } catch(e){}
  }

  // Scheduled vs Not Scheduled calculations
  let scheduled = 0;
  let scheduledFiltered = [];
  let notScheduledFiltered = [];

  if(isSingleDay){
    scheduledFiltered = studentsInScope.filter(s => isWorkingDayForStudent(from, s));
    notScheduledFiltered = studentsInScope.filter(s => !isWorkingDayForStudent(from, s));
    scheduled = scheduledFiltered.length;
  } else if(selStudent && rpt && typeof rpt.eligible === "number"){
    scheduled = rpt.eligible;
  } else {
    try {
      let d = parseISO(from), endD = parseISO(to);
      while(d <= endD){
        const iso = toLocalISO(d);
        for(const stu of studentsInScope){
          if(isWorkingDayForStudent(iso, stu)) scheduled++;
        }
        d.setDate(d.getDate() + 1);
      }
    } catch(e){
      scheduled = list.filter(a => a.status === "Present" || a.status === "Late" || a.status === "Absent").length;
    }
  }

  // Filtered rows display
  let rows = [];
  if(isSingleDay){
    rows = list.map(a => { const s = byId.get(a.studentId); return s ? {a, s} : null; }).filter(Boolean);
    if(sf){
      if(sf === "Duplicate") rows = rows.filter(r => r.a.isDuplicate);
      else if(sf === "Unknown") rows = [];
      else if(sf === "Not Scheduled"){
        rows = notScheduledFiltered.map(s => ({a:{status:"Not Scheduled", time:"—", isDuplicate:false, fingerId:s.fid?parseInt(String(s.fid).replace("F-","")):null, date:from}, s}));
      } else if(sf === "Absent"){
        const presentIds = new Set(rows.filter(r => r.a.status === "Present" || r.a.status === "Late").map(r => r.s.id));
        const absentStudents = scheduledFiltered.filter(s => !presentIds.has(s.id));
        rows = absentStudents.map(s => ({a:{status:"Absent", time:"—", isDuplicate:false, fingerId:null, date:from}, s}));
      } else {
        rows = rows.filter(r => r.a.status === sf);
      }
    } else if(selStudent && !rows.length){
      if(scheduledFiltered.length){
        rows = [{a:{status:"Absent", time:"—", isDuplicate:false, fingerId:null, date:from}, s:selStudent}];
      } else {
        rows = [{a:{status:"Not Scheduled", time:"—", isDuplicate:false, fingerId:selStudent.fid?parseInt(String(selStudent.fid).replace("F-","")):null, date:from}, s:selStudent}];
      }
    }
  } else {
    // Multi-day
    rows = list.map(a => { const s = byId.get(a.studentId); return s ? {a, s} : null; }).filter(Boolean);
    if(sf){
      if(sf === "Duplicate") rows = rows.filter(r => r.a.isDuplicate);
      else if(sf === "Unknown") rows = [];
      else rows = rows.filter(r => r.a.status === sf);
    }
  }

  // Sort rows
  rows.sort((x, y) => {
    if(!isSingleDay){
      const dc = (y.a.date || "").localeCompare(x.a.date || "");
      if(dc !== 0) return dc;
    }
    if(sort === "time_desc") return (y.a.time || "").localeCompare(x.a.time || "");
    if(sort === "time_asc") return (x.a.time || "").localeCompare(y.a.time || "");
    if(sort === "name_asc") return x.s.name.localeCompare(y.s.name);
    if(sort === "roll_asc") return x.s.roll.localeCompare(y.s.roll);
    if(sort === "class_asc") return x.s.class.localeCompare(y.s.class);
    if(sort === "status_asc") return (x.a.status || "").localeCompare(y.a.status || "");
    return 0;
  });
  lastAttRender = {rows, isSingleDay, from, to};

  // KPI Calculations
  let presentAll, lateAll, absentAll, pct;
  if(selStudent && rpt && typeof rpt === "object" && "eligible" in rpt){
    presentAll = rpt.present ?? 0;
    lateAll = rpt.late ?? 0;
    absentAll = rpt.absent ?? 0;
    pct = rpt.rate ?? 0;
  } else if(isToday && Kpis && Kpis.date === today && !cf && !bf && !selStudent && typeof Kpis.scheduled === "number"){
    presentAll = Kpis.present ?? 0;
    lateAll = Kpis.late ?? 0;
    absentAll = Kpis.absent ?? Math.max(0, (Kpis.scheduled ?? scheduled) - presentAll - lateAll);
    pct = Kpis.scheduled ? Math.round((presentAll + lateAll)/Kpis.scheduled*100) : 0;
  } else if(isSingleDay){
    presentAll = list.filter(a => a.status === "Present").length;
    lateAll = list.filter(a => a.status === "Late").length;
    absentAll = Math.max(0, scheduled - presentAll - lateAll);
    pct = scheduled ? Math.round((presentAll + lateAll)/scheduled*100) : 0;
  } else {
    presentAll = list.filter(a => a.status === "Present").length;
    lateAll = list.filter(a => a.status === "Late").length;
    absentAll = list.filter(a => a.status === "Absent").length;
    pct = scheduled ? Math.round((presentAll + lateAll)/scheduled*100) : 0;
  }

  const present = sf ? rows.filter(r => r.a.status === "Present").length : presentAll;
  const late = sf ? rows.filter(r => r.a.status === "Late").length : lateAll;
  const absent = sf ? (sf === "Absent" ? rows.length : (sf === "Not Scheduled" ? 0 : absentAll)) : absentAll;
  const notScheduledCount = isSingleDay ? notScheduledFiltered.length : list.filter(a => a.status === "Not Scheduled").length;
  const dup = rows.filter(r => r.a.isDuplicate).length;

  // Unknown scan attempts
  let unks = [];
  try {
    unks = Unknowns.filter(u => (u.date >= from && u.date <= to));
    const evUnks = ev.filter(e => {
      const isUnk = e.result === "UNKNOWN" || e.status === "UNKNOWN" || (!e.studentId && e.status === "Unknown");
      return isUnk && (!e.date || (e.date >= from && e.date <= to));
    });
    for(const eu of evUnks){
      if(!unks.some(u => u.time === eu.time && u.finger === (eu.fingerId ? "F-"+eu.fingerId : "—"))){
        unks.push({time: eu.time, finger: eu.fingerId ? "F-"+eu.fingerId : "—", note: "Unknown fingerprint", date: eu.date});
      }
    }
  } catch(e){
    unks = isToday ? Unknowns : [];
  }

  // Render 9 KPI cards (date value stays concise + single-line — never wraps)
  // Day fmt ("1 Oct 2026") + range fmt ("25 Sep – 1 Oct 2026", en dash, full year)
  const _fmtC=iso=>{ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||""); if(!m) return iso||"—"; return (+m[3])+" "+MONTHS_S[+m[2]-1]+" "+m[1]; };
  const _isoP=iso=>{ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||""); return m?[m[1],m[2],+m[3]]:null; };
  const _fP=p=>p?p[2]+" "+MONTHS_S[+p[1]-1]+" "+p[0]:"—";
  let dateCardVal;
  if(isSingleDay){ dateCardVal=_fmtC(from); }
  else {
    const a=_isoP(from), b=_isoP(to);
    if(a&&b&&a[0]===b[0]&&a[1]===b[1]) dateCardVal=`${a[2]} – ${b[2]} ${MONTHS_S[+a[1]-1]} ${a[0]}`;
    else if(a&&b&&a[0]===b[0]) dateCardVal=`${a[2]} ${MONTHS_S[+a[1]-1]} – ${b[2]} ${MONTHS_S[+b[1]-1]} ${a[0]}`;
    else dateCardVal=`${_fmtC(from)} – ${_fmtC(to)}`;
  }
  const _curSf = (typeof attStatusFilter!=="undefined" && attStatusFilter) ? attStatusFilter.value : "";
  if(selStudent && rpt && typeof rpt === "object" && "eligible" in rpt){
    attStats.innerHTML = `
      <div class="stat${_curSf===""?" sel":""}" data-f=""><small>Student</small><b>${esc(selStudent.name)}</b></div>
      <div class="stat${_curSf==="Present"?" sel":""}" data-f="Present"><small>Present</small><b>${rpt.present ?? 0}</b></div>
      <div class="stat${_curSf==="Late"?" sel":""}" data-f="Late"><small>Late</small><b>${rpt.late ?? 0}</b></div>
      <div class="stat${_curSf==="Absent"?" sel":""}" data-f="Absent"><small>Absent</small><b>${rpt.absent ?? 0}</b></div>
      <div class="stat info"><small>Eligible days</small><b>${rpt.eligible ?? 0}</b></div>
      <div class="stat info"><small>Attended</small><b>${rpt.attended ?? 0}</b></div>
      <div class="stat info"><small>Duplicate scans</small><b>${dup}</b></div>
      <div class="stat info"><small>Attendance %</small><b>${rpt.rate ?? 0}%</b></div>`;
  } else {
    attStats.innerHTML = `
      <div class="stat${_curSf===""?" sel":""}" data-f=""><small>Total students</small><b>${totalStudents}</b></div>
      <div class="stat${_curSf==="Present"?" sel":""}" data-f="Present"><small>Present</small><b>${present}</b></div>
      <div class="stat${_curSf==="Late"?" sel":""}" data-f="Late"><small>Late</small><b>${late}</b></div>
      <div class="stat${_curSf==="Absent"?" sel":""}" data-f="Absent"><small>Absent</small><b>${absent}</b></div>
      <div class="stat${_curSf==="Not Scheduled"?" sel":""}" data-f="Not Scheduled"><small>Not scheduled</small><b>${notScheduledCount}</b></div>
      <div class="stat info"><small>Attendance %</small><b>${pct}%</b></div>
      <div class="stat info" data-act="unknown"><small>Unknown scans</small><b>${unks.length}</b></div>
      <div class="stat info" data-act="dup" data-f="Duplicate"><small>Duplicate scans</small><b>${dup}</b></div>`;
  }
  const _rng=$("attRangeLabel"); if(_rng) _rng.textContent=dateCardVal;
  const _ar=$("arange"); if(_ar) _ar.textContent={today:"Today",yesterday:"Yesterday",week:"This week",month:"This month",custom_day:"Custom date",custom_range:"Custom range",academic:"Academic year"}[preset]||"Records";

  // Render Table Body (one fixed grid for header + every row; paged, searched)
  const _vkey=[preset,from,to,cf,bf,sf,sid,sort,attSearchQ,selStudent?selStudent.id:""].join("|");
  if(_vkey!==attViewKey){ attViewKey=_vkey; attShowLimit=50; }
  if(attSearchQ){ const q=attSearchQ; rows=rows.filter(r=>((r.s.name||"")+" "+(r.s.roll||"")).toLowerCase().includes(q)); }
  attShownRows=rows;
  paintAttTable();

  // Render Unknown Attempts section (view toggles live in paintAttTabs)
  if(attUnknownCount) attUnknownCount.textContent = `${unks.length} attempt${unks.length === 1 ? "" : "s"}`;
  if(attUnknownBody){
    if(unks.length && !selStudent){
      attUnknownBody.innerHTML = unks.map(u => `<div class="ar unk"><span>${esc(attFT(u.time))}</span><span>${esc(u.finger)}</span><span>${esc(u.note)}</span></div>`).join("");
    } else if(!selStudent){
      attUnknownBody.innerHTML = `<p class="sub" style="padding:16px 0">No unknown scan attempts.</p>`;
    }
  }
}

function renderToday(){
  if(attDatePreset) attDatePreset.value = "today";
  renderAttendance();
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
    if(v && typeof v==="object") return v;
  }
  // fallback to legacy UI key for offline
  if(grade && ClassSchedulesUI && ClassSchedulesUI[grade]){
    const v=ClassSchedulesUI[grade];
    if(v && v.workingDays) return v.workingDays;
    if(v) return v;
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
      if(v && v.workingDays) return v.workingDays;
      if(v) return v;
    }
  }
  if(batch && BatchSchedules[batch]){
    const v=BatchSchedules[batch];
    if(v && v.workingDays) return v.workingDays;
    if(v) return v;
  }
  if(grade && ClassSchedules[grade]){
    const v=ClassSchedules[grade];
    if(v && v.workingDays) return v.workingDays;
    if(v) return v;
  }
  return Settings.workingDays;
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
  const at=(h.startTime&&h.endTime)?("@"+h.startTime+"-"+h.endTime):"";
  return span+at+":"+(h.type||"holiday")+":"+(h.name||"Holiday");
}); }
function overridesToBackend(){ return Overrides.map(o=>o.date+((o.startTime&&o.endTime)?("@"+o.startTime+"-"+o.endTime):"")+(o.isWorking?":1":":0")+":"+o.note); }
function classSchedulesToBackend(){
  // normalize to backend expected format: {class: workingDays} or {class: {workingDays}}
  const out={};
  Object.keys(ClassSchedules).forEach(k=>{
    const v=ClassSchedules[k];
    if(!v) return;
    if(v.workingDays) {
      out[k]={workingDays: v.workingDays};
      if(v.presentCutoff) out[k].presentCutoff = v.presentCutoff;
      if(v.lateCutoff) out[k].lateCutoff = v.lateCutoff;
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
    if(v.workingDays) {
      out[k]={workingDays: v.workingDays};
      if(v.presentCutoff) out[k].presentCutoff = v.presentCutoff;
      if(v.lateCutoff) out[k].lateCutoff = v.lateCutoff;
    } else {
      out[k]=v;
    }
  });
  return out;
}
function parseScheduleContext(val){
  val = String(val||"").trim();
  if(!val) return {type:"global", name:"", key:"", label:"Global (all classes & batches)"};
  /* Holiday/override jump targets resolve to the global template —
     the month navigates to their date (see the select handler). */
  if(val.startsWith("holiday:")||val.startsWith("override:")) return {type:"global", name:"", key:"", label:"Global (all classes & batches)"};
  if(val.startsWith("class:")) {
    const name = val.slice(6).trim();
    return {type:"class", name, key:name, label:`Class: ${name}`};
  }
  if(val.startsWith("batch:")) {
    const name = val.slice(6).trim();
    return {type:"batch", name, key:name, label:`Batch: ${name}`};
  }
  const allBatches = [...new Set([...(Batches||[]), ...Students.map(s=>s.batch).filter(Boolean)])];
  if(allBatches.includes(val) || val.includes("|")) {
    return {type:"batch", name:val, key:val, label:`Batch: ${val}`};
  }
  return {type:"class", name:val, key:val, label:`Class: ${val}`};
}
function getScheduleContext(){
  const sel = $("calClassSelect");
  return parseScheduleContext(sel ? sel.value : "");
}
function populateScheduleSelector(){
  const sel=$("calClassSelect");
  if(!sel) return;
  const cur = sel.value;
  const batches = [...new Set([...(Batches||[]), ...Students.map(s=>s.batch).filter(Boolean)])].sort();
  let html = '<optgroup label="Everyone"><option value="">All classes and batches</option></optgroup>';
  if(Classes && Classes.length){
    html += '<optgroup label="Classes">';
    Classes.forEach(c=>{
      const val = `class:${c}`;
      const isSel = (cur === val || cur === c) ? 'selected' : '';
      html += `<option value="${val}" ${isSel}>${esc(c)}</option>`;
    });
    html += '</optgroup>';
  }
  if(batches && batches.length){
    html += '<optgroup label="Batches">';
    batches.forEach(b=>{
      const val = `batch:${b}`;
      const isSel = (cur === val || cur === b) ? 'selected' : '';
      html += `<option value="${val}" ${isSel}>${esc(b)}</option>`;
    });
    /* Per-class batches ride the same group (user order): value keeps
       the full "Class|Batch" key, label shows short + class. */
    Object.keys(BatchSchedules||{}).filter(k=>k.includes("|")).sort((a,b)=>a.localeCompare(b)).forEach(k=>{
      const p=splitBatchKey(k);
      const val = `batch:${k}`;
      const isSel = (cur === val) ? 'selected' : '';
      html += `<option value="${val}" ${isSel}>${esc(p.short)} · ${esc(p.cls)}</option>`;
    });
    html += '</optgroup>';
  }
  /* Jump groups (user order): holidays/overrides ride the same grid
     dropdown — picking one navigates the month to its date on the
     global template (see the select handler). Values date-keyed. */
  const _MS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const _dS=iso=>{ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||""); return m?(+m[3])+" "+_MS[+m[2]-1]:"—"; };
  if(Holidays && Holidays.length){
    html += '<optgroup label="Holidays">';
    [...Holidays].sort((a,b)=>String(a.start).localeCompare(String(b.start))).forEach(h=>{
      const val = `holiday:${h.start}`;
      const isSel = (cur === val) ? 'selected' : '';
      const span = h.start===h.end?_dS(h.start):(_dS(h.start)+"→"+_dS(h.end));
      html += `<option value="${val}" ${isSel}>${esc(h.name||"Holiday")} · ${esc(span)}${fmtTimes(h)?esc(fmtTimes(h)):""}</option>`;
    });
    html += '</optgroup>';
  }
  if(Overrides && Overrides.length){
    html += '<optgroup label="Overrides">';
    [...Overrides].sort((a,b)=>String(a.date).localeCompare(String(b.date))).forEach(o=>{
      const val = `override:${o.date}`;
      const isSel = (cur === val) ? 'selected' : '';
      html += `<option value="${val}" ${isSel}>${esc(_dS(o.date)+(o.note?" — "+o.note:""))}${fmtTimes(o)?esc(fmtTimes(o)):""}</option>`;
    });
    html += '</optgroup>';
  }
  sel.innerHTML = html;
}
function getWorkingDaysForBatch(batchName){
  if(batchName && BatchSchedules[batchName]){
    const v = BatchSchedules[batchName];
    if(v && typeof v==="object" && v.workingDays) return v.workingDays;
    if(v && typeof v==="object") return v;
  }
  if(batchName && batchName.includes("|")){
    const grade = batchName.split("|")[0].trim();
    if(grade && ClassSchedules[grade]){
      const v = ClassSchedules[grade];
      if(v && typeof v==="object" && v.workingDays) return v.workingDays;
      if(v && typeof v==="object") return v;
    }
  }
  return Settings.workingDays;
}
function isWorkingDayForBatch(d, batchName){
  const ov = getOverride(d);
  if(ov) return ov.isWorking;
  const hol = isHoliday(d);
  if(hol){
    const type = String(hol.type||"holiday").toLowerCase();
    return type === "exam";
  }
  const day = new Date(d+"T00:00:00").getDay();
  const wd = getWorkingDaysForBatch(batchName);
  return asBool(wd[day] ?? wd[String(day)]);
}
function isWorkingDayForContext(d, ctx){
  if(!ctx || ctx.type === "global") return isWorkingDayUI(d);
  if(ctx.type === "class") return isWorkingDayForClass(d, ctx.name);
  if(ctx.type === "batch") return isWorkingDayForBatch(d, ctx.name);
  return isWorkingDayUI(d);
}
function getScheduleTiming(ctx){
  const gPresent = Settings.presentCutoff || "08:00";
  const gLate = Settings.lateCutoff || Settings.lateAfter || "08:30";
  if(!ctx || ctx.type === "global"){
    return {
      presentCutoff: gPresent,
      lateCutoff: gLate,
      isInherited: false,
      level: "global"
    };
  }
  if(ctx.type === "class"){
    const entry = ClassSchedules[ctx.name];
    const cp = entry && entry.presentCutoff ? entry.presentCutoff : null;
    const cl = entry && entry.lateCutoff ? entry.lateCutoff : null;
    const hasCustom = Boolean(cp || cl);
    return {
      presentCutoff: cp || gPresent,
      lateCutoff: cl || gLate,
      isInherited: !hasCustom,
      level: "class",
      customPresent: cp,
      customLate: cl
    };
  }
  if(ctx.type === "batch"){
    const entry = BatchSchedules[ctx.name];
    const bp = entry && entry.presentCutoff ? entry.presentCutoff : null;
    const bl = entry && entry.lateCutoff ? entry.lateCutoff : null;
    if(bp || bl){
      return {
        presentCutoff: bp || gPresent,
        lateCutoff: bl || gLate,
        isInherited: false,
        level: "batch",
        customPresent: bp,
        customLate: bl
      };
    }
    if(ctx.name.includes("|")){
      const grade = ctx.name.split("|")[0].trim();
      const cEntry = ClassSchedules[grade];
      if(cEntry && (cEntry.presentCutoff || cEntry.lateCutoff)){
        return {
          presentCutoff: cEntry.presentCutoff || gPresent,
          lateCutoff: cEntry.lateCutoff || gLate,
          isInherited: true,
          level: "class"
        };
      }
    }
    return {
      presentCutoff: gPresent,
      lateCutoff: gLate,
      isInherited: true,
      level: "global"
    };
  }
  return { presentCutoff: gPresent, lateCutoff: gLate, isInherited: false, level: "global" };
}
async function persistCalendar(){
  try{
    await api("/api/settings",{method:"POST",body:JSON.stringify({
      holidays: holidaysToBackend(), overrides: overridesToBackend(), workingDays: Settings.workingDays,
      classSchedules: classSchedulesToBackend(), batchSchedules: batchSchedulesToBackend()
    })});
    cacheSave();
    return true;
  }catch(e){ await glassAlert("Failed to save calendar: "+e.message); }
  return false;
}
function fmtD25(iso){ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||""); if(!m) return iso||"—"; return (+m[3])+" "+MONTHS_S[+m[2]-1]+" "+m[1]; }
function fmtT12(hhmm){ const m=/^(\d{1,2}):(\d{2})/.exec(hhmm||""); if(!m) return ""; let h=+m[1]; const ap=h>=12?"PM":"AM"; h=h%12; if(h===0)h=12; return h+":"+m[2]+" "+ap; }
function fmtTRange(a,b){ const x=fmtT12(a), y=fmtT12(b); return x&&y?x+"–"+y:(x||y); }
function renderHolidays(){
  const hBadge = $("holidayCountBadge"); if(hBadge) hBadge.textContent = Holidays.length;
  if(!holidayBody) return;
  if(!Holidays.length){
    holidayBody.innerHTML=`<p class="sub" style="padding:12px 0">No holidays or vacations configured. Use + Add holiday in Setup to schedule school-wide breaks and exam days.</p>`;
    return;
  }
  holidayBody.innerHTML=Holidays.map(h=>{
    const typeTxt = h.type === "exam" ? "Exam · working" : (h.type||"Holiday");
    const span = h.start===h.end?fmtD25(h.start):(fmtD25(h.start)+" → "+fmtD25(h.end));
    const tm = fmtTRange(h.startTime,h.endTime);
    return `<div class="vrow">
      <div><span>${esc(h.name)}</span><small>${esc(span)}${tm?esc(" · "+tm):""} · ${esc(typeTxt)}</small></div>
      <button type="button" data-edit-holiday="${esc(h.start)}">Edit</button>
      <button type="button" data-del-holiday="${esc(h.start)}">Remove</button>
    </div>`;
  }).join("");
  try{ renderCbTables(); }catch(e){}
}
function renderOverrides(){
  const oBadge = $("overrideCountBadge"); if(oBadge) oBadge.textContent = Overrides.length;
  if(!overrideBody) return;
  if(!Overrides.length){
    overrideBody.innerHTML=`<p class="sub" style="padding:12px 0">No date overrides configured. Use + Add override in Setup for single-day schedule exceptions.</p>`;
    return;
  }
  overrideBody.innerHTML=Overrides.map(o=>{
    const statusText = o.isWorking ? "Working" : "Holiday";
    const tm = fmtTRange(o.startTime,o.endTime);
    return `<div class="vrow">
      <div><span>${esc(fmtD25(o.date))}${tm?esc(" · "+tm):""}</span><small>${esc(statusText)}${o.note?esc(" — "+o.note):" —"}</small></div>
      <button type="button" data-edit-override="${esc(o.date)}">Edit</button>
      <button type="button" data-del-override="${esc(o.date)}">Remove</button>
    </div>`;
  }).join("");
  try{ renderCbTables(); }catch(e){}
}
function renderWeekly(){
  populateScheduleSelector();
}
function renderCalendarMonth(){
  if(!calendarGrid) return;
  const y=calendarMonth.getFullYear(), m=calendarMonth.getMonth();
  const _mn=$("mnum"), _mname=$("mname"), _myr=$("myr");
  if(_mn) _mn.textContent=String(m+1).padStart(2,"0");
  if(_mname) _mname.textContent=calendarMonth.toLocaleDateString('en-GB',{month:'long'});
  if(_myr) _myr.textContent=y;
  try{ const _t=new Date(), _tb=$("calTodayBtn"); if(_tb) _tb.classList.toggle("here", y===_t.getFullYear()&&m===_t.getMonth()); }catch(_){}
  const ctx = getScheduleContext();
  const first=new Date(y,m,1).getDay(), last=new Date(y,m+1,0).getDate();
  /* Weekday template row owns its own frost window ABOVE the date grid
     (see #calendarHeadGrid): display-only text from the same source as
     renderWeekly (saved values only). Editing moved to the sidebar
     schedule popup, so headers carry no toggle affordance and no click
     target. Same position as before — only a 12px gap separates the two
     windows; column widths match so headers align with the dates below. */
  let tplWd = Settings.workingDays;
  if(selName && (selKind==="class"||selKind==="batch")) tplWd = selKind==="batch" ? getWorkingDaysForBatch(selName) : getWorkingDaysForClass(selName);
  else if(ctx.type === "class") tplWd = getWorkingDaysForClass(ctx.name);
  else if(ctx.type === "batch") tplWd = getWorkingDaysForBatch(ctx.name);
  const tplNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let headHtml=tplNames.map((d,idx)=>{
    const on = asBool(tplWd[idx] ?? tplWd[String(idx)]);
    return `<span class="${on?"":"dim"}">${d}</span>`;
  }).join("");
  let html="", workCount=0;
  for(let i=0;i<first;i++) html+=`<div class="d empty" aria-hidden="true"></div>`;
  for(let d=1;d<=last;d++){
    const iso=toLocalISO(new Date(y,m,d));
    const hol=isHoliday(iso), ov=getOverride(iso), todayCls=iso===todayISO()?" today":"";
    const working = isWorkingDayForContext(iso, ctx);
    if(working) workCount++;
    const typeCls = ov ? "ovr" : (hol ? "hol" : (working ? "" : "off"));
    const lab = ov ? esc(ov.note)+esc(fmtTimes(ov)) : (hol ? esc(hol.name)+esc(fmtTimes(hol)) : "");
    html+=`<div class="d${typeCls?" "+typeCls:""}${todayCls}" data-date="${iso}"${lab?` title="${lab}"`:""}><b>${d}</b>${lab?`<i>${lab}</i>`:""}</div>`;
  }
  for(let i=0, trail=(7-((first+last)%7))%7;i<trail;i++) html+=`<div class="d empty" aria-hidden="true"></div>`;
  const _rowsN=Math.ceil((first+last)/7);
  /* Track floor matches the .d cell min-height in CSS (66px): with a 0
     minimum the bounded pane squeezed tracks below cell height and cells
     overflowed into each other (cubes touching). Floor forces scroll
     instead of overlap. Keep in sync with .d min-height. */
  try{ calendarGrid.style.gridTemplateRows=`repeat(${_rowsN},minmax(66px,1fr))`; }catch(_){}
  /* Month fraction readout (reference 2/4 datum): working days in the
     current view for the current context. Node persists (hidden truth
     when absent); paint only. */
  const wf=$("calWorkFracNum");
  if(wf) wf.textContent=workCount+"/"+last;
  const headEl=(typeof calendarHeadGrid!=="undefined"&&calendarHeadGrid)||$("calendarHeadGrid");
  if(headEl){ headEl.innerHTML=headHtml; calendarGrid.innerHTML=html; }
  else{ calendarGrid.innerHTML=headHtml+html; }
}
/* Class cubes: display regroup only — batches stay one flat global
   list, zero data change. Batch B nests under class C iff ≥1 student
   has class=C AND batch=B (same Students/Batches state the selector
   uses); a batch used by two classes shows under both. Batches with
   zero students anywhere collect in an Ungrouped cube last. */
let selKind="class", selName=null; // master-detail selection (class or batch tile)
let cubeView="class"; // left list shows one kind at a time (CLASSES|BATCHES tabs)
function syncCsCtx(){ csCtx={type:selKind,name:selName}; }
function batchesForClass(c){
  return [...new Set(Students.filter(s=>s.class===c).map(s=>s.batch).filter(Boolean))].sort();
}
function allBatchesList(){
  return [...new Set([...(Batches||[]), ...Students.map(s=>s.batch).filter(Boolean)])].sort();
}
/* Class↔batch linkage (user order): batches are one flat global list;
   a batch belongs to a class via (a) a shared global name, (b) a
   composite schedule key "Class|Batch" (per-class timing), or
   (c) a student carrying both. Short names display; full keys target. */
function splitBatchKey(k){
  const m=/^([^|]+)\|(.+)$/.exec(String(k||"").trim());
  return m?{cls:m[1].trim(),short:m[2].trim()}:{cls:"",short:String(k||"").trim()};
}
/* Short batch names usable by class c (enrollment dropdowns). */
function classBatchNames(c){
  const out=[], seen=new Set();
  const push=n=>{ n=String(n||"").trim(); const l=n.toLowerCase(); if(n&&!seen.has(l)){ seen.add(l); out.push(n); } };
  (Batches||[]).forEach(push);
  Object.keys(BatchSchedules||{}).forEach(k=>{ const p=splitBatchKey(k); if(p.cls===c) push(p.short); });
  (Students||[]).forEach(s=>{ if(s&&s.class===c&&s.batch) push(s.batch); });
  return out.sort((a,b)=>String(a).localeCompare(String(b)));
}
/* Board rows for the Batches table: {key, label}. Unscoped shows
   globals plus every composite (suffixed); scoped shows the class's
   set under short names. */
function batchBoardEntries(scope){
  const rows=[];
  const globals=[...(Batches||[])].sort((a,b)=>String(a).localeCompare(String(b)));
  const composites=Object.keys(BatchSchedules||{}).filter(k=>k.includes("|")).sort((a,b)=>String(a).localeCompare(String(b)));
  if(!scope){
    globals.forEach(n=>rows.push({key:n,label:n}));
    composites.forEach(k=>{ const p=splitBatchKey(k); rows.push({key:k,label:p.short+" · "+p.cls}); });
    return rows;
  }
  const pool=[];
  globals.forEach(n=>pool.push({key:n,label:n}));
  composites.forEach(k=>{ const p=splitBatchKey(k); if(p.cls===scope) pool.push({key:k,label:p.short}); });
  (Students||[]).forEach(s=>{ if(s&&s.class===scope&&s.batch) pool.push({key:s.batch,label:s.batch}); });
  /* Composites first on ties ("9|A" overrides shared "A" for class 9 —
     same precedence as attendance resolution), then first-wins. */
  pool.sort((a,b)=>String(a.label).localeCompare(String(b.label))||((b.key.includes("|")?1:0)-(a.key.includes("|")?1:0)));
  const seen=new Set(), out=[];
  pool.forEach(r=>{ const l=splitBatchKey(r.key).short.toLowerCase(); if(!seen.has(l)){ seen.add(l); out.push(r); } });
  return out;
}
function batchRowCount(key, scope){
  const p=splitBatchKey(key);
  const isActive=s=>s&&(s.active!==false&&s.active!==0);
  /* Shared rows skip students whose class owns a composite for that
     name (they resolve to the composite, not the shared timing). */
  const compHere=new Set();
  if(!p.cls){
    Object.keys(BatchSchedules||{}).forEach(k=>{ const q=splitBatchKey(k); if(q.cls) compHere.add(q.cls+","+q.short.toLowerCase()); });
  }
  return Students.filter(s=>isActive(s)&&s.batch===p.short&&(!scope||s.class===scope)&&(p.cls ? s.class===p.cls : !compHere.has(s.class+","+p.short.toLowerCase()))).length;
}
/* Batches-board scope: null = all, else a class name. Follows class
   selection; cleared by chip, toolbar retarget, or class removal. */
let cbBatchScope=null;
/* Tab switch: left list swaps kind; selection follows into the
   shown kind (first item) so the right card never disagrees. */
function setCubeView(v){
  cubeView=(v==="batch")?"batch":"class";
  const pool=(cubeView==="batch")?allBatchesList():Classes;
  if(!pool.includes(selName)){ selKind=cubeView; selName=pool[0]||null; }
  syncCsCtx();
  const sel=$("calClassSelect");
  if(sel&&selName){
    sel.value = selKind==="class"?`class:${selName}`:`batch:${selName}`;
    if(selKind==="class"&&!sel.value) sel.value=selName;
    renderWeekly(); renderCalendarMonth();
  }
  renderClasses();
}
function renderClasses(){
  if(!classCubes) return;
  const tabC=$("cubeTabClasses"), tabB=$("cubeTabBatches");
  if(tabC) tabC.classList.toggle("active",cubeView==="class");
  if(tabB) tabB.classList.toggle("active",cubeView==="batch");
  const classRow=$("classAddRow"), batchRow=$("batchAddRow");
  if(classRow) classRow.hidden=(cubeView!=="class");
  if(batchRow) batchRow.hidden=(cubeView!=="batch");
  /* Static skeleton: #cubeGrid list + wall + #classDetail month.
     Only the list refills here; selection changes clear staged
     month edits, then the inline month editor repaints. */
  const grid=$("cubeGrid");
  if(!grid) return;
  if(!Classes.length){ selKind="class"; selName=null; grid.innerHTML=`<div class="empty" style="padding:14px;font-size:10px"><b>No classes configured</b></div>`; syncMonthEditor(); return; }
  const allBatches=allBatchesList();
  const pool=(cubeView==="batch")?allBatches:Classes;
  const prevKey=selName?selKind+":"+selName:null;
  const valid=(selKind===cubeView&&pool.includes(selName));
  if(!valid){ selKind=cubeView; selName=pool[0]||null; }
  if((selName?selKind+":"+selName:null)!==prevKey) pendingDays={};
  syncCsCtx();
  const tile=(k,label,n)=>{ const bin=`<span class="cube-actions"><button data-del-${k}="${esc(label)}" aria-label="Remove ${k}">Remove</button></span>`; return `<div class="class-cube${selKind===k&&selName===label?" active":""}" data-kind="${k}" data-cube="${esc(label)}" role="tab"><span class="cube-name">${esc(label)}</span><span class="cube-count">${n}</span>${bin}</div>`; };
  const rows=(cubeView==="batch"?allBatches:Classes).map(label=>tile(cubeView,label,Students.filter(s=>cubeView==="batch"?s.batch===label:s.class===label).length)).join("");
  grid.innerHTML=rows;
  syncMonthEditor();
}
/* Bottom strip tables: read-only classes/batches with active-student
   counts (missing/legacy records count as active — only explicit
   inactive students are excluded). Row click previews that schedule
   in the month above (same retarget flow as the toolbar selector). */
function renderCbTables(){
  const cr=$("cbClassRows"), br=$("cbBatchRows");
  if(!cr||!br) return;
  const isActive=s=>s&&(s.active!==false&&s.active!==0);
  if($("cbClassCount")) $("cbClassCount").textContent=Classes.length;
  const tileTxt=s=>{ const m=/\d+/.exec(s||""); return m?m[0]:((s||"").trim().charAt(0).toUpperCase()||"–"); };
  const row=(kind,key,label,n)=>{
    const sel=(selKind===kind&&selName===key)?" active":"";
    const dim=n===0?" dim":"";
    return `<div class="row${sel}${dim}" data-cb-kind="${kind}" data-cb-name="${esc(key)}" role="button" tabindex="0"><span class="tile" aria-hidden="true">${esc(tileTxt(label))}</span><span class="cell"><span class="t">${esc(label)}</span><small>${n}</small></span><button type="button" data-cb-edit-kind="${kind}" data-cb-edit-name="${esc(key)}" aria-label="Edit" title="Edit">Edit</button></div>`;
  };
  cr.innerHTML=Classes.length?Classes.map(c=>{ const _n=Students.filter(s=>isActive(s)&&s.class===c).length; return row("class",c,c,_n+(_n===1?" student":" students")); }).join(""):`<p class="empty-l">No classes yet — use + Add class below.</p>`;
  if(cbBatchScope&&!Classes.includes(cbBatchScope)) cbBatchScope=null;
  const bEntries=batchBoardEntries(cbBatchScope);
  if($("cbBatchCount")) $("cbBatchCount").textContent=bEntries.length;
  const scopeBtn=$("cbBatchScope");
  if(scopeBtn){
    if(cbBatchScope){ scopeBtn.hidden=false; scopeBtn.textContent=cbBatchScope+" ×"; scopeBtn.title="Show all batches"; }
    else scopeBtn.hidden=true;
  }
  br.innerHTML=bEntries.length?bEntries.map(e=>{ const _n=batchRowCount(e.key,cbBatchScope); return row("batch",e.key,e.label,_n+(_n===1?" student":" students")); }).join(""):(cbBatchScope?`<p class="empty-l">No batches for ${esc(cbBatchScope)} yet — use + to add one.</p>`:`<p class="empty-l">No batches yet — use + Add batch below.</p>`);
  /* Page 2: holidays & overrides. Past entries dim so actives read
     instantly; headers carry the active (today-or-later) counts. */
  const t=todayISO();
  const MS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dShort=iso=>{ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||""); return m?(+m[3])+" "+MS[+m[2]-1]:"—"; };
  const rangeShort=(a,b)=>{
    if(!a) return "—"; if(!b||b===a) return dShort(a);
    const ma=/^(\d{4})-(\d{2})-(\d{2})$/.exec(a), mb=/^(\d{4})-(\d{2})-(\d{2})$/.exec(b);
    if(ma&&mb&&ma[1]===mb[1]&&ma[2]===mb[2]) return (+ma[3])+"-"+(+mb[3])+" "+MS[+mb[2]-1];
    return dShort(a)+"→"+dShort(b);
  };
  const hr=$("cbHolidayRows"), or_=$("cbOverrideRows");
  if(hr&&or_){
    const hoRow=(kind,key,label,meta,past,title)=>{
      const sel=((kind==="holiday"&&selHolidayKey===key)||(kind==="override"&&selOverrideKey===key))?" active":"";
      const tile=kind==="holiday"
        ?`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16"/><line x1="16" y1="3" x2="16" y2="7"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`
        :`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 3"/></svg>`;
      return `<div class="row${sel}${past?" dim":""}" data-ho-kind="${kind}" data-ho-key="${esc(key)}" role="button" tabindex="0" title="${esc(title||"")}"><span class="tile" aria-hidden="true">${tile}</span><span class="cell"><span class="t">${esc(label)}</span><small>${esc(meta)}</small></span><button type="button" data-ho-edit="${kind}" data-ho-key="${esc(key)}" aria-label="Edit" title="Edit">Edit</button></div>`;
    };
    const _nh=Holidays.filter(h=>h.end>=t).length, _no=Overrides.filter(o=>o.date>=t).length;
    if($("cbHolidayCount")) $("cbHolidayCount").textContent=_nh;
    if($("cbOverrideCount")) $("cbOverrideCount").textContent=_no;
    hr.innerHTML=Holidays.length?Holidays.map(h=>hoRow("holiday",h.start,h.name||"Holiday",rangeShort(h.start,h.end)+fmtTimes(h),h.end<t,(h.name||"Holiday")+" "+(h.start===h.end?h.start:(h.start+".."+h.end))+fmtTimes(h)+" ("+(h.type||"holiday")+")")).join(""):`<p class="empty-l">No holidays yet — use + Add holiday below.</p>`;
    or_.innerHTML=Overrides.length?Overrides.map(o=>hoRow("override",o.date,o.note?dShort(o.date)+" — "+o.note:dShort(o.date),dShort(o.date)+" · "+(o.isWorking?"Working":"Holiday")+fmtTimes(o),o.date<t,o.date+fmtTimes(o)+" → "+(o.isWorking?"working":"non-working")+(o.note?": "+o.note:""))).join(""):`<p class="empty-l">No overrides yet — use + Add override below.</p>`;
  }
  paintCbPage(cbPage);
}
/* Single board (H single-window law): the ‹ › pager carousel is retired —
   Classes · Batches and Holidays · Overrides always stack visible in the
   one frost window, so paintCbPage pins both pages open. Nodes stay
   (hidden pager + label remain logic truth for tests/wiring). */
let cbPage=0;
let selHolidayKey=null, selOverrideKey=null;
function editTarget(kind){
  if(selKind===kind&&selName) return {type:kind,name:selName};
  const c=getScheduleContext();
  if(c.type===kind&&c.name) return c;
  return null;
}
function paintCbPage(i){
  cbPage=0;
  const p0=$("cbPageCb"), p1=$("cbPageHo"), lab=$("cbPageLabel");
  if(p0) p0.hidden=false;
  if(p1) p1.hidden=false;
  if(lab) lab.textContent="CLASSES · BATCHES · HOLIDAYS · OVERRIDES";
}
function onCbStripClick(e){
  const del=e.target.closest("[data-cb-del-kind],[data-ho-del]");
  if(del){ onCbDel(del); return; }
  /* Row-tap editors: tapping anywhere on the row opens the same
     editor as the Edit button. Delete lives inside the Edit popup. */
  const ed=e.target.closest("[data-cb-edit-kind],[data-ho-edit]");
  if(ed){
    if(ed.dataset.hoEdit){
      if(ed.dataset.hoEdit==="holiday"){ selHolidayKey=ed.dataset.hoKey; renderCbTables(); openHolidayEdit(selHolidayKey); }
      else{ selOverrideKey=ed.dataset.hoKey; renderCbTables(); openOverrideEdit(selOverrideKey); }
    }else{
      selKind=ed.dataset.cbEditKind; selName=ed.dataset.cbEditName; syncCsCtx();
      if(selKind==="class") cbBatchScope=selName;
      pendingDays={};
      cubeView=selKind;
      renderWeekly(); renderClasses();
      const sel=$("calClassSelect");
      if(sel&&selName){
        sel.value=selKind==="class"?`class:${selName}`:`batch:${selName}`;
        if(selKind==="class"&&!sel.value) sel.value=selName;
      }
      renderCalendarMonth(); renderCbTables();
      if(currentTab==="attendance") renderAttendance();
      openSchedPopup(selKind,selName);
    }
    return;
  }
  const ho=e.target.closest("[data-ho-kind]");
  if(ho){
    /* Row tap SELECTS only — the brown tile marks where you are, exactly as
       Classes and Batches now do. The edit window is opened by the pencil
       button alone ([data-ho-edit] below), so tapping a row can no longer
       throw a form over the list the user is trying to read. */
    if(ho.dataset.hoKind==="holiday") selHolidayKey=ho.dataset.hoKey;
    else selOverrideKey=ho.dataset.hoKey;
    renderCbTables();
    return;
  }
  /* Class/batch row tap: preview only (no popup — the pencil opens
     editors). Context sync + repaints stay. */
  const r=e.target.closest("[data-cb-kind]"); if(!r) return;
  selKind=r.dataset.cbKind; selName=r.dataset.cbName; syncCsCtx();
  /* Class tap also scopes the Batches board (toggle); month preview
     below is untouched (row-tap-no-popup contract holds). */
  if(r.dataset.cbKind==="class") cbBatchScope=(cbBatchScope===r.dataset.cbName)?null:r.dataset.cbName;
  pendingDays={};
  cubeView=selKind;
  renderWeekly(); renderClasses();
  const sel=$("calClassSelect");
  if(sel&&selName){
    sel.value=selKind==="class"?`class:${selName}`:`batch:${selName}`;
    if(selKind==="class"&&!sel.value) sel.value=selName;
  }
  renderCalendarMonth(); renderCbTables();
  if(currentTab==="attendance") renderAttendance();
}
async function onCbDel(del){
  if(del.dataset.cbDelKind){
    const kind=del.dataset.cbDelKind, name=del.dataset.cbDelName;
    if(kind==="class"){
      if(!(await glassConfirm(`Remove class "${name}"?`,{title:"Remove class",okText:"Remove",danger:true}))) return;
      try{
        const next=Classes.filter(x=>x!==name);
        /* Drop its schedule + per-class batches with it (user order):
           orphans never linger server-side. */
        delete ClassSchedules[name]; ClassSchedulesUI=ClassSchedules;
        Object.keys(BatchSchedules).forEach(k=>{ if(splitBatchKey(k).cls===name) delete BatchSchedules[k]; });
        if(cbBatchScope===name) cbBatchScope=null;
        if(selKind==="class"&&selName===name){ selKind="class"; selName=null; pendingDays={}; syncCsCtx(); }
        await api("/api/settings",{method:"POST",body:JSON.stringify({classes:next})});
        await persistCalendar();
        await loadClassesHolidaysSettings(); renderAll();
      }catch(err){ await glassAlert("Failed to remove class: "+err.message); }
    }else{
      if(name.includes("|")){
        const p=splitBatchKey(name);
        if(!(await glassConfirm(`Remove batch "${p.short}" from "${p.cls}"? Students keep the batch name and fall back to shared timing.`,{title:"Remove batch",okText:"Remove",danger:true}))) return;
        try{
          delete BatchSchedules[name];
          if(selKind==="batch"&&selName===name){ selName=null; }
          if(await persistCalendar()){ await loadClassesHolidaysSettings(); renderAll(); }
        }catch(err){ await glassAlert("Failed to remove batch: "+err.message); }
        return;
      }
      if(!(await glassConfirm(`Remove batch "${name}"?`,{title:"Remove batch",okText:"Remove",danger:true}))) return;
      try{
        if(!(Batches||[]).some(b=>b===name)){ await glassAlert(`"${name}" is carried by student records and cannot be removed here.`); return; }
        const next=(Batches||[]).filter(x=>x!==name);
        delete BatchSchedules[name];
        await api("/api/settings",{method:"POST",body:JSON.stringify({batches:next})});
        await persistCalendar();
        await loadClassesHolidaysSettings(); renderAll();
      }catch(err){ await glassAlert("Failed to remove batch: "+err.message); }
    }
    return;
  }
  const hk=del.dataset.hoKey;
  if(del.dataset.hoDel==="holiday"){
    if(selHolidayKey===hk) selHolidayKey=null;
    Holidays=Holidays.filter(h=>h.start!==hk);
    if(await persistCalendar()){ renderHolidays(); renderCalendarMonth(); }
  }else if(del.dataset.hoDel==="override"){
    if(selOverrideKey===hk) selOverrideKey=null;
    Overrides=Overrides.filter(o=>o.date!==hk);
    if(await persistCalendar()){ renderOverrides(); renderCalendarMonth(); }
  }
}
function cbEditKind(kind, singular){
  const t=editTarget(kind);
  if(!t){ glassAlert("Select "+singular+" in the table first."); return; }
  openSchedPopup(t.type,t.name);
}
if($("cbAddClass")) $("cbAddClass").onclick=()=>openSchedPopup("class",null);
if($("cbAddBatch")) $("cbAddBatch").onclick=()=>openSchedPopup("batch",null,cbBatchScope);
if($("cbEditClass")) $("cbEditClass").onclick=()=>cbEditKind("class","a class");
if($("cbEditBatch")) $("cbEditBatch").onclick=()=>cbEditKind("batch","a batch");
if($("cbAddHoliday")) $("cbAddHoliday").onclick=()=>openHolidayCreate();
if($("cbAddOverride")) $("cbAddOverride").onclick=()=>openOverrideCreate();
if($("cbEditHoliday")) $("cbEditHoliday").onclick=()=>{ if(!selHolidayKey){ glassAlert("Select a holiday in the table first."); return; } openHolidayEdit(selHolidayKey); };
if($("cbEditOverride")) $("cbEditOverride").onclick=()=>{ if(!selOverrideKey){ glassAlert("Select an override in the table first."); return; } openOverrideEdit(selOverrideKey); };
/* Delegation hosts. The Setup 2 cards were moved OUT of #cbStrip into their own
   pane when Setup 2 was created, but this handler was left bound to #cbStrip
   alone — so inside those cards nothing worked: Edit Class/Batch/Holiday/
   Override opened no window (verified: the modal stayed display:none even for
   a programmatic button.click(), so it was never the pointer path), row taps
   changed nothing, the scope/page buttons were dead, and Enter/Space did
   nothing. Both hosts are subtrees of .app and disjoint, so binding both runs
   the handler exactly once per click. Handler bodies are unchanged, and the
   host is the PANE, not a list, so it survives renderCbTables() re-rendering
   the cards. */
const cbDelegHosts=[$("cbStrip"), $("setupLists")].filter(Boolean);
for(const cbHost of cbDelegHosts){
  cbHost.addEventListener("click",(e)=>{
    if(e.target.closest("#cbBatchScope")){ cbBatchScope=null; renderCbTables(); return; }
    if(e.target.closest("#cbPrev")){ paintCbPage(cbPage-1); return; }
    if(e.target.closest("#cbNext")){ paintCbPage(cbPage+1); return; }
    onCbStripClick(e);
  });
  /* Row Enter/Space previews like a tap (user order): pencil and
     trash are native buttons with their own keyboard keys. */
  cbHost.addEventListener("keydown",(e)=>{
    if(e.target.closest("button")) return;
    if((e.key==="Enter"||e.key===" ")&&e.target.closest("[data-cb-kind],[data-ho-kind]")){ e.preventDefault(); onCbStripClick(e); }
  });
}
/* Inline month editor: staged days + snapshot + strip paint. Toggles
   stage into pendingDays (never persisted); Save composes staged days
   into the existing ClassSchedules/BatchSchedules entry, then runs the
   existing timing save; Cancel restores the snapshot. */
let pendingDays={};
let schedSnapshot=null;
function meKey(){ return selName ? selKind+":"+selName : null; }
function snapshotSchedule(){
  if(!selName){ schedSnapshot=null; return; }
  const wd = selKind==="batch" ? getWorkingDaysForBatch(selName) : getWorkingDaysForClass(selName);
  const t = getScheduleTiming({type:selKind,name:selName});
  schedSnapshot={kind:selKind,name:selName,wd:{...wd},present:t.presentCutoff,late:t.lateCutoff};
}
function paintMonthEditor(){
  const ed=$("monthEditor"); if(!ed) return;
  ed.style.display=schedSnapshot?"":"none";
  if(!schedSnapshot) return;
  if($("csPresentCutoff")) $("csPresentCutoff").value=schedSnapshot.present;
  if($("csLateCutoff")) $("csLateCutoff").value=schedSnapshot.late;
}
function syncMonthEditor(){
  const grid=$("cubeGrid");
  if(grid) grid.querySelectorAll(".class-cube").forEach(t=>t.classList.toggle("active",t.dataset.kind===selKind&&t.dataset.cube===selName));
  snapshotSchedule(); paintMonthEditor(); renderCalendarMonth();
}
async function onMeSave(){
  if(!selName) return;
  const key=selKind+":"+selName;
  if(pendingDays[key]){
    if(selKind==="batch"){
      const entry=BatchSchedules[selName]||{};
      BatchSchedules[selName]=Object.assign({}, typeof entry==="object"?entry:{}, {workingDays: pendingDays[key]});
    } else if(selKind==="class"){
      const entry=ClassSchedules[selName]||{};
      ClassSchedules[selName]=Object.assign({}, typeof entry==="object"?entry:{}, {workingDays: pendingDays[key]});
      ClassSchedulesUI=ClassSchedules;
    }
    delete pendingDays[key];
  }
  await onCsSaveTiming();
}
function onMeCancel(){
  const key=meKey(); if(key) delete pendingDays[key];
  snapshotSchedule(); paintMonthEditor(); renderCalendarMonth();
}
/* Static strip wiring (nodes persist — wire once, not per render). */
function wireSchedEditor(){
  if($("csSaveTiming")) $("csSaveTiming").onclick=onMeSave;
  if($("csCancelTiming")) $("csCancelTiming").onclick=onMeCancel;
}
function formatAuditDetails(raw, action){
  if(!raw) return "—";
  const text = String(raw).trim();
  if(!text) return "—";

  // Parse JSON objects or extract key settings if JSON was serialized
  let obj = null;
  if((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))){
    try {
      obj = JSON.parse(text);
    } catch(e) {
      obj = null;
    }
  }

  if(obj && typeof obj === "object" && !Array.isArray(obj) &&
     ("frequency" in obj || "weekdays" in obj || "intervalDays" in obj)){
    // Backup schedule shapes read as short human words ("Daily · 18:30").
    if(obj.enabled === false) return "Off";
    const t = obj.time || "";
    const f = String(obj.frequency || "daily").toLowerCase();
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const days = Array.isArray(obj.weekdays)
      ? obj.weekdays.map(d => dayNames[d]).filter(Boolean) : [];
    if(f === "weekdays"){
      if(days.length === 0 || days.length === 7) return t ? `Daily · ${t}` : "Daily";
      return t ? `${days.join(", ")} · ${t}` : days.join(", ");
    }
    if(f === "interval"){
      const n = parseInt(obj.intervalDays, 10) || 1;
      if(n <= 1) return t ? `Daily · ${t}` : "Daily";
      return t ? `Every ${n} days · ${t}` : `Every ${n} days`;
    }
    return t ? `Daily · ${t}` : "Daily";
  }

  if(obj && typeof obj === "object" && !Array.isArray(obj)){
    const labelMap = {
      schoolName: "School",
      region: "Region",
      academicYear: "Academic year",
      schoolOpeningDate: "Opening date",
      attendanceStartDate: "Attendance start",
      presentCutoff: "Present cutoff",
      lateCutoff: "Late cutoff",
      lateThreshold: "Late cutoff",
      minPercent: "Min attendance"
    };
    const parts = [];
    const priorityKeys = [
      "schoolName", "region", "academicYear", "schoolOpeningDate",
      "presentCutoff", "lateCutoff"
    ];
    for(const k of priorityKeys){
      if(obj[k] !== undefined && obj[k] !== null && obj[k] !== ""){
        parts.push(`${labelMap[k]}: ${obj[k]}`);
      }
    }
    // Include other simple settings
    for(const [k, v] of Object.entries(obj)){
      if(!priorityKeys.includes(k) && labelMap[k] && v !== undefined && v !== null && v !== "" && typeof v !== "object"){
        const val = (k === "minPercent") ? `${v}%` : v;
        parts.push(`${labelMap[k]}: ${val}`);
      }
    }
    if(parts.length > 0){
      return parts.join(" · ");
    }
  }

  // Handle truncated JSON strings (e.g. [:500] from backend)
  if(text.startsWith("{") && (text.includes('"schoolName"') || text.includes('"presentCutoff"'))){
    const labelMap = {
      schoolName: "School",
      region: "Region",
      academicYear: "Academic year",
      schoolOpeningDate: "Opening date",
      presentCutoff: "Present cutoff",
      lateCutoff: "Late cutoff"
    };
    const parts = [];
    for(const [k, label] of Object.entries(labelMap)){
      const re = new RegExp(`"${k}"\\s*:\\s*"([^"\\\\]*)"`);
      const m = text.match(re);
      if(m && m[1]){
        parts.push(`${label}: ${m[1]}`);
      }
    }
    if(parts.length > 0){
      return parts.join(" · ");
    }
  }

  const cap = (s, n) => s.length > n ? s.slice(0, n).trimEnd() + "…" : s;

  // Backup runs ("Uploaded atl-backup-….db (123 bytes, sha256:…, trigger:manual)")
  // read as short human words — filename plus trigger only.
  let m = text.match(/^(Uploaded|Saved)\s+(\S+?)\s*\(([^)]*)\)\s*$/);
  if(m){
    const trig = (m[3].match(/trigger\s*:\s*([A-Za-z]+)/) || [])[1] || "";
    const verb = m[1] === "Saved" ? "Saved" : "Sent";
    return trig ? `${verb} ${m[2]} · ${trig}` : `${verb} ${m[2]}`;
  }

  // Attendance correction ("sid 5 2026-09-11 PRESENT->LATE reason:late bus").
  m = text.match(/^sid\s+(\S+)\s+(\S+)\s+(\S+?)\s*->\s*(\S+)\s+reason:(.*)$/);
  if(m) return `${m[1]} · ${m[2]} · ${m[3]} → ${m[4]} · ${m[5].trim()}`;

  // Absence reconciliation ("4 absent 0 not_scheduled 2026-09-11").
  m = text.match(/^(\d+)\s+absent\s+(\d+)\s+not_scheduled\s+(\S+)\s*$/);
  if(m) return `${m[1]} absent · ${m[2]} not scheduled · ${shortAuditDate(m[3])}`;

  // Student field update ("id 3 ['name','phone']").
  m = text.match(/^id\s+(\d+)\s*\[(.*)\]\s*$/);
  if(m){
    const fields = m[2].replace(/['"]/g, "").split(/\s*,\s*/).filter(Boolean).join(", ");
    return fields ? `Student ${m[1]} · ${fields}` : `Student ${m[1]}`;
  }

  // Finger slot move ("id 5 3->7").
  m = text.match(/^id\s+(\d+)\s+(\d+)\s*->\s*(\d+)\s*$/);
  if(m) return `Student ${m[1]} · slot ${m[2]} → ${m[3]}`;

  // Removed student ("Aarav fid 5 ok").
  m = text.match(/^(.+?)\s+fid\s+(\d+)\s*(.*)$/);
  if(m) return `${m[1].trim()} · slot ${m[2]}${m[3].trim() ? " · " + m[3].trim() : ""}`;

  // Any other JSON-ish fragment: strip brackets/quotes, join the pairs.
  if(/[{}\[\]"]/.test(text)){
    const pretty = text.replace(/^[{\[]\s*|\s*[}\]]$/g, "")
      .replace(/["']/g, "")
      .split(/\s*,\s*/)
      .map(p => p.replace(/\s*:\s*/g, ": ").trim())
      .filter(Boolean)
      .join(" · ")
      .replace(/^[·\s]+|[·\s]+$/g, "");
    if(pretty) return cap(pretty, 160);
  }

  return cap(text.replace(/\s+/g, " "), 160);
}

function formatAuditTime(raw){
  const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if(!raw) return "—";
  const text=String(raw).trim();
  // DD/MM/YYYY first (also matches the tail of "YYYY-MM-DD DD/MM/YYYY, HH:MM:SS" composites).
  let m=text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2})/);
  if(m) return `${parseInt(m[1],10)} ${months[parseInt(m[2],10)-1]||""} · ${String(m[4]).padStart(2,"0")}:${m[5]}`;
  m=text.match(/(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})/);
  if(m) return `${parseInt(m[3],10)} ${months[parseInt(m[2],10)-1]||""} · ${String(m[4]).padStart(2,"0")}:${m[5]}`;
  return text;
}

function shortAuditDate(iso){
  const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m=String(iso||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return String(iso||"");
  return `${parseInt(m[3],10)} ${months[parseInt(m[2],10)-1]||""}`;
}

function formatAuditAction(action){
  const map = {
    GDRIVE_BACKUP: "GDrive Backup",
    TELEGRAM_BACKUP: "Telegram Backup",
    USB_BACKUP: "USB Backup",
    GDRIVE_SCHEDULE_CHANGED: "GDrive Schedule",
    TELEGRAM_SCHEDULE_CHANGED: "Telegram Schedule",
    USB_SCHEDULE_CHANGED: "USB Schedule",
    GDRIVE_RESTORE: "GDrive Restore",
    SETTINGS_CHANGED: "Settings",
    STUDENT_ENROLLED: "Enrollment",
    STUDENT_IMPORTED: "Import",
    STUDENT_IMPORTED_CSV: "Import",
    STUDENT_UPDATED: "Student Update",
    STUDENT_DELETED: "Student Removed",
    FINGER_REENROLLED: "Re-enroll",
    ATTENDANCE_CORRECTED: "Correction",
    ATTENDANCE_RECORDED: "Attendance",
    DUPLICATE_SCAN: "Duplicate",
    UNKNOWN_FINGERPRINT: "Unknown Finger",
    NON_WORKING_DAY_SCAN: "Off-day Scan",
    NOT_SCHEDULED_SCAN: "Unscheduled Scan",
    ABSENCE_RECONCILIATION: "Reconciliation",
    GALLERY_CLEARED: "Gallery Cleared"
  };
  if(!action) return "—";
  if(map[action]) return map[action];
  return String(action).split("_").map(w=>w.charAt(0)+w.slice(1).toLowerCase()).join(" ");
}

function renderAudit(){
  const cc=$("auditCount"); if(cc) cc.textContent=Audit.length+(Audit.length===1?" record":" records");
  if(!Audit.length){ auditBody.innerHTML=`<p class="sub" style="padding:12px 0">No audit history. Changes appear here.</p>`; return; }
  auditBody.innerHTML=Audit.map(a=>`<div class="ar audit"><span title="${esc(a.time)}">${esc(formatAuditTime(a.time))}</span><span>${esc(formatAuditAction(a.action))}</span><span>${esc(formatAuditDetails(a.details, a.action))}</span><span>${esc(a.by)}</span></div>`).join("");
}
function renderAll(){
  renderClassFilters();
  renderStudentList();
  renderWeekly();
  renderHolidays();
  renderOverrides();
  renderCalendarMonth();
  renderClasses();
  renderCbTables();
  renderAudit();
  if(currentTab==="attendance") renderAttendance();
}
// ---- ENROLL: information + real fingerprint scan ----
/* Photo picker helper: no file → cb(""); oversize → error shown, cb skipped */
function readPhotoFile(input, errEl, cb){
  const f=input&&input.files&&input.files[0];
  if(!f){ cb(""); return; }
  if(f.size>2*1024*1024){ if(errEl){ errEl.textContent="Photo max 2MB."; errEl.style.display="block"; } return; }
  const r=new FileReader(); r.onload=e=>cb(e.target.result); r.readAsDataURL(f);
}
/* Initials monogram: first letters of the first two words, uppercased */
function studentInitials(name){
  return String(name||"").trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();
}
async function pollEnrollProgress(stepEl, labelEl){
  if(_enrollAbort) return;
  try{
    const p=await api("/api/sensor/progress",{method:"GET"});
    if(p&&labelEl){
      const st=p.state, step=p.step||0;
      if(stepEl) stepEl.textContent=step+"/3";
      try{
        const steps=document.getElementById("scanSteps");
        if(steps) Array.from(steps.querySelectorAll("i")).forEach((el,i)=>el.classList.toggle("on",i<step));
        const sb=document.getElementById("scanStartBtn");
        if(sb&&sb.textContent!=="Done") sb.textContent=step>=3?"Done":(step>0?("Capture "+Math.min(step+1,3)+" of 3"):"Start scan");
      }catch(e){}
      if(st==="place") labelEl.textContent="Place your finger on the sensor";
      else if(st==="hold"||st==="capturing") labelEl.textContent="Place your finger on the sensor";
      else if(st==="enroll_1") labelEl.textContent="Lift, then place the same finger again";
      else if(st==="enroll_2") labelEl.textContent="Lift, then place it once more";
      else if(st==="enroll_3") labelEl.textContent="Fingerprint saved";
    }
  }catch(e){}
  if(!_enrollAbort) _enrollPoll=setTimeout(()=>pollEnrollProgress(stepEl,labelEl),700);
}
function fingerprintScanUI(title, subtitle, onStart, onSuccess, summary){
  setState("ready");
  enrollTitle.textContent=title;
  enrollSub.textContent=subtitle;
  try{ enrollModal.querySelector(".mod").classList.remove("w640"); }catch(e){}
  enrollBody.innerHTML=`
    <div class="scan-sum">${esc(summary||"")}</div>
    <div style="margin-top:28px"><span class="scan-cap">Captures</span><div class="scan-big" id="scanCount">0 / 3</div>
    <div class="scan-steps" id="scanSteps"><i></i><i></i><i></i></div>
    <div class="scan-st" id="scanLabel">Place your finger on the sensor</div>
    <div class="scan-hint">Keep the same finger flat. The sensor light stays on.</div></div>
    <div class="ft"><button id="scanCancelBtn">Cancel</button><button class="go" id="scanStartBtn">Start scan</button></div>
    <div class="err scan-err" id="scanErr" style="display:none"></div>`;
  openModal(enrollModal);
  $("scanCancelBtn").onclick=()=>{ finishEnrollUi(); resumeSensorScan(); };
  $("scanStartBtn").onclick=async()=>{
    $("scanStartBtn").disabled=true;
    $("scanStartBtn").textContent="Capture 1 of 3";
    _enrollAbort=false;
    const stepEl=$("scanCount"), labelEl=$("scanLabel");
    pollEnrollProgress(stepEl,labelEl);
    try{
      const res=await onStart();
      try{ onSuccess(res); }catch(e){}
      const done=$("scanStartBtn"); if(done){ done.textContent="Done"; }
      returnToFrontPage();
    }catch(err){
      _enrollAbort=true;
      if(_enrollPoll) clearTimeout(_enrollPoll);
      const e=$("scanErr"); e.style.display="block";
      e.textContent=err.message||"Scan failed. Check the sensor and try again.";
      const sb=$("scanStartBtn"); sb.disabled=false; sb.textContent="Start scan";
    }
  };
}
/* Plain-text option rows driven by a native select's own value.
   Buttons mirror select.options; a click writes select.value,
   dispatches change (so dependent painters run), and repaints.
   Selects carry data-gsel="1" so the MutationObserver skips them. */
function dlgPaintRow(sel, box){
  if(!sel||!box) return;
  box.innerHTML="";
  Array.from(sel.options).forEach(o=>{
    const b=document.createElement("button"); b.type="button";
    const on=o.value===sel.value;
    b.className=on?"on":""; b.textContent=o.textContent; b.dataset.v=o.value;
    b.setAttribute("role","radio"); b.setAttribute("aria-checked",on?"true":"false");
    b.onclick=()=>{ sel.value=o.value; try{ sel.dispatchEvent(new Event("change",{bubbles:true})); }catch(e){} dlgPaintRow(sel,box); };
    box.appendChild(b);
  });
}
/* Equal-width option cells: the row takes seg sN for N<=4 options so cells
   never wrap; past 4 options the field degrades to the dropdown popover. */
function dlgPaintSegRow(sel, box){
  if(!sel||!box) return;
  const n=Math.min(Math.max(sel.options.length,1),4);
  box.classList.remove("opts","s1","s2","s3","s4");
  box.classList.add("seg","s"+n);
  dlgPaintRow(sel,box);
}
/* Class row degrades to a dropdown button past 4 options. */
function dlgPaintClassRow(sel, box){
  if(!sel||!box) return;
  if(sel.options.length>4){
    box.style.display="none"; sel.classList.remove("dlg-hidden");
    try{ sel.removeAttribute("data-gsel"); }catch(e){}
    try{ if(window.__ensureGsel) window.__ensureGsel(sel); }catch(e){}
  }
  else{ box.style.display=""; sel.classList.add("dlg-hidden"); try{ sel.setAttribute("data-gsel","1"); }catch(e){} dlgPaintSegRow(sel,box); }
}
/* Batch row follows the same rule as classes. */
function dlgPaintBatchRow(sel, box){
  if(!sel||!box) return;
  if(sel.options.length>4){
    box.style.display="none"; sel.classList.remove("dlg-hidden");
    try{ sel.removeAttribute("data-gsel"); }catch(e){}
    try{ if(window.__ensureGsel) window.__ensureGsel(sel); }catch(e){}
  }
  else{ box.style.display=""; sel.classList.add("dlg-hidden"); try{ sel.setAttribute("data-gsel","1"); }catch(e){} dlgPaintSegRow(sel,box); }
}
function openNewStudent(){
  pauseSensorScan();
  enrollTitle.textContent="New enrollment";
  enrollSub.textContent="Add a student to the roster.";
  try{ enrollModal.querySelector(".mod").classList.add("w640"); }catch(e){}
  enrollBody.innerHTML=`
    <div class="edit-grid">
      <div class="edit-fields">
        <div class="g2">
          <div class="fld"><label>Full name</label><input id="nsName" placeholder="Full name"></div>
          <div class="fld"><label>Roll number</label><input id="nsRoll" placeholder="Roll number"></div>
          <div class="fld drop"><label>Class</label><select id="nsGrade">${Classes.map(c=>`<option>${esc(c)}</option>`).join("")}</select></div>
          <div class="fld drop"><label>Section</label><input id="nsSection" placeholder="Section"></div>
          <div class="fld w drop"><label>Batch</label><select id="nsBatch"></select></div>
          <div class="fld"><label>Parent / Guardian</label><input id="nsParent" placeholder="Parent name"></div>
          <div class="fld"><label>Parent phone</label><input id="nsPhone" placeholder="Phone"></div>
          <div class="fld w"><label>Address</label><input id="nsAddress" placeholder="Address"></div>
        </div>
      </div>
      <div class="edit-photo">
        <label>Photo</label>
        <div class="edit-photo-circle">+<span class="edit-photo-badge"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></span></div>
        <button type="button" id="nsChoosePhoto" class="edit-photo-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Choose photo</button>
        <small>JPG, PNG up to 2MB</small>
        <input type="file" id="nsPhoto" accept="image/*" hidden>
      </div>
    </div>
    <div class="err" id="nsErr" style="display:none"></div>
    <div class="ft"><button id="nsCancel">Cancel</button><button class="go" id="nsSave">Enroll student</button></div>`;
  openModal(enrollModal);
  $("nsCancel").onclick=()=>{ if(_enrollPoll) clearTimeout(_enrollPoll); closeModal(enrollModal); resumeSensorScan(); };
  const nsChooseBtn=$("nsChoosePhoto");
  if(nsChooseBtn) nsChooseBtn.onclick=(e)=>{ e.preventDefault(); const inp=$("nsPhoto"); if(inp) inp.click(); };
  /* Batch follows class (user order): only this class's batches list;
     no free text, no phantom fallback class. */
  const paintNsBatches=()=>{
    const g=$("nsGrade")?$("nsGrade").value:"";
    const list=classBatchNames(g);
    if($("nsBatch")) $("nsBatch").innerHTML=list.map(b=>`<option value="${esc(b)}">${esc(b)}</option>`).join("");
  };
  if($("nsGrade")) $("nsGrade").onchange=()=>{ paintNsBatches(); };
  paintNsBatches();
  $("nsSave").onclick=()=>{
    const name=$("nsName").value.trim(), roll=$("nsRoll").value.trim(),
          grade=$("nsGrade").value.trim(), batch=$("nsBatch").value.trim(),
          section=$("nsSection").value.trim(), parent=$("nsParent").value.trim(),
          phone=$("nsPhone").value.trim(), address=$("nsAddress").value.trim();
    const err=$("nsErr");
    if(!name||!roll||!grade){ err.textContent="Name, roll and class are required."; err.style.display="block"; return; }
    if(!(Classes||[]).length){ err.textContent="Create a class in Setup first."; err.style.display="block"; return; }
    if(!batch){ err.textContent=`No batches for ${grade} yet — add them in Setup first.`; err.style.display="block"; return; }
    err.style.display="none";
    const finish=(photo)=>{
      const form={name,roll,grade,batch,section,parent,phone,address,photo:photo||""};
      closeModal(enrollModal);
  fingerprintScanUI("Enroll fingerprint", "Press Start scan once, then place and lift the same finger three times. Don't click between captures.",
        ()=>apiEnrollStudent(form),
        async (res)=>{ await loadAll(); try{ if(res&&res.id!=null) selectStudent(res.id); }catch(e){} toast("Student enrolled."); },
        name+" · "+roll+" · "+grade);
    };
    readPhotoFile($("nsPhoto"), err, finish);
  };
  const nsSync=()=>{ const b=$("nsSave"); if(b) b.disabled=!($("nsName").value.trim()&&$("nsRoll").value.trim()&&$("nsGrade").value.trim()); };
  enrollBody.oninput=nsSync; nsSync();
}
function openEditStudent(id){
  const s=Students.find(x=>x.id===id); if(!s) return;
  enrollTitle.textContent="Edit student information";
  enrollSub.textContent="Changes apply immediately.";
  try{ enrollModal.querySelector(".mod").classList.add("w640"); }catch(e){}
  enrollBody.innerHTML=`
    <div class="edit-grid">
      <div class="edit-fields">
        <div class="g2">
          <div class="fld"><label>Full name</label><input id="edName" value="${esc(s.name)}"></div>
          <div class="fld"><label>Roll</label><input id="edRoll" value="${esc(s.roll)}"></div>
          <div class="fld drop"><label>Class</label><select id="edGrade">${Classes.map(c=>`<option ${c===s.class?"selected":""}>${esc(c)}</option>`).join("")}</select></div>
          <div class="fld drop"><label>Section</label><input id="edSection" value="${esc(s.section||'')}"></div>
          <div class="fld drop"><label>Batch</label><select id="edBatch"></select></div>
          <div class="fld"><label>Status</label><div class="seg s2" id="edActiveRow" role="radiogroup"></div><select id="edActive" data-gsel="1" class="dlg-hidden"><option value="1" ${s.active?"selected":""}>Active</option><option value="0" ${!s.active?"selected":""}>Inactive</option></select></div>
          <div class="fld"><label>Parent / Guardian</label><input id="edParent" value="${esc(s.parent||'')}"></div>
          <div class="fld"><label>Phone</label><input id="edPhone" value="${esc(s.phone)}"></div>
          <div class="fld w"><label>Address</label><input id="edAddress" value="${esc(s.address)}"></div>
        </div>
      </div>
      <div class="edit-photo">
        <label>Photo</label>
        <div class="edit-photo-circle">${esc(studentInitials(s.name))}<span class="edit-photo-badge"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></span></div>
        <button type="button" id="edChoosePhoto" class="edit-photo-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Choose photo</button>
        <small>JPG, PNG up to 2MB</small>
        <input type="file" id="edPhoto" accept="image/*" hidden>
        ${s.photo ? `<div id="edPhotoPreview" class="edit-photo-preview"><img src="${esc(s.photo)}" alt=""></div>` : ``}
      </div>
    </div>
    <div class="ft">
      <button id="edDelete">Delete student</button>
      <button id="edCancel">Cancel</button>
      <button class="go" id="edSave">Save changes</button>
    </div>
    <div class="err" id="edErr" style="display:none"></div>`;
  openModal(enrollModal);
  $("edCancel").onclick=()=>closeModal(enrollModal);
  /* Batch follows class; the stored value survives even if no class
     owns it anymore (grandfathered legacy, user order). */
  const paintEdBatches=()=>{
    const g=$("edGrade")?$("edGrade").value:"";
    const list=classBatchNames(g), lows=new Set(list.map(o=>o.toLowerCase()));
    const cur=String(s.batch||"");
    const legacy=!!(cur&&!lows.has(cur.toLowerCase()));
    const opts=legacy?[cur,...list]:[...list];
    if($("edBatch")) $("edBatch").innerHTML=opts.map(b=>`<option value="${esc(b)}"${b===cur?" selected":""}>${esc(b)}${(legacy&&b===cur)?" (legacy)":""}</option>`).join("");
  };
  if($("edGrade")) $("edGrade").onchange=()=>{ paintEdBatches(); };
  paintEdBatches();
  dlgPaintRow($("edActive"),$("edActiveRow"));
  const edPhotoEl=$("edPhoto");
  if(edPhotoEl) edPhotoEl.onchange=(e)=>{
    const inp=e.target;
    if(inp.files&&inp.files[0]&&inp.files[0].size>2*1024*1024){ const er=$("edErr"); er.textContent="Photo max 2MB."; er.style.display="block"; inp.value=""; return; }
    readPhotoFile(inp, $("edErr"), (data)=>{
      if(!data) return;
      edPhotoDirty=true; edSync();
      const prev=$("edPhotoPreview"); if(prev){ prev.style.display="block"; const img=prev.querySelector("img"); if(img) img.src=data; }
    });
  };
  const edChooseBtn=$("edChoosePhoto");
  if(edChooseBtn) edChooseBtn.onclick=(e)=>{ e.preventDefault(); const inp=$("edPhoto"); if(inp) inp.click(); };
  const edDeleteBtn=$("edDelete");
  if(edDeleteBtn) edDeleteBtn.onclick=async()=>{ try{ await deleteStudent(id); closeModal(enrollModal); }catch(e){} };
  let edClearRequested=false;
  const edClearBtn=$("edClearPhoto");
  if(edClearBtn) edClearBtn.onclick=(e)=>{ e.preventDefault(); edClearRequested=true; edPhotoDirty=true; edSync(); const prev=$("edPhotoPreview"); if(prev){ const img=prev.querySelector("img"); if(img) img.src=""; prev.style.display="none"; } const inp=$("edPhoto"); if(inp) inp.value=""; };
  $("edSave").onclick=async()=>{
    const err=$("edErr");
    const name=$("edName").value.trim(), roll=$("edRoll").value.trim(), grade=$("edGrade").value.trim(),
          batch=$("edBatch").value.trim(), section=$("edSection").value.trim(), parentEl=$("edParent").value.trim(),
          phone=$("edPhone").value.trim(), address=$("edAddress").value.trim(), active=$("edActive").value==="1";
    const doSave=async(photoData)=>{
      try{
        const payload={name,roll,grade,batch,section,parent:parentEl,phone,address,active};
        if(photoData!==null) payload.photo=photoData;
        await api("/api/students/"+id,{method:"PATCH",body:JSON.stringify(payload)});
        closeModal(enrollModal); await loadAll();
        selectStudent(id);
        await glassAlert("Saved.");
      }catch(e){ err.style.display="block"; err.textContent=e.message; }
    };
    readPhotoFile($("edPhoto"), err, (photoData)=>{
      doSave(photoData==="" ? (edClearRequested?"":null) : photoData);
    });
  };
  const edOrig={name:s.name||"",roll:s.roll||"",grade:s.class||"",batch:s.batch||"",section:s.section||"",parent:s.parent||"",phone:s.phone||"",address:s.address||"",active:s.active?"1":"0"};
  let edPhotoDirty=false;
  const edSync=()=>{ const b=$("edSave"); if(!b) return;
    const cur={name:$("edName").value.trim(),roll:$("edRoll").value.trim(),grade:$("edGrade").value.trim(),batch:$("edBatch").value.trim(),section:$("edSection").value.trim(),parent:$("edParent").value.trim(),phone:$("edPhone").value.trim(),address:$("edAddress").value.trim(),active:$("edActive").value};
    const same=Object.keys(edOrig).every(k=>String(cur[k])===String(edOrig[k]))&&!edPhotoDirty&&!edClearRequested;
    b.disabled=!(cur.name&&cur.roll&&!same); };
  enrollBody.oninput=edSync; enrollBody.onchange=edSync; edSync();
}
function openReEnroll(id){
  const s=Students.find(x=>x.id===id); if(!s) return;
  pauseSensorScan();
  fingerprintScanUI("Re-enroll fingerprint", "Press Start scan once, then place and lift the same finger three times. Don't click between captures.",
    ()=>api("/api/students/"+id+"/reenroll",{method:"POST",body:"{}"}),
    ()=>{ loadAll(); },
    s.name+" · "+s.roll+" · "+s.class);
}
async function deleteStudent(id){
  const s=Students.find(x=>x.id===id); if(!s) return;
  if(!(await glassConfirm("Deactivate "+s.name+"? Their fingerprint slot is freed and roll is released. History is kept.",{title:"Deactivate student",okText:"Deactivate",danger:true}))) return;
  pauseSensorScan();
  try{ await api("/api/students/"+id,{method:"DELETE"}); await loadAll(); }catch(e){ await glassAlert("Failed: "+e.message); }
  finally{ resumeSensorScan(); }
}
async function reactivateStudent(id){
  const s=Students.find(x=>x.id===id); if(!s) return;
  if(!(await glassConfirm("Re-activate "+s.name+"?",{title:"Re-activate student",okText:"Re-activate"}))) return;
  try{ await api("/api/students/"+id,{method:"PATCH",body:JSON.stringify({active:1})}); await loadAll(); selectStudent(id); }catch(e){ await glassAlert("Failed: "+e.message); }
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
function printHTML(htmlContent, docTitle){
  const w=window.open('','_blank'); if(!w) return;
  const t = docTitle ? esc(docTitle) : "Report";
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${t}</title><style>
    @page {
      size: auto;
      margin: 12mm 15mm;
    }
    *, *:before, *:after {
      box-sizing: border-box;
    }
    html, body {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #181A20;
      background: #FFFFFF;
      padding: 24px;
      max-width: 900px;
      margin: 0 auto;
      line-height: 1.4;
    }
    .report-header {
      border-bottom: 2px solid #181A20;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    h1 {
      font-family: "Newsreader", Georgia, serif;
      font-size: 20px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 0 0 6px 0;
      color: #181A20;
    }
    .report-subtitle {
      font-size: 11px;
      letter-spacing: 0.03em;
      color: #6B6B6B;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .report-meta-tag {
      display: inline-block;
      padding: 2px 7px;
      background: #F6F4EF;
      border: 1px solid #E9E6E0;
      border-radius: 2px;
      font-size: 10px;
      font-weight: 500;
      color: #181A20;
    }
    .stats-row {
      display: flex !important;
      flex-wrap: wrap !important;
      gap: 8px !important;
      margin: 14px 0 20px 0 !important;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .stat {
      border: 1px solid #E9E6E0 !important;
      background: #FCFBF7 !important;
      padding: 8px 12px !important;
      min-width: 85px !important;
      flex: 1 1 0% !important;
      box-sizing: border-box !important;
    }
    .stat b {
      display: block !important;
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
      font-size: 16px !important;
      font-weight: 600 !important;
      color: #181A20 !important;
      letter-spacing: -0.02em !important;
      line-height: 1.2 !important;
    }
    .stat label,
    .stat small {
      display: block !important;
      font-size: 8.5px !important;
      font-weight: 600 !important;
      letter-spacing: 0.12em !important;
      text-transform: uppercase !important;
      color: #6B6B6B !important;
      margin-top: 4px !important;
      line-height: 1.2 !important;
    }
    .table-wrap {
      border: 1px solid #E9E6E0 !important;
      background: #F2F3F6 !important;
      margin: 14px 0 20px 0 !important;
      overflow: visible !important;
      contain: none !important;
    }
    .table-scroll {
      max-height: none !important;
      overflow: visible !important;
    }
    table {
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      border-collapse: collapse !important;
      font-size: 10.5px !important;
      table-layout: auto !important;
    }
    thead {
      display: table-header-group !important;
    }
    tr {
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    th {
      font-size: 8.5px !important;
      font-weight: 600 !important;
      text-transform: uppercase !important;
      letter-spacing: 0.12em !important;
      color: #6B6B6B !important;
      text-align: left !important;
      padding: 8px 10px !important;
      border-bottom: 1.5px solid #181A20 !important;
      background: #F6F4EF !important;
      white-space: nowrap !important;
    }
    td {
      padding: 7px 10px !important;
      border-bottom: 1px solid #E9E6E0 !important;
      color: #181A20 !important;
      vertical-align: middle !important;
      font-variant-numeric: tabular-nums !important;
      white-space: normal !important;
      word-break: break-word !important;
      max-width: none !important;
    }
    tr:nth-child(even) td {
      background: #FAFAF7 !important;
    }
    .badge {
      display: inline-block !important;
      font-size: 8.5px !important;
      font-weight: 600 !important;
      letter-spacing: 0.08em !important;
      text-transform: uppercase !important;
      padding: 2px 6px !important;
      border: 1px solid #E9E6E0 !important;
      background: #F2F3F6 !important;
      border-radius: 2px !important;
      white-space: nowrap !important;
    }
    .badge.present {
      color: #2F5D34 !important;
      border-color: #2F5D34 !important;
      background: #F3F8F4 !important;
    }
    .badge.late {
      color: #8A6A2A !important;
      border-color: #C7B07A !important;
      background: #FAF7F0 !important;
    }
    .badge.absent {
      color: #8A3A3A !important;
      border-color: #8A3A3A !important;
      background: #FDF4F4 !important;
    }
    .badge.not-scheduled {
      color: #6B6B6B !important;
      border-color: #E9E6E0 !important;
      background: #F6F4EF !important;
    }
    .badge.duplicate {
      color: #6B6B6B !important;
      border-color: #E9E6E0 !important;
    }
    .report-section {
      margin-top: 22px !important;
      page-break-inside: auto !important;
      break-inside: auto !important;
    }
    /* Reports are ink on paper: cloned cards/tables carry live UI
       buttons (Correct/Edit/…) — never print them. */
    button {
      display: none !important;
    }
    .section-title {
      font-family: "Newsreader", Georgia, serif !important;
      font-size: 13px !important;
      font-weight: 600 !important;
      text-transform: uppercase !important;
      letter-spacing: 0.08em !important;
      margin-bottom: 8px !important;
      color: #181A20 !important;
      border-bottom: 1px solid #E9E6E0 !important;
      padding-bottom: 4px !important;
    }
    .detail-card {
      border: 1px solid #E9E6E0 !important;
      background: #F2F3F6 !important;
      padding: 16px !important;
      margin: 12px 0 !important;
      display: flex !important;
      gap: 20px !important;
    }
    .detail-photo {
      width: 140px !important;
      height: 180px !important;
      border: 1px solid #181A20 !important;
      background: #F6F4EF !important;
      overflow: hidden !important;
      flex-shrink: 0 !important;
    }
    .detail-photo img {
      width: 100% !important;
      height: 100% !important;
      object-fit: cover !important;
    }
    .detail-photo-fallback {
      width: 100% !important;
      height: 100% !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-family: "Newsreader", Georgia, serif !important;
      font-size: 54px !important;
      color: #181A20 !important;
    }
    .detail-grid {
      display: grid !important;
      grid-template-columns: repeat(2, 1fr) !important;
      gap: 10px !important;
      flex: 1 !important;
    }
    .detail-field label {
      display: block !important;
      font-size: 8.5px !important;
      font-weight: 600 !important;
      letter-spacing: 0.12em !important;
      text-transform: uppercase !important;
      color: #6B6B6B !important;
      margin-bottom: 2px !important;
    }
    .detail-field span {
      display: block !important;
      font-size: 11px !important;
      font-weight: 500 !important;
      color: #181A20 !important;
    }
    .empty {
      padding: 16px !important;
      text-align: center !important;
      font-size: 10px !important;
      color: #6B6B6B !important;
    }
    button, .btn {
      display: none !important;
    }
    @media print {
      body {
        padding: 0 !important;
        max-width: none !important;
      }
      .no-print {
        display: none !important;
      }
    }
  </style></head><body>${htmlContent}<script>window.addEventListener('DOMContentLoaded',()=>{ setTimeout(()=>{ try{ window.print(); }catch(e){} }, 100); }); if(document.readyState==='complete'){ setTimeout(()=>{ try{ window.print(); }catch(e){} }, 100); }<\/script></body></html>`);
  w.document.close();
}

// ---- events ----
async function openAdmin(){
  // require admin auth when PIN configured — use safe header-only check that does not need sensor
  try{
    await api("/api/audit", {method:"GET"});
  }catch(e){
    if(e.status===401) return;
    // for other errors (e.g., network when PIN empty), still allow open to preserve offline admin when no PIN
    const pin = (()=>{ try{ return sessionStorage.getItem("atl_admin_pin") || ""; }catch(_e){ return ""; }})();
    if(!pin){
    } else {
      return;
    }
  }
  const titles={
    students: "Students",
    attendance: "Today — Attendance",
    today: "Today — Attendance",
    reports: "Attendance",
    setup: "Setup",
    calendar: "Setup",
    settings: "Setup",
    backup: "Backup — Audit"
  };
  if(adminTitle) adminTitle.textContent=titles[currentTab]||"Admin";
  adminLayer.classList.add("open"); renderAll();
  try{ repaintFades(); }catch(e){}
  /* Synchronous tab switch (was 80ms deferred): the deferred switch
     flashed the wrong pane/rail on every refresh before settling. */
  updateTabs();
  scrollToPane(currentTab);
}
/* Section switching helpers: the page keeps all sections on the document;
   clicks and restore paths jump to their section, the observer tracks
   manual scrolling. */
function adminScroller(){ try{ return document.querySelector("#adminLayer .app"); }catch(_){ return null; } }
function setSpyTab(tab){
  currentTab = tab;
  try{
    const navBtns=document.querySelectorAll("#adminNav button[data-tab]");
    const setupAlias=(tab==="calendar"||tab==="settings")?"setup":null;
    navBtns.forEach(b=>b.classList.toggle("on", b.dataset.tab===tab||b.dataset.tab===setupAlias));
  }catch(e){}
}
function scrollToPane(tab){
  /* Click-to-section: instant jump (zero-motion rule), landing the section
     top just under the sticky bar. offsetTop is relative to .app (the only
     positioned ancestor), which is also the scroller. */
  let t=tab;
  if(t==="calendar"||t==="settings") t="setup";
  if(["students","attendance","setup","backup"].indexOf(t)<0) return;
  const sc=adminScroller();
  const pane=document.getElementById("pane-"+t);
  if(!sc||!pane) return;
  let rh=0; try{ const r=sc.querySelector(".rail"); rh=r?r.offsetHeight:0; }catch(_){}
  try{ sc.scrollTop=Math.max(0, pane.offsetTop - rh); }catch(_){}
  spyFromScroll();
}
function updateTabs(){
  /* Stacked page: every section stays on the document (never hidden), so
     the page scrolls continuously and clicks jump to a section. */
  document.querySelectorAll(".admin-pane").forEach(p=>{ p.classList.remove("hidden"); p.style.opacity=""; });
  let tab = currentTab;
  if(tab === "calendar" || tab === "settings") tab = "setup";
  setSpyTab(currentTab);
  /* Sidebar context follows the tab: only the active page's secondary
     controls stay visible (Phase 2: students, Phase 3: attendance).
     Nodes are pre-moved in markup; this just toggles the section.
     Uses [hidden] + CSS display:none !important — plain inline
     display:none loses to the .side-ctx display:flex !important shell.
     The opened section starts at top (nav stays fixed above it; the
     section scrolls internally, never the rail or the workspace). */
  try{ document.querySelectorAll('#adminSide [data-side]').forEach(s=>{ const on=(s.dataset.side===tab); s.hidden=!on; if(on){ try{ s.scrollTop=0; }catch(_){} } }); }catch(e){}
  const titles = {
    students: "Students",
    attendance: "Today — Attendance",
    today: "Today — Attendance",
    reports: "Attendance",
    setup: "Setup",
    calendar: "Setup",
    settings: "Setup",
    backup: "Backup — Audit"
  };
  if(adminTitle) adminTitle.textContent = titles[currentTab] || "Admin";
  /* Paint-first tab switch (user order): visibility already toggled above
     so the new pane appears instantly; heavy re-renders run on the next
     frame against cached data, then refresh. */
  const _defer=fn=>{ try{ requestAnimationFrame(()=>{ try{fn();}catch(e){} }); }catch(e){ try{fn();}catch(_){} } };
  if(tab === "attendance"){
    if(currentTab === "attendance" && attDatePreset && !attDatePreset.value) attDatePreset.value = "today";
    _defer(renderAttendance);
  }
  if(tab === "setup"){
    _defer(()=>{ populateScheduleSelector(); renderClasses(); renderWeekly(); renderHolidays(); renderOverrides(); renderCalendarMonth(); });
  }
  if(tab === "backup"){ _defer(()=>{ renderAudit(); loadBackupManagerStatus(); }); }
  else { try{ if(typeof stopGDrivePolling==="function") stopGDrivePolling(); }catch(e){} }
  _defer(()=>{ try{ repaintFades(); }catch(e){} });
}
document.getElementById("openAdminBtn").onclick=openAdmin;
const _frontEnrollBtn=document.getElementById("openEnrollBtn"); if(_frontEnrollBtn) _frontEnrollBtn.onclick=openNewStudent;
const _newToolbarBtn=document.getElementById("newStudentToolbarBtn"); if(_newToolbarBtn) _newToolbarBtn.onclick=openNewStudent;
document.getElementById("adminClose").onclick=()=>{
  finishEnrollUi();
  try{ if(typeof stopGDrivePolling==="function") stopGDrivePolling(); }catch(e){}
  adminLayer.classList.remove("open");
  resumeSensorScan();
};
adminNav.onclick=(e)=>{
  const btn = e.target.closest("button");
  if(!btn) return;
  [...adminNav.children].forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  currentTab = btn.dataset.tab;
  try{ localStorage.setItem("atl_admin_tab", currentTab); }catch(e){}
  if(currentTab === "calendar" || currentTab === "settings"){
    const setupBtn = adminNav.querySelector("button[data-tab='setup']");
    if(setupBtn) setupBtn.classList.add("active");
  }
  if(currentTab === "attendance"){
    if(attDatePreset) attDatePreset.value = "today";
  }
  updateTabs();
  scrollToPane(currentTab);
};
/* Section-entry micro-animation (user order): a 150ms fade + 4px settle as a
   section enters the viewport. Deliberately small and self-contained:
     - opacity/transform only (see the CSS) → no reflow, so row heights, the
       sticky column headers and the tables never move.
     - one-shot per entry: the class is removed on animationend so no
       transform lingers. That is not cosmetic — a pane holding any transform,
       even translateY(0), becomes the containing block for the fixed
       dropdowns inside it (.gsel-pop, .dt-pop), which would jump.
     - re-armed only when the section leaves the viewport, so a fast scroll
       cannot stack repeats, and a re-entry inside 600ms is ignored to avoid
       flicker on a flick-scroll that re-crosses the same section.
     - sidebar clicks need no special case: the jump lands, the observer
       fires on its own. No existing handler or ID is touched.
   Skipped entirely under prefers-reduced-motion (the CSS drops the
   animation, and the observer stops adding the class at all). */
(function(){
  const sc=adminScroller();
  if(!sc || !("IntersectionObserver" in window)) return;
  const reduce=window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  if(reduce && reduce.matches) return;
  const COOLDOWN=600, seen=new WeakMap();
  function play(pane){
    if(!pane || pane.classList.contains("is-entering")) return;
    const now=Date.now();
    if(now-(seen.get(pane)||0) < COOLDOWN) return;
    seen.set(pane, now);
    /* Dismiss any open popover BEFORE the transform goes on. A pane carrying a
       transform becomes the containing block for its position:fixed children
       (.gsel-pop, .dt-pop), so a dropdown left open across an entry snaps to
       the pane instead of the viewport and flies across the screen (measured:
       a fixed child 1562px out of place). Same dismissal openModal() already
       performs before it shows a dialog. */
    try{ if(window.__closeGselPop) window.__closeGselPop(); }catch(_){}
    try{ if(typeof closeDtPops==="function") closeDtPops(); }catch(_){}
    pane.classList.add("is-entering");
    /* Belt and braces: if the animation never fires (background tab, reduced
       motion turned on mid-session) the class must still not survive. */
    const clear=()=>{ pane.classList.remove("is-entering"); pane.removeEventListener("animationend", clear); };
    pane.addEventListener("animationend", clear, {once:true});
    setTimeout(clear, 600);
  }
  try{
    const io=new IntersectionObserver((entries)=>{
      for(const en of entries){
        if(en.isIntersecting && en.intersectionRatio>=0.25) play(en.target);
      }
    }, {root:sc, threshold:[0, 0.25, 0.6]});
    const scan=()=>{ document.querySelectorAll("#adminLayer .admin-pane").forEach(p=>{ if(!p.__io){ p.__io=true; io.observe(p); } }); };
    scan();
    /* Sections are rebuilt by renders, so re-scan as the app works. */
    if(window.MutationObserver){ new MutationObserver(scan).observe(sc, {childList:true, subtree:true}); }
    window.addEventListener("resize", scan, {passive:true});
  }catch(_){}
})();
/* Scroll-spy: mark the section that actually occupies the window.
   Deterministic probe line just below the sticky bar — the last section
   whose top has passed the line is the one on screen. Chosen over
   IntersectionObserver because at a section boundary the observer reports
   two panes intersecting at once and the "which one" answer flips. */
function spyFromScroll(){
  const sc=adminScroller();
  if(!sc) return;
  try{ if(!document.querySelector("#adminLayer").classList.contains("open")) return; }catch(_){ return; }
  let rh=0; try{ const r=sc.querySelector(".rail"); rh=r?r.offsetHeight:0; }catch(_){}
  const line=sc.scrollTop + rh + 8;
  let cur=null;
  ["students","attendance","setup","backup"].forEach(t=>{
    const p=document.getElementById("pane-"+t);
    if(p && p.offsetTop<=line) cur=t;
  });
  if(cur) setSpyTab(cur);
}
try{
  const _spyRoot=adminScroller();
  if(_spyRoot) _spyRoot.addEventListener("scroll", spyFromScroll, {passive:true});
}catch(_){}
/* Page scroll indicator — a real control, not decoration. All native
   scrollbars are hidden file-wide, so this is the single scroll affordance.
   One 14px grip strip on the right edge holding a 6px thumb:
     - click the strip  -> page jumps so that point becomes the top
     - drag the thumb   -> scrolls (pointer capture survives leaving strip)
     - wheel over strip -> forwards deltaY to .app. Required: the strip is a
       SIBLING of .app, so wheel events over it never reach the scroller.
     - shows while scrolling and on hover, hides when idle; keyboard arrows /
       PageUp-Down / Home / End also work.
   Length is CAPPED (MAX_THUMB) so it stays a short marker, not a long bar.
   All motion instant — no transitions, per the zero-motion rule. */
(function(){
  const track=$("scrollTrack"), ind=$("scrollInd");
  const sc=adminScroller();
  if(!track||!ind||!sc) return;
  const IDLE=900, MAX_THUMB=110, MIN_THUMB=40;
  let hideT=null, dragging=false, dragId=null, grabDelta=0;

  /* Page-only (user order): the far-right strip is the PAGE's bar. Bounded
     inner windows now carry their own mini bar, so this one no longer has to
     stand in for them. */
  /* The strip belongs to the CONTENT column, not the window: anchored at the top
   of the window it ran beside whatever right-aligned control sat at that
   height (CLOSE in the nav, Export CSV in the Attendance toolbar) and read as
   part of that control. The nav is not a fixed height — it measures 109px once
   the search box and Close stack — so fit the strip to the real rail instead of
   hardcoding a number that is wrong half the time. getBoundingClientRect is in
   the same rendered units that `top`/`height` resolve against here, and zoom
   does not scale a fixed element's offsets, so no ratio correction is needed. */
  const rail=document.getElementById("adminNav");
  const navEl=rail?rail.closest(".rail"):null;
  let fitted=-1;
  function fitTrack(){
    let h=0;
    try{ if(navEl && navEl.offsetParent!==null) h=navEl.offsetHeight; }catch(_){}
    /* Runs on every paint, so it must be cheap AND must self-correct: at init
       the admin layer is still closed, the rail has no box, and the strip would
       otherwise stay window-height until a resize happened to arrive. Bail when
       the value has not changed so a scroll does not force layout each frame. */
    if(h===fitted) return;
    fitted=h;
    track.style.top=h+"px";
    track.style.height="calc(100% - "+h+"px)";
  }
  fitTrack();

  /* th = the TRACK's own height (it stops below the nav, so it is shorter than
     the scroller); ch = the SCROLLER's client height, which is what the scroll
     range is measured against. Visual travel uses th, scroll arithmetic uses ch
     — mixing them up puts the thumb outside the track. */
  const metrics=()=>{ const ch=sc.clientHeight, sh=sc.scrollHeight;
    return {ch:ch, sh:sh, th:track.clientHeight||ch, on:sh>ch+1}; };
  function paint(){
    fitTrack();
    const ch=sc.clientHeight, sh=sc.scrollHeight, st=sc.scrollTop;
    const th=track.clientHeight||ch;
    /* Dead strip must not intercept clicks on a page that cannot scroll. */
    track.classList.toggle("dead", !(sh>ch+1));
    if(!(sh>ch+1)){ ind.style.height="0px"; return; }
    const h=Math.min(MAX_THUMB, Math.max(MIN_THUMB, Math.round(th*th/sh)));
    const room=th-h;
    const top=room>0 ? Math.round((st/(sh-ch))*room) : 0;
    ind.style.height=h+"px";
    ind.style.top=top+"px";
    track.setAttribute("aria-valuenow", String(Math.round(st)));
    track.setAttribute("aria-valuemax", String(Math.max(0, sh-ch)));
  }
  function show(){ if(hideT){ clearTimeout(hideT); hideT=null; } track.classList.add("on"); paint(); }
  function idle(){
    if(hideT) clearTimeout(hideT);
    hideT=setTimeout(()=>{ if(!dragging) track.classList.remove("on"); hideT=null; }, IDLE);
  }
  /* Map a pointer y on the strip to scrollTop (1:1 across the full range).
     EVERYTHING here is client space (rects + clientY). The admin layer is
     scaled (zoom:.9), so style px and client px are NOT the same units:
     mixing a scaled rect difference with style/offset values made the thumb
     lag the cursor by ~50px and even travel backwards on a small drag.
     grabY = clientY at grab, minus the thumb's own client top, so the thumb
     keeps the exact spot under the pointer (no re-centring on first move). */
  function jumpTo(clientY, grabY){
    const m=metrics();
    if(!m.on) return;
    const tr=track.getBoundingClientRect();
    const ir=ind.getBoundingClientRect();
    const thumbH=ir.height || parseFloat(ind.style.height) || MIN_THUMB;
    const room=Math.max(0, tr.height-thumbH);
    /* Bare click: centre the thumb under the pointer. Drag: keep the grab. */
    const anchor=(grabY!=null) ? (clientY-grabY) : (clientY-thumbH/2);
    const topWanted=anchor-tr.top;
    const frac=room>0 ? Math.max(0, Math.min(1, topWanted/room)) : 0;
    sc.scrollTop=Math.round(frac*(m.sh-m.ch));
  }

  sc.addEventListener("scroll", ()=>{ show(); idle(); }, {passive:true});
  window.addEventListener("resize", ()=>{ fitTrack(); paint(); });
  track.addEventListener("mouseenter", show);
  track.addEventListener("mouseleave", ()=>{ idle(); });
  /* The strip is only fitted inside paint(), and paint() only runs once the
     strip is shown (scroll / hover). So when the nav height changes and Admin
     opens, the strip could sit at top:0 — its 14px hit zone under the bar —
     until the first scroll. Re-fit whenever the layer opens or closes, and on
     any rail resize, so the strip always starts below the bar. */
  try{
    const layer=document.getElementById("adminLayer");
    if(layer && window.MutationObserver) new MutationObserver(()=>{ fitTrack(); paint(); }).observe(layer, {attributes:true, attributeFilter:["class"]});
    const bar=navEl;
    if(bar && "ResizeObserver" in window) new ResizeObserver(()=>{ fitTrack(); paint(); }).observe(bar);
  }catch(_){}

  /* Wheel on the strip drives the page (it sits outside every scroll region, so
     the page would not move on its own). */
  track.addEventListener("wheel",(e)=>{
    const m=metrics(); if(!m.on) return;
    e.preventDefault();
    sc.scrollTop+=e.deltaY;
    show(); idle();
  }, {passive:false});

  track.addEventListener("pointerdown",(e)=>{
    show();
    if(e.target===ind){
      /* Where inside the thumb the grab started, in CLIENT space (the thumb's
         own client rect, not style.top — style px and client px differ under
         the admin layer's zoom, which is what made the drag drift). */
      grabDelta = e.clientY - ind.getBoundingClientRect().top;
      dragging=true; dragId=e.pointerId;
      track.classList.add("drag");
      try{ track.setPointerCapture(e.pointerId); }catch(_){}
      e.preventDefault();
      return;
    }
    jumpTo(e.clientY, null);   /* bare strip click = centre thumb here */
    idle();
  });
  track.addEventListener("pointermove",(e)=>{
    if(!dragging) return;
    jumpTo(e.clientY, grabDelta);
    show();
  });
  function endDrag(e){
    if(!dragging) return;
    dragging=false;
    track.classList.remove("drag");
    try{ track.releasePointerCapture(dragId); }catch(_){}
    dragId=null;
    idle();
  }
  track.addEventListener("pointerup", endDrag);
  track.addEventListener("pointercancel", endDrag);

  track.addEventListener("keydown",(e)=>{
    const m=metrics(); if(!m.on) return;
    const page=m.ch*0.9;
    let d=0;
    if(e.key==="ArrowDown") d=60;
    else if(e.key==="ArrowUp") d=-60;
    else if(e.key==="PageDown") d=page;
    else if(e.key==="PageUp") d=-page;
    else if(e.key==="Home"){ sc.scrollTop=0; show(); idle(); e.preventDefault(); return; }
    else if(e.key==="End"){ sc.scrollTop=m.sh; show(); idle(); e.preventDefault(); return; }
    else return;
    sc.scrollTop+=d;
    e.preventDefault();
    show(); idle();
  });

  paint();   /* sized but hidden until first scroll or hover */
})();

/* Page-only wheel (user order): the wheel belongs to the main UI, never to
   the bounded lists. Classes, Batches, Holidays, Overrides, the student
   records and the audit history are competing windows: while they also took
   the wheel, one gesture scrolled a list AND the page, and the UI felt stuck
   between them. Now the wheel scrolls the page only, and those lists are
   driven by their own thin bar (drag, wheel-over-the-strip, or keyboard when
   focused) — plus touch, which is untouched and still swipes a list natively.
   The page is moved by hand because overscroll-behavior:contain on the lists
   blocks the browser's own chaining, which is what made the page feel stuck.
   Overlays are excluded: a dialog must keep scrolling itself. */
(function(){
  const sc=adminScroller();
  if(!sc) return;
  const OVERLAY=".scrim,.pv,.gsel-pop,.dt-pop,.gconfirm,.gconfirm-ov,.cmd-pal";
  document.addEventListener("wheel",(e)=>{
    if(e.ctrlKey) return;                        /* pinch-zoom */
    if(Math.abs(e.deltaX)>Math.abs(e.deltaY)) return;  /* horizontal pan stays native */
    if(e.target && e.target.closest && e.target.closest(OVERLAY)) return;
    if(!e.target || !sc.contains(e.target)) return;  /* kiosk side keeps its own wheel */
    /* The page takes every wheel inside Admin, wherever the cursor is. Inner
       lists are never consulted, so one gesture moves exactly one thing. */
    e.preventDefault();
    const max=sc.scrollHeight-sc.clientHeight;
    sc.scrollTop=Math.max(0, Math.min(max, sc.scrollTop + e.deltaY));
  }, {passive:false});
})();

/* Mini scrollbars for the bounded inner windows (user order). The project
   hides every native scrollbar, so a list that scrolls gave no sign at all and
   read as a dead end; each such window now carries its own small bar sized by
   its own content. Built in JS so no per-region markup is hand-edited, and
   only attached where it earns its place: a visible, actually-scrolling
   region tall enough to be usable. */
(function(){
  const sc=adminScroller();
  if(!sc) return;
  /* .main-col is deliberately NOT a region. It holds the month calendar;
     a bar pinned to its edge would double the page strip a few px away.
     The data lists live in Setup 2 and carry their own bars. */
  const REGIONS=".ros,.sd-recs,.rows,.bk,#auditBody,#gdriveFilesBody";
  /* MIN_THUMB is a usability floor: with 500 audit rows the honest ratio is
   493x493/39000 = 6px, which is invisible and undraggable. The floor keeps the
   control grabbable for a mouse; it is clamped to the visible track height so
   a short region can never grow a thumb larger than its own track. Touch
   needs no floor: the bar is hidden on hover:none, where swipe scrolls. */
  const MIN_REGION_H=120, MIN_THUMB=32, MAX_THUMB=96;
  /* Every bar must repaint when the PAGE scrolls, not just when its own
     region scrolls: a region's visible box moves with the page, so a bar
     measured earlier goes stale (this is what left the audit bar sized for
     an off-screen position and overflowing its panel). */
  const repaints=[];
  sc.addEventListener("scroll", ()=>{ for(let i=0;i<repaints.length;i++) repaints[i](); }, {passive:true});

  function build(region){
    /* Only real scroll containers get a bar. A plain flow container (Backup
       now that it no longer scrolls) must never show one — a bar that cannot
       scroll anything is a lie. */
    if(!/(auto|scroll)/.test(getComputedStyle(region).overflowY)) return;
    if(region.__minibar) return;
    region.__minibar=true;
    const bar=document.createElement("div");
    bar.className="minibar";
    bar.setAttribute("role","scrollbar");
    bar.setAttribute("aria-orientation","vertical");
    bar.tabIndex=0;
    const thumb=document.createElement("span");
    thumb.className="minibar-t";
    bar.appendChild(thumb);
    /* The bar is positioned against the region's own box. */
    if(getComputedStyle(region).position==="static") region.style.position="relative";
    region.appendChild(bar);

    let grabDelta=0, dragging=false, pid=null;
    /* Resolved once: the ancestors that can CLIP this region. geom() used to walk
       the tree and read getComputedStyle on each node on every scroll event; the
       ancestor chain does not change while the bar exists (a data render replaces
       the region's CHILDREN, never its ancestors), so this is safe to cache. */
    const clipAncestors=[];
    (function(){
      let n=region.parentElement;
      while(n && n!==document.body){
        if(n===sc) break;
        try{ if(/(auto|scroll|hidden|clip)/.test(getComputedStyle(n).overflowY)) clipAncestors.push(n); }catch(_){}
        n=n.parentElement;
      }
    })();
    /* Last values written, so paint() stops re-assigning identical style
       properties. Assigning bar.style.top/height and thumb.style.top/height on
       every scroll event re-invalidated style for the whole subtree each time;
       skipping the no-op writes is most of the per-frame cost. */
    const lastBar={h:null,t:null}, lastThumb={h:null,t:null};
    /* Audit-list-only switch. The bar geometry and hover branch below are shared
       by every list, so anything audit-specific has to be gated on this. */
    const isAudit=(region.id==="auditBody");

    const metrics=()=>({
      ch:region.clientHeight,
      sh:region.scrollHeight,
      st:region.scrollTop,
      on:region.scrollHeight>region.clientHeight+1
    });
    /* Geometry: the bar covers only the part of the region that is actually
     visible. Clamping to the window alone was not enough — a region inside a
     clipping column was drawn past that column, which is what put the audit
     bar outside its panel and made dragging useless. So intersect with every
     clipping ancestor as well. The thumb is also CAPPED, because a region that
     overflows only slightly would otherwise produce a near-full-height bar
     (513x513/550 = 478px) that reads as a plain rule, not a scrollbar. */
  function geom(){
    const m=metrics();
    const r=region.getBoundingClientRect();
    let top=r.top, bot=r.bottom;
    /* clipAncestors is resolved ONCE at build time (see above). Walking the
       tree and calling getComputedStyle on every ancestor inside geom() forced a
       style recalc on EVERY scroll event, and paint() runs on every scroll event
       for every bar in the document. Measuring rects is cheap by comparison —
       getBoundingClientRect does not invalidate style. */
    for(let i=0;i<clipAncestors.length;i++){
      const nr=clipAncestors[i].getBoundingClientRect();
      if(nr.top>top) top=nr.top;
      if(nr.bottom<bot) bot=nr.bottom;
    }
    top=Math.max(0, top);
    bot=Math.min(window.innerHeight, bot);
    return {m:m, rTop:r.top, vTop:top, vH:Math.max(0, bot-top)};
  }
  function paint(){
    const g=geom(), m=g.m;
    /* A bar exists only where it can work: the region must actually overflow
       AND be tall enough on screen to grab. A bar on content that already
       fits is a lie — it painted a full-height grey column over the
       right-aligned action buttons. A short dark thumb means there IS more
       below. Regions too small or off-screen get no bar (a bar on a sliver
       is noise). */
    bar.hidden = !(g.vH>=MIN_REGION_H && m.on);
    if(bar.hidden) return;
    /* Only write a style property when the value actually changed (see the
       lastBar/lastThumb note at build time). Re-assigning an identical value
       still re-invalidates style for the bar's subtree, and paint() runs on
       every scroll event of every bar. */
    const barH=g.vH+"px";
    if(lastBar.h!==barH){ bar.style.height=barH; lastBar.h=barH; }
    /* Region-local top (the bar is inside the scroller, so add scrollTop). */
    /* The audit bar is NOT rounded (user order). Because the bar is a CHILD of
       the scroller, its top is (constant viewport offset + scrollTop), and the
       audit scrub writes FRACTIONAL scrollTop — so rounding that sum left up to
       half a pixel of error that changed every frame the list moved, and the
       strip visibly jittered. Fractional costs nothing here: the bar is pinned
       to the scrollport, not to a cursor, and device-pixel snapping happens on
       paint anyway. Every other list keeps its Math.round. */
    const barTop=g.vTop - g.rTop + m.st;
    const barT=(isAudit ? barTop : Math.round(barTop))+"px";
    if(lastBar.t!==barT){ bar.style.top=barT; lastBar.t=barT; }
    const h=Math.max(MIN_THUMB, Math.min(MAX_THUMB, g.vH, Math.round(g.vH*g.vH/m.sh)));
    const room=g.vH-h;
    /* Sub-pixel on purpose: scrollTop is fractional here, so rounding the
       thumb to whole px quantised its travel to 1/RANGE of the scroll — 2.2px
       per step on a short list — and a 1:1 drag visibly stepped. The thumb now
       follows the pointer continuously. (The BAR above stays rounded: it is
       pinned to the viewport, not to the cursor, so a fraction there only
       buys shimmer.) */
    const top=room>0 ? (m.st/(m.sh-m.ch))*room : 0;
    const thH=h+"px", thT=top+"px";
    if(lastThumb.h!==thH){ thumb.style.height=thH; lastThumb.h=thH; }
    if(lastThumb.t!==thT){ thumb.style.top=thT; lastThumb.t=thT; }
    bar.setAttribute("aria-valuenow", String(Math.round(m.st)));
    bar.setAttribute("aria-valuemax", String(Math.max(0, m.sh-m.ch)));
  }
  /* Client space only (see the page strip): the admin layer is scaled, so
     style px and client px are different units. Mixing them drifted the thumb
     a few px behind the pointer.
     scrollFor() is that mapping, UNCHANGED, returning the scroll position
     instead of assigning it. jumpTo() writes it (click and drag — untouched,
     still one write per event, still 1:1), and the eased hover below uses it
     as a target it approaches without jumping. One mapping, two consumers, so
     they can never disagree about where a given y points. */
  function scrollFor(clientY, grabOff){
    const g=geom(), m=g.m;
    if(!(m.on && g.vH>=MIN_REGION_H)) return null;
    const br=bar.getBoundingClientRect();
    const tr=thumb.getBoundingClientRect();
    const thumbH=tr.height || parseFloat(thumb.style.height) || MIN_THUMB;
    const room=Math.max(0, br.height-thumbH);
    const anchor=(grabOff!=null) ? (clientY-grabOff) : (clientY-thumbH/2);
    const frac=room>0 ? Math.max(0, Math.min(1, (anchor-br.top)/room)) : 0;
    return frac*(m.sh-m.ch);
  }
  function jumpTo(clientY, grabOff){
    const v=scrollFor(clientY, grabOff);
    if(v!=null) region.scrollTop=v;
  }

    region.addEventListener("scroll", paint, {passive:true});
    window.addEventListener("resize", paint, {passive:true});
    /* Content grows/shrinks with every data render — keep the bar honest. */
    try{
      const ro=new ResizeObserver(()=>paint());
      ro.observe(region);
      for(let k=0;k<region.children.length && k<3;k++) ro.observe(region.children[k]);
    }catch(_){}
    /* A data render replaces the region's children (innerHTML), which detaches
       the bar that lives inside it. Without this the region keeps its
       __minibar flag with no bar in the DOM and can never get one back — that
       is why the audit list, the student list and the Setup lists had NO bar at
       all on the real device (build() saw the flag and skipped them).
       Re-append the same node; appending here fires no loop because the
       isConnected check settles it. */
    if(window.MutationObserver){
      new MutationObserver(()=>{
        if(region.__minibar && !bar.isConnected) region.appendChild(bar);
        paint();
      }).observe(region, {childList:true});
    }
    repaints.push(paint);

    bar.addEventListener("pointerdown",(e)=>{
      const m=metrics();
      if(!(m.on && m.ch>=MIN_REGION_H)) return;
      /* A running ease would keep writing under the press, so the click or the
         grab starts from a still list. */
      stopHover();
      if(e.target===thumb){
        /* Grab offset inside the thumb, measured in client space. */
        grabDelta=e.clientY - thumb.getBoundingClientRect().top;
        dragging=true; pid=e.pointerId;
        bar.classList.add("drag");
        try{ bar.setPointerCapture(e.pointerId); }catch(_){}
        e.preventDefault();
        return;
      }
      jumpTo(e.clientY, null);   /* bare lane click = centre thumb here */
      e.preventDefault();
    });
    bar.addEventListener("pointermove",(e)=>{ if(!dragging) return; jumpTo(e.clientY, grabDelta); });

    /* Magnetic hover-scrub (user order): no click and no drag needed — move
       the cursor vertically inside the lane and the list follows it.

       Setup 2 EASES toward the cursor; every other pane keeps the old direct
       write, so nothing about them changes this step (flip `eased` to apply
       the easing everywhere — it is one flag, deliberately).

       Why easing: a direct write snaps the whole distance into a single
       frame, so a 2px hand tremor teleported the list 1-2 rows and the row you
       were aiming at was gone before you could stop. Each frame now closes
       18% of the remaining gap, which is smooth to the eye but still arrives.

       Notes:
         - The TARGET is computed once per pointermove from scrollFor(); the
           loop then touches nothing but scrollTop. Running geom() every frame
           would walk every clipping ancestor with getComputedStyle at 60Hz,
           which is itself stutter.
         - No overshoot is possible: cur + (target-cur)*EASE is monotonic, the
           gap shrinks by 0.82 per frame and never changes sign.
         - DEAD zone: sub-3px cursor jitter updates nothing at all. (Scroll
           offsets also snap to device pixels — 1.11px under zoom .9 — so
           without this, tremor was being amplified into visible jumps.)
         - EASE_EPS snaps the last half pixel so the list lands exactly on the
           target instead of crawling toward it forever.
         - refused while a real drag owns the motion, for anything that is not
           a mouse, and on (hover:none) screens, where there is no hover at
           all: there, swipe and the drag handle remain how you scroll.
         - stopHover() kills the loop on pointerleave, on a press (so a click
           or a drag starts from a still list) and when a drag ends. */
    const canHover=window.matchMedia ? window.matchMedia("(hover:hover)") : null;
    /* Easing stays opt-in via #setupLists. It was TRIED for the audit strip and
       measured a hard accuracy failure: the list landed on 18% of the target
       (0.14/0.16/0.17/0.18 of expected at four cursor positions — exactly the
       EASE factor), i.e. the ease ran one step and stopped. Smooth-but-lands-in
       the-wrong-place is worse than the snap it replaced, so the direct write is
       kept and only the DEAD filter below is applied to the audit list. */
    const eased=!!region.closest("#setupLists");
    const EASE=0.18, EASE_EPS=0.5, DEAD=3;
    let scrubY=null, scrubRaf=0, hTarget=null, hLastY=null, hRaf=0, hBlocked=false;
    function step(){
      if(hTarget==null){ hRaf=0; return; }
      const cur=region.scrollTop, d=hTarget-cur;
      if(Math.abs(d)<=EASE_EPS){ region.scrollTop=hTarget; hTarget=null; hRaf=0; return; }
      region.scrollTop=cur+d*EASE;
      /* Scroll offsets snap to DEVICE pixels — 1.11px under zoom .9 — so once
         the remaining gap is under ~3px the 18% step is smaller than half a
         pixel and the write lands back on the value it already had. Without
         this guard the ease sat there forever: a 2px correction, or a 5px
         cursor move, never moved the list at all. If a frame cannot move it,
         finish on the target now. Small corrections therefore land in one
         frame and only real jumps ease. */
      if(region.scrollTop===cur){ region.scrollTop=hTarget; hTarget=null; hRaf=0; return; }
      hRaf=requestAnimationFrame(step);
    }
    function hover(e){
      if(dragging || e.pointerType!=="mouse") return;
      if(canHover && !canHover.matches) return;
      if(!eased){
        /* Other panes: one rAF write straight to the target, as before. The audit
           list keeps a DEAD guard of its own — without it a 1px hand tremor was
           enough (measured 11 distinct scrollTop values and an 86px jump from a
           motionless finger), because this branch has no sub-3px filter. */
        if(isAudit){
          if(hLastY!=null && Math.abs(e.clientY-hLastY)<DEAD) return;
          hLastY=e.clientY;
        }
        scrubY=e.clientY;
        if(scrubRaf) return;
        scrubRaf=requestAnimationFrame(()=>{
          scrubRaf=0;
          const y=scrubY; scrubY=null;
          if(y!=null) jumpTo(y, null);
        });
        return;
      }
      /* A finished drag leaves the thumb at the grab offset, not centred, so
         resuming hover under a still cursor would snap it. Stay off until the
         cursor leaves the lane. */
      if(hBlocked) return;
      if(hLastY!=null && Math.abs(e.clientY-hLastY)<DEAD) return;
      hLastY=e.clientY;
      hTarget=scrollFor(e.clientY, null);
      if(hTarget==null) return;
      if(hRaf) return;
      hRaf=requestAnimationFrame(step);
    }
    function stopHover(){
      scrubY=null; hTarget=null; hLastY=null; hBlocked=false;
      if(scrubRaf){ cancelAnimationFrame(scrubRaf); scrubRaf=0; }
      if(hRaf){ cancelAnimationFrame(hRaf); hRaf=0; }
    }
    bar.addEventListener("pointerenter", hover);
    bar.addEventListener("pointermove", hover);
    bar.addEventListener("pointerleave", stopHover);

    function endDrag(){
      if(!dragging) return;
      dragging=false;
      bar.classList.remove("drag");
      /* Hover stays off until the cursor leaves the lane: after a drag the
         thumb sits at the grab offset, and "thumb centred under the cursor"
         would yank the list to a different position. */
      if(eased){ hBlocked=true; if(hRaf){ cancelAnimationFrame(hRaf); hRaf=0; } hTarget=null; }
      try{ bar.releasePointerCapture(pid); }catch(_){}
    }
    bar.addEventListener("pointerup", endDrag);
    bar.addEventListener("pointercancel", endDrag);
    bar.addEventListener("keydown",(e)=>{
      const m=metrics();
      if(!(m.on && m.ch>=MIN_REGION_H)) return;
      const step=60, page=m.ch*0.9;
      let d=0;
      if(e.key==="ArrowDown") d=step;
      else if(e.key==="ArrowUp") d=-step;
      else if(e.key==="PageDown") d=page;
      else if(e.key==="PageUp") d=-page;
      else if(e.key==="Home"){ region.scrollTop=0; paint(); e.preventDefault(); return; }
      else if(e.key==="End"){ region.scrollTop=m.sh; paint(); e.preventDefault(); return; }
      else return;
      region.scrollTop+=d;
      paint();
      e.preventDefault();
    });
    paint();
  }

  function attach(){
    /* No visibility gate here. At script load the admin layer is still closed,
       so every region has no box and the old offsetParent check skipped them
       all — which is why the audit list had NO bar at all on the real device
       until a reload happened with Admin already open. build() gates on real
       scrollability and paint() hides any bar whose visible height is too
       small, so attaching while hidden is safe. */
    document.querySelectorAll("#adminLayer "+REGIONS).forEach(build);
    /* Regions built earlier still need a repaint: opening the admin layer
       changes their visible box without changing the DOM. */
    for(let i=0;i<repaints.length;i++) repaints[i]();
  }
  attach();
  /* Rows/lists appear after data renders, so re-scan as the app works. */
  if(window.MutationObserver){
    const mo=new MutationObserver(()=>attach());
    mo.observe(sc, {childList:true, subtree:true});
    /* Opening/closing Admin changes no children, only a class — without this
       the bars stayed unbuilt for the whole session. */
    const layer=document.getElementById("adminLayer");
    if(layer) new MutationObserver(()=>attach()).observe(layer, {attributes:true, attributeFilter:["class"]});
  }
  window.addEventListener("resize", attach, {passive:true});
})();
// CSV import (backend) — posts the body to /api/import/csv (field "file")
(function(){
  const toolbar = document.querySelector('#pane-students .tab-toolbar');
  if(!toolbar) return;
  const impBtn = $("importStudentsBtn");
  if(!impBtn) return;
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
    const file=e.target.files?.[0]; if(!file) return;
    fileInput.value='';
    const prev=impBtn.textContent; impBtn.textContent='Importing…'; impBtn.disabled=true;
    try{
      const fd=new FormData(); fd.append('file',file);
      const r=await api('/api/import/csv',{method:'POST',body:fd});
      await glassAlert(`Import complete: ${r.added||0} added, ${r.skipped||0} skipped${r.errors?.length?` (${r.errors.length} errors)`:''}`);
      await loadAll();
    }catch(err){ await glassAlert('Import failed: '+(err.message||err)); }
    finally{ impBtn.textContent=prev; impBtn.disabled=false; }
  };
})();
 // Students Export CSV (client-side) — columns per docs/ADMIN.md; rate over full history
(function(){
  const expBtn = $("exportStudentsBtn");
  if(!expBtn || expBtn._csvWired) return;
  expBtn._csvWired = true;
  expBtn.onclick=()=>{
    const head=["Name","Roll","Class","Batch","Section","Parent","Phone","Address","Fingerprint","Status","Attendance rate %"];
    const rows=Students.map(s=>{
      const ev=AllEvents.filter(a=>a.studentId===s.id);
      const p=ev.filter(a=>a.status==="Present").length, l=ev.filter(a=>a.status==="Late").length, ab=ev.filter(a=>a.status==="Absent").length;
      const t=p+l+ab, rate=t?Math.round(100*(p+l)/t):"";
      return [s.name,s.roll,s.class,s.batch||"",s.section||"",s.parent||"",s.phone||"",s.address||"",s.fid||"",s.active?"Active":"Inactive",rate];
    });
    exportCSV([head,...rows],"students_"+todayISO()+".csv");
  };
})();
// Unified Attendance toolbar actions & event listeners
const handleAttendancePrint = () => {
  const school = Settings.schoolName || "ATL Model School";
  const preset = attDatePreset ? attDatePreset.value : "today";
  const today = todayISO();
  const {from, to} = resolveAttRange(preset, null);

  const isSingleDay = (from === to);
  const cf = attClassFilter ? attClassFilter.value : "";
  const bf = attBatchFilter ? attBatchFilter.value : "";
  const sid = (attStudentFilter && attStudentFilter.value) ? parseInt(attStudentFilter.value) : null;
  const stu = sid ? Students.find(s => s.id === sid) : null;

  let scopeLabel = "Entire School";
  if(stu) scopeLabel = `Student: ${stu.name} (Roll: ${stu.roll||"—"}, Class: ${stu.class||"—"}${stu.batch ? " · Batch: " + stu.batch : ""})`;
  else if(cf && bf) scopeLabel = `Class: ${cf} · Batch: ${bf}`;
  else if(cf) scopeLabel = `Class: ${cf}`;
  else if(bf) scopeLabel = `Batch: ${bf}`;

  let dateDesc = "";
  if(isSingleDay){
    dateDesc = (from === today) ? `Today — ${fmtDate(from)} (${from})` : `Date: ${fmtDate(from)} (${from})`;
  } else {
    dateDesc = `Date Range: ${fmtDate(from)} to ${fmtDate(to)} (${from} → ${to}, ${rangeDays(from,to)} days)`;
  }

  const generated = new Date().toLocaleString();
  const titleText = stu ? `${school} — Student Attendance (${stu.name})` : (isSingleDay ? `${school} — Attendance (${from})` : `${school} — Attendance Report`);

  const hdr = `
    <div class="report-header">
      <h1>${esc(titleText)}</h1>
      <div class="report-subtitle">
        <div><strong>${esc(dateDesc)}</strong> &nbsp;·&nbsp; <span>${esc(scopeLabel)}</span></div>
        <div><span class="report-meta-tag">Generated: ${esc(generated)}</span></div>
      </div>
    </div>`;

  const stats = (attStats && attStats.children.length) ? `<div class="stats-row">${attStats.innerHTML}</div>` : "";
  /* Read the rows the table actually painted. lastAttRender.rows is the
     pre-search snapshot and is still the empty default until the async
     renderAttendance finishes — printing it alone yields a header + stats
     with no records. attShownRows is the filtered set paintAttTable draws. */
  const lr = (attShownRows && attShownRows.length) ? attShownRows
    : ((typeof lastAttRender!=="undefined" && lastAttRender && lastAttRender.rows) ? lastAttRender.rows : []);
  const lrSingle = (typeof lastAttRender!=="undefined" && lastAttRender) ? !!lastAttRender.isSingleDay : true;
  const tblHtml = lr.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Time</th><th>Student</th><th>Roll</th><th>Class</th><th>Status</th><th>Fingerprint</th></tr></thead><tbody>${lr.map(r=>`<tr><td>${esc(r.a.date||"")}</td><td>${esc(r.a.time||"")}</td><td>${esc(r.s.name||"")}</td><td>${esc(r.s.roll||"")}</td><td>${esc(r.s.class||"")}</td><td>${esc(r.a.status||"")}${r.a.isDuplicate?" (Duplicate)":""}</td><td>${esc(r.a.fingerId!=null?"F-"+r.a.fingerId:"")}</td></tr>`).join("")}</tbody></table></div>` : "";

  let unknownsHtml = "";
  const unkRows = attUnknownBody ? attUnknownBody.querySelectorAll(".ar") : [];
  const hasUnks = unkRows.length>0 && !stu;
  if(hasUnks){
    unknownsHtml = `
      <div class="report-section">
        <div class="section-title">Unknown Scan Attempts (${unkRows.length})</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>Fingerprint</th><th>Note</th></tr></thead>
            <tbody>
              ${attUnknownBody.innerHTML}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  printHTML(hdr + stats + tblHtml + unknownsHtml, `${school} — Attendance (${from}${from!==to?" to "+to:""})`);
};

const handleAttendanceExport = async () => {
  const preset = attDatePreset ? attDatePreset.value : "today";
  const {from, to} = resolveAttRange(preset, null);

  const isSingleDay = (from === to);
  const cf = attClassFilter ? attClassFilter.value : "";
  const bf = attBatchFilter ? attBatchFilter.value : "";
  const sf = attStatusFilter ? attStatusFilter.value : "";
  const sid = (attStudentFilter && attStudentFilter.value) ? parseInt(attStudentFilter.value) : null;
  const stu = sid ? Students.find(s => s.id === sid) : null;

  // Prefer backend CSV streaming export for all date ranges
  try {
    let url = "/api/export/csv?type=attendance";
    if(isSingleDay){
      url += "&date=" + encodeURIComponent(from);
    } else {
      url += "&start=" + encodeURIComponent(from) + "&end=" + encodeURIComponent(to);
    }
    if(cf) url += "&class=" + encodeURIComponent(cf);
    if(bf) url += "&batch=" + encodeURIComponent(bf);
    if(sid) url += "&studentId=" + encodeURIComponent(sid);
    if(sf && sf !== "All" && sf !== "Unknown"){
      url += "&status=" + encodeURIComponent(sf.toUpperCase().replace(" ","_"));
    }

    const pinHeaders = {};
    try { const p = sessionStorage.getItem("atl_admin_pin"); if(p) pinHeaders["X-Admin-Pin"] = p; }catch(_e){}

    const r = await fetch(url, {cache: "no-store", headers: pinHeaders});
    if(r.ok){
      const blob = await r.blob();
      const url2 = URL.createObjectURL(blob), a = document.createElement('a');
      let baseName = stu ? `attendance_${stu.roll || stu.name}` : `attendance_${from}${from!==to ? "_to_"+to : ""}${cf ? "_"+cf : ""}${bf ? "_"+bf : ""}`;
      if(stu && from !== to) baseName += `_${from}_to_${to}`;
      a.href = url2;
      a.download = (baseName + ".csv").replace(/[\s\/\\:]+/g, "_");
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url2), 1500);
      return;
    }
  } catch(e){}

  // Fallback / offline frontend CSV export (from last render data, never DOM)
  /* Same source as the print: the rows the table paints, so the CSV honours
     the active filters/search instead of the pre-search snapshot. */
  const lrRows = (attShownRows && attShownRows.length) ? attShownRows
    : ((lastAttRender && lastAttRender.rows) ? lastAttRender.rows : []);
  const lr = {rows:lrRows, isSingleDay:(lastAttRender?lastAttRender.isSingleDay:isSingleDay), from:(lastAttRender&&lastAttRender.from)||from, to:(lastAttRender&&lastAttRender.to)||to};
  const rows = [["Date", "Time", "Student", "Roll", "Class", "Batch", "Status", "Fingerprint"]];
  for(const r of lr.rows){
    if(!r || !r.s) continue;
    const status = r.a.status + (r.a.isDuplicate ? " Duplicate" : "");
    const finger = r.a.fingerId!=null ? "F-"+r.a.fingerId : "";
    if(lr.isSingleDay) rows.push([lr.from, r.a.time||"", r.s.name, r.s.roll, r.s.class, r.s.batch||"", status, finger]);
    else rows.push([r.a.date||lr.from, r.a.time||"", r.s.name, r.s.roll, r.s.class, r.s.batch||"", status, finger]);
  }
  const filename = `attendance-${from}${from!==to ? "-to-"+to : ""}${cf?"-"+cf:""}.csv`;
  exportCSV(rows, filename);
};

const handleAttendanceRefresh = async () => {
  const btn = attRefreshBtn;
  if(btn){ btn.disabled = true; }
  try {
    await loadTodayAttendance();
    await renderAttendance();
  } finally {
    if(btn){ btn.disabled = false; }
  }
};

if(attRefreshBtn) attRefreshBtn.onclick = handleAttendanceRefresh;
if(attPrintBtn) attPrintBtn.onclick = handleAttendancePrint;
if(attExportBtn) attExportBtn.onclick = handleAttendanceExport;

if(attDatePreset) attDatePreset.addEventListener("change", () => {
  const v = attDatePreset.value;
  if(attSingleDate) attSingleDate.style.display = (v === "custom_day") ? "" : "none";
  if(attFromDate) attFromDate.style.display = (v === "custom_range") ? "" : "none";
  if(attToDate) attToDate.style.display = (v === "custom_range") ? "" : "none";
  renderAttendance();
});
if(attSingleDate) attSingleDate.addEventListener("change", renderAttendance);
if(attFromDate) attFromDate.addEventListener("change", renderAttendance);
if(attToDate) attToDate.addEventListener("change", renderAttendance);
if(attClassFilter) attClassFilter.addEventListener("change", () => {
  populateAttStudents();
  renderAttendance();
});
if(attBatchFilter) attBatchFilter.addEventListener("change", () => {
  populateAttStudents();
  renderAttendance();
});
if(attStudentFilter) attStudentFilter.addEventListener("change", renderAttendance);
if(attStatusFilter) attStatusFilter.addEventListener("change", renderAttendance);
if($("attSearch")) $("attSearch").addEventListener("input",()=>{ try{ attSearchQ=$("attSearch").value.trim().toLowerCase(); }catch(e){ attSearchQ=""; } renderAttendance(); });
/* Near-bottom paging (user order): next 50 rows without refetching. */
(function(){
  const rv=$("attRecordsView"); if(!rv||rv._moreWired) return; rv._moreWired=true;
  rv.addEventListener("scroll",()=>{
    try{
      if(attShowLimit>=((lastAttRender.rows||[]).length)) return;
      if(rv.scrollHeight-rv.scrollTop-rv.clientHeight>400) return;
      attShowLimit+=50; paintAttTable();
    }catch(e){}
  },{passive:true});
})();
/* Empty-state Clear filters (user order): same full reset as the brick. */
if(attTableBody && !attTableBody._clearWired){ attTableBody._clearWired=true; attTableBody.addEventListener("click",(e)=>{ if(e.target&&e.target.closest&&e.target.closest("[data-clear-filters]")){ try{ clearAttendanceSection(); }catch(err){} } }); }
if(attSort) attSort.addEventListener("change", renderAttendance);
/* Time sort toggle (user order): the only sort control — flips newest/oldest
   through the existing attSort select so all sort machinery keeps working. */
function paintTimeToggle(){ const b=$("attTimeToggle"); if(!b) return; const v=(attSort&&attSort.value)||"time_desc"; b.textContent=v==="time_asc"?"Time: oldest":"Time: newest"; }
if($("attTimeToggle")) $("attTimeToggle").onclick=()=>{ if(!attSort) return; attSort.value=(attSort.value==="time_asc")?"time_desc":"time_asc"; try{ attSort.dispatchEvent(new Event("change",{bubbles:true})); }catch(e){} paintTimeToggle(); };
/* Board tabs (user order): records / unknown share one fixed board.
   Static nodes (only tbody refills), so one binding holds. Instant
   channel swap, no motion. */
let attBoardTab = "records";
/* Table paging + search state (user order): first 50 rows, next 50 near the
   bottom; search narrows name + roll live. lastAttRender keeps FULL rows for
   print/export; attShownRows is what the table paints. */
let attShowLimit=50, attViewKey="", attSearchQ="", attShownRows=[];
function attFD(iso){ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||""); if(!m) return iso||"—"; return (+m[3])+" "+MONTHS_S[+m[2]-1]+" "+m[1]; }
function attFT(t){ if(t==="23:59:59"||t==="00:00:00") return "—"; const m=/^(\d{1,2}):(\d{2})/.exec(t||""); if(!m) return "—"; let h=+m[1]; const ap=h>=12?"PM":"AM"; h=h%12; if(h===0)h=12; return h+":"+m[2]+" "+ap; }
function attFS(a){ return a==="Not Scheduled"?"Not scheduled":a; }
function attFW(w){ return w==="Not Scheduled"?"Not scheduled":w; }
function attWorkOf(r,from){
  let working="—";
  if(r.s && (r.a.date||from)){
    const d=r.a.date||from;
    working = isWorkingDayForStudent(d, r.s) ? "Scheduled" : "Not Scheduled";
    if(r.a.status === "Not Scheduled") working = "Not Scheduled";
    else if(r.a.status === "Absent" && !isWorkingDayForStudent(d, r.s)) working = "Not Scheduled";
  }
  return working;
}
function attFilterActive(){ try{ return !!((attClassFilter&&attClassFilter.value)||(attBatchFilter&&attBatchFilter.value)||(attStudentFilter&&attStudentFilter.value)||(attStatusFilter&&attStatusFilter.value)||attSearchQ); }catch(e){ return false; } }
function attRowHTML(r,from){
  const stL2=s=>({Present:"P",Late:"L",Absent:"A"})[s]||"X";
  const isDupe = r.a.isDuplicate ? `<span>Dup</span>` : ``;
  const correctBtn = `<button data-correct data-correct-sid="${r.s.id}" data-correct-date="${esc(r.a.date || from)}" data-correct-status="${esc(r.a.status)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>Correct</button>`;
  const working=attWorkOf(r,from);
  return `<div class="ar" data-student="${r.s.id}">
    <span>${esc(attFD(r.a.date||from))}</span>
    <span>${esc(attFT(r.a.time))}</span>
    <span>${esc(r.s.name)}</span>
    <span>${esc(r.s.roll)}</span>
    <span>${esc(r.s.class)}</span>
    <span class="s-${stL2(r.a.status)}">${esc(attFS(r.a.status))}${isDupe}</span>
    <span>${esc(attFW(working))}</span>
    ${correctBtn}
  </div>`;
}
function paintAttTable(){
  try{
    const L=lastAttRender, all=attShownRows||[];
    const drows=all.slice(0,attShowLimit);
    if(!all.length){
      const clear=attFilterActive()?` <button type="button" data-clear-filters>Clear filters</button>`:"";
      attTableBody.innerHTML=`<div class="att-empty">No attendance records.${clear}</div>`;
    } else {
      attTableBody.innerHTML=drows.map(r=>attRowHTML(r,L.from)).join("");
    }
    const rc=document.getElementById("attRecordCount");
    if(rc) rc.textContent=all.length+(all.length===1?" record":" records");
    paintFadeBottom($("attRecordsView"));
  }catch(e){}
}
/* Last rendered attendance rows (data, not DOM) — feeds the offline CSV fallback */
let lastAttRender = {rows:[], isSingleDay:true, from:"", to:""};
function paintAttTabs(){
  const unk = attBoardTab === "unknown";
  document.querySelectorAll('#attRecordsBoard .att-tab').forEach(b=>{
    const on = (b.dataset.attab || "records") === attBoardTab;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  const rv = $("attRecordsView"), uv = $("attUnknownView");
  const rw = $("attRecordsWrap"), uw = $("attUnknownWrap");
  if(rw) rw.hidden = unk;
  if(uw) uw.hidden = !unk;
  if(rv) rv.hidden = false;
  if(uv) uv.hidden = false;
  const rc = $("attRecordCount"), uc = $("attUnknownCount");
  if(rc) rc.hidden = unk;
  if(uc) uc.hidden = !unk;
}
document.querySelectorAll('#attRecordsBoard .att-tab').forEach(b=>{
  b.addEventListener("click", ()=>{ attBoardTab = b.dataset.attab || "records"; paintAttTabs(); });
});
/* Stat cells (user order): the five status cells filter the records table
   through the existing attStatusFilter (no new mechanism) — tap a status
   filters, tap Total or the active cell clears. Unknown scans opens the
   unknown tab (tap again to return); Duplicate scans filters duplicates. */
if(attStats && !attStats.dataset.cubes){
  attStats.dataset.cubes = "1";
  attStats.addEventListener("click", (e)=>{
    const t=(e.target && e.target.closest) ? e.target.closest(".stat[data-act]") : null;
    if(t && attStats.contains(t)){
      const act=t.getAttribute("data-act");
      if(act==="unknown"){
        attBoardTab=(attBoardTab==="unknown")?"records":"unknown";
        try{ paintAttTabs(); }catch(_){}
        return;
      }
    }
    const c = (e.target && e.target.closest) ? e.target.closest(".stat[data-f]") : null;
    if(!c || !attStats.contains(c) || !attStatusFilter) return;
    if(attBoardTab!=="records"){ attBoardTab="records"; try{ paintAttTabs(); }catch(_){} }
    const v = c.getAttribute("data-f") || "";
    const next = (v && v === attStatusFilter.value) ? "" : v;
    if(attStatusFilter.value !== next){
      attStatusFilter.value = next;
      try{ attStatusFilter.dispatchEvent(new Event("change", {bubbles:true})); }catch(_){}
    }
    try{ renderAttendance(); }catch(err){ console.error(err); }
  });
}
/* Section Clear: full attendance reset — preset Today, dates emptied,
   year override dropped, all filters to All, shell shut, table reloaded */
function clearAttendanceSection(){
  try{ closeDtPops(); }catch(e){ console.error(e); }
  try{ attAcadFrom=attAcadTo=null; }catch(e){ console.error(e); }
  try{ if(attSingleDate) attSingleDate.value=""; }catch(e){ console.error(e); }
  try{ if(attFromDate) attFromDate.value=""; }catch(e){ console.error(e); }
  try{ if(attToDate) attToDate.value=""; }catch(e){ console.error(e); }
  ["attClassFilter","attBatchFilter","attStudentFilter","attStatusFilter"].forEach(id=>{
    try{ const el=$(id); if(el) el.value=""; }catch(e){ console.error(e); }
  });
  try{ attSearchQ=""; const si=$("attSearch"); if(si) si.value=""; attShowLimit=50; }catch(e){ console.error(e); }
  try{ if(attSort) attSort.value="time_desc"; }catch(e){ console.error(e); }
  try{ populateAttStudents(); }catch(e){ console.error(e); }
  try{ _dtCommitPreset("today"); }catch(e){ console.error(e); }
  try{ renderAttendance(); }catch(e){ console.error(e); }
}

$("calPrevBtn").onclick=()=>{ calendarMonth.setMonth(calendarMonth.getMonth()-1); renderCalendarMonth(); };
$("calNextBtn").onclick=()=>{ calendarMonth.setMonth(calendarMonth.getMonth()+1); renderCalendarMonth(); };
if($("calTodayBtn")) $("calTodayBtn").onclick=()=>{ calendarMonth=new Date(); renderCalendarMonth(); };
/* Legend emphasis: sticky single-select over the existing resolved
   day states (working / non-working + holidays / override). No
   navigation, no data change — pressing a status selects it and it
   stays selected (re-pressing or double-clicking never clears it).
   Grid classes survive re-render (set on the container, cells repaint
   inside). */
let calEmphasis=null;
if($("setupToolbar")) $("setupToolbar").addEventListener("click",(e)=>{
  const b=e.target.closest("[data-calview]"); if(!b) return;
  calEmphasis = b.dataset.calview;
  document.querySelectorAll("#setupToolbar [data-calview]").forEach(x=>x.setAttribute("aria-pressed", x===b?"true":"false"));
  try{ $("monthViewResetBtn").setAttribute("aria-pressed","false"); }catch(_){}
  const g=$("calendarGrid"); if(!g) return;
  g.dataset.v=calEmphasis==="working"?"working":calEmphasis==="non-working"?"nonworking":calEmphasis==="override"?"overrides":calEmphasis==="holiday"?"holidays":"month";
});
/* Month View reset: clears the sticky legend emphasis back to the full
   month (the only way back — re-pressing a filter keeps it). */
if($("monthViewResetBtn")) $("monthViewResetBtn").onclick=()=>{
  calEmphasis=null;
  document.querySelectorAll("#setupToolbar [data-calview]").forEach(x=>x.setAttribute("aria-pressed","false"));
  try{ $("monthViewResetBtn").setAttribute("aria-pressed","true"); }catch(_){}
  const g=$("calendarGrid"); if(!g) return;
  g.dataset.v="month";
};
/* Day window is read-only resolved display — tables own all holiday /
   override editing. Resolution read ONLY from the shared truth
   functions: override → holiday (exam = working) → active-context
   template. Headers keep editing the template. */
function daySheetSource(iso, ctx){
  const ov=getOverride(iso);
  if(ov) return {badge:ov.isWorking?"WORKING":"NON-WORKING",
    text:"Date override (global) — "+(ov.isWorking?"working":"non-working")+(ov.note?": "+ov.note:"")+fmtTimes(ov)};
  const hol=isHoliday(iso);
  if(hol){
    const type=String(hol.type||"holiday").toLowerCase();
    const exam=type==="exam";
    return {badge:exam?"WORKING":"NON-WORKING",
      text:"Holiday range (global) — "+hol.name+" ("+hol.type+")"+fmtTimes(hol)+(exam?", counts as working":"")};
  }
  const w=isWorkingDayForContext(iso, ctx);
  const ctxName=(!ctx||ctx.type==="global")?"Global":(ctx.type==="class"?"Class: "+ctx.name:"Batch: "+ctx.name);
  return {badge:w?"WORKING":"NON-WORKING",
    text:"Weekly template ("+ctxName+") — "+(w?"working":"non-working")};
}
/* Day-sheet thought bubble (user order): anchored popover, not a
   modal. Anchor = clicked date cell; bubble flips below/above +
   clamps horizontally, tail tracks the cell center; the cell is never
   covered (below/above always clears it). */
let _dsAnchor=null;
let _undoTimer=null, _undoData=null;
function _undoOutside(e){ try{ if(e.target&&e.target.closest&&e.target.closest("#setupUndoBar")) return; hideSetupUndo(); }catch(_){} }
function hideSetupUndo(){ try{ if(_undoTimer){ clearTimeout(_undoTimer); _undoTimer=null; } }catch(e){} _undoData=null; try{ const b=$("setupUndoBar"); if(b) b.hidden=true; }catch(e){} try{ document.removeEventListener("pointerdown",_undoOutside,true); }catch(e){} }
function showSetupUndo(kind, rec){
  hideSetupUndo();
  _undoData={kind:kind, rec:rec};
  try{
    const bar=$("setupUndoBar"), msg=$("setupUndoMsg"), btn=$("setupUndoBtn");
    if(msg) msg.textContent=(kind==="holiday"?"Holiday removed":"Override removed")+" · ";
    if(btn) btn.onclick=()=>undoSetupRemove();
    if(bar) bar.hidden=false;
    document.removeEventListener("pointerdown",_undoOutside,true);
    document.addEventListener("pointerdown",_undoOutside,true);
    _undoTimer=setTimeout(()=>hideSetupUndo(),5000);
  }catch(e){}
}
async function undoSetupRemove(){
  const d=_undoData; hideSetupUndo(); if(!d) return;
  try{
    if(d.kind==="holiday"){ Holidays.push(d.rec); Holidays.sort((a,b)=>String(a.start).localeCompare(String(b.start))||String(a.end).localeCompare(String(b.end))); }
    else{ Overrides.push(d.rec); Overrides.sort((a,b)=>String(a.date).localeCompare(String(b.date))); }
    if(await persistCalendar()){ renderHolidays(); renderOverrides(); renderCbTables(); renderCalendarMonth(); }
  }catch(e){}
}
function _dsOutside(e){ try{ if(daySheetModal&&daySheetModal.classList.contains("open")&&!(e.target&&e.target.closest&&e.target.closest("#daySheetModal .mod"))) closeDaySheet(); }catch(_){} }
function _dsScrollShut(){ try{ if(daySheetModal&&daySheetModal.classList.contains("open")) closeDaySheet(); }catch(_){} }
function _dsReposition(){ try{ if(daySheetModal&&daySheetModal.classList.contains("open")) positionDaySheet(); }catch(_){} }
function closeDaySheet(){ try{ document.removeEventListener("pointerdown",_dsOutside,true); document.removeEventListener("scroll",_dsScrollShut,true); window.removeEventListener("resize",_dsReposition); }catch(e){} _dsAnchor=null; closeModal(daySheetModal); }
function positionDaySheet(){
  const card=(typeof daySheetModal!=="undefined"&&daySheetModal)?daySheetModal.querySelector(".mod"):null;
  if(!card||!_dsAnchor||!_dsAnchor.getBoundingClientRect) return;
  const GAP=10, M=8, vw=window.innerWidth, vh=window.innerHeight;
  const r=_dsAnchor.getBoundingClientRect();
  const bw=card.offsetWidth||320, bh=card.offsetHeight||200;
  /* Half-based flip (user order): cell in the lower half opens the
     bubble above it (tail down); upper half opens below (tail up).
     M-pin stays as last-resort safety only. */
  let top, tail;
  if((r.top+r.height/2)>vh/2){ top=r.top-GAP-bh; tail="bottom"; }
  else{ top=r.bottom+GAP; tail="top"; }
  if(top+bh+M>vh) top=Math.max(M,vh-bh-M);
  if(top<M) top=M;
  let left=Math.round(r.left+r.width/2-bw/2);
  left=Math.max(M,Math.min(left,Math.max(M,vw-bw-M)));
  let tx=Math.round(r.left+r.width/2-left);
  tx=Math.max(22,Math.min(tx,bw-22));
  card.style.left=left+"px"; card.style.top=top+"px";
  try{ card.dataset.tail=tail; }catch(e){}
}
function openDaySheet(iso, cell){
  const ctx=getScheduleContext();
  const src=daySheetSource(iso, ctx);
  const dt=new Date(iso+"T00:00:00");
  const ov=getOverride(iso), hol=isHoliday(iso);
  daySheetTitle.textContent=dt.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"short",year:"numeric"});
  const dsBadge=ov?((ov.note||"Override")+" · "+(ov.isWorking?"Working":"Holiday")):(hol?((hol.name||"Holiday")+" · "+(String(hol.type||"holiday").toLowerCase()==="exam"?"Working":"Holiday")):src.badge);
  const dsMk=ov?(hol?"both":"ovr"):(hol?"hol":"");
  const dsWeek=dt.toLocaleDateString("en-GB",{weekday:"long"});
  const dsShort=dt.getDate()+" "+MONTHS_S[dt.getMonth()]+" "+dt.getFullYear();
  daySheetBody.innerHTML=
    `<div class="mk${dsMk?" "+dsMk:""}"></div><div class="eye">${esc(dsBadge)}</div>`+
    `<div class="d1">${esc(dsWeek)}</div><div class="d2">${esc(dsShort)}</div>`+
    `<div class="src">${esc(src.text)}</div>`+
    `<div class="ft"><button class="act m" id="dsClose">Close</button>${ov?`<button class="act del" id="dsDelOv" aria-label="Remove override">Delete</button>`:""}${(!ov&&hol)?`<button class="act del" id="dsDelHol" aria-label="Remove holiday">Delete</button>`:""}<button class="act p" id="dsAddOv">Add override for this date</button></div>`;
  openModal(daySheetModal);
  _dsAnchor=(typeof cell!=="undefined"&&cell)||null;
  try{
    document.removeEventListener("pointerdown",_dsOutside,true);
    document.removeEventListener("scroll",_dsScrollShut,true);
    window.removeEventListener("resize",_dsReposition);
    document.addEventListener("pointerdown",_dsOutside,true);
    document.addEventListener("scroll",_dsScrollShut,true);
    window.addEventListener("resize",_dsReposition);
  }catch(e){}
  positionDaySheet();
  $("dsClose").onclick=()=>closeDaySheet();
  const rmOvBtn=$("dsDelOv");
  if(rmOvBtn) rmOvBtn.onclick=async()=>{
    const o=Overrides.find(x=>x.date===iso); if(!o) return;
    Overrides=Overrides.filter(x=>x.date!==iso);
    closeDaySheet();
    if(await persistCalendar()){ renderOverrides(); renderCbTables(); renderCalendarMonth(); showSetupUndo("override",o); }
    else{ Overrides.push(o); Overrides.sort((a,b)=>String(a.date).localeCompare(String(b.date))); }
  };
  const rmHolBtn=$("dsDelHol");
  if(rmHolBtn) rmHolBtn.onclick=async()=>{
    const h=isHoliday(iso); if(!h) return;
    Holidays=Holidays.filter(x=>x.start!==h.start);
    closeDaySheet();
    if(await persistCalendar()){ renderHolidays(); renderCbTables(); renderCalendarMonth(); showSetupUndo("holiday",h); }
    else{ Holidays.push(h); Holidays.sort((a,b)=>String(a.start).localeCompare(String(b.start))||String(a.end).localeCompare(String(b.end))); }
  };
  $("dsAddOv").onclick=()=>{
    closeDaySheet();
    $("overrideModalBody").innerHTML=`<div class="g2">
      <div class="fld"><label>Date</label><input type="date" id="overrideDate" value="${esc(iso)}"></div>
      <div class="fld"><label>Becomes</label><div class="seg two" id="overrideWorkingRow" role="radiogroup"></div><select id="overrideWorking" data-gsel="1" class="dlg-hidden"><option value="1">Working day</option><option value="0">Holiday</option></select></div>
      <div class="fld"><label>Start time</label><input type="time" id="overrideStartTime"></div>
      <div class="fld"><label>End time</label><input type="time" id="overrideEndTime"></div>
      <div class="fld w"><label>Note</label><input id="overrideNote" autocomplete="off" spellcheck="false" placeholder="Special working Saturday"></div>
      <div class="ft"><span class="form-pair"><button id="overrideCancel">Cancel</button><button class="go" id="overrideSave">Save override</button></span></div>
      <div class="err" id="overrideErr" style="display:none"></div></div>`;
    openModal(overrideModal);
    $("overrideCancel").onclick=()=>closeModal(overrideModal);
    dlgPaintRow($("overrideWorking"),$("overrideWorkingRow"));
    const ovrSync0=()=>{ const b=$("overrideSave"); if(!b) return;
      const d=$("overrideDate").value, n=$("overrideNote").value.trim();
      const stm=$("overrideStartTime").value, etm=$("overrideEndTime").value;
      b.disabled=!(d&&!n.includes("@")&&(!stm||isHHMM(stm))&&(!etm||isHHMM(etm))); };
    $("overrideModalBody").addEventListener("input",ovrSync0);
    $("overrideModalBody").addEventListener("change",ovrSync0);
    ovrSync0();
    $("overrideSave").onclick=async()=>{
      const date=$("overrideDate").value, note=$("overrideNote").value.trim(), err=$("overrideErr");
      if(!date){ err.textContent="A date is required."; err.style.display="block"; return; }
      if(note.includes("@")){ err.textContent="Notes cannot contain the @ symbol."; err.style.display="block"; return; }
      let stm=$("overrideStartTime").value, etm=$("overrideEndTime").value;
      if((stm&&!isHHMM(stm))||(etm&&!isHHMM(etm))){ err.textContent="Times must be HH:MM (or left empty for all day)."; err.style.display="block"; return; }
      [stm,etm]=normTimes(stm,etm);
      Overrides=Overrides.filter(o=>o.date!==date);
      Overrides.push({date,isWorking:$("overrideWorking").value==="1",note,startTime:stm,endTime:etm});
      if(await persistCalendar()){ closeModal(overrideModal); renderOverrides(); renderCalendarMonth(); }
    };
    $("overrideModalTitle").textContent="Add override";
    $("overrideNote").focus();
  };
}
/* Day cells open the read-only window; headers are display-only.
   Weekday toggling lives in the class/batch solid schedule editor —
   branch bodies lifted verbatim from the retired header path, with
   the editor context plus an editor refresh. Single persist path. */
async function onDayToggleClick(e){
  const cell=e.target.closest("[data-date]");
  if(cell){ openDaySheet(cell.dataset.date, cell); return; }
}
let csCtx=null;
function openClassSchedule(ctx){
  if(ctx.type==="class"){ selKind="class"; selName=ctx.name; }
  else if(ctx.type==="batch"){ selKind="batch"; selName=ctx.name; }
  renderClasses();
  syncCsCtx();
}
/* Editor nodes are per-render (wired by wireSchedEditor). */
if($("calendarGrid")){
  $("calendarGrid").addEventListener("click", onDayToggleClick);
}
/* Context dropdown drives the same single selection as the tiles:
   retarget the editor to the chosen class/batch (or hide it for
   global) so toolbar, month, roster, and editor never disagree.
   Same flow as tile select: clear staged edits, sync, re-render. */
if($("calClassSelect")) $("calClassSelect").onchange=()=>{
  const raw=$("calClassSelect").value;
  /* Jump targets (user order): holiday/override picks navigate the
     month to that date on the global template — same renders as a
     context retarget, zero popups. */
  const jm=/^(holiday|override):(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if(jm){
    const iso=jm[2]+"-"+jm[3]+"-"+jm[4];
    if(jm[1]==="holiday"){ const h=Holidays.find(x=>x.start===iso); if(h) selHolidayKey=h.start; }
    else selOverrideKey=iso;
    selName=null; pendingDays={}; syncCsCtx();
    cbBatchScope=null;
    calendarMonth=new Date(+jm[2],+jm[3]-1,1);
    renderWeekly(); renderClasses(); renderCbTables(); renderCalendarMonth();
    if(currentTab==="attendance") renderAttendance();
    return;
  }
  const ctx=getScheduleContext();
  pendingDays={};
  if(ctx.type==="global"){ selName=null; }
  else{
    selKind=ctx.type; selName=ctx.name;
    if(cubeView!==ctx.type) cubeView=ctx.type;
  }
  syncCsCtx();
  cbBatchScope=(ctx.type==="class")?ctx.name:null;
  renderWeekly(); renderClasses(); renderCbTables();
  const sel=$("calClassSelect");
  if(sel&&selName){
    sel.value = selKind==="class"?`class:${selName}`:`batch:${selName}`;
    if(selKind==="class"&&!sel.value) sel.value=selName;
  }
  if(currentTab==="attendance") renderAttendance();
};
/* Reset-week retired: template editing lives in the solid schedule editor. */
function openHolidayCreate(){
  $("holidayModalTitle").textContent="Add holiday";
  $("holidayModalBody").innerHTML=`<div class="g2">
    <div class="fld w"><label>Name</label><input id="holidayName" autocomplete="off" spellcheck="false" placeholder="Diwali vacation"></div>
    <div class="fld"><label>Start date</label><input type="date" id="holidayStart"></div>
    <div class="fld"><label>End date</label><input type="date" id="holidayEnd"></div>
    <div class="fld"><label>Start time</label><input type="time" id="holidayStartTime"></div>
    <div class="fld"><label>End time</label><input type="time" id="holidayEndTime"></div>
    <div class="fld w"><label>Type</label><div class="seg" id="holidayTypeRow" role="radiogroup"></div><select id="holidayType" data-gsel="1" class="dlg-hidden"><option value="holiday">Holiday</option><option value="vacation">Vacation</option><option value="exam">Exam day</option></select></div>
    <div class="ft"><span class="form-pair"><button id="holidayCancel">Cancel</button><button class="go" id="holidaySave">Save holiday</button></span></div>
    <div class="err" id="holidayErr" style="display:none"></div></div>`;
  openModal(holidayModal);
  $("holidayCancel").onclick=()=>closeModal(holidayModal);
  dlgPaintRow($("holidayType"),$("holidayTypeRow"));
  const holSync=()=>{ const b=$("holidaySave"); if(!b) return;
    const n=$("holidayName").value.trim(), s=$("holidayStart").value, e=$("holidayEnd").value||s;
    const stm=$("holidayStartTime").value, etm=$("holidayEndTime").value;
    b.disabled=!(n&&!n.includes("@")&&s&&e&&s<=e&&(!stm||isHHMM(stm))&&(!etm||isHHMM(etm))); };
  $("holidayModalBody").addEventListener("input",holSync);
  $("holidayModalBody").addEventListener("change",holSync);
  holSync();
  $("holidaySave").onclick=async()=>{
    const name=$("holidayName").value.trim(), start=$("holidayStart").value, end=$("holidayEnd").value||start, err=$("holidayErr");
    if(!name||!start||!end||start>end){ err.textContent="Name and a valid date range are required."; err.style.display="block"; return; }
    if(name.includes("@")){ err.textContent="Names cannot contain the @ symbol."; err.style.display="block"; return; }
    let stm=$("holidayStartTime").value, etm=$("holidayEndTime").value;
    if((stm&&!isHHMM(stm))||(etm&&!isHHMM(etm))){ err.textContent="Times must be HH:MM (or left empty for all day)."; err.style.display="block"; return; }
    [stm,etm]=normTimes(stm,etm);
    Holidays.push({name,start,end,startTime:stm,endTime:etm,category:"",type:$("holidayType").value});
    if(await persistCalendar()){ closeModal(holidayModal); renderHolidays(); renderCalendarMonth(); }
  };
}
function openOverrideCreate(){
  $("overrideModalTitle").textContent="Add override";
  $("overrideModalBody").innerHTML=`<div class="g2">
    <div class="fld"><label>Date</label><input type="date" id="overrideDate"></div>
    <div class="fld"><label>Becomes</label><div class="seg two" id="overrideWorkingRow" role="radiogroup"></div><select id="overrideWorking" data-gsel="1" class="dlg-hidden"><option value="1">Working day</option><option value="0">Holiday</option></select></div>
    <div class="fld"><label>Start time</label><input type="time" id="overrideStartTime"></div>
    <div class="fld"><label>End time</label><input type="time" id="overrideEndTime"></div>
    <div class="fld w"><label>Note</label><input id="overrideNote" autocomplete="off" spellcheck="false" placeholder="Special working Saturday"></div>
    <div class="ft"><span class="form-pair"><button id="overrideCancel">Cancel</button><button class="go" id="overrideSave">Save override</button></span></div>
    <div class="err" id="overrideErr" style="display:none"></div></div>`;
  openModal(overrideModal);
  $("overrideCancel").onclick=()=>closeModal(overrideModal);
  dlgPaintRow($("overrideWorking"),$("overrideWorkingRow"));
  const ovrSync=()=>{ const b=$("overrideSave"); if(!b) return;
    const d=$("overrideDate").value, n=$("overrideNote").value.trim();
    const stm=$("overrideStartTime").value, etm=$("overrideEndTime").value;
    b.disabled=!(d&&!n.includes("@")&&(!stm||isHHMM(stm))&&(!etm||isHHMM(etm))); };
  $("overrideModalBody").addEventListener("input",ovrSync);
  $("overrideModalBody").addEventListener("change",ovrSync);
  ovrSync();
  $("overrideSave").onclick=async()=>{
    const date=$("overrideDate").value, note=$("overrideNote").value.trim(), err=$("overrideErr");
    if(!date){ err.textContent="A date is required."; err.style.display="block"; return; }
    if(note.includes("@")){ err.textContent="Notes cannot contain the @ symbol."; err.style.display="block"; return; }
    let stm=$("overrideStartTime").value, etm=$("overrideEndTime").value;
    if((stm&&!isHHMM(stm))||(etm&&!isHHMM(etm))){ err.textContent="Times must be HH:MM (or left empty for all day)."; err.style.display="block"; return; }
    [stm,etm]=normTimes(stm,etm);
    Overrides=Overrides.filter(o=>o.date!==date);
    Overrides.push({date,isWorking:$("overrideWorking").value==="1",note,startTime:stm,endTime:etm});
    if(await persistCalendar()){ closeModal(overrideModal); renderOverrides(); renderCalendarMonth(); }
  };
};
/* Sidebar schedule popup: ADD CLASS / ADD BATCH create with the full
   schedule inline (name + working days + cutoffs). Same .modal
   species as the holiday / override forms; same persist paths as
   the retired inline editor. */
let _pbDays={};
function paintPbDays(){
  if(!schedModalBody) return;
  schedModalBody.querySelectorAll("[data-pb-day]").forEach(b=>{
    const on=!!_pbDays[b.dataset.pbDay];
    b.classList.toggle("on",on);
    b.setAttribute("aria-pressed",on?"true":"false");
  });
}
function openSchedPopup(kind, name, forClass){
  forClass=(forClass&&kind==="batch"&&!name)?String(forClass):null;
  const isEdit=!!name||kind==="global";
  const ctx=isEdit?(kind==="global"?{type:"global",name:"",label:"Global (all classes & batches)"}:{type:kind,name:name,label:(kind==="class"?"Class: ":"Batch: ")+name}):{type:kind,name:"",label:""};
  const timing=getScheduleTiming(isEdit?ctx:{type:"global",name:""});
  _pbDays={};
  const srcWd=isEdit?(ctx.type==="global"?Settings.workingDays:(ctx.type==="class"?getWorkingDaysForClass(ctx.name):getWorkingDaysForBatch(ctx.name))):Settings.workingDays;
  for(let i=0;i<7;i++) _pbDays[i]=asBool(srcWd[i]??srcWd[String(i)]);
  const kindWord=kind==="global"?"Schedule":(kind==="class"?"Class":"Batch");
  schedModalTitle.textContent=isEdit?("Edit schedule"+(ctx.type==="global"?" — Global":" — "+ctx.name)):("Add "+kindWord.toLowerCase());
  try{ const _eye=$("schedModalEye"); if(_eye) _eye.textContent=kindWord; }catch(e){}
  /* Sub explains what the screen controls (user order): no names
     (title + SCHEDULE FOR already carry them), no dev words. */
  schedModalSub.textContent=!isEdit?(kind==="class"?"Name the class and set its weekly schedule. The calendar switches to it on save.":"Name the batch and set its weekly schedule. The calendar switches to it on save."):(ctx.type==="batch"?"Set which days this batch meets, and when scans count as on-time or late.":ctx.type==="global"?"Set which days the school meets, and when scans count as on-time or late.":"Set which days this class meets, and when scans count as on-time or late.");
  const names=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  schedModalBody.innerHTML=`<div class="g2">
    <div class="fld w sched-name"><label>${isEdit?"Schedule for":kindWord+" name"}</label><input id="pbName" autocomplete="off" spellcheck="false" placeholder="${kind==="batch"?"Batch Morning":"Grade 11-A"}" value="${isEdit?esc(ctx.type==="global"?"Global":ctx.name):""}" ${(isEdit&&ctx.type==="global")?"disabled":""}></div>
    ${forClass?`<div class="fld w"><div style="font-size:11px;opacity:.75">New batch will belong to ${esc(forClass)} — other classes are unaffected.</div></div>`:""}
    <div class="fld w sched-days"><label>Working days</label><div class="opts">${names.map((d,idx)=>{const on=!!_pbDays[idx];return `<button type="button" class="${on?"on":""}" data-pb-day="${idx}" aria-pressed="${on}">${d}</button>`;}).join("")}</div></div>
    <div class="fld sched-cut"><label>Present cutoff</label><input type="time" id="pbPresent" value="${esc(timing.presentCutoff)}"></div>
    <div class="fld sched-cut"><label>Late cutoff</label><input type="time" id="pbLate" value="${esc(timing.lateCutoff)}"></div>
    <div class="ft">${name?`<button type="button" class="del" id="pbDel" aria-label="Delete this schedule">Delete</button>`:""}<span class="form-pair"><button id="pbCancel">Cancel</button><button class="go" id="pbSave">${isEdit?"Save schedule":"Add "+kindWord.toLowerCase()}</button></span></div>
    <div class="err" id="pbErr" style="display:none"></div></div>`;
  openModal(schedModal);
  schedModalBody.querySelectorAll("[data-pb-day]").forEach(b=>{
    b.onclick=()=>{ _pbDays[b.dataset.pbDay]=!_pbDays[b.dataset.pbDay]; paintPbDays(); };
  });
  $("pbCancel").onclick=()=>closeModal(schedModal);
  const pbSync=()=>{ const b=$("pbSave"); if(!b) return;
    const p=$("pbPresent").value, l=$("pbLate").value;
    const n=(($("pbName")||{}).value||"").trim();
    b.disabled=!(p&&l&&p<=l&&(isEdit||n)); };
  schedModalBody.addEventListener("input",pbSync);
  schedModalBody.addEventListener("change",pbSync);
  pbSync();
  /* Edit-mode trash (user order): the board × flow, reused verbatim
     (confirm + API + batch guard live in onCbDel — nothing new). */
  const pbDel=$("pbDel");
  if(pbDel) pbDel.onclick=()=>{ closeModal(schedModal); onCbDel({dataset:{cbDelKind:kind,cbDelName:name}}); };
  if(!isEdit){ try{ $("pbName").focus(); }catch(e){} }
  /* Rename (user order): names are keys (lists, schedules, composites,
     student records) — editing one renames across all of them before
     the timing save below runs. Student PATCHes go first so a failure
     aborts before any list moves (retry-safe: renamed records no
     longer match the filter). */
  async function renameScheduleTarget(ctx, newName){
    const oldName=ctx.name;
    const fail=m=>{ throw new Error(m); };
    if(ctx.type==="class"){
      if(newName.includes("|")) fail('Class names cannot contain "|".');
      if(newName.length>80) fail("That class name is too long (max 80).");
      if(Classes.some(c=>c!==oldName&&c.toLowerCase()===newName.toLowerCase())) fail("That class already exists.");
      for(const s of Students.filter(s=>s.class===oldName)){
        await api("/api/students/"+s.id,{method:"PATCH",body:JSON.stringify({grade:newName})});
      }
      Classes=Classes.map(c=>c===oldName?newName:c);
      if(ClassSchedules[oldName]!==undefined){ ClassSchedules[newName]=ClassSchedules[oldName]; delete ClassSchedules[oldName]; }
      Object.keys(BatchSchedules).forEach(k=>{ const p=splitBatchKey(k); if(p.cls===oldName){ BatchSchedules[newName+"|"+p.short]=BatchSchedules[k]; delete BatchSchedules[k]; } });
      await api("/api/settings",{method:"POST",body:JSON.stringify({classes:Classes})});
      ClassSchedulesUI=ClassSchedules;
      ctx.name=newName;
    }else{
      const op=splitBatchKey(oldName);
      if(op.cls){
        let nc=op.cls, ns=newName;
        if(newName.includes("|")){ const np=splitBatchKey(newName); nc=np.cls; ns=np.short; if(!nc||!ns) fail("Use Class|Batch form."); }
        if(!ns) fail("A name is required.");
        if(ns.length>40) fail("That batch name is too long (max 40).");
        if((nc+"|"+ns).length>80) fail("That name is too long for this class.");
        if(!Classes.includes(nc)) fail(`Class "${nc}" does not exist.`);
        const nk=nc+"|"+ns;
        if(nk!==oldName&&BatchSchedules[nk]!==undefined) fail("That batch already exists for this class.");
        for(const s of Students.filter(s=>s.class===nc&&s.batch===op.short)){
          await api("/api/students/"+s.id,{method:"PATCH",body:JSON.stringify({batch:ns})});
        }
        if(BatchSchedules[oldName]!==undefined){ BatchSchedules[nk]=BatchSchedules[oldName]; delete BatchSchedules[oldName]; }
        ctx.name=nk;
      }else{
        if(newName.includes("|")) fail('Batch names cannot contain "|".');
        if(newName.length>40) fail("That batch name is too long (max 40).");
        if((Batches||[]).some(b=>b!==oldName&&b.toLowerCase()===newName.toLowerCase())) fail("That batch already exists.");
        for(const s of Students.filter(s=>s.batch===oldName)){
          await api("/api/students/"+s.id,{method:"PATCH",body:JSON.stringify({batch:newName})});
        }
        Batches=(Batches||[]).map(b=>b===oldName?newName:b);
        if(BatchSchedules[oldName]!==undefined){ BatchSchedules[newName]=BatchSchedules[oldName]; delete BatchSchedules[oldName]; }
        await api("/api/settings",{method:"POST",body:JSON.stringify({batches:Batches})});
        ctx.name=newName;
      }
    }
  }
  $("pbSave").onclick=async()=>{
    const err=$("pbErr");
    const pVal=$("pbPresent").value, lVal=$("pbLate").value;
    if(!pVal||!lVal){ err.textContent="Both Present and Late cutoffs are required."; err.style.display="block"; return; }
    if(pVal>lVal){ err.textContent="Present cutoff must be before or equal to Late cutoff."; err.style.display="block"; return; }
    const wd={}; for(let i=0;i<7;i++) wd[i]=!!_pbDays[i];
    if(!isEdit){
      const raw=(($("pbName")||{}).value||"").trim();
      if(!raw){ err.textContent="A name is required."; err.style.display="block"; return; }
      if(kind==="class"){
        if(Classes.some(c=>c.toLowerCase()===raw.toLowerCase())){ err.textContent="That class already exists."; err.style.display="block"; return; }
        if(raw.includes("|")){ err.textContent='Class names cannot contain "|".'; err.style.display="block"; return; }
        try{
          await api("/api/settings",{method:"POST",body:JSON.stringify({classes:Classes.concat(raw)})});
          ClassSchedules[raw]={workingDays:wd,presentCutoff:pVal,lateCutoff:lVal};
          ClassSchedulesUI=ClassSchedules;
          if(await persistCalendar()){
            cubeView="class"; selKind="class"; selName=raw; syncCsCtx();
            cbBatchScope=raw;
            closeModal(schedModal);
            await loadClassesHolidaysSettings(); renderAll();
            const sel=$("calClassSelect");
            if(sel){ sel.value=`class:${raw}`; if(!sel.value) sel.value=raw; }
            renderWeekly(); renderCalendarMonth();
          }
        }catch(e){ err.textContent="Failed to add class: "+e.message; err.style.display="block"; }
      }else{
        if(raw.includes("|")){ err.textContent='Batch names cannot contain "|".'; err.style.display="block"; return; }
        if((Batches||[]).some(b=>b.toLowerCase()===raw.toLowerCase())){
          if(forClass){ err.textContent=`"${raw}" is a shared batch — it already applies to ${forClass}.`; err.style.display="block"; return; }
          err.textContent="That batch already exists."; err.style.display="block"; return;
        }
        if(raw.length>40){ err.textContent="That batch name is too long (max 40)."; err.style.display="block"; return; }
        try{
          if(forClass){
            /* Scoped add (user order): a "Class|Batch" schedule with the
               modal's days + cutoffs — other classes unaffected, no
               global name created. */
            const key=forClass+"|"+raw;
            if(key.length>80){ err.textContent="That name is too long for this class."; err.style.display="block"; return; }
            BatchSchedules[key]={workingDays:wd,presentCutoff:pVal,lateCutoff:lVal};
            if(await persistCalendar()){
              cubeView="batch"; selKind="batch"; selName=key; syncCsCtx();
              closeModal(schedModal);
              await loadClassesHolidaysSettings(); renderAll();
              const sel=$("calClassSelect");
              if(sel) sel.value=`batch:${key}`;
              renderWeekly(); renderCalendarMonth();
            }
            return;
          }
          await api("/api/settings",{method:"POST",body:JSON.stringify({batches:(Batches||[]).concat(raw)})});
          BatchSchedules[raw]={workingDays:wd,presentCutoff:pVal,lateCutoff:lVal};
          if(await persistCalendar()){
            cubeView="batch"; selKind="batch"; selName=raw; syncCsCtx();
            closeModal(schedModal);
            await loadClassesHolidaysSettings(); renderAll();
            const sel=$("calClassSelect");
            if(sel) sel.value=`batch:${raw}`;
            renderWeekly(); renderCalendarMonth();
          }
        }catch(e){ err.textContent="Failed to add batch: "+e.message; err.style.display="block"; }
      }
      return;
    }
    /* Name edit on a record editor renames first (user order); the
       timing branches below then run against the new name. */
    if(isEdit&&(ctx.type==="class"||ctx.type==="batch")){
      const newName=(($("pbName")||{}).value||"").trim();
      if(!newName){ err.textContent="A name is required."; err.style.display="block"; return; }
      if(newName!==ctx.name){
        const oldName=ctx.name;
        try{ await renameScheduleTarget(ctx, newName); }
        catch(e){ err.textContent=e.message; err.style.display="block"; return; }
        if(selName===oldName) selName=ctx.name;
        if(ctx.type==="class"&&cbBatchScope===oldName) cbBatchScope=ctx.name;
        syncCsCtx();
        schedModalTitle.textContent="Edit schedule — "+ctx.name;
      }
    }
    if(ctx.type==="global"){
      Settings.workingDays=wd;
      Settings.presentCutoff=pVal; Settings.lateCutoff=lVal; Settings.lateAfter=lVal;
      if($("setLateThreshold")) $("setLateThreshold").value=lVal;
      if($("setPresentCutoff")) $("setPresentCutoff").value=pVal;
      try{
        await api("/api/settings",{method:"POST",body:JSON.stringify({presentCutoff:pVal,lateCutoff:lVal})});
        if(await persistCalendar()){ closeModal(schedModal); await loadClassesHolidaysSettings(); renderAll(); }
      }catch(e){ err.textContent="Failed to save timings: "+e.message; err.style.display="block"; }
    }else if(ctx.type==="class"){
      const entry=ClassSchedules[ctx.name]||{};
      ClassSchedules[ctx.name]=Object.assign({},typeof entry==="object"?entry:{},{workingDays:wd,presentCutoff:pVal,lateCutoff:lVal});
      ClassSchedulesUI=ClassSchedules;
      if(await persistCalendar()){ closeModal(schedModal); await loadClassesHolidaysSettings(); renderAll(); }
    }else{
      const entry=BatchSchedules[ctx.name]||{};
      BatchSchedules[ctx.name]=Object.assign({},typeof entry==="object"?entry:{},{workingDays:wd,presentCutoff:pVal,lateCutoff:lVal});
      if(await persistCalendar()){ closeModal(schedModal); await loadClassesHolidaysSettings(); renderAll(); }
    }
  };
}
if($("sideAddClassBtn")) $("sideAddClassBtn").onclick=()=>openSchedPopup("class",null);
if($("sideAddBatchBtn")) $("sideAddBatchBtn").onclick=()=>openSchedPopup("batch",null);
/* Sidebar eyes open the record popups (same .modal species as the
   creation forms); Close buttons dismiss them. */
(function(){
  const osib=$("openSchoolInfoBtn"); if(osib) osib.onclick=()=>openModal(schoolInfoModal);
  const sic=$("schoolInfoCancel"); if(sic) sic.onclick=()=>closeModal(schoolInfoModal);
  const eh=$("eyeHolidaysBtn"); if(eh) eh.onclick=()=>openModal($("holidayViewModal"));
  const eo=$("eyeOverrideBtn"); if(eo) eo.onclick=()=>openModal($("overrideViewModal"));
  const hc=$("holidayViewClose"); if(hc) hc.onclick=()=>closeModal($("holidayViewModal"));
  const oc=$("overrideViewClose"); if(oc) oc.onclick=()=>closeModal($("overrideViewModal"));
  const hct=$("holidayViewCloseTop"); if(hct) hct.onclick=()=>closeModal($("holidayViewModal"));
  const oct=$("overrideViewCloseTop"); if(oct) oct.onclick=()=>closeModal($("overrideViewModal"));
})();

/* Solid timing save: lifted verbatim from the popup — same
   validators, same 3 branches, same global double-POST, same mirror
   sync, same confirmations. Only the tail changed: refresh the
   snapshot/strip, then re-render month + editor. */
async function onCsSaveTiming(){
  const ctx = csCtx || getScheduleContext();
  const pVal = $("csPresentCutoff") ? $("csPresentCutoff").value : "08:00";
  const lVal = $("csLateCutoff") ? $("csLateCutoff").value : "08:30";
  if(!pVal || !lVal){ await glassAlert("Both Present and Late cutoffs are required."); return; }
  if(pVal > lVal){ await glassAlert("Present cutoff must be before or equal to Late cutoff."); return; }

  if(ctx.type === "global"){
    Settings.presentCutoff = pVal;
    Settings.lateCutoff = lVal;
    Settings.lateAfter = lVal;
    if($("setLateThreshold")) $("setLateThreshold").value = lVal;
    if($("setPresentCutoff")) $("setPresentCutoff").value = pVal;
    try {
      await api("/api/settings", {method: "POST", body: JSON.stringify({
        presentCutoff: pVal, lateCutoff: lVal
      })});
      await persistCalendar();
      await glassAlert("Global timings saved.");
    } catch(e){ await glassAlert("Failed to save timings: "+e.message); }
  } else if(ctx.type === "class"){
    let entry = ClassSchedules[ctx.name] || {};
    ClassSchedules[ctx.name] = Object.assign({}, typeof entry==="object"?entry:{}, {
      workingDays: entry.workingDays || getWorkingDaysForClass(ctx.name),
      presentCutoff: pVal,
      lateCutoff: lVal
    });
    ClassSchedulesUI = ClassSchedules;
    cacheSave();
    if(await persistCalendar()){
      await glassAlert(`Timings saved for class ${ctx.name}.`);
    }
  } else if(ctx.type === "batch"){
    let entry = BatchSchedules[ctx.name] || {};
    BatchSchedules[ctx.name] = Object.assign({}, typeof entry==="object"?entry:{}, {
      workingDays: entry.workingDays || getWorkingDaysForBatch(ctx.name),
      presentCutoff: pVal,
      lateCutoff: lVal
    });
    cacheSave();
    if(await persistCalendar()){
      await glassAlert(`Timings saved for batch ${ctx.name}.`);
    }
  }
  snapshotSchedule(); paintMonthEditor();
  renderWeekly(); renderCalendarMonth(); renderToday();
}
/* Inherit-revert retired with the Setup bar: the popup is Save + Close.
   (Custom timings now stand until overwritten — flagged regression.) */
$("holidayBody").addEventListener("click",async(e)=>{
  const edit=e.target.closest("[data-edit-holiday]");
  if(edit){ openHolidayEdit(edit.dataset.editHoliday); return; }
  const btn=e.target.closest("[data-del-holiday]"); if(!btn) return;
  Holidays=Holidays.filter(h=>h.start!==btn.dataset.delHoliday);
  if(await persistCalendar()){ renderHolidays(); renderCalendarMonth(); }
});
function openHolidayEdit(startKey){
  const h=Holidays.find(x=>x.start===startKey); if(!h) return;
    try{ closeModal($("holidayViewModal")); }catch(e){}
    $("holidayModalTitle").textContent="Edit holiday";
    $("holidayModalBody").innerHTML=`<div class="g2">
      <div class="fld w"><label>Name</label><input id="holidayName" autocomplete="off" spellcheck="false" value="${esc(h.name)}"></div>
      <div class="fld"><label>Start date</label><input type="date" id="holidayStart" value="${esc(h.start)}"></div>
      <div class="fld"><label>End date</label><input type="date" id="holidayEnd" value="${esc(h.end)}"></div>
      <div class="fld"><label>Start time</label><input type="time" id="holidayStartTime" value="${esc(h.startTime||"")}"></div>
      <div class="fld"><label>End time</label><input type="time" id="holidayEndTime" value="${esc(h.endTime||"")}"></div>
      <div class="fld w"><label>Type</label><div class="seg" id="holidayTypeRow" role="radiogroup"></div><select id="holidayType" data-gsel="1" class="dlg-hidden"><option value="holiday" ${h.type==="holiday"?"selected":""}>Holiday</option><option value="vacation" ${h.type==="vacation"?"selected":""}>Vacation</option><option value="exam" ${h.type==="exam"?"selected":""}>Exam day</option></select></div>
      <div class="ft"><button type="button" class="del" id="holidayDel" aria-label="Delete this holiday">Delete</button><span class="form-pair"><button id="holidayCancel">Cancel</button><button class="go" id="holidaySave">Save holiday</button></span></div>
      <div class="err" id="holidayErr" style="display:none"></div></div>`;
    const origStart=h.start;
    Holidays=Holidays.filter(x=>x.start!==origStart);
    openModal(holidayModal);
    $("holidayCancel").onclick=()=>{ Holidays.push(h); closeModal(holidayModal); renderHolidays(); renderCalendarMonth(); };
    dlgPaintRow($("holidayType"),$("holidayTypeRow"));
    const holSyncE=()=>{ const b=$("holidaySave"); if(!b) return;
      const n=$("holidayName").value.trim(), s=$("holidayStart").value, e=$("holidayEnd").value||s;
      const stm=$("holidayStartTime").value, etm=$("holidayEndTime").value;
      b.disabled=!(n&&!n.includes("@")&&s&&e&&s<=e&&(!stm||isHHMM(stm))&&(!etm||isHHMM(etm))); };
    $("holidayModalBody").addEventListener("input",holSyncE);
    $("holidayModalBody").addEventListener("change",holSyncE);
    holSyncE();
    /* Edit-mode trash (user order): the record is already staged out —
       delete just commits that (board-× parity: direct, no confirm). */
    $("holidayDel").onclick=async()=>{ closeModal(holidayModal); if(await persistCalendar()){ renderHolidays(); renderCbTables(); renderCalendarMonth(); } };
    $("holidaySave").onclick=async()=>{
      const name=$("holidayName").value.trim(), start=$("holidayStart").value, end=$("holidayEnd").value||start, err=$("holidayErr");
      if(!name||!start||!end||start>end){ err.textContent="Name and a valid date range are required."; err.style.display="block"; return; }
      if(name.includes("@")){ err.textContent="Names cannot contain the @ symbol."; err.style.display="block"; return; }
      let stm=$("holidayStartTime").value, etm=$("holidayEndTime").value;
      if((stm&&!isHHMM(stm))||(etm&&!isHHMM(etm))){ err.textContent="Times must be HH:MM (or left empty for all day)."; err.style.display="block"; return; }
      [stm,etm]=normTimes(stm,etm);
      Holidays.push({name,start,end,startTime:stm,endTime:etm,category:"",type:$("holidayType").value});
      if(await persistCalendar()){ closeModal(holidayModal); renderHolidays(); renderCalendarMonth(); } else Holidays.push(h);
    };
}
$("overrideBody").addEventListener("click",async(e)=>{
  const edit=e.target.closest("[data-edit-override]");
  if(edit){ openOverrideEdit(edit.dataset.editOverride); return; }
  const btn=e.target.closest("[data-del-override]"); if(!btn) return;
  Overrides=Overrides.filter(o=>o.date!==btn.dataset.delOverride);
  if(await persistCalendar()){ renderOverrides(); renderCalendarMonth(); }
});
function openOverrideEdit(dateKey){
  const o=Overrides.find(x=>x.date===dateKey); if(!o) return;
    try{ closeModal($("overrideViewModal")); }catch(e){}
    $("overrideModalTitle").textContent="Edit override";
    $("overrideModalBody").innerHTML=`<div class="g2">
      <div class="fld"><label>Date</label><input type="date" id="overrideDate" value="${esc(o.date)}"></div>
      <div class="fld"><label>Becomes</label><div class="seg two" id="overrideWorkingRow" role="radiogroup"></div><select id="overrideWorking" data-gsel="1" class="dlg-hidden"><option value="1" ${o.isWorking?"selected":""}>Working day</option><option value="0" ${!o.isWorking?"selected":""}>Holiday</option></select></div>
      <div class="fld"><label>Start time</label><input type="time" id="overrideStartTime" value="${esc(o.startTime||"")}"></div>
      <div class="fld"><label>End time</label><input type="time" id="overrideEndTime" value="${esc(o.endTime||"")}"></div>
      <div class="fld w"><label>Note</label><input id="overrideNote" value="${esc(o.note)}"></div>
      <div class="ft"><button type="button" class="del" id="overrideDel" aria-label="Delete this override">Delete</button><span class="form-pair"><button id="overrideCancel">Cancel</button><button class="go" id="overrideSave">Save override</button></span></div>
      <div class="err" id="overrideErr" style="display:none"></div></div>`;
    const orig=o.date;
    Overrides=Overrides.filter(x=>x.date!==orig);
    openModal(overrideModal);
    $("overrideCancel").onclick=()=>{ Overrides.push(o); closeModal(overrideModal); renderOverrides(); renderCalendarMonth(); };
    dlgPaintRow($("overrideWorking"),$("overrideWorkingRow"));
    const ovrSyncE=()=>{ const b=$("overrideSave"); if(!b) return;
      const d=$("overrideDate").value, n=$("overrideNote").value.trim();
      const stm=$("overrideStartTime").value, etm=$("overrideEndTime").value;
      b.disabled=!(d&&!n.includes("@")&&(!stm||isHHMM(stm))&&(!etm||isHHMM(etm))); };
    $("overrideModalBody").addEventListener("input",ovrSyncE);
    $("overrideModalBody").addEventListener("change",ovrSyncE);
    ovrSyncE();
    /* Edit-mode trash (user order): staged-out record commits deleted. */
    $("overrideDel").onclick=async()=>{ closeModal(overrideModal); if(await persistCalendar()){ renderOverrides(); renderCbTables(); renderCalendarMonth(); } };
    $("overrideSave").onclick=async()=>{
      const date=$("overrideDate").value, note=$("overrideNote").value.trim(), err=$("overrideErr");
      if(!date){ err.textContent="A date is required."; err.style.display="block"; return; }
      if(note.includes("@")){ err.textContent="Notes cannot contain the @ symbol."; err.style.display="block"; return; }
      let stm=$("overrideStartTime").value, etm=$("overrideEndTime").value;
      if((stm&&!isHHMM(stm))||(etm&&!isHHMM(etm))){ err.textContent="Times must be HH:MM (or left empty for all day)."; err.style.display="block"; return; }
      [stm,etm]=normTimes(stm,etm);
      Overrides=Overrides.filter(x=>x.date!==date);
      Overrides.push({date,isWorking:$("overrideWorking").value==="1",note,startTime:stm,endTime:etm});
      if(await persistCalendar()){ closeModal(overrideModal); renderOverrides(); renderCalendarMonth(); } else Overrides.push(o);
    };
}
wireSchedEditor();
/* Left-list view tabs + left-bar batch add. Static nodes — wire once. */
if($("cubeTabClasses")) $("cubeTabClasses").onclick=()=>setCubeView("class");
if($("cubeTabBatches")) $("cubeTabBatches").onclick=()=>setCubeView("batch");
$("settingsSaveBtn").onclick=async()=>{
  try{
    const start=$("setAttendanceStart")?$("setAttendanceStart").value:"";
    const pVal=$("setPresentCutoff")?$("setPresentCutoff").value:"08:00";
    const lVal=$("setLateThreshold")?$("setLateThreshold").value:"08:30";
    await api("/api/settings",{method:"POST",body:JSON.stringify({
      schoolName:$("setSchoolName").value.trim(),
      address:$("setSchoolAddress").value.trim(),
      presentCutoff: pVal,
      lateCutoff: lVal,
      academicYear:$("setAcademicYear").value,
      attendanceStartDate: start || undefined,
      schoolOpeningDate: start || undefined
    })});
    Settings.presentCutoff = pVal;
    Settings.lateCutoff = lVal;
    Settings.lateAfter = lVal;
    await glassAlert("Settings saved to database.");
    closeModal(schoolInfoModal);
    await loadClassesHolidaysSettings(); renderAll();
  }catch(e){ await glassAlert("Failed: "+e.message); }
};
$("settingsExportBtn").onclick=()=>exportCSV([["Field","Value"],["School name",$("setSchoolName").value],["Address",$("setSchoolAddress").value],["Late threshold",$("setLateThreshold").value],["Academic year",$("setAcademicYear").value]],"school-settings.csv");
if($("backupDownloadBtn")) $("backupDownloadBtn").onclick=async()=>{
  try{
    const b = await api("/api/backup", {method:"GET", responseType:"blob"});
    const url=URL.createObjectURL(b), a=document.createElement('a'); a.href=url; a.download="atl-backup-"+todayISO()+".db"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1500);
  }catch(e){
    await glassAlert("Backup failed: "+(e.message||(e.body&&e.body.error)||e.status));
  }
};
if($("backupFileInput")) $("backupFileInput").onchange=async(e)=>{
  const file=e.target.files&&e.target.files[0]; if(!file) return;
  const status=$("backupStatus"); status.textContent="Restoring...";
  pauseSensorScan();
  try{
    const form=new FormData(); form.append("file",file);
    const body = await api("/api/restore", {method:"POST", body:form});
    status.textContent="Restore complete. Reloading data..."; await loadAll();
  }catch(err){
    const msg = err.message || (err.body && err.body.error) || err.status;
    status.textContent="Restore failed: "+msg;
    try{ await glassAlert("Restore failed: "+msg); }catch(_e){}
  }finally{
    resumeSensorScan();
  }
  e.target.value="";
};
if($("auditExportBtn")) $("auditExportBtn").onclick=()=>{
  const rows=[["Time","Action","Details","By"]].concat(Audit.map(a=>[a.time,a.action,a.details,a.by||"Admin"]));
  exportCSV(rows,"audit_"+todayISO()+".csv");
};
if($("auditClearBtn")) $("auditClearBtn").onclick=()=>{ try{ glassAlert("Clear audit is managed on the backend."); }catch(e){} };

// --- Unified Backup Manager Controller ---
let _gdrivePollTimer = null;
let _unifiedActiveWeekdays = [0, 1, 2, 3, 4, 5, 6];
let _destStates = {
  gdrive: null,
  telegram: null,
  usb: null
};

function stopGDrivePolling(){
  if(_gdrivePollTimer){
    clearInterval(_gdrivePollTimer);
    _gdrivePollTimer = null;
  }
}

/* Pair action lives in its own left-aligned Row-3 (same left edge as
   the Send/Check rows) so pill text widths can never drag it.
   paintGdrivePair toggles the row on real state changes only. */
function paintGdrivePair(show){
  const row = $("gdrivePairRow");
  if(row) row.style.display = show ? "flex" : "none";
}
function renderDeviceCodeBox(df){
  const codeBox = $("gdriveDeviceCodeBox");
  const authBox = $("gdriveAuthBox");
  if(!codeBox) return;
  if(df && df.userCode){
    if(authBox) authBox.style.display = "block";
    codeBox.style.display = "block";
    paintGdrivePair(false);
    if($("gdriveUserCodeDisplay")) $("gdriveUserCodeDisplay").textContent = df.userCode;
    const link = $("gdriveDeviceUrlLink");
    if(link){
      link.href = df.verificationUrlComplete || df.verificationUrl || "https://www.google.com/device";
    }
    if($("gdriveDevicePollStatus")) $("gdriveDevicePollStatus").textContent = "Waiting for approval…";
  } else {
    codeBox.style.display = "none";
  }
}

/* Uniform 3-row service rows (user order): Row-1 head, Row-2 optional
   detail, Row-3 text actions. Wiring/IDs untouched — this
   only swaps the state-correct emphasis onto the state-correct button and
   collapses an empty optional detail line. */
function setPrimary(btn, on){
  if(!btn) return;
  try{ btn.classList.toggle("primary", !!on); }catch(e){}
}
function applyDestRowState(){
  try{
    const gd = _destStates.gdrive || {};
    const usb = _destStates.usb || {};
    const gdReady = !!gd.authenticated;
    const usbReady = !!(usb.connected && usb.enabled && usb.lastStatus !== "ERROR");
    // Drive: not-ready -> Pair is emphasized; ready -> send is emphasized.
    setPrimary($("gdriveDeviceStartBtn"), !gdReady);
    setPrimary($("gdriveBackupRowBtn"), gdReady);
    // Telegram: text actions always visible (user: actions always visible).
    setPrimary($("telegramBackupNowBtn"), true);
    // USB: not-ready -> Check USB is the primary; ready -> backup is primary.
    setPrimary($("usbRefreshBtn"), !usbReady);
    setPrimary($("usbBackupNowBtn"), usbReady);
    // USB Row-2 collapses when the drive is not ready — the status line
    // + Check USB are the one message (the line always carries static
    // Mount/Space text, so an emptiness check could never fire).
    const usbLine = $("usbDetailLine");
    if(usbLine){
      usbLine.style.display = usbReady ? "" : "none";
    }
  }catch(e){}
}

function startGDrivePolling(intervalSec){
  stopGDrivePolling();
  const pollInterval = Math.max((intervalSec || 5) * 1000, 3000);
  _gdrivePollTimer = setInterval(async () => {
    try {
      const res = await api("/api/backup/gdrive/device-poll", { method: "POST" });
      if(res && res.status === "success"){
        stopGDrivePolling();
        renderDeviceCodeBox(null);
        await glassAlert("Connected to Google Drive successfully!");
        await loadBackupManagerStatus();
      } else if(res && (res.status === "pending" || res.status === "slow_down")){
        if($("gdriveDevicePollStatus")) $("gdriveDevicePollStatus").textContent = "Waiting for approval…";
      } else if(res && res.status === "expired"){
        stopGDrivePolling();
        renderDeviceCodeBox(null);
        if($("gdriveDevicePollStatus")) $("gdriveDevicePollStatus").textContent = "Session expired.";
        await loadBackupManagerStatus();
      }
    } catch(e){
      stopGDrivePolling();
      const m = (e.body && e.body.error) || e.message || "Polling stopped";
      if($("gdriveDevicePollStatus")) $("gdriveDevicePollStatus").textContent = m;
    }
  }, pollInterval);
}

async function startDeviceFlow(){
  const btn = $("gdriveDeviceStartBtn");
  try {
    if(btn){ btn.disabled = true; }
    // Pair is reachable while unchecked — enable first so one click
    // goes from dead to pairing (failure aborts before device-start).
    const gdSt = (typeof _destStates === "object" && _destStates) ? _destStates.gdrive : null;
    if(gdSt && gdSt.enabled === false){
      await api("/api/backup/gdrive/toggle", {method: "POST", body: JSON.stringify({enabled: true})});
      paintDestToggles();
    }
    const res = await api("/api/backup/gdrive/device-start", { method: "POST" });
    if(res && res.ok){
      renderDeviceCodeBox(res);
      startGDrivePolling(res.interval || 5);
      if(res.verificationUrlComplete){
        window.open(res.verificationUrlComplete, "_blank");
      }
    } else {
      await glassAlert((res && res.error) || "Failed to start Google authorization");
    }
  } catch(err){
    const m = (err.body && err.body.error) || err.message || "Failed to start Google authorization";
    await glassAlert("Google Drive: " + m);
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = "Connect Drive"; }
  }
}

async function cancelDeviceFlow(){
  stopGDrivePolling();
  renderDeviceCodeBox(null);
  try {
    await api("/api/backup/gdrive/device-cancel", { method: "POST" });
  } catch(_){}
  await loadBackupManagerStatus();
}

function updateUnifiedLastBackupInfo(dests){
  const infoEl = $("backupLastInfo");
  if(!infoEl) return;
  let newestStr = null;
  let newestDest = null;
  let newestName = null;
  const labels = ["Google Drive", "Telegram", "USB Drive"];

  dests.forEach((d, idx) => {
    if(d && d.lastBackup){
      if(!newestStr || d.lastBackup > newestStr){
        newestStr = d.lastBackup;
        newestName = d.lastBackupName || "";
        newestDest = labels[idx];
      }
    }
  });

  if(newestStr){
    infoEl.textContent = `Last backup: ${newestStr}${newestName ? ` (${newestName})` : ""} · ${newestDest}`;
  } else {
    infoEl.textContent = "Last backup: Never";
  }
}

/* Scheduler on/off lives in a text toggle button (no tick box).
   _schedEnabledState is the single truth for paint + payload. */
let _schedEnabledState = true;
function paintSchedToggle(){
  const b = $("backupSchedToggleBtn");
  if(b) b.textContent = _schedEnabledState ? "ON" : "OFF";
  if(b) b.classList.toggle("on", !!_schedEnabledState);
}
function renderUnifiedSchedule(sched){
  _schedEnabledState = sched.enabled !== false;
  paintSchedToggle();
  if($("backupSchedTime")) $("backupSchedTime").value = sched.time || "18:30";
  if($("backupSchedFreq")) $("backupSchedFreq").value = sched.frequency || "daily";
  try{ if($("backupSchedFreq")) $("backupSchedFreq").dispatchEvent(new Event("change")); }catch(e){}
  if($("backupSchedInterval")) $("backupSchedInterval").value = sched.intervalDays || 1;

  _unifiedActiveWeekdays = Array.isArray(sched.weekdays) ? [...sched.weekdays] : [0, 1, 2, 3, 4, 5, 6];
  updateUnifiedScheduleVisibility();
  updateUnifiedWeekdayButtons();
}

function updateUnifiedScheduleVisibility(){
  /* No frequency switch on screen (user order): Time, Interval and
     Weekdays are always printed together. The hidden select only
     carries the derived mode for the save payload. */
  const sel=$("backupSchedFreq");
  if(sel) sel.value=deriveSchedFreq();
  const intervalWrap=$("backupSchedIntervalWrap");
  if(intervalWrap){ intervalWrap.style.display=""; intervalWrap.style.visibility="visible"; }
  const daysWrap=$("backupSchedDaysWrap");
  if(daysWrap){ daysWrap.style.display=""; daysWrap.style.visibility="visible"; try{daysWrap.setAttribute("aria-hidden","false");}catch(e){} }
  try{ paintSchedMode(); }catch(e){}
}
/* Mode follows the fields: a narrowed week wins, else an interval
   above 1 day, else daily. */
function deriveSchedFreq(){
  const all=[0,1,2,3,4,5,6].every(d=>_unifiedActiveWeekdays.includes(d));
  if(!all) return "weekdays";
  const iv=parseInt((($("backupSchedInterval")||{}).value||"1"),10)||1;
  return iv>1?"interval":"daily";
}
/* Plain-language readout of the derived mode (user order): one fixed
   line under the fields, repainted on every edit. */
function paintSchedMode(){
  const el=$("backupSchedMode"); if(!el) return;
  const raw=(($("backupSchedTime")||{}).value||"18:30");
  const m=/^(\d{1,2}):(\d{2})/.exec(raw||""); let t=raw||"18:30";
  if(m){ let h=+m[1]; const ap=h>=12?"PM":"AM"; h=h%12; if(h===0)h=12; t=h+":"+m[2]+" "+ap; }
  const f=deriveSchedFreq();
  if(f==="weekdays"){
    const names={1:"Mon",2:"Tue",3:"Wed",4:"Thu",5:"Fri",6:"Sat",0:"Sun"};
    const days=[1,2,3,4,5,6,0].filter(d=>_unifiedActiveWeekdays.includes(d)).map(d=>names[d]);
    el.textContent="Runs "+days.join(", ")+" at "+t;
  } else if(f==="interval"){
    const iv=parseInt((($("backupSchedInterval")||{}).value||"1"),10)||1;
    el.textContent="Runs every "+iv+" day"+(iv===1?"":"s")+" at "+t;
  } else {
    el.textContent="Runs daily at "+t;
  }
}

function updateUnifiedWeekdayButtons(){
  const container = $("backupSchedDays");
  if(!container) return;
  const btns = container.querySelectorAll("button[data-day]");
  btns.forEach(btn => {
    const day = parseInt(btn.dataset.day, 10);
    if(_unifiedActiveWeekdays.includes(day)){
      btn.classList.add("on");
    } else {
      btn.classList.remove("on");
    }
  });
}

async function loadBackupManagerStatus(){
  if(!$("backupManagerCard")) return;
  try{
    const [gdRes, tgRes, usbRes] = await Promise.allSettled([
      api("/api/backup/gdrive/status"),
      api("/api/backup/telegram/status"),
      api("/api/backup/usb/status")
    ]);

    const gd = gdRes.status === "fulfilled" ? gdRes.value : null;
    const tg = tgRes.status === "fulfilled" ? tgRes.value : null;
    const usb = usbRes.status === "fulfilled" ? usbRes.value : null;

    _destStates.gdrive = gd;
    _destStates.telegram = tg;
    _destStates.usb = usb;

    // 1. Google Drive Row
    const gdStatus = $("destStatusGdrive");
    const gdAuthBox = $("gdriveAuthBox");
    const gdActionBox = $("gdriveActionBox");
    if(gdStatus){
      if(!gd){
        gdStatus.textContent = "Offline"; gdStatus.className = "";
        if(gdActionBox) gdActionBox.style.display = "none";
      } else if(!gd.enabled){
        gdStatus.textContent = "Disabled"; gdStatus.className = "";
        if(gdAuthBox) gdAuthBox.style.display = "none";
        if(gdActionBox) gdActionBox.style.display = "none";
      } else if(!gd.configured){
        gdStatus.textContent = "Setup needed"; gdStatus.className = "";
        if(gdActionBox) gdActionBox.style.display = "none";
        // Unconfigured: pairing is the only way forward — the Pair
        // row visibility resolves in the shared paint line below.
        if(gd.deviceFlow && gdAuthBox) gdAuthBox.style.display = "block";
        else if(gdAuthBox) gdAuthBox.style.display = "none";
        renderDeviceCodeBox(gd.deviceFlow || null);
        if(gd.deviceFlow && !_gdrivePollTimer) startGDrivePolling(gd.deviceFlow.interval || 5);
      } else if(!gd.authenticated){
        gdStatus.textContent = "Not connected"; gdStatus.className = "bad";
        if(gdActionBox) gdActionBox.style.display = "none";
        if(gd.deviceFlow){
          if(gdAuthBox) gdAuthBox.style.display = "block";
          renderDeviceCodeBox(gd.deviceFlow);
          if(!_gdrivePollTimer) startGDrivePolling(gd.deviceFlow.interval || 5);
        } else {
          if(gdAuthBox) gdAuthBox.style.display = "none";
          renderDeviceCodeBox(null);
        }
      } else {
        gdStatus.textContent = "Ready"; gdStatus.className = "ok";
        if(gdAuthBox) gdAuthBox.style.display = "none";
        if(gdActionBox){
          gdActionBox.style.display = "block";
          loadGDriveList();
        }
      }
      // Pair stays reachable whenever pairing is still possible — even
      // unchecked (the click enables Drive first). Hidden only when a
      // code is showing, backend is offline, or already paired.
      paintGdrivePair(!!(gd && !gd.authenticated && !gd.deviceFlow));
      if($("gdriveStatusMsg")){
        $("gdriveStatusMsg").textContent = (gd && gd.lastError) ? gd.lastError : "";
      }
    }

    // 2. Telegram Row
    const tgStatus = $("destStatusTelegram");
    if(tgStatus){
      if(!tg){
        tgStatus.textContent = "Offline"; tgStatus.className = "";
      } else if(!tg.enabled){
        tgStatus.textContent = "Disabled"; tgStatus.className = "";
      } else if(!tg.configured){
        tgStatus.textContent = "Not configured"; tgStatus.className = "";
      } else if(tg.lastStatus === "ERROR"){
        tgStatus.textContent = "Error"; tgStatus.className = "bad";
      } else {
        tgStatus.textContent = "Ready"; tgStatus.className = "ok";
      }
    }
    if($("telegramChatId")){
      $("telegramChatId").textContent = (tg && tg.chatId) ? tg.chatId : "Not configured";
    }
    if($("telegramLastError")){
      $("telegramLastError").textContent = (tg && tg.lastError) ? tg.lastError : "";
    }

    // 3. USB Row
    const usbStatus = $("destStatusUsb");
    if(usbStatus){
      if(!usb){
        usbStatus.textContent = "Offline"; usbStatus.className = "";
      } else if(!usb.connected){
        usbStatus.textContent = "Not connected"; usbStatus.className = "bad";
      } else if(!usb.enabled){
        usbStatus.textContent = "Disabled"; usbStatus.className = "";
      } else if(usb.lastStatus === "ERROR"){
        usbStatus.textContent = "Error"; usbStatus.className = "bad";
      } else {
        usbStatus.textContent = "Ready"; usbStatus.className = "ok";
      }
    }
    if($("usbMountPath")){
      $("usbMountPath").textContent = (usb && usb.mountPath) ? usb.mountPath : "Not detected";
    }
    if($("usbFreeSpace")){
      $("usbFreeSpace").textContent = (usb && usb.freeBytes) ? (usb.freeBytes / (1024*1024*1024)).toFixed(1) + " GB free" : "--";
    }
    if($("usbLastError")){
      $("usbLastError").textContent = (usb && usb.lastError) ? usb.lastError : "";
    }

    // 4. Shared Schedule
    const activeSched = (gd && gd.schedule) || (tg && tg.schedule) || (usb && usb.schedule);
    if(activeSched) renderUnifiedSchedule(activeSched);

    // 5. Last Backup Info
    updateUnifiedLastBackupInfo([gd, tg, usb]);

    // 6. Uniform row rhythm: state-correct primaries, collapsed Row-2s.
    applyDestRowState();
    // 7. ON/OFF toggle texts follow backend truth.
    try{ paintDestToggles(); }catch(e){}

  }catch(err){
    console.warn("loadBackupManagerStatus error:", err);
  }
}

// Backward-compatibility aliases
function loadGDriveStatus(){ return loadBackupManagerStatus(); }
function loadTelegramStatus(){ return loadBackupManagerStatus(); }
function loadUsbStatus(){ return loadBackupManagerStatus(); }

// Schedule Event Listeners
if($("backupSchedFreq")) $("backupSchedFreq").onchange = updateUnifiedScheduleVisibility;

if($("backupSchedToggleBtn")) $("backupSchedToggleBtn").onclick = function(){
  _schedEnabledState = !_schedEnabledState;
  paintSchedToggle();
};

if($("backupSchedDays")) $("backupSchedDays").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-day]");
  if(!btn) return;
  const day = parseInt(btn.dataset.day, 10);
  if(_unifiedActiveWeekdays.includes(day)){
    if(_unifiedActiveWeekdays.length > 1){
      _unifiedActiveWeekdays = _unifiedActiveWeekdays.filter(d => d !== day);
    }
  } else {
    _unifiedActiveWeekdays.push(day);
  }
  updateUnifiedWeekdayButtons();
  try{ updateUnifiedScheduleVisibility(); }catch(e){}
});

if($("backupSchedInterval")) $("backupSchedInterval").addEventListener("input", ()=>{ try{ updateUnifiedScheduleVisibility(); }catch(e){} });
/* Interval steppers (user order): the native spinner arrows are too
   small — big −/+ boxes drive the same input (1–30 clamped) and fire
   input so the mode derivation runs. */
function stepSchedInterval(d){
  const inp=$("backupSchedInterval"); if(!inp) return;
  const cur=parseInt(inp.value,10)||1;
  inp.value=Math.min(30,Math.max(1,cur+d));
  try{ inp.dispatchEvent(new Event("input",{bubbles:true})); }catch(e){}
  try{ updateUnifiedScheduleVisibility(); }catch(e){}
}
holdRepeat($("intervalMinus"),()=>stepSchedInterval(-1));
holdRepeat($("intervalPlus"),()=>stepSchedInterval(1));
if($("backupSchedTime")) $("backupSchedTime").addEventListener("input", ()=>{ try{ paintSchedMode(); }catch(e){} });

if($("backupSchedSaveBtn")) $("backupSchedSaveBtn").onclick = async () => {
  const btn = $("backupSchedSaveBtn");
  const statusEl = $("backupSchedStatus");
  try {
    btn.disabled = true;
    if(statusEl) statusEl.textContent = "";

    const payload = {
      enabled: (typeof _schedEnabledState === "boolean") ? _schedEnabledState : true,
      time: $("backupSchedTime") ? $("backupSchedTime").value : "18:30",
      frequency: $("backupSchedFreq") ? $("backupSchedFreq").value : "daily",
      intervalDays: $("backupSchedInterval") ? parseInt($("backupSchedInterval").value, 10) || 1 : 1,
      weekdays: _unifiedActiveWeekdays
    };

    const saves = [
      api("/api/backup/gdrive/schedule", { method: "POST", body: JSON.stringify(payload) }),
      api("/api/backup/telegram/schedule", { method: "POST", body: JSON.stringify(payload) }),
      api("/api/backup/usb/schedule", { method: "POST", body: JSON.stringify(payload) })
    ];

    const names=["Google Drive","Telegram","USB"];
    const results=await Promise.allSettled(saves);
    const bad=[];
    results.forEach((r,i)=>{ if(r.status==="rejected") bad.push(names[i]+(r.reason&&r.reason.message?" ("+r.reason.message+")":"")); });

    if(bad.length){
      if(statusEl) statusEl.textContent="Schedule failed: "+bad.join(", ")+".";
      await glassAlert("Schedule save failed for: "+bad.join(", ")+". Destinations that saved are already applied.");
    }else{
      if(statusEl) statusEl.textContent = "Schedule saved.";
      setTimeout(() => { if(statusEl) statusEl.textContent = ""; }, 3000);
    }
    await loadBackupManagerStatus();
  } catch(e){
    await glassAlert("Save schedule failed: " + (e.message || (e.body && e.body.error) || "error"));
  } finally {
    btn.disabled = false;
    btn.textContent = "Save";
  }
};

/* (Destination tick boxes retired — Back Up Now runs every enabled
   destination; scheduler toggle is a text button. Handlers removed.) */
/* Destination ON/OFF text toggles (no tick boxes): flip the backend
   flag, repaint the text immediately, then reload truth. */
const _DEST_TOGGLE_URL = {gdrive:"/api/backup/gdrive/toggle", telegram:"/api/backup/telegram/toggle", usb:"/api/backup/usb/toggle"};
function paintDestToggles(){
  document.querySelectorAll('#pane-backup .dest-toggle[data-dest]').forEach(b=>{
    const st = (typeof _destStates === "object" && _destStates) ? _destStates[b.dataset.dest] : null;
    const on = !st || st.enabled !== false;
    b.textContent = on ? "ON" : "OFF";
    try{ b.classList.toggle("on", on); }catch(e){}
  });
}
document.querySelectorAll('#pane-backup .dest-toggle[data-dest]').forEach(b=>{
  b.addEventListener("click", async ()=>{
    const dest = b.dataset.dest;
    const st = (typeof _destStates === "object" && _destStates) ? _destStates[dest] : null;
    const want = st ? st.enabled === false : false;
    try{
      await api(_DEST_TOGGLE_URL[dest], {method: "POST", body: JSON.stringify({enabled: want})});
      b.textContent = want ? "ON" : "OFF";
      try{ b.classList.toggle("on", !!want); }catch(e){}
    }catch(e){
      await glassAlert("Failed to toggle: " + (e.message || "error"));
    }
    await loadBackupManagerStatus();
  });
});

// Back Up Now Button — no tick boxes: runs every enabled destination
// (readiness errors land per-destination in the summary, as before).
if($("backupNowBtn")) $("backupNowBtn").onclick = async () => {
  const btn = $("backupNowBtn");
  const statusEl = $("backupNowStatus");
  const st = (typeof _destStates === "object" && _destStates) ? _destStates : {};
  const isGd = !st.gdrive || st.gdrive.enabled !== false;
  const isTg = !st.telegram || st.telegram.enabled !== false;
  const isUsb = !st.usb || st.usb.enabled !== false;

  if(!isGd && !isTg && !isUsb){
    await glassAlert("All backup destinations are disabled.");
    return;
  }

  btn.disabled = true;
  if(statusEl) statusEl.textContent = "Starting backups…";

  const tasks = [];
  const taskNames = [];

  if(isGd){
    taskNames.push("Google Drive");
    tasks.push(api("/api/backup/gdrive/backup", { method: "POST" }));
  }
  if(isTg){
    taskNames.push("Telegram");
    tasks.push(api("/api/backup/telegram/backup", { method: "POST" }));
  }
  if(isUsb){
    taskNames.push("USB");
    tasks.push(api("/api/backup/usb/backup", { method: "POST" }));
  }

  const results = await Promise.allSettled(tasks);
  const summaries = [];

  results.forEach((r, idx) => {
    const name = taskNames[idx];
    if(r.status === "fulfilled" && r.value && r.value.ok !== false){
      summaries.push(`${name}: OK`);
    } else {
      const err = (r.reason && ((r.reason.body && r.reason.body.error) || r.reason.message)) || (r.value && r.value.error) || "Failed";
      summaries.push(`${name}: ${err}`);
    }
  });

  const summaryText = summaries.join("; ");
  if(statusEl) statusEl.textContent = summaryText;
  await glassAlert(summaryText);

  await loadBackupManagerStatus();
  btn.disabled = false;
  btn.textContent = "Back Up Now";
};

// Instant audit jumps (user order): the audit list is long and now lives in
// its own bounded window, so these jump the LIST (Top -> 0, Bottom -> end),
// not the surrounding section. No animation — the wall allows zero motion.
function bkAuditJump(toBottom){
  const c=$("auditBody"); if(!c) return;
  c.scrollTop = toBottom ? c.scrollHeight : 0;
}
if($("bkJumpTop")) $("bkJumpTop").onclick=()=>bkAuditJump(false);
if($("bkJumpBottom")) $("bkJumpBottom").onclick=()=>bkAuditJump(true);
document.querySelectorAll('[data-bk-jump]').forEach(b=>{ b.onclick=()=>bkAuditJump(b.getAttribute("data-bk-jump")==="bottom"); });

// Refresh Button
if($("backupRefreshBtn")) $("backupRefreshBtn").onclick = async () => {
  const btn = $("backupRefreshBtn");
  try{
    btn.disabled = true;
    await loadBackupManagerStatus();
  }finally{
    btn.disabled = false;
  }
};

// Row-tap toggles retired (user order): only the checkbox square itself
// toggles — taps on rows, labels, or text must not flip state.

// Google Device Flow Event Listeners
if($("gdriveDeviceStartBtn")) $("gdriveDeviceStartBtn").onclick = startDeviceFlow;if($("gdriveDeviceCancelBtn")) $("gdriveDeviceCancelBtn").onclick = cancelDeviceFlow;

// Google Drive Management
if($("gdriveDisconnectBtn")) {
  $("gdriveDisconnectBtn").onclick = async () => {
    if(!(await glassConfirm("Disconnect Google Drive cloud backup?",{title:"Disconnect Drive",okText:"Disconnect",danger:true}))) return;
    try {
      await api("/api/backup/gdrive/disconnect", {method: "POST"});
      await loadBackupManagerStatus();
    } catch(e) {
      await glassAlert("Disconnect failed: " + (e.message || "error"));
    }
  };
}

if($("gdriveRefreshListBtn")) {
  $("gdriveRefreshListBtn").onclick = () => loadGDriveList();
}

async function loadGDriveList() {
  const tbody = $("gdriveFilesBody");
  if(!tbody) return;
  try {
    const res = await api("/api/backup/gdrive/list");
    const files = (res && res.files) || [];
    if(!files.length) {
      tbody.innerHTML = '<p class="sub" style="padding:6px 0">No cloud snapshots found</p>';
      return;
    }
    tbody.innerHTML = files.map(f => {
      const sz = f.size ? `${(f.size / 1024).toFixed(1)} KB` : "";
      return `<div class="vrow small">
        <div><span>${esc(f.name)}</span><small>${sz}</small></div>
        <button data-gdrive-restore="${esc(f.id)}" data-gdrive-name="${esc(f.name)}">Restore</button>
      </div>`;
    }).join("");
  } catch(e) {
    tbody.innerHTML = `<p class="sub" style="color:var(--red);padding:6px 0">Failed to list: ${esc(e.message || "error")}</p>`;
  }
}

if($("gdriveFilesBody")) {
  $("gdriveFilesBody").onclick = async (e) => {
    const btn = e.target.closest("button[data-gdrive-restore]");
    if(!btn) return;
    const fileId = btn.dataset.gdriveRestore;
    const name = btn.dataset.gdriveName || "cloud backup";
    if(!(await glassConfirm(`Restore database from cloud backup "${name}"?\n\nWARNING: Current database will be safely backed up to .pre_restore.bak before replacement.`,{title:"Restore from cloud",okText:"Restore",danger:true}))) return;
    pauseSensorScan();
    try {
      btn.disabled = true;
      btn.textContent = "Restoring…";
      await api("/api/backup/gdrive/restore", {method: "POST", body: JSON.stringify({fileId: fileId})});
      await glassAlert(`Database restored successfully from "${name}". Page will now reload.`);
      window.location.reload();
    } catch(err) {
      resumeSensorScan();
      await glassAlert("Restore failed: " + (err.message || "error"));
      btn.disabled = false;
      btn.textContent = "Restore";
    }
  };
}

// Google Drive Row Management (per-row send: same endpoint as Back Up Now)
if($("gdriveBackupRowBtn")) {
  $("gdriveBackupRowBtn").onclick = async () => {
    const btn = $("gdriveBackupRowBtn");
    try {
      btn.disabled = true;
      const res = await api("/api/backup/gdrive/backup", {method: "POST"});
      await glassAlert("Backup sent to Google Drive successfully: " + (res.name || "complete"));
      await loadBackupManagerStatus();
    } catch(e) {
      await glassAlert("Google Drive backup failed: " + (e.message || "error"));
    } finally {
      btn.disabled = false;
      btn.textContent = "Back up now";
    }
  };
}

// Telegram Management
if($("telegramBackupNowBtn")) {
  $("telegramBackupNowBtn").onclick = async () => {
    const btn = $("telegramBackupNowBtn");
    try {
      btn.disabled = true;
      const res = await api("/api/backup/telegram/backup", {method: "POST"});
      await glassAlert("Backup sent to Telegram successfully: " + (res.name || "complete"));
      await loadBackupManagerStatus();
    } catch(e) {
      await glassAlert("Telegram backup failed: " + (e.message || "error"));
    } finally {
      btn.disabled = false;
      btn.textContent = "Back up now";
    }
  };
}

if($("telegramClearStatusBtn")) {
  $("telegramClearStatusBtn").onclick = async () => {
    try {
      await api("/api/backup/telegram/clear-status", {method: "POST"});
      await loadBackupManagerStatus();
    } catch(e) {
      await glassAlert("Failed to clear status: " + (e.message || "error"));
    }
  };
}

// USB Management
if($("usbBackupNowBtn")) {
  $("usbBackupNowBtn").onclick = async () => {
    const btn = $("usbBackupNowBtn");
    try {
      btn.disabled = true;
      const res = await api("/api/backup/usb/backup", {method: "POST"});
      await glassAlert("Backup written to USB drive successfully: " + (res.name || "complete"));
      await loadBackupManagerStatus();
    } catch(e) {
      await glassAlert("USB backup failed: " + (e.message || "error"));
    } finally {
      btn.disabled = false;
      btn.textContent = "Back up to USB";
    }
  };
}

if($("usbRefreshBtn")) {
  $("usbRefreshBtn").onclick = async () => {
    const btn = $("usbRefreshBtn");
    try {
      btn.disabled = true;
      await loadBackupManagerStatus();
    } finally {
      btn.disabled = false;
      btn.textContent = "Detect USB";
    }
  };
}

if($("usbClearStatusBtn")) {
  $("usbClearStatusBtn").onclick = async () => {
    try {
      await api("/api/backup/usb/clear-status", {method: "POST"});
      await loadBackupManagerStatus();
    } catch(e) {
      await glassAlert("Failed to clear status: " + (e.message || "error"));
    }
  };
}

// Window Focus & Routing
function checkAdminRoute(){
  const h = window.location.hash || "";
  const s = window.location.search || "";
  if(h.includes("admin=backup") || s.includes("admin=backup")){
    openAdmin();
    const btn = document.querySelector('nav.admin-nav button[data-tab="backup"]');
    if(btn){
      [...adminNav.children].forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      currentTab="backup";
      updateTabs();
      scrollToPane("backup");
    }
  }
}
window.addEventListener("load", checkAdminRoute);
window.addEventListener("hashchange", checkAdminRoute);
window.addEventListener("focus", ()=>{
  if(currentTab==="backup" && adminLayer && adminLayer.classList.contains("open")){
    loadBackupManagerStatus();
  }
});
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
    await loadClassesHolidaysSettings(); renderAll(); await glassAlert("Saved.");
  }catch(e){ await glassAlert("Failed: "+e.message); }
};
detailScroll.addEventListener("click",(e)=>{
  const btn=e.target.closest("button"); if(!btn) return;
  const action=btn.dataset.action, id=parseInt(btn.dataset.id||selectedStudentId);
  if(action==="edit") openEditStudent(id);
  else if(action==="reenroll") openReEnroll(id);
  else if(action==="delete") deleteStudent(id);
  else if(action==="reactivate") reactivateStudent(id);
  else if(action==="print"){
    /* Print-only markup (user order): the profile used to clone
       #detailScroll's live DOM, so the interactive panel landed on paper
       unstyled — native selects visible, the 31-column timeline collapsed
       into one run of text, legend spans stacked. Built from the same
       data instead, using the print vocabulary printHTML already styles. */
    const s=Students.find(x=>x.id===id); if(!s) return;
    const _fd=iso=>{ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||""); return m?(+m[3])+" "+MONTHS_S[+m[2]-1]+" "+m[1]:(iso||"—"); };
    const _ft=t=>{ if(t==="23:59:59"||t==="00:00:00") return "—"; const m=/^(\d{1,2}):(\d{2})/.exec(t||""); if(!m) return "—"; let h=+m[1]; const ap=h>=12?"PM":"AM"; h=h%12; if(h===0)h=12; return h+":"+m[2]+" "+ap; };
    /* _stName is local to renderStudentDetail — define the same mapping here. */
    const _psName=st=>st==="Not Scheduled"?"Not scheduled":st;
    /* Fingerprint shown in the table (from the records) is the same source the
       card uses, so the two can never disagree. */
    const _hist=(AllEvents||[]).filter(a=>a.studentId===s.id);
    const _recs=_hist.slice(-40).reverse();
    const generated=new Date().toLocaleString("en-GB",{day:"2-digit",month:"short",year:"numeric"});
    const _field=(l,v)=>`<div class="detail-field"><label>${esc(l)}</label><span>${esc(v||"—")}</span></div>`;
    const _fid=s.fingerId!=null?"F-"+s.fingerId:(_recs.find(a=>a.fingerId!=null)?"F-"+_recs.find(a=>a.fingerId!=null).fingerId:"");
    const hdr=`<div class="report-header">
        <h1>Student profile</h1>
        <div class="report-subtitle">
          <div><strong>${esc(s.name)}</strong> &nbsp;·&nbsp; Roll ${esc(s.roll||"—")} &nbsp;·&nbsp; ${esc(s.class||"—")}${s.batch?" &nbsp;·&nbsp; "+esc(s.batch):""}</div>
          <div><span class="report-meta-tag">Generated: ${esc(generated)}</span></div>
        </div>
      </div>`;
    /* Minimal: plain field pairs, no photo block, no stat row — identity then
       records. */
    const fields=`<div class="report-section">
        <div class="detail-grid">
          ${_field("Status", s.active===false?"Inactive":"Active")}
          ${_field("Fingerprint", _fid)}
          ${_field("Phone", s.phone)}
          ${_field("Parent", s.parent)}
          ${_field("Section", s.section)}
          ${_field("Address", s.address)}
        </div>
      </div>`;
    const tbl=_recs.length?`<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Time</th><th>Status</th><th>Fingerprint</th></tr></thead>
        <tbody>${_recs.map(a=>`<tr><td>${esc(_fd(a.date))}</td><td>${esc(_ft(a.time))}</td><td>${esc(_psName(a.status))}</td><td>${esc(a.fingerId!=null?"F-"+a.fingerId:"—")}</td></tr>`).join("")}</tbody>
      </table></div>`
      :`<div class="empty">No attendance records for this student.</div>`;
    printHTML(hdr+fields+tbl, `${s.name} — Student profile`);
  }
  else if(action==="refresh"){ loadHistory().then(()=>{ try{ renderStudentDetail(selectedStudentId); }catch(e){} }); }
  else if(action==="export"){ exportStudentCSV(id); }
});
detailScroll.addEventListener("click",(e)=>{
  const b=e.target.closest("button"); if(!b) return;
  if(b.id==="sdPrev"||b.id==="sdNext"){
    if(!sdMonth){ const _t3=new Date(); sdMonth=new Date(_t3.getFullYear(),_t3.getMonth(),1); }
    sdMonth=new Date(sdMonth.getFullYear(), sdMonth.getMonth()+(b.id==="sdNext"?1:-1), 1);
    sdMode="month";
    try{ _dtCloseOpts=null; closeDtPops(); }catch(e){}
    try{ renderStudentDetail(selectedStudentId); }catch(e){}
  } else if(b.id==="sdTimeToggle"){ sdNewest=!sdNewest; try{ renderStudentDetail(selectedStudentId); }catch(e){} }
});
/* Month arrows hold to repeat (user order): a tap steps one month, holding
   runs through the months. Delegated on detailScroll because
   renderStudentDetail recreates #sdPrev/#sdNext on every step — a direct
   holdRepeat would lose its capture with the discarded node. Slower floor
   (~110ms) than the number steppers: each tick rebuilds the whole detail
   panel, so this stays smooth without hammering the Pi. */
if(detailScroll) holdRepeatDelegate(detailScroll,
  (e)=>{ const b=e.target&&e.target.closest?e.target.closest("button"):null; return (b&&(b.id==="sdPrev"||b.id==="sdNext"))?b:null; },
  (t)=>{
    if(!t) return;
    if(!sdMonth){ const _t3=new Date(); sdMonth=new Date(_t3.getFullYear(),_t3.getMonth(),1); }
    sdMonth=new Date(sdMonth.getFullYear(), sdMonth.getMonth()+(t.id==="sdNext"?1:-1), 1);
    sdMode="month";
    try{ _dtCloseOpts=null; closeDtPops(); }catch(e){}
    try{ renderStudentDetail(selectedStudentId); }catch(e){}
  },
  {floorMs:110});
detailScroll.addEventListener("change",(e)=>{
  if(e.target && e.target.id==="sdStatusFilter"){ sdStatus=e.target.value||""; try{ renderStudentDetail(selectedStudentId); }catch(e){} return; }
  if(e.target && e.target.id==="sdDatePreset"){
    const _prev=sdDatePreset;
    sdDatePreset=e.target.value;
    if(sdDatePreset==="current"){
      const _now=new Date(); sdMonth=new Date(_now.getFullYear(),_now.getMonth(),1); sdMode="month"; try{ _dtCloseOpts=null; closeDtPops(); }catch(e){} try{ renderStudentDetail(selectedStudentId); }catch(e){} return;
    }
    if(sdDatePreset==="custom"){
      openSdCustomRange(_prev);
    }else{
      sdMode="range";
      try{ _dtCloseOpts=null; closeDtPops(); }catch(e){}
      try{ renderStudentDetail(selectedStudentId); }catch(e){}
    }
  }
});
function openSdCustomRange(prev){
  const _now=new Date(); const _today=_iso(_now.getFullYear(),_now.getMonth()+1,_now.getDate());
  if(!sdCustomFrom) sdCustomFrom=_today;
  if(!sdCustomTo) sdCustomTo=_today;
  let _applied=false;
  const _anchorEl=(document.querySelector('#sdDatePreset') && document.querySelector('#sdDatePreset').closest('.gsel') && document.querySelector('#sdDatePreset').closest('.gsel').querySelector('.gsel-btn')) || document.getElementById('sdDatePreset');
  /* Capture the trigger rect NOW while the DOM is live. openRangePop()
     closes any existing popup first, and that close can re-render the
     detail panel (detaching this anchor) — measuring later yields a
     0,0 rect and drops the calendar at the top-left corner. */
  let _rect=null;
  try{ const _rr=_anchorEl&&_anchorEl.getBoundingClientRect?_anchorEl.getBoundingClientRect():null; if(_rr&&(_rr.width>0||_rr.height>0)) _rect={left:_rr.left,top:_rr.top,right:_rr.right,bottom:_rr.bottom,width:_rr.width,height:_rr.height}; }catch(_){}
  /* Discard any pending cancel from a previous custom-range popup
     BEFORE opening: letting it fire would revert sdDatePreset and
     re-render (detaching the anchor) mid-open. */
  try{ _dtCloseOpts=null; closeDtPops(); }catch(_){}
  openRangePop(_anchorEl,{key:"R:sdCustom",_rect:_rect,from:sdCustomFrom,to:sdCustomTo,onApply:(f,t)=>{ sdCustomFrom=f; sdCustomTo=t; sdDatePreset="custom"; sdMode="range"; _applied=true; try{ renderStudentDetail(selectedStudentId); }catch(_){}} ,onClear:()=>{ sdCustomFrom=""; sdCustomTo=""; } ,onCancel:()=>{ if(!_applied){ sdDatePreset=prev; try{ renderStudentDetail(selectedStudentId); }catch(_){} } }});
}
/* Re-pick safety: a native select fires change only when its value
   CHANGES, so re-picking "Custom range" while it is already selected
   (after Apply, or after returning from another section) opens nothing.
   Catch that option click directly. The key guard skips it when the
   change path already opened the calendar. */
document.addEventListener("click",(e)=>{
  const o=e.target&&e.target.closest?e.target.closest('.gsel-opt[data-v="custom"]'):null;
  if(!o) return;
  const pop=o.closest?o.closest('.gsel-pop'):null;
  if(!pop||pop.dataset.for!=="sdDatePreset") return;
  if(typeof _dtOpenFor!=="undefined"&&_dtOpenFor==="R:sdCustom") return;
  openSdCustomRange(sdDatePreset);
});
function exportStudentCSV(id){
  const s=Students.find(x=>x.id===id); if(!s) return;
  const rows=[["Date","Time","Status","Finger"]];
  AllEvents.filter(a=>a.studentId===s.id).slice().reverse().forEach(a=>rows.push([a.date||"", a.time||"", a.status||"", a.fingerId!=null?"F-"+a.fingerId:""]));
  exportCSV(rows, (s.name||"student").replace(/\s+/g,"_")+"_attendance.csv");
}
studentListEl.addEventListener("click",(e)=>{ const row=e.target.closest(".ri"); if(!row) return; const id=parseInt(row.dataset.id); if(id) selectStudent(id); });
searchInput.addEventListener("input",()=>{ Timers.clear("search"); Timers.set("search", setTimeout(renderStudentList,260)); });
/* Roster-local search writes through the shared input (no input event,
   so the command palette stays shut) and re-renders the list. */
if($("rosterSearch")) $("rosterSearch").addEventListener("input",()=>{ const rs=$("rosterSearch"); if(searchInput&&rs) searchInput.value=rs.value; renderStudentList(); });
/* Rail command palette: same input, second job. Roster filtering is
   untouched (same id, same debounce above); the palette matches
   actions + students and runs on Enter/click. */
function gotoTab(name){ const b=adminNav&&adminNav.querySelector(`button[data-tab="${name}"]`); if(b) b.click(); }
const CMD_ACTIONS=[
  {t:"Add Class",k:"add class new create",run:()=>{ gotoTab("setup"); openSchedPopup("class",null); }},
  {t:"Add Batch",k:"add batch new create",run:()=>{ gotoTab("setup"); openSchedPopup("batch",null); }},
  {t:"Add Holiday",k:"add holiday vacation exam break",run:()=>{ gotoTab("setup"); paintCbPage(1); openHolidayCreate(); }},
  {t:"Add Override",k:"add override special date exception",run:()=>{ gotoTab("setup"); paintCbPage(1); openOverrideCreate(); }},
  {t:"School Information",k:"school info settings name address year cutoff",run:()=>{ openModal(schoolInfoModal); }},
  {t:"New Enrollment",k:"new enroll admit student",run:()=>{ gotoTab("students"); openNewStudent(); }},
  {t:"Import CSV",k:"import csv upload students",run:()=>{ gotoTab("students"); const b=$("importStudentsBtn"); if(b) b.click(); }},
  {t:"Export CSV",k:"export csv download students",run:()=>{ gotoTab("students"); const b=$("exportStudentsBtn"); if(b) b.click(); }},
  {t:"Refresh attendance",k:"refresh reload attendance update",run:()=>{ gotoTab("attendance"); const b=$("attRefreshBtn"); if(b) b.click(); }},
  {t:"Print attendance",k:"print attendance report paper",run:()=>{ gotoTab("attendance"); const b=$("attPrintBtn"); if(b) b.click(); }},
  {t:"Export attendance CSV",k:"export attendance csv download report",run:()=>{ gotoTab("attendance"); const b=$("attExportBtn"); if(b) b.click(); }},
  {t:"Back Up Now",k:"backup save database drive",run:()=>{ gotoTab("backup"); const b=$("backupNowBtn"); if(b) b.click(); }},
  {t:"Holidays",k:"holidays list view vacations board",run:()=>{ gotoTab("setup"); paintCbPage(1); }},
  {t:"Overrides",k:"overrides list view dates board",run:()=>{ gotoTab("setup"); paintCbPage(1); }},
  {t:"Attendance",k:"attendance today present late absent",run:()=>gotoTab("attendance")},
  {t:"Students",k:"students roster list",run:()=>gotoTab("students")},
  {t:"Setup",k:"setup schedule school configuration",run:()=>gotoTab("setup")},
  {t:"Backup",k:"backup manager",run:()=>gotoTab("backup")},
];
let _cmdItems=[], _cmdHi=0;
function cmdMatches(){
  const q=(searchInput.value||"").trim().toLowerCase();
  if(!q) return null;
  const acts=CMD_ACTIONS.filter(a=>(a.t+" "+a.k).toLowerCase().includes(q)).slice(0,5);
  const stus=Students.filter(s=>(s.name+" "+s.roll+" "+s.class+" "+(s.batch||"")+" "+s.phone+" "+s.fid+" "+s.id+" "+(s.section||"")+" "+(s.parent||"")).toLowerCase().includes(q)).slice(0,6);
  return {acts,stus};
}
function paintCmdPal(){
  const box=$("cmdPal"); if(!box) return;
  const m=cmdMatches();
  if(!m||(!m.acts.length&&!m.stus.length)){ box.hidden=true; searchInput.setAttribute("aria-expanded","false"); searchInput.removeAttribute("aria-activedescendant"); return; }
  let html=""; _cmdItems=[]; let idx=0;
  if(m.acts.length){
    html+=`<div class="cmd-grp">Actions</div>`;
    m.acts.forEach(a=>{ _cmdItems.push({kind:"act",ref:a}); html+=`<div class="cmd-opt" id="cmdOpt-${idx}" data-cmd="${idx++}" role="option" aria-selected="false"><span>${esc(a.t)}</span><span class="k">action</span></div>`; });
  }
  if(m.stus.length){
    html+=`<div class="cmd-grp">Students</div>`;
    m.stus.forEach(s=>{ _cmdItems.push({kind:"stu",ref:s}); html+=`<div class="cmd-opt" id="cmdOpt-${idx}" data-cmd="${idx++}" role="option" aria-selected="false"><span>${esc(s.name)}</span><span class="k">${esc(s.roll||"")}</span></div>`; });
  }
  box.innerHTML=html; box.hidden=false; searchInput.setAttribute("aria-expanded","true");
  _cmdHi=0; markCmdHi();
}
function markCmdHi(){
  const box=$("cmdPal"); if(!box||box.hidden) return;
  box.querySelectorAll(".cmd-opt").forEach((el,i)=>{
    const on=(i===_cmdHi);
    el.classList.toggle("hi",on);
    el.setAttribute("aria-selected",on?"true":"false");
    if(on) searchInput.setAttribute("aria-activedescendant",el.id||("cmdOpt-"+i));
  });
  const cur=box.querySelector(".cmd-opt.hi");
  if(cur){ try{ cur.scrollIntoView({block:"nearest"}); }catch(e){} }
}
function runCmd(i){
  const it=_cmdItems[i]; closeCmdPal(false); if(!it) return;
  if(it.kind==="act"){ try{ it.ref.run(); }catch(e){} }
  else { gotoTab("students"); selectStudent(it.ref.id); }
}
function closeCmdPal(clear){
  const box=$("cmdPal"); if(box) box.hidden=true;
  searchInput.setAttribute("aria-expanded","false");
  searchInput.removeAttribute("aria-activedescendant");
  if(clear){ searchInput.value=""; renderStudentList(); }
}
searchInput.addEventListener("input",paintCmdPal);
searchInput.addEventListener("keydown",(e)=>{
  const box=$("cmdPal"), open=box&&!box.hidden;
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){
    if(!open) return;
    e.preventDefault();
    _cmdHi=((_cmdHi+(e.key==="ArrowDown"?1:-1))%_cmdItems.length+_cmdItems.length)%_cmdItems.length;
    markCmdHi();
  }else if(e.key==="Enter"){
    if(!open) return;
    e.preventDefault(); runCmd(_cmdHi);
  }else if(e.key==="Escape"){
    if(!open) return;
    e.preventDefault(); e.stopPropagation(); closeCmdPal(false);
  }
});
if($("cmdPal")) $("cmdPal").addEventListener("click",(e)=>{
  const o=e.target.closest("[data-cmd]"); if(!o) return;
  runCmd(parseInt(o.dataset.cmd,10));
});
document.addEventListener("pointerdown",(e)=>{
  const box=$("cmdPal");
  if(box&&!box.hidden&&!(e.target.closest&&e.target.closest(".rail-search"))) closeCmdPal(false);
},true);
classFilter.addEventListener("change",renderStudentList);
if(batchFilter) batchFilter.addEventListener("change",renderStudentList);
if(studentStatusFilter) studentStatusFilter.addEventListener("change",renderStudentList);
/* Roster filter row (filters spec): plain text buttons drive the hidden
   native selects (truth for renderStudentList/renderClassFilters).
   Selecting applies, closes, and selects the first student in result. */
let fltOpen="";
function paintFlt(){
  const cf=classFilter?classFilter.value:"", bf=batchFilter?batchFilter.value:"", sf=studentStatusFilter?studentStatusFilter.value:"all";
  const bc=$("fltClass"), bb=$("fltBatch"), ba=$("fltActive"), cl=$("fltClear");
  if(bc){ bc.textContent=cf||"All classes"; bc.classList.toggle("set",!!cf); }
  if(bb){ bb.textContent=bf||"All batches"; bb.classList.toggle("set",!!bf); }
  if(ba){ ba.classList.toggle("set",sf==="active"); }
  if(cl) cl.classList.toggle("show",!!(cf||bf||sf!=="all"));
}
function fltApply(){
  renderStudentList(); paintFlt();
  const first=studentListEl.querySelector(".ri");
  if(first) selectStudent(+first.dataset.id);
}
function fltClose(){ fltOpen=""; const pv=$("fltPop"); if(pv) pv.hidden=true; }
function fltPop(kind,btn){
  const pv=$("fltPop"); if(!pv) return;
  if(fltOpen===kind){ fltClose(); return; }
  fltOpen=kind;
  const isC=kind==="c";
  const items=isC?[...(Classes||[])]:[...new Set([...(Batches||[]),...Students.map(s=>s.batch).filter(Boolean)])].sort();
  const cur=isC?(classFilter&&classFilter.value):(batchFilter&&batchFilter.value);
  const cnt=v=>Students.filter(s=>isC?s.class===v:(s.batch||"")===v).length;
  pv.innerHTML=`<div class="pv-head"><h4>${isC?"All classes":"All batches"}</h4><span>${Students.length} total</span></div><div class="pv-search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input type="text" id="pvSearch" placeholder="Search ${isC?"classes":"batches"}..." aria-label="Search ${isC?"classes":"batches"}" autocomplete="off" spellcheck="false"></div><div class="pv-list">`+
    `<button class="o${cur?"":" on"}" data-v=""><span>${isC?"All classes":"All batches"}</span><small>${Students.length}</small></button><div class="cap">${isC?"Classes":"Batches"}</div>`+
    items.map(v=>`<button class="o${cur===v?" on":""}" data-v="${esc(v)}"><span>${esc(v)}</span><small>${cnt(v)}</small></button>`).join("")+`</div>`;
  const si=pv.querySelector(".pv-search input"); if(si) si.addEventListener("input",()=>{ const q=si.value.trim().toLowerCase(); pv.querySelectorAll(".o").forEach(b=>{ const t=(b.querySelector("span")||b).textContent.toLowerCase(); const hide=!!q && !t.includes(q); b.hidden=hide; b.style.display=hide?"none":""; }); pv.querySelectorAll(".cap").forEach(c=>{ c.hidden=!!q; c.style.display=q?"none":""; }); });
  pv.style.left=btn.offsetLeft+"px"; pv.style.top=(btn.offsetTop+btn.offsetHeight+8)+"px"; pv.hidden=false;
  try{ const ro=btn.closest(".ro"); const maxLeft=Math.max(0,(ro?ro.clientWidth:pv.parentElement.clientWidth)-pv.offsetWidth-4); if(btn.offsetLeft>maxLeft) pv.style.left=maxLeft+"px"; }catch(e){}
  pv.querySelectorAll(".o").forEach(o=>o.onclick=()=>{ const sel=isC?classFilter:batchFilter; if(sel) sel.value=o.dataset.v; fltClose(); fltApply(); });
}
if($("fltClass")) $("fltClass").onclick=function(){ fltPop("c",this); };
if($("fltBatch")) $("fltBatch").onclick=function(){ fltPop("b",this); };
if($("enrollClose")) $("enrollClose").onclick=()=>{ const m=$("enrollModal"); if(m) m.classList.remove("open"); };
if($("fltActive")) $("fltActive").onclick=function(){ if(studentStatusFilter) studentStatusFilter.value=(studentStatusFilter.value==="active")?"all":"active"; fltClose(); fltApply(); };
if($("fltClear")) $("fltClear").onclick=function(){ if(classFilter) classFilter.value=""; if(batchFilter) batchFilter.value=""; if(studentStatusFilter) studentStatusFilter.value="all"; fltClose(); fltApply(); };
/* Sort by opens on hover like the gsel triggers (user order): the button is
   a label, not a toggle — entering its wrap opens the menu, leaving the
   wrap closes it, and the menu's own pick handler dismisses it deliberately.
   Click-to-toggle is retired here for the same reason it was in enhance():
   on touch the tap's synthetic mouseleave closed the menu before a choice
   could land. Keyboard Enter/Space still opens via the keydown handler.
   Close discipline mirrors the gsel lifecycle exactly (user order): leave
   only *schedules* a close 160ms out, and the timer re-checks the live
   pointer position against BOTH rects before hiding — so crossing the 8px
   gap between trigger and panel can never kill the menu mid-journey. */
if($("roSort")){ const _roWrap=$("roSort").closest(".ro-sort-wrap"); if(_roWrap){ const _roList=$("roSortMenu");
  const RO_DELAY=160;
  let _roTimer=null, _roX=-1, _roY=-1, _roTracked=false;
  function _roCancel(){ if(_roTimer){ clearTimeout(_roTimer); _roTimer=null; } }
  function _roIn(x,y){
    if(!_roWrap||!_roList||_roList.hidden) return false;
    const wr=_roWrap.getBoundingClientRect();
    if(x>=wr.left-1&&x<=wr.right+1&&y>=wr.top-1&&y<=wr.bottom+1) return true;
    const pr=_roList.getBoundingClientRect();
    if(x>=pr.left-1&&x<=pr.right+1&&y>=pr.top-1&&y<=pr.bottom+1) return true;
    return false;
  }
  function _roTrack(e){ _roX=e.clientX; _roY=e.clientY; }
  function _roTrackLeave(e){ if(e&&e.relatedTarget===null){ _roX=_roY=-1; } }
  function _roWatch(on){
    if(on&&!_roTracked){ _roTracked=true; document.addEventListener("pointermove",_roTrack,true); document.addEventListener("mouseleave",_roTrackLeave,true); }
    if(!on&&_roTracked){ _roTracked=false; document.removeEventListener("pointermove",_roTrack,true); document.removeEventListener("mouseleave",_roTrackLeave,true); }
  }
  function _roOpen(){ if(_roList&&_roList.hidden){ _roList.hidden=false; $("roSort").setAttribute("aria-expanded","true"); _roWatch(true); } }
  function _roClose(){ _roCancel(); _roWatch(false); if(_roList&&!_roList.hidden){ _roList.hidden=true; $("roSort").setAttribute("aria-expanded","false"); } }
  function _roSoon(){
    _roCancel();
    if(!_roList||_roList.hidden) return;
    _roTimer=setTimeout(()=>{ _roTimer=null; if(_roIn(_roX,_roY)) return; _roClose(); },RO_DELAY);
  }
  _roWrap.addEventListener("mouseenter",()=>{ _roCancel(); _roOpen(); });
  _roWrap.addEventListener("mouseleave",_roSoon);
  if(_roList){ _roList.addEventListener("mouseenter",_roCancel); _roList.addEventListener("mouseleave",_roSoon); }
  $("roSort").addEventListener("focus",_roCancel);
  $("roSort").addEventListener("keydown",(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); _roCancel(); _roOpen(); } });
} }
if($("roSortMenu")) $("roSortMenu").addEventListener("click", function(e){ const b=e.target.closest("button[data-sort]"); if(!b) return; sdStudentSort=b.dataset.sort; const lbl=$("roSortLabel"); if(lbl){ const labelMap={name:"Name",name_desc:"Name",roll:"Roll",class:"Class",active:"Active first"}; lbl.textContent=labelMap[sdStudentSort]||"Name"; } const m=$("roSortMenu"); if(m) m.hidden=true; const r=$("roSort"); if(r) r.setAttribute("aria-expanded","false"); renderStudentList(); });
/* roSortMenu is a raw panel like #fltPop — it was missing the outside-close
   + Escape handlers, so it stayed open when the user clicked elsewhere. */
document.addEventListener("click",(e)=>{ const m=$("roSortMenu"); if(!m||m.hidden) return; const inside=e.target&&e.target.closest&&(e.target.closest("#roSortMenu")||e.target.closest("#roSort")); if(!inside){ m.hidden=true; const r=$("roSort"); if(r) r.setAttribute("aria-expanded","false"); } });
document.addEventListener("keydown",(e)=>{ if(e.key==="Escape"){ const m=$("roSortMenu"); if(m&&!m.hidden){ m.hidden=true; const r=$("roSort"); if(r) r.setAttribute("aria-expanded","false"); } } });
document.addEventListener("click",(e)=>{ if(fltOpen&&!(e.target.closest&&((e.target.closest("#fltPop"))||(e.target.closest("#flt"))))) fltClose(); });
document.addEventListener("keydown",(e)=>{ if(e.key==="Escape"&&fltOpen) fltClose(); });
try{ paintFlt(); }catch(e){}
const handleTableClick = (e)=>{
  const corr = e.target.closest("[data-correct]");
  if(corr){
    e.stopPropagation();
    const sid=parseInt(corr.dataset.correctSid), date=corr.dataset.correctDate, old=corr.dataset.correctStatus;
    openCorrection(sid, date, old);
    return;
  }
  const tr=e.target.closest(".ar"); if(!tr) return; const sid=parseInt(tr.dataset.student);
  if(sid){ adminNav.querySelector('[data-tab="students"]').click(); setTimeout(()=>selectStudent(sid),120); }
};
if(attTableBody) attTableBody.addEventListener("click", handleTableClick);
// ---- correction (POST /api/correction) ----
function openCorrection(studentId, date, oldStatus){
  const s=Students.find(x=>x.id===studentId);
  if(!s) return;
  const body=$("correctionModalBody");
  if(!body) return;
  const _dm=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date||"");
  const _dd=_dm?(+_dm[3])+" "+MONTHS_S[+_dm[2]-1]+" "+_dm[1]:date;
  const _stTxt={PRESENT:"Present",LATE:"Late",ABSENT:"Absent",NOT_SCHEDULED:"Not scheduled"}[String(oldStatus||"").toUpperCase()]||oldStatus||"—";
  body.innerHTML=`
    <div>
      <div class="msum">${esc(s.name)} · ${esc(s.roll)} · ${esc(s.class)}</div>
      <div class="msum2">${esc(_dd)} · Currently ${esc(_stTxt)}</div>
      <div class="fld" style="margin-top:28px"><label>New status</label><div class="seg s4" id="corrOpts" role="radiogroup"></div><select id="corrStatus" class="corr-hidden" data-gsel="1" tabindex="-1" aria-hidden="true"><option value="PRESENT">Present</option><option value="LATE">Late</option><option value="ABSENT">Absent</option><option value="NOT_SCHEDULED">Not scheduled</option></select></div>
      <div class="fld" style="margin-top:28px"><label for="corrReason">Reason</label><textarea id="corrReason" rows="3" maxlength="300" placeholder="e.g. Arrived late, fingerprint misread"></textarea><p class="cnt" id="corrCount">0 / 300</p></div>
      <div class="ft"><button id="corrCancel">Cancel</button><button class="go" id="corrSave" disabled>Save correction</button></div>
      <div class="err" id="corrErr" style="display:none"></div>
    </div>`;
  // preselect oldStatus if matches
  try{ const sel=$("corrStatus"); if(sel && oldStatus) { const up=String(oldStatus).toUpperCase(); for(let o of sel.options){ if(o.value===up) sel.value=o.value; } } }catch(e){}
  /* Plain-text status options, driven by the same select value the
     save handler reads. The native select stays hidden (no gsel
     enhancement here); the option row mirrors + writes its value. */
  const _cs2=$("corrStatus"), _base=_cs2?_cs2.value:"", _box=$("corrOpts"), _rs=$("corrReason"), _sv=$("corrSave"), _ct=$("corrCount");
  function paintCorrOpts(){ if(!_box||!_cs2) return; _box.innerHTML=""; Array.from(_cs2.options).forEach(o=>{ const b=document.createElement("button"); b.type="button"; const on=o.value===_cs2.value; b.className=on?"on":""; b.textContent=o.textContent; b.dataset.v=o.value; b.setAttribute("role","radio"); b.setAttribute("aria-checked",on?"true":"false"); b.onclick=()=>{ _cs2.value=o.value; paintCorrOpts(); syncCorrSave(); }; _box.appendChild(b); }); }
  function syncCorrSave(){ const r=_rs?_rs.value:""; if(_ct) _ct.textContent=r.length+" / 300"; const t=r.trim(); const ok=_cs2&&_cs2.value!==_base&&t.length>=3&&t.length<=300; if(_sv) _sv.disabled=!ok; }
  if(_rs) _rs.addEventListener("input",syncCorrSave);
  paintCorrOpts(); syncCorrSave();
  openModal(correctionModal);
  $("corrCancel").onclick=()=>closeModal(correctionModal);
  $("corrSave").onclick=async()=>{
    const newStatus=$("corrStatus").value, reason=$("corrReason").value.trim(), err=$("corrErr");
    if(!newStatus || !reason || reason.length<3 || reason.length>300){ err.textContent="Status and reason (3-300 chars) required."; err.style.display="block"; return; }
    err.style.display="none";
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
      await glassAlert("Correction saved. Audit preserved.");
    }catch(ex){
      err.textContent=ex.message||"Failed to save correction"; err.style.display="block";
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
document.addEventListener("keydown",(e)=>{
  if(e.key==="Escape"){
    if(daySheetModal && daySheetModal.classList.contains("open")){ closeDaySheet(); }
    else if(enrollModal && enrollModal.classList.contains("open")){
      finishEnrollUi();
      if(adminLayer && adminLayer.classList.contains("open")) return;
      resumeSensorScan();
    }
    else if(holidayViewModal && holidayViewModal.classList.contains("open")) closeModal(holidayViewModal);
    else if(overrideViewModal && overrideViewModal.classList.contains("open")) closeModal(overrideViewModal);
    else if(holidayModal && holidayModal.classList.contains("open")) closeModal(holidayModal);
    else if(overrideModal && overrideModal.classList.contains("open")) closeModal(overrideModal);
    else if(schedModal && schedModal.classList.contains("open")) closeModal(schedModal);
    else if(schoolInfoModal && schoolInfoModal.classList.contains("open")) closeModal(schoolInfoModal);
    else if(correctionModal && correctionModal.classList.contains("open")) closeModal(correctionModal);
    else if(adminLayer && adminLayer.classList.contains("open")){
      finishEnrollUi();
      adminLayer.classList.remove("open");
      resumeSensorScan();
    }
  }
});
// ---- init ----
function bootFail(e){ console.error(e); document.body.insertAdjacentHTML("afterbegin",'<div style="position:fixed;top:0;left:0;right:0;z-index:99999;background:#8A3A3A;color:#fff;font:12px sans-serif;padding:8px 12px">Boot failed: '+String((e&&e.message)||e)+'</div>'); }
cacheLoad();
const _liveBoot=(()=>{ try{return new URLSearchParams(location.search).get("live")==="1";}catch(e){return false;} })();
/* Dev loop: ?live=1 skips the cached first paint so a refresh never
   flashes stale rows; loadAll() repaints fresh right after. */
if(!_liveBoot){ try{ renderAll(); }catch(e){ bootFail(e); } }
setState("ready");
loadAll().then(()=>{
  setTimeout(sensorScanLoop,300);
  /* UI-testing shortcut (user order): ?tab=<name> reopens the admin
     straight on that tab after a refresh — no Admin click, no tab
     hunting. Normal PIN/session rules still apply to API calls. */
  try{
    const q=new URLSearchParams(location.search);
    const t=q.get("tab");
    const live=q.get("live")==="1";
    let auto=false;
    if(t&&["students","attendance","setup","backup","today","reports","calendar","settings"].indexOf(t)>=0){
      currentTab=t;
      try{localStorage.setItem("atl_admin_tab",t);}catch(_){}
      openAdmin(); auto=true;
    }
    /* Dev loop (user order): ?live=1 restores the last open position
       (admin panel + tab + selected student) after every auto-refresh.
       Production boot without the param is untouched (kiosk stays idle). */
    else if(live){ try{ openAdmin(); auto=true; }catch(e){} }
    if(auto){ try{ const sid=parseInt(localStorage.getItem("atl_student")||""); if(sid&&Students.some(x=>x.id===sid)) selectStudent(sid); }catch(e){} }
  }catch(e){}
  /* Live-reload for UI testing (user order): ?tab=X&live=1 keeps the page
     fresh while you edit. CSS-only changes hot-swap live with zero state
     loss (open modals, scroll, typed inputs all survive); JS changes still
     need a full reload, and ?live=1 restores your tab + student after it.
     Inert without the param. */
  try{
    const q2=new URLSearchParams(location.search);
    if(q2.get("live")==="1"){
      const hash=s=>{let h=5381;for(let i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;return h;};
      let first=null;
      const timer=setInterval(async()=>{
        if(document.hidden) return;
        try{
          const r=await fetch(location.pathname+"?devping="+Date.now(),{cache:"no-store"});
          const t=await r.text();
          const a=t.indexOf("<style>"), b=t.indexOf("</style>");
          const c=t.indexOf("<script>"), d=t.lastIndexOf("<\/script>");
          const css=(a>=0&&b>a)?t.slice(a+7,b):"";
          const js=(c>=0&&d>c)?t.slice(c+8,d):"";
          const cur={c:hash(css),j:hash(js)};
          if(!first){first=cur;return;}
          if(cur.j!==first.j){clearInterval(timer);location.reload();return;}
          if(cur.c!==first.c){
            first.c=cur.c;
            const st=document.querySelector("style");
            if(st){ try{ st.textContent=css; }catch(_){} }
          }
        }catch(e){}
      },800);
    }
  }catch(e){}
}, bootFail);
setInterval(()=>{
  if(typeof document!=="undefined" && document.hidden) return;
  loadTodayAttendance().then(()=>{ if(currentTab==="attendance") renderAttendance(); });
}, 15000);
// alias used by the injected backend bridge
function saveStorage(){ return cacheSave(); }
/* Glass confirm/alert — frosted replacement for native confirm()/alert() (Promise-based) */
function toast(msg){
  try{
    document.querySelectorAll(".toast-live").forEach(n=>n.remove());
    if(window._toastTimer){ clearTimeout(window._toastTimer); window._toastTimer=null; }
    const t=document.createElement("div"); t.className="toast toast-live"; t.textContent=msg;
    document.body.appendChild(t);
    window._toastTimer=setTimeout(()=>{ try{ t.remove(); }catch(e){} window._toastTimer=null; },2600);
  }catch(e){}
}
function glassDialog(opts){
  opts=opts||{};
  return new Promise((resolve)=>{
    const prevFocus=(typeof document!=='undefined'&&document.activeElement)||null;
    const ov=document.createElement('div'); ov.className='gconfirm-ov';
    const card=document.createElement('div'); card.className='gconfirm'; card.setAttribute('role','alertdialog'); card.setAttribute('aria-modal','true');
    const h=document.createElement('h3'); h.textContent=opts.title||'Confirm'; card.appendChild(h);
    const p=document.createElement('p'); p.textContent=opts.message||''; card.appendChild(p);
    const row=document.createElement('div'); row.className='gconfirm-row';
    let done=false;
    const cleanup=()=>{ ov.remove(); document.removeEventListener('keydown',onKey,true); if(prevFocus&&prevFocus.focus){ try{ prevFocus.focus(); }catch(e){} } };
    const finish=(v)=>{ if(done) return; done=true; cleanup(); resolve(v); };
    if(opts.cancelText!==null&&opts.cancelText!==undefined){
      const c=document.createElement('button'); c.type='button'; c.className='gconfirm-cancel'; c.textContent=opts.cancelText||'Cancel';
      c.addEventListener('click',()=>finish(false)); row.appendChild(c);
    }
    const ok=document.createElement('button'); ok.type='button'; ok.className='gconfirm-ok'+(opts.danger?' danger':''); ok.textContent=opts.okText||'Confirm';
    ok.addEventListener('click',()=>finish(true)); row.appendChild(ok);
    card.appendChild(row); ov.appendChild(card); document.body.appendChild(ov);
    const btns=Array.from(row.querySelectorAll('button'));
    const onKey=(e)=>{
      if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); finish(false); }
      else if(e.key==='Enter'){ e.preventDefault(); e.stopPropagation(); finish(true); }
      else if(e.key==='Tab'){ e.preventDefault(); e.stopPropagation(); const i=btns.indexOf(document.activeElement); const n=e.shiftKey?(i<=0?btns.length-1:i-1):(i===btns.length-1?0:i+1); btns[n].focus(); }
    };
    document.addEventListener('keydown',onKey,true);
    try{ ok.focus(); }catch(e){}
  });
}
function glassConfirm(message,opts){ opts=opts||{}; opts.message=message; if(opts.cancelText===undefined) opts.cancelText='Cancel'; if(!opts.okText) opts.okText='Confirm'; return glassDialog(opts); }
function glassAlert(message,okText){ return glassDialog({title:'Notice',message:message,okText:okText||'OK',cancelText:null}); }
function glassPrompt(message,defaultValue,opts){
  opts=opts||{};
  return new Promise((resolve)=>{
    const prevFocus=(typeof document!=='undefined'&&document.activeElement)||null;
    const ov=document.createElement('div'); ov.className='gconfirm-ov';
    const card=document.createElement('div'); card.className='gconfirm'; card.setAttribute('role','dialog'); card.setAttribute('aria-modal','true');
    const h=document.createElement('h3'); h.textContent=opts.title||'Enter Value'; card.appendChild(h);
    if(message){ const p=document.createElement('p'); p.textContent=message; card.appendChild(p); }
    const inp=document.createElement('input'); inp.type='text'; inp.className='setup-input-compact';
    inp.style.cssText='width:100%;margin:12px 0 0;background:rgba(242,243,246,0.06);border:1px solid var(--frost-line);color:inherit;padding:8px 10px;border-radius:0;font-size:13px;outline:none;box-sizing:border-box;';
    inp.value=defaultValue||'';
    if(opts.placeholder) inp.placeholder=opts.placeholder;
    card.appendChild(inp);
    const row=document.createElement('div'); row.className='gconfirm-row';
    let done=false;
    const cleanup=()=>{ ov.remove(); document.removeEventListener('keydown',onKey,true); if(prevFocus&&prevFocus.focus){ try{ prevFocus.focus(); }catch(e){} } };
    const finish=(v)=>{ if(done) return; done=true; cleanup(); resolve(v); };
    const c=document.createElement('button'); c.type='button'; c.className='gconfirm-cancel'; c.textContent=opts.cancelText||'Cancel';
    c.addEventListener('click',()=>finish(null)); row.appendChild(c);
    const ok=document.createElement('button'); ok.type='button'; ok.className='gconfirm-ok'; ok.textContent=opts.okText||'Confirm';
    ok.addEventListener('click',()=>finish(inp.value.trim())); row.appendChild(ok);
    card.appendChild(row); ov.appendChild(card); document.body.appendChild(ov);
    const onKey=(e)=>{
      if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); finish(null); }
      else if(e.key==='Enter'){ e.preventDefault(); e.stopPropagation(); finish(inp.value.trim()); }
    };
    document.addEventListener('keydown',onKey,true);
    setTimeout(()=>{ try{ inp.focus(); inp.select(); }catch(e){} }, 40);
  });
}
/* Human-readable byte size for the photo readout */
function fmtPhotoSize(bytes){
  const n=Number(bytes)||0;
  if(n<1024) return n+' B';
  if(n<1048576){ const s=(n/1024).toFixed(1); return (s.slice(-2)==='.0'?s.slice(0,-2):s)+' KB'; }
  return (n/1048576).toFixed(2)+' MB';
}
/* Photo dropzone — re-skins native file input, preserves files[0] read path + validation */
function enhancePhotoField(input){
  if(!input||input.tagName!=='INPUT'||input.type!=='file'||input.dataset.ph) return;
  input.dataset.ph='1';
  if(!input._mono) input._mono='+';
  const monoHtml=()=>{ const sp=document.createElement('span'); sp.textContent=input._mono||'+'; return sp; };
  const drop=document.createElement('div'); drop.className='photo-drop';
  input.parentNode.insertBefore(drop,input); drop.appendChild(input);
  try{ input.tabIndex=-1; }catch(e){}
  const thumb=document.createElement('div'); thumb.className='photo-thumb'; thumb.appendChild(monoHtml());
  const meta=document.createElement('div'); meta.className='photo-meta';
  const nm=document.createElement('div'); nm.className='photo-name'; nm.textContent='No photo yet';
  const sz=document.createElement('div'); sz.className='photo-sub'; sz.textContent='Optional. Up to 2 MB. Drag and drop.';
  meta.appendChild(nm); meta.appendChild(sz);
  const acts=document.createElement('div'); acts.className='photo-acts';
  const choose=document.createElement('button'); choose.type='button'; choose.className='photo-choose'; choose.textContent='Choose photo';
  const rm=document.createElement('button'); rm.type='button'; rm.className='photo-remove'; rm.textContent='Remove'; rm.style.display='none';
  acts.appendChild(choose); acts.appendChild(rm);
  drop.appendChild(thumb); drop.appendChild(meta); drop.appendChild(acts);
  let objUrl=null;
  const refresh=()=>{
    const f=input.files&&input.files[0];
    if(objUrl){ try{ URL.revokeObjectURL(objUrl); }catch(e){} objUrl=null; }
    if(f){
      try{ objUrl=URL.createObjectURL(f); thumb.innerHTML=''; const im=document.createElement('img'); im.alt=''; im.src=objUrl; thumb.appendChild(im); }catch(e){}
      nm.textContent=f.name; sz.textContent=fmtPhotoSize(f.size)+' · kept on save'; rm.style.display='';
    }else{
      thumb.innerHTML=''; thumb.appendChild(monoHtml()); nm.textContent='No photo yet'; sz.textContent='Optional. Up to 2 MB. Drag and drop.'; rm.style.display='none';
    }
  };
  const changed=()=>refresh();
  input.addEventListener('change',changed);
  input._photoRefresh=refresh;
  choose.addEventListener('click',()=>{ try{ input.click(); }catch(e){} });
  rm.addEventListener('click',(e)=>{
    e.preventDefault();
    if(input.id==='edPhoto'){ const clr=document.getElementById('edClearPhoto'); if(clr){ clr.click(); } }
    else{ try{ input.value=''; }catch(_e){} }
    refresh();
  });
  drop.addEventListener('dragover',(e)=>{ e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave',()=>drop.classList.remove('over'));
  drop.addEventListener('drop',(e)=>{
    e.preventDefault(); drop.classList.remove('over');
    const fs=e.dataTransfer&&e.dataTransfer.files;
    if(fs&&fs.length){ try{ input.files=fs; }catch(_e){} refresh(); try{ input.dispatchEvent(new Event('change',{bubbles:true})); }catch(_e2){} }
  });
  refresh();
}
/* Rail Reveal — the popup emerges from the sidebar edge toward the
   left, fades in over the same window, then settles. Inline
   transition keeps the change self-contained (no CSS edit). The rAF
   split forces the start state to commit before the end state runs;
   otherwise the browser collapses the two into one frame and the
   popup pops in instead of sliding. `dx` is a fixed small distance
   toward the rail (the popup right edge is already 8px from the rail
   left; starting at +12px reads as "emerge from the rail"). */
const RAIL_REVEAL_DX=12;
const RAIL_REVEAL_MS=160;
function _revealFromRail(el){
  if(!el) return;
  try{ el.style.transition="none"; el.style.opacity="1"; el.style.transform=""; _railBridge(el); }catch(e){}
}
/* 1px hairline stub bridging the 8px rail gap at trigger height, so the
   popup reads as emerging from the owning row. Child of the popup, so
   it travels with the reveal and dies with the surface (reuse path
   clears it via innerHTML; _bridge ref is re-created each reveal).
   pointer-events:none: hover/leave math uses the popup border box,
   which excludes this overflow stub. Color is the global hairline
   token (ink-aware via the existing D10 flip); no new paint. */
function _railBridge(popEl){
  if(!popEl) return;
  try{
    if(popEl._bridge){ try{popEl._bridge.remove();}catch(e){} popEl._bridge=null; }
    const top=parseFloat(popEl.style.top)||0;
    const h=popEl.offsetHeight||0;
    const ty=(typeof popEl._triggerY==="number")?popEl._triggerY:top+h/2;
    let y=Math.round(ty-top);
    y=Math.max(5,Math.min(Math.max(5,h-5),y));
    const b=document.createElement("div");
    b.setAttribute("aria-hidden","true");
    b.style.cssText="position:absolute;right:-8px;top:"+y+"px;width:8px;height:1px;background:var(--hairline);pointer-events:none;";
    popEl.appendChild(b);
    popEl._bridge=b;
  }catch(e){}
}
/* Glass dropdowns — custom translucent popups for native <select> (native stays truth, fires change) */
(function(){
  if(window.__glassSelectInit) return; window.__glassSelectInit=true;
  let openWrap=null, popEl=null, hiIdx=-1;
  /* Lifecycle: single rAF-deferred close gated on real pointer state.
     Old :hover polling raced the 1-2px gap between sibling controls and
     could close the *next* popup just as it opened (the "stuck hover"
     bug). Pointermove/mouseleave on document tell us when the cursor
     has truly left BOTH the trigger and the list. */
  const CLOSE_DELAY=160;
  let closeTimer=null, lastPointerX=-1, lastPointerY=-1;
  function cancelClose(){ if(closeTimer){ clearTimeout(closeTimer); closeTimer=null; } }
  function inWrapOrPop(x,y){
    if(!openWrap || !popEl) return false;
    const wr=openWrap.getBoundingClientRect();
    if(x>=wr.left-1 && x<=wr.right+1 && y>=wr.top-1 && y<=wr.bottom+1) return true;
    const pr=popEl.getBoundingClientRect();
    if(x>=pr.left-1 && x<=pr.right+1 && y>=pr.top-1 && y<=pr.bottom+1) return true;
    return false;
  }
  function maybeCloseSoon(){
    cancelClose();
    if(!openWrap || !popEl) return;
    /* Never hover-close while the user is TYPING in the popup's search field
       (user report: "the popup disappears after two or three words").
       inWrapOrPop() re-measures the popup's CURRENT rect, and the filter hides
       non-matching rows, so typing SHRINKS the popup under a cursor that never
       moved: the point falls outside the new rect, mouseleave fires, and the
       pop closed mid-word.
       popEl.__typing is set by the input listener below and is NOT implied by
       focus: the search field is auto-focused the moment the popup opens, so a
       bare focus test would disable hover-close for as long as the popup is
       open. Only real typing suppresses it; Escape, an outside click and
       picking a row all still close as before. */
    try{ if(popEl.contains(document.activeElement) && popEl.__typing) return; }catch(e){}
    closeTimer=setTimeout(()=>{
      closeTimer=null;
      if(inWrapOrPop(lastPointerX,lastPointerY)) return;
      /* Re-check after the grace period: the field can gain focus, or the user
         can start typing, inside those CLOSE_DELAY ms. */
      try{ if(popEl && popEl.__typing && popEl.contains(document.activeElement)) return; }catch(e){}
      closePop(false);
    },CLOSE_DELAY);
  }
  function onDocMove(e){ lastPointerX=e.clientX; lastPointerY=e.clientY; }
  function onDocLeave(e){ if(e && e.relatedTarget===null){ lastPointerX=lastPointerY=-1; } }
  function rows(){ return popEl ? Array.from(popEl.querySelectorAll('.gsel-opt:not([aria-disabled="true"])')) : []; }
  function setHi(i){
    const rs=rows(); if(!rs.length) return;
    hiIdx=(i+rs.length)%rs.length;
    rs.forEach((r,j)=>r.classList.toggle('hi', j===hiIdx));
    try{ rs[hiIdx].scrollIntoView({block:'nearest'}); }catch(e){}
  }
  function closePop(refocus){
    cancelClose();
    if(popEl){ popEl.remove(); popEl=null; }
    const w=openWrap; openWrap=null; hiIdx=-1;
    if(w){ w.classList.remove('open'); const b=w.querySelector('.gsel-btn'); if(b){ b.setAttribute('aria-expanded','false'); if(refocus) b.focus(); } }
    document.removeEventListener('pointerdown',onDocDown,true);
    document.removeEventListener('keydown',onKeyDown,true);
    window.removeEventListener('resize',onCloseOnly,true);
    window.removeEventListener('scroll',onScrollClose,true);
    document.removeEventListener('pointermove',onDocMove,true);
    document.removeEventListener('mouseleave',onDocLeave,true);
  }
  function onCloseOnly(){ closePop(false); }
  /* Inner list scrolls bubble to window: only an OUTER scroll closes */
  function onScrollClose(e){ if(popEl && e.target && !popEl.contains(e.target)) closePop(false); }
  /* Hover closes only once the cursor has truly left BOTH the control
     and the list (pointermove-based check, with a small grace period).
     Replaces the old :hover polling that raced sibling-control gaps. */
  function schedHoverClose(){ maybeCloseSoon(); }
  function onDocDown(e){
    if(!openWrap) return;
    if(openWrap.contains(e.target)) return;
    if(popEl && popEl.contains(e.target)) return;
    closePop(false);
  }
  function onKeyDown(e){
    if(!openWrap || !popEl) return;
    /* Never steal keys from real fields: while typing in an input,
       textarea or select (e.g. a modal form under a stuck hover popover),
       only Escape may act — arrows/space/enter stay with the field. */
    const tag=(e.target&&e.target.tagName)||"";
    if(tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT"){ if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); closePop(true); } return; }
    if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); closePop(true); }
    else if(e.key==='ArrowDown'){ e.preventDefault(); e.stopPropagation(); setHi(hiIdx+1); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); e.stopPropagation(); setHi(hiIdx-1); }
    else if(e.key==='Enter'||e.key===' '){ const rs=rows(); if(rs.length && hiIdx>=0){ e.preventDefault(); e.stopPropagation(); rs[hiIdx].click(); } }
    else if(e.key==='Tab'){ closePop(false); }
  }
  function labelOf(sel){
    const o=sel.options[sel.selectedIndex];
    const t=o ? o.textContent : '';
    /* Setup context display (user order): short names on the bar —
       "Global" for the empty value, bare name for class/batch
       ("1212", never "Class: 1212"). Options keep full labels. */
    if(sel&&sel.id==="calClassSelect"){
      if(!o||!sel.value) return "Global";
      return String(t).replace(/^(Class|Batch):\s*/,"").trim()||t;
    }
    return t;
  }
  function pick(sel,btn,v){
    if(sel.value!==v){ sel.value=v; try{ sel.dispatchEvent(new Event('change',{bubbles:true})); }catch(e){ const ev=document.createEvent('HTMLEvents'); ev.initEvent('change',true,false); sel.dispatchEvent(ev); } }
    syncBtn(sel,btn); closePop(false); try{ btn.focus(); }catch(e){}
  }
  function syncBtn(sel,btn){
    const lab=btn.querySelector('.gsel-lab'); if(lab) lab.textContent=labelOf(sel);
    btn.disabled=!!sel.disabled;
    try{ btn.classList.toggle("set",sel.selectedIndex>0); }catch(e){}
  }
  function openPop(wrap,sel,btn){
    /* Sibling-switch reuse: if a sidebar gsel popup is already open
       and the new control is also in the sidebar, reuse the same
       surface (no destroy/recreate) so the rail-reveal animation can
       run a fresh transition without a flicker. Falls back to a
       full close+reopen otherwise. */
    const newInRail=!!(wrap.closest&&wrap.closest('#adminSide'));
    const oldInRail=!!(openWrap&&openWrap.closest&&openWrap.closest('#adminSide'));
    if(popEl && openWrap && newInRail && oldInRail && popEl.parentNode===document.body){
      /* Tear down the old open state without removing popEl, rebuild
         options, re-place, re-reveal. */
      openWrap.classList.remove('open');
      const oldBtn=openWrap.querySelector('.gsel-btn');
      if(oldBtn) oldBtn.setAttribute('aria-expanded','false');
      openWrap=wrap; wrap.classList.add('open'); btn.setAttribute('aria-expanded','true');
      popEl.innerHTML="";
      buildGselOptions(popEl, sel, btn);
      placeGsel(popEl, wrap);
      scrollSelIntoView(popEl);
      if(newInRail) _revealFromRail(popEl);
      return;
    }
    closePop(false);
    openWrap=wrap; wrap.classList.add('open'); btn.setAttribute('aria-expanded','true');
    popEl=document.createElement('div'); popEl.className='gsel-pop'; popEl.setAttribute('role','listbox');
    buildGselOptions(popEl, sel, btn);
    document.body.appendChild(popEl);
    popEl.addEventListener('mouseleave',schedHoverClose);
    popEl.addEventListener('mouseenter',cancelClose);
    /* Marks real typing in the search field. input bubbles, so this covers the
       field without buildGselOptions knowing about hover behaviour; the flag
       lives on the freshly created popEl, so it resets on every open. */
    popEl.addEventListener('input',()=>{ popEl.__typing=true; });
    placeGsel(popEl, wrap);
    scrollSelIntoView(popEl);
    try{ const si=popEl.querySelector(".gsel-search input"); if(si) si.focus({preventScroll:true}); }catch(e){}
    if(newInRail) _revealFromRail(popEl);
    document.addEventListener('pointerdown',onDocDown,true);
    document.addEventListener('keydown',onKeyDown,true);
    document.addEventListener('pointermove',onDocMove,true);
    document.addEventListener('mouseleave',onDocLeave,true);
    window.addEventListener('resize',onCloseOnly,true);
    window.addEventListener('scroll',onScrollClose,true);
  }
  function buildGselOptions(popEl, sel, btn){
    /* Pop tags its source select (user order): lets CSS pin one
       dropdown's overlay without touching the shared pop. */
    try{ if(sel&&sel.id) popEl.dataset.for=sel.id; }catch(e){}
    /* Grouped single column (popups spec): every optgroup renders its
       header row followed by plain option rows — generic and schedule
       selects alike. */
    const sched = sel && sel.id==="calClassSelect";
    if(sched) popEl.classList.add("gsel-sched");
    const attPop = sel&&(sel.id==="attClassFilter"||sel.id==="attBatchFilter");
    /* Attendance filter dropdowns (user order): student count on every row.
       The filter line past 8 options is shared with the schedule scope
       popup, which also hides emptied group headers while filtering. */
    let attCount=null;
    if(attPop){
      attCount=(v)=>{
        if(!v) return (Students||[]).length;
        if(sel.id==="attClassFilter") return Students.filter(s=>s.class===v).length;
        return Students.filter(s=>(s.batch||"")===v).length;
      };
    }
    if(attPop||sched){
      const nOpts=Array.from(sel.querySelectorAll("option")).length;
      if(nOpts>8){
        const box=document.createElement("div"); box.className="gsel-search";
        const inp=document.createElement("input"); inp.type="text"; inp.placeholder=sched?"Search schedule…":"Search"; inp.setAttribute("aria-label",sched?"Search schedule":"Search options");
        inp.addEventListener("input",()=>{
          const q=inp.value.trim().toLowerCase();
          popEl.querySelectorAll(".gsel-opt").forEach(r=>{
            const hit=!q||(r.textContent||"").toLowerCase().includes(q);
            r.style.display=hit?"":"none";
            if(hit) r.removeAttribute("aria-disabled"); else r.setAttribute("aria-disabled","true");
          });
          popEl.querySelectorAll(".gsel-grp").forEach(g=>{
            let n=g.nextElementSibling, any=false;
            while(n&&!n.classList.contains("gsel-grp")){
              if(n.classList.contains("gsel-opt")&&n.style.display!=="none"){ any=true; break; }
              n=n.nextElementSibling;
            }
            g.style.display=any?"":"none";
          });
        });
        box.appendChild(inp); popEl.appendChild(box);
      }
    }
    Array.from(sel.children).forEach(ch=>{
      if(ch.tagName==='OPTGROUP'){
        const g=document.createElement('div'); g.className='gsel-grp'; g.textContent=ch.label||''; popEl.appendChild(g);
        Array.from(ch.children).forEach(o=>{ if(o.tagName==='OPTION') addGselOpt(popEl,o,sel,btn,attCount); });
      }else if(ch.tagName==='OPTION'){
        addGselOpt(popEl,ch,sel,btn,attCount);
      }
    });
  }
  function addGselOpt(popEl, o, sel, btn, attCount){
    const r=document.createElement('div'); r.className='gsel-opt'; r.setAttribute('role','option');
    const t=document.createElement('span'); t.className='opt-t'; t.textContent=o.textContent; r.appendChild(t); r.dataset.v=o.value;
    if(typeof attCount==="function"){ const sm=document.createElement("small"); sm.textContent=attCount(o.value); r.appendChild(sm); }
    if(o.disabled){ r.setAttribute('aria-disabled','true'); return; }
    if(o.value===sel.value){ r.classList.add('sel'); r.setAttribute('aria-selected','true'); }
    r.addEventListener('click',()=>pick(sel,btn,o.value));
    popEl.appendChild(r);
    return r;
  }
  function placeGsel(popEl, wrap){
    const rc=wrap.getBoundingClientRect();
    const _attPop=popEl.dataset&&popEl.dataset.for&&(popEl.dataset.for==="attClassFilter"||popEl.dataset.for==="attBatchFilter");
    popEl.style.minWidth=Math.max(_attPop?260:rc.width,140)+'px';
    popEl.style.maxWidth=Math.max(140,window.innerWidth-16)+'px';
    const h=Math.min(popEl.classList.contains('gsel-sched')?400:(_attPop?320:260),popEl.offsetHeight||260);
    const railEl=(wrap.closest&&wrap.closest('#adminSide'))||null;
    let left=rc.left;
    let inRail=false;
    if(railEl){
      const rr=railEl.getBoundingClientRect();
      const railLeft=Math.max(0,rr.left);
      const gap=8;
      inRail=true;
      left=Math.max(8,railLeft-gap-popEl.offsetWidth);
      if(left+popEl.offsetWidth>window.innerWidth-8) left=Math.max(8,window.innerWidth-popEl.offsetWidth-8);
      popEl._triggerY=rc.top+rc.height/2;
    }else{
      /* Scope popover (popups spec): fixed 340px, right-aligned under
         the control, then the same viewport clamp. */
      if(popEl.classList.contains("gsel-sched")){
        const w=popEl.offsetWidth||340;
        left=rc.right-w;
        if(left+popEl.offsetWidth>window.innerWidth-8) left=Math.max(8,window.innerWidth-8-popEl.offsetWidth);
        if(left<8) left=8;
      }
      if(left+popEl.offsetWidth>window.innerWidth-8) left=Math.max(8,rc.right-popEl.offsetWidth);
      try{ delete popEl._triggerY; }catch(e){ try{ popEl._triggerY=null; }catch(_){} }
    }
    let top=rc.bottom+8;
    if(inRail){
      const desired=Math.round(rc.top+(rc.height-h)/2);
      top=Math.max(8,Math.min(desired,window.innerHeight-h-8));
    }else if(top+h>window.innerHeight-8){
      top=Math.max(8,rc.top-8-h);
    }
    /* Modal-footer awareness (user order): a dropdown opening downward
       over the modal's ✕/✓ row flips up when the card has room above —
       same rule for every modal select. Viewport logic above keeps
       final say when neither fits. */
    if(!inRail){ try{
      const card=wrap.closest&&wrap.closest('.mod');
      if(card){ const cr=card.getBoundingClientRect(); if(top+h>cr.bottom-8){ const up=Math.round(rc.top-4-h); if(up>=Math.max(8,cr.top)) top=up; } }
    }catch(_){} }
    /* Backup-card awareness (vault): inside #backupManagerCard the
       Frequency sheet prefers UP whenever it fits above the field,
       so it never covers the commit bar — viewport logic above keeps
       final say when neither side fits. */
    if(!inRail){ try{
      const bc=wrap.closest&&wrap.closest('#backupManagerCard');
      if(bc){ const br=bc.getBoundingClientRect(); const up=Math.round(rc.top-4-h); if(up>=br.top-8) top=up; }
    }catch(_){} }
    popEl.style.top=top+'px'; popEl.style.left=Math.max(8,left)+'px';
  }
  function scrollSelIntoView(popEl){
    hiIdx=Array.from(popEl.querySelectorAll('.gsel-opt:not([aria-disabled="true"])'))
      .findIndex(r=>r.classList.contains('sel'));
    if(hiIdx<0) hiIdx=0;
    const rs=Array.from(popEl.querySelectorAll('.gsel-opt'));
    rs.forEach((r,j)=>r.classList.toggle('hi',j===hiIdx));
    const cur=rs[hiIdx]; if(cur){ try{cur.scrollIntoView({block:'nearest'});}catch(e){} }
  }
  function enhance(sel){
    if(!sel||sel.tagName!=='SELECT'||sel.dataset.gsel) return;
    if(sel.id==='attDatePreset') return; /* segmented strip owns this one */
    sel.dataset.gsel='1';
    const wrap=document.createElement('span'); wrap.className='gsel';
    try{
      if(sel.style.width) wrap.style.width=sel.style.width;
      if(sel.style.maxWidth) wrap.style.maxWidth=sel.style.maxWidth;
      ['height','minHeight','padding','border','background','fontSize','borderRadius','outline'].forEach(k=>{ sel.style[k]=''; });
    }catch(e){}
    if(sel.closest && sel.closest('.fld')) wrap.classList.add('gsel-form');
    sel.parentNode.insertBefore(wrap,sel); wrap.appendChild(sel);
    try{ sel.tabIndex=-1; sel.setAttribute('aria-hidden','true'); }catch(e){}
    const btn=document.createElement('button'); btn.type='button'; btn.className='gsel-btn';
    btn.setAttribute('aria-haspopup','listbox'); btn.setAttribute('aria-expanded','false');
    const lab=document.createElement('span'); lab.className='gsel-lab'; btn.appendChild(lab);
    const ch=document.createElement('span'); ch.className='gsel-chev'; ch.textContent='\u25BE'; btn.appendChild(ch);
    wrap.appendChild(btn);
    const sync=()=>syncBtn(sel,btn); sel.addEventListener('change',sync); sync();
    try{ new MutationObserver(sync).observe(sel,{childList:true}); }catch(e){}
    /* Hover owns open/close outside modals (click toggle retired —
       it fought the hover); modal dropdowns are click-to-toggle
       instead (user order — hover fired while reaching across small
       modals like holiday Type). The Setup scope control is also
       click-to-toggle (user order): it must stay shut on hover and
       open only when clicked. Keyboard Enter/Space/Arrows still
       open for accessibility everywhere. */
    const modalClick=sel.closest&&sel.closest('.mod');
    const clickOpen=modalClick||(sel&&sel.id==="calClassSelect");
    if(clickOpen){
      btn.addEventListener('click',(e)=>{ if(sel.disabled) return; e.stopPropagation(); if(openWrap===wrap) closePop(false); else openPop(wrap,sel,btn); });
    }else{
      wrap.addEventListener('mouseenter',()=>{ if(sel.disabled) return; cancelClose(); if(openWrap!==wrap) openPop(wrap,sel,btn); });
      wrap.addEventListener('mouseleave',schedHoverClose);
    }
    btn.addEventListener('mouseenter',cancelClose);
    btn.addEventListener('focus',cancelClose);
    btn.addEventListener('keydown',(e)=>{
      if(sel.disabled) return;
      if(e.key==='ArrowDown'||e.key==='ArrowUp'||e.key==='Enter'||e.key===' '){ e.preventDefault(); if(openWrap!==wrap) openPop(wrap,sel,btn); }
    });
  }
  function enhanceAll(root){
    try{ (root||document).querySelectorAll('select').forEach(enhance); }catch(e){}
  }
  /* Repair hook (user order): if a select somehow missed enhancement
     (or lost its wrap), re-run it — used by late-shown panes. */
  try{
    window.__ensureGsel=function(sel){
      if(!sel||sel.tagName!=='SELECT') return;
      const w=sel.parentNode;
      if(w&&w.classList&&w.classList.contains('gsel')&&w.querySelector(':scope > .gsel-btn')) return;
      try{ delete sel.dataset.gsel; }catch(e){ try{sel.removeAttribute('data-gsel');}catch(_){} }
      enhance(sel);
    };
    /* Escape hatch for modal open: drop any stuck popover (and its
       document key/pointer handlers) so typing in a form always wins. */
    window.__closeGselPop=function(){ try{ closePop(false); }catch(e){} };
  }catch(e){}
  enhanceAll(document);
  try{
    new MutationObserver((muts)=>{
      muts.forEach(m=>{ m.addedNodes.forEach(n=>{ if(!n||!n.querySelectorAll) return; if(n.tagName==='SELECT') enhance(n); enhanceAll(n); }); });
    }).observe(document.body,{childList:true,subtree:true});
  }catch(e){}
})();
/* Attendance preset cubes — visual layer over #attDatePreset (truth),
   now living in the main panel above the KPI strip (rail strip retired).
   Same flow as before: set value, clear year unless academic, render,
   dispatch change. Reveal inputs + APPLY live in #attRevealRow and are
   shown/hidden by renderAttendance; Clear pair runs the section reset. */
(function(){
  function sync(){
    const sel=document.getElementById("attDatePreset"); if(!sel) return;
    document.querySelectorAll('#attPresetRow .att-cube[data-v]').forEach(b=>{
      const on=(b.dataset.v===sel.value);
      b.classList.toggle("on",on);
      b.setAttribute("aria-pressed",on?"true":"false");
    });
  }
  function build(){
    const sel=document.getElementById("attDatePreset"); if(!sel||sel.dataset.cubes) return;
    sel.dataset.cubes="1";
    document.querySelectorAll('#attPresetRow .att-cube[data-v]').forEach(b=>{
      b.addEventListener("click",()=>{
        const v=b.dataset.v;
        if(sel.value!==v){
          sel.value=v;
          /* Drive the flow through the change event alone (single render —
             no direct call: it rendered twice and raced the fetch) */
          try{
            if(v!=="academic"){ attAcadFrom=attAcadTo=null; }
          }catch(e){}
          try{ sel.dispatchEvent(new Event("change",{bubbles:true})); }catch(e){ try{ const ev=document.createEvent("HTMLEvents"); ev.initEvent("change",true,false); sel.dispatchEvent(ev); }catch(_){} }
        }
        /* Custom cubes open their anchored calendar popup (tap, never
           hover); Academic Year opens the year-range popup the same
           way. Every other preset shuts any open popup. Re-tapping
           the active popup preset reopens its popup. */
        try{
          if(v==="custom_day") openDayPop(b);
          else if(v==="custom_range") openRangePop(b);
          else if(v==="academic") openAcadPop(b);
          else closeDtPops();
        }catch(e){ console.error(e); }
        sync();
      });
    });
    const clr=()=>{ try{ clearAttendanceSection(); }catch(e){ console.error(e); } };
    const cb=document.getElementById("attClearBrick"); if(cb) cb.addEventListener("click",clr);
    sel.addEventListener("change",sync); sync();
  }
  if(document.readyState==="loading"){ document.addEventListener("DOMContentLoaded",build); } else { build(); }
})();
/* Academic-year + custom-range frost popups for the preset strip.
   Year spans anchor to Settings.startDate month/day (no invented
   cutoffs); range Apply auto-orders. Both write through the existing
   custom_range machinery (attFromDate/attToDate + renderAttendance). */
function _pad2(n){ return (n<10?"0":"")+n; }
function _iso(y,m,d){ return y+"-"+_pad2(m)+"-"+_pad2(d); }
function _fmtShort(iso){ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||""); if(!m) return iso||"—"; return (+m[3])+" "+MONTHS_S[+m[2]-1]+" "+m[1]; }
function _dtShell(){
  closeDtPops();
  const box=document.createElement("div"); box.className="dt-pop"; box.setAttribute("role","dialog");
  box.id="dtRangeAcadPop";
  document.body.appendChild(box);
  return box;
}
let _dtOpenFor=null;
let _dtCloseT=null, _dtLastX=-1, _dtLastY=-1;
function _dtCancelClose(){ if(_dtCloseT){ clearTimeout(_dtCloseT); _dtCloseT=null; } }
function _dtInAnchorOrBox(x,y){
  const box=document.getElementById("dtRangeAcadPop");
  if(!box) return false;
  const a=box._dtAnchor;
  if(a){
    const ar=a.getBoundingClientRect();
    if(x>=ar.left-1 && x<=ar.right+1 && y>=ar.top-1 && y<=ar.bottom+1) return true;
  }
  const br=box.getBoundingClientRect();
  return (x>=br.left-1 && x<=br.right+1 && y>=br.top-1 && y<=br.bottom+1);
}
function _dtMaybeCloseSoon(){
  _dtCancelClose();
  _dtCloseT=setTimeout(()=>{
    _dtCloseT=null;
    if(_dtInAnchorOrBox(_dtLastX,_dtLastY)) return;
    closeDtPops();
  },180);
}
function _dtDocMove(e){ _dtLastX=e.clientX; _dtLastY=e.clientY; }
/* Restore the seg-strip's natural .active state (mirrors the strip's
   own sync(): active = selected preset). Called when an owned popup
   closes so the opener row releases its reveal marker. */
function _clearRevealingSegs(){
  try{
    const sel=document.getElementById("attDatePreset");
    const cur=sel?sel.value:"";
    document.querySelectorAll(".seg-strip .seg-btn[data-v]").forEach(b=>{
      const on=(b.dataset.v===cur);
      b.classList.toggle("active",on);
      b.setAttribute("aria-pressed",on?"true":"false");
    });
  }catch(e){}
}
function closeDtPops(){
  _dtCancelClose();
  _dtOpenFor=null;
  _clearRevealingSegs();
  const old=document.getElementById("dtRangeAcadPop"); if(old){ try{old.remove();}catch(e){} }
  document.removeEventListener("pointerdown",_dtDocDown,true);
  document.removeEventListener("keydown",_dtKey,true);
  window.removeEventListener("scroll",_dtScroll,true);
  window.removeEventListener("resize",_dtFollowOrClose);
  if(typeof _dtCloseOpts==="function"){ const f=_dtCloseOpts; _dtCloseOpts=null; try{f();}catch(e){} }
}
let _dtCloseOpts=null;
function _dtDocDown(e){ const box=document.getElementById("dtRangeAcadPop"); if(box&&!box.contains(e.target)&&!(box._dtAnchor&&box._dtAnchor.contains&&box._dtAnchor.contains(e.target))) closeDtPops(); }
function _dtKey(e){ if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); closeDtPops(); } }
/* Stay-open parity with the gsel dropdowns: a scroll/resize re-anchors
   the popup to its (possibly re-rendered) trigger instead of killing it.
   Only a detached-or-hidden anchor still closes. */
function _dtLiveAnchor(box){
  const a=box&&box._dtAnchor;
  if(a&&a.isConnected) return a;
  try{ const sel=document.getElementById("sdDatePreset"); const wrap=sel&&sel.closest&&sel.closest(".gsel"); const btn=wrap&&wrap.querySelector(".gsel-btn"); if(btn&&btn.isConnected) return btn; if(sel&&sel.isConnected){ try{ const r=sel.getBoundingClientRect(); if(r.width>0||r.height>0) return sel; }catch(_){} } }catch(e){}
  return null;
}
function _dtFollowOrClose(){
  const box=document.getElementById("dtRangeAcadPop"); if(!box) return;
  const a=_dtLiveAnchor(box);
  if(a){ try{ const r=a.getBoundingClientRect(); if(r.width>0||r.height>0){ box._dtAnchor=a; _dtPlace(box,a); return; } }catch(e){} }
  closeDtPops();
}
function _dtScroll(e){ const box=document.getElementById("dtRangeAcadPop"); if(box&&box.contains(e.target)) return; _dtFollowOrClose(); }
function _dtPlace(box,anchor){
  let _anchor=anchor;
  if(!_anchor || !_anchor.isConnected){ try{ const sel=document.getElementById("sdDatePreset"); const wrap=sel&&sel.closest&&sel.closest(".gsel"); const btn=wrap&&wrap.querySelector(".gsel-btn"); if(btn) _anchor=btn; }catch(e){} }
  if(box) box._dtAnchor=_anchor;
  /* Prefer a live measurement: if the detail panel re-rendered between
     open and place, the anchor is detached (measures 0,0 and drops the
     calendar at the top-left) — use the rect captured at open instead. */
  let r=null;
  try{ r=(_anchor&&_anchor.isConnected&&_anchor.getBoundingClientRect)?_anchor.getBoundingClientRect():null; }catch(e){ r=null; }
  if(!r||(r.width===0&&r.height===0)) r=(box&&box._rect)||{left:8,top:8,right:8,bottom:8,width:0,height:0};
  box.style.visibility="hidden"; box.style.left="0px"; box.style.top="0px";
  const w=box.offsetWidth,h=box.offsetHeight,vw=window.innerWidth,vh=window.innerHeight;
  /* Sidebar-anchored Academic Year / Custom Range: dock the popup's
     right edge to the rail's left edge (8px gap) so it opens LEFT
     into the workspace. Center vertically on the trigger so the
     picker feels anchored to its control, not dropped from above. */
  let railLeft=0;
  try{ const rail=document.getElementById("adminSide"); if(rail){ const rr=rail.getBoundingClientRect(); if(rr&&rr.width>0) railLeft=Math.max(0,rr.left); } }catch(e){}
  const inRail=(r&&r.width>0&&!!(_anchor && _anchor.closest && _anchor.closest('#adminSide'))&&r.right<=railLeft+260);
  let left;
  if(inRail){
    /* Modestly larger surface so the calendar reads easier; restrained
       bump only — does not dominate the workspace. */
    if(box.classList.contains("dt-pop") && !box.dataset.sized){
      box.style.minWidth="296px";
      box.dataset.sized="1";
    }
    left=Math.max(8,railLeft-8-w);
    if(left+w>vw-8) left=Math.max(8,vw-w);
    box._triggerY=r.top+r.height/2;
  }else{
    left=Math.min(Math.max(8,r.left),Math.max(8,vw-w-8));
    try{ delete box._triggerY; }catch(e){ try{ box._triggerY=null; }catch(_){} }
  }
  let top;
  if(inRail){
    const desired=Math.round(r.top+(r.height-h)/2);
    top=Math.max(8,Math.min(desired,vh-h-8));
  }else{
    top=r.bottom+6; if(top+h>vh-8) top=Math.max(8,r.top-h-6);
  }
  box.style.left=left+"px"; box.style.top=top+"px"; box.style.visibility="";
  /* Anchored tail (day-bubble language): a sharp apex at the anchor's
     horizontal center, pointing up when the popup sits below the cube
     and down when flipped above. Rail-docked popups keep no tail. */
  try{
    if(!inRail && _anchor && _anchor.getBoundingClientRect){
      let tail=null;
      try{ tail=box.querySelector(":scope > .dt-tail"); }catch(_){ tail=null; }
      if(!tail){ tail=document.createElement("div"); tail.className="dt-tail"; tail.setAttribute("aria-hidden","true"); box.appendChild(tail); }
      const bw=box.offsetWidth||0;
      const cx=Math.round(r.left+r.width/2-left);
      tail.style.left=Math.max(20,Math.min(Math.max(20,bw-20),cx))+"px";
      const below=(top>=r.bottom-2);
      tail.classList.toggle("tail-up",below);
      tail.classList.toggle("tail-down",!below);
    }
  }catch(e){}
  if(inRail) _revealFromRail(box);
}
function _dtWire(box,anchor){
  _dtPlace(box,anchor);
  document.addEventListener("pointerdown",_dtDocDown,true);
  document.addEventListener("keydown",_dtKey,true);
  window.addEventListener("scroll",_dtScroll,true);
  window.addEventListener("resize",_dtFollowOrClose);
  /* No hover dismissal (parity with the class/batch popups, which close
     only on outside click): moving the cursor across the calendar must
     never close it. Dismissal is outside-pointerdown, Escape, scroll/
     resize follow, or explicit Apply/Cancel/Clear. */
  try{
    if(anchor && anchor.addEventListener){
      /* Reveal marker: the owning row borrows the strip's existing
         .active treatment (opposite-pole 500) so trigger and popup
         read as one unit. Siblings release theirs, so exactly one
         row reads as the source. closeDtPops restores sync state. */
      if(anchor.classList && anchor.classList.contains("seg-btn")){
        _clearRevealingSegs();
        try{
          const strip=anchor.closest?anchor.closest(".seg-strip"):null;
          if(strip) strip.querySelectorAll(".seg-btn[data-v]").forEach(b=>{
            if(b!==anchor){ b.classList.remove("active"); b.setAttribute("aria-pressed","false"); }
          });
        }catch(e){}
        anchor.classList.add("active");
        anchor.setAttribute("aria-pressed","true");
      }
    }
  }catch(e){}
}
function _dtCommitPreset(v){
  /* Arm the hidden preset select so renderAttendance honors the pick,
     then fire change so the existing reveal/sync/render flow runs. */
  try{
    const sel=document.getElementById("attDatePreset");
    if(sel){
      if(sel.value!==v) sel.value=v;
      try{ sel.dispatchEvent(new Event("change",{bubbles:true})); }
      catch(e){ try{ const ev=document.createEvent("HTMLEvents"); ev.initEvent("change",true,false); sel.dispatchEvent(ev); }catch(_){} }
    }
  }catch(e){}
}
function acadYearOptions(){
  const out=[];
  const m=/^(\d{4})/.exec((typeof Settings!=="undefined"&&Settings&&Settings.academicYear)||"");
  const y0=m?+m[1]:new Date().getFullYear();
  const sm=/^(\d{4})-(\d{2})-(\d{2})$/.exec((typeof Settings!=="undefined"&&Settings&&Settings.startDate)||"");
  const mo=sm?+sm[2]:8, dy=sm?+sm[3]:14;
  for(let y=y0;y>y0-3;y--){
    const e=new Date(y+1,mo-1,dy); e.setDate(e.getDate()-1);
    out.push({label:y+"–"+String(y+1).slice(2),from:_iso(y,mo,dy),to:_iso(e.getFullYear(),e.getMonth()+1,e.getDate())});
  }
  return out;
}
function openAcadPop(anchor){
  const key="A:"+((anchor&&anchor.dataset&&anchor.dataset.v)||"");
  if(_dtOpenFor===key) return; _dtOpenFor=key;
  const box=_dtShell(); box._dtAnchor=anchor;
  const head=document.createElement("div"); head.className="dt-head";
  const title=document.createElement("div"); title.className="dt-title"; title.textContent="Academic year";
  head.appendChild(title); box.appendChild(head);
  const curLbl=String((typeof Settings!=="undefined"&&Settings&&Settings.academicYear)||"");
  acadYearOptions().forEach(opt=>{
    const b=document.createElement("button"); b.type="button"; b.className="dt-acad-btn";
    const cur=(attAcadFrom===opt.from&&attAcadTo===opt.to)||(!attAcadFrom&&curLbl.indexOf(String(opt.label).slice(0,4))===0);
    if(cur) b.classList.add("sel");
    const m1=document.createElement("span"); m1.className="dt-acad-main"; m1.textContent=opt.label;
    const m2=document.createElement("span"); m2.className="dt-acad-sub"; m2.textContent=_fmtShort(opt.from)+" → "+_fmtShort(opt.to);
    b.appendChild(m1); b.appendChild(m2);
    b.addEventListener("click",()=>{ attAcadFrom=opt.from; attAcadTo=opt.to; _dtCommitPreset("academic"); try{renderAttendance();}catch(e){ console.error(e); } closeDtPops(); });
    box.appendChild(b);
  });
  const foot=document.createElement("div"); foot.className="dt-foot";
  const clear=document.createElement("button"); clear.type="button"; clear.className="dt-glyph dt-clear"; clear.setAttribute("aria-label","Clear"); clear.textContent="Clear";
  clear.addEventListener("click",()=>{ attAcadFrom=attAcadTo=null; try{renderAttendance();}catch(e){ console.error(e); } closeDtPops(); });
  const done=document.createElement("button"); done.type="button"; done.className="dt-glyph go"; done.setAttribute("aria-label","Done"); done.textContent="Done";
  done.addEventListener("click",closeDtPops);
  foot.appendChild(clear); foot.appendChild(done); box.appendChild(foot);
  _dtWire(box,anchor);
}
/* Dot logic (user order): a day earns a dot only for real scan activity —
   Present / Late / Duplicate (flag or status). Auto-marked Absent,
   Not Scheduled, and Unknown-only days stay dotless. */
function _scanDays(src){
  const s=new Set();
  try{ (src||[]).forEach(a=>{ if(!a||!a.date) return;
    if(a.status==="Present"||a.status==="Late"||a.status==="Duplicate"||a.isDuplicate) s.add(a.date); }); }catch(e){}
  return s;
}
function _monthGrid(box,label,view,onPick,isSel,isMid){
  if(label){ const sec=document.createElement("div"); sec.className="dt-sec"; sec.textContent=label; box.appendChild(sec); }
  const head=document.createElement("div"); head.className="dt-head";
  const title=document.createElement("div"); title.className="dt-title";
  const nav=document.createElement("div"); nav.className="dt-nav";
  const prev=document.createElement("button"); prev.type="button"; prev.textContent="Prev"; prev.setAttribute("aria-label","Previous month");
  const next=document.createElement("button"); next.type="button"; next.textContent="Next"; next.setAttribute("aria-label","Next month");
  nav.appendChild(prev); nav.appendChild(next); head.appendChild(title); head.appendChild(nav); box.appendChild(head);
  const grid=document.createElement("div"); grid.className="dt-grid"; box.appendChild(grid);
  let _recDays=new Set();
  function draw(){
    title.textContent=MONTHS_L[view.m]+" "+view.y;
    grid.innerHTML="";
    try{ const src=(typeof AllEvents!=="undefined"&&AllEvents&&AllEvents.length)?AllEvents:((typeof Attendance!=="undefined")?Attendance:[]); _recDays=_scanDays(src); }catch(e){ _recDays=new Set(); }
    ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].forEach(d=>{ const s=document.createElement("div"); s.className="dt-dow"; s.textContent=d; grid.appendChild(s); });
    const first=new Date(view.y,view.m,1).getDay(), dim=new Date(view.y,view.m+1,0).getDate();
    for(let i=0;i<first;i++){ const g=document.createElement("span"); g.className="dt-day hide"; g.setAttribute("aria-hidden","true"); grid.appendChild(g); }
    for(let d=1;d<=dim;d++) addDay(d);
    const tail=(7-((first+dim)%7))%7;
    for(let d=1;d<=tail;d++){ const g=document.createElement("span"); g.className="dt-day hide"; g.setAttribute("aria-hidden","true"); grid.appendChild(g); }
  }
  function addDay(d){
    const b=document.createElement("button"); b.type="button"; b.className="dt-day";
    const lb=document.createElement("span"); lb.textContent=d; b.appendChild(lb);
    const dt=new Date(view.y,view.m,d);
    const iso=_iso(dt.getFullYear(),dt.getMonth()+1,dt.getDate());
    if(isSel(iso)) b.classList.add("sel");
    else if(isMid&&isMid(iso)){
      b.classList.add("in");
      const _plus=n=>{ const x=new Date(dt); x.setDate(x.getDate()+n); return _iso(x.getFullYear(),x.getMonth()+1,x.getDate()); };
      const _isW=s=>{ try{ return !!(isMid&&isMid(s)); }catch(e){ return false; } };
      const _col=dt.getDay();
      if(_col>0&&_isW(_plus(-1)))b.classList.add("bl");
      if(_col<6&&_isW(_plus(1)))b.classList.add("br");
      if(_isW(_plus(-7)))b.classList.add("bt");
      if(_isW(_plus(7)))b.classList.add("bb");
    }
    const dot=document.createElement("i"); dot.className="dt-dot"; dot.setAttribute("aria-hidden","true");
    try{ dot.classList.toggle("off",!(_recDays&&_recDays.has(iso))); }catch(e){ dot.classList.add("off"); }
    b.appendChild(dot);
    b.addEventListener("click",()=>{ onPick(iso); });
    grid.appendChild(b);
  }
  grid.addEventListener("keydown",(e)=>{
    if(e.key!=="ArrowRight"&&e.key!=="ArrowLeft"&&e.key!=="ArrowDown"&&e.key!=="ArrowUp") return;
    const btns=Array.from(grid.querySelectorAll("button"));
    const cur=btns.indexOf(document.activeElement);
    if(cur<0) return;
    e.preventDefault();
    const d=(e.key==="ArrowRight")?1:(e.key==="ArrowLeft")?-1:(e.key==="ArrowDown")?7:-7;
    const nx=btns[(cur+d+btns.length)%btns.length];
    if(nx) nx.focus();
  });
  /* Month nav holds to repeat (user order): tap steps one month, holding
     runs through the years. Created once, outside draw(), so pointer
     capture survives each grid repaint. */
  holdRepeat(prev,()=>{ view.m--; if(view.m<0){view.m=11;view.y--;} draw(); });
  holdRepeat(next,()=>{ view.m++; if(view.m>11){view.m=0;view.y++;} draw(); });
  draw();
  return draw;
}
function openRangePop(anchor, opts){
  const key="R:"+((opts&&opts.key)||((anchor&&anchor.dataset&&anchor.dataset.v)||""));
  if(_dtOpenFor===key) return; _dtOpenFor=key;
  const t=new Date();
  let from=(opts&&opts.from)||(typeof attFromDate!=="undefined"&&attFromDate&&attFromDate.value)||"", to=(opts&&opts.to)||(typeof attToDate!=="undefined"&&attToDate&&attToDate.value)||"";
  let pickingTo=!!(from&&!to);
  let _applied=false;
  _dtCloseOpts=(typeof opts==="object"&&opts&&typeof opts.onCancel==="function")?function(){ if(!_applied){ try{opts.onCancel();}catch(e){} } }:null;
  const box=_dtShell(); box._dtAnchor=anchor; box.classList.add("cal");
  if(opts&&opts._rect) box._rect=opts._rect;
  const head=document.createElement("div"); head.className="dt-head";
  const title=document.createElement("div"); title.className="dt-title"; title.textContent="Custom range";
  head.appendChild(title); box.appendChild(head);
  const hint=document.createElement("div"); hint.className="dt-sec dt-hint"; hint.style.marginTop="0";
  box.appendChild(hint);
  const base=from||_iso(t.getFullYear(),t.getMonth()+1,t.getDate());
  const bm=/^(\d{4})-(\d{2})-(\d{2})$/.exec(base)||[0,t.getFullYear(),t.getMonth()+1,t.getDate()];
  const view={y:+bm[1],m:+bm[2]-1};
  function paintHint(){
    hint.textContent=!from?"Tap the start day":(!to?"Tap the end day":_fmtShort(from)+" → "+_fmtShort(to));
  }
  const inSel=iso=>((from&&iso===from)||(to&&iso===to));
  const inMid=iso=>{ if(!from||!to||from===to) return false; const lo=from<to?from:to, hi=from<to?to:from; return iso>lo&&iso<hi; };
  const redraw=_monthGrid(box,"",view,iso=>{
    if(!pickingTo){ from=iso; to=""; pickingTo=true; }
    else { to=iso; if(from>to){ const x=from; from=to; to=x; } pickingTo=false; }
    paintHint(); redraw();
  },inSel,inMid);
  paintHint();
  const foot=document.createElement("div"); foot.className="dt-foot";
  const clear=document.createElement("button"); clear.type="button"; clear.className="dt-glyph"; clear.setAttribute("aria-label","Clear"); clear.textContent="Clear";
  clear.addEventListener("click",()=>{
    from=""; to=""; pickingTo=false;
    try{ if(opts&&typeof opts.onClear==="function") opts.onClear(); else { if(attFromDate)attFromDate.value=""; if(attToDate)attToDate.value=""; renderAttendance(); } }catch(e){ console.error(e); }
    paintHint(); redraw();
  });
  const apply=document.createElement("button"); apply.type="button"; apply.className="dt-glyph go"; apply.setAttribute("aria-label","Apply"); apply.textContent="Apply";
  apply.addEventListener("click",()=>{
    if(!from) from=_iso(t.getFullYear(),t.getMonth()+1,t.getDate());
    if(!to) to=from;
    if(from>to){ const x=from; from=to; to=x; }
    try{ if(opts&&typeof opts.onApply==="function"){ _applied=true; opts.onApply(from,to); } else { if(attFromDate)attFromDate.value=from; if(attToDate)attToDate.value=to; _dtCommitPreset("custom_range"); try{renderAttendance();}catch(e){ console.error(e); } } }catch(e){ console.error(e); }
    closeDtPops();
  });
  foot.appendChild(clear); foot.appendChild(apply); box.appendChild(foot);
  _dtWire(box,anchor);
}
/* Custom-date calendar popup — single-day mirror of openRangePop.
   Same anchored shell, grid, nav, glyph foot. Pick stages locally;
   tick writes the hidden single input + commits custom_day. */
function openDayPop(anchor){
  const key="D:"+((anchor&&anchor.dataset&&anchor.dataset.v)||"");
  if(_dtOpenFor===key) return; _dtOpenFor=key;
  const t=new Date();
  let sel=(typeof attSingleDate!=="undefined"&&attSingleDate&&attSingleDate.value)||"";
  const box=_dtShell(); box._dtAnchor=anchor; box.classList.add("cal");
  const head=document.createElement("div"); head.className="dt-head";
  const title=document.createElement("div"); title.className="dt-title"; title.textContent="Custom date";
  head.appendChild(title); box.appendChild(head);
  const hint=document.createElement("div"); hint.className="dt-sec dt-hint"; hint.style.marginTop="0";
  box.appendChild(hint);
  const base=sel||_iso(t.getFullYear(),t.getMonth()+1,t.getDate());
  const bm=/^(\d{4})-(\d{2})-(\d{2})$/.exec(base)||[0,t.getFullYear(),t.getMonth()+1,t.getDate()];
  const view={y:+bm[1],m:+bm[2]-1};
  function paintHint(){
    hint.textContent=!sel?"Tap the day":_fmtShort(sel);
  }
  const redraw=_monthGrid(box,"",view,iso=>{
    sel=iso;
    paintHint(); redraw();
  },iso=>(sel&&iso===sel));
  paintHint();
  const foot=document.createElement("div"); foot.className="dt-foot";
  const clear=document.createElement("button"); clear.type="button"; clear.className="dt-glyph"; clear.setAttribute("aria-label","Clear"); clear.textContent="Clear";
  clear.addEventListener("click",()=>{
    sel="";
    try{ if(attSingleDate)attSingleDate.value=""; renderAttendance(); }catch(e){ console.error(e); }
    paintHint(); redraw();
  });
  const apply=document.createElement("button"); apply.type="button"; apply.className="dt-glyph go"; apply.setAttribute("aria-label","Apply"); apply.textContent="Apply";
  apply.addEventListener("click",()=>{
    if(!sel) sel=_iso(t.getFullYear(),t.getMonth()+1,t.getDate());
    try{ if(attSingleDate)attSingleDate.value=sel; _dtCommitPreset("custom_day"); try{renderAttendance();}catch(e){ console.error(e); } }catch(e){ console.error(e); }
    closeDtPops();
  });
  foot.appendChild(clear); foot.appendChild(apply); box.appendChild(foot);
  _dtWire(box,anchor);
}
/* Frosted tooltip engine — RETIRED per user call (no hover warnings
   anywhere). Kept as a no-op shell so nothing references missing code. */
/* Custom frost date/time picker — replaces native popups (browser chrome
   can never wear the theme). Trigger glyph + portalled popup, same
   architecture as the gsel dropdowns. Typing stays native; the picker
   only writes well-formed values (date YYYY-MM-DD, time HH:MM 24h)
   and fires input+change so all existing save flows keep working. */
(function(){
  if(window.__frostDtInit) return; window.__frostDtInit=true;
  let popEl=null, popInput=null, popType=null, popFace=null;
  const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
  const pad=n=>(n<10?"0":"")+n;
  const viewKey={};
  function closePop(){
    _dtCancelClose();
    if(popFace){ try{ popFace.classList.remove("open"); }catch(e){} }
    if(popEl){ try{ popEl.remove(); }catch(e){} popEl=null; popInput=null; popType=null; popFace=null; }
    document.removeEventListener("pointerdown",onDocDown,true);
    document.removeEventListener("keydown",onKey,true);
    window.removeEventListener("scroll",onScroll,true);
    window.removeEventListener("resize",closePop);
    document.removeEventListener("pointermove",_dtDocMove,true);
  }
  function onDocDown(e){ if(e.target===popFace) return; if(popEl && !popEl.contains(e.target) && e.target!==popInput) closePop(); }
  /* Column scrolls bubble to window: only a scroll OUTSIDE the popup closes */
  function onScroll(e){ if(popEl && e.target && !popEl.contains(e.target)) closePop(); }
  function onKey(e){
    if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); closePop(); if(popFace){ try{ popFace.focus(); }catch(_){} } return; }
    if(!popEl) return;
    const tag=(e.target&&e.target.tagName)||"";
    if(tag==="TEXTAREA"||tag==="INPUT"||tag==="SELECT") return;
    const btns=Array.from(popEl.querySelectorAll("button")).filter(b=>!b.disabled&&b.offsetParent!==null);
    if(!btns.length) return;
    const cur=btns.indexOf(document.activeElement);
    if(e.key==="ArrowRight"||e.key==="ArrowLeft"||e.key==="ArrowDown"||e.key==="ArrowUp"){
      e.preventDefault();
      const cols=popEl.classList.contains("tm")?1:7;
      const d=(e.key==="ArrowRight")?1:(e.key==="ArrowLeft")?-1:(e.key==="ArrowDown")?cols:-cols;
      const nx=btns[(cur<0?(d>0?0:btns.length-1):cur+d+btns.length)%btns.length];
      if(nx) nx.focus();
    }else if(e.key==="Enter"&&cur>=0&&popType==="date"){
      e.preventDefault(); btns[cur].click();
    }
  }
  function commit(input,val){
    input.value=val;
    try{ input.dispatchEvent(new Event("input",{bubbles:true})); }catch(e){}
    try{ input.dispatchEvent(new Event("change",{bubbles:true})); }catch(e){}
  }
  function place(input){
    if(!popEl) return;
    const anchor=popFace||input;
    const r=anchor.getBoundingClientRect();
    popEl.style.visibility="hidden"; popEl.style.left="0px"; popEl.style.top="0px";
    const w=popEl.offsetWidth, h=popEl.offsetHeight, vw=window.innerWidth, vh=window.innerHeight;
    /* Rail-dock only for sidebar-anchored fields: dock right edge of
       the popup to the rail's left edge (8px gap) so the picker opens
       LEFT into the workspace. Center vertically on the trigger. */
    let inRail=false, railLeft=0;
    try{
      const rail=document.getElementById("adminSide");
      if(rail){ const rr=rail.getBoundingClientRect(); if(rr&&rr.width>0){ railLeft=Math.max(0,rr.left); inRail=!!(r&&r.width>0&&anchor && anchor.closest && anchor.closest('#adminSide')&&r.left>=railLeft-1&&r.right<=railLeft+260); } }
    }catch(e){}
    let left;
    if(inRail){
      if(!popEl.dataset.sized){ popEl.style.minWidth="296px"; popEl.dataset.sized="1"; }
      left=Math.max(8,railLeft-8-w);
      if(left+w>vw-8) left=Math.max(8,vw-w);
      popEl._triggerY=r.top+r.height/2;
    }else{
      left=Math.min(Math.max(8,r.left),Math.max(8,vw-w-8));
      try{ delete popEl._triggerY; }catch(e){ try{ popEl._triggerY=null; }catch(_){} }
    }
    let top;
    if(inRail){
      const desired=Math.round(r.top+(r.height-h)/2);
      top=Math.max(8,Math.min(desired,vh-h-8));
    }else{
      top=r.bottom+6; if(top+h>vh-8) top=Math.max(8,r.top-h-6);
    }
    /* Same modal-footer flip as the dropdowns (user order): time/date
       pickers never bury the modal's own action row when room above.
       A flipped-above popover must never cover the modal title: clamp
       it below the title block. */
    try{
      const card=input.closest&&input.closest('.mod');
      if(card){ const cr=card.getBoundingClientRect(); if(top+h>cr.bottom-8){ const up=Math.round(r.top-4-h); if(up>=Math.max(8,cr.top)) top=up; } if(top<cr.top+96) top=Math.min(cr.top+96,Math.max(8,vh-h-8)); }
    }catch(_){}
    popEl.style.left=left+"px"; popEl.style.top=top+"px"; popEl.style.visibility="";
    if(inRail) _revealFromRail(popEl);
  }
  function openPop(input,type,face){
    if(popEl && popInput===input && popType===type){ closePop(); return; }
    closePop();
    popInput=input; popType=type; popFace=face||null;
    if(popFace) popFace.classList.add("open");
    popEl=document.createElement("div"); popEl.className="dt-pop"; popEl.setAttribute("role","dialog");
    if(type==="date") popEl.classList.add("cal");
    if(type==="date") buildDate(popEl,input); else buildTime(popEl,input);
    document.body.appendChild(popEl); place(input);
    document.addEventListener("pointerdown",onDocDown,true);
    document.addEventListener("keydown",onKey,true);
    window.addEventListener("scroll",onScroll,true);
    window.addEventListener("resize",closePop);
    /* Tracked-pointer close: if the cursor leaves the popup AND the
       trigger for a moment, close. Prevents the stuck-popup residue
       when the user moves from the input to a sibling control. */
    try{
      popEl.addEventListener("mouseenter",_dtCancelClose);
      popEl.addEventListener("mouseleave",_dtMaybeCloseSoon);
      if(popFace){ popFace.addEventListener("mouseenter",_dtCancelClose); popFace.addEventListener("mouseleave",_dtMaybeCloseSoon); }
      document.addEventListener("pointermove",_dtDocMove,true);
    }catch(e){}
  }
  function parseDate(v){ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(v||""); if(!m) return null; const d=new Date(+m[1],+m[2]-1,+m[3]); return isNaN(d)?null:d; }
  function buildDate(box,input){
    const today=new Date(); today.setHours(0,0,0,0);
    let _recDays=new Set();
    let sel=parseDate(input.value);
    let vk=input.id||input.name||"dt";
    let view=viewKey[vk];
    if(!view){ const base=sel||today; view={y:base.getFullYear(),m:base.getMonth()}; }
    const id0=input.id||"";
    const pairId=/Start$/.test(id0)?id0.replace(/Start$/,"End"):(/End$/.test(id0)?id0.replace(/End$/,"Start"):null);
    const pairVal=()=>{ try{ const p=pairId&&document.getElementById(pairId); return p?p.value:""; }catch(e){ return ""; } };
    const head=document.createElement("div"); head.className="dt-head";
    const title=document.createElement("div"); title.className="dt-title";
    const nav=document.createElement("div"); nav.className="dt-nav";
    const prev=document.createElement("button"); prev.type="button"; prev.textContent="Prev"; prev.setAttribute("aria-label","Previous month");
    const next=document.createElement("button"); next.type="button"; next.textContent="Next"; next.setAttribute("aria-label","Next month");
    /* Month nav holds to repeat (user order): a tap steps one month, holding
       runs through the years. These buttons are created once and live
       outside draw(), so pointer capture survives each grid repaint. */
    holdRepeat(prev,()=>{ view.m--; if(view.m<0){view.m=11;view.y--;} draw(); });
    holdRepeat(next,()=>{ view.m++; if(view.m>11){view.m=0;view.y++;} draw(); });
    nav.appendChild(prev); nav.appendChild(next); head.appendChild(title); head.appendChild(nav); box.appendChild(head);
    const grid=document.createElement("div"); grid.className="dt-grid"; box.appendChild(grid);
    const foot=document.createElement("div"); foot.className="dt-foot";
    const clear=document.createElement("button"); clear.type="button"; clear.textContent="Clear";
    const tBtn=document.createElement("button"); tBtn.type="button"; tBtn.textContent="Today";
    clear.addEventListener("click",()=>{ viewKey[vk]=view; commit(input,""); closePop(); });
    tBtn.addEventListener("click",()=>{ const t=new Date(); view={y:t.getFullYear(),m:t.getMonth()}; viewKey[vk]=view; commit(input,t.getFullYear()+"-"+pad(t.getMonth()+1)+"-"+pad(t.getDate())); closePop(); });
    foot.appendChild(clear); foot.appendChild(tBtn); box.appendChild(foot);
    function isoOf(d){ return view.y+"-"+pad(view.m+1)+"-"+pad(d); }
    function inWash(iso){
      const a=input.value, b=pairVal();
      if(!a||!b||a===b) return false;
      const lo=a<b?a:b, hi=a<b?b:a;
      return iso>lo&&iso<hi;
    }
    function draw(){
      viewKey[vk]=view;
      title.textContent=MONTHS[view.m]+" "+view.y;
      grid.innerHTML="";
      try{ const src=(typeof AllEvents!=="undefined"&&AllEvents&&AllEvents.length)?AllEvents:((typeof Attendance!=="undefined")?Attendance:[]); _recDays=_scanDays(src); }catch(e){ _recDays=new Set(); }
      const cells=[];
      ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].forEach(d=>{ const s=document.createElement("div"); s.className="dt-dow"; s.textContent=d; grid.appendChild(s); });
      const first=new Date(view.y,view.m,1).getDay(), dim=new Date(view.y,view.m+1,0).getDate();
      for(let i=0;i<first;i++){ const g=document.createElement("span"); g.className="dt-day hide"; g.setAttribute("aria-hidden","true"); grid.appendChild(g); }
      for(let d=1;d<=dim;d++) addDay(d,cells);
      const tail=(7-((first+dim)%7))%7;
      for(let i=0;i<tail;i++){ const g=document.createElement("span"); g.className="dt-day hide"; g.setAttribute("aria-hidden","true"); grid.appendChild(g); }
      paintStatic(cells);
      const endPick=/End$/.test(id0)&&pairVal()&&!input.value;
      if(endPick){
        cells.forEach(c=>c.el.addEventListener("mouseenter",()=>{
          const hov=c.iso, a=pairVal();
          const lo=a<hov?a:hov, hi=a<hov?hov:a;
          paintWashMesh(cells,s=>s>lo&&s<hi);
        }));
        grid.addEventListener("mouseleave",()=>paintStatic(cells));
      }
    }
    function paintWashMesh(list,test){
      list.forEach(c=>{
        const iso=c.iso; let mid=false; try{ mid=!!(test&&test(iso)); }catch(e){}
        c.el.classList.toggle("in",mid);
        ["bl","br","bt","bb"].forEach(k=>c.el.classList.remove(k));
        if(!mid) return;
        const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)||[];
        const _d=new Date(+m[1],+m[2]-1,+m[3]); if(isNaN(_d)) return;
        const _s=n=>{ const x=new Date(_d); x.setDate(x.getDate()+n); return x.getFullYear()+"-"+pad(x.getMonth()+1)+"-"+pad(x.getDate()); };
        const _w=s=>{ try{ return !!(test&&test(s)); }catch(e){ return false; } };
        const _c=_d.getDay();
        const L=_c>0&&_w(_s(-1)),R=_c<6&&_w(_s(1)),T=_w(_s(-7)),B=_w(_s(7));
        if(L)c.el.classList.add("bl"); if(R)c.el.classList.add("br"); if(T)c.el.classList.add("bt"); if(B)c.el.classList.add("bb");
      });
    }
    function paintStatic(cells){ paintWashMesh(cells,inWash); }
    function addDay(d,cells){
      const b=document.createElement("button"); b.type="button"; b.className="dt-day";
      const lb=document.createElement("span"); lb.textContent=d; b.appendChild(lb);
      const dt=new Date(view.y,view.m,d);
      const iso=isoOf(d);
      if(dt.getTime()===today.getTime()) b.classList.add("today");
      if(sel&&dt.getFullYear()===sel.getFullYear()&&dt.getMonth()===sel.getMonth()&&dt.getDate()===sel.getDate()) b.classList.add("sel");
      /* Pair endpoint (Start/End range): mark the other end black too, so
         both popups show the full range. inWash stays exclusive. */
      try{ const _pi=pairVal(); if(_pi&&/^\d{4}-\d{2}-\d{2}$/.test(_pi)&&_pi===iso) b.classList.add("sel"); }catch(_){}
      if(inWash(iso)) b.classList.add("in");
      b.addEventListener("click",()=>{ viewKey[vk]={y:dt.getFullYear(),m:dt.getMonth()}; commit(input,iso); closePop(); });
      const dot=document.createElement("i"); dot.className="dt-dot"; dot.setAttribute("aria-hidden","true");
      try{ dot.classList.toggle("off",!(_recDays&&_recDays.has(iso))); }catch(e){ dot.classList.add("off"); }
      b.appendChild(dot);
      grid.appendChild(b);
      cells.push({el:b,iso:iso});
    }
    draw();
  }
  function parseTime(v){ const m=/^(\d{1,2}):(\d{2})/.exec(v||""); if(!m) return null; const h=+m[1],mi=+m[2]; if(h>23||mi>59) return null; return {h:h,mi:mi}; }
  function buildTime(box,input){
    let cur=parseTime(input.value)||{h:8,mi:0};
    function h12(){ const h=cur.h%12; return h===0?12:h; }
    function isPM(){ return cur.h>=12; }
    function apply(){ commit(input,pad(cur.h)+":"+pad(cur.mi)); }
    function cap(t){ const c=document.createElement("div"); c.className="tp-cap"; c.textContent=t; box.appendChild(c); }
    let hG,mG,aG,nVal;
    function paint(){
      const hh=h12(), pm=isPM()?1:0;
      [[hG,hh],[mG,cur.mi],[aG,pm]].forEach(([g,v])=>{
        if(!g) return;
        Array.from(g.querySelectorAll("button")).forEach(b=>{
          const on=b.dataset.on===String(v);
          b.classList.toggle("on",on);
        });
      });
      if(nVal) nVal.textContent=pad(cur.mi);
    }
    cap("Hour");
    hG=document.createElement("div"); hG.className="tp-grid";
    [1,2,3,4,5,6,7,8,9,10,11,12].forEach(h=>{
      const b=document.createElement("button"); b.type="button"; b.textContent=pad(h); b.dataset.on=h;
      b.addEventListener("click",()=>{ cur.h=(isPM()?12:0)+(h%12); apply(); paint(); });
      hG.appendChild(b);
    });
    box.appendChild(hG);
    { const mh=document.createElement("div"); mh.className="tp-minhead";
      const mc=document.createElement("div"); mc.className="tp-cap"; mc.textContent="Minute"; mh.appendChild(mc);
      const md=document.createElement("button"); md.type="button"; md.className="tp-nudge"; md.textContent="−"; md.setAttribute("aria-label","One minute less");
      holdRepeat(md,()=>{ cur.mi=(cur.mi+59)%60; apply(); paint(); });
      nVal=document.createElement("span"); nVal.className="tp-nudge-val";
      const mu=document.createElement("button"); mu.type="button"; mu.className="tp-nudge"; mu.textContent="+"; mu.setAttribute("aria-label","One minute more");
      holdRepeat(mu,()=>{ cur.mi=(cur.mi+1)%60; apply(); paint(); });
      mh.appendChild(md); mh.appendChild(nVal); mh.appendChild(mu); box.appendChild(mh); }
    mG=document.createElement("div"); mG.className="tp-grid";
    for(let m=0;m<60;m+=5){
      const b=document.createElement("button"); b.type="button"; b.textContent=pad(m); b.dataset.on=m;
      b.addEventListener("click",()=>{ cur.mi=m; apply(); paint(); });
      mG.appendChild(b);
    }
    box.appendChild(mG);
    cap("AM / PM");
    aG=document.createElement("div"); aG.className="tp-grid ampm";
    [["AM",0],["PM",1]].forEach(([label,v])=>{
      const b=document.createElement("button"); b.type="button"; b.textContent=label; b.dataset.on=v;
      b.addEventListener("click",()=>{ cur.h=(cur.h%12)+(v?12:0); apply(); paint(); });
      aG.appendChild(b);
    });
    box.appendChild(aG);
    const foot=document.createElement("div"); foot.className="dt-foot";
    const clear=document.createElement("button"); clear.type="button"; clear.setAttribute("aria-label","Clear"); clear.textContent="Clear";
    const done=document.createElement("button"); done.type="button"; done.className="go"; done.setAttribute("aria-label","Done"); done.textContent="Done";
    clear.addEventListener("click",()=>{ commit(input,""); closePop(); });
    done.addEventListener("click",()=>{ closePop(); });
    foot.appendChild(clear); foot.appendChild(done); box.appendChild(foot);
    paint();
  }
  function fmtDate(iso){ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||""); if(!m) return ""; return (+m[3])+" "+MONTHS_S[+m[2]-1]+" "+m[1]; }
  function fmtTime(hhmm){ const m=/^(\d{1,2}):(\d{2})/.exec(hhmm||""); if(!m) return ""; let h=+m[1]; const ap=h>=12?"PM":"AM"; h=h%12; if(h===0)h=12; return h+":"+m[2]+" "+ap; }
  function syncFace(input){
    const face=input._dtFace; if(!face) return;
    const t=(input.type||"").toLowerCase();
    const v=input.value||"";
    face.textContent=t==="date"?(v?fmtDate(v):"Select date"):(v?fmtTime(v):"Select time");
    face.classList.toggle("dim",!v);
  }
  function enhance(input){
    if(!input||(input.tagName!=="INPUT")||input.dataset.dt) return;
    const t=(input.type||"").toLowerCase(); if(t!=="time"&&t!=="date") return;
    if(input.closest&&input.closest("#attDateStaging")) return;
    input.dataset.dt="1";
    try{ input.style.display="none"; }catch(e){}
    const face=document.createElement("button"); face.type="button"; face.className="dt-face";
    face.setAttribute("aria-label",t==="date"?"Choose date":"Choose time");
    try{ input.parentNode.insertBefore(face,input.nextSibling); }catch(e){ return; }
    input._dtFace=face;
    face.addEventListener("click",(e)=>{ e.preventDefault(); e.stopPropagation(); openPop(input,t,face); });
    input.addEventListener("input",()=>syncFace(input));
    input.addEventListener("change",()=>syncFace(input));
    syncFace(input);
  }
  function enhanceAll(root){ try{ (root||document).querySelectorAll('input[type="time"],input[type="date"]').forEach(enhance); }catch(e){} }
  enhanceAll(document);
  try{
    new MutationObserver((muts)=>{
      muts.forEach(m=>{ m.addedNodes.forEach(n=>{ if(!n||!n.querySelectorAll) return; if(n.tagName==="INPUT") enhance(n); enhanceAll(n); }); });
    }).observe(document.body,{childList:true,subtree:true});
  }catch(e){}
})();
