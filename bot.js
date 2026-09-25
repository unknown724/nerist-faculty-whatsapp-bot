/**
 * NERIST Faculty WhatsApp Bot
 * Powered by whatsapp-web.js and qrcode-terminal
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

function log(...args) {
    const timestamp = new Date().toLocaleString();
    console.log(`[${timestamp}]`, ...args);
}

// Load faculty dataset
let facultyList = [];
try {
    const facultyPath = path.join(__dirname, 'faculty.json');
    if (fs.existsSync(facultyPath)) {
        facultyList = JSON.parse(fs.readFileSync(facultyPath, 'utf8'));
        log(`Loaded ${facultyList.length} faculty records from faculty.json.`);
    } else {
        log('faculty.json not found, falling back to online URL mode.');
    }
} catch (err) {
    console.warn('Warning: Failed to load faculty.json:', err.message);
}

/**
 * Extracts initials/acronym from faculty name (e.g. "Dr. Ashok Kumar Ray" -> "akr")
 * Replicates the shortcut search behavior of nerist-faculty-search.pages.dev
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
 * Smart Search:
 * 1. Checks acronym/initials (e.g., 'akr' -> Ashok Kumar Ray)
 * 2. Checks email handle (e.g., 'akr@nerist.ac.in', 'kry@nerist.ac.in')
 * 3. Checks faculty name or portal name
 * 4. Checks department name
 */
function searchFaculty(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    // 1. Exact acronym match (e.g. 'akr' -> Dr. Ashok Kumar Ray)
    const exactAcronym = facultyList.filter(f => 
        getAcronym(f.name) === q || getAcronym(f.portalName) === q
    );
    if (exactAcronym.length > 0) return exactAcronym;

    // 2. Email prefix match (e.g. 'akr' or 'kry')
    const emailMatch = facultyList.filter(f => 
        (f.emails || []).some(em => em.toLowerCase().split('@')[0] === q)
    );
    if (emailMatch.length > 0) return emailMatch;

    // 3. Name or portal name match
    const nameMatches = facultyList.filter(f => {
        const name = (f.name || '').toLowerCase();
        const pName = (f.portalName || '').toLowerCase();
        return name.includes(q) || pName.includes(q);
    });
    if (nameMatches.length > 0) return nameMatches;

    // 4. Department match
    return facultyList.filter(f => {
        const dept = (f.department || '').toLowerCase();
        return dept.includes(q);
    });
}

// Initialize WhatsApp client with LocalAuth session persistence
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

// Display QR code on terminal for WhatsApp Web authentication (if not already logged in)
client.on('qr', (qr) => {
    console.log('\n=============================================');
    console.log('   SCAN THIS QR CODE WITH YOUR WHATSAPP     ');
    console.log('=============================================\n');
    qrcode.generate(qr, { small: true });
    console.log('\nSteps:');
    console.log('1. Open WhatsApp on your phone');
    console.log('2. Go to Settings > Linked Devices > Link a Device');
    console.log('3. Point your camera at the QR code above.\n');
});

// Emitted when authentication is successful
client.on('authenticated', () => {
    log('Authenticated successfully with WhatsApp Web.');
});

// Emitted when authentication fails
client.on('auth_failure', (msg) => {
    console.error('Authentication failure:', msg);
});

// Requirement 8: Log "Bot ready" when connected
client.on('ready', () => {
    log('Bot ready');
});

// Auto-reconnect if connection drops (e.g. Wi-Fi reconnection after sleep/boot)
client.on('disconnected', (reason) => {
    log('WhatsApp client disconnected:', reason);
    log('Reconnecting in 15 seconds...');
    setTimeout(() => {
        client.initialize().catch(err => {
            log('Reconnection failed, retrying in 30 seconds:', err.message);
            setTimeout(() => client.initialize(), 30000);
        });
    }, 15000);
});

/**
 * Handle incoming & outgoing messages
 */
client.on('message_create', async (message) => {
    try {
        const body = (message.body || '').trim();
        if (!body) return;

        const lowerBody = body.toLowerCase();

        // 1. Help command: @help or !help
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
            log(`Processed help command from: ${message.from}`);
            return;
        }

        // 2. Requirement 2 & 6: Check for @find or !find prefix
        let prefix = '';
        if (lowerBody.startsWith('@find')) {
            prefix = '@find';
        } else if (lowerBody.startsWith('!find')) {
            prefix = '!find';
        } else {
            // Ignore messages that don't start with @find / !find
            return;
        }

        // Requirement 3: Extract query after command
        const query = body.slice(prefix.length).trim();
        if (!query) {
            await message.reply('Please specify a faculty name or shortcut.\n*Example:* `@find Rajesh Kumar` or `@find akr`');
            return;
        }

        // Requirement 4: Search URL
        const encodedQuery = encodeURIComponent(query);
        const searchUrl = `https://nerist-faculty-search.pages.dev/?q=${encodedQuery}`;

        // Perform smart search (supports shortcuts like akr, kry, full names, etc.)
        const matches = searchFaculty(query);

        // Requirement 5: Display Name and Mobile number
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
            log(`Replied to @find "${query}" with ${matches.length} results.`);
        } else {
            const replyText = `Found "${query}" - official contact here:\n${searchUrl}\n\n📱 *Mobile:* No match found in offline database. Please check the website!`;
            await message.reply(replyText);
            log(`Replied to @find "${query}" with no local matches.`);
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
log('Starting WhatsApp Client...');
client.initialize();
