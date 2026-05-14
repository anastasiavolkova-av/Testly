// Сервис расчёта метрик A/B-экспериментов: агрегаты по группам пишутся в experiment_results.

class MetricsService {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * Пересчитывает все метрики для эксперимента: очищает experiment_results по experiment_id,
     * затем вызывает расчёт каждой метрики по очереди.
     */
    async calculateAndSaveMetrics(experimentId) {
        console.log('Расчёт метрик для эксперимента', experimentId);

        // Удаление старых строк по этому эксперименту
        await this.pool.query(
            'DELETE FROM experiment_results WHERE experiment_id = $1',
            [experimentId]
        );

        // Подсчёт каждой метрики и вставка в experiment_results
        await this.calculateFormCompletionRate(experimentId);
        await this.calculateAvgTaskTime(experimentId);
        await this.calculateAvgScrollDepth(experimentId);
        await this.calculateAvgSessionDuration(experimentId);
        await this.calculateBounceRate(experimentId);
        await this.calculateEventDensity(experimentId);
        await this.calculateConfusionIndex(experimentId);
        await this.calculateErrorRate(experimentId);

        console.log('Метрики для эксперимента', experimentId, 'сохранены.');

        return { success: true, experimentId };
    }

    // Подсчёт метрики form_completion_rate (metric_id=5): доля сессий с form_submit среди сессий с form_focus
    async calculateFormCompletionRate(experimentId) {
        const query = `
            WITH form_stats AS (
                WITH form_starts AS (
                    SELECT DISTINCT s.session_id, s.ab_group
                    FROM sessions s
                    WHERE s.experiment_id = $1
                        AND EXISTS (SELECT 1 FROM events e WHERE e.session_id = s.session_id AND e.event_name = 'form_focus')
                ),
                form_submits AS (
                    SELECT DISTINCT s.session_id, s.ab_group
                    FROM sessions s
                    WHERE s.experiment_id = $1
                        AND EXISTS (SELECT 1 FROM events e WHERE e.session_id = s.session_id AND e.event_name = 'form_submit')
                )
                SELECT 
                    fs.ab_group,
                    CASE 
                        WHEN COUNT(DISTINCT fs.session_id) > 0
                        THEN ROUND(COUNT(DISTINCT fsub.session_id) * 100.0 / COUNT(DISTINCT fs.session_id), 2)
                        ELSE 0 
                    END as completion_rate_percent
                FROM form_starts fs
                LEFT JOIN form_submits fsub ON fs.session_id = fsub.session_id AND fs.ab_group = fsub.ab_group
                GROUP BY fs.ab_group
            )
            INSERT INTO experiment_results (experiment_id, metric_id, ab_group, metric_value)
            SELECT $1, 5, ab_group, completion_rate_percent FROM form_stats
        `;
        
        await this.pool.query(query, [experimentId]);
    }
    
    // Подсчёт метрики avg_task_time_sec (metric_id=6): среднее время от form_focus до form_submit по сессии
    async calculateAvgTaskTime(experimentId) {
        const query = `
            WITH task_times AS (
                WITH first_focus AS (
                    SELECT s.session_id, s.ab_group, MIN(e.timestamp) as focus_time
                    FROM sessions s
                    JOIN events e ON s.session_id = e.session_id
                    WHERE s.experiment_id = $1 AND e.event_name = 'form_focus'
                    GROUP BY s.session_id, s.ab_group
                ),
                first_submit AS (
                    SELECT s.session_id, s.ab_group, MIN(e.timestamp) as submit_time
                    FROM sessions s
                    JOIN events e ON s.session_id = e.session_id
                    WHERE s.experiment_id = $1 AND e.event_name = 'form_submit'
                    GROUP BY s.session_id, s.ab_group
                )
                SELECT 
                    ff.ab_group,
                    AVG(EXTRACT(EPOCH FROM (fs.submit_time - ff.focus_time))) as avg_task_time_sec
                FROM first_focus ff
                JOIN first_submit fs ON ff.session_id = fs.session_id AND ff.ab_group = fs.ab_group
                GROUP BY ff.ab_group
            )
            INSERT INTO experiment_results (experiment_id, metric_id, ab_group, metric_value)
            SELECT $1, 6, ab_group, avg_task_time_sec FROM task_times
        `;
        
        await this.pool.query(query, [experimentId]);
    }
    
    // Подсчёт метрики avg_scroll_depth (metric_id=1): средняя максимальная глубина скролла по группам
    async calculateAvgScrollDepth(experimentId) {
        const query = `
            INSERT INTO experiment_results (experiment_id, metric_id, ab_group, metric_value)
            SELECT 
                $1,
                1,
                ab_group,
                AVG(max_scroll_depth) as avg_scroll_depth
            FROM sessions
            WHERE experiment_id = $1 AND max_scroll_depth IS NOT NULL
            GROUP BY ab_group
        `;
        
        await this.pool.query(query, [experimentId]);
    }
    
    // Подсчёт метрики avg_session_duration_sec (metric_id=2): средняя длительность сессии в секундах
    async calculateAvgSessionDuration(experimentId) {
        const query = `
            INSERT INTO experiment_results (experiment_id, metric_id, ab_group, metric_value)
            SELECT 
                $1,
                2,
                ab_group,
                AVG(duration_ms) / 1000.0 as avg_session_duration_sec
            FROM sessions
            WHERE experiment_id = $1 AND duration_ms IS NOT NULL
            GROUP BY ab_group
        `;
        
        await this.pool.query(query, [experimentId]);
    }
    
    // Подсчёт метрики bounce_rate (metric_id=3): доля сессий с не более чем двумя событиями
    async calculateBounceRate(experimentId) {
        const query = `
            WITH session_event_counts AS (
                SELECT s.session_id, s.ab_group, COUNT(e.event_id) as event_count
                FROM sessions s
                LEFT JOIN events e ON s.session_id = e.session_id
                WHERE s.experiment_id = $1
                GROUP BY s.session_id, s.ab_group
            )
            INSERT INTO experiment_results (experiment_id, metric_id, ab_group, metric_value)
            SELECT 
                $1,
                3,
                ab_group,
                CASE 
                    WHEN COUNT(*) > 0
                    THEN ROUND(COUNT(CASE WHEN event_count <= 2 THEN 1 END) * 100.0 / COUNT(*), 2)
                    ELSE 0 
                END as bounce_rate_percent
            FROM session_event_counts
            GROUP BY ab_group
        `;
        
        await this.pool.query(query, [experimentId]);
    }
    
    // Подсчёт метрики event_density_avg (metric_id=4): среднее число событий в секунду по сессии
    async calculateEventDensity(experimentId) {
        const query = `
            INSERT INTO experiment_results (experiment_id, metric_id, ab_group, metric_value)
            SELECT 
                $1,
                4,
                s.ab_group,
                AVG(e.event_count / (s.duration_ms / 1000.0)) as event_density_avg
            FROM sessions s
            JOIN (SELECT session_id, COUNT(*) as event_count FROM events GROUP BY session_id) e 
                ON s.session_id = e.session_id
            WHERE s.experiment_id = $1 AND s.duration_ms > 0
            GROUP BY s.ab_group
        `;
        
        await this.pool.query(query, [experimentId]);
    }
    
    // Подсчёт метрики confusion_index (metric_id=7): доля кликов по неинтерактивным элементам
    async calculateConfusionIndex(experimentId) {
        const query = `
            WITH click_stats AS (
                SELECT 
                    s.ab_group,
                    COUNT(*) as total_clicks,
                    COUNT(CASE 
                        WHEN e.event_data->'element'->>'tag' IN ('p', 'div', 'span', 'h1', 'h2', 'h3', 'section', 'article')
                        AND (e.event_data->'element'->>'role' IS NULL OR e.event_data->'element'->>'role' NOT IN ('button', 'link'))
                        THEN 1 
                    END) as confused_clicks
                FROM events e
                JOIN sessions s ON e.session_id = s.session_id
                WHERE s.experiment_id = $1 AND e.event_name = 'click'
                GROUP BY s.ab_group
            )
            INSERT INTO experiment_results (experiment_id, metric_id, ab_group, metric_value)
            SELECT 
                $1,
                7,
                ab_group,
                CASE 
                    WHEN total_clicks > 0 
                    THEN ROUND(confused_clicks * 100.0 / total_clicks, 2)
                    ELSE 0 
                END as confusion_index_percent
            FROM click_stats
        `;
        
        await this.pool.query(query, [experimentId]);
    }
    
    // Подсчёт метрики error_rate (metric_id=8): доля ошибок среди взаимодействий (click, form_focus, form_submit)
    async calculateErrorRate(experimentId) {
        const query = `
            WITH error_stats AS (
                SELECT 
                    s.ab_group,
                    CASE 
                        WHEN COUNT(*) FILTER (WHERE e.event_name IN ('click', 'form_focus', 'form_submit')) > 0
                        THEN ROUND(
                            COUNT(*) FILTER (WHERE e.event_name IN ('js_error', 'promise_error', 'resource_error')) * 100.0 /
                            COUNT(*) FILTER (WHERE e.event_name IN ('click', 'form_focus', 'form_submit')), 2
                        )
                        ELSE 0 
                    END as error_rate_percent
                FROM events e
                JOIN sessions s ON e.session_id = s.session_id
                WHERE s.experiment_id = $1
                GROUP BY s.ab_group
            )
            INSERT INTO experiment_results (experiment_id, metric_id, ab_group, metric_value)
            SELECT $1, 8, ab_group, error_rate_percent FROM error_stats
        `;
        
        await this.pool.query(query, [experimentId]);
    }
    
    /**
     * Возвращает все метрики эксперимента из experiment_results с именами и единицами из справочника metrics (для дашборда и API).
     */
    async getMetricsByExperimentId(experimentId) {
        const query = `
            SELECT 
                er.metric_id,
                m.metric_name,
                m.unit,
                m.description,
                er.ab_group,
                er.metric_value
            FROM experiment_results er
            JOIN metrics m ON er.metric_id = m.metric_id
            WHERE er.experiment_id = $1
            ORDER BY er.metric_id, er.ab_group
        `;

        const result = await this.pool.query(query, [experimentId]);

        const metrics = {};
        result.rows.forEach(row => {
            if (!metrics[row.metric_id]) {
                metrics[row.metric_id] = {
                    id: row.metric_id,
                    name: row.metric_name,
                    unit: row.unit,
                    description: row.description,
                    values: {}
                };
            }
            metrics[row.metric_id].values[row.ab_group] = parseFloat(row.metric_value);
        });

        return Object.values(metrics);
    }
}

module.exports = MetricsService;