const fs = require('fs');
const { saveToDatabase } = require('../services/tracking.service');

// Контроллер приёма событий трекера: запись в лог-файл и в БД.
class TrackingController {
    constructor(pool) {
        this.pool = pool;
    }

    // Обработчик POST /api/track: принимает массив событий, пишет в data/events.log и в таблицы users, sessions, events.
    async trackEvents(req, res) {
        const events = req.body;

        if (!Array.isArray(events)) {
            return res.status(400).json({ error: 'Expected array' });
        }

        console.log('Получено событий:', events.length);

        try {
            for (const event of events) {
                // Запись в лог-файл с меткой времени сервера
                event._server_time = new Date().toISOString();
                fs.appendFileSync(
                    './data/events.log',
                    JSON.stringify(event) + '\n'
                );

                // Сохранение в БД (пользователь, сессия при session_start/session_end, событие)
                await saveToDatabase(event, this.pool);

                if (event.event_name && event.ab_group) {
                    console.log('Событие:', event.ab_group, event.event_name);
                }
            }

            res.json({ success: true, received: events.length, savedToDB: true });

        } catch (error) {
            console.error('Ошибка сохранения событий:', error);
            res.status(500).json({ error: 'Database error', details: error.message });
        }
    }
}

module.exports = TrackingController;
