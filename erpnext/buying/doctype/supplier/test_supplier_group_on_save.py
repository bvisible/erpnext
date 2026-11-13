# //// Neoffice — added file (no upstream equivalent): the fork's rule for a group-type Supplier Group (supplier.py,
# //// validate_supplier_group, neoffice-maintenance#2648).
"""A supplier already in a group-type Supplier Group still saves; a new one, or a group changed to one, is refused.

Upstream v15.125.0 refuses a group-type Supplier Group at every save of a supplier. Most suppliers of our instances sit
in the root "All Supplier Groups", the default of Buying Settings: an IBAN added to one, from the purchase invoice of a
scan, failed to save. The fork applies the check where a group is chosen, as it does for the customer.
"""

import frappe
from frappe import _
from frappe.tests.roles import as_role
from frappe.tests.utils import FrappeTestCase


class TestTheGroupOfASupplierOnSave(FrappeTestCase):
	def setUp(self):
		self.root = frappe.db.get_value("Supplier Group", {"is_group": 1}, "name")
		self.leaf = frappe.db.get_value("Supplier Group", {"is_group": 0}, "name")
		if not (self.root and self.leaf):
			self.skipTest("the site has no Supplier Group that is a group and one that is not")

	def a_supplier_saved_before(self, group):
		"""A supplier saved before v15.125.0 in `group`: made in a leaf, then moved as the old rule let it be."""
		with as_role("client_admin"):
			doc = frappe.new_doc("Supplier")
			doc.supplier_name = f"_Test Group Rule {frappe.generate_hash(length=8)}"
			doc.supplier_group = self.leaf
			doc.insert()
		frappe.db.set_value("Supplier", doc.name, "supplier_group", group, update_modified=False)
		return frappe.get_doc("Supplier", doc.name)

	def test_a_supplier_already_in_a_group_type_group_still_saves(self):
		doc = self.a_supplier_saved_before(self.root)
		with as_role("client_admin"):
			doc.website = "https://example.com"
			doc.save()
		self.assertEqual(frappe.db.get_value("Supplier", doc.name, "website"), "https://example.com")
		self.assertEqual(frappe.db.get_value("Supplier", doc.name, "supplier_group"), self.root)

	def test_a_new_supplier_in_a_group_type_group_is_refused(self):
		doc = frappe.new_doc("Supplier")
		doc.supplier_name = f"_Test Group Rule {frappe.generate_hash(length=8)}"
		doc.supplier_group = self.root
		with as_role("client_admin"), self.assertRaises(frappe.ValidationError) as refused:
			doc.insert()
		self.assertIn(
			_("Cannot select a Group type Supplier Group. Please select a non-group Supplier Group."),
			str(refused.exception),
		)

	def test_a_group_changed_to_a_group_type_one_is_refused(self):
		doc = self.a_supplier_saved_before(self.leaf)
		doc.supplier_group = self.root
		with as_role("client_admin"), self.assertRaises(frappe.ValidationError) as refused:
			doc.save()
		self.assertIn(
			_("Cannot select a Group type Supplier Group. Please select a non-group Supplier Group."),
			str(refused.exception),
		)
