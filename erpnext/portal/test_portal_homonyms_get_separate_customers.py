# //// Neoffice — added file (no upstream equivalent). Two Website Users who share a full name must each
# //// get their OWN Customer: the portal login hook (create_customer_or_supplier) must never link the
# //// second account to the first's Customer, or the second sees the first's orders and invoices
# //// (neoffice-maintenance#1756).

import unittest

import frappe
from frappe.tests.utils import FrappeTestCase

from erpnext.portal.utils import create_customer_or_supplier

USERS = ["homonym-a-1756@yopmail.com", "homonym-b-1756@yopmail.com"]


class TestPortalHomonymsGetSeparateCustomers(FrappeTestCase):
    @staticmethod
    def _purge():
        """Clean slate so the test does not depend on what an earlier run left (the hook can commit)."""
        frappe.set_user("Administrator")
        for email in USERS:
            for pu in frappe.get_all("Portal User", filters={"user": email}, fields=["parent", "parenttype"]):
                if frappe.db.exists(pu.parenttype, pu.parent):
                    frappe.delete_doc(pu.parenttype, pu.parent, force=True, ignore_permissions=True)
            for ce in frappe.get_all("Contact Email", filters={"email_id": email}, fields=["parent"]):
                if frappe.db.exists("Contact", ce.parent):
                    frappe.delete_doc("Contact", ce.parent, force=True, ignore_permissions=True)
            if frappe.db.exists("User", email):
                frappe.delete_doc("User", email, force=True, ignore_permissions=True)
        frappe.db.commit()  # nosemgrep: the purge and the users must survive each test's rollback

    @classmethod
    def setUpClass(cls):
        # the portal hook reads Webshop Settings, a doctype of the webshop app: without it the test cannot run the
        # real path (the CI job of this module installs webshop; a plain erpnext site does not)
        if "webshop" not in frappe.get_installed_apps():
            raise unittest.SkipTest("webshop is not installed on this site")
        super().setUpClass()
        cls._role = frappe.db.get_single_value("Portal Settings", "default_role")
        frappe.db.set_single_value("Portal Settings", "default_role", "Customer")
        cls._purge()
        for email in USERS:
            user = frappe.get_doc(
                {
                    "doctype": "User",
                    "email": email,
                    "first_name": "Homonym",
                    "last_name": "Dupont",
                    "user_type": "Website User",
                    "send_welcome_email": 0,
                }
            ).insert(ignore_permissions=True)
            user.add_roles("Customer")
        frappe.db.commit()  # nosemgrep: the users must outlive each test's rollback

    @classmethod
    def tearDownClass(cls):
        cls._purge()
        if cls._role is not None:
            frappe.db.set_single_value("Portal Settings", "default_role", cls._role)
        frappe.db.commit()  # nosemgrep: undo the committed users
        super().tearDownClass()

    def tearDown(self):
        frappe.set_user("Administrator")

    def test_two_homonyms_do_not_share_a_customer(self):
        names = []
        for email in USERS:
            frappe.set_user(email)
            party = create_customer_or_supplier()
            names.append(party.name if party else None)
        frappe.set_user("Administrator")
        self.assertTrue(all(names), f"both homonyms must get a Customer, got {names}")
        self.assertNotEqual(names[0], names[1], f"homonyms must not share one Customer: {names}")
