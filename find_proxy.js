async function findProxyFetch() {
    const res = await fetch('https://nerist-student-search.pages.dev/');
    const html = await res.text();
    const matches = html.match(/src="(\/assets\/[^"]+)"/g);
    if (matches) {
        for (const m of matches) {
            const url = 'https://nerist-student-search.pages.dev' + m.slice(5, -1);
            const sRes = await fetch(url);
            const code = await sRes.text();
            
            let idx = code.indexOf('Received an empty or invalid response');
            if (idx !== -1) {
                console.log(code.slice(Math.max(0, idx - 800), idx + 100));
            }
        }
    }
}
findProxyFetch();
