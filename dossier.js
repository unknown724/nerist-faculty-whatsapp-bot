const { getOrFetchStudentDetails } = require('./student_index');

async function fetchDossier(regNo) {
    if (!regNo) return null;
    const cleanReg = regNo.trim();
    
    let resultDossier = null;

    // 1. Try Cloudflare Dossier Cache API first
    try {
        const res = await fetch(`https://nerist-student-search.pages.dev/api/dossierCache?regNo=${encodeURIComponent(cleanReg)}`, {
            signal: AbortSignal.timeout(4000)
        });
        if (res.ok) {
            const data = await res.json();
            if (data && data.dossier) {
                resultDossier = { ...data.dossier };
            }
        }
    } catch (e) {}

    // 2. Fetch/Enrich with Roll Number & any missing details from student_index / live PDF extractor
    try {
        const ext = await getOrFetchStudentDetails(cleanReg);
        if (ext) {
            if (!resultDossier) {
                resultDossier = {
                    dob: ext.dob || null,
                    fatherName: ext.fatherName || null,
                    motherName: ext.motherName || null,
                    phone: ext.mobile || null,
                    email: ext.email || null,
                    address: ext.address || null,
                    parentsMobile: ext.parentMobile || null,
                    aadhaar: ext.aadhaar || null
                };
            }
            if (ext.rollNo) {
                resultDossier.rollNo = ext.rollNo;
            }
            if (ext.mobile && !resultDossier.phone) resultDossier.phone = ext.mobile;
            if (ext.parentMobile && !resultDossier.parentsMobile) resultDossier.parentsMobile = ext.parentMobile;
            if (ext.fatherName && !resultDossier.fatherName) resultDossier.fatherName = ext.fatherName;
            if (ext.motherName && !resultDossier.motherName) resultDossier.motherName = ext.motherName;
            if (ext.aadhaar && !resultDossier.aadhaar) resultDossier.aadhaar = ext.aadhaar;
        }
    } catch (e) {}

    return resultDossier;
}

module.exports = { fetchDossier };
