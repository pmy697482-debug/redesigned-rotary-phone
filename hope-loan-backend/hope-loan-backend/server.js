require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Server } = require('socket.io');

const db = require('./src/db');
require('./src/seed')(db);

const app = express();
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

app.use(express.static(path.join(__dirname, 'public')));

require('./src/sockets')(io, db, push);

const PORT = process.env.PORT || 3000;
server.listen(PORT, function () {
  console.log('희망나누미론 서버 실행 중: http://localhost:' + PORT);
});
