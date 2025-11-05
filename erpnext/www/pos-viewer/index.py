import frappe
from frappe import _
from frappe.utils import nowdate, now_datetime

no_cache = 1  # Disable caching for real-time updates


def get_context(context):
	"""
	Page context - minimal setup as auth is handled client-side via API
	"""
	context.no_cache = 1
	context.show_sidebar = False
	return context


@frappe.whitelist(allow_guest=True)
def validate_api_key(api_key_string):
	"""
	Validate API key and return user info if valid.
	Expected format: "api_key:api_secret"
	"""
	try:
		if not api_key_string or ":" not in api_key_string:
			return {"valid": False, "message": _("Incorrect password")}

		api_key, api_secret = api_key_string.split(":", 1)

		# Get user by API key
		user_name = frappe.db.get_value("User", {"api_key": api_key}, "name")

		if not user_name:
			return {"valid": False, "message": _("Incorrect password")}

		# Get the hashed API secret from database
		from frappe.utils.password import get_decrypted_password
		stored_secret = get_decrypted_password("User", user_name, fieldname="api_secret", raise_exception=False)

		if not stored_secret or stored_secret != api_secret:
			return {"valid": False, "message": _("Incorrect password")}

		# Get the user document
		user_doc = frappe.get_doc("User", user_name)

		# Set user in session
		frappe.set_user(user_name)

		# Check if user has permission to access POS
		if not frappe.has_permission("POS Invoice", "read"):
			return {
				"valid": False,
				"message": _("Access denied. Please contact your administrator."),
			}

		return {
			"valid": True,
			"user": user_doc.name,
			"full_name": user_doc.full_name,
			"user_image": user_doc.user_image,
			"message": _("Authentication successful"),
		}

	except Exception as e:
		frappe.log_error(title="POS Viewer API Auth Error", message=str(e))
		return {"valid": False, "message": _("Connection error. Please try again.")}


@frappe.whitelist()
def get_pos_profiles():
	"""
	Get available POS profiles for current user.
	Returns profiles assigned to user, or all active profiles if none assigned.
	"""
	user = frappe.session.user

	# First check if user has specific profiles assigned
	user_profiles = frappe.get_all(
		"POS Profile User", filters={"user": user}, fields=["parent", "default"], order_by="`default` desc"
	)

	if user_profiles:
		profile_names = [p.parent for p in user_profiles]
		default_profile = next((p.parent for p in user_profiles if p.default), None)

		profiles = frappe.get_all(
			"POS Profile",
			filters={"name": ["in", profile_names], "disabled": 0},
			fields=["name", "company", "warehouse", "currency", "country"],
		)
	else:
		# No specific profiles assigned, return all active profiles
		profiles = frappe.get_all(
			"POS Profile",
			filters={"disabled": 0},
			fields=["name", "company", "warehouse", "currency", "country"],
		)
		default_profile = profiles[0].name if profiles else None

	return {"profiles": profiles, "default_profile": default_profile}


@frappe.whitelist()
def get_pos_opening_entry(pos_profile):
	"""
	Get the current open POS Opening Entry for a profile.
	Returns the entry if open, None otherwise.
	"""
	user = frappe.session.user

	# Find open POS session for this user and profile
	opening_entry = frappe.get_all(
		"POS Opening Entry",
		filters={"user": user, "pos_profile": pos_profile, "docstatus": 1, "status": "Open"},
		fields=["name", "period_start_date", "posting_date", "company", "pos_profile"],
		order_by="period_start_date desc",
		limit=1,
	)

	if opening_entry:
		entry = frappe.get_doc("POS Opening Entry", opening_entry[0].name)
		return {
			"name": entry.name,
			"period_start_date": entry.period_start_date,
			"posting_date": entry.posting_date,
			"company": entry.company,
			"pos_profile": entry.pos_profile,
			"balance_details": entry.balance_details,
		}

	return None


@frappe.whitelist()
def update_cart_data(pos_opening_entry, cart_data):
	"""
	Update cart data in cache for real-time viewing.
	Called by POS when cart changes.
	"""
	import json

	# Store cart data in cache with a 1-hour expiry
	cache_key = f"pos_cart_{pos_opening_entry}"
	cart_data_dict = json.loads(cart_data) if isinstance(cart_data, str) else cart_data
	frappe.cache().set_value(cache_key, cart_data_dict, expires_in_sec=3600)

	return {"success": True}


@frappe.whitelist()
def get_current_cart(pos_opening_entry):
	"""
	Get current cart data from cache.
	Returns cart data if available, None otherwise.
	"""
	if not frappe.has_permission("POS Invoice", "read"):
		frappe.throw(_("Insufficient permissions to read POS Invoice"))

	# Try to get cart data from cache first
	cache_key = f"pos_cart_{pos_opening_entry}"
	cart_data = frappe.cache().get_value(cache_key)

	if cart_data:
		return cart_data

	# Fallback: try to get from database (saved draft invoice)
	pos_opening = frappe.get_doc("POS Opening Entry", pos_opening_entry)

	invoices = frappe.get_all(
		"POS Invoice",
		filters={
			"pos_profile": pos_opening.pos_profile,
			"docstatus": 0,  # Draft only
		},
		fields=["name"],
		order_by="modified desc",
		limit=1,
	)

	if not invoices:
		return None

	# Get full invoice details
	invoice = frappe.get_doc("POS Invoice", invoices[0].name)

	# Get item images for display
	items_with_images = []
	for item in invoice.items:
		item_dict = item.as_dict()
		# Get item image if available
		image = frappe.db.get_value("Item", item.item_code, "image")
		item_dict["image"] = image
		items_with_images.append(item_dict)

	return {
		"name": invoice.name,
		"customer": invoice.customer,
		"customer_name": frappe.db.get_value("Customer", invoice.customer, "customer_name")
		if invoice.customer
		else None,
		"posting_date": invoice.posting_date,
		"posting_time": invoice.posting_time,
		"currency": invoice.currency,
		"items": items_with_images,
		"total_qty": invoice.total_qty,
		"total": invoice.total,
		"net_total": invoice.net_total,
		"total_taxes_and_charges": invoice.total_taxes_and_charges,
		"discount_amount": invoice.discount_amount,
		"grand_total": invoice.grand_total,
		"rounded_total": invoice.rounded_total,
		"outstanding_amount": invoice.outstanding_amount,
		"paid_amount": invoice.paid_amount,
		"change_amount": invoice.change_amount,
	}


@frappe.whitelist()
def create_customer(customer_name, email=None, mobile_no=None, address_line1=None, city=None, pincode=None, country=None, customer_type="Individual"):
	"""
	Create a new customer with optional contact and address details.
	"""
	if not frappe.has_permission("Customer", "create"):
		frappe.throw(_("Insufficient permissions to create Customer"))

	if not customer_name:
		frappe.throw(_("Customer name is required"))

	try:
		# Get default currency from company or system settings
		default_currency = frappe.db.get_single_value("Global Defaults", "default_currency") or "USD"

		# Create Customer document
		customer = frappe.new_doc("Customer")
		customer.customer_name = customer_name
		customer.customer_type = customer_type  # Use provided customer_type (Individual or Company)
		customer.customer_group = frappe.db.get_single_value("Selling Settings", "customer_group") or "Individual"
		customer.territory = frappe.db.get_single_value("Selling Settings", "territory") or "All Territories"
		customer.default_currency = default_currency

		# Add email and mobile if provided
		if email:
			customer.email_id = email
		if mobile_no:
			customer.mobile_no = mobile_no

		customer.insert(ignore_permissions=True)

		# Create Contact if email or mobile provided
		if email or mobile_no:
			contact = frappe.new_doc("Contact")
			contact.first_name = customer_name
			if email:
				contact.append("email_ids", {"email_id": email, "is_primary": 1})
			if mobile_no:
				contact.append("phone_nos", {"phone": mobile_no, "is_primary_mobile_no": 1})

			contact.append("links", {"link_doctype": "Customer", "link_name": customer.name})
			contact.insert(ignore_permissions=True)

		# Create Address if address details provided
		if address_line1 or city:
			address = frappe.new_doc("Address")
			address.address_title = customer_name
			address.address_type = "Billing"
			address.address_line1 = address_line1 or ""
			address.city = city or ""
			address.pincode = pincode or ""
			# Country is now passed from frontend (from POS Profile)
			address.country = country or frappe.db.get_single_value("System Settings", "country")

			address.append("links", {"link_doctype": "Customer", "link_name": customer.name})
			address.insert(ignore_permissions=True)

		frappe.db.commit()

		return {
			"success": True,
			"customer": customer.name,
			"customer_name": customer.customer_name,
			"message": _("Customer created successfully"),
		}

	except Exception as e:
		frappe.log_error(title="POS Viewer Customer Creation Error", message=str(e))
		return {"success": False, "message": _("Failed to create customer: {0}").format(str(e))}


@frappe.whitelist()
def get_customer_list(search_term=""):
	"""
	Get list of customers for autocomplete/search.
	"""
	if not frappe.has_permission("Customer", "read"):
		frappe.throw(_("Insufficient permissions to read Customer"))

	filters = {}
	if search_term:
		filters = [
			["Customer", "customer_name", "like", f"%{search_term}%"],
		]

	customers = frappe.get_all(
		"Customer", filters=filters, fields=["name", "customer_name", "email_id", "mobile_no"], limit=20
	)

	return customers


@frappe.whitelist()
def trigger_twint_payment(pos_opening_entry, order_uuid, qr_code, pairing_token, amount):
	"""
	Trigger Twint payment display on POS Viewer.
	Called from POS when Twint payment is initiated.
	"""
	if not frappe.has_permission("POS Invoice", "write"):
		frappe.throw(_("Insufficient permissions to trigger payment"))

	# Store Twint payment data in cache with 10 minute expiry
	cache_key = f"pos_twint_payment_{pos_opening_entry}"
	payment_data = {
		"order_uuid": order_uuid,
		"qr_code": qr_code,
		"pairing_token": pairing_token,
		"amount": amount,
		"status": "PENDING",
		"timestamp": frappe.utils.now()
	}
	frappe.cache().set_value(cache_key, payment_data, expires_in_sec=600)

	return {"success": True}


@frappe.whitelist()
def get_twint_payment(pos_opening_entry):
	"""
	Get current Twint payment data for POS Viewer.
	Returns payment data if a Twint payment is active, None otherwise.
	"""
	if not frappe.has_permission("POS Invoice", "read"):
		frappe.throw(_("Insufficient permissions to read payment data"))

	cache_key = f"pos_twint_payment_{pos_opening_entry}"
	payment_data = frappe.cache().get_value(cache_key)

	return payment_data


@frappe.whitelist()
def clear_twint_payment(pos_opening_entry):
	"""
	Clear Twint payment data from cache.
	Called when payment is completed or cancelled.
	"""
	if not frappe.has_permission("POS Invoice", "write"):
		frappe.throw(_("Insufficient permissions to clear payment"))

	cache_key = f"pos_twint_payment_{pos_opening_entry}"
	frappe.cache().delete_value(cache_key)

	return {"success": True}
