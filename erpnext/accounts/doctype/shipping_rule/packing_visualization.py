# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
import os
import json
import time
import numpy as np
from frappe.utils import get_files_path

def generate_packing_visualization(items_data, bin_dimensions=None):
	"""
	Generate 3D visualization of item packing in a shipping container
	
	Args:
		items_data: List of items with dimensions and quantity
		bin_dimensions: Dimensions of the shipping container (optional)
		
	Returns:
		Dict: Packing information and path to generated image
	"""
	try:
		# Import necessary libraries
		from py3dbp import Packer, Bin, Item
		import matplotlib.pyplot as plt
		from mpl_toolkits.mplot3d import Axes3D
		
		# Convert items_data from JSON to list if necessary
		if isinstance(items_data, str):
			items_data = json.loads(items_data)
		
		# Prepare items for packing
		packing_items = []
		for item in items_data:
			for i in range(int(item.get("qty", 1))):
				# Check if this item already has a precalculated position
				position = item.get("position", None)
				
				packing_items.append({
					"name": item.get("name", "Item"),
					"length": float(item.get("length", 0)),
					"width": float(item.get("width", 0)),
					"height": float(item.get("height", 0)),
					"weight": float(item.get("weight", 0)),
					"position": position[i] if position and isinstance(position, list) and i < len(position) else None
				})
		
		# If no container dimensions are provided, calculate optimal dimensions
		if not bin_dimensions:
			from erpnext.accounts.doctype.shipping_rule.shipping_rule import ShippingRule
			bin_dimensions = ShippingRule.calculate_optimal_packing(packing_items)
		
		# Check if items are all identical (like books) and flat
		all_identical = True
		is_flat = False
		items_with_positions = 0
		
		if len(packing_items) > 1:
			first_item = packing_items[0]
			first_dims = (
				float(first_item.get("length", 0)),
				float(first_item.get("width", 0)),
				float(first_item.get("height", 0))
			)
			
			# Check if item is flat
			if first_dims[2] > 0 and (first_dims[0] / first_dims[2] > 5 or first_dims[1] / first_dims[2] > 5):
				is_flat = True
			
			# Check if all items have identical dimensions
			for item in packing_items[1:]:
				item_dims = (
					float(item.get("length", 0)),
					float(item.get("width", 0)),
					float(item.get("height", 0))
				)
				
				if item_dims != first_dims:
					all_identical = False
					break
			
			# Count items with positions
			items_with_positions = sum(1 for item in packing_items if item.get("position") is not None)
		
		# Initialize packer
		packer = Packer()
		
		# Create virtual container
		virtual_bin = Bin("Colis", 
						bin_dimensions["length"], 
						bin_dimensions["width"], 
						bin_dimensions["height"], 
						bin_dimensions["length"] * bin_dimensions["width"] * bin_dimensions["height"])
		packer.add_bin(virtual_bin)
		
		# For identical flat items (like books) that don't have precalculated positions
		if is_flat and all_identical and items_with_positions == 0 and len(packing_items) > 1:
			# Calculate stacked height based on item height
			item_height = float(packing_items[0].get("height", 0))
			
			# Manually set positions to stack items vertically
			for i, item in enumerate(packing_items):
				item["position"] = [0, 0, i * item_height]
				items_with_positions += 1
				
			frappe.log_error("PackingVisualization", f"Stacking {len(packing_items)} identical flat items vertically")
		
		# If items don't have precalculated positions, run packing algorithm
		if items_with_positions == 0:
			# Add items to packer
			for i, item in enumerate(packing_items):
				packing_item = Item(f"Item_{i}_{item['name']}", 
								item.get("length"), 
								item.get("width"), 
								item.get("height"), 
								item.get("weight", 0))
				packing_item.can_rotate = True
				packing_item.rotation_type = 0
				packer.add_item(packing_item)
			
			# Execute packing algorithm
			packer.pack(bigger_first=True)
		
		# Create visualization
		fig = plt.figure(figsize=(10, 8))
		ax = fig.add_subplot(111, projection='3d')
		
		# Define a palette of vibrant colors
		colors = [
			[0.8, 0.2, 0.2],  # Red
			[0.2, 0.8, 0.2],  # Green
			[0.2, 0.2, 0.8],  # Blue
			[0.8, 0.8, 0.2],  # Yellow
			[0.8, 0.2, 0.8],  # Magenta
			[0.2, 0.8, 0.8],  # Cyan
			[0.8, 0.5, 0.2],  # Orange
			[0.5, 0.2, 0.8],  # Purple
			[0.2, 0.5, 0.8],  # Light blue
			[0.5, 0.8, 0.2],  # Light green
		]
		
		# Function to get a color from the palette
		def get_random_color():
			return colors[np.random.randint(0, len(colors))]
		
		# Function to add a 3D box (representing an item)
		def add_box(ax, item, color):
			# Extract position and dimensions
			pos = np.array(item.position, dtype=float)
			dim = np.array(item.get_dimension(), dtype=float)
			
			# Extract original item name for display
			item_name = item.name.split("_", 2)[2] if "_" in item.name else item.name
			# Limit name length for display
			if len(item_name) > 15:
				item_name = item_name[:12] + "..."
			
			# Create a rectangular prism with moderate transparency
			# Use intermediate points for better rendering
			xx, yy = np.meshgrid(np.linspace(pos[0], pos[0]+dim[0], 2), np.linspace(pos[1], pos[1]+dim[1], 2))
			ax.plot_surface(xx, yy, np.full_like(xx, pos[2]), color=color, alpha=0.5, edgecolor='k', linewidth=0.5)
			ax.plot_surface(xx, yy, np.full_like(xx, pos[2]+dim[2]), color=color, alpha=0.5, edgecolor='k', linewidth=0.5)
			
			yy, zz = np.meshgrid(np.linspace(pos[1], pos[1]+dim[1], 2), np.linspace(pos[2], pos[2]+dim[2], 2))
			ax.plot_surface(np.full_like(yy, pos[0]), yy, zz, color=color, alpha=0.5, edgecolor='k', linewidth=0.5)
			ax.plot_surface(np.full_like(yy, pos[0]+dim[0]), yy, zz, color=color, alpha=0.5, edgecolor='k', linewidth=0.5)
			
			xx, zz = np.meshgrid(np.linspace(pos[0], pos[0]+dim[0], 2), np.linspace(pos[2], pos[2]+dim[2], 2))
			ax.plot_surface(xx, np.full_like(xx, pos[1]), zz, color=color, alpha=0.5, edgecolor='k', linewidth=0.5)
			ax.plot_surface(xx, np.full_like(xx, pos[1]+dim[1]), zz, color=color, alpha=0.5, edgecolor='k', linewidth=0.5)
			
			# Add annotation with item name and dimensions
			center_pos = pos + dim/2
			dim_text = f"{item_name}\n{dim[0]:.1f}x{dim[1]:.1f}x{dim[2]:.1f} cm"
			ax.text(center_pos[0], center_pos[1], center_pos[2], dim_text, 
				   ha='center', va='center', fontsize=8, color='black', fontweight='bold')
			
			# Draw edges for better visibility
			edge_color = [max(0, c-0.2) for c in color]  # Darker color for edges
			
			# Vertical edges
			for i in [0, 1]:
				for j in [0, 1]:
					ax.plot([pos[0]+i*dim[0], pos[0]+i*dim[0]],
						 [pos[1]+j*dim[1], pos[1]+j*dim[1]],
						 [pos[2], pos[2]+dim[2]], color=edge_color, linewidth=2)
						 
			# Bottom horizontal edges
			for i in [0, 1]:
				ax.plot([pos[0], pos[0]+dim[0]],
					 [pos[1]+i*dim[1], pos[1]+i*dim[1]],
					 [pos[2], pos[2]], color=edge_color, linewidth=2)
				ax.plot([pos[0]+i*dim[0], pos[0]+i*dim[0]],
					 [pos[1], pos[1]+dim[1]],
					 [pos[2], pos[2]], color=edge_color, linewidth=2)
					 
			# Top horizontal edges
			for i in [0, 1]:
				ax.plot([pos[0], pos[0]+dim[0]],
					 [pos[1]+i*dim[1], pos[1]+i*dim[1]],
					 [pos[2]+dim[2], pos[2]+dim[2]], color=edge_color, linewidth=2)
				ax.plot([pos[0]+i*dim[0], pos[0]+i*dim[0]],
					 [pos[1], pos[1]+dim[1]],
					 [pos[2]+dim[2], pos[2]+dim[2]], color=edge_color, linewidth=2)
			
			# Extract item name from item name
			item_name = item.name.split("_", 2)[2] if "_" in item.name else item.name
			
			# Add item name to the center of the box
			center = pos + dim/2
			ax.text(center[0], center[1], center[2], item_name, 
			       color='black', ha='center', va='center', fontweight='bold')
		
		# Draw the bin (container)
		bin_dims = [float(bin_dimensions["length"]), float(bin_dimensions["width"]), float(bin_dimensions["height"])]
		
		# Draw the bin edges in black with thicker lines
		for x in [0, bin_dims[0]]:
			for y in [0, bin_dims[1]]:
				ax.plot([x, x], [y, y], [0, bin_dims[2]], 'k-', linewidth=2)
		
		for x in [0, bin_dims[0]]:
			for z in [0, bin_dims[2]]:
				ax.plot([x, x], [0, bin_dims[1]], [z, z], 'k-', linewidth=2)
		
		for y in [0, bin_dims[1]]:
			for z in [0, bin_dims[2]]:
				ax.plot([0, bin_dims[0]], [y, y], [z, z], 'k-', linewidth=2)
				
		# Add transparent grid on the faces to facilitate 3D perception
		# Bottom face
		xx, yy = np.meshgrid(np.linspace(0, bin_dims[0], 5), np.linspace(0, bin_dims[1], 5))
		ax.plot_surface(xx, yy, np.zeros_like(xx), color=[0.9, 0.9, 0.9], alpha=0.1)
		
		# Back face
		yy, zz = np.meshgrid(np.linspace(0, bin_dims[1], 5), np.linspace(0, bin_dims[2], 5))
		ax.plot_surface(np.zeros_like(yy), yy, zz, color=[0.9, 0.9, 0.9], alpha=0.1)
		
		# Left face
		xx, zz = np.meshgrid(np.linspace(0, bin_dims[0], 5), np.linspace(0, bin_dims[2], 5))
		ax.plot_surface(xx, np.zeros_like(xx), zz, color=[0.9, 0.9, 0.9], alpha=0.1)
		
		# Draw packed items
		packed_items_info = []
		
		# Handle items with precalculated positions
		if items_with_positions > 0:
			frappe.log_error("PackingVisualization", f"Using {items_with_positions} precalculated positions")
			
			# Create Item objects with precalculated positions
			custom_items = []
			for i, item_data in enumerate(packing_items):
				if item_data.get("position") is not None:
					item = Item(f"Item_{i}_{item_data['name']}", 
								float(item_data.get("length", 0)),
								float(item_data.get("width", 0)), 
								float(item_data.get("height", 0)),
								float(item_data.get("weight", 0)))
					item.position = item_data["position"]
					custom_items.append(item)
					
					# Also store item info for the report
					pos = np.array(item.position, dtype=float)
					dim = np.array([float(item_data.get("length", 0)), 
					                float(item_data.get("width", 0)), 
					                float(item_data.get("height", 0))], dtype=float)
					
					# Extract original item name
					item_name = item_data.get("name", f"Item_{i}")
					
					packed_items_info.append({
						"name": item_name,
						"position": pos.tolist(),
						"dimensions": dim.tolist()
					})
			
			# Draw each item with a different color
			for item in custom_items:
				color = get_random_color()
				add_box(ax, item, color)
		else:
			# Use items packed by py3dbp algorithm
			for bin in packer.bins:
				for item in bin.items:
					color = get_random_color()
					add_box(ax, item, color)
					
					# Collect information about the item for the report
					pos = np.array(item.position, dtype=float)
					dim = np.array(item.get_dimension(), dtype=float)
					
					# Extract original item name
					item_name = item.name.split("_", 2)[2] if "_" in item.name else item.name
					
					packed_items_info.append({
						"name": item_name,
						"position": pos.tolist(),
						"dimensions": dim.tolist()
					})
		
		# Configure axes
		ax.set_xlabel('Length (cm)', fontweight='bold')
		ax.set_ylabel('Width (cm)', fontweight='bold')
		ax.set_zlabel('Height (cm)', fontweight='bold')
		ax.set_title('Packing Visualization', fontsize=14, fontweight='bold')
		
		# Define axis limits with a small margin around the container for better visualization
		ax.set_xlim([-bin_dims[0]*0.05, bin_dims[0]*1.05])
		ax.set_ylim([-bin_dims[1]*0.05, bin_dims[1]*1.05])
		ax.set_zlim([-bin_dims[2]*0.05, bin_dims[2]*1.05])
		
		# Improve the angle of view to better see the proportions
		ax.view_init(elev=25, azim=135)
		
		# IMPORTANT: Disable auto-scaling to preserve real proportions
		# This ensures that dimensions are displayed with the correct proportions
		ax.set_box_aspect([bin_dims[0], bin_dims[1], bin_dims[2]])
		
		# Add annotations for container dimensions
		ax.text(bin_dims[0]/2, -bin_dims[1]*0.1, -bin_dims[2]*0.1, f"Length: {bin_dims[0]:.1f} cm", 
			   ha='center', va='center', fontweight='bold')
		ax.text(-bin_dims[0]*0.1, bin_dims[1]/2, -bin_dims[2]*0.1, f"Width: {bin_dims[1]:.1f} cm", 
			   ha='center', va='center', fontweight='bold')
		ax.text(-bin_dims[0]*0.1, -bin_dims[1]*0.1, bin_dims[2]/2, f"Height: {bin_dims[2]:.1f} cm", 
			   ha='center', va='center', fontweight='bold')
		
		# Save the image
		files_path = get_files_path()
		packing_viz_dir = os.path.join(files_path, 'packing_visualization')
		
		# Create the directory if it doesn't exist
		if not os.path.exists(packing_viz_dir):
			os.makedirs(packing_viz_dir)
		
		# Generate a unique filename
		img_filename = f"packing_viz_{int(time.time())}.png"
		img_path = os.path.join(packing_viz_dir, img_filename)
		
		# Save the image
		plt.savefig(img_path)
		plt.close()
		
		# Generate a relative URL for browser access
		img_url = f"/files/packing_visualization/{img_filename}"
		
		# Return packing information
		return {
			"success": True,
			"message": "Packing visualization generated successfully",
			"image_url": img_url,
			"bin_dimensions": bin_dimensions,
			"packed_items": packed_items_info
		}
		
	except ImportError as e:
		return {
			"success": False,
			"message": f"Error importing: {str(e)}. Please install required libraries: py3dbp, matplotlib, numpy."
		}
	except Exception as e:
		frappe.log_error("PackingVisualizationError", e)
		return {
			"success": False,
			"message": f"Error generating packing visualization: {str(e)}"
		}

@frappe.whitelist()
def visualize_packing(items_data, shipping_rule=None, bin_dimensions=None):
	"""
	API endpoint for generating a packing visualization
	
	Args:
		items_data: JSON string or list of articles with dimensions
		shipping_rule: ID of the shipping rule (optional)
		bin_dimensions: Custom container dimensions (optional)
		
	Returns:
		Dict: Packing information and image URL
	"""
	try:
		# Convert items_data from JSON to list if necessary
		if isinstance(items_data, str):
			items_data = json.loads(items_data)
		
		# Convert bin_dimensions from JSON to dict if necessary
		if isinstance(bin_dimensions, str) and bin_dimensions:
			bin_dimensions = json.loads(bin_dimensions)
			
		# Initialize shipping rule information
		shipping_info = {
			"shipping_rule_name": "",
			"constraint_name": ""
		}
		
		# If no custom dimensions are provided but a shipping rule is specified
		if not bin_dimensions and shipping_rule:
			rule = frappe.get_doc("Shipping Rule", shipping_rule)
			
			# Get the name of the shipping rule
			shipping_info["shipping_rule_name"] = rule.label or rule.name
			
			# For rules with multiple constraints, try to get the constraint name from document
			constraint_group = ""
			
			# Try to retrieve the applicable constraint
			if hasattr(rule, 'calculate_based_on'):
				if rule.calculate_based_on == "Multiple Constraints" and hasattr(rule, 'condition_multiple_constraints'):
					# For rules with multiple constraints
					if rule.condition_multiple_constraints and len(rule.condition_multiple_constraints) > 0:
						# Extract all constraint groups
						constraint_groups = {}
						for constraint in rule.condition_multiple_constraints:
							if hasattr(constraint, 'condition_group') and constraint.condition_group:
								group = constraint.condition_group
								if group not in constraint_groups:
									constraint_groups[group] = []
								constraint_groups[group].append(constraint)
						
						# If we have constraint groups, try to find the active one
						if constraint_groups:
							constraint_group = next(iter(constraint_groups))  # default to first group
							
							# Try to find the constraint with height that allows 3 books to be stacked
							# Prepare items for packing
							packing_items = []
							for item in items_data:
								for _ in range(int(item.get("qty", 1))):
									packing_items.append({
										"name": item.get("name", "Item"),
										"length": float(item.get("length", 0)),
										"width": float(item.get("width", 0)),
										"height": float(item.get("height", 0)),
										"weight": float(item.get("weight", 0))
									})
							
							# Check if all items are flat and identical (like books)
							all_identical = True
							is_flat = False
							first_item = None
							
							if len(packing_items) > 1:
								first_item = packing_items[0]
								first_length = float(first_item.get("length", 0))
								first_width = float(first_item.get("width", 0))
								first_height = float(first_item.get("height", 0))
								
								# Check if item is flat (height much smaller than length/width)
								if first_height > 0 and (first_length / first_height > 5 or first_width / first_height > 5):
									is_flat = True
								
								# Check if all items have the same dimensions
								for item in packing_items[1:]:
									length = float(item.get("length", 0))
									width = float(item.get("width", 0))
									height = float(item.get("height", 0))
									
									if (length != first_length or width != first_width or height != first_height):
										all_identical = False
										break
							
							# Calculate total weight
							total_weight = sum(float(item.get("weight", 0) or 0) for item in packing_items)
							
							# For flat identical items like books, we need to find the right constraint group
							if is_flat and all_identical and first_item:
								# Calculate stacked height
								stacked_height = first_height * len(packing_items)
								
								# Find a group that can accommodate the items
								for group, constraints in constraint_groups.items():
									# Extract max dimensions and weight from constraints
									max_length = 0
									max_width = 0
									max_height = 0
									max_weight = 0
									
									for c in constraints:
										if hasattr(c, 'constraint_type') and hasattr(c, 'max_value'):
											if c.constraint_type == "Length":
												max_length = float(c.max_value)
											elif c.constraint_type == "Width":
												max_width = float(c.max_value)
											elif c.constraint_type == "Height":
												max_height = float(c.max_value)
											elif c.constraint_type == "Weight":
												max_weight = float(c.max_value)
									
									# Check if this group can accommodate the stacked items
									if (first_length <= max_length and 
										first_width <= max_width and 
										stacked_height <= max_height and 
										total_weight <= max_weight):
										constraint_group = group
										break
							
							# Store the constraint name for display
							shipping_info["constraint_name"] = constraint_group
				elif hasattr(rule, 'conditions'):
					# For standard rules
					if rule.conditions and len(rule.conditions) > 0:
						# Take the first condition as an example (simplification)
						condition = rule.conditions[0]
						if hasattr(condition, 'title'):
							shipping_info["constraint_name"] = condition.title
						elif hasattr(condition, 'label'):
							shipping_info["constraint_name"] = condition.label
						else:
							shipping_info["constraint_name"] = f"{rule.calculate_based_on}"
			
			# Get the maximum dimensions of the constraints to display correctly
			# Initialize default values
			max_length = 0
			max_width = 0
			max_height = 0
			
			# If the rule uses multiple constraints, get dimensions from the selected constraint group
			if rule.calculate_based_on == "Multiple Constraints" and constraint_group:
				for constraint in rule.condition_multiple_constraints:
					if hasattr(constraint, 'condition_group') and constraint.condition_group == constraint_group:
						if hasattr(constraint, 'constraint_type') and hasattr(constraint, 'max_value'):
							if constraint.constraint_type == "Length":
								max_length = float(constraint.max_value)
							elif constraint.constraint_type == "Width":
								max_width = float(constraint.max_value)
							elif constraint.constraint_type == "Height":
								max_height = float(constraint.max_value)
				
				# If we found constraint dimensions, use them
				if max_length > 0 and max_width > 0 and max_height > 0:
					bin_dimensions = {
						"length": max_length,
						"width": max_width,
						"height": max_height,
						"volume": max_length * max_width * max_height
					}
			
			# If we don't have bin dimensions yet, calculate them
			if not bin_dimensions:
				# Prepare items for packing (if optimal calculation is needed)
				packing_items = []
				for item in items_data:
					for _ in range(int(item.get("qty", 1))):
						packing_items.append({
							"name": item.get("name", "Item"),
							"length": float(item.get("length", 0)),
							"width": float(item.get("width", 0)),
							"height": float(item.get("height", 0)),
							"weight": float(item.get("weight", 0))
						})
				
				# Check if all items are flat and identical (like books)
				all_identical = True
				is_flat = False
				first_item = None
				
				if len(packing_items) > 1:
					first_item = packing_items[0]
					first_length = float(first_item.get("length", 0))
					first_width = float(first_item.get("width", 0))
					first_height = float(first_item.get("height", 0))
					
					# Check if item is flat (height much smaller than length/width)
					if first_height > 0 and (first_length / first_height > 5 or first_width / first_height > 5):
						is_flat = True
					
					# Check if all items have the same dimensions
					for item in packing_items[1:]:
						length = float(item.get("length", 0))
						width = float(item.get("width", 0))
						height = float(item.get("height", 0))
						
						if (length != first_length or width != first_width or height != first_height):
							all_identical = False
							break
				
				# For identical flat items (like books), stack them vertically
				if is_flat and all_identical and first_item:
					item_length = float(first_item.get("length", 0))
					item_width = float(first_item.get("width", 0))
					item_height = float(first_item.get("height", 0))
					
					# Stack them vertically
					stacked_height = item_height * len(packing_items)
					
					# Create a bin that just fits the stacked items
					bin_dimensions = {
						"length": item_length,
						"width": item_width,
						"height": stacked_height,
						"volume": item_length * item_width * stacked_height
					}
					
					# Adjust positions to show stacked books
					for i, item in enumerate(packing_items):
						item["position"] = [0, 0, i * item_height]
				else:
					# For mixed items or non-flat items, use standard calculation
					optimal_dimensions = rule.calculate_optimal_packing(packing_items)
					bin_dimensions = optimal_dimensions
		
		# Generate visualization with additional information
		result = generate_packing_visualization(items_data, bin_dimensions)
		
		# Add shipping rule information to the result
		if result and result.get("success"):
			result["shipping_info"] = shipping_info
			
			# Add container dimensions to the result for better display
			if bin_dimensions:
				result["bin_dimensions"] = {
					"length": bin_dimensions["length"],
					"width": bin_dimensions["width"],
					"height": bin_dimensions["height"],
					"volume": bin_dimensions["volume"]
				}
			
		return result
		
	except Exception as e:
		frappe.log_error("PackingVisualizationError", e)
		return {
			"success": False,
			"message": f"Error: {str(e)}"
		}
