# //// Neoffice — added file (no upstream equivalent). `make_contact` used to look an existing Contact up
# //// by e-mail alone and re-insert it as the new party's own: a customer created with an e-mail another
# //// contact already carried (a placeholder typed in the quick-entry dialog, a shared mailbox) got a
# //// COPY of that other contact, still linked to the other customer and carrying the new customer's
# //// typed name, and its primary contact pointed at the copy. Its contact panel then showed nobody,
# //// and the « primary contact » field named a stranger.

import frappe
from frappe.tests.utils import FrappeTestCase

PREFIX = "Zz Contact Test"
SHARED_EMAIL = "shared-contact-test@yopmail.com"
ORPHAN_EMAIL = "orphan-contact-test@yopmail.com"


def _links(contact):
    """The customers a contact is linked to (the helpdesk's mirror links are another matter)."""
    return {
        (row.link_doctype, row.link_name)
        for row in frappe.get_doc("Contact", contact).links
        if row.link_doctype == "Customer"
    }


def _primary_contact(customer):
    return frappe.db.get_value("Customer", customer, "customer_primary_contact")


class TestMakeContactKeepsAContactWithItsOwnParty(FrappeTestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        self._purge()

    def tearDown(self):
        self._purge()

    @staticmethod
    def _purge():
        names = frappe.get_all("Customer", filters={"customer_name": ["like", f"{PREFIX}%"]}, pluck="name")
        for contact in frappe.get_all(
            "Dynamic Link",
            filters={"parenttype": "Contact", "link_doctype": "Customer", "link_name": ["in", names or [""]]},
            pluck="parent",
        ):
            if frappe.db.exists("Contact", contact):
                frappe.delete_doc("Contact", contact, force=True, ignore_permissions=True)
        for name in names:
            frappe.db.set_value("Customer", name, "customer_primary_contact", None)
            frappe.delete_doc("Customer", name, force=True, ignore_permissions=True)
        for contact in frappe.get_all(
            "Contact", filters={"first_name": ["like", f"{PREFIX}%"]}, pluck="name"
        ):
            frappe.delete_doc("Contact", contact, force=True, ignore_permissions=True)

    @staticmethod
    def _customer(suffix, **values):
        return frappe.get_doc(
            {
                "doctype": "Customer",
                "customer_name": f"{PREFIX} {suffix}",
                "customer_type": "Individual",
                "customer_group": frappe.db.get_value("Customer Group", {"is_group": 0}),
                "territory": frappe.db.get_value("Territory", {"is_group": 0}),
                **values,
            }
        ).insert(ignore_permissions=True)

    def test_a_second_customer_with_the_same_email_gets_a_contact_of_its_own(self):
        first = self._customer("A", email_id=SHARED_EMAIL, first_name="Alice", last_name="First")
        second = self._customer("B", email_id=SHARED_EMAIL, first_name="Bob", last_name="Second")

        first_contact = _primary_contact(first.name)
        second_contact = _primary_contact(second.name)

        self.assertTrue(first_contact and second_contact, "both customers must get a primary contact")
        self.assertNotEqual(first_contact, second_contact, "the second customer must not share the first's contact")
        self.assertEqual(
            _links(second_contact),
            {("Customer", second.name)},
            "the second customer's contact must be linked to the second customer, and to nobody else",
        )
        self.assertEqual(
            _links(first_contact),
            {("Customer", first.name)},
            "the first customer's contact must stay the first customer's, alone",
        )

    def test_the_first_customers_contact_keeps_its_own_names(self):
        first = self._customer("A", email_id=SHARED_EMAIL, first_name="Alice", last_name="First")
        self._customer("B", email_id=SHARED_EMAIL, first_name="Bob", last_name="Second")

        contact = frappe.get_doc("Contact", _primary_contact(first.name))
        self.assertEqual((contact.first_name, contact.last_name), ("Alice", "First"))

    def test_a_contact_nobody_owns_is_adopted_not_duplicated(self):
        orphan = frappe.get_doc(
            {
                "doctype": "Contact",
                "first_name": f"{PREFIX} Orphan",
                "email_ids": [{"email_id": ORPHAN_EMAIL, "is_primary": 1}],
            }
        ).insert(ignore_permissions=True)

        customer = self._customer("C", email_id=ORPHAN_EMAIL)

        self.assertEqual(_primary_contact(customer.name), orphan.name)
        self.assertEqual(_links(orphan.name), {("Customer", customer.name)})
        self.assertEqual(frappe.db.count("Contact", {"email_id": ORPHAN_EMAIL}), 1)

    def test_a_customer_without_email_never_takes_a_contact_without_email(self):
        """A missing e-mail used to filter on an empty one, which every e-mail-less contact matches."""
        stranger = self._customer("D", email_id=SHARED_EMAIL, first_name="Dora", last_name="Stranger")
        stranger_contact = _primary_contact(stranger.name)
        frappe.db.delete("Contact Email", {"parent": stranger_contact})
        frappe.db.set_value("Contact", stranger_contact, "email_id", None)

        customer = self._customer("E", mobile_no="+41 79 000 00 00")

        contact = _primary_contact(customer.name)
        self.assertTrue(contact)
        self.assertNotEqual(contact, stranger_contact)
        self.assertEqual(_links(contact), {("Customer", customer.name)})
        self.assertEqual(_links(stranger_contact), {("Customer", stranger.name)})
