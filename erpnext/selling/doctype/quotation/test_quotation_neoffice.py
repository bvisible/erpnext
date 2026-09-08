# //// Neoffice — added file (no upstream equivalent). Second half of #270.
# ////
# //// set_expired_status() is a RAW SQL UPDATE. No hook, no controller, no validation runs
# //// on it — which is exactly why it could flip a SIGNED offer to 'Expired' and nothing
# //// could defend it (9bf5608ecd, seen on DEVIS-2026-00093: accepted 2026-08-18, expired
# //// 2026-09-01, the acceptance vanished from the list view of the people waiting for it).
# ////
# //// A test that only read the SQL string would prove nothing about what the database
# //// does, so this one writes real rows and reads back what the statement left. It never
# //// calls submit(): submit() commits, and this must roll back cleanly. docstatus is set
# //// on the column directly, which is all the statement looks at.
import unittest

import frappe
from frappe.utils import add_days, nowdate


class TestQuotationExpiryKeepsAccepted(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		cls.company = frappe.db.get_value("Company", {}, "name")
		cls.customer = frappe.db.get_value("Customer", {"disabled": 0}, "name")
		cls.item = frappe.db.get_value("Item", {"disabled": 0, "is_sales_item": 1}, "name")
		if not (cls.company and cls.customer and cls.item):
			raise unittest.SkipTest("no company / customer / item on this site")

	def tearDown(self):
		frappe.db.rollback()

	def _expired_quotation(self, status):
		"""A submitted quotation whose validity has passed, carrying `status`."""
		doc = frappe.get_doc(
			{
				"doctype": "Quotation",
				"quotation_to": "Customer",
				"party_name": self.customer,
				"company": self.company,
				"transaction_date": add_days(nowdate(), -30),
				"valid_till": add_days(nowdate(), -1),  # yesterday: the job's target
				"order_type": "Sales",
				"items": [{"item_code": self.item, "qty": 1, "rate": 100}],
			}
		)
		doc.insert(ignore_permissions=True)
		# NOT submit(): it commits, and this test must roll back. The statement under test
		# reads docstatus and status as columns, so setting them is enough.
		frappe.db.set_value("Quotation", doc.name, "docstatus", 1, update_modified=False)
		frappe.db.set_value("Quotation", doc.name, "status", status, update_modified=False)
		return doc.name

	def _status(self, name):
		return frappe.db.get_value("Quotation", name, "status")

	def test_a_signed_offer_survives_the_daily_expiry_job(self):
		"""9bf5608ecd. 'Accepted' is OUR status (the public acceptance link in
		neoffice_theme). Upstream only knows Open/Ordered, so its exclusion list did not
		hold it and the job expired an offer the customer had already signed."""
		from erpnext.selling.doctype.quotation.quotation import set_expired_status

		accepted = self._expired_quotation("Accepted")
		set_expired_status()
		self.assertEqual(
			self._status(accepted),
			"Accepted",
			"a signed offer must not be expired by the daily job",
		)

	def test_an_offer_nobody_answered_still_expires(self):
		"""The other direction: the guard must not stop the job doing its actual work.
		Without this, setting the status list to everything would pass the test above."""
		from erpnext.selling.doctype.quotation.quotation import set_expired_status

		open_quote = self._expired_quotation("Open")
		set_expired_status()
		self.assertEqual(
			self._status(open_quote),
			"Expired",
			"an offer past its validity that nobody accepted must still expire",
		)

	def test_the_two_travel_together(self):
		"""Both rows in ONE run of the job: the statement has to tell them apart, which a
		test running them separately would not prove."""
		from erpnext.selling.doctype.quotation.quotation import set_expired_status

		accepted = self._expired_quotation("Accepted")
		open_quote = self._expired_quotation("Open")
		set_expired_status()
		self.assertEqual(self._status(accepted), "Accepted")
		self.assertEqual(self._status(open_quote), "Expired")

	def test_a_lost_offer_is_left_alone(self):
		"""Upstream's own exclusions must survive our addition to the list."""
		from erpnext.selling.doctype.quotation.quotation import set_expired_status

		lost = self._expired_quotation("Lost")
		set_expired_status()
		self.assertEqual(self._status(lost), "Lost")
