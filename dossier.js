async function fetchDossier(regNo) {
    if (!regNo) return null;
    const cleanReg = regNo.trim();
    
    // 1. Try Cloudflare Dossier Cache API first
    try {
        const res = await fetch(`https://nerist-student-search.pages.dev/api/dossierCache?regNo=${encodeURIComponent(cleanReg)}`, {
            signal: AbortSignal.timeout(4000)
        });
        if (res.ok) {
            const data = await res.json();
            if (data && data.dossier) {
                return data.dossier;
            }
        }
    } catch (e) {}

    return null;
}

module.exports = { fetchDossier };
