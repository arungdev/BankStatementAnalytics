# GPay profiles and automatic bank links

In Settings → Accounts → Google Pay, **Add GPay profile** creates a separate Google/GPay
export profile. Give it a label, your exact name in that export, and its own export folder.
Optionally select the imported bank accounts used by that profile. Choose the profile before
using the existing folder setup, auto-import toggle, or Sync now controls. A new profile starts
with automatic import disabled. Profiles belong to the signed-in Bank Analytics user.

Existing imports and their financial values remain in **Primary GPay**. The additional profiles
are stored as tenant-owned profile configuration records. Migration 7 adds nullable profile and
owner-identity fields to imported groups and expenses; existing rows remain unchanged.
Source keys, repeated-import detection, group reconstruction and source-version review are
scoped to the selected profile. The exact owner identity is saved with each imported expense.
Changing the configured name applies to subsequent imports; existing identity snapshots are
preserved. Custom groups keep their existing editing behavior.

Bill Splits provides a profile selector when multiple profiles exist. It scopes group lists,
confirmed splits, summary amounts and GPay activity. All profiles combines the stored expenses;
it does not assume that similar bills exported by different profiles represent the same bill.
Same-named groups remain separate and carry profile labels.

Completed Payment history records match automatically after importing Takeout and when GPay
Activity opens. Each link requires an exact India-local calendar date, amount and payment
direction. The date can be the statement transaction date or, for UPI payments, an explicitly
stored bank value date differing from the transaction date by exactly one day. Dates are never
shifted or guessed, and both date candidates compete in the same uniqueness check. Value-date
links carry a distinct audit method and explain both dates; no stored date or financial value
is changed. Account suffixes must identify one eligible imported bank account. Named payees must
agree with bank details as whole tokens unless an existing stored GPay activity identifier
already identifies that bank row. IOB UPI payee fields truncated to about 14 characters also
match a long prefix of the source name when the source account hint uniquely identifies the
bank account. This uses the statement description, not edited merchant names; short prefixes,
different surnames and merchant substitutions do not qualify. Profile bank selections restrict
eligible accounts. Unmatched reasons distinguish missing bank data, name/identifier conflicts
and payments already reserved by another activity or excluded as own-account transfers.

An explicitly confirmed Payment history link can establish an exact payee name alias, such as
`IRCTC Web UPI` → `WEB UPI`. The confirmation must itself have the same date, amount, direction
and uniquely identified account. Subsequent automatic matches reuse that exact name pair only
within the same GPay profile, bank account, bank type, mode, payee routing code and payment direction. Punctuation
and whitespace are normalized. Automatic matches never teach new aliases; aliases do not remove
the requirement for a unique payment on both sides or override stored source identifiers.

Both sides must be unique: multiple bank candidates, competing source records and conflicting
source versions remain unlinked. Failed, cancelled, pending or unknown payments and own-account
transfers are excluded. Previously rejected matches are respected. Accepted links are persisted
with their full bank key and an audit entry. Existing source confirmations reserve their bank row.
Personal notes are preserved when GPay payment context is appended. No bank amounts, merchant
names, categories, split settlements or participant paid amounts are changed by this matcher.

**View bank transaction** replaces the review button for linked records and opens the bank
details in the RHS. Unlinked records show their matching state and reason.
Ambiguous records additionally expose the eligible owned bank candidates and the number of
other GPay activities competing for them. The table displays the number of possible matches;
opening it shows candidate payees, amounts, full bank keys and dates in the existing RHS.
Inspecting a possible bank transaction is read-only and does not confirm a match. Source search
uses decoded source fields, including activity IDs whose characters are escaped in stored JSON.

A GPay activity ID is
still a source identifier, not a verified UPI/UTR reference. Unique date/amount matching is an
inference from available data. It does not prove a participant-to-split repayment relationship.
Digital orders and cashback retain previously confirmed bank links, but are not automatically
matched by the Payment history matcher. Vouchers do not imply a bank payment.
