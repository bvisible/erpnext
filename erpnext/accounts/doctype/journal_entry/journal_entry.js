// Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
// License: GNU General Public License v3. See license.txt

frappe.provide("erpnext.accounts");
frappe.provide("erpnext.journal_entry");


frappe.ui.form.on("Journal Entry", {
	setup: function(frm) {
		frm.add_fetch("bank_account", "account", "account");
		frm.ignore_doctypes_on_cancel_all = ['Sales Invoice', 'Purchase Invoice'];
	},
	////
	onload: function(frm) {
		if (frm.doc.__islocal) {
			erpnext.journal_entry.quick_entry(frm);
		}
	},
	////

	refresh: function(frm) {
		erpnext.toggle_naming_series();

		if(frm.doc.docstatus > 0) {
			frm.add_custom_button(__('Ledger'), function() {
				frappe.route_options = {
					"voucher_no": frm.doc.name,
					"from_date": frm.doc.posting_date,
					"to_date": moment(frm.doc.modified).format('YYYY-MM-DD'),
					"company": frm.doc.company,
					"finance_book": frm.doc.finance_book,
					"group_by": '',
					"show_cancelled_entries": frm.doc.docstatus === 2
				};
				frappe.set_route("query-report", "General Ledger");
			}, __('View'));
		}

		if(frm.doc.docstatus==1) {
			frm.add_custom_button(__('Reverse Journal Entry'), function() {
				return erpnext.journal_entry.reverse_journal_entry(frm);
			}, __('Actions'));
		}

		if (frm.doc.__islocal || frm.doc.docstatus == 0) {
			frm.add_custom_button(__('Quick Entry'), function() {
				return erpnext.journal_entry.quick_entry(frm);
			});
		}

		// hide /unhide fields based on currency
		erpnext.journal_entry.toggle_fields_based_on_currency(frm);

		if ((frm.doc.voucher_type == "Inter Company Journal Entry") && (frm.doc.docstatus == 1) && (!frm.doc.inter_company_journal_entry_reference)) {
			frm.add_custom_button(__("Create Inter Company Journal Entry"),
				function() {
					frm.trigger("make_inter_company_journal_entry");
				}, __('Make'));
		}
	},

	make_inter_company_journal_entry: function(frm) {
		var d = new frappe.ui.Dialog({
			title: __("Select Company"),
			fields: [
				{
					'fieldname': 'company',
					'fieldtype': 'Link',
					'label': __('Company'),
					'options': 'Company',
					"get_query": function () {
						return {
							filters: [
								["Company", "name", "!=", frm.doc.company]
							]
						};
					},
					'reqd': 1
				}
			],
		});
		d.set_primary_action(__('Create'), function() {
			d.hide();
			var args = d.get_values();
			frappe.call({
				args: {
					"name": frm.doc.name,
					"voucher_type": frm.doc.voucher_type,
					"company": args.company
				},
				method: "erpnext.accounts.doctype.journal_entry.journal_entry.make_inter_company_journal_entry",
				callback: function (r) {
					if (r.message) {
						var doc = frappe.model.sync(r.message)[0];
						frappe.set_route("Form", doc.doctype, doc.name);
					}
				}
			});
		});
		d.show();
	},

	multi_currency: function(frm) {
		erpnext.journal_entry.toggle_fields_based_on_currency(frm);
	},

	posting_date: function(frm) {
		if(!frm.doc.multi_currency || !frm.doc.posting_date) return;

		$.each(frm.doc.accounts || [], function(i, row) {
			erpnext.journal_entry.set_exchange_rate(frm, row.doctype, row.name);
		})
	},

	company: function(frm) {
		frappe.call({
			method: "frappe.client.get_value",
			args: {
				doctype: "Company",
				filters: {"name": frm.doc.company},
				fieldname: "cost_center"
			},
			callback: function(r){
				if(r.message){
					$.each(frm.doc.accounts || [], function(i, jvd) {
						frappe.model.set_value(jvd.doctype, jvd.name, "cost_center", r.message.cost_center);
					});
				}
			}
		});

		erpnext.accounts.dimensions.update_dimension(frm, frm.doctype);
	},

	voucher_type: function(frm){

		if(!frm.doc.company) return null;

		if((!(frm.doc.accounts || []).length) || ((frm.doc.accounts || []).length === 1 && !frm.doc.accounts[0].account)) {
			if(in_list(["Bank Entry", "Cash Entry"], frm.doc.voucher_type)) {
				return frappe.call({
					type: "GET",
					method: "erpnext.accounts.doctype.journal_entry.journal_entry.get_default_bank_cash_account",
					args: {
						"account_type": (frm.doc.voucher_type=="Bank Entry" ?
							"Bank" : (frm.doc.voucher_type=="Cash Entry" ? "Cash" : null)),
						"company": frm.doc.company
					},
					callback: function(r) {
						if(r.message) {
							// If default company bank account not set
							if(!$.isEmptyObject(r.message)){
								update_jv_details(frm.doc, [r.message]);
							}
						}
					}
				});
			}
		}
	},

	from_template: function(frm){
		if (frm.doc.from_template){
			frappe.db.get_doc("Journal Entry Template", frm.doc.from_template)
				.then((doc) => {
					frappe.model.clear_table(frm.doc, "accounts");
					frm.set_value({
						"company": doc.company,
						"voucher_type": doc.voucher_type,
						"naming_series": doc.naming_series,
						"is_opening": doc.is_opening,
						"multi_currency": doc.multi_currency
					})
					update_jv_details(frm.doc, doc.accounts);
				});
		}
	}
});

var update_jv_details = function(doc, r) {
	$.each(r, function(i, d) {
		var row = frappe.model.add_child(doc, "Journal Entry Account", "accounts");
		frappe.model.set_value(row.doctype, row.name, "account", d.account)
		frappe.model.set_value(row.doctype, row.name, "balance", d.balance)
	});
	refresh_field("accounts");
}

erpnext.accounts.JournalEntry = class JournalEntry extends frappe.ui.form.Controller {
	onload() {
		this.load_defaults();
		this.setup_queries();
		this.setup_balance_formatter();
		erpnext.accounts.dimensions.setup_dimension_filters(this.frm, this.frm.doctype);
	}

	onload_post_render() {
		cur_frm.get_field("accounts").grid.set_multiple_add("account");
	}

	load_defaults() {
		//this.frm.show_print_first = true;
		if(this.frm.doc.__islocal && this.frm.doc.company) {
			frappe.model.set_default_values(this.frm.doc);
			$.each(this.frm.doc.accounts || [], function(i, jvd) {
				frappe.model.set_default_values(jvd);
			});
			var posting_date = this.frm.doc.posting_date;
			if(!this.frm.doc.amended_from) this.frm.set_value('posting_date', posting_date || frappe.datetime.get_today());
		}
	}

	setup_queries() {
		var me = this;

		me.frm.set_query("account", "accounts", function(doc, cdt, cdn) {
			return erpnext.journal_entry.account_query(me.frm);
		});

		me.frm.set_query("party_type", "accounts", function(doc, cdt, cdn) {
			const row = locals[cdt][cdn];

			return {
				query: "erpnext.setup.doctype.party_type.party_type.get_party_type",
				filters: {
					'account': row.account
				}
			}
		});

		me.frm.set_query("reference_name", "accounts", function(doc, cdt, cdn) {
			var jvd = frappe.get_doc(cdt, cdn);

			// journal entry
			if(jvd.reference_type==="Journal Entry") {
				frappe.model.validate_missing(jvd, "account");
				return {
					query: "erpnext.accounts.doctype.journal_entry.journal_entry.get_against_jv",
					filters: {
						account: jvd.account,
						party: jvd.party
					}
				};
			}

			var out = {
				filters: [
					[jvd.reference_type, "docstatus", "=", 1]
				]
			};

			if(in_list(["Sales Invoice", "Purchase Invoice"], jvd.reference_type)) {
				out.filters.push([jvd.reference_type, "outstanding_amount", "!=", 0]);
				// Filter by cost center
				if(jvd.cost_center) {
					out.filters.push([jvd.reference_type, "cost_center", "in", ["", jvd.cost_center]]);
				}
				// account filter
				frappe.model.validate_missing(jvd, "account");
				var party_account_field = jvd.reference_type==="Sales Invoice" ? "debit_to": "credit_to";
				out.filters.push([jvd.reference_type, party_account_field, "=", jvd.account]);

			}

			if(in_list(["Sales Order", "Purchase Order"], jvd.reference_type)) {
				// party_type and party mandatory
				frappe.model.validate_missing(jvd, "party_type");
				frappe.model.validate_missing(jvd, "party");

				out.filters.push([jvd.reference_type, "per_billed", "<", 100]);
			}

			if(jvd.party_type && jvd.party) {
				var party_field = "";
				if(jvd.reference_type.indexOf("Sales")===0) {
					var party_field = "customer";
				} else if (jvd.reference_type.indexOf("Purchase")===0) {
					var party_field = "supplier";
				}

				if (party_field) {
					out.filters.push([jvd.reference_type, party_field, "=", jvd.party]);
				}
			}

			return out;
		});


	}

	setup_balance_formatter() {
		const formatter = function(value, df, options, doc) {
			var currency = frappe.meta.get_field_currency(df, doc);
			var dr_or_cr = value ? ('<label>' + (value > 0.0 ? __("Dr") : __("Cr")) + '</label>') : "";
			return "<div style='text-align: right'>"
				+ ((value==null || value==="") ? "" : format_currency(Math.abs(value), currency))
				+ " " + dr_or_cr
				+ "</div>";
		};
		this.frm.fields_dict.accounts.grid.update_docfield_property('balance', 'formatter', formatter);
		this.frm.fields_dict.accounts.grid.update_docfield_property('party_balance', 'formatter', formatter);
	}

	reference_name(doc, cdt, cdn) {
		var d = frappe.get_doc(cdt, cdn);

		if(d.reference_name) {
			if (d.reference_type==="Purchase Invoice" && !flt(d.debit)) {
				this.get_outstanding('Purchase Invoice', d.reference_name, doc.company, d);
			} else if (d.reference_type==="Sales Invoice" && !flt(d.credit)) {
				this.get_outstanding('Sales Invoice', d.reference_name, doc.company, d);
			} else if (d.reference_type==="Journal Entry" && !flt(d.credit) && !flt(d.debit)) {
				this.get_outstanding('Journal Entry', d.reference_name, doc.company, d);
			}
		}
	}

	get_outstanding(doctype, docname, company, child, due_date) {
		var me = this;
		var args = {
			"doctype": doctype,
			"docname": docname,
			"party": child.party,
			"account": child.account,
			"account_currency": child.account_currency,
			"company": company
		}

		return frappe.call({
			method: "erpnext.accounts.doctype.journal_entry.journal_entry.get_outstanding",
			args: { args: args},
			callback: function(r) {
				if(r.message) {
					$.each(r.message, function(field, value) {
						frappe.model.set_value(child.doctype, child.name, field, value);
					})
				}
			}
		});
	}

	accounts_add(doc, cdt, cdn) {
		var row = frappe.get_doc(cdt, cdn);
		$.each(doc.accounts, function(i, d) {
			if(d.account && d.party && d.party_type) {
				row.account = d.account;
				row.party = d.party;
				row.party_type = d.party_type;
			}
		});

		// set difference
		if(doc.difference) {
			if(doc.difference > 0) {
				row.credit_in_account_currency = doc.difference;
				row.credit = doc.difference;
			} else {
				row.debit_in_account_currency = -doc.difference;
				row.debit = -doc.difference;
			}
		}
		cur_frm.cscript.update_totals(doc);

		erpnext.accounts.dimensions.copy_dimension_from_first_row(this.frm, cdt, cdn, 'accounts');
	}

};

cur_frm.script_manager.make(erpnext.accounts.JournalEntry);

cur_frm.cscript.update_totals = function(doc) {
	var td=0.0; var tc =0.0;
	var accounts = doc.accounts || [];
	for(var i in accounts) {
		td += flt(accounts[i].debit, precision("debit", accounts[i]));
		tc += flt(accounts[i].credit, precision("credit", accounts[i]));
	}
	var doc = locals[doc.doctype][doc.name];
	doc.total_debit = td;
	doc.total_credit = tc;
	doc.difference = flt((td - tc), precision("difference"));
	refresh_many(['total_debit','total_credit','difference']);
}

cur_frm.cscript.get_balance = function(doc,dt,dn) {
	cur_frm.cscript.update_totals(doc);
	cur_frm.call('get_balance', null, () => { cur_frm.refresh(); });
}

cur_frm.cscript.validate = function(doc,cdt,cdn) {
	cur_frm.cscript.update_totals(doc);
}

frappe.ui.form.on("Journal Entry Account", {
	party: function(frm, cdt, cdn) {
		var d = frappe.get_doc(cdt, cdn);
		if(!d.account && d.party_type && d.party) {
			if(!frm.doc.company) frappe.throw(__("Please select Company"));
			return frm.call({
				method: "erpnext.accounts.doctype.journal_entry.journal_entry.get_party_account_and_balance",
				child: d,
				args: {
					company: frm.doc.company,
					party_type: d.party_type,
					party: d.party,
					cost_center: d.cost_center
				}
			});
		}
	},
	cost_center: function(frm, dt, dn) {
		erpnext.journal_entry.set_account_balance(frm, dt, dn);
	},

	account: function(frm, dt, dn) {
		erpnext.journal_entry.set_account_balance(frm, dt, dn);
	},

	debit_in_account_currency: function(frm, cdt, cdn) {
		erpnext.journal_entry.set_exchange_rate(frm, cdt, cdn);
	},

	credit_in_account_currency: function(frm, cdt, cdn) {
		erpnext.journal_entry.set_exchange_rate(frm, cdt, cdn);
	},

	debit: function(frm, dt, dn) {
		cur_frm.cscript.update_totals(frm.doc);
	},

	credit: function(frm, dt, dn) {
		cur_frm.cscript.update_totals(frm.doc);
	},

	exchange_rate: function(frm, cdt, cdn) {
		var company_currency = frappe.get_doc(":Company", frm.doc.company).default_currency;
		var row = locals[cdt][cdn];

		if(row.account_currency == company_currency || !frm.doc.multi_currency) {
			frappe.model.set_value(cdt, cdn, "exchange_rate", 1);
		}

		erpnext.journal_entry.set_debit_credit_in_company_currency(frm, cdt, cdn);
	}
})

frappe.ui.form.on("Journal Entry Account", "accounts_remove", function(frm) {
	cur_frm.cscript.update_totals(frm.doc);
});

$.extend(erpnext.journal_entry, {
	toggle_fields_based_on_currency: function(frm) {
		var fields = ["currency_section", "account_currency", "exchange_rate", "debit", "credit"];

		var grid = frm.get_field("accounts").grid;
		if(grid) grid.set_column_disp(fields, frm.doc.multi_currency);

		// dynamic label
		var field_label_map = {
			"debit_in_account_currency": "Debit",
			"credit_in_account_currency": "Credit"
		};

		$.each(field_label_map, function (fieldname, label) {
			frm.fields_dict.accounts.grid.update_docfield_property(
				fieldname,
				'label',
				frm.doc.multi_currency ? (label + " in Account Currency") : label
			);
		})
	},

	set_debit_credit_in_company_currency: function(frm, cdt, cdn) {
		var row = locals[cdt][cdn];

		frappe.model.set_value(cdt, cdn, "debit",
			flt(flt(row.debit_in_account_currency)*row.exchange_rate, precision("debit", row)));

		frappe.model.set_value(cdt, cdn, "credit",
			flt(flt(row.credit_in_account_currency)*row.exchange_rate, precision("credit", row)));

		cur_frm.cscript.update_totals(frm.doc);
	},

	set_exchange_rate: function(frm, cdt, cdn) {
		var company_currency = frappe.get_doc(":Company", frm.doc.company).default_currency;
		var row = locals[cdt][cdn];

		if(row.account_currency == company_currency || !frm.doc.multi_currency) {
			row.exchange_rate = 1;
			erpnext.journal_entry.set_debit_credit_in_company_currency(frm, cdt, cdn);
		} else if (!row.exchange_rate || row.exchange_rate == 1 || row.account_type == "Bank") {
			frappe.call({
				method: "erpnext.accounts.doctype.journal_entry.journal_entry.get_exchange_rate",
				args: {
					posting_date: frm.doc.posting_date,
					account: row.account,
					account_currency: row.account_currency,
					company: frm.doc.company,
					reference_type: cstr(row.reference_type),
					reference_name: cstr(row.reference_name),
					debit: flt(row.debit_in_account_currency),
					credit: flt(row.credit_in_account_currency),
					exchange_rate: row.exchange_rate
				},
				callback: function(r) {
					if(r.message) {
						row.exchange_rate = r.message;
						erpnext.journal_entry.set_debit_credit_in_company_currency(frm, cdt, cdn);
					}
				}
			})
		} else {
			erpnext.journal_entry.set_debit_credit_in_company_currency(frm, cdt, cdn);
		}
		refresh_field("exchange_rate", cdn, "accounts");
	},

	accounts: function(frm) {
		console.log("accounts");
	},

	quick_entry: function(frm) {
		var naming_series_options = frm.fields_dict.naming_series.df.options;
		var naming_series_default = frm.fields_dict.naming_series.df.default || naming_series_options.split("\n")[0];

		var dialog = new frappe.ui.Dialog({
			title: __("Quick Journal Entry"),
			fields: [
				{fieldtype:"Link", label:__("Template"), fieldname:"template", options:"Journal Entry Template",
					onchange: function() {
						frappe.call({
							method: "frappe.client.get",
							args: {
								doctype: "Journal Entry Template",
								name: cur_dialog.get_value("template"),
							},
							callback(r) {
								if(r.message) {
									var template_doc = r.message;
									cur_dialog.set_values({
										"credit_or_debit": template_doc.credit_or_debit,
										"totalization": template_doc.default_amount,
										"is_vat_excluded": template_doc.is_vat_excluded,
									})
								}
							}
						});
					}
				},
				{fieldtype: "Select", fieldname: "credit_or_debit", label: __("Credit / Debit"), options: "Credit\nDebit", reqd: 1},
				{fieldtype: "Check", fieldname: "is_vat_excluded", label: __("Amount without tax")},
				{fieldtype: "Currency", fieldname: "totalization", label: __("Amount"), reqd: 1},
				////{fieldtype: "Currency", fieldname: "debit", label: __("Amount"), reqd: 1},
				/* ////
				{fieldtype: "Link", fieldname: "debit_account", label: __("Debit Account"), reqd: 1,
					options: "Account",
					get_query: function() {
						return erpnext.journal_entry.account_query(frm);
					}
				},
				{fieldtype: "Link", fieldname: "credit_account", label: __("Credit Account"), reqd: 1,
					options: "Account",
					get_query: function() {
						return erpnext.journal_entry.account_query(frm);
					}
				},
				*/ ////
				{fieldtype: "Date", fieldname: "posting_date", label: __("Date"), reqd: 1,
					default: frm.doc.posting_date},
				{fieldtype: "Small Text", fieldname: "user_remark", label: __("User Remark")},
				{fieldtype: "Select", fieldname: "naming_series", label: __("Series"), reqd: 1,
					options: naming_series_options, default: naming_series_default},
			]
		});
		////
		function populate_row(dt, dn, values){
			setTimeout(function(){
				var fields = ["account", "party_type", "party", "debit_in_account_currency", "credit_in_account_currency", "user_remark"];
				for(var l=0; l<fields.length; l++){
					frappe.model.set_value(dt, dn, fields[l], values[l]);
				}
			}, 100);
		}
		////
		dialog.set_primary_action(__("Save"), function() {
			var btn = this;
			var values = dialog.get_values();

			frm.set_value("posting_date", values.posting_date);
			frm.set_value("user_remark", values.user_remark);
			frm.set_value("naming_series", values.naming_series);

			// clear table is used because there might've been an error while adding child
			// and cleanup didn't happen
			////frm.clear_table("accounts");
			////
			if(frm.doc.accounts.length == 1) {
				frm.clear_table("accounts");
			}
			////

			// using grid.add_new_row() to add a row in UI as well as locals
			// this is required because triggers try to refresh the grid

			////
			frm.set_value("is_vat_excluded", values.is_vat_excluded);
			frappe.call({
				method: "frappe.client.get",
				args: {
					doctype: "Journal Entry Template",
					name: cur_dialog.get_value("template"),
				},
				callback(r) {
					if(r.message) {
						var template_doc = r.message;
						var totalization_doc = template_doc.accounting_entry_totalization[0]

						frappe.db.get_value("Account", template_doc.accounting_entry_totalization[0].account, "taxable_account", (re) => {
							if(re.taxable_account) var tax_account_name = re.taxable_account;
							else tax_account_name ="Sans TVA - pri"

							frappe.call({
								method: "frappe.client.get",
								args: {
									doctype: "Item Tax Template",
									name: tax_account_name,
								},
								callback(result) {
									if(result.message) {
										var tax_template = result.message;
										if(tax_template.taxes) {
											var has_vat = false;
											if(values.credit_or_debit == "Debit") {
												var debit = values.totalization;
												var credit = 0;
											} else {
												var debit = 0;
												var credit = values.totalization;
											}
											var totalization_values = [totalization_doc.account, totalization_doc.party_type, totalization_doc.party, debit, credit, totalization_doc.user_remark];
											for(var i = 0; i < tax_template.taxes.length; i++) {
												if(tax_template.taxes[i].tax_rate > 0) {
													var debit_tax = debit * tax_template.taxes[i].tax_rate / 100;
													var debit_ht = debit - debit_tax;
													var credit_tax = credit * tax_template.taxes[i].tax_rate / 100;
													var credit_ht = credit - credit_tax;
													var remark = totalization_doc.user_remark
													totalization_values = [totalization_doc.account, totalization_doc.party_type, totalization_doc.party, debit_ht, credit_ht, totalization_doc.user_remark];
													var totalization_row = frm.fields_dict.accounts.grid.add_new_row();
													populate_row(totalization_row.doctype, totalization_row.name, totalization_values);

													/*****   VAT   *****/
													var totalization_row_vat = frm.fields_dict.accounts.grid.add_new_row()
													var totalization_vat_values = [tax_template.taxes[i].tax_type, null, null, debit_tax, credit_tax, totalization_doc.user_remark ? __("VAT for") + " " + totalization_doc.user_remark : __("VAT for") + " " + totalization_doc.account]
													populate_row(totalization_row_vat.doctype, totalization_row_vat.name, totalization_vat_values);
													has_vat = true;
													break;
												}
											}
											if(!has_vat) {
												var totalization_row = frm.fields_dict.accounts.grid.add_new_row();
												populate_row(totalization_row.doctype, totalization_row.name, totalization_values);
											}
										}
									}

									var counterparty_row = [];
									var counterparty_vat_row = [];
									var unique_counterparty = template_doc.accounting_entry_counterparty.length == 1 ? true : false;
									var amount = unique_counterparty ? values.totalization / template_doc.accounting_entry_counterparty.length : null;
									if(values.credit_or_debit == "Debit") {
										var debit_counterparty = unique_counterparty ? 0 : null;
										var credit_counterparty = amount;
									} else {
										var debit_counterparty = amount;
										var credit_counterparty = unique_counterparty ? 0 : null;
									}
									template_doc.accounting_entry_counterparty.forEach(function(val,index) {
										frappe.db.get_value("Account", val.account, "taxable_account", (re) => {
											var tax_name = "";
											if(re.taxable_account) tax_name = re.taxable_account;
											else tax_name = "Sans TVA - pri";

											frappe.call({
												method: "frappe.client.get",
												args: {
													doctype: "Item Tax Template",
													name: tax_name,
												},
												callback(result) {
													if(result.message) {
														counterparty_row[index] = frm.fields_dict.accounts.grid.add_new_row();
														var tax_template = result.message;
														//if(index > 1) amount = 0;
														var counterparty_values = [val.account, val.party_type, val.party, debit_counterparty, credit_counterparty, val.user_remark];
														has_vat = false;
														if(tax_template.taxes) {
															for(var j = 0; j < tax_template.taxes.length; j++) {
																if(tax_template.taxes[j].tax_rate > 0) {
																	var debit_ht_counterparty = unique_counterparty ? values.is_vat_excluded ? debit_counterparty : debit_counterparty / (1+tax_template.taxes[j].tax_rate / 100) : null;
																	var debit_tax_counterparty = unique_counterparty ? values.is_vat_excluded ? debit_counterparty * tax_template.taxes[j].tax_rate / 100 : debit_counterparty - debit_ht_counterparty : null;

																	var credit_ht_counterparty = unique_counterparty ? values.is_vat_excluded ? credit_counterparty : credit_counterparty / (1+tax_template.taxes[j].tax_rate / 100) : null;
																	var credit_tax_counterparty = unique_counterparty ? values.is_vat_excluded ? credit_counterparty * tax_template.taxes[j].tax_rate / 100 : credit_counterparty - credit_ht_counterparty : null;

																	counterparty_values = [val.account, val.party_type, val.party, debit_ht_counterparty, credit_ht_counterparty, val.user_remark];
																	frappe.model.set_value(totalization_row.doctype, totalization_row.name, "debit_in_account_currency", credit_ht_counterparty + credit_tax_counterparty);
																	frappe.model.set_value(totalization_row.doctype, totalization_row.name, "credit_in_account_currency", debit_ht_counterparty + debit_tax_counterparty);
																	populate_row(counterparty_row[index].doctype, counterparty_row[index].name, counterparty_values);
																	/*****   VAT   *****/
																	var vat_account = tax_template.taxes[j].tax_type
																	if(unique_counterparty && index == template_doc.accounting_entry_counterparty.length - 1 && values.totalization % template_doc.accounting_entry_counterparty.length != 0) {
																		var rest = (values.totalization % template_doc.accounting_entry_counterparty.length).toFixed(2);
																		debit_tax > 0? debit_tax += rest : credit_tax += rest;
																	}
																	counterparty_vat_row[index] = frm.fields_dict.accounts.grid.add_new_row();
																	var counterparty_vat_values = [vat_account, null, null, debit_tax_counterparty, credit_tax_counterparty, val.user_remark? __("VAT for") + " " + val.user_remark : __("VAT for") + " "  + val.account];
																	populate_row(counterparty_vat_row[index].doctype, counterparty_vat_row[index].name, counterparty_vat_values);
																	has_vat = true;
																	break;
																}
															}
														}
														if(!has_vat) {
															if( unique_counterparty && index == template_doc.accounting_entry_counterparty.length - 1 && values.totalization % template_doc.accounting_entry_counterparty.length != 0) {
																rest = (values.totalization % template_doc.accounting_entry_counterparty.length).toFixed(2);
																debit_counterparty > 0? debit_counterparty += rest : credit_counterparty += rest;
																counterparty_values = [val.account, val.party_type, val.party, debit_counterparty, credit_counterparty, val.user_remark];
															}
															populate_row(counterparty_row[index].doctype, counterparty_row[index].name, counterparty_values);
														}
													}
													if(i == template_doc.accounting_entry_counterparty.length - 1) {
														refresh_field("accounts");
															//frm.save();
													}
												}
											});
										});
										//setTimeout(function() {}, 200);
									});
								}
							});
						});
					}
				}
			});
			
			/* base code:
			var debit_row = frm.fields_dict.accounts.grid.add_new_row();
			frappe.model.set_value(debit_row.doctype, debit_row.name, "account", values.debit_account);
			frappe.model.set_value(debit_row.doctype, debit_row.name, "debit_in_account_currency", values.debit);

			var credit_row = frm.fields_dict.accounts.grid.add_new_row();
			frappe.model.set_value(credit_row.doctype, credit_row.name, "account", values.credit_account);
			frappe.model.set_value(credit_row.doctype, credit_row.name, "credit_in_account_currency", values.debit);

			frm.save();
			*/
			////
			dialog.hide();
		});
		setTimeout(function() { dialog.show(); }, 400); ////
		////dialog.show();
	},

	account_query: function(frm) {
		var filters = {
			company: frm.doc.company,
			is_group: 0
		};
		if(!frm.doc.multi_currency) {
			$.extend(filters, {
				account_currency: frappe.get_doc(":Company", frm.doc.company).default_currency
			});
		}
		return { filters: filters };
	},

	reverse_journal_entry: function() {
		frappe.model.open_mapped_doc({
			method: "erpnext.accounts.doctype.journal_entry.journal_entry.make_reverse_journal_entry",
			frm: cur_frm
		})
	},
});

$.extend(erpnext.journal_entry, {
	set_account_balance: function(frm, dt, dn) {
		var d = locals[dt][dn];
		if(d.account) {
			if(!frm.doc.company) frappe.throw(__("Please select Company first"));
			if(!frm.doc.posting_date) frappe.throw(__("Please select Posting Date first"));

			return frappe.call({
				method: "erpnext.accounts.doctype.journal_entry.journal_entry.get_account_balance_and_party_type",
				args: {
					account: d.account,
					date: frm.doc.posting_date,
					company: frm.doc.company,
					debit: flt(d.debit_in_account_currency),
					credit: flt(d.credit_in_account_currency),
					exchange_rate: d.exchange_rate,
					cost_center: d.cost_center
				},
				callback: function(r) {
					if(r.message) {
						$.extend(d, r.message);
						erpnext.journal_entry.set_debit_credit_in_company_currency(frm, dt, dn);
						refresh_field('accounts');
					}
				}
			});
		}
	},
});

////
function excludingVatPrice(price, vat){
	if ( price == null ) {
		return -1;
	} else {
		return +(price - (price / (vat + 100)) * vat).toFixed(2);
	}
}
frappe.ui.form.on('Journal Entry Account', {
	debit_in_account_currency(frm, cdt, cdm, cdn) {
		var local_rows = locals[cdt];
		var rows_processed = 0;

		if(frm.selected_doc.debit_in_account_currency != null) {
			Object.values(locals["Journal Entry"]).forEach(function(result) {
				if(result.name == frm.selected_doc.parent) {
					if(!result.disable_calculation) {
						Object.values(local_rows).forEach(function(val) {
							if(val.idx == frm.selected_doc.idx+1 && val.parent == frm.selected_doc.parent) {
								if(val.account) {
									frappe.db.get_value("Account", val.account, ["account_type", "tax_rate"], (res) => {
										if(res.account_type && res.account_type == "Tax") {
											var base_debit = val.debit_in_account_currency ? Number(frm.selected_doc.debit_in_account_currency + Number(val.debit_in_account_currency)).toFixed(2) : Number(frm.selected_doc.debit_in_account_currency).toFixed(2);
											var original_tax = (base_debit - (base_debit / (1 + res.tax_rate / 100))).toFixed(2);

											var debit_value = result.is_vat_excluded ? frm.selected_doc.debit_in_account_currency : (frm.selected_doc.debit_in_account_currency / (1 + res.tax_rate / 100)).toFixed(2)
											var debit_tax = result.is_vat_excluded ? (debit_value * (res.tax_rate / 100)).toFixed(2) : frm.selected_doc.debit_in_account_currency - debit_value
											if(original_tax != Number(val.debit_in_account_currency).toFixed(2)) {
												frappe.model.set_value('Journal Entry Account', val.name , "debit_in_account_currency", debit_tax)
												frappe.model.set_value('Journal Entry Account', val.name , "debit", debit_tax)
												if(!result.is_vat_excluded) {
													frm.selected_doc.debit_in_account_currency = debit_value
													frm.selected_doc.debit = debit_value
													refresh_field("accounts");
													refresh_field("total_credit");
													refresh_field("total_debit");
												}
											}
										}
									});
								}
							}
							rows_processed++;
							if(rows_processed == Object.values(local_rows).length) {
								var new_credit = 0;
								rows_processed = 0;
								setTimeout(function() {
									Object.values(local_rows).forEach(function(val) {
										if(val.idx != 1 && val.parent == frm.selected_doc.parent ) {
											new_credit += val.debit_in_account_currency ? parseFloat(val.debit_in_account_currency) : 0;
										}
										rows_processed++;
										if(rows_processed == Object.values(local_rows).length) {
											frappe.model.set_value('Journal Entry Account', Object.values(local_rows)[0].name , "credit_in_account_currency", parseFloat(new_credit.toFixed(2)))
											refresh_field("accounts");
											refresh_field("total_credit");
											refresh_field("total_debit");
										}
									});
								}, 200);
							}
						});
					}
				}
			});
		}
	},

	////
	credit_in_account_currency(frm, cdt, cdm, cdn) {
		var local_rows = locals[cdt];
		var rows_processed = 0;
		if(frm.selected_doc.credit_in_account_currency != null) {
			Object.values(locals["Journal Entry"]).forEach(function(result) {
				if(result.name == frm.selected_doc.parent) {
					if(!result.disable_calculation) {
						Object.values(local_rows).forEach(function(val) {
							if(val.idx == frm.selected_doc.idx+1 && val.parent == frm.selected_doc.parent) {
								if(val.account) {
									frappe.db.get_value("Account", val.account, ["account_type", "tax_rate"], (res) => {
										//total_credit += frm.selected_doc.credit_in_account_currency;
										if(res.account_type && res.account_type == "Tax") {
											var base_credit = val.debit_in_account_currency ? Number(frm.selected_doc.credit_in_account_currency + Number(val.credit_in_account_currency)).toFixed(2) : Number(frm.selected_doc.credit_in_account_currency).toFixed(2);
											var original_tax = base_credit - ((base_credit / (1 + res.tax_rate / 100))).toFixed(2);

											var credit_value = result.is_vat_excluded ? frm.selected_doc.credit_in_account_currency : (frm.selected_doc.credit_in_account_currency / (1 + res.tax_rate / 100)).toFixed(2)
											var credit_tax = result.is_vat_excluded ? (credit_value * (res.tax_rate / 100)).toFixed(2) : frm.selected_doc.credit_in_account_currency - credit_value
											if(original_tax != Number(val.credit_in_account_currency).toFixed(2)) {
												frappe.model.set_value('Journal Entry Account', val.name , "credit_in_account_currency", parseFloat(credit_tax))
												frappe.model.set_value('Journal Entry Account', val.name , "credit", parseFloat(credit_tax))
												if(!result.is_vat_excluded) {
													frm.selected_doc.credit_in_account_currency = credit_value
													frm.selected_doc.credit = credit_value
													refresh_field("accounts");
													refresh_field("total_credit");
													refresh_field("total_debit");
												}
											}
										}
									});
								}
							}
							rows_processed++;
							if(rows_processed == Object.values(local_rows).length) {
								var new_debit = 0;
								rows_processed = 0;
								setTimeout(function() {
									Object.values(local_rows).forEach(function(val) {
										if(val.idx != 1 && val.parent == frm.selected_doc.parent ) {
											new_debit += val.credit_in_account_currency ? parseFloat(val.credit_in_account_currency) : 0;
										}
										rows_processed++;
										if(rows_processed == Object.values(local_rows).length) {
											frappe.model.set_value('Journal Entry Account', Object.values(local_rows)[0].name , "debit_in_account_currency", parseFloat(new_debit.toFixed(2)))
											//frappe.model.set_value('Journal Entry Account', Object.values(local_rows)[0].name , "credit_in_account_currency", parseFloat(credit_tax))
											refresh_field("accounts");
											refresh_field("total_credit");
											refresh_field("total_debit");
										}
									});
								}, 200);
							}
						});
					}
				}
			});
		}
	},
	////

	account(frm, cdt, cdm, cdn) {
		var local_rows = locals[cdt];
		//setTimeout(function() {
			Object.values(locals["Journal Entry"]).forEach(function(result) {
				if(result.name == frm.selected_doc.parent) {
					if(!result.disable_calculation) {
						//setTimeout(function() {
							var last_item = local_rows[Object.keys(local_rows)[Object.keys(local_rows).length - 1]]
							if(last_item.idx == frm.selected_doc.idx && last_item.account) {
								frappe.db.get_value("Account", last_item.account, ["taxable_account"], (r) => {
									if(r.taxable_account) {
										frappe.call({
											method: "frappe.client.get",
											args: {
												doctype: "Item Tax Template",
												name: r.taxable_account,
											},
											callback(res) {
												if(res.message) {
													var tax_template = res.message;
													if(tax_template.taxes) {
														for(var j = 0; j < tax_template.taxes.length; j++) {
															if(tax_template.taxes[j].tax_rate > 0) {
																var account = tax_template.taxes[j].tax_type
																var remark = frm.selected_doc.user_remark ? __("VAT for") + " " + totalization_doc.user_remark : __("VAT for") + " " + frm.selected_doc.account
																var last_account_vat = frm.fields_dict.accounts.grid.add_new_row()
																frappe.model.set_value(last_account_vat.doctype, last_account_vat.name, "account", account);
																frappe.model.set_value(last_account_vat.doctype, last_account_vat.name, "user_remark", remark);

																var debit = last_item.debit_in_account_currency ? excludingVatPrice(last_item.debit_in_account_currency, tax_template.taxes[j].tax_rate) : 0;
																var debit_tax = last_item.debit_in_account_currency - debit

																var credit = last_item.credit_in_account_currency ? excludingVatPrice(last_item.credit_in_account_currency, tax_template.taxes[j].tax_rate) : 0;
																var credit_tax = last_item.credit_in_account_currency - credit

																frm.selected_doc.debit_in_account_currency = debit_tax;
																frm.selected_doc.credit_in_account_currency = credit_tax;
																setTimeout(function() {
																	frappe.model.set_value(last_item.doctype, last_item.name, "debit_in_account_currency", parseFloat(debit));
																	frappe.model.set_value(last_item.doctype, last_item.name, "credit_in_account_currency", parseFloat(credit));
																}, 100)
																refresh_field("accounts");
																refresh_field("total_credit");
																refresh_field("total_debit");
																break;
															}
														}
													}
												}
											}
										});
									}
								});
							}
						//}, 2000);
					}
				}
			});
		//}, 200);
	},
});
////
