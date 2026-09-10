from frappe import _

# //// Neoffice — A FUNCTION, not a module constant: `_()` at module level runs at IMPORT, and
# //// a worker imports every app before it connects to a site. `frappe.cache` is
# //// None there, so each of these labels logged "Unable to load translations"
# //// with a bare AttributeError on every restart (neoffice-maintenance#325, #326)
# //// -- and any label that did come back was frozen in whatever language was
# //// active at import, for the lifetime of the process. Called per use, both go
# //// away.
def doctype_rule_map():
	return {
		"Item": {"points": 5, "for_doc_event": "New"},
		"Customer": {"points": 5, "for_doc_event": "New"},
		"Supplier": {"points": 5, "for_doc_event": "New"},
		"Lead": {"points": 2, "for_doc_event": "New"},
		"Opportunity": {
			"points": 10,
			"for_doc_event": "Custom",
			"condition": 'doc.status=="Converted"',
			"rule_name": _("On Converting Opportunity"),
			"user_field": "converted_by",
		},
		"Sales Order": {
			"points": 10,
			"for_doc_event": "Submit",
			"rule_name": _("On Sales Order Submission"),
			"user_field": "modified_by",
		},
		"Purchase Order": {
			"points": 10,
			"for_doc_event": "Submit",
			"rule_name": _("On Purchase Order Submission"),
			"user_field": "modified_by",
		},
		"Task": {
			"points": 5,
			"condition": 'doc.status == "Completed"',
			"rule_name": _("On Task Completion"),
			"user_field": "completed_by",
		},
	}


def get_default_energy_point_rules():
	return [
		{
			"doctype": "Energy Point Rule",
			"reference_doctype": doctype,
			"for_doc_event": rule.get("for_doc_event") or "Custom",
			"condition": rule.get("condition"),
			"rule_name": rule.get("rule_name") or _("On {0} Creation").format(doctype),
			"points": rule.get("points"),
			"user_field": rule.get("user_field") or "owner",
		}
		# //// Neoffice — see the block marker above: constant became a function call
		for doctype, rule in doctype_rule_map().items()
	]
