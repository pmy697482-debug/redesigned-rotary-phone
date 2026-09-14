const admin = require('firebase-admin');

let initialized = false;
let initTried = false;

function ensureInit() {
  if (initTried) return;
  initTried = true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.warn(
      '[push] FIREBASE_SERVICE_ACCOUNT_JSON 환경변수가 없어서 푸시 알림 발송을 건너뛰어요. ' +
        '앱 내 실시간 알림(소켓)은 정상 동작해요.'
    );
    return;
  }
  try {
    const serviceAccount = JSON.parse(raw);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    initialized = true;
    console.log('[push] Firebase 초기화 완료 — 푸시 알림이 활성화됐어요.');
  } catch (e) {
    console.error('[push] Firebase 초기화 실패:', e.message);
  }
}

async function sendToTokens(tokens, notification, data) {
  ensureInit();
  if (!initialized || tokens.length === 0) {
    return { successCount: 0, invalidTokens: [] };
  }

  const message = {
    tokens: tokens,
    notification: notification,
    data: data || {},
    android: { priority: 'high' },
    apns: { payload: { aps: { sound: 'default' } } }
  };

  let res;
  try {
    res = await admin.messaging().sendEachForMulticast(message);
  } catch (e) {
    console.error('[push] 발송 실패:', e.message);
    return { successCount: 0, invalidTokens: [] };
  }

  const invalidTokens = [];
  res.responses.forEach(function (r, i) {
    if (!r.success) {
      const code = r.error && r.error.code;
      if (
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/registration-token-not-registered'
      ) {
        invalidTokens.push(tokens[i]);
      }
    }
  });
  return { successCount: res.successCount, invalidTokens: invalidTokens };
}

// db를 받아 담당자(username)에게 등록된 모든 기기로 푸시를 보내는 헬퍼를 만들어 반환합니다.
module.exports = function (db) {
  return {
    async sendToStaff(username, notification, data) {
      const rows = db.prepare('SELECT token FROM device_tokens WHERE username = ?').all(username);
      if (rows.length === 0) return;
      const tokens = rows.map(function (r) { return r.token; });
      const result = await sendToTokens(tokens, notification, data);
      if (result.invalidTokens.length) {
        const del = db.prepare('DELETE FROM device_tokens WHERE token = ?');
        result.invalidTokens.forEach(function (t) { del.run(t); });
      }
    }
  };
};
