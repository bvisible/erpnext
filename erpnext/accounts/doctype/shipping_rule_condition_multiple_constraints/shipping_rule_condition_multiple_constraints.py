# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class ShippingRuleConditionMultipleConstraints(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		condition_group: DF.Data
		constraint_type: DF.Literal["Weight", "Price", "Length", "Width", "Height"]
		max_value: DF.Float
		min_value: DF.Float
		shipping_amount: DF.Currency
		parent: DF.Data
		parentfield: DF.Data
		parenttype: DF.Data
	# end: auto-generated types
	
	def validate(self):
		"""Set default values if not provided"""
		if self.min_value is None:
			self.min_value = 0
			
		if self.max_value is None:
			self.max_value = 999999
			
		if self.shipping_amount is None:
			self.shipping_amount = 0