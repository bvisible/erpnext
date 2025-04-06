import frappe


def execute():
    """
    A New select field 'reconciliation_takes_effect_on' has been added to control Advance Payment Reconciliation dates.
    Migrate old checkbox configuration to new select field on 'Company' and 'Payment Entry'
    """
    # Check if column already exists, create it if not
    if not frappe.db.has_column("Company", "reconciliation_takes_effect_on"):
        frappe.db.add_column("Company", "reconciliation_takes_effect_on", "varchar(50)")
    
    # Get only company name and existing checkbox field
    companies = frappe.db.get_all("Company", fields=["name", "reconcile_on_advance_payment_date"])
    
    for x in companies:
        new_value = (
            "Advance Payment Date" if x.get("reconcile_on_advance_payment_date") else "Oldest Of Invoice Or Advance"
        )
        frappe.db.set_value("Company", x.name, "reconciliation_takes_effect_on", new_value)
    
    # Ensure column exists in Payment Entry table
    if not frappe.db.has_column("Payment Entry", "advance_reconciliation_takes_effect_on"):
        frappe.db.add_column("Payment Entry", "advance_reconciliation_takes_effect_on", "varchar(50)")
    
    frappe.db.sql(
        """update `tabPayment Entry` set advance_reconciliation_takes_effect_on = if(reconcile_on_advance_payment_date = 0, 'Oldest Of Invoice Or Advance', 'Advance Payment Date')"""
    )
