const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { createPool, checkConnection } = require('./src/services/database.service');
const ExperimentsController = require('./src/controllers/experiments.controller');
const TrackingController = require('./src/controllers/tracking.controller');
const AuthController = require('./src/controllers/auth.controller');
const ProjectsController = require('./src/controllers/projects.controller');
const { createRequireAuth } = require('./src/middlewares/auth.middleware');
const { createRequireProjectMember } = require('./src/middlewares/project.middleware');

const app = express();
const PORT = 3000;
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 2 * 1024 * 1024 // 2MB на файл
    }
});

// Подключение к PostgreSQL
const pool = createPool();

// Проверка доступности БД при старте
checkConnection(pool)
    .then((now) => {
        console.log('Подключение к PostgreSQL установлено:', now);
    })
    .catch((err) => {
        console.error('Ошибка подключения к БД:', err.message);
    });

// Мидлвары: разбор cookies, JSON-тела запроса, раздача статики из public
app.use(cookieParser());
app.use(express.json());
app.use(express.static('public'));

// Создание каталога для логов и данных, если его нет
const DATA_DIR = './data';
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// Инициализация контроллеров (эксперименты и трекинг)
const experimentsController = new ExperimentsController(pool);
const trackingController = new TrackingController(pool);
const authController = new AuthController(pool);
const projectsController = new ProjectsController(pool);
const requireAuth = createRequireAuth(pool);
const requireProjectMember = createRequireProjectMember(pool);

// Лендинг
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'landing', 'index.html'));
});

app.get('/exp/:id', (req, res) => experimentsController.getExperimentTestPage(req, res));
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard', 'index.html'));
});

// API приёма событий трекера
app.post('/api/track', async (req, res) => await trackingController.trackEvents(req, res));

// API авторизации
app.post('/api/auth/register', async (req, res) => await authController.register(req, res));
app.post('/api/auth/login', async (req, res) => await authController.login(req, res));
app.post('/api/auth/logout', async (req, res) => await authController.logout(req, res));
app.get('/api/auth/me', async (req, res) => await authController.me(req, res));
app.post('/api/auth/reset-password', async (req, res) => await authController.resetPassword(req, res));

// API проектов и участников
app.get('/api/projects', requireAuth, async (req, res) => await projectsController.getProjects(req, res));
app.post('/api/projects', requireAuth, async (req, res) => await projectsController.createProject(req, res));
app.get('/api/projects/:projectId/members', requireAuth, async (req, res) => await projectsController.getMembers(req, res));
app.post('/api/projects/:projectId/members', requireAuth, async (req, res) => await projectsController.addMember(req, res));

// API экспериментов: создание, список, получение по ID
app.post(
    '/api/projects/:projectId/experiments',
    requireAuth,
    requireProjectMember,
    upload.fields([
        { name: 'variant_a', maxCount: 1 },
        { name: 'variant_b', maxCount: 1 }
    ]),
    async (req, res) => await experimentsController.createExperiment(req, res)
);
app.get('/api/projects/:projectId/experiments', requireAuth, requireProjectMember, async (req, res) => await experimentsController.getExperiments(req, res));
app.get('/api/projects/:projectId/experiments/:id', requireAuth, requireProjectMember, async (req, res) => await experimentsController.getExperiment(req, res));
app.post('/api/projects/:projectId/experiments/:id/start', requireAuth, requireProjectMember, async (req, res) => await experimentsController.startExperiment(req, res));
app.post('/api/projects/:projectId/experiments/:id/pause', requireAuth, requireProjectMember, async (req, res) => await experimentsController.pauseExperiment(req, res));
app.post('/api/projects/:projectId/experiments/:id/resume', requireAuth, requireProjectMember, async (req, res) => await experimentsController.resumeExperiment(req, res));
app.post('/api/projects/:projectId/experiments/:id/archive', requireAuth, requireProjectMember, async (req, res) => await experimentsController.archiveExperiment(req, res));
app.post('/api/projects/:projectId/experiments/:id/complete', requireAuth, requireProjectMember, async (req, res) => await experimentsController.completeExperiment(req, res));
app.post('/api/projects/:projectId/experiments/:id/calculate', requireAuth, requireProjectMember, async (req, res) => await experimentsController.calculateMetrics(req, res));
app.get('/api/projects/:projectId/experiments/:id/metrics', requireAuth, requireProjectMember, async (req, res) => await experimentsController.getMetrics(req, res));
app.get('/api/projects/:projectId/experiments/:id/summary', requireAuth, requireProjectMember, async (req, res) => await experimentsController.getSummary(req, res));
app.get('/api/projects/:projectId/experiments/:id/statistics', requireAuth, requireProjectMember, async (req, res) => await experimentsController.getStatistics(req, res));
app.get('/api/projects/:projectId/experiments/:id/scroll-funnel', requireAuth, requireProjectMember, async (req, res) => await experimentsController.getScrollFunnel(req, res));
app.get('/api/projects/:projectId/experiments/:id/devices', requireAuth, requireProjectMember, async (req, res) => await experimentsController.getDevices(req, res));
app.get('/api/projects/:projectId/experiments/:id/form-funnel', requireAuth, requireProjectMember, async (req, res) => await experimentsController.getFormFunnel(req, res));

// Запуск HTTP-сервера
app.listen(PORT, () => {
    console.log('Сервер запущен.');
    console.log('Лендинг: http://localhost:' + PORT + '/');
    console.log('Дашборд: http://localhost:' + PORT + '/dashboard');
    console.log('Лог событий трекера (файл):', path.resolve(DATA_DIR, 'events.log'));
    console.log('Каталог данных:', DATA_DIR + '/');
});