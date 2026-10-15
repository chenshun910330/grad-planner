// 研途手帳的推播發送器：GitHub Actions 每 15 分鐘執行一次
//   1. 送出到期的行程／進度提醒（reminders 佇列）
//   2. 上課前提醒（有開啟的使用者，依課表計算）
//   3. 清掉 30 天前已送出的舊提醒
// 參數：--dry-run 只印出會送什麼，不真的送、不改資料庫
const admin = require('firebase-admin');

const DRY = process.argv.includes('--dry-run');
const APP_URL = process.env.APP_URL || '';
const DAY = 86400000;

if (process.env.FIRESTORE_EMULATOR_HOST) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-grad-planner' });
} else {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('缺少環境變數 FIREBASE_SERVICE_ACCOUNT（服務帳戶金鑰 JSON）');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const db = admin.firestore();

const NTHU_SLOTS = [['1', '08:00'], ['2', '09:00'], ['3', '10:10'], ['4', '11:10'], ['n', '12:10'], ['5', '13:20'], ['6', '14:20'],
  ['7', '15:30'], ['8', '16:30'], ['9', '17:30'], ['a', '18:30'], ['b', '19:30'], ['c', '20:30']].map(([code, start]) => ({ code, start }));
const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// GitHub 的機器是 UTC，台灣固定 +8、沒有日光節約
function taipeiNow(now = Date.now()) {
  const t = new Date(now + 8 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  return {
    date: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`,
    dow: ((t.getUTCDay() + 6) % 7) + 1, // 1=週一 … 7=週日
    minutes: t.getUTCHours() * 60 + t.getUTCMinutes(),
  };
}

const tokenCache = new Map();
async function tokensOf(uid) {
  if (!tokenCache.has(uid)) {
    const qs = await db.collection('users').doc(uid).collection('tokens').get();
    tokenCache.set(uid, qs.docs.map(d => d.id));
  }
  return tokenCache.get(uid);
}

async function push(uid, title, body, tag) {
  const tokens = await tokensOf(uid);
  if (!tokens.length) { console.log(`  [略過] ${uid} 沒有任何裝置開啟通知：${title}`); return 0; }
  if (DRY) { console.log(`  [dry-run] → ${tokens.length} 台裝置：${title}｜${body}`); return tokens.length; }
  const webpush = { notification: { icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag } };
  if (APP_URL.startsWith('https://')) webpush.fcmOptions = { link: APP_URL };
  const res = await admin.messaging().sendEachForMulticast({ tokens, notification: { title, body }, webpush });
  const dead = [];
  res.responses.forEach((r, i) => {
    if (r.success) return;
    const code = r.error?.code || '';
    console.log(`  [失敗] ${code} ${r.error?.message || ''}`);
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') dead.push(tokens[i]);
  });
  // 解除安裝或清掉瀏覽器資料的裝置，token 會失效，順手刪掉
  for (const t of dead) await db.collection('users').doc(uid).collection('tokens').doc(t).delete();
  if (dead.length) tokenCache.set(uid, tokens.filter(t => !dead.includes(t)));
  console.log(`  [送出] ${title} → 成功 ${res.successCount}／共 ${tokens.length}`);
  return res.successCount;
}

async function sendDueReminders(now) {
  const qs = await db.collection('reminders').where('sent', '==', false).where('fireAt', '<=', now).get();
  console.log(`到期提醒：${qs.size} 則`);
  for (const doc of qs.docs) {
    const r = doc.data();
    // 行程已經開始、或排程停擺太久，就不補發
    const stale = (r.eventAt && now > r.eventAt) || now - r.fireAt > DAY;
    if (stale) {
      console.log(`  [過期不發] ${r.title}`);
      if (!DRY) await doc.ref.update({ sent: true, skipped: 'stale', sentAt: now });
      continue;
    }
    const n = await push(r.uid, r.title, r.body, doc.id);
    if (!DRY) await doc.ref.update({ sent: true, sentAt: now, delivered: n });
  }
}

async function sendClassReminders(now) {
  const tp = taipeiNow(now);
  const users = await db.collection('users').where('classReminder', '==', true).get();
  console.log(`上課提醒：${users.size} 位使用者有開啟（台灣時間 ${tp.date} 週${'一二三四五六日'[tp.dow - 1]} ${Math.floor(tp.minutes / 60)}:${String(tp.minutes % 60).padStart(2, '0')}）`);
  for (const u of users.docs) {
    const p = u.data();
    if ((p.semesterStart && tp.date < p.semesterStart) || (p.semesterEnd && tp.date > p.semesterEnd)) continue;
    const lead = p.classLead || 10;
    const slots = p.slots?.length ? p.slots : NTHU_SLOTS;
    const courses = await u.ref.collection('courses').where('day', '==', tp.dow).get();
    for (const c of courses.docs) {
      const k = c.data(), slot = slots.find(s => s.code === k.startSlot);
      if (!slot) continue;
      const start = toMin(slot.start);
      // 排程每 15 分鐘跑一次，所以從「目標時間前 7 分鐘」到上課前都算數，再用 classSent 防止重複
      if (tp.minutes < start - lead - 7 || tp.minutes >= start) continue;
      const mark = u.ref.collection('classSent').doc(`${tp.date}_${c.id}`);
      if (!DRY) {
        try { await mark.create({ at: now }); } catch { continue; } // 已經送過
      }
      const left = start - tp.minutes;
      await push(u.id, `${left} 分鐘後上課｜${k.name}`, `${slot.start} 開始・第 ${k.startSlot === k.endSlot ? k.startSlot : `${k.startSlot}–${k.endSlot}`} 節${k.room ? '・' + k.room : ''}`, `class-${c.id}`);
    }
  }
}

async function cleanup(now) {
  if (DRY) return;
  const old = await db.collection('reminders').where('sent', '==', true).where('fireAt', '<', now - 30 * DAY).limit(300).get();
  const b = db.batch(); old.forEach(d => b.delete(d.ref));
  if (old.size) { await b.commit(); console.log(`清掉 ${old.size} 則舊提醒`); }
}

(async () => {
  const now = Date.now();
  console.log(DRY ? '=== dry-run（不會真的送出）===' : '=== 開始發送 ===');
  await sendDueReminders(now);
  await sendClassReminders(now);
  await cleanup(now);
  console.log('完成');
})().catch(e => { console.error(e); process.exit(1); });
