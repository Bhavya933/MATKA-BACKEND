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

// Process-level error catching
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
    console.error(err.name, err.message, err.stack);
});

process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED REJECTION! 💥 Shutting down...');
    console.error(err);
});

// MySQL Connection
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'shriram_matka'
});

// --- MIDNIGHT RESET ENGINE ---
const resetGamesForNewDay = () => {
    console.log("🕛 MIDNIGHT RESET: Clearing all games for the new day...");
    db.query("UPDATE games SET number = 'XXX-XX-XXX', status = 'OPEN'", (err) => {
        if (err) console.error("Midnight reset failed:", err.message);
        else console.log("✅ All games reset to OPEN.");
    });
};

// Check every 30 seconds if it's 12:00 AM (Ensure it only runs ONCE per day)
let lastResetDay = null;
setInterval(() => {
    const now = new Date();
    const todayStr = now.toDateString();
    if (now.getHours() === 0 && now.getMinutes() === 0 && lastResetDay !== todayStr) {
        lastResetDay = todayStr;
        resetGamesForNewDay();
    }
}, 30000); 

// Helper to sync database schema automatically
const syncSchema = () => {
    const tables = [
        `CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            mobile VARCHAR(15) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            isAdmin TINYINT(1) DEFAULT 0,
            balance DECIMAL(15, 2) DEFAULT 0.00,
            isBlocked TINYINT(1) DEFAULT 0,
            is_blocked TINYINT(1) DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS games (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            subtitle VARCHAR(100),
            number VARCHAR(20) DEFAULT 'XXX-XX-XXX',
            open_time TIME,
            close_time TIME,
            status ENUM('OPEN', 'CLOSED') DEFAULT 'CLOSED',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS bets (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_mobile VARCHAR(15) NOT NULL,
            game_name VARCHAR(255) NOT NULL,
            game_type VARCHAR(100) NOT NULL,
            session ENUM('OPEN', 'CLOSE') NOT NULL,
            number VARCHAR(100) NOT NULL,
            points INT NOT NULL,
            status ENUM('PENDING', 'WON', 'LOST') DEFAULT 'PENDING',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS deposits (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            amount DECIMAL(10, 2) NOT NULL,
            status ENUM('PENDING', 'APPROVED', 'REJECTED') DEFAULT 'PENDING',
            method VARCHAR(50) DEFAULT 'GPAY',
            utr_id VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS withdrawals (
            id VARCHAR(100) PRIMARY KEY,
            user_id INT NOT NULL,
            amount DECIMAL(10, 2) NOT NULL,
            status ENUM('PENDING', 'APPROVED', 'REJECTED') DEFAULT 'PENDING',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS user_bank_accounts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            account_type ENUM('BANK', 'UPI') NOT NULL,
            bank_name VARCHAR(100),
            account_holder VARCHAR(155),
            account_number VARCHAR(50),
            ifsc_code VARCHAR(20),
            upi_id VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS notifications (
            id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            audience ENUM('ALL', 'USER') DEFAULT 'ALL',
            type ENUM('INFO', 'SUCCESS', 'WARNING', 'CRITICAL') DEFAULT 'INFO',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS site_settings (
            id INT PRIMARY KEY DEFAULT 1,
            admin_upi VARCHAR(255) DEFAULT '3103624a@bandhan',
            support_number VARCHAR(20) DEFAULT '91XXXXXXXXXX',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )`
    ];

    tables.forEach(sql => {
        db.query(sql, (err) => {
            if (err) console.error('Error creating table:', err.message);
        });
    });

    // Remove the unused and empty 'name' column as requested
    db.query("SHOW COLUMNS FROM users LIKE 'name'", (err, rows) => {
        if (!err && rows.length > 0) {
            console.log("Dropping unused 'name' column...");
            db.query("ALTER TABLE users DROP COLUMN name", (err) => {
                if (err) console.error("Error dropping name column:", err.message);
            });
        }
    });

    // Handle column migrations for users (username -> mobile, isAdmin)
    db.query("SHOW COLUMNS FROM users LIKE 'mobile'", (err, rows) => {
        if (!err && rows.length === 0) {
            // Check if username exists to rename it, else just add mobile
            db.query("SHOW COLUMNS FROM users LIKE 'username'", (err, uRows) => {
                if (!err && uRows.length > 0) {
                    console.log("Renaming username to mobile...");
                    db.query("ALTER TABLE users CHANGE username mobile VARCHAR(15) UNIQUE NOT NULL", (err) => {
                        if (err) console.error("Rename Error:", err.message);
                    });
                } else {
                    console.log("Adding mobile column to users...");
                    db.query("ALTER TABLE users ADD COLUMN mobile VARCHAR(15) UNIQUE NOT NULL", (err) => {
                        if (err) console.error("Add Column Error:", err.message);
                    });
                }
            });
        }
    });

    // Fix the status ENUM for bets to be all-caps (PENDING, WON, LOST)
    db.query("ALTER TABLE bets MODIFY COLUMN status ENUM('PENDING', 'WON', 'LOST') DEFAULT 'PENDING'", (err) => {
        if (err) console.error("Error updating bets status enum:", err.message);
        else {
            // One-time data conversion for legacy statuses
            db.query("UPDATE bets SET status = 'PENDING' WHERE status = 'Placed'", (err) => {
                if (err) console.error("Error migrating 'Placed' to 'PENDING':", err.message);
            });
            db.query("UPDATE bets SET status = 'WON' WHERE status = 'Won'", (err) => {
                if (err) console.error("Error migrating 'Won' to 'WON':", err.message);
            });
            db.query("UPDATE bets SET status = 'LOST' WHERE status = 'Lost'", (err) => {
                if (err) console.error("Error migrating 'Lost' to 'LOST':", err.message);
                if (err) console.error("Error migrating 'Lost' to 'WON':", err.message);
            });
        }
    });

    // --- REPAIR OLD HISTORY AUTOMATICALLY ---
    const repairOldBets = () => {
        console.log("🛠️ Starting History Repair (Final Payout)...");
        // Only select those that are NOT already Won/Lost
        db.query("SELECT TRIM(name) as name, number FROM games WHERE number != 'XXX-XX-XXX'", (err, games) => {
            if (!err && games.length > 0) {
                games.forEach(g => {
                    console.log(`Checking history for: ${g.name} (${g.number})`);
                    settleBets(g.name.trim(), g.number);
                });
            }
        });
    };

    // Run repair once everything is ready
    setTimeout(repairOldBets, 5000); 

    db.query("SHOW COLUMNS FROM users LIKE 'isAdmin'", (err, rows) => {
        if (!err && rows.length === 0) {
            db.query("ALTER TABLE users ADD COLUMN isAdmin TINYINT(1) DEFAULT 0", (err) => {
                if (err) console.error("Add isAdmin column error:", err.message);
            });
        }
    });

    // Migration for bets table (user_id -> user_mobile)
    db.query("SHOW COLUMNS FROM bets LIKE 'user_mobile'", (err, rows) => {
        if (!err && rows.length === 0) {
            console.log("No 'user_mobile' column in 'bets', checking for 'user_id'...");
            db.query("SHOW COLUMNS FROM bets LIKE 'user_id'", (err, uRows) => {
                if (!err && uRows.length > 0) {
                    console.log("Adding user_mobile column and migrating data from user_id...");
                    // Add column first
                    db.query("ALTER TABLE bets ADD COLUMN user_mobile VARCHAR(15)", (err) => {
                        if (err) {
                            console.error("Add user_mobile Error:", err.message);
                        } else {
                            // Update values from users table
                            db.query("UPDATE bets b JOIN users u ON b.user_id = u.id SET b.user_mobile = u.mobile", (err) => {
                                if (err) console.error("Data Migration Error:", err.message);
                                else console.log("Successfully migrated user IDs to mobile numbers in bets table.");
                            });
                        }
                    });
                } else {
                    console.log("Adding user_mobile column (no user_id found)...");
                    db.query("ALTER TABLE bets ADD COLUMN user_mobile VARCHAR(15) NOT NULL", (err) => {
                        if (err) console.error("Add user_mobile Error:", err.message);
                    });
                }
            });
        }
    });

    // Ensure digit column is named 'number' if it exists as digit (legacy support)
    db.query("SHOW COLUMNS FROM bets LIKE 'number'", (err, rows) => {
        if (!err && rows.length === 0) {
            db.query("SHOW COLUMNS FROM bets LIKE 'digit'", (err, dRows) => {
                if (!err && dRows.length > 0) {
                    db.query("ALTER TABLE bets CHANGE digit number VARCHAR(100) NOT NULL", (err) => {
                        if (err) console.error("Rename digit to number Error:", err.message);
                    });
                }
            });
        }
    });

    // Handle column-level migration for is_blocked
    db.query("SHOW COLUMNS FROM users LIKE 'is_blocked'", (err, rows) => {
        if (!err && rows.length === 0) {
            db.query("ALTER TABLE users ADD COLUMN is_blocked BOOLEAN DEFAULT FALSE", (err) => {
                if (err) console.error("Could not add is_blocked column:", err.message);
                else console.log("Added is_blocked column to users table.");
            });
        }
    });

    // Handle isBlocked (for dashboard compat)
    db.query("SHOW COLUMNS FROM users LIKE 'isBlocked'", (err, rows) => {
        if (!err && rows.length === 0) {
            db.query("ALTER TABLE users ADD COLUMN isBlocked TINYINT(1) DEFAULT 0", (err) => {
                if (err) console.error("Could not add isBlocked column:", err.message);
            });
        }
    });

    // Handle withdrawals ID type migration (INT -> VARCHAR for custom strings)
    db.query("SHOW COLUMNS FROM withdrawals LIKE 'id'", (err, rows) => {
        if (!err && rows.length > 0 && rows[0].Type.toLowerCase().includes('int')) {
            console.log("Migrating withdrawals ID column to VARCHAR...");
            db.query("ALTER TABLE withdrawals MODIFY id VARCHAR(100)", (err) => {
                if (err) console.error("Could not migrate withdrawals ID column:", err.message);
                else console.log("Migrated withdrawals ID column to VARCHAR.");
            });
        }
    });

    // Handle deposits schema migration
    db.query("SHOW COLUMNS FROM deposits LIKE 'method'", (err, rows) => {
        if (!err && rows.length === 0) {
            db.query("ALTER TABLE deposits ADD COLUMN method VARCHAR(50) DEFAULT 'GPAY', ADD COLUMN utr_id VARCHAR(100)", (err) => {
                if (!err) console.log("Updated deposits table schema (Added method and utr_id columns).");
            });
        }
    });

    // Update balance column precision
    db.query("ALTER TABLE users MODIFY COLUMN balance DECIMAL(15, 2) DEFAULT 0.00", (err) => {
        if (err) console.error("Balance precision update error:", err.message);
    });
};

db.getConnection((err, conn) => {
    if (err) {
        console.error('MySQL Connection Error:', err.message);
        return;
    }
    console.log('Connected to MySQL Database.');

    // --- AUTO-REPAIR DATABASE SCHEMA (REMOTE FIX) ---
    console.log("🛠️ Checking Database Schema...");
    conn.query("SHOW COLUMNS FROM bets LIKE 'payoutDone'", (err, results) => {
        if (!err && results.length === 0) {
            console.log("🏗️ Repairing 'bets' table: Adding payoutDone...");
            conn.query("ALTER TABLE bets ADD COLUMN payoutDone TINYINT(1) DEFAULT 0");
        }
    });
    conn.query("SHOW COLUMNS FROM bets LIKE 'result_number'", (err, results) => {
        if (!err && results.length === 0) {
            console.log("🏗️ Repairing 'bets' table: Adding result_number...");
            conn.query("ALTER TABLE bets ADD COLUMN result_number VARCHAR(20) DEFAULT NULL");
        }
        conn.release();
    });

    // Reset logic is now centrally managed at the top of this file
    repairOldBets(); 
    
    // ONE-TIME FORCE SETTLE FOR ANDHRA DAY (RESTORE WINNINGS)
    setTimeout(() => {
        console.log("🏆 FORCING payout repair for yesterday's Andhra Day...");
        settleBets("ANDHRA DAY", "100-01-010");
    }, 5000);
});


// =======================
// BET SETTLEMENT HELPER (For Auto-Finalize)
// =======================
// THE ROBUST BET SETTLEMENT ENGINE
// THE MASTER BET SETTLEMENT ENGINE
const settleBets = (game_name, inputNumber, callback) => {
    const number = (inputNumber || 'XXX-XX-XXX').toUpperCase();
    console.log(`🎯 Settling bets for ${game_name} with result ${number}`);

    // Robust Catch-all query for PENDING or Placed
    // Robust Catch-all query for PENDING or Placed or incorrectly LOST bets
    const query = 'SELECT * FROM bets WHERE TRIM(game_name) = ? AND (status = "Placed" OR UPPER(status) = "PENDING" OR UPPER(status) = "LOST") AND payoutDone = 0';
    db.query(query, [game_name.trim()], (err, pendingBets) => {
        if (err) {
            console.error("Fetch pending bets error:", err.message);
            if (callback) callback({ error: err.message });
            return;
        }

        if (!pendingBets || pendingBets.length === 0) {
            console.log(`No pending bets found for ${game_name}.`);
            // Even if no bets to settle, update the result_number for everyone else to keep history consistent
            db.query('UPDATE bets SET result_number = ? WHERE TRIM(game_name) = ?', [number, game_name.trim()]);
            if (callback) callback({ message: 'No bets to settle' });
            return;
        }

        // Broad update to ensure everyone (even already settled) sees the latest format
        db.query('UPDATE bets SET result_number = ? WHERE TRIM(game_name) = ?', [number, game_name.trim()]);

        const parts = (number || '').split('-');
        let openPanna = 'XXX', jodi = 'XX', closePanna = 'XXX';

        if (parts.length === 3) {
            openPanna = parts[0];
            jodi = parts[1];
            closePanna = parts[2];
        } else if (parts.length === 1 && number.length === 1 && /[0-9]/.test(number)) {
            jodi = number + 'X';
        } else if (parts.length === 1 && number.length === 2 && /[0-9]/.test(number)) {
            jodi = number;
        }

        const openDigit = jodi[0] || 'X';
        const closeDigit = jodi[1] || 'X';

        const isOpenDigitDeclared = /[0-9]/.test(openDigit);
        const isCloseDigitDeclared = /[0-9]/.test(closeDigit);
        const isOpenPannaDeclared = openPanna.length === 3 && !openPanna.includes('X');
        const isClosePannaDeclared = closePanna.length === 3 && !closePanna.includes('X');
        const isJodiDeclared = jodi.length === 2 && !jodi.includes('X');

        let processed = 0;
        const processNext = () => {
            if (processed >= pendingBets.length) {
                console.log(`✅ All ${pendingBets.length} bets for ${game_name} settled.`);
                if (callback) callback({ message: `Settled ${pendingBets.length} bets` });
                return;
            }

            const bet = pendingBets[processed++];
            let outcome = 'PENDING';
            let multiplier = 9;
            const betNumber = String(bet.number || '').trim();

            try {
                if (bet.game_type === 'Single Digit') {
                    multiplier = 9.5;
                    if (bet.session === 'OPEN' && isOpenDigitDeclared) outcome = (betNumber === openDigit) ? 'Won' : 'Lost';
                    else if (bet.session === 'CLOSE' && isCloseDigitDeclared) outcome = (betNumber === closeDigit) ? 'Won' : 'Lost';
                } else if (bet.game_type === 'Double Digit (Jodi)') {
                    multiplier = 95;
                    if (isJodiDeclared) outcome = (betNumber === jodi) ? 'Won' : 'Lost';
                } else if (bet.game_type === 'Single Panna') {
                    multiplier = 156;
                    if (bet.session === 'OPEN' && isOpenPannaDeclared) outcome = (betNumber === openPanna) ? 'Won' : 'Lost';
                    else if (bet.session === 'CLOSE' && isClosePannaDeclared) outcome = (betNumber === closePanna) ? 'Won' : 'Lost';
                } else if (bet.game_type === 'Double Panna') {
                    multiplier = 320;
                    if (bet.session === 'OPEN' && isOpenPannaDeclared) outcome = (betNumber === openPanna) ? 'Won' : 'Lost';
                    else if (bet.session === 'CLOSE' && isClosePannaDeclared) outcome = (betNumber === closePanna) ? 'Won' : 'Lost';
                } else if (bet.game_type === 'Triple Panna') {
                    multiplier = 800;
                    if (bet.session === 'OPEN' && isOpenPannaDeclared) outcome = (betNumber === openPanna) ? 'Won' : 'Lost';
                    else if (bet.session === 'CLOSE' && isClosePannaDeclared) outcome = (betNumber === closePanna) ? 'Won' : 'Lost';
                } else if (bet.game_type === 'Half Sangam') {
                    multiplier = 1000;
                    const bParts = betNumber.split(/[x×]/);
                    if (bParts.length >= 2) {
                        if (bet.session === 'OPEN' && isOpenPannaDeclared && isCloseDigitDeclared) {
                           outcome = (bParts[0].trim() === openPanna && bParts[1].trim() === closeDigit) ? 'Won' : 'Lost';
                        } else if (bet.session === 'CLOSE' && isClosePannaDeclared && isOpenDigitDeclared) {
                           outcome = (bParts[0].trim() === closePanna && bParts[1].trim() === openDigit) ? 'Won' : 'Lost';
                        }
                    }
                } else if (bet.game_type === 'Full Sangam') {
                    multiplier = 10000;
                    const bParts = betNumber.split(/[x×]/);
                    if (bParts.length >= 2 && isOpenPannaDeclared && isClosePannaDeclared) {
                        outcome = (bParts[0].trim() === openPanna && bParts[1].trim() === closePanna) ? 'Won' : 'Lost';
                    }
                }
            } catch (calcErr) {
                console.error("Settlement Calc Error:", calcErr);
                outcome = 'PENDING';
            }

            if (outcome === 'Won') {
                const winAmount = bet.points * multiplier;
                db.query('UPDATE users SET balance = balance + ? WHERE mobile = ?', [winAmount, bet.user_mobile], (err) => {
                    if (err) console.error("Balance update failed:", err.message);
                    // 3. Final Step: Mark as Won in DB
                    // Note: Using 'Won' case to match strict ENUMs
                    db.query('UPDATE bets SET status = "Won", result_number = ?, payoutDone = 1 WHERE id = ?', [number, bet.id], (err) => {
                        if (err) {
                            console.error(`❌ STATUS UPDATE FAILED for Bet ${bet.id}:`, err.message);
                            // Fallback: try lowercase 'won' if strict enum is failing
                            db.query('UPDATE bets SET status = "won", result_number = ?, payoutDone = 1 WHERE id = ?', [number, bet.id], () => processNext());
                        } else {
                            console.log(`✅ Bet ${bet.id} fully settled as Won.`);
                            processNext();
                        }
                    });
                });
            } else if (outcome === 'Lost') {
                db.query('UPDATE bets SET status = "Lost", result_number = ? WHERE id = ?', [number, bet.id], (err) => {
                    if (err) {
                        db.query('UPDATE bets SET status = "lost", result_number = ? WHERE id = ?', [number, bet.id], () => processNext());
                    } else {
                        processNext();
                    }
                });
            } else {
                processNext();
            }
        };

        processNext();
    });
};

// =======================
// AUTH ENDPOINTS
// =======================

// Sign Up
app.post('/api/signup', (req, res) => {
    const { name, mobile, password } = req.body;
    const query = 'INSERT INTO users (name, mobile, password, isAdmin) VALUES (?, ?, ?, 0)';
    db.query(query, [name, mobile, password], (err, result) => {
        if (err) {
            console.error('Signup Error:', err);
            if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Mobile number already exists' });
            return res.status(500).json({ error: 'Database error: ' + err.message });
        }
        res.json({ message: 'User registered successfully', id: result.insertId });
    });
});

// Login
app.post('/api/login', (req, res) => {
    const { mobile, password } = req.body;
    const query = `
      SELECT id, mobile, mobile as name, balance, isAdmin, role, isBlocked as is_blocked 
      FROM users 
      WHERE mobile = ? AND password = ?
    `;
    
    db.query(query, [mobile, password], (err, results) => {
        if (err) {
            console.error('SERVER LOGIN ERROR:', err);
            return res.status(500).json({ error: 'Database error: ' + err.message });
        }
        
        if (results.length === 0) {
            return res.status(401).json({ error: 'Invalid mobile or password' });
        }
        
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
        SELECT w.*, u.mobile as name 
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

    db.getConnection((err, conn) => {
        if (err) return res.status(500).json({ error: 'Database Connection Error: ' + err.message });

        conn.beginTransaction(err => {
            if (err) { conn.release(); return res.status(500).json({ error: 'Trans Begin Error: ' + err.message }); }

            // 1. Get original withdrawal info
            conn.query('SELECT user_id, amount, status FROM withdrawals WHERE id = ?', [id], (err, results) => {
                if (err) return conn.rollback(() => { conn.release(); res.status(500).json({ error: err.message }); });
                if (results.length === 0) return conn.rollback(() => { conn.release(); res.status(404).json({ error: 'Withdrawal not found' }); });

                const withdrawal = results[0];
                if (withdrawal.status !== 'PENDING') return conn.rollback(() => { conn.release(); res.status(400).json({ error: 'Request is already ' + withdrawal.status }); });

                // 2. Update status
                conn.query('UPDATE withdrawals SET status = ? WHERE id = ?', [status, id], (err, result) => {
                    if (err) return conn.rollback(() => { conn.release(); res.status(500).json({ error: err.message }); });

                    // 3. If REJECTED, Refund Balance to User
                    if (status === 'REJECTED') {
                        const amount = parseFloat(withdrawal.amount);
                        conn.query('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, withdrawal.user_id], (err, userRes) => {
                            if (err) return conn.rollback(() => { conn.release(); res.status(500).json({ error: 'Refund Error: ' + err.message }); });
                            
                            conn.commit(err => {
                                if (err) return conn.rollback(() => { conn.release(); res.status(500).json({ error: 'Commit Error: ' + err.message }); });
                                conn.release();
                                console.log(`Successfully REJECTED withdrawal ${id} and REFUNDED ${amount} to user ${withdrawal.user_id}`);
                                res.json({ message: 'Withdrawal REJECTED and amount REFUNDED to user wallet ✅' });
                            });
                        });
                    } else {
                        // APPROVED case: Money already deducted on request
                        conn.commit(err => {
                            if (err) return conn.rollback(() => { conn.release(); res.status(500).json({ error: 'Commit Error: ' + err.message }); });
                            conn.release();
                            console.log(`Successfully APPROVED withdrawal ${id}`);
                            res.json({ message: 'Withdrawal APPROVED successfully ✅' });
                        });
                    }
                });
            });
        });
    });
});

// Request new withdrawal
app.post('/api/withdrawals', (req, res) => {
    const { id, user_id, amount, method, upi_id, account_number, ifsc } = req.body;
    const withdrawAmount = parseFloat(amount || 0);

    db.getConnection((err, conn) => {
        if (err) return res.status(500).json({ error: 'Database Connection Error: ' + err.message });

        conn.beginTransaction(err => {
            if (err) { conn.release(); return res.status(500).json({ error: 'Trans Begin Error: ' + err.message }); }

            // 1. Check if user has enough balance
            conn.query('SELECT balance FROM users WHERE id = ?', [user_id], (err, results) => {
                if (err) return conn.rollback(() => { conn.release(); res.status(500).json({ error: err.message }); });
                if (results.length === 0) return conn.rollback(() => { conn.release(); res.status(404).json({ error: 'User not found' }); });

                const balance = parseFloat(results[0].balance);
                if (balance < withdrawAmount) return conn.rollback(() => { conn.release(); res.status(400).json({ error: 'Insufficient wallet balance' }); });

                // 2. Deduct balance from users table immediately
                conn.query('UPDATE users SET balance = balance - ? WHERE id = ?', [withdrawAmount, user_id], (err, userRes) => {
                    if (err) return conn.rollback(() => { conn.release(); res.status(500).json({ error: 'Balance deduction failed: ' + err.message }); });

                    // 3. Insert withdrawal request WITH custom ID
                    const insertSql = 'INSERT INTO withdrawals (id, user_id, amount, method, upi_id, account_number, ifsc, status) VALUES (?, ?, ?, ?, ?, ?, ?, "PENDING")';
                    conn.query(insertSql, [id, user_id, withdrawAmount, method, upi_id, account_number, ifsc], (err, result) => {
                        if (err) return conn.rollback(() => { conn.release(); res.status(500).json({ error: 'Insert Withdrawal Error: ' + err.message }); });

                        conn.commit(err => {
                            if (err) return conn.rollback(() => { conn.release(); res.status(500).json({ error: 'Commit Error: ' + err.message }); });
                            conn.release();
                            console.log(`User ${user_id} requested withdrawal. ${withdrawAmount} deducted from wallet. ID: ${id}`);
                            res.json({ message: 'Withdrawal requested successfully. Amount deducted from wallet.', new_balance: balance - withdrawAmount });
                        });
                    });
                });
            });
        });
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

const seedSettings = () => {
    db.query('SELECT COUNT(*) AS count FROM site_settings', (err, results) => {
        if (!err && results[0].count === 0) {
            console.log('Seeding default site settings...');
            db.query('INSERT INTO site_settings (id, admin_upi, support_number) VALUES (1, "3103624a@bandhan", "91XXXXXXXXXX")');
        }
    });
};
seedSettings();

// Get Site Settings
app.get('/api/settings', (req, res) => {
    db.query('SELECT * FROM site_settings WHERE id = 1', (err, results) => {
        if (err || results.length === 0) {
            return res.json({ admin_upi: '3103624a@bandhan', support_number: '91XXXXXXXXXX' });
        }
        res.json(results[0]);
    });
});

// Update Site Settings (Admin)
app.put('/api/settings', (req, res) => {
    const { admin_upi, support_number } = req.body;
    db.query('UPDATE site_settings SET admin_upi = ?, support_number = ? WHERE id = 1', 
    [admin_upi, support_number], (err, result) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ message: 'Settings updated successfully' });
    });
});

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
        if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
        
        // AUTO-FINALIZE: Automatically settle bets when number is updated
        if (number && number !== 'XXX-XX-XXX') {
            settleBets(name, number, (settleRes) => {
                console.log(`Auto-settled bets for ${name}:`, settleRes ? settleRes.message : 'Done');
            });
        }
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
    const query = 'SELECT id, mobile as name, mobile, balance, is_blocked, created_at FROM users WHERE isAdmin = 0 ORDER BY created_at DESC';
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(results);
    });
});

// Admin: Toggle block status
app.put('/api/users/:id/toggle-block', (req, res) => {
    const { id } = req.params;
    db.query('UPDATE users SET isBlocked = NOT isBlocked WHERE id = ?', [id], (err, result) => {
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
    const query = `
        SELECT d.*, IFNULL(u.mobile, 'Unknown User') as name 
        FROM deposits d 
        LEFT JOIN users u ON d.user_id = u.id 
        ORDER BY d.created_at DESC
    `;
    db.query(query, (err, results) => {
        if (err) {
            console.error("Fetch deposits error:", err.message);
            return res.status(500).json({ error: 'Fetch Deposits Error: ' + err.message });
        }
        res.json(results);
    });
});

// Create deposit request (User)
app.post('/api/deposits', (req, res) => {
    const { user_id, amount, method, utr_id } = req.body;
    const sql = 'INSERT INTO deposits (user_id, amount, method, utr_id, status) VALUES (?, ?, ?, ?, "PENDING")';
    db.query(sql, [user_id, amount, method, utr_id], (err, results) => {
        if (err) {
            console.error("Deposit submission error:", err.message);
            return res.status(500).json({ error: 'Deposit Error: ' + err.message });
        }
        res.json({ message: 'Deposit request submitted', insertId: results.insertId });
    });
});

// Update deposit status (Approve/Reject)
app.put("/api/deposits/:id/status", (req, res) => {
  const id = req.params.id;
  const { status } = req.body;

  console.log("==== DEBUG START ====");
  console.log("ID:", id);
  console.log("BODY:", req.body);
  console.log("STATUS:", status);

  if (!status) {
    return res.status(400).json({ error: "Status is required" });
  }

  db.getConnection((err, conn) => {
    if (err) {
      console.error("Get Connection Error:", err);
      return res.status(500).json({ error: 'Database Connection Error: ' + err.message });
    }

    conn.beginTransaction(err => {
      if (err) {
        conn.release();
        console.error("Trans Begin Error:", err);
        return res.status(500).json({ error: 'Transaction Begin Error: ' + err.message });
      }

      // 1. Get deposit info before anything
      conn.query('SELECT user_id, amount, status FROM deposits WHERE id = ?', [id], (err, results) => {
        if (err) return conn.rollback(() => { conn.release(); res.status(500).json({ error: 'Fetch Deposit Error: ' + err.message }); });
        if (results.length === 0) return conn.rollback(() => { conn.release(); res.status(404).json({ error: 'Deposit not found' }); });

        const deposit = results[0];
        if (deposit.status !== 'PENDING') return conn.rollback(() => { conn.release(); res.status(400).json({ error: 'Deposit is ' + deposit.status + ', cannot change.' }); });

        // 2. Update status
        const updateStatusSql = "UPDATE deposits SET status = ? WHERE id = ?";
        conn.query(updateStatusSql, [status, id], (err, updateRes) => {
          if (err) return conn.rollback(() => { conn.release(); res.status(500).json({ error: 'Status Update Error: ' + err.message }); });

          // 3. If APPROVED, Add Balance to User
          if (status === 'APPROVED') {
            const amount = parseFloat(deposit.amount);
            conn.query('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, deposit.user_id], (err, userRes) => {
              if (err) return conn.rollback(() => { conn.release(); res.status(500).json({ error: 'Balance Update Error: ' + err.message }); });
              
              conn.commit(err => {
                if (err) return conn.rollback(() => { conn.release(); res.status(500).json({ error: 'Commit Error: ' + err.message }); });
                conn.release();
                console.log(`Successfully approved deposit ${id} for user ${deposit.user_id}. Amount added: ${amount}`);
                res.json({ message: "Status updated and balance added successfully ✅" });
              });
            });
          } else {
            conn.commit(err => {
              if (err) return conn.rollback(() => { conn.release(); res.status(500).json({ error: 'Commit Error: ' + err.message }); });
              conn.release();
              console.log(`Successfully rejected deposit ${id}`);
              res.json({ message: "Deposit rejected successfully ✅" });
            });
          }
        });
      });
    });
  });
});

// --- BETTING ENDPOINTS ---

// Fetch User Data (Balance + Bets + Block Status) - For AUTO SYNC
app.get('/api/users/:mobile/sync', (req, res) => {
    const { mobile } = req.params;
    const userSql = 'SELECT id, mobile, balance, isAdmin, is_blocked FROM users WHERE mobile = ?';
    const betsSql = 'SELECT * FROM bets WHERE user_mobile = ? ORDER BY created_at DESC LIMIT 50';

    db.query(userSql, [mobile], (err, userRes) => {
        if (err) {
            console.error("Sync user error:", err.message);
            return res.status(500).json({ error: 'Sync User Error: ' + err.message });
        }
        if (userRes.length === 0) return res.status(404).json({ error: 'User not found' });

        db.query(betsSql, [mobile], (err, betsRes) => {
            if (err) {
                console.error("Sync bets error:", err.message);
                return res.status(500).json({ error: 'Sync Bets Error: ' + err.message });
            }
            res.json({
                balance: userRes[0].balance,
                is_blocked: userRes[0].isBlocked,
                isAdmin: userRes[0].isAdmin,
                bets: betsRes
            });
        });
    });
});

// Fetch Combined Transaction History (Deposits + Withdrawals)
app.get('/api/users/:userId/transactions', (req, res) => {
    const { userId } = req.params;
    const query = `
        (SELECT id, amount, status, created_at, 'DEPOSIT' as type, method FROM deposits WHERE user_id = ?)
        UNION ALL
        (SELECT id, amount, status, created_at, 'WITHDRAWAL' as type, method FROM withdrawals WHERE user_id = ?)
        ORDER BY created_at DESC
    `;
    db.query(query, [userId, userId], (err, results) => {
        if (err) {
            console.error("Fetch transactions error:", err.message);
            return res.status(500).json({ error: 'Database error: ' + err.message });
        }
        res.json(results);
    });
});

// Bank Account Management API
app.get('/api/users/:userId/accounts', (req, res) => {
    const { userId } = req.params;
    db.query('SELECT * FROM user_bank_accounts WHERE user_id = ? ORDER BY created_at DESC', [userId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/users/:userId/accounts', (req, res) => {
    const { userId } = req.params;
    const { account_type, bank_name, account_holder, account_number, ifsc_code, upi_id } = req.body;
    
    const query = 'INSERT INTO user_bank_accounts (user_id, account_type, bank_name, account_holder, account_number, ifsc_code, upi_id) VALUES (?, ?, ?, ?, ?, ?, ?)';
    db.query(query, [userId, account_type, bank_name, account_holder, account_number, ifsc_code, upi_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Account saved successfully', id: result.insertId });
    });
});

app.delete('/api/users/:userId/accounts/:accountId', (req, res) => {
    const { userId, accountId } = req.params;
    db.query('DELETE FROM user_bank_accounts WHERE id = ? AND user_id = ?', [accountId, userId], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Account deleted' });
    });
});

// Place Bet (User)
app.post('/api/bets', (req, res) => {
    const { user_mobile, game_name, game_type, session, number, points } = req.body;

    db.getConnection((err, conn) => {
        if (err) return res.status(500).json({ error: 'Database Connection Error: ' + err.message });

        conn.beginTransaction(err => {
            if (err) { conn.release(); return res.status(500).json({ error: 'Trans Begin Error: ' + err.message }); }

            // 1. Check Balance
            conn.query('SELECT id, balance FROM users WHERE mobile = ?', [user_mobile], (err, results) => {
                if (err) return conn.rollback(() => { conn.release(); res.status(500).json({ error: 'Check Bal Error: ' + err.message }); });
                if (results.length === 0) return conn.rollback(() => { conn.release(); res.status(404).json({ error: 'User not found' }); });

                const userId = results[0].id;
                const balance = results[0].balance;
                if (balance < points) return conn.rollback(() => { conn.release(); res.status(400).json({ error: 'Insufficient Balance' }); });

                // 2. Subtract Balance
                conn.query('UPDATE users SET balance = balance - ? WHERE mobile = ?', [points, user_mobile], (err, results) => {
                    if (err) return conn.rollback(() => { conn.release(); res.status(500).json({ error: 'Update Bal Error: ' + err.message }); });

                    // 3. Insert Bet - Using the correct database ENUM values (PENDING, WON, LOST)
                    const betSql = 'INSERT INTO bets (user_id, user_mobile, game_name, game_type, session, number, points, status) VALUES (?, ?, ?, ?, ?, ?, ?, "PENDING")';
                    conn.query(betSql, [userId, user_mobile, game_name, game_type, session, number, points], (err, results) => {
                        if (err) return conn.rollback(() => { conn.release(); res.status(500).json({ error: 'Insert Bet Error: ' + err.message }); });

                        conn.commit(err => {
                            if (err) return conn.rollback(() => { conn.release(); res.status(500).json({ error: 'Commit Error: ' + err.message }); });
                            conn.release();
                            res.json({ message: 'Bet placed successfully', balance: balance - points });
                        });
                    });
                });
            });
        });
    });
});

// Declare Result Route (Manual Trigger)
app.post('/api/declare-result', (req, res) => {
    const { game_name, number } = req.body;
    db.query('UPDATE games SET number = ? WHERE name = ?', [number, game_name], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        settleBets(game_name, number, (settleRes) => {
            if (settleRes.error) return res.status(500).json({ error: settleRes.error });
            res.json(settleRes);
        });
    });
});

// Global Error Handler (MUST BE AT THE BOTTOM)
app.use((err, req, res, next) => {
    console.error("ERROR 💥:", err);
    res.status(500).json({ 
        error: "Internal Server Error", 
        message: err.message,
        details: err.code || 'No code'
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
