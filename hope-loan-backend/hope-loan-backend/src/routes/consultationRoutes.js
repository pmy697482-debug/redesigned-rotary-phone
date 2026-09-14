const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { authRequired, requireRole } = require('../middleware/auth');

function getNextStaff(db) {
  const accounts = db.prepare('SELECT username, name FROM accounts ORDER BY rowid ASC').all();
  if (accounts.length === 0) throw new Error('등록된 담당자 계정이 없어요.');

  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('assignment_pointer');
  const pointer = row ? parseInt(row.value, 10) : 0;
  const staff = accounts[pointer % accounts.length];
  const next = (pointer + 1) % accounts.length;

  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('assignment_pointer', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(next));

  return staff;
}

module.exports = function (db, io, push) {
  const router = express.Router();

  const submitLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '신청이 너무 자주 발생했어요. 잠시 후 다시 시도해 주세요.' }
  });

  // 고객: 신규 상담 신청 (인증 불필요)
  router.post('/', submitLimiter, (req, res) => {
    const { name, phone, amount } = req.body || {};
    if (!name || !phone || !amount) {
      return res.status(400).json({ error: '이름, 연락처, 필요 금액을 모두 입력해 주세요.' });
    }

    let staff;
    try {
      staff = getNextStaff(db);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO consultations
       (id, name, phone, amount, assigned_username, assigned_name, status, created_at, last_message_at)
       VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?)`
    ).run(id, String(name).trim(), String(phone).trim(), String(amount).trim(), staff.username, staff.name, now, now);

    db.prepare(
      'INSERT INTO messages (consultation_id, sender, sender_name, text, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, 'system', null, staff.name + ' 담당자가 배정되었습니다. 곧 답변드릴게요.', now);

    io.to('staff:' + staff.username)
      .to('staff:all')
      .emit('new-consultation', { id, name, amount, assignedName: staff.name });

    // 앱이 꺼져 있어도 담당자에게 푸시 알림 발송 (실패해도 신청 자체는 정상 처리)
    push
      .sendToStaff(
        staff.username,
        { title: '새 상담 신청', body: name + '님이 상담을 신청했어요 (' + amount + '만원)' },
        { consultationId: id }
      )
      .catch(function (e) { console.error('[push]', e.message); });

    res.json({ id, assignedName: staff.name });
  });

  // 고객: 연락처로 최근 상담 이어가기 (인증 불필요)
  router.get('/lookup', (req, res) => {
    const phone = req.query.phone;
    if (!phone) return res.status(400).json({ error: '연락처를 입력해 주세요.' });
    const row = db
      .prepare('SELECT * FROM consultations WHERE phone = ? ORDER BY created_at DESC LIMIT 1')
      .get(String(phone).trim());
    if (!row) return res.status(404).json({ error: '일치하는 신청 내역이 없어요.' });
    res.json(row);
  });

  // 담당자: 목록 조회 (총관리자는 전체, 서브관리자는 본인 배정 건만)
  router.get('/', authRequired, (req, res) => {
    const rows =
      req.user.role === 'super'
        ? db.prepare('SELECT * FROM consultations ORDER BY last_message_at DESC').all()
        : db
            .prepare('SELECT * FROM consultations WHERE assigned_username = ? ORDER BY last_message_at DESC')
            .all(req.user.username);
    res.json(rows);
  });

  // 상담 상세 조회 (채팅 화면 헤더 등에서 사용, 상담 id 자체가 접근키 역할)
  router.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM consultations WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: '상담을 찾을 수 없어요.' });
    res.json(row);
  });

  // 상담 메시지 목록 (상담 id를 아는 고객 본인, 또는 담당자/총관리자)
  router.get('/:id/messages', (req, res) => {
    const exists = db.prepare('SELECT 1 FROM consultations WHERE id = ?').get(req.params.id);
    if (!exists) return res.status(404).json({ error: '상담을 찾을 수 없어요.' });
    const rows = db
      .prepare('SELECT sender, sender_name, text, created_at FROM messages WHERE consultation_id = ? ORDER BY id ASC')
      .all(req.params.id);
    res.json(rows);
  });

  // 총관리자: 신청 정보 수정
  router.put('/:id', authRequired, requireRole('super'), (req, res) => {
    const row = db.prepare('SELECT * FROM consultations WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: '상담을 찾을 수 없어요.' });
    const { name, phone, amount } = req.body || {};
    db.prepare('UPDATE consultations SET name = ?, phone = ?, amount = ? WHERE id = ?').run(
      (name || row.name).trim(),
      (phone || row.phone).trim(),
      (amount || row.amount).toString().trim(),
      req.params.id
    );
    res.json({ ok: true });
  });

  // 총관리자: 신청 삭제
  router.delete('/:id', authRequired, requireRole('super'), (req, res) => {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM messages WHERE consultation_id = ?').run(req.params.id);
      db.prepare('DELETE FROM consultations WHERE id = ?').run(req.params.id);
    });
    tx();
    res.json({ ok: true });
  });

  return router;
};
