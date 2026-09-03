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
		//// Neoffice — rewritten (40468858e1, 2026-03-16): upstream is an if/else chain over five
		//// statuses only (Open, Partially Ordered, Ordered, Lost, Expired) and shows NO indicator for
		//// anything else. Ours is a map, so Draft, Cancelled and above all "Invoiced" — the status our
		//// flow sets once the quotation has been billed — get a colour instead of an empty cell.
		//// Expired is red here where upstream greys it: an expired quotation is a lost sale to chase.
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
