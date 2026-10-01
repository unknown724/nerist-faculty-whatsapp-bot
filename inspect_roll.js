async function inspect() {
    const res = await fetch('https://nerist-student-search.pages.dev/');
    const html = await res.text();
    const matches = html.match(/src="(\/assets\/[^"]+)"/g);
    if (matches) {
        for (const m of matches) {
            const url = 'https://nerist-student-search.pages.dev' + m.slice(5, -1);
            console.log('Fetching', url);
            const sRes = await fetch(url);
            const code = await sRes.text();
            
            // Check for Reg No or Roll No strings
            const regex = /(?:Registration|Reg\.|Roll|user_id)[^"]{0,50}/gi;
            let match;
            while ((match = regex.exec(code)) !== null) {
                console.log('Match:', match[0]);
            }
        }
    }
}
inspect();
