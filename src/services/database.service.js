const { Pool } = require('pg');

function createPool() {
    return new Pool({
        user: process.env.DB_USER || 'postgres',
        host: process.env.DB_HOST || 'localhost',
        database: process.env.DB_NAME || 'ux_ab_testing',
        password: process.env.DB_PASSWORD || 'postgres',
        port: Number(process.env.DB_PORT || 5432),
    });
}

async function checkConnection(pool) {
    const result = await pool.query('SELECT NOW() AS now');
    return result.rows[0].now;
}

module.exports = {
    createPool,
    checkConnection
};
