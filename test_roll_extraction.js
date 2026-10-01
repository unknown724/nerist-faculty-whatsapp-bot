const zlib = require('zlib');

function parseStreamLines(str) {
  const items = [];
  const regex = /1 0 0 1 ([0-9.-]+) ([0-9.-]+) Tm|\(([^)]*)\)Tj/g;
  let m;
  let curX = 0, curY = 0;
  while ((m = regex.exec(str)) !== null) {
    if (m[1] !== undefined) {
      curX = parseFloat(m[1]);
      curY = parseFloat(m[2]);
    } else if (m[3] !== undefined) {
      items.push({ x: curX, y: curY, str: m[3] });
    }
  }

  // Sort descending by Y (top of page to bottom), then ascending by X (left to right)
  items.sort((a,b) => (Math.abs(b.y - a.y) > 3) ? (b.y - a.y) : (a.x - b.x));

  const lines = [];
  let curLine = [];
  let lineY = -999;
  for (const it of items) {
    if (lineY === -999 || Math.abs(lineY - it.y) <= 3) {
      curLine.push(it);
      lineY = it.y;
    } else {
      curLine.sort((a,b) => a.x - b.x);
      lines.push(curLine.map(c => c.str).join('  '));
      curLine = [it];
      lineY = it.y;
    }
  }
  if (curLine.length) {
    curLine.sort((a,b) => a.x - b.x);
    lines.push(curLine.map(c => c.str).join('  '));
  }
  return lines;
}

async function extractPdfData(regNo) {
  try {
    const res = await fetch('https://nerist-student-search.pages.dev/api/pdfProxy?regNo=' + encodeURIComponent(regNo), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { regNo, error: 'Fetch status ' + res.status };
    const b = Buffer.from(await res.arrayBuffer());
    let i = 0;
    while((i = b.indexOf('stream', i)) !== -1) {
      let start = i + 6;
      if(b[start] === 13) start++;
      if(b[start] === 10) start++;
      const end = b.indexOf('endstream', start);
      if(end !== -1) {
        try {
          const decomp = zlib.inflateSync(b.slice(start, end)).toString('utf8');
          if (decomp.includes('Roll No')) {
            const lines = parseStreamLines(decomp);
            let rollNo = null, session = null, semester = null;
            for (const line of lines) {
              const rMatch = line.match(/Roll\s*No\s*[:\-]?\s*([A-Za-z0-9\/]+)/i);
              if (rMatch && !rollNo) rollNo = rMatch[1];
              const sMatch = line.match(/Session\s*[:\-]?\s*([^\s].*)/i);
              if (sMatch && !session) session = sMatch[1].trim();
              const semMatch = line.match(/For Semester:\s*([^\s].*?)(?:Report|$)/i);
              if (semMatch && !semester) semester = semMatch[1].trim();
            }
            return { regNo, rollNo, session, semester };
          }
        } catch(e){}
      }
      i = end !== -1 ? end + 9 : start;
    }
  } catch(e) {
    return { regNo, error: e.message };
  }
  return { regNo, error: 'Not found in PDF' };
}

async function run() {
  const testIds = ['121/108', '120/011', '121/214', '125/017'];
  for (const id of testIds) {
    const res = await extractPdfData(id);
    console.log(JSON.stringify(res));
  }
}

run();
