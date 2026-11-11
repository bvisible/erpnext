# //// Neoffice — added file (no upstream equivalent)
"""An empty freeze date stored as text freezes nothing (neoffice-maintenance#1550).

A test script once left Accounts Settings.acc_frozen_upto as the TEXT « 0001-01-01 »: the raw value is truthy,
getdate() reads it as None, and check_freezing_date raised a TypeError at every ledger posting, so the site booked
nothing until the setting was cleared by hand. A real freeze date still refuses what comes before it.
"""

from unittest import mock

import frappe
from frappe.tests.utils import FrappeTestCase

from erpnext.accounts.general_ledger import check_freezing_date


def _settings(frozen_upto):
	def get_value(doctype, name=None, fieldname=None, *args, **kwargs):
		if doctype == "Accounts Settings" and fieldname == "acc_frozen_upto":
			return frozen_upto
		if doctype == "Accounts Settings" and fieldname == "frozen_accounts_modifier":
			return None
		return original(doctype, name, fieldname, *args, **kwargs)

	original = frappe.db.get_value
	return mock.patch.object(frappe.db, "get_value", side_effect=get_value)


class TestAnEmptyFreezeDateFreezesNothing(FrappeTestCase):
	def test_an_empty_date_stored_as_text_lets_the_posting_through(self):
		for stored in ("0001-01-01", "0000-00-00"):
			with self.subTest(stored=stored), _settings(stored):
				check_freezing_date("2026-01-15")

	def test_no_freeze_date_lets_the_posting_through(self):
		with _settings(None):
			check_freezing_date("2026-01-15")

	def test_a_real_freeze_date_still_refuses_what_comes_before_it(self):
		with _settings("2026-12-31"), self.assertRaises(frappe.ValidationError):
			check_freezing_date("2026-01-15")
		with _settings("2026-12-31"):
			check_freezing_date("2027-01-15")
