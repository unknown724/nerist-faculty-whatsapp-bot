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
    normalizeMessageContent
} = require('@whiskeysockets/baileys');
const pino = require('pino');
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

/**
 * Send Native Flow Interactive Buttons (Boxes like IndiGo bot)
 */
async function sendInteractiveButtons({ sock, jid, title, body, footer = 'NERIST Faculty Explorer', buttons = [] }) {
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
            jid,
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
                                text: footer,
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
            {
                tag: 'bot',
                attrs: { biz_bot: '1' },
            },
        ];

        await sock.relayMessage(jid, waMsg.message, {
            messageId: waMsg.key.id,
            additionalNodes,
        });
        return waMsg;
    } catch (btnErr) {
        log('Interactive button relay notice, using fallback:', btnErr.message);
        let fallbackText = `${title ? `*${title}*\n\n` : ''}${body}\n\n`;
        if (buttons.length > 0) {
            fallbackText += buttons.map((b) => `• ${b.text}: ${b.url || b.id}`).join('\n');
        }
        return await sock.sendMessage(jid, { text: fallbackText });
    }
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
        browser: ['NERIST Server Bot', 'Chrome', '124.0.0'],
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
        if (type !== 'notify' || !messages || messages.length === 0) return;

        for (const msg of messages) {
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;

            const senderJid = msg.key.remoteJid;
            const normalizedJid = jidNormalizedUser(senderJid);
            const myJid = jidNormalizedUser(sock.user?.id);
            const isFromMe = msg.key.fromMe === true;
            const isGroup = senderJid.endsWith('@g.us');

            // True if this is the "Message Yourself" chat
            const isMessageToSelf = (isFromMe && (normalizedJid === myJid || senderJid === myJid));

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

            // If it's outgoing from ourselves to another person/group, ignore
            if (isFromMe && !isMessageToSelf) continue;

            const lowerBody = rawBody.toLowerCase();

            // =====================================================================
            // 🔒 ADMIN COMMANDS & BUTTONS (ONLY IN "MESSAGE YOURSELF")
            // =====================================================================
            if (isMessageToSelf && (lowerBody.startsWith('#') || lowerBody.startsWith('btn_admin_'))) {
                // 1. Status
                if (lowerBody === '#status' || lowerBody === '#server' || lowerBody === 'btn_admin_status') {
                    const power = getPowerStatus();
                    const mem = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
                    const powerIcon = power.isAcOnline ? '⚡' : '⚠️';
                    const powerState = power.isAcOnline ? 'Plugged In (AC Power ON)' : 'Discharging (Electricity is OFF!)';
                    const uptime = formatUptime((Date.now() - botStartTime) / 1000);

                    await sendInteractiveButtons({
                        sock,
                        jid: senderJid,
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
                            { id: 'btn_admin_status', text: '🔄 Refresh Status' },
                            { id: 'btn_admin_wifi_login', text: '📶 Re-login Wi-Fi' },
                            { id: 'btn_admin_shutdown_req', text: '🛑 Shutdown Laptop' }
                        ]
                    });
                    return;
                }

                // 2. Request Shutdown (Shows Yes / No confirmation boxes like IndiGo)
                if (lowerBody === '#shutdown' || lowerBody === 'btn_admin_shutdown_req') {
                    pendingShutdownTime = Date.now();
                    await sendInteractiveButtons({
                        sock,
                        jid: senderJid,
                        title: '⚠️ Confirm Server Shutdown?',
                        body: 'This will completely turn off the laptop server.\n\nAre you sure you want to proceed? (Expires in 60s)',
                        footer: 'Emergency Protection',
                        buttons: [
                            { id: 'btn_admin_shutdown_confirm', text: '🛑 Yes, Shut Down' },
                            { id: 'btn_admin_shutdown_cancel', text: '❌ Cancel' }
                        ]
                    });
                    return;
                }

                // 3. Confirm Shutdown
                if (lowerBody === '#shutdown confirm' || lowerBody === 'btn_admin_shutdown_confirm') {
                    if (Date.now() - pendingShutdownTime <= 60000) {
                        await sock.sendMessage(senderJid, { text: '🛑 Shutting down the laptop in 10 seconds. Goodbye!' });
                        log('Remote shutdown initiated by owner.');
                        exec('shutdown /s /t 10 /c "Remote shutdown requested via WhatsApp"');
                    } else {
                        await sock.sendMessage(senderJid, { text: '⏳ Confirmation expired. Tap "Shutdown Laptop" again.' });
                    }
                    pendingShutdownTime = 0;
                    return;
                }

                // 4. Cancel Shutdown
                if (lowerBody === '#cancelshutdown' || lowerBody === 'btn_admin_shutdown_cancel') {
                    exec('shutdown /a');
                    emergencyShutdownTriggered = false;
                    pendingShutdownTime = 0;
                    await sock.sendMessage(senderJid, { text: '✅ Scheduled shutdown cancelled. Server remains online.' });
                    log('Scheduled shutdown cancelled by owner.');
                    return;
                }

                // 5. Request Restart
                if (lowerBody === '#restart') {
                    pendingRestartTime = Date.now();
                    await sendInteractiveButtons({
                        sock,
                        jid: senderJid,
                        title: '🔄 Confirm Server Restart?',
                        body: 'This will reboot the laptop operating system.',
                        footer: 'System Control',
                        buttons: [
                            { id: 'btn_admin_restart_confirm', text: '🔄 Yes, Restart' },
                            { id: 'btn_admin_shutdown_cancel', text: '❌ Cancel' }
                        ]
                    });
                    return;
                }

                // 6. Confirm Restart
                if (lowerBody === '#restart confirm' || lowerBody === 'btn_admin_restart_confirm') {
                    if (Date.now() - pendingRestartTime <= 60000) {
                        await sock.sendMessage(senderJid, { text: '🔄 Restarting the laptop in 10 seconds...' });
                        log('Remote restart initiated by owner.');
                        exec('shutdown /r /t 10 /c "Remote restart requested via WhatsApp"');
                    } else {
                        await sock.sendMessage(senderJid, { text: '⏳ Confirmation expired. Type `#restart` again.' });
                    }
                    pendingRestartTime = 0;
                    return;
                }

                // 7. Re-login Campus Wi-Fi
                if (lowerBody === '#wifilogin' || lowerBody === 'btn_admin_wifi_login') {
                    await sock.sendMessage(senderJid, { text: '🔄 Attempting authentication with NERIST captive portal (10.10.200.1:8090)...' });
                    const result = await loginCampusPortal();
                    await sock.sendMessage(senderJid, { text: result.success ? `✅ ${result.message}` : `❌ ${result.message}` });
                    return;
                }

                // 8. Restart Bot
                if (lowerBody === '#restartbot' || lowerBody === 'btn_admin_restart_bot') {
                    await sock.sendMessage(senderJid, { text: '♻️ Restarting WhatsApp bot process...' });
                    log('Restarting bot process on owner request...');
                    setTimeout(() => process.exit(0), 1000);
                    return;
                }

                // 9. Help Admin
                if (lowerBody === '#helpadmin') {
                    await sock.sendMessage(senderJid, {
                        text:
`🛠️ *NERIST Server Admin Commands*
• \`#status\` : Live power, battery, RAM, uptime.
• \`#shutdown\` : Remotely shut down the laptop.
• \`#cancelshutdown\` : Abort scheduled shutdown.
• \`#restart\` : Reboot the laptop.
• \`#wifilogin\` : Re-login to NERIST captive portal.
• \`#restartbot\` : Restart bot process.`
                    });
                    return;
                }
            }

            // =====================================================================
            // 👥 PUBLIC FACULTY SEARCH FOR STUDENTS (@find & @help)
            // =====================================================================

            // 1. Help or Menu button
            if (lowerBody === '@help' || lowerBody === '!help' || lowerBody === 'hi' || lowerBody === 'menu' || lowerBody === 'btn_help_find') {
                await sendInteractiveButtons({
                    sock,
                    jid: senderJid,
                    title: 'NERIST Faculty Explorer 🎓',
                    body:
`Welcome to the official NERIST Faculty Directory Assistant!

*How to Search:*
Send \`@find <name or shortcut>\` in chat.
• \`@find akr\` (Shortcuts: Ashok Kumar Ray)
• \`@find Rajesh Kumar\` (Full/Partial name)
• \`@find Physics\` (By department)`,
                    footer: 'nerist-faculty-search.pages.dev',
                    buttons: [
                        { url: 'https://nerist-faculty-search.pages.dev/', text: '🌐 Open Web Explorer' },
                        { id: 'btn_search_again', text: '🔍 Search Faculty' }
                    ]
                });
                return;
            }

            // Search Again button clicked
            if (lowerBody === 'btn_search_again') {
                await sock.sendMessage(senderJid, { text: 'Type `@find <name>` to search (e.g. `@find akr` or `@find Rajesh Kumar`).' });
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

            const query = rawBody.slice(prefix.length).trim();
            if (!query) {
                await sock.sendMessage(senderJid, { text: 'Please specify a faculty name or shortcut.\n*Example:* `@find Rajesh Kumar` or `@find akr`' });
                return;
            }

            searchCount++;
            const encodedQuery = encodeURIComponent(query);
            const searchUrl = `https://nerist-faculty-search.pages.dev/?q=${encodedQuery}`;
            const matches = searchFaculty(query);

            if (matches.length > 0) {
                const topMatch = matches[0];
                const displayName = topMatch.name || topMatch.portalName;
                const mobile = topMatch.portalPhone || topMatch.officialPhone || 'Not listed';
                const dept = topMatch.department || 'NERIST';

                let replyBody = `👤 *${displayName}*\n📱 *Mobile:* ${mobile}\n🏛️ *Dept:* ${dept}\n\n`;

                if (matches.length > 1) {
                    replyBody += `_Also found:_ ` + matches.slice(1, 3).map(m => m.name).join(', ') + '\n';
                }

                const buttons = [
                    { url: searchUrl, text: '🔗 View Official Profile' }
                ];
                if (topMatch.portalPhone && /^\d{10}$/.test(topMatch.portalPhone.trim())) {
                    buttons.push({ url: `tel:${topMatch.portalPhone.trim()}`, text: '📞 Call Faculty' });
                }
                buttons.push({ id: 'btn_search_again', text: '🔍 Search Another' });

                await sendInteractiveButtons({
                    sock,
                    jid: senderJid,
                    title: `Found "${query}"`,
                    body: replyBody,
                    footer: 'NERIST Faculty Explorer',
                    buttons
                });

                log(`Answered @find "${query}" with ${matches.length} matches.`);
            } else {
                await sendInteractiveButtons({
                    sock,
                    jid: senderJid,
                    title: `Search: "${query}"`,
                    body: `No direct record found in offline database.\nPlease check the online portal for live results!`,
                    footer: 'nerist-faculty-search.pages.dev',
                    buttons: [
                        { url: searchUrl, text: '🌐 Search Online Portal' },
                        { id: 'btn_search_again', text: '🔍 Try Another Name' }
                    ]
                });
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
                title: '⚠️ [NERIST Server Alert]',
                body: `⚡ Electricity in the hostel is *OFF*!\n🔋 Laptop is running on battery: *${power.batteryPct}%*\n\n⏱️ Server will auto-shutdown if battery drops below ${SHUTDOWN_THRESHOLD}%.`,
                footer: 'Power Alert',
                buttons: [
                    { id: 'btn_admin_status', text: '📊 Check Status' },
                    { id: 'btn_admin_shutdown_req', text: '🛑 Shutdown Laptop' }
                ]
            });
        }

        // Detect Electricity Restored
        if (lastAcStatus === false && power.isAcOnline === true) {
            log(`[POWER ALERT] Electricity RESTORED! Battery: ${power.batteryPct}%`);
            emergencyShutdownTriggered = false;
            await sock.sendMessage(myJid, {
                text: `✅ *[NERIST Server Alert]*\n⚡ Electricity has been *RESTORED*!\n🔋 Laptop is plugged in and charging: *${power.batteryPct}%*`
            });
        }

        lastAcStatus = power.isAcOnline;

        // Failsafe Critical Low Battery Auto-Shutdown
        if (!power.isAcOnline && power.batteryPct <= SHUTDOWN_THRESHOLD && !emergencyShutdownTriggered) {
            emergencyShutdownTriggered = true;
            log(`[CRITICAL] Battery at ${power.batteryPct}%. Initiating safe emergency shutdown in 60s!`);
            await sock.sendMessage(myJid, {
                text: `🚨 *[CRITICAL BATTERY ALERT]*\nBattery reached *${power.batteryPct}%*!\nShutting down laptop safely in 60 seconds to protect hardware.\n\n_To cancel, reply \`#cancelshutdown\`!_`
            });
            exec('shutdown /s /t 60 /c "NERIST Bot: Emergency battery protection shutdown"');
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
