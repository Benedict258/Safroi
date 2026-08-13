# Safroi — Pricing & Payment Infrastructure
## Agent Build Prompt

> **Instructions for the agent:** Read this document fully before writing a single line of code. Follow every step in the exact order listed. Do not skip steps. Do not modify any existing functionality unless explicitly instructed. Come back with questions only if something is genuinely ambiguous — do not make assumptions on security-critical items like webhook signature verification.

---

## Product Context

**Safroi** is an AI-powered legal risk analyzer. Users upload or paste Terms of Service, Privacy Policies, or business contracts and receive color-coded risk cards explaining exactly what they are agreeing to.

**Current stack:**
- Frontend: React (Vite)
- Backend: Node.js + Express
- Database: MongoDB
- Auth: Already implemented — do not touch

**What we are building:**
A complete, production-ready subscription and payment infrastructure supporting two payment processors simultaneously — Paystack for Nigerian users and Lemon Squeezy for global users — with three pricing tiers: Free, Pro at $5/month, and Business at $15/month.

---

## Before You Start — Read This

### What you must NOT touch
- Any existing routes
- Any existing React components (unless adding to them as instructed below)
- Any existing MongoDB schemas beyond the specific field additions described in Step 1
- Any existing auth logic
- Any existing environment variables

### What "done" means for this task
Every item in the testing checklist at the end of this document passes manually. Do not consider the task complete until you have verified each item yourself.

### Security rules — non-negotiable
- Never hardcode any API key, secret, or webhook secret anywhere in the codebase
- All webhook endpoints must verify request signatures before processing anything
- Reject any webhook request that fails signature verification with HTTP 400 immediately — do not log the payload or process any part of it

---

## Step 1 — MongoDB User Schema Update

**File to modify:** your existing User model file (wherever the Mongoose schema is defined)

Add the following fields to the existing user document schema. Add them at the end of the schema definition. Do not remove, rename, or reorder any existing fields.

```
plan
  type: String
  enum: ["free", "pro", "business"]
  default: "free"

planActive
  type: Boolean
  default: true

paymentProvider
  type: String
  enum: ["paystack", "lemonsqueezy", null]
  default: null

paystackCustomerId
  type: String
  required: false
  default: null

paystackSubscriptionCode
  type: String
  required: false
  default: null

lemonsqueezyCustomerId
  type: String
  required: false
  default: null

lemonsqueezySubscriptionId
  type: String
  required: false
  default: null

planExpiresAt
  type: Date
  required: false
  default: null
```

**After adding these fields:**
- Run your existing application and confirm it starts without errors
- Confirm an existing user document in MongoDB is not affected by the schema change
- If you use Mongoose strict mode, ensure the new fields are properly declared so they are not stripped on save

---

## Step 2 — Environment Variables

**File to modify:** `.env` in the project root

Add the following variables. Leave the values blank for now — Benedict will fill them in with real keys. Do not add placeholder strings like "your_key_here" — just add the variable names with no value assigned, so the .env file is ready to receive real values.

```
PAYSTACK_SECRET_KEY=
PAYSTACK_PLAN_CODE_PRO=
PAYSTACK_PLAN_CODE_BUSINESS=

LEMONSQUEEZY_API_KEY=
LEMONSQUEEZY_STORE_ID=
LEMONSQUEEZY_WEBHOOK_SECRET=
LEMONSQUEEZY_VARIANT_ID_PRO=
LEMONSQUEEZY_VARIANT_ID_BUSINESS=

CLIENT_URL=
```

**After adding these variables:**
- Confirm that your main Express entry file loads dotenv at the very top, before any other imports. If it does not, add `require('dotenv').config()` as the first line.
- Confirm that `process.env.PAYSTACK_SECRET_KEY` and `process.env.LEMONSQUEEZY_API_KEY` are accessible from within route files without additional configuration.

---

## Step 3 — Plan Enforcement Middleware

**New file to create:** `middleware/requirePlan.js`

This middleware enforces plan-based access control. It is built now but not attached to any route yet. It will be wired up in a future prompt once free tier limits are decided.

**Plan hierarchy (lowest to highest):**
```
free → pro → business
```

**How it works:**
The middleware is a higher-order function that takes a minimum required plan as a string parameter and returns an Express middleware function. When the middleware runs, it checks the authenticated user's current plan against the minimum required plan. If the user's plan does not meet the minimum, it returns HTTP 403 with the following JSON body:

```json
{
  "error": "upgrade_required",
  "currentPlan": "the user's current plan",
  "requiredPlan": "the minimum plan required",
  "upgradeUrl": "/pricing"
}
```

If the user's plan meets or exceeds the minimum, it calls next() and allows the request to proceed.

**Assumptions this middleware can make:**
- The authenticated user's MongoDB document is already attached to `req.user` by the existing auth middleware
- `req.user.plan` contains the user's current plan string
- `req.user.planActive` is true for active subscribers

**Additional check:**
If `req.user.planActive` is false even though the user has a pro or business plan, treat them as free tier — their subscription has lapsed.

**Export:**
Export the middleware as a named export called `requirePlan`.

**Example of how it will eventually be used (do not implement this yet, just understand the pattern):**
```javascript
const { requirePlan } = require('../middleware/requirePlan');
router.post('/api/analyze', requirePlan('pro'), analyzeHandler);
```

---

## Step 4 — Paystack Integration

### 4a — Install dependency
Install axios if it is not already in package.json:
```
npm install axios
```

### 4b — Create the Paystack router
**New file to create:** `routes/paystack.js`

**Register in main Express app** under the prefix `/api/paystack`. Add this registration after your existing route registrations, not before them.

---

### Endpoint 1: POST /api/paystack/initialize

**Purpose:** Start a Paystack subscription checkout for a user choosing Pro or Business.

**Request body expected:**
```json
{
  "email": "user@example.com",
  "userId": "mongodb_user_id",
  "plan": "pro"
}
```

**Step-by-step logic:**

1. Validate that email, userId, and plan are all present in the request body. If any are missing, return HTTP 400 with `{ "error": "missing_fields" }`.

2. Validate that plan is either "pro" or "business". If not, return HTTP 400 with `{ "error": "invalid_plan" }`.

3. Look up the correct Paystack plan code from environment variables:
   - If plan is "pro", use `process.env.PAYSTACK_PLAN_CODE_PRO`
   - If plan is "business", use `process.env.PAYSTACK_PLAN_CODE_BUSINESS`

4. Call the Paystack Initialize Transaction API:
   - URL: `https://api.paystack.co/transaction/initialize`
   - Method: POST
   - Headers: `Authorization: Bearer ${process.env.PAYSTACK_SECRET_KEY}`, `Content-Type: application/json`
   - Body:
     ```json
     {
       "email": "user's email",
       "plan": "the plan code from env",
       "callback_url": "${CLIENT_URL}/payment/paystack/callback",
       "metadata": {
         "userId": "the mongodb user id",
         "plan": "pro or business"
       }
     }
     ```

5. If the Paystack API returns a successful response, return HTTP 200 with:
   ```json
   {
     "authorizationUrl": "the authorization_url from Paystack response"
   }
   ```

6. If the Paystack API call fails for any reason, log the error and return HTTP 500 with `{ "error": "paystack_init_failed" }`.

---

### Endpoint 2: GET /api/paystack/callback

**Purpose:** Verify a completed Paystack transaction and update the user's plan in MongoDB.

**Query parameter expected:** `reference` (the transaction reference from Paystack)

**Step-by-step logic:**

1. Extract the `reference` query parameter. If it is missing, redirect to `${CLIENT_URL}/pricing?payment=failed`.

2. Call the Paystack Verify Transaction API:
   - URL: `https://api.paystack.co/transaction/verify/${reference}`
   - Method: GET
   - Headers: `Authorization: Bearer ${process.env.PAYSTACK_SECRET_KEY}`

3. If the API call fails, redirect to `${CLIENT_URL}/pricing?payment=failed`.

4. Check that the response data status is "success". If not, redirect to `${CLIENT_URL}/pricing?payment=failed`.

5. Extract `userId` and `plan` from `data.metadata`.

6. Find the user in MongoDB by `_id` using the extracted userId.

7. If the user is not found, redirect to `${CLIENT_URL}/pricing?payment=failed`.

8. Update the user's MongoDB document with:
   - `plan`: the plan from metadata ("pro" or "business")
   - `planActive`: true
   - `paymentProvider`: "paystack"
   - `paystackCustomerId`: `data.customer.id` from the Paystack response
   - `paystackSubscriptionCode`: `data.subscription_code` if present, otherwise leave null

9. Save the updated user document.

10. Redirect to `${CLIENT_URL}/dashboard?payment=success`.

---

### Endpoint 3: POST /api/paystack/webhook

**Purpose:** Receive and process Paystack webhook events.

**This endpoint must use `express.raw({ type: 'application/json' })` as middleware** so the raw request body is available for signature verification. Do not use `express.json()` on this route.

**Step-by-step logic:**

1. Extract the `x-paystack-signature` header from the request.

2. Compute an HMAC SHA512 hash of the raw request body using `process.env.PAYSTACK_SECRET_KEY` as the secret.

3. Compare the computed hash to the `x-paystack-signature` header value using a timing-safe comparison (use `crypto.timingSafeEqual`). If they do not match, return HTTP 400 immediately with no further processing.

4. Parse the raw body as JSON to get the event object.

5. Handle the following event types:

   **charge.success:**
   - Extract userId from `event.data.metadata.userId`
   - Find the user in MongoDB
   - Update: `plan` from metadata, `planActive` to true, `paymentProvider` to "paystack"
   - Save and return HTTP 200

   **subscription.disable:**
   - Extract the customer code from `event.data.customer.customer_code`
   - Find the user in MongoDB by `paystackCustomerId`
   - Update: `planActive` to false
   - Save and return HTTP 200

   **invoice.payment_failed:**
   - Find the user by customer code
   - Update: `planActive` to false
   - Save and return HTTP 200

   **Any other event type:**
   - Log the event type for visibility
   - Return HTTP 200 (Paystack requires 200 for all webhook responses)

---

## Step 5 — Lemon Squeezy Integration

### 5a — Create the Lemon Squeezy router
**New file to create:** `routes/lemonsqueezy.js`

**Register in main Express app** under the prefix `/api/lemonsqueezy`.

---

### Endpoint 1: POST /api/lemonsqueezy/checkout

**Purpose:** Create a Lemon Squeezy checkout session for a user choosing Pro or Business.

**Request body expected:**
```json
{
  "userId": "mongodb_user_id",
  "plan": "pro"
}
```

**Step-by-step logic:**

1. Validate that userId and plan are present. If missing, return HTTP 400 with `{ "error": "missing_fields" }`.

2. Validate plan is "pro" or "business". If not, return HTTP 400 with `{ "error": "invalid_plan" }`.

3. Look up the correct Lemon Squeezy variant ID:
   - If plan is "pro", use `process.env.LEMONSQUEEZY_VARIANT_ID_PRO`
   - If plan is "business", use `process.env.LEMONSQUEEZY_VARIANT_ID_BUSINESS`

4. Call the Lemon Squeezy Checkout API:
   - URL: `https://api.lemonsqueezy.com/v1/checkouts`
   - Method: POST
   - Headers:
     ```
     Authorization: Bearer ${LEMONSQUEEZY_API_KEY}
     Content-Type: application/vnd.api+json
     Accept: application/vnd.api+json
     ```
   - Body (JSON:API format):
     ```json
     {
       "data": {
         "type": "checkouts",
         "attributes": {
           "checkout_options": {
             "success_url": "${CLIENT_URL}/payment/lemonsqueezy/success"
           },
           "checkout_data": {
             "custom": {
               "userId": "the mongodb user id",
               "plan": "pro or business"
             }
           }
         },
         "relationships": {
           "store": {
             "data": {
               "type": "stores",
               "id": "${LEMONSQUEEZY_STORE_ID}"
             }
           },
           "variant": {
             "data": {
               "type": "variants",
               "id": "the variant id from env"
             }
           }
         }
       }
     }
     ```

5. If the API call succeeds, return HTTP 200 with:
   ```json
   {
     "checkoutUrl": "the url from response.data.data.attributes.url"
   }
   ```

6. If the API call fails, log the error and return HTTP 500 with `{ "error": "lemonsqueezy_checkout_failed" }`.

---

### Endpoint 2: POST /api/lemonsqueezy/webhook

**Purpose:** Receive and process Lemon Squeezy webhook events.

**This endpoint must use `express.raw({ type: 'application/json' })` as middleware** — same reason as Paystack. Do not use `express.json()` on this specific route.

**Step-by-step logic:**

1. Extract the `x-signature` header.

2. Compute an HMAC SHA256 hash of the raw request body using `process.env.LEMONSQUEEZY_WEBHOOK_SECRET`.

3. Compare using `crypto.timingSafeEqual`. If they do not match, return HTTP 400 immediately.

4. Parse the raw body as JSON.

5. Handle the following event types (found in `event.meta.event_name`):

   **order_created:**
   - Extract userId from `event.meta.custom_data.userId`
   - Extract plan from `event.meta.custom_data.plan`
   - Find user in MongoDB
   - Update: `plan`, `planActive` to true, `paymentProvider` to "lemonsqueezy", `lemonsqueezyCustomerId` from `event.data.attributes.customer_id`
   - Save and return HTTP 200

   **subscription_created:**
   - Extract userId and plan from `event.meta.custom_data`
   - Find user in MongoDB
   - Update: `plan`, `planActive` to true, `paymentProvider` to "lemonsqueezy", `lemonsqueezySubscriptionId` from `event.data.id`
   - Save and return HTTP 200

   **subscription_updated:**
   - If `event.data.attributes.status` is "active", set `planActive` to true
   - If status is anything else, set `planActive` to false
   - Find user by `lemonsqueezySubscriptionId`
   - Save and return HTTP 200

   **subscription_cancelled or subscription_expired:**
   - Find user by `lemonsqueezySubscriptionId` from `event.data.id`
   - Update: `planActive` to false
   - Save and return HTTP 200

   **Any other event:**
   - Log the event name
   - Return HTTP 200

---

### Endpoint 3: GET /api/lemonsqueezy/success

**Purpose:** Simple redirect target after Lemon Squeezy checkout completes.

Redirect immediately to `${CLIENT_URL}/dashboard?payment=success`.

---

## Step 6 — Pricing Page (Frontend)

**New file to create:** `src/pages/Pricing.jsx`

**Add to router** at the path `/pricing`. This should be a public route — no auth required to view the pricing page.

---

### Layout

Three cards displayed side by side on desktop, stacked vertically on mobile. Each card has: plan name, price, feature list, and a CTA button.

---

### Free Card

- Plan name: Free
- Price: $0 / forever
- Features:
  - Limited scans per month (label only — the actual limit will be configured later)
  - URL input
  - Basic risk cards
  - No Chrome Extension
  - No translation
- CTA button: "Get Started"
  - If user is not logged in: link to /signup
  - If user is logged in and already on Free: link to /dashboard
  - If user is logged in and on a paid plan: show "Current plan downgrade not available"

---

### Pro Card

- Plan name: Pro
- Price: $5 / month
- Highlight this card visually — border, badge saying "Most Popular", or background color
- Features:
  - Unlimited scans
  - URL + paste + file input
  - Chrome Extension sync
  - 4-language translation
  - Risk history and export
- CTA button: "Get Pro"
  - Triggers the payment flow described below

---

### Business Card

- Plan name: Business
- Price: $15 / month
- Features:
  - Everything in Pro
  - 3 team seats
  - Policy change alerts
  - API access
  - Priority support
- CTA button: "Get Business"
  - Triggers the payment flow described below

---

### Payment Flow Logic for Pro and Business Buttons

When a user clicks Get Pro or Get Business, run this logic:

1. If the user is not logged in, redirect to /login with a query param `redirect=/pricing` so they return after login.

2. If the user is logged in, determine which payment options to show:
   - Check the user's stored `paymentProvider`. If it is already set, default to that provider.
   - If no provider is set yet, detect location. Use `Intl.DateTimeFormat().resolvedOptions().timeZone` — if the timezone contains "Africa/Lagos" or "Africa/Abuja", show both options. Otherwise default to Lemon Squeezy only.

3. For Nigerian users or users who want to choose: show two buttons — "Pay with Paystack" and "Pay with Lemon Squeezy".

4. Paystack button click:
   - Call `POST /api/paystack/initialize` with the user's email, MongoDB user ID, and selected plan
   - On success, redirect the browser to the returned `authorizationUrl`
   - On failure, show an inline error message — do not redirect

5. Lemon Squeezy button click:
   - Call `POST /api/lemonsqueezy/checkout` with the user's MongoDB user ID and selected plan
   - On success, redirect the browser to the returned `checkoutUrl`
   - On failure, show an inline error message — do not redirect

6. Show a loading state on the button while the API call is in progress. Disable the button during loading to prevent double clicks.

---

### Payment Result Pages (Frontend Routes)

**Add route: `/payment/paystack/callback`**

Create a simple component that:
1. Reads the `reference` query parameter from the URL
2. Shows a loading spinner and the text "Verifying your payment..."
3. Calls `GET /api/paystack/callback?reference=${reference}`
4. On success response, redirects to `/dashboard?payment=success`
5. On failure response, redirects to `/pricing?payment=failed`

**Add route: `/payment/lemonsqueezy/success`**

Create a simple component that:
1. Shows a success message: "Payment successful! Setting up your account..."
2. After 2 seconds, redirects to `/dashboard?payment=success`

**Handle the `?payment=success` and `?payment=failed` params on existing pages:**

On the `/dashboard` page, if `?payment=success` is present in the URL, show a dismissible success banner at the top: "You're now on the [plan name] plan. Welcome to Safroi Pro."

On the `/pricing` page, if `?payment=failed` is present in the URL, show a dismissible error banner at the top: "Payment could not be completed. Please try again or contact support."

---

## Step 7 — Plan Badge in Dashboard

**File to modify:** the component that renders the dashboard header or user profile section (identify this from the existing codebase)

Add a small plan badge next to the user's name or email. The badge should:
- Show "Free", "Pro", or "Business" based on `user.plan`
- Use a visually distinct color per tier (suggest: gray for Free, blue for Pro, purple for Business)
- If the user is on Free plan, show a small "Upgrade" link immediately after the badge that navigates to `/pricing`
- If the user is on Pro or Business, show no upgrade link
- If `planActive` is false despite a paid plan, show the badge in red with the text "[Plan] — Expired" and show an "Renew" link to `/pricing`

---

## Step 8 — Testing Checklist

Before marking this task as complete, verify every item below manually. Do not skip any item. Report the result of each check.

**Pricing page:**
- [ ] `/pricing` renders correctly with all three cards and correct prices ($0, $5, $15)
- [ ] Pro card is visually highlighted as Most Popular
- [ ] Clicking Get Started as a logged-out user redirects to /login
- [ ] Clicking Get Pro as a logged-in Nigerian user shows both Paystack and Lemon Squeezy options
- [ ] Clicking Get Pro as a logged-in non-Nigerian user shows only Lemon Squeezy option
- [ ] Buttons show a loading state while the API call is in progress
- [ ] Double-clicking the button does not trigger two API calls

**Paystack flow:**
- [ ] Clicking Pay with Paystack calls POST /api/paystack/initialize correctly
- [ ] The browser is redirected to a real Paystack checkout page (use test keys)
- [ ] Completing a test Paystack payment triggers the callback endpoint
- [ ] After callback, the user's `plan` field in MongoDB is updated to "pro" or "business"
- [ ] After callback, the browser lands on /dashboard?payment=success
- [ ] The success banner appears on the dashboard

**Lemon Squeezy flow:**
- [ ] Clicking Pay with Lemon Squeezy calls POST /api/lemonsqueezy/checkout correctly
- [ ] The browser is redirected to a real Lemon Squeezy checkout page (use test mode)
- [ ] Completing a test Lemon Squeezy checkout triggers the webhook
- [ ] After webhook, the user's `plan` field in MongoDB is updated correctly
- [ ] The browser lands on /payment/lemonsqueezy/success then redirects to /dashboard

**Middleware:**
- [ ] Calling `requirePlan('pro')` directly in a test with a Free user returns 403 with `upgrade_required`
- [ ] Calling `requirePlan('pro')` with a Pro user calls next() correctly
- [ ] The middleware is NOT attached to any existing routes

**Webhooks:**
- [ ] Paystack webhook rejects requests with an invalid signature with HTTP 400
- [ ] Lemon Squeezy webhook rejects requests with an invalid signature with HTTP 400
- [ ] Both webhooks return HTTP 200 for valid, processed events
- [ ] MongoDB is correctly updated after each webhook event

**Plan badge:**
- [ ] Dashboard shows the correct plan badge for Free, Pro, and Business users
- [ ] Free users see an Upgrade link next to the badge
- [ ] Users with an expired plan see the badge in red with a Renew link

---

## Notes for the Agent

- Use `crypto` from Node's standard library for all HMAC operations — do not install a separate crypto package
- All async operations must use try/catch — do not let unhandled promise rejections crash the server
- Log errors to the console with enough context to debug — include the endpoint name and a short description of what failed
- The CLIENT_URL environment variable must have no trailing slash — build all redirect URLs accordingly
- Do not implement any scan counting or scan limit logic — that will be handled in a separate follow-up prompt
- If you encounter an ambiguity in any webhook event structure, refer to the official Paystack and Lemon Squeezy webhook documentation rather than guessing
