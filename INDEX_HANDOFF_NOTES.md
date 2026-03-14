# Index Handoff Notes

This file is a reminder of what is currently wired into `index.html` on this branch so it can be compared against the `Justine` branch later.

## Session log (March 14, 2026)

### Firebase write issue — resolved
- Root cause was **Email/Password sign-in not enabled** in the Firebase Console and **Firestore not yet created / rules blocking writes**.
- Fix: enabled Email/Password auth and set Firestore rules to allow authenticated users to read/write only their own `users/{uid}/**` path.

### Default subcollection seeding — attempted, abandoned
- Tried seeding default documents into `users/{uid}/transactions` inside the same `writeBatch` call during sign-up in `auth.js`.
- Also added `collection` to the Firestore import in `auth.js` for this purpose.
- Did not work as intended; user plans to take a different approach for initializing user data.
- The `collection` import added to `auth.js` is still there but currently unused by the seeding logic — can be removed if the new approach doesn't need it.

### Next step (owner's intent)
- User wants a **different approach** to initializing the transactions subcollection / default values — specifics TBD.

## What was changed in `index.html`

- Moved the stylesheet reference to `assets/css/styles.css`.
- Moved the page logic out of inline `<script>` code and into `assets/js/app.js`.
- Kept service worker registration through `assets/js/cache-registration.js`.
- Added a status message area:
  - `<p class="page-message" id="page-message" aria-live="polite"></p>`
- Added auth-related header controls:
  - `#user-email`
  - `#auth-link`
  - `#logout-btn`
- Kept the dashboard layout as three main parts:
  - summary cards
  - add transaction form
  - transaction history list

## IDs that `assets/js/app.js` depends on

If Justine's `index.html` becomes the main version, these IDs need to exist or the current dashboard script will break:

- `transaction-form`
- `transaction-list`
- `clear-btn`
- `logout-btn`
- `auth-link`
- `user-email`
- `page-message`
- `balance`
- `total-income`
- `total-expense`
- `description`
- `amount`
- `category`
- `type`

## Current behavior connected to `index.html`

- If the user is not logged in, the page redirects to `login.html`.
- If the user is logged in, the header shows their email and a logout button.
- Transactions load from Firestore path:
  - `users/{uid}/transactions`
- Summary cards auto-update:
  - balance
  - total income
  - total expenses
- The form adds a new transaction.
- Each transaction row has a delete button.
- The `Clear All` button deletes all current transactions after confirmation.
- The page uses the status message area to show success/error messages.

## Structure to preserve if merging layouts

- Header with title/subtitle and auth controls
- Summary section with 3 cards
- Add transaction form with fields for description, amount, category, and type
- Transaction history section with a clear button and list container

## Important asset references

Current `index.html` expects:

- `assets/css/styles.css`
- `assets/js/cache-registration.js`
- `assets/js/app.js`

## If Justine's branch replaces the page

Minimum checklist before switching over:

1. Keep the required element IDs listed above.
2. Keep the asset paths or update the imports/scripts accordingly.
3. Make sure the page still includes the login/logout header controls.
4. Make sure there is a visible or hidden `#page-message` element for runtime messages.
5. Make sure transaction rows still support delete actions through a button with class `btn-delete` and a `data-id` attribute.
6. Make sure the page still works with Firestore data under `users/{uid}/transactions`.