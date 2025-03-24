# Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
# License: GNU General Public License v3. See license.txt

# For license information, please see license.txt


import frappe
from frappe import _, msgprint, throw
from frappe.model.document import Document
from frappe.utils import flt, fmt_money

import erpnext


class OverlappingConditionError(frappe.ValidationError):
	pass


class FromGreaterThanToError(frappe.ValidationError):
	pass


class ManyBlankToValuesError(frappe.ValidationError):
	pass


class ShippingRule(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		from erpnext.accounts.doctype.shipping_rule_condition.shipping_rule_condition import (
			ShippingRuleCondition,
		)
		# //// Start: Custom Shipping Rule - Multiple Constraints ////
		from erpnext.accounts.doctype.shipping_rule_condition_multiple_constraints.shipping_rule_condition_multiple_constraints import (
			ShippingRuleConditionMultipleConstraints,
		)
		# //// End: Custom Shipping Rule - Multiple Constraints ////
		from erpnext.accounts.doctype.shipping_rule_country.shipping_rule_country import (
			ShippingRuleCountry,
		)

		account: DF.Link
		# //// Start: Custom Shipping Rule - Multiple Constraints ////
		# //// calculate_based_on: DF.Literal["Fixed", "Net Total", "Net Weight"]
		calculate_based_on: DF.Literal["Fixed", "Net Total", "Net Weight", "Multiple Constraints"]
		# //// End: Custom Shipping Rule - Multiple Constraints ////
		company: DF.Link
		# //// Start: Custom Shipping Rule - Multiple Constraints ////
		condition_multiple_constraints: DF.Table[ShippingRuleConditionMultipleConstraints]
		# //// End: Custom Shipping Rule - Multiple Constraints ////
		conditions: DF.Table[ShippingRuleCondition]
		cost_center: DF.Link
		countries: DF.Table[ShippingRuleCountry]
		disabled: DF.Check
		label: DF.Data
		shipping_amount: DF.Currency
		shipping_rule_type: DF.Literal["Selling", "Buying"]
	# end: auto-generated types

	# //// Start: Custom Shipping Rule - Multiple Constraints ////
	def validate(self):
		self.validate_from_to_values()
		self.sort_shipping_rule_conditions()
		# ////self.validate_overlapping_shipping_rule_conditions()
		# Only validate overlapping conditions if not using multiple constraints
		if self.calculate_based_on != "Multiple Constraints":
			self.validate_overlapping_shipping_rule_conditions()
	# //// End: Custom Shipping Rule - Multiple Constraints ////

	# //// Start: Custom Shipping Rule - Multiple Constraints ////
	def validate_from_to_values(self):
		# Skip validation for multiple constraints mode
		if self.calculate_based_on == "Multiple Constraints":
			return
			
		zero_to_values = []

		for d in self.get("conditions"):
			self.round_floats_in(d)

			# values cannot be negative
			self.validate_value("from_value", ">=", 0.0, d)
			self.validate_value("to_value", ">=", 0.0, d)

			if not d.to_value:
				zero_to_values.append(d)
			elif d.from_value >= d.to_value:
				throw(
					_("From value must be less than to value in row {0}").format(d.idx),
					FromGreaterThanToError,
				)

		# check if more than two or more rows has To Value = 0
		if len(zero_to_values) >= 2:
			throw(
				_('There can only be one Shipping Rule Condition with 0 or blank value for "To Value"'),
				ManyBlankToValuesError,
			)
	# //// End: Custom Shipping Rule - Multiple Constraints ////

	def apply(self, doc):
		"""Apply shipping rule on given doc. Called from accounts controller"""
		shipping_amount = 0.0
		by_value = False

		if doc.get_shipping_address():
			# validate country only if there is address
			self.validate_countries(doc)

		if self.calculate_based_on == "Net Total":
			value = doc.base_net_total
			by_value = True

		elif self.calculate_based_on == "Net Weight":
			value = doc.total_net_weight
			by_value = True

		elif self.calculate_based_on == "Fixed":
			shipping_amount = self.shipping_amount
			
		# //// Start: Custom Shipping Rule - Multiple Constraints ////
		elif self.calculate_based_on == "Multiple Constraints":
			shipping_amount = self.get_shipping_amount_from_multiple_constraints(doc)
		# //// End: Custom Shipping Rule - Multiple Constraints ////

		# shipping amount by value, apply conditions
		if by_value:
			shipping_amount = self.get_shipping_amount_from_rules(value)

		# convert to order currency
		if doc.currency != doc.company_currency:
			shipping_amount = flt(shipping_amount / doc.conversion_rate, 2)
		
		# //// Start: Custom Shipping Rule - Multiple Constraints ////
		# If shipping amount is 0, remove the shipping rule from the document
		if flt(shipping_amount) == 0:
			# Clear shipping rule fields from the document
			doc.shipping_rule = ""
			doc.shipping_rule_rate = 0
			
			# Remove any existing shipping charges from tax table
			self.remove_shipping_charges_from_tax_table(doc)
			
			return
		
		# Only add shipping rule to tax table if amount is greater than 0
		# //// End: Custom Shipping Rule - Multiple Constraints ////
		self.add_shipping_rule_to_tax_table(doc, shipping_amount)

	def get_shipping_amount_from_rules(self, value):
		# //// Start: Custom Shipping Rule - Multiple Constraints ////
		if not self.get("conditions"):
			frappe.throw(_("No conditions defined for the shipping rule. Please add at least one condition."), title=_("Incomplete configuration"))
		# //// End: Custom Shipping Rule - Multiple Constraints ////
		
		for condition in self.get("conditions"):
			if not condition.to_value or (flt(condition.from_value) <= flt(value) <= flt(condition.to_value)):
				return condition.shipping_amount

		return 0.0
		
	# //// Start: Custom Shipping Rule - Multiple Constraints ////
	def get_shipping_amount_from_multiple_constraints(self, doc):
		"""Apply shipping rule based on multiple grouped constraints
		
		Args:
			doc: The document to apply shipping rule to (Sales Order, Delivery Note, etc.)
		
		Returns:
			float: The calculated shipping amount based on constraints
		"""
		# Validation des conditions
		if not self.condition_multiple_constraints:
			frappe.throw(_("No conditions defined for the shipping rule with multiple constraints. Please add at least one condition."), title=_("Incomplete configuration"))
			return 0.0
		
		# Vérifier que les unités de mesure sont définies
		if not self.weight_uom:
			frappe.throw(_("Please define the weight unit for the shipping rule with multiple constraints."), title=_("Configuration incomplete"))
		
		if not self.dimensions_uom:
			frappe.throw(_("Please define the dimensional unit for the shipping rule with multiple constraints."), title=_("Configuration incomplete"))
			
		# Set a flag to prevent recursive application
		if hasattr(doc, '_processing_shipping_rule') and doc._processing_shipping_rule:
			return self.shipping_amount  # Default to fixed amount to break potential loops
		
		# Set processing flag
		doc._processing_shipping_rule = True
		
		try:
			valid_groups = {}
			
			# Extract values from document for comparison
			total_price = doc.base_net_total if hasattr(doc, 'base_net_total') else 0
			
			# Calculate max dimensions and total weight from items
			length = width = height = 0
			total_weight = 0
			
			# List to store items for 3D packing optimization
			packing_items = []
			
			# Get max dimensions and weight from all items
			if hasattr(doc, 'items') and doc.items:
				for item in doc.items:
					# Get item document to read dimensions and weight
					item_doc = None
					item_code = getattr(item, 'item_code', None)
					qty = flt(getattr(item, 'qty', 1))
					
					if item_code:
						try:
							item_doc = frappe.get_cached_doc("Item", item_code)
						except:
							pass
					
					# Get weight and dimensions from item doc
					if item_doc:
						# Get weight from item doc and convert to shipping rule's weight UOM
						item_weight = flt(getattr(item_doc, 'weight_per_unit', 0) or 0) * qty
						item_weight_uom = getattr(item_doc, 'weight_uom', None)
						
						# Convert weight to shipping rule's UOM if needed
						if item_weight_uom and item_weight_uom != self.weight_uom:
							try:
								item_weight = self.convert_to_uom(item_weight, item_weight_uom, self.weight_uom)
							except Exception as e:
								frappe.log_error(
									"Error calculating shipping rules",
									f"Error converting weight unit: {str(e)} for item {item_code}"
								)
						
						total_weight += item_weight
						
						# Get dimensions from item doc and convert to shipping rule's dimensions UOM
						item_length = getattr(item_doc, 'length', 0) or 0
						item_width = getattr(item_doc, 'width', 0) or 0
						item_height = getattr(item_doc, 'height', 0) or 0
						item_dimensions_uom = getattr(item_doc, 'dimensions_uom', None)
						
						# Convert dimensions to shipping rule's UOM if needed
						if item_dimensions_uom and item_dimensions_uom != self.dimensions_uom:
							try:
								item_length = self.convert_to_uom(item_length, item_dimensions_uom, self.dimensions_uom)
								item_width = self.convert_to_uom(item_width, item_dimensions_uom, self.dimensions_uom)
								item_height = self.convert_to_uom(item_height, item_dimensions_uom, self.dimensions_uom)
							except Exception as e:
								frappe.log_error(
									"Error calculating shipping rules",
									f"Error converting dimension unit: {str(e)} for item {item_code}"
								)
						
						# Update max dimensions
						if item_length > length:
							length = item_length
						if item_width > width:
							width = item_width
						if item_height > height:
							height = item_height
						
						# Add item to packing list for 3D optimization
						if item_length > 0 and item_width > 0 and item_height > 0:
							for i in range(int(qty)):
								packing_items.append({
									"name": f"{item_code}_{i}",
									"length": item_length,
									"width": item_width,
									"height": item_height,
									"weight": item_weight/qty if qty > 0 else 0
								})
					
					# If no item doc or no dimensions found, try to get from item row
					else:
						# Get dimensions directly from the item row if available
						item_length = flt(getattr(item, 'length', 0) or 0)
						item_width = flt(getattr(item, 'width', 0) or 0)
						item_height = flt(getattr(item, 'height', 0) or 0)
						item_dimensions_uom = getattr(item, 'dimension_uom', None) or ''
						
						# Convert dimensions if unit is specified and different
						if item_dimensions_uom and item_dimensions_uom != self.dimensions_uom:
							try:
								if item_length:
									item_length = self.convert_to_uom(item_length, item_dimensions_uom, self.dimensions_uom)
								if item_width:
									item_width = self.convert_to_uom(item_width, item_dimensions_uom, self.dimensions_uom)
								if item_height:
									item_height = self.convert_to_uom(item_height, item_dimensions_uom, self.dimensions_uom)
							except Exception as e:
								frappe.log_error(
									"Error calculating shipping rules",
									f"Error converting dimension unit from item row: {str(e)}"
								)
						
						# Update max dimensions
						if item_length > length:
							length = item_length
						if item_width > width:
							width = item_width
						if item_height > height:
							height = item_height
						
						# Add item to packing list for 3D optimization
						if item_length > 0 and item_width > 0 and item_height > 0:
							for i in range(int(qty)):
								packing_items.append({
									"name": f"Row_{item.idx}_{i}",
									"length": item_length,
									"width": item_width,
									"height": item_height,
									"weight": item_weight/qty if qty > 0 else 0
								})
			
			# Calculate optimized packing if we have items
			optimal_packing = self.calculate_optimal_packing(packing_items)
			
			# Process each constraint group
			for condition in self.condition_multiple_constraints:
				group = condition.condition_group
				
				# Initialize group if not exists
				if group not in valid_groups:
					valid_groups[group] = {
						"valid": True, 
						"shipping_amount": condition.shipping_amount
					}
				
				# Skip validation if group already invalid
				if not valid_groups[group]["valid"]:
					continue
				
				# Check if constraint is valid based on type
				constraint_value = 0
				
				# Determine the constraint value based on type
				if condition.constraint_type == "Weight":
					constraint_value = flt(total_weight)
					constraint_label = _("Weight")
					constraint_uom = self.weight_uom
					
				# Price constraint
				elif condition.constraint_type == "Price":
					constraint_value = flt(total_price)
					constraint_label = _("Price")
					constraint_uom = doc.currency if hasattr(doc, 'currency') else ''
				
				# Length constraint
				elif condition.constraint_type == "Length":
					# Use the optimally packed length if available
					if optimal_packing["length"] > 0:
						constraint_value = flt(optimal_packing["length"])
					else:
						constraint_value = flt(length)
					constraint_label = _("Length")
					constraint_uom = self.dimensions_uom
				
				# Width constraint
				elif condition.constraint_type == "Width":
					# Use the optimally packed width if available
					if optimal_packing["width"] > 0:
						constraint_value = flt(optimal_packing["width"])
					else:
						constraint_value = flt(width)
					constraint_label = _("Width")
					constraint_uom = self.dimensions_uom
				
				# Height constraint
				elif condition.constraint_type == "Height":
					# Use the optimally packed height if available
					if optimal_packing["height"] > 0:
						constraint_value = flt(optimal_packing["height"])
					else:
						constraint_value = flt(height)
					constraint_label = _("Height")
					constraint_uom = self.dimensions_uom
				else:
					continue
				
				# Check if constraint value is within range
				min_value = flt(condition.min_value) if condition.min_value is not None else 0
				max_value = flt(condition.max_value) if condition.max_value is not None else float('inf')
				
				# Check if the value is within the defined range
				if not (min_value <= constraint_value <= max_value):
					valid_groups[group]["valid"] = False
					
					# Register invalid reason
					if "invalid_reasons" not in valid_groups[group]:
						valid_groups[group]["invalid_reasons"] = []
					
					# Format reason with appropriate units
					reason = _("The value {0} {1} ({2}) is not within the range {3}-{4}").format(
						constraint_label,
						flt(constraint_value, precision=2),
						constraint_uom,
						flt(min_value, precision=2),
						_("infini") if max_value == float('inf') else flt(max_value, precision=2)
					)
					valid_groups[group]["invalid_reasons"].append(reason)
			
			# Find the first valid group and apply its shipping amount
			for group, data in valid_groups.items():
				if data["valid"]:
					return data["shipping_amount"]
			
			return 0.0

		finally:
			# Clear processing flag
			doc._processing_shipping_rule = False

	@classmethod
	def calculate_optimal_packing(cls, packing_items):
		"""Calculate optimal 3D arrangement of items using py3dbp bin packing algorithm
		
		Args:
			packing_items (list): List of items with dimensions
		
		Returns:
			dict: Optimal packing dimensions
		"""
		try:
			# Import py3dbp library
			from py3dbp import Packer, Bin, Item
			
			# If no items with dimensions, return default values
			if not packing_items:
				return {
					"length": 0, 
					"width": 0, 
					"height": 0, 
					"volume": 0
				}
			
			# Create a virtual packing bin with large dimensions
			# We use this to find the optimal arrangement, not to validate constraints
			max_dim = 1000000  # A very large dimension to ensure all items can fit
			virtual_bin = Bin('VirtualContainer', max_dim, max_dim, max_dim, max_dim)
			
			# Initialize the packer
			packer = Packer()
			packer.add_bin(virtual_bin)
			
			# Add all items to the packer
			for i, item in enumerate(packing_items):
				# Extract dimensions from the item dictionary
				length = float(item.get("length", 0))
				width = float(item.get("width", 0))
				height = float(item.get("height", 0))
				weight = float(item.get("weight", 0))
				
				# Skip invalid items
				if length <= 0 or width <= 0 or height <= 0:
					continue
				
				# Create an item for py3dbp
				item_id = f"Item_{i}"
				packing_item = Item(item_id, length, width, height, weight)
				
				# Allow rotation for better packing
				# This will try different orientations of the item
				packing_item.position = [0, 0, 0]  # Default position
				
				# Enable rotation for better packing
				packing_item.can_rotate = True
				
				# For books, it is very important to allow stacking
				# That's why we enable all possible rotations
				packing_item.rotation_type = 0  # Allow all rotations (default value in py3dbp)
				
				# Add item to the packer
				packer.add_item(packing_item)
						
			# Run the packing algorithm
			# This will arrange items in the virtual container
			packer.pack(bigger_first=True)
			
			# Get the packed bin
			packed_bin = packer.bins[0]
			
			# If no items were packed (could happen if all items have invalid dimensions)
			if not packed_bin.items:
				return {
					"length": 0, 
					"width": 0, 
					"height": 0, 
					"volume": 0
				}
			
			# Calculate the maximum dimensions used by the packed items
			max_x = max_y = max_z = 0
			for item in packed_bin.items:
				# Get position and dimensions
				pos = item.position
				dim = item.get_dimension()
				
				# Calculate the furthest point in each dimension
				max_x = max(max_x, float(pos[0]) + float(dim[0]))
				max_y = max(max_y, float(pos[1]) + float(dim[1]))
				max_z = max(max_z, float(pos[2]) + float(dim[2]))
			
			
			# Identify the smallest dimension - probably height for books
			dimensions_sorted = sorted([max_x, max_y, max_z])
			
			# For books or flat objects, we reorder the dimensions 
			# to make the height the smallest dimension
			# and length > width
			if len(packing_items) == 1:
				# For a single item, we respect the original dimensions
				# because it might be important for dimension constraints
				result = {
					"length": max_x,
					"width": max_y,
					"height": max_z,
					"volume": max_x * max_y * max_z
				}
				return result
			else:
				# For multiple items, we reorder the dimensions
				# The smallest dimension (index 0) becomes the height
				# The other two become length and width (with length >= width)
				height = dimensions_sorted[0]
				width = dimensions_sorted[1]
				length = dimensions_sorted[2]
				
				# We use the dimensions calculated by py3dbp instead of artificially multiplying
				# because the algorithm has already determined the optimal placement (side by side or stacked)
				result = {
					"length": length,
					"width": width,
					"height": height,
					"volume": length * width * height
				}
				return result
			
		except ImportError:
			# Fallback to the original packing algorithm if py3dbp is not available
			frappe.log_error("py3dbp library not available, falling back to basic packing algorithm", "ShippingRule")
			
			# If no items with dimensions, return default values
			if not packing_items:
				return {
					"length": 0, 
					"width": 0, 
					"height": 0, 
					"volume": 0
				}
			
			# Sort items by volume (largest first) for better packing
			packing_items.sort(key=lambda x: x["length"] * x["width"] * x["height"], reverse=True)
			
			# Group items by dimensions while preserving orientation
			grouped_items = {}
			for item in packing_items:
				# Use original dimensions to preserve orientation
				item_key = (item["length"], item["width"], item["height"])
				
				if item_key not in grouped_items:
					grouped_items[item_key] = []
				grouped_items[item_key].append(item)
			
			# Simplified bin packing - stack similar items
			packings = []
			for dims, items in grouped_items.items():
				# Keep original orientations
				l, w, h = dims
				
				# How many items in this group
				count = len(items)
				
				# For a single item, just use its dimensions directly
				if count == 1:
					packings.append({
						"length": l,
						"width": w,
						"height": h,
						"items": 1,
						"volume": l * w * h,
						"type": "single"
					})
					continue
				
				# Generate possible stacking arrangements
				# Option 1: Stack vertically (on top of each other)
				vert_stack = {
					"length": l,
					"width": w,
					"height": h * count,
					"items": count,
					"volume": l * w * h * count,
					"type": "vertical"
				}
				
				# Option 2: Arrange horizontally in length
				length_stack = {
					"length": l * count,
					"width": w,
					"height": h,
					"items": count,
					"volume": l * w * h * count,
					"type": "length"
				}
				
				# Option 3: Arrange horizontally in width
				width_stack = {
					"length": l,
					"width": w * count,
					"height": h,
					"items": count,
					"volume": l * w * h * count,
					"type": "width"
				}
				
				# Add all options for this group
				packings.extend([vert_stack, length_stack, width_stack])
			
			# Find the most compact arrangement (minimize the max of length, width, height)
			if packings:
				# IMPORTANT: For single items, we must prioritize original dimensions to avoid
				# breaking shipping rules validation
				single_item_packings = [p for p in packings if p.get("type") == "single"]
				if single_item_packings:
					best_packing = single_item_packings[0]
				else:
					# Sort by maximum dimension
					packings.sort(key=lambda x: max(x["length"], x["width"], x["height"]))
					best_packing = packings[0]
				
				return best_packing
			else:
				return {
					"length": 0,
					"width": 0,
					"height": 0,
					"volume": 0
				}
		except Exception as e:
			# Log any other errors and return a safe default
			frappe.log_error(f"Error in calculate_optimal_packing: {str(e)}", "ShippingRule")
			return {
				"length": 0, 
				"width": 0, 
				"height": 0, 
				"volume": 0
			}

	def convert_to_uom(self, value, from_uom, to_uom):
		"""Convert value from one UOM to another
		
		Args:
			value (float): The value to convert
			from_uom (str): Source UOM
			to_uom (str): Target UOM
		
		Returns:
			float: Converted value
		"""
		# If the value is null or the UOM is the same, return the value as is
		if not value or not from_uom or not to_uom or from_uom == to_uom:
			return value
		
		# Try to find a direct conversion factor first
		uom_conversion = frappe.db.get_value(
			"UOM Conversion Factor",
			{"from_uom": from_uom, "to_uom": to_uom},
			"value"
		)
		
		if uom_conversion:
			return flt(value) * flt(uom_conversion)
		
		# Try the reverse conversion
		reverse_conversion = frappe.db.get_value(
			"UOM Conversion Factor",
			{"from_uom": to_uom, "to_uom": from_uom},
			"value"
		)
		
		if reverse_conversion:
			return flt(value) / flt(reverse_conversion)
		
		# Fallback method: use standard conversion factors
		try:
			from_conversion_factor = frappe.get_value("UOM Conversion Detail", 
				{"parent": "UOM", "uom": from_uom}, "conversion_factor") or 1.0
			to_conversion_factor = frappe.get_value("UOM Conversion Detail", 
				{"parent": "UOM", "uom": to_uom}, "conversion_factor") or 1.0
			
			# Convert value
			return flt(value) * flt(from_conversion_factor) / flt(to_conversion_factor)
		except Exception as e:
			frappe.log_error(f"Error converting unit from {from_uom} to {to_uom}: {str(e)}")
			frappe.throw(_("No conversion factor found between {0} and {1}").format(from_uom, to_uom))
	# //// End: Custom Shipping Rule - Multiple Constraints ////

	def validate_countries(self, doc):
		# validate applicable countries
		if self.countries:
			shipping_country = doc.get_shipping_address().get("country")
			if not shipping_country:
				frappe.throw(
					_("Shipping Address does not have country, which is required for this Shipping Rule")
				)
			if shipping_country not in [d.country for d in self.countries]:
				frappe.throw(
					_("Shipping rule not applicable for country {0} in Shipping Address").format(
						shipping_country
					)
				)

	# //// Start: Custom Shipping Rule - Multiple Constraints ////
	def remove_shipping_charges_from_tax_table(self, doc):
		"""
		Remove all shipping-related charges from the tax table.
		
		Args:
			doc: The document to remove shipping charges from
		"""
		# Get all shipping account heads and labels to identify shipping taxes
		shipping_accounts = []
		shipping_labels = []
		try:
			shipping_rules = frappe.get_all("Shipping Rule", fields=["account", "label"])
			for rule in shipping_rules:
				if rule.account and rule.account not in shipping_accounts:
					shipping_accounts.append(rule.account)
				if rule.label and rule.label not in shipping_labels:
					shipping_labels.append(rule.label)
		except:
			pass
			
		# Identify shipping taxes to remove
		shipping_taxes_to_remove = []
		for i, tax in enumerate(doc.get("taxes", [])):
			# Check if this is a shipping-related tax using account_head
			if hasattr(tax, "account_head") and tax.account_head in shipping_accounts:
				shipping_taxes_to_remove.append(i)
				continue
				
			if not hasattr(tax, "description") or not tax.description:
				continue
				
			# Check using description - look for any shipping rule label
			if any(label in tax.description for label in shipping_labels):
				shipping_taxes_to_remove.append(i)
				continue
				
			# Check for generic shipping terms
			if (self.label in tax.description or
				"shipping" in tax.description.lower() or
				"delivery" in tax.description.lower() or
				"freight" in tax.description.lower() or
				"port" in tax.description.lower() or
				"multi" in tax.description.lower()):
				shipping_taxes_to_remove.append(i)
		
		# Remove shipping taxes in reverse order to avoid index issues
		for idx in sorted(shipping_taxes_to_remove, reverse=True):
			doc.taxes.pop(idx)
	
	def add_shipping_rule_to_tax_table(self, doc, shipping_amount):
		# ////shipping_charge = {
		# ////	"charge_type": "Actual",
		# ////	"account_head": self.account,
		# ////	"cost_center": self.cost_center,
		# ////}
		
		"""
		Add shipping charges to the tax table.
		This method supports multiple constraints and applies tax templates if defined.
		"""
		# Store original taxes for later reference
		original_taxes = []
		for tax in doc.get("taxes", []):
			if hasattr(tax, "as_dict"):
				original_taxes.append(tax.as_dict())
			else:
				original_taxes.append(dict(tax or {}))
				
		# First remove any existing shipping charges
		self.remove_shipping_charges_from_tax_table(doc)
		
		# Store loyalty taxes separately and remove them temporarily
		loyalty_taxes = []
		for i in range(len(doc.taxes) - 1, -1, -1):  # Process in reverse to avoid index issues
			tax = doc.taxes[i]
			if hasattr(tax, 'is_loyalty_points_reduction') and tax.is_loyalty_points_reduction:
				loyalty_taxes.append(tax)
				doc.taxes.pop(i)
		
		# Define document type based on shipping rule type
		if self.shipping_rule_type == "Selling":
			# check if not applied on purchase
			if not doc.meta.get_field("taxes").options == "Sales Taxes and Charges":
				frappe.throw(_("Shipping rule only applicable for Selling"))
			# //// shipping_charge["doctype"] = "Sales Taxes and Charges"
			doctype = "Sales Taxes and Charges"
		else:
			# check if not applied on sales
			if not doc.meta.get_field("taxes").options == "Purchase Taxes and Charges":
				frappe.throw(_("Shipping rule only applicable for Buying"))
			# ////shipping_charge["doctype"] = "Purchase Taxes and Charges"
			# ////shipping_charge["category"] = "Valuation and Total"
			# ////shipping_charge["add_deduct_tax"] = "Add"

		# ////existing_shipping_charge = doc.get("taxes", filters=shipping_charge)
		# ////if existing_shipping_charge:
			# ////take the last record found
			# ////existing_shipping_charge[-1].tax_amount = shipping_amount
			doctype = "Purchase Taxes and Charges"
		
		# Calculate base amount and taxes if applicable
		base_shipping_amount = shipping_amount
		tax_rows = []
		
		# Process tax template if available
		if hasattr(self, 'taxable_account') and self.taxable_account:
			try:
				tax_templates = frappe.get_doc("Item Tax Template", self.taxable_account)
				
				if tax_templates and tax_templates.taxes:
					total_tax_rate = 0
					
					# Calculate total tax rate from all applicable taxes
					for tax in tax_templates.taxes:
						if tax.tax_rate:
							total_tax_rate += flt(tax.tax_rate)
					
					# Calculate base shipping amount based on whether tax is included
					if hasattr(self, 'tax_is_included') and self.tax_is_included:
						# If tax is included, divide by (1 + tax_rate) to get base amount
						base_shipping_amount = flt(shipping_amount) / (1 + (total_tax_rate / 100))
					else:
						# If tax is not included, use the full amount as base
						base_shipping_amount = shipping_amount
					
					# Prepare tax rows for tax calculation
					for tax in tax_templates.taxes:
						if flt(tax.tax_rate) > 0:
							# Calculate tax amount based on base shipping amount
							tax_amount = flt(base_shipping_amount) * flt(tax.tax_rate) / 100
							
							# Get account name for better description
							account_name = ""
							try:
								account_name = frappe.get_cached_value('Account', tax.tax_type, 'account_name')
							except:
								account_name = tax.tax_type
							
							# Prepare a simple tax row with minimum required fields
							tax_rows.append({
								"description": f"{self.label} - {account_name} ({tax.tax_rate}%)",
								"account_head": tax.tax_type,
								"charge_type": "Actual",
								"tax_amount": tax_amount,
								"cost_center": self.cost_center
							})
			except Exception as e:
				frappe.log_error(f"Error processing shipping rule taxes: {str(e)}")
		
		# Add the shipping charge
		if self.shipping_rule_type == "Selling":
			# For selling, we just need basic fields
			new_tax_row = {
				"doctype": "Sales Taxes and Charges",
				"charge_type": "Actual",
				"description": self.label,
				"account_head": self.account,
				"cost_center": self.cost_center,
				"tax_amount": base_shipping_amount
			}
		else:
			# //// shipping_charge["tax_amount"] = shipping_amount
			# //// shipping_charge["description"] = self.label
			# //// doc.append("taxes", shipping_charge)
			# For buying, we need additional fields
			new_tax_row = {
				"doctype": "Purchase Taxes and Charges",
				"charge_type": "Actual",
				"description": self.label,
				"account_head": self.account,
				"cost_center": self.cost_center,
				"tax_amount": base_shipping_amount,
				"category": "Valuation and Total",
				"add_deduct_tax": "Add"
			}

		# Final step: append the main shipping row and any tax rows
		try:
			# Find the maximum idx currently in the taxes table
			max_idx = 0
			for tax in doc.taxes:
				if hasattr(tax, 'idx') and tax.idx > max_idx:
					max_idx = tax.idx

			# Add the main shipping charge with the next available idx
			new_tax_row["idx"] = max_idx + 1
			doc.append("taxes", new_tax_row)
			max_idx += 1

			# Add all tax rows
			for tax_row in tax_rows:
				# Add necessary doctype info based on shipping rule type
				if self.shipping_rule_type == "Selling":
					tax_row["doctype"] = "Sales Taxes and Charges"
				else:
					tax_row["doctype"] = "Purchase Taxes and Charges"
					tax_row["category"] = "Valuation and Total"
					tax_row["add_deduct_tax"] = "Add"

				# Increment idx for each tax row
				max_idx += 1
				tax_row["idx"] = max_idx

				# Add the tax row
				doc.append("taxes", tax_row)

			# Now restore loyalty taxes at the end with incremented idx values
			for loyalty_tax in loyalty_taxes:
				max_idx += 1
				loyalty_tax.idx = max_idx
				doc.append("taxes", loyalty_tax)

			# Reindex all taxes to ensure sequential idx values
			for i, tax in enumerate(doc.taxes):
				tax.idx = i + 1

			# Store shipping rule information in document for reference
			doc.shipping_rule = self.name
			doc.shipping_rule_rate = shipping_amount
		except Exception as e:
			frappe.log_error(f"Failed to add shipping tax rows: {str(e)}")
	# //// End: Custom Shipping Rule - Multiple Constraints ////

	def sort_shipping_rule_conditions(self):
		"""Sort Shipping Rule Conditions based on increasing From Value"""
		self.shipping_rules_conditions = sorted(self.conditions, key=lambda d: flt(d.from_value))
		for i, d in enumerate(self.conditions):
			d.idx = i + 1

	def validate_overlapping_shipping_rule_conditions(self):
		def overlap_exists_between(num_range1, num_range2):
			"""
			num_range1 and num_range2 are two ranges
			ranges are represented as a tuple e.g. range 100 to 300 is represented as (100, 300)
			if condition num_range1 = 100 to 300
			then condition num_range2 can only be like 50 to 99 or 301 to 400
			hence, non-overlapping condition = (x1 <= x2 < y1 <= y2) or (y1 <= y2 < x1 <= x2)
			"""
			(x1, x2), (y1, y2) = num_range1, num_range2
			separate = (x1 <= x2 <= y1 <= y2) or (y1 <= y2 <= x1 <= x2)
			return not separate

		overlaps = []
		for i in range(0, len(self.conditions)):
			for j in range(i + 1, len(self.conditions)):
				d1, d2 = self.conditions[i], self.conditions[j]
				if d1.as_dict() != d2.as_dict():
					# in our case, to_value can be zero, hence pass the from_value if so
					range_a = (d1.from_value, d1.to_value or d1.from_value)
					range_b = (d2.from_value, d2.to_value or d2.from_value)
					if overlap_exists_between(range_a, range_b):
						overlaps.append([d1, d2])

		if overlaps:
			company_currency = erpnext.get_company_currency(self.company)
			msgprint(_("Overlapping conditions found between:"))
			messages = []
			for d1, d2 in overlaps:
				messages.append(
					f"{d1.from_value}-{d1.to_value} = {fmt_money(d1.shipping_amount, currency=company_currency)} "
					+ _("and")
					+ f" {d2.from_value}-{d2.to_value} = {fmt_money(d2.shipping_amount, currency=company_currency)}"
				)

			msgprint("\n".join(messages), raise_exception=OverlappingConditionError)