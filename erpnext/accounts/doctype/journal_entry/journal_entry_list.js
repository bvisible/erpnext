frappe.listview_settings["Journal Entry"] = {
	add_fields: ["voucher_type", "posting_date", "total_debit", "company", "user_remark"],
	//// Neoffice — fixes an UPSTREAM BUG (97fbb85e89, 2025-11-26): upstream writes
	//// `return [__("Draft", "red", "docstatus,=,0")]` — the colour and the filter are passed to
	//// __() as translation arguments instead of being array elements, so the Draft and Cancelled
	//// rows got no indicator colour and no click-through filter. Ours closes __() around the label
	//// only. Upstream still has the bug at v15.121.0 AND on the upstream/version-15 tip — worth a
	//// PR rather than carrying it. Merge note: upstream has since added `reversal_of` to
	//// add_fields and a `docstatus === 1` branch for "Reversal Of Exchange Rate Revaluation" that
	//// we do not have — take upstream's version and re-apply only this bracket fix.
	get_indicator: function (doc) {
		if (doc.docstatus == 0) {
			return [__("Draft"), "red", "docstatus,=,0"];
		} else if (doc.docstatus == 2) {
			return [__("Cancelled"), "grey", "docstatus,=,2"];
		} else {
			return [__(doc.voucher_type), "blue", "voucher_type,=," + doc.voucher_type];
		}
	},
};
