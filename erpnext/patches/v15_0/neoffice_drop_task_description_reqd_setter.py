#//// Neoffice — added file (no upstream equivalent). Task.description was made mandatory in
#//// 2026-02 twice over: `reqd: 1` in task.json (reverted to upstream on 2026-09-04, tracker #207)
#//// and a system-generated Property Setter `Task-description-reqd` found on every site checked
#//// (osiris 2026-02-03, hub 2026-02-18). This drops the setter so the revert is effective.
#//// A setter created through Customize Form carries is_system_generated=0 and is left alone.
import frappe


def execute():
	name = "Task-description-reqd"
	if not frappe.db.exists("Property Setter", name):
		return
	if not frappe.db.get_value("Property Setter", name, "is_system_generated"):
		return
	frappe.delete_doc("Property Setter", name, ignore_permissions=True, force=True)
	frappe.clear_cache(doctype="Task")
