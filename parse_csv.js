const fs = require('fs');
const readline = require('readline');

async function parseCsv() {
    const fileStream = fs.createReadStream('C:\\Users\\USER\\Downloads\\products_export_1.csv');
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let headers = [];
    let isFirst = true;
    let mappings = [];

    for await (const line of rl) {
        const columns = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                columns.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        columns.push(current);

        if (isFirst) {
            headers = columns;
            isFirst = false;
            continue;
        }

        const handle = columns[0] || '';
        const title = columns[1] || '';
        const price = columns[23] || '';
        const whopLink = columns[38] || '';

        if (handle && whopLink.trim() && whopLink.startsWith('http')) {
            mappings.push({ handle, title, price, whopLink });
        }
    }

    console.log(JSON.stringify(mappings, null, 2));
}

parseCsv().catch(console.error);
