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

    // 1. Roll number / user_id match
    const rollQuery = q.replace(/[^a-zA-Z0-9]/g, '');
    const rollMatches = studentsList.filter(s => {
        const roll = (s.user_id || '').toLowerCase().replace(/[^a-zA-Z0-9]/g, '');
        return roll === rollQuery || (rollQuery.length >= 4 && roll.includes(rollQuery));
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

const botSentIds = new Set();

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
        generateHighQualityLinkPreview: false
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

            const rawBody = (
                buttonId ||
                buttonText ||
                content?.conversation ||
                content?.extendedTextMessage?.text ||
                ''
            ).trim();

            if (!rawBody) continue;
            const lowerBody = rawBody.toLowerCase();
            const targetPnJid = resolveToPnJid(senderJid);
            const userPhone = targetPnJid.split('@')[0].replace(/[^0-9]/g, '').slice(-10);
            log(`[BUSINESS MSG] fromMe=${msg.key.fromMe} jid=${senderJid} phone=${userPhone} text="${rawBody}" (buttonId=${buttonId})`);

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
                    `💳 *DIRECT UPI PAYMENT: ₹${amount}*\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `📌 *Plan:* ${planTitle}\n` +
                    `💰 *Amount:* *₹${amount}.00*\n` +
                    `📱 *UPI ID:* \`${UPI_VPA}\` _(Tap to copy)_\n` +
                    `📞 *UPI Phone:* \`${UPI_PHONE}\` _(GPay / PhonePe / Paytm)_\n` +
                    `👤 *Recipient:* ${UPI_NAME}\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `🚀 *Instant Activation:*\n` +
                    `1. Scan this QR or pay ₹${amount} to UPI ID or Phone Number\n` +
                    `2. Copy the **12-digit UTR / UPI Ref No.** from payment receipt\n` +
                    `3. Send it here (e.g. \`429184910283\`) to unlock immediately!`;

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
            // 📝 12-DIGIT UTR / REFERENCE VERIFICATION
            // -----------------------------------------------------------------
            const utrMatch = rawBody.match(/\b\d{12}\b/);
            if (utrMatch && !rawBody.startsWith('@student') && !rawBody.startsWith('student ')) {
                const utr = utrMatch[0];
                const data = loadQuotas();

                if (data.usedUtrs && data.usedUtrs[utr]) {
                    await sendMsg(sock, senderJid, `❌ *UTR Already Redeemed*\nThis 12-digit reference (\`${utr}\`) has already been claimed.`);
                    continue;
                }

                const pending = userPendingPayment.get(userPhone) || { type: 'single', amount: 3 };
                const today = new Date().toISOString().slice(0, 10);
                const userRec = data.quotas[userPhone] || { lastDate: today, dailyUsed: 0, paidCredits: 0, passExpiresAt: null };

                if (!data.usedUtrs) data.usedUtrs = {};

                if (pending.type === 'monthly' || pending.amount >= 119) {
                    // Activate 30-day monthly pass
                    const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
                    userRec.passExpiresAt = expiry;
                    data.usedUtrs[utr] = { phone: userPhone, amount: 119, type: 'monthly', timestamp: Date.now() };
                    data.quotas[userPhone] = userRec;
                    saveQuotas(data);

                    await sendMsg(sock, senderJid,
                        `🎉 *MONTHLY PASS ACTIVATED!*\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `✅ Verified UTR: \`${utr}\`\n` +
                        `🌟 You now have **Unlimited Dossier Unlocks** for 30 days!\n` +
                        `📅 Valid until: ${expiry.slice(0, 10)}`
                    );

                    // Notify Admin
                    try {
                        await sock.sendMessage(ADMIN_JID, {
                            text: `🔔 *MONTHLY PASS ACTIVATED (₹119)*\n👤 User: +91${userPhone}\n📝 UTR: \`${utr}\`\n📅 Valid for 30 Days`
                        });
                    } catch (e) {}
                    userPendingPayment.delete(userPhone);
                    continue;
                } else {
                    // Add 1 single unlock credit
                    userRec.paidCredits = (userRec.paidCredits || 0) + 1;
                    data.usedUtrs[utr] = { phone: userPhone, amount: 3, type: 'single', timestamp: Date.now() };
                    data.quotas[userPhone] = userRec;
                    saveQuotas(data);

                    await sendMsg(sock, senderJid,
                        `✅ *PAYMENT VERIFIED (₹3)*\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `📝 UTR: \`${utr}\`\n` +
                        `🔓 1 Dossier Unlock Credit added to your account!`
                    );

                    // Notify Admin
                    try {
                        await sock.sendMessage(ADMIN_JID, {
                            text: `🔔 *PAYMENT RECEIVED (₹3)*\n👤 User: +91${userPhone}\n📝 UTR: \`${utr}\`\n🎓 Target: \`${pending.targetRoll || 'General'}\``
                        });
                    } catch (e) {}

                    // Auto-unlock if user was in middle of unlocking a student!
                    if (pending.targetRoll) {
                        dossierQuery = pending.targetRoll;
                    }
                    userPendingPayment.delete(userPhone);
                    if (!dossierQuery) continue;
                }
            }

            // -----------------------------------------------------------------
            // 👋 GREETINGS & MENU
            // -----------------------------------------------------------------
            if (['hi', 'hello', 'hey', 'start', 'help', 'menu'].includes(lowerBody)) {
                await sendNativeButtons({
                    sock,
                    jid: senderJid,
                    title: 'NERIST Student Directory',
                    body: `👋 *Welcome to NERIST Student Assistant*\n\nSearch any student by name or registration number:\n• Example: \`@student meira\`\n• Example: \`@student 121/108\`\n\nTap the button below to test search!`,
                    footer: 'NERIST Student Directory',
                    buttons: [
                        { id: 'search_meira', text: '🔍 Search Meirasana' }
                    ]
                });
                continue;
            }

            // -----------------------------------------------------------------
            // 🎓 STUDENT SEARCH (@student <name or roll>)
            // -----------------------------------------------------------------
            let studentQuery = '';
            if (buttonId === 'search_meira') {
                studentQuery = 'meira';
            } else if (lowerBody.startsWith('@student') || lowerBody.startsWith('!student')) {
                studentQuery = rawBody.slice(8).trim();
            } else if (lowerBody.startsWith('student ')) {
                studentQuery = rawBody.slice(8).trim();
            } else if (!lowerBody.startsWith('@dossier') && !lowerBody.startsWith('!dossier') && !lowerBody.startsWith('dossier ') && !lowerBody.startsWith('dossier_') && !lowerBody.startsWith('unlock_') && !lowerBody.includes('unlock dossier')) {
                // Auto-match student names or roll numbers in private chat
                const check = searchStudents(rawBody);
                if (check.length > 0) {
                    studentQuery = rawBody.trim();
                }
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

                    let replyBody = `🎓 *${top.full_name}*\n` +
                                    `📋 *Reg. No:* \`${rollNo}\`\n` +
                                    `🏛️ *Dept:* ${top.department_name || top.degree_name || 'NERIST'}\n` +
                                    `📚 *Program:* ${top.program_name || 'Degree'} (Sem ${top.semester || 'N/A'})`;

                    if (matches.length > 1) {
                        replyBody += `\n\n_Also found (${matches.length - 1} more):_\n` +
                                     matches.slice(1, 4).map(s => `• *${s.full_name}* (\`@student ${s.user_id}\`)`).join('\n');
                    }

                    const cleanRollToken = rollNo.replace(/[^a-zA-Z0-9]/g, '_');

                    await sendNativeButtons({
                        sock,
                        jid: senderJid,
                        title: 'NERIST Student Profile',
                        body: replyBody.trim(),
                        footer: 'Confidential dossier is locked',
                        buttons: [
                            { id: `unlock_${cleanRollToken}`, text: '🔓 Unlock Dossier' }
                        ]
                    });
                    log(`Processed @student "${studentQuery}" -> sent student card.`);
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
                        `⚠️ *Daily Free Limit Reached (3/3 Used)*\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `Free tier allows 3 dossier unlocks per day.\n` +
                        `To support 24/7 laptop server hosting:\n\n` +
                        `👉 *1 Extra Unlock:* *₹3*\n` +
                        `👉 *Monthly Pass (30 Days Unlimited):* *₹119*`;

                    await sendNativeButtons({
                        sock,
                        jid: senderJid,
                        title: 'Daily Limit Reached',
                        body: limitBody,
                        footer: 'NERIST Server Hosting Fund',
                        buttons: [
                            { id: `pay_single_${cleanRollToken}`, text: '💳 Unlock for ₹3' },
                            { id: 'pay_monthly', text: '🌟 Monthly Pass (₹119)' }
                        ]
                    });
                    log(`Daily limit reached for ${userPhone}. Sent payment card.`);
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

                if (dossier) {
                    let dossierText = `🔓 *CONFIDENTIAL DOSSIER UNLOCKED*\n` +
                                      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                                      `👤 *Name:* ${targetName}\n` +
                                      `📋 *Reg. No:* \`${targetRoll}\`\n` +
                                      (dossier.rollNo ? `🆔 *Roll No:* \`${dossier.rollNo}\`\n` : '');

                    if (top) {
                        dossierText += `🏛️ *Dept:* ${top.department_name || top.degree_name || 'NERIST'}\n` +
                                       `📚 *Program:* ${top.program_name || 'Degree'} (Sem ${top.semester || 'N/A'})\n` +
                                       `📊 *CGPA:* ${top.cgpa || 'N/A'}\n` +
                                       (top.state ? `📍 *State:* ${top.state}\n` : '');
                    }

                    dossierText += `\n📋 *Personal Information:*\n`;
                    if (dossier.phone) dossierText += `📱 *Phone:* ${dossier.phone}\n`;
                    if (dossier.email) dossierText += `📧 *Email:* ${dossier.email}\n`;
                    if (dossier.dob) dossierText += `🎂 *DOB:* ${dossier.dob}\n`;
                    if (dossier.fatherName) dossierText += `👨 *Father:* ${dossier.fatherName}\n`;
                    if (dossier.motherName) dossierText += `👩 *Mother:* ${dossier.motherName}\n`;
                    if (dossier.parentsMobile) dossierText += `📞 *Parent Phone:* ${dossier.parentsMobile}\n`;
                    if (dossier.address) dossierText += `🏠 *Address/Pin:* ${dossier.address}\n`;
                    if (dossier.aadhaar) dossierText += `🪪 *Aadhaar:* \`${dossier.aadhaar}\`\n`;

                    if (access.isAdmin) {
                        dossierText += `\n_👑 VIP Admin Access (Unlimited)_`;
                    } else if (access.hasPass) {
                        dossierText += `\n_🌟 Monthly Pass Active (${access.daysLeft} days remaining)_`;
                    } else if (access.hasPaidCredit) {
                        dossierText += `\n_💳 Paid Credit Used (${access.paidCredits - 1} remaining)_`;
                    } else {
                        dossierText += `\n_⚡ Free Unlocks Remaining Today: ${Math.max(0, access.remaining - 1)}/3_`;
                    }

                    try {
                        await sock.sendMessage(senderJid, {
                            image: { url: photoUrl },
                            caption: dossierText.trim()
                        });
                    } catch (e) {
                        await sendMsg(sock, senderJid, dossierText.trim());
                    }
                    log(`Dossier unlocked with photo for ${targetRoll}`);
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
