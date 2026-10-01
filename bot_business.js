/**
 * =============================================================================
 * NERIST Student Directory & Dossier Assistant - WhatsApp Business Edition
 * =============================================================================
 * Account: +919362980761 (WhatsApp Business)
 * Features:
 * - Native Flow Quick Reply pill buttons ([ 🔓 Unlock Dossier ])
 * - Student Directory & Decrypted Confidential Dossier
 * - Runs 24/7 alongside the print bot on another machine without conflicts
 * =============================================================================
 */

require('dotenv').config();
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
const { fetchDossier } = require('./dossier');
const { initStudentIndex, getStudentByRoll, getStudentByPhone, regToDetailsMap, phoneToRegsMap } = require('./student_index');

function log(...args) {
    const timestamp = new Date().toLocaleString();
    console.log(`[BUSINESS BOT ${timestamp}]`, ...args);
}

// =============================================================================
// QUOTA & DIRECT UPI PAYMENT CONFIGURATION
// =============================================================================
const QUOTA_FILE = path.join(__dirname, 'user_quotas.json');
const ADMIN_PHONE = (process.env.ADMIN_PHONE || '9863013886').replace(/[^0-9]/g, '').slice(-10);
const ADMIN_JID = `${process.env.ADMIN_PHONE || '9863013886'}@s.whatsapp.net`.replace(/^(\d{10})@/, '91$1@');
const UPI_VPA = process.env.UPI_VPA || 'devanandawaheng725-2@oksbi';
const UPI_PHONE = process.env.UPI_PHONE || '9863013886';
const UPI_NAME = process.env.UPI_NAME || 'Devananda Wahengbam';
const DAILY_FREE_LIMIT = 3;

function loadQuotas() {
    try {
        if (fs.existsSync(QUOTA_FILE)) {
            return JSON.parse(fs.readFileSync(QUOTA_FILE, 'utf8'));
        }
    } catch (e) {}
    return { quotas: {}, usedUtrs: {} };
}

function saveQuotas(data) {
    try {
        fs.writeFileSync(QUOTA_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        log('Error saving user quotas:', e.message);
    }
}

function checkUserAccess(phone) {
    if (!phone) return { allowed: false, reason: 'unknown_user' };
    const cleanPhone = phone.replace(/[^0-9]/g, '').slice(-10);

    // 1. Admin VIP bypass (Devananda - Permanent Unlimited)
    if (cleanPhone === ADMIN_PHONE) {
        return { allowed: true, isAdmin: true, remaining: 999 };
    }

    const data = loadQuotas();
    const today = new Date().toISOString().slice(0, 10);
    const userRec = data.quotas[cleanPhone] || { lastDate: today, dailyUsed: 0, paidCredits: 0, passExpiresAt: null };

    // 2. Monthly Unlimited Pass
    if (userRec.passExpiresAt && new Date(userRec.passExpiresAt) > new Date()) {
        const daysLeft = Math.ceil((new Date(userRec.passExpiresAt) - new Date()) / (1000 * 60 * 60 * 24));
        return { allowed: true, hasPass: true, daysLeft };
    }

    // 3. Paid Single Unlock Credits
    if ((userRec.paidCredits || 0) > 0) {
        return { allowed: true, hasPaidCredit: true, paidCredits: userRec.paidCredits };
    }

    // 4. Daily Free Quota
    if (userRec.lastDate !== today) {
        userRec.lastDate = today;
        userRec.dailyUsed = 0;
        data.quotas[cleanPhone] = userRec;
        saveQuotas(data);
    }

    if ((userRec.dailyUsed || 0) < DAILY_FREE_LIMIT) {
        const remaining = DAILY_FREE_LIMIT - (userRec.dailyUsed || 0);
        return { allowed: true, dailyUsed: userRec.dailyUsed || 0, remaining };
    }

    return { allowed: false, dailyUsed: userRec.dailyUsed, remaining: 0 };
}

function consumeUserCredit(phone) {
    if (!phone) return;
    const cleanPhone = phone.replace(/[^0-9]/g, '').slice(-10);
    if (cleanPhone === ADMIN_PHONE) return;

    const data = loadQuotas();
    const today = new Date().toISOString().slice(0, 10);
    const userRec = data.quotas[cleanPhone] || { lastDate: today, dailyUsed: 0, paidCredits: 0, passExpiresAt: null };

    if (userRec.passExpiresAt && new Date(userRec.passExpiresAt) > new Date()) {
        return; // Monthly pass: unlimited unlocks without deduction
    }

    if ((userRec.paidCredits || 0) > 0) {
        userRec.paidCredits -= 1;
    } else {
        if (userRec.lastDate !== today) {
            userRec.lastDate = today;
            userRec.dailyUsed = 0;
        }
        userRec.dailyUsed = (userRec.dailyUsed || 0) + 1;
    }

    data.quotas[cleanPhone] = userRec;
    saveQuotas(data);
}

// In-memory mapping for user interactions
const userLastStudent = new Map();
const userPendingPayment = new Map();
const studentCleanIdMap = new Map();

// Load student database
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

function cleanHonorifics(str) {
    if (!str) return '';
    return str
        .replace(/\b(dr|mr|ms|prof|mrs|er|sir|maam|mam|madam|miss)\b\.?/gi, ' ')
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function searchStudents(rawQuery) {
    if (!rawQuery || !rawQuery.trim()) return [];
    const q = rawQuery.trim().toLowerCase();
    const cleanQ = cleanHonorifics(rawQuery).toLowerCase();

    // 1. Class Roll Number match (e.g. D/23/EC/015, D23EC015)
    const rollMatch = getStudentByRoll(rawQuery);
    if (rollMatch) return [rollMatch];

    // 2. Roll number / user_id match
    const rollQuery = q.replace(/[^a-zA-Z0-9]/g, '');
    const rollMatches = studentsList.filter(s => {
        const roll = (s.user_id || '').toLowerCase().replace(/[^a-zA-Z0-9]/g, '');
        const classRoll = (s.roll_no || '').toLowerCase().replace(/[^a-zA-Z0-9]/g, '');
        return roll === rollQuery || classRoll === rollQuery || (rollQuery.length >= 4 && (roll.includes(rollQuery) || classRoll.includes(rollQuery)));
    });
    if (rollMatches.length > 0) return rollMatches;

    // 2. Name match
    const nameMatches = studentsList.filter(s => {
        const name = (s.full_name || '').toLowerCase();
        const cleanName = cleanHonorifics(s.full_name || '').toLowerCase();
        return name.includes(q) || cleanName.includes(cleanQ);
    });
    if (nameMatches.length > 0) return nameMatches;

    // 3. Multi-word match
    const words = cleanQ.split(' ').filter(Boolean);
    if (words.length > 1) {
        const multiMatches = studentsList.filter(s => {
            const cleanName = cleanHonorifics(s.full_name || '').toLowerCase();
            return words.every(w => cleanName.includes(w));
        });
        if (multiMatches.length > 0) return multiMatches;
    }

    // 4. Dept match
    return studentsList.filter(s => {
        const dept = (s.department_name || s.degree_name || '').toLowerCase();
        return dept.includes(q);
    });
}

// Helper: Aggregate all roll numbers across datasets (lateral entry, diploma + degree, PG, etc.)
function getAllRollNumbersForStudent(targetReg, targetName, phone, initialRoll) {
    const rolls = new Set();
    if (initialRoll && typeof initialRoll === 'string' && initialRoll.trim() && initialRoll.trim() !== 'N/A') {
        rolls.add(initialRoll.trim());
    }
    if (targetReg && regToDetailsMap && regToDetailsMap.has(targetReg)) {
        const details = regToDetailsMap.get(targetReg);
        if (details && details.rollNo && details.rollNo !== 'N/A') rolls.add(details.rollNo.trim());
    }
    if (targetReg && Array.isArray(studentsList)) {
        const matchReg = studentsList.find(s => s.user_id === targetReg);
        if (matchReg && matchReg.roll_no && matchReg.roll_no !== 'N/A') rolls.add(matchReg.roll_no.trim());
    }
    if (targetName && typeof targetName === 'string' && Array.isArray(studentsList)) {
        const normTarget = targetName.trim().toLowerCase();
        for (const s of studentsList) {
            if (s.full_name && s.full_name.trim().toLowerCase() === normTarget) {
                if (s.roll_no && s.roll_no !== 'N/A') rolls.add(s.roll_no.trim());
                if (regToDetailsMap && regToDetailsMap.has(s.user_id)) {
                    const details = regToDetailsMap.get(s.user_id);
                    if (details && details.rollNo && details.rollNo !== 'N/A') rolls.add(details.rollNo.trim());
                }
            }
        }
    }
    const cleanPhone = phone ? String(phone).replace(/[^0-9]/g, '').slice(-10) : '';
    if (cleanPhone && cleanPhone.length === 10 && phoneToRegsMap) {
        const matches = phoneToRegsMap.get(cleanPhone) || [];
        for (const m of matches) {
            if (regToDetailsMap && regToDetailsMap.has(m.regNo)) {
                const details = regToDetailsMap.get(m.regNo);
                if (details && details.rollNo && details.rollNo !== 'N/A') rolls.add(details.rollNo.trim());
            }
            if (Array.isArray(studentsList)) {
                const s = studentsList.find(st => st.user_id === m.regNo);
                if (s && s.roll_no && s.roll_no !== 'N/A') rolls.add(s.roll_no.trim());
            }
        }
    }
    return Array.from(rolls).filter(r => r && r !== 'N/A' && r.length > 2);
}

// Helper: Calculate/Resolve the correct current semester (fixes outdated semester slips)
function resolveCorrectSemester(topRecord, dossier, regRecord) {
    const romanMap = { 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8 };
    let candidateSem = null;
    if (topRecord && typeof topRecord.semester === 'number' && topRecord.semester > 0) {
        candidateSem = topRecord.semester;
    } else if (topRecord && topRecord.semester) {
        const num = parseInt(topRecord.semester, 10);
        if (!isNaN(num) && num > 0) candidateSem = num;
    }

    const semStr = regRecord?.semester || dossier?.semester || topRecord?.sem_string;
    let slipSem = null;
    if (semStr) {
        const match = String(semStr).match(/^(I|II|III|IV|V|VI|VII|VIII)/i);
        if (match) slipSem = romanMap[match[1].toUpperCase()];
        else {
            const mDigit = String(semStr).match(/(\d+)/);
            if (mDigit) slipSem = parseInt(mDigit[1], 10);
        }
    }

    const sessStr = regRecord?.session || dossier?.session || '';
    const sessMatch = String(sessStr).match(/(\d{4})-(\d{4})\s*(Jul|Jan)/i);
    if (slipSem && sessMatch) {
        const slipYear = parseInt(sessMatch[1], 10);
        const slipSeason = sessMatch[3].toLowerCase();
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        const currentSeason = currentMonth >= 6 ? 'jul' : 'jan';
        let diffSems = (currentYear - slipYear) * 2;
        if (slipSeason === 'jan' && currentSeason === 'jul') diffSems += 1;
        else if (slipSeason === 'jul' && currentSeason === 'jan') diffSems -= 1;
        const projectedSem = slipSem + diffSems;
        if (projectedSem > (candidateSem || 0)) {
            candidateSem = projectedSem;
        }
    }

    const prog = ((topRecord && topRecord.program_name) || '').toLowerCase();
    let maxSem = 8;
    if (prog.includes('m.tech') || prog.includes('m.sc') || prog.includes('mba') || prog.includes('master')) maxSem = 4;
    else if (prog.includes('diploma')) maxSem = 6;
    else if (prog.includes('phd')) maxSem = 10;

    if (candidateSem && candidateSem > maxSem) {
        candidateSem = maxSem;
    }

    return candidateSem || (slipSem ? Math.min(slipSem, maxSem) : (topRecord?.semester || 'N/A'));
}

const botSentIds = new Set();
const SHOW_DOSSIER_PHOTO = process.env.SHOW_DOSSIER_PHOTO !== 'false';

/**
 * Robustly fetches and validates the student's authentic photo buffer from SymphonyX CDN.
 * Handles both registration numbers (e.g. 121/108) and roll numbers (e.g. D/23/EC/015),
 * filters out 5-byte "false" responses, and validates JPEG magic bytes.
 */
async function fetchStudentPhotoBuffer(targetRoll) {
    if (!targetRoll || !SHOW_DOSSIER_PHOTO) return null;
    const cleanRoll = targetRoll.trim();

    const candidates = [
        cleanRoll.replace(/\//g, '_'),
        cleanRoll.replace(/[^a-zA-Z0-9]/g, '_')
    ];

    if (regToDetailsMap) {
        for (const [reg, details] of regToDetailsMap.entries()) {
            if (details.rollNo && details.rollNo.toLowerCase() === cleanRoll.toLowerCase()) {
                candidates.unshift(reg.replace(/\//g, '_'));
                break;
            }
        }
    }

    for (const token of candidates) {
        const url = `https://saascdn.symphonyx.in/fetch/9/1/3/STUDENT_IMAGES/${token}.jpg`;
        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                },
                signal: AbortSignal.timeout(4000)
            });
            if (res.ok) {
                const cType = res.headers.get('content-type') || '';
                if (cType.includes('image')) {
                    const buf = Buffer.from(await res.arrayBuffer());
                    if (buf.length > 500 && buf[0] === 0xff && buf[1] === 0xd8) {
                        return buf;
                    }
                }
            }
        } catch (e) {}
    }
    return null;
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

async function sendMsg(sock, jid, text) {
    if (!text || !jid) return;
    try {
        const sent = await sock.sendMessage(jid, { text: String(text).trim() });
        if (sent?.key?.id) {
            botSentIds.add(sent.key.id);
        }
        return sent;
    } catch (err) {
        log(`Error sending message to ${jid}:`, err.message);
    }
}

function resolveToPnJid(jid) {
    if (!jid) return jid;
    if (!jid.endsWith('@lid')) return jid;
    const lidNum = jid.split('@')[0];
    try {
        const authDir = path.join(__dirname, 'session_auth_business');
        const revPath = path.join(authDir, `lid-mapping-${lidNum}_reverse.json`);
        if (fs.existsSync(revPath)) {
            const pn = JSON.parse(fs.readFileSync(revPath, 'utf8'));
            if (pn) return `${pn}@s.whatsapp.net`;
        }
    } catch (e) {}
    return jid;
}

async function sendNativeButtons({ sock, jid, title = '', body = '', footer = 'NERIST Directory', buttons = [] }) {
    if (!jid || !body) return;
    const targetJid = resolveToPnJid(jid);

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
                                text: footer || 'NERIST Directory',
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
        log(`Delivered native interactive quick reply buttons to ${targetJid}`);
        return waMsg;
    } catch (btnErr) {
        log(`sendNativeButtons error: ${btnErr.message}, falling back to text`);
        const fallbackText = `${title ? '*' + title + '*\n\n' : ''}${body}\n\n` +
            buttons.map(b => b.url ? `🔗 ${b.text}: ${b.url}` : `👉 \`${b.id}\``).join('\n');
        return sendMsg(sock, targetJid, fallbackText.trim());
    }
}

// Populate student clean ID index for button callbacks
for (const s of studentsList) {
    if (s.user_id) {
        const cleanKey = s.user_id.replace(/[^a-zA-Z0-9]/g, '_');
        studentCleanIdMap.set(cleanKey, s.user_id);
    }
}

async function startBusinessBot() {
    log('Initializing WhatsApp Business Client...');
    const authDir = path.join(__dirname, 'session_auth_business');
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.windows('Desktop'),
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
            console.log('\n======================================================');
            console.log('   SCAN WITH WHATSAPP BUSINESS NUMBER: +919362980761  ');
            console.log('======================================================\n');
            qrcode.generate(qr, { small: true });

            try {
                const qrImgPath = path.join(__dirname, 'qr_business.png');
                await QRCodeImage.toFile(qrImgPath, qr, {
                    width: 450,
                    margin: 2,
                    color: { dark: '#000000', light: '#ffffff' }
                });
                log(`QR saved as image to: ${qrImgPath}`);
            } catch (e) {}
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            log(`Connection closed (status: ${statusCode}). Reconnecting: ${shouldReconnect}`);
            if (shouldReconnect) {
                setTimeout(startBusinessBot, statusCode === 440 ? 10000 : 3000);
            }
        } else if (connection === 'open') {
            const myJid = cleanJid(sock.user?.id || state?.creds?.me?.id);
            log(`🟢 Business Bot Online! Connected as: ${sock.user?.name || 'Business'} (${myJid})`);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        if (!messages || messages.length === 0) return;

        for (const msg of messages) {
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;
            if (msg.key.id && botSentIds.has(msg.key.id)) continue;

            const senderJid = msg.key.remoteJid;
            const isGroup = senderJid.endsWith('@g.us');

            // Silently ignore all group messages
            if (isGroup) continue;

            const content = normalizeMessageContent(msg.message);

            // Detect Quick Reply Button Taps
            let buttonId = null;
            let buttonText = null;

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
                } catch (e) {
                    log(`Failed to parse nativeFlowResponseMessage paramsJson: ${e.message}`);
                }
            }

            if (!buttonId && (content?.templateButtonReplyMessage || msg.message?.templateButtonReplyMessage)) {
                const t = content?.templateButtonReplyMessage || msg.message?.templateButtonReplyMessage;
                buttonId = t.selectedId;
                buttonText = t.selectedDisplayText;
            }

            if (!buttonId && (content?.buttonsResponseMessage || msg.message?.buttonsResponseMessage)) {
                const b = content?.buttonsResponseMessage || msg.message?.buttonsResponseMessage;
                buttonId = b.selectedButtonId;
                buttonText = b.selectedDisplayText;
            }

            if (!buttonId && (content?.listResponseMessage || msg.message?.listResponseMessage)) {
                const l = content?.listResponseMessage || msg.message?.listResponseMessage;
                buttonId = l.singleSelectReply?.selectedRowId;
            }

            // Check for media attachments (PDF, documents, images)
            const documentMsg =
                content?.documentMessage ||
                content?.documentWithCaptionMessage?.message?.documentMessage ||
                msg.message?.documentMessage ||
                msg.message?.documentWithCaptionMessage?.message?.documentMessage;
            const imageMsg =
                content?.imageMessage ||
                content?.viewOnceMessage?.message?.imageMessage ||
                msg.message?.imageMessage;
            const isMediaAttachment = !!(documentMsg || imageMsg);

            const rawBody = (
                buttonId ||
                buttonText ||
                content?.conversation ||
                content?.extendedTextMessage?.text ||
                documentMsg?.caption ||
                imageMsg?.caption ||
                ''
            ).trim();

            if (!rawBody && !isMediaAttachment) continue;
            const lowerBody = rawBody.toLowerCase();
            const targetPnJid = resolveToPnJid(senderJid);
            const userPhone = targetPnJid.split('@')[0].replace(/[^0-9]/g, '').slice(-10);
            log(`[BUSINESS MSG] fromMe=${msg.key.fromMe} jid=${senderJid} phone=${userPhone} text="${rawBody}" (media=${isMediaAttachment}, buttonId=${buttonId})`);

            // If a document or photo is sent without a student command, acknowledge preparation immediately
            if (isMediaAttachment && !msg.key.fromMe && !lowerBody.startsWith('@student') && !lowerBody.startsWith('@phone')) {
                const rawMime = (documentMsg?.mimetype || imageMsg?.mimetype || '').toLowerCase();
                const rawDocName = documentMsg?.fileName || '';
                const lowerDocName = rawDocName.toLowerCase();
                const isPdfFile = lowerDocName.endsWith('.pdf') || rawMime.includes('pdf');
                const isPhotoFile = !isPdfFile && (!!imageMsg || rawMime.startsWith('image/') || /\.(jpe?g|png|webp|heic|bmp|tiff)$/i.test(lowerDocName));

                let prepNotice = '⏳ *Your document is preparing...*\nPlease wait a moment.';
                if (isPdfFile) {
                    prepNotice = rawDocName
                        ? `⏳ *Your PDF is preparing...*\n📄 _${rawDocName}_\nPlease wait a moment.`
                        : `⏳ *Your PDF is preparing...*\nPlease wait a moment.`;
                } else if (isPhotoFile) {
                    prepNotice = `⏳ *Your photo is preparing...*\nPlease wait a moment.`;
                }

                await sendMsg(sock, senderJid, prepNotice);
                continue;
            }

            // -----------------------------------------------------------------
            // 📱 ADMIN PHONE NUMBER LOOKUP (@phone <num>)
            // -----------------------------------------------------------------
            if (lowerBody.startsWith('@phone') || lowerBody.startsWith('!phone') || lowerBody.startsWith('#phone')) {
                if (userPhone !== ADMIN_PHONE) {
                    await sendMsg(sock, senderJid, '⛔ *Access Denied:* Phone lookup is restricted to administrators only.');
                    continue;
                }
                const phoneQuery = rawBody.replace(/^[@!#]phone/i, '').trim();
                if (!phoneQuery) {
                    await sendMsg(sock, senderJid, '📱 *Usage:* `@phone <10-digit number>`\nExample: `@phone 7628811494`');
                    continue;
                }
                const matches = getStudentByPhone(phoneQuery);
                if (!matches || matches.length === 0) {
                    await sendMsg(sock, senderJid, `❌ No student record found matching phone: \`${phoneQuery}\``);
                    continue;
                }
                let reply = `🔍 *Phone Lookup Result (${matches.length} found):*\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                for (const m of matches) {
                    reply += `👤 *${m.full_name}*\n` +
                             `📋 *Reg No:* \`${m.user_id}\`\n` +
                             (m.rollNo ? `🆔 *Roll No:* \`${m.rollNo}\`\n` : '') +
                             `🏛️ *Dept:* ${m.department_name || m.degree_name || 'NERIST'}\n` +
                             `📚 *Program:* ${m.program_name || 'Degree'} (Sem ${m.semester || 'N/A'})\n` +
                             (m.fatherName ? `👨 *Father:* ${m.fatherName}\n` : '') +
                             (m.motherName ? `👩 *Mother:* ${m.motherName}\n` : '') +
                             `📱 *Matched:* ${m.matchedPhone} (${m.matchType})\n` +
                             `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                }
                await sendMsg(sock, senderJid, reply.trim());
                continue;
            }

            // -----------------------------------------------------------------
            // 👑 ADMIN DIRECT MANAGEMENT HOOKS (Devananda only)
            // -----------------------------------------------------------------
            if (userPhone === ADMIN_PHONE) {
                if (lowerBody.startsWith('#grant ')) {
                    const parts = rawBody.slice(7).trim().split(/\s+/);
                    const targetNum = parts[0]?.replace(/[^0-9]/g, '').slice(-10);
                    const amount = parseInt(parts[1], 10) || 1;
                    if (targetNum) {
                        const data = loadQuotas();
                        const today = new Date().toISOString().slice(0, 10);
                        const userRec = data.quotas[targetNum] || { lastDate: today, dailyUsed: 0, paidCredits: 0, passExpiresAt: null };
                        userRec.paidCredits = (userRec.paidCredits || 0) + amount;
                        data.quotas[targetNum] = userRec;
                        saveQuotas(data);
                        await sendMsg(sock, senderJid, `✅ Granted ${amount} paid unlock credits to +91${targetNum}. Total: ${userRec.paidCredits}`);
                        continue;
                    }
                } else if (lowerBody.startsWith('#pass ')) {
                    const targetNum = rawBody.slice(6).trim().replace(/[^0-9]/g, '').slice(-10);
                    if (targetNum) {
                        const data = loadQuotas();
                        const today = new Date().toISOString().slice(0, 10);
                        const userRec = data.quotas[targetNum] || { lastDate: today, dailyUsed: 0, paidCredits: 0, passExpiresAt: null };
                        const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
                        userRec.passExpiresAt = expiry;
                        data.quotas[targetNum] = userRec;
                        saveQuotas(data);
                        await sendMsg(sock, senderJid, `🌟 Activated 30-Day Monthly Pass for +91${targetNum}. Valid until: ${expiry.slice(0, 10)}`);
                        continue;
                    }
                }
            }

            // -----------------------------------------------------------------
            // 💳 DIRECT UPI PAYMENT DISPATCH (₹3 Single or ₹119 Monthly)
            // -----------------------------------------------------------------
            if (buttonId && (buttonId.startsWith('pay_single_') || buttonId === 'pay_monthly')) {
                const isMonthly = buttonId === 'pay_monthly';
                const amount = isMonthly ? 119 : 3;
                const cleanToken = isMonthly ? '' : buttonId.replace('pay_single_', '');
                const targetRoll = cleanToken ? (studentCleanIdMap.get(cleanToken) || cleanToken.replace(/_/g, '/')) : '';
                const note = isMonthly ? 'NERIST_Monthly_Pass' : `Dossier_${cleanToken}`;
                const planTitle = isMonthly ? 'Monthly Unlimited Pass (30 Days)' : '1 Extra Dossier Unlock';

                // Save pending unlock intent for this user
                userPendingPayment.set(userPhone, {
                    type: isMonthly ? 'monthly' : 'single',
                    targetRoll,
                    amount,
                    timestamp: Date.now()
                });

                const upiUrl = `upi://pay?pa=${encodeURIComponent(UPI_VPA)}&pn=${encodeURIComponent(UPI_NAME)}&am=${amount}&cu=INR&tn=${encodeURIComponent(note)}`;

                let qrBuffer = null;
                try {
                    qrBuffer = await QRCodeImage.toBuffer(upiUrl, {
                        width: 420,
                        margin: 2,
                        color: { dark: '#000000', light: '#ffffff' }
                    });
                } catch (e) {
                    log('Error generating payment QR:', e.message);
                }

                const payMsg =
                    `🏛️ *NERIST SERVER RESOURCE CONTRIBUTION*\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `📌 *Plan:* ${planTitle}\n` +
                    `💰 *Allocation Fee:* *₹${amount}.00*\n` +
                    `📱 *UPI ID:* \`${UPI_VPA}\` _(Tap to copy)_\n` +
                    `📞 *UPI Phone:* \`${UPI_PHONE}\` _(GPay / PhonePe / Paytm)_\n` +
                    `👤 *Beneficiary:* ${UPI_NAME}\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `⚡ *Instant Automated Unlock Instructions:*\n` +
                    `1. Scan this QR or transfer ₹${amount} via your UPI app.\n` +
                    `2. Open your payment receipt in GPay / PhonePe / Paytm.\n` +
                    `3. Locate the **12-digit UPI Reference / UTR Number**.\n` +
                    `4. Reply here with that 12-digit number (e.g. \`429184910283\`).\n\n` +
                    `The system validates the reference and decrypts the record immediately!`;

                if (qrBuffer) {
                    await sock.sendMessage(senderJid, {
                        image: qrBuffer,
                        caption: payMsg
                    });
                } else {
                    await sendMsg(sock, senderJid, payMsg);
                }
                log(`Sent UPI payment instructions (₹${amount}) to ${userPhone}`);
                continue;
            }

            // -----------------------------------------------------------------
            // ❓ UTR & VERIFICATION ASSISTANCE GUIDE
            // -----------------------------------------------------------------
            if (buttonId === 'info_utr' || lowerBody === 'utr' || lowerBody === 'how to pay') {
                const guideText =
                    `📋 *HOW TO VERIFY PAYMENT INSTANTLY*\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `After transferring ₹3 or ₹119 in your payment app:\n\n` +
                    `1. Open the payment receipt inside your UPI app.\n` +
                    `2. Locate the **12-digit UPI Reference Number / UTR**:\n` +
                    `   • *Google Pay:* Tap the payment ➔ Look for \`UPI transaction ID\`\n` +
                    `   • *PhonePe:* Tap the payment ➔ Look for \`UTR\`\n` +
                    `   • *Paytm:* Tap the transaction ➔ Look for \`UPI Ref No.\`\n` +
                    `   • *BHIM / Banking Apps:* Look for \`UTR / RRN / 12-Digit Ref\`\n\n` +
                    `3. Copy or type that 12-digit number directly into this chat (e.g. \`429184910283\`).\n\n` +
                    `⚡ *Automated Decryption:* The server validates the transaction reference and instantly unlocks your requested dossier!`;

                await sendMsg(sock, senderJid, guideText);
                continue;
            }

            // -----------------------------------------------------------------
            // 👑 ADMIN 1-TAP CLAIM APPROVAL / REJECTION HOOKS
            // -----------------------------------------------------------------
            if (userPhone === ADMIN_PHONE && buttonId && (buttonId.startsWith('claim_approve_') || buttonId.startsWith('claim_reject_'))) {
                const isApprove = buttonId.startsWith('claim_approve_');
                const claimId = isApprove ? buttonId.replace('claim_approve_', '') : buttonId.replace('claim_reject_', '');
                const data = loadQuotas();
                if (!data.pendingClaims) data.pendingClaims = {};

                const claim = data.pendingClaims[claimId];
                if (!claim) {
                    await sendMsg(sock, senderJid, `⚠️ *Claim Not Found*: This approval request has already been processed or expired.`);
                    continue;
                }

                if (isApprove) {
                    const studentPhone = claim.userPhone;
                    const today = new Date().toISOString().slice(0, 10);
                    const userRec = data.quotas[studentPhone] || { lastDate: today, dailyUsed: 0, paidCredits: 0, passExpiresAt: null };

                    if (!data.usedUtrs) data.usedUtrs = {};
                    data.usedUtrs[claim.utr] = { phone: studentPhone, amount: claim.amount, type: claim.type, timestamp: Date.now() };

                    if (claim.type === 'monthly' || claim.amount >= 119) {
                        const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
                        userRec.passExpiresAt = expiry;
                        data.quotas[studentPhone] = userRec;
                        delete data.pendingClaims[claimId];
                        saveQuotas(data);

                        await sendMsg(sock, claim.senderJid,
                            `🎉 *MONTHLY PASS APPROVED!*\n` +
                            `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                            `✅ Admin confirmed UTR: \`${claim.utr}\`\n` +
                            `🌟 You now have **Unlimited Dossier Unlocks** for 30 days!\n` +
                            `📅 Valid until: ${expiry.slice(0, 10)}`
                        );
                    } else {
                        userRec.paidCredits = (userRec.paidCredits || 0) + 1;
                        data.quotas[studentPhone] = userRec;
                        delete data.pendingClaims[claimId];
                        saveQuotas(data);

                        await sendMsg(sock, claim.senderJid,
                            `✅ *PAYMENT APPROVED!*\n` +
                            `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                            `Admin confirmed UTR: \`${claim.utr}\` (₹${claim.amount})\n` +
                            `🔓 1 Dossier Unlock Token added to your account!`
                        );

                        // If user was waiting for a specific dossier, auto-deliver it to them now!
                        if (claim.targetRoll) {
                            try {
                                const targetRoll = claim.targetRoll;
                                const matches = searchStudents(targetRoll);
                                const top = matches.length > 0 ? matches[0] : null;
                                const targetName = top ? top.full_name : 'Student';
                                const destJid = (claim.senderJid && !claim.senderJid.endsWith('@lid'))
                                    ? claim.senderJid
                                    : (claim.userPhone ? `${claim.userPhone}@s.whatsapp.net` : resolveToPnJid(claim.senderJid));

                                await sendMsg(sock, destJid, `🔐 *Decrypting and delivering confidential record for ${targetName}...*`);
                                const dossier = await fetchDossier(targetRoll);
                                const regRec = regToDetailsMap.get(targetRoll);

                                let effDossier = dossier;
                                if (!effDossier && regRec) {
                                    effDossier = {
                                        rollNo: regRec.rollNo,
                                        phone: regRec.mobile,
                                        parentsMobile: regRec.parentMobile,
                                        fatherName: regRec.fatherName,
                                        motherName: regRec.motherName,
                                        dob: regRec.dob,
                                        email: regRec.email,
                                        aadhaar: regRec.aadhaar,
                                        semester: regRec.semester,
                                        session: regRec.session
                                    };
                                }

                                if (effDossier || top) {
                                    effDossier = effDossier || {};
                                    const allRolls = getAllRollNumbersForStudent(
                                        targetRoll,
                                        targetName,
                                        effDossier.phone || effDossier.parentsMobile || regRec?.mobile,
                                        effDossier.rollNo || regRec?.rollNo
                                    );

                                    const currentSem = resolveCorrectSemester(top, effDossier, regRec);

                                    let dossierText = `🔓 *CONFIDENTIAL DOSSIER UNLOCKED*\n` +
                                                      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                                                      `👤 *Name:* ${targetName}\n` +
                                                      `📋 *Reg. No:* \`${targetRoll}\`\n`;

                                    if (allRolls.length > 1) {
                                        dossierText += `🔢 *Roll Nos:* ${allRolls.map(r => `\`${r}\``).join(' · ')}\n`;
                                    } else if (allRolls.length === 1) {
                                        dossierText += `🔢 *Roll No:* \`${allRolls[0]}\`\n`;
                                    }

                                    if (top) {
                                        dossierText += `🏛️ *Dept:* ${top.department_name || top.degree_name || 'NERIST'}\n` +
                                                       `📚 *Program:* ${top.program_name || 'Degree'} (Sem ${currentSem})\n` +
                                                       `📊 *CGPA:* ${top.cgpa || 'N/A'}\n` +
                                                       (top.state ? `📍 *State:* ${top.state}\n` : '');
                                    }

                                    dossierText += `\n📋 *Personal Information:*\n`;
                                    if (effDossier.phone) dossierText += `📱 *Phone:* ${effDossier.phone}\n`;
                                    if (effDossier.email) dossierText += `📧 *Email:* ${effDossier.email}\n`;
                                    if (effDossier.dob) dossierText += `🎂 *DOB:* ${effDossier.dob}\n`;
                                    if (effDossier.fatherName) dossierText += `👨 *Father:* ${effDossier.fatherName}\n`;
                                    if (effDossier.motherName) dossierText += `👩 *Mother:* ${effDossier.motherName}\n`;
                                    if (effDossier.parentsMobile) dossierText += `📞 *Parent Phone:* ${effDossier.parentsMobile}\n`;
                                    if (effDossier.address) dossierText += `🏠 *Address/Pin:* ${effDossier.address}\n`;
                                    if (effDossier.aadhaar) dossierText += `🪪 *Aadhaar:* \`${effDossier.aadhaar}\`\n`;
                                    dossierText += `\n_💳 Paid Credit Used (0 remaining)_`;

                                    const photoBuf = await fetchStudentPhotoBuffer(targetRoll);
                                    if (photoBuf) {
                                        try {
                                            await sock.sendMessage(destJid, {
                                                image: photoBuf,
                                                caption: dossierText.trim()
                                            });
                                        } catch (sendImgErr) {
                                            await sendMsg(sock, destJid, dossierText.trim());
                                        }
                                    } else {
                                        await sendMsg(sock, destJid, dossierText.trim());
                                    }
                                }
                            } catch (dErr) {
                                log('Error delivering auto-approved dossier:', dErr.message);
                            }
                        }
                    }

                    await sendMsg(sock, senderJid, `✅ *Claim Approved*: Verified UTR \`${claim.utr}\` for +91${claim.userPhone}. Record unlocked.`);
                } else {
                    delete data.pendingClaims[claimId];
                    saveQuotas(data);

                    await sendMsg(sock, claim.senderJid,
                        `❌ *VERIFICATION UNCONFIRMED*\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `The administrator could not confirm transaction reference \`${claim.utr}\`.\n` +
                        `If funds were deducted from your bank, please forward your payment receipt screenshot to the administrator at +91${ADMIN_PHONE}.`
                    );

                    await sendMsg(sock, senderJid, `❌ *Claim Rejected*: Disallowed UTR \`${claim.utr}\` for +91${claim.userPhone}.`);
                }
                continue;
            }

            // -----------------------------------------------------------------
            // 📝 12-DIGIT UTR / REFERENCE SUBMISSION (OPTION B: 1-TAP ADMIN APPROVAL)
            // -----------------------------------------------------------------
            const utrMatch = rawBody.match(/\b\d{12}\b/);
            if (utrMatch && !lowerBody.startsWith('@') && !lowerBody.startsWith('#') && !lowerBody.startsWith('!') && !rawBody.startsWith('+91')) {
                const utr = utrMatch[0];
                const data = loadQuotas();

                if (data.usedUtrs && data.usedUtrs[utr]) {
                    await sendMsg(sock, senderJid, `❌ *UTR Already Claimed*\nThis 12-digit reference (\`${utr}\`) has already been redeemed.`);
                    continue;
                }

                if (!data.pendingClaims) data.pendingClaims = {};

                // Check if already submitted and pending
                const existing = Object.values(data.pendingClaims).find(c => c.utr === utr);
                if (existing) {
                    await sendMsg(sock, senderJid, `⏳ *Verification in Progress*\nReference \`${utr}\` is already awaiting admin approval.`);
                    continue;
                }

                const pending = userPendingPayment.get(userPhone) || { type: 'single', amount: 3, targetRoll: userLastStudent.get(senderJid) || '' };
                const claimId = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

                data.pendingClaims[claimId] = {
                    claimId,
                    userPhone,
                    senderJid,
                    targetRoll: pending.targetRoll || '',
                    amount: pending.amount || 3,
                    type: pending.type || 'single',
                    utr,
                    timestamp: Date.now()
                };
                saveQuotas(data);

                // 1. Notify Student: Clean confirmation that admin has received it
                await sendMsg(sock, senderJid,
                    `⏳ *PAYMENT REFERENCE SUBMITTED*\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `📝 *UTR Reference:* \`${utr}\`\n` +
                    `💰 *Amount:* ₹${pending.amount}.00\n` +
                    `⏳ *Status:* Forwarded to server administrator (+91${ADMIN_PHONE}) for 1-tap verification.\n\n` +
                    `⚡ Your record will be decrypted and delivered directly to this chat the moment it is confirmed!`
                );

                // 2. Dispatch 1-Tap Interactive Decision Card to Admin (+919863013886)
                const planLabel = pending.type === 'monthly' ? 'Monthly Pass (₹119)' : `1 Unlock (₹3) for \`${pending.targetRoll || 'General'}\``;
                const adminCardText =
                    `🔔 *NEW PAYMENT APPROVAL REQUEST*\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `💰 *Amount:* *₹${pending.amount}.00*\n` +
                    `👤 *Student:* +91${userPhone}\n` +
                    `📝 *UTR:* \`${utr}\`\n` +
                    `📌 *Plan:* ${planLabel}\n\n` +
                    `_Verify payment in your Google Pay / SBI app, then tap below:_`;

                await sendNativeButtons({
                    sock,
                    jid: ADMIN_JID,
                    title: 'Payment Approval Required',
                    body: adminCardText,
                    footer: 'PrintKurox Payment Gateway',
                    buttons: [
                        { id: `claim_approve_${claimId}`, text: '✅ Approve & Unlock' },
                        { id: `claim_reject_${claimId}`, text: '❌ Reject Fake UTR' }
                    ]
                });

                log(`Payment claim ${claimId} (UTR: ${utr}, ₹${pending.amount}) forwarded to admin for approval.`);
                continue;
            }

            // -----------------------------------------------------------------
            // 🎓 STUDENT SEARCH (@student <name or roll> or disambiguation tap)
            // -----------------------------------------------------------------
            let studentQuery = '';
            if (buttonId && buttonId.startsWith('view_student_')) {
                const altClean = buttonId.replace('view_student_', '');
                studentQuery = studentCleanIdMap.get(altClean) || altClean.replace(/_/g, '/');
            } else if (lowerBody.startsWith('@student') || lowerBody.startsWith('!student')) {
                studentQuery = rawBody.slice(8).trim();
            } else if (lowerBody.startsWith('student ')) {
                studentQuery = rawBody.slice(8).trim();
            }

            if (studentQuery) {
                const matches = searchStudents(studentQuery);
                if (matches.length > 0) {
                    const top = matches[0];
                    const rollNo = top.user_id || 'N/A';
                    const targetJid = resolveToPnJid(senderJid);

                    // Track last viewed student for this user
                    userLastStudent.set(senderJid, rollNo);
                    userLastStudent.set(targetJid, rollNo);

                    let replyBody = `👤 *Name:* ${top.full_name}\n` +
                                    `📋 *Reg. No:* \`${rollNo}\`\n` +
                                    (top.roll_no ? `🔢 *Class Roll:* \`${top.roll_no}\`\n` : '') +
                                    `🏛️ *Dept:* ${top.department_name || top.degree_name || 'NERIST'}\n` +
                                    (top.status === 'Alumni / Left'
                                        ? `🎓 *Status:* Alumni / Ex-Student`
                                        : `🎓 *Semester:* Semester ${top.semester} (Odd Sem)`);

                    const cleanRollToken = rollNo.replace(/[^a-zA-Z0-9]/g, '_');

                    // Primary Action: Unlock Top Candidate
                    const actionButtons = [
                        { id: `unlock_${cleanRollToken}`, text: '🔓 Unlock Dossier' }
                    ];

                    // Disambiguation Quick Reply Buttons: 1-Tap Alternate Matches (up to 2 buttons)
                    if (matches.length > 1) {
                        for (let i = 1; i < Math.min(3, matches.length); i++) {
                            const alt = matches[i];
                            const altClean = (alt.user_id || '').replace(/[^a-zA-Z0-9]/g, '_');
                            const label = `👤 ${alt.full_name || 'Student'}`.trim();
                            actionButtons.push({
                                id: `view_student_${altClean}`,
                                text: label.length > 24 ? label.slice(0, 23) + '…' : label
                            });
                        }

                        if (matches.length > 3) {
                            replyBody += `\n\n_Additional matches (${matches.length - 3} more):_\n` +
                                         matches.slice(3, 7).map(s => `• *${s.full_name}* (\`@student ${s.user_id}\`)`).join('\n');
                        }
                    }

                    await sendNativeButtons({
                        sock,
                        jid: senderJid,
                        title: 'NERIST Student Profile',
                        body: replyBody.trim(),
                        footer: matches.length > 1 ? `Found ${matches.length} matches · Tap to switch` : 'Confidential dossier is locked',
                        buttons: actionButtons
                    });
                    log(`Processed @student "${studentQuery}" -> sent student card with ${actionButtons.length} buttons.`);
                } else {
                    await sendMsg(sock, senderJid, 'No student found in NERIST database.');
                }
                continue;
            }

            // -----------------------------------------------------------------
            // 🔓 DOSSIER UNLOCK (@dossier <roll> or button tap)
            // -----------------------------------------------------------------
            let dossierQuery = '';
            if (buttonId && buttonId.startsWith('unlock_')) {
                const cleanToken = buttonId.replace('unlock_', '');
                dossierQuery = studentCleanIdMap.get(cleanToken) || cleanToken.replace(/_/g, '/');
            } else if (lowerBody.startsWith('@dossier') || lowerBody.startsWith('!dossier')) {
                dossierQuery = rawBody.slice(8).trim();
            } else if (lowerBody.startsWith('dossier_')) {
                dossierQuery = rawBody.slice(8).trim();
            } else if (lowerBody.startsWith('dossier ')) {
                dossierQuery = rawBody.slice(8).trim();
            } else if (lowerBody.includes('unlock dossier') || lowerBody === 'unlock') {
                const targetJid = resolveToPnJid(senderJid);
                dossierQuery = userLastStudent.get(senderJid) || userLastStudent.get(targetJid) || '';
            }

            if (dossierQuery) {
                const matches = searchStudents(dossierQuery);
                const top = matches.length > 0 ? matches[0] : null;
                const targetRoll = top ? top.user_id : dossierQuery;
                const targetName = top ? top.full_name : 'Student';
                const photoUrl = `https://saascdn.symphonyx.in/fetch/9/1/3/STUDENT_IMAGES/${targetRoll.replace(/\//g, '_')}.jpg`;

                // Quota & Abuse Prevention Check
                const access = checkUserAccess(userPhone);
                if (!access.allowed) {
                    const cleanRollToken = targetRoll.replace(/[^a-zA-Z0-9]/g, '_');
                    const limitBody =
                        `⚠️ *Fair Usage Limit Reached (3/3 Used)*\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `Under the *NERIST Student Directory Policy*, accounts receive 3 complimentary dossier unlocks per 24 hours to prevent automated scraping and ensure fair server access.\n\n` +
                        `To support dedicated 24/7 campus server hosting & computational infrastructure, additional decrypt tokens are allocated below:\n\n` +
                        `🔹 *Single Unlock Token:* *₹3*\n` +
                        `_(Decrypt 1 additional confidential profile)_\n\n` +
                        `🔹 *Campus Pass (30 Days Unlimited):* *₹119*\n` +
                        `_(Continuous unrestricted directory access)_\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `_Select an option below to initiate instant token activation:_`;

                    await sendNativeButtons({
                        sock,
                        jid: senderJid,
                        title: 'Directory Capacity Notice',
                        body: limitBody,
                        footer: 'NERIST Server Resource Allocation',
                        buttons: [
                            { id: `pay_single_${cleanRollToken}`, text: '💳 Unlock for ₹3' },
                            { id: 'pay_monthly', text: '🌟 Monthly Pass (₹119)' },
                            { id: 'info_utr', text: '❓ How to Verify UTR' }
                        ]
                    });
                    log(`Daily limit reached for ${userPhone}. Sent professional capacity card.`);
                    continue;
                }

                // Consume credit
                consumeUserCredit(userPhone);

                // 1. Instant Reaction Animation
                sock.sendMessage(senderJid, { react: { text: '⏳', key: msg.key } }).catch(() => {});
                sock.sendPresenceUpdate('composing', senderJid).catch(() => {});

                // 2. Animated Progress Message
                await sendMsg(
                    sock,
                    senderJid,
                    `🔐 *DECRYPTING CONFIDENTIAL ARCHIVE...*\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `👤 *Student:* ${targetName}\n` +
                    `📋 *Reg. No:* \`${targetRoll}\`\n` +
                    `⏳ _Accessing SymphonyX encrypted student cache..._`
                );

                const dossier = await fetchDossier(targetRoll);

                // 3. Complete Reaction Animation
                sock.sendMessage(senderJid, { react: { text: '🔓', key: msg.key } }).catch(() => {});

                const regRec = regToDetailsMap.get(targetRoll);
                let effDossier = {
                    ...(regRec || {}),
                    ...(dossier || {})
                };
                if (top) {
                    if (!effDossier.rollNo && top.roll_no) effDossier.rollNo = top.roll_no;
                    if (!effDossier.phone && top.mobile) effDossier.phone = top.mobile;
                    if (!effDossier.email && top.email) effDossier.email = top.email;
                    if (!effDossier.semester && top.semester) effDossier.semester = top.semester;
                    if (!effDossier.address && top.pincode) effDossier.address = `PIN: ${top.pincode}`;
                }
                if (regRec) {
                    if (!effDossier.rollNo && (regRec.rollNo || regRec.roll_no)) effDossier.rollNo = regRec.rollNo || regRec.roll_no;
                    if (!effDossier.phone && (regRec.mobile || regRec.phone)) effDossier.phone = regRec.mobile || regRec.phone;
                    if (!effDossier.email && regRec.email) effDossier.email = regRec.email;
                    if (!effDossier.parentsMobile && (regRec.parentMobile || regRec.parentsMobile)) effDossier.parentsMobile = regRec.parentMobile || regRec.parentsMobile;
                }

                if (effDossier || top) {
                    effDossier = effDossier || {};
                    const allRolls = getAllRollNumbersForStudent(
                        targetRoll,
                        targetName,
                        effDossier.phone || effDossier.parentsMobile || regRec?.mobile,
                        effDossier.rollNo || regRec?.rollNo
                    );

                    const currentSem = resolveCorrectSemester(top, effDossier, regRec);

                    let dossierText = `🔓 *CONFIDENTIAL DOSSIER UNLOCKED*\n` +
                                      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                                      `👤 *Name:* ${targetName}\n` +
                                      `📋 *Reg. No:* \`${targetRoll}\`\n`;

                    if (allRolls.length > 1) {
                        dossierText += `🔢 *Roll Nos:* ${allRolls.map(r => `\`${r}\``).join(' · ')}\n`;
                    } else if (allRolls.length === 1) {
                        dossierText += `🔢 *Roll No:* \`${allRolls[0]}\`\n`;
                    }

                    if (top) {
                        const isAlumni = top.status === 'Alumni / Left' || effDossier.status === 'Alumni / Left';
                        const semDisplay = isAlumni ? 'Alumni / Ex-Student' : `Sem ${top.semester || currentSem}`;
                        dossierText += `🏛️ *Dept:* ${top.department_name || top.degree_name || 'NERIST'}\n` +
                                       `🎓 *Program:* ${top.program_name || 'Degree'} (${semDisplay})\n` +
                                       `📊 *CGPA:* ${top.cgpa || 'N/A'}\n` +
                                       (top.state ? `📍 *State:* ${top.state}\n` : '');
                    }

                    dossierText += `\n📋 *Personal Information:*\n`;
                    if (effDossier.phone) dossierText += `📱 *Phone:* ${effDossier.phone}\n`;
                    if (effDossier.email) dossierText += `📧 *Email:* ${effDossier.email}\n`;
                    if (effDossier.dob) dossierText += `🎂 *DOB:* ${effDossier.dob}\n`;
                    if (effDossier.fatherName) dossierText += `👨 *Father:* ${effDossier.fatherName}\n`;
                    if (effDossier.motherName) dossierText += `👩 *Mother:* ${effDossier.motherName}\n`;
                    if (effDossier.parentsMobile) dossierText += `📞 *Parent Phone:* ${effDossier.parentsMobile}\n`;
                    if (effDossier.address) dossierText += `🏠 *Address/Pin:* ${effDossier.address}\n`;
                    if (effDossier.aadhaar) dossierText += `🪪 *Aadhaar:* \`${effDossier.aadhaar}\`\n`;

                    if (access.isAdmin) {
                        dossierText += `\n_👑 VIP Admin Access (Unlimited)_`;
                    } else if (access.hasPass) {
                        dossierText += `\n_🌟 Monthly Pass Active (${access.daysLeft} days remaining)_`;
                    } else if (access.hasPaidCredit) {
                        dossierText += `\n_💳 Paid Credit Used (${access.paidCredits - 1} remaining)_`;
                    } else {
                        dossierText += `\n_⚡ Free Unlocks Remaining Today: ${Math.max(0, access.remaining - 1)}/3_`;
                    }

                    const destJid = (senderJid && !senderJid.endsWith('@lid'))
                        ? senderJid
                        : (userPhone ? `${userPhone}@s.whatsapp.net` : resolveToPnJid(senderJid));

                    const photoBuf = await fetchStudentPhotoBuffer(targetRoll);
                    if (photoBuf) {
                        try {
                            await sock.sendMessage(destJid, {
                                image: photoBuf,
                                caption: dossierText.trim()
                            });
                        } catch (e) {
                            await sendMsg(sock, destJid, dossierText.trim());
                        }
                    } else {
                        await sendMsg(sock, destJid, dossierText.trim());
                    }
                    log(`Dossier unlocked for ${targetRoll} (Photo: ${photoBuf ? 'Delivered' : 'None/Suppressed'})`);
                } else {
                    await sendMsg(sock, senderJid, `❌ Unable to unlock dossier for \`${targetRoll}\`.`);
                }
                continue;
            }
        }
    });
}

process.on('uncaughtException', (err) => log('Uncaught:', err.message));
process.on('unhandledRejection', (reason) => log('Unhandled:', reason));

startBusinessBot();
