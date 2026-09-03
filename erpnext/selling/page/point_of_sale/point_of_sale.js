//// Neoffice — the ONLY divergence of this file from upstream v15.89.0 is its missing final
//// newline (a5f79d75b3, 2025-02-26 "update neov2", ten files of this lot at once). Nothing
//// else differs — take upstream's side on the last-line conflict.
frappe.provide("erpnext.PointOfSale");

frappe.pages["point-of-sale"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Point of Sale"),
		single_column: true,
	});

	frappe.require("point-of-sale.bundle.js", function () {
		wrapper.pos = new erpnext.PointOfSale.Controller(wrapper);
		window.cur_pos = wrapper.pos;
	});
};

frappe.pages["point-of-sale"].refresh = function (wrapper) {
	if (document.scannerDetectionData) {
		onScan.detachFrom(document);
		wrapper.pos.wrapper.html("");
		wrapper.pos.check_opening_entry();
	}
};