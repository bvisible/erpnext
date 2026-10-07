# //// Neoffice — added file (no upstream equivalent). Regression tests for the three defects of
# //// the loyalty tier maths found on 2026-10-07 (neoffice-maintenance#1287): the tier rule that
# //// returned the tier ABOVE the right one, a `total_spent` that counted an invoice once per
# //// redemption row, and a boolean sent by the desk as the string "false" that counted as true.
# //// Each test fails on the code as it stood before the fix.

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, today

from erpnext.accounts.doctype.loyalty_program import loyalty_program as lp

# The six tiers of the shop that reported it: 1 point per `factor` CHF, from `min_spent` CHF on.
TIERS = [
	("Tier 1", 3.0, 0),
	("Tier 2", 2.8, 2000),
	("Tier 3", 2.6, 4000),
	("Tier 4", 2.4, 6000),
	("Tier 5", 2.2, 8000),
	("Tier 6", 2.0, 10000),
]


def rules(tiers=TIERS):
	return [frappe._dict(tier_name=n, collection_factor=f, min_spent=m) for n, f, m in tiers]


class TestTierForSpent(FrappeTestCase):
	"""The tier a customer is in is the highest one whose threshold the lifetime spend reached."""

	def tier(self, spent, tiers=TIERS):
		return lp.get_tier_for_spent(rules(tiers), spent).tier_name

	def test_a_spend_inside_a_band_gets_that_band_not_the_one_above(self):
		# Before the fix every one of these came back one tier too high, and anything above the
		# second-highest threshold came back as the top tier.
		self.assertEqual(self.tier(8163.77), "Tier 5")
		self.assertEqual(self.tier(7368.75), "Tier 4")
		self.assertEqual(self.tier(2500), "Tier 2")
		self.assertEqual(self.tier(9999.99), "Tier 5")

	def test_a_spend_exactly_on_a_threshold_is_in_that_tier(self):
		for spent, expected in [(0, "Tier 1"), (2000, "Tier 2"), (6000, "Tier 4"), (10000, "Tier 6")]:
			self.assertEqual(self.tier(spent), expected, f"spent {spent}")

	def test_a_spend_just_under_a_threshold_stays_below(self):
		self.assertEqual(self.tier(1999.99), "Tier 1")
		self.assertEqual(self.tier(5999.99), "Tier 3")

	def test_the_top_tier_is_for_anyone_past_its_threshold(self):
		self.assertEqual(self.tier(10000.01), "Tier 6")
		self.assertEqual(self.tier(250000), "Tier 6")

	def test_the_order_of_the_rules_does_not_matter(self):
		self.assertEqual(self.tier(8163.77, list(reversed(TIERS))), "Tier 5")

	def test_a_spend_under_every_threshold_falls_back_on_the_lowest_tier(self):
		"""A single-tier program with a threshold (min_spent 1000) still applies to a customer who
		has spent less: it is the only tier there is, and upstream gave it to them too."""
		self.assertEqual(self.tier(10, [("Silver", 1000, 1000)]), "Silver")
		self.assertEqual(self.tier(10, [("Silver", 1000, 1000), ("Gold", 900, 5000)]), "Silver")

	def test_a_program_without_rules_has_no_tier(self):
		self.assertIsNone(lp.get_tier_for_spent([], 100))


class TestLoyaltyTotals(FrappeTestCase):
	"""The totals the customer form, the points dialog, the till and the web shop all read."""

	def setUp(self):
		self.company = frappe.defaults.get_defaults().get("company") or frappe.get_all(
			"Company", pluck="name"
		)[0]
		customers = frappe.get_all("Customer", pluck="name", limit=1)
		if not customers:
			self.skipTest("the site has no customer to hang loyalty entries on")
		self.customer = customers[0]
		self.program = "_NEOFFICE loyalty tiers test"
		frappe.db.delete("Loyalty Point Entry", {"loyalty_program": self.program})
		if frappe.db.exists("Loyalty Program", self.program):
			frappe.delete_doc("Loyalty Program", self.program, force=1, ignore_permissions=True)
		frappe.get_doc(
			{
				"doctype": "Loyalty Program",
				"loyalty_program_name": self.program,
				"loyalty_program_type": "Multiple Tier Program",
				"from_date": add_days(today(), -2000),
				"conversion_factor": 0.08,
				"expiry_duration": 365,
				"company": self.company,
				"collection_rules": [
					{"tier_name": n, "collection_factor": f, "min_spent": m} for n, f, m in TIERS
				],
			}
		).insert(ignore_permissions=True)

	def tearDown(self):
		frappe.db.delete("Loyalty Point Entry", {"loyalty_program": self.program})
		if frappe.db.exists("Loyalty Program", self.program):
			frappe.delete_doc("Loyalty Program", self.program, force=1, ignore_permissions=True)

	def entry(self, points, amount, expires_in=300, redeem_against=None, invoice="_NEO-INV"):
		doc = frappe.get_doc(
			{
				"doctype": "Loyalty Point Entry",
				"company": self.company,
				"loyalty_program": self.program,
				"customer": self.customer,
				"invoice_type": "Sales Invoice",
				"invoice": invoice,
				"loyalty_points": points,
				"purchase_amount": amount,
				"posting_date": add_days(today(), -400 + expires_in),
				"expiry_date": add_days(today(), expires_in),
				"redeem_against": redeem_against,
			}
		)
		doc.flags.ignore_permissions = True
		doc.flags.ignore_links = True
		doc.insert()
		return doc

	def details(self, **kwargs):
		return lp.get_loyalty_program_details_with_points(
			self.customer, loyalty_program=self.program, company=self.company, **kwargs
		)

	# -- total_spent ---------------------------------------------------------------------------

	def test_a_redemption_row_does_not_add_its_invoice_to_the_total_again(self):
		"""Paying an invoice with points writes one negative row PER earn row consumed, and each
		copies the invoice total into `purchase_amount`. The shop's total counted the invoice once
		per row: CHF 8'163.77 shown for CHF 7'368.75 really spent."""
		first = self.entry(100, 300)
		second = self.entry(200, 600)
		# a CHF 57.10 invoice, paid with the points of both earn rows
		self.entry(10, 57.10, invoice="_NEO-INV-2")
		self.entry(-20, 57.10, redeem_against=first.name, invoice="_NEO-INV-2")
		self.entry(-30, 57.10, redeem_against=second.name, invoice="_NEO-INV-2")
		total = lp.get_loyalty_details(self.customer, self.program, include_expired_entry=True)
		self.assertEqual(round(total["total_spent"], 2), round(300 + 600 + 57.10, 2))

	def test_redeeming_still_takes_the_points_off_the_balance(self):
		first = self.entry(100, 300)
		self.entry(-40, 57.10, redeem_against=first.name, invoice="_NEO-INV-2")
		self.assertEqual(self.details()["loyalty_points"], 60)

	# -- expired points ------------------------------------------------------------------------

	def test_expired_entries_are_left_out_by_default(self):
		self.entry(100, 300, expires_in=200)
		self.entry(500, 1000, expires_in=-5)
		self.assertEqual(self.details()["loyalty_points"], 100)
		self.assertEqual(round(self.details()["total_spent"], 2), 300)

	def test_expired_entries_count_when_asked_for(self):
		self.entry(100, 300, expires_in=200)
		self.entry(500, 1000, expires_in=-5)
		details = self.details(include_expired_entry=True)
		self.assertEqual(details["loyalty_points"], 600)
		self.assertEqual(round(details["total_spent"], 2), 1300)

	def test_the_string_false_from_the_desk_means_false(self):
		"""The points dialog sent `include_expired_entry: false` from JavaScript; Frappe handed the
		function the STRING "false", which is true: expired points were counted (776 shown for 463
		usable)."""
		self.entry(100, 300, expires_in=200)
		self.entry(500, 1000, expires_in=-5)
		self.assertEqual(self.details(include_expired_entry="false")["loyalty_points"], 100)
		self.assertEqual(self.details(include_expired_entry="0")["loyalty_points"], 100)
		self.assertEqual(self.details(include_expired_entry="true")["loyalty_points"], 600)
		self.assertEqual(self.details(include_expired_entry="1")["loyalty_points"], 600)

	def test_a_current_transaction_amount_from_the_desk_is_a_number(self):
		self.entry(100, 300)
		self.assertEqual(self.details(current_transaction_amount="0")["tier_name"], "Tier 1")

	# -- the tier the customer is in -----------------------------------------------------------

	def test_the_tier_follows_the_real_lifetime_spend(self):
		self.entry(1000, 7368.75)
		self.assertEqual(self.details(include_expired_entry=True)["tier_name"], "Tier 4")
		self.assertEqual(self.details(include_expired_entry=True)["collection_factor"], 2.4)

	def test_the_current_purchase_counts_towards_the_tier_it_is_earned_at(self):
		self.entry(1000, 7368.75)
		details = self.details(include_expired_entry=True, current_transaction_amount=700)
		self.assertEqual(details["tier_name"], "Tier 5")

	def test_a_customer_with_no_entries_is_in_the_lowest_tier(self):
		self.assertEqual(self.details(include_expired_entry=True)["tier_name"], "Tier 1")


class TestLoyaltyDetailsAreForWhoReadsTheCustomer(FrappeTestCase):
	"""`get_loyalty_program_details_with_points` is whitelisted: a portal account could read the
	lifetime spend, the points and the tier of ANY customer through it, while the list of the
	entries is refused to them. When the function is the endpoint itself, the caller must be able
	to read the customer. The web shop calls it from Python, in the same process, for its own
	customer: that path is left alone."""

	ENDPOINT = (
		"erpnext.accounts.doctype.loyalty_program.loyalty_program.get_loyalty_program_details_with_points"
	)

	def setUp(self):
		customers = frappe.get_all("Customer", pluck="name", limit=1)
		portal = frappe.get_all(
			"User", filters={"user_type": "Website User", "enabled": 1, "name": ["!=", "Guest"]}, pluck="name"
		)
		programs = frappe.get_all("Loyalty Program", pluck="name", limit=1)
		if not (customers and portal and programs):
			self.skipTest("the site has no customer, portal account or loyalty program")
		self.customer, self.program = customers[0], programs[0]
		self.portal = next(
			(u for u in portal if not frappe.has_permission("Customer", "read", user=u)), None
		)
		if not self.portal:
			self.skipTest("every portal account of the site can read customers")
		self.cmd_before = frappe.local.form_dict.get("cmd")

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.local.form_dict.pop("cmd", None)
		if getattr(self, "cmd_before", None):
			frappe.local.form_dict["cmd"] = self.cmd_before

	def call_as(self, user, as_endpoint):
		frappe.set_user(user)
		if as_endpoint:
			frappe.local.form_dict["cmd"] = self.ENDPOINT
		else:
			frappe.local.form_dict.pop("cmd", None)
		return lp.get_loyalty_program_details_with_points(self.customer, loyalty_program=self.program)

	def test_a_portal_account_cannot_read_another_customers_loyalty_details_over_http(self):
		with self.assertRaises(frappe.PermissionError):
			self.call_as(self.portal, as_endpoint=True)

	def test_staff_who_read_the_customer_still_get_them_over_http(self):
		self.assertIn("loyalty_points", self.call_as("Administrator", as_endpoint=True))

	def test_the_web_shop_reading_its_own_customer_in_process_is_not_blocked(self):
		"""Not called as the endpoint: webshop pages, checkout and cart run it as the portal account."""
		self.assertIn("loyalty_points", self.call_as(self.portal, as_endpoint=False))
