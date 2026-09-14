const bcrypt = require('bcryptjs');

// 최초 실행 시에만 기본 계정 6개(총관리자 1 + 서브관리자 5)를 생성합니다.
// 비밀번호는 평문으로 저장되지 않고 bcrypt로 해시되어 저장됩니다.
module.exports = function seed(db) {
  const count = db.prepare('SELECT COUNT(*) as c FROM accounts').get().c;
  if (count > 0) return;

  const defaults = [
    { username: 'hope_master', password: 'Master#2024', role: 'super', name: '총관리자' },
    { username: 'hope_sub1', password: 'Sub1#2024', role: 'sub', name: '상담사 1' },
    { username: 'hope_sub2', password: 'Sub2#2024', role: 'sub', name: '상담사 2' },
    { username: 'hope_sub3', password: 'Sub3#2024', role: 'sub', name: '상담사 3' },
    { username: 'hope_sub4', password: 'Sub4#2024', role: 'sub', name: '상담사 4' },
    { username: 'hope_sub5', password: 'Sub5#2024', role: 'sub', name: '상담사 5' }
  ];

  const insert = db.prepare(
    'INSERT INTO accounts (username, password_hash, role, name) VALUES (?, ?, ?, ?)'
  );
  defaults.forEach(function (a) {
    insert.run(a.username, bcrypt.hashSync(a.password, 10), a.role, a.name);
  });

  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('assignment_pointer', '0');

  console.log('[seed] 기본 계정 6개를 생성했습니다. 로그인 후 계정 관리 화면에서 반드시 비밀번호를 변경하세요.');
};
