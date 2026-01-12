const express = require('express');
const cookieParser = require('cookie-parser'); // Добавьте эту строку
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// ========== МИДЛВАРЫ (ВАЖНО!) ==========
app.use(cookieParser()); // ДО express.json()!
app.use(express.json());
app.use(express.static('public'));

// ========== ПАПКА ДЛЯ ДАННЫХ ==========
const DATA_DIR = './data';
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// ========== ГЛАВНАЯ СТРАНИЦА ==========
app.get('/', (req, res) => {
    // Безопасное чтение куки
    let group = req.cookies ? req.cookies.ab_group : null;
    const isNewUser = !group;
    
    // Если нет группы - назначаем случайно
    if (!group) {
        group = Math.random() < 0.5 ? 'A' : 'B';
    }
    
    // Устанавливаем куку
    res.cookie('ab_group', group, { 
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 дней
        httpOnly: false, // Чтобы JS мог читать
        path: '/'
    });
    
    console.log(`${isNewUser ? '👤 Новый' : '♻️ Возврат'} → группа ${group}`);
    
    const file = group === 'A' 
        ? 'versions/a/index.html' 
        : 'versions/b/index.html';
    
    const filePath = path.join(__dirname, 'public', file);
    
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send(`Файл не найден: ${file}`);
    }
});

// ========== API ДЛЯ ТРЕКЕРА ==========
app.post('/api/track', (req, res) => {
    const events = req.body;
    
    if (!Array.isArray(events)) {
        return res.status(400).json({ error: 'Expected array' });
    }
    
    console.log(`📥 Получено ${events.length} событий`);
    
    // Сохраняем в файл
    events.forEach(event => {
        event._server_time = new Date().toISOString();
        fs.appendFileSync(
            './data/events.log',
            JSON.stringify(event) + '\n'
        );
        
        // Вывод для отладки
        if (event.event_name && event.ab_group) {
            console.log(`   → ${event.ab_group}: ${event.event_name}`);
        }
    });
    
    res.json({ success: true, received: events.length });
});

// ========== СТРАНИЦА С ДАННЫМИ ==========
app.get('/data', (req, res) => {
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Данные A/B теста</title>
        <style>
            body { font-family: Arial; padding: 20px; }
            .event { padding: 10px; margin: 5px 0; border-radius: 5px; }
            .group-a { background: #e3f2fd; border-left: 4px solid #2196f3; }
            .group-b { background: #fff3e0; border-left: 4px solid #ff9800; }
            .stats { background: #f5f5f5; padding: 15px; border-radius: 10px; margin: 20px 0; }
        </style>
    </head>
    <body>
        <h1>📊 Данные A/B тестирования</h1>
        <p><a href="/">← На главную</a></p>
    `;
    
    try {
        if (fs.existsSync('./data/events.log')) {
            const content = fs.readFileSync('./data/events.log', 'utf8');
            const lines = content.trim().split('\n').filter(line => line);
            const events = lines.map(line => JSON.parse(line));
            
            // Статистика
            const total = events.length;
            const groupA = events.filter(e => e.ab_group === 'A').length;
            const groupB = events.filter(e => e.ab_group === 'B').length;
            const unknown = events.filter(e => !e.ab_group || e.ab_group === 'unknown').length;
            
            html += `
            <div class="stats">
                <h3>📈 Статистика</h3>
                <p>Всего событий: <strong>${total}</strong></p>
                <p>Группа A: <strong style="color:#2196f3">${groupA}</strong></p>
                <p>Группа B: <strong style="color:#ff9800">${groupB}</strong></p>
                <p>Неизвестно: <strong>${unknown}</strong></p>
            </div>
            
            <h3>📝 Последние 30 событий</h3>
            `;
            
            // Последние 30 событий
            events.slice(-30).reverse().forEach(event => {
                const time = event.timestamp ? 
                    new Date(event.timestamp).toLocaleTimeString() : '?';
                const group = event.ab_group || 'unknown';
                
                html += `
                <div class="event group-${group.toLowerCase()}">
                    <strong>${time}</strong> | 
                    <span style="color:${group === 'A' ? '#2196f3' : '#ff9800'}">
                        <strong>${group}</strong>
                    </span> | 
                    <strong>${event.event_name}</strong>
                    ${event.properties ? 
                        `<br><small style="color:#666">${JSON.stringify(event.properties)}</small>` : 
                        ''}
                </div>`;
            });
        } else {
            html += `<p>Событий пока нет. Посетите главную страницу.</p>`;
        }
    } catch (error) {
        html += `<p style="color:red">Ошибка: ${error.message}</p>`;
    }
    
    html += `</body></html>`;
    res.send(html);
});

// ========== ЗАПУСК СЕРВЕРА ==========
app.listen(PORT, () => {
    console.log(`
    🚀 Сервер запущен!
    📊 Тестирование: http://localhost:3000/
    📁 Данные: http://localhost:3000/data
    📂 Файлы данных: ${DATA_DIR}/
    `);
});