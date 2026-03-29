const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// MySQL Connection
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'shriram_matka'
});

db.getConnection((err, connection) => {
    if (err) {
        console.error('Database connection failed:', err);
    } else {
        console.log('Connected to MySQL Database.');
        connection.release();
    }
});

// =======================
// AUTH ENDPOINTS
// =======================

// Sign Up
app.post('/api/signup', (req, res) => {
    const { username, password } = req.body;
    const query = 'INSERT INTO users (username, password, role) VALUES (?, ?, "USER")';
    db.query(query, [username, password], (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Username already exists' });
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ message: 'User registered successfully', id: result.insertId });
    });
});

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const query = 'SELECT id, username, role, balance FROM users WHERE username = ? AND password = ?';
    db.query(query, [username, password], (err, results) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (results.length === 0) return res.status(401).json({ error: 'Invalid username or password' });
        res.json({ message: 'Login successful', user: results[0] });
    });
});

// =======================
// WITHDRAWAL ENDPOINTS
// =======================

// Get all withdrawals
app.get('/api/withdrawals', (req, res) => {
    const query = `
        SELECT w.*, u.username as name 
        FROM withdrawals w 
        JOIN users u ON w.user_id = u.id 
        ORDER BY w.created_at DESC
    `;
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(results);
    });
});

// Update withdrawal status
app.post('/api/withdrawals/status', (req, res) => {
    const { id, status } = req.body;
    const query = 'UPDATE withdrawals SET status = ? WHERE id = ?';
    db.query(query, [status, id], (err, result) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ message: 'Status updated successfully' });
    });
});

// Request new withdrawal
app.post('/api/withdrawals', (req, res) => {
    const { id, user_id, amount, method, upi_id, account_number, ifsc } = req.body;
    const query = 'INSERT INTO withdrawals (id, user_id, amount, method, upi_id, account_number, ifsc, status) VALUES (?, ?, ?, ?, ?, ?, ?, "PENDING")';
    db.query(query, [id, user_id, amount, method, upi_id, account_number, ifsc], (err, result) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ message: 'Withdrawal requested successfully' });
    });
});

// =======================
// NOTIFICATIONS ENDPOINTS
// =======================

// Get notifications
app.get('/api/notifications', (req, res) => {
    const query = 'SELECT * FROM notifications ORDER BY created_at DESC';
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(results);
    });
});

// Create notification
app.post('/api/notifications', (req, res) => {
    const { title, message, audience, type } = req.body;
    const query = 'INSERT INTO notifications (title, message, audience, type) VALUES (?, ?, ?, ?)';
    db.query(query, [title, message, audience, type], (err, result) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ message: 'Notification sent successfully' });
    });
});

// =======================
// BALANCE ENDPOINTS
// =======================
app.get('/api/users/:id/balance', (req, res) => {
    const { id } = req.params;
    db.query('SELECT balance FROM users WHERE id = ?', [id], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ balance: results[0].balance });
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
