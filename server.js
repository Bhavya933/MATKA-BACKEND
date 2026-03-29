const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("API is running 🚀");
});

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
            console.error('Signup Error:', err); // LOG THE FULL ERROR FOR RENDER
            if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Username already exists' });
            return res.status(500).json({ error: 'Database error: ' + err.message });
        }
        res.json({ message: 'User registered successfully', id: result.insertId });
    });
});

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const query = 'SELECT id, username, role, balance, is_blocked FROM users WHERE username = ? AND password = ?';
    db.query(query, [username, password], (err, results) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (results.length === 0) return res.status(401).json({ error: 'Invalid username or password' });
        
        const user = results[0];
        if (user.is_blocked) {
            return res.status(403).json({ error: 'Account Blocked! Please contact admin.' });
        }
        
        res.json({ message: 'Login successful', user });
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
// GAMES ENDPOINTS
// =======================

const INITIAL_GAMES = [
    { name: 'ANDHRA DAY', subtitle: 'ANDHRA', number: '123-34-567', open_time: '15:30:00', close_time: '16:30:00', status: 'CLOSED' },
    { name: 'ANDHRA MORNING', subtitle: 'ANDHRA', number: '100-11-XXX', open_time: '10:35:00', close_time: '11:35:00', status: 'OPEN' }, 
    { name: 'ANDHRA NIGHT', subtitle: 'ANDHRA', number: '123-12-123', open_time: '20:40:00', close_time: '22:40:00', status: 'CLOSED' },
    { name: 'CHENNAI CENTRAL', subtitle: 'CHENNAI', number: '123-1X-XXX', open_time: '15:55:00', close_time: '17:55:00', status: 'CLOSED' },
    { name: 'CHENNAI EXPRESS', subtitle: 'CHENNAI', number: '123-02-XXX', open_time: '21:55:00', close_time: '23:59:00', status: 'CLOSED' }
];

// Helper to populate default games if table is empty
const seedGames = () => {
    db.query('SELECT COUNT(*) AS count FROM games', (err, results) => {
        if (!err && results[0].count === 0) {
            console.log('Seeding default games...');
            INITIAL_GAMES.forEach(g => {
                db.query('INSERT INTO games (name, subtitle, number, open_time, close_time, status) VALUES (?, ?, ?, ?, ?, ?)', 
                [g.name, g.subtitle, g.number, g.open_time, g.close_time, g.status]);
            });
        }
    });
};
seedGames();

// Get all games
app.get('/api/games', (req, res) => {
    db.query('SELECT * FROM games ORDER BY id ASC', (err, results) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(results);
    });
});

// Admin: Create new game
app.post('/api/games', (req, res) => {
    const { name, subtitle, number, open_time, close_time, status } = req.body;
    const query = 'INSERT INTO games (name, subtitle, number, open_time, close_time, status) VALUES (?, ?, ?, ?, ?, ?)';
    db.query(query, [name, subtitle, number, open_time, close_time, status || 'OPEN'], (err, result) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ message: 'Game card created successfully', id: result.insertId });
    });
});

// Admin: Update game
app.put('/api/games/:id', (req, res) => {
    const { id } = req.params;
    const { name, number, open_time, close_time, status } = req.body;
    const query = 'UPDATE games SET name = ?, number = ?, open_time = ?, close_time = ?, status = ? WHERE id = ?';
    db.query(query, [name, number, open_time, close_time, status, id], (err, result) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ message: 'Game updated successfully' });
    });
});

// Admin: Delete game
app.delete('/api/games/:id', (req, res) => {
    const { id } = req.params;
    db.query('DELETE FROM games WHERE id = ?', [id], (err, result) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ message: 'Game deleted successfully' });
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

// Admin: Get all users
app.get('/api/users', (req, res) => {
    const query = 'SELECT id, username, balance, is_blocked, created_at FROM users WHERE role = "USER" ORDER BY created_at DESC';
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(results);
    });
});

// Admin: Toggle block status
app.put('/api/users/:id/toggle-block', (req, res) => {
    const { id } = req.params;
    db.query('UPDATE users SET is_blocked = NOT is_blocked WHERE id = ?', [id], (err, result) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ message: 'Block status toggled successfully' });
    });
});

// Heartbeat check for auto-logout
app.get('/api/users/:id/status', (req, res) => {
    const { id } = req.params;
    db.query('SELECT is_blocked FROM users WHERE id = ?', [id], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ is_blocked: results[0].is_blocked });
    });
});

// --- DEPOSIT ENDPOINTS ---

// Fetch all deposits (Admin)
app.get('/api/deposits', (req, res) => {
    const sql = `
        SELECT d.*, u.username as name 
        FROM deposits d 
        JOIN users u ON d.user_id = u.id 
        ORDER BY d.created_at DESC
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Create deposit request (User)
app.post('/api/deposits', (req, res) => {
    const { id, user_id, amount, method, utr_id } = req.body;
    const sql = 'INSERT INTO deposits (id, user_id, amount, method, utr_id) VALUES (?, ?, ?, ?, ?)';
    db.query(sql, [id, user_id, amount, method, utr_id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Deposit request submitted', id });
    });
});

// Update deposit status (Approve/Reject)
app.put('/api/deposits/:id/status', (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // 'APPROVED' or 'REJECTED'

    db.beginTransaction(err => {
        if (err) return res.status(500).json({ error: err.message });

        // 1. Get deposit info
        db.query('SELECT user_id, amount, status FROM deposits WHERE id = ?', [id], (err, results) => {
            if (err) return db.rollback(() => res.status(500).json({ error: err.message }));
            if (results.length === 0) return db.rollback(() => res.status(404).json({ error: 'Deposit not found' }));

            const deposit = results[0];
            if (deposit.status !== 'PENDING') return db.rollback(() => res.status(400).json({ error: 'Deposit already processed' }));

            // 2. Update status
            db.query('UPDATE deposits SET status = ? WHERE id = ?', [status, id], (err, results) => {
                if (err) return db.rollback(() => res.status(500).json({ error: err.message }));

                // 3. If APPROVED, Add Balance to User
                if (status === 'APPROVED') {
                    db.query('UPDATE users SET balance = balance + ? WHERE id = ?', [deposit.amount, deposit.user_id], (err, results) => {
                        if (err) return db.rollback(() => res.status(500).json({ error: err.message }));
                        
                        db.commit(err => {
                            if (err) return db.rollback(() => res.status(500).json({ error: err.message }));
                            res.json({ message: 'Deposit approved and balance updated' });
                        });
                    });
                } else {
                    db.commit(err => {
                        if (err) return db.rollback(() => res.status(500).json({ error: err.message }));
                        res.json({ message: 'Deposit rejected' });
                    });
                }
            });
        });
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
