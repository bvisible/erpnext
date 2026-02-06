// Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
// License: GNU General Public License v3. See license.txt

frappe.provide("erpnext.accounts");
frappe.provide("erpnext.journal_entry");
frappe.provide("erpnext.journal_entry_utils");

// Check if the utility functions are available and initialize them
if (frappe.initialize_journal_entry_utils) {
    frappe.initialize_journal_entry_utils();
} else {
    // Fallback if frappe.initialize_journal_entry_utils is not available
    console.warn("Initialize journal entry utils not available");
}

// Update values directly without triggering events
erpnext.journal_entry_utils.forceDirect = function(row, values) {
    if (!row || !values) return false;
    
    const doctype = row.doctype || 'Journal Entry Account';
    console.log("[DEBUG] forceDirect: modification directe de la ligne", { 
        name: row.name, 
        current: { 
            debit: row.debit_in_account_currency, 
            credit: row.credit_in_account_currency 
        },
        new: { 
            debit: values.debit !== undefined ? values.debit : row.debit_in_account_currency, 
            credit: values.credit !== undefined ? values.credit : row.credit_in_account_currency 
        }
    });
    
    // Mark the row as being internally updated to avoid loops
    row._internal_update = true;
    
    try {
        // Get the local object for direct manipulation
        const localDoc = locals[doctype][row.name];
        if (!localDoc) return false;
        
        // Update values directly in the local object
        if (values.debit !== undefined) {
            localDoc.debit_in_account_currency = values.debit;
            localDoc.debit = values.debit;
        }
        
        if (values.credit !== undefined) {
            localDoc.credit_in_account_currency = values.credit;
            localDoc.credit = values.credit;
        }
        
        if (values.account !== undefined) {
            localDoc.account = values.account;
        }
        
        if (values.remark !== undefined) {
            localDoc.user_remark = values.remark;
        }
        
        // Refresh the interface
        refresh_field("accounts");
        
        return true;
    } catch (error) {
        console.error("[ERROR] forceDirect - Error during direct update", error);
        return false;
    } finally {
        // Ensure the marker is reset
        setTimeout(() => {
            row._internal_update = false;
        }, 100);
    }
};

// Convert a currency amount to a floating-point number with 2 decimal places by default
erpnext.journal_entry_utils.toDecimal = function(amount, precision = 2) {
    // Complete input validation
    if (amount === null || amount === undefined) {
        return 0;
    }
    
    // Ensure the input is a number
    const num = parseFloat(amount);
    if (isNaN(num)) {
        return 0;
    }
    
    // Use the specified precision
    return parseFloat(num.toFixed(precision));
};

// Calculate the price excluding VAT from a price including VAT and VAT rate
erpnext.journal_entry_utils.excludingVatPrice = function(priceWithTax, vatRate) {
    // Input validation
    if (!priceWithTax || isNaN(parseFloat(priceWithTax))) return 0;
    if (!vatRate || isNaN(parseFloat(vatRate))) return priceWithTax;
    
    // Safe calculation
    const divisor = 1 + (parseFloat(vatRate) / 100);
    if (divisor <= 0) return priceWithTax;
    
    return this.toDecimal(parseFloat(priceWithTax) / divisor);
};

// Calculate the VAT amount
erpnext.journal_entry_utils.calculateVatAmount = function(price, vatRate, isVatExcluded) {
    // Input validation
    if (!price || isNaN(parseFloat(price))) return 0;
    if (!vatRate || isNaN(parseFloat(vatRate))) return 0;
    
    const numPrice = parseFloat(price);
    const numVatRate = parseFloat(vatRate);
    
    if (isVatExcluded) {
        // If the price is excluding VAT, calculate VAT directly
        return this.toDecimal(numPrice * numVatRate / 100);
    } else {
        // If the price is including VAT, calculate the price excluding VAT first
        const priceWithoutVat = this.excludingVatPrice(numPrice, numVatRate);
        return this.toDecimal(numPrice - priceWithoutVat);
    }
};

// Generate a remark for a VAT row
erpnext.journal_entry_utils.formatVatRemark = function(baseRemark, accountName) {
    if (baseRemark) {
        return __('VAT for') + " " + baseRemark;
    }
    return __('VAT for') + " " + accountName;
};

// Function to verify the consistency of VAT rows
erpnext.journal_entry_utils.enforceVatRowsConsistency = function(form) {
    try {
        const frm = form || cur_frm;
        if (!frm || !frm.doc || !frm.doc.accounts || !Array.isArray(frm.doc.accounts)) {
            return;
        }
        
        // Search for all account rows that are VAT rows
        const vatRows = frm.doc.accounts.filter(row => 
            (row._is_vat_line || (row.account && row.account.includes('TVA'))) &&
            row.doctype && row.name
        );
        
        if (vatRows.length > 0) {            
            for (const row of vatRows) {
                // If both fields have non-zero values, force correction
                const debit = parseFloat(row.debit_in_account_currency || 0);
                const credit = parseFloat(row.credit_in_account_currency || 0);
                
                if (debit > 0 && credit > 0) {
                    // Privilege debit (keep the largest value)
                    if (debit >= credit) {
                        erpnext.journal_entry_utils.forceDirect(row, {
                            credit: 0
                        });
                    } else {
                        erpnext.journal_entry_utils.forceDirect(row, {
                            debit: 0
                        });
                    }
                }
            }
        }
    } catch (error) {
        console.error("[ERROR] enforceVatRowsConsistency", error);
    }
};

// Function to reposition VAT rows after their source rows
erpnext.journal_entry_utils.repositionVatRows = function(form) {
    try {
        const frm = form || cur_frm;
        if (!frm || !frm.doc || !frm.doc.accounts || !Array.isArray(frm.doc.accounts)) {
            return;
        }
        
        // Identify all VAT rows that have a reference to a source row
        const vatRows = frm.doc.accounts.filter(row => 
            (row._is_vat_line || (row.account && row.account.includes('TVA'))) && 
            row._source_row_id
        );
        
        if (vatRows.length === 0) {
            console.log("[DEBUG] repositionVatRows: aucune ligne TVA à repositionner");
            return;
        }
        
        // Create a copy of the accounts table
        const originalAccounts = [...frm.doc.accounts];
        
        // Remove VAT rows from the table to reposition
        const nonVatRows = originalAccounts.filter(row => 
            !(row._is_vat_line || (row.account && row.account.includes('TVA'))) || 
            !row._source_row_id
        );
        
        // Create a new array for the reorganized accounts
        let newAccounts = [];
        
        // Iterate over non-VAT rows and add associated VAT rows directly after
        for (const sourceRow of nonVatRows) {
            // Add the source row
            newAccounts.push(sourceRow);
            
            // If the row is not a VAT row, find its associated VAT rows
            if (!(sourceRow._is_vat_line || (sourceRow.account && sourceRow.account.includes('TVA')))) {
                const associatedVatRows = vatRows.filter(row => row._source_row_id === sourceRow.name);
                
                if (associatedVatRows.length > 0) {
                    // Add all associated VAT rows directly after their source row
                    for (const vatRow of associatedVatRows) {
                        newAccounts.push(vatRow);
                        
                        // Mark as processed
                        vatRow._repositioned = true;
                    }
                }
            }
        }
        
        // Check if there are any remaining VAT rows and add them at the end
        const remainingVatRows = vatRows.filter(row => !row._repositioned);
        
        if (remainingVatRows.length > 0) {
            // Add these rows at the end
            for (const vatRow of remainingVatRows) {
                newAccounts.push(vatRow);
            }
        }
        
        // Check that all unique original identifiers are present in the new array
        const originalIds = new Set(originalAccounts.map(row => row.name));
        const newIds = new Set(newAccounts.map(row => row.name));
        
        if (originalIds.size !== newIds.size) {
            console.error("[ERROR] repositionVatRows: Number of identifiers different after repositioning", {
                original: originalIds.size,
                new: newIds.size
            });
            
            // Check missing identifiers
            const missingIds = [...originalIds].filter(id => !newIds.has(id));
            if (missingIds.length > 0) {
                console.error("[ERROR] repositionVatRows: Missing identifiers", missingIds);
                
                // Retrieve missing rows and add them
                for (const id of missingIds) {
                    const missingRow = originalAccounts.find(row => row.name === id);
                    if (missingRow) {
                        newAccounts.push(missingRow);
                    }
                }
            }
            
            // Check extra identifiers
            const extraIds = [...newIds].filter(id => !originalIds.has(id));
            if (extraIds.length > 0) {
                console.error("[ERROR] repositionVatRows: Extra identifiers", extraIds);
                
                // Remove duplicates
                newAccounts = newAccounts.filter((row, index, self) => 
                    index === self.findIndex(r => r.name === row.name)
                );
            }
        }
        
        // Check for remaining inconsistencies
        if (newAccounts.length !== originalAccounts.length) {
            console.error("[ERROR] repositionVatRows: Always an inconsistency in the number of lines", {
                original: originalAccounts.length,
                new: newAccounts.length
            });
            return; // Do not apply the change if inconsistency
        }
        
        // Update indices
        newAccounts.forEach((row, index) => {
            row.idx = index + 1;
            
            // Remove temporary marker
            if (row._repositioned) {
                delete row._repositioned;
            }
        });
        
        // Replace the original table with the new one
        frm.doc.accounts = newAccounts;
        
        // Refresh the interface
        refresh_field("accounts");        
    } catch (error) {
        console.error("[ERROR] repositionVatRows", error);
    }
};

// Function to process VAT
erpnext.journal_entry_utils.processTVA = function(frm, row) {
    // Check if automatic calculations are disabled
    if (frm.doc.disable_calculation) {
        return;
    }
    
    // Ignore if the row is already being processed or if it's a VAT row
    if (row._processing_tax || row._internal_update) {
        return;
    }
    
    if (row._is_vat_line || (row.account && row.account.includes('TVA'))) {
        return;
    }
    
    // Store original amounts to check if recalculation is really necessary
    if (!row._last_processed_values) {
        row._last_processed_values = {
            debit: row.debit_in_account_currency,
            credit: row.credit_in_account_currency,
            account: row.account
        };
    } else {
        // Check if the values have not changed since last processing
        if (row._last_processed_values.debit === row.debit_in_account_currency && 
            row._last_processed_values.credit === row.credit_in_account_currency &&
            row._last_processed_values.account === row.account) {
            return;
        }
        
        // Update last processed values
        row._last_processed_values.debit = row.debit_in_account_currency;
        row._last_processed_values.credit = row.credit_in_account_currency;
        row._last_processed_values.account = row.account;
    }
    
    // Get company VAT method
    this.getCompanyVatMethod(frm.doc.company, (vatMethod) => {
        // If it's "Flat-rate taxation", do not add VAT rows
        if (vatMethod && vatMethod.includes("Flat")) {
            row._processing_tax = false;
            return;
        }
        
        // Disable automatic balancing during VAT processing
        frm.doc._skip_balance = true;
        
        // Mark the row as being processed
        row._processing_tax = true;
        
        // Get the active mode (debit or credit)
        const debitAmount = parseFloat(row.debit_in_account_currency || 0);
        const creditAmount = parseFloat(row.credit_in_account_currency || 0);
        const isDebitMode = debitAmount > 0;
        const isCreditMode = creditAmount > 0;
        
        // If no amount, do nothing
        if (!isDebitMode && !isCreditMode) {
            row._processing_tax = false;
            return;
        }
        
        // Get tax information for the account
        this.getAccountTaxInfo(row.account, (taxInfo) => {
            if (!taxInfo || !taxInfo.taxRate) {
                console.log("[DEBUG] processTVA: pas de taux de TVA pour ce compte");
                row._processing_tax = false;
                return;
            }
            
            // Calculate base and tax amounts - check if it's the first time or an update
            let baseAmount, taxAmount;
            const isVatExcluded = frm.doc.is_vat_excluded === 1;
            
            // To avoid cascading recalculations, check if the row already has a VAT row associated
            // or if it has already been calculated once
            const hasExistingVatRow = this.findVatRow(frm, row, taxInfo.taxAccount);
            const isFirstCalculation = !row._original_amount && !hasExistingVatRow;
            
            if (isFirstCalculation) {
                if (isVatExcluded) {
                    // Mode HT: The amount entered is HT, calculate VAT directly without modifying the amount entered
                    if (isDebitMode) {
                        baseAmount = debitAmount; // Montant HT = montant saisi
                        taxAmount = this.calculateVatAmount(baseAmount, taxInfo.taxRate, true); // TVA directe
                        // Store the original amount for future calculations
                        row._original_amount = {
                            type: 'debit',
                            ht: baseAmount,
                            tva: taxAmount,
                            ttc: baseAmount + taxAmount // Pour référence
                        };
                    } else {
                        baseAmount = creditAmount; // Montant HT = montant saisi
                        taxAmount = this.calculateVatAmount(baseAmount, taxInfo.taxRate, true); // TVA directe
                        // Store the original amount for future calculations
                        row._original_amount = {
                            type: 'credit',
                            ht: baseAmount,
                            tva: taxAmount,
                            ttc: baseAmount + taxAmount // Pour référence
                        };
                    }
                    
                    // In the HT mode, we keep the amount entered (HT)
                    // No update of the original row
                } else {
                    // Mode TTC: The amount entered is TTC, extract VAT and update the HT amount
                    if (isDebitMode) {
                        baseAmount = this.excludingVatPrice(debitAmount, taxInfo.taxRate);
                        taxAmount = debitAmount - baseAmount;
                        // Store the original amount for future calculations
                        row._original_amount = {
                            type: 'debit',
                            ttc: debitAmount,
                            ht: baseAmount,
                            tva: taxAmount
                        };
                    } else {
                        baseAmount = this.excludingVatPrice(creditAmount, taxInfo.taxRate);
                        taxAmount = creditAmount - baseAmount;
                        // Store the original amount for future calculations
                        row._original_amount = {
                            type: 'credit',
                            ttc: creditAmount,
                            ht: baseAmount,
                            tva: taxAmount
                        };
                    }
                    
                    // Update the original row with the calculated HT amount
                    if (isDebitMode) {
                        this.forceDirect(row, {
                            debit: baseAmount,
                            credit: 0
                        });
                    } else {
                        this.forceDirect(row, {
                            debit: 0,
                            credit: baseAmount
                        });
                    }
                    
                    // In the mode TTC, update the original row with the calculated HT amount
                    if (isDebitMode) {
                        this.forceDirect(row, {
                            debit: baseAmount,
                            credit: 0
                        });
                    } else {
                        this.forceDirect(row, {
                            credit: baseAmount,
                            debit: 0
                        });
                    }
                }
            } else {
                // Future calculations: the behavior depends on the HT/TTC mode
                if (isVatExcluded) {
                    // Mode HT: The amount entered is HT, calculate VAT directly
                    if (isDebitMode) {
                        baseAmount = debitAmount; // Amount HT = amount entered
                        taxAmount = this.calculateVatAmount(baseAmount, taxInfo.taxRate, true); // Direct VAT
                    } else {
                        baseAmount = creditAmount; // Amount HT = amount entered
                        taxAmount = this.calculateVatAmount(baseAmount, taxInfo.taxRate, true); // Direct VAT
                    }
                    
                    console.log("[DEBUG] processTVA: recalcul basé sur HT existant (mode HT)", {
                        baseAmount: baseAmount,
                        taxAmount: taxAmount,
                        isDebitMode: isDebitMode,
                        is_vat_excluded: true
                    });
                    
                    // In the mode HT, keep the amount entered as is (HT)
                } else {
                    // Mode TTC: The amount entered is TTC, it needs to be converted to HT
                    if (isDebitMode) {
                        // Convert the TTC amount to HT amount
                        const ttcAmount = debitAmount;
                        baseAmount = this.excludingVatPrice(ttcAmount, taxInfo.taxRate);
                        taxAmount = ttcAmount - baseAmount;
                        
                        console.log("[DEBUG] processTVA: recalcul TTC vers HT (mode TTC)", {
                            ttcAmount: ttcAmount,
                            baseAmount: baseAmount,
                            taxAmount: taxAmount,
                            isDebitMode: true
                        });
                        
                        // Update with the HT amount
                        this.forceDirect(row, {
                            debit: baseAmount,
                            credit: 0
                        });
                    } else {
                        // Convert the TTC amount to HT amount
                        const ttcAmount = creditAmount;
                        baseAmount = this.excludingVatPrice(ttcAmount, taxInfo.taxRate);
                        taxAmount = ttcAmount - baseAmount;
                        
                        // Update with the HT amount
                        this.forceDirect(row, {
                            credit: baseAmount,
                            debit: 0
                        });
                    }
                }
                
                // Store the new values for reference
                if (isDebitMode) {
                    row._original_amount = {
                        type: 'debit',
                        ht: baseAmount,
                        tva: taxAmount,
                        ttc: isVatExcluded ? baseAmount + taxAmount : debitAmount
                    };
                } else {
                    row._original_amount = {
                        type: 'credit',
                        ht: baseAmount,
                        tva: taxAmount,
                        ttc: isVatExcluded ? baseAmount + taxAmount : creditAmount
                    };
                }
            }
            
            // Search for an existing VAT line
            // First search by the bidirectional relationship
            let existingVatRow = null;
            if (row._has_vat_line && row._vat_row_id) {
                // Direct search by ID
                existingVatRow = frm.doc.accounts.find(vrow => vrow.name === row._vat_row_id);
                if (!existingVatRow) {
                    row._has_vat_line = false;
                    row._vat_row_id = null;
                }
            }
            
            // If no row is found via direct relationship, use findVatRow
            if (!existingVatRow) {
                existingVatRow = this.findVatRow(frm, row, taxInfo.taxAccount);
            }
            
            if (existingVatRow) {
                
                // Ensure the association is correct in both directions
                if (existingVatRow._source_row_id !== row.name) {
                    existingVatRow._source_row_id = row.name;
                }
                
                if (!row._has_vat_line || row._vat_row_id !== existingVatRow.name) {
                    row._has_vat_line = true;
                    row._vat_row_id = existingVatRow.name;
                }
                
                // If the account has changed, update the VAT account
                if (existingVatRow.account !== taxInfo.taxAccount) {
                    this.forceDirect(existingVatRow, {
                        account: taxInfo.taxAccount
                    });
                }
                
                // Update the existing VAT row
                if (isDebitMode) {
                    this.forceDirect(existingVatRow, {
                        debit: taxAmount,
                        credit: 0,
                        remark: this.formatVatRemark(row.user_remark, row.account)
                    });
                } else {
                    this.forceDirect(existingVatRow, {
                        credit: taxAmount,
                        debit: 0,
                        remark: this.formatVatRemark(row.user_remark, row.account)
                    });
                }
                
                // Ensure the _is_vat_line flag is set
                if (!existingVatRow._is_vat_line) {
                    existingVatRow._is_vat_line = true;
                }
            } else {
                // Determine the position for the new VAT row
                // We want to place it just after the source row
                let insertIdx = row.idx;
                
                // Create a new VAT row at the determined position
                const vatRow = frm.add_child('accounts', null, insertIdx);
                vatRow._is_vat_line = true;
                vatRow._source_row = row.idx;        // Old method (idx may change)
                vatRow._source_row_id = row.name;    // New method (unique identifier)
                vatRow._parent_account = row.account; // Store parent account for traceability
                vatRow._internal_update = true;      // Avoid cascade updates
                vatRow._skip_balance = true;         // Avoid automatic balancing
                
                // Establish the bidirectional relationship
                if (!row._has_vat_line) {
                    row._has_vat_line = true;
                }
                
                // Use setTimeout to ensure the name is available
                setTimeout(() => {
                    if (vatRow.name && !row._vat_row_id) {
                        row._vat_row_id = vatRow.name;
                    }
                }, 100);

                // Set the _skip_balance flag on the document
                frm.doc._skip_balance = true;
                
                // Initialize explicitly all values before setting them to avoid issues
                vatRow.debit_in_account_currency = 0;
                vatRow.credit_in_account_currency = 0;
                vatRow.debit = 0;
                vatRow.credit = 0;
                
                // Use forceDirect for more control over the values instead of frappe.model.set_value
                // This will avoid race conditions where both values (debit and credit) would be set
                if (isDebitMode) {
                    frappe.model.set_value(vatRow.doctype, vatRow.name, "account", taxInfo.taxAccount);
                    frappe.model.set_value(vatRow.doctype, vatRow.name, "user_remark", this.formatVatRemark(row.user_remark, row.account));
                    
                    // Use forceDirect to update values without triggering events
                    this.forceDirect(vatRow, {
                        debit: taxAmount,
                        credit: 0
                    });
                } else {
                    frappe.model.set_value(vatRow.doctype, vatRow.name, "account", taxInfo.taxAccount);
                    frappe.model.set_value(vatRow.doctype, vatRow.name, "user_remark", this.formatVatRemark(row.user_remark, row.account));
                    
                    // Use forceDirect to update values without triggering events
                    this.forceDirect(vatRow, {
                        credit: taxAmount,
                        debit: 0
                    });
                }
                
                // Reset the flag after a delay
                setTimeout(() => {
                    vatRow._internal_update = false;
                }, 100);
                
                refresh_field("accounts");
            }
            
            // Ensure everything is consistent
            setTimeout(() => {
                this.enforceVatRowsConsistency(frm);
                row._processing_tax = false;
                
                // Reactivate automatic balancing
                frm.doc._skip_balance = false;
                
                // Reposition the VAT rows
                if (this.repositionVatRows) {
                    console.log("[DEBUG] processTVA: repositionnement des lignes TVA");
                    this.repositionVatRows(frm);
                }
                
                // Update document totals
                cur_frm.cscript.update_totals(frm.doc);
            }, 200);
        });
    });
};

// Function to find an existing VAT row
erpnext.journal_entry_utils.findVatRow = function(frm, sourceRow, vatAccount) {
    if (!frm.doc.accounts || !Array.isArray(frm.doc.accounts) || !sourceRow.name) {
        return null;
    }
    
    // 0. First check the direct reference via _vat_row_id (bidirectional relationship)
    if (sourceRow._has_vat_line && sourceRow._vat_row_id) {
        const directVatRow = frm.doc.accounts.find(row => row.name === sourceRow._vat_row_id);
        if (directVatRow) {
            // Verify that the inverse relationship is correct
            if (!directVatRow._source_row_id || directVatRow._source_row_id !== sourceRow.name) {
                directVatRow._source_row_id = sourceRow.name;
                directVatRow._is_vat_line = true;
            }
            
            return directVatRow;
        }
    }
    
    // 1. Priority absolute: Search by unique source ID, this is the most reliable method
    const linkedVatRow = frm.doc.accounts.find(row => 
        row._source_row_id === sourceRow.name && 
        (row._is_vat_line || (row.account && row.account.includes('TVA')))
    );
    
    if (linkedVatRow) {
        // Establish the bidirectional relationship if it doesn't exist
        if (!sourceRow._has_vat_line || !sourceRow._vat_row_id) {
            sourceRow._has_vat_line = true;
            sourceRow._vat_row_id = linkedVatRow.name;
        }
        
        return linkedVatRow;
    }
    
    // 2. Search by user_remark content containing the source account name
    if (sourceRow.account) {
        const remarkVatRow = frm.doc.accounts.find(row => 
            (row._is_vat_line || (row.account && row.account.includes('TVA'))) && 
            row.user_remark && 
            row.user_remark.includes(sourceRow.account) &&
            (!row._source_row_id || row._source_row_id === '')
        );
        
        if (remarkVatRow) {
            // Establish the bidirectional relationship
            remarkVatRow._source_row_id = sourceRow.name;
            remarkVatRow._is_vat_line = true;
            
            // Establish the bidirectional relationship
            sourceRow._has_vat_line = true;
            sourceRow._vat_row_id = remarkVatRow.name;
            
            return remarkVatRow;
        }
    }
    
    // IMPORTANT: For new rows, do not search for existing VAT rows by compatibility
    if (sourceRow.__islocal && sourceRow.__unsaved) {
        // For new rows, only search by _source_row_id, never by fallback
        return null;
    }
    
    // 3. Search by proximity of index (the row just after the source row)
    const nextRow = frm.doc.accounts.find(row => 
        row.idx === sourceRow.idx + 1 && 
        (row._is_vat_line || (row.account && row.account.includes('TVA'))) &&
        (!row._source_row_id || row._source_row_id === '')
    );
    
    if (nextRow) {
        // Establish the association
        nextRow._source_row_id = sourceRow.name;
        nextRow._is_vat_line = true;
        
        // Establish the bidirectional relationship
        sourceRow._has_vat_line = true;
        sourceRow._vat_row_id = nextRow.name;
        
        return nextRow;
    }
    
    // 4. If a specific VAT account is provided, search among rows with this account
    if (vatAccount) {
        const vatTypeRow = frm.doc.accounts.find(row => 
            row.account === vatAccount && 
            (!row._source_row_id || row._source_row_id === '')
        );
        
        if (vatTypeRow) {
            // Establish the association
            vatTypeRow._source_row_id = sourceRow.name;
            vatTypeRow._is_vat_line = true;
            
            // Establish the bidirectional relationship
            sourceRow._has_vat_line = true;
            sourceRow._vat_row_id = vatTypeRow.name;
            
            return vatTypeRow;
        }
    }
    
    // 5. Last chance: search for a free VAT row without association
    const freeVatRow = frm.doc.accounts.find(row => 
        (row._is_vat_line || (row.account && row.account.includes('TVA'))) && 
        (!row._source_row_id || row._source_row_id === '')
    );
    
    if (freeVatRow) {
        // Establish the association
        freeVatRow._source_row_id = sourceRow.name;
        freeVatRow._is_vat_line = true;
        
        // Establish the bidirectional relationship
        sourceRow._has_vat_line = true;
        sourceRow._vat_row_id = freeVatRow.name;
        
        return freeVatRow;
    }
    
    return null;
};

// Function to retrieve full VAT info for a company (is_vat_company + vat_accounting_method)
erpnext.journal_entry_utils.getCompanyVatInfo = function(companyName, callback) {
    if (!companyName) {
        if (typeof callback === 'function') callback({ isVatCompany: false, vatMethod: null });
        return;
    }

    // Check if we already have this information in cache
    if (erpnext.journal_entry_utils._vatInfoCache &&
        erpnext.journal_entry_utils._vatInfoCache[companyName] &&
        erpnext.journal_entry_utils._vatInfoCache[companyName].timestamp > Date.now() - 3600000) { // Cache valid for 1 hour

        if (typeof callback === 'function') {
            callback(erpnext.journal_entry_utils._vatInfoCache[companyName].value);
        }
        return;
    }

    // Initialize cache if needed
    if (!erpnext.journal_entry_utils._vatInfoCache) {
        erpnext.journal_entry_utils._vatInfoCache = {};
    }

    frappe.db.get_value("Company", companyName, ["is_vat_company", "vat_accounting_method"], (result) => {
        const vatInfo = {
            isVatCompany: result && result.is_vat_company ? true : false,
            vatMethod: result && result.vat_accounting_method ? result.vat_accounting_method : null
        };

        // Store in cache
        erpnext.journal_entry_utils._vatInfoCache[companyName] = {
            value: vatInfo,
            timestamp: Date.now()
        };

        if (typeof callback === 'function') {
            callback(vatInfo);
        }
    });
};

// Function to retrieve the VAT accounting method for a company (legacy - uses getCompanyVatInfo internally)
erpnext.journal_entry_utils.getCompanyVatMethod = function(companyName, callback) {
    erpnext.journal_entry_utils.getCompanyVatInfo(companyName, (vatInfo) => {
        if (typeof callback === 'function') {
            callback(vatInfo.vatMethod);
        }
    });
};

// Function to retrieve tax information for an account
erpnext.journal_entry_utils.getAccountTaxInfo = function(accountName, callback) {
    if (!accountName) {
        if (typeof callback === 'function') callback(null);
        return;
    }
    
    frappe.db.get_value("Account", accountName, ["taxable_account"], (re) => {
        if (!re || !re.taxable_account) {
            if (typeof callback === 'function') callback(null);
            return;
        }
        
        const taxTemplateName = re.taxable_account;
        
        frappe.call({
            method: "frappe.client.get",
            args: {
                doctype: "Item Tax Template",
                name: taxTemplateName
            },
            callback: (result) => {
                if (!result.message || !result.message.taxes || !result.message.taxes.length) {
                    if (typeof callback === 'function') callback(null);
                    return;
                }
                
                const taxLine = result.message.taxes.find(tax => tax.tax_rate > 0);
                if (!taxLine) {
                    if (typeof callback === 'function') callback(null);
                    return;
                }
                
                if (typeof callback === 'function') {
                    callback({
                        taxRate: taxLine.tax_rate,
                        taxAccount: taxLine.tax_type
                    });
                }
            },
            error: () => {
                if (typeof callback === 'function') callback(null);
            }
        });
    });
};

// Function to configure VAT listeners
erpnext.journal_entry_utils.setupVatListener = function(frm, row) {
    if (!row || row._tva_watcher_setup) return;
    
    // Mark as configured
    row._tva_watcher_setup = true;
    
    // Watch for account changes
    frappe.model.on(row.doctype, row.name, "account", function(fieldname, value) {
        // Check if automatic calculations are disabled
        if (frm.doc.disable_calculation) {
            return;
        }
        
        if (value && !row._processing_tax && !row._internal_update) {
            // Check if it's a VAT account
            if (value.includes('TVA')) {
                row._is_vat_line = true;
                
                // Check if both amounts are defined and correct
                if (row.debit_in_account_currency > 0 && row.credit_in_account_currency > 0) {
                    if (row.debit_in_account_currency >= row.credit_in_account_currency) {
                        erpnext.journal_entry_utils.forceDirect(row, {
                            credit: 0
                        });
                    } else {
                        erpnext.journal_entry_utils.forceDirect(row, {
                            debit: 0
                        });
                    }
                }
            }
            
            // Wait a moment before processing VAT
            setTimeout(() => {
                if (erpnext.journal_entry_utils.processTVA && !row._is_vat_line) {
                    erpnext.journal_entry_utils.processTVA(frm, row);
                }
            }, 100);
        }
    });
    
    // Watch for debit changes
    frappe.model.on(row.doctype, row.name, "debit_in_account_currency", function(fieldname, value) {
        if (row._processing_tax || row._internal_update) return;
        
        // Check if automatic calculations are disabled
        if (frm.doc.disable_calculation) {
            return;
        }
        
        // If debit exists, set it to zero
        if (value > 0 && row.credit_in_account_currency > 0) {
            row._skip_tax_recalc = true;
            erpnext.journal_entry_utils.forceDirect(row, {
                credit: 0
            });
            setTimeout(() => {
                row._skip_tax_recalc = false;
            }, 100);
        }
        
        // Wait a moment before processing VAT
        setTimeout(() => {
            if (erpnext.journal_entry_utils.processTVA && !row._is_vat_line) {
                erpnext.journal_entry_utils.processTVA(frm, row);
            }
        }, 100);
    });
    
    // Watch for credit changes
    frappe.model.on(row.doctype, row.name, "credit_in_account_currency", function(fieldname, value) {
        if (row._processing_tax || row._internal_update) return;
        
        // Check if automatic calculations are disabled
        if (frm.doc.disable_calculation) {
            return;
        }
        
        // If credit exists, set it to zero
        if (value > 0 && row.debit_in_account_currency > 0) {
            row._skip_tax_recalc = true;
            erpnext.journal_entry_utils.forceDirect(row, {
                debit: 0
            });
            setTimeout(() => {
                row._skip_tax_recalc = false;
            }, 100);
        }
        
        // Wait a moment before processing VAT
        setTimeout(() => {
            if (erpnext.journal_entry_utils.processTVA && !row._is_vat_line) {
                erpnext.journal_entry_utils.processTVA(frm, row);
            }
        }, 100);
    });
};

// Function to populate a journal entry row
erpnext.journal_entry_utils.populateRow = function(dt, dn, values) {
    try {
        if (!dt || !dn || !values) {
            console.error("Invalid parameters for populateRow", { dt, dn, values });
            return Promise.reject("Invalid parameters");
        }
    
        const fields = ["account", "party_type", "party", "debit_in_account_currency", "credit_in_account_currency", "user_remark"];
        const actions = [];
        
        // Create a promise for each field to set
        fields.forEach((field, index) => {
            if (values[index] !== undefined) {
                actions.push(frappe.model.set_value(dt, dn, field, values[index]));
            }
        });
        
        // Wait for all promises to resolve
        return Promise.all(actions);
    } catch (error) {
        console.error("Error in populateRow", error);
        return Promise.reject(error);
    }
};

// Function to handle the quick entry process
erpnext.journal_entry_utils.processQuickEntry = function(frm, values, createNew, submitDoc) {
    // Prepare the form
    frm.set_value("posting_date", values.posting_date);
    frm.set_value("user_remark", values.user_remark);
    
    // Define specific VAT flags
    frm.set_value("is_vat_excluded", values.is_vat_excluded === 1 ? 1 : 0); // Check if VAT is excluded
    frm.set_value("disable_calculation", values.disable_calculation || 0);
    
    // Clear the table if only one row exists
    if (frm.doc.accounts.length == 1) {
        frm.clear_table("accounts");
    }
    
    // Check the VAT method of the company first
    this.getCompanyVatMethod(frm.doc.company, (vatMethod) => {
        // If it's "Flat-rate taxation", disable automatic calculations
        if (vatMethod && vatMethod.includes("Flat")) {
            frm.set_value("disable_calculation", 1);
            values.disable_calculation = 1;
        }
        
        this.continueQuickEntry(frm, values, createNew, submitDoc);
    });
};

// Function to continue the quick entry process after checking the VAT method
erpnext.journal_entry_utils.continueQuickEntry = function(frm, values, createNew, submitDoc) {
    // If calculations are disabled, add at least one empty row then save
    if (values.disable_calculation) {
        // Check if there are already rows in the table
        if (frm.doc.accounts.length === 0) {
            // Add at least one minimal journal entry row
            var row = frm.add_child('accounts');
            
            // Search for a template if available
            if (values.template) {
                frappe.call({
                    method: "frappe.client.get",
                    args: {
                        doctype: "Journal Entry Template",
                        name: values.template,
                    },
                    callback: (r) => {
                        if (r.message && r.message.accounting_entry_totalization && r.message.accounting_entry_totalization.length > 0) {
                            const templateDoc = r.message;
                            const totalizationDoc = templateDoc.accounting_entry_totalization[0];
                            
                            // Define minimal values
                            frappe.model.set_value(row.doctype, row.name, 'account', totalizationDoc.account);
                            if (totalizationDoc.party_type) {
                                frappe.model.set_value(row.doctype, row.name, 'party_type', totalizationDoc.party_type);
                            }
                            if (totalizationDoc.party) {
                                frappe.model.set_value(row.doctype, row.name, 'party', totalizationDoc.party);
                            }
                            
                            // Amount to use
                            const amount = values.totalization || 0.01;
                            
                            // Determine if it's a debit or credit
                            if (values.credit_or_debit === "Debit") {
                                frappe.model.set_value(row.doctype, row.name, 'debit_in_account_currency', amount);
                            } else {
                                frappe.model.set_value(row.doctype, row.name, 'credit_in_account_currency', amount);
                            }
                            
                            // Add counterparty row if template contains one
                            if (templateDoc.accounting_entry_counterparty && templateDoc.accounting_entry_counterparty.length > 0) {
                                const counterpartyInfo = templateDoc.accounting_entry_counterparty[0];
                                const counterpartyRow = frm.add_child('accounts');
                                
                                frappe.model.set_value(counterpartyRow.doctype, counterpartyRow.name, 'account', counterpartyInfo.account);
                                if (counterpartyInfo.party_type) {
                                    frappe.model.set_value(counterpartyRow.doctype, counterpartyRow.name, 'party_type', counterpartyInfo.party_type);
                                }
                                if (counterpartyInfo.party) {
                                    frappe.model.set_value(counterpartyRow.doctype, counterpartyRow.name, 'party', counterpartyInfo.party);
                                }
                                
                                // Inverse amount to balance
                                if (values.credit_or_debit === "Debit") {
                                    frappe.model.set_value(counterpartyRow.doctype, counterpartyRow.name, 'credit_in_account_currency', amount);
                                } else {
                                    frappe.model.set_value(counterpartyRow.doctype, counterpartyRow.name, 'debit_in_account_currency', amount);
                                }
                            }
                            
                            // Refresh and continue
                            refresh_field("accounts");
                            this.finishQuickEntry(frm, submitDoc, createNew);
                        } else {
                            // Create basic rows
                            this.createBasicEntryRows(frm, values);
                            this.finishQuickEntry(frm, submitDoc, createNew);
                        }
                    },
                    error: () => {
                        // Create basic rows
                        this.createBasicEntryRows(frm, values);
                        this.finishQuickEntry(frm, submitDoc, createNew);
                    }
                });
            } else {
                // No template, create basic rows
                this.createBasicEntryRows(frm, values);
                this.finishQuickEntry(frm, submitDoc, createNew);
            }
        } else {
            // Rows already exist, just save
            this.finishQuickEntry(frm, submitDoc, createNew);
        }
        return;
    }
    
    // With calculation enabled, and a template selected
    if (values.template) {
        frappe.call({
            method: "frappe.client.get",
            args: {
                doctype: "Journal Entry Template",
                name: values.template
            },
            callback: (r) => {
                if (r.message) {
                    this.processTemplateBasedEntry(frm, values, r.message, submitDoc, createNew);
                } else {
                    // Fallback to basic row creation
                    this.createBasicEntryRows(frm, values);
                    this.finishQuickEntry(frm, submitDoc, createNew);
                }
            },
            error: () => {
                // In case of error, create basic rows
                this.createBasicEntryRows(frm, values);
                this.finishQuickEntry(frm, submitDoc, createNew);
            }
        });
    } else {
        // No template, create basic rows
        this.createBasicEntryRows(frm, values);
        this.finishQuickEntry(frm, submitDoc, createNew);
    }
};

// Create basic debit and credit rows
erpnext.journal_entry_utils.createBasicEntryRows = function(frm, values) {
    // Clear the table first
    frm.clear_table("accounts");
    
    // Add the debit row
    var debitRow = frm.fields_dict.accounts.grid.add_new_row();
    if (values.debit_account) {
        frappe.model.set_value(debitRow.doctype, debitRow.name, "account", values.debit_account);
    }
    frappe.model.set_value(
        debitRow.doctype,
        debitRow.name,
        "debit_in_account_currency",
        values.debit || values.totalization || 0
    );
    
    // Add the credit row
    var creditRow = frm.fields_dict.accounts.grid.add_new_row();
    if (values.credit_account) {
        frappe.model.set_value(creditRow.doctype, creditRow.name, "account", values.credit_account);
    }
    frappe.model.set_value(
        creditRow.doctype,
        creditRow.name,
        "credit_in_account_currency",
        values.debit || values.totalization || 0
    );
    
    refresh_field("accounts");
};

// Process an entry based on a template
erpnext.journal_entry_utils.processTemplateBasedEntry = function(frm, values, templateDoc, submitDoc, createNew) {
    // Preparation - clear and set base values
    frm.clear_table("accounts");
    
    if (templateDoc.voucher_type) {
        frm.set_value("voucher_type", templateDoc.voucher_type);
    }
    
    // Configuration
    const debit = values.credit_or_debit == "Debit" ? values.totalization : 0;
    const credit = values.credit_or_debit == "Credit" ? values.totalization : 0;
    
    // Add the main row
    if (templateDoc.accounting_entry_totalization && templateDoc.accounting_entry_totalization.length > 0) {
        const totalizationDoc = templateDoc.accounting_entry_totalization[0];
        const totalizationRow = frm.fields_dict.accounts.grid.add_new_row();
        
        this.populateRow(
            totalizationRow.doctype,
            totalizationRow.name,
            [
                totalizationDoc.account,
                totalizationDoc.party_type,
                totalizationDoc.party,
                debit,
                credit,
                totalizationDoc.user_remark
            ]
        );
    }
    
    // Add the counterparty rows
    if (templateDoc.accounting_entry_counterparty && templateDoc.accounting_entry_counterparty.length > 0) {
        const uniqueCounterparty = templateDoc.accounting_entry_counterparty.length == 1;
        const amount = uniqueCounterparty ? values.totalization : (values.totalization / templateDoc.accounting_entry_counterparty.length);
        
        templateDoc.accounting_entry_counterparty.forEach((counterparty, index) => {
            const counterpartyRow = frm.fields_dict.accounts.grid.add_new_row();
            
            // Create the row based on the mode (debit/credit)
            const counterpartyDebit = values.credit_or_debit == "Credit" ? amount : 0;
            const counterpartyCredit = values.credit_or_debit == "Debit" ? amount : 0;
            
            this.populateRow(
                counterpartyRow.doctype,
                counterpartyRow.name,
                [
                    counterparty.account,
                    counterparty.party_type,
                    counterparty.party,
                    counterpartyDebit,
                    counterpartyCredit,
                    counterparty.user_remark
                ]
            );
        });
    }
    
    refresh_field("accounts");
    this.finishQuickEntry(frm, submitDoc, createNew);
};

// Finalize quick entry
erpnext.journal_entry_utils.finishQuickEntry = function(frm, submitDoc, createNew) {
    // VAT processing if necessary - before saving
    if (!frm.doc.disable_calculation) {
        // Sequentially process all non-VAT rows for VAT row creation
        let promises = [];
        let vatRowsAdded = 0;

        // Get all non-VAT rows
        const sourceRows = frm.doc.accounts.filter(row => 
            !row._is_vat_line && 
            !row.account?.includes('TVA')
        );
        
        // Iterate over all non-VAT rows and add VAT rows if necessary
        sourceRows.forEach((row, index) => {
            // Configure VAT listeners if they are not already set up
            if (!row._tva_watcher_setup && erpnext.journal_entry_utils.setupVatListener) {
                erpnext.journal_entry_utils.setupVatListener(frm, row);
            }
            
            // Trigger VAT processing manually for this row
            let promise = new Promise(resolve => {
                // Small delay between each processing to avoid conflicts
                setTimeout(() => {                    
                    if (erpnext.journal_entry_utils.processTVA) {
                        // Déclencher le calcul TVA
                        erpnext.journal_entry_utils.processTVA(frm, row);
                        
                        // Check if VAT row has been added
                        setTimeout(() => {
                            const vatRow = erpnext.journal_entry_utils.findVatRow(frm, row, null);
                            if (vatRow) {
                                
                                // Ensure correct and proper association
                                if (!vatRow._source_row_id || vatRow._source_row_id !== row.name) {
                                    vatRow._source_row_id = row.name;
                                    
                                    // Ensure the source row recognizes its VAT row
                                    if (!row._has_vat_line) {
                                        row._has_vat_line = true;
                                        row._vat_row_id = vatRow.name;
                                    }
                                }
                                
                                vatRowsAdded++;
                            }
                            resolve();
                        }, 300);
                    } else {
                        resolve();
                    }
                }, index * 400); // Wait 400ms between each processing
            });
            
            promises.push(promise);
        });
        
        // Wait for all VAT processing to complete before saving
        Promise.all(promises).then(() => {            
            // Update differences before saving
            if (cur_frm && cur_frm.cscript.update_totals) {
                console.log("[DEBUG] finishQuickEntry: updating totals");
                cur_frm.cscript.update_totals(frm.doc);
            }
            
            // Check and fix missing associations
            frm.doc.accounts.forEach(row => {
                // For each non-VAT row, check if it has associated VAT rows
                if (row.account && !row.account.includes('TVA')) {
                    frm.doc.accounts.forEach(vatRow => {
                        if (vatRow.account && vatRow.account.includes('TVA') && 
                            vatRow.user_remark && vatRow.user_remark.includes(row.account) &&
                            !vatRow._source_row_id) {
                            
                            // Establish missing association
                            vatRow._is_vat_line = true;
                            vatRow._source_row_id = row.name;
                            row._has_vat_line = true;
                            row._vat_row_id = vatRow.name;
                        }
                    });
                }
            });
            
            // Reposition VAT rows before saving
            if (erpnext.journal_entry_utils.repositionVatRows) {
                console.log("[DEBUG] finishQuickEntry: repositionnement des lignes TVA");
                erpnext.journal_entry_utils.repositionVatRows(frm);
            }
            
            // Save after all VAT processing
            setTimeout(this.saveDocument.bind(this, frm, submitDoc, createNew), 500);
        });
    } else {
        // If VAT calculation is disabled, save directly
        setTimeout(this.saveDocument.bind(this, frm, submitDoc, createNew), 500);
    }
};

// Function to save the document
erpnext.journal_entry_utils.saveDocument = function(frm, submitDoc, createNew) {
    frm.save().then(() => {
        if (submitDoc) {
            // Submit after saving
            frm.savesubmit().then(() => {
                if (createNew) {
                    setTimeout(() => {
                        frappe.new_doc("Journal Entry");
                    }, 1000);
                }
            }).catch((err) => {
                console.error("Error during submission:", err);
                frappe.msgprint({
                    title: __("Submission Error"),
                    indicator: "red",
                    message: __("Error during submission. Please verify the data and try again.")
                });
            });
        } else if (createNew) {
            // Create a new document
            setTimeout(() => {
                frappe.new_doc("Journal Entry");
            }, 1000);
        }
    }).catch((err) => {
        console.error("Error during saving:", err);
        frappe.msgprint({
            title: __("Error"),
            indicator: "red",
            message: __("Error during saving. Please try again.")
        });
    });
};

frappe.ui.form.on("Journal Entry", {
	setup: function (frm) {
		frm.add_fetch("bank_account", "account", "account");
		frm.ignore_doctypes_on_cancel_all = [
			"Sales Invoice",
			"Purchase Invoice",
			"Journal Entry",
			"Repost Payment Ledger",
			"Asset",
			"Asset Movement",
			"Asset Depreciation Schedule",
			"Repost Accounting Ledger",
			"Unreconcile Payment",
			"Unreconcile Payment Entries",
			"Bank Transaction",
		];

		// Ensure our utility module is available
		frappe.provide("erpnext.journal_entry_utils");
		
		// Check the VAT accounting method to hide/show relevant fields
		erpnext.journal_entry_utils.getCompanyVatInfo(frm.doc.company, (vatInfo) => {
		    if (!vatInfo.isVatCompany) {
		        // Non-VAT company: hide fields and disable calculation
		        frm.set_df_property("disable_calculation", "hidden", 1);
		        frm.set_df_property("is_vat_excluded", "hidden", 1);
		        frm.set_value("disable_calculation", 1);
		    } else if (vatInfo.vatMethod && vatInfo.vatMethod.includes("Flat")) {
		        frm.set_df_property("disable_calculation", "hidden", 1);
		        frm.set_df_property("is_vat_excluded", "hidden", 1);
		        frm.set_value("disable_calculation", 1);
		    } else {
		        frm.set_df_property("disable_calculation", "hidden", 0);
		        frm.set_df_property("is_vat_excluded", "hidden", 0);
		    }
		});

		frm.doc.accounts = frm.doc.accounts || [];
		frm.doc.accounts.forEach(row => {
		    if (erpnext.journal_entry_utils && erpnext.journal_entry_utils.setupVatListener) {
		        erpnext.journal_entry_utils.setupVatListener(frm, row);
		    } else {
		        console.warn("Function setupVatListener not available!");
		    }
		});
	},

	refresh: function (frm) {
		erpnext.toggle_naming_series();
		
		erpnext.journal_entry_utils.getCompanyVatInfo(frm.doc.company, (vatInfo) => {
		    if (!vatInfo.isVatCompany) {
		        // Non-VAT company: hide fields and disable calculation
		        frm.set_df_property("disable_calculation", "hidden", 1);
		        frm.set_df_property("is_vat_excluded", "hidden", 1);
		        if (frm.doc.docstatus === 0) {
		            frm.set_value("disable_calculation", 1);
		        }
		    } else if (vatInfo.vatMethod && vatInfo.vatMethod.includes("Flat")) {
		        frm.set_df_property("disable_calculation", "hidden", 1);
		        frm.set_df_property("is_vat_excluded", "hidden", 1);
		        if (frm.doc.docstatus === 0) {
		            frm.set_value("disable_calculation", 1);
		        }
		    } else {
		        frm.set_df_property("disable_calculation", "hidden", 0);
		        frm.set_df_property("is_vat_excluded", "hidden", 0);
		    }
		});

        if (frm.doc.docstatus == 0) {
            frm.add_custom_button(__('Quick Entry'), function() {
                return erpnext.journal_entry.quick_entry(frm);
            });
            
            // Bouton pour repositionner manuellement les lignes TVA
            if (frm.doc.accounts && frm.doc.accounts.some(row => row.account && row.account.includes('TVA'))) {
                frm.add_custom_button(__('Réorganiser lignes TVA'), function() {
                    if (erpnext.journal_entry_utils) {
                        // Check associations first
                        frm.doc.accounts.forEach(row => {
                            // For each non-VAT row, search for potential VAT rows
                            if (row.account && !row.account.includes('TVA')) {
                                frm.doc.accounts.forEach(vatRow => {
                                    if (vatRow.account && vatRow.account.includes('TVA') && 
                                        vatRow.user_remark && vatRow.user_remark.includes(row.account) &&
                                        !vatRow._source_row_id) {
                                        
                                        // Establish the missing association
                                        vatRow._is_vat_line = true;
                                        vatRow._source_row_id = row.name;
                                        row._has_vat_line = true;
                                        row._vat_row_id = vatRow.name;
                                    }
                                });
                            }
                        });
                        
                        // Apply repositioning
                        if (erpnext.journal_entry_utils.repositionVatRows) {
                            erpnext.journal_entry_utils.repositionVatRows(frm);
                            frappe.show_alert({
                                message: __("VAT lines repositioned successfully"),
                                indicator: 'green'
                            }, 3);
                        }
                    }
                }, __("Actions"));
            }
        }
		if (frm.doc.docstatus > 0) {
			frm.add_custom_button(__('Quick Entry'), function() {
                return erpnext.journal_entry.quick_entry(frm);
            });
			frm.add_custom_button(
				__("Ledger"),
				function () {
					frappe.route_options = {
						voucher_no: frm.doc.name,
						from_date: frm.doc.posting_date,
						to_date: moment(frm.doc.modified).format("YYYY-MM-DD"),
						company: frm.doc.company,
						finance_book: frm.doc.finance_book,
						categorize_by: "",
						show_cancelled_entries: frm.doc.docstatus === 2,
					};
					frappe.set_route("query-report", "General Ledger");
				},
				__("View")
			);
		}

		if (frm.doc.docstatus == 1) {
			frm.add_custom_button(
				__("Reverse Journal Entry"),
				function () {
					return erpnext.journal_entry.reverse_journal_entry(frm);
				},
				__("Actions")
			);
		}

		if (frm.doc.__islocal) {
            erpnext.journal_entry.quick_entry(frm);
			frm.add_custom_button(__("Quick Entry"), function () {
				return erpnext.journal_entry.quick_entry(frm);
			});
		}

		// hide /unhide fields based on currency
		erpnext.journal_entry.toggle_fields_based_on_currency(frm);

		if (
			frm.doc.voucher_type == "Inter Company Journal Entry" &&
			frm.doc.docstatus == 1 &&
			!frm.doc.inter_company_journal_entry_reference
		) {
			frm.add_custom_button(
				__("Create Inter Company Journal Entry"),
				function () {
					frm.trigger("make_inter_company_journal_entry");
				},
				__("Make")
			);
		}

		erpnext.accounts.unreconcile_payment.add_unreconcile_btn(frm);
		
		if (frm.doc.docstatus == 0) {
		    // Check if our utility module is available
		    frappe.provide("erpnext.journal_entry_utils");
		    
		    // Verify and reconfigure VAT listeners (for new rows)
		    frm.doc.accounts = frm.doc.accounts || [];
		    frm.doc.accounts.forEach(row => {
		        if (!row._tva_watcher_setup && erpnext.journal_entry_utils.setupVatListener) {
		            console.log("Configuration écouteur TVA - refresh", row.idx);
		            erpnext.journal_entry_utils.setupVatListener(frm, row);
		        }
		    });
		    
		    // Verify and enforce VAT rows consistency
		    if (erpnext.journal_entry_utils.enforceVatRowsConsistency) {
		        console.log("Vérification cohérence TVA - refresh");
		        erpnext.journal_entry_utils.enforceVatRowsConsistency(frm);
		    }
		}
	},
	before_save: function (frm) {
		if (frm.doc.docstatus == 0 && !frm.doc.is_system_generated) {
			let payment_entry_references = frm.doc.accounts.filter(
				(elem) => elem.reference_type == "Payment Entry"
			);
			if (payment_entry_references.length > 0) {
				let rows = payment_entry_references.map((x) => "#" + x.idx);
				frappe.throw(
					__("Rows: {0} have 'Payment Entry' as reference_type. This should not be set manually.", [
						frappe.utils.comma_and(rows),
					])
				);
			}
		}
	},
	make_inter_company_journal_entry: function (frm) {
		var d = new frappe.ui.Dialog({
			title: __("Select Company"),
			fields: [
				{
					fieldname: "company",
					fieldtype: "Link",
					label: __("Company"),
					options: "Company",
					get_query: function () {
						return {
							filters: [["Company", "name", "!=", frm.doc.company]],
						};
					},
					reqd: 1,
				},
			],
		});
		d.set_primary_action(__("Create"), function () {
			d.hide();
			var args = d.get_values();
			frappe.call({
				args: {
					name: frm.doc.name,
					voucher_type: frm.doc.voucher_type,
					company: args.company,
				},
				method: "erpnext.accounts.doctype.journal_entry.journal_entry.make_inter_company_journal_entry",
				callback: function (r) {
					if (r.message) {
						var doc = frappe.model.sync(r.message)[0];
						frappe.set_route("Form", doc.doctype, doc.name);
					}
				},
			});
		});
		d.show();
	},

	multi_currency: function (frm) {
		erpnext.journal_entry.toggle_fields_based_on_currency(frm);
	},

	posting_date: function (frm) {
		if (!frm.doc.multi_currency || !frm.doc.posting_date) return;

		$.each(frm.doc.accounts || [], function (i, row) {
			erpnext.journal_entry.set_exchange_rate(frm, row.doctype, row.name);
		});
	},

	company: function (frm) {
		frappe.call({
			method: "frappe.client.get_value",
			args: {
				doctype: "Company",
				filters: { name: frm.doc.company },
				fieldname: "cost_center",
			},
			callback: function (r) {
				if (r.message) {
					$.each(frm.doc.accounts || [], function (i, jvd) {
						frappe.model.set_value(jvd.doctype, jvd.name, "cost_center", r.message.cost_center);
					});
				}
			},
		});

		erpnext.accounts.dimensions.update_dimension(frm, frm.doctype);
		
		erpnext.journal_entry_utils.getCompanyVatInfo(frm.doc.company, (vatInfo) => {
		    if (!vatInfo.isVatCompany) {
		        // Non-VAT company: hide fields and disable calculation
		        frm.set_df_property("disable_calculation", "hidden", 1);
		        frm.set_df_property("is_vat_excluded", "hidden", 1);
		        frm.set_value("disable_calculation", 1);
		    } else if (vatInfo.vatMethod && vatInfo.vatMethod.includes("Flat")) {
		        frm.set_df_property("disable_calculation", "hidden", 1);
		        frm.set_df_property("is_vat_excluded", "hidden", 1);
		        frm.set_value("disable_calculation", 1);
		    } else {
		        frm.set_df_property("disable_calculation", "hidden", 0);
		        frm.set_df_property("is_vat_excluded", "hidden", 0);
		    }
		});
		erpnext.utils.set_letter_head(frm);
	},

	voucher_type: function (frm) {
		if (!frm.doc.company) return null;

		if (
			!(frm.doc.accounts || []).length ||
			((frm.doc.accounts || []).length === 1 && !frm.doc.accounts[0].account)
		) {
			if (["Bank Entry", "Cash Entry"].includes(frm.doc.voucher_type)) {
				return frappe.call({
					type: "GET",
					method: "erpnext.accounts.doctype.journal_entry.journal_entry.get_default_bank_cash_account",
					args: {
						account_type:
							frm.doc.voucher_type == "Bank Entry"
								? "Bank"
								: frm.doc.voucher_type == "Cash Entry"
								? "Cash"
								: null,
						company: frm.doc.company,
					},
					callback: function (r) {
						if (r.message) {
							// If default company bank account not set
							if (!$.isEmptyObject(r.message)) {
								update_jv_details(frm.doc, [r.message]);
							}
						}
					},
				});
			}
		}
	},

	from_template: function (frm) {
		if (frm.doc.from_template) {
			frappe.db.get_doc("Journal Entry Template", frm.doc.from_template).then((doc) => {
				frappe.model.clear_table(frm.doc, "accounts");
				frm.set_value({
					company: doc.company,
					voucher_type: doc.voucher_type,
					naming_series: doc.naming_series,
					is_opening: doc.is_opening,
					multi_currency: doc.multi_currency,
				});
				update_jv_details(frm.doc, doc.accounts);
			});
		}
	},
});

var update_jv_details = function (doc, r) {
	$.each(r, function (i, d) {
		var row = frappe.model.add_child(doc, "Journal Entry Account", "accounts");
		frappe.model.set_value(row.doctype, row.name, "account", d.account);
		
		// Ensure our utility module is available
		frappe.provide("erpnext.journal_entry_utils");
		
		if (erpnext.journal_entry_utils && erpnext.journal_entry_utils.setupVatListener) {
		    setTimeout(() => {
		        const localRow = locals[row.doctype][row.name];
		        if (localRow) {
		            erpnext.journal_entry_utils.setupVatListener(cur_frm, localRow);
		        }
		    }, 200);
		} else {
		    console.warn("Function setupVatListener not available!");
		}
	});
	refresh_field("accounts");
};

erpnext.accounts.JournalEntry = class JournalEntry extends frappe.ui.form.Controller {
	onload() {
		this.load_defaults();
		this.setup_queries();
		erpnext.accounts.dimensions.setup_dimension_filters(this.frm, this.frm.doctype);
	}

	onload_post_render() {
		cur_frm.get_field("accounts").grid.set_multiple_add("account");
	}

	load_defaults() {
		//this.frm.show_print_first = true;
		if (this.frm.doc.__islocal && this.frm.doc.company) {
			frappe.model.set_default_values(this.frm.doc);
			$.each(this.frm.doc.accounts || [], function (i, jvd) {
				frappe.model.set_default_values(jvd);
			});
			var posting_date = this.frm.doc.posting_date;
			if (!this.frm.doc.amended_from)
				this.frm.set_value("posting_date", posting_date || frappe.datetime.get_today());
		}
	}

	setup_queries() {
		var me = this;

		me.frm.set_query("account", "accounts", function (doc, cdt, cdn) {
			return erpnext.journal_entry.account_query(me.frm);
		});

		me.frm.set_query("party_type", "accounts", function (doc, cdt, cdn) {
			const row = locals[cdt][cdn];

			return {
				query: "erpnext.setup.doctype.party_type.party_type.get_party_type",
				filters: {
					account: row.account,
				},
			};
		});

		me.frm.set_query("reference_name", "accounts", function (doc, cdt, cdn) {
			var jvd = frappe.get_doc(cdt, cdn);

			// journal entry
			if (jvd.reference_type === "Journal Entry") {
				frappe.model.validate_missing(jvd, "account");
				return {
					query: "erpnext.accounts.doctype.journal_entry.journal_entry.get_against_jv",
					filters: {
						account: jvd.account,
						party: jvd.party,
					},
				};
			}

			var out = {
				filters: [[jvd.reference_type, "docstatus", "=", 1]],
			};

			if (["Sales Invoice", "Purchase Invoice"].includes(jvd.reference_type)) {
				out.filters.push([jvd.reference_type, "outstanding_amount", "!=", 0]);
				// Filter by cost center
				if (jvd.cost_center) {
					out.filters.push([jvd.reference_type, "cost_center", "in", ["", jvd.cost_center]]);
				}
				// account filter
				frappe.model.validate_missing(jvd, "account");
				var party_account_field = jvd.reference_type === "Sales Invoice" ? "debit_to" : "credit_to";
				out.filters.push([jvd.reference_type, party_account_field, "=", jvd.account]);
			}

			if (["Sales Order", "Purchase Order"].includes(jvd.reference_type)) {
				// party_type and party mandatory
				frappe.model.validate_missing(jvd, "party_type");
				frappe.model.validate_missing(jvd, "party");

				out.filters.push([jvd.reference_type, "per_billed", "<", 100]);
			}

			if (jvd.party_type && jvd.party) {
				let party_field = "";
				if (jvd.reference_type.indexOf("Sales") === 0) {
					party_field = "customer";
				} else if (jvd.reference_type.indexOf("Purchase") === 0) {
					party_field = "supplier";
				}

				if (party_field) {
					out.filters.push([jvd.reference_type, party_field, "=", jvd.party]);
				}
			}

			return out;
		});
	}

	reference_name(doc, cdt, cdn) {
		var d = frappe.get_doc(cdt, cdn);

		if (d.reference_name) {
			if (d.reference_type === "Purchase Invoice" && !flt(d.debit)) {
				this.get_outstanding("Purchase Invoice", d.reference_name, doc.company, d);
			} else if (d.reference_type === "Sales Invoice" && !flt(d.credit)) {
				this.get_outstanding("Sales Invoice", d.reference_name, doc.company, d);
			} else if (d.reference_type === "Journal Entry" && !flt(d.credit) && !flt(d.debit)) {
				this.get_outstanding("Journal Entry", d.reference_name, doc.company, d);
			}
		}
	}

	get_outstanding(doctype, docname, company, child) {
		var args = {
			doctype: doctype,
			docname: docname,
			party: child.party,
			account: child.account,
			account_currency: child.account_currency,
			company: company,
		};

		return frappe.call({
			method: "erpnext.accounts.doctype.journal_entry.journal_entry.get_outstanding",
			args: { args: args },
			callback: function (r) {
				if (r.message) {
					$.each(r.message, function (field, value) {
						frappe.model.set_value(child.doctype, child.name, field, value);
					});
				}
			},
		});
	}

	accounts_add(doc, cdt, cdn) {
		var row = frappe.get_doc(cdt, cdn);
		row.exchange_rate = 1;
		$.each(doc.accounts, function (i, d) {
			if (d.account && d.party && d.party_type) {
				row.account = d.account;
				row.party = d.party;
				row.party_type = d.party_type;
				row.exchange_rate = d.exchange_rate;
			}
		});

		// set difference
		if (doc.difference) {
			if (doc.difference > 0) {
				row.credit_in_account_currency = doc.difference / row.exchange_rate;
				row.credit = doc.difference;
			} else {
				row.debit_in_account_currency = -doc.difference / row.exchange_rate;
				row.debit = -doc.difference;
			}
		}
		cur_frm.cscript.update_totals(doc);

		erpnext.accounts.dimensions.copy_dimension_from_first_row(this.frm, cdt, cdn, "accounts");
		
		// Ensure our utility module is available
		frappe.provide("erpnext.journal_entry_utils");
		
		if (erpnext.journal_entry_utils && erpnext.journal_entry_utils.setupVatListener) {
		    setTimeout(() => {
		        erpnext.journal_entry_utils.setupVatListener(cur_frm, row);
		    }, 200);
		} else {
		    console.warn("Function setupVatListener not available!");
		}
	}
};

cur_frm.script_manager.make(erpnext.accounts.JournalEntry);

cur_frm.cscript.update_totals = function (doc) {
	var td = 0.0;
	var tc = 0.0;
	var accounts = doc.accounts || [];
	for (var i in accounts) {
		td += flt(accounts[i].debit, precision("debit", accounts[i]));
		tc += flt(accounts[i].credit, precision("credit", accounts[i]));
	}
	doc = locals[doc.doctype][doc.name];
	doc.total_debit = td;
	doc.total_credit = tc;
	doc.difference = flt(td - tc, precision("difference"));
	refresh_many(["total_debit", "total_credit", "difference"]);
};

cur_frm.cscript.get_balance = function (doc, dt, dn) {
	cur_frm.cscript.update_totals(doc);
	cur_frm.call("get_balance", null, () => {
		cur_frm.refresh();
	});
};

cur_frm.cscript.validate = function (doc, cdt, cdn) {
	cur_frm.cscript.update_totals(doc);
};

frappe.ui.form.on("Journal Entry Account", {
	party: function (frm, cdt, cdn) {
		var d = frappe.get_doc(cdt, cdn);
		if (!d.account && d.party_type && d.party) {
			if (!frm.doc.company) frappe.throw(__("Please select Company"));
			return frm.call({
				method: "erpnext.accounts.doctype.journal_entry.journal_entry.get_party_account_and_currency",
				child: d,
				args: {
					company: frm.doc.company,
					party_type: d.party_type,
					party: d.party,
				},
			});
		}
	},

	account: function (frm, dt, dn) {
		erpnext.journal_entry.set_account_details(frm, dt, dn);
		
		const row = locals[dt][dn];
		
		// Ensure our utility module is available
		frappe.provide("erpnext.journal_entry_utils");
		
		if (row && erpnext.journal_entry_utils && erpnext.journal_entry_utils.processTVA) {
		    setTimeout(() => {
		        erpnext.journal_entry_utils.processTVA(frm, row);
		    }, 200);
		} else if (row) {
		    console.warn("Function processTVA not available!");
		}
	},

	debit_in_account_currency: function (frm, cdt, cdn) {
		erpnext.journal_entry.set_exchange_rate(frm, cdt, cdn);
		
		var d = locals[cdt][cdn];
		
		// Ensure our utility module is available
		frappe.provide("erpnext.journal_entry_utils");
		
		// Use forceDirect to avoid loop issues
		if (d.debit_in_account_currency > 0 && d.credit_in_account_currency > 0) {
		    if (erpnext.journal_entry_utils.forceDirect) {
		        erpnext.journal_entry_utils.forceDirect(d, {
		            credit: 0
		        });
		    } else {
		        d.credit_in_account_currency = 0;
		        d.credit = 0;
		        refresh_field("accounts");
		    }
		}
		
		// Trigger VAT calculation
		if (d && erpnext.journal_entry_utils && erpnext.journal_entry_utils.processTVA) {
		    setTimeout(() => {
		        erpnext.journal_entry_utils.processTVA(frm, d);
		    }, 200);
		} else if (d) {
		    console.warn("Function processTVA not available!");
		}
	},

	credit_in_account_currency: function (frm, cdt, cdn) {
		erpnext.journal_entry.set_exchange_rate(frm, cdt, cdn);
		
		var d = locals[cdt][cdn];
		
		// Ensure our utility module is available
		frappe.provide("erpnext.journal_entry_utils");
		
		// Use forceDirect to avoid loop issues
		if (d.debit_in_account_currency > 0 && d.credit_in_account_currency > 0) {
		    if (erpnext.journal_entry_utils.forceDirect) {
		        erpnext.journal_entry_utils.forceDirect(d, {
		            debit: 0
		        });
		    } else {
		        d.debit_in_account_currency = 0;
		        d.debit = 0;
		        refresh_field("accounts");
		    }
		}
		
		// Trigger VAT calculation
		if (d && erpnext.journal_entry_utils && erpnext.journal_entry_utils.processTVA) {
		    setTimeout(() => {
		        erpnext.journal_entry_utils.processTVA(frm, d);
		    }, 200);
		} else if (d) {
		    console.warn("Function processTVA not available!");
		}
	},

	debit: function (frm, dt, dn) {
		cur_frm.cscript.update_totals(frm.doc);
	},

	credit: function (frm, dt, dn) {
		cur_frm.cscript.update_totals(frm.doc);
	},

	exchange_rate: function (frm, cdt, cdn) {
		var company_currency = frappe.get_doc(":Company", frm.doc.company).default_currency;
		var row = locals[cdt][cdn];

		if (row.account_currency == company_currency || !frm.doc.multi_currency) {
			frappe.model.set_value(cdt, cdn, "exchange_rate", 1);
		}

		erpnext.journal_entry.set_debit_credit_in_company_currency(frm, cdt, cdn);
	},
});

frappe.ui.form.on("Journal Entry Account", "accounts_remove", function (frm) {
	cur_frm.cscript.update_totals(frm.doc);
});

$.extend(erpnext.journal_entry, {
	toggle_fields_based_on_currency: function (frm) {
		var fields = ["currency_section", "account_currency", "exchange_rate", "debit", "credit"];

		var grid = frm.get_field("accounts").grid;
		if (grid) grid.set_column_disp(fields, frm.doc.multi_currency);

		// dynamic label
		var field_label_map = {
			debit_in_account_currency: "Debit",
			credit_in_account_currency: "Credit",
		};

		$.each(field_label_map, function (fieldname, label) {
			frm.fields_dict.accounts.grid.update_docfield_property(
				fieldname,
				"label",
				frm.doc.multi_currency ? label + " in Account Currency" : label
			);
		});
	},

	set_debit_credit_in_company_currency: function (frm, cdt, cdn) {
		var row = locals[cdt][cdn];

		frappe.model.set_value(
			cdt,
			cdn,
			"debit",
			flt(flt(row.debit_in_account_currency) * row.exchange_rate, precision("debit", row))
		);

		frappe.model.set_value(
			cdt,
			cdn,
			"credit",
			flt(flt(row.credit_in_account_currency) * row.exchange_rate, precision("credit", row))
		);

		cur_frm.cscript.update_totals(frm.doc);
	},

	set_exchange_rate: function (frm, cdt, cdn) {
		var company_currency = frappe.get_doc(":Company", frm.doc.company).default_currency;
		var row = locals[cdt][cdn];

		if (row.account_currency == company_currency || !frm.doc.multi_currency) {
			row.exchange_rate = 1;
			erpnext.journal_entry.set_debit_credit_in_company_currency(frm, cdt, cdn);
		} else if (!row.exchange_rate || row.exchange_rate == 1 || row.account_type == "Bank") {
			frappe.call({
				method: "erpnext.accounts.doctype.journal_entry.journal_entry.get_exchange_rate",
				args: {
					posting_date: frm.doc.posting_date,
					account: row.account,
					account_currency: row.account_currency,
					company: frm.doc.company,
					reference_type: cstr(row.reference_type),
					reference_name: cstr(row.reference_name),
					debit: flt(row.debit_in_account_currency),
					credit: flt(row.credit_in_account_currency),
					exchange_rate: row.exchange_rate,
				},
				callback: function (r) {
					if (r.message) {
						row.exchange_rate = r.message;
						erpnext.journal_entry.set_debit_credit_in_company_currency(frm, cdt, cdn);
					}
				},
			});
		} else {
			erpnext.journal_entry.set_debit_credit_in_company_currency(frm, cdt, cdn);
		}
		refresh_field("exchange_rate", cdn, "accounts");
	},

	quick_entry: function(frm) {
        console.log("Quick entry");
        var naming_series_options = frm.fields_dict.naming_series.df.options;
        var naming_series_default =
            frm.fields_dict.naming_series.df.default || naming_series_options.split("\n")[0];

        var dialog = new frappe.ui.Dialog({
            title: __("Quick Journal Entry"),
            fields: [{
                    fieldtype: "Link",
                    label: __("Template"),
                    fieldname: "template",
                    options: "Journal Entry Template",
                    onchange: function() {
                        frappe.call({
                            method: "frappe.client.get",
                            args: {
                                doctype: "Journal Entry Template",
                                name: cur_dialog.get_value("template"),
                            },
                            callback(r) {
                                if (r.message) {
                                    var template_doc = r.message;
                                    cur_dialog.set_values({
                                        "credit_or_debit": template_doc.credit_or_debit,
                                        "totalization": template_doc.default_amount,
                                        "user_remark": template_doc.user_remark,
                                        "disable_calculation": template_doc.disable_calculation,
                                    });
                                    
                                    // Check company VAT info
                                    erpnext.journal_entry_utils.getCompanyVatInfo(frm.doc.company, (vatInfo) => {
                                        // If company is not subject to VAT, hide ALL VAT fields
                                        if (!vatInfo.isVatCompany) {
                                            cur_dialog.set_value("disable_calculation", 1);
                                            cur_dialog.set_df_property("disable_calculation", "hidden", 1);
                                            cur_dialog.set_df_property("is_vat_excluded", "hidden", 1);
                                        } else if (vatInfo.vatMethod && vatInfo.vatMethod.includes("Flat")) {
                                            // If flat-rate taxation, keep existing behavior
                                            cur_dialog.set_value("disable_calculation", 1);
                                            cur_dialog.set_value("is_vat_excluded", 0);
                                            cur_dialog.set_df_property("is_vat_excluded", "hidden", 1);
                                            cur_dialog.set_df_property("disable_calculation", "read_only", 1);
                                        } else {
                                            // Normal behavior for other methods
                                            cur_dialog.set_df_property("is_vat_excluded", "hidden", 0);
                                            cur_dialog.set_df_property("disable_calculation", "read_only", 0);

                                            // Update is_vat_excluded state based on disable_calculation
                                            const disableCalc = template_doc.disable_calculation;
                                            if (disableCalc) {
                                                cur_dialog.set_value("is_vat_excluded", 0);
                                                cur_dialog.set_df_property("is_vat_excluded", "read_only", 1);
                                            } else {
                                                cur_dialog.set_df_property("is_vat_excluded", "read_only", 0);
                                                // Set is_vat_excluded only if disable_calculation is not enabled
                                                cur_dialog.set_value("is_vat_excluded", template_doc.is_vat_excluded || 0);
                                            }
                                        }
                                    });
                                }
                            }
                        });
                    }
                },
                {
                    fieldtype: "Select",
                    fieldname: "credit_or_debit",
                    label: __("Credit / Debit"),
                    options: "Credit\nDebit",
                    reqd: 1
                },
                {
                    fieldtype: "Check",
                    fieldname: "disable_calculation",
                    label: __("Disable Automatic calculation"),
                    onchange: function() {
                        // If disable_calculation is checked, uncheck and disable is_vat_excluded
                        const disableCalc = cur_dialog.get_value("disable_calculation");
                        if (disableCalc) {
                            cur_dialog.set_value("is_vat_excluded", 0);
                            cur_dialog.set_df_property("is_vat_excluded", "read_only", 1);
                        } else {
                            // Check VAT info first before allowing editing
                            erpnext.journal_entry_utils.getCompanyVatInfo(frm.doc.company, (vatInfo) => {
                                // Only allow editing if company is subject to VAT and not flat-rate
                                if (vatInfo.isVatCompany && (!vatInfo.vatMethod || !vatInfo.vatMethod.includes("Flat"))) {
                                    cur_dialog.set_df_property("is_vat_excluded", "read_only", 0);
                                }
                            });
                        }
                    }
                },
                {
                    fieldtype: "Check",
                    fieldname: "is_vat_excluded",
                    label: __("Amount without tax")
                },
                {
                    fieldtype: "Currency",
                    fieldname: "totalization",
                    label: __("Amount"),
                    reqd: 1
                },
                {
                    fieldtype: "Date",
                    fieldname: "posting_date",
                    label: __("Date"),
                    reqd: 1,
                    default: localStorage.getItem('je_last_posting_date') || frm.doc.posting_date
                },
                {
                    fieldtype: "Small Text",
                    fieldname: "user_remark",
                    label: __("User Remark")
                },
            ],

            secondary_action_label: __("Submit & Create New"),
            secondary_action: function() {
                var values = dialog.get_values();
                
                // Check if totalization is 0 or negative
                if (values.totalization <= 0) {
                    frappe.throw(__("Amount cannot be zero or negative"));
                    return;
                }
                
                // Save posting date
                if (values.posting_date) {
                    localStorage.setItem('je_last_posting_date', values.posting_date);
                }
                
                // Use the utility function
                erpnext.journal_entry_utils.processQuickEntry(frm, values, true, true);
                
                dialog.hide();
            }
        });

        /**
         * Populates a journal entry row with the specified values
         * @param {string} dt - Document type (doctype)
         * @param {string} dn - Document name
         * @param {Array} values - Values to set for fields
         */
        function populate_row(dt, dn, values) {
            return erpnext.journal_entry_utils.populateRow(dt, dn, values);
        }

        dialog.set_primary_action(__("Save"), function() {
            var values = dialog.get_values();
            
            // Check if totalization is 0 or negative
            if (values.totalization <= 0) {
                frappe.throw(__("Amount cannot be zero or negative"));
                return;
            }
            
            // Save posting date
            if (values.posting_date) {
                localStorage.setItem('je_last_posting_date', values.posting_date);
            }
            
            // Use the utility function
            erpnext.journal_entry_utils.processQuickEntry(frm, values, false, false);
            
            dialog.hide();
        });

        // Check VAT info on dialog load
        erpnext.journal_entry_utils.getCompanyVatInfo(frm.doc.company, (vatInfo) => {
            // If company is not subject to VAT, hide ALL VAT fields
            if (!vatInfo.isVatCompany) {
                dialog.set_value("disable_calculation", 1);
                dialog.set_df_property("disable_calculation", "hidden", 1);
                dialog.set_df_property("is_vat_excluded", "hidden", 1);
            } else if (vatInfo.vatMethod && vatInfo.vatMethod.includes("Flat")) {
                // If flat-rate taxation, keep existing behavior
                dialog.set_value("disable_calculation", 1);
                dialog.set_df_property("disable_calculation", "read_only", 1);
                dialog.set_df_property("is_vat_excluded", "hidden", 1);
            }

            // Show dialog after verification
            dialog.show();
        });
    },

	account_query: function (frm) {
		var filters = {
			company: frm.doc.company,
			is_group: 0,
		};
		if (!frm.doc.multi_currency) {
			$.extend(filters, {
				account_currency: [
					"in",
					[frappe.get_doc(":Company", frm.doc.company).default_currency, null],
				],
			});
		}
		return { filters: filters };
	},

	reverse_journal_entry: function () {
		frappe.model.open_mapped_doc({
			method: "erpnext.accounts.doctype.journal_entry.journal_entry.make_reverse_journal_entry",
			frm: cur_frm,
		});
	},
});

// Initialize our VAT module
frappe.provide("erpnext.journal_entry_utils");

// Check if functions already exist
if (!erpnext.journal_entry_utils.setupVatListener) {
    $.extend(erpnext.journal_entry_utils, {
        setupVatListener: function(frm, row) {
            if (!row || row._tva_watcher_setup) return;
            
            // Mark as configured
            row._tva_watcher_setup = true;
            
            // Watch fields for VAT calculation
            frappe.model.on(row.doctype, row.name, "debit_in_account_currency", function(fieldname, value) {
                if (erpnext.journal_entry_utils.processTVA && !row._processing_tax && !row._skip_tax_recalc) {
                    // If credit also exists, set it to zero
                    if (row.credit_in_account_currency > 0) {
                        row.credit_in_account_currency = 0;
                        row.credit = 0;
                        refresh_field("accounts");
                    }
                    
                    setTimeout(() => {
                        erpnext.journal_entry_utils.processTVA(frm, row);
                    }, 200);
                }
            });
            
            frappe.model.on(row.doctype, row.name, "credit_in_account_currency", function(fieldname, value) {
                if (erpnext.journal_entry_utils.processTVA && !row._processing_tax && !row._skip_tax_recalc) {
                    // If debit also exists, set it to zero
                    if (row.debit_in_account_currency > 0) {
                        row.debit_in_account_currency = 0;
                        row.debit = 0;
                        refresh_field("accounts");
                    }
                    
                    setTimeout(() => {
                        erpnext.journal_entry_utils.processTVA(frm, row);
                    }, 200);
                }
            });
        }
    });
}

$.extend(erpnext.journal_entry, {
	set_account_details: function (frm, dt, dn) {
		var d = locals[dt][dn];
		if (d.account) {
			if (!frm.doc.company) frappe.throw(__("Please select Company first"));
			if (!frm.doc.posting_date) frappe.throw(__("Please select Posting Date first"));

			return frappe.call({
				method: "erpnext.accounts.doctype.journal_entry.journal_entry.get_account_details_and_party_type",
				args: {
					account: d.account,
					date: frm.doc.posting_date,
					company: frm.doc.company,
					debit: flt(d.debit_in_account_currency),
					credit: flt(d.credit_in_account_currency),
					exchange_rate: d.exchange_rate,
				},
				callback: function (r) {
					if (r.message) {
						$.extend(d, r.message);
						erpnext.journal_entry.set_amount_on_last_row(frm, dt, dn);
						erpnext.journal_entry.set_debit_credit_in_company_currency(frm, dt, dn);
						refresh_field("accounts");
					}
				},
			});
		}
	},
	set_amount_on_last_row: function (frm, dt, dn) {
		let row = locals[dt][dn];
		let length = frm.doc.accounts.length;
		if (row.idx != length) return;
		
		// Do not automatically balance for rows being processed for VAT
		// or if the document has a flag indicating that VAT processing is in progress
		if (row._processing_tax || row._is_vat_line || row._internal_update || frm.doc._skip_balance) {
			return;
		}

		let difference = frm.doc.accounts.reduce((total, row) => {
			if (row.idx == length) return total;

			return total + row.debit - row.credit;
		}, 0);

		if (difference) {
			if (difference > 0) {
				row.credit_in_account_currency = difference / row.exchange_rate;
				row.credit = difference;
			} else {
				row.debit_in_account_currency = -difference / row.exchange_rate;
				row.debit = -difference;
			}
		}
		refresh_field("accounts");
	},
});