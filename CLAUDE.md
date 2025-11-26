# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## About ERPNext

ERPNext is an open-source ERP system built on the **Frappe Framework** (https://github.com/frappe/frappe). It is a Frappe app that requires Frappe Framework version >=15.40.4,<16.0.0.

## Development Setup

ERPNext uses **Frappe Bench** for development. Assuming Bench is already installed:

```bash
# Get the ERPNext app
bench get-app erpnext

# Create a new site
bench new-site mysite.local

# Install ERPNext on the site
bench --site mysite.local install-app erpnext

# Start development server
bench start
```

## Common Commands

### Development
```bash
bench start                          # Start development server (includes auto-reload)
bench build --app erpnext           # Build frontend assets (JS/CSS bundles)
bench watch                         # Watch for changes and auto-rebuild
bench clear-cache                   # Clear cached data
bench console                       # Python REPL with frappe context
bench migrate                       # Run database migrations from patches.txt
```

### Testing
```bash
# Run all tests
bench --site test_site run-tests --app erpnext

# Run tests for specific DocType
bench --site test_site run-tests --doctype "Sales Order"

# Run tests for specific module
bench --site test_site run-tests --module erpnext.accounts

# Run parallel tests (CI configuration)
bench --site test_site run-parallel-tests --app erpnext --total-builds 4 --build-number 1
```

### Code Quality
```bash
# Linting and formatting (uses ruff for Python, eslint/prettier for JS)
pre-commit run --all-files

# Python linting only
ruff check erpnext/

# Python formatting
ruff format erpnext/
```

## Architecture Overview

### Module Structure

ERPNext is organized into **21 functional modules** under the `erpnext/` directory:

- **accounts** - Financial accounting, invoicing, payments, general ledger
- **stock** - Inventory management, warehouses, serial numbers
- **manufacturing** - Bill of materials, work orders, production planning
- **buying** - Purchase orders, supplier management, procurement
- **selling** - Sales orders, quotations, customer management
- **crm** - Leads, opportunities, customer relationship management
- **projects** - Project management, tasks, timesheets
- **hr** (HRMS functionality is in a separate app)
- **assets** - Fixed asset management, depreciation
- **support** - Issue tracking, service level agreements
- **setup** - Company, employee, configuration settings
- **quality_management** - Quality procedures, feedback
- **controllers** - Shared base controller classes
- **regional** - Country-specific customizations

Each module has a consistent structure:
```
module_name/
├── doctype/              # DocType definitions (1 folder per DocType)
├── report/              # Custom reports
├── workspace/           # Workspace configurations
├── dashboard_chart/     # Dashboard visualizations
└── page/                # Custom pages
```

### DocType Architecture

**DocTypes** are the core abstraction in ERPNext/Frappe. Each DocType represents a database table with associated business logic.

Structure of a DocType (e.g., `erpnext/selling/doctype/sales_order/`):
```
sales_order/
├── sales_order.json      # Schema: fields, permissions, metadata
├── sales_order.py        # Python controller (business logic)
├── sales_order.js        # Client-side JavaScript
├── sales_order_list.js   # List view customization
├── sales_order_dashboard.py  # Dashboard links/indicators
├── test_sales_order.py   # Unit tests
└── test_records.json     # Test fixtures
```

**Key points:**
- The `.json` file defines the schema (fields, permissions, naming, etc.)
- The `.py` file contains the Python controller class with business logic
- Controller classes inherit from base classes to share functionality
- Type hints are auto-generated from the JSON schema

### Controller Inheritance Hierarchy

ERPNext uses a class hierarchy for shared business logic:

```
frappe.model.document.Document
  └── TransactionBase (erpnext/utilities/transaction_base.py)
      └── StatusUpdater (erpnext/controllers/status_updater.py)
          └── AccountsController (erpnext/controllers/accounts_controller.py)
              └── StockController (erpnext/controllers/stock_controller.py)
                  ├── SellingController (erpnext/controllers/selling_controller.py)
                  │   └── SalesOrder, Quotation, DeliveryNote...
                  └── BuyingController (erpnext/controllers/buying_controller.py)
                      └── PurchaseOrder, PurchaseInvoice...
```

**Each layer provides:**
- `TransactionBase` - Posting date/time validation, UOM validation
- `StatusUpdater` - Automatic status management based on completion percentages
- `AccountsController` - Pricing, taxes, payment terms, currency conversion
- `StockController` - Stock ledger entries, warehouse validation, serial/batch numbers
- `SellingController` - Customer-specific logic, commission, delivery
- `BuyingController` - Supplier-specific logic, procurement

### Controller Lifecycle Methods

Standard hooks available in DocType controllers:

```python
class MyDocType(Document):
    def validate(self):
        # Runs before save (both draft and submit)
        # Use for validation logic

    def before_save(self):
        # Runs just before database save

    def on_submit(self):
        # Runs when document is submitted (docstatus = 1)
        # Use for creating ledger entries, updating linked docs

    def on_cancel(self):
        # Runs when document is cancelled (docstatus = 2)
        # Use for reversing ledger entries

    def on_trash(self):
        # Runs before document is deleted

    def after_insert(self):
        # Runs after first insert
```

### Hooks System

The `erpnext/hooks.py` file is the central configuration file that defines:

1. **Document lifecycle hooks** - Run code when documents are saved/submitted/cancelled
2. **Scheduled jobs** - Cron-style scheduled tasks
3. **Regional overrides** - Country-specific implementations
4. **DocType overrides** - Replace standard Frappe DocTypes with custom classes
5. **Whitelisted methods** - Override standard API endpoints

Example from hooks.py:
```python
doc_events = {
    "Sales Invoice": {
        "on_submit": ["erpnext.regional.create_transaction_log"],
        "on_cancel": ["erpnext.regional.italy.utils.sales_invoice_on_cancel"]
    }
}

scheduler_events = {
    "daily": [
        "erpnext.stock.doctype.serial_no.serial_no.update_maintenance_status"
    ],
    "cron": {
        "0/15 * * * *": [
            "erpnext.manufacturing.doctype.bom_update_log.bom_update_log.resume_bom_cost_update_jobs"
        ]
    }
}
```

### API Endpoints

Methods can be exposed as HTTP endpoints using the `@frappe.whitelist()` decorator:

```python
@frappe.whitelist()
def get_stock_balance(item_code, warehouse, posting_date=None):
    # Accessible via: /api/method/erpnext.stock.utils.get_stock_balance
    return frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty")
```

### Database Queries

**Always use QueryBuilder (qb), not raw SQL:**

```python
from frappe import qb

# Good - QueryBuilder
so = qb.DocType("Sales Order")
results = (
    qb.from_(so)
    .select(so.name, so.customer, so.grand_total)
    .where((so.docstatus == 1) & (so.status == "To Deliver"))
    .run(as_dict=True)
)

# Bad - raw SQL (avoid)
frappe.db.sql("SELECT name, customer FROM `tabSales Order` WHERE docstatus = 1")
```

## Code Conventions

### Naming
- **DocTypes:** CamelCase (e.g., `SalesOrder`, `PurchaseInvoice`)
- **Python files:** snake_case (e.g., `sales_order.py`, `purchase_invoice.py`)
- **Naming series:** Pattern format (e.g., `SAL-ORD-.YYYY.-` generates `SAL-ORD-2025-00001`)

### Style
- **Python:** Tabs (size 4), max line length 110, uses Ruff for linting/formatting
- **JavaScript:** Tabs (size 4), uses ESLint + Prettier
- **JSON:** Spaces (size 2)

### Type Hints
Controllers have auto-generated type hints:
```python
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from frappe.types import DF

    customer: DF.Link  # Link to Customer DocType
    items: DF.Table[SalesOrderItem]  # Child table
    posting_date: DF.Date
```

### Regional Customization
Use the `@erpnext.allow_regional` decorator for functions that can be overridden per country:

```python
@erpnext.allow_regional
def calculate_tax(invoice):
    # Default implementation
    # Can be overridden in hooks.py regional_overrides
```

## Testing

### Test Structure
- **DocType tests:** `erpnext/MODULE/doctype/DOCTYPE/test_DOCTYPE.py`
- **Report tests:** `erpnext/MODULE/report/REPORT/test_REPORT.py`
- **Test fixtures:** `test_records.json` in each DocType folder

### Writing Tests
```python
import frappe
from frappe.tests import IntegrationTestCase

class TestSalesOrder(IntegrationTestCase):
    def test_sales_order_creation(self):
        so = frappe.get_doc({
            "doctype": "Sales Order",
            "customer": "_Test Customer",
            "items": [{
                "item_code": "_Test Item",
                "qty": 10
            }]
        })
        so.insert()
        so.submit()
        self.assertEqual(so.docstatus, 1)
```

### Running Single Tests
```bash
# Run specific test class
bench --site test_site run-tests --module erpnext.selling.doctype.sales_order.test_sales_order

# Run specific test method
bench --site test_site run-tests --module erpnext.selling.doctype.sales_order.test_sales_order --test TestSalesOrder.test_sales_order_creation
```

## Database Migrations

Migrations are defined in `erpnext/patches.txt` and executed in order when running `bench migrate`.

Structure:
```
[pre_model_sync]
erpnext.patches.v14_0.change_is_subcontracted_fieldtype

[post_model_sync]
erpnext.patches.v15_0.update_invoice_status
execute:frappe.reload_doctype("Sales Invoice")
```

**Creating a patch:**
1. Add entry to `patches.txt`
2. Create patch file: `erpnext/patches/v15_0/my_patch.py`
```python
import frappe

def execute():
    frappe.reload_doctype("Sales Order")
    # Migration logic here
```

## Child Tables (Master-Detail)

Child tables create one-to-many relationships:

**In parent JSON:**
```json
{
  "fieldname": "items",
  "fieldtype": "Table",
  "options": "Sales Order Item"
}
```

**In controller:**
```python
for item in self.items:  # self.items is list of child documents
    total += item.qty * item.rate
```

## Status Management

Documents automatically track status based on completion percentages via `StatusUpdater`:

```python
# Sales Order status automatically updates:
# - "Draft" → "To Deliver and Bill" (when submitted)
# - "To Deliver and Bill" → "To Bill" (when per_delivered >= 100)
# - "To Bill" → "Completed" (when per_billed >= 100)
```

Status mappings are defined in `erpnext/controllers/status_updater.py`.

## Important Files

- **`erpnext/hooks.py`** - App configuration, hooks, scheduled jobs, regional overrides
- **`erpnext/patches.txt`** - Database migration patches (run with `bench migrate`)
- **`erpnext/modules.txt`** - List of all modules
- **`pyproject.toml`** - Python package configuration, dependencies, Ruff settings
- **`.pre-commit-config.yaml`** - Pre-commit hooks for code quality

## CI/CD

GitHub Actions workflows in `.github/workflows/`:
- **`server-tests-mariadb.yml`** - Backend tests with MariaDB
- **`server-tests-postgres.yml`** - Backend tests with PostgreSQL
- **`linters.yml`** - Runs ruff, eslint, prettier
- **`patch.yml`** - Tests database migrations

Tests run in parallel across 4 containers for performance.
