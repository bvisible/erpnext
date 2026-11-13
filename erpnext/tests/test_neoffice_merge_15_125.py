# //// Neoffice — added file (no upstream equivalent): the two places where the merge of upstream v15.125.0 had to
# //// keep our behaviour inside upstream's new code (bvisible/neoffice-maintenance#2648). Each test fails on upstream's
# //// code and on a merge that only puts both sides next to each other. The users are made here: a site restored from
# //// production has no test users.
import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, random_string

import erpnext
from erpnext.accounts.doctype.pos_invoice.pos_invoice import get_stock_availability
from erpnext.stock.utils import get_or_make_bin

PRICE_KEEPER = "neoffice-merge-prices@example.com"
CASHIER = "neoffice-merge-till@example.com"
USERS = {
	# keeps the catalogue: creates items and their buying prices
	PRICE_KEEPER: ["Item Manager", "Purchase Master Manager"],
	# reads what the till may sell
	CASHIER: ["Accounts User"],
}


class TestNeofficeMerge15125(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		for email, roles in USERS.items():
			if not frappe.db.exists("User", email):
				user = frappe.get_doc(
					{
						"doctype": "User",
						"email": email,
						"first_name": "Neoffice Merge",
						"send_welcome_email": 0,
					}
				).insert(ignore_permissions=True)
				user.add_roles(*roles)
		frappe.db.commit()

	@classmethod
	def tearDownClass(cls):
		frappe.set_user("Administrator")
		for email in USERS:
			frappe.delete_doc("User", email, force=True, ignore_permissions=True)
		frappe.db.commit()
		super().tearDownClass()

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.rollback()

	def make_item(self, is_stock_item=1):
		# scenery: a plain item with no price of its own (no standard rate, so after_insert adds none)
		return frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": f"_Neoffice Merge {random_string(8)}",
				"item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
				"stock_uom": "Nos",
				"is_stock_item": is_stock_item,
				"standard_rate": 0,
			}
		).insert(ignore_permissions=True)

	def test_a_buying_price_stays_on_its_buying_price_list(self):
		# upstream 15.125.0 makes add_price take a selling price list (any other is replaced by the default
		# selling list); our `buying` keyword records the purchase price of the quick entry on a buying list.
		buying_list = frappe.get_doc(
			{
				"doctype": "Price List",
				"price_list_name": f"_Neoffice Merge Buying {random_string(6)}",
				"currency": erpnext.get_default_currency(),
				"buying": 1,
				"selling": 0,
			}
		).insert(ignore_permissions=True)
		item = self.make_item()

		frappe.set_user(PRICE_KEEPER)
		item = frappe.get_doc("Item", item.name)
		item.buying_standard_rate = 60  # a Neoffice custom field, read with .get(): absent on a bare site
		item.standard_rate = 100
		self.assertTrue(item.add_price(buying_list.name, buying=True))

		prices = frappe.get_all(
			"Item Price",
			filters={"item_code": item.name},
			fields=["price_list", "price_list_rate", "buying"],
		)
		self.assertEqual(len(prices), 1, prices)
		self.assertEqual(prices[0].price_list, buying_list.name)
		self.assertEqual(flt(prices[0].price_list_rate), 60)

	def test_the_till_does_not_take_a_sales_order_reservation_off_twice(self):
		# ours subtracts Bin.reserved_qty (what Sales Orders still have to deliver), upstream 15.125.0 subtracts
		# Bin.reserved_stock (Stock Reservation Entries, always made for a Sales Order in v15): the same units.
		item = self.make_item()
		warehouse = frappe.db.get_value("Warehouse", {"is_group": 0, "disabled": 0}, "name")
		bin_name = get_or_make_bin(item.name, warehouse)

		frappe.set_user(CASHIER)
		for reserved_qty, reserved_stock, expected in ((3, 3, 7), (3, 0, 7), (0, 2, 8), (0, 0, 10)):
			frappe.db.set_value(
				"Bin",
				bin_name,
				{"actual_qty": 10, "reserved_qty": reserved_qty, "reserved_stock": reserved_stock},
			)
			with self.subTest(reserved_qty=reserved_qty, reserved_stock=reserved_stock):
				available, is_stock_item, _negative_allowed = get_stock_availability(item.name, warehouse)
				self.assertTrue(is_stock_item)
				self.assertEqual(flt(available), expected)
