/**
 * View form item packaging
 * Retrieves item dimensions, shipping rule, and generates a visualization
 * 
 * @param {Object} frm - Frappe form object
**/
function visualize_packing_from_form(frm) {
    // Check if there are any items
    if (!frm.doc.items || !frm.doc.items.length) {
        frappe.msgprint({
            title: "No items",
            message: __("The current document does not contain any items to visualize."),
            indicator: "orange"
        });
        return;
    }
    
    // Get all item codes
    const item_codes = frm.doc.items
        .filter(item => item.item_code)
        .map(item => item.item_code);
    
    if (!item_codes.length) {
        frappe.msgprint({
            title: "No valid items",
            message: __("The document does not contain any valid items."),
            indicator: "red"
        });
        return;
    }
    
    // Retrieve dimensions of all items in a single request
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Item",
            filters: { name: ["in", item_codes] },
            fields: ["name", "length", "width", "height", "weight_per_unit", "weight_uom", "item_name"]
        },
        callback: function(r) {
            frappe.hide_progress();
            
            if (r.exc || !r.message) {
                frappe.msgprint({
                    title: "Error",
                    message: __("Unable to retrieve item dimensions."),
                    indicator: "red"
                });
                return;
            }
            
            // Create a mapping of items and their dimensions
            const item_dimensions = {};
            r.message.forEach(item => {
                item_dimensions[item.name] = {
                    length: parseFloat(item.length || 0),
                    width: parseFloat(item.width || 0),
                    height: parseFloat(item.height || 0),
                    weight: parseFloat(item.weight_per_unit || 0),
                    item_name: item.item_name
                };
            });
            
            // Prepare item data for visualization
            const items_to_visualize = [];
            
            // Iterate through all items in the form
            frm.doc.items.forEach(form_item => {
                if (!form_item.item_code) return;
                
                const item_data = item_dimensions[form_item.item_code] || {};
                
                // Utiliser les dimensions du formulaire si disponibles, sinon celles de l'Item
                const length = parseFloat(form_item.length || 0) || parseFloat(item_data.length || 0);
                const width = parseFloat(form_item.width || 0) || parseFloat(item_data.width || 0);
                const height = parseFloat(form_item.height || 0) || parseFloat(item_data.height || 0);
                const weight = parseFloat(form_item.weight_per_unit || form_item.weight || 0) || 
                             parseFloat(item_data.weight || 0);
                
                // Ajouter l'article s'il a des dimensions valides
                if (length > 0 && width > 0 && height > 0) {
                    items_to_visualize.push({
                        name: form_item.item_name || item_data.item_name || form_item.item_code,
                        length: length,
                        width: width,
                        height: height,
                        weight: weight,
                        qty: form_item.qty || 1
                    });
                }
            });
            
            // Check if there are any items with dimensions
            if (!items_to_visualize.length) {
                frappe.msgprint({
                    title: "No valid items",
                    message: __("No valid items found. Please define dimensions in the item master."),
                    indicator: "red"
                });
                return;
            }
            
            // Get the shipping rule from the form
            const shipping_rule = frm.doc.shipping_rule || null;
            
            // Call the visualization API
            frappe.call({
                method: "erpnext.accounts.doctype.shipping_rule.packing_visualization.visualize_packing",
                args: {
                    items_data: items_to_visualize,
                    shipping_rule: shipping_rule
                },
                callback: function(r) {
                    frappe.hide_progress();
                    
                    if (r.exc) {
                        frappe.msgprint({
                            title: "Error in visualization",
                            message: __("An error occurred while generating the visualization."),
                            indicator: "red"
                        });
                        return;
                    }
                    
                    const result = r.message;
                    
                    if (!result || !result.success) {
                        frappe.msgprint({
                            title: "Error in visualization",
                            message: __("An error occurred while generating."),
                            indicator: "red"
                        });
                        return;
                    }
                    
                    // Create a dialog to display the visualization
                    const d = new frappe.ui.Dialog({
                        title: "Packing Visualization",
                        size: "large",
                        fields: [
                            {
                                fieldtype: "HTML",
                                fieldname: "visualization_container"
                            }
                        ]
                    });
                    
                    // Get the bin dimensions
                    const bin_dims = result.bin_dimensions;
                    
                    // Get the shipping info
                    const shipping_info = result.shipping_info || {
                        shipping_rule_name: "",
                        constraint_name: ""
                    };
                    
                    // Generate the header with rule and constraint information
                    let rule_info = "";
                    if (shipping_info.shipping_rule_name) {
                        rule_info = `<div class="text-muted mb-2">
                            <strong>${__("Shipping Rule")}:</strong> ${shipping_info.shipping_rule_name}
                            ${shipping_info.constraint_name ? `<br><strong>Constraint:</strong> ${shipping_info.constraint_name}` : ''}
                        </div>`;
                    }
                    
                    // Generate the dimension information
                    const dimension_info = `<div class="font-weight-bold mb-2">
                        ${__("Bin Dimensions")}: ${bin_dims.length.toFixed(1)} × ${bin_dims.width.toFixed(1)} × ${bin_dims.height.toFixed(1)} cm
                        (Volume: ${bin_dims.volume.toFixed(1)} cm³)
                    </div>`;
                    
                    // Generate the list of packed items
                    let items_list = `<div class="mb-3">
                        <ul class="list-unstyled">`;
                    
                    result.packed_items.forEach(item => {
                        const pos = item.position.map(p => p.toFixed(1)).join(", ");
                        const dims = item.dimensions.map(d => d.toFixed(1)).join(" × ");
                        items_list += `<li><span class="font-weight-bold">${item.name}</span>: 
                            Position: (${pos}), Dimensions: ${dims}</li>`;
                    });
                    
                    items_list += `</ul></div>`;
                    
                    // Generate the image HTML
                    const image_html = `<div class="text-center">
                        <img src="${result.image_url}" alt="Visualisation de l'emballage" 
                            style="max-width: 100%; max-height: 500px; border: 1px solid #ddd; border-radius: 5px;" />
                    </div>`;
                    
                    // Assemble the complete content
                    const content = `
                        <div class="packing-visualization-container">
                            ${rule_info}
                            ${dimension_info}
                            ${items_list}
                            ${image_html}
                        </div>
                    `;
                    
                    // Update the dialog content
                    d.fields_dict.visualization_container.$wrapper.html(content);
                    
                    // Add action buttons
                    d.set_primary_action("Close", () => {
                        d.hide();
                    });
                    
                    // Add download button
                    d.add_custom_action("Download", () => {
                        const a = document.createElement('a');
                        a.href = result.image_url;
                        a.download = 'packing_visualization.png';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                    }, 'btn-info');
                    
                    // Show the dialog
                    d.show();
                }
            });
        }
    });
}

// Code console for direct use in the browser console
const visualize_packing_from_console = () => {
    // Check the current form
    if (!cur_frm) {
        frappe.msgprint({
            title: "Error",
            message: "No active form found. Open a document first.",
            indicator: "red"
        });
        return;
    }
    
    // Use the main function with the current form
    visualize_packing_from_form(cur_frm);
};