cur_frm.add_fetch("payment_gateway_account", "payment_account", "payment_account");
cur_frm.add_fetch("payment_gateway_account", "payment_gateway", "payment_gateway");
cur_frm.add_fetch("payment_gateway_account", "message", "message");

frappe.ui.form.on("Payment Request", {
	setup: function (frm) {
		frm.set_query("party_type", function () {
			return {
				query: "erpnext.setup.doctype.party_type.party_type.get_party_type",
			};
		});

		frm.set_query("payment_gateway_account", function () {
			return {
				filters: {
					company: frm.doc.company,
				},
			};
		});

		frm.set_query("bank_account", function () {
			return {
				query: "erpnext.accounts.doctype.payment_request.payment_request.get_bank_account_query",
				filters: {
					company: frm.doc.company,
					party_type: frm.doc.party_type,
					party: frm.doc.party,
				},
			};
		});
	},
});

frappe.ui.form.on("Payment Request", "onload", function (frm, dt, dn) {
	if (frm.doc.reference_doctype) {
		frappe.call({
			method: "erpnext.accounts.doctype.payment_request.payment_request.get_print_format_list",
			args: { ref_doctype: frm.doc.reference_doctype },
			callback: function (r) {
				set_field_options("print_format", r.message["print_format"]);
			},
		});
	}
});

frappe.ui.form.on("Payment Request", "refresh", function (frm) {
	let sending_email = false;

	if (
		frm.doc.payment_request_type == "Inward" &&
		frm.doc.payment_channel !== "Phone" &&
		!["Initiated", "Paid"].includes(frm.doc.status) &&
		!frm.doc.__islocal &&
		frm.doc.docstatus == 1
	) {
		//// Neoffice — upstream's "Resend Payment Email" button (which re-sends the stored mail as it is) is
		//// replaced by a "Send by Email" dialog (b83a0c8847 + 2483c36bc4, 2026-03-15; 132320ee4d, 2026-05-30):
		//// (1) the message is rendered on the server (get_rendered_message), so the dialog shows its Jinja
		//// placeholders resolved and the amount with its currency ("22.90 CHF", not "22.9"); (2) the sender
		//// may edit recipients, subject and message; (3) the attachments listed are the real ones, from
		//// neoffice_theme (get_payment_email_attachments), the reference document shown meanwhile and when
		//// neoffice_theme is absent; (4) the mail leaves through send_edited_payment_email (payment_request.py),
		//// which keeps upstream's gates and asks the right to write the request. Upstream's `sending_email`
		//// flag guards against a double send. Rewritten at the merge with v15.123.0: same behaviour, the old
		//// block was mis-indented. Cross-app dependency: this file calls into neoffice_theme.
		frm.add_custom_button(__("Send by Email"), function () {
			frappe.call({
				method: "erpnext.accounts.doctype.payment_request.payment_request.get_rendered_message",
				args: { docname: frm.doc.name },
				callback: function (r) {
					const rendered_message = r.message || frm.doc.message || "";
					const reference =
						"📎 " + (frm.doc.reference_name || "") + " (" + __(frm.doc.reference_doctype || "") + ")";

					const d = new frappe.ui.Dialog({
						title: __("Send Payment Request by Email"),
						size: "large",
						fields: [
							{
								fieldname: "recipients",
								fieldtype: "Data",
								label: __("To"),
								default: frm.doc.email_to,
								reqd: 1,
							},
							{
								fieldname: "subject",
								fieldtype: "Data",
								label: __("Subject"),
								default: frm.doc.subject,
								reqd: 1,
							},
							{
								fieldname: "message",
								fieldtype: "Text Editor",
								label: __("Message"),
								default: rendered_message,
							},
							{
								fieldname: "attachments_info",
								fieldtype: "HTML",
								options:
									'<div style="margin-top:10px; padding:10px; background:#f5f5f5; border-radius:4px; font-size:12px;">' +
									"<strong>" +
									__("Attachments") +
									" :</strong><br>" +
									'<span class="pr-email-attachments">' +
									frappe.utils.escape_html(reference) +
									"</span></div>",
							},
						],
						primary_action_label: __("Send"),
						primary_action: function (values) {
							if (sending_email) {
								frappe.show_alert({ message: __("Sending Email"), indicator: "blue" });
								return;
							}
							sending_email = true;
							d.hide();
							frappe.call({
								method: "erpnext.accounts.doctype.payment_request.payment_request.send_edited_payment_email",
								args: {
									docname: frm.doc.name,
									recipients: values.recipients,
									subject: values.subject,
									message: values.message,
								},
								freeze: true,
								freeze_message: __("Sending"),
								callback: function (r) {
									if (!r.exc) {
										frappe.msgprint(__("Message Sent"));
									}
								},
								always: function () {
									sending_email = false;
								},
							});
						},
					});
					d.show();

					// the real attachment list: the request and its reference document
					frappe.call({
						method: "neoffice_theme.override_doctype.payment_request.get_payment_email_attachments",
						args: { docname: frm.doc.name },
						callback: function (ar) {
							if (ar.message && ar.message.length) {
								d.$wrapper.find(".pr-email-attachments").html(
									ar.message
										.map(function (a) {
											return frappe.utils.escape_html(
												"📎 " + (a.name || "") + " (" + __(a.doctype || "") + ")"
											);
										})
										.join("<br>")
								);
							}
						},
					});
				},
			});
		});
	}

	if (
		frm.doc.payment_request_type == "Outward" &&
		["Initiated", "Partially Paid"].includes(frm.doc.status)
	) {
		frm.add_custom_button(__("Create Payment Entry"), function () {
			frappe.call({
				method: "erpnext.accounts.doctype.payment_request.payment_request.make_payment_entry",
				args: { docname: frm.doc.name },
				freeze: true,
				callback: function (r) {
					if (!r.exc) {
						var doc = frappe.model.sync(r.message);
						frappe.set_route("Form", r.message.doctype, r.message.name);
					}
				},
			});
		}).addClass("btn-primary");
	}
});

frappe.ui.form.on("Payment Request", "is_a_subscription", function (frm) {
	frm.toggle_reqd("payment_gateway_account", frm.doc.is_a_subscription);
	frm.toggle_reqd("subscription_plans", frm.doc.is_a_subscription);

	if (frm.doc.is_a_subscription && frm.doc.reference_doctype && frm.doc.reference_name) {
		frappe.call({
			method: "erpnext.accounts.doctype.payment_request.payment_request.get_subscription_details",
			args: { reference_doctype: frm.doc.reference_doctype, reference_name: frm.doc.reference_name },
			freeze: true,
			callback: function (data) {
				if (!data.exc) {
					$.each(data.message || [], function (i, v) {
						var d = frappe.model.add_child(
							frm.doc,
							"Subscription Plan Detail",
							"subscription_plans"
						);
						d.qty = v.qty;
						d.plan = v.plan;
					});
					frm.refresh_field("subscription_plans");
				}
			},
		});
	}
});
