const express = require('express');
const bcrypt = require('bcryptjs');
const { authRequired, requireRole } = require('../middleware/auth');

module.exports = function (db) {
  const router = express.Router();

  // 아래 모든 엔드포인트는 로그인 + 총관리자 권한이 필요합니다.
  router.use(authRequired, requireRole('super'));

  router.get('/', (req, res) => {
    const rows = db
      .prepare('SELECT username, role, name FROM accounts ORDER BY rowid ASC')
      .all();
    res.json(rows);
  });

  // 서브관리자(또는 본인 포함)의 아이디/비밀번호 변경
  router.put('/:username', (req, res) => {
    const target = db.prepare('SELECT * FROM accounts WHERE username = ?').get(req.params.username);
    if (!target) return res.status(404).json({ error: '계정을 찾을 수 없어요.' });

    const { newUsername, newPassword } = req.body || {};
    let usernameToUse = target.username;

    if (newUsername && newUsername !== target.username) {
      const dupe = db.prepare('SELECT 1 FROM accounts WHERE username = ?').get(newUsername);
      if (dupe) return res.status(409).json({ error: '이미 사용 중인 아이디예요.' });
      usernameToUse = newUsername;
    }

    const passwordHash = newPassword ? bcrypt.hashSync(newPassword, 10) : target.password_hash;

    const tx = db.transaction(() => {
      db.prepare('UPDATE accounts SET username = ?, password_hash = ? WHERE username = ?').run(
        usernameToUse,
        passwordHash,
        target.username
      );
      if (usernameToUse !== target.username) {
        db.prepare('UPDATE consultations SET assigned_username = ? WHERE assigned_username = ?').run(
          usernameToUse,
          target.username
        );
      }
    });
    tx();

    res.json({ ok: true, username: usernameToUse });
  });

  return router;
};
