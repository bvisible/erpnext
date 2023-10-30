# Copyright (c) 2021, Frappe Technologies Pvt. Ltd. and Contributors
# License: GNU General Public License v3. See license.txt

import frappe
from frappe.utils import cint, flt, fmt_money

from erpnext.accounts.doctype.pricing_rule.pricing_rule import get_pricing_rule_for_item
import json #//// added

#//// added from v14 removed function in v15
def get_web_item_qty_in_stock(item_code, item_warehouse_field, warehouse=None):
	in_stock, stock_qty = 0, ""
	template_item_code, is_stock_item = frappe.db.get_value(
		"Item", item_code, ["variant_of", "is_stock_item"]
	)

	if not warehouse:
		warehouse = frappe.db.get_value("Item", {"item_code": item_code}, item_warehouse_field) #////

	if not warehouse and template_item_code and template_item_code != item_code:
		warehouse = frappe.db.get_value(
			"Item", {"item_code": template_item_code}, item_warehouse_field #////
		)

	if warehouse:
		stock_qty = frappe.db.sql(
			"""
			select GREATEST(S.actual_qty - S.reserved_qty - S.reserved_qty_for_production - S.reserved_qty_for_sub_contract, 0) / IFNULL(C.conversion_factor, 1)
			from tabBin S
			inner join `tabItem` I on S.item_code = I.Item_code
			left join `tabUOM Conversion Detail` C on I.sales_uom = C.uom and C.parent = I.Item_code
			where S.item_code=%s and S.warehouse=%s""",
			(item_code, warehouse),
		)

		if stock_qty:
			stock_qty = adjust_qty_for_expired_items(item_code, stock_qty, warehouse)
			in_stock = stock_qty[0][0] > 0 and 1 or 0

	return frappe._dict(
		{"in_stock": in_stock, "stock_qty": stock_qty, "is_stock_item": is_stock_item}
	)
#////

def get_price(item_code, price_list, customer_group, company, qty=1, party=None, from_pos=False): #//// added , from_pos=False
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

			if party and party.doctype == "Customer":
				pricing_rule_dict.update({"customer": party.name})

			pricing_rule = get_pricing_rule_for_item(pricing_rule_dict)
			price_obj = price[0]

			if pricing_rule:
				# price without any rules applied
				mrp = price_obj.price_list_rate or 0

				if pricing_rule.pricing_rule_for == "Discount Percentage":
					price_obj.discount_percent = pricing_rule.discount_percentage
					price_obj.formatted_discount_percent = str(flt(pricing_rule.discount_percentage, 0)) + "%"
					price_obj.price_list_rate = flt(
						price_obj.price_list_rate * (1.0 - (flt(pricing_rule.discount_percentage) / 100.0))
					)

				if pricing_rule.pricing_rule_for == "Rate":
					rate_discount = flt(mrp) - flt(pricing_rule.price_list_rate)
					if rate_discount > 0:
						price_obj.formatted_discount_rate = fmt_money(rate_discount, currency=price_obj["currency"])
					price_obj.price_list_rate = pricing_rule.price_list_rate or 0

				#//// added code block
				if pricing_rule.pricing_rule_for == "Discount Amount":
					price_obj.price_list_rate = flt(price_obj.price_list_rate - pricing_rule.discount_amount)

				if pricing_rule.pricing_rules:
					valid_from = frappe.db.get_value("Pricing Rule", json.loads(pricing_rule.pricing_rules)[0], "valid_from")
					valid_upto = frappe.db.get_value("Pricing Rule", json.loads(pricing_rule.pricing_rules)[0], "valid_upto")
					synchronized_rule = frappe.db.get_value("Pricing Rule", json.loads(pricing_rule.pricing_rules)[0], "synchronized_rule")
					if valid_from:
						price[0].valid_from = str(valid_from) + " 00:00:00"

					if valid_upto:
						price[0].valid_upto = str(valid_upto) + " 23:59:59"
					price[0].synchronized_rule = synchronized_rule
				#////

			if price_obj:
				price_obj["formatted_price"] = fmt_money(
					price_obj["price_list_rate"], currency=price_obj["currency"]
				)
				if mrp != price_obj["price_list_rate"]:
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

		query = """
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
		""".format(
			attribute_query=attribute_query, variant_of_query=variant_of_query
		)

		item_codes = set([r[0] for r in frappe.db.sql(query, query_values)])
		items.append(item_codes)

	res = list(set.intersection(*items))

	return res
