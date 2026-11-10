# Testing Flake on real phones

A checklist to run by hand on an iPhone (iOS 16.4 or newer) and an Android phone (Chrome). `pnpm verify` covers the same flows in emulated phones; this is for what only real hardware shows: the Home Screen app, notifications, the camera, and losing signal.

Use test data on production, or a staging deployment. Tick each box on both phones unless it says otherwise.

## Before you start

- [ ] A company to test with. Sign up with an email you can read on the phone.
- [ ] One customer with a lot, on a route, with a signed quote (Customers, New customer, then open the quote link and accept it).
- [ ] Yourself on the crew with your own email (Settings, Crew), so you get a route link.
- [ ] For the salt order: someone in `ADMIN_EMAILS` has added a supplier near your lot in Settings, System, 216LABS, Salt suppliers.
- [ ] The phone has Wi-Fi and cellular both available, so you can turn one off at a time.

## 1. Sign in

- [ ] Open the app URL in Safari or Chrome. Tap **Share, Add to Home Screen** (iPhone) or **menu, Install app / Add to Home screen** (Android).
- [ ] Open Flake from the Home Screen. Enter your email, tap **Email me a link**.
- [ ] **iPhone:** in the email, use the **code**, not the link. Type it in **Code from the email** and tap **Sign in**. You land on the dashboard inside the Home Screen app. (The link would open Safari, which keeps its own sign-in.)
- [ ] **Android:** tap the link in the email. It opens the app signed in. Also try the code once.
- [ ] A wrong code says "That code is wrong or has expired". An old code after a new email is sent says the same.

## 2. Turn on notifications

From the Home Screen app, as an owner or dispatcher:

- [ ] Settings, Alerts, **Turn on alerts**. Allow notifications when the phone asks.
- [ ] **Send a test alert**. It arrives within a couple of minutes, with the app closed.
- [ ] Tapping the notification opens Settings, Alerts.
- [ ] iPhone in Safari (not the Home Screen app) says to add Flake to the Home Screen first, instead of failing.
- [ ] **Turn off**, then on again, works.

## 3. A route with no signal

On the driver's phone (it can be the same phone):

- [ ] Start a storm from the dashboard and **Publish**. The route link arrives by email. Open it.
- [ ] Add the route page to the Home Screen too, and open it from there.
- [ ] Tap **Navigate**, then come back. Tap **Arrive** at the first stop.
- [ ] Turn on **Airplane Mode**.
- [ ] Take a **Before photo**, enter a snow depth, take an **After photo**, tap **Done**. The bar says **Saved on phone**.
- [ ] Do the next stop the same way, still offline. Also report a **Problem** with a short voice note.
- [ ] Close the app completely (swipe it away) and open it again from the Home Screen, still offline. The route and your finished stops are all still there.
- [ ] Turn Airplane Mode off. The bar goes **Sending**, then **Synced**, without tapping anything.
- [ ] On the office storm board, both stops show done with times from when you tapped, not when it synced. Each visit has both photos, once each. The problem shows with the voice note.
- [ ] **Undo last** right after a Done reopens that stop, on the phone and on the board.

## 4. A pin with a photo

- [ ] In the office app, open the lot (Customers, the customer, the site). Tap **Drop pin**, choose **hazard**, tap the map.
- [ ] On the pin's row, **Add photo** opens the camera or photo library. Take one. The thumbnail shows.
- [ ] Open the route link on the driver's phone: the stop shows the pin and its photo.
- [ ] Put the driver's phone in Airplane Mode and reopen the route: the pin photo still shows, from the phone.
- [ ] Back in the office, **Remove** the pin. The driver's route drops it on its next refresh.

## 5. The customer's records page

- [ ] Customers, the customer, Records page: **Email it** or **Copy**. Open the link on a phone that isn't signed in.
- [ ] It shows each visit from step 3 with times, services, depth and photos. Tap a photo: it opens full size.
- [ ] **Ask for a visit** on a lot sends the office a notification (from step 2) and an email.
- [ ] Back in the office, **Make a new link**. The old link now says it's no longer active.

## 6. Salt order

- [ ] Reports, **Order salt**. Enter the lot's address and a number of tons. The quote says whether it ships now, joins a shared truckload, or splits.
- [ ] Place it. The order shows with its status. **Cancel** works while it's still filling.
- [ ] The supplier's email has a private link. On a phone, that link can set a delivery date and mark the load delivered.

## 7. Things that should fail politely

- [ ] Start a storm, then turn off signal on the office phone and tap **Another pass**. It says it couldn't reach the server, not "Unexpected token".
- [ ] A route link the office replaced (storm board, **QR / copy link**, **New link**) opens a friendly "no longer active" screen. Work already done on the old link still syncs.
- [ ] Rotate each phone mid-route. Nothing is lost.

## What to write down when something's off

Phone model and OS version, Home Screen app or browser, signal on or off, the step number, the time to the minute, and a screenshot. The time lets the office's Settings, System page and the server log line up with what you saw.
