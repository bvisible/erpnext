# //// Neoffice — added file (no upstream equivalent).
"""The companies an account is bound to, for a report that reads past the reader's permissions (neoffice-maintenance#2838)."""

import frappe


def bound_companies(doctype: str) -> list[str] | None:
	"""The companies of the session user's User Permissions on Company that apply to `doctype` (or to every doctype), or None:
	an account without such a bound reads every company, as before."""
	from frappe.core.doctype.user_permission.user_permission import get_user_permissions
	from frappe.permissions import filter_allowed_docs_for_doctype

	permissions = get_user_permissions(frappe.session.user).get("Company")
	if not permissions:
		return None
	return filter_allowed_docs_for_doctype(permissions, doctype, with_default_doc=False) or None
