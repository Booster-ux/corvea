const axios = require('axios');
const crypto = require('crypto');
const redisService = require('./services/redisService');

// Track created orders to simulate duplicate check (idempotency) dynamically
const createdOrders = [];

// 1. Mock network layer globally before importing our app
const originalPost = axios.post;
const originalGet = axios.get;

const MOCK_WEBHOOK_SECRET = 'whsec_YTM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Njc4OTA='; // base64 compatible mock key

// Inject mock behaviors for third party calls
axios.get = async function (url, config) {
    if (url.includes('/companies')) {
        console.log('   [Mock API] GET /companies -> Returning mock company list');
        return { data: { data: [{ id: 'biz_test_12345' }] } };
    }
    if (url.includes('/orders.json')) {
        console.log(`   [Mock API] GET /orders.json -> Returning ${createdOrders.length} mocked orders`);
        return { data: { orders: createdOrders } };
    }
    return originalGet.apply(this, arguments);
};

axios.post = async function (url, data, config) {
    if (url.includes('/oauth/access_token')) {
        console.log('   [Mock API] POST /oauth/access_token -> Returning mock access token');
        return {
            data: {
                access_token: 'shpat_mock_access_token_123456',
                expires_in: 86400
            }
        };
    }
    if (url.includes('/checkout_configurations')) {
        // Return purchase URL containing the plan ID or created inline session
        const planId = data.plan?.product_id ? 'plan_XA564i63pBo41' : 'plan_Pj1GzRRMdZzJ9';
        const session = 'ch_JddUmJt2Ep8sqc5';
        return {
            data: {
                id: session,
                purchase_url: `https://whop.com/checkout/${planId}/?session=${session}`
            }
        };
    }
    if (url.includes('/orders.json')) {
        console.log('   [Mock API] POST /orders.json -> Shopify Order creation success!');
        const newOrder = {
            id: 888877770000 + createdOrders.length,
            email: data.order.email,
            total_price: data.order.transactions[0].amount,
            note_attributes: data.order.note_attributes || []
        };
        createdOrders.push(newOrder);
        return {
            data: {
                order: newOrder
            }
        };
    }
    return originalPost.apply(this, arguments);
};

// Override env variables for test run
process.env.WHOP_API_KEY = 'apik_test_apikey';
process.env.WHOP_WEBHOOK_SECRET = MOCK_WEBHOOK_SECRET;
process.env.SHOPIFY_STORE = 'test-corvea.myshopify.com';
process.env.SHOPIFY_CLIENT_ID = 'test_client_id_4455';
process.env.SHOPIFY_CLIENT_SECRET = 'test_client_secret_6677';
process.env.SHOPIFY_ADMIN_API_TOKEN = 'shpat_test_token';

// Import our server app
const app = require('./api/index');
const PORT = 3535;

let server;

// Helper to sign webhook requests matching Whop Standard Header signature compliance
function signWebhook(payloadStr, transactionId = 'pay_tx_999') {
    const webhookId = `msg_wh_${crypto.randomBytes(8).toString('hex')}`;
    const webhookTimestamp = Math.floor(Date.now() / 1000).toString();
    const signedContent = `${webhookId}.${webhookTimestamp}.${payloadStr}`;
    const keyBuffer = Buffer.from(MOCK_WEBHOOK_SECRET.substring(6), 'base64');
    const signature = crypto.createHmac('sha256', keyBuffer).update(signedContent).digest('base64');

    return {
        'Content-Type': 'application/json',
        'webhook-id': webhookId,
        'webhook-timestamp': webhookTimestamp,
        'webhook-signature': `v1,${signature}`
    };
}

async function runTests() {
    server = app.listen(PORT, async () => {
        console.log(`\n======================================================`);
        console.log(`Starting Integration Test Suite on http://localhost:${PORT}`);
        console.log(`======================================================\n`);

        try {
            // Test 1: Health Check (with Redis backend ping)
            console.log('Test 1: Verifying Health Check API (with Redis)...');
            const healthRes = await axios.get(`http://localhost:${PORT}/api/health`);
            if (healthRes.status === 200 && healthRes.data.status === 'healthy') {
                console.log(`✅ Health Check Verified: OK. Redis status: ${healthRes.data.redis}`);
            } else {
                throw new Error('Health check API failed.');
            }

            // Test 2: Generate unique checkouts representing different Shopify cart sizes / rules
            console.log('\nTest 2: Generating Checkout configurations under different scenarios...');

            const testCarts = [
                {
                    name: 'membership only',
                    cart: {
                        token: 'cart_sub_100',
                        items: [
                            {
                                id: '430099558839',
                                handle: 'corvea-beauty-journal',
                                title: 'Corvea Beauty Journal - Membership',
                                price: 3999, // 39.99/mo (but A$0 upfront today due to 30 days trial)
                                quantity: 1
                            }
                        ]
                    },
                    email: 'buyer-sub@example.com',
                    expectedUpfront: 0.00
                },
                {
                    name: 'one physical product',
                    cart: {
                        token: 'cart_phys_200',
                        items: [
                            {
                                id: '430099558832',
                                handle: 'skintific-5x-ceramide-soothing-toner',
                                title: '5X Ceramide Soothing Toner',
                                price: 1499,
                                quantity: 1
                            }
                        ]
                    },
                    email: 'buyer-toner@example.com',
                    expectedUpfront: 14.99
                },
                {
                    name: 'large discounted cart above A$250',
                    cart: {
                        token: 'cart_large_300',
                        total_price: 30768, // cents (307.68)
                        items_subtotal_price: 30768,
                        total_discount: 24620,
                        items: [
                            {
                                id: '430099558855',
                                handle: 'expensive-skincare-bundle',
                                title: 'Premium Skincare Bundle Stack',
                                price: 55388,
                                final_price: 30768, // After bundle discount
                                quantity: 1
                            }
                        ]
                    },
                    email: 'buyer-large@example.com',
                    expectedUpfront: 307.68
                },
                {
                    name: 'multiple quantities, bundles, and zero-priced free gift',
                    cart: {
                        token: 'cart_gift_400',
                        items: [
                            {
                                id: '430099558832',
                                handle: 'skintific-5x-ceramide-soothing-toner',
                                title: '5X Ceramide Soothing Toner',
                                price: 1499,
                                quantity: 3
                            },
                            {
                                id: '430099559900',
                                handle: 'free-gift-face-cream',
                                title: 'Calm Active Free Cream Gift',
                                price: 999,
                                final_price: 0, // Free product gift!
                                quantity: 1
                            }
                        ]
                    },
                    email: 'buyer-gift@example.com',
                    expectedUpfront: 44.97 // 14.99 * 3 = 44.97
                },
                {
                    name: 'mixed cart (physical products + membership)',
                    cart: {
                        token: 'cart_mixed_500',
                        items: [
                            {
                                id: '430099558832',
                                handle: 'skintific-5x-ceramide-soothing-toner',
                                title: '5X Ceramide Soothing Toner',
                                price: 1499,
                                quantity: 2
                            },
                            {
                                id: '430099558839',
                                handle: 'corvea-beauty-journal',
                                title: 'Corvea Beauty Journal - Membership',
                                price: 3999,
                                quantity: 1
                            }
                        ]
                    },
                    email: 'buyer-mixed@example.com',
                    expectedUpfront: 29.98
                }
            ];

            const activeCheckouts = [];

            for (const item of testCarts) {
                const res = await axios.post(`http://localhost:${PORT}/api/create-checkout`, {
                    cart: item.cart,
                    customer_email: item.email
                });

                if (res.status === 200 && res.data.checkout_url) {
                    // Extract session/checkout ID configuration
                    const urlParsed = new URL(res.data.checkout_url);
                    const checkoutRef = urlParsed.searchParams.get('checkout_reference');

                    console.log(`   ✅ "${item.name}" scenario success. Upfront price: A$${item.expectedUpfront}. Linked reference: ${checkoutRef}`);

                    activeCheckouts.push({
                        name: item.name,
                        cart: item.cart,
                        checkout_reference: checkoutRef,
                        expected_total: item.expectedUpfront,
                        email: item.email,
                        checkout_id: 'ch_test_default'
                    });
                } else {
                    throw new Error(`Checkout config failed for scenario: ${item.name}`);
                }
            }

            // Test 2.5: Verify checkout summary API endpoint outputs clean, formatted, and sanitized items
            console.log('\nTest 2.5: Verifying GET /api/checkout-summary/:checkout_reference for sanitized display properties...');
            for (const ch of activeCheckouts) {
                const summaryRes = await axios.get(`http://localhost:${PORT}/api/checkout-summary/${ch.checkout_reference}`);
                if (summaryRes.status !== 200) {
                    throw new Error(`Failed to load summary for ${ch.name}`);
                }
                const summary = summaryRes.data;
                console.log(`   Summary sanitization for "${ch.name}": currency=${summary.currency}, total=${summary.total}, items_count=${summary.items.length}, trial_status=${summary.membership_trial_status}`);

                // Key assertions
                if (!summary.items || !Array.isArray(summary.items)) throw new Error('Summary items missing or not array.');
                if (summary.total !== ch.expected_total) throw new Error(`Summary total (${summary.total}) does not match expected (${ch.expected_total})`);
                if (summary.currency !== 'aud') throw new Error('Incorrect currency returned.');
                if (ch.name.includes('membership') && !summary.membership_trial_status) throw new Error('Membership trial status not set appropriately.');

                // Expose no credentials assertion
                const keys = Object.keys(summary);
                if (keys.includes('cart_token') || keys.includes('apiKey') || keys.includes('webhookSecret')) {
                    throw new Error('Credential leakage detected in checkout summary endpoint response.');
                }
            }
            console.log('   ✅ All summary responses verified secure.');

            // Test 3: Process the simulated webhooks based on the created checkouts
            console.log('\nTest 3: Testing webhook handlers and verification logic...');

            for (const ch of activeCheckouts) {
                const webhookPayload = JSON.stringify({
                    action: 'payment.succeeded',
                    data: {
                        id: `pay_${ch.checkout_reference}`,
                        amount: ch.expected_total, // matching expected dollar totals
                        currency: 'aud',
                        email: ch.email,
                        customer: {
                            username: 'Jane Buyer',
                            email: ch.email
                        },
                        metadata: {
                            checkout_reference: ch.checkout_reference,
                            shopify_cart_token: ch.cart.token,
                            expected_total: String(ch.expected_total),
                            currency: 'aud',
                            membership_selected: ch.name.includes('membership') ? 'true' : 'false',
                            item_count: String(ch.cart.items.length)
                        }
                    }
                });

                console.log(`   Simulating payment.succeeded webhook for "${ch.name}" (total: A$${ch.expected_total})...`);
                const headers = signWebhook(webhookPayload);
                const webhookRes = await axios.post(`http://localhost:${PORT}/api/whop-webhook`, webhookPayload, { headers });

                if (webhookRes.status === 201 && webhookRes.data.shopify_order_id) {
                    console.log(`   ✅ Webhook processed. Shopify Order ID Created: ${webhookRes.data.shopify_order_id}`);

                    // Verify Redis key was deleted on success
                    const deletedVal = await redisService.get(`checkout:${ch.checkout_reference}`);
                    if (deletedVal === null) {
                        console.log(`   ✅ Redis key checkout:${ch.checkout_reference} successfully deleted!`);
                    } else {
                        throw new Error(`Redis key checkout:${ch.checkout_reference} was NOT deleted after successful order creation.`);
                    }
                } else {
                    throw new Error(`Webhook payment simulation failed for scenario: ${ch.name}`);
                }
            }

            // Test 4: Idempotency protection check (duplicate webhook delivery)
            console.log('\nTest 4: Verifying duplicate webhook delivery (idempotency)...');
            const targetCh = activeCheckouts[0];
            const duplicatePayload = JSON.stringify({
                action: 'payment.succeeded',
                data: {
                    id: `pay_${targetCh.checkout_reference}`, // Duplicate transaction ID
                    amount: targetCh.expected_total,
                    currency: 'aud',
                    email: targetCh.email,
                    metadata: {
                        checkout_reference: targetCh.checkout_reference,
                        shopify_cart_token: targetCh.cart.token,
                        expected_total: String(targetCh.expected_total),
                        currency: 'aud',
                        membership_selected: 'true',
                        item_count: '1'
                    }
                }
            });

            const dupHeaders = signWebhook(duplicatePayload);
            const dupRes = await axios.post(`http://localhost:${PORT}/api/whop-webhook`, duplicatePayload, { headers: dupHeaders });

            if (dupRes.status === 200 && dupRes.data.message === 'Order already processed.') {
                console.log('✅ Duplicate webhooks correctly blocked without duplicating order!');
            } else {
                throw new Error('Failed to block duplicate webhook trigger.');
            }

            // Test 5: Verify missing or expired checkout reference rejection
            console.log('\nTest 5: Verifying missing/expired checkout reference rejection...');
            const invalidPayload = JSON.stringify({
                action: 'payment.succeeded',
                data: {
                    id: `pay_invalid_12345`,
                    amount: 29.98,
                    currency: 'aud',
                    email: 'buyer@example.com',
                    metadata: {
                        checkout_reference: 'ref_expired_or_non_existent',
                        shopify_cart_token: 'cart_expired',
                        expected_total: '29.98',
                        currency: 'aud',
                        membership_selected: 'false',
                        item_count: '1'
                    }
                }
            });

            const invalidHeaders = signWebhook(invalidPayload);
            try {
                await axios.post(`http://localhost:${PORT}/api/whop-webhook`, invalidPayload, { headers: invalidHeaders });
                throw new Error('Webhook processed an invalid checkout reference which should have failed.');
            } catch (err) {
                if (err.response && err.response.status === 400 && err.response.data.error === 'Missing or expired checkout reference.') {
                    console.log('✅ Expired/missing checkout reference correctly rejected with controlled HTTP 400!');
                } else {
                    throw err;
                }
            }

            console.log(`\n======================================================`);
            console.log('🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉');
            console.log(`======================================================\n`);
            shutdown(0);

        } catch (error) {
            console.error('\n❌ INTEGRATION TEST FAILED:', error.message);
            if (error.response) {
                console.error('Response status:', error.response.status);
                console.error('Response data:', error.response.data);
            }
            shutdown(1);
        }
    });
}

function shutdown(code) {
    if (server) {
        server.close(() => {
            console.log('Test Server stopped.');
            process.exit(code);
        });
    } else {
        process.exit(code);
    }
}

runTests().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
