// Контроллер экспериментов: главная страница, CRUD экспериментов, метрики, дашборд.

const MetricsService = require('../services/metrics.service');
const StatsService = require('../services/stats.service');
const fs = require('fs');
const path = require('path');

class ExperimentsController {
    constructor(pool) {
        this.pool = pool;
        this.metricsService = new MetricsService(pool);
        this.statsService = new StatsService();
    }

    getProjectRoot() {
        return path.resolve(__dirname, '../..');
    }

    toPosixPath(filePath) {
        return filePath.split(path.sep).join('/');
    }

    getBaseUrl(req) {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        return `${protocol}://${req.get('host')}`;
    }

    /**
     * Страницы из storage отдаются по URL /exp/:id — относительный src="tracker.js"
     * резолвится в /exp/tracker.js (404). Подставляем абсолютный /tracker.js и при необходимости инжектим скрипт.
     */
    prepareExperimentVariantHtml(rawHtml, experimentId) {
        let html = String(rawHtml || '');
        const id = Number(experimentId);
        const safeId = Number.isInteger(id) && id > 0 ? id : 0;

        html = html.replace(/src\s*=\s*"tracker\.js"/gi, 'src="/tracker.js"');
        html = html.replace(/src\s*=\s*'tracker\.js'/gi, "src='/tracker.js'");

        const hasRootTracker = /src\s*=\s*["']\/tracker\.js["']/i.test(html);

        if (!hasRootTracker) {
            const inject = [
                '<script>',
                `try{document.body&&document.body.setAttribute('data-experiment-id','${safeId}');}catch(e){}`,
                '</script>',
                '<script src="/tracker.js" defer></script>',
                ''
            ].join('\n');
            if (/<\/body>/i.test(html)) {
                html = html.replace(/<\/body>/i, `${inject}</body>`);
            } else {
                html += inject;
            }
        }

        if (safeId && !/data-experiment-id\s*=/i.test(html)) {
            html = html.replace(/<body(\s[^>]*)?>/i, (match, attrs) => {
                const a = attrs || '';
                return `<body${a} data-experiment-id="${safeId}">`;
            });
        }

        return html;
    }

    getScopedProjectId(req) {
        const raw = req.params?.projectId;
        if (raw === undefined) return null;
        const projectId = Number(raw);
        if (!Number.isInteger(projectId) || projectId <= 0) return null;
        return projectId;
    }

    scopedClause(projectId, field = 'project_id', paramIndex = 2) {
        if (!projectId) return { sql: '', params: [] };
        return {
            sql: ` AND ${field} = $${paramIndex}`,
            params: [projectId]
        };
    }

    async ensureScopedExperiment(req, experimentId) {
        const projectId = this.getScopedProjectId(req);
        const scope = this.scopedClause(projectId, 'project_id', 2);
        const result = await this.pool.query(
            `
            SELECT experiment_id, project_id, status, started_at, completed_at
            FROM experiments
            WHERE experiment_id = $1${scope.sql}
            LIMIT 1
            `,
            [experimentId, ...scope.params]
        );
        return result.rows[0] || null;
    }

    getAllowedTransitions() {
        return {
            draft: ['running', 'archived'],
            running: ['paused', 'completed', 'archived'],
            paused: ['running', 'completed', 'archived'],
            completed: ['archived'],
            archived: []
        };
    }

    async transitionStatus(req, res, targetStatus) {
        try {
            const { id } = req.params;
            const parsedId = Number(id);
            const projectId = this.getScopedProjectId(req);
            const scope = this.scopedClause(projectId, 'project_id', 2);
            if (!Number.isInteger(parsedId) || parsedId <= 0) {
                return res.status(400).json({ error: 'Некорректный ID эксперимента' });
            }

            const currentRes = await this.pool.query(
                `SELECT experiment_id, status, started_at, completed_at
                 FROM experiments
                 WHERE experiment_id = $1${scope.sql}`,
                [parsedId, ...scope.params]
            );

            if (currentRes.rows.length === 0) {
                return res.status(404).json({ error: 'Эксперимент не найден' });
            }

            const experiment = currentRes.rows[0];
            const currentStatus = (experiment.status || '').toLowerCase();
            const allowedTransitions = this.getAllowedTransitions();
            const nextStatuses = allowedTransitions[currentStatus] || [];

            if (!nextStatuses.includes(targetStatus)) {
                return res.status(409).json({
                    error: `Недопустимый переход статуса: ${currentStatus} -> ${targetStatus}`
                });
            }

            let updateQuery = `
                UPDATE experiments
                SET status = $2
                WHERE experiment_id = $1${projectId ? ' AND project_id = $3' : ''}
                RETURNING experiment_id, status, started_at, completed_at
            `;
            if (targetStatus === 'running') {
                updateQuery = `
                    UPDATE experiments
                    SET status = $2,
                        started_at = COALESCE(started_at, NOW())
                    WHERE experiment_id = $1${projectId ? ' AND project_id = $3' : ''}
                    RETURNING experiment_id, status, started_at, completed_at
                `;
            } else if (targetStatus === 'completed') {
                updateQuery = `
                    UPDATE experiments
                    SET status = $2,
                        completed_at = NOW(),
                        started_at = COALESCE(started_at, NOW())
                    WHERE experiment_id = $1${projectId ? ' AND project_id = $3' : ''}
                    RETURNING experiment_id, status, started_at, completed_at
                `;
            }

            const updateParams = projectId ? [parsedId, targetStatus, projectId] : [parsedId, targetStatus];
            const updated = await this.pool.query(updateQuery, updateParams);
            const row = updated.rows[0];

            if (targetStatus === 'completed') {
                await this.metricsService.calculateAndSaveMetrics(parsedId);
                await this.statsService.runExperimentAnalysis(parsedId);
            }

            return res.json({
                success: true,
                experiment_id: row.experiment_id,
                status: row.status,
                started_at: row.started_at,
                completed_at: row.completed_at
            });
        } catch (error) {
            console.error('Ошибка смены статуса эксперимента:', error);
            if (error && error.code === '23514' && error.constraint === 'experiments_status_check') {
                return res.status(409).json({
                    error: 'Статус не разрешен ограничением БД (experiments_status_check). Обновите CHECK для статусов: draft, running, paused, completed, archived.'
                });
            }
            return res.status(500).json({ error: error.message });
        }
    }

    // Возвращает список всех экспериментов (для API)
    async getExperiments(req, res) {
        try {
            const projectId = this.getScopedProjectId(req);
            const scope = this.scopedClause(projectId, 'project_id', 1);
            const result = await this.pool.query(`
                SELECT 
                    experiment_id,
                    project_id,
                    name,
                    hypothesis,
                    status,
                    public_link AS link,
                    created_at,
                    started_at,
                    completed_at
                FROM experiments
                WHERE 1 = 1${scope.sql}
                ORDER BY created_at DESC
            `, [...scope.params]);
            
            res.json(result.rows);
        } catch (error) {
            console.error('Ошибка получения списка экспериментов:', error);
            res.status(500).json({ error: error.message });
        }
    }

    // Создание нового эксперимента (name, hypothesis, description из тела запроса)
    async createExperiment(req, res) {
        try {
            const projectId = this.getScopedProjectId(req);
            const { name, hypothesis, description } = req.body;
            const safeName = typeof name === 'string' ? name.trim() : '';
            const safeHypothesis = typeof hypothesis === 'string' ? hypothesis.trim() : '';
            const safeDescription = typeof description === 'string' ? description.trim() : null;
            const variantA = req.files?.variant_a?.[0] || null;
            const variantB = req.files?.variant_b?.[0] || null;

            if (!safeName || !safeHypothesis) {
                return res.status(400).json({ error: 'Поля name и hypothesis обязательны' });
            }

            if (!variantA || !variantB) {
                return res.status(400).json({
                    error: 'Нужно загрузить оба файла: variant_A.html и variant_B.html'
                });
            }

            if (variantA.originalname !== 'variant_A.html' || variantB.originalname !== 'variant_B.html') {
                return res.status(400).json({
                    error: 'Имена файлов должны быть строго variant_A.html и variant_B.html'
                });
            }
            
            const insertColumns = projectId
                ? '(project_id, name, hypothesis, description, status, started_at, completed_at)'
                : '(name, hypothesis, description, status, started_at, completed_at)';
            const insertValues = projectId
                ? '($1, $2, $3, $4, \'draft\', NULL, NULL)'
                : '($1, $2, $3, \'draft\', NULL, NULL)';
            const insertParams = projectId
                ? [projectId, safeName, safeHypothesis, safeDescription]
                : [safeName, safeHypothesis, safeDescription];

            const result = await this.pool.query(`
                INSERT INTO experiments ${insertColumns}
                VALUES ${insertValues}
                RETURNING experiment_id, project_id, status, created_at
            `, insertParams);
            
            const experimentId = result.rows[0].experiment_id;
            const experimentStorageDir = path.join(this.getProjectRoot(), 'storage', 'experiments', String(experimentId));
            fs.mkdirSync(experimentStorageDir, { recursive: true });

            const variantAAbsolutePath = path.join(experimentStorageDir, 'variant_A.html');
            const variantBAbsolutePath = path.join(experimentStorageDir, 'variant_B.html');
            fs.writeFileSync(variantAAbsolutePath, variantA.buffer);
            fs.writeFileSync(variantBAbsolutePath, variantB.buffer);

            const variantARelativePath = this.toPosixPath(path.relative(this.getProjectRoot(), variantAAbsolutePath));
            const variantBRelativePath = this.toPosixPath(path.relative(this.getProjectRoot(), variantBAbsolutePath));
            const publicLink = `${this.getBaseUrl(req)}/exp/${experimentId}`;

            await this.pool.query(`
                UPDATE experiments
                SET variant_a_path = $2,
                    variant_b_path = $3,
                    public_link = $4
                WHERE experiment_id = $1
            `, [experimentId, variantARelativePath, variantBRelativePath, publicLink]);
            
            res.json({
                success: true,
                experiment_id: experimentId,
                status: result.rows[0].status,
                created_at: result.rows[0].created_at,
                link: publicLink,
                links: {
                    a: `${publicLink}?preview=A`,
                    b: `${publicLink}?preview=B`
                }
            });
        } catch (error) {
            console.error('Ошибка создания эксперимента:', error);
            res.status(500).json({ error: error.message });
        }
    }

    // Отдача тестовой страницы для эксперимента по общей ссылке /exp/:id
    async getExperimentTestPage(req, res) {
        try {
            const experimentId = Number(req.params.id);
            if (!Number.isInteger(experimentId) || experimentId <= 0) {
                return res.status(400).send('Некорректный experiment_id');
            }

            const result = await this.pool.query(`
                SELECT experiment_id, status, variant_a_path, variant_b_path
                FROM experiments
                WHERE experiment_id = $1
            `, [experimentId]);

            if (result.rows.length === 0) {
                return res.status(404).send('Эксперимент не найден');
            }

            const experiment = result.rows[0];
            if (!experiment.variant_a_path || !experiment.variant_b_path) {
                return res.status(409).send('Для эксперимента не загружены варианты A/B');
            }

            const preview = String(req.query.preview || '').toUpperCase();
            let group = req.cookies?.ab_group;
            if (preview === 'A' || preview === 'B') {
                group = preview;
            }
            if (group !== 'A' && group !== 'B') {
                group = Math.random() < 0.5 ? 'A' : 'B';
            }

            res.cookie('ab_group', group, {
                maxAge: 30 * 24 * 60 * 60 * 1000,
                httpOnly: false,
                path: '/'
            });

            const relativePath = group === 'A' ? experiment.variant_a_path : experiment.variant_b_path;
            const projectRoot = this.getProjectRoot();
            const absolutePath = path.resolve(projectRoot, relativePath);

            if (!absolutePath.startsWith(projectRoot)) {
                return res.status(400).send('Некорректный путь к файлу варианта');
            }
            if (!fs.existsSync(absolutePath)) {
                return res.status(404).send(`Файл варианта ${group} не найден`);
            }

            const rawHtml = fs.readFileSync(absolutePath, 'utf8');
            const html = this.prepareExperimentVariantHtml(rawHtml, experimentId);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(html);
        } catch (error) {
            console.error('Ошибка отдачи тестовой страницы:', error);
            return res.status(500).send(error.message);
        }
    }

    // Завершение эксперимента: статус completed и расчёт метрик по experiment_results
    async completeExperiment(req, res) {
        return this.transitionStatus(req, res, 'completed');
    }

    async startExperiment(req, res) {
        return this.transitionStatus(req, res, 'running');
    }

    async pauseExperiment(req, res) {
        return this.transitionStatus(req, res, 'paused');
    }

    async resumeExperiment(req, res) {
        return this.transitionStatus(req, res, 'running');
    }

    async archiveExperiment(req, res) {
        return this.transitionStatus(req, res, 'archived');
    }

    // Возвращает один эксперимент по ID (для API)
    async getExperiment(req, res) {
        try {
            const { id } = req.params;
            const projectId = this.getScopedProjectId(req);
            const scope = this.scopedClause(projectId, 'project_id', 2);

            const result = await this.pool.query(`
            SELECT 
                experiment_id,
                project_id,
                name,
                hypothesis,
                description,
                status,
                public_link AS link,
                variant_a_path,
                variant_b_path,
                created_at,
                started_at,
                completed_at
            FROM experiments 
            WHERE experiment_id = $1${scope.sql}
            `, [id, ...scope.params]);

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Эксперимент не найден' });
            }

            res.json(result.rows[0]);
        } catch (error) {
            console.error('Ошибка получения эксперимента:', error);
            res.status(500).json({ error: error.message });
        }
    }

    // Запуск пересчёта метрик для эксперимента (без смены статуса)
    async calculateMetrics(req, res) {
        try {
            const { id } = req.params;
            const projectId = this.getScopedProjectId(req);
            const scope = this.scopedClause(projectId, 'project_id', 2);

            // Проверка существования эксперимента
            const check = await this.pool.query(
                `SELECT experiment_id FROM experiments WHERE experiment_id = $1${scope.sql}`,
                [id, ...scope.params]
            );

            if (check.rows.length === 0) {
                return res.status(404).json({ error: 'Эксперимент не найден' });
            }

            // Расчёт и сохранение метрик
            await this.metricsService.calculateAndSaveMetrics(id);
            await this.statsService.runExperimentAnalysis(id);

            res.json({
                success: true,
                message: `Метрики и статистический анализ для эксперимента #${id} рассчитаны.`
            });
        } catch (error) {
            console.error('Ошибка расчёта метрик:', error);
            res.status(500).json({ error: error.message });
        }
    }

    // Возвращает метрики эксперимента из experiment_results (для дашборда и API)
    async getMetrics(req, res) {
        try {
            const { id } = req.params;
            const experimentId = Number(id);
            if (!Number.isInteger(experimentId) || experimentId <= 0) {
                return res.status(400).json({ error: 'Некорректный ID эксперимента' });
            }
            const experiment = await this.ensureScopedExperiment(req, experimentId);
            if (!experiment) {
                return res.status(404).json({ error: 'Эксперимент не найден' });
            }

            const metrics = await this.metricsService.getMetricsByExperimentId(experimentId);

            res.json({
                experiment_id: experimentId,
                metrics
            });
        } catch (error) {
            console.error('Ошибка получения метрик:', error);
            res.status(500).json({ error: error.message });
        }
    }

    async getSummary(req, res) {
        try {
            const experimentId = Number(req.params.id);
            if (!Number.isInteger(experimentId) || experimentId <= 0) {
                return res.status(400).json({ error: 'Некорректный ID эксперимента' });
            }
            const scopedExperiment = await this.ensureScopedExperiment(req, experimentId);
            if (!scopedExperiment) {
                return res.status(404).json({ error: 'Эксперимент не найден' });
            }

            const [expRes, totalsRes, groupsRes] = await Promise.all([
                this.pool.query(`
                    SELECT experiment_id, status, started_at, completed_at
                    FROM experiments
                    WHERE experiment_id = $1
                `, [experimentId]),
                this.pool.query(`
                    SELECT
                        COUNT(DISTINCT s.user_id) AS users,
                        COUNT(DISTINCT s.session_id) AS sessions,
                        COUNT(e.event_id) AS events,
                        COALESCE(AVG(s.duration_ms) / 1000.0, 0) AS avg_duration_sec
                    FROM sessions s
                    LEFT JOIN events e ON e.session_id = s.session_id
                    WHERE s.experiment_id = $1
                `, [experimentId]),
                this.pool.query(`
                    SELECT
                        s.ab_group,
                        COUNT(DISTINCT s.user_id) AS users,
                        COUNT(DISTINCT s.session_id) AS sessions,
                        COUNT(e.event_id) AS events,
                        COALESCE(AVG(s.duration_ms) / 1000.0, 0) AS avg_duration_sec
                    FROM sessions s
                    LEFT JOIN events e ON e.session_id = s.session_id
                    WHERE s.experiment_id = $1
                    GROUP BY s.ab_group
                `, [experimentId])
            ]);

            if (expRes.rows.length === 0) {
                return res.status(404).json({ error: 'Эксперимент не найден' });
            }

            const experiment = expRes.rows[0];
            const totals = totalsRes.rows[0] || {};
            const byGroup = {
                A: { users: 0, sessions: 0, events: 0, avg_duration_sec: 0 },
                B: { users: 0, sessions: 0, events: 0, avg_duration_sec: 0 }
            };

            groupsRes.rows.forEach((row) => {
                const group = row.ab_group;
                if (group !== 'A' && group !== 'B') return;
                byGroup[group] = {
                    users: Number(row.users || 0),
                    sessions: Number(row.sessions || 0),
                    events: Number(row.events || 0),
                    avg_duration_sec: Number(row.avg_duration_sec || 0)
                };
            });

            const startedAt = experiment.started_at ? new Date(experiment.started_at) : null;
            const endedAt = experiment.completed_at ? new Date(experiment.completed_at) : null;
            const durationSec = startedAt
                ? Math.max(0, Math.floor(((endedAt || new Date()).getTime() - startedAt.getTime()) / 1000))
                : 0;

            return res.json({
                experiment_id: experimentId,
                totals: {
                    users: Number(totals.users || 0),
                    sessions: Number(totals.sessions || 0),
                    events: Number(totals.events || 0),
                    avg_duration_sec: Number(totals.avg_duration_sec || 0),
                    test_duration_sec: durationSec
                },
                by_group: byGroup
            });
        } catch (error) {
            console.error('Ошибка получения summary:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    async getStatistics(req, res) {
        try {
            const experimentId = Number(req.params.id);
            if (!Number.isInteger(experimentId) || experimentId <= 0) {
                return res.status(400).json({ error: 'Некорректный ID эксперимента' });
            }
            const scopedExperiment = await this.ensureScopedExperiment(req, experimentId);
            if (!scopedExperiment) {
                return res.status(404).json({ error: 'Эксперимент не найден' });
            }

            const result = await this.pool.query(`
                SELECT
                    sr.metric_id,
                    m.metric_name,
                    sr.p_value,
                    sr.ci_lower,
                    sr.ci_upper,
                    sr.ci_level,
                    sr.power,
                    sr.required_n,
                    sr.calculated_at
                FROM statistical_results sr
                LEFT JOIN metrics m ON m.metric_id = sr.metric_id
                WHERE sr.experiment_id = $1
                ORDER BY sr.metric_id
            `, [experimentId]);

            const statistics = result.rows.map((row) => ({
                metric_id: Number(row.metric_id),
                metric_name: row.metric_name,
                p_value: row.p_value !== null ? Number(row.p_value) : null,
                ci_lower: row.ci_lower !== null ? Number(row.ci_lower) : null,
                ci_upper: row.ci_upper !== null ? Number(row.ci_upper) : null,
                ci_level: row.ci_level !== null ? Number(row.ci_level) : null,
                power: row.power !== null ? Number(row.power) : null,
                required_n: row.required_n !== null ? Number(row.required_n) : null,
                calculated_at: row.calculated_at
            }));

            return res.json({
                experiment_id: experimentId,
                statistics
            });
        } catch (error) {
            console.error('Ошибка получения статистики:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    async getScrollFunnel(req, res) {
        try {
            const experimentId = Number(req.params.id);
            if (!Number.isInteger(experimentId) || experimentId <= 0) {
                return res.status(400).json({ error: 'Некорректный ID эксперимента' });
            }
            const scopedExperiment = await this.ensureScopedExperiment(req, experimentId);
            if (!scopedExperiment) {
                return res.status(404).json({ error: 'Эксперимент не найден' });
            }

            const steps = [25, 50, 75, 90, 100];
            const result = await this.pool.query(`
                SELECT
                    s.ab_group,
                    (e.event_data->>'depth')::int AS depth,
                    COUNT(DISTINCT s.session_id) AS sessions_reached
                FROM events e
                JOIN sessions s ON s.session_id = e.session_id
                WHERE s.experiment_id = $1
                  AND e.event_name = 'scroll'
                  AND (e.event_data->>'depth') IN ('25','50','75','90','100')
                GROUP BY s.ab_group, depth
            `, [experimentId]);

            const groups = {
                A: steps.map(() => 0),
                B: steps.map(() => 0)
            };

            result.rows.forEach((row) => {
                const group = row.ab_group;
                if (group !== 'A' && group !== 'B') return;
                const depth = Number(row.depth);
                const idx = steps.indexOf(depth);
                if (idx >= 0) {
                    groups[group][idx] = Number(row.sessions_reached || 0);
                }
            });

            return res.json({
                experiment_id: experimentId,
                steps,
                groups
            });
        } catch (error) {
            console.error('Ошибка получения scroll funnel:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    async getDevices(req, res) {
        try {
            const experimentId = Number(req.params.id);
            if (!Number.isInteger(experimentId) || experimentId <= 0) {
                return res.status(400).json({ error: 'Некорректный ID эксперимента' });
            }
            const scopedExperiment = await this.ensureScopedExperiment(req, experimentId);
            if (!scopedExperiment) {
                return res.status(404).json({ error: 'Эксперимент не найден' });
            }

            const result = await this.pool.query(`
                SELECT
                    COALESCE(NULLIF(s.device_category, ''), 'unknown') AS device_category,
                    COUNT(*) AS sessions,
                    COALESCE(AVG(s.duration_ms) / 1000.0, 0) AS avg_duration_sec,
                    COUNT(*) FILTER (WHERE s.ab_group = 'A') AS a_sessions,
                    COUNT(*) FILTER (WHERE s.ab_group = 'B') AS b_sessions
                FROM sessions s
                WHERE s.experiment_id = $1
                GROUP BY COALESCE(NULLIF(s.device_category, ''), 'unknown')
                ORDER BY sessions DESC
            `, [experimentId]);

            const totalSessions = result.rows.reduce((acc, row) => acc + Number(row.sessions || 0), 0);
            const distribution = result.rows.map((row) => {
                const sessions = Number(row.sessions || 0);
                return {
                    device_category: row.device_category,
                    sessions,
                    share_pct: totalSessions > 0 ? Number(((sessions * 100) / totalSessions).toFixed(2)) : 0,
                    avg_duration_sec: Number(row.avg_duration_sec || 0),
                    by_group: {
                        A: Number(row.a_sessions || 0),
                        B: Number(row.b_sessions || 0)
                    }
                };
            });

            return res.json({
                experiment_id: experimentId,
                total_sessions: totalSessions,
                distribution
            });
        } catch (error) {
            console.error('Ошибка получения устройств:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    async getFormFunnel(req, res) {
        try {
            const experimentId = Number(req.params.id);
            if (!Number.isInteger(experimentId) || experimentId <= 0) {
                return res.status(400).json({ error: 'Некорректный ID эксперимента' });
            }
            const scopedExperiment = await this.ensureScopedExperiment(req, experimentId);
            if (!scopedExperiment) {
                return res.status(404).json({ error: 'Эксперимент не найден' });
            }

            const stages = [
                { key: 'form_focus', label: 'Фокус на форме' },
                { key: 'form_input', label: 'Заполнение формы' },
                { key: 'form_submit', label: 'Отправка формы' }
            ];

            const stageResults = [];
            for (const stage of stages) {
                const result = await this.pool.query(`
                    SELECT
                        s.ab_group,
                        COUNT(DISTINCT s.session_id) AS sessions
                    FROM sessions s
                    WHERE s.experiment_id = $1
                      AND EXISTS (
                        SELECT 1
                        FROM events e
                        WHERE e.session_id = s.session_id
                          AND e.event_name = $2
                      )
                    GROUP BY s.ab_group
                `, [experimentId, stage.key]);

                const byGroup = { A: 0, B: 0 };
                result.rows.forEach((row) => {
                    if (row.ab_group === 'A' || row.ab_group === 'B') {
                        byGroup[row.ab_group] = Number(row.sessions || 0);
                    }
                });

                stageResults.push({
                    key: stage.key,
                    label: stage.label,
                    total: byGroup.A + byGroup.B,
                    by_group: byGroup
                });
            }

            const focusTotal = stageResults[0]?.total || 0;
            const submitTotal = stageResults[2]?.total || 0;
            const conversion = focusTotal > 0 ? Number(((submitTotal * 100) / focusTotal).toFixed(2)) : 0;

            return res.json({
                experiment_id: experimentId,
                stages: stageResults,
                conversion: {
                    focus_to_submit_pct: conversion
                }
            });
        } catch (error) {
            console.error('Ошибка получения form funnel:', error);
            return res.status(500).json({ error: error.message });
        }
    }
}

module.exports = ExperimentsController;