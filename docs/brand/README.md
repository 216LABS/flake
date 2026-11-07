## Who Flake is

Flake runs a snow plow company's storm night: it says when to roll, gives drivers their route without an app, records proof of every visit, and turns the night's work into bills. It is for companies with 1 to 25 trucks.

**Promise:** Plowed, proved and paid.

Write everything from the 3 AM point of view. Someone tired, cold and possibly gloved needs to know what to do next. Every screen has one job and one amber thing.

**Name it this way:** "Flake" in running text, and "Flake by 216LABS" in legal pages, sales material and anywhere a stranger first meets it. Never "FLAKE", "Flake App" or "flake.ai".

**What the name means.** Flake is a snowflake. It is the smallest thing in a storm, and the reason for everything that happens that night.

## How Flake sounds

Plain, specific and calm. A good dispatcher on the radio, not a software company.

- Say what happened and what to do next. "Your route changed. Open your link to see it."
- Use the trade's words: storm, push, route, trigger, salt, sub, pass, site, proof. Say "bill" or "invoice", never "monetize". Say "driver", never "resource" or "technician".
- Use real numbers and units: 3", 12 stops, 4:00 AM.
- Use "you" for the operator and "we" sparingly. Sentence case everywhere. No exclamation points, no emoji.
- Never overclaim. Competitors in this market say "industry leading" and "the easiest, period". Flake says what it does and shows it. Say "in early testing" until that stops being true. Never invent customers, numbers or quotes.
- Never imply Flake dispatches on its own. It alerts, and a person starts the storm.

| Instead of | Write |
| --- | --- |
| Oops! Something went wrong. | That photo didn't upload. It's saved on your phone and will send when you have signal. |
| Empower your snow operations with AI-driven insights | Know when to roll. Prove you showed up. Get paid that night. |
| Successfully submitted! | Saved. |
| Resource unavailable | We can't text or email Dale, so they don't have this route. Show them the QR code. |

**Whose name goes first.** To a plow company's customers and crews, the plow company is the brand. Texts and emails open with their company name and come from it. Flake appears only as "via Flake" where the rules require it. Quote pages and proof packets carry the company's name at the top and a small "Flake" at the foot.

## Color

Night and snow are the ground. `beacon` is the one thing to do next.

- Use `ground` for the page and `surface` for anything that holds content. Text is `ink`, and secondary text is `ink-muted`.
- Use `beacon` with `on-beacon` text for the single primary action on a screen. Two amber buttons means one of them is wrong.
- Never set `beacon` as text on `ground` in the Paper theme. It fails contrast. On `night` it is fine.
- Use `night` for the sidebar, the conditions band and the storm command strip, and in both themes. These are where the office sees live state.
- Use `link` for links. Use `success`, `warning` and `danger` only for states, and always with a word beside them, never color alone.
- Don't use ice blue as a brand color. Every snow product reaches for it, and it disappears on a white truck. `ice` is only for a selected state on the driver's screen.
- No gradients and no shadows. Separate things with `line` and spacing.

**The Night theme is for the cab.** Pilots and vision researchers agree on the principle: bright screens wreck night vision, and long-wavelength light from amber to red disturbs it least. So the driver's screen is dark, large areas stay dark, and big white panels never appear. All driver text holds 7:1 contrast, which a test enforces.

## Type

- Set headings, numbers, buttons on the driver's screen, and labels in `display` (Barlow Semi Condensed). Its designer drew on highway signs, Clearview, DIN and license plates, which is why it reads at a glance.
- Set running text and form fields in `sans` (Public Sans).
- Use tabular numbers wherever a value changes in place.
- Set small labels in `label`: uppercase, tracked, never a full sentence.
- Keep the driver's screen at `driver-action` or `driver-body` and nothing smaller.

## Shape and space

- Corners are nearly square, like a sign: `radius-sm` on badges, `radius-md` on controls and panels, `radius-lg` on driver buttons. No pills.
- Keep panels flat, with a `line` border.
- Driver targets are at least 64px tall, with `space-3` between them. Nothing on that screen depends on hover.
- Motion is limited to progress and state. Honor reduced motion.

## The plow stripe

The stripe is the angled amber and night band from the back of a plow truck. It is Flake's one piece of decoration, so it stays rare: a 6px edge on the office sidebar, the foot of the marketing hero and sign-in panel, the foot of a social image, the edge of a printed card. Never as a background, a divider between sections or a large field. Don't use it on anything that could be mistaken for real road or vehicle safety marking.

## Logo

The mark is a snowflake: six solid arms meeting at the center, with an amber V near each tip.

- Use `flake-logo-on-dark` on `night` and `flake-logo-on-light` on `ground`. Use `flake-logo-by-216labs-*` where a stranger first meets the name.
- On trucks, printed forms and stamps, use `flake-logo-one-color-black`, or the white mark on a dark door. Amber on a white truck door does not read.
- Use `flake-mark-*` alone only under 32px or where "Flake" already appears nearby, and `flake-app-icon` for the favicon and home screen.
- Keep clear space equal to one arm's V on every side. The smallest logo is 20px tall, and the smallest mark is 16px.
- Never recolor it, stretch it, or put it on a photo without a solid panel behind it.
- Use only this snowflake. Don't swap in stock snowflake icons or emoji.

## Icons and imagery

Use Lucide icons, in line style at 16 to 20px, in the color of the text beside them. An icon sits beside a word and doesn't replace it, except for universally understood controls. No emoji.

Photography: real trucks, real lots, real night and dawn. Beacon light, snow in headlights, salt on a boot, a phone in a gloved hand. No stock smiling teams, no bluebird ski-day snow, no aerial drone beauty shots. Until there are real photos from real operators, use real product screens instead of stock.

## Where it shows up

| Touchpoint | Rule |
| --- | --- |
| Office app | Paper theme, `night` sidebar. Live state goes in `night` bands. One `beacon` action per screen. |
| Driver route page | Night theme only. One next stop, big buttons, no decoration, English and Spanish. |
| Customer text | Starts with the plow company's name. One message, one link, under 160 characters where possible. |
| Email | Plain text first. The plow company's name in From and subject. No marketing footer on service messages. |
| Quote page | The plow company's name leads. Quiet Paper theme, and `beacon` only on Accept. |
| Proof packet (PDF) | A legal record. Black on white, the company's name first, no decoration, "Flake" small in the footer. |
| Marketing site | `night` hero and real product screens. Plain claims, and "in early testing" stays visible. |
| Social and link previews | `flake-social-card`. The promise and one plain sentence. |
| Truck decal or shop sticker | One-color logo, large. White truck: black. Dark truck: white. |
| Slides and sales | `night` title slide, Paper for the rest, the same type. One claim per slide. |
| Domain and sender | Sends from a subdomain, with the plow company's name as the display name. |
