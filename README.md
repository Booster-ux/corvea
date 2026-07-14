# Shopify-Whop Checkout Integration

This middleware allows you to replace or bypass the default Shopify checkout. Customers will check out through Whop while Shopify remains the storefront, product source, cart source, and inventory/order system.

## Setup Requirements

### 1. Environment Variables (`.env`)
Create a `.env` file in the root of your project (or set these inside your Vercel Dashboard env configuration):

```env
# Whop API Config
WHOP_API_KEY=apik_your_whop_key # Provided in Whop Developer Settings
WHOP_WEBHOOK_SECRET=whsec_your_webhook_secret # Provided when setting up webhook in Whop
WHOP_COMPANY_ID=your_whop_company_id # Optional: bypasses dynamic company listing lookup

# Shopify Admin API Config
SHOPIFY_STORE=corvea.myshopify.com # Your .myshopify.com domain
SHOPIFY_CLIENT_ID=your_shopify_client_id # Shopify App Client ID from dev dashboard
SHOPIFY_CLIENT_SECRET=your_shopify_client_secret # Shopify App Client Secret from dev dashboard
SHOPIFY_ADMIN_API_TOKEN=shpat_your_legacy_admin_token # Optional fallback: legacy direct token
SHOPIFY_API_VERSION=2026-07

# Membership Configuration Details
MEMBERSHIP_PRODUCT_ID=corvea-beauty-journal # Shopify product handle for the membership subscription
MEMBERSHIP_CHECKOUT_LINK=https://whop.com/checkout/plan_TZycBpe6PAHCk # Default Whop checkout link for membership

# Upstash Redis Persistence (Required for complex cart synchronization)
UPSTASH_REDIS_REST_URL=https://your-database-name.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_rest_token
```

---

## Technical Architecture & Cart Strategy
Whop is natively designed for single-product digital checkout configurations (one plan per session) and rejects metadata values that exceed a 500-character ceiling. To support complex carts with digital subscriptions, discount rules, and physical items, we implement the following flow:

1. When a checkout is initiated, the frontend sends the cart object `/cart.js` contents to `/api/create-checkout`.
2. The server processes the cart items, calculating upfront costs and identifying if the **Corvea Beauty Journal Membership** is in the cart.
3. **Cart Serialization & Storage:** Instead of dispatching the complete product schema directly in Whop metadata (which would crash due to the 500-char value limit), the server generates a unique `checkout_reference` (e.g. `ref_b12a8f...`) and registers the complete Shopify cart on **Upstash Redis** under the key **`checkout:{checkout_reference}`** with a **24-hour Time-to-Live (TTL)**.
4. **Lightweight Whop Metadata:** Only compact references are passed inside the Whop checkout configuration payload, ensuring all values remain under 150 characters:
   - `checkout_reference`
   - `shopify_cart_token`
   - `expected_total`
   - `currency`
   - `membership_selected`
   - `item_count`
5. When Whop receives payment and fires a `payment.succeeded` or `membership.activated` webhook:
   - The Whop signature is validated (HMAC-SHA256).
   - An **Idempotency Check** is performed first against Shopify Order records using the transaction ID.
   - The stored cart matches are queried from Redis using `checkout_reference`.
   - Total payment amount and currency matches are confirmed against expected value metadata.
   - The paid Shopify order is created via the Admin REST API.
   - **Cleanup:** On success, the Redis key is deleted. If creation fails, the record is preserved to support retry attempts.

---

## 2. Vercel Deployment Steps

1. Install the Vercel CLI:
   ```bash
   npm install -g vercel
   ```
2. Run log in and deploy:
   ```bash
   vercel login
   vercel
   ```
3. Set your production environment secrets on Vercel:
   ```bash
   vercel env add WHOP_API_KEY
   vercel env add WHOP_WEBHOOK_SECRET
   vercel env add WHOP_COMPANY_ID
   vercel env add SHOPIFY_STORE
   vercel env add SHOPIFY_CLIENT_ID
   vercel env add SHOPIFY_CLIENT_SECRET
   vercel env add SHOPIFY_ADMIN_API_TOKEN
   vercel env add SHOPIFY_API_VERSION
   vercel env add MEMBERSHIP_PRODUCT_ID
   vercel env add MEMBERSHIP_CHECKOUT_LINK
   vercel env add UPSTASH_REDIS_REST_URL
   vercel env add UPSTASH_REDIS_REST_TOKEN
   ```
4. Deploy to production:
   ```bash
   vercel --prod
   ```

---

## 3. Whop Webhook Setup Steps

1. In your **Whop Dashboard**, navigate to **Developer Settings** > **Webhooks**.
2. Click **Create Webhook**.
3. Set the endpoint URL to: `https://your-vercel-server-project.vercel.app/api/whop-webhook`.
4. Click select events and listen to:
   - `payment.succeeded`
   - `membership.activated`
5. Copy the generated Webhook Secret (starts with `whsec_...`) and save it to your Vercel/server's `WHOP_WEBHOOK_SECRET` environment variable.

---

## 4. Shopify Theme Integration (Shrine Theme)

To redirect customers from the checkout buttons of your Shopify store to your branded embedded checkout page, install the client-side script in your **Shrine** theme:

1. In your Shopify Admin, go to **Online Store** > **Themes**.
2. Locate your **Shrine** theme, click the three dots (`...`), and select **Edit code**.
3. Locate `layout/theme.liquid` (for global site coverage) or `sections/main-cart.liquid` (specifically for the cart page).
4. Scroll to the bottom of the file (before the closing `</body>` tag) and paste the following snippet:

```html
<!-- Whop Checkout Interceptor Script -->
<script>
(function() {
  // Point to your production Vercel gateway instance API
  const API_ENDPOINT = 'https://corvea.vercel.app/api/create-checkout';

  const CHECKOUT_SELECTORS = [
    'button[name="checkout"]',
    'input[name="checkout"]',
    'a[href="/checkout"]',
    '.cart__checkout-button',
    '.checkout-btn',
    '.checkout-button',
    '.cart-drawer__checkout'
  ];

  let isRedirecting = false;

  function initInterceptor() {
    document.addEventListener('click', function(event) {
      if (isRedirecting) {
        event.preventDefault();
        return;
      }
      const element = event.target.closest(CHECKOUT_SELECTORS.join(','));
      if (element) {
        event.preventDefault();
        event.stopPropagation();
        triggerWhopCheckout(element);
      }
    }, true);

    document.addEventListener('submit', function(event) {
      if (isRedirecting) {
        event.preventDefault();
        return;
      }
      const form = event.target;
      const isCartSubmit = form.action && (form.action.includes('/cart') || form.action.includes('/checkout'));
      if (isCartSubmit) {
        const submitter = event.submitter;
        if (submitter && submitter.name === 'checkout') {
          event.preventDefault();
          triggerWhopCheckout(submitter);
        }
      }
    }, true);
  }

  async function triggerWhopCheckout(buttonElement) {
    isRedirecting = true;
    const originalText = buttonElement.innerText || buttonElement.value || 'Checkout';
    setLoadingState(buttonElement, true, originalText);

    try {
      const cartResponse = await fetch('/cart.js');
      if (!cartResponse.ok) throw new Error('Failed to retrieve cart details.');
      const cart = await cartResponse.json();

      if (!cart.items || cart.items.length === 0) {
        alert('Your cart is empty.');
        setLoadingState(buttonElement, false, originalText);
        isRedirecting = false;
        return;
      }

      let customerEmail = null;
      if (window.Shopify && window.Shopify.customerEmail) {
        customerEmail = window.Shopify.customerEmail;
      }

      cart.host = window.location.host;

      const checkoutResponse = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart: cart, customer_email: customerEmail })
      });

      if (!checkoutResponse.ok) {
        const errPayload = await checkoutResponse.json();
        throw new Error(errPayload.error || 'Failed to construct Whop payment session.');
      }

      const session = await checkoutResponse.json();
      if (session.embedded_checkout_url) {
        // Redirect client to custom subdomain embedded checkout page
        window.location.href = session.embedded_checkout_url;
      } else {
        throw new Error('No embedded_checkout_url returned from API.');
      }
    } catch (error) {
      console.error('[Whop Integration] Error:', error.message || error);
      alert('[Checkout Error] ' + (error.message || 'An unexpected error occurred during secure checkout generation.'));
      isRedirecting = false;
      setLoadingState(buttonElement, false, originalText);
    }
  }

  function setLoadingState(element, isLoading, originalText) {
    if (isLoading) {
      if (element.tagName === 'INPUT') element.value = 'Preparing Secure Checkout...';
      else element.innerText = 'Preparing Secure Checkout...';
      element.style.opacity = '0.69';
      element.style.cursor = 'not-allowed';
    } else {
      if (element.tagName === 'INPUT') element.value = originalText;
      else element.innerText = originalText;
      element.style.opacity = '1';
      element.style.cursor = 'pointer';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initInterceptor);
  } else {
    initInterceptor();
  }
})();
</script>
```

5. Click **Save** in the top right.

---

## 5. Subdomain & Embedded Checkout Setup Requirements (Custom Domain Readiness)

This integration is hosted on:
- Production checkout URL: `https://checkout.corvea.store`

### A. Vercel Custom-Domain Setup
1. In your **Vercel Dashboard**, open your project settings.
2. Navigate to **Domains**.
3. Under **Add Domain**, enter: `checkout.corvea.store`
4. Assign it to redirect or resolve directly (pointing to clean deployments).

### B. DNS configuration
Set up the following record on your DNS Registrar (e.g. GoDaddy, Namecheap, Cloudflare) for the `corvea.store` zone:

| Type | Name | Value | TTL |
| :--- | :--- | :--- | :--- |
| `CNAME` | `checkout` | `cname.vercel-dns.com` | `Automatic` or `3600` |

### C. Whop Dashboard Configuration
To allow client-side payment frame initialization on your custom domain layout:
1. Navigate to **Whop Dashboard** > **Developer settings** > **Payments** or **Developer Playground**.
2. Locate the Whop Embedded Checkout domains registry.
3. Whitelist: `checkout.corvea.store` (this allows the parent window to host the iframe loader dynamically).

### D. Apple Pay Domain Verification (If Applicable)
To support Apple Pay express checkouts inside the embedded iframe:
1. Download the domain association file (under name `apple-developer-merchantid-domain-association`) from the **Whop / Stripe Dashboard Settings**.
2. Place this file inside your project filesystem in the `public/.well-known/` directory:
   `public/.well-known/apple-developer-merchantid-domain-association`
3. Vercel will automatically serve it statically under path:
   `https://checkout.corvea.store/.well-known/apple-developer-merchantid-domain-association`
4. Proceed to click "Verify Domain" inside the Whop checkout/payments portal.

---

## 6. Local Mock Testing

Execute script:
```bash
node test-run.js
```

This runs the integration test suite, demonstrating:
- Multiple checkout scenarios (membership only, physical items, large discounts, zero-priced free gift, bundle items).
- Sanitized Checkout summary serialization: `GET /api/checkout-summary/:checkout_reference` endpoint returning only display fields and checking credentials protection.
- Webhook signature verification and idempotency check.
- Redis database mapping state storage/retrieval.
- Controlled rejection of invalid/expired checkouts.
