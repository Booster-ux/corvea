const whopService = require('../services/whopService');

/**
 * Endpoint: POST /api/create-checkout
 * Captures cart data and customer email from the client, map products,
 * generates a Whop checkout configurations URL, and returns it.
 */
async function handleCreateCheckout(req, res) {
    const { cart, customer_email } = req.body;

    if (!cart) {
        return res.status(400).json({ error: 'Cart payload is required.' });
    }

    if (!cart.items || !Array.isArray(cart.items) || cart.items.length === 0) {
        return res.status(400).json({ error: 'Cart must contain at least one item.' });
    }

    try {
        const result = await whopService.createCheckout(cart, customer_email);
        console.log(`Generated Whop Checkout: ${result.purchase_url} for cart`);
        return res.status(200).json(result);
    } catch (error) {
        console.error('Checkout creation controller error:', error);
        return res.status(500).json({ error: error.message || 'Failed to create checkout configuration session.' });
    }
}

module.exports = {
    handleCreateCheckout
};
