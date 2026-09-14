const jwt = require('jsonwebtoken');
const { getSecret } = require('../middleware/auth');

module.exports = function (io, db, push) {
  io.on('connection', function (socket) {
    // 담당자 로그인 후 자신에게 배정된 알림을 받기 위한 room 가입
    socket.on('authenticate-staff', function (token) {
      try {
        const payload = jwt.verify(token, getSecret());
        socket.data.user = payload;
        socket.join('staff:' + payload.username);
        if (payload.role === 'super') socket.join('staff:all');
      } catch (e) {
        // 유효하지 않은 토큰은 조용히 무시 (고객 세션일 수도 있음)
      }
    });

    // 특정 상담의 실시간 메시지를 받기 위한 room 가입 (고객/담당자 공용)
    socket.on('join-consultation', function (consultationId) {
      if (typeof consultationId === 'string' && consultationId.length < 100) {
        socket.join('consult:' + consultationId);
      }
    });

    socket.on('send-message', function (payload) {
      try {
        if (!payload || !payload.consultationId) return;
        const consultation = db
          .prepare('SELECT * FROM consultations WHERE id = ?')
          .get(payload.consultationId);
        if (!consultation) return;

        const text = String(payload.text || '').slice(0, 1000).trim();
        if (!text) return;

        let sender = 'customer';
        let senderName = null;

        if (socket.data.user) {
          // 담당자로 인증된 소켓 — 권한 검사 (총관리자는 전체, 서브관리자는 본인 배정 건만)
          if (
            socket.data.user.role !== 'super' &&
            consultation.assigned_username !== socket.data.user.username
          ) {
            return;
          }
          sender = socket.data.user.username;
          senderName = socket.data.user.name;
        }

        const now = new Date().toISOString();
        db.prepare(
          'INSERT INTO messages (consultation_id, sender, sender_name, text, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(payload.consultationId, sender, senderName, text, now);

        const newStatus = consultation.status === 'closed' ? 'closed' : 'active';
        db.prepare('UPDATE consultations SET last_message_at = ?, status = ? WHERE id = ?').run(
          now,
          newStatus,
          payload.consultationId
        );

        const message = { sender, senderName: senderName, text, created_at: now };
        io.to('consult:' + payload.consultationId).emit('message', message);
        io.to('staff:' + consultation.assigned_username)
          .to('staff:all')
          .emit('list-updated');

        // 고객이 보낸 메시지일 때만 담당자에게 푸시 알림 (담당자 본인 메시지는 알림 불필요)
        if (sender === 'customer') {
          push
            .sendToStaff(
              consultation.assigned_username,
              { title: consultation.name + '님의 새 메시지', body: text.slice(0, 80) },
              { consultationId: payload.consultationId }
            )
            .catch(function (e) { console.error('[push]', e.message); });
        }
      } catch (e) {
        console.error('[socket send-message]', e);
      }
    });
  });
};
