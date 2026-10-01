const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const INDEX_FILE = path.join(__dirname, 'roll_phone_index.json');
const STUDENTS_FILE = path.join(__dirname, 'students.json');

// In-memory data stores
let studentsList = [];
const rollToRegMap = new Map();     // cleanRoll -> regNo
const phoneToRegsMap = new Map();   // clean10DigitPhone -> Set of { regNo, type: 'Student' | 'Parent' }
const regToDetailsMap = new Map();  // regNo -> details object

function cleanRollNo(roll) {
    if (!roll) return '';
    return String(roll).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cleanPhoneNo(phone) {
    if (!phone) return '';
    const digits = String(phone).replace(/[^0-9]/g, '');
    if (digits.length >= 10) {
        return digits.slice(-10);
    }
    return '';
}

function cleanRegNo(reg) {
    if (!reg) return '';
    return String(reg).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseStreamLines(decompStr) {
    const items = [];
    const regex = /1 0 0 1 ([0-9.-]+) ([0-9.-]+) Tm|\(([^)]*)\)Tj/g;
    let m;
    let curX = 0, curY = 0;
    while ((m = regex.exec(decompStr)) !== null) {
        if (m[1] !== undefined) {
            curX = parseFloat(m[1]);
            curY = parseFloat(m[2]);
        } else if (m[3] !== undefined) {
            items.push({ x: curX, y: curY, str: m[3] });
        }
    }

    // Sort descending by Y, then ascending by X
    items.sort((a, b) => (Math.abs(b.y - a.y) > 3) ? (b.y - a.y) : (a.x - b.x));

    const lines = [];
    let curLine = [];
    let lineY = -999;
    for (const it of items) {
        if (lineY === -999 || Math.abs(lineY - it.y) <= 3) {
            curLine.push(it);
            lineY = it.y;
        } else {
            curLine.sort((a, b) => a.x - b.x);
            lines.push(curLine.map(c => c.str).join('  '));
            curLine = [it];
            lineY = it.y;
        }
    }
    if (curLine.length) {
        curLine.sort((a, b) => a.x - b.x);
        lines.push(curLine.map(c => c.str).join('  '));
    }
    return lines;
}

/**
 * High-speed extractor from NERIST PDF stream
 */
async function extractPdfData(regNo) {
    if (!regNo) return null;
    const cleanReg = regNo.trim();
    try {
        const res = await fetch(`https://nerist-student-search.pages.dev/api/pdfProxy?regNo=${encodeURIComponent(cleanReg)}`, {
            signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) return null;

        const b = Buffer.from(await res.arrayBuffer());
        let i = 0;
        while ((i = b.indexOf('stream', i)) !== -1) {
            let start = i + 6;
            if (b[start] === 13) start++;
            if (b[start] === 10) start++;
            const end = b.indexOf('endstream', start);
            if (end !== -1) {
                try {
                    const decomp = zlib.inflateSync(b.slice(start, end)).toString('utf8');
                    if (decomp.includes('Roll No')) {
                        const lines = parseStreamLines(decomp);
                        const result = { regNo: cleanReg };

                        for (const line of lines) {
                            const rMatch = line.match(/Roll\s*No\s*[:\-]?\s*([^\s]+)/i);
                            if (rMatch && !result.rollNo) result.rollNo = rMatch[1].trim();

                            const pMatch = line.match(/Parents?\s*Mobile\s*[:\-]?\s*(\+?91[6-9]\d{9}|[6-9]\d{9})/i);
                            if (pMatch && !result.parentMobile) result.parentMobile = pMatch[1].trim();

                            const mMatch = line.match(/(?:^|\s)Mobile\s*[:\-]?\s*(\+?91[6-9]\d{9}|[6-9]\d{9})/i);
                            if (mMatch && !result.mobile) result.mobile = mMatch[1].trim();

                            const eMatch = line.match(/Email\s*[:\-]?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
                            if (eMatch && !result.email) result.email = eMatch[1].trim();

                            const dMatch = line.match(/DOB\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}|\d{2}[-/]\d{2}[-/]\d{4})/i);
                            if (dMatch && !result.dob) result.dob = dMatch[1].trim();

                            const fMatch = line.match(/Father'?s?\s*Name\s*[:\-]?\s*([A-Za-z\s.]+?)(?:\s+(?:Mother|Address|DOB)|$)/i);
                            if (fMatch && !result.fatherName) result.fatherName = fMatch[1].trim();

                            const moMatch = line.match(/Mother'?s?\s*Name\s*[:\-]?\s*([A-Za-z\s.]+?)(?:\s+(?:Father|Address|DOB)|$)/i);
                            if (moMatch && !result.motherName) result.motherName = moMatch[1].trim();

                            const aMatch = line.match(/Aadhaar\s*(?:No)?\s*[:\-]?\s*(\d{12})/i);
                            if (aMatch && !result.aadhaar) result.aadhaar = aMatch[1].trim();

                            const sMatch = line.match(/Session\s*[:\-]?\s*([^\s].*)/i);
                            if (sMatch && !result.session) result.session = sMatch[1].trim();

                            const semMatch = line.match(/For Semester:\s*([^\s].*?)(?:Report|$)/i);
                            if (semMatch && !result.semester) result.semester = semMatch[1].trim();
                        }
                        return result;
                    }
                } catch (e) {}
            }
            i = end !== -1 ? end + 9 : start;
        }
    } catch (e) {}
    return null;
}

/**
 * Register record into in-memory maps
 */
/**
 * Register record into in-memory maps
 */
function indexRecord(rec) {
    if (!rec) return;
    const regNo = rec.regNo || rec.user_id;
    if (!regNo) return;

    const existing = regToDetailsMap.get(regNo) || {};
    const merged = { ...existing, ...rec, regNo };
    if (!merged.rollNo && (rec.roll_no || existing.roll_no)) {
        merged.rollNo = rec.roll_no || existing.roll_no;
    }
    if (!merged.mobile && (rec.phone || existing.phone)) {
        merged.mobile = rec.phone || existing.phone;
    }
    regToDetailsMap.set(regNo, merged);

    const roll = merged.rollNo || merged.roll_no;
    if (roll) {
        const cRoll = cleanRollNo(roll);
        if (cRoll) rollToRegMap.set(cRoll, regNo);
    }

    const cReg = cleanRegNo(regNo);
    if (cReg) {
        rollToRegMap.set(cReg, regNo);
    }

    const mob = merged.mobile || merged.phone;
    if (mob) {
        const p1 = cleanPhoneNo(mob);
        if (p1) {
            if (!phoneToRegsMap.has(p1)) phoneToRegsMap.set(p1, []);
            const arr = phoneToRegsMap.get(p1);
            if (!arr.some(item => item.regNo === regNo && item.type === 'Student Mobile')) {
                arr.push({ regNo, type: 'Student Mobile', phone: mob });
            }
        }
    }

    const parentMob = merged.parentMobile || merged.parentsMobile;
    if (parentMob) {
        const p2 = cleanPhoneNo(parentMob);
        if (p2) {
            if (!phoneToRegsMap.has(p2)) phoneToRegsMap.set(p2, []);
            const arr = phoneToRegsMap.get(p2);
            if (!arr.some(item => item.regNo === regNo && item.type === 'Parents Mobile')) {
                arr.push({ regNo, type: 'Parents Mobile', phone: parentMob });
            }
        }
    }
}

/**
 * Load student list & persistent cache
 */
function initStudentIndex(providedList = null) {
    if (providedList && Array.isArray(providedList)) {
        studentsList = providedList;
    } else if (fs.existsSync(STUDENTS_FILE)) {
        try {
            studentsList = JSON.parse(fs.readFileSync(STUDENTS_FILE, 'utf8'));
        } catch (e) {}
    }

    if (fs.existsSync(INDEX_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
            if (typeof data === 'object') {
                for (const [reg, item] of Object.entries(data)) {
                    indexRecord({ ...item, regNo: item.regNo || reg });
                }
            }
        } catch (e) {}
    }

    // Attach roll numbers back to studentsList items & index all students in memory
    for (const s of studentsList) {
        const details = regToDetailsMap.get(s.user_id);
        if (details && (details.rollNo || details.roll_no)) {
            s.roll_no = details.rollNo || details.roll_no;
        }
        indexRecord({
            regNo: s.user_id,
            rollNo: s.roll_no,
            mobile: s.mobile,
            email: s.email,
            semester: s.semester
        });
    }
}

/**
 * Save index safely
 */
function persistIndex() {
    try {
        const out = {};
        for (const [reg, details] of regToDetailsMap.entries()) {
            out[reg] = details;
        }
        fs.writeFileSync(INDEX_FILE, JSON.stringify(out, null, 2), 'utf8');
    } catch (e) {}
}

/**
 * Lookup by Class Roll No or Reg No (e.g. "D/23/EC/015", "d23ec015", "120/011", "120011")
 */
function getStudentByRoll(rawRoll) {
    if (!rawRoll) return null;
    const cRoll = cleanRollNo(rawRoll);
    if (!cRoll) return null;

    const regNo = rollToRegMap.get(cRoll);
    if (regNo) {
        return studentsList.find(s => s.user_id === regNo) || null;
    }

    // Secondary scan across studentsList
    return studentsList.find(s => cleanRollNo(s.roll_no) === cRoll || cleanRegNo(s.user_id) === cRoll) || null;
}

/**
 * Lookup by Phone No (strictly for admin, matches student mobile & parents mobile)
 */
function getStudentByPhone(rawPhone) {
    if (!rawPhone) return [];
    const cPhone = cleanPhoneNo(rawPhone);
    if (!cPhone || cPhone.length < 10) return [];

    const matches = phoneToRegsMap.get(cPhone);
    if (!matches || matches.length === 0) return [];

    const results = [];
    const seenRegs = new Set();
    for (const m of matches) {
        const student = studentsList.find(s => s.user_id === m.regNo);
        const details = regToDetailsMap.get(m.regNo) || {};
        if (student) {
            results.push({
                ...student,
                rollNo: details.rollNo || details.roll_no || student.roll_no || null,
                fatherName: details.fatherName || null,
                motherName: details.motherName || null,
                matchedPhone: m.phone,
                matchType: m.type
            });
            seenRegs.add(m.regNo);
        }
    }
    return results;
}

/**
 * Get or fetch student details (with live fallback and auto-cache)
 */
async function getOrFetchStudentDetails(regNo) {
    if (!regNo) return null;
    const cleanReg = regNo.trim();
    if (regToDetailsMap.has(cleanReg)) {
        return regToDetailsMap.get(cleanReg);
    }

    const fetched = await extractPdfData(cleanReg);
    if (fetched) {
        indexRecord(fetched);
        persistIndex();
        return fetched;
    }
    return null;
}

module.exports = {
    cleanRollNo,
    cleanPhoneNo,
    cleanRegNo,
    extractPdfData,
    initStudentIndex,
    persistIndex,
    indexRecord,
    getStudentByRoll,
    getStudentByPhone,
    getOrFetchStudentDetails,
    regToDetailsMap,
    rollToRegMap,
    phoneToRegsMap
};
