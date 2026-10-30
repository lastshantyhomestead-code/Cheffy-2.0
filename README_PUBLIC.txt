Cheffy 2.0 — Grocery & Pantry Accuracy Update
=============================================
Version: 2026-10-29

Public GitHub Pages app files. Upload the contents of this folder (not the ZIP
itself) to the root of your EXISTING Cheffy 2.0 GitHub Pages repository.
DO NOT upload Code.gs or your household access code to GitHub.
DO NOT replace Cheffy Classic.

Changes:
- Grocery ingredients for simple breakfasts, including English muffins + one
  selected spread; quantities multiply by household portions (default 3).
- Generic lunches now warn until you choose leftovers, sandwiches, wraps or
  a manually checked soup; no silent skipping.
- Breakfasts, lunches, dinners, recipe sides, salad, baking, pizza and veggie
  box now contribute to the shopping list.
- Pizza toppings selectable; veggie box rotates for NEW weeks only.
- Grocery cupboard statuses separate from purchased checkboxes.
- Explicit Update Pantry, Add Purchased Items to Pantry, Finish Week review.
- All upcoming meals included in pantry protection.
- Recalculate Grocery List action preserves the existing menu, matching
  checkmarks, cupboard reviews and unmatched older ingredients (flagged as
  carried over and removable).
- Safer sync compatibility with the existing Google Sheets data.

IMPORTANT: The currently saved week's shopping list does NOT recalculate
on deployment. Open Groceries > Recalculate grocery list when you are ready.
Your saved meals, salad, baking, pantry, extras and checked grocery items
are not automatically reset by installing these files.

Install Google Apps Script update FIRST and deploy a NEW VERSION of your
existing web app deployment. Detailed instructions are in the separate
Cheffy_2_0_UPDATE_INSTRUCTIONS.txt provided with the download.
