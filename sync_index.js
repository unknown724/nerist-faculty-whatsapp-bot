const fs = require('fs');
const path = require('path');
const {
    initStudentIndex,
    extractPdfData,
    indexRecord,
    persistIndex,
    regToDetailsMap
} = require('./student_index');

const STUDENTS_FILE = path.join(__dirname, 'students.json');

async function syncAll(concurrency = 8, limit = Infinity) {
    if (!fs.existsSync(STUDENTS_FILE)) {
        console.error('students.json not found!');
        return;
    }

    const students = JSON.parse(fs.readFileSync(STUDENTS_FILE, 'utf8'));
    initStudentIndex(students);

    console.log(`Starting index sync. Total students: ${students.length}. Already indexed: ${regToDetailsMap.size}`);

    const remaining = students.filter(s => !regToDetailsMap.has(s.user_id)).slice(0, limit);
    console.log(`Remaining to fetch: ${remaining.length}`);

    let processed = 0;
    let successful = 0;
    let failed = 0;

    for (let i = 0; i < remaining.length; i += concurrency) {
        const batch = remaining.slice(i, i + concurrency);
        await Promise.all(batch.map(async (student) => {
            const regNo = student.user_id;
            try {
                const details = await extractPdfData(regNo);
                if (details && (details.rollNo || details.mobile)) {
                    indexRecord(details);
                    successful++;
                } else {
                    failed++;
                }
            } catch (err) {
                failed++;
            } finally {
                processed++;
            }
        }));

        if (processed % 40 === 0 || processed === remaining.length) {
            persistIndex();
            console.log(`[SYNC] Processed: ${processed}/${remaining.length} | Success: ${successful} | Failed: ${failed} | Total Indexed: ${regToDetailsMap.size}`);
        }

        // Polite delay between batches
        await new Promise(r => setTimeout(r, 150));
    }

    persistIndex();
    console.log(`[SYNC COMPLETE] Successfully indexed ${regToDetailsMap.size} students to roll_phone_index.json.`);
}

if (require.main === module) {
    const limit = process.argv[2] ? parseInt(process.argv[2], 10) : Infinity;
    syncAll(8, limit);
}

module.exports = { syncAll };
