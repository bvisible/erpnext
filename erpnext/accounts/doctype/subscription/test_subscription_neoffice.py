# //// Neoffice — added file (no upstream equivalent). The first tests this fork adds to
# //// erpnext: on 2026-09-07 the fork carried 25 commits in fourteen days and ZERO test
# //// classes of its own (#270), several of them on the path money takes. Without a test
# //// here, the upstream merge of #138 can undo one of them and nothing will say so.
# ////
# //// This file pins can_generate_new_invoice(), whose gate we changed twice:
# ////   `==` -> `>=`            so a scheduler that missed the boundary day catches up
# ////   `or is_new_subscription()` dropped, because it only ever fired on a period that
# ////                            had NOT started and billed future and trialling
# ////                            subscriptions on the day they were created (e66b59afac).
# //// Both directions are asserted: the catch-up must work AND the future period must not
# //// bill. A test for only one of them would pass with the bug.
import unittest

import frappe
from frappe.utils import add_days, add_months, getdate, nowdate


class TestSubscriptionInvoiceGate(unittest.TestCase):
	"""No database rows: can_generate_new_invoice() reads fields and one DB helper, so a
	document held in memory with that helper stubbed exercises the real gate."""

	def _subscription(self, **fields):
		doc = frappe.new_doc("Subscription")
		doc.update(
			{
				"generate_invoice_at": "Beginning of the current subscription period",
				"generate_new_invoices_past_due_date": 0,
				"cancelation_date": None,
				"number_of_days": 0,
			}
		)
		doc.update(fields)
		# the gate's only database call; False = nothing outstanding holds it shut
		doc.has_outstanding_invoice = lambda: False
		# TRUE on purpose: this is the state that produced the bug — a subscription that
		# has never invoiced. It has to be stubbed, and the first version of this file was
		# worthless without it: on a site that holds any invoice at all, the real method
		# queries `subscription = NULL`, matches those rows and returns False, so the
		# escape under test never fired and the tests passed WITH the regression
		# reintroduced. Checked by putting it back: 7/7 green, catching nothing.
		doc.is_new_subscription = lambda: True
		return doc

	# ---------------------------------------------------------------- the regression
	def test_a_period_that_has_not_started_is_not_billed(self):
		"""e66b59afac. `or is_new_subscription()` billed a subscription whose period
		begins next month, on the day it was created, with a posting_date in the future."""
		start = add_months(nowdate(), 1)
		sub = self._subscription(
			current_invoice_start=start,
			current_invoice_end=add_months(start, 1),
		)
		self.assertFalse(
			sub.can_generate_new_invoice(nowdate()),
			"a subscription whose period starts next month must not bill today",
		)

	def test_a_trialling_subscription_is_not_billed_either(self):
		"""Same shape, one day out: the trial case measured on 2026-09-04."""
		start = add_days(nowdate(), 1)
		sub = self._subscription(
			current_invoice_start=start,
			current_invoice_end=add_months(start, 1),
		)
		self.assertFalse(sub.can_generate_new_invoice(nowdate()))

	# ------------------------------------------------------- what must keep working
	def test_the_first_day_of_the_period_bills(self):
		"""Upstream's exact-day behaviour, which the `>=` must not lose."""
		start = nowdate()
		sub = self._subscription(
			current_invoice_start=start,
			current_invoice_end=add_months(start, 1),
		)
		self.assertTrue(sub.can_generate_new_invoice(start))

	def test_a_missed_boundary_day_still_catches_up(self):
		"""The whole point of `>=`: upstream only fires on the exact day, so a scheduler
		that did not run that day skipped the period FOR GOOD."""
		start = add_days(nowdate(), -9)
		sub = self._subscription(
			current_invoice_start=start,
			current_invoice_end=add_months(start, 1),
		)
		self.assertTrue(
			sub.can_generate_new_invoice(nowdate()),
			"nine days late must still bill: that is why the test is >= and not ==",
		)

	# --------------------------------------------------------------- the other gates
	def test_days_before_the_period_respects_its_own_window(self):
		start = add_days(nowdate(), 5)
		sub = self._subscription(
			generate_invoice_at="Days before the current subscription period",
			number_of_days=3,
			current_invoice_start=start,
			current_invoice_end=add_months(start, 1),
		)
		# window opens at start - 3 days, i.e. in two days
		self.assertFalse(sub.can_generate_new_invoice(nowdate()))
		self.assertTrue(sub.can_generate_new_invoice(add_days(nowdate(), 2)))

	def test_a_cancelled_subscription_never_bills(self):
		sub = self._subscription(
			current_invoice_start=nowdate(),
			current_invoice_end=add_months(nowdate(), 1),
			cancelation_date=getdate(nowdate()),
		)
		self.assertFalse(sub.can_generate_new_invoice(nowdate()))

	def test_an_outstanding_invoice_holds_the_gate_shut(self):
		sub = self._subscription(
			current_invoice_start=nowdate(),
			current_invoice_end=add_months(nowdate(), 1),
		)
		sub.has_outstanding_invoice = lambda: True
		self.assertFalse(sub.can_generate_new_invoice(nowdate()))
		# ... unless the subscription is allowed to bill past the due date
		sub.generate_new_invoices_past_due_date = 1
		self.assertTrue(sub.can_generate_new_invoice(nowdate()))


# //// Neoffice ▼▼▼ — new tests for the fix: process() cancels at period end and then calls
# //// set_subscription_status(), whose last branch set a cancelled subscription straight
# //// back to Active while cancelation_date stayed, leaving can_generate_new_invoice() to
# //// refuse for ever with nothing saying so (6da35b6ef3 "fix(subscription): a cancelled
# //// subscription stays cancelled", dmis, ACC-SUB-2026-00001, #230). Both directions are
# //// asserted: cancelled stays cancelled, and a settled account that was never cancelled
# //// still becomes Active.
class TestCancelledStaysCancelled(unittest.TestCase):
	"""set_subscription_status() after cancel_subscription(): the status must not come back.

	process() cancels at period end and then calls set_subscription_status(); with nothing
	outstanding, its last branch set the status straight back to Active while
	cancelation_date stayed -- an Active subscription that can_generate_new_invoice()
	refuses for ever, silently (dmis, ACC-SUB-2026-00001, #230). Upstream has the same code.
	"""

	def _subscription(self, status, cancelation_date):
		doc = frappe.new_doc("Subscription")
		doc.update({"status": status, "cancelation_date": cancelation_date, "end_date": None})
		# the database-backed questions the method asks, answered as a settled account
		doc.is_trialling = lambda: False
		doc.is_past_grace_period = lambda: False
		doc.current_invoice_is_past_due = lambda: False
		doc.has_outstanding_invoice = lambda: False
		return doc

	def test_a_cancelled_subscription_with_nothing_outstanding_stays_cancelled(self):
		sub = self._subscription("Cancelled", nowdate())
		sub.set_subscription_status(nowdate())
		self.assertEqual(sub.status, "Cancelled", "a settled account must not undo a cancellation")
		self.assertEqual(getdate(sub.cancelation_date), getdate(nowdate()))

	def test_a_settled_subscription_that_was_never_cancelled_still_becomes_active(self):
		"""The other direction: the guard must not freeze the method."""
		sub = self._subscription("Unpaid", None)
		sub.set_subscription_status(nowdate())
		self.assertEqual(sub.status, "Active")
# //// Neoffice ▲▲▲
