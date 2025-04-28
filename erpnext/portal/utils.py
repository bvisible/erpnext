import frappe
from frappe.utils.nestedset import get_root_of


def set_default_role(doc, method):
	"""Set customer, supplier, student, guardian based on email"""
	if frappe.flags.setting_role or frappe.flags.in_migrate:
		return

	roles = frappe.get_roles(doc.name)

	contact_name = frappe.get_value("Contact", dict(email_id=doc.email))
	if contact_name:
		contact = frappe.get_doc("Contact", contact_name)
		for link in contact.links:
			frappe.flags.setting_role = True
			if link.link_doctype == "Customer" and "Customer" not in roles:
				doc.add_roles("Customer")
			elif link.link_doctype == "Supplier" and "Supplier" not in roles:
				doc.add_roles("Supplier")

def create_customer_or_supplier():
	"""Based on the default Role (Customer, Supplier), create a Customer / Supplier.
	Called on_session_creation hook.
	"""
	user = frappe.session.user

	user_doc = frappe.get_doc("User", user)
	if hasattr(user_doc, "flags") and getattr(user_doc.flags, "skip_customer_creation", False) or user_doc.user_type != "Website User":
		return

	user_roles = frappe.get_roles()
	portal_settings = frappe.get_single("Portal Settings")
	default_role = portal_settings.default_role

	if default_role not in ["Customer", "Supplier"]:
		return

	# create customer / supplier if the user has that role
	if portal_settings.default_role and portal_settings.default_role in user_roles:
		doctype = portal_settings.default_role
	else:
		doctype = None

	if not doctype:
		return

	# //// Check if the customer/supplier already exists
	existing_party = None
	contact_name = frappe.db.get_value("Contact", {"email_id": user})

	if contact_name:
		contact = frappe.get_doc("Contact", contact_name)
		for link in contact.links:
			if link.link_doctype == doctype:
				existing_party = frappe.get_doc(doctype, link.link_name)
				return existing_party

	# //// Create a new entity
	party = frappe.new_doc(doctype)
	fullname = frappe.utils.get_fullname(user)

	# //// Configuration based on the document type
	if doctype == "Customer":
		# //// Get the default currency
		company = frappe.defaults.get_user_default("Company")
		default_currency = frappe.get_cached_value('Company', company, 'default_currency')
		territory = get_root_of("Territory")

		# //// Configure the customer with the required fields
		party.update({
			"customer_name": fullname,
			"customer_type": "Individual",
			"territory": territory,
			"customer_group": "All Customer Groups",
			"default_currency": default_currency
		})
		
		webshop_settings = frappe.get_single("Webshop Settings")
		if hasattr(webshop_settings, 'default_customer_group') and webshop_settings.default_customer_group:
			party.customer_group = webshop_settings.default_customer_group
	else:
		party.update({
			"supplier_name": fullname,
			"supplier_group": "All Supplier Groups",
			"supplier_type": "Individual",
		})

	party.flags.ignore_mandatory = True
	try:
		party.insert(ignore_permissions=True)
	except Exception as e:
		frappe.log_error("Error inserting party", f"Error inserting {doctype}: {str(e)}")
		return None

	alternate_doctype = "Customer" if doctype == "Supplier" else "Supplier"

	# //// Check directly for the alternative entity
	has_alternate = False
	alt_contact_name = frappe.db.get_value("Contact", {"email_id": user})
	if alt_contact_name:
		alt_contact = frappe.get_doc("Contact", alt_contact_name)
		for link in alt_contact.links:
			if link.link_doctype == alternate_doctype:
				has_alternate = True
				break
	
	if has_alternate:
		contact_fullname = fullname + "-" + doctype
	else:
		contact_fullname = fullname

	try:
		create_party_contact(doctype, contact_fullname, user, party.name)
	except Exception as e:
		frappe.log_error("Error creating contact", f"Error creating contact for {doctype}: {str(e)}")

	return party

def create_party_contact(doctype, fullname, user, party_name):
	contact = frappe.new_doc("Contact")
	contact.update({"first_name": fullname, "email_id": user})
	contact.append("links", dict(link_doctype=doctype, link_name=party_name))
	contact.append("email_ids", dict(email_id=user, is_primary=True))
	contact.flags.ignore_mandatory = True
	contact.insert(ignore_permissions=True)


def party_exists(doctype, user):
	# //// check if contact exists against party and if it is linked to the doctype
	contact_name = frappe.db.get_value("Contact", {"email_id": user})
	if contact_name:
		contact = frappe.get_doc("Contact", contact_name)
		doctypes = [d.link_doctype for d in contact.links]
		result = doctype in doctypes
		return result

	return False