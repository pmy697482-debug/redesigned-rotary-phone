(function () {
  var shell = document.getElementById('shell');
  var topbarWho = document.getElementById('topbarWho');
  var socket = io();

  var state = {
    token: localStorage.getItem('hope_token') || null,
    user: JSON.parse(localStorage.getItem('hope_user') || 'null'),
    currentConsultationId: null,
    pollHandle: null
  };

  // ---------- 유틸 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtTime(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
  }
  function stopPolling() {
    if (state.pollHandle) { clearInterval(state.pollHandle); state.pollHandle = null; }
  }
  function toggleInvalid(fieldId, invalid) {
    document.getElementById(fieldId).classList.toggle('invalid', !!invalid);
  }
  function isValidPhone(v) {
    var d = v.replace(/[^0-9]/g, '');
    return d.length >= 9 && d.length <= 11;
  }
  // ---------- 푸시 알림 (네이티브 앱 안에서 실행 중일 때만 동작) ----------
  function isNativeApp() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }

  function initPushForStaff() {
    if (!isNativeApp()) return; // 데스크톱/모바일 브라우저에서는 건너뜀
    var Push = window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications;
    if (!Push) return;

    Push.requestPermissions().then(function (result) {
      if (result.receive === 'granted') { Push.register(); }
    }).catch(function () { /* 권한 거부 등은 조용히 무시 */ });

    if (!window.__hopePushListenersAdded) {
      window.__hopePushListenersAdded = true;

      Push.addListener('registration', function (tokenInfo) {
        if (!state.token) return; // 로그인 상태가 아니면 등록하지 않음
        api('/api/notifications/register-token', {
          method: 'POST',
          body: JSON.stringify({ token: tokenInfo.value, platform: window.Capacitor.getPlatform() })
        }).catch(function () { /* 등록 실패는 조용히 무시, 앱 내 실시간 알림은 계속 동작 */ });
      });

      Push.addListener('registrationError', function (err) {
        console.error('[push] 등록 실패', err);
      });

      Push.addListener('pushNotificationActionPerformed', function (action) {
        var data = action && action.notification && action.notification.data;
        if (data && data.consultationId && state.user) {
          showChat(data.consultationId, 'staff');
        }
      });
    }
  }

  function showToast(text) {
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 4000);
  }

  async function api(path, options) {
    options = options || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    var res = await fetch(path, Object.assign({}, options, { headers: headers }));
    var data = null;
    try { data = await res.json(); } catch (e) { /* 본문 없음 */ }
    if (!res.ok) {
      var msg = (data && data.error) || '요청 처리 중 문제가 발생했어요.';
      throw new Error(msg);
    }
    return data;
  }

  function logout() {
    stopPolling();
    state.token = null;
    state.user = null;
    localStorage.removeItem('hope_token');
    localStorage.removeItem('hope_user');
    renderTopbar();
    showHome();
  }

  function renderTopbar() {
    if (!state.user) { topbarWho.innerHTML = ''; return; }
    var roleLabel = state.user.role === 'super' ? '총관리자' : '서브관리자';
    topbarWho.innerHTML =
      '<span>' + esc(state.user.name) + ' · ' + roleLabel + '</span>' +
      '<button id="logoutBtn" type="button">로그아웃</button>';
    document.getElementById('logoutBtn').addEventListener('click', logout);
  }

  // ---------- 소켓 이벤트 ----------
  socket.on('connect', function () {
    if (state.token) socket.emit('authenticate-staff', state.token);
  });
  socket.on('new-consultation', function (payload) {
    if (state.user) {
      showToast('새 상담이 배정됐어요: ' + payload.name + ' (' + payload.assignedName + ')');
      if (document.getElementById('dashBody')) renderConsultationList();
    }
  });
  socket.on('list-updated', function () {
    if (document.getElementById('dashBody')) renderConsultationList();
  });
  socket.on('message', function (message) {
    if (document.getElementById('chatMessages')) appendChatMessage(message);
  });

  // ================= 홈 =================
  function showHome() {
    stopPolling();
    renderTopbar();
    shell.innerHTML =
      '<div class="home-hero">' +
        '<h1>필요한 금액을 편하게 말씀해 주세요</h1>' +
        '<p>이름과 연락처, 필요 금액만 남기면 담당자와 바로 1:1 채팅으로 상담받을 수 있어요.</p>' +
      '</div>' +
      '<div class="choice-grid">' +
        '<div class="choice-card" id="goCustomer"><h3>대출 상담 신청</h3><p>이름 / 필요 금액 / 연락처를 남기고 담당자와 채팅을 시작해요.</p></div>' +
        '<div class="choice-card" id="goStaffLogin"><h3>담당자 로그인</h3><p>총관리자 · 서브관리자 계정으로 상담 현황을 확인해요.</p></div>' +
      '</div>' +
      '<div class="center-link"><button class="text-link" id="goLookup">이미 신청하셨나요? 연락처로 상담 이어가기</button></div>';

    document.getElementById('goCustomer').addEventListener('click', showCustomerForm);
    document.getElementById('goStaffLogin').addEventListener('click', showStaffLogin);
    document.getElementById('goLookup').addEventListener('click', showCustomerLookup);
  }

  // ================= 고객: 신청 폼 =================
  function showCustomerForm() {
    stopPolling();
    shell.innerHTML =
      '<div class="card">' +
        '<h2>상담 신청</h2>' +
        '<p class="sub">아래 정보를 남기면 담당자가 순서대로 배정돼요.</p>' +
        '<div class="field" id="f-name"><label>이름</label><div class="input-wrap"><input id="cName" placeholder="홍길동"></div><div class="err">이름을 입력해 주세요.</div></div>' +
        '<div class="field" id="f-phone"><label>연락처</label><div class="input-wrap"><input id="cPhone" placeholder="010-1234-5678"></div><div class="err">올바른 연락처를 입력해 주세요.</div></div>' +
        '<div class="field" id="f-amount"><label>필요 금액</label><div class="input-wrap"><input id="cAmount" type="number" min="1" placeholder="500"><span class="suffix">만원</span></div><div class="err">필요 금액을 입력해 주세요.</div></div>' +
        '<button class="primary-btn" id="submitReq">상담 신청하기</button>' +
        '<div class="center-link"><button class="text-link" id="backHome1">처음으로</button></div>' +
      '</div>';
    document.getElementById('backHome1').addEventListener('click', showHome);
    document.getElementById('submitReq').addEventListener('click', submitCustomerRequest);
  }

  async function submitCustomerRequest() {
    var name = document.getElementById('cName').value.trim();
    var phone = document.getElementById('cPhone').value.trim();
    var amount = document.getElementById('cAmount').value.trim();
    var ok = true;
    toggleInvalid('f-name', !name); if (!name) ok = false;
    toggleInvalid('f-phone', !isValidPhone(phone)); if (!isValidPhone(phone)) ok = false;
    toggleInvalid('f-amount', !amount || Number(amount) <= 0); if (!amount || Number(amount) <= 0) ok = false;
    if (!ok) return;

    var btn = document.getElementById('submitReq');
    btn.disabled = true; btn.textContent = '접수하는 중...';

    try {
      var result = await api('/api/consultations', {
        method: 'POST',
        body: JSON.stringify({ name: name, phone: phone, amount: amount })
      });
      showChat(result.id, 'customer');
    } catch (e) {
      btn.disabled = false; btn.textContent = '상담 신청하기';
      alert(e.message);
    }
  }

  // ================= 고객: 연락처로 이어가기 =================
  function showCustomerLookup() {
    stopPolling();
    shell.innerHTML =
      '<div class="card">' +
        '<h2>상담 이어가기</h2>' +
        '<p class="sub">신청하실 때 남긴 연락처를 입력해 주세요.</p>' +
        '<div class="field" id="f-lookup"><label>연락처</label><div class="input-wrap"><input id="lookupPhone" placeholder="010-1234-5678"></div><div class="err">일치하는 신청 내역이 없어요.</div></div>' +
        '<button class="primary-btn" id="lookupBtn">상담 이어가기</button>' +
        '<div class="center-link"><button class="text-link" id="backHome2">처음으로</button></div>' +
      '</div>';
    document.getElementById('backHome2').addEventListener('click', showHome);
    document.getElementById('lookupBtn').addEventListener('click', async function () {
      var phone = document.getElementById('lookupPhone').value.trim();
      try {
        var found = await api('/api/consultations/lookup?phone=' + encodeURIComponent(phone));
        showChat(found.id, 'customer');
      } catch (e) {
        toggleInvalid('f-lookup', true);
      }
    });
  }

  // ================= 담당자 로그인 =================
  function showStaffLogin() {
    stopPolling();
    shell.innerHTML =
      '<div class="card">' +
        '<h2>담당자 로그인</h2>' +
        '<p class="sub">총관리자 · 서브관리자 계정으로 로그인해 주세요.</p>' +
        '<div id="loginBanner"></div>' +
        '<div class="field"><label>아이디</label><div class="input-wrap"><input id="loginUser" placeholder="아이디"></div></div>' +
        '<div class="field"><label>비밀번호</label><div class="input-wrap"><input id="loginPass" type="password" placeholder="비밀번호"></div></div>' +
        '<button class="primary-btn" id="loginBtn">로그인</button>' +
        '<div class="center-link"><button class="text-link" id="backHome3">처음으로</button></div>' +
      '</div>';
    document.getElementById('backHome3').addEventListener('click', showHome);
    document.getElementById('loginBtn').addEventListener('click', doStaffLogin);
    document.getElementById('loginPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doStaffLogin(); });
  }

  async function doStaffLogin() {
    var u = document.getElementById('loginUser').value.trim();
    var p = document.getElementById('loginPass').value;
    var banner = document.getElementById('loginBanner');
    try {
      var result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
      state.token = result.token;
      state.user = result.user;
      localStorage.setItem('hope_token', state.token);
      localStorage.setItem('hope_user', JSON.stringify(state.user));
      socket.emit('authenticate-staff', state.token);
      renderTopbar();
      showStaffDashboard('list');
      initPushForStaff();
    } catch (e) {
      banner.innerHTML = '<div class="banner error">' + esc(e.message) + '</div>';
    }
  }

  // ================= 담당자 대시보드 =================
  async function showStaffDashboard(tab) {
    stopPolling();
    if (!state.user) { showHome(); return; }
    var isSuper = state.user.role === 'super';

    var tabsHtml = '<div class="tabs">' +
      '<button class="tab-btn" data-tab="list">상담 목록</button>' +
      (isSuper ? '<button class="tab-btn" data-tab="accounts">상담사 계정 관리</button>' : '') +
      '</div>';

    shell.innerHTML =
      '<div class="dash-head"><div><h2>상담 현황</h2><p>' + (isSuper ? '전체 상담 목록을 관리할 수 있어요.' : '나에게 배정된 상담 목록이에요.') + '</p></div></div>' +
      tabsHtml +
      '<div id="dashBody"></div>';

    shell.querySelectorAll('.tab-btn').forEach(function (btn) {
      if (btn.getAttribute('data-tab') === tab) btn.classList.add('active');
      btn.addEventListener('click', function () { showStaffDashboard(btn.getAttribute('data-tab')); });
    });

    if (tab === 'accounts' && isSuper) {
      await renderAccountManage();
    } else {
      await renderConsultationList();
      stopPolling();
      state.pollHandle = setInterval(renderConsultationList, 8000);
    }
  }

  async function renderConsultationList() {
    var body = document.getElementById('dashBody');
    if (!body) { stopPolling(); return; }
    var isSuper = state.user.role === 'super';
    var list;
    try {
      list = await api('/api/consultations');
    } catch (e) {
      if (e.message.indexOf('세션') !== -1) { logout(); return; }
      body.innerHTML = '<div class="list-card"><div class="empty-state">' + esc(e.message) + '</div></div>';
      return;
    }

    if (list.length === 0) {
      body.innerHTML = '<div class="list-card"><div class="empty-state">아직 배정된 상담이 없어요.</div></div>';
      return;
    }

    var rows = list.map(function (c) {
      var statusLabel = c.status === 'closed' ? '종료' : (c.status === 'active' ? '진행중' : '대기중');
      var actions = '<button class="icon-btn" data-open="' + esc(c.id) + '">채팅 열기</button>';
      if (isSuper) {
        actions += '<button class="icon-btn" data-edit="' + esc(c.id) + '">수정</button>' +
                   '<button class="icon-btn danger" data-del="' + esc(c.id) + '">삭제</button>';
      }
      return '<div class="req-row">' +
        '<div class="req-main">' +
          '<div class="req-name">' + esc(c.name) + '<span class="status-chip ' + c.status + '">' + statusLabel + '</span></div>' +
          '<div class="req-meta">' + esc(c.amount) + '만원 · ' + esc(c.phone) + (isSuper ? ' · 담당 ' + esc(c.assigned_name) : '') + ' · ' + fmtTime(c.created_at) + '</div>' +
        '</div>' +
        '<div class="req-actions">' + actions + '</div>' +
      '</div>';
    }).join('');

    body.innerHTML = '<div class="list-card">' + rows + '</div>';

    body.querySelectorAll('[data-open]').forEach(function (b) {
      b.addEventListener('click', function () { showChat(b.getAttribute('data-open'), 'staff'); });
    });
    body.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!confirm('이 상담 신청을 삭제할까요?')) return;
        try {
          await api('/api/consultations/' + b.getAttribute('data-del'), { method: 'DELETE' });
          renderConsultationList();
        } catch (e) { alert(e.message); }
      });
    });
    body.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', async function () {
        var id = b.getAttribute('data-edit');
        var row = list.find(function (c) { return c.id === id; });
        var newName = prompt('이름', row.name); if (newName === null) return;
        var newAmount = prompt('필요 금액(만원)', row.amount); if (newAmount === null) return;
        var newPhone = prompt('연락처', row.phone); if (newPhone === null) return;
        try {
          await api('/api/consultations/' + id, {
            method: 'PUT',
            body: JSON.stringify({ name: newName, amount: newAmount, phone: newPhone })
          });
          renderConsultationList();
        } catch (e) { alert(e.message); }
      });
    });
  }

  // ================= 계정 관리 (총관리자 전용) =================
  async function renderAccountManage() {
    var body = document.getElementById('dashBody');
    var accounts;
    try {
      accounts = await api('/api/accounts');
    } catch (e) {
      body.innerHTML = '<div class="list-card"><div class="empty-state">' + esc(e.message) + '</div></div>';
      return;
    }

    var rows = accounts.map(function (a, idx) {
      var roleLabel = a.role === 'super' ? '총관리자' : '서브관리자';
      return '<div class="acct-row">' +
        '<div class="acct-top">' +
          '<div><div class="acct-name">' + esc(a.name) + '</div><div class="acct-role">' + roleLabel + ' · 아이디 ' + esc(a.username) + '</div></div>' +
          '<button class="icon-btn" data-toggle="' + idx + '">아이디/비밀번호 변경</button>' +
        '</div>' +
        '<div class="acct-edit" id="edit-' + idx + '">' +
          '<input placeholder="새 아이디" id="newUser-' + idx + '" value="' + esc(a.username) + '">' +
          '<input placeholder="새 비밀번호(선택)" id="newPass-' + idx + '" type="password">' +
          '<button class="icon-btn" data-save="' + esc(a.username) + '" data-idx="' + idx + '">저장</button>' +
        '</div>' +
      '</div>';
    }).join('');

    body.innerHTML = '<div class="list-card">' + rows + '</div>';

    body.querySelectorAll('[data-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.getElementById('edit-' + btn.getAttribute('data-toggle')).classList.toggle('open');
      });
    });
    body.querySelectorAll('[data-save]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var idx = btn.getAttribute('data-idx');
        var originalUsername = btn.getAttribute('data-save');
        var newUsername = document.getElementById('newUser-' + idx).value.trim();
        var newPassword = document.getElementById('newPass-' + idx).value;
        if (!newUsername) { alert('아이디를 입력해 주세요.'); return; }
        try {
          await api('/api/accounts/' + encodeURIComponent(originalUsername), {
            method: 'PUT',
            body: JSON.stringify({ newUsername: newUsername, newPassword: newPassword || undefined })
          });
          alert('저장되었어요.');
          renderAccountManage();
        } catch (e) { alert(e.message); }
      });
    });
  }

  // ================= 채팅 =================
  async function showChat(consultationId, viewerType) {
    stopPolling();
    state.currentConsultationId = consultationId;
    socket.emit('join-consultation', consultationId);

    var consultation;
    try {
      consultation = await api('/api/consultations/' + consultationId);
    } catch (e) {
      shell.innerHTML = '<div class="empty-state">' + esc(e.message) + '</div>';
      return;
    }

    var backAction = viewerType === 'customer' ? showHome : function () { showStaffDashboard('list'); };

    shell.innerHTML =
      '<div class="chat-wrap" data-viewer="' + viewerType + '">' +
        '<div class="chat-head">' +
          '<div><h2>' + esc(consultation.name) + '님 상담</h2><div class="meta">담당자: ' + esc(consultation.assigned_name) + ' · ' + esc(consultation.amount) + '만원</div></div>' +
          '<button class="text-link" id="chatBack">' + (viewerType === 'customer' ? '처음으로' : '목록으로') + '</button>' +
        '</div>' +
        '<div class="chat-box">' +
          '<div class="chat-messages" id="chatMessages"></div>' +
          '<div class="chat-input-row">' +
            '<button type="button" id="chatAttachBtn" class="attach-btn" title="사진/파일 첨부">📎</button>' +
            '<input type="file" id="chatFileInput" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" style="display:none">' +
            '<input id="chatInput" placeholder="메시지를 입력하세요">' +
            '<button id="chatSend">보내기</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.getElementById('chatBack').addEventListener('click', function () { stopPolling(); backAction(); });
    document.getElementById('chatSend').addEventListener('click', sendChatMessage);
    document.getElementById('chatInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendChatMessage(); });
    document.getElementById('chatAttachBtn').addEventListener('click', function () {
      document.getElementById('chatFileInput').click();
    });
    document.getElementById('chatFileInput').addEventListener('change', handleFileSelected);

    try {
      var messages = await api('/api/consultations/' + consultationId + '/messages');
      var box = document.getElementById('chatMessages');
      box.innerHTML = '';
      messages.forEach(appendChatMessage);
    } catch (e) { /* 무시하고 실시간 수신만 사용 */ }
  }

  function appendChatMessage(m) {
    var box = document.getElementById('chatMessages');
    if (!box) return;
    var wrap = document.querySelector('.chat-wrap');
    var viewerType = wrap ? wrap.getAttribute('data-viewer') : 'customer';

    var el = document.createElement('div');
    if (m.sender === 'system') {
      el.className = 'msg system';
      el.textContent = m.text;
    } else {
      var mine = viewerType === 'customer' ? m.sender === 'customer' : m.sender !== 'customer';
      el.className = 'msg ' + (mine ? 'mine' : 'theirs');
      var label = m.sender === 'customer' ? '고객' : (m.senderName || m.sender_name || '담당자');
      var inner = '<span class="sender">' + esc(label) + '</span>';

      var attUrl = m.attachment_url;
      var attName = m.attachment_name;
      var attMime = m.attachment_mime;
      if (attUrl) {
        if (attMime && attMime.indexOf('image/') === 0) {
          inner += '<a href="' + esc(attUrl) + '" target="_blank" rel="noopener"><img class="chat-image" src="' + esc(attUrl) + '" alt="첨부 이미지"></a>';
        } else {
          inner += '<a class="chat-file" href="' + esc(attUrl) + '" target="_blank" rel="noopener">📄 ' + esc(attName || '첨부파일') + '</a>';
        }
      }
      if (m.text) {
        inner += attUrl ? ('<div class="chat-caption">' + esc(m.text) + '</div>') : esc(m.text);
      }
      el.innerHTML = inner;
    }
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }

  async function handleFileSelected(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = ''; // 같은 파일을 다시 선택해도 change 이벤트가 발생하도록 초기화
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      alert('파일 크기는 10MB 이하만 가능해요.');
      return;
    }
    var allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    if (allowed.indexOf(file.type) === -1) {
      alert('이미지(JPG/PNG/WEBP/GIF) 또는 PDF 파일만 첨부할 수 있어요.');
      return;
    }

    var attachBtn = document.getElementById('chatAttachBtn');
    attachBtn.disabled = true;
    attachBtn.textContent = '전송 중...';
    try {
      var formData = new FormData();
      formData.append('file', file);
      var headers = {};
      if (state.token) headers.Authorization = 'Bearer ' + state.token;
      var res = await fetch('/api/uploads/' + state.currentConsultationId, {
        method: 'POST',
        headers: headers,
        body: formData
      });
      var data = null;
      try { data = await res.json(); } catch (e2) { /* 본문 없음 */ }
      if (!res.ok) throw new Error((data && data.error) || '업로드에 실패했어요.');
      // 실제 채팅창 표시는 서버가 보내는 실시간(socket) 메시지로 처리돼요.
    } catch (err) {
      alert(err.message);
    } finally {
      attachBtn.disabled = false;
      attachBtn.textContent = '📎';
    }
  }

  function sendChatMessage() {
    var input = document.getElementById('chatInput');
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    socket.emit('send-message', { consultationId: state.currentConsultationId, text: text });
  }

  // ================= 초기화 =================
  if (state.token && state.user) {
    renderTopbar();
    showStaffDashboard('list');
    initPushForStaff();
  } else {
    showHome();
  }
})();
