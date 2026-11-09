# //// Neoffice — added file (no upstream equivalent). When a bracket of a shipping rule costs 0.00 (« free above 500 »)
# //// ShippingRule.apply took the rule off the document, and the controller applies a rule only while the document
# //// names it: the rule never came back when the order was reduced below the threshold
# //// (neoffice-maintenance#1466, point 1).

import frappe
from frappe.tests.utils import FrappeTestCase

RULE = "_Test Shipping Rule - Free Above 500"
COMPANY = "_Test Company"


def free_above_500():
	"""A Net Total rule: 50.00 up to 500, free above (a bracket at 0.00 with no upper limit).

	Not inserted: apply() reads the rule as it stands."""
	rule = frappe.new_doc("Shipping Rule")
	rule.update(
		{
			"name": RULE,
			"label": RULE,
			"shipping_rule_type": "Selling",
			"calculate_based_on": "Net Total",
			"company": COMPANY,
			"account": "_Test Account Shipping Charges - _TC",
			"cost_center": "_Test Cost Center - _TC",
		}
	)
	rule.append("conditions", {"from_value": 0, "to_value": 500, "shipping_amount": 50})
	rule.append("conditions", {"from_value": 500.01, "to_value": 0, "shipping_amount": 0})
	return rule


def order_of(net_total):
	"""A Sales Order in memory that names the rule, with the net total the rule reads."""
	doc = frappe.new_doc("Sales Order")
	doc.company = COMPANY
	doc.currency = doc.company_currency  # the company's, so that nothing is converted
	doc.conversion_rate = 1
	doc.base_net_total = net_total
	doc.shipping_rule = RULE
	return doc


def shipping_rows(doc, rule):
	return [tax for tax in doc.taxes if tax.account_head == rule.account]


class TestShippingRuleStaysOnTheDocument(FrappeTestCase):
	def test_the_rule_stays_on_the_order_when_its_bracket_costs_nothing(self):
		rule, doc = free_above_500(), order_of(602.22)
		rule.apply(doc)
		self.assertEqual(doc.shipping_rule, RULE)
		self.assertEqual(doc.shipping_rule_rate, 0)
		self.assertFalse(shipping_rows(doc, rule), "a free shipping leaves no row on the taxes")

	def test_the_charge_comes_back_when_the_order_is_reduced(self):
		rule, doc = free_above_500(), order_of(602.22)
		rule.apply(doc)
		doc.base_net_total = 450

		# the controller applies the rule the document still names, at the next recalculation
		self.assertEqual(doc.shipping_rule, RULE)
		rule.apply(doc)
		self.assertEqual([row.tax_amount for row in shipping_rows(doc, rule)], [50])
		self.assertEqual(doc.shipping_rule, RULE)
