frappe.provide('erpnext.PointOfSale');

frappe.pages['point-of-sale'].on_page_load = function(wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __('Point of Sale'),
		single_column: true
	});
	window.pos_loaded = true; //// added
	frappe.require('point-of-sale.bundle.js', function() {
		wrapper.pos = new erpnext.PointOfSale.Controller(wrapper);
		window.cur_pos = wrapper.pos;
		//// added code block
		window.is_item_details_open = false;
		window.checkPort = async function(fromWorker){
			if("serial" in navigator){
				var ports = await navigator.serial.getPorts();
				if(ports.length == 0 || fromWorker){
					frappe.confirm(
						'Please provide permission to connect to the weigh device',
						async function(){
							ports = await navigator.serial.requestPort();
							//Call connect again if the worker is already initialized
							if(typeof(window.mettlerWorker) != "undefined"){
								window.mettlerWorker.postMessage({"command": "connect"});
							}
						},
						function(){

						}
					);
				}
			}
			else{
				frappe.msgprint("Your browser does not support serial device connection. Please switch to a supported browser to connect to your weigh device");
			}
		}
		////
	});
	//// added code block
	$(document).on('page-change', function(){
		var urlParts = window.location.pathname.split('/');
		var page = urlParts.pop() || urlParts.pop();
		if(page == "point-of-sale" && !window.pos_loaded){
			window.location.reload();
		}
		else if(page == "point-of-sale" && window.pos_loaded){
			window.pos_loaded = false;
		}
	});
	////
};

frappe.pages['point-of-sale'].refresh = function(wrapper) {
	if (document.scannerDetectionData) {
		onScan.detachFrom(document);
		wrapper.pos.wrapper.html("");
		wrapper.pos.check_opening_entry();
	}

	//// added code block
	window.onbeforeunload = function(){
		if(window.enable_weigh_scale == 1){
			window.mettlerWorker.terminate();
			window.mettlerWorker = "undefined";
		}
		return null;
	}
	////
};
