const fs = require('fs');
const path = require('path');

const facultyList = JSON.parse(fs.readFileSync(path.join(__dirname, 'faculty.json'), 'utf8'));

function cleanHonorifics(str) {
    if (!str) return '';
    return str
        .replace(/\b(dr|mr|ms|prof|mrs|er|sir|maam|mam|madam|miss)\b\.?/gi, ' ')
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

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

function handleMessage(messageBody) {
    const body = (messageBody || '').trim();
    if (!body) return null;

    const lowerBody = body.toLowerCase();

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

        return { type: 'found', text: replyBody };
    } else {
        return { type: 'not_found', text: 'No database found' };
    }
}

// Tests
console.log('--- TEST 1: Shortcut @find jb ---');
console.log(handleMessage('@find jb').text);

console.log('\n--- TEST 2: Honorific @find jb maam ---');
console.log(handleMessage('@find jb maam').text);

console.log('\n--- TEST 3: Shortcut @find akr sir ---');
console.log(handleMessage('@find akr sir').text);

console.log('\n--- TEST 4: Unknown @find unknown person ---');
console.log(handleMessage('@find unknown person').text);

