erpnext.PointOfSale.StripeTerminal = function(){
	var connectiontoken = "";
	var terminal;
	var loading_dialog, connecting_dialog, message_dilaog, confirm_dialog;
	var payment_object,is_online;
	var me = this;

	this.assign_stripe_connection_token = function(payment, is_online) {
		payment_object = payment;
		is_online = is_online;
		show_loading_modal(__('Connecting to Stripe Terminal'), __('Please Wait'));
		frappe.dom.freeze();
		frappe.call({
			method: "pasigono.pasigono.api.get_stripe_terminal_token",
			freeze: true,
			headers: {
				"X-Requested-With": "XMLHttpRequest"
			},
			callback: function (r) {
				frappe.dom.unfreeze();
				if (r.message) {
					connectiontoken = r.message.secret;
					terminal = StripeTerminal.create({
						onFetchConnectionToken: fetchConnectionToken,
						onUnexpectedReaderDisconnect: unexpectedDisconnect
					});
					connect_to_stripe_terminal(payment, is_online);
				} else {
					show_error_dialog(__('Please configure the stripe settings.'));
				}
			}
		});
	}

	function fetchConnectionToken() {
		return connectiontoken;

	}

	function show_loading_modal(title, message) {
		loading_dialog = new frappe.ui.Dialog({
			title: __(title),
			fields: [{
					label: '',
					fieldname: 'show_dialog',
					fieldtype: 'HTML'
				},
			],
		});
		var html = '<div style="min-height:200px;position: relative;text-align: center;padding-top: 75px;line-height: 25px;font-size: 15px;">';
		html += '<div style="">' + message + '</div>';
		html += '</div>';
		loading_dialog.fields_dict.show_dialog.$wrapper.html(html);
		loading_dialog.show();
		if(title == __('Collecting Payments')) {
			loading_dialog.set_primary_action(__('Cancel'), function () {
				loading_dialog.hide();
				terminal.clearReaderDisplay();
			});
		}
	}

	function unexpectedDisconnect() {
		frappe.msgprint("Error: Stripe terminal unexpectedly disconnected. Please reload page")
	}

	function connect_to_stripe_terminal(payment, is_online) {
		frappe.dom.freeze();
		frappe.call({
			method: "pasigono.pasigono.api.get_stripe_terminal_settings",
			freeze: true,
			headers: {
				"X-Requested-With": "XMLHttpRequest"
			},
			callback: function (r) {
				frappe.dom.unfreeze();
				var isSimulated = false;
				var testCardNumber = "";
				var testCardtype = "";
				if (r.message != undefined) {
					if (r.message.enable_test_mode == 1) {
						isSimulated = true;
						testCardNumber = r.message.card_number;
						testCardtype = r.message.card_type;
					}
				}

				var config = {
					simulated: isSimulated
				};
				terminal.discoverReaders(config).then(function (discoverResult) {
					if (discoverResult.error) {
						cur_dialog.hide();
						show_error_dialog(__('No Stripe readers found.'));
					} else if (discoverResult.discoveredReaders.length === 0) {
						cur_dialog.hide();
						show_error_dialog(__('No Stripe readers found.'));
					} else {
						var devices = '';
						for(let x in discoverResult.discoveredReaders){
							devices = devices + '\n' + discoverResult.discoveredReaders[x].label;
						}						
						var d = new frappe.ui.Dialog({
							'fields': [
								{'fieldname': 'stripe_readers', 'fieldtype': 'Select', 'reqd': 1, 'label': 'Stripe Reader', 'options': devices }
							],
							primary_action: function(){
								var selected = d.get_values().stripe_readers;
								var selectedReader;
								for(let x in discoverResult.discoveredReaders){
									if(discoverResult.discoveredReaders[x].label == selected){
										selectedReader = discoverResult.discoveredReaders[x];
										d.hide();
									}
								}
								terminal.connectReader(selectedReader).then(function (connectResult) {
									if (connectResult.error) {
										cur_dialog.hide();
										show_error_dialog(__('Failed to connect.') + connectResult.error.message);

									} else {
										if (r.message.enable_test_mode == 1 && testCardNumber != "" && testCardtype != "") {
											terminal.setSimulatorConfiguration({
												'testCardNumber': testCardNumber,
												'testPaymentMethod': testCardtype
											});
										}
										loading_dialog.hide();
									}
								});
							},
							secondary_action: function(){
								frappe.msgprint(__('Please disable Stripe Terminal in the POS Profile.'));
								d.hide();
							},
							secondary_action_label: __('Cancel'),
							title: __('Select a Stripe Terminal device')
						});
						d.show();
						// if only one reader is found, set in stripe_readers field
						var userInteracted = false;
						if(discoverResult.discoveredReaders.length == 1){
							d.fields_dict.stripe_readers.set_input(discoverResult.discoveredReaders[0].label);
							// Show alert to the user
							frappe.show_alert({
								message:__('Without any action on your part, the Stripe Terminal device will be automatically selected in 5 seconds.'),
								indicator:'green'
							}, 5);
							
							// Set up a timeout to automatically execute the primary action
							setTimeout(function(){
								// Check if the user has interacted with the dialog or if the dialog is still open
								if(!userInteracted && d.$wrapper.find('.modal-dialog').length > 0){
									d.hide();
									d.primary_action();
								}
							}, 5000);
						}

						// Event handlers for user interactions
						d.$wrapper.on('click', 'button, .modal-dialog', function() {
							userInteracted = true;
						});
						d.$wrapper.on('change', 'input, select', function() {
							userInteracted = true;
						});

					}
				});
			}
		});
	}


	this.display_details = async function(payment){	
		var items = [];
		var currency = payment.frm.doc.currency;
	
		cur_frm.doc.items.forEach(function(row){
			var amount = Math.round(row.rate * row.qty * 100); // Ensure this is an integer
			var item = {
				"description": row.item_name,
				"quantity": row.qty,
				"amount": amount
			};
			items.push(item);
		});
		
		setTimeout(function(){
			try {
				terminal.setReaderDisplay({
					type: 'cart',
					cart: {
						line_items: items,
						tax: Math.round(cur_frm.doc.total_taxes_and_charges * 100), // Ensure tax is an integer
						total: Math.round((cur_frm.doc.rounded_total || cur_frm.doc.grand_total) * 100), // Ensure total is an integer
						currency: currency
					}
				}).then(function() {
					//console.log('setReaderDisplay call successful');
				}).catch(function(error) {
					console.error('setReaderDisplay call failed', error);
				});
			} catch (error) {
				console.error('Failed to set reader display:', error);
			}
		}, 400);
	}

	this.collecting_payments = function(payment, is_online) {
		if(payment.frm.doc.is_return == 1){
			confirm_dialog = new frappe.ui.Dialog({
				title: __('Confirm, refund through Stripe'),
				fields: [{
						label: '',
						fieldname: 'show_dialog',
						fieldtype: 'HTML'
					},
				],
				primary_action_label: __("Confirm"),
				primary_action(values) {
					confirm_dialog.hide();
					refund_payment(payment, is_online);
				},
				secondary_action_label: __("Cancel"),
				secondary_action(values) {
					confirm_dialog.hide();
				}
			});
			var payments = payment.frm.doc.payments;
			to_refund = 0;
			payments.forEach(function(row) {
				if (row.mode_of_payment == window.stripe_mode_of_payment) {
					if (row.amount_authorized/100 < row.amount*-1) {
						frappe.throw(__('Cannot refund more than paid with Stripe payment.'));
					}
					to_refund += row.amount;
				}
			});
			var html = '<div style="text-align: center;">' + __('Please confirm. Refund of') + ' ' + payment.frm.doc.currency.toUpperCase() + ' ';
			html += to_refund + __(' through stripe.') + '</div>';
			confirm_dialog.fields_dict.show_dialog.$wrapper.html(html);
			confirm_dialog.show();
			frappe.dom.unfreeze();////
		}
		else{
			create_payment(payment, is_online);
		}
	}

	////
	this.clear_display = function(){
		if(terminal)  terminal.clearReaderDisplay();
	}
	////

	function refund_payment(payment, is_online){
		show_loading_modal(__('Refunding Payments'), __('Please Wait'));
		frappe.dom.freeze();
		var payments = payment.frm.doc.payments;
		payments.forEach(function(row){
			if(row.mode_of_payment == window.stripe_mode_of_payment){
				frappe.call({
					method: "pasigono.pasigono.api.refund_payment",
					freeze: true,
					args: {
						"payment_intent_id": row.card_payment_intent,
						"amount": row.base_amount.toFixed(2)*-100
					},
					headers: {
						"X-Requested-With": "XMLHttpRequest"
					},
					callback: function(result){
						loading_dialog.hide();
						frappe.dom.unfreeze();
						if (is_online) {
							payment.frm.savesubmit()
								.then((sales_invoice) => {
									if (sales_invoice && sales_invoice.doc) {
										payment.frm.doc.docstatus = sales_invoice.doc.docstatus;
										frappe.show_alert({
											indicator: 'green',
											message: __(`POS invoice ${sales_invoice.doc.name} created succesfully`)
										});
										payment.toggle_components(false);
										payment.order_summary.toggle_component(true);
										payment.order_summary.load_summary_of(payment.frm.doc, true);
									}
								});

						} else {
							payment.payment.events.submit_invoice();
						}
					}
				});
			}
		});
	}


	function create_payment(payment, is_online){
		show_loading_modal(__('Collecting Payments'), __('Please Wait'));
		loading_dialog.$wrapper.attr('id', 'myUniqueModalId');
		loading_dialog.$wrapper.find('.btn-modal-close').hide()

		$(document).on('shown.bs.modal', '#myUniqueModalId', function() {
			$(this).data('bs.modal')._config.backdrop = 'static';
			$(this).data('bs.modal')._config.keyboard = false;
		});
		$(document).on('hidden.bs.modal', '#myUniqueModalId', function() {
			$(this).removeAttr('id');
		});
		//frappe.dom.freeze();
		frappe.call({
			method: "pasigono.pasigono.api.payment_intent_creation",
			freeze: true,
			args: {
				"sales_invoice": payment.frm.doc
			},
			headers: {
				"X-Requested-With": "XMLHttpRequest"
			},
			callback: function (r) {
				terminal.collectPaymentMethod(r.message.client_secret).then(function (result) {
					if (result.error) {
						loading_dialog.hide();
						show_payment_error_dialog(result.error.message, is_online);
					} else {
						terminal.processPayment(result.paymentIntent).then(function (result) {
							if (result.error) {
								loading_dialog.hide();
								show_payment_error_dialog(result.error.message, is_online);
							} else if (result.paymentIntent) {
								loading_dialog.hide();
								confirm_dialog = new frappe.ui.Dialog({
									title: __('Confirm Stripe Payment'),
									fields: [{
											label: '',
											fieldname: 'show_dialog',
											fieldtype: 'HTML'
										},
									],
									primary_action_label: __("Confirm"),
									primary_action(values) {
										capture_payment(payment, is_online, result.paymentIntent);
										terminal.clearReaderDisplay();
									},
									secondary_action_label: __("Cancel"),
									secondary_action(values) {
										cancel_payment(payment, is_online, result.paymentIntent);
										terminal.clearReaderDisplay();
									}
								});
								var html = '<div style="text-align: center;">' + __('Please confirm. Payment of') + ' ' + result.paymentIntent.currency.toUpperCase() + ' ';
								html += result.paymentIntent.amount/100 + __(' through stripe.') + '</div>';
								confirm_dialog.fields_dict.show_dialog.$wrapper.html(html);
								confirm_dialog.show();
								frappe.dom.unfreeze();////
							}
						});
					}
				});

			}
		})
	}


	function cancel_payment(payment, is_online, payment_intent){
		confirm_dialog.hide();

		var canceling_dialog = new frappe.ui.Dialog({
			title: __('Canceling Stripe Terminal'),
			fields: [{
					label: '',
					fieldname: 'show_dialog',
					fieldtype: 'HTML'
				},
			],
		});
		var html = '<div style="min-height:200px;position: relative;text-align: center;padding-top: 75px;line-height: 25px;font-size: 15px;">';
		html += '<div style="">' + __('Please Wait') + '</div>';
		html += '</div>';
		canceling_dialog.fields_dict.show_dialog.$wrapper.html(html);
		canceling_dialog.show();
		frappe.call({
			method: "pasigono.pasigono.api.cancel_payment_intent",
			freeze: true,
			args: {
				"payment_intent_id": payment_intent.id,
				"sales_invoice_id": payment.frm.doc.name
			},
			headers: {
				"X-Requested-With": "XMLHttpRequest"
			},
			callback: function (intent_result) {
				frappe.dom.unfreeze();
				canceling_dialog.hide();
				frappe.msgprint(__("Stripe payment cancelled."));
			}
		})
	}


	function capture_payment(payment, is_online, payment_intent){
		confirm_dialog.hide();
		show_loading_modal(__('COllecting Payments'), __('Please Wait'));
		frappe.call({
			method: "pasigono.pasigono.api.capture_payment_intent",
			freeze: true,
			args: {
				"payment_intent_id": payment_intent.id,
				"sales_invoice_id": payment.frm.doc.name
			},
			headers: {
				"X-Requested-With": "XMLHttpRequest"
			},
			callback: function (intent_result) {
				frappe.dom.unfreeze();
				loading_dialog.hide();
				var payments = payment.frm.doc.payments;
				payments.forEach(function(row){
					if(row.mode_of_payment == window.stripe_mode_of_payment){
						if('charges' in intent_result.message) {
							var card_info = intent_result.message.charges.data[0].payment_method_details.card_present;
							row.card_brand = card_info.brand;
							row.card_last4 = card_info.last4;
							row.card_account_type = card_info.receipt.account_type;
							row.card_application_preferred_name = card_info.receipt.application_preferred_name;
							row.card_dedicated_file_name = card_info.receipt.dedicated_file_name;
							row.card_authorization_response_code = card_info.receipt.authorization_response_code;
							row.card_application_cryptogram = card_info.receipt.application_cryptogram;
							row.card_terminal_verification_results = card_info.receipt.terminal_verification_results;
							row.card_transaction_status_information = card_info.receipt.transaction_status_information;
							row.card_authorization_code = card_info.receipt.authorization_code;
							row.card_charge_id = intent_result.message.charges.data[0].id;
							row.card_payment_intent = intent_result.message.charges.data[0].payment_intent;
							row.amount_authorized = parseInt(card_info.amount_authorized);
						} else {
							row.card_charge_id = intent_result.message.id;
						}
					}
				});

				if (is_online) {
					payment.frm.savesubmit()
						.then((sales_invoice) => {
							//For raw printing
							if(window.open_cash_drawer_automatically == 1){
								payment.payment.events.open_cash_drawer();
							}

							if(window.automatically_print == 1){
								payment.payment.events.raw_print(this.frm);
							}

							if (sales_invoice && sales_invoice.doc) {
								payment.frm.doc.docstatus = sales_invoice.doc.docstatus;
								frappe.show_alert({
									indicator: 'green',
									message: __(`POS invoice ${sales_invoice.doc.name} created succesfully`)
								});
								frappe.call({
									method: "pasigono.pasigono.api.update_payment_intent",
									freeze: true,
									args: {
										"payment_intent_id": payment_intent.id,
										"sales_invoice_id": sales_invoice.doc.name
									},
									headers: {
										"X-Requested-With": "XMLHttpRequest"
									},
									callback: function (intent_result) {
										payment.toggle_components(false);
										payment.order_summary.toggle_component(true);
										payment.order_summary.load_summary_of(payment.frm.doc, true);
									}
								});
							}
						});

				} else {
					payment.payment.events.submit_invoice();
				}
			}
		})
	}

	function retry_stripe_terminal(me, payment_object, is_online)
	{
		message_dilaog.hide();
		me.collecting_payments(payment_object, is_online);
		//assign_stripe_connection_token
		//me.assign_stripe_connection_token(payment_object, is_online);
	}
	function change_payment_method()
	{
		message_dilaog.hide();
		$(".num-col.brand-primary").click();

	}

	function show_error_dialog(message) {
		message_dilaog = new frappe.ui.Dialog({
			title: 'Message',
			fields: [{
					label: '',
					fieldname: 'show_dialog',
					fieldtype: 'HTML'
				},
			],
			primary_action_label: __("Retry"),
			primary_action(values) {
				////retry_stripe_terminal(me);
				me.assign_stripe_connection_token(payment_object, is_online);
				message_dilaog.hide();
			}
		});
		var html = "<p>" + message + "</p>";
		message_dilaog.fields_dict.show_dialog.$wrapper.html(html);
		message_dilaog.show();
	}

	function show_payment_error_dialog(message, is_online) {
		message_dilaog = new frappe.ui.Dialog({
			title: 'Message',
			fields: [{
					label: '',
					fieldname: 'show_dialog',
					fieldtype: 'HTML'

				},

			],
			primary_action_label: __("Retry"),
			secondary_action_label: __("Change Payment Mode"),
			primary_action(values) {
				retry_stripe_terminal(me, payment_object, is_online);
				//me.collecting_payments(payment_object, is_online);
			},
			secondary_action(values) {
				change_payment_method();
			}
		});
		var html = "<p>" + message + "</p>";
		message_dilaog.fields_dict.show_dialog.$wrapper.html(html);
		message_dilaog.show();

		message_dilaog.$wrapper.attr('id', 'myUniqueModalId');
		message_dilaog.$wrapper.find('.btn-modal-close').hide()
		$(document).on('shown.bs.modal', '#myUniqueModalId', function() {
			$(this).data('bs.modal')._config.backdrop = 'static';
			$(this).data('bs.modal')._config.keyboard = false;
		});
		$(document).on('hidden.bs.modal', '#myUniqueModalId', function() {
			$(this).removeAttr('id');
		});
	}
}
