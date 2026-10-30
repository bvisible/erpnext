# //// Neoffice — added file (no upstream equivalent): the "Manage Stock" choice of the multiple-variants dialog (3594a46c69)
# //// rides in the attribute map; unchecked it is 0, and the empty-value filter used to drop it before it was read.
import frappe
from frappe.tests.utils import FrappeTestCase

from erpnext.controllers.item_variant import create_multiple_variants

ATTRIBUTE = "_Test Neoffice Size"
TEMPLATE = "_Test Neoffice Variant Template"


class TestManageStockChoiceOfMultipleVariants(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		if not frappe.db.exists("Item Attribute", ATTRIBUTE):
			frappe.get_doc(
				{
					"doctype": "Item Attribute",
					"attribute_name": ATTRIBUTE,
					"item_attribute_values": [
						{"attribute_value": value, "abbr": value} for value in ("S", "M", "L")
					],
				}
			).insert(ignore_permissions=True)
		if not frappe.db.exists("Item", TEMPLATE):
			frappe.get_doc(
				{
					"doctype": "Item",
					"item_code": TEMPLATE,
					"item_name": TEMPLATE,
					"item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
					"stock_uom": "Nos",
					"is_stock_item": 1,
					"has_variants": 1,
					"attributes": [{"attribute": ATTRIBUTE}],
				}
			).insert(ignore_permissions=True)

	@classmethod
	def tearDownClass(cls):
		for name in frappe.get_all("Item", filters={"variant_of": TEMPLATE}, pluck="name"):
			frappe.delete_doc("Item", name, force=True, ignore_permissions=True)
		frappe.delete_doc("Item", TEMPLATE, force=True, ignore_permissions=True)
		frappe.delete_doc("Item Attribute", ATTRIBUTE, force=True, ignore_permissions=True)
		super().tearDownClass()

	def is_stock_item_of(self, value):
		return frappe.db.get_value("Item", {"variant_of": TEMPLATE, "item_name": ("like", f"%{value}")}, "is_stock_item")

	def test_unchecked_manage_stock_creates_non_stock_variants(self):
		created = create_multiple_variants(TEMPLATE, {ATTRIBUTE: ["S"], "is_stock_item": 0})
		self.assertEqual(created, 1)
		self.assertEqual(self.is_stock_item_of("S"), 0)

	def test_checked_manage_stock_creates_stock_variants(self):
		create_multiple_variants(TEMPLATE, {ATTRIBUTE: ["M"], "is_stock_item": 1})
		self.assertEqual(self.is_stock_item_of("M"), 1)

	def test_a_caller_that_does_not_send_the_choice_keeps_the_template_default(self):
		create_multiple_variants(TEMPLATE, {ATTRIBUTE: ["L"]})
		self.assertEqual(self.is_stock_item_of("L"), 1)
