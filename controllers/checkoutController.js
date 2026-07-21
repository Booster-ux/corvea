const whopService = require('../services/whopService');
const redisService = require('../services/redisService');

// In-memory rate limiting map for the public summary endpoint
const ipRequests = new Map();

/**
 * Endpoint: POST /api/create-checkout
 * Captures cart data and customer email from the client, map products,
 * generates a Whop checkout configurations URL, and returns it.
 */
async function handleCreateCheckout(req, res) {
    const { cart, customer_email } = req.body;

    if (!cart) {
        return res.status(400).json({ success: false, error: 'Cart payload is required.' });
    }

    if (!cart.items || !Array.isArray(cart.items) || cart.items.length === 0) {
        return res.status(400).json({ success: false, error: 'Cart must contain at least one item.' });
    }

    try {
        const result = await whopService.createCheckout(cart, customer_email);
        const checkoutReference = result.checkout_reference;
        const generatedCheckoutUrl = `https://checkout.corvea.store/?checkout_reference=${checkoutReference}`;

        // Temporary server logs
        console.log(`[TEMP LOG] checkout reference created: ${checkoutReference}`);
        console.log(`[TEMP LOG] final checkout URL: ${generatedCheckoutUrl}`);
        console.log(`[TEMP LOG] response sent: ${JSON.stringify({ success: true, checkout_url: generatedCheckoutUrl })}`);

        return res.status(200).json({
            success: true,
            checkout_url: generatedCheckoutUrl
        });
    } catch (error) {
        console.error('Checkout creation controller error:', error);
        return res.status(500).json({ success: false, error: error.message || 'Failed to create checkout configuration session.' });
    }
}

/**
 * Endpoint: GET /api/checkout-summary/:checkout_reference
 * Retrieves the stored Redis cart and returns only sanitized display data.
 */
async function handleCheckoutSummary(req, res) {
    res.setHeader('Content-Type', 'application/json');

    const { checkout_reference } = req.params;

    // Validate checkout_reference format to prevent arbitrary Redis-key access
    const referenceRegex = /^ref_[a-f0-9]{32}$/;
    if (!checkout_reference || !referenceRegex.test(checkout_reference)) {
        return res.status(400).json({ success: false, error: 'Invalid checkout reference format.' });
    }

    // Direct simple rate limiting per client IP
    const ip = req.headers['x-forwarding-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute
    const maxRequests = 60; // 60 requests per minute

    let userRequests = ipRequests.get(ip) || [];
    userRequests = userRequests.filter(timestamp => now - timestamp < windowMs);
    if (userRequests.length >= maxRequests) {
        return res.status(429).json({ success: false, error: 'Too many requests. Please try again later.' });
    }
    userRequests.push(now);
    ipRequests.set(ip, userRequests);

    try {
        const redisKey = `checkout:${checkout_reference}`;
        const storedCart = await redisService.get(redisKey);

        if (!storedCart) {
            return res.status(404).json({ success: false, error: 'Checkout session has expired or does not exist.' });
        }

        // Return only sanitized display data
        const items = (storedCart.items || []).map(item => ({
            product_title: item.product_title || item.title || '',
            variant_title: item.variant_title || '',
            quantity: parseInt(item.quantity, 10),
            final_unit_price: parseFloat((item.price_cents / 100).toFixed(2)),
            final_line_price: parseFloat((item.final_line_price / 100).toFixed(2)),
            discount_amount: parseFloat((item.discount_amount / 100).toFixed(2)),
            free_gift: !!item.free_gift
        }));

        const isMembershipSelected = !!storedCart.membership_selected;

        return res.status(200).json({
            items,
            currency: storedCart.currency || 'aud',
            total: parseFloat(storedCart.expected_total),
            membership_trial_status: isMembershipSelected,
            membership_renewal_price: isMembershipSelected ? 39.99 : 0.00,
            item_count: parseInt(storedCart.item_count, 10),
            session_id: storedCart.session_id,
            plan_id: storedCart.plan_id
        });
    } catch (error) {
        console.error('Checkout summary controller error:', error);
        return res.status(500).json({ success: false, error: 'Failed to retrieve checkout summary.' });
    }
}

module.exports = {
    handleCreateCheckout,
    handleCheckoutSummary
};
