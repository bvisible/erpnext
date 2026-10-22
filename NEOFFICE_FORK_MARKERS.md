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
- `erpnext/accounts/doctype/purchase_invoice/purchase_invoice.json` — `status` (Select) `options` gains
  `In Payment Run` (`e84ce61bd4`, 2025-11-28). Paired with the `DF.Literal` and `set_status()`
  changes marked in `purchase_invoice.py` and the colour in `purchase_invoice_list.js`.
  Same file, `e8aaf3e9d7` (2026-02-02): `section_break_44.collapsible 1 → 0`;
  `33e5705d01`: `payments_section.depends_on` dropped; `title/due_date/outstanding_amount.in_list_view 1`.

#### Mandatory / label changes
- `erpnext/selling/doctype/customer/customer.json` — `default_currency.reqd → 1` (`1c3c1a2693`, 2023-11-27).
  **This is the fork behaviour** that `Customer.validate` compensates for (marked in `customer.py`,
  fixed by `ecdec25916`). Converting it to a Property Setter must keep that default in step.
- `erpnext/accounts/doctype/subscription/subscription.json` (`f032a768e2`) — `current_invoice_start.label`
  *Current Invoice Start Date* → *Next Invoice Start Date*; `current_invoice_end.label` likewise;
  both `in_list_view 1`.
- `erpnext/projects/doctype/task/task.json` (`f032a768e2`) — `is_group.allow_in_quick_entry 1`,
  `is_template.allow_in_quick_entry 1`. It also carried `description.reqd → 1`, **reverted to
  upstream on 2026-09-04** (#207): upstream lets a Task exist with a title and no body, and making
  the description mandatory refused every quick entry, every scripted insert and every Task created
  from a template that had none. Nothing left to reconcile for that property at the merge.

#### Grid / list layout — the `feat(columns)` series
A single campaign (author *NeoService*, 2026-03-18 → 2026-04-05: `c698bb59d3`, `cf3da8f419`,
`29112ba97d`, `d07483bfa5`, `901fc34b28`, `098c02b1dc`, `790f5661a5`, `af88bb5415`, `f57e231dca`,
`81a102ac4e`, `ae3358153a`, `65df17f92d`; plus `41a38943a2`, `2654f7c1d4`, `e29bd93fed`) applied
the column widths configured on Osiris to the DocType JSON. **Every one of these is `columns` /
`in_list_view` only** — pure Property Setter material, and the largest single source of JSON
conflict at the merge.

| file | fields touched (`columns` / `in_list_view`) |
|---|---|
| `erpnext/accounts/doctype/journal_entry/journal_entry.json` | `title`, `posting_date`, `cheque_no`, `user_remark`, `remark` |
| `erpnext/accounts/doctype/journal_entry_account/journal_entry_account.json` | `account`, `party_type`, `debit_in_account_currency`, `credit_in_account_currency`, `reference_name`, `user_remark` |
| `erpnext/accounts/doctype/journal_entry_template/journal_entry_template.json` | `template_title` |
| `erpnext/accounts/doctype/loyalty_program_collection/loyalty_program_collection.json` | `min_spent` |
| `erpnext/accounts/doctype/mode_of_payment/mode_of_payment.json` | `type` |
| `erpnext/accounts/doctype/payment_entry/payment_entry.json` | `paid_amount` |
| `erpnext/accounts/doctype/payment_term/payment_term.json` | `payment_term_name`, `mode_of_payment` |
| `erpnext/accounts/doctype/purchase_invoice_item/purchase_invoice_item.json` | `item_code`, `description`, `qty`, `uom`, `rate`, `amount`, `item_tax_template`, `expense_account` |
| `erpnext/accounts/doctype/purchase_taxes_and_charges/purchase_taxes_and_charges.json` | `charge_type`, `included_in_print_rate`, `account_head`, `rate` |
| `erpnext/accounts/doctype/sales_invoice/sales_invoice.json` | `title`, `posting_date`, `rounded_total`, `section_break_49` |
| `erpnext/accounts/doctype/sales_invoice_item/sales_invoice_item.json` | `item_code`, `description_section`, `description`, `qty`, `uom`, `price_list_rate`, `discount_percentage`, `discount_amount`, `rate`, `amount`, `warehouse` |
| `erpnext/accounts/doctype/sales_taxes_and_charges/sales_taxes_and_charges.json` | `charge_type`, `account_head`, `included_in_print_rate`, `rate` |
| `erpnext/selling/doctype/quotation/quotation.json` | `title` |
| `erpnext/selling/doctype/quotation_item/quotation_item.json` | `item_code`, `section_break_5`, `description`, `image` (`fetch_from` dropped), `qty`, `uom`, `price_list_rate`, `discount_percentage`, `discount_amount`, `rate`, `amount` |
| `erpnext/selling/doctype/sales_order/sales_order.json` | `customer_name` |
| `erpnext/selling/doctype/sales_order_item/sales_order_item.json` | `item_code`, `delivery_date`, `section_break_5`, `description`, `stock_uom`, `uom`, `price_list_rate`, `discount_percentage`, `discount_amount`, `rate`, `amount`, `warehouse`; top-level `row_format Dynamic` |
| `erpnext/stock/doctype/delivery_note_item/delivery_note_item.json` | `item_code`, `section_break_6`, `description`, `qty`, `uom`, `price_list_rate`, `discount_percentage`, `discount_amount`, `rate`, `amount`, `warehouse` |
| `erpnext/stock/doctype/item_default/item_default.json` | `company`, `default_warehouse`, `default_price_list`, `expense_account`, `income_account` |
| `erpnext/stock/doctype/item_supplier/item_supplier.json` | `supplier`, `supplier_part_no` |
| `erpnext/stock/doctype/item_tax/item_tax.json` | `item_tax_template`, `tax_category`, `valid_from`, `minimum_net_rate`, `maximum_net_rate` |

### C. Top-level DocType properties

- **`restrict_to_domain: "Gestion"`** added to `accounts/doctype/account`,
  `accounts/doctype/journal_entry`, `accounts/doctype/loyalty_point_entry`,
  `projects/doctype/task`, `stock/doctype/stock_ledger_entry`,
  `selling/page/sales_funnel`, `stock/page/stock_balance`,
  `stock/page/warehouse_capacity_summary` (`f032a768e2` / `da71070613`).
  **TO REVIEW**: a Domain named *Gestion* — a French word — gates these doctypes and pages. No
  commit explains it; if the Domain does not exist on a site, upstream hides the doctype.
- `erpnext/accounts/doctype/journal_entry/journal_entry.json` and `stock/doctype/stock_ledger_entry.json`:
  top-level `read_only: 1` (upstream: unset).
- `erpnext/accounts/doctype/loyalty_point_entry/loyalty_point_entry.json` and `stock/doctype/stock_ledger_entry.json`:
  `permissions` rewritten (`da71070613`, 2023-11-15 *updates for v15*; no rationale — **TO REVIEW**,
  a permission change is exactly what must not diverge silently).
- `erpnext/stock/page/warehouse_capacity_summary/warehouse_capacity_summary.json`: `page_name` *Warehouse Capacity Summary* →
  `warehouse-capacity-summary`; `selling/page/sales_funnel.json` and `stock/page/stock_balance.json`:
  `system_page: 0` and a rewritten `creation`.

### Defects found while inventorying

- `erpnext/accounts/doctype/purchase_invoice_item/purchase_invoice_item.json` — `field_order` contains
  `column_break_ulom`, which **has no field definition**. A dangling `field_order` entry; harmless
  today, but it will not survive a strict validation.
- `erpnext/selling/doctype/customer/test_records.json` (`b7c85d6065`, 2026-09-01) is a fixture, not a
  DocType: the test customers were given a currency because `default_currency` is `reqd` on our
  Customer (see above).

---

## i18n — JSON records whose text was never passed through `_()`

JSON cannot hold a comment, so these two edits are recorded here (the Python / JS / HTML hunks of the same
campaign carry their own inline `//// Neoffice` marker).

- `erpnext/accounts/notification/notification_for_new_fiscal_year/notification_for_new_fiscal_year.json` —
  `subject` was the English text `Notification for new fiscal year {{ doc.name }}`; upstream renders the
  body through `_()` but not the subject, so the e-mail subject stayed English. We wrap the caption in
  `{{ _("Notification for new fiscal year") }}`.
- `erpnext/accounts/print_format/cheque_printing_format/cheque_printing_format.json` — in the `html` value,
  the captions `Prepared By`, `Authorised Signatory`, `Received Payment as Above` and `A/C Payee` were static
  English text; we wrap them in `{{ _("…") }}`. The template also carries a Jinja `{#- //// Neoffice … -#}`
  comment at its start (never rendered).

---

## Auto-marked (fork-markers workflow)

- `erpnext/setup/workspace/setup/setup.json` — removed the "Terminal Setup" link (payment-terminal
  card, pointed at Page `terminal-setup`) — that page has never existed in this repository so the
  link was a dead end since it was introduced by `fe317f8402`; `payment-terminal-wizard`, right
  after it in the same card, already does that job (`e993714031` "fix(workspace): Setup linked to a
  page that has never existed").
- `erpnext/setup/workspace/home/home.json` — reverted the draft-orders count number card and the
  Document Scan shortcut (in place of Videoconference) that `5b2e5a0ab2` had added — Home stays
  sourced from the hub like every other workspace; keeping the JSON change would have given Home
  two sources and a migrate re-import racing the hub sync (`c54de4b231` "Revert \"feat(home): count
  draft orders, Document Scan instead of Videoconference\"").
- `erpnext/buying/print_format/drop_shipping_format/drop_shipping_format.json` — in the `html` value (a Jinja template) each of the 20 printed labels (Purchase Order, Supplier Name, Address, Contact, Mobile No, Date, Customer Name, Customer Address, Customer Contact, Customer Mobile No, Sr, Item Name, Description, Qty, Rate, Amount, Item Code, Total, Grand Total, In Words) is wrapped in `_()`, the value opens with a Jinja `{# //// Neoffice … #}` comment (never rendered), and `modified` is bumped to `2026-10-04 12:00:00` — upstream wrote these labels as static English text, so the print ignored the print language; the values and the Jinja logic are untouched (62ee4e47e1 "fix(i18n): translate buying messages composed or injected before _()").
- `erpnext/accounts/workspace/receivables/receivables.json` — removed the legacy "Import payment entries" links (page `bankimport` of erpnextswiss) from the Quick Access / Menu content and the `links` array — bank files are imported through Mint (Bank Statement Import: CAMT 053/054, CSV, Excel, EBICS), not through the legacy erpnextswiss page, so the links were a dead end for new users (f250b80d1e "fix(workspaces): drop the legacy « Import payment entries » links (page bankimport of erpnextswiss) from Accounting and Receivables"). The page `bankimport` itself is untouched.

---

*Written by the `//// Neoffice` marking campaign, lot E1 (neoffice-maintenance #138).*

### English msgids instead of French source strings (2026-10-04)

House rule: the source text of a translatable string is English; the French lives in the
catalogue and the French screen is unchanged. JSON and `.po` files cannot carry a comment, so
those edits are recorded here (the code edits are marked in place with `//// Neoffice`).

- `erpnext/accounts/workspace/accounting/accounting.json` — the link label `Transaction bancaire` is now `Bank Transaction` (the French is served by the catalogue, same words).
- `erpnext/locale/fr.po` — 2 entries (the VAT-lines button, the POS viewer sign-up button) renamed to their English msgid. The JS and HTML that call them are marked in place.
- Left as they are on purpose: the chart and number-card labels of the Neoffice workspaces (`Paiements du Mois`, `CA du Mois`…) are the names of Dashboard Chart / Number Card records, i.e. data; `Bank transferts` (a mixed-language card break) would change the French screen if corrected; and the POS viewer thank-you title (`www/pos-viewer/index.js`), a French literal on a page that has no JS catalogue, would show English twice.

---

## Merge with upstream v15.124.1 (2026-10-22)

`fork_markers.py check --base v15.124.1 --head HEAD --upstream-base v15.124.1` answers 0 unmarked hunks.
Nothing is added to the list below, except what the merge settled in files that cannot carry a comment:

- `erpnext/locale/fr.po`, `erpnext/locale/main.pot`: upstream migrated its CSV catalogues to PO (`ba0f3c68f3`), so
  both sides added the file. Upstream's text is the frame (header, order, new strings); our French wins wherever
  it is not empty and differs (1 980 entries: « société », Neoffice's wording), upstream's wins where ours is
  empty (8), and the 768 entries only we have stay at the end. No HTML entity in any msgstr.
- `erpnext/translations/*.csv`: deleted by upstream, `fr.csv` included (it was the only one we had touched, by one
  entry which the PO already carries).
- `erpnext/selling/doctype/sales_order_item/sales_order_item.json`: upstream's file (new field
  `mapped_additional_discount_amount`) with our column / list view properties reapplied by property, and `row_format`.

## Merge with upstream v15.123.0 — the files without comment syntax that were never listed (2026-10-20)

Inventoried at the merge of upstream `version-15` v15.123.0 (`e864addb6c`), when `fork_markers.py check
--base e864addb6c --head HEAD --upstream-base e864addb6c` was taken to 0 for the first time. Each entry says
what differs from upstream v15.123.0 and which of our commits did it. Most come from `f032a768e2` ("last
updates", 2024-09-23) and `da71070613` ("updates for v15", 2023-11-15), which give no reason beyond their
subject: the Neoffice workspaces (icons, charts, number cards, links, `restrict_to_domain: "Gestion"`), the
form tours re-saved from the desk, the module onboardings pointed at `neoffice.io/help`, and the column
layout of child tables. They are listed so that the next merge sees them, not because each is still wanted:
the workspaces are synced from the hub, and a JSON change that the hub overrides is a candidate for removal.

- `erpnext/accounts/doctype/account/account.json` — restrict_to_domain null→"Gestion". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/accounts/doctype/shipping_rule_condition_multiple_constraints/shipping_rule_condition_multiple_constraints.json` — added file (no upstream equivalent). Commits: 5bb3903da1 (2025-03-13, "Advanced Shipping Rule with Multiple Constraints (Dimensions, Weight, ").
- `erpnext/accounts/form_tour/accounts_settings/accounts_settings.json` — first_document null→0; include_name_field null→0; list_name null→"List"; new_document_form null→0; steps (edited); track_steps null→0; ui_tour null→0; view_name null→"Workspaces". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/accounts/form_tour/purchase_invoice/purchase_invoice.json` — first_document null→0; include_name_field null→0; list_name null→"List"; new_document_form null→0; steps (edited); track_steps null→0; ui_tour null→0; view_name null→"Workspaces". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/accounts/form_tour/sales_invoice/sales_invoice.json` — list_name null→"List"; new_document_form null→0; steps (edited); track_steps null→0; ui_tour null→0; view_name null→"Workspaces". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/accounts/form_tour/sales_taxes_and_charges_template/sales_taxes_and_charges_template.json` — list_name null→"List"; new_document_form null→0; steps (edited); track_steps null→0; ui_tour null→0; view_name null→"Workspaces". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/accounts/module_onboarding/accounts/accounts.json` — documentation_url "https://docs.erpnext.com/docs/user/m…→"neoffice.io/help". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/accounts/property_setter/journal_entry_template_accounts_hidden/journal_entry_template_accounts_hidden.json` — added file (no upstream equivalent). Commits: fdba5ee235 (2026-02-22, "fix: Cacher le champ 'Écritures Comptables' dans Journal Entry Templat").
- `erpnext/accounts/workspace/assets/assets.json` — added file (no upstream equivalent). Commits: fe317f8402 (2026-06-12, "feat(workspaces): Neoffice workspace layouts — Quick Access shortcuts,").
- `erpnext/accounts/workspace/bank_and_config/bank_and_config.json` — added file (no upstream equivalent). Commits: fe317f8402 (2026-06-12, "feat(workspaces): Neoffice workspace layouts — Quick Access shortcuts,").
- `erpnext/accounts/workspace/fiduciary/fiduciary.json` — added file (no upstream equivalent). Commits: fe317f8402 (2026-06-12, "feat(workspaces): Neoffice workspace layouts — Quick Access shortcuts,").
- `erpnext/accounts/workspace/financial_reports/financial_reports.json` — charts +Evolution Paiements; content (layout) edited; icon "file"→"lucide-trending-up"; links +General Ledgers, VAT Reports, VAT Declaration, VAT reconciliation, VAT Report, Sales Partner… −Ledgers, UAE VAT 201; number_cards +Paiements du Mois, Paiements Annuels, Ecritures Comptables, Créances Ouvertes, Dettes Ouvertes; parent_page "Accounting"→null; sequence_id 5.0→6.0. Commits: fe317f8402 (2026-06-12, "feat(workspaces): Neoffice workspace layouts — Quick Access shortcuts,").
- `erpnext/assets/form_tour/asset/asset.json` — first_document null→0; include_name_field null→0; list_name null→"List"; new_document_form null→0; steps (edited); track_steps null→0; ui_tour null→0; view_name null→"Workspaces". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/assets/form_tour/asset_category/asset_category.json` — first_document null→0; include_name_field null→0; list_name null→"List"; new_document_form null→0; steps (edited); track_steps null→0; ui_tour null→0; view_name null→"Workspaces". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/assets/module_onboarding/assets/assets.json` — documentation_url "https://docs.erpnext.com/docs/user/m…→"neoffice.io/help". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/assets/workspace/assets/assets.json` — charts −Asset Value Analytics; content (layout) edited; restrict_to_domain ""→"Gestion". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/buying/doctype/purchase_order_item/purchase_order_item.json` — `item_code`: columns 2→1; `schedule_date`: columns 2→1; `description`: columns null→2; in_list_view null→1; `rate`: columns 2→1; `amount`: columns 2→1; `warehouse`: columns null→1; `item_tax_template`: columns null→1; in_list_view null→1. Commits: 71aba4c309 (2026-03-19, "feat(columns): update Purchase Order Item column config from Osiris UI"); e513c024eb (2023-11-01, "Update purchase_order_item.json").
- `erpnext/buying/form_tour/buying_settings/buying_settings.json` — first_document null→0; include_name_field null→0; list_name null→"List"; new_document_form null→0; steps (edited); track_steps null→0; ui_tour null→0; view_name null→"Workspaces". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/buying/form_tour/purchase_order/purchase_order.json` — first_document null→0; include_name_field null→0; list_name null→"List"; new_document_form null→0; steps (edited); track_steps null→0; ui_tour null→0; view_name null→"Workspaces". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/buying/module_onboarding/buying/buying.json` — documentation_url "https://docs.erpnext.com/docs/user/m…→"neoffice.io/help". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/buying/workspace/buying/buying.json` — charts +Evolution Achats, Top 10 Fournisseurs par Achats −Purchase Order Trends; content (layout) edited; icon "buying"→"lucide-shopping-cart"; indicator_color null→"green"; links +Suppliers, Documents, Purchase Receipt, Expenses Receipt −Buying, Material Request, Items & Pricing, Item, Item Price, Price List…; number_cards +Achats du Mois, Achats Annuels, Fournisseurs Actifs, Factures Fournisseurs Impayées; parent_page ""→null; quick_lists +Open Purchase Order, Open Purchase Invoice; restrict_to_domain ""→"Gestion"; sequence_id 5.0→11.0; shortcuts +Supplier, Purchase Invoice, Purchase Receipt −Learn Procurement. Commits: fe317f8402 (2026-06-12, "feat(workspaces): Neoffice workspace layouts — Quick Access shortcuts,"); f032a768e2 (2024-09-23, "last updates").
- `erpnext/crm/module_onboarding/crm/crm.json` — documentation_url "https://docs.erpnext.com/docs/user/m…→"neoffice.io/help". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/crm/workspace/crm/crm.json` — charts −Territory Wise Sales; content (layout) edited; links −Reports, Lead Details, Sales Pipeline Analytics, Opportunity Summary by Sales Stage, Sales Funnel, Prospects Engaged But Not Converted…; restrict_to_domain ""→"Gestion"; sequence_id 17.0→24.0; shortcuts −Lead, Opportunity, Customer, Sales Analytics, Dashboard. Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/erpnext_integrations/workspace/erpnext_integrations/erpnext_integrations.json` — content (layout) edited; restrict_to_domain ""→"Gestion"; sequence_id 21.0→65.0; shortcuts −Browse Apps. Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/manufacturing/doctype/blanket_order_item/blanket_order_item.json` — `item_name`: in_list_view null→1. Commits: a7f1f49d45 (2023-11-01, "Update blanket_order_item.json").
- `erpnext/manufacturing/module_onboarding/manufacturing/manufacturing.json` — documentation_url "https://docs.erpnext.com/docs/user/m…→"neoffice.io/help". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/manufacturing/workspace/manufacturing/manufacturing.json` — parent_page ""→"Stock"; restrict_to_domain ""→"Manufacturing". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/projects/workspace/projects/projects.json` — charts −Open Projects; content (layout) edited; links −Projects, Project, Task, Project Template, Project Type, Project Update…; restrict_to_domain ""→"Gestion". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/public/images/erpnext-logo-blue.png` — the Neoffice logo in place of ERPNext's (the desk, the apps screen and the login page show our brand). Commits: 87c0015127 (2025-03-17, "Change icon").
- `erpnext/public/images/erpnext-logo.png` — the Neoffice logo in place of ERPNext's (the desk, the apps screen and the login page show our brand). Commits: 87c0015127 (2025-03-17, "Change icon").
- `erpnext/public/js/point-of-sale.bundle.js` — the same eight imports in another order (pos_controller.js first, pos_payment.js last); the reason is written in the file itself, whose `.bundle.js` extension the check classes as having no comments. Commits: da71070613 (2023-11-15, "updates for v15"); a5f79d75b3 (2025-02-26, "update neov2").
- `erpnext/quality_management/workspace/quality/quality.json` — content (layout) edited; links −Goal and Procedure, Quality Goal, Quality Procedure, Tree of Procedures, Feedback, Quality Feedback…; parent_page ""→"CRM"; restrict_to_domain ""→"Gestion"; sequence_id 9.0→28.0; shortcuts −Quality Goal, Quality Procedure, Quality Inspection, Quality Review, Quality Action, Non Conformance. Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/selling/form_tour/customer/customer.json` — first_document null→0; include_name_field null→0; list_name null→"List"; new_document_form null→0; steps (edited); track_steps null→0; ui_tour null→0; view_name null→"Workspaces". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/selling/form_tour/quotation/quotation.json` — list_name null→"List"; new_document_form null→0; steps (edited); track_steps null→0; ui_tour null→0; view_name null→"Workspaces". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/selling/form_tour/sales_order/sales_order.json` — first_document null→0; include_name_field null→0; list_name null→"List"; new_document_form null→0; steps (edited); track_steps null→0; ui_tour null→0; view_name null→"Workspaces". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/selling/form_tour/selling_settings/selling_settings.json` — first_document null→0; include_name_field null→0; list_name null→"List"; new_document_form null→0; steps (edited); track_steps null→0; ui_tour null→0; view_name null→"Workspaces". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/selling/module_onboarding/selling/selling.json` — documentation_url "https://docs.erpnext.com/docs/user/m…→"neoffice.io/help". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/selling/page/sales_funnel/sales_funnel.json` — restrict_to_domain null→"Gestion"; system_page null→0. Commits: da71070613 (2023-11-15, "updates for v15").
- `erpnext/selling/workspace/selling/selling.json` — charts +Evolution CA (Ventes), Pipeline Devis par Statut, Top 10 Clients par CA, CA par Categorie −Sales Order Trends; content (layout) edited; icon "sell"→"lucide-tag"; idx 0→5; indicator_color null→"green"; links +Terms and Conditions, Payment Terms Template, Payment Term, Mode of Payment, Sales Partner Type, Documents… −Selling, Blanket Order, Items and Pricing, Item Price, Price List, Item Group…; number_cards +CA du Mois, CA Annuel, Panier Moyen, Clients Actifs, Devis en Cours, Commandes en Cours; parent_page ""→null; restrict_to_domain ""→"Gestion"; sequence_id 6.0→1.0; shortcuts +Sales Invoice, Subscription, Quotation, Delivery Note, To Do −Learn Sales Management, Sales Analytics; type "Workspace"→null. Commits: fe317f8402 (2026-06-12, "feat(workspaces): Neoffice workspace layouts — Quick Access shortcuts,"); a5f79d75b3 (2025-02-26, "update neov2"); f032a768e2 (2024-09-23, "last updates").
- `erpnext/setup/doctype/company/company.json` — `enable_perpetual_inventory`: hidden null→1; `enable_provisional_accounting_for_non_stock_items`: hidden null→1. Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/setup/form_tour/company/company.json` — list_name null→"List"; new_document_form null→0; steps (edited); track_steps null→0; ui_tour null→0; view_name null→"Workspaces". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/setup/module_onboarding/home/home.json` — documentation_url "https://docs.erpnext.com/docs/v14/us…→"neoffice.io/help". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/setup/workspace/erpnext_settings/erpnext_settings.json` — links −Import Data, Export Data, Bulk Update, Download Backups, Deleted Documents, Email / Notifications…; restrict_to_domain ""→"Gestion"; sequence_id 19.0→64.0; shortcuts −Print Settings, System Settings, Accounts Settings, Global Defaults, Stock Settings, Selling Settings…. Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/stock/doctype/serial_and_batch_entry/serial_and_batch_entry.json` — `serial_no`: in_global_search null→1; `batch_no`: in_global_search null→1. Commits: da71070613 (2023-11-15, "updates for v15").
- `erpnext/stock/doctype/stock_ledger_entry/stock_ledger_entry.json` — permissions [{"export": 1, "print": 1, "read": 1,…→[{"export": 1, "print": 1, "read": 1,…; read_only null→1; restrict_to_domain null→"Gestion". Commits: da71070613 (2023-11-15, "updates for v15").
- `erpnext/stock/form_tour/item/item.json` — list_name null→"List"; new_document_form null→0; steps (edited); track_steps null→0; ui_tour null→0; view_name null→"Workspaces". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/stock/form_tour/item_general/item_general.json` — list_name null→"List"; new_document_form null→0; steps (edited); track_steps null→0; ui_tour null→0; view_name null→"Workspaces". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/stock/form_tour/material_request/material_request.json` — first_document null→0; include_name_field null→0; list_name null→"List"; new_document_form null→0; steps (edited); track_steps null→0; ui_tour null→0; view_name null→"Workspaces". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/stock/form_tour/purchase_receipt/purchase_receipt.json` — first_document null→0; include_name_field null→0; list_name null→"List"; new_document_form null→0; steps (edited); track_steps null→0; ui_tour null→0; view_name null→"Workspaces". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/stock/form_tour/stock_entry/stock_entry.json` — first_document null→0; include_name_field null→0; list_name null→"List"; new_document_form null→0; steps (edited); track_steps null→0; ui_tour null→0; view_name null→"Workspaces". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/stock/form_tour/stock_reconciliation/stock_reconciliation.json` — view_name null→"Workspaces". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/stock/form_tour/stock_settings/stock_settings.json` — view_name null→"Workspaces". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/stock/form_tour/warehouse/warehouse.json` — view_name null→"Workspaces". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/stock/module_onboarding/stock/stock.json` — documentation_url "https://docs.erpnext.com/docs/user/m…→"neoffice.io/help". Commits: f032a768e2 (2024-09-23, "last updates").
- `erpnext/stock/page/stock_balance/stock_balance.json` — restrict_to_domain null→"Gestion"; system_page null→0. Commits: da71070613 (2023-11-15, "updates for v15").
- `erpnext/stock/workspace/stock/stock.json` — charts +Evolution Mouvements Stock −Warehouse wise Stock Value; content (layout) edited; icon "stock"→"lucide-warehouse"; idx 0→1; indicator_color null→"green"; links +Traceability, Alcohol Type, Warehouses & Catalogs, Inventory Dimension, Supplier Catalog, Supplier Catalog Log… −Customs Tariff Number, Settings, Stock Settings, Unit of Measure (UOM), Item Variant Settings, Item Attribute…; number_cards +Mouvements Stock Mois, Valeur Mouvements Année, Livraisons du Mois, Articles en Stock −Total Warehouses, Total Stock Value, Total Active Items; parent_page ""→null; restrict_to_domain ""→"Gestion"; sequence_id 7.0→10.0; shortcuts +Brand, Item Group −Learn Inventory Management. Commits: fe317f8402 (2026-06-12, "feat(workspaces): Neoffice workspace layouts — Quick Access shortcuts,"); f032a768e2 (2024-09-23, "last updates").
- `erpnext/support/workspace/service/service.json` — added file (no upstream equivalent). Commits: fe317f8402 (2026-06-12, "feat(workspaces): Neoffice workspace layouts — Quick Access shortcuts,").
- `erpnext/support/workspace/support/support.json` — content (layout) edited; indicator_color null→""; links −Issues, Issue, Issue Type, Issue Priority, Maintenance, Maintenance Schedule…; parent_page ""→"Selling"; restrict_to_domain ""→"Gestion"; sequence_id 12.0→10.0; shortcuts −Issue, Maintenance Visit, Service Level Agreement. Commits: f032a768e2 (2024-09-23, "last updates").
