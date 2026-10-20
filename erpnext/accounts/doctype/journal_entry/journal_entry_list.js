frappe.listview_settings["Journal Entry"] = {
	add_fields: ["voucher_type", "posting_date", "total_debit", "company", "user_remark", "reversal_of"],
	//// Neoffice — fixes an UPSTREAM BUG (97fbb85e89, 2025-11-26): upstream writes
	//// `return [__("Draft", "red", "docstatus,=,0")]` — the colour and the filter are passed to
	//// __() as translation arguments instead of being array elements, so the Draft and Cancelled
	//// rows get no indicator colour and no click-through filter. Ours closes __() around the label
	//// only (Draft and Cancelled lines). Upstream still has the bug at v15.123.0: worth a PR.
	get_indicator: function (doc) {
		if (doc.docstatus == 0) {
			return [__("Draft"), "red", "docstatus,=,0"];
		} else if (doc.docstatus == 2) {
			//// Neoffice — the same bracket fix for Cancelled (see the marker above get_indicator).
			return [__("Cancelled"), "grey", "docstatus,=,2"];
		} else if (doc.docstatus === 1) {
			if (doc.reversal_of && doc.voucher_type == "Exchange Rate Revaluation") {
				return [__("Reversal Of Exchange Rate Revaluation"), "blue"];
			}
			return [__(doc.voucher_type), "blue", `voucher_type,=,${doc.voucher_type}`];
		}
	},
};
