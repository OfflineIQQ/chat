import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, updateProfile }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch,
  increment, arrayUnion, arrayRemove, query, where, orderBy, limit, onSnapshot,
  serverTimestamp, getCountFromServer }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDgK8NFwky9907pBmFAh9zmvxY0X1BMqMw",
  authDomain: "al-janabi-chat.firebaseapp.com",
  projectId: "al-janabi-chat",
  storageBucket: "al-janabi-chat.firebasestorage.app",
  messagingSenderId: "1008425731131",
  appId: "1:1008425731131:web:171a8c58f948348ac0c81e"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);
const LV = 2000;
const MAXLV = 999;

const errors = {
  "auth/invalid-credential": "البريد أو كلمة المرور غير صحيحة.",
  "auth/invalid-email": "صيغة البريد الإلكتروني غير صحيحة.",
  "auth/email-already-in-use": "هذا البريد مسجّل من قبل. استخدم زر الدخول.",
  "auth/weak-password": "كلمة المرور ضعيفة. استخدم 6 أحرف على الأقل.",
  "auth/too-many-requests": "محاولات كثيرة. انتظر قليلاً وحاول مرة ثانية.",
  "auth/network-request-failed": "تحقق من اتصال الإنترنت."
};
const showError = (e) => { $("err").textContent = errors[e.code] || "حدث خطأ. حاول مرة ثانية."; };

let me = null, isAdmin = false, mode = "groups", peer = null, grp = null, pending = null;
let unsubMsgs = null, unsubBan = null, unsubUsers = null, unsubInbox = null, unsubPres = null;
let unsubMyG = null, unsubPubG = null, unsubGrp = null, unsubCodes = null, beatTimer = null;
let usersMap = {}, presenceMap = {}, myGroups = [], pubGroups = [];
let lastMsgSnap = null, lastOpts = null, lastInboxSnap = null, pfPhoto = "";
let modalUid = null, modalTok = 0, followState = false;

const myName = () => (me && me.displayName) || "مستخدم";
const chatIdWith = (uid) => [me.uid, uid].sort().join("_");
const gdoc = (d) => Object.assign({ id: d.id, members: [] }, d.data());
const lvlOf = (c, b) => Math.min(MAXLV, Math.floor((c || 0) / LV) + 1 + (b || 0));

function lvlInfo(u) {
  const c = (u && u.msgCount) || 0;
  const lv = lvlOf(c, u && u.bonus);
  const max = lv >= MAXLV;
  return { lv, max, cur: c % LV, pct: max ? 100 : (c % LV) / LV * 100 };
}

function note(id, text, ok) {
  const m = $(id);
  m.textContent = text;
  m.className = ok ? "ok" : "bad";
}

/* ---------- ألوان المستويات ---------- */
const PAL = [
  ["#16a34a", "#fff"], ["#0891b2", "#fff"], ["#2563eb", "#fff"], ["#7c3aed", "#fff"],
  ["#db2777", "#fff"], ["#ea580c", "#fff"], ["#f59e0b", "#1a1200"], ["#0d9488", "#fff"],
  ["#9333ea", "#fff"], ["#65a30d", "#fff"], ["#0284c7", "#fff"]
];
const VEC = [[-16, -14], [14, -16], [-20, 2], [20, 4], [-6, -20], [8, 14], [-12, 12]];

function tierOf(li) {
  if (li.max) return { bg: "#7f1d1d", fg: "#fff", max: true };
  const t = Math.floor(li.lv / 15);
  if (t === 0) return { bg: "#ffffff", fg: "#1f2937", bd: "1px solid #cbd5e1" };
  const p = PAL[(t - 1) % PAL.length];
  return { bg: p[0], fg: p[1] };
}

function paintBadge(el, li, label, extra) {
  const c = tierOf(li);
  el.className = "lvb" + (extra ? " " + extra : "") + (c.max ? " max" : "");
  el.textContent = label;
  el.style.background = c.bg;
  el.style.color = c.fg;
  el.style.border = c.bd || "";
  if (c.max) {
    VEC.forEach((v, i) => {
      const s = document.createElement("i");
      s.className = "sp";
      s.style.setProperty("--dx", v[0] + "px");
      s.style.setProperty("--dy", v[1] + "px");
      s.style.animationDelay = (i * 0.2) + "s";
      el.appendChild(s);
    });
  }
  return c;
}

/* ---------- الحالة (متصل / آخر ظهور) ---------- */
function isOnline(uid) {
  const p = presenceMap[uid];
  return !!(p && p.on && Date.now() - p.t < 240000);
}

function seenText(uid) {
  if (isOnline(uid)) return "متصل الآن";
  const p = presenceMap[uid];
  if (!p || !p.t) return "غير متصل";
  const d = new Date(p.t), now = new Date();
  const tm = d.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((today - that) / 86400000);
  if (diff <= 0) return "آخر ظهور اليوم " + tm;
  if (diff === 1) return "آخر ظهور أمس " + tm;
  return "آخر ظهور " + d.toLocaleDateString("ar") + " " + tm;
}

function beat(on) {
  if (!me) return Promise.resolve();
  return setDoc(doc(db, "presence", me.uid), { t: serverTimestamp(), on }).catch(() => {});
}
function startBeat() {
  stopBeat();
  beat(document.visibilityState === "visible");
  beatTimer = setInterval(() => { if (document.visibilityState === "visible") beat(true); }, 120000);
}
function stopBeat() { if (beatTimer) { clearInterval(beatTimer); beatTimer = null; } }
document.addEventListener("visibilitychange", () => { if (me) beat(document.visibilityState === "visible"); });
window.addEventListener("pagehide", () => { if (me) beat(false); });

function updateSub() {
  if (!me) return;
  const s = $("me");
  s.className = "";
  if (mode === "dm" && peer) {
    s.textContent = seenText(peer.uid);
    if (isOnline(peer.uid)) s.className = "on";
  } else if (mode === "group" && grp) {
    s.textContent = grp.members.length + " عضو" + (grp.type === "private" ? " - مجموعة خاصة" : "");
  } else {
    s.textContent = (me.displayName || me.email) + (isAdmin ? " (مدير)" : "");
  }
}

function refreshPresenceUI() {
  if (!me) return;
  if (mode === "people") { renderUserList(); if (lastInboxSnap) renderInbox(lastInboxSnap); }
  updateSub();
  if (modalUid && !$("modal").classList.contains("hidden")) drawModalStatus();
}
setInterval(refreshPresenceUI, 60000);

/* ---------- الدخول ---------- */
$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("err").textContent = "";
  try { await signInWithEmailAndPassword(auth, $("email").value.trim(), $("pass").value); }
  catch (err) { showError(err); }
});

$("signupBtn").addEventListener("click", async () => {
  $("err").textContent = "";
  const name = $("name").value.trim();
  if (!name) { $("err").textContent = "اكتب اسمك أول."; return; }
  try {
    const cred = await createUserWithEmailAndPassword(auth, $("email").value.trim(), $("pass").value);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, "users", cred.user.uid), { name }, { merge: true });
  } catch (err) { showError(err); }
});

$("logout").addEventListener("click", async () => { await beat(false); signOut(auth); });
$("adminBtn").addEventListener("click", () => $("panel").classList.toggle("hidden"));

function emptyNote(box, text) {
  const d = document.createElement("div");
  d.className = "empty";
  d.textContent = text;
  box.appendChild(d);
}

function avatarEl(photo, name, extra, uid, noClick) {
  const w = document.createElement("div");
  w.className = "avw";
  const d = document.createElement("div");
  d.className = "av" + (extra ? " " + extra : "");
  if (photo) {
    const i = document.createElement("img");
    i.src = photo;
    i.alt = "";
    d.appendChild(i);
  } else {
    d.textContent = ((name || "?").trim().charAt(0) || "?").toUpperCase();
  }
  w.appendChild(d);
  if (uid && isOnline(uid)) {
    const dot = document.createElement("i");
    dot.className = "dot";
    w.appendChild(dot);
  }
  if (uid && !noClick) {
    w.style.cursor = "pointer";
    w.onclick = (e) => { e.stopPropagation(); openProfile(uid); };
  }
  return w;
}

function showDenied() {
  const list = $("list");
  list.textContent = "";
  emptyNote(list, "لا تملك صلاحية عرض الرسائل. قد يكون حسابك محظوراً.");
  $("text").disabled = true;
}

/* ---------- المرفقات ---------- */
function clearPending() {
  pending = null;
  $("file").value = "";
  $("chip").classList.add("hidden");
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let max = 900, q = 0.7, out = "";
      for (let i = 0; i < 4; i++) {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        out = c.toDataURL("image/jpeg", q);
        if (out.length < 500000) break;
        max *= 0.75;
        q -= 0.1;
      }
      URL.revokeObjectURL(url);
      out.length < 750000 ? resolve(out) : reject(new Error("big"));
    };
    img.onerror = () => reject(new Error("bad"));
    img.src = url;
  });
}

function makeAvatar(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => reject(new Error("bad"));
    img.src = url;
  });
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("read"));
    r.readAsDataURL(file);
  });
}

$("attach").addEventListener("click", () => $("file").click());
$("chipX").addEventListener("click", clearPending);

$("file").addEventListener("change", async () => {
  const f = $("file").files[0];
  if (!f) return;
  try {
    if (f.type.startsWith("image/")) {
      pending = { image: await compressImage(f), name: f.name };
    } else {
      if (f.size > 500 * 1024) { alert("حجم الملف أكبر من 500 كيلوبايت."); clearPending(); return; }
      pending = { data: await readAsDataUrl(f), name: f.name.slice(0, 100) };
    }
    $("chipName").textContent = (pending.image ? "📷 " : "📎 ") + f.name;
    $("chip").classList.remove("hidden");
  } catch (err) {
    alert("تعذر تجهيز الملف. جرّب صورة أو ملف أصغر.");
    clearPending();
  }
});

/* ---------- عرض الرسائل ---------- */
function curOpts() {
  if (mode === "public") return { del: isAdmin, ban: isAdmin };
  if (mode === "saved") return { saved: true };
  if (mode === "group" && grp) return { del: grp.owner === me.uid || isAdmin, own: true, ban: isAdmin };
  return {};
}

async function saveCopy(m, u) {
  const n = { uid: me.uid, name: myName(), text: m.text || "", from: u.name || m.name || "", createdAt: serverTimestamp() };
  if (m.image) n.image = m.image;
  if (m.fileData) { n.fileName = m.fileName || "file"; n.fileData = m.fileData; }
  await setDoc(doc(collection(db, "users", me.uid, "saved")), n);
}

function miniBtn(label, fn) {
  const b = document.createElement("button");
  b.className = "mini";
  b.textContent = label;
  b.onclick = fn;
  return b;
}

function renderMsgs(snap, opts) {
  lastMsgSnap = snap;
  lastOpts = opts;
  const list = $("list");
  list.textContent = "";
  if (snap.empty) {
    emptyNote(list, opts.saved ? "لا توجد رسائل محفوظة. اكتب ملاحظة أو احفظ رسالة من أي دردشة." : "لا توجد رسائل بعد. اكتب أول رسالة.");
    return;
  }
  snap.docs.slice().reverse().forEach((d) => {
    const m = d.data({ serverTimestamps: "estimate" });
    const u = usersMap[m.uid] || {};
    const line = document.createElement("div");
    line.className = "line" + (m.uid === me.uid ? " mine" : "");
    const box = document.createElement("div");
    box.className = "msg";
    const who = document.createElement("div");
    who.className = "who";
    if (opts.saved) {
      who.textContent = m.from ? "من: " + m.from : "ملاحظة";
    } else {
      who.textContent = u.name || m.name || "مستخدم";
      if (u.username) {
        const un = document.createElement("span");
        un.textContent = " @" + u.username;
        who.appendChild(un);
      }
      const li = lvlInfo(u);
      const lb = document.createElement("span");
      paintBadge(lb, li, "Lv " + li.lv);
      who.appendChild(lb);
      who.style.cursor = "pointer";
      who.onclick = () => openProfile(m.uid);
    }
    box.appendChild(who);
    if (m.text) {
      const body = document.createElement("div");
      body.textContent = m.text;
      box.appendChild(body);
    }
    if (m.image) {
      const im = document.createElement("img");
      im.src = m.image;
      im.alt = "صورة";
      box.appendChild(im);
    }
    if (m.fileData) {
      const a = document.createElement("a");
      a.href = m.fileData;
      a.download = m.fileName || "file";
      a.textContent = "📎 " + (m.fileName || "ملف");
      box.appendChild(a);
    }
    const bar = document.createElement("div");
    bar.className = "bar";
    if (opts.saved) {
      bar.appendChild(miniBtn("حذف", () => { if (confirm("حذف من المحفوظات؟")) deleteDoc(d.ref).catch(console.error); }));
    } else {
      const sv = miniBtn("حفظ", async () => {
        try { await saveCopy(m, u); sv.textContent = "تم ✓"; }
        catch (e) { console.error(e); alert("تعذر الحفظ."); }
      });
      bar.appendChild(sv);
      if (opts.del || (opts.own && m.uid === me.uid)) {
        bar.appendChild(miniBtn("حذف", () => { if (confirm("حذف هذه الرسالة؟")) deleteDoc(d.ref).catch(console.error); }));
      }
      if (opts.ban && m.uid !== me.uid) {
        bar.appendChild(miniBtn("حظر", () => {
          if (confirm("حظر " + (u.name || m.name || "هذا المستخدم") + "؟")) {
            setDoc(doc(db, "banned", m.uid), { name: u.name || m.name || "", at: serverTimestamp() }).catch(console.error);
          }
        }));
      }
    }
    box.appendChild(bar);
    line.append(avatarEl(u.photo, u.name || m.name, "", opts.saved ? null : m.uid), box);
    list.appendChild(line);
  });
  list.scrollTop = list.scrollHeight;
}

function renderBanned(snap) {
  const box = $("banList");
  box.textContent = "";
  if (snap.empty) { emptyNote(box, "لا يوجد محظورون."); return; }
  snap.forEach((d) => {
    const row = document.createElement("div");
    row.className = "ban";
    const n = document.createElement("span");
    n.textContent = d.data().name || d.id;
    row.append(n, miniBtn("إلغاء الحظر", () => deleteDoc(d.ref).catch(console.error)));
    box.appendChild(row);
  });
}

function item(name, sub, photo, uid, onClick) {
  const b = document.createElement("button");
  b.className = "item";
  const t = document.createElement("div");
  t.className = "it";
  const n = document.createElement("div");
  n.textContent = name;
  t.appendChild(n);
  if (sub) {
    const s = document.createElement("small");
    s.textContent = sub;
    t.appendChild(s);
  }
  b.append(avatarEl(photo, name, "", uid), t);
  b.onclick = onClick;
  return b;
}

function renderUserList() {
  const box = $("userList");
  box.textContent = "";
  const term = $("q").value.trim().toLowerCase().replace(/^@/, "");
  const users = Object.keys(usersMap)
    .filter((id) => id !== me.uid)
    .map((id) => Object.assign({ uid: id }, usersMap[id]))
    .filter((u) => !term || (u.name || "").toLowerCase().includes(term) || (u.username || "").includes(term));
  if (!users.length) { emptyNote(box, term ? "لا توجد نتائج." : "لا يوجد مستخدمون آخرون بعد. ادعُ أصدقاءك للتسجيل."); return; }
  users.sort((a, b) => (isOnline(b.uid) - isOnline(a.uid)) || (a.name || "").localeCompare(b.name || ""));
  users.forEach((u) => {
    const sub = (u.username ? "@" + u.username : "") + (u.bio ? (u.username ? " - " : "") + u.bio : "");
    box.appendChild(item(u.name || "مستخدم", sub, u.photo, u.uid, () => setMode("dm", { uid: u.uid, name: u.name || "مستخدم" })));
  });
}

function renderUsers(snap) {
  usersMap = {};
  snap.forEach((d) => { usersMap[d.id] = d.data(); });
  renderUserList();
  if (lastInboxSnap) renderInbox(lastInboxSnap);
  if (lastMsgSnap && (mode === "public" || mode === "dm" || mode === "group")) renderMsgs(lastMsgSnap, curOpts());
  if (mode === "profile") drawLvl();
  if (grp && !$("ginfo").classList.contains("hidden")) drawGInfo();
}

function renderInbox(snap) {
  lastInboxSnap = snap;
  const box = $("inboxList");
  box.textContent = "";
  const rows = [];
  snap.forEach((d) => {
    const m = d.data({ serverTimestamps: "estimate" });
    const u = usersMap[d.id] || {};
    rows.push({ uid: d.id, name: u.name || m.name || "مستخدم", photo: u.photo, text: m.text || "",
      t: m.at && m.at.toMillis ? m.at.toMillis() : 0 });
  });
  if (!rows.length) { emptyNote(box, "لا توجد محادثات بعد. اختر مستخدماً من القائمة."); return; }
  rows.sort((a, b) => b.t - a.t);
  rows.forEach((r) => box.appendChild(item(r.name, r.text, r.photo, r.uid, () => setMode("dm", { uid: r.uid, name: r.name }))));
}

$("q").addEventListener("input", renderUserList);

/* ---------- المجموعات ---------- */
function gItem(icon, title, sub, onClick, tag) {
  const b = document.createElement("button");
  b.className = "item";
  const av = document.createElement("div");
  av.className = "av";
  av.textContent = icon;
  const t = document.createElement("div");
  t.className = "it";
  const n = document.createElement("div");
  n.textContent = title;
  t.appendChild(n);
  if (sub) {
    const s = document.createElement("small");
    s.textContent = sub;
    t.appendChild(s);
  }
  b.append(av, t);
  if (tag) {
    const x = document.createElement("span");
    x.className = "tag";
    x.textContent = tag;
    b.appendChild(x);
  }
  b.onclick = onClick;
  return b;
}

function renderGroups() {
  if (!me) return;
  const my = $("myGroups");
  my.textContent = "";
  my.appendChild(gItem("🌐", "الدردشة العامة", "مفتوحة لجميع المستخدمين", () => setMode("public")));
  myGroups.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "")).forEach((g) => {
    my.appendChild(gItem(g.type === "private" ? "🔒" : "👥", g.name,
      g.members.length + " عضو" + (g.desc ? " - " + g.desc : ""), () => setMode("group", g)));
  });
  const pub = $("pubGroups");
  pub.textContent = "";
  const list = pubGroups.filter((g) => !g.members.includes(me.uid));
  if (!list.length) { emptyNote(pub, "لا توجد مجموعات عامة للانضمام الآن."); return; }
  list.forEach((g) => {
    pub.appendChild(gItem("👥", g.name, g.members.length + " عضو" + (g.desc ? " - " + g.desc : ""), () => joinGroup(g), "انضمام"));
  });
}

async function joinGroup(g) {
  try {
    await updateDoc(doc(db, "groups", g.id), { members: arrayUnion(me.uid) });
    setMode("group", Object.assign({}, g, { members: g.members.concat(me.uid) }));
  } catch (e) {
    console.error(e);
    alert("تعذر الانضمام للمجموعة.");
  }
}

$("gNewBtn").addEventListener("click", () => { $("gnew").classList.toggle("hidden"); note("gMsg", "", true); });
$("gCancel").addEventListener("click", () => $("gnew").classList.add("hidden"));

$("gCreate").addEventListener("click", async () => {
  const name = $("gName").value.trim();
  const desc = $("gDesc").value.trim();
  const type = $("gType").value;
  if (!name) { note("gMsg", "اكتب اسم المجموعة.", false); return; }
  $("gCreate").disabled = true;
  try {
    const ref = doc(collection(db, "groups"));
    await setDoc(ref, { name, desc, type, owner: me.uid, members: [me.uid], createdAt: serverTimestamp() });
    $("gName").value = "";
    $("gDesc").value = "";
    $("gnew").classList.add("hidden");
    setMode("group", { id: ref.id, name, desc, type, owner: me.uid, members: [me.uid] });
  } catch (e) {
    console.error(e);
    note("gMsg", "تعذر إنشاء المجموعة. تأكد من نشر القواعد الجديدة.", false);
  }
  $("gCreate").disabled = false;
});

function closeGInfo() { $("ginfo").classList.add("hidden"); }

function drawGInfo() {
  if (!grp) return;
  const own = grp.owner === me.uid;
  $("giName").textContent = grp.name;
  $("giDesc").textContent = grp.desc || "";
  $("giType").textContent = (grp.type === "private" ? "مجموعة خاصة: المنشئ فقط يضيف الأعضاء" : "مجموعة عامة: أي شخص يكدر ينضم")
    + " - " + grp.members.length + " عضو";
  $("giAdd").classList.toggle("hidden", !own);
  $("giLeave").classList.toggle("hidden", own);
  $("giDelete").classList.toggle("hidden", !own);
  const box = $("giMembers");
  box.textContent = "";
  grp.members.forEach((uid) => {
    const u = usersMap[uid] || {};
    const row = document.createElement("div");
    row.className = "ban";
    const left = document.createElement("div");
    left.style.cssText = "display:flex;align-items:center;gap:8px;min-width:0";
    const nm = document.createElement("span");
    nm.textContent = (u.name || "مستخدم") + (uid === grp.owner ? " (المنشئ)" : "");
    left.append(avatarEl(u.photo, u.name, "", uid), nm);
    row.appendChild(left);
    if (own && uid !== me.uid) {
      row.appendChild(miniBtn("إزالة", () => {
        if (!confirm("إزالة " + (u.name || "هذا العضو") + " من المجموعة؟")) return;
        updateDoc(doc(db, "groups", grp.id), { members: arrayRemove(uid) })
          .catch((e) => { console.error(e); note("giMsg", "تعذرت الإزالة.", false); });
      }));
    }
    box.appendChild(row);
  });
}

$("gInfoBtn").addEventListener("click", () => { note("giMsg", "", true); drawGInfo(); $("ginfo").classList.remove("hidden"); });
$("giClose").addEventListener("click", closeGInfo);
$("ginfo").addEventListener("click", (e) => { if (e.target === $("ginfo")) closeGInfo(); });

$("giAddBtn").addEventListener("click", async () => {
  const uname = $("giUser").value.trim().toLowerCase().replace(/^@/, "");
  if (!uname || !grp) return;
  try {
    const s = await getDoc(doc(db, "usernames", uname));
    if (!s.exists()) { note("giMsg", "اسم المستخدم غير موجود.", false); return; }
    const uid = s.data().uid;
    if (grp.members.includes(uid)) { note("giMsg", "هذا الشخص عضو من قبل.", false); return; }
    await updateDoc(doc(db, "groups", grp.id), { members: arrayUnion(uid) });
    $("giUser").value = "";
    note("giMsg", "تمت الإضافة.", true);
  } catch (e) {
    console.error(e);
    note("giMsg", "تعذرت الإضافة.", false);
  }
});

$("giLeave").addEventListener("click", async () => {
  if (!grp || !confirm("مغادرة المجموعة؟")) return;
  const id = grp.id;
  setMode("groups");
  try { await updateDoc(doc(db, "groups", id), { members: arrayRemove(me.uid) }); }
  catch (e) { console.error(e); alert("تعذرت المغادرة."); }
});

$("giDelete").addEventListener("click", async () => {
  if (!grp || !confirm("حذف المجموعة نهائياً؟ ما يمكن التراجع.")) return;
  const id = grp.id;
  setMode("groups");
  try { await deleteDoc(doc(db, "groups", id)); }
  catch (e) { console.error(e); alert("تعذر الحذف."); }
});

function leftGroup() {
  if (mode !== "group") return;
  alert("لم تعد عضواً في هذه المجموعة، أو تم حذفها.");
  setMode("groups");
}

/* ---------- بطاقة الملف الشخصي ---------- */
function drawModalStatus() {
  const s = $("mStatus");
  s.textContent = seenText(modalUid);
  s.className = isOnline(modalUid) ? "on" : "";
  const u = usersMap[modalUid] || {};
  $("mAv").textContent = "";
  $("mAv").appendChild(avatarEl(u.photo, u.name, "big", modalUid, true));
  const c = tierOf(lvlInfo(u));
  const av = $("mAv").querySelector(".av");
  if (av) {
    av.style.boxShadow = c.max
      ? "0 0 0 3px #7f1d1d, 0 0 12px 2px rgba(220,38,38,.6)"
      : (c.bd ? "none" : "0 0 0 3px " + c.bg);
  }
}

function drawFollow() {
  const b = $("mFollow");
  b.textContent = followState ? "إلغاء المتابعة" : "متابعة";
  b.className = followState ? "ghost" : "primary";
}

function closeModal() {
  modalUid = null;
  modalTok++;
  $("modal").classList.add("hidden");
}

async function openProfile(uid) {
  if (!me) return;
  modalUid = uid;
  const tok = ++modalTok;
  const u = usersMap[uid] || {};
  const self = uid === me.uid;
  const li = lvlInfo(u);
  $("modal").classList.remove("hidden");
  $("mName").textContent = u.name || "مستخدم";
  $("mUser").textContent = u.username ? "@" + u.username : "";
  $("mBio").textContent = u.bio || "";
  const c = paintBadge($("mLvl"), li, li.max ? "Lv " + MAXLV + " 🏆" : "Lv " + li.lv, "big");
  $("mBar").style.width = li.pct + "%";
  $("mBar").style.background = c.max ? "#7f1d1d" : (c.bd ? "" : c.bg);
  $("mCnt").textContent = li.max ? "وصل للحد الأقصى" : li.cur + " / " + LV + " رسالة للمستوى التالي";
  $("mFers").textContent = "…";
  $("mFing").textContent = "…";
  $("mFollow").classList.toggle("hidden", self);
  $("mMsg").classList.toggle("hidden", self);
  $("mFollow").disabled = true;
  followState = false;
  drawFollow();
  drawModalStatus();
  try {
    const [a, b] = await Promise.all([
      getCountFromServer(query(collection(db, "follows"), where("to", "==", uid))),
      getCountFromServer(query(collection(db, "follows"), where("from", "==", uid)))
    ]);
    if (tok !== modalTok) return;
    $("mFers").textContent = a.data().count;
    $("mFing").textContent = b.data().count;
    if (!self) {
      const s = await getDoc(doc(db, "follows", me.uid + "_" + uid));
      if (tok !== modalTok) return;
      followState = s.exists();
      drawFollow();
      $("mFollow").disabled = false;
    }
  } catch (e) {
    console.error(e);
    if (tok === modalTok) { $("mFers").textContent = "-"; $("mFing").textContent = "-"; }
  }
}

$("mFollow").addEventListener("click", async () => {
  if (!modalUid || modalUid === me.uid) return;
  const ref = doc(db, "follows", me.uid + "_" + modalUid);
  $("mFollow").disabled = true;
  try {
    const n = +$("mFers").textContent || 0;
    if (followState) {
      await deleteDoc(ref);
      followState = false;
      $("mFers").textContent = Math.max(0, n - 1);
    } else {
      await setDoc(ref, { from: me.uid, to: modalUid, at: serverTimestamp() });
      followState = true;
      $("mFers").textContent = n + 1;
    }
    drawFollow();
  } catch (e) {
    console.error(e);
    alert("تعذر تنفيذ العملية.");
  }
  $("mFollow").disabled = false;
});

$("mMsg").addEventListener("click", () => {
  const uid = modalUid;
  const name = (usersMap[uid] || {}).name || "مستخدم";
  closeModal();
  setMode("dm", { uid, name });
});
$("mClose").addEventListener("click", closeModal);
$("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeModal(); });
$("title").addEventListener("click", () => {
  if (mode === "dm" && peer) openProfile(peer.uid);
  else if (mode === "group") $("gInfoBtn").click();
});

/* ---------- حسابي ---------- */
function drawPfAvatar() {
  const box = $("pfAv");
  box.textContent = "";
  box.appendChild(avatarEl(pfPhoto, $("pfName").value || myName(), "big"));
}

function drawLvl() {
  const li = lvlInfo(usersMap[me.uid] || {});
  const box = $("pfLvl");
  box.textContent = "";
  const b = document.createElement("span");
  paintBadge(b, li, "Lv " + li.lv + (li.max ? " 🏆" : ""), "big");
  const t = document.createElement("span");
  t.style.marginInlineStart = "8px";
  t.textContent = li.max ? "المستوى الأقصى" : li.cur + " / " + LV + " رسالة للمستوى التالي";
  box.append(b, t);
}

function fillProfile() {
  const u = usersMap[me.uid] || {};
  pfPhoto = u.photo || "";
  $("pfName").value = u.name || myName();
  $("pfUser").value = u.username || "";
  $("pfBio").value = u.bio || "";
  $("pfMsg").textContent = "";
  $("rdMsg").textContent = "";
  $("cdMsg").textContent = "";
  $("adminTools").classList.toggle("hidden", !isAdmin);
  drawPfAvatar();
  drawLvl();
}

$("pfPick").addEventListener("click", () => $("pfPhoto").click());
$("pfPhoto").addEventListener("change", async () => {
  const f = $("pfPhoto").files[0];
  if (!f) return;
  try { pfPhoto = await makeAvatar(f); drawPfAvatar(); note("pfMsg", "", true); }
  catch (e) { note("pfMsg", "تعذر قراءة الصورة. جرّب صورة ثانية.", false); }
  $("pfPhoto").value = "";
});
$("pfDel").addEventListener("click", () => { pfPhoto = ""; drawPfAvatar(); });
$("pfView").addEventListener("click", () => openProfile(me.uid));

$("pfSave").addEventListener("click", async () => {
  const name = $("pfName").value.trim();
  const uname = $("pfUser").value.trim().toLowerCase().replace(/^@/, "");
  const bio = $("pfBio").value.trim();
  if (!name) { note("pfMsg", "اكتب اسمك.", false); return; }
  if (uname && !/^[a-z0-9_]{3,20}$/.test(uname)) {
    note("pfMsg", "اسم المستخدم: حروف إنجليزية صغيرة وأرقام و _ فقط، من 3 إلى 20.", false);
    return;
  }
  if (["admin", "administrator", "support", "root"].includes(uname)) {
    note("pfMsg", "هذا الاسم محجوز للنظام.", false);
    return;
  }
  $("pfSave").disabled = true;
  note("pfMsg", "جارٍ الحفظ...", true);
  try {
    const old = (usersMap[me.uid] || {}).username || "";
    const batch = writeBatch(db);
    if (uname !== old) {
      if (uname) {
        const s = await getDoc(doc(db, "usernames", uname));
        if (s.exists() && s.data().uid !== me.uid) {
          note("pfMsg", "اسم المستخدم محجوز. اختر اسماً ثانياً.", false);
          $("pfSave").disabled = false;
          return;
        }
        if (!s.exists()) batch.set(doc(db, "usernames", uname), { uid: me.uid });
      }
      if (old) batch.delete(doc(db, "usernames", old));
    }
    batch.set(doc(db, "users", me.uid), { name, username: uname, bio, photo: pfPhoto }, { merge: true });
    await batch.commit();
    await updateProfile(me, { displayName: name });
    updateSub();
    note("pfMsg", "تم الحفظ.", true);
  } catch (e) {
    console.error(e);
    note("pfMsg", "تعذر الحفظ. قد يكون اسم المستخدم محجوزاً، أو لم تنشر القواعد الجديدة.", false);
  }
  $("pfSave").disabled = false;
});

/* ---------- أكواد المستويات ---------- */
$("rdBtn").addEventListener("click", async () => {
  const code = $("rdCode").value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,20}$/.test(code)) { note("rdMsg", "الكود غير صحيح. تأكد من كتابته.", false); return; }
  if (lvlInfo(usersMap[me.uid] || {}).max) { note("rdMsg", "وصلت للمستوى الأقصى أصلاً.", false); return; }
  $("rdBtn").disabled = true;
  note("rdMsg", "جارٍ التحقق...", true);
  try {
    const cref = doc(db, "codes", code);
    const rref = doc(db, "redeems", code + "_" + me.uid);
    const [cs, rs] = await Promise.all([getDoc(cref), getDoc(rref)]);
    if (!cs.exists() || !cs.data().active) { note("rdMsg", "الكود غير صالح.", false); }
    else if (rs.exists()) { note("rdMsg", "استخدمت هذا الكود من قبل.", false); }
    else if (cs.data().uses >= cs.data().maxUses) { note("rdMsg", "هذا الكود انتهى (استُخدم بالكامل).", false); }
    else {
      const lv = cs.data().levels;
      const b = writeBatch(db);
      b.set(rref, { code, uid: me.uid, at: serverTimestamp() });
      b.update(cref, { uses: increment(1) });
      b.update(doc(db, "users", me.uid), { bonus: increment(lv), lastCode: code });
      await b.commit();
      $("rdCode").value = "";
      note("rdMsg", "تم التفعيل! حصلت على " + lv + " مستوى.", true);
    }
  } catch (e) {
    console.error(e);
    note("rdMsg", "تعذر تفعيل الكود. قد يكون استُخدم قبل لحظات أو انتهى.", false);
  }
  $("rdBtn").disabled = false;
});

function randCode() {
  const ch = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const a = new Uint32Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => ch[n % ch.length]).join("");
}

$("atMax").addEventListener("click", async () => {
  if (!isAdmin) return;
  $("atMax").disabled = true;
  try {
    await updateDoc(doc(db, "users", me.uid), { bonus: 998 });
    note("cdMsg", "تم! مستواك الآن الأقصى (999).", true);
  } catch (e) {
    console.error(e);
    note("cdMsg", "تعذر التنفيذ. تأكد من نشر القواعد الجديدة.", false);
  }
  $("atMax").disabled = false;
});

$("cdCreate").addEventListener("click", async () => {
  if (!isAdmin) return;
  const code = ($("cdCode").value.trim().toUpperCase()) || randCode();
  const levels = parseInt($("cdLv").value, 10);
  const maxUses = parseInt($("cdUses").value, 10);
  if (!/^[A-Z0-9]{4,20}$/.test(code)) { note("cdMsg", "الكود: حروف إنجليزية وأرقام فقط، من 4 إلى 20.", false); return; }
  if (!(levels >= 1 && levels <= 998)) { note("cdMsg", "عدد المستويات من 1 إلى 998.", false); return; }
  if (!(maxUses >= 1)) { note("cdMsg", "اكتب عدد مرات الاستخدام (1 أو أكثر).", false); return; }
  $("cdCreate").disabled = true;
  try {
    const ref = doc(db, "codes", code);
    if ((await getDoc(ref)).exists()) { note("cdMsg", "هذا الكود موجود. اختر كوداً ثانياً.", false); }
    else {
      await setDoc(ref, { levels, maxUses, uses: 0, active: true, createdAt: serverTimestamp() });
      $("cdCode").value = "";
      note("cdMsg", "تم إنشاء الكود: " + code, true);
    }
  } catch (e) {
    console.error(e);
    note("cdMsg", "تعذر إنشاء الكود. تأكد من نشر القواعد الجديدة.", false);
  }
  $("cdCreate").disabled = false;
});

function renderCodes(snap) {
  const box = $("cdList");
  box.textContent = "";
  if (snap.empty) { emptyNote(box, "لا توجد أكواد بعد."); return; }
  const rows = [];
  snap.forEach((d) => rows.push(Object.assign({ id: d.id }, d.data({ serverTimestamps: "estimate" }))));
  const ts = (c) => (c.createdAt && c.createdAt.toMillis ? c.createdAt.toMillis() : 0);
  rows.sort((a, b) => ts(b) - ts(a));
  rows.forEach((c) => {
    const row = document.createElement("div");
    row.className = "ban";
    const info = document.createElement("div");
    info.style.minWidth = "0";
    const cd = document.createElement("div");
    cd.className = "code";
    cd.textContent = c.id;
    const sub = document.createElement("small");
    sub.style.cssText = "display:block;color:var(--muted)";
    sub.textContent = "+" + c.levels + " مستوى - استُخدم " + c.uses + " من " + c.maxUses;
    info.append(cd, sub);
    const act = document.createElement("div");
    act.style.cssText = "display:flex;gap:6px";
    const cp = miniBtn("نسخ", () => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(c.id).then(() => { cp.textContent = "تم ✓"; }).catch(() => prompt("انسخ الكود:", c.id));
      } else { prompt("انسخ الكود:", c.id); }
    });
    const del = miniBtn("حذف", () => {
      if (confirm("حذف الكود " + c.id + "؟ (المستويات اللي انمنحت قبل ما تنسحب)")) deleteDoc(doc(db, "codes", c.id)).catch(console.error);
    });
    act.append(cp, del);
    row.append(info, act);
    box.appendChild(row);
  });
}

/* ---------- التنقل ---------- */
function setMode(m, p) {
  mode = m;
  peer = m === "dm" ? p : null;
  grp = m === "group" ? p : null;
  if (unsubMsgs) { unsubMsgs(); unsubMsgs = null; }
  if (unsubGrp) { unsubGrp(); unsubGrp = null; }
  lastMsgSnap = null;
  clearPending();
  closeGInfo();
  const chatLike = m === "public" || m === "dm" || m === "saved" || m === "group";
  $("tabPub").classList.toggle("on", m === "groups" || m === "group" || m === "public");
  $("tabPriv").classList.toggle("on", m === "people" || m === "dm");
  $("tabSaved").classList.toggle("on", m === "saved");
  $("tabProf").classList.toggle("on", m === "profile");
  $("groups").classList.toggle("hidden", m !== "groups");
  $("people").classList.toggle("hidden", m !== "people");
  $("profile").classList.toggle("hidden", m !== "profile");
  $("list").classList.toggle("hidden", !chatLike);
  $("send").classList.toggle("hidden", !chatLike);
  $("back").classList.toggle("hidden", !(m === "dm" || m === "group" || m === "public"));
  $("gInfoBtn").classList.toggle("hidden", m !== "group");
  $("adminBtn").classList.toggle("hidden", !(isAdmin && m === "public"));
  if (m !== "public") $("panel").classList.add("hidden");
  $("title").textContent = ({ groups: "المجموعات", public: "الدردشة العامة", people: "الرسائل الخاصة",
    saved: "الرسائل المحفوظة", profile: "حسابي" })[m] || (m === "group" ? grp.name : peer.name);
  $("text").disabled = false;
  $("list").textContent = "";
  if (m === "profile") fillProfile();

  let q = null;
  if (m === "public") {
    q = query(collection(db, "messages"), orderBy("createdAt", "desc"), limit(50));
  } else if (m === "dm") {
    q = query(collection(db, "chats", chatIdWith(peer.uid), "messages"), orderBy("createdAt", "desc"), limit(50));
  } else if (m === "saved") {
    q = query(collection(db, "users", me.uid, "saved"), orderBy("createdAt", "desc"), limit(50));
  } else if (m === "group") {
    q = query(collection(db, "groups", grp.id, "messages"), orderBy("createdAt", "desc"), limit(50));
    unsubGrp = onSnapshot(doc(db, "groups", grp.id), (s) => {
      if (!s.exists()) { leftGroup(); return; }
      grp = gdoc(s);
      $("title").textContent = grp.name;
      updateSub();
      if (!$("ginfo").classList.contains("hidden")) drawGInfo();
      if (lastMsgSnap) renderMsgs(lastMsgSnap, curOpts());
    }, () => leftGroup());
  }
  if (q) unsubMsgs = onSnapshot(q, (snap) => renderMsgs(snap, curOpts()), (err) => { console.error(err); showDenied(); });
  updateSub();
}

$("tabPub").addEventListener("click", () => setMode("groups"));
$("tabPriv").addEventListener("click", () => setMode("people"));
$("tabSaved").addEventListener("click", () => setMode("saved"));
$("tabProf").addEventListener("click", () => setMode("profile"));
$("back").addEventListener("click", () => setMode(mode === "dm" ? "people" : "groups"));

function stopAll() {
  [unsubMsgs, unsubBan, unsubUsers, unsubInbox, unsubPres, unsubMyG, unsubPubG, unsubGrp, unsubCodes]
    .forEach((u) => { if (u) u(); });
  unsubMsgs = unsubBan = unsubUsers = unsubInbox = unsubPres = unsubMyG = unsubPubG = unsubGrp = unsubCodes = null;
  stopBeat();
  usersMap = {};
  presenceMap = {};
  myGroups = [];
  pubGroups = [];
  grp = null;
  peer = null;
  lastMsgSnap = lastInboxSnap = null;
}

onAuthStateChanged(auth, async (user) => {
  stopAll();
  closeModal();
  closeGInfo();
  me = user;
  isAdmin = false;
  clearPending();
  $("auth").classList.toggle("hidden", !!user);
  $("chat").classList.toggle("hidden", !user);
  $("panel").classList.add("hidden");
  if (!user) return;
  mode = "groups";
  updateSub();

  try { isAdmin = (await getDoc(doc(db, "admins", user.uid))).exists(); } catch (e) {}
  if (auth.currentUser !== user) return;

  try {
    const ref = doc(db, "users", user.uid);
    if (user.displayName) {
      await setDoc(ref, { name: user.displayName }, { merge: true });
    } else if (!(await getDoc(ref)).exists()) {
      await setDoc(ref, { name: (user.email || "").split("@")[0] || "مستخدم" }, { merge: true });
    }
  } catch (e) { console.error(e); }
  if (auth.currentUser !== user) return;

  if (isAdmin) {
    unsubBan = onSnapshot(collection(db, "banned"), renderBanned, console.error);
    unsubCodes = onSnapshot(collection(db, "codes"), renderCodes, console.error);
  }
  unsubUsers = onSnapshot(collection(db, "users"), renderUsers, console.error);
  unsubInbox = onSnapshot(collection(db, "users", user.uid, "inbox"), renderInbox, console.error);
  unsubMyG = onSnapshot(query(collection(db, "groups"), where("members", "array-contains", user.uid)),
    (snap) => { myGroups = snap.docs.map(gdoc); renderGroups(); }, console.error);
  unsubPubG = onSnapshot(query(collection(db, "groups"), where("type", "==", "public"), limit(50)),
    (snap) => { pubGroups = snap.docs.map(gdoc); renderGroups(); }, console.error);
  unsubPres = onSnapshot(collection(db, "presence"), (snap) => {
    presenceMap = {};
    snap.forEach((d) => {
      const v = d.data({ serverTimestamps: "estimate" });
      presenceMap[d.id] = { on: !!v.on, t: v.t && v.t.toMillis ? v.t.toMillis() : Date.now() };
    });
    refreshPresenceUI();
  }, console.error);
  startBeat();
  renderGroups();
  setMode("groups");
});

/* ---------- الإرسال ---------- */
$("send").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("text").value.trim();
  if (!me || (!text && !pending)) return;
  const msg = { uid: me.uid, name: myName(), text, createdAt: serverTimestamp() };
  let preview = text;
  if (pending) {
    if (pending.image) { msg.image = pending.image; preview = text || "📷 صورة"; }
    else { msg.fileName = pending.name; msg.fileData = pending.data; preview = text || "📎 " + pending.name; }
  }
  $("text").value = "";
  clearPending();
  try {
    const b = writeBatch(db);
    const bump = () => b.update(doc(db, "users", me.uid), { msgCount: increment(1) });
    if (mode === "public") {
      b.set(doc(collection(db, "messages")), msg);
      bump();
    } else if (mode === "group" && grp) {
      b.set(doc(collection(db, "groups", grp.id, "messages")), msg);
      bump();
    } else if (mode === "dm" && peer) {
      b.set(doc(collection(db, "chats", chatIdWith(peer.uid), "messages")), msg);
      b.set(doc(db, "users", peer.uid, "inbox", me.uid), { name: myName(), text: preview, at: serverTimestamp() });
      b.set(doc(db, "users", me.uid, "inbox", peer.uid), { name: peer.name, text: preview, at: serverTimestamp() });
      bump();
    } else if (mode === "saved") {
      b.set(doc(collection(db, "users", me.uid, "saved")), msg);
    } else { return; }
    await b.commit();
  } catch (err) {
    console.error(err);
    alert("تعذر الإرسال. تأكد من نشر القواعد الجديدة ومن حجم الملف.");
  }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
/* ===== بداية الإضافات: الردود والإشعارات ===== */
(function () {
  var ls = function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  var sv = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };
  var PN = { snd: ls("pn_snd", "1"), pub: ls("pn_pub", "0") };
  var INIT = +ls("rd_init", 0);
  if (!INIT) { INIT = Date.now(); sv("rd_init", String(INIT)); }
  var reply = null, unread = {}, watching = {}, subs = [], ac = null, tt = null;

  var st = document.createElement("style");
  st.textContent = [
    ".quote{border-inline-start:3px solid currentColor;padding:2px 8px;margin-bottom:4px;font-size:12px;opacity:.85;border-radius:4px;background:rgba(127,127,127,.18);overflow-wrap:anywhere}",
    "#rpl{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 12px;background:var(--card);border-top:1px solid var(--line);color:var(--muted);font-size:14px}",
    "#rpl span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".ndot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#e11d2e;margin-inline-start:4px;vertical-align:middle}",
    "#pnToast{display:none;position:fixed;z-index:30;top:calc(env(safe-area-inset-top,0px) + 8px);left:8px;right:8px;max-width:640px;margin:0 auto;background:var(--card);color:var(--text);border:1px solid var(--line);border-inline-start:4px solid var(--accent);border-radius:12px;padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.25);cursor:pointer}",
    "#pnBox{display:grid;gap:8px;margin-top:8px}",
    "#pnBox h2{margin:12px 0 4px;font-size:16px}",
    "#pnState{font-size:14px;color:var(--muted)}",
    ".pnrow{display:flex;align-items:center;gap:8px;color:var(--text)!important;font-size:15px!important;margin-top:0!important}",
    ".pnrow input{width:auto}"
  ].join("");
  document.head.appendChild(st);

  /* ---------- أدوات ---------- */
  function getRead(k) { return Math.max(INIT, +ls("rd_" + k, 0)); }
  function curKey() {
    if (mode === "public") return "pub";
    if (mode === "group" && grp) return "g:" + grp.id;
    if (mode === "dm" && peer) return "dm:" + peer.uid;
    return null;
  }
  function stripQuote(t) { var x = /^↪ [^\n]*\n([\s\S]*)$/.exec(t || ""); return x ? x[1] : (t || ""); }
  function preview(m) {
    var t = stripQuote(m.text).replace(/\s+/g, " ").trim();
    if (t) return t;
    return m.image ? "📷 صورة" : (m.fileData ? "📎 " + (m.fileName || "ملف") : "");
  }
  function dot(el, on) {
    if (!el) return;
    var d = el.querySelector(".ndot");
    if (on && !d) { d = document.createElement("i"); d.className = "ndot"; el.appendChild(d); }
    else if (!on && d) d.remove();
  }
  function anyKey(p) { return Object.keys(unread).some(function (k) { return k.indexOf(p) === 0; }); }
  function badge(el) {
    var b = document.createElement("span");
    b.className = "tag";
    b.style.background = "#d11a2a";
    b.style.color = "#fff";
    b.textContent = "جديد";
    el.appendChild(b);
  }
  function paint() {
    var n = Object.keys(unread).length;
    document.title = (n ? "(" + n + ") " : "") + "Al-janabi Chat";
    try {
      if (navigator.setAppBadge) {
        var p = n ? navigator.setAppBadge(n) : navigator.clearAppBadge();
        if (p && p.catch) p.catch(function () {});
      }
    } catch (e) {}
    dot($("tabPriv"), anyKey("dm:"));
    dot($("tabPub"), anyKey("g:") || !!unread.pub);
    if (me) { renderGroups(); if (lastInboxSnap) renderInbox(lastInboxSnap); }
  }
  function markRead(k) {
    sv("rd_" + k, String(Date.now()));
    if (unread[k]) { delete unread[k]; paint(); }
  }

  /* ---------- صوت وتنبيه ---------- */
  function unlock() {
    try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === "suspended") ac.resume(); } catch (e) {}
  }
  document.addEventListener("pointerdown", unlock);
  function beep() {
    if (PN.snd !== "1" || !ac) return;
    try {
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = "sine"; o.frequency.value = 880;
      o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(.12, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(.001, ac.currentTime + .25);
      o.start(); o.stop(ac.currentTime + .25);
    } catch (e) {}
  }
  function toast(title, body, key) {
    var t = $("pnToast");
    if (!t) { t = document.createElement("div"); t.id = "pnToast"; document.body.appendChild(t); }
    t.textContent = "";
    var a = document.createElement("b"); a.textContent = title;
    var b = document.createElement("div"); b.textContent = body;
    t.append(a, b);
    t.style.display = "block";
    t.onclick = function () { t.style.display = "none"; openKey(key); };
    clearTimeout(tt);
    tt = setTimeout(function () { t.style.display = "none"; }, 5000);
  }
  function showSys(title, body, key) {
    if (!window.Notification || Notification.permission !== "granted" || !navigator.serviceWorker) return;
    navigator.serviceWorker.getRegistration().then(function (r) {
      if (r) r.showNotification(title, { body: body, tag: key, renotify: true, vibrate: [80, 40, 80], data: { key: key } });
    }).catch(function () {});
  }
  function alertUser(label, m, key) {
    beep();
    if (navigator.vibrate) navigator.vibrate(60);
    var body = (m.name || "") + ": " + preview(m);
    if (document.visibilityState === "visible") toast(label, body, key); else showSys(label, body, key);
  }
  function openKey(key) {
    if (!me || !key) return;
    if (key === "pub") { setMode("public"); return; }
    if (key.indexOf("g:") === 0) {
      var g = myGroups.filter(function (x) { return x.id === key.slice(2); })[0];
      if (g) setMode("group", g);
      return;
    }
    if (key.indexOf("dm:") === 0) {
      var uid = key.slice(3), u = usersMap[uid] || {};
      setMode("dm", { uid: uid, name: u.name || "مستخدم" });
    }
  }
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener("message", function (e) { if (e.data && e.data.open) openKey(e.data.open); });
  }

  /* ---------- مراقبة الرسائل الجديدة ---------- */
  function watch(key, label, q) {
    if (watching[key] || Object.keys(watching).length >= 40) return;
    var first = true, lastId = "";
    watching[key] = onSnapshot(q, function (snap) {
      var d = snap.docs[0];
      if (!d) return;
      var m = d.data({ serverTimestamps: "estimate" });
      var uid = auth.currentUser && auth.currentUser.uid;
      var ts = m.createdAt && m.createdAt.toMillis ? m.createdAt.toMillis() : Date.now();
      if (first) {
        first = false; lastId = d.id;
        if (m.uid !== uid && ts > getRead(key) && curKey() !== key) { unread[key] = true; paint(); }
        return;
      }
      if (d.id === lastId) return;
      lastId = d.id;
      if (m.uid === uid) return;
      if (curKey() === key && document.visibilityState === "visible") { sv("rd_" + key, String(Date.now())); return; }
      unread[key] = true;
      paint();
      alertUser(label, m, key);
    }, function () { if (watching[key]) { watching[key](); delete watching[key]; } });
  }
  function watchPub() {
    watch("pub", "الدردشة العامة", query(collection(db, "messages"), orderBy("createdAt", "desc"), limit(1)));
  }
  function startNotif(u) {
    subs.push(onSnapshot(collection(db, "users", u.uid, "inbox"), function (s) {
      s.forEach(function (d) {
        watch("dm:" + d.id, d.data().name || "رسالة خاصة",
          query(collection(db, "chats", [u.uid, d.id].sort().join("_"), "messages"), orderBy("createdAt", "desc"), limit(1)));
      });
    }, function () {}));
    subs.push(onSnapshot(query(collection(db, "groups"), where("members", "array-contains", u.uid)), function (s) {
      s.forEach(function (d) {
        watch("g:" + d.id, d.data().name || "مجموعة",
          query(collection(db, "groups", d.id, "messages"), orderBy("createdAt", "desc"), limit(1)));
      });
    }, function () {}));
    if (PN.pub === "1") watchPub();
  }
  function stopNotif() {
    subs.forEach(function (f) { f(); });
    subs = [];
    Object.keys(watching).forEach(function (k) { watching[k](); });
    watching = {};
    unread = {};
    paint();
  }
  onAuthStateChanged(auth, function (u) {
    stopNotif();
    if (u) startNotif(u); else clearReply();
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") { var k = curKey(); if (k) markRead(k); }
  });

  /* ---------- الرد على رسالة ---------- */
  var rp = document.createElement("div");
  rp.id = "rpl"; rp.className = "hidden";
  var rt = document.createElement("span"); rt.id = "rplT";
  var rx = document.createElement("button");
  rx.type = "button"; rx.className = "mini"; rx.textContent = "إلغاء";
  rx.onclick = function () { clearReply(); };
  rp.append(rt, rx);
  $("chip").parentNode.insertBefore(rp, $("chip"));

  function clearReply() { reply = null; rp.classList.add("hidden"); }
  function setReply(m) {
    var u = usersMap[m.uid] || {};
    reply = { name: u.name || m.name || "مستخدم", text: preview(m).slice(0, 60) };
    rt.textContent = "ردًا على " + reply.name + ": " + reply.text;
    rp.classList.remove("hidden");
    $("text").focus();
  }
  document.addEventListener("submit", function (e) {
    if (!e.target || e.target.id !== "send" || !reply) return;
    var v = $("text").value.trim();
    if (v || pending) $("text").value = ("↪ " + reply.name + ": " + reply.text + "\n" + v).slice(0, 1000);
    setTimeout(clearReply, 0);
  }, true);

  function decorate(snap, opts) {
    if (snap.empty) return;
    var docs = snap.docs.slice().reverse(), lines = $("list").children;
    docs.forEach(function (d, i) {
      var line = lines[i];
      if (!line || !line.classList.contains("line")) return;
      var box = line.querySelector(".msg");
      if (!box) return;
      var m = d.data({ serverTimestamps: "estimate" });
      var mm = /^↪ ([^\n]*)\n([\s\S]*)$/.exec(m.text || "");
      if (mm) {
        for (var j = 0; j < box.children.length; j++) {
          var ch = box.children[j];
          if (ch.tagName === "DIV" && ch.textContent === m.text && !ch.classList.contains("who") && !ch.classList.contains("bar")) {
            ch.textContent = "";
            var q = document.createElement("div");
            q.className = "quote"; q.textContent = mm[1];
            ch.appendChild(q);
            if (mm[2]) { var r = document.createElement("div"); r.textContent = mm[2]; ch.appendChild(r); }
            break;
          }
        }
      }
      if (!opts.saved) {
        var bar = box.querySelector(".bar");
        if (bar) bar.insertBefore(miniBtn("رد", function () { setReply(m); }), bar.firstChild);
      }
    });
  }

  /* ---------- ربط الإضافات بالتطبيق ---------- */
  var _renderMsgs = renderMsgs;
  renderMsgs = function (snap, opts) { _renderMsgs(snap, opts); decorate(snap, opts); };

  var _renderInbox = renderInbox;
  renderInbox = function (snap) {
    _renderInbox(snap);
    var rows = [];
    snap.forEach(function (d) {
      var m = d.data({ serverTimestamps: "estimate" });
      rows.push({ id: d.id, t: m.at && m.at.toMillis ? m.at.toMillis() : 0 });
    });
    rows.sort(function (a, b) { return b.t - a.t; });
    var kids = $("inboxList").children;
    rows.forEach(function (r, i) { if (kids[i] && unread["dm:" + r.id]) badge(kids[i]); });
  };

  var _renderGroups = renderGroups;
  renderGroups = function () {
    _renderGroups();
    if (!me) return;
    var kids = $("myGroups").children;
    if (kids[0] && unread.pub) badge(kids[0]);
    myGroups.slice().sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); }).forEach(function (g, i) {
      if (kids[i + 1] && unread["g:" + g.id]) badge(kids[i + 1]);
    });
  };

  var _setMode = setMode;
  setMode = function (m, p) {
    _setMode(m, p);
    clearReply();
    var k = curKey();
    if (k) markRead(k);
  };

  /* ---------- إعدادات الإشعارات في تبويب حسابي ---------- */
  function buildSettings() {
    var p = $("profile");
    if (!p || $("pnBox")) return;
    var box = document.createElement("div");
    box.id = "pnBox";
    var h = document.createElement("h2"); h.textContent = "الإشعارات";
    var s = document.createElement("div"); s.id = "pnState";
    var b1 = document.createElement("button"); b1.type = "button"; b1.className = "primary"; b1.textContent = "تفعيل إشعارات الجهاز";
    var b2 = document.createElement("button"); b2.type = "button"; b2.className = "ghost"; b2.textContent = "تجربة إشعار";
    function state() {
      s.textContent = !window.Notification ? "غير مدعومة بهذا المتصفح. على الآيفون ثبّت التطبيق على الشاشة الرئيسية أولاً."
        : Notification.permission === "granted" ? "إشعارات الجهاز مفعّلة."
        : Notification.permission === "denied" ? "الإشعارات محظورة. فعّلها من إعدادات المتصفح لهذا الموقع."
        : "إشعارات الجهاز غير مفعّلة.";
    }
    b1.onclick = function () {
      if (window.Notification) { var r = Notification.requestPermission(); if (r && r.then) r.then(state); else state(); }
    };
    b2.onclick = function () {
      if (window.Notification && Notification.permission === "granted") showSys("Al-janabi Chat", "إذا شفت هذي الرسالة فالإشعارات تعمل.", "test");
      else alert("فعّل إشعارات الجهاز أولاً.");
    };
    function chk(text, key) {
      var l = document.createElement("label"); l.className = "pnrow";
      var i = document.createElement("input"); i.type = "checkbox"; i.checked = PN[key] === "1";
      i.onchange = function () {
        PN[key] = i.checked ? "1" : "0"; sv("pn_" + key, PN[key]);
        if (key === "pub") {
          if (i.checked) watchPub();
          else if (watching.pub) { watching.pub(); delete watching.pub; delete unread.pub; paint(); }
        }
      };
      l.append(i, document.createTextNode(text));
      return l;
    }
    box.append(h, s, b1, b2, chk("صوت عند وصول رسالة", "snd"), chk("إشعارات الدردشة العامة", "pub"));
    p.appendChild(box);
    state();
  }
  buildSettings();
})();
/* ===== نهاية الإضافات ===== */
/* ===== تعديل الرد: اليوزر فقط ===== */
(function () {
  var ruid = null;
  function labelOf(uid) {
    var u = usersMap[uid] || {};
    return u.username ? "@" + u.username : (u.name || "مستخدم");
  }
  var _rm = renderMsgs;
  renderMsgs = function (snap, opts) {
    _rm(snap, opts);
    if (snap.empty) return;
    var docs = snap.docs.slice().reverse(), lines = $("list").children;
    docs.forEach(function (d, i) {
      var line = lines[i];
      if (!line) return;
      var uid = d.data().uid;
      var btns = line.querySelectorAll(".bar .mini");
      for (var j = 0; j < btns.length; j++) {
        if (btns[j].textContent === "رد") {
          btns[j].addEventListener("click", function () {
            ruid = uid;
            $("rplT").textContent = "ردًا على " + labelOf(uid);
          });
        }
      }
    });
  };
  document.addEventListener("submit", function (e) {
    if (!e.target || e.target.id !== "send" || !ruid) return;
    var v = $("text").value;
    if (v.indexOf("↪ ") === 0) {
      var nl = v.indexOf("\n");
      if (nl > 0) $("text").value = ("↪ " + labelOf(ruid) + v.slice(nl)).slice(0, 1000);
    }
    ruid = null;
  }, true);
})();
/* ===== نهاية تعديل الرد ===== */
/* ===== بداية: رد بنمط واتساب + تفاعلات ===== */
(function () {
  var EM = ["😂", "❤️", "😮", "🥲", "💔", "🤔"];
  var rep = null, rx = {}, unRx = null;

  var st = document.createElement("style");
  st.textContent = [
    ".quote{display:block;border-inline-start:4px solid #a78bfa;padding:4px 8px;margin-bottom:6px;border-radius:6px;background:rgba(127,127,127,.2);font-size:13px;opacity:1}",
    ".quote b{display:block;font-size:12px;color:#a78bfa;font-weight:700}",
    ".line.mine .quote b{color:inherit}",
    ".quote i{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-style:normal;opacity:.85}",
    ".rxs{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}",
    ".rxc{font-size:13px;padding:1px 7px;border-radius:12px;border:1px solid currentColor;background:rgba(127,127,127,.18);cursor:pointer}",
    ".rxc.mine{background:rgba(167,139,250,.35)}",
    ".rxp{display:flex;gap:2px;margin-top:6px;padding:4px;border-radius:20px;background:rgba(127,127,127,.25);width:max-content;max-width:100%}",
    ".rxp button{background:transparent;border:0;font-size:22px;padding:2px 6px}"
  ].join("");
  document.head.appendChild(st);

  function labelOf(uid) { var u = usersMap[uid] || {}; return u.username ? "@" + u.username : (u.name || "مستخدم"); }
  function prev(m) {
    var t = (m.text || "").replace(/^↪ [^\n]*\n/, "").replace(/\s+/g, " ").trim().slice(0, 60);
    return t || (m.image ? "📷 صورة" : (m.fileData ? "📎 " + (m.fileName || "ملف") : ""));
  }
  function rkey() {
    if (mode === "public") return "pub";
    if (mode === "group" && grp) return "g_" + grp.id;
    if (mode === "dm" && peer && me) return "d_" + [me.uid, peer.uid].sort().join("_");
    return null;
  }

  function stopRx() { if (unRx) { unRx(); unRx = null; } rx = {}; }
  function startRx() {
    stopRx();
    var k = rkey();
    if (!k) return;
    unRx = onSnapshot(query(collection(db, "reactions"), where("k", "==", k), limit(1000)), function (s) {
      rx = {};
      s.forEach(function (d) { var v = d.data(); (rx[v.m] = rx[v.m] || {})[v.uid] = v.e; });
      drawRx();
    }, function () {});
  }

  function react(mid, code) {
    var k = rkey();
    if (!k || !me) return;
    var ref = doc(db, "reactions", mid + "_" + me.uid);
    var cur = (rx[mid] || {})[me.uid];
    var p = cur === code ? deleteDoc(ref) : setDoc(ref, { k: k, m: mid, uid: me.uid, e: code });
    p.catch(function () { alert("تعذر التفاعل. تأكد من نشر القواعد الجديدة."); });
  }

  function drawRx() {
    if (!me) return;
    Array.prototype.forEach.call($("list").querySelectorAll(".line"), function (line) {
      var mid = line.dataset.mid, box = line.querySelector(".msg");
      if (!mid || !box) return;
      var old = box.querySelector(".rxs");
      if (old) old.remove();
      var r = rx[mid];
      if (!r) return;
      var cnt = {}, mine = null;
      Object.keys(r).forEach(function (u) {
        cnt[r[u]] = (cnt[r[u]] || 0) + 1;
        if (u === me.uid) mine = r[u];
      });
      var codes = Object.keys(cnt);
      if (!codes.length) return;
      var row = document.createElement("div");
      row.className = "rxs";
      codes.sort().forEach(function (c) {
        var s = document.createElement("span");
        s.className = "rxc" + (mine === c ? " mine" : "");
        s.textContent = EM[+c - 1] + " " + cnt[c];
        s.onclick = function () { react(mid, c); };
        row.appendChild(s);
      });
      box.insertBefore(row, box.querySelector(".bar"));
    });
  }

  function togglePick(box, mid) {
    var ex = box.querySelector(".rxp");
    if (ex) { ex.remove(); return; }
    var p = document.createElement("div");
    p.className = "rxp";
    EM.forEach(function (e, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = e;
      b.onclick = function () { p.remove(); react(mid, String(i + 1)); };
      p.appendChild(b);
    });
    box.insertBefore(p, box.querySelector(".bar"));
  }

  var _rm = renderMsgs;
  renderMsgs = function (snap, opts) {
    _rm(snap, opts);
    if (snap.empty) return;
    var docs = snap.docs.slice().reverse(), lines = $("list").children;
    docs.forEach(function (d, i) {
      var line = lines[i];
      if (!line || !line.classList.contains("line")) return;
      var m = d.data({ serverTimestamps: "estimate" });
      line.dataset.mid = d.id;
      var box = line.querySelector(".msg"), bar = box && box.querySelector(".bar");
      if (!bar) return;
      Array.prototype.forEach.call(bar.querySelectorAll(".mini"), function (b) {
        if (b.textContent === "رد") {
          b.addEventListener("click", function () {
            rep = { uid: m.uid, text: prev(m) };
            var t = $("rplT");
            if (t) t.textContent = "ردًا على " + labelOf(m.uid) + ": " + rep.text;
          });
        }
      });
      if (!opts.saved && rkey()) {
        bar.insertBefore(miniBtn("😊", function () { togglePick(box, d.id); }), bar.firstChild);
      }
    });
    Array.prototype.forEach.call($("list").querySelectorAll(".quote"), function (q) {
      var s = q.textContent, k = s.indexOf(" ‖ "), n = 3;
      if (k < 0) { k = s.indexOf(": "); n = 2; }
      var nm = k < 0 ? s : s.slice(0, k), tx = k < 0 ? "" : s.slice(k + n);
      q.textContent = "";
      var b = document.createElement("b");
      b.textContent = nm;
      q.appendChild(b);
      if (tx) { var i2 = document.createElement("i"); i2.textContent = tx; q.appendChild(i2); }
    });
    drawRx();
  };

  document.addEventListener("submit", function (e) {
    if (!e.target || e.target.id !== "send" || !rep) return;
    var v = $("text").value;
    if (v.indexOf("↪ ") === 0) {
      var nl = v.indexOf("\n");
      if (nl > 0) $("text").value = ("↪ " + labelOf(rep.uid) + " ‖ " + rep.text + v.slice(nl)).slice(0, 1000);
    }
    rep = null;
  }, true);

  var _sm = setMode;
  setMode = function (m, p) { _sm(m, p); rep = null; startRx(); };
  onAuthStateChanged(auth, function (u) { if (!u) stopRx(); });
})();
/* ===== نهاية: رد بنمط واتساب + تفاعلات ===== */
