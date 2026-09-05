# Copyright (c) 2021, Frappe Technologies Pvt. Ltd. and Contributors
# License: GNU General Public License v3. See license.txt

import frappe
from frappe.utils import cint, flt, fmt_money

from erpnext.accounts.doctype.pricing_rule.pricing_rule import get_pricing_rule_for_item
# //// Neoffice — `json` imported for the Pricing Rule lookup below, which has to decode
# //// `pricing_rule.pricing_rules` (a JSON list of rule names). The blank-line change around it
# //// is ours too and will conflict cosmetically.
import json # //// added

# //// Neoffice — two keyword arguments added to upstream's signature. `warehouse` is forwarded
# //// into the Pricing Rule context below so a rule restricted to one warehouse actually matches
# //// (upstream never passes it, so warehouse-scoped promotions were ignored); `from_pos` is
# //// passed by selling/page/point_of_sale/point_of_sale.py get_items(). Both default to their
# //// upstream behaviour, so upstream callers are unaffected.
# //// TO REVIEW: `from_pos` is accepted but never read in this function.
def get_price(item_code, price_list, customer_group, company, qty=1, party=None, from_pos=False, warehouse=None): # //// added , from_pos=False, warehouse=None
	template_item_code = frappe.db.get_value("Item", item_code, "variant_of")

	if price_list:
		price = frappe.get_all(
			"Item Price",
			fields=["price_list_rate", "currency"],
			filters={"price_list": price_list, "item_code": item_code},
		)

		if template_item_code and not price:
			price = frappe.get_all(
				"Item Price",
				fields=["price_list_rate", "currency"],
				filters={"price_list": price_list, "item_code": template_item_code},
			)

		if price:
			pricing_rule_dict = frappe._dict(
				{
					"item_code": item_code,
					"qty": qty,
					"stock_qty": qty,
					"transaction_type": "selling",
					"price_list": price_list,
					"customer_group": customer_group,
					"company": company,
					"conversion_rate": 1,
					"for_shopping_cart": True,
					"currency": frappe.db.get_value("Price List", price_list, "currency"),
					"doctype": "Quotation",
				}
			)

			# //// Neoffice — see the signature marker above: the warehouse goes into the dict handed to
			# //// get_pricing_rule_for_item, which is how a Pricing Rule with a warehouse filter can match.
			# //// added: pass warehouse to match Pricing Rules with warehouse filter
			if warehouse:
				pricing_rule_dict["warehouse"] = warehouse

			if party and party.doctype == "Customer":
				pricing_rule_dict.update({"customer": party.name})

			pricing_rule = get_pricing_rule_for_item(pricing_rule_dict)
			price_obj = price[0]

			# //// Neoffice — `mrp` is captured BEFORE the pricing rule runs; upstream only sets it inside the
			# //// `if pricing_rule:` branch. Without this, the comparison further down
			# //// (`if mrp != price_obj["price_list_rate"]`) hit an unbound name whenever no rule applied.
			# //// Together with `price_obj["mrp"] = mrp` below (marked), this is what lets the webshop and
			# //// the POS show a struck-through original price next to a promotional one.
			# Store original price as MRP before any discount is applied
			mrp = price_obj.price_list_rate or 0

			if pricing_rule:

				if pricing_rule.pricing_rule_for == "Discount Percentage":
					price_obj.discount_percent = pricing_rule.discount_percentage
					price_obj.formatted_discount_percent = str(flt(pricing_rule.discount_percentage, 0)) + "%"
					price_obj.price_list_rate = flt(
						price_obj.price_list_rate * (1.0 - (flt(pricing_rule.discount_percentage) / 100.0))
					)

				if pricing_rule.pricing_rule_for == "Rate":
					rate_discount = flt(mrp) - flt(pricing_rule.price_list_rate)
					if rate_discount > 0:
						price_obj.formatted_discount_rate = fmt_money(
							rate_discount, currency=price_obj["currency"]
						)
					price_obj.price_list_rate = pricing_rule.price_list_rate or 0

				# //// Neoffice — added block (793f38c40b, 2023-10-30; 7eea61c52e, 2025-12-06; 70250637fb,
				# //// 2026-02-01). Upstream handles "Discount Percentage" and "Rate" but never subtracts a
				# //// "Discount Amount" rule from the price list rate, so such a promotion showed at full price
				# //// on the webshop and at the till. The rest of the block exposes the rule's validity window
				# //// (valid_from / valid_upto) on the returned price so the shop can display "offer ends on…".
				# //// The `synchronized_rule` guard just below is documented on its own lines (ecdec25916).
				# //// added code block
				if pricing_rule.pricing_rule_for == "Discount Amount":
					price_obj.price_list_rate = flt(price_obj.price_list_rate - pricing_rule.discount_amount)

				if pricing_rule.pricing_rules:
					valid_from = frappe.db.get_value("Pricing Rule", json.loads(pricing_rule.pricing_rules)[0], "valid_from")
					valid_upto = frappe.db.get_value("Pricing Rule", json.loads(pricing_rule.pricing_rules)[0], "valid_upto")
					# //// Neoffice — `synchronized_rule` is a legacy column: no Custom Field defines it any more
					# //// (it came with the retired shop-sync integration), so it exists only on sites that had it
					# //// before. A fresh site (CI, a new instance) has no such column and get_value died with
					# //// OperationalError 1054, taking every priced webshop listing with it. Read it only if present.
					synchronized_rule = (
						frappe.db.get_value("Pricing Rule", json.loads(pricing_rule.pricing_rules)[0], "synchronized_rule")
						if frappe.db.has_column("Pricing Rule", "synchronized_rule")
						else 0
					)
					if valid_from:
						price[0].valid_from = str(valid_from) + " 00:00:00"

					if valid_upto:
						price[0].valid_upto = str(valid_upto) + " 23:59:59"
					price[0].synchronized_rule = synchronized_rule
				# ////

			if price_obj:
				price_obj["formatted_price"] = fmt_money(
					price_obj["price_list_rate"], currency=price_obj["currency"]
				)
				if mrp != price_obj["price_list_rate"]:
					# //// Neoffice — upstream only returns the FORMATTED mrp; the raw value is added so callers can
					# //// compute the discount themselves (the POS item grid does). See the `mrp` marker above.
					price_obj["mrp"] = mrp
					price_obj["formatted_mrp"] = fmt_money(mrp, currency=price_obj["currency"])

				price_obj["currency_symbol"] = (
					not cint(frappe.db.get_default("hide_currency_symbol"))
					and (
						frappe.db.get_value("Currency", price_obj.currency, "symbol", cache=True)
						or price_obj.currency
					)
					or ""
				)

				uom_conversion_factor = frappe.db.sql(
					"""select	C.conversion_factor
					from `tabUOM Conversion Detail` C
					inner join `tabItem` I on C.parent = I.name and C.uom = I.sales_uom
					where I.name = %s""",
					item_code,
				)

				uom_conversion_factor = uom_conversion_factor[0][0] if uom_conversion_factor else 1
				price_obj["formatted_price_sales_uom"] = fmt_money(
					price_obj["price_list_rate"] * uom_conversion_factor, currency=price_obj["currency"]
				)

				if not price_obj["price_list_rate"]:
					price_obj["price_list_rate"] = 0

				if not price_obj["currency"]:
					price_obj["currency"] = ""

				if not price_obj["formatted_price"]:
					price_obj["formatted_price"], price_obj["formatted_mrp"] = "", ""

			return price_obj


def get_item_codes_by_attributes(attribute_filters, template_item_code=None):
	items = []

	for attribute, values in attribute_filters.items():
		attribute_values = values

		if not isinstance(attribute_values, list):
			attribute_values = [attribute_values]

		if not attribute_values:
			continue

		wheres = []
		query_values = []
		for attribute_value in attribute_values:
			wheres.append("( attribute = %s and attribute_value = %s )")
			query_values += [attribute, attribute_value]

		attribute_query = " or ".join(wheres)

		if template_item_code:
			variant_of_query = "AND t2.variant_of = %s"
			query_values.append(template_item_code)
		else:
			variant_of_query = ""

		query = f"""
			SELECT
				t1.parent
			FROM
				`tabItem Variant Attribute` t1
			WHERE
				1 = 1
				AND (
					{attribute_query}
				)
				AND EXISTS (
					SELECT
						1
					FROM
						`tabItem` t2
					WHERE
						t2.name = t1.parent
						{variant_of_query}
				)
			GROUP BY
				t1.parent
			ORDER BY
				NULL
		"""

		item_codes = set([r[0] for r in frappe.db.sql(query, query_values)])
		items.append(item_codes)

	res = list(set.intersection(*items))

	return res
