const express = require("express");
const app = express();
const {resolve} = require("path");
// Copy the .env.example in the root into a .env file in this folder

const env = require("dotenv").config({path: "./.env"});
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

app.use(express.static(process.env.STATIC_DIR));
app.use(
    express.json({
        // We need the raw body to verify webhook signatures.
        // Let's compute it only when hitting the Stripe webhook endpoint.
        verify: function (req, res, buf) {
            if (req.originalUrl.startsWith("/webhook")) {
                req.rawBody = buf.toString();
            }
        },
    })
);

app.get("/", (req, res) => {
    const path = resolve(process.env.STATIC_DIR + "/index.html");
    res.sendFile(path);
});

// Fetch the Checkout Session to display the JSON result on the success page
app.get("/checkout-session", async (req, res) => {
    const {sessionId} = req.query;
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    res.send(session);
});

app.post("/create-checkout-session", async (req, res) => {
    const domainURL = process.env.DOMAIN;
    const {priceId} = req.body;

    // Create new Checkout Session for the order
    // Other optional params include:
    // [billing_address_collection] - to display billing address details on the page
    // [customer] - if you have an existing Stripe Customer ID
    // [customer_email] - lets you prefill the email input in the form
    // For full details see https://stripe.com/docs/api/checkout/sessions/create
    try {
        const session = await stripe.checkout.sessions.create({
            mode: "subscription",
            payment_method_types: ["card"],
            client_reference_id: "blackjackptit",
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            // ?session_id={CHECKOUT_SESSION_ID} means the redirect will have the session ID set as a query param
            success_url: `${domainURL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${domainURL}/canceled.html`,
        });

        res.send({
            sessionId: session.id,
        });
    } catch (e) {
        res.status(400);
        return res.send({
            error: {
                message: e.message,
            }
        });
    }
});

app.get('/cancel-subscription', async (req, res) => {
    const {subscriptionId} = req.query;
    const deletedSubscription = await stripe.subscriptions.del(
        subscriptionId
    );
    res.send(deletedSubscription);
});

app.get('/subscription', async (req, res) => {
  const {subscriptionId} = req.query;
  const subscription = await stripe.subscriptions.retrieve(
      subscriptionId
  );
  res.send(subscription);
});

app.get('/customer', async (req, res) => {
    const {customerId} = req.query;
    const customer = await stripe.customers.retrieve(
        customerId
    );
    res.send(customer);
});

app.get("/setup", (req, res) => {
    res.send({
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
        basicPrice: process.env.BASIC_PRICE_ID,
        proPrice: process.env.PRO_PRICE_ID,
    });
});

app.post('/customer-portal', async (req, res) => {
    // This is the ID of the Stripe Customer. Typically, this is stored alongside
    // your authenticated user in the database.
    const {customerId} = req.body;

    // This is the url to which the customer will be redirected when they are done
    // managign their billing with the portal.
    const returnUrl = process.env.DOMAIN;

    const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
    });

    res.send({
        url: session.url,
    });
});

// Webhook handler for asynchronous events.
app.post("/webhook", async (req, res) => {
    let eventType;
    // Check if webhook signing is configured.
    if (process.env.STRIPE_WEBHOOK_SECRET) {
        // Retrieve the event by verifying the signature using the raw body and secret.
        let event;
        let signature = req.headers["stripe-signature"];

        try {
            event = stripe.webhooks.constructEvent(
                req.rawBody,
                signature,
                process.env.STRIPE_WEBHOOK_SECRET
            );
        } catch (err) {
            console.log(`⚠️  Webhook signature verification failed.`);
            return res.sendStatus(400);
        }
        // Extract the object from the event.
        data = event.data;
        eventType = event.type;
    } else {
        // Webhook signing is recommended, but if the secret is not configured in `config.js`,
        // retrieve the event data directly from the request body.
        data = req.body.data;
        eventType = req.body.type;
    }

    console.log(eventType);
    if (eventType === "checkout.session.completed") {
        console.log(`🔔  Payment received!`);
    }

    if (eventType === "customer.subscription.deleted") {
        console.log(`🔔  Subscription cancelled!`);
    }

    res.sendStatus(200);
});

app.listen(4242, () => console.log(`Node server listening on port ${4242}!`));
