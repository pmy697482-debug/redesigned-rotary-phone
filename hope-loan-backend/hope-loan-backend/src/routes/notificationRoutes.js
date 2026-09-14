const express = require('express');
const { authRequired } = require('../middleware/auth');

module.exports = function (db) {
  const router = express.Router();
  router.use(authRequired);

  // 담당자 로그인 후, 앱(네이티브)에서 발급받은 FCM 토큰을 등록
  router.post('/register-token', (req, res) => {
    const { token, platform } = req.body || {};
    if (!token) return res.status(400).json({ error: '기기 토큰이 없어요.' });
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO device_tokens (token, username, platform, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET username = excluded.username, platform = excluded.platform, updated_at = excluded.updated_at`
    ).run(token, req.user.username, platform || 'unknown', now);
    res.json({ ok: true });
  });

  // 로그아웃 시 토큰 해제 (선택)
  router.delete('/register-token', (req, res) => {
    const { token } = req.body || {};
    if (token) db.prepare('DELETE FROM device_tokens WHERE token = ?').run(token);
    res.json({ ok: true });
  });

  return router;
};
