# Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
# //// Neoffice — `cint` added to the import (a5f79d75b3, 2025-02-26 "update neov2") for the
# //// float_precision rounding below. Upstream: `from frappe.utils import flt, today`, placed
# //// AFTER the query_builder import — the reorder is ours too and will conflict cosmetically.
from frappe.utils import flt, today, cint
from frappe.query_builder.functions import Sum
# //// Neoffice — `Case` and `sbool` added to the imports for the three loyalty fixes below
# //// (neoffice-maintenance#1287, 2026-10-07). Upstream imports neither.
from frappe.query_builder import Case
from frappe.utils import sbool


class LoyaltyProgram(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		from erpnext.accounts.doctype.loyalty_program_collection.loyalty_program_collection import (
			LoyaltyProgramCollection,
		)

		auto_opt_in: DF.Check
		collection_rules: DF.Table[LoyaltyProgramCollection]
		company: DF.Link | None
		conversion_factor: DF.Float
		cost_center: DF.Link | None
		customer_group: DF.Link | None
		customer_territory: DF.Link | None
		expense_account: DF.Link | None
		expiry_duration: DF.Int
		from_date: DF.Date
		loyalty_program_name: DF.Data
		loyalty_program_type: DF.Literal["Single Tier Program", "Multiple Tier Program"]
		to_date: DF.Date | None
	# end: auto-generated types

	pass


# //// Neoffice — added (no upstream equivalent), neoffice-maintenance#1287. A whitelisted function
# //// called from the desk (`frappe.call({args: {include_expired_entry: false}})`) receives the
# //// STRING "false", which is true in Python: the points dialog counted expired points (776 shown
# //// for 463 usable). Upstream has no coercion here. Keep as long as these functions stay
# //// whitelisted without type hints.
def _as_flag(value):
	"""A boolean sent by the desk arrives as "true"/"false"/"1"/"0": read it as what it says."""
	return bool(sbool(value))


# //// Neoffice — added (no upstream equivalent), neoffice-maintenance#1290. The two functions below
# //// are whitelisted and upstream checks nothing: any signed-in account, a portal customer
# //// included, read the points, the lifetime spend and the tier of ANY customer through them,
# //// while the list of the entries is refused to it. When the function is the endpoint itself
# //// (called from the browser), the caller must be able to read the customer. The web shop calls
# //// them from Python, in the same process, for its own customer: that path is not the endpoint
# //// and is left alone. The desk screens that call them (invoice forms, point of sale, the
# //// customer's points dialog) are staff who read customers. Keep until upstream checks.
def _refuse_unreadable_customer(customer, method):
	if customer and (frappe.local.form_dict.get("cmd") or "").endswith("." + method):
		frappe.has_permission("Customer", "read", doc=customer, throw=True)


# //// Neoffice — added (no upstream equivalent), neoffice-maintenance#1287. Upstream version-15
# //// picks the tier in the loop of `get_loyalty_program_details_with_points` that sorts the rules
# //// by min_spent DESCENDING, always takes the first one (`i == 0`) and only steps down while
# //// `spent <= min_spent`: it returns the tier just ABOVE the right one (CHF 8'163.77 with a tier
# //// from CHF 8'000 and the next from CHF 10'000 came out in the CHF 10'000 tier), and every
# //// customer earned points at the wrong factor. Upstream fixed it on `develop` (ascending sort,
# //// `>=`); version-15 still has the inverted loop at v15.122.0. This is the same rule as that fix.
# //// Drop it for upstream's loop once a version-15 release carries it.
def get_tier_for_spent(collection_rules, spent):
	"""The tier of a customer who has spent `spent`: the rule with the highest `min_spent` that the
	spend has reached. Under every threshold: the lowest tier (a single tier program applies to
	everyone, whatever its threshold). No rules: no tier."""
	rules = sorted(collection_rules or [], key=lambda rule: flt(rule.get("min_spent")))
	if not rules:
		return None

	tier = rules[0]
	for rule in rules:
		if flt(spent) < flt(rule.get("min_spent")):
			break
		tier = rule
	return tier


def get_loyalty_details(
	customer, loyalty_program, expiry_date=None, company=None, include_expired_entry=False
):
	if not expiry_date:
		expiry_date = today()

	include_expired_entry = _as_flag(include_expired_entry)

	LoyaltyPointEntry = frappe.qb.DocType("Loyalty Point Entry")

	# //// Neoffice — upstream: `Sum(LoyaltyPointEntry.purchase_amount)` over EVERY row. Paying an
	# //// invoice with points writes one negative row per earn row it consumes, and each of them
	# //// copies the invoice total into `purchase_amount` (sales_invoice.apply_loyalty_points), so the
	# //// invoice was added to `total_spent` once per row: CHF 8'163.77 shown for CHF 7'368.75 really
	# //// spent, which pushed the customer into a higher tier. Only the rows that EARN count here
	# //// (neoffice-maintenance#1287, 2026-10-07). Drop when upstream stops recopying the total.
	earned_amount = (
		Case()
		.when(
			(LoyaltyPointEntry.redeem_against.isnull()) | (LoyaltyPointEntry.redeem_against == ""),
			LoyaltyPointEntry.purchase_amount,
		)
		.else_(0)
	)

	query = (
		frappe.qb.from_(LoyaltyPointEntry)
		.select(
			Sum(LoyaltyPointEntry.loyalty_points).as_("loyalty_points"),
			Sum(earned_amount).as_("total_spent"),
		)
		.where(
			(LoyaltyPointEntry.customer == customer)
			& (LoyaltyPointEntry.loyalty_program == loyalty_program)
			& (LoyaltyPointEntry.posting_date <= expiry_date)
		)
		.groupby(LoyaltyPointEntry.customer)
	)

	if company:
		query = query.where(LoyaltyPointEntry.company == company)

	if not include_expired_entry:
		query = query.where(LoyaltyPointEntry.expiry_date >= expiry_date)

	loyalty_point_details = query.run(as_dict=True)

	if loyalty_point_details:
		return loyalty_point_details[0]
	else:
		return {"loyalty_points": 0, "total_spent": 0}


@frappe.whitelist()
def get_loyalty_program_details_with_points(
	customer,
	loyalty_program=None,
	expiry_date=None,
	company=None,
	silent=False,
	include_expired_entry=False,
	current_transaction_amount=0,
):
	# //// Neoffice — flags and amounts arrive as strings from the desk (see `_as_flag`), and
	# //// `total_spent + "0"` raised a TypeError. neoffice-maintenance#1287.
	_refuse_unreadable_customer(customer, "get_loyalty_program_details_with_points")
	silent = _as_flag(silent)
	include_expired_entry = _as_flag(include_expired_entry)
	current_transaction_amount = flt(current_transaction_amount)

	lp_details = get_loyalty_program_details(customer, loyalty_program, company=company, silent=silent)
	loyalty_program = frappe.get_doc("Loyalty Program", loyalty_program)
	lp_details.update(
		get_loyalty_details(customer, loyalty_program.name, expiry_date, company, include_expired_entry)
	)

	# //// Neoffice — upstream: a loop over the rules sorted DESCENDING that always took the first
	# //// and stepped down while `spent <= min_spent`, i.e. the tier above the right one. See
	# //// `get_tier_for_spent`. neoffice-maintenance#1287.
	tier = get_tier_for_spent(
		[d.as_dict() for d in loyalty_program.collection_rules],
		flt(lp_details.total_spent) + current_transaction_amount,
	)
	if tier:
		lp_details.tier_name = tier.tier_name
		lp_details.collection_factor = tier.collection_factor

	return lp_details


@frappe.whitelist()
def get_loyalty_program_details(
	customer,
	loyalty_program=None,
	expiry_date=None,
	company=None,
	silent=False,
	include_expired_entry=False,
):
	lp_details = frappe._dict()
	# //// Neoffice — `silent` sent by the desk is a string too (see `_as_flag`). #1287.
	_refuse_unreadable_customer(customer, "get_loyalty_program_details")
	silent = _as_flag(silent)

	if not loyalty_program:
		loyalty_program = frappe.db.get_value("Customer", customer, "loyalty_program")

		if not loyalty_program and not silent:
			frappe.throw(_("Customer isn't enrolled in any Loyalty Program"))
		elif silent and not loyalty_program:
			return frappe._dict({"loyalty_programs": None})

	if not company:
		company = frappe.db.get_default("company") or frappe.get_all("Company")[0].name

	loyalty_program = frappe.get_doc("Loyalty Program", loyalty_program)
	lp_details.update({"loyalty_program": loyalty_program.name})
	lp_details.update(loyalty_program.as_dict())
	return lp_details


@frappe.whitelist()
def get_redeemption_factor(loyalty_program=None, customer=None):
	customer_loyalty_program = None
	if not loyalty_program:
		customer_loyalty_program = frappe.db.get_value("Customer", customer, "loyalty_program")
		loyalty_program = customer_loyalty_program
	if loyalty_program:
		return frappe.db.get_value("Loyalty Program", loyalty_program, "conversion_factor")
	else:
		frappe.throw(_("Customer isn't enrolled in any Loyalty Program"))


def validate_loyalty_points(ref_doc, points_to_redeem):
	loyalty_program = None
	posting_date = None

	if ref_doc.doctype == "Sales Invoice":
		posting_date = ref_doc.posting_date
	else:
		posting_date = today()

	if hasattr(ref_doc, "loyalty_program") and ref_doc.loyalty_program:
		loyalty_program = ref_doc.loyalty_program
	else:
		loyalty_program = frappe.db.get_value("Customer", ref_doc.customer, ["loyalty_program"])

	if (
		loyalty_program
		and frappe.db.get_value("Loyalty Program", loyalty_program, ["company"]) != ref_doc.company
	):
		frappe.throw(_("The Loyalty Program isn't valid for the selected company"))

	if loyalty_program and points_to_redeem:
		loyalty_program_details = get_loyalty_program_details_with_points(
			ref_doc.customer, loyalty_program, posting_date, ref_doc.company
		)

		if points_to_redeem > loyalty_program_details.loyalty_points:
			frappe.throw(_("You don't have enough Loyalty Points to redeem"))

		# //// Neoffice — upstream: `loyalty_amount = flt(points_to_redeem * conversion_factor)` with no
		# //// precision, which keeps the full binary tail; the redeemed amount then failed the
		# //// "more value than the Total Amount" check below on rounding noise. Ours rounds to the site
		# //// float_precision first (a5f79d75b3, 2025-02-26 "update neov2"; the commit itself carries no
		# //// rationale — reading is inferred from the code, TO REVIEW). Unchanged upstream at v15.121.0.
		float_precision = cint(frappe.db.get_default("float_precision")) or 2
		loyalty_amount = flt(points_to_redeem * loyalty_program_details.conversion_factor, float_precision)

		total_amount = ref_doc.grand_total if ref_doc.is_rounded_total_disabled() else ref_doc.rounded_total
		if loyalty_amount > total_amount:
			frappe.throw(_("You can't redeem Loyalty Points having more value than the Total Amount."))

		if not ref_doc.loyalty_amount and ref_doc.loyalty_amount != loyalty_amount:
			ref_doc.loyalty_amount = loyalty_amount

		if ref_doc.doctype == "Sales Invoice":
			ref_doc.loyalty_program = loyalty_program
			if not ref_doc.loyalty_redemption_account:
				ref_doc.loyalty_redemption_account = loyalty_program_details.expense_account

			if not ref_doc.loyalty_redemption_cost_center:
				ref_doc.loyalty_redemption_cost_center = loyalty_program_details.cost_center

		elif ref_doc.doctype == "Sales Order":
			return loyalty_amount