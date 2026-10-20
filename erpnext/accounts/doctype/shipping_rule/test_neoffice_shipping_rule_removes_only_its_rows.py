# //// Neoffice — added file (no upstream equivalent). When a shipping charge falls to 0 our ShippingRule.apply
# //// removes the rows the rule added; it must not take other tax rows whose description merely contains
# //// "port", "multi" or "delivery" (« Taxe d'importation », « Transport »…) (neoffice-maintenance#1769).

from unittest import mock

import frappe
from frappe.tests.utils import FrappeTestCase

MODULE = "erpnext.accounts.doctype.shipping_rule.shipping_rule"


def _row(account_head, description):
	return frappe._dict(account_head=account_head, description=description)


class TestShippingRuleRemovesOnlyItsRows(FrappeTestCase):
	def test_a_free_shipping_removes_the_rules_rows_and_nothing_else(self):
		rule = frappe.new_doc("Shipping Rule")
		rule.label = "Livraison"
		rule.account = "Frais de livraison - T"
		doc = frappe._dict(
			taxes=[
				_row("TVA 8.1% - T", "TVA 8.1%"),
				_row("Frais de livraison - T", "Livraison"),
				_row("TVA 8.1% - T", "Livraison - TVA 8.1% - T (8.1%)"),
				_row("Droits de douane - T", "Taxe d'importation"),
				_row("Frais divers - T", "Transport spécial"),
				_row("Frais divers - T", "Multiplicateur de frais"),
			]
		)
		rules = [frappe._dict(account="Frais de livraison - T", label="Livraison")]
		with mock.patch(f"{MODULE}.frappe.get_all", return_value=rules):
			rule.remove_shipping_charges_from_tax_table(doc)
		self.assertEqual(
			[row.description for row in doc.taxes],
			["TVA 8.1%", "Taxe d'importation", "Transport spécial", "Multiplicateur de frais"],
		)
