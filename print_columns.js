const fs = require('fs');

const data = fs.readFileSync('C:\\Users\\USER\\Downloads\\products_export_1.csv', 'utf8');
const firstLine = data.split('\n')[0];

const columns = [];
let current = '';
let inQuotes = false;
for (let i = 0; i < firstLine.length; i++) {
    const char = firstLine[i];
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

columns.forEach((col, idx) => {
    console.log(`${idx}: ${col}`);
});
