# //// Neoffice — added file (no upstream equivalent): tests of the security fixes taken from upstream
# //// version-15 ahead of the full merge (bvisible/neoffice-maintenance#1748). Each test fails on the code
# //// before its fix. The two users are made here: a site restored from production has no test users.
import frappe
from frappe.tests.utils import FrappeTestCase

PORTAL_USER = "neoffice-security-portal@example.com"
DESK_USER = "neoffice-security-desk@example.com"


class TestNeofficeSecurityBackports(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		for email, roles in ((PORTAL_USER, ["Customer"]), (DESK_USER, ["Accounts Manager"])):
			if not frappe.db.exists("User", email):
				user = frappe.get_doc(
					{
						"doctype": "User",
						"email": email,
						"first_name": "Neoffice Security",
						"send_welcome_email": 0,
					}
				).insert(ignore_permissions=True)
				user.add_roles(*roles)
		frappe.db.commit()

	@classmethod
	def tearDownClass(cls):
		frappe.set_user("Administrator")
		for email in (PORTAL_USER, DESK_USER):
			frappe.delete_doc("User", email, force=True, ignore_permissions=True)
		frappe.db.commit()
		super().tearDownClass()

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.rollback()

	def test_create_customer_makes_a_customer_and_nothing_else(self):
		# GHSA-x635-wr4c-7345, upstream 45b232d369: the request's own "doctype" key made any record
		from erpnext.crm.frappe_crm_api import create_customer

		intruder = "neoffice-security-intruder@example.com"
		customer_group = frappe.db.get_value("Customer Group", {"is_group": 0}, "name")
		territory = frappe.db.get_value("Territory", {"is_group": 0}, "name")
		frappe.set_user(PORTAL_USER)
		create_customer(
			frappe._dict(
				{
					"doctype": "User",
					"email": intruder,
					"first_name": "Intruder",
					"customer_name": "Neoffice Security Customer",
					"customer_type": "Company",
					"customer_group": customer_group,
					"territory": territory,
					"disabled": 1,
					"contacts": "[]",
				}
			)
		)

		frappe.set_user("Administrator")
		self.assertFalse(frappe.db.exists("User", intruder))
		customer = frappe.db.get_value(
			"Customer", {"customer_name": "Neoffice Security Customer"}, ["name", "disabled"], as_dict=True
		)
		self.assertTrue(customer)
		self.assertEqual(customer.disabled, 0)

	def test_a_booking_visitors_details_are_escaped_in_the_lead(self):
		# GHSA-rv4r-c8v3-3hrc, upstream 2ca71f16c4: the public booking page's free text reached the Lead raw
		appointment = frappe.new_doc("Appointment")
		appointment.customer_name = "Neoffice Security Visitor"
		appointment.customer_email = "neoffice-security-visitor@example.com"
		appointment.customer_details = '<img src="x" onerror="alert(1)">'
		appointment.create_lead_and_link()

		note = frappe.get_doc("Lead", appointment.party).notes[0].note
		self.assertNotIn("<img", note)
		self.assertIn("&lt;img", note)

	def test_a_cheque_print_format_is_built_by_a_system_manager_only(self):
		# GHSA-w996-r7v3-87wr, upstream 2f5b93e308: the Print Format built from a template is server-side Jinja
		from erpnext.accounts.doctype.cheque_print_template.cheque_print_template import (
			create_or_update_cheque_print_format,
		)

		template = frappe.get_doc({"doctype": "Cheque Print Template", "bank_name": "Neoffice Security Bank"})
		template.insert(ignore_permissions=True)

		frappe.set_user(DESK_USER)
		self.assertRaises(frappe.PermissionError, create_or_update_cheque_print_format, template.name)
		self.assertFalse(frappe.db.exists("Print Format", template.name))

		frappe.set_user("Administrator")
		create_or_update_cheque_print_format(template.name)
		self.assertTrue(frappe.db.exists("Print Format", template.name))
