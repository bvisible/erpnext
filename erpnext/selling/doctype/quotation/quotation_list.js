frappe.listview_settings["Quotation"] = {
	add_fields: ["customer_name", "base_grand_total", "status", "company", "currency", "valid_till"],

	onload: function (listview) {
		if (listview.page.fields_dict.quotation_to) {
			listview.page.fields_dict.quotation_to.get_query = function () {
				return {
					filters: {
						name: ["in", ["Customer", "Lead"]],
					},
				};
			};
		}

		if (frappe.model.can_create("Sales Order")) {
			listview.page.add_action_item(__("Sales Order"), () => {
				erpnext.bulk_transaction_processing.create(listview, "Quotation", "Sales Order");
			});
		}

		if (frappe.model.can_create("Sales Invoice")) {
			listview.page.add_action_item(__("Sales Invoice"), () => {
				erpnext.bulk_transaction_processing.create(listview, "Quotation", "Sales Invoice");
			});
		}
	},

	get_indicator: function (doc) {
		const status_colors = {
			"Draft": "red",
			"Open": "orange",
			"Partially Ordered": "yellow",
			"Ordered": "green",
			"Invoiced": "green",
			"Lost": "gray",
			"Expired": "red",
			"Cancelled": "red",
		};
		if (status_colors[doc.status]) {
			return [__(doc.status), status_colors[doc.status], "status,=," + doc.status];
		}
	},
};
