// Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
// License: GNU General Public License v3. See license.txt

frappe.provide("erpnext.accounts.dimensions");

frappe.ui.form.on("Shipping Rule", {
	onload: function (frm) {
		erpnext.accounts.dimensions.setup_dimension_filters(frm, frm.doctype);
	},

	company: function (frm) {
		erpnext.accounts.dimensions.update_dimension(frm, frm.doctype);
	},

	refresh: function (frm) {
		frm.set_query("account", function () {
			return {
				filters: {
					company: frm.doc.company,
				},
			};
		});

		frm.trigger("toggle_reqd");
	},
	calculate_based_on: function (frm) {
		frm.trigger("toggle_reqd");
	},
	toggle_reqd: function (frm) {
		frm.toggle_reqd("shipping_amount", frm.doc.calculate_based_on === "Fixed");
		//// Neoffice — added "Multiple Constraints" mode (5bb3903da1, 2025-03-13 "Advanced Shipping
		//// Rule with Multiple Constraints"). Upstream only knows Fixed / Net Total / Net Weight and
		//// makes `conditions` mandatory for everything that is not Fixed. In our mode the charge comes
		//// from the `condition_multiple_constraints` child table instead, so `conditions` must NOT be
		//// required and the two UOM fields must be. See shipping_rule.py for the whole feature.
		frm.toggle_reqd("conditions", frm.doc.calculate_based_on !== "Fixed" && frm.doc.calculate_based_on !== "Multiple Constraints");
		frm.toggle_reqd("condition_multiple_constraints", frm.doc.calculate_based_on === "Multiple Constraints");
		frm.toggle_reqd("weight_uom", frm.doc.calculate_based_on === "Multiple Constraints");
		frm.toggle_reqd("dimensions_uom", frm.doc.calculate_based_on === "Multiple Constraints");
	},
});
