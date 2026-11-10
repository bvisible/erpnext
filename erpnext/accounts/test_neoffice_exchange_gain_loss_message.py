# //// Neoffice — added file (no upstream equivalent): the refusal of an exchange gain/loss journal without the
# //// company's Exchange Gain/Loss Account links the company, where the account is set (neoffice-maintenance#2325).
import frappe
from frappe.tests.utils import FrappeTestCase

from erpnext.accounts.utils import create_gain_loss_journal


class TestNeofficeExchangeGainLossMessage(FrappeTestCase):
	def test_the_refusal_links_the_company(self):
		company = frappe.db.get_value("Company", {}, "name")
		with self.assertRaises(frappe.ValidationError) as refused:
			create_gain_loss_journal(
				company,
				None,
				"Customer",
				None,
				None,
				None,
				0,
				"debit",
				"credit",
				None,
				None,
				None,
				None,
				None,
				None,
				None,
				None,
			)
		message = str(refused.exception)
		self.assertIn("/app/company/", message)
		self.assertIn(company, message)
