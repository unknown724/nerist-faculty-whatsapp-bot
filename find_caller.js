async function findCaller() {
    const res = await fetch('https://nerist-student-search.pages.dev/');
    const html = await res.text();
    const matches = html.match(/src="(\/assets\/[^"]+)"/g);
    if (matches) {
        for (const m of matches) {
            const url = 'https://nerist-student-search.pages.dev' + m.slice(5, -1);
            const sRes = await fetch(url);
            const code = await sRes.text();
            
            let idx = code.indexOf('Ke(');
            while (idx !== -1) {
                console.log('--- CALL TO Ke ---');
                console.log(code.slice(Math.max(0, idx - 400), idx + 200));
                idx = code.indexOf('Ke(', idx + 3);
            }
        }
    }
}
findCaller();
