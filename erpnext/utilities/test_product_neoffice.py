# //// Neoffice — added file (no upstream equivalent): get_price (webshop and till prices) with a
# //// Pricing Rule. Upstream 15.124.0 takes a "Discount Amount" rule off the price list rate itself;
# //// our own subtraction was left next to it by the merge and the discount was taken twice.
# //// The test fails on that code (price 80 instead of 90).
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from erpnext.stock.doctype.item.test_item import make_item
from erpnext.utilities.product import get_price

ITEM = "_Test Neoffice Get Price Item"
PRICE_LIST = "_Test Neoffice Get Price List"


class TestGetPriceWithAPricingRule(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		make_item(ITEM, {"is_stock_item": 0})
		if not frappe.db.exists("Price List", PRICE_LIST):
			frappe.get_doc(
				{
					"doctype": "Price List",
					"price_list_name": PRICE_LIST,
					"currency": "EUR",
					"selling": 1,
					"enabled": 1,
				}
			).insert()
		frappe.get_doc(
			{
				"doctype": "Item Price",
				"item_code": ITEM,
				"price_list": PRICE_LIST,
				"price_list_rate": 100,
				"selling": 1,
			}
		).insert()
		cls.company = frappe.db.get_value("Company", {}, "name")

	def price_with(self, rule):
		"""The price get_price returns when `rule` is the Pricing Rule that applies."""
		with patch("erpnext.utilities.product.get_pricing_rule_for_item", return_value=frappe._dict(rule)):
			return get_price(ITEM, PRICE_LIST, "All Customer Groups", self.company)

	def test_without_a_rule_the_price_list_rate_stands(self):
		with patch("erpnext.utilities.product.get_pricing_rule_for_item", return_value=None):
			price = get_price(ITEM, PRICE_LIST, "All Customer Groups", self.company)
		self.assertEqual(flt(price.price_list_rate), 100)

	def test_a_discount_amount_is_taken_off_once(self):
		price = self.price_with({"pricing_rule_for": "Discount Amount", "discount_amount": 10})
		self.assertEqual(flt(price.price_list_rate), 90)
		self.assertEqual(flt(price.mrp), 100)

	def test_a_discount_percentage_is_taken_off_once(self):
		price = self.price_with({"pricing_rule_for": "Discount Percentage", "discount_percentage": 20})
		self.assertEqual(flt(price.price_list_rate), 80)

	def test_a_rate_rule_replaces_the_rate(self):
		price = self.price_with({"pricing_rule_for": "Rate", "price_list_rate": 70})
		self.assertEqual(flt(price.price_list_rate), 70)
