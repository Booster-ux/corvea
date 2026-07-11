const shopifyService = require('../services/shopifyService');
const redisService = require('../services/redisService');

/**
 * Endpoint: POST /api/whop-webhook
 * Responds to Whop payment.succeeded and membership.activated events.
 * Keyed by checkout_reference or cart token fallback.
 * Reconstructs Shopify orders from customer cart metadata.
 */
async function handleWebhook(req, res) {
    const event = req.body;
    const eventAction = event.action || event.type;
    const eventData = event.data;

    console.log(`[Webhook Receiver] Received event from Whop: ${eventAction}`);

    // Interested in payments or membership activations (e.g. trial activations)
    if (eventAction !== 'payment.succeeded' && eventAction !== 'membership.activated') {
        return res.status(200).json({ message: `Ignored unhandled event: ${eventAction}` });
    }

    if (!eventData) {
        return res.status(400).json({ error: 'Missing webhook data payload.' });
    }

    const transactionId = eventData.id;
    const metadata = eventData.metadata || {};

    if (!transactionId) {
        return res.status(400).json({ error: 'Missing transaction or resource ID.' });
    }

    try {
        // 1. Idempotency Check first: check if order already exists for this Whop Payment/Membership ID
        const exists = await shopifyService.orderExistsForTransaction(transactionId);
        if (exists) {
            console.log(`[Webhook Receiver] Order already exists for transaction: ${transactionId}. Skipping duplicate creation.`);
            // Clean up Redis key just in case it wasn't deleted
            if (metadata.checkout_reference) {
                await redisService.del(`checkout:${metadata.checkout_reference}`);
            }
            return res.status(200).json({ message: 'Order already processed.' });
        }

        let lineItems = [];
        let expectedTotal = 0.00;
        let expectedCurrency = 'aud';
        let redisKey = null;

        // 2. Resolve cart information from Redis database (if checkout_reference is provided)
        if (metadata.checkout_reference) {
            redisKey = `checkout:${metadata.checkout_reference}`;
            console.log(`[Webhook Receiver] Fetching cart details from Redis: ${redisKey}`);

            const storedCart = await redisService.get(redisKey);
            if (!storedCart) {
                console.error(`[Webhook Error] Redis record missing or expired for checkout_reference: ${metadata.checkout_reference}, Payment ID: ${transactionId}`);
                return res.status(400).json({ error: 'Missing or expired checkout reference.' });
            }

            lineItems = storedCart.items || [];
            expectedTotal = parseFloat(storedCart.expected_total);
            expectedCurrency = storedCart.currency || 'aud';
        }
        // Fallback: read directly from metadata if cart_items_json exists (backwards compatibility/test cases)
        else if (metadata.cart_items_json) {
            console.log(`[Webhook Receiver] Falling back to metadata cart_items_json payload mapping.`);
            try {
                lineItems = JSON.parse(metadata.cart_items_json);
                expectedCurrency = metadata.currency || 'aud';
                expectedTotal = parseFloat(metadata.expected_total || '0.00');
            } catch (err) {
                console.error('[Webhook Error] Failed to parse cart_items_json fallback:', err.message);
                return res.status(400).json({ error: 'Invalid cart_items_json format.' });
            }
        }
        // No configuration mapped
        else {
            console.log(`[Webhook Receiver] Skipping sync: Metadata contains neither checkout_reference nor cart_items_json. TX: ${transactionId}`);
            return res.status(200).json({ message: 'No Shopify cart metadata found in checkout. Skipping order creation.' });
        }

        // 3. Resolve customer details
        const email = metadata.customer_email || eventData.email || eventData.customer?.email || 'no-email@whop.com';
        const customerName = eventData.customer?.username || eventData.customer?.email || 'Whop Customer';

        // 4. Calculate total paid
        // If it's a membership activation event (with no initial amount field or A$0 initial price), total paid is 0 or what was paid for one-time items
        let totalPaid = 0.00;
        if (eventData.amount !== undefined && eventData.amount !== null) {
            const rawAmt = parseFloat(eventData.amount);
            if (Number.isInteger(rawAmt) && rawAmt > 1000) {
                totalPaid = rawAmt / 100;
            } else {
                totalPaid = rawAmt;
            }
        } else {
            // Calculate from one-time items from configuration
            const oneTimeCentsTotal = lineItems
                .filter(item => !item.is_membership)
                .reduce((sum, item) => sum + (item.price_cents * item.quantity), 0);
            totalPaid = parseFloat((oneTimeCentsTotal / 100).toFixed(2));
        }

        // 5. Verification Validation
        const webhookCurrency = (eventData.currency || eventData.plan?.currency || 'aud').toLowerCase();
        if (webhookCurrency !== expectedCurrency.toLowerCase()) {
            console.error(`[Webhook Error] Currency mismatch. Expected: ${expectedCurrency}, Received: ${webhookCurrency}. TX: ${transactionId}`);
            return res.status(400).json({ error: 'Currency mismatch.' });
        }

        // Allow up to A$0.02 float rounding tolerance
        if (Math.abs(totalPaid - expectedTotal) > 0.02) {
            console.error(`[Webhook Error] Payment amount mismatch. Expected: A$${expectedTotal}, Paid: A$${totalPaid}. TX: ${transactionId}`);
            return res.status(400).json({ error: 'Paid amount mismatch.' });
        }

        console.log(`[Webhook Receiver] Re-creating Shopify order for customer ${email}. Items count: ${lineItems.length}. Total paid: A$${totalPaid}`);

        // 6. Create paid order in Shopify (this automatically decrements inventory and handles free gifts/discounts)
        const shopifyOrder = await shopifyService.createPaidOrder({
            email,
            items: lineItems,
            totalAmountPaid: totalPaid,
            gatewayTransactionId: transactionId,
            customerName
        });

        // 7. Delete the Redis record only after successful Shopify order creation
        if (redisKey) {
            await redisService.del(redisKey);
            console.log(`[Webhook Receiver] Successfully deleted Redis key: ${redisKey}`);
        }

        return res.status(201).json({
            message: 'Shopify order created successfully.',
            shopify_order_id: shopifyOrder.id
        });
    } catch (error) {
        console.error(`[Webhook Receiver Error] Failed to process Whop Webhook (${transactionId}):`, error.message);
        // Note: We DO NOT delete the Redis key here, keeping the record available for retry/retry actions.
        return res.status(error.status || 500).json({ error: error.message || 'Failed to process webhook event.' });
    }
}

module.exports = {
    handleWebhook
};
