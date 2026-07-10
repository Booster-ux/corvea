const fs = require('fs');
const readline = require('readline');

async function searchCsv() {
    const fileStream = fs.createReadStream('C:\\Users\\USER\\Downloads\\products_export_1.csv');
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let lineNum = 0;
    for await (const line of rl) {
        lineNum++;
        if (line.includes('whop.com')) {
            console.log(`Line ${lineNum}: ${line.substring(0, 150)}...`);
        }
    }
}

searchCsv().catch(console.error);
