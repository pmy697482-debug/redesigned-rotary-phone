const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { getSecret } = require('../middleware/auth');

module.exports = function (db) {
  const router = express.Router();

  // 무차별 대입 로그인 시도를 막기 위한 요청 제한
  const loginLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '로그인 시도가 너무 많아요. 잠시 후 다시 시도해 주세요.' }
  });

  router.post('/login', loginLimiter, (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: '아이디와 비밀번호를 입력해 주세요.' });
    }

    const account = db.prepare('SELECT * FROM accounts WHERE username = ?').get(username);
    if (!account || !bcrypt.compareSync(password, account.password_hash)) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않아요.' });
    }

    const payload = { username: account.username, role: account.role, name: account.name };
    const token = jwt.sign(payload, getSecret(), { expiresIn: '12h' });
    res.json({ token, user: payload });
  });

  return router;
};
