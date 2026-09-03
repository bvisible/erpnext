import frappe
#//// Neoffice — import added for the Territory root used when creating a portal Customer below
#//// (28b1f44368, 2025-04-28 "Fix bug create customer").
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

#//// Neoffice ▼▼▼ create_customer_or_supplier is rewritten — +142 / -24 lines against upstream.
####
#//// Upstream: if the session user has no party yet (party_exists), create one, blank, with
#//// ignore_mandatory, then a Contact. On our sites that produced duplicate Customers and
#//// half-filled records: the webshop signs the shopper in through this same on_session_creation
#//// hook, and our Customer has mandatory fields upstream's blank insert never fills
#//// (default_currency is reqd in our customer.json — see selling/doctype/customer/customer.py).
####
#//// What ours does instead (28b1f44368, 2025-04-28 "Fix bug create customer"; d62d07f7d4,
#//// 2025-08-15 "improve customer portal user linking"):
#////   - looks for an existing party in THREE ways before creating anything — the Portal User
#////     row, the Contact links, then a Customer with the same full name — and links the user to
#////     the one it finds (portal_users row) rather than creating a second;
#////   - fills the new Customer properly: customer_type, Territory root, customer group (from
#////     Webshop Settings when it defines one) and the company default_currency;
#////   - honours a `skip_customer_creation` flag on the User, so a caller that creates the
#////     account itself is not shadowed by this hook;
#////   - never lets the hook break the login: the insert and the contact creation are wrapped,
#////     a DuplicateEntryError falls back to linking the existing Customer, and failures are
#////     logged instead of raised.
####
#//// TO REVIEW before the upstream merge:
#////   - matching a party by CUSTOMER NAME (full name of the user) merges two different people
#////     who happen to share a name into one Customer record;
#////   - the same "already exists" check is written three times over, once after party.update();
#////   - `except Exception` around the insert turns a real failure into a silent None;
#////   - it reads the `Webshop Settings` single, which the webshop app owns, not erpnext;
#////   - upstream's party_exists() is now only used by the (unmarked) callers below.
#//// Resolve this function from the two commits above, not line by line.
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
	# First check via Portal User (most reliable)
	existing_portal_user = frappe.db.get_value("Portal User", 
		{"user": user, "parenttype": doctype}, 
		"parent")
	
	if existing_portal_user:
		return frappe.get_doc(doctype, existing_portal_user)
	
	# Then check via Contact
	existing_party = None
	contact_name = frappe.db.get_value("Contact", {"email_id": user})

	if contact_name:
		contact = frappe.get_doc("Contact", contact_name)
		for link in contact.links:
			if link.link_doctype == doctype:
				existing_party = frappe.get_doc(doctype, link.link_name)
				# Link to Portal User if not already linked
				if not frappe.db.exists("Portal User", {"parent": existing_party.name, "user": user}):
					existing_party.append("portal_users", {"user": user})
					existing_party.flags.ignore_permissions = True
					existing_party.save()
				return existing_party

	# //// Before creating, check if a customer with the same name already exists
	fullname = frappe.utils.get_fullname(user)
	
	if doctype == "Customer":
		# Check if a customer with this name already exists
		existing_by_name = frappe.db.get_value("Customer", 
			{"customer_name": fullname}, 
			"name")
		
		if existing_by_name:
			# Customer with this name exists, link it to the user instead of creating a duplicate
			existing_customer = frappe.get_doc("Customer", existing_by_name)
			
			# Link to Portal User if not already linked
			if not frappe.db.exists("Portal User", {"parent": existing_by_name, "user": user}):
				existing_customer.append("portal_users", {"user": user})
				existing_customer.flags.ignore_permissions = True
				existing_customer.flags.ignore_mandatory = True
				existing_customer.save()
			
			# Create/update contact if needed
			if not contact_name:
				try:
					create_party_contact("Customer", fullname, user, existing_customer.name)
				except:
					pass
			
			return existing_customer
	
	# //// Create a new entity only if none exists
	party = frappe.new_doc(doctype)
	
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

	# Check if a customer with this name already exists before inserting
	if doctype == "Customer":
		existing = frappe.db.get_value("Customer", {"customer_name": fullname}, "name")
		if existing:
			# Customer with this name already exists, use it instead of creating duplicate
			existing_customer = frappe.get_doc("Customer", existing)
			if not frappe.db.exists("Portal User", {"parent": existing, "user": user}):
				existing_customer.append("portal_users", {"user": user})
				existing_customer.flags.ignore_permissions = True
				existing_customer.save()
			return existing_customer
	
	party.flags.ignore_mandatory = True
	try:
		party.insert(ignore_permissions=True)
	except frappe.DuplicateEntryError as e:
		# If we get a duplicate error, it means a customer with this name already exists
		# This can happen due to race conditions or naming series issues
		if doctype == "Customer":
			# Try to find the existing customer
			existing = frappe.get_all("Customer",
				filters=[["customer_name", "=", fullname]],
				fields=["name"],
				limit=1)
			if existing:
				existing_customer = frappe.get_doc("Customer", existing[0].name)
				# Link to user if not already linked
				if not frappe.db.exists("Portal User", {"parent": existing[0].name, "user": user}):
					existing_customer.append("portal_users", {"user": user})
					existing_customer.flags.ignore_permissions = True
					existing_customer.save()
				return existing_customer
		frappe.log_error("Error inserting party (duplicate)", f"Duplicate error inserting {doctype}: {str(e)}")
		return None
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

#//// Neoffice ▲▲▲ end of the rewritten create_customer_or_supplier (see its header above).
#//// create_party_contact itself is upstream's, unchanged.
def create_party_contact(doctype, fullname, user, party_name):
	contact = frappe.new_doc("Contact")
	contact.update({"first_name": fullname, "email_id": user})
	contact.append("links", dict(link_doctype=doctype, link_name=party_name))
	contact.append("email_ids", dict(email_id=user, is_primary=True))
	contact.flags.ignore_mandatory = True
	contact.insert(ignore_permissions=True)


def party_exists(doctype, user):
	#//// Neoffice — body unchanged in substance (upstream returns the membership test directly; ours
	#//// stores it in `result` first). This helper is no longer called by
	#//// create_customer_or_supplier() above, which does its own three-way lookup. The file also
	#//// lost its final newline (28b1f44368, 2025-04-28).
	# //// check if contact exists against party and if it is linked to the doctype
	contact_name = frappe.db.get_value("Contact", {"email_id": user})
	if contact_name:
		contact = frappe.get_doc("Contact", contact_name)
		doctypes = [d.link_doctype for d in contact.links]
		result = doctype in doctypes
		return result

	return False