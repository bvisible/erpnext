frappe.provide('frappe.ui.form');

frappe.ui.form.ContactAddressQuickEntryForm = class ContactAddressQuickEntryForm extends frappe.ui.form.QuickEntryForm {
	constructor(doctype, after_insert, init_callback, doc, force) {
		super(doctype, after_insert, init_callback, doc, force);
		this.skip_redirect_on_error = true;
	}

	render_dialog() {
		this.mandatory = this.mandatory.concat(this.get_variant_fields());
		//// added code block
		let count = 0;
		let territory_idx = 0;
		let name_idx = 0;
		this.mandatory.forEach(df => {
			if (df.fieldname === "territory") {
				territory_idx = count;
			}
			if (df.fieldname === "customer_name") {
				name_idx = count;
			}
			count++;
		})
		if(territory_idx != 0) {
			this.mandatory.splice(territory_idx+1, 0, {fieldtype: 'Column Break'});
		}
		if(name_idx != 0) {
			this.mandatory.splice(name_idx + 1, 0, {fieldtype: 'Section Break'});
		}
		////
		super.render_dialog();
	}

	insert() {
		/**
		 * Using alias fieldnames because the doctype definition define "email_id" and "mobile_no" as readonly fields.
		 * Therefor, resulting in the fields being "hidden".
		 */
		const map_field_names = {
			"email_address": "email_id",
			"mobile_number": "mobile_no",
		};

		Object.entries(map_field_names).forEach(([fieldname, new_fieldname]) => {
			this.dialog.doc[new_fieldname] = this.dialog.doc[fieldname];
			delete this.dialog.doc[fieldname];
		});

		return super.insert();
	}

	get_variant_fields() {
		var variant_fields = [
			{
			fieldtype: "Section Break",
			label: __("Primary Contact Details"),
			collapsible: 0 //// modified from 1 to 0
			},
			{
				label: __("Email Id"),
				fieldname: "email_address",
				fieldtype: "Data",
				options: "Email",
				reqd: 1, //// added
			},
			{
				fieldtype: "Column Break"
			},
			{
				label: __("Mobile Number"),
				fieldname: "mobile_number",
				fieldtype: "Data"
			},
			{
				fieldtype: "Section Break",
				label: __("Primary Address Details"),
				collapsible: 1
			},
			{
				label: __("Address Line 1"),
				fieldname: "address_line1",
				fieldtype: "Data",
				mandatory_depends_on: "eval:doc.address_line1 || doc.city || doc.pincode" //// added
			},
			{
				label: __("Address Line 2"),
				fieldname: "address_line2",
				fieldtype: "Data"
			},
			{
				label: __("ZIP Code"),
				fieldname: "pincode",
				fieldtype: "Data",
				mandatory_depends_on: "eval:doc.address_line1 || doc.city || doc.pincode" //// added
			},
			{
				fieldtype: "Column Break"
			},
			{
				label: __("City"),
				fieldname: "city",
				fieldtype: "Data",
				mandatory_depends_on: "eval:doc.address_line1 || doc.city || doc.pincode" //// added
			},
			{
				label: __("State"),
				fieldname: "state",
				fieldtype: "Data"
			},
			{
				label: __("Country"),
				fieldname: "country",
				fieldtype: "Link",
				options: "Country",
				mandatory_depends_on: "eval:doc.address_line1 || doc.city || doc.pincode" //// added
			},
			{
				label: __("Customer POS Id"),
				fieldname: "customer_pos_id",
				fieldtype: "Data",
				hidden: 1
			}
		];

		return variant_fields;
	}
}
