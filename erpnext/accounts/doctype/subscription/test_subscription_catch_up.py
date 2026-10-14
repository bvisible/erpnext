# //// Neoffice — added file (no upstream equivalent): a subscription that fell behind catches up (neoffice-maintenance#1556), and a
# //// membership that ends on the last day of its first period is accepted (neoffice-maintenance#1500).
"""A subscription that fell behind is billed up to today, a bounded number of periods per pass.

Upstream bills ONE period per pass: a daily plan that took five days of delay (an instance switched off, a run that failed, an unpaid
invoice that held the gate shut) kept them for ever. Each night created the invoice of the period five days back and the delay never
shrank. The pass now loops, asking the same gates before every period, up to MAX_CATCH_UP_PERIODS; it never bills a period that begins
after the end date of the subscription.

A subscription whose end date is the LAST DAY of its first period (what a club that does not renew in its members' name seals each
membership at) was refused, at creation or, written around the validation, by a "Subscription failed" every night (#1500). That day is
accepted; an earlier one, which would cut the period, still is not.

Self-contained: the item, the plan and the customer are made here (the upstream test records are not on every site) and everything is
rolled back, nothing is committed.
"""

from unittest import mock

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, add_months, getdate, nowdate

import erpnext
from erpnext.accounts.doctype.subscription import subscription as subscription_module

PREFIX = "ZZ catch up"


class TestSubscriptionCatchUp(FrappeTestCase):
	def setUp(self):
		self.company = erpnext.get_default_company()
		self.assertTrue(self.company, "a default company is needed to bill")
		frappe.db.set_single_value("Accounts Settings", "acc_frozen_upto", None)
		settings = frappe.get_single("Subscription Settings")
		settings.grace_period = 0
		settings.cancel_after_grace = 0
		settings.save()
		self.currency = frappe.get_cached_value("Company", self.company, "default_currency")
		self.item = self._item()
		self.customer = self._customer()

	def tearDown(self):
		frappe.db.rollback()

	# -- what a subscription needs ---------------------------------------------------------------------------------------------

	def _item(self):
		name = f"{PREFIX} service"
		if not frappe.db.exists("Item", name):
			frappe.get_doc(
				{
					"doctype": "Item",
					"item_code": name,
					"item_name": name,
					"is_stock_item": 0,
					"item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
					"stock_uom": frappe.db.get_value("UOM", {"enabled": 1}, "name"),
				}
			).insert()
		return name

	def _customer(self):
		name = f"{PREFIX} customer"
		if not frappe.db.exists("Customer", name):
			frappe.get_doc(
				{
					"doctype": "Customer",
					"customer_name": name,
					"customer_group": frappe.db.get_value("Customer Group", {"is_group": 0}, "name"),
					"territory": frappe.db.get_value("Territory", {"is_group": 0}, "name"),
				}
			).insert()
		return name

	def _plan(self, interval="Day", count=1):
		name = f"{PREFIX} {interval} {count}"
		if not frappe.db.exists("Subscription Plan", name):
			frappe.get_doc(
				{
					"doctype": "Subscription Plan",
					"plan_name": name,
					"item": self.item,
					"price_determination": "Fixed Rate",
					"cost": 50,
					"currency": self.currency,
					"billing_interval": interval,
					"billing_interval_count": count,
				}
			).insert()
		return name

	def _subscription(self, started_days_ago, interval="Day", count=1, past_due=1, **more):
		"""A subscription that started that many days ago and has billed nothing yet: its delay is its age."""
		subscription = frappe.new_doc("Subscription")
		subscription.company = self.company
		subscription.party_type = "Customer"
		subscription.party = self.customer
		subscription.start_date = add_days(nowdate(), -started_days_ago)
		subscription.generate_invoice_at = more.pop("generate_invoice_at", "Beginning of the current subscription period")
		subscription.generate_new_invoices_past_due_date = past_due
		for key, value in more.items():
			setattr(subscription, key, value)
		subscription.append("plans", {"plan": self._plan(interval, count), "qty": 1})
		subscription.insert()
		return subscription

	def _night(self, subscription):
		"""One nightly pass, as process_all does it: the document is loaded again, then processed for today."""
		subscription = frappe.get_doc("Subscription", subscription.name)
		subscription.process(nowdate())
		return frappe.get_doc("Subscription", subscription.name)

	def _invoices(self, subscription):
		return frappe.get_all(
			"Sales Invoice",
			{"subscription": subscription.name, "docstatus": 1},
			["posting_date", "from_date", "to_date"],
			order_by="posting_date asc",
		)

	def _days(self, invoices):
		return [getdate(invoice.posting_date) for invoice in invoices]

	# -- the delay is billed -------------------------------------------------------------------------------------------------------

	def test_a_daily_subscription_that_fell_behind_is_billed_up_to_today_in_one_pass(self):
		subscription = self._night(self._subscription(started_days_ago=5))
		invoices = self._invoices(subscription)
		self.assertEqual(self._days(invoices), [getdate(add_days(nowdate(), -n)) for n in range(5, -1, -1)])
		self.assertEqual(getdate(subscription.current_invoice_start), getdate(add_days(nowdate(), 1)))

	def test_each_invoice_is_dated_and_covers_its_own_day(self):
		invoices = self._invoices(self._night(self._subscription(started_days_ago=3)))
		self.assertEqual(len(invoices), 4)
		for invoice in invoices:
			self.assertEqual(getdate(invoice.posting_date), getdate(invoice.from_date))
			self.assertEqual(getdate(invoice.from_date), getdate(invoice.to_date))

	def test_the_next_night_bills_only_the_new_day(self):
		subscription = self._night(self._subscription(started_days_ago=5))
		self.assertEqual(len(self._invoices(subscription)), 6)
		self.assertEqual(len(self._invoices(self._night(subscription))), 6, "a second pass bills nothing more")

	def test_a_subscription_on_time_is_billed_once_a_day(self):
		subscription = self._night(self._subscription(started_days_ago=0))
		self.assertEqual(self._days(self._invoices(subscription)), [getdate(nowdate())])
		self.assertEqual(len(self._invoices(self._night(subscription))), 1)

	def test_a_monthly_subscription_two_periods_behind_is_billed_for_three(self):
		started = getdate(add_months(getdate(nowdate()).replace(day=1), -2))  # a first of the month: no day to lose to a shorter month
		subscription = self._subscription(started_days_ago=0, interval="Month", count=1, start_date=started)
		invoices = self._invoices(self._night(subscription))
		self.assertEqual(
			[getdate(invoice.from_date) for invoice in invoices],
			[started, getdate(add_months(started, 1)), getdate(add_months(started, 2))],
		)

	def test_a_subscription_that_starts_later_is_not_billed(self):
		self.assertEqual(self._invoices(self._night(self._subscription(started_days_ago=-3))), [])

	# -- the pass is bounded ---------------------------------------------------------------------------------------------------------

	def test_a_pass_bills_at_most_the_cap_and_the_next_night_goes_on(self):
		subscription = self._subscription(started_days_ago=9)
		with mock.patch.object(subscription_module, "MAX_CATCH_UP_PERIODS", 3):
			counts = []
			for _night in range(4):
				subscription = self._night(subscription)
				counts.append(len(self._invoices(subscription)))
		self.assertEqual(counts, [3, 6, 9, 10], "three a night until today's period is billed")

	def test_the_cap_is_a_month_of_a_daily_plan(self):
		self.assertEqual(subscription_module.MAX_CATCH_UP_PERIODS, 31)

	# -- the gates are the ones of the single pass -------------------------------------------------------------------------------

	def test_an_unpaid_invoice_holds_the_gate_shut_as_before(self):
		subscription = self._night(self._subscription(started_days_ago=5, past_due=0))
		self.assertEqual(len(self._invoices(subscription)), 1, "the invoice just made is unpaid: nothing more is billed")
		self.assertEqual(len(self._invoices(self._night(subscription))), 1)

	def test_the_period_still_rolls_forward_when_the_gate_is_shut(self):
		subscription = self._night(self._subscription(started_days_ago=3, past_due=0))
		self.assertEqual(getdate(subscription.current_invoice_start), getdate(add_days(nowdate(), -2)), "the next period to bill")
		subscription = self._night(subscription)
		self.assertEqual(len(self._invoices(subscription)), 1)
		self.assertEqual(getdate(subscription.current_invoice_start), getdate(nowdate()), "as before: the period is today's")

	def test_a_period_already_billed_is_not_billed_again(self):
		subscription = self._subscription(started_days_ago=0)
		subscription.generate_invoice()  # the invoice of the current period, made by hand: the period is not moved on
		self.assertEqual(len(self._invoices(self._night(subscription))), 1)

	def test_a_cancelled_subscription_is_not_billed(self):
		subscription = self._subscription(started_days_ago=5)
		subscription.cancel_subscription()
		self.assertEqual(self._invoices(self._night(subscription)), [])

	def test_no_period_that_begins_after_the_end_date_is_billed(self):
		subscription = self._night(self._subscription(started_days_ago=6, end_date=add_days(nowdate(), -3)))
		days = self._days(self._invoices(subscription))
		self.assertEqual(days, [getdate(add_days(nowdate(), -n)) for n in range(6, 2, -1)])
		self.assertEqual(max(days), getdate(subscription.end_date), "the last invoice is the end date's")
		self.assertEqual(len(self._invoices(self._night(subscription))), 4, "and the nights after bill nothing")
		self.assertEqual(subscription.status, "Completed")

	def test_the_force_fetch_of_the_desk_still_bills_one_period(self):
		subscription = self._subscription(started_days_ago=5)
		subscription.force_fetch_subscription_updates()
		self.assertEqual(len(self._invoices(subscription)), 1)

	# -- the three moments an invoice can be made -----------------------------------------------------------------------------------

	def test_invoices_made_days_before_each_period_are_made_up_to_the_window(self):
		subscription = self._night(
			self._subscription(
				started_days_ago=5, generate_invoice_at="Days before the current subscription period", number_of_days=2
			)
		)
		days = self._days(self._invoices(subscription))
		self.assertEqual(days, [getdate(add_days(nowdate(), -n)) for n in range(7, -1, -1)])
		self.assertEqual(getdate(subscription.current_invoice_start), getdate(add_days(nowdate(), 3)))

	def test_invoices_made_at_the_end_of_each_period_are_made_for_every_period_that_ended(self):
		subscription = self._night(
			self._subscription(started_days_ago=5, generate_invoice_at="End of the current subscription period")
		)
		self.assertEqual(self._days(self._invoices(subscription)), [getdate(add_days(nowdate(), -n)) for n in range(5, -1, -1)])

	# -- an end date on the last day of the first period (#1500) --------------------------------------------------------------------

	def _last_day_of_the_first_period(self, start, interval, count):
		if interval == "Day":
			return add_days(start, count - 1)
		if interval == "Week":
			return add_days(start, 7 * count - 1)
		if interval == "Year":
			return add_days(add_months(start, 12 * count), -1)
		return add_days(add_months(start, count), -1)

	def test_an_end_date_on_the_last_day_of_the_first_period_is_accepted(self):
		start = getdate(nowdate())
		for interval, count in (("Day", 1), ("Day", 3), ("Week", 1), ("Month", 1), ("Month", 3), ("Year", 1)):
			end = self._last_day_of_the_first_period(start, interval, count)
			subscription = self._subscription(started_days_ago=0, interval=interval, count=count, end_date=end)
			self.assertEqual(getdate(subscription.end_date), getdate(end), f"{count} {interval}")

	def test_an_end_date_before_the_last_day_of_the_first_period_is_still_refused(self):
		start = getdate(nowdate())
		for interval, count in (("Day", 3), ("Week", 1), ("Month", 1), ("Year", 1)):
			end = add_days(self._last_day_of_the_first_period(start, interval, count), -1)
			with self.assertRaises(frappe.ValidationError, msg=f"{count} {interval}"):
				self._subscription(started_days_ago=0, interval=interval, count=count, end_date=end)

	def test_a_membership_of_one_period_is_billed_once_then_completed(self):
		start = getdate(add_days(nowdate(), -35))
		end = self._last_day_of_the_first_period(start, "Month", 1)
		subscription = self._night(self._subscription(started_days_ago=0, interval="Month", count=1, start_date=start, end_date=end))
		self.assertEqual([getdate(invoice.from_date) for invoice in self._invoices(subscription)], [start])
		self.assertEqual(subscription.status, "Completed")
		self.assertEqual(len(self._invoices(self._night(subscription))), 1, "and the nights after bill nothing")
