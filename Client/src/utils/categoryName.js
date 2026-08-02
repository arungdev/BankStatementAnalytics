/* Category / sub-category names come in from four places: the Settings inputs, the
   window.prompt on Merchants, and the inline "Create …" row in the category picker on
   both Transactions and Merchants. They all have to agree with each other and with
   CategoriesApiController, which applies the same rules server-side — this module is
   the one copy of them. */

export const CATEGORY_NAME_MAX = 50;

/* Whitespace is collapsed, not just trimmed, so "Food  Delivery" doesn't become a
   second category that looks identical to "Food Delivery" in every list. */
export const normalizeCategoryName = (raw) => (raw ?? "").trim().replace(/\s+/g, " ");

/* Returns { name, error }. `error` is a ready-to-show message, or null when the name is
   usable — `what` names the thing in it ("Category" / "Sub-category"). */
export const validateCategoryName = (raw, what = "Category") => {
  const name = normalizeCategoryName(raw);

  if (!name) return { name, error: `${what} name is required.` };
  if (name.length > CATEGORY_NAME_MAX)
    return { name, error: `${what} name can be at most ${CATEGORY_NAME_MAX} characters.` };

  return { name, error: null };
};

/* Case-insensitive match against existing names — the uniqueness rule the server
   enforces. Returns the existing name (so callers can select it instead of failing),
   or undefined. */
export const findExistingName = (names, name) => {
  const q = normalizeCategoryName(name).toLowerCase();
  return (names || []).find((n) => n.toLowerCase() === q);
};
