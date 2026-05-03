// netlify/functions/stripe-webhook.js
// Listens for Stripe payment events and updates the user's plan
// in Supabase when they subscribe, upgrade, or cancel.
//
// Required environment variables (set in Netlify dashboard):
//   STRIPE_SECRET_KEY       — your Stripe secret key (sk_live_...)
//   STRIPE_WEBHOOK_SECRET   — your webhook signing secret (whsec_...)
//   SUPABASE_URL            — your Supabase project URL
//   SUPABASE_SERVICE_KEY    — your Supabase service_role key

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service key bypasses RLS for admin operations
);

// Map your Stripe Price IDs to plan names
// Replace these with the actual Price IDs from your Stripe dashboard
// (Products → your product → Pricing → copy the price ID like price_1ABC...)
const PRICE_TO_PLAN = {
  'price_REPLACE_WITH_PRO_PRICE_ID':   'pro',
  'price_REPLACE_WITH_ELITE_PRICE_ID': 'elite'
};

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Verify the webhook signature to make sure it's really from Stripe
  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: 'Webhook signature verification failed' };
  }

  console.log('Stripe event received:', stripeEvent.type);

  try {
    switch (stripeEvent.type) {

      // ── Payment succeeded / subscription started ──
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        const customerId = session.customer;
        const subscriptionId = session.subscription;
        const customerEmail = session.customer_details?.email;

        // Get the subscription to find out which price/plan they chose
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription.items.data[0]?.price?.id;
        const plan = PRICE_TO_PLAN[priceId] || 'pro';

        console.log('New subscription:', customerEmail, '→', plan);

        // Update the user's plan in Supabase by email
        const { error } = await supabase
          .from('profiles')
          .update({
            plan: plan,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId
          })
          .eq('id', (
            await supabase
              .from('profiles')
              .select('id')
              .eq('stripe_customer_id', customerId)
              .single()
          ).data?.id || await getUserIdByEmail(customerEmail));

        if (error) console.error('Supabase update error:', error);
        break;
      }

      // ── Subscription upgraded or changed ──
      case 'customer.subscription.updated': {
        const subscription = stripeEvent.data.object;
        const customerId = subscription.customer;
        const priceId = subscription.items.data[0]?.price?.id;
        const plan = PRICE_TO_PLAN[priceId] || 'pro';

        // Only update if active
        if (subscription.status === 'active') {
          const { error } = await supabase
            .from('profiles')
            .update({ plan: plan, stripe_subscription_id: subscription.id })
            .eq('stripe_customer_id', customerId);

          if (error) console.error('Supabase update error:', error);
          console.log('Subscription updated for customer', customerId, '→', plan);
        }
        break;
      }

      // ── Subscription cancelled ──
      case 'customer.subscription.deleted': {
        const subscription = stripeEvent.data.object;
        const customerId = subscription.customer;

        // Downgrade to basic when subscription ends
        const { error } = await supabase
          .from('profiles')
          .update({ plan: 'basic', stripe_subscription_id: null })
          .eq('stripe_customer_id', customerId);

        if (error) console.error('Supabase update error:', error);
        console.log('Subscription cancelled for customer', customerId, '— downgraded to basic');
        break;
      }

      default:
        console.log('Unhandled event type:', stripeEvent.type);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };

  } catch (err) {
    console.error('Webhook handler error:', err);
    return { statusCode: 500, body: 'Webhook handler error: ' + err.message };
  }
};

// Helper: look up a Supabase user ID by email (for new customers)
async function getUserIdByEmail(email) {
  if (!email) return null;
  try {
    const { data, error } = await supabase.auth.admin.listUsers();
    if (error || !data) return null;
    const user = data.users.find(function(u) { return u.email === email; });
    return user ? user.id : null;
  } catch (e) {
    console.error('getUserIdByEmail error:', e);
    return null;
  }
}
