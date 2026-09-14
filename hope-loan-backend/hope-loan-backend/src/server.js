require('dotenv').config();

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Server } = require('socket.io');

const db = require('./src/db');
require('./src/seed')(db);

const app = express();
// Render 등 리버스 프록시 뒤에서 실행될 때, 프록시가 붙여주는 X-Forwarded-For 헤더를 신뢰하도록 설정
// (이게 없으면 express-rate-limit이 요청마다 에러를 던져서 서버가 재시작돼요)
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

const push = require('./src/push')(db);

app.use('/api/auth', require('./src/routes/authRoutes')(db));
app.use('/api/accounts', require('./src/routes/accountRoutes')(db));
app.use('/api/consultations', require('./src/routes/consultationRoutes')(db, io, push));
app.use('/api/notifications', require('./src/routes/notificationRoutes')(db));

const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/api/uploads', require('./src/routes/uploadRoutes')(db, io, push));

app.use(express.static(path.join(__dirname, 'public')));

require('./src/sockets')(io, db, push);

const PORT = process.env.PORT || 3000;
server.listen(PORT, function () {
  console.log('희망나누미론 서버 실행 중: http://localhost:' + PORT);
});
