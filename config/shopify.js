const dotenv = require('dotenv');
dotenv.config();

module.exports = {
    store: process.env.SHOPIFY_STORE || 'corvea.myshopify.com',
    adminApiToken: process.env.SHOPIFY_ADMIN_API_TOKEN,
    apiVersion: process.env.SHOPIFY_API_VERSION || '2026-07',
    get baseUrl() {
        // Standardize URL formatting
        const storeDomain = this.store.replace(/^https?:\/\//, '').replace(/\/$/, '');
        return `https://${storeDomain}/admin/api/${this.apiVersion}`;
    }
};
