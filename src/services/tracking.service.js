/**
 * Сохраняет одно событие трекера в БД: при session_start создаёт сессию,
 * при session_end обновляет сессию, записывает событие в events.
 */
function extractExperimentId(event) {
    const directValue = Number(event?.experiment_id);
    if (Number.isInteger(directValue) && directValue > 0) return directValue;

    const fromProperties = Number(event?.properties?.experiment_id);
    if (Number.isInteger(fromProperties) && fromProperties > 0) return fromProperties;

    const source = event?.page_url || event?.page || '';
    const pathMatch = String(source).match(/\/exp\/(\d+)/i);
    if (pathMatch) {
        const fromPath = Number(pathMatch[1]);
        if (Number.isInteger(fromPath) && fromPath > 0) return fromPath;
    }

    const queryMatch = String(source).match(/[?&](?:exp_id|experiment_id)=(\d+)/i);
    if (queryMatch) {
        const fromQuery = Number(queryMatch[1]);
        if (Number.isInteger(fromQuery) && fromQuery > 0) return fromQuery;
    }

    return null;
}

async function resolveFallbackExperimentId(db) {
    const running = await db.query(`
        SELECT experiment_id
        FROM experiments
        WHERE status = 'running'
        ORDER BY COALESCE(started_at, created_at) DESC
    `);
    if (running.rows.length === 1) {
        return Number(running.rows[0].experiment_id);
    }
    if (running.rows.length > 1) {
        return null;
    }

    const drafts = await db.query(`
        SELECT experiment_id
        FROM experiments
        WHERE status = 'draft'
        ORDER BY created_at DESC
    `);
    if (drafts.rows.length === 1) {
        return Number(drafts.rows[0].experiment_id);
    }
    return null;
}

async function saveToDatabase(event, pool) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const experiment_id = extractExperimentId(event) || await resolveFallbackExperimentId(client);
        if (!Number.isInteger(experiment_id) || experiment_id <= 0) {
            throw new Error('Не удалось определить experiment_id для события');
        }

        // При событии session_start — вставка строки в sessions
        if (event.event_name === 'session_start') {
            await client.query(`
                INSERT INTO sessions (
                    session_id, experiment_id, user_id, ab_group,
                    start_time, device_category
                ) VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (session_id) DO NOTHING
            `, [
                event.session_id,
                experiment_id,
                event.user_id,
                event.ab_group,
                new Date(event.timestamp),
                event.properties?.device?.device_type || 'desktop'
            ]);
        }

        // При событии session_end — обновление end_time, duration_ms, max_scroll_depth в sessions
        if (event.event_name === 'session_end') {
            // Ограничение значения глубины скролла диапазоном 0–100
            let scrollMax = event.properties?.scroll_max;
            if (scrollMax > 100) scrollMax = 100;
            if (scrollMax < 0) scrollMax = 0;

            await client.query(`
                UPDATE sessions 
                SET 
                    end_time = $1,
                    duration_ms = $2,
                    max_scroll_depth = $3
                WHERE session_id = $4
            `, [
                new Date(event.timestamp),
                event.properties?.duration,
                scrollMax,
                event.session_id
            ]);
        }

        // Запись события в таблицу events (event_id, session_id, event_name, timestamp, event_data)
        await client.query(`
            INSERT INTO events (event_id, session_id, event_name, timestamp, event_data)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (event_id) DO NOTHING
        `, [
            event.event_id,
            event.session_id,
            event.event_name,
            new Date(event.timestamp),
            JSON.stringify({
                ...event.properties,
                experiment_id,
                page: event.page,
                page_url: event.page_url
            })
        ]);

        await client.query('COMMIT');
        return true;
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            console.error('Ошибка отката транзакции:', rollbackError.message);
        }
        console.error('Ошибка сохранения события', event.event_id, error.message);
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    saveToDatabase
};