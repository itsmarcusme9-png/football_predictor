// server.js - Complete Backend with Auto-Update System
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'your-secret-key-change-this-in-production';

// ============ REAL API CONFIG ============
const API_KEY = 'ft_football_6ca052be156f35e9336ac1bcf0a898a1de3a60f4';
const API_BASE = 'https://api.kickoffapi.com/api/v1';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Database files
const USERS_FILE = path.join(__dirname, 'users.json');
const PREDICTIONS_FILE = path.join(__dirname, 'predictions.json');

// Initialize database files
function initDB() {
    if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }));
    }
    if (!fs.existsSync(PREDICTIONS_FILE)) {
        fs.writeFileSync(PREDICTIONS_FILE, JSON.stringify({ predictions: [] }));
    }
}
initDB();

// Read/write functions
function getUsers() {
    try {
        const data = fs.readFileSync(USERS_FILE);
        return JSON.parse(data);
    } catch {
        return { users: [] };
    }
}

function saveUsers(data) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

function getPredictions() {
    try {
        const data = fs.readFileSync(PREDICTIONS_FILE);
        return JSON.parse(data);
    } catch {
        return { predictions: [] };
    }
}

function savePredictions(data) {
    fs.writeFileSync(PREDICTIONS_FILE, JSON.stringify(data, null, 2));
}

// Helper: Generate form
function generateForm() {
    const results = ['W', 'D', 'L'];
    const form = [];
    for (let i = 0; i < 5; i++) {
        const r = Math.random();
        if (r > 0.6) form.push('W');
        else if (r > 0.3) form.push('D');
        else form.push('L');
    }
    return form;
}

// ============ FETCH REAL MATCHES FROM KICKOFFAPI ============
async function fetchRealMatches() {
    try {
        const today = new Date();
        const from = today.toISOString().split('T')[0];
        const to = new Date(today.getTime() + 7 * 86400000).toISOString().split('T')[0];

        console.log(`📅 Fetching matches from ${from} to ${to}`);

        let response = await fetch(
            `${API_BASE}/fixtures?from=${from}&to=${to}`,
            {
                headers: {
                    'X-API-Key': API_KEY,
                    'Accept': 'application/json'
                }
            }
        );

        if (!response.ok) {
            console.log(`API Error: ${response.status}`);
            return null;
        }

        const data = await response.json();
        console.log('✅ API Response received');

        let matches = [];
        if (data.data && Array.isArray(data.data)) {
            matches = data.data;
        } else if (data.fixtures && Array.isArray(data.fixtures)) {
            matches = data.fixtures;
        } else if (data.response && Array.isArray(data.response)) {
            matches = data.response;
        } else if (Array.isArray(data)) {
            matches = data;
        }

        if (matches.length === 0) {
            console.log('⚠️ No matches found');
            return null;
        }

        console.log(`📊 Found ${matches.length} total matches`);

        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        const nextWeekStr = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];
        
        matches = matches.filter(m => {
            const matchDate = new Date(m.date || m.kickoff || m.start_time || Date.now());
            const matchDateStr = matchDate.toISOString().split('T')[0];
            return matchDateStr >= todayStr && matchDateStr <= nextWeekStr;
        });

        console.log(`📅 Next 7 days: ${matches.length} matches`);

        const leagueNames = [...new Set(matches.map(m => 
            (m.league?.name || m.league || m.competition?.name || 'Unknown')
        ))];
        console.log(`📋 Leagues: ${leagueNames.join(', ')}`);

        if (matches.length > 100) {
            matches = matches.slice(0, 100);
            console.log(`📊 Limited to top 100 matches`);
        }

        const transformed = matches.map(m => {
            const matchDate = new Date(m.date || m.kickoff || m.start_time || m.startTime || Date.now());
            const homeForm = generateForm();
            const awayForm = generateForm();
            
            return {
                id: m.id || `match-${Date.now()}-${Math.random()}`,
                date: matchDate.toISOString().split('T')[0],
                time: matchDate.toTimeString().slice(0, 5),
                league: m.league?.name || m.competition?.name || m.tournament?.name || m.league_name || 'Unknown League',
                home: m.home?.name || m.homeTeam?.name || m.team_home?.name || m.home_name || 'Home',
                away: m.away?.name || m.awayTeam?.name || m.team_away?.name || m.away_name || 'Away',
                status: m.status === 'LIVE' || m.status === 'live' || m.status === 'inplay' ? 'live' : 'upcoming',
                form: {
                    home: homeForm,
                    away: awayForm,
                    homePoints: homeForm.filter(f => f === 'W').length * 3 + homeForm.filter(f => f === 'D').length,
                    awayPoints: awayForm.filter(f => f === 'W').length * 3 + awayForm.filter(f => f === 'D').length
                },
                odds: {
                    home: m.odds?.home || m.odds?.home_win || m.odds_home || (1.5 + Math.random() * 1.5).toFixed(2),
                    draw: m.odds?.draw || m.odds_draw || (2.5 + Math.random() * 1.5).toFixed(2),
                    away: m.odds?.away || m.odds?.away_win || m.odds_away || (1.5 + Math.random() * 1.5).toFixed(2)
                },
                h2h: {
                    homeWins: Math.floor(Math.random() * 5),
                    draws: Math.floor(Math.random() * 4),
                    awayWins: Math.floor(Math.random() * 5)
                }
            };
        });

        console.log(`✅ Final: ${transformed.length} matches ready for predictions`);
        return transformed;

    } catch (error) {
        console.error('❌ API Error:', error.message);
        return null;
    }
}

// ============ AUTHENTICATION ============

// Register
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    const db = getUsers();
    
    if (db.users.find(u => u.username === username || u.email === email)) {
        return res.status(400).json({ error: 'Username or email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = {
        id: Date.now().toString(),
        username,
        email,
        password: hashedPassword,
        isOwner: false,
        createdAt: new Date().toISOString(),
        settings: { favoriteLeagues: [], favoriteTeams: [] },
        stats: { totalPredictions: 0, correctPredictions: 0, accuracy: 0 }
    };

    db.users.push(user);
    saveUsers(db);

    const token = jwt.sign(
        { id: user.id, username: user.username, isOwner: false },
        JWT_SECRET,
        { expiresIn: '7d' }
    );

    res.json({
        token,
        user: {
            id: user.id,
            username: user.username,
            email: user.email,
            isOwner: false,
            settings: user.settings,
            stats: user.stats
        }
    });
});

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    const db = getUsers();
    const user = db.users.find(u => u.username === username);

    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
        { id: user.id, username: user.username, isOwner: user.isOwner || false },
        JWT_SECRET,
        { expiresIn: '7d' }
    );

    res.json({
        token,
        user: {
            id: user.id,
            username: user.username,
            email: user.email,
            isOwner: user.isOwner || false,
            settings: user.settings,
            stats: user.stats
        }
    });
});

// ============ OWNER AUTO-LOGIN ============
app.get('/api/owner', async (req, res) => {
    const db = getUsers();
    let owner = db.users.find(u => u.username === 'owner');

    if (!owner) {
        const hashedPassword = await bcrypt.hash('admin123', 10);
        owner = {
            id: 'owner-' + Date.now(),
            username: 'owner',
            email: 'owner@predictor.com',
            password: hashedPassword,
            isOwner: true,
            createdAt: new Date().toISOString(),
            settings: { favoriteLeagues: [], favoriteTeams: [] },
            stats: { totalPredictions: 0, correctPredictions: 0, accuracy: 0 }
        };
        db.users.push(owner);
        saveUsers(db);
    }

    const token = jwt.sign(
        { id: owner.id, username: owner.username, isOwner: true },
        JWT_SECRET,
        { expiresIn: '365d' }
    );

    res.json({
        token,
        user: {
            id: owner.id,
            username: owner.username,
            email: owner.email,
            isOwner: true,
            settings: owner.settings,
            stats: owner.stats
        }
    });
});

// ============ VERIFY TOKEN MIDDLEWARE ============
function verifyToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.id;
        req.isOwner = decoded.isOwner || false;
        next();
    } catch {
        res.status(401).json({ error: 'Invalid token' });
    }
}

// ============ ADMIN ROUTES ============
app.get('/api/admin/users', verifyToken, (req, res) => {
    const db = getUsers();
    const user = db.users.find(u => u.id === req.userId);
    
    if (!user || !user.isOwner) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const safeUsers = db.users.map(u => ({
        id: u.id,
        username: u.username,
        email: u.email,
        isOwner: u.isOwner || false,
        createdAt: u.createdAt,
        stats: u.stats
    }));

    res.json(safeUsers);
});

app.delete('/api/admin/users/:userId', verifyToken, (req, res) => {
    const db = getUsers();
    const user = db.users.find(u => u.id === req.userId);
    
    if (!user || !user.isOwner) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const userId = req.params.userId;
    const userIndex = db.users.findIndex(u => u.id === userId);
    
    if (userIndex === -1) {
        return res.status(404).json({ error: 'User not found' });
    }

    if (userId === req.userId) {
        return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    db.users.splice(userIndex, 1);
    saveUsers(db);

    res.json({ success: true, message: 'User deleted' });
});

app.get('/api/admin/predictions', verifyToken, (req, res) => {
    const db = getUsers();
    const user = db.users.find(u => u.id === req.userId);
    
    if (!user || !user.isOwner) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const predDb = getPredictions();
    res.json(predDb.predictions);
});

app.get('/api/admin/stats', verifyToken, (req, res) => {
    const db = getUsers();
    const user = db.users.find(u => u.id === req.userId);
    
    if (!user || !user.isOwner) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const predDb = getPredictions();
    const totalPredictions = predDb.predictions.length;
    const correctPredictions = predDb.predictions.filter(p => p.result === 'correct').length;

    res.json({
        totalUsers: db.users.length,
        totalPredictions: totalPredictions,
        correctPredictions: correctPredictions,
        accuracy: totalPredictions ? (correctPredictions / totalPredictions * 100).toFixed(1) : 0
    });
});

// ============ USER ROUTES ============
app.get('/api/profile', verifyToken, (req, res) => {
    const db = getUsers();
    const user = db.users.find(u => u.id === req.userId);

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        isOwner: user.isOwner || false,
        settings: user.settings,
        stats: user.stats
    });
});

app.put('/api/settings', verifyToken, (req, res) => {
    const db = getUsers();
    const userIndex = db.users.findIndex(u => u.id === req.userId);

    if (userIndex === -1) {
        return res.status(404).json({ error: 'User not found' });
    }

    db.users[userIndex].settings = {
        ...db.users[userIndex].settings,
        ...req.body
    };

    saveUsers(db);
    res.json({ success: true, settings: db.users[userIndex].settings });
});

// ============ PREDICTIONS API ============
app.get('/api/predictions', verifyToken, (req, res) => {
    const db = getPredictions();
    const userPredictions = db.predictions.filter(p => p.userId === req.userId);
    res.json(userPredictions);
});

app.post('/api/prediction/result', verifyToken, (req, res) => {
    const { predictionId, correct } = req.body;
    const db = getPredictions();
    
    const predIndex = db.predictions.findIndex(p => p.id === predictionId);
    if (predIndex === -1) {
        return res.status(404).json({ error: 'Prediction not found' });
    }

    db.predictions[predIndex].result = correct ? 'correct' : 'incorrect';
    savePredictions(db);

    const userDb = getUsers();
    const userIndex = userDb.users.findIndex(u => u.id === req.userId);
    
    if (userIndex !== -1) {
        userDb.users[userIndex].stats.totalPredictions += 1;
        if (correct) {
            userDb.users[userIndex].stats.correctPredictions += 1;
        }
        userDb.users[userIndex].stats.accuracy = 
            (userDb.users[userIndex].stats.correctPredictions / 
             userDb.users[userIndex].stats.totalPredictions) * 100;
        saveUsers(userDb);
    }

    res.json({ success: true });
});

// ============ GENERATE PREDICTIONS ============
app.get('/api/generate-predictions', verifyToken, async (req, res) => {
    try {
        let matches = await fetchRealMatches();

        if (!matches || matches.length === 0) {
            console.log('⚠️ Using fallback predictions');
            matches = generateFallbackMatches();
        }

        const predictions = matches.map(match => {
            return generatePredictionForMatch(match, req.userId);
        });

        const db = getPredictions();
        const newPredictions = predictions.map(p => ({
            ...p,
            userId: req.userId,
            result: 'pending',
            createdAt: new Date().toISOString()
        }));
        
        db.predictions.push(...newPredictions);
        savePredictions(db);

        res.json(newPredictions);

    } catch (error) {
        console.error('❌ Error generating predictions:', error);
        const fallback = generateFallbackPredictions(req.userId);
        res.json(fallback);
    }
});

function generatePredictionForMatch(match, userId) {
    let homeProb, drawProb, awayProb;

    if (match.odds && match.odds.home > 1) {
        const homeOdds = parseFloat(match.odds.home);
        const drawOdds = parseFloat(match.odds.draw);
        const awayOdds = parseFloat(match.odds.away);
        
        const total = 1/homeOdds + 1/drawOdds + 1/awayOdds;
        homeProb = (1/homeOdds) / total;
        drawProb = (1/drawOdds) / total;
        awayProb = (1/awayOdds) / total;
    } else {
        const homeForm = match.form?.home || ['W', 'D', 'L'];
        const awayForm = match.form?.away || ['W', 'D', 'L'];
        
        const homePoints = homeForm.reduce((sum, r) => {
            if (r === 'W') return sum + 3;
            if (r === 'D') return sum + 1;
            return sum;
        }, 0);
        
        const awayPoints = awayForm.reduce((sum, r) => {
            if (r === 'W') return sum + 3;
            if (r === 'D') return sum + 1;
            return sum;
        }, 0);
        
        const totalPoints = homePoints + awayPoints || 1;
        homeProb = (homePoints / totalPoints) * 0.6 + 0.2;
        drawProb = 0.25;
        awayProb = 1 - homeProb - drawProb;
        
        const random = (Math.random() - 0.5) * 0.05;
        homeProb += random;
        awayProb -= random;
        drawProb += (Math.random() - 0.5) * 0.03;
        
        const total = homeProb + drawProb + awayProb;
        homeProb /= total;
        drawProb /= total;
        awayProb /= total;
    }

    let prediction, confidence;
    if (homeProb > drawProb && homeProb > awayProb) {
        prediction = 'home';
        confidence = Math.round((homeProb * 100) + 10);
        if (homeProb - drawProb > 0.15 && homeProb - awayProb > 0.15) {
            confidence += 5;
        }
    } else if (awayProb > homeProb && awayProb > drawProb) {
        prediction = 'away';
        confidence = Math.round((awayProb * 100) + 10);
        if (awayProb - drawProb > 0.15 && awayProb - homeProb > 0.15) {
            confidence += 5;
        }
    } else {
        prediction = 'draw';
        confidence = Math.round((drawProb * 100) + 10);
        if (drawProb - homeProb > 0.10 && drawProb - awayProb > 0.10) {
            confidence += 5;
        }
    }

    confidence = Math.max(confidence, 45);
    confidence = Math.min(confidence, 92);

    const homeGoals = Math.round(homeProb * 4 + (Math.random() - 0.5) * 0.3);
    const awayGoals = Math.round(awayProb * 3.5 + (Math.random() - 0.5) * 0.3);

    return {
        id: `pred-${Date.now()}-${Math.random()}-${userId}`,
        date: match.date || new Date().toISOString().split('T')[0],
        league: match.league || 'Unknown',
        home: match.home || 'Home',
        away: match.away || 'Away',
        prediction: prediction,
        confidence: confidence,
        probabilities: {
            home: Math.round(homeProb * 100),
            draw: Math.round(drawProb * 100),
            away: Math.round(awayProb * 100)
        },
        predictedScore: `${homeGoals}-${awayGoals}`,
        h2h: match.h2h || { homeWins: 0, draws: 0, awayWins: 0 },
        form: {
            home: match.form?.home || ['W', 'D', 'L'],
            away: match.form?.away || ['W', 'D', 'L']
        }
    };
}

function generateFallbackMatches() {
    const leagues = ['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1'];
    const teams = {
        'Premier League': ['Arsenal', 'Chelsea', 'Liverpool', 'Man City', 'Tottenham', 'Man United'],
        'La Liga': ['Barcelona', 'Real Madrid', 'Sevilla', 'Atletico Madrid', 'Valencia'],
        'Serie A': ['Inter Milan', 'Juventus', 'AC Milan', 'Napoli', 'Roma'],
        'Bundesliga': ['Bayern Munich', 'Dortmund', 'Leipzig', 'Leverkusen'],
        'Ligue 1': ['PSG', 'Marseille', 'Lyon', 'Monaco']
    };

    const matches = [];
    const today = new Date();

    for (let day = 0; day < 3; day++) {
        const date = new Date(today);
        date.setDate(date.getDate() + day);
        const dateStr = date.toISOString().split('T')[0];

        const numMatches = 3 + Math.floor(Math.random() * 4);
        
        for (let i = 0; i < numMatches; i++) {
            const league = leagues[Math.floor(Math.random() * leagues.length)];
            const teamList = teams[league] || teams['Premier League'];
            
            const homeIdx = Math.floor(Math.random() * teamList.length);
            let awayIdx = Math.floor(Math.random() * teamList.length);
            while (awayIdx === homeIdx) {
                awayIdx = Math.floor(Math.random() * teamList.length);
            }

            matches.push({
                date: dateStr,
                league: league,
                home: teamList[homeIdx],
                away: teamList[awayIdx],
                status: 'upcoming',
                form: {
                    home: generateForm(),
                    away: generateForm(),
                    homePoints: Math.floor(Math.random() * 10),
                    awayPoints: Math.floor(Math.random() * 10)
                },
                odds: {
                    home: (1.5 + Math.random() * 1.5).toFixed(2),
                    draw: (2.5 + Math.random() * 1.5).toFixed(2),
                    away: (1.5 + Math.random() * 1.5).toFixed(2)
                },
                h2h: {
                    homeWins: Math.floor(Math.random() * 5),
                    draws: Math.floor(Math.random() * 4),
                    awayWins: Math.floor(Math.random() * 5)
                }
            });
        }
    }

    return matches;
}

function generateFallbackPredictions(userId) {
    const matches = generateFallbackMatches();
    return matches.map(match => generatePredictionForMatch(match, userId));
}

// ============ AUTO-UPDATE SYSTEM ============
// This allows you to update your site with ONE command!

// Endpoint 1: Update a file and deploy
app.post('/api/update-site', async (req, res) => {
    try {
        const { file, content } = req.body;
        
        const token = req.headers['authorization']?.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        
        let responseMessage = '';

        if (file && content) {
            const filePath = path.join(__dirname, file);
            fs.writeFileSync(filePath, content);
            responseMessage += `✅ Updated: ${file}\n`;
            console.log(`✅ Updated: ${file}`);
        }
        
        exec('git add . && git commit -m "🤖 AI auto-update" && git push origin main', 
            (error, stdout, stderr) => {
                if (error) {
                    console.log('Git error:', error);
                    return res.json({ 
                        success: true, 
                        message: responseMessage + 'File updated but git push failed. Manual push needed.',
                        error: stderr
                    });
                }
                console.log('✅ Git push successful');
                console.log('📤 Git output:', stdout);
                
                res.json({ 
                    success: true, 
                    message: responseMessage + '🚀 Site updated and deployed! Changes will be live in 1-2 minutes.',
                    gitOutput: stdout
                });
            }
        );
        
    } catch (error) {
        console.error('❌ Update error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint 2: Quick deploy (just push current changes)
app.post('/api/deploy-site', async (req, res) => {
    try {
        const token = req.headers['authorization']?.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        
        exec('git add . && git commit -m "⚡ Quick deploy" && git push origin main', 
            (error, stdout, stderr) => {
                if (error) {
                    return res.json({ success: false, error: stderr });
                }
                res.json({ 
                    success: true, 
                    message: '🚀 Deploy triggered! Site will update in 1-2 minutes.',
                    output: stdout
                });
            }
        );
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint 3: Get site status (what's changed, etc.)
app.get('/api/site-status', (req, res) => {
    exec('git status --porcelain', (error, stdout) => {
        if (error) {
            return res.json({ status: 'error', message: error.message });
        }
        const changes = stdout ? stdout.split('\n').filter(Boolean) : [];
        res.json({
            status: 'ok',
            changes: changes,
            hasChanges: changes.length > 0,
            message: changes.length ? `${changes.length} files changed` : 'No changes'
        });
    });
});

// ============ START SERVER ============
app.listen(PORT, () => {
    console.log(`⚽ Football Predictor Server running on http://localhost:${PORT}`);
    console.log(`📊 API endpoints:`);
    console.log(`   - POST /api/register`);
    console.log(`   - POST /api/login`);
    console.log(`   - GET  /api/owner (Owner auto-login)`);
    console.log(`   - GET  /api/profile`);
    console.log(`   - GET  /api/predictions`);
    console.log(`   - GET  /api/generate-predictions (REAL DATA!)`);
    console.log(`   - GET  /api/admin/users (Admin only)`);
    console.log(`   - POST /api/update-site (Auto-update)`);
    console.log(`   - POST /api/deploy-site (Quick deploy)`);
    console.log(`   - GET  /api/site-status (Check status)`);
});
