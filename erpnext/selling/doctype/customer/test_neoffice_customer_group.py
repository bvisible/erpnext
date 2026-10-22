# //// Neoffice — added file (no upstream equivalent): erpnext 15.123 refuses a group-type Customer Group at every
# //// save of a customer; the fleet's customers created under the root group could not be saved any more.
import frappe
from frappe.tests.utils import FrappeTestCase

GROUP = "_Test Neoffice Group Of Groups"
LEAF = "_Test Neoffice Leaf Group"


def customer_group(name, is_group, parent="All Customer Groups"):
	if not frappe.db.exists("Customer Group", name):
		frappe.get_doc(
			{
				"doctype": "Customer Group",
				"customer_group_name": name,
				"is_group": is_group,
				"parent_customer_group": parent,
			}
		).insert(ignore_permissions=True)


def new_customer(name, group):
	doc = frappe.new_doc("Customer")
	doc.customer_name = name
	doc.customer_type = "Individual"
	doc.customer_group = group
	doc.territory = frappe.db.get_value("Territory", {"is_group": 0}, "name") or "All Territories"
	return doc


class TestCustomerGroupIsCheckedWhereItIsChosen(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		customer_group(GROUP, 1)
		customer_group(LEAF, 0)

	def test_a_new_customer_in_a_group_type_group_is_refused(self):
		with self.assertRaises(frappe.ValidationError):
			new_customer("_Test Neoffice Customer In A Group", GROUP).insert(ignore_permissions=True)

	def test_a_customer_moved_to_a_group_type_group_is_refused(self):
		doc = new_customer("_Test Neoffice Customer Moved", LEAF).insert(ignore_permissions=True)
		doc.customer_group = GROUP
		with self.assertRaises(frappe.ValidationError):
			doc.save(ignore_permissions=True)

	def test_a_customer_already_in_a_group_type_group_can_still_be_saved(self):
		doc = new_customer("_Test Neoffice Customer Legacy", LEAF).insert(ignore_permissions=True)
		# what the fleet holds: created before upstream's check existed
		frappe.db.set_value("Customer", doc.name, "customer_group", GROUP)
		doc = frappe.get_doc("Customer", doc.name)
		doc.mobile_no = "+41790000000"
		doc.save(ignore_permissions=True)
		self.assertEqual(frappe.db.get_value("Customer", doc.name, "customer_group"), GROUP)
