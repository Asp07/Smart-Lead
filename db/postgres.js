const { Pool } = require('pg');
const config = require('../config/config');
const pool = new Pool(config.db);

pool.on('connect', () => {
    console.log('Connected to PostgreSQL');
});

pool.on('error', (err) => {
    console.error('Unexpected postgres error', err);
});

module.exports = pool;