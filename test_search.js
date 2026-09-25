const fs = require('fs');
const path = require('path');

const facultyList = JSON.parse(fs.readFileSync(path.join(__dirname, 'faculty.json'), 'utf8'));

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

function searchFaculty(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    // 1. Exact acronym / shortcut match (e.g. 'akr' -> Ashok Kumar Ray)
    const exactAcronym = facultyList.filter(f => 
        getAcronym(f.name) === q || getAcronym(f.portalName) === q
    );
    if (exactAcronym.length > 0) return exactAcronym;

    // 2. Email username match (e.g. 'akr' in akr@nerist.ac.in, 'kry' in kry@nerist.ac.in)
    const emailMatch = facultyList.filter(f => 
        (f.emails || []).some(em => em.toLowerCase().split('@')[0] === q)
    );
    if (emailMatch.length > 0) return emailMatch;

    // 3. Name or portal name match (prefix or substring)
    const nameMatches = facultyList.filter(f => {
        const name = (f.name || '').toLowerCase();
        const pName = (f.portalName || '').toLowerCase();
        return name.includes(q) || pName.includes(q);
    });
    if (nameMatches.length > 0) return nameMatches;

    // 4. Department match (e.g. 'physics')
    return facultyList.filter(f => {
        const dept = (f.department || '').toLowerCase();
        return dept.includes(q);
    });
}

function handleMessage(messageBody) {
    const body = (messageBody || '').trim();
    if (!body) return null;

    const lowerBody = body.toLowerCase();

    if (lowerBody === '@help' || lowerBody === '!help') {
        return {
            type: 'help',
            text: 'Help message returned'
        };
    }

    let prefix = '';
    if (lowerBody.startsWith('@find')) {
        prefix = '@find';
    } else if (lowerBody.startsWith('!find')) {
        prefix = '!find';
    } else {
        return null;
    }

    const query = body.slice(prefix.length).trim();
    if (!query) {
        return { type: 'error', text: 'Please specify a faculty name.' };
    }

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

        return { type: 'found', text: replyText, count: matches.length };
    } else {
        const replyText = `Found "${query}" - official contact here:\n${searchUrl}\n\n📱 *Mobile:* No match found in offline database. Please check the website!`;
        return { type: 'not_found', text: replyText };
    }
}

// Tests
console.log('--- TEST 1: Shortcut @find akr ---');
console.log(handleMessage('@find akr').text);

console.log('--- TEST 2: Shortcut @find kry ---');
console.log(handleMessage('@find kry').text);

console.log('--- TEST 3: Full Name @find Rajesh Kumar ---');
console.log(handleMessage('@find Rajesh Kumar').text);

console.log('--- TEST 4: Unknown @find unknown person ---');
console.log(handleMessage('@find unknown person').text);
