# How Flake screens should work

Rules for any new or changed screen. They come from a screen-by-screen pass (Nov 23, 2026) and from three public
sources: Vercel's Web Interface Guidelines (github.com/vercel-labs/web-interface-guidelines), Anthropic's
frontend-design skill (github.com/anthropics/skills), and Laws of UX (lawsofux.com).

## Start from the person, not the data

Before laying out a screen, write down who opens it, when, and the one thing they came to do. Put that first.

| Screen | Who, when | What they came for, so it goes first |
| --- | --- | --- |
| Dashboard | Owner, phone, 3 AM alert | The live storm, then alerts. No tutorial mid-storm. |
| Storm board | Owner or dispatcher, during the storm | Progress and who's late. Ending the storm is apart and quiet. |
| Billing review | Office, desk, the morning after | Total, how many are ready, how many need a look, one Approve button. |
| Customer | Office, any time | Who they are and how to reach them. Editing is one tap away, not the default. |
| Lot | Dispatcher | Services, where it is, notes for the driver. A new quote is rare once one is signed. |
| Driver route | Driver, in a truck, gloves, night | Next stop, Arrive, big. Nothing else competes. |
| Customer records | Customer, from a text | Their visits with photos. A quote to sign gets its own box. |

## Rules

1. **One primary action per screen**, in the accent color, large, and within thumb reach on a phone. Everything else
   is outline or ghost.
2. **Rare or destructive actions go apart from everyday ones**: Close storm, Archive, Retire, Void, Regenerate. Put
   them at the end or on their own row, never beside the button people press most. They still ask first.
3. **Read first, edit on request.** Details show as text with an Edit button. Only forms people fill every time (a
   new customer, the driver's Done) open as forms.
4. **Fold what's rare.** A section most visits don't need is one line until opened (`components/fold.tsx`). Draw the
   folded content only when it's open.
5. **Explain once, then get out of the way.** Help text that matters the first time goes in a fold or a dismissible
   note, not a paragraph above the work every time.
6. **Cap lists that can grow** on summary screens: three to six items, then "and N more" with a link.
7. **Answer before tools.** Lead with the number or state people came for (the total, ready count, what's late), then
   the controls.
8. **Empty states say what will appear and what to do**, never a grid of zeros or a bare dash. "Not yet" with a reason
   beats "-" or "No data".
9. **Write the way people talk.** Phone numbers as (216) 555-0100. Times in the company's zone. Sentence case. No
   system words (draft id, E.164, webhook).
10. **Never color alone.** Every colored status also has a word.
11. **Phone first.** 44 px targets, 16 px inputs, nothing under the report button or the tab bar, labels never break
    mid-word. Check every changed screen at 390 px and at desk width before calling it done.
12. **Same name all the way through.** A button called Approve leads to "Approved", not "Charged" or "Done".

## Checking a screen

Screenshot it at 390 px and 1440 px with real-looking data (not the test pile: reset the local demo first). Then ask:
- Can someone tell in three seconds what this screen is for and what to do next?
- Is the most-used action the easiest to hit, and the riskiest one hard to hit by accident?
- Is anything shown twice?
- Does any block of text above the work need to be there every time?
