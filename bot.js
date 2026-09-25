/**
 * =============================================================================
 * NERIST Faculty WhatsApp Bot & 24/7 Hostel Server Controller
 * =============================================================================
 * Powered by Baileys Multi-Device Engine with Native Flow Interactive Box Replies
 * Features:
 * - Interactive Button/Box Reply System (like IndiGo / WhatsApp Business)
 * - Smart faculty search with acronyms (@find akr, @find Rajesh Kumar)
 * - NERIST Hostel Wi-Fi Captive Portal Auto-Login (10.10.200.1:8090)
 * - Electricity cut / restore detection & proactive WhatsApp alerts
 * - Remote admin control in "Message Yourself" chat with Yes/No confirmation buttons
 * - Failsafe auto-shutdown on critical battery (<12%)
 * =============================================================================
 */

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    jidNormalizedUser,
    proto,
    generateWAMessageFromContent,
    normalizeMessageContent,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const QRCodeImage = require('qrcode');
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
 * Clean honorifics and titles (Dr, Mr, Ms, Prof, Sir, Maam, etc.)
 */
function cleanHonorifics(str) {
    if (!str) return '';
    return str
        .replace(/\b(dr|mr|ms|prof|mrs|er|sir|maam|mam|madam|miss)\b\.?/gi, ' ')
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Extracts all acronym combinations (e.g. "Joyatri Bora Hazarika" -> ['jbh', 'jb', 'jh'])
 */
function getAllAcronyms(nameStr) {
    const cleaned = cleanHonorifics(nameStr);
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];

    const initials = words.map(w => w[0].toLowerCase());
    const full = initials.join('');
    const list = new Set();
    list.add(full);

    if (words.length >= 3) {
        list.add(initials[0] + initials[1]); // e.g. Joyatri Bora -> jb
        list.add(initials[0] + initials[words.length - 1]); // e.g. Joyatri Hazarika -> jh
    }
    return Array.from(list);
}

/**
 * Faculty Smart Search with Acronym & Nickname support (e.g. jb, jb maam, akr, akr sir)
 */
function searchFaculty(rawQuery) {
    const cleaned = cleanHonorifics(rawQuery).toLowerCase();
    const q = cleaned || rawQuery.trim().toLowerCase();
    if (!q) return [];

    // 1. Acronym match (when query is short: <= 4 letters, no spaces)
    if (q.length <= 4 && !q.includes(' ')) {
        const acronymMatches = facultyList.filter(f => {
            const acrs = [
                ...getAllAcronyms(f.name),
                ...getAllAcronyms(f.portalName)
            ];
            return acrs.includes(q) || acrs.some(a => a.startsWith(q));
        });
        if (acronymMatches.length > 0) return acronymMatches;
    }

    // 2. Email username match
    const emailMatch = facultyList.filter(f => 
        (f.emails || []).some(em => em.toLowerCase().split('@')[0] === q)
    );
    if (emailMatch.length > 0) return emailMatch;

    // 3. Name or portal name match
    const nameMatches = facultyList.filter(f => {
        const n = cleanHonorifics(f.name || '').toLowerCase();
        const pn = cleanHonorifics(f.portalName || '').toLowerCase();
        return n.includes(q) || pn.includes(q) || (f.name || '').toLowerCase().includes(q) || (f.portalName || '').toLowerCase().includes(q);
    });
    if (nameMatches.length > 0) return nameMatches;

    // 4. Department match
    return facultyList.filter(f => {
        const dept = (f.department || '').toLowerCase();
        return dept.includes(q);
    });
}

/**
 * Hardware Power & Battery Sensing (Windows WMI + Linux sysfs)
 */
function getPowerStatus() {
    try {
        if (process.platform === 'win32') {
            const cmd = 'powershell -NoProfile -Command "(Get-CimInstance Win32_Battery).EstimatedChargeRemaining; (Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus).PowerOnline"';
            const lines = execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            const batteryPct = parseInt(lines[0], 10) || 100;
            const isAcOnline = lines[1] ? lines[1].toLowerCase() === 'true' : true;
            return { batteryPct, isAcOnline, success: true };
        } else {
            // Linux /sys/class/power_supply
            let batteryPct = 100;
            let isAcOnline = true;
            try {
                if (fs.existsSync('/sys/class/power_supply/BAT0/capacity')) {
                    batteryPct = parseInt(fs.readFileSync('/sys/class/power_supply/BAT0/capacity', 'utf8').trim(), 10) || 100;
                } else if (fs.existsSync('/sys/class/power_supply/BAT1/capacity')) {
                    batteryPct = parseInt(fs.readFileSync('/sys/class/power_supply/BAT1/capacity', 'utf8').trim(), 10) || 100;
                }
                const acFiles = [
                    '/sys/class/power_supply/AC/online',
                    '/sys/class/power_supply/ACAD/online',
                    '/sys/class/power_supply/ADP1/online'
                ];
                for (const acFile of acFiles) {
                    if (fs.existsSync(acFile)) {
                        isAcOnline = fs.readFileSync(acFile, 'utf8').trim() === '1';
                        break;
                    }
                }
            } catch (e) {}
            return { batteryPct, isAcOnline, success: true };
        }
    } catch (e) {
        return { batteryPct: 100, isAcOnline: true, success: false, error: e.message };
    }
}

/**
 * Cross-platform shutdown, restart, and cancellation
 */
function executeShutdown(delaySeconds = 10, reason = 'Remote shutdown requested via WhatsApp') {
    if (process.platform === 'win32') {
        exec(`shutdown /s /t ${delaySeconds} /c "${reason}"`);
    } else {
        exec(`sudo shutdown -h +${Math.max(1, Math.round(delaySeconds / 60))}`);
    }
}

function executeRestart(delaySeconds = 10, reason = 'Remote restart requested via WhatsApp') {
    if (process.platform === 'win32') {
        exec(`shutdown /r /t ${delaySeconds} /c "${reason}"`);
    } else {
        exec(`sudo shutdown -r +${Math.max(1, Math.round(delaySeconds / 60))}`);
    }
}

function executeCancelShutdown() {
    if (process.platform === 'win32') {
        exec('shutdown /a');
    } else {
        exec('sudo shutdown -c');
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
    } catch (e) {}

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
    } catch (e) {}

    return { online: false, captive: false };
}

function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d > 0 ? d + 'd ' : ''}${h}h ${m}m`;
}

// Cache of message IDs sent by the bot to prevent self-looping
const botSentIds = new Set();

async function sendMsg(sock, jid, text) {
    if (!text || !jid) return;
    try {
        const sent = await sock.sendMessage(jid, { text: String(text).trim() });
        if (sent?.key?.id) {
            botSentIds.add(sent.key.id);
            if (botSentIds.size > 500) {
                const first = botSentIds.values().next().value;
                botSentIds.delete(first);
            }
        }
        return sent;
    } catch (err) {
        log(`Error sending WhatsApp message to ${jid}:`, err.message);
    }
}

/**
 * Smart Reply Router:
 * If chatting in "Message Yourself", sends to BOTH senderJid (@lid) and primary myJid (@s.whatsapp.net)
 * ensuring messages reliably appear in your WhatsApp conversation on phone & web.
 */
async function sendSmartReply(sock, senderJid, isMessageToSelf, text) {
    if (!text) return;
    const myJid = jidNormalizedUser(sock.user?.id);
    if (isMessageToSelf) {
        const targets = new Set([senderJid, myJid].filter(Boolean));
        for (const target of targets) {
            await sendMsg(sock, target, text);
        }
    } else {
        await sendMsg(sock, senderJid, text);
    }
}

/**
 * Formats Clean, Actionable Admin Menus with one-tap copyable WhatsApp command blocks
 */
async function sendInteractiveButtons({ sock, jid, title, body, footer = '', buttons = [], isMessageToSelf = false }) {
    let messageText = '';
    if (title) messageText += `*${title}*\n\n`;
    messageText += `${body}\n`;

    if (buttons && buttons.length > 0) {
        messageText += `\n📋 *Actions (Tap to copy):*\n`;
        for (const btn of buttons) {
            if (btn.url) {
                messageText += `🔗 *${btn.text}:*\n${btn.url}\n\n`;
            } else {
                const shortcut = btn.id ? btn.id.replace('btn_admin_', '#').replace('btn_', '@') : btn.text;
                messageText += `• \`${shortcut}\` : ${btn.text}\n`;
            }
        }
    }
    if (footer) {
        messageText += `\n_${footer}_`;
    }

    return await sendSmartReply(sock, jid, isMessageToSelf, messageText.trim());
}

// Global runtime state
let lastAcStatus = null;
let pendingShutdownTime = 0;
let pendingRestartTime = 0;
let emergencyShutdownTriggered = false;
let searchCount = 0;
let botStartTime = Date.now();

async function startBot() {
    log('Initializing Baileys Multi-Device Client...');
    const authDir = path.join(__dirname, 'session_auth');
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.windows('Chrome'),
        syncFullHistory: false,
        generateHighQualityLinkPreview: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n=============================================');
            console.log('   SCAN THIS QR CODE WITH YOUR WHATSAPP     ');
            console.log('=============================================\n');
            qrcode.generate(qr, { small: true });
            console.log('Open WhatsApp > Linked Devices > Link a Device > Scan QR above.\n');

            try {
                const qrImgPath = path.join(__dirname, 'qr.png');
                await QRCodeImage.toFile(qrImgPath, qr, {
                    width: 450,
                    margin: 2,
                    color: {
                        dark: '#000000',
                        light: '#ffffff'
                    }
                });
                const artifactDir = 'C:\\Users\\Richard Konsam\\.gemini\\antigravity-ide\\brain\\467f6d19-6dde-4f85-b59a-59f905273efa';
                if (fs.existsSync(artifactDir)) {
                    fs.copyFileSync(qrImgPath, path.join(artifactDir, 'qr.png'));
                }
            } catch (qrErr) {
                // non-fatal image generation error
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            log(`Connection closed (status: ${statusCode}). Reconnecting: ${shouldReconnect}`);
            if (shouldReconnect) {
                setTimeout(startBot, 3000);
            } else {
                log('Device logged out. Delete session_auth folder and re-run to scan QR again.');
            }
        } else if (connection === 'open') {
            const myJid = jidNormalizedUser(sock.user?.id);
            log(`Bot ready! Connected to WhatsApp as: ${sock.user?.name || 'Owner'} (${myJid})`);

            // Greet Owner in "Message Yourself"
            const power = getPowerStatus();
            const powerText = power.isAcOnline ? '⚡ Plugged In (AC Electricity ON)' : `⚠️ Battery: ${power.batteryPct}% (Electric OFF)`;

            await sendInteractiveButtons({
                sock,
                jid: myJid,
                isMessageToSelf: true,
                title: '🟢 NERIST Laptop Server Online',
                body: `Server is active and running 24/7.\n\n• Power: ${powerText}\n• Campus Wi-Fi User: ${CAMPUS_WIFI_USER}\n• Memory: ${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)} MB`,
                footer: 'NERIST Server Controller',
                buttons: [
                    { id: 'btn_admin_status', text: '📊 Check Server Status' },
                    { id: 'btn_admin_wifi_login', text: '📶 Re-login Campus Wi-Fi' },
                    { id: 'btn_admin_shutdown_req', text: '🛑 Shutdown Laptop' }
                ]
            });

            // Start hardware power & wifi watchdogs
            lastAcStatus = power.isAcOnline;
            startWatchdogs(sock, myJid);
        }
    });

    // Message events
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (!messages || messages.length === 0) return;

        for (const msg of messages) {
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;

            // Ignore messages sent by our bot process to avoid loops
            if (msg.key.id && botSentIds.has(msg.key.id)) continue;

            const senderJid = msg.key.remoteJid;
            const normalizedJid = jidNormalizedUser(senderJid);
            const myJid = jidNormalizedUser(sock.user?.id);
            const myLid = sock.user?.lid ? jidNormalizedUser(sock.user.lid) : null;
            const myPhone = (myJid || '').split('@')[0];
            const isFromMe = msg.key.fromMe === true;
            const isGroup = senderJid.endsWith('@g.us');

            // True if this is the "Message Yourself" chat
            const isMessageToSelf = !isGroup && (
                normalizedJid === myJid ||
                senderJid === myJid ||
                (myPhone && senderJid.includes(myPhone)) ||
                (myLid && (normalizedJid === myLid || senderJid === myLid))
            );

            // CRITICAL FIX: When messaging yourself, WhatsApp sends remoteJid as @lid (e.g. 60769525878871@lid).
            // Replying to @lid fails silently. We must always send to myJid (e.g. 919863013886@s.whatsapp.net).
            const replyJid = isMessageToSelf ? myJid : senderJid;

            // Unwrap content
            const content = normalizeMessageContent(msg.message);

            // 0. Detect Button Interaction (Native Flow Quick Reply / Button)
            let buttonId = null;
            const interactive =
                content?.interactiveResponseMessage ||
                msg.message?.interactiveResponseMessage ||
                content?.viewOnceMessage?.message?.interactiveResponseMessage ||
                msg.message?.viewOnceMessage?.message?.interactiveResponseMessage;

            if (interactive?.nativeFlowResponseMessage?.paramsJson) {
                try {
                    const params = JSON.parse(interactive.nativeFlowResponseMessage.paramsJson);
                    buttonId = params.id;
                    log(`Native flow button tapped: id="${buttonId}" by ${senderJid}`);
                } catch (e) {}
            }

            if (!buttonId && (content?.templateButtonReplyMessage || msg.message?.templateButtonReplyMessage)) {
                const t = content?.templateButtonReplyMessage || msg.message?.templateButtonReplyMessage;
                buttonId = t.selectedId;
            }

            if (!buttonId && (content?.buttonsResponseMessage || msg.message?.buttonsResponseMessage)) {
                const b = content?.buttonsResponseMessage || msg.message?.buttonsResponseMessage;
                buttonId = b.selectedButtonId;
            }

            // Extract message text or buttonId
            const rawBody = (
                buttonId ||
                content?.conversation ||
                content?.extendedTextMessage?.text ||
                ''
            ).trim();

            if (!rawBody) continue;

            // If it's outgoing from ourselves to another person/group (not Message Yourself), ignore
            if (isFromMe && !isMessageToSelf) continue;

            log(`[MSG] fromMe=${isFromMe} toSelf=${isMessageToSelf} jid=${senderJid} text="${rawBody}"`);

            const lowerBody = rawBody.toLowerCase();

            // =====================================================================
            // 🔒 ADMIN COMMANDS & BUTTONS (ONLY IN "MESSAGE YOURSELF")
            // =====================================================================
            const isAdminCommand = isMessageToSelf && (
                lowerBody.startsWith('#') ||
                lowerBody.startsWith('btn_admin_') ||
                ['status', 'server', 'shutdown', 'restart', 'wifilogin', 'helpadmin', 'settings', 'setting', 'menu', 'admin'].includes(lowerBody) ||
                lowerBody.startsWith('#shutdown') ||
                lowerBody.startsWith('shutdown') ||
                lowerBody.startsWith('#restart') ||
                lowerBody.startsWith('restart') ||
                lowerBody.includes('shutdown') ||
                lowerBody.includes('reboot') ||
                lowerBody.includes('cancel') ||
                lowerBody.includes('status') ||
                lowerBody.includes('wifi')
            );

            if (isAdminCommand) {
                // 1. Status Check
                if (
                    lowerBody === '#status' || lowerBody === 'status' || lowerBody === '#server' || lowerBody === 'server' ||
                    lowerBody === 'btn_admin_status' || lowerBody.includes('status')
                ) {
                    const power = getPowerStatus();
                    const mem = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
                    const powerIcon = power.isAcOnline ? '⚡' : '⚠️';
                    const powerState = power.isAcOnline ? 'Plugged In (AC Power ON)' : 'Discharging (Electricity is OFF!)';
                    const uptime = formatUptime((Date.now() - botStartTime) / 1000);

                    await sendInteractiveButtons({
                        sock,
                        jid: senderJid,
                        isMessageToSelf,
                        title: '🖥️ NERIST Server Diagnostics',
                        body:
`• ${powerIcon} *Power:* ${powerState}
• 🔋 *Battery:* ${power.batteryPct}% ${power.isAcOnline ? '(Charging)' : '(On Battery)'}
• 📶 *Campus Wi-Fi User:* ${CAMPUS_WIFI_USER}
• 🧠 *Node RAM:* ${mem} MB
• ⏱️ *Server Uptime:* ${uptime}
• 📊 *Searches Today:* ${searchCount} queries handled`,
                        footer: 'NERIST Server Controller',
                        buttons: [
                            { id: 'btn_admin_status', text: '📊 Refresh Status' },
                            { id: 'btn_admin_wifi_login', text: '📶 Re-login Wi-Fi' },
                            { id: 'btn_admin_shutdown_req', text: '🛑 Shutdown Laptop' }
                        ]
                    });
                    return;
                }

                // 2. Request Shutdown (Interactive Quick Actions)
                if (
                    lowerBody === '#shutdown' || lowerBody === 'shutdown' || lowerBody === 'btn_admin_shutdown_req' ||
                    lowerBody.includes('shutdown laptop')
                ) {
                    pendingShutdownTime = Date.now();
                    await sendInteractiveButtons({
                        sock,
                        jid: senderJid,
                        isMessageToSelf,
                        title: '⚠️ Confirm Server Shutdown?',
                        body: 'This will completely turn off the laptop server.\n\nAre you sure you want to proceed? (Expires in 60s)',
                        footer: 'Emergency Protection',
                        buttons: [
                            { id: '#shutdown confirm', text: '🛑 Yes, Shut Down' },
                            { id: '#cancelshutdown', text: '❌ No, Cancel' }
                        ]
                    });
                    return;
                }

                // 3. Confirm Shutdown
                if (
                    lowerBody === '#shutdown confirm' || lowerBody === 'shutdown confirm' || lowerBody === 'btn_admin_shutdown_confirm' ||
                    lowerBody.includes('yes, shut down') || lowerBody === 'yes'
                ) {
                    if (Date.now() - pendingShutdownTime <= 60000) {
                        await sendSmartReply(sock, senderJid, isMessageToSelf, '🛑 Shutting down the laptop in 10 seconds. Goodbye!');
                        log('Remote shutdown initiated by owner.');
                        executeShutdown(10, 'Remote shutdown requested via WhatsApp');
                    } else {
                        await sendSmartReply(sock, senderJid, isMessageToSelf, '⏳ Confirmation expired. Send `#shutdown` again.');
                    }
                    pendingShutdownTime = 0;
                    return;
                }

                // 4. Cancel Shutdown / Cancel Action
                if (
                    lowerBody === '#cancelshutdown' || lowerBody === 'cancel' || lowerBody === 'no' || lowerBody === 'btn_admin_shutdown_cancel' ||
                    lowerBody.includes('no, cancel') || lowerBody.includes('cancel')
                ) {
                    executeCancelShutdown();
                    emergencyShutdownTriggered = false;
                    pendingShutdownTime = 0;
                    pendingRestartTime = 0;
                    await sendSmartReply(sock, senderJid, isMessageToSelf, '✅ Action cancelled. Server remains online.');
                    log('Scheduled action cancelled by owner.');
                    return;
                }

                // 5. Request Restart (Interactive Quick Actions)
                if (
                    lowerBody === '#restart' || lowerBody === 'restart' || lowerBody === 'btn_admin_restart_req' ||
                    lowerBody.includes('reboot laptop')
                ) {
                    pendingRestartTime = Date.now();
                    await sendInteractiveButtons({
                        sock,
                        jid: senderJid,
                        isMessageToSelf,
                        title: '🔄 Confirm Server Restart?',
                        body: 'This will reboot the laptop operating system.\n\nAre you sure you want to proceed? (Expires in 60s)',
                        footer: 'System Control',
                        buttons: [
                            { id: '#restart confirm', text: '🔄 Yes, Reboot' },
                            { id: '#cancelshutdown', text: '❌ No, Cancel' }
                        ]
                    });
                    return;
                }

                // 6. Confirm Restart
                if (
                    lowerBody === '#restart confirm' || lowerBody === 'restart confirm' || lowerBody === 'btn_admin_restart_confirm' ||
                    lowerBody.includes('yes, reboot')
                ) {
                    if (Date.now() - pendingRestartTime <= 60000) {
                        await sendSmartReply(sock, senderJid, isMessageToSelf, '🔄 Restarting the laptop in 10 seconds...');
                        log('Remote restart initiated by owner.');
                        executeRestart(10, 'Remote restart requested via WhatsApp');
                    } else {
                        await sendSmartReply(sock, senderJid, isMessageToSelf, '⏳ Confirmation expired. Send `#restart` again.');
                    }
                    pendingRestartTime = 0;
                    return;
                }

                // 7. Re-login Campus Wi-Fi
                if (
                    lowerBody === '#wifilogin' || lowerBody === 'wifilogin' || lowerBody === 'wifi' || lowerBody === 'btn_admin_wifi_login' ||
                    lowerBody.includes('re-login wi-fi') || lowerBody.includes('re-login campus wi-fi')
                ) {
                    await sendSmartReply(sock, senderJid, isMessageToSelf, '🔄 Attempting authentication with NERIST captive portal (10.10.200.1:8090)...');
                    const result = await loginCampusPortal();
                    await sendSmartReply(sock, senderJid, isMessageToSelf, result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
                    return;
                }

                // 8. Restart Bot Process
                if (lowerBody === '#restartbot' || lowerBody === 'restartbot' || lowerBody === 'btn_admin_restart_bot') {
                    await sendSmartReply(sock, senderJid, isMessageToSelf, '♻️ Restarting WhatsApp bot process...');
                    log('Restarting bot process on owner request...');
                    setTimeout(() => process.exit(0), 1000);
                    return;
                }

                // 9. Admin Settings & Control Menu
                if (
                    lowerBody === '#settings' || lowerBody === 'settings' || lowerBody === '#setting' || lowerBody === 'setting' ||
                    lowerBody === '#menu' || lowerBody === 'menu' || lowerBody === '#admin' || lowerBody === 'admin' ||
                    lowerBody === '#helpadmin' || lowerBody === 'helpadmin' || lowerBody === '#help'
                ) {
                    await sendInteractiveButtons({
                        sock,
                        jid: senderJid,
                        isMessageToSelf,
                        title: '⚙️ NERIST Server Control Panel',
                        body:
`*Hostel 24/7 Server Administration*
Choose an option below:`,
                        footer: 'NERIST Remote Admin',
                        buttons: [
                            { id: '#status', text: '📊 Check Server Status' },
                            { id: '#wifilogin', text: '📶 Re-login Wi-Fi' },
                            { id: '#shutdown', text: '🛑 Shutdown Laptop' },
                            { id: '#restart', text: '🔄 Reboot Laptop' }
                        ]
                    });
                    return;
                }
            }

            // =====================================================================
            // 👥 PUBLIC FACULTY SEARCH FOR STUDENTS (@find & @help)
            // =====================================================================

            // 1. Help or Menu button
            if (lowerBody === '@help' || lowerBody === '!help' || lowerBody === 'hi' || lowerBody === 'hello' || lowerBody === 'menu' || lowerBody === 'btn_help_find') {
                await sendInteractiveButtons({
                    sock,
                    jid: senderJid,
                    isMessageToSelf,
                    title: 'NERIST Faculty Explorer 🎓',
                    body:
`Welcome to the official NERIST Faculty Directory Assistant!

*How to Search:*
Send \`@find <name or shortcut>\` in chat.
• \`@find akr\` (Shortcuts: Ashok Kumar Ray)
• \`@find jb\` (Dr. Joyatri Bora Hazarika / JB ma'am)
• \`@find Rajesh Kumar\` (Full/Partial name)
• \`@find Physics\` (By department)`,
                    footer: 'nerist-faculty-search.pages.dev',
                    buttons: [
                        { url: 'https://nerist-faculty-search.pages.dev/', text: '🌐 Open Web Explorer' },
                        { id: '@find akr', text: '🔍 Search Example' }
                    ]
                });
                return;
            }

            // Search Again button clicked
            if (lowerBody === 'btn_search_again' || lowerBody === '@search' || lowerBody === 'search') {
                await sendSmartReply(sock, senderJid, isMessageToSelf, 'Type `@find <name>` to search (e.g. `@find akr` or `@find Rajesh Kumar`).');
                return;
            }

            // 2. Check for search query (@find, !find, find, or direct match in 1-on-1 chat)
            let query = '';
            if (lowerBody.startsWith('@find')) {
                query = rawBody.slice(5).trim();
            } else if (lowerBody.startsWith('!find')) {
                query = rawBody.slice(5).trim();
            } else if (lowerBody.startsWith('find ')) {
                query = rawBody.slice(5).trim();
            } else if (!isGroup) {
                // In private chat or Message Yourself, auto-match if valid faculty query
                const quickCheck = searchFaculty(rawBody);
                if (quickCheck.length > 0) {
                    query = rawBody.trim();
                }
            }

            if ((lowerBody === '@find' || lowerBody === '!find' || lowerBody === 'find') && !query) {
                await sendSmartReply(sock, senderJid, isMessageToSelf, 'Please specify a faculty name or shortcut.\n*Example:* `@find Rajesh Kumar` or `@find akr`');
                return;
            }
            if (!query) return;

            searchCount++;
            const matches = searchFaculty(query);

            if (matches.length > 0) {
                const topMatch = matches[0];
                const displayName = topMatch.name || topMatch.portalName;
                const mobile = topMatch.portalPhone || topMatch.officialPhone || 'Not listed';
                const dept = topMatch.department || 'NERIST';

                let replyBody = `👤 *${displayName}*\n📱 *Mobile:* ${mobile}\n🏛️ *Dept:* ${dept}`;

                if (matches.length > 1) {
                    replyBody += `\n\n_Also found:_ ` + matches.slice(1, 4).map(m => {
                        const name = m.name || m.portalName;
                        return `${name} (\`@find ${name}\`)`;
                    }).join(', ');
                }

                await sendSmartReply(sock, senderJid, isMessageToSelf, replyBody.trim());
                log(`Answered @find "${query}" with ${matches.length} matches.`);
            } else {
                await sendSmartReply(sock, senderJid, isMessageToSelf, 'No database found');
                log(`Answered @find "${query}" with: No database found`);
            }
        }
    });
}

/**
 * Background Power & Campus Wi-Fi Watchdogs
 */
function startWatchdogs(sock, myJid) {
    // 1. Campus Wi-Fi Auto-Login Loop (runs every 20s)
    checkInternetWatchdog();
    setInterval(() => {
        checkInternetWatchdog();
    }, 20000);

    // 2. Hardware Power & Battery Sensing Loop (runs every 30s)
    setInterval(async () => {
        const power = getPowerStatus();
        if (!power.success) return;

        // Detect Electricity Cut
        if (lastAcStatus === true && power.isAcOnline === false) {
            log(`[POWER ALERT] Electricity CUT! Running on battery: ${power.batteryPct}%`);
            await sendInteractiveButtons({
                sock,
                jid: myJid,
                isMessageToSelf: true,
                title: '⚠️ [NERIST Server Alert]',
                body: `⚡ Electricity in the hostel is *OFF*!\n🔋 Laptop is running on battery: *${power.batteryPct}%*\n\n⏱️ Server will auto-shutdown if battery drops below ${SHUTDOWN_THRESHOLD}%.`,
                footer: 'Power Alert',
                buttons: [
                    { id: '#status', text: '📊 Check Status' },
                    { id: '#shutdown', text: '🛑 Shutdown Laptop' }
                ]
            });
        }

        // Detect Electricity Restored
        if (lastAcStatus === false && power.isAcOnline === true) {
            log(`[POWER ALERT] Electricity RESTORED! Battery: ${power.batteryPct}%`);
            emergencyShutdownTriggered = false;
            await sendSmartReply(sock, myJid, true, `✅ *[NERIST Server Alert]*\n⚡ Electricity has been *RESTORED*!\n🔋 Laptop is plugged in and charging: *${power.batteryPct}%*`);
        }

        lastAcStatus = power.isAcOnline;

        // Failsafe Critical Low Battery Auto-Shutdown
        if (!power.isAcOnline && power.batteryPct <= SHUTDOWN_THRESHOLD && !emergencyShutdownTriggered) {
            emergencyShutdownTriggered = true;
            log(`[CRITICAL] Battery at ${power.batteryPct}%. Initiating safe emergency shutdown in 60s!`);
            await sendSmartReply(sock, myJid, true, `🚨 *[CRITICAL BATTERY ALERT]*\nBattery reached *${power.batteryPct}%*!\nShutting down laptop safely in 60 seconds to protect hardware.\n\n_To cancel, reply \`#cancelshutdown\`!_`);
            executeShutdown(60, 'NERIST Bot: Emergency battery protection shutdown');
        }
    }, 30000);
}

// Global exception guards
process.on('uncaughtException', (err) => {
    log('Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
    log('Unhandled Rejection:', reason);
});

// Launch
startBot();
