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
const { initStudentIndex, getStudentByPhone, getStudentByRoll } = require('./student_index');
const path = require('path');
const { execSync, exec } = require('child_process');
const { fetchDossier } = require('./dossier');

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

// 2. Load faculty & student databases
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

let studentsList = [];
try {
    const studentsPath = path.join(__dirname, 'students.json');
    if (fs.existsSync(studentsPath)) {
        studentsList = JSON.parse(fs.readFileSync(studentsPath, 'utf8'));
        log(`Loaded ${studentsList.length} student records from students.json.`);
        initStudentIndex(studentsList);
    }
} catch (err) {
    console.warn('Warning: Failed to load students.json:', err.message);
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
 * Student Search by Name, Roll Number, or Department
 */
function searchStudents(rawQuery) {
    if (!rawQuery || !rawQuery.trim()) return [];
    const q = rawQuery.trim().toLowerCase();
    const cleanQ = cleanHonorifics(rawQuery).toLowerCase();

    // 1. Direct Roll / Reg No Match
    const byRoll = getStudentByRoll ? getStudentByRoll(rawQuery.trim()) : null;
    if (byRoll) return [byRoll];

    // 2. Match by roll number / user_id (e.g. 121/108, 121_108, 121108, D22AE002, D/22/AE/002)
    const rollQuery = q.replace(/[^a-zA-Z0-9]/g, '');
    const rollMatches = studentsList.filter(s => {
        const roll = (s.user_id || '').toLowerCase().replace(/[^a-zA-Z0-9]/g, '');
        const classRoll = (s.roll_no || '').toLowerCase().replace(/[^a-zA-Z0-9]/g, '');
        return roll === rollQuery || classRoll === rollQuery || (rollQuery.length >= 4 && (roll.includes(rollQuery) || classRoll.includes(rollQuery)));
    });
    if (rollMatches.length > 0) return rollMatches;

    // 2. Exact word / substring match on full_name
    const nameMatches = studentsList.filter(s => {
        const name = (s.full_name || '').toLowerCase();
        const cleanName = cleanHonorifics(s.full_name || '').toLowerCase();
        return name.includes(q) || cleanName.includes(cleanQ);
    });
    if (nameMatches.length > 0) return nameMatches;

    // 3. Multi-word match (e.g. "Mutum Meirasana")
    const words = cleanQ.split(' ').filter(Boolean);
    if (words.length > 1) {
        const multiMatches = studentsList.filter(s => {
            const cleanName = cleanHonorifics(s.full_name || '').toLowerCase();
            return words.every(w => cleanName.includes(w));
        });
        if (multiMatches.length > 0) return multiMatches;
    }

    // 4. Department / Degree match
    return studentsList.filter(s => {
        const dept = (s.department_name || s.degree_name || '').toLowerCase();
        return dept.includes(q);
    });
}

/**
 * Hardware Power & Battery Sensing (Windows WMI + Linux sysfs)
 */
async function getPowerStatus() {
    return new Promise((resolve) => {
        try {
            if (process.platform === 'win32') {
                const cmd = 'powershell -NoProfile -Command "(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue).EstimatedChargeRemaining; (Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus -ErrorAction SilentlyContinue).PowerOnline"';
                exec(cmd, { encoding: 'utf8', timeout: 6000 }, (error, stdout) => {
                    if (error || !stdout) {
                        return resolve({ batteryPct: 100, isAcOnline: true, success: true });
                    }
                    const lines = stdout.trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
                    const batteryPct = parseInt(lines[0], 10) || 100;
                    const isAcOnline = lines[1] ? lines[1].toLowerCase() === 'true' : true;
                    resolve({ batteryPct, isAcOnline, success: true });
                });
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
                resolve({ batteryPct, isAcOnline, success: true });
            }
        } catch (e) {
            resolve({ batteryPct: 100, isAcOnline: true, success: false, error: e.message });
        }
    });
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

function cleanJid(jid) {
    if (!jid) return '';
    try {
        const norm = jidNormalizedUser(jid);
        return norm.replace(/:.*@/, '@');
    } catch (e) {
        return (jid || '').replace(/:.*@/, '@');
    }
}

/**
 * Smart Reply Router:
 * Always sends to the owner's WhatsApp JID (e.g. 919863013886@s.whatsapp.net) for Message Yourself chats
 * Supports optional direct image sending (photo + caption)
 */
async function sendSmartReply(sock, senderJid, isMessageToSelf, text, imageUrl = null) {
    if (!text && !imageUrl) return;
    const myJid = cleanJid(sock.user?.id);
    const target = senderJid || myJid;
    if (!target) return;

    if (imageUrl) {
        try {
            const sent = await sock.sendMessage(target, {
                image: { url: imageUrl },
                caption: String(text || '').trim()
            });
            if (sent?.key?.id) {
                botSentIds.add(sent.key.id);
                if (botSentIds.size > 500) {
                    const first = botSentIds.values().next().value;
                    botSentIds.delete(first);
                }
            }
            return sent;
        } catch (err) {
            log(`Image send failed for ${imageUrl}: ${err.message}. Sending as text fallback.`);
        }
    }

    return await sendMsg(sock, target, text);
}

const lidMappingCache = new Map();

function resolveToPnJid(jid) {
    if (!jid) return jid;
    if (!jid.endsWith('@lid')) return jid;
    const lidNum = jid.split('@')[0];
    if (lidMappingCache.has(lidNum)) {
        return lidMappingCache.get(lidNum);
    }
    try {
        const authDir = path.join(__dirname, 'session_auth');
        const revPath = path.join(authDir, `lid-mapping-${lidNum}_reverse.json`);
        if (fs.existsSync(revPath)) {
            const pn = JSON.parse(fs.readFileSync(revPath, 'utf8'));
            if (pn) {
                const target = `${pn}@s.whatsapp.net`;
                lidMappingCache.set(lidNum, target);
                return target;
            }
        }
    } catch (e) {}
    return jid;
}

/**
 * Formats Clean, Native WhatsApp Interactive Quick Reply Pill Buttons
 * (Same native pill buttons as student disambiguation in WhatsApp Business)
 */
async function sendInteractiveButtons({ sock, jid, title = '', body = '', footer = 'NERIST Server Controller', buttons = [], isMessageToSelf = false, imageUrl = null }) {
    if (!jid || !body) return;
    const myJid = cleanJid(sock.user?.id);
    const myPn = myJid ? myJid.split('@')[0].split(':')[0] : null;
    const targetJid = jid || resolveToPnJid(jid);

    if (!buttons || buttons.length === 0) {
        return await sendSmartReply(sock, targetJid, isMessageToSelf, `${title ? '*' + title + '*\n\n' : ''}${body}`, imageUrl);
    }

    const nativeButtons = buttons.map((btn) => {
        if (btn.url) {
            return {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                    display_text: btn.text,
                    url: btn.url,
                    merchant_url: btn.url,
                }),
            };
        }
        return {
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({
                display_text: btn.text,
                id: btn.id,
            }),
        };
    });

    try {
        const waMsg = generateWAMessageFromContent(
            targetJid,
            {
                viewOnceMessage: {
                    message: {
                        messageContextInfo: {
                            deviceListMetadata: {},
                            deviceListMetadataVersion: 2,
                        },
                        interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                            header: proto.Message.InteractiveMessage.Header.fromObject({
                                title: title || '',
                                hasMediaAttachment: false,
                            }),
                            body: proto.Message.InteractiveMessage.Body.fromObject({
                                text: body,
                            }),
                            footer: proto.Message.InteractiveMessage.Footer.fromObject({
                                text: footer || 'NERIST Server Controller',
                            }),
                            nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                                buttons: nativeButtons,
                            }),
                        }),
                    },
                },
            },
            { userJid: sock.user?.id }
        );

        const additionalNodes = [
            {
                tag: 'biz',
                attrs: {},
                content: [
                    {
                        tag: 'interactive',
                        attrs: {
                            type: 'native_flow',
                            v: '1',
                        },
                        content: [
                            {
                                tag: 'native_flow',
                                attrs: {
                                    name: 'mixed',
                                    v: '9',
                                },
                            },
                        ],
                    },
                ],
            },
        ];

        await sock.relayMessage(targetJid, waMsg.message, {
            messageId: waMsg.key.id,
            additionalNodes,
        });

        if (waMsg?.key?.id) {
            botSentIds.add(waMsg.key.id);
        }
        log(`Delivered native interactive buttons to ${targetJid}`);
        return waMsg;
    } catch (btnErr) {
        log(`sendInteractiveButtons error: ${btnErr.message}, sending fallback text`);
        const fallback = `${title ? '*' + title + '*\n\n' : ''}${body}\n\n` +
            buttons.map(b => b.url ? `🔗 ${b.text}: ${b.url}` : `👉 \`${b.id}\``).join('\n') +
            (footer ? `\n\n_${footer}_` : '');
        return await sendSmartReply(sock, targetJid, isMessageToSelf, fallback.trim(), imageUrl);
    }
}

// Global runtime state
let lastAcStatus = null;
let pendingShutdownTime = 0;
let pendingRestartTime = 0;
let emergencyShutdownTriggered = false;
let searchCount = 0;
let botStartTime = Date.now();
let greetedOnStartup = false;
let watchdogsStarted = false;

async function waitForInternetOnBoot() {
    log('Performing pre-flight network & captive portal check...');
    let tries = 0;
    while (true) {
        tries++;
        try {
            const net = await checkInternetWatchdog();
            if (net.online) {
                log('Internet is ACTIVE! Ready to connect.');
                return true;
            }
            if (tries % 5 === 0) {
                log(`[Network Pre-Flight] Waiting for Wi-Fi / Portal login (Attempt ${tries})...`);
            }
        } catch (e) {
            // non-fatal probe error
        }
        await new Promise(r => setTimeout(r, 3000));
    }
}

async function startBot() {
    try {
        await waitForInternetOnBoot();
        log('Initializing Baileys Multi-Device Client...');
        const authDir = path.join(__dirname, 'session_auth');
        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        
        let version = [2, 3000, 1015901307];
        try {
            const vData = await fetchLatestBaileysVersion();
            if (vData && vData.version) version = vData.version;
        } catch (vErr) {
            log(`Could not fetch latest Baileys version online (${vErr.message}), using stable fallback version.`);
        }

        const sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            browser: Browsers.windows('Chrome'),
            syncFullHistory: false,
            generateHighQualityLinkPreview: false,
            keepAliveIntervalMs: 20000,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000
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
            } catch (qrErr) {
                // non-fatal image generation error
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            log(`Connection closed (status: ${statusCode}). Reconnecting: ${shouldReconnect}`);
            if (shouldReconnect) {
                // If another session connected (440 - Connection Replaced), wait 10s to avoid spam fight
                const delay = statusCode === 440 ? 10000 : 3000;
                setTimeout(startBot, delay);
            } else {
                log('Device logged out. Delete session_auth folder and re-run to scan QR again.');
            }
        } else if (connection === 'open') {
            const myJid = cleanJid(sock.user?.id || state?.creds?.me?.id);
            log(`Bot ready! Connected to WhatsApp as: ${sock.user?.name || 'Owner'} (${myJid})`);

            // Greet Owner ONLY ONCE on initial launch (not on every socket keepalive/reconnect)
            if (!greetedOnStartup) {
                greetedOnStartup = true;
                const power = await getPowerStatus();
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
            }

            // Start hardware power & wifi watchdogs once
            if (!watchdogsStarted) {
                watchdogsStarted = true;
                const power = await getPowerStatus();
                lastAcStatus = power.isAcOnline;
                startWatchdogs(sock, myJid);
            }
        }
    });

    // Message events
    // =====================================================================
    // 🔒 STRICT HARD RULE FOR PERSONAL NUMBER (+91 9863013886):
    // ONLY RESPOND WHEN @find IS INCLUDED! IGNORE EVERYTHING ELSE!
    // Whatever message is there, whatever files, ignore all unless @find is included.
    // =====================================================================
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (!messages || messages.length === 0) return;

        for (const msg of messages) {
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;
            if (msg.key.fromMe) continue; // Ignore messages from ourselves
            if (msg.key.id && botSentIds.has(msg.key.id)) continue;

            const senderJid = msg.key.remoteJid;
            const content = normalizeMessageContent(msg.message);

            // Extract plain text from message or caption
            const text = (
                content?.conversation ||
                content?.extendedTextMessage?.text ||
                content?.imageMessage?.caption ||
                content?.documentMessage?.caption ||
                content?.videoMessage?.caption ||
                ''
            ).trim();

            // HARD RULE: ONLY when @find is included! Ignore ALL others!
            if (!text || !text.toLowerCase().includes('@find')) {
                continue;
            }

            log(`[@find Triggered] jid=${senderJid} text="${text}"`);

            const findMatch = text.match(/@find\s*(.*)/i);
            const query = (findMatch ? findMatch[1] : '').trim();

            if (!query) {
                await sendSmartReply(sock, senderJid, false, 'Please specify a faculty name or shortcut.\n*Example:* `@find Rajesh Kumar` or `@find akr`');
                continue;
            }

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

                await sendSmartReply(sock, senderJid, false, replyBody.trim());
                log(`Answered @find "${query}" with ${matches.length} matches.`);
            } else {
                await sendSmartReply(sock, senderJid, false, 'No database found');
                log(`Answered @find "${query}" with: No database found`);
            }
        }
    });
    } catch (startErr) {
        log(`Error during startBot startup: ${startErr.message}. Retrying in 5 seconds...`);
        setTimeout(startBot, 5000);
    }
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
        const power = await getPowerStatus();
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
