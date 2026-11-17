# //// Neoffice — added file (no upstream equivalent).
"""An account bound to some companies reads no timesheet and no stock movement of another company in the reports that read them
past its permissions (neoffice-maintenance#2838).

« Employee Billing Summary » and « Project Billing Summary » read the timesheets with get_all, « Itemwise Recommended Reorder Level »
reads the stock ledger in SQL, and none of them has a company filter: an account bound to one company by a User Permission on
« Company » read every company's hours, billing amounts and consumption. They now keep to its companies; nothing changes for an
account without a bound, nor for a bound that applies to other doctypes only.

The timesheet and the stock movement are scenery, written as rows of a company that need not exist; every read is the reader's.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, nowdate

from erpnext.projects.report.employee_billing_summary import employee_billing_summary
from erpnext.stock.report.itemwise_recommended_reorder_level import (
	itemwise_recommended_reorder_level as reorder_level,
)

READER = "test_2838_bound_reader@example.com"
OWN = "_Test Company 2838 Own"
OTHER = "_Test Company 2838 Other"
ITEM = "_Test Item 2838 Consumed"


class TestABoundAccountReadsNoTimesheetOrStockOfAnotherCompany(FrappeTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		frappe.get_doc(
			{
				"doctype": "User",
				"email": READER,
				"first_name": "Bound Reader 2838",
				"send_welcome_email": 0,
				"roles": [{"role": "Accounts User"}],
			}
		).insert()
		self.timesheet = self.a_timesheet_of(OTHER)
		self.a_consumption_of(OTHER)

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.rollback()
		frappe.cache.hdel("user_permissions", READER)

	def a_timesheet_of(self, company):
		name = "_T-2838-" + frappe.generate_hash(length=8)
		frappe.get_doc(
			{
				"doctype": "Timesheet",
				"name": name,
				"company": company,
				"employee": "_T-2838-EMP",
				"employee_name": "Timesheet 2838",
				"start_date": nowdate(),
				"end_date": nowdate(),
				"docstatus": 1,
			}
		).db_insert()
		frappe.get_doc(
			{
				"doctype": "Timesheet Detail",
				"name": frappe.generate_hash(length=10),
				"parent": name,
				"parenttype": "Timesheet",
				"parentfield": "time_logs",
				"from_time": f"{nowdate()} 08:00:00",
				"to_time": f"{nowdate()} 10:00:00",
				"hours": 2,
				"is_billable": 1,
				"billing_hours": 2,
				"billing_rate": 100,
			}
		).db_insert()
		return name

	def a_consumption_of(self, company):
		frappe.get_doc(
			{
				"doctype": "Stock Ledger Entry",
				"name": frappe.generate_hash(length=10),
				"company": company,
				"item_code": ITEM,
				"warehouse": "_Test Warehouse 2838",
				"posting_date": nowdate(),
				"posting_time": "10:00:00",
				"voucher_type": "Stock Entry",
				"voucher_no": "_T-2838-SE",
				"actual_qty": -5,
				"is_cancelled": 0,
			}
		).db_insert()

	def bind(self, company, applicable_for=None):
		frappe.get_doc(
			{
				"doctype": "User Permission",
				"name": frappe.generate_hash(length=10),
				"user": READER,
				"allow": "Company",
				"for_value": company,
				"apply_to_all_doctypes": 0 if applicable_for else 1,
				"applicable_for": applicable_for,
			}
		).db_insert()
		frappe.cache.hdel("user_permissions", READER)

	def read_as_the_reader(self):
		"""Whether the reader reads the other company's timesheet and its consumption."""
		period = {"from_date": add_days(nowdate(), -1), "to_date": add_days(nowdate(), 1)}
		frappe.set_user(READER)
		try:
			billed = {row["timesheet"] for row in employee_billing_summary.execute(dict(period))[1]}
			consumed = reorder_level.get_consumed_items(frappe._dict(period))
			return {"timesheet": self.timesheet in billed, "consumption": ITEM in consumed}
		finally:
			frappe.set_user("Administrator")

	def test_the_timesheet_and_the_consumption_of_another_company_are_not_read(self):
		self.bind(OWN)
		self.assertEqual(self.read_as_the_reader(), {"timesheet": False, "consumption": False})

	def test_those_of_the_bound_company_are_still_read(self):
		self.bind(OTHER)
		self.assertEqual(self.read_as_the_reader(), {"timesheet": True, "consumption": True})

	def test_nothing_changes_for_an_account_without_a_bound(self):
		self.assertEqual(self.read_as_the_reader(), {"timesheet": True, "consumption": True})

	def test_a_bound_that_applies_to_another_doctype_leaves_the_reports_alone(self):
		self.bind(OWN, applicable_for="Sales Invoice")
		self.assertEqual(self.read_as_the_reader(), {"timesheet": True, "consumption": True})
