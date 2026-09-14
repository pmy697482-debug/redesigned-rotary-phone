const jwt = require('jsonwebtoken');

function getSecret() {
  return process.env.JWT_SECRET || 'dev-secret-change-me';
}

// Authorization: Bearer <token> 헤더를 검사해 req.user에 {username, role, name}을 채웁니다.
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  try {
    req.user = jwt.verify(token, getSecret());
    next();
  } catch (e) {
    return res.status(401).json({ error: '세션이 만료되었어요. 다시 로그인해 주세요.' });
  }
}

function requireRole(role) {
  return function (req, res, next) {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: '이 작업을 수행할 권한이 없어요.' });
    }
    next();
  };
}

module.exports = { authRequired, requireRole, getSecret };
