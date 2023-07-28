frappe.provide('frappe.ui.form');
////
frappe.ui.form.ItemQuickEntryForm = class ItemQuickEntryForm extends frappe.ui.form.QuickEntryForm {
	constructor(doctype, after_insert) {
		super(doctype, after_insert);
		this.neocustom = this.neocustom.bind(this);
	}

	async neocustom(dialog) {
		const self = this; // add this line to store the reference to the current instance

		let template_field = this.dialog.get_field("item_template");

		let html_tabs = `
		<div class="form-message blue" style=" margin-bottom: 0; ">
			<div>
			` + __("To transform a simple product into a bundled product,") + `
			<a href="/app/product-bundle/view/list" onclick="location.reload()">
			` + __("click here") + `
			</a>.
			</div>
		</div>
		<div class="form-tabs-list quick-entry">
			<input id="form-tabs-quick-entry" name="form-tabs-quick-entry" type="hidden" value="">
			<ul class="nav form-tabs" id="form-tabs-quick-entry" role="tablist">
				<li class="nav-item show">
					<a class="nav-link active" id="product-simple" data-toggle="tab" role="tab" aria-selected="false">
					` + __("Simple product") + `
					</a>
				</li>
				<li class="nav-item show">
					<a class="nav-link " id="product-var" data-toggle="tab" role="tab">
					` + __("Variable product") + `
					</a>
				</li>
				<li class="nav-item show">
					<a class="nav-link " id="var" data-toggle="tab" role="tab" >
					` + __("Variable") + `
					</a>
				</li>
			</ul>
		</div>
		`;

		$(dialog.$body).prepend(html_tabs);
		self.dialog.$wrapper.find('div[data-fieldname="buying_standard_rate"]').insertAfter(self.dialog.$wrapper.find('div[data-fieldname="standard_rate"]'));
		await this.waitForUIReady();

		let is_stock_item_input = self.dialog.$wrapper.find('div[data-fieldname="is_stock_item"] .input-area input[type="checkbox"]');
		let create_variant_input = self.dialog.$wrapper.find('div[data-fieldname="create_variant"] .input-area input[type="checkbox"]');
		let create_variant = self.dialog.$wrapper.find('div[data-fieldname="create_variant"]');

		self.dialog.$wrapper.find("#form-tabs-quick-entry .nav-link").off("click").on("click", function () {
			let tab_selected = $(this).attr("id");
			if (tab_selected == "product-simple") {
				self.dialog.$wrapper.find("#form-tabs-quick-entry").val("product-simple");
				hide_for_product_simple();
			} else if (tab_selected == "product-var") {
				self.dialog.$wrapper.find("#form-tabs-quick-entry").val("product-var");
				hide_for_product_var();
			} else if (tab_selected == "var") {
				self.dialog.$wrapper.find("#form-tabs-quick-entry").val("var");
				hide_for_var();
			}
		});

		function setFieldVisibility(fieldNames, hidden) {
			fieldNames.forEach((fieldName) => {
				let field = self.dialog.get_field(fieldName);
				field.df.hidden = hidden;
				field.refresh();
			});
		}

		function setFieldRequired(fieldNames, reqd) {
			fieldNames.forEach((fieldName) => {
				let field = self.dialog.get_field(fieldName);
				field.df.reqd = reqd;
				field.refresh();
			});
		}

		function toggleCheckbox(checkbox, checked) {
			if ($(checkbox).is(':checked') !== checked) {
				$(checkbox).click();
			}
		}

		function hide_for_product_simple() {
			toggleCheckbox(is_stock_item_input, true);
			toggleCheckbox(create_variant_input, false);

			setFieldVisibility([
				'is_stock_item', 'standard_rate', 'buying_standard_rate', 'stock_uom',
				'opening_stock', 'item_code', 'item_name', 'item_group'
			], false);

			setFieldVisibility([
				'attributes_quick_entry_1', 'attributes_quick_entry_2', 'attributes_quick_entry_3', 'item_template', 'variant_selling_price', 'variant_buying_price'
			], true);

			setFieldRequired([
				'attributes_quick_entry_1', 'attributes_quick_entry_2', 'attributes_quick_entry_3'
			], false);
		}

		function hide_for_product_var() {
			toggleCheckbox(is_stock_item_input, false);
			toggleCheckbox(create_variant_input, false);
			self.dialog.get_field("stock_uom").df.hidden = false;
			self.dialog.get_field("stock_uom").refresh();

			setFieldVisibility([
				'is_stock_item', 'standard_rate', 'buying_standard_rate', 'opening_stock'
			], true);

			setFieldVisibility([
				'attributes_quick_entry_1', 'variant_selling_price', 'variant_buying_price'
			], false);

			setFieldRequired([
				'attributes_quick_entry_1'
			], true);

			function change_val_attribute_1() {
				let val = self.dialog.$wrapper.find('[data-fieldname="attributes_quick_entry_1"]').find("input").val();
				if(val === '' || val === undefined) {
					let aqe2 = self.dialog.get_field("attributes_quick_entry_2")
					aqe2.set_value('')
					aqe2.refresh()
					let aqe3 = self.dialog.get_field("attributes_quick_entry_3")
					aqe3.set_value('')
					aqe3.df.hidden = true;
					aqe3.refresh()
				}
				setFieldVisibility(['attributes_quick_entry_2'], val === '' || val === undefined);
				//setFieldRequired(['attributes_quick_entry_2'], 0);
			}

			function change_val_attribute_2() {
				let val = self.dialog.$wrapper.find('[data-fieldname="attributes_quick_entry_2"]').find("input").val();
				if(val === '' || val === undefined) {
					let aqe3 = self.dialog.get_field("attributes_quick_entry_3")
					aqe3.set_value('')
					aqe3.refresh()
				}
				setFieldVisibility(['attributes_quick_entry_3'], val === '' || val === undefined);
				//setFieldRequired(['attributes_quick_entry_3'], 0);
			}

			setTimeout(() => {
				self.dialog.$wrapper.find('[data-fieldname="attributes_quick_entry_1"]').off("change paste keyup").on("change paste keyup", function () {
					change_val_attribute_1.call(self);

					self.dialog.$wrapper.find('[data-fieldname="attributes_quick_entry_2"] [role="listbox"]').off("click").on("click", function () {
						change_val_attribute_2.call(self);
					});
					self.dialog.$wrapper.find('[data-fieldname="attributes_quick_entry_2"]').off("change paste keyup").on("change paste keyup", function () {
						change_val_attribute_2.call(self);
					});
				});
				self.dialog.$wrapper.find('[data-fieldname="attributes_quick_entry_1"] [role="listbox"]').off("click").on("click", function () {
					change_val_attribute_1.call(self);

					self.dialog.$wrapper.find('[data-fieldname="attributes_quick_entry_2"] [role="listbox"]').off("click").on("click", function () {
						change_val_attribute_2.call(self);
					});
					self.dialog.$wrapper.find('[data-fieldname="attributes_quick_entry_2"]').off("change paste keyup").on("change paste keyup", function () {
						change_val_attribute_2.call(self);
					});
				});
			}, 200);
		}

		function hide_for_var() {
			toggleCheckbox(is_stock_item_input, true);
			toggleCheckbox(create_variant_input, true);
			setFieldVisibility([
				'is_stock_item', 'standard_rate', 'buying_standard_rate', 'opening_stock'
			], false);

			setFieldVisibility([
				'attributes_quick_entry_1', 'attributes_quick_entry_2', 'attributes_quick_entry_3', 'variant_selling_price', 'variant_buying_price'
			], true);

			setFieldRequired([
				'attributes_quick_entry_1', 'attributes_quick_entry_2', 'attributes_quick_entry_3'
			], false);
		}

		hide_for_product_simple();
		$(create_variant).hide();
		self.dialog.$wrapper.find("#form-tabs-quick-entry").val("product-simple");
	};

	waitForUIReady() {
		return new Promise((resolve) => {
			let checkUI = () => {
				if ($('div[data-fieldname="is_stock_item"] .input-area input[type="checkbox"]').length > 0) {
					resolve();
				} else {
					requestAnimationFrame(checkUI);
				}
			};
			checkUI();
		});
	}
	////

	render_dialog() {
		this.mandatory = this.get_variant_fields().concat(this.mandatory);
		this.mandatory = this.mandatory.concat(this.get_attributes_fields());
		this.check_naming_series_based_on();
		super.render_dialog();
		this.init_post_render_dialog_operations();
		this.preset_fields_for_template();
		this.dialog.$wrapper.find('.edit-full').text(__('Edit in full page for more options like assets, serial nos, batches etc.'))
	}

	check_naming_series_based_on() {
		if (frappe.defaults.get_default("item_naming_by") === "Naming Series") {
			this.mandatory = this.mandatory.filter(d => d.fieldname !== "item_code");
		}
	}

	init_post_render_dialog_operations() {
		this.dialog.fields_dict.attribute_html.$wrapper.append(frappe.render_template("item_quick_entry"));
		this.init_for_create_variant_trigger();
		this.init_for_item_template_trigger();
		// explicitly hide manufacturing fields as hidden not working.
		this.toggle_manufacturer_fields();
		this.dialog.get_field("item_template").df.hidden = 1;
		this.dialog.get_field("item_template").refresh();
		////
		this.neocustom(this.dialog);
		////
	}

	register_primary_action() {
		var me = this;
		this.dialog.set_primary_action(__('Save'), function() {
			if (me.dialog.working) return;

			var data = me.dialog.get_values();
			var variant_values = {};

			if (me.dialog.fields_dict.create_variant.$input.prop("checked")) {
				variant_values = me.get_variant_doc();
				if (!Object.keys(variant_values).length) {
					data = null;
				}
				variant_values.stock_uom = me.template_doc.stock_uom;
				variant_values.item_group = me.template_doc.item_group;
			}

			if (data) {
				me.dialog.working = true;
				var values = me.update_doc();
				//patch for manufacturer type variants as extend is overwriting it.
				if (variant_values['variant_based_on'] == "Manufacturer") {
					values['variant_based_on'] = "Manufacturer";
				}
				////
				if($("#form-tabs-quick-entry").val() == "product-var"){
					values['has_variants_quick_entry'] = 1;
					values['attributes_quick_entry_1'] = me.dialog.get_field("attributes_quick_entry_1").input.value;
					values['attributes_quick_entry_2'] = me.dialog.get_field("attributes_quick_entry_2").input.value;
					if(me.dialog.get_field("attributes_quick_entry_2").input.value){
						values['attributes_quick_entry_3'] = me.dialog.get_field("attributes_quick_entry_3").input.value;
					}
					$.extend(variant_values, values);
					me.insert(variant_values);
					frappe.set_route('Form', me.doctype, me.doc.name);
					return;
				} else {
					values['has_variants_quick_entry'] = 0;
				}
				////
				$.extend(variant_values, values);
				me.insert(variant_values);
			}
		});
	}

	insert(variant_values) {
		let me = this;
		return new Promise(resolve => {
			frappe.call({
				method: "frappe.client.insert",
				args: {
					doc: variant_values
				},
				callback: function(r) {
					me.dialog.hide();
					// delete the old doc
					frappe.model.clear_doc(me.dialog.doc.doctype, me.dialog.doc.name);
					me.dialog.doc = r.message;
					if (frappe._from_link) {
						frappe.ui.form.update_calling_link(me.dialog.doc);
					} else {
						if (me.after_insert) {
							me.after_insert(me.dialog.doc);
						} else {
							me.open_form_if_not_list();
						}
					}
				},
				error: function() {
					me.open_doc();
				},
				always: function() {
					me.dialog.working = false;
					resolve(me.dialog.doc);
				},
				freeze: true
			});
		});
	}

	open_doc() {
		this.dialog.hide();
		this.update_doc();
		if (this.dialog.fields_dict.create_variant.$input.prop("checked")) {
			var template = this.dialog.fields_dict.item_template.input.value;
			if (template)
				frappe.set_route("Form", this.doctype, template);
		} else {
			frappe.set_route('Form', this.doctype, this.doc.name);
		}
	}

	get_variant_fields() {
		var variant_fields = [
			{
				fieldname: "create_variant",
				fieldtype: "Check",
				label: __("Create Variant")
			},
			{
				fieldname: 'item_template',
				label: __('Item Template'),
				reqd: 0,
				fieldtype: 'Link',
				options: "Item",
				get_query: function() {
					return {
						filters: {
							"has_variants": 1
						}
					};
				}
			}
		];

		return variant_fields;
	}

	get_manufacturing_fields() {
		this.manufacturer_fields = [{
			fieldtype: 'Link',
			options: 'Manufacturer',
			label: 'Manufacturer',
			fieldname: "manufacturer",
			hidden: 1,
			reqd: 0
		}, {
			fieldtype: 'Data',
			label: 'Manufacturer Part Number',
			fieldname: 'manufacturer_part_no',
			hidden: 1,
			reqd: 0
		}];
		return this.manufacturer_fields;
	}

	get_attributes_fields() {
		var attribute_fields = [{
			fieldname: 'attribute_html',
			fieldtype: 'HTML'
		}]

		attribute_fields = attribute_fields.concat(this.get_manufacturing_fields());
		return attribute_fields;
	}

	init_for_create_variant_trigger() {
		var me = this;

		this.dialog.fields_dict.create_variant.$input.on("click", function() {
			me.preset_fields_for_template();
			me.init_post_template_trigger_operations(false, [], true);
		});
	}

	preset_fields_for_template() {
		var for_variant = this.dialog.get_value('create_variant');

		// setup template field, seen and mandatory if variant
		let template_field = this.dialog.get_field("item_template");
		template_field.df.reqd = for_variant;
		template_field.set_value('');
		template_field.df.hidden = !for_variant;
		template_field.refresh();

		// hide properties for variant
		['item_code', 'item_name', 'item_group', 'stock_uom'].forEach((d) => {
			let f = this.dialog.get_field(d);
			f.df.hidden = for_variant;
			f.refresh();
		});

		this.dialog.get_field('attribute_html').toggle(false);

		// non mandatory for variants
		['item_code', 'stock_uom', 'item_group'].forEach((d) => {
			let f = this.dialog.get_field(d);
			f.df.reqd = !for_variant;
			f.refresh();
		});

	}

	init_for_item_template_trigger() {
		var me = this;

		me.dialog.fields_dict["item_template"].df.onchange = () => {
			var template = me.dialog.fields_dict.item_template.input.value;
			me.template_doc = null;
			if (template) {
				frappe.call({
					method: "frappe.client.get",
					args: {
						doctype: "Item",
						name: template
					},
					callback: function(r) {
						me.template_doc = r.message;
						me.is_manufacturer = false;

						if (me.template_doc.variant_based_on === "Manufacturer") {
							me.init_post_template_trigger_operations(true, [], true);
						} else {

							me.init_post_template_trigger_operations(false, me.template_doc.attributes, false);
							me.render_attributes(me.template_doc.attributes);
						}
						////
						me.dialog.get_field("standard_rate").set_value(me.template_doc.variant_selling_price);
						me.dialog.get_field("buying_standard_rate").set_value(me.template_doc.variant_buying_price);
						////
					}
				});
			} else {
				me.dialog.get_field('attribute_html').toggle(false);
				me.init_post_template_trigger_operations(false, [], true);
			}
		}
	}

	init_post_template_trigger_operations(is_manufacturer, attributes, attributes_flag) {
		this.attributes = attributes;
		this.attribute_values = {};
		this.attributes_count = attributes.length;

		this.dialog.fields_dict.attribute_html.$wrapper.find(".attributes").empty();
		this.is_manufacturer = is_manufacturer;
		this.toggle_manufacturer_fields();
		this.dialog.fields_dict.attribute_html.$wrapper.find(".attributes").toggleClass("hide-control", attributes_flag);
		this.dialog.fields_dict.attribute_html.$wrapper.find(".attributes-header").toggleClass("hide-control", attributes_flag);
	}

	toggle_manufacturer_fields() {
		var me = this;
		$.each(this.manufacturer_fields, function(i, dialog_field) {
			me.dialog.get_field(dialog_field.fieldname).df.hidden = !me.is_manufacturer;
			me.dialog.get_field(dialog_field.fieldname).df.reqd = dialog_field.fieldname == 'manufacturer' ? me.is_manufacturer : false;
			me.dialog.get_field(dialog_field.fieldname).refresh();
		});
	}

	initiate_render_attributes() {
		this.dialog.fields_dict.attribute_html.$wrapper.find(".attributes").empty();
		this.render_attributes(this.attributes);
	}

	render_attributes(attributes) {
		var me = this;

		this.dialog.get_field('attribute_html').toggle(true);

		$.each(attributes, function(index, row) {
			var desc = "";
			var fieldtype = "Data";
			if (row.numeric_values) {
				fieldtype = "Float";
				desc = "Min Value: " + row.from_range + " , Max Value: " + row.to_range + ", in Increments of: " + row.increment;
			}

			me.init_make_control(fieldtype, row);
			me[row.attribute].set_value(me.attribute_values[row.attribute] || "");
			me[row.attribute].$wrapper.toggleClass("has-error", me.attribute_values[row.attribute] ? false : true);

			// Set Label explicitly as make_control is not displaying label
			$(me[row.attribute].label_area).text(__(row.attribute));

			if (desc) {
				$(repl(`<p class="help-box small text-muted hidden-xs">%(desc)s</p>`, {
					"desc": desc
				})).insertAfter(me[row.attribute].input_area);
			}

			if (!row.numeric_values) {
				me.init_awesomplete_for_attribute(row);
			} else {
				me[row.attribute].$input.on("change", function() {
					me.attribute_values[row.attribute] = $(this).val();
					$(this).closest(".frappe-control").toggleClass("has-error", $(this).val() ? false : true);
				});
			}
		});
	}

	init_make_control(fieldtype, row) {
		this[row.attribute] = frappe.ui.form.make_control({
			df: {
				"fieldtype": fieldtype,
				"label": row.attribute,
				"fieldname": row.attribute,
				"options": row.options || ""
			},
			parent: $(this.dialog.fields_dict.attribute_html.wrapper).find(".attributes"),
			only_input: false
		});
		this[row.attribute].make_input();
	}

	init_awesomplete_for_attribute(row) {
		var me = this;

		this[row.attribute].input.awesomplete = new Awesomplete(this[row.attribute].input, {
			minChars: 0,
			maxItems: 99,
			autoFirst: true,
			list: [],
		});

		this[row.attribute].$input.on('input', function(e) {
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Item Attribute Value",
					filters: [
						["parent", "=", $(e.target).attr("data-fieldname")],
						["attribute_value", "like", e.target.value + "%"]
					],
					fields: ["attribute_value"],
					parent: "Item Attribute"
				},
				callback: function(r) {
					if (r.message) {
						e.target.awesomplete.list = r.message.map(function(d) {
							return d.attribute_value;
						});
					}
				}
			});
		}).on('focus', function(e) {
			$(e.target).val('').trigger('input');
		}).on("awesomplete-close", function (e) {
			me.attribute_values[$(e.target).attr("data-fieldname")] = e.target.value;
			$(e.target).closest(".frappe-control").toggleClass("has-error", e.target.value ? false : true);
		});
	}

	get_variant_doc() {
		var me = this;
		var variant_doc = {};
		var attribute = this.validate_mandatory_attributes();

		if (Object.keys(attribute).length) {
			frappe.call({
				method: "erpnext.controllers.item_variant.create_variant_doc_for_quick_entry",
				args: {
					"template": me.dialog.fields_dict.item_template.$input.val(),
					args: attribute
				},
				async: false,
				callback: function(r) {
					if (Object.prototype.toString.call(r.message) == "[object Object]") {
						variant_doc = r.message;
					} else {
						var msgprint_dialog = frappe.msgprint(__("Item Variant {0} already exists with same attributes", [repl('<a class="strong variant-click" data-item-code="%(item)s" \
								>%(item)s</a>', {
							item: r.message
						})]));

						msgprint_dialog.$wrapper.find(".variant-click").on("click", function() {
							msgprint_dialog.hide();
							me.dialog.hide();
							if (frappe._from_link) {
								frappe._from_link.set_value($(this).attr("data-item-code"));
							} else {
								frappe.set_route('Form', "Item", $(this).attr("data-item-code"));
							}
						});
					}
				}
			})
		}
		return variant_doc;
	}

	validate_mandatory_attributes() {
		var me = this;
		var attribute = {};
		var mandatory = [];

		$.each(this.attributes, function(index, attr) {
			var value = me.attribute_values[attr.attribute] || "";
			if (value) {
				attribute[attr.attribute] = attr.numeric_values ? flt(value) : value;
			} else {
				mandatory.push(attr.attribute);
			}
		})

		if (this.is_manufacturer) {
			$.each(this.manufacturer_fields, function(index, field) {
				attribute[field.fieldname] = me.dialog.fields_dict[field.fieldname].input.value;
			});
		}
		return attribute;
	}

};
