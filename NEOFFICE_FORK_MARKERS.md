<!-- //// Neoffice — added file (no upstream equivalent). -->

# Neoffice fork markers — files that cannot carry a `//// Neoffice` comment

Every Neoffice change to this fork carries an inline `//// Neoffice` marker stating the reason,
so that `grep -rn "////"` maps our whole divergence from upstream before a merge.

Some file formats **cannot hold a comment**: DocType / Page JSON, `.po` catalogues, images.
Their divergence is recorded here instead. Baseline for every comparison below:
`git diff v15.89.0 origin/version-15 -- <file>` (`v15.89.0` = `d8dab986fa`, the exact merge base
between `origin/version-15` and upstream).

---

## Lot E1 — erpnext

Editable files of lot E1 (53 source files) are marked in place. This section lists the **JSON**
divergence in the same areas — `accounts/doctype`, `selling/doctype`, `selling/page`,
`stock/doctype`, `projects/doctype`, `stock/page` — with the fieldnames, so the fields can be
converted to Custom Fields / Property Setters (neoffice-maintenance #138).

Three kinds of change appear, and they do **not** convert the same way:

| kind | how to remove it from the fork |
|---|---|
| **A. Added field** — a field upstream does not have | **Custom Field** (fixture) |
| **B. Modified property** of an upstream field (`columns`, `in_list_view`, `label`, `reqd`, `options`…) | **Property Setter** (fixture) |
| **C. Modified top-level DocType property** (`restrict_to_domain`, `read_only`, `permissions`…) | Property Setter, or drop it |

### A. Added fields and added DocTypes — become Custom Fields

#### `erpnext/accounts/doctype/shipping_rule/shipping_rule.json`
Commits: `5bb3903da1` (2025-03-13 *Advanced Shipping Rule with Multiple Constraints*),
`a50104af31` (2025-04-05 *Fix bug shipping*).
Feature documented in `shipping_rule.py` (marked there).

| fieldname | fieldtype | options | insert_after | notes |
|---|---|---|---|---|
| `taxable_account` | Link | `Item Tax Template` | `account` | description *"If not defined, it will not add tax"* |
| `tax_is_included` | Check | — | `taxable_account` | `default 0`, `depends_on eval:doc.taxable_account ? true : false` |
| `show_constraint_group` | Check | — | `calculate_based_on` | `default 1`, `depends_on eval:doc.calculate_based_on==='Multiple Constraints'` |
| `shipping_rule_conditions_multiple_constraints_section` | Section Break | — | `conditions` | label *Configuration Multiple Constraints*, same `depends_on` |
| `weight_uom` | Link | `UOM` | `…_section` | same `depends_on` |
| `column_break_umar` | Column Break | — | `weight_uom` | |
| `dimensions_uom` | Link | `UOM` | `column_break_umar` | same `depends_on` |
| `section_break_vgym` | Section Break | — | `dimensions_uom` | same `depends_on` |
| `condition_multiple_constraints` | Table | `Shipping Rule Condition Multiple Constraints` | `section_break_vgym` | same `depends_on` |

Modified upstream fields in the same file (kind B):
- `calculate_based_on` (Select) `options`: `Fixed\nNet Total\nNet Weight` → `… \nMultiple Constraints`
- `rule_conditions_section` `depends_on`: `eval:doc.calculate_based_on!=='Fixed'` → `… && doc.calculate_based_on!=='Multiple Constraints'`
- `conditions` `depends_on`: none → `eval:doc.calculate_based_on!=='Fixed' && doc.calculate_based_on!=='Multiple Constraints'`
- top-level: `engine InnoDB`, `naming_rule "By fieldname"`, `sort_field modified`, `links/states/actions []`

#### `erpnext/accounts/doctype/shipping_rule_condition_multiple_constraints/…json` — **added DocType**
Commit `5bb3903da1`. Child table (`istable: 1`), module `Accounts`,
description *"A condition for a Shipping Rule"*. Its `.py` and `__init__.py` are marked in place.

| fieldname | fieldtype | options | flags |
|---|---|---|---|
| `condition_group` | Data | — | `in_list_view 1`, `reqd 1` |
| `constraint_type` | Select | `Weight\nPrice\nLength\nWidth\nHeight` | `in_list_view 1`, `reqd 1` |
| `min_value` | Float | — | `in_list_view 1`, `reqd 1` |
| `max_value` | Float | — | `in_list_view 1`, `reqd 1` |
| `shipping_amount` | Currency | `Company:company:default_currency` | `in_list_view 1`, `reqd 1` |

#### `erpnext/stock/doctype/item/item.json`
Commit `5bb3903da1` — the parcel dimensions the Multiple-Constraints shipping mode packs with.

| fieldname | fieldtype | options | insert_after | depends_on |
|---|---|---|---|---|
| `column_break_nscp` | Column Break | — | `allow_negative_stock` | — |
| `length` | Float | — | `column_break_nscp` | `is_stock_item` |
| `width` | Float | — | `length` | `is_stock_item` |
| `height` | Float | — | `width` | `is_stock_item` |
| `dimensions_uom` | Link | `UOM` | `height` | `is_stock_item` |

Labels: *Length / Width / Height Per Unit*, *Dimensions UOM*.
Modified in the same file (kind B): `item_name.in_list_view 1`, `is_stock_item.in_list_view 1`,
`brand.columns 2 / in_list_view 1 / in_standard_filter 1` (`c698bb59d3`).

> **Not in the JSON but part of the same divergence**: `Purchase Invoice.is_proposed`,
> `Purchase Invoice.supplier_group`, `Sales Invoice / Subscription.customer_reference`,
> `Account.tax_code`, `Item Group.pos_color`, `POS Profile.disable_auto_price` /
> `cloudprnt_printer` / `cloudprnt_printer_name` are **already Custom Fields** — the fork code
> reads them (markers in `purchase_invoice.py`, `subscription.py`, `account.js`,
> `pos_item_selector.js`, `pos_past_order_summary.js`, `pos_payment.js`). They are listed here
> because a fresh site without those fixtures makes that code raise.

### B. Modified properties of upstream fields — become Property Setters

#### Status option added (feature, not layout)
- `accounts/doctype/purchase_invoice/purchase_invoice.json` — `status` (Select) `options` gains
  `In Payment Run` (`e84ce61bd4`, 2025-11-28). Paired with the `DF.Literal` and `set_status()`
  changes marked in `purchase_invoice.py` and the colour in `purchase_invoice_list.js`.
  Same file, `e8aaf3e9d7` (2026-02-02): `section_break_44.collapsible 1 → 0`;
  `33e5705d01`: `payments_section.depends_on` dropped; `title/due_date/outstanding_amount.in_list_view 1`.

#### Mandatory / label changes
- `selling/doctype/customer/customer.json` — `default_currency.reqd → 1` (`1c3c1a2693`, 2023-11-27).
  **This is the fork behaviour** that `Customer.validate` compensates for (marked in `customer.py`,
  fixed by `ecdec25916`). Converting it to a Property Setter must keep that default in step.
- `accounts/doctype/subscription/subscription.json` (`f032a768e2`) — `current_invoice_start.label`
  *Current Invoice Start Date* → *Next Invoice Start Date*; `current_invoice_end.label` likewise;
  both `in_list_view 1`.
- `projects/doctype/task/task.json` (`f032a768e2`) — `description.reqd → 1`,
  `is_group.allow_in_quick_entry 1`, `is_template.allow_in_quick_entry 1`.

#### Grid / list layout — the `feat(columns)` series
A single campaign (author *NeoService*, 2026-03-18 → 2026-04-05: `c698bb59d3`, `cf3da8f419`,
`29112ba97d`, `d07483bfa5`, `901fc34b28`, `098c02b1dc`, `790f5661a5`, `af88bb5415`, `f57e231dca`,
`81a102ac4e`, `ae3358153a`, `65df17f92d`; plus `41a38943a2`, `2654f7c1d4`, `e29bd93fed`) applied
the column widths configured on Osiris to the DocType JSON. **Every one of these is `columns` /
`in_list_view` only** — pure Property Setter material, and the largest single source of JSON
conflict at the merge.

| file | fields touched (`columns` / `in_list_view`) |
|---|---|
| `accounts/doctype/journal_entry/journal_entry.json` | `title`, `posting_date`, `cheque_no`, `user_remark`, `remark` |
| `accounts/doctype/journal_entry_account/journal_entry_account.json` | `account`, `party_type`, `debit_in_account_currency`, `credit_in_account_currency`, `reference_name`, `user_remark` |
| `accounts/doctype/journal_entry_template/journal_entry_template.json` | `template_title` |
| `accounts/doctype/loyalty_program_collection/loyalty_program_collection.json` | `min_spent` |
| `accounts/doctype/mode_of_payment/mode_of_payment.json` | `type` |
| `accounts/doctype/payment_entry/payment_entry.json` | `paid_amount` |
| `accounts/doctype/payment_term/payment_term.json` | `payment_term_name`, `mode_of_payment` |
| `accounts/doctype/purchase_invoice_item/purchase_invoice_item.json` | `item_code`, `description`, `qty`, `uom`, `rate`, `amount`, `item_tax_template`, `expense_account` |
| `accounts/doctype/purchase_taxes_and_charges/purchase_taxes_and_charges.json` | `charge_type`, `included_in_print_rate`, `account_head`, `rate` |
| `accounts/doctype/sales_invoice/sales_invoice.json` | `title`, `posting_date`, `rounded_total`, `section_break_49` |
| `accounts/doctype/sales_invoice_item/sales_invoice_item.json` | `item_code`, `description_section`, `description`, `qty`, `uom`, `price_list_rate`, `discount_percentage`, `discount_amount`, `rate`, `amount`, `warehouse` |
| `accounts/doctype/sales_taxes_and_charges/sales_taxes_and_charges.json` | `charge_type`, `account_head`, `included_in_print_rate`, `rate` |
| `selling/doctype/quotation/quotation.json` | `title` |
| `selling/doctype/quotation_item/quotation_item.json` | `item_code`, `section_break_5`, `description`, `image` (`fetch_from` dropped), `qty`, `uom`, `price_list_rate`, `discount_percentage`, `discount_amount`, `rate`, `amount` |
| `selling/doctype/sales_order/sales_order.json` | `customer_name` |
| `selling/doctype/sales_order_item/sales_order_item.json` | `item_code`, `delivery_date`, `section_break_5`, `description`, `stock_uom`, `uom`, `price_list_rate`, `discount_percentage`, `discount_amount`, `rate`, `amount`, `warehouse`; top-level `row_format Dynamic` |
| `stock/doctype/delivery_note_item/delivery_note_item.json` | `item_code`, `section_break_6`, `description`, `qty`, `uom`, `price_list_rate`, `discount_percentage`, `discount_amount`, `rate`, `amount`, `warehouse` |
| `stock/doctype/item_default/item_default.json` | `company`, `default_warehouse`, `default_price_list`, `expense_account`, `income_account` |
| `stock/doctype/item_supplier/item_supplier.json` | `supplier`, `supplier_part_no` |
| `stock/doctype/item_tax/item_tax.json` | `item_tax_template`, `tax_category`, `valid_from`, `minimum_net_rate`, `maximum_net_rate` |

### C. Top-level DocType properties

- **`restrict_to_domain: "Gestion"`** added to `accounts/doctype/account`,
  `accounts/doctype/journal_entry`, `accounts/doctype/loyalty_point_entry`,
  `projects/doctype/task`, `stock/doctype/stock_ledger_entry`,
  `selling/page/sales_funnel`, `stock/page/stock_balance`,
  `stock/page/warehouse_capacity_summary` (`f032a768e2` / `da71070613`).
  **TO REVIEW**: a Domain named *Gestion* — a French word — gates these doctypes and pages. No
  commit explains it; if the Domain does not exist on a site, upstream hides the doctype.
- `accounts/doctype/journal_entry.json` and `stock/doctype/stock_ledger_entry.json`:
  top-level `read_only: 1` (upstream: unset).
- `accounts/doctype/loyalty_point_entry.json` and `stock/doctype/stock_ledger_entry.json`:
  `permissions` rewritten (`da71070613`, 2023-11-15 *updates for v15*; no rationale — **TO REVIEW**,
  a permission change is exactly what must not diverge silently).
- `stock/page/warehouse_capacity_summary.json`: `page_name` *Warehouse Capacity Summary* →
  `warehouse-capacity-summary`; `selling/page/sales_funnel.json` and `stock/page/stock_balance.json`:
  `system_page: 0` and a rewritten `creation`.

### Defects found while inventorying

- `accounts/doctype/purchase_invoice_item/purchase_invoice_item.json` — `field_order` contains
  `column_break_ulom`, which **has no field definition**. A dangling `field_order` entry; harmless
  today, but it will not survive a strict validation.
- `selling/doctype/customer/test_records.json` (`b7c85d6065`, 2026-09-01) is a fixture, not a
  DocType: the test customers were given a currency because `default_currency` is `reqd` on our
  Customer (see above).

---

*Written by the `//// Neoffice` marking campaign, lot E1 (neoffice-maintenance #138).*
