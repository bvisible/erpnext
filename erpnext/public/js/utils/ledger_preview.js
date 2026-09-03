frappe.provide("erpnext.accounts");

erpnext.accounts.ledger_preview = {
	show_accounting_ledger_preview(frm) {
		let me = this;
		if (!frm.is_new() && frm.doc.docstatus == 0) {
			frm.add_custom_button(
				__("Accounting Ledger"),
				function () {
					frappe.call({
						type: "GET",
						method: "erpnext.controllers.stock_controller.show_accounting_ledger_preview",
						args: {
							company: frm.doc.company,
							doctype: frm.doc.doctype,
							docname: frm.doc.name,
						},
						callback: function (response) {
							me.make_dialog(
								"Accounting Ledger Preview",
								"accounting_ledger_preview_html",
								response.message.gl_columns,
								response.message.gl_data
							);
						},
					});
				},
				__("Preview")
			);
		}
	},

	show_stock_ledger_preview(frm) {
		let me = this;
		if (!frm.is_new() && frm.doc.docstatus == 0) {
			frm.add_custom_button(
				__("Stock Ledger"),
				function () {
					frappe.call({
						type: "GET",
						method: "erpnext.controllers.stock_controller.show_stock_ledger_preview",
						args: {
							company: frm.doc.company,
							doctype: frm.doc.doctype,
							docname: frm.doc.name,
						},
						callback: function (response) {
							me.make_dialog(
								"Stock Ledger Preview",
								"stock_ledger_preview_html",
								response.message.sl_columns,
								response.message.sl_data
							);
						},
					});
				},
				__("Preview")
			);
		}
	},

	make_dialog(label, fieldname, columns, data) {
		let me = this;
		let dialog = new frappe.ui.Dialog({
			size: "extra-large",
			title: __(label),
			fields: [
				{
					fieldtype: "HTML",
					fieldname: fieldname,
				},
			],
		});

		//// Neoffice — the delay before the ledger DataTable is drawn goes from upstream's 200 ms to
		//// 1000 ms (ef160121c0, 2025-03-17 "Update ledger_preview.js"): on our instances the dialog was
		//// not laid out yet at 200 ms and the table rendered with zero-width columns.
		//// TO REVIEW: a longer timer is still a race, and it makes every ledger preview feel slow —
		//// the fix is to draw on the dialog's shown event.
		setTimeout(function () {
			me.get_datatable(columns, data, dialog.get_field(fieldname).wrapper);
		}, 1000);

		dialog.show();
	},

	get_datatable(columns, data, wrapper) {
		const datatable_options = {
			columns: columns,
			data: data,
			dynamicRowHeight: true,
			checkboxColumn: false,
			inlineFilters: true,
		};

		new frappe.DataTable(wrapper, datatable_options);
	},
};
