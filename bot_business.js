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

async function sendNativeButtons({ sock, jid, title = '', body = '', footer = '', buttons = [] }) {
    if (!jid || !body) return;
    const targetJid = resolveToPnJid(jid);

    const nativeButtons = [];
    for (const btn of (buttons || [])) {
        if (btn.url) {
            nativeButtons.push({
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                    display_text: btn.text || 'Open Link',
                    url: btn.url,
                    merchant_url: btn.url
                })
            });
        } else {
            nativeButtons.push({
                name: 'quick_reply',
                buttonParamsJson: JSON.stringify({
                    display_text: btn.text || 'Action',
                    id: btn.id || btn.text
                })
            });
        }
    }

    try {
        const interactiveMessage = proto.Message.InteractiveMessage.create({
            body: proto.Message.InteractiveMessage.Body.create({
                text: body
            }),
            footer: proto.Message.InteractiveMessage.Footer.create({
                text: footer || 'NERIST Student Directory'
            }),
            header: proto.Message.InteractiveMessage.Header.create({
                title: title || '',
                hasMediaAttachment: false
            }),
            nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                buttons: nativeButtons
            })
        });

        const msg = generateWAMessageFromContent(targetJid, {
            viewOnceMessage: {
                message: {
                    messageContextInfo: {
                        deviceListMetadata: {},
                        deviceListMetadataVersion: 2
                    },
                    interactiveMessage
                }
            }
        }, { quoted: null });

        if (msg?.key?.id) {
            botSentIds.add(msg.key.id);
        }

        await sock.relayMessage(targetJid, msg.message, { messageId: msg.key.id });
        log(`Sent native interactive quick reply buttons to ${targetJid}`);
        return msg;
    } catch (err) {
        log(`Native button relay error to ${targetJid}: ${err.message}. Sending fallback text.`);
        let messageText = '';
        if (title) messageText += `*${title}*\n\n`;
        messageText += `${body}\n\n`;
        for (const btn of buttons) {
            messageText += `• ${btn.text}: \`${btn.id || btn.url}\`\n`;
        }
        return await sendMsg(sock, targetJid, messageText.trim());
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
            const interactive =
                content?.interactiveResponseMessage ||
                msg.message?.interactiveResponseMessage ||
                content?.viewOnceMessage?.message?.interactiveResponseMessage ||
                msg.message?.viewOnceMessage?.message?.interactiveResponseMessage;

            if (interactive?.nativeFlowResponseMessage?.paramsJson) {
                try {
                    const params = JSON.parse(interactive.nativeFlowResponseMessage.paramsJson);
                    buttonId = params.id;
                    log(`Button tapped: id="${buttonId}" by ${senderJid}`);
                } catch (e) {}
            }

            const rawBody = (
                buttonId ||
                content?.conversation ||
                content?.extendedTextMessage?.text ||
                ''
            ).trim();

            if (!rawBody) continue;
            const lowerBody = rawBody.toLowerCase();
            log(`[BUSINESS MSG] fromMe=${msg.key.fromMe} jid=${senderJid} text="${rawBody}"`);

            // -----------------------------------------------------------------
            // 🎓 STUDENT SEARCH (@student <name or roll>)
            // -----------------------------------------------------------------
            let studentQuery = '';
            if (lowerBody.startsWith('@student') || lowerBody.startsWith('!student')) {
                studentQuery = rawBody.slice(8).trim();
            } else if (lowerBody.startsWith('student ')) {
                studentQuery = rawBody.slice(8).trim();
            } else if (!lowerBody.startsWith('@dossier') && !lowerBody.startsWith('!dossier') && !lowerBody.startsWith('dossier ')) {
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

                    let replyBody = `🎓 *${top.full_name}*\n` +
                                    `📋 *Reg. No:* \`${rollNo}\`\n` +
                                    `🏛️ *Dept:* ${top.department_name || top.degree_name || 'NERIST'}\n` +
                                    `📚 *Program:* ${top.program_name || 'Degree'} (Sem ${top.semester || 'N/A'})`;

                    if (matches.length > 1) {
                        replyBody += `\n\n_Also found (${matches.length - 1} more):_\n` +
                                     matches.slice(1, 4).map(s => `• *${s.full_name}* (\`@student ${s.user_id}\`)`).join('\n');
                    }

                    await sendNativeButtons({
                        sock,
                        jid: senderJid,
                        title: 'NERIST Student Profile',
                        body: replyBody.trim(),
                        footer: 'Confidential dossier is locked',
                        buttons: [
                            { id: `@dossier ${rollNo}`, text: '🔓 Unlock Dossier' }
                        ]
                    });
                    log(`Processed @student "${studentQuery}" -> sent student card.`);
                } else {
                    await sendMsg(sock, senderJid, 'No student found in NERIST database.');
                }
                continue;
            }

            // -----------------------------------------------------------------
            // 🔓 DOSSIER UNLOCK (@dossier <roll>)
            // -----------------------------------------------------------------
            let dossierQuery = '';
            if (lowerBody.startsWith('@dossier') || lowerBody.startsWith('!dossier')) {
                dossierQuery = rawBody.slice(8).trim();
            } else if (lowerBody.startsWith('dossier ')) {
                dossierQuery = rawBody.slice(8).trim();
            }

            if (dossierQuery) {
                const matches = searchStudents(dossierQuery);
                const top = matches.length > 0 ? matches[0] : null;
                const targetRoll = top ? top.user_id : dossierQuery;
                const targetName = top ? top.full_name : 'Student';
                const photoUrl = `https://saascdn.symphonyx.in/fetch/9/1/3/STUDENT_IMAGES/${targetRoll.replace(/\//g, '_')}.jpg`;

                await sendMsg(sock, senderJid, `🔐 Decrypting dossier for *${targetName}* (\`${targetRoll}\`)...`);
                const dossier = await fetchDossier(targetRoll);

                if (dossier) {
                    let dossierText = `🔓 *CONFIDENTIAL DOSSIER UNLOCKED*\n\n` +
                                      `👤 *${targetName}*\n` +
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
