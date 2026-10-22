import frappe
# //// Neoffice — import added for the Territory root used when creating a portal Customer below
# //// (28b1f44368, 2025-04-28 "Fix bug create customer").
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

# //// Neoffice ▼▼▼ create_customer_or_supplier is rewritten — +142 / -24 lines against upstream.
####
# //// Upstream: if the session user has no party yet (party_exists), create one, blank, with
# //// ignore_mandatory, then a Contact. On our sites that produced duplicate Customers and
# //// half-filled records: the webshop signs the shopper in through this same on_session_creation
# //// hook, and our Customer has mandatory fields upstream's blank insert never fills
# //// (default_currency is reqd in our customer.json — see selling/doctype/customer/customer.py).
####
# //// What ours does instead (28b1f44368, 2025-04-28 "Fix bug create customer"; d62d07f7d4,
# //// 2025-08-15 "improve customer portal user linking"):
# ////   - looks for an existing party in THREE ways before creating anything — the Portal User
# ////     row, the Contact links, then a Customer with the same full name — and links the user to
# ////     the one it finds (portal_users row) rather than creating a second;
# ////   - fills the new Customer properly: customer_type, Territory root, customer group (from
# ////     Webshop Settings when it defines one) and the company default_currency;
# ////   - honours a `skip_customer_creation` flag on the User, so a caller that creates the
# ////     account itself is not shadowed by this hook;
# ////   - never lets the hook break the login: the insert and the contact creation are wrapped,
# ////     a DuplicateEntryError falls back to linking the existing Customer, and failures are
# ////     logged instead of raised.
####
# //// TO REVIEW before the upstream merge:
# ////   - matching a party by CUSTOMER NAME (full name of the user) merges two different people
# ////     who happen to share a name into one Customer record;
# ////   - the same "already exists" check is written three times over, once after party.update();
# ////   - `except Exception` around the insert turns a real failure into a silent None;
# ////   - it reads the `Webshop Settings` single, which the webshop app owns, not erpnext;
# ////   - upstream's party_exists() is now only used by the (unmarked) callers below.
# //// Resolve this function from the two commits above, not line by line.
def create_customer_or_supplier():
	"""Based on the default Role (Customer, Supplier), create a Customer / Supplier.
	Called on_session_creation hook.
	"""
	user = frappe.session.user

	# //// Neoffice — a User flagged skip_customer_creation is left alone (see the header of this function).
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

	# //// Neoffice — the by-name match that used to sit here is removed (neoffice-maintenance#1756,
	# //// closing this file's "TO REVIEW" note). It linked a new portal account to any existing
	# //// Customer whose customer_name equalled the user's full name, so two people who share a
	# //// name shared one Customer and the second saw the first's orders, invoices and addresses.
	# //// Upstream create_party() always makes a new party; ERPNext appends a number when a
	# //// customer_name repeats, so no DuplicateEntryError results. The Portal User and Contact
	# //// lookups above still reunite a returning user with their own party.
	fullname = frappe.utils.get_fullname(user)

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

	# //// Neoffice — a second by-name match stood here (the same homonym bug as above,
	# //// neoffice-maintenance#1756); removed. ERPNext appends a number for a duplicate
	# //// customer_name, so the insert below does not collide.
	party.flags.ignore_mandatory = True
	try:
		party.insert(ignore_permissions=True)
	except frappe.DuplicateEntryError as e:
		# //// Neoffice — this used to find the Customer with the same customer_name and link the user
		# //// to it, which merged two people who share a name (neoffice-maintenance#1756). Just log and
		# //// bail; ERPNext appends a number for a duplicate customer_name, so this path is not normally hit.
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

# //// Neoffice ▲▲▲ end of the rewritten create_customer_or_supplier (see its header above).


def create_party(doctype, fullname):
	party = frappe.new_doc(doctype)
	# Can't set parent party as group

	party.update(
		{
			f"{doctype.lower()}_name": fullname,
			f"{doctype.lower()}_type": "Individual",
		}
	)

	party.flags.ignore_mandatory = True
	party.insert(ignore_permissions=True)

	return party


# //// Neoffice — create_party_contact is upstream's but for the names it gives the contact (see inside).
def create_party_contact(doctype, fullname, user, party_name):
	contact = frappe.new_doc("Contact")
	# //// Neoffice — the User's own first and last names when it carries both: upstream wrote the
	# //// full name as the first name and none as the last, so the shop's checkout greeted a new
	# //// account with "Ana Rossi" as its first name and an empty last name, a required field
	# //// (neoffice-maintenance#691 D-9, 2026-09-25). A User with a single name keeps upstream's, and
	# //// so does a contact the caller names apart (the "-Customer" of a user who is a supplier too).
	names = frappe.db.get_value("User", user, ["first_name", "last_name"], as_dict=True) or {}
	first_name, last_name = (names.get("first_name") or "").strip(), (names.get("last_name") or "").strip()
	if first_name and last_name and fullname == frappe.utils.get_fullname(user):
		contact.update({"first_name": first_name, "last_name": last_name, "email_id": user})
	else:
		contact.update({"first_name": fullname, "email_id": user})
	contact.append("links", dict(link_doctype=doctype, link_name=party_name))
	contact.append("email_ids", dict(email_id=user, is_primary=True))
	contact.flags.ignore_mandatory = True
	contact.insert(ignore_permissions=True)


def party_exists(doctype, user):
	# check if contact exists against party and if it is linked to the doctype
	contact_name = frappe.db.get_value("Contact", {"email_id": user})
	if contact_name:
		contact = frappe.get_doc("Contact", contact_name)
		doctypes = [d.link_doctype for d in contact.links]
		return doctype in doctypes

	return False
