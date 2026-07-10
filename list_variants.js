const fs = require('fs');
const readline = require('readline');

async function listVariants() {
    const fileStream = fs.createReadStream('C:\\Users\\USER\\Downloads\\products_export_1.csv');
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let headers = [];
    let isFirst = true;
    let rows = [];

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
        const option1Name = columns[8] || '';
        const option1Val = columns[9] || '';
        const sku = columns[17] || '';
        const price = columns[23] || '';
        const status = columns[75] || '';
        const whopLink = columns[38] || '';

        rows.push({ handle, title, option1Name, option1Val, sku, price, status, whopLink });
    }

    // Group by handle
    const groups = {};
    for (const r of rows) {
        if (!groups[r.handle]) {
            groups[r.handle] = {
                handle: r.handle,
                title: r.title,
                status: r.status,
                variants: []
            };
        }
        if (r.sku || r.option1Val || r.price) {
            groups[r.handle].variants.push({
                optionValue: r.option1Val,
                sku: r.sku,
                price: r.price,
                whopLink: r.whopLink
            });
        }
    }

    const activeGroups = Object.values(groups).filter(g => g.status === 'active' || g.status === 'draft');
    console.log(JSON.stringify(activeGroups, null, 2));
}

listVariants().catch(console.error);
