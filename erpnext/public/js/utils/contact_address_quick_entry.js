frappe.provide("frappe.ui.form");

frappe.ui.form.ContactAddressQuickEntryForm = class ContactAddressQuickEntryForm extends (
	frappe.ui.form.QuickEntryForm
) {
	constructor(doctype, after_insert, init_callback, doc, force) {
		super(doctype, after_insert, init_callback, doc, force);
		this.skip_redirect_on_error = true;
	}

	render_dialog() {
		this.mandatory = this.mandatory.concat(this.get_variant_fields());
		super.render_dialog();

		// Set default currency from system settings
		if (this.dialog && this.dialog.fields_dict.default_currency) {
			const default_currency = frappe.defaults.get_default("currency");
			if (default_currency) {
				this.dialog.set_value("default_currency", default_currency);
			}
		}
	}

	//// Neoffice — extracted from insert() so open_doc() can use it too. Upstream
	//// only renamed the alias fields on insert, so "Edit in full page" carried
	//// `email_address` onto a Customer that has no such field: the email the
	//// caller had just typed was dropped on the floor, silently, and the customer
	//// was created unreachable. Remove when upstream maps them in update_doc().
	map_alias_fields() {
		/**
		 * Using alias fieldnames because the doctype definition define "email_id" and "mobile_no" as readonly fields.
		 * This results in the fields being "hidden".
		 */
		const map_field_names = {
			email_address: "email_id",
			mobile_number: "mobile_no",
			map_to_first_name: "first_name",
			map_to_last_name: "last_name",
		};

		Object.entries(map_field_names).forEach(([fieldname, new_fieldname]) => {
			if (this.dialog.doc[fieldname] !== undefined) {
				this.dialog.doc[new_fieldname] = this.dialog.doc[fieldname];
				delete this.dialog.doc[fieldname];
			}
		});
	}

	insert() {
		this.map_alias_fields(); //// Neoffice — was inline here, see map_alias_fields()
		return super.insert();
	}

	//// Neoffice — added. update_doc() copies the dialog values onto the doc under
	//// their DIALOG names, and upstream renamed the aliases in insert() only — so
	//// clicking "Edit Full Form" carried `email_address` onto a Customer that has
	//// no such field: the mandatory email vanished on the way, and the customer
	//// was created unreachable. Map before handing over. super.open_doc() runs
	//// update_doc() again and re-adds the alias key, which the server ignores;
	//// calling super keeps its after_save hook and __run_link_triggers.
	open_doc(set_hooks) {
		this.update_doc();
		this.map_alias_fields();
		return super.open_doc(set_hooks);
	}

	get_variant_fields() {
		var variant_fields = [
			{
				fieldtype: "Section Break",
				label: __("Primary Contact Details"),
				collapsible: 0, //// changed 
			},
			{
				label: __("First Name"),
				fieldname: "map_to_first_name",
				fieldtype: "Data",
				depends_on: "eval:doc.customer_type=='Company' || doc.supplier_type=='Company'",
			},
			{
				label: __("Last Name"),
				fieldname: "map_to_last_name",
				fieldtype: "Data",
				depends_on: "eval:doc.customer_type=='Company' || doc.supplier_type=='Company'",
			},
			{
				fieldtype: "Column Break",
			},
			{
				label: __("Email Id"),
				fieldname: "email_address",
				fieldtype: "Data",
				options: "Email",
				reqd: 1, //// added
			},
			{
				label: __("Mobile Number"),
				fieldname: "mobile_number",
				fieldtype: "Data",
			},
			{
				fieldtype: "Section Break",
				label: __("Primary Address Details"),
				collapsible: 0,
			},
			{
				label: __("Address Line 1"),
				fieldname: "address_line1",
				fieldtype: "Data",
			},
			{
				label: __("Address Line 2"),
				fieldname: "address_line2",
				fieldtype: "Data",
			},
			{
				label: __("ZIP Code"),
				fieldname: "pincode",
				fieldtype: "Data",
			},
			{
				fieldtype: "Column Break",
			},
			{
				label: __("City"),
				fieldname: "city",
				fieldtype: "Data",
			},
			{
				label: __("State/Province"),
				fieldname: "state",
				fieldtype: "Data",
			},
			{
				label: __("Country"),
				fieldname: "country",
				fieldtype: "Link",
				options: "Country",
			},
			{
				label: __("Customer POS Id"),
				fieldname: "customer_pos_id",
				fieldtype: "Data",
				hidden: 1,
			},
		];

		return variant_fields;
	}
};