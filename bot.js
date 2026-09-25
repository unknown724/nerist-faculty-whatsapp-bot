/**
 * NERIST Faculty WhatsApp Bot & 24/7 Hostel Server Controller
 * Features:
 * - Smart faculty lookup with acronyms (@find akr, @find Rajesh Kumar)
 * - Auto-login to NERIST Hostel Wi-Fi captive portal (10.10.200.1:8090)
 * - Electricity cut / restore detection & proactive WhatsApp alerts
 * - Remote admin control via "Message Yourself" (#status, #shutdown, #restart, #wifilogin)
 * - Failsafe auto-shutdown on critical battery (<12%)
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');

// 1. Load .env configuration
function loadEnv() {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const idx = trimmed.indexOf('=');
                if (idx !== -1) {
                    const key = trimmed.slice(0, idx).trim();
                    const val = trimmed.slice(idx + 1).trim();
                    process.env[key] = val;
                }
            }
        }
    }
}
loadEnv();

const CAMPUS_PORTAL_URL = process.env.CAMPUS_PORTAL_URL || 'http://10.10.200.1:8090';
const CAMPUS_WIFI_USER = process.env.CAMPUS_WIFI_USER || '122148';
const CAMPUS_WIFI_PASS = process.env.CAMPUS_WIFI_PASS || 'Tombinao123';
const SHUTDOWN_THRESHOLD = parseInt(process.env.AUTO_SHUTDOWN_BATTERY_THRESHOLD || '12', 10);

function log(...args) {
    const timestamp = new Date().toLocaleString();
    console.log(`[${timestamp}]`, ...args);
}

// 2. Load faculty database
let facultyList = [];
try {
    const facultyPath = path.join(__dirname, 'faculty.json');
    if (fs.existsSync(facultyPath)) {
        facultyList = JSON.parse(fs.readFileSync(facultyPath, 'utf8'));
        log(`Loaded ${facultyList.length} faculty records from faculty.json.`);
    }
} catch (err) {
    console.warn('Warning: Failed to load faculty.json:', err.message);
}

/**
 * Extracts acronyms from name (e.g. "Dr. Ashok Kumar Ray" -> "akr")
 */
function getAcronym(str) {
    if (!str) return '';
    return str
        .replace(/\b(dr|mr|ms|prof|mrs|er)\b\.?/gi, '')
        .replace(/[^a-zA-Z\s]/g, '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(w => w[0])
        .join('')
        .toLowerCase();
}

/**
 * Faculty Smart Search
 */
function searchFaculty(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const exactAcronym = facultyList.filter(f => 
        getAcronym(f.name) === q || getAcronym(f.portalName) === q
    );
    if (exactAcronym.length > 0) return exactAcronym;

    const emailMatch = facultyList.filter(f => 
        (f.emails || []).some(em => em.toLowerCase().split('@')[0] === q)
    );
    if (emailMatch.length > 0) return emailMatch;

    const nameMatches = facultyList.filter(f => {
        const name = (f.name || '').toLowerCase();
        const pName = (f.portalName || '').toLowerCase();
        return name.includes(q) || pName.includes(q);
    });
    if (nameMatches.length > 0) return nameMatches;

    return facultyList.filter(f => {
        const dept = (f.department || '').toLowerCase();
        return dept.includes(q);
    });
}

/**
 * Hardware Power & Battery Sensing (Windows API via PowerShell)
 */
function getPowerStatus() {
    try {
        const cmd = 'powershell -NoProfile -Command "(Get-CimInstance Win32_Battery).EstimatedChargeRemaining; (Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus).PowerOnline"';
        const lines = execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        const batteryPct = parseInt(lines[0], 10) || 100;
        const isAcOnline = lines[1] ? lines[1].toLowerCase() === 'true' : true;
        return { batteryPct, isAcOnline, success: true };
    } catch (e) {
        return { batteryPct: 100, isAcOnline: true, success: false, error: e.message };
    }
}

/**
 * NERIST Campus Portal Auto-Login
 */
async function loginCampusPortal() {
    if (!CAMPUS_WIFI_USER || !CAMPUS_WIFI_PASS) {
        return { success: false, message: 'Campus credentials not configured in .env' };
    }
    try {
        const params = new URLSearchParams({
            mode: '191',
            username: CAMPUS_WIFI_USER,
            password: CAMPUS_WIFI_PASS,
            a: Date.now().toString(),
            producttype: '0'
        });
        const res = await fetch(`${CAMPUS_PORTAL_URL}/login.xml`, {
            method: 'POST',
            body: params.toString(),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            signal: AbortSignal.timeout(5000)
        });
        const text = await res.text();
        if (text.includes('LIVE') || text.includes('signed in')) {
            log(`[NERIST Wi-Fi] Authenticated successfully as ${CAMPUS_WIFI_USER}`);
            return { success: true, message: `Signed in as ${CAMPUS_WIFI_USER}` };
        } else {
            log(`[NERIST Wi-Fi] Login response: ${text.slice(0, 100)}`);
            return { success: false, message: 'Portal rejected credentials' };
        }
    } catch (e) {
        return { success: false, message: `Portal error: ${e.message}` };
    }
}

/**
 * Check genuine internet access; if captive portal intercepted, auto-login immediately
 */
async function checkInternetWatchdog() {
    try {
        const probe = await fetch('http://connectivitycheck.gstatic.com/generate_204', {
            signal: AbortSignal.timeout(3500)
        });
        if (probe.status === 204) {
            return { online: true, captive: false };
        }
    } catch (e) {
        // Probe timed out or failed
    }

    // Check if captive portal is reachable
    try {
        const portalCheck = await fetch(`${CAMPUS_PORTAL_URL}/httpclient.html`, {
            signal: AbortSignal.timeout(3000)
        });
        if (portalCheck.status === 200) {
            log('[NERIST Wi-Fi] Captive portal detected! Auto-logging in...');
            const result = await loginCampusPortal();
            return { online: result.success, captive: true, loginResult: result.message };
        }
    } catch (e) {
        // Gateway unreachable
    }

    return { online: false, captive: false };
}

// Format Uptime helper
function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d > 0 ? d + 'd ' : ''}${h}h ${m}m`;
}

// Initialize WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: path.join(__dirname, '.wwebjs_auth')
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

let ownerWid = null;
let lastAcStatus = null;
let pendingShutdownTime = 0;
let pendingRestartTime = 0;
let emergencyShutdownTriggered = false;
let searchCount = 0;

// Send alert to owner in "Message Yourself"
async function sendOwnerAlert(text) {
    if (!ownerWid) return;
    try {
        await client.sendMessage(ownerWid, text);
    } catch (err) {
        log('Failed to send owner alert:', err.message);
    }
}

client.on('qr', (qr) => {
    console.log('\n=============================================');
    console.log('   SCAN THIS QR CODE WITH YOUR WHATSAPP     ');
    console.log('=============================================\n');
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
    log('Authenticated successfully with WhatsApp Web.');
});

client.on('auth_failure', (msg) => {
    console.error('Authentication failure:', msg);
});

client.on('ready', async () => {
    ownerWid = client.info.wid._serialized;
    log(`Bot ready! Logged in as: ${client.info.pushname || 'Owner'} (${ownerWid})`);

    // Greet owner on startup in Message Yourself
    const power = getPowerStatus();
    const powerText = power.isAcOnline ? '⚡ Plugged In (AC Power)' : `⚠️ Battery: ${power.batteryPct}% (Electric OFF)`;
    await sendOwnerAlert(
`🟢 *NERIST Server Online*
• Bot is active and running 24/7.
• Power: ${powerText}
• Hostel Wi-Fi Watchdog: Active (Auto-login: ${CAMPUS_WIFI_USER})
• Send \`#helpadmin\` to see remote control commands.`
    );

    // Initial power status
    lastAcStatus = power.isAcOnline;

    // Start background loops
    startPowerWatchdog();
    startWifiWatchdog();
});

client.on('disconnected', (reason) => {
    log('WhatsApp client disconnected:', reason);
    log('Reconnecting in 15 seconds...');
    setTimeout(() => {
        client.initialize().catch(err => {
            log('Reconnection failed:', err.message);
            setTimeout(() => client.initialize(), 30000);
        });
    }, 15000);
});

/**
 * Background Loop: Power Cut & Battery Watchdog (runs every 30 seconds)
 */
function startPowerWatchdog() {
    setInterval(async () => {
        const power = getPowerStatus();
        if (!power.success) return;

        // 1. Detect Electricity Cut
        if (lastAcStatus === true && power.isAcOnline === false) {
            log(`[POWER ALERT] Electricity CUT! Running on battery: ${power.batteryPct}%`);
            await sendOwnerAlert(
`⚠️ *[NERIST Server Alert]*
⚡ Electricity in the hostel is *OFF*!
🔋 Laptop is running on battery: *${power.batteryPct}%*
⏱️ Server will automatically shut down if battery falls below ${SHUTDOWN_THRESHOLD}%.
_Reply \`#status\` anytime to check live levels._`
            );
        }

        // 2. Detect Electricity Restored
        if (lastAcStatus === false && power.isAcOnline === true) {
            log(`[POWER ALERT] Electricity RESTORED! Battery: ${power.batteryPct}%`);
            emergencyShutdownTriggered = false;
            await sendOwnerAlert(
`✅ *[NERIST Server Alert]*
⚡ Electricity has been *RESTORED*!
🔋 Laptop is plugged in and charging: *${power.batteryPct}%*`
            );
        }

        lastAcStatus = power.isAcOnline;

        // 3. Failsafe Critical Low Battery Auto-Shutdown
        if (!power.isAcOnline && power.batteryPct <= SHUTDOWN_THRESHOLD && !emergencyShutdownTriggered) {
            emergencyShutdownTriggered = true;
            log(`[CRITICAL] Battery at ${power.batteryPct}%. Initiating safe emergency shutdown in 60s!`);
            await sendOwnerAlert(
`🚨 *[CRITICAL BATTERY ALERT]*
Battery dropped to *${power.batteryPct}%*!
Shutting down laptop safely in 60 seconds to prevent hardware damage.
_To cancel this shutdown, reply \`#cancelshutdown\` immediately!_`
            );
            exec('shutdown /s /t 60 /c "NERIST Bot: Emergency battery protection shutdown"');
        }
    }, 30000);
}

/**
 * Background Loop: Campus Wi-Fi Auto-Login Watchdog (runs every 20 seconds)
 */
function startWifiWatchdog() {
    // Run immediately on boot
    checkInternetWatchdog();
    setInterval(() => {
        checkInternetWatchdog();
    }, 20000);
}

/**
 * Message Handler: Supports both Student @find queries and Owner #admin commands
 */
client.on('message_create', async (message) => {
    try {
        const body = (message.body || '').trim();
        if (!body) return;

        // Check if message is from the Owner in "Message Yourself"
        const isFromOwner = (message.fromMe === true && (message.to === ownerWid || message.from === ownerWid));

        // =========================================================================
        // 🔒 ADMIN COMMANDS (ONLY ACCESSIBLE TO OWNER IN MESSAGE YOURSELF)
        // =========================================================================
        if (isFromOwner && body.startsWith('#')) {
            const cmd = body.toLowerCase();

            // 1. #status / #server
            if (cmd === '#status' || cmd === '#server') {
                const power = getPowerStatus();
                const mem = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
                const powerIcon = power.isAcOnline ? '⚡' : '⚠️';
                const powerState = power.isAcOnline ? 'Plugged In (AC Electricity ON)' : 'Discharging (Electricity is OFF!)';

                const statusMsg =
`🖥️ *NERIST Server Diagnostics*
• ${powerIcon} *Power:* ${powerState}
• 🔋 *Battery:* ${power.batteryPct}% ${power.isAcOnline ? '(Charging)' : '(On Battery)'}
• 📶 *Campus Wi-Fi User:* ${CAMPUS_WIFI_USER}
• 🧠 *RAM Usage:* ${mem} MB
• ⏱️ *Bot Uptime:* ${formatUptime(process.uptime())}
• 📊 *Searches Today:* ${searchCount} queries handled

_Commands: \`#shutdown\`, \`#restart\`, \`#wifilogin\`, \`#restartbot\`_`;
                await message.reply(statusMsg);
                return;
            }

            // 2. #shutdown
            if (cmd === '#shutdown') {
                pendingShutdownTime = Date.now();
                await message.reply(
`⚠️ *Remote Shutdown Requested*
This will completely turn off the laptop server.
To confirm, reply with:
\`#shutdown confirm\` (valid for 60 seconds)`
                );
                return;
            }

            // 3. #shutdown confirm
            if (cmd === '#shutdown confirm') {
                if (Date.now() - pendingShutdownTime <= 60000) {
                    await message.reply('🛑 Shutting down the laptop in 10 seconds. Goodbye!');
                    log('Remote shutdown initiated by owner.');
                    exec('shutdown /s /t 10 /c "Remote shutdown requested via WhatsApp"');
                } else {
                    await message.reply('⏳ Confirmation expired. Please type `#shutdown` again.');
                }
                pendingShutdownTime = 0;
                return;
            }

            // 4. #cancelshutdown
            if (cmd === '#cancelshutdown') {
                exec('shutdown /a');
                emergencyShutdownTriggered = false;
                pendingShutdownTime = 0;
                await message.reply('✅ Scheduled shutdown cancelled. Server remains online.');
                log('Scheduled shutdown cancelled by owner.');
                return;
            }

            // 5. #restart
            if (cmd === '#restart') {
                pendingRestartTime = Date.now();
                await message.reply(
`🔄 *Remote Restart Requested*
This will reboot the laptop server.
To confirm, reply with:
\`#restart confirm\` (valid for 60 seconds)`
                );
                return;
            }

            // 6. #restart confirm
            if (cmd === '#restart confirm') {
                if (Date.now() - pendingRestartTime <= 60000) {
                    await message.reply('🔄 Restarting the laptop in 10 seconds...');
                    log('Remote restart initiated by owner.');
                    exec('shutdown /r /t 10 /c "Remote restart requested via WhatsApp"');
                } else {
                    await message.reply('⏳ Confirmation expired. Please type `#restart` again.');
                }
                pendingRestartTime = 0;
                return;
            }

            // 7. #wifilogin
            if (cmd === '#wifilogin') {
                await message.reply('🔄 Attempting login to NERIST captive portal (10.10.200.1)...');
                const result = await loginCampusPortal();
                await message.reply(result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
                return;
            }

            // 8. #restartbot
            if (cmd === '#restartbot') {
                await message.reply('♻️ Restarting WhatsApp bot process...');
                log('Restarting bot process on owner request...');
                setTimeout(() => process.exit(0), 1000);
                return;
            }

            // 9. #helpadmin
            if (cmd === '#helpadmin') {
                await message.reply(
`🛠️ *NERIST Server Admin Commands*
• \`#status\` : Live server power, battery, RAM, uptime.
• \`#shutdown\` : Remotely shut down the laptop.
• \`#cancelshutdown\` : Abort scheduled shutdown.
• \`#restart\` : Reboot the laptop.
• \`#wifilogin\` : Force re-login to NERIST captive portal.
• \`#restartbot\` : Restart bot process.`
                );
                return;
            }
        }

        // =========================================================================
        // 👥 PUBLIC COMMANDS: FACULTY SEARCH FOR STUDENTS (@find & @help)
        // =========================================================================
        const lowerBody = body.toLowerCase();

        // 1. @help
        if (lowerBody === '@help' || lowerBody === '!help') {
            const helpText =
`📚 *NERIST Faculty Search Bot*

*How to use:*
• *@find <name or shortcut>* : Search for faculty mobile number & contact.
  _Examples:_
  • \`@find Rajesh Kumar\` (Full name)
  • \`@find akr\` (Initials shortcut -> Ashok Kumar Ray)
  • \`@find kry\` (Initials shortcut -> Kaushik Ray)
• *@help* : Show this help menu.

🌐 *Online Faculty Explorer:*
https://nerist-faculty-search.pages.dev/`;
            await message.reply(helpText);
            return;
        }

        // 2. Check for @find or !find prefix
        let prefix = '';
        if (lowerBody.startsWith('@find')) {
            prefix = '@find';
        } else if (lowerBody.startsWith('!find')) {
            prefix = '!find';
        } else {
            return;
        }

        // Extract query
        const query = body.slice(prefix.length).trim();
        if (!query) {
            await message.reply('Please specify a faculty name or shortcut.\n*Example:* `@find Rajesh Kumar` or `@find akr`');
            return;
        }

        searchCount++;
        const encodedQuery = encodeURIComponent(query);
        const searchUrl = `https://nerist-faculty-search.pages.dev/?q=${encodedQuery}`;

        const matches = searchFaculty(query);

        if (matches.length > 0) {
            const topMatches = matches.slice(0, 3);
            let replyText = `Found "${query}" - official contact here:\n${searchUrl}\n\n`;

            topMatches.forEach((f, index) => {
                const displayName = f.name || f.portalName;
                const mobile = f.portalPhone || f.officialPhone || 'Not listed (check web portal)';

                replyText += `👤 *${displayName}*\n📱 *Mobile:* ${mobile}\n`;

                if (index < topMatches.length - 1) {
                    replyText += `──────────────────\n`;
                }
            });

            if (matches.length > 3) {
                replyText += `\n_...and ${matches.length - 3} more results on the website._`;
            }

            await message.reply(replyText);
        } else {
            const replyText = `Found "${query}" - official contact here:\n${searchUrl}\n\n📱 *Mobile:* No match found in offline database. Please check the website!`;
            await message.reply(replyText);
        }
    } catch (err) {
        console.error('Error processing message:', err);
    }
});

// Guard against process crashes
process.on('uncaughtException', (err) => {
    log('Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
    log('Unhandled Rejection:', reason);
});

// Initialize client
log('Starting NERIST Faculty WhatsApp Bot & Server Controller...');
client.initialize();
