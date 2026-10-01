async function inspectBundle() {
    const res = await fetch('https://nerist-student-search.pages.dev/');
    const html = await res.text();
    const matches = html.match(/src="(\/assets\/[^"]+)"/g);
    if (matches) {
        for (const m of matches) {
            const url = 'https://nerist-student-search.pages.dev' + m.slice(5, -1);
            const sRes = await fetch(url);
            const code = await sRes.text();
            
            let idx = 0;
            while ((idx = code.indexOf('Roll No', idx)) !== -1) {
                console.log('--- FOUND ROLL NO BLOCK ---');
                console.log(code.slice(Math.max(0, idx - 150), idx + 350));
                idx += 7;
            }
        }
    }
}
inspectBundle();
