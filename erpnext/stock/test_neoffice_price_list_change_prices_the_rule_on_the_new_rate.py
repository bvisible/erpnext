# //// Neoffice — added file (no upstream equivalent). After a price list change, apply_price_list_on_item handed the
# //// pricing rules the OLD price_list_rate the form still held, so a 10 % rule was worked out on the old price
# //// (neoffice-maintenance#1073). The form's side (transaction.js drop_stale_discount_amount) is proven in a browser.

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from erpnext.stock import get_item_details

OLD_RATE = 100.0
NEW_RATE = 80.0


class TestAPriceListChangePricesTheRuleOnTheNewRate(FrappeTestCase):
	def _rate_seen_by_the_rules(self, looked_up):
		seen = {}

		def rules(args, doc=None):
			seen["price_list_rate"] = args.price_list_rate
			return frappe._dict()

		args = frappe._dict(
			{
				"item_code": "_Test Item",
				"doctype": "Quotation",
				"parenttype": "Quotation",
				"price_list": "_Test Price List",
				"price_list_rate": OLD_RATE,  # what the form sends: the rate of the price list it leaves
				"qty": 1,
				"conversion_factor": 1,
			}
		)
		with (
			patch.object(get_item_details, "get_price_list_rate", return_value=frappe._dict(looked_up)),
			patch.object(get_item_details, "get_pricing_rule_for_item", side_effect=rules),
		):
			details = get_item_details.apply_price_list_on_item(args)
		return seen["price_list_rate"], details

	def test_the_rules_read_the_rate_of_the_new_price_list(self):
		seen, details = self._rate_seen_by_the_rules({"price_list_rate": NEW_RATE})
		self.assertEqual(seen, NEW_RATE)
		self.assertEqual(details.price_list_rate, NEW_RATE)

	def test_an_item_the_new_list_does_not_price_keeps_the_rate_it_had(self):
		seen, _details = self._rate_seen_by_the_rules({})
		self.assertEqual(seen, OLD_RATE)
