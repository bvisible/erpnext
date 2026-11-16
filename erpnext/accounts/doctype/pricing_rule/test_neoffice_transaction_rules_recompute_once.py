# //// Neoffice — added file (no upstream equivalent).
"""A transaction pricing rule that sets nothing does not recompute the document again (maintenance#2429).

apply_pricing_rule_on_transaction recomputed the whole document after every transaction rule of price that passed its
filters, a coupon-based rule without its coupon included: on a shop every coupon and gift card has its rule, and an order
paid on invoice was recomputed 43 times per save, 258 times in all, 0.7 s of its 4 s on a copy of a working site. The first
rule still recomputes, as upstream does; a later one recomputes only when the discount differs from the one the document
was last recomputed with.

The rules and the document are the function's own inputs, given here in memory: the database is not read (the queries, the
filters and the bookkeeping of the applied rules are stubbed), nothing is written.
"""

import unittest
from unittest.mock import patch

import frappe
from frappe.utils import flt

from erpnext.accounts.doctype.pricing_rule import utils


class _Doc(frappe._dict):
	"""A selling document as the function reads it: its totals, its discount, and a counter of its recomputations.

	Its computation does what the real one does with the discount: a percentage gives the discount amount."""

	doctype = "Quotation"
	name = "_Test Quotation 2429"

	def __init__(self, **values):
		super().__init__(
			total_qty=2,
			total=100,
			grand_total=100,
			apply_discount_on="Grand Total",
			additional_discount_percentage=0,
			discount_amount=0,
		)
		self.update(values)
		self.recomputed = 0

	def set(self, key, value):
		self[key] = value

	def calculate_taxes_and_totals(self):
		self.recomputed += 1
		if self.additional_discount_percentage:
			self.discount_amount = flt(self.total * self.additional_discount_percentage / 100)
		self.grand_total = self.total - flt(self.discount_amount)

	def validate_all_documents_schedule(self):
		pass


def _rule(name, **values):
	rule = frappe._dict(
		name=name,
		price_or_product_discount="Price",
		discount_percentage=0,
		discount_amount=0,
		coupon_code_based=0,
		validate_applied_rule=0,
		apply_discount_on="Grand Total",
	)
	rule.update(values)
	return rule


class TestATransactionRuleThatSetsNothingDoesNotRecomputeAgain(unittest.TestCase):
	def apply(self, doc, rules):
		with (
			patch.object(utils, "get_other_conditions", lambda conditions, values, doc: conditions),
			patch.object(utils.frappe.db, "sql", lambda *args, **kwargs: rules),
			patch.object(utils, "get_transaction_pricing_rules", lambda doc: set()),
			patch.object(utils, "is_transaction_discount_changed", lambda doc: False),
			patch.object(utils, "filter_pricing_rules_for_qty_amount", lambda qty, amount, rules: rules),
			patch.object(utils, "filter_pricing_rule_based_on_condition", lambda rules, doc: rules),
			patch.object(utils, "set_transaction_pricing_rules", lambda doc, applied: None),
		):
			utils.apply_pricing_rule_on_transaction(doc)

	def test_coupon_rules_without_their_coupon_recompute_once(self):
		doc = _Doc()
		coupons = [
			_rule(f"_Test coupon rule {n}", discount_percentage=10, coupon_code_based=1) for n in range(40)
		]

		self.apply(doc, coupons)

		self.assertEqual(doc.recomputed, 1)
		self.assertEqual(doc.additional_discount_percentage, 0)
		self.assertEqual(doc.grand_total, 100)

	def test_a_rule_that_changes_the_discount_is_recomputed(self):
		doc = _Doc()
		rules = [
			_rule("_Test coupon rule", discount_percentage=10, coupon_code_based=1),
			_rule("_Test five percent", discount_percentage=5),
			_rule("_Test another coupon rule", discount_amount=20, coupon_code_based=1),
		]

		self.apply(doc, rules)

		self.assertEqual(doc.additional_discount_percentage, 5)
		self.assertEqual(doc.grand_total, 95)
		self.assertEqual(doc.recomputed, 2)

	def test_the_discount_amount_the_computation_sets_is_not_taken_for_a_change(self):
		doc = _Doc()
		rules = [_rule("_Test ten percent", discount_percentage=10)] + [
			_rule(f"_Test coupon rule {n}", discount_amount=20, coupon_code_based=1) for n in range(5)
		]

		self.apply(doc, rules)

		self.assertEqual(doc.discount_amount, 10)
		self.assertEqual(doc.grand_total, 90)
		self.assertEqual(doc.recomputed, 1)

	def test_two_rules_that_set_the_same_discount_recompute_once(self):
		doc = _Doc()

		self.apply(
			doc,
			[
				_rule("_Test five percent", discount_percentage=5),
				_rule("_Test also five", discount_percentage=5),
			],
		)

		self.assertEqual(doc.grand_total, 95)
		self.assertEqual(doc.recomputed, 1)
