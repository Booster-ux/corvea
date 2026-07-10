const fs = require('fs');
const readline = require('readline');

async function listActiveProducts() {
    const fileStream = fs.createReadStream('C:\\Users\\USER\\Downloads\\products_export_1.csv');
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let headers = [];
    let isFirst = true;
    let products = [];

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
        const status = columns[75] || '';
        const whopLink = columns[38] || '';

        if (handle && (title || price)) {
            products.push({ handle, title, price, status, whopLink });
        }
    }

    // Filter to unique ones since split rows represent variants or extra images
    const uniqueProducts = {};
    for (const p of products) {
        if (!uniqueProducts[p.handle]) {
            uniqueProducts[p.handle] = p;
        } else {
            // Merge values if any were missing
            if (!uniqueProducts[p.handle].title && p.title) uniqueProducts[p.handle].title = p.title;
            if (!uniqueProducts[p.handle].price && p.price) uniqueProducts[p.handle].price = p.price;
            if (!uniqueProducts[p.handle].status && p.status) uniqueProducts[p.handle].status = p.status;
            if (!uniqueProducts[p.handle].whopLink && p.whopLink) uniqueProducts[p.handle].whopLink = p.whopLink;
        }
    }

    const result = Object.values(uniqueProducts).filter(p => p.status === 'active' || p.status === 'draft');
    console.log(JSON.stringify(result, null, 2));
}

listActiveProducts().catch(console.error);
