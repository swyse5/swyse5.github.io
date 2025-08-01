// Salary Calculator for Golf Pick Submission

let currentSalaryCap = 100;

// Function to format salary with proper decimal places
function formatSalary(salary) {
    // Show cents only if there are non-zero cents
    return salary % 1 === 0 ? salary.toString() : salary.toFixed(2);
}

// Initialize salary calculator
document.addEventListener('DOMContentLoaded', function() {
    // Note: Change listeners for golfer selects are handled in golfer-rankings.js
    
    // Load settings and do initial calculation
    setTimeout(async () => {
        await loadSalarySettings();
        updateSalaryCalculator();
    }, 100);
});

// Load salary settings from JSON
async function loadSalarySettings() {
    try {
        const settings = await getSettings();
        currentSalaryCap = settings.salaryCap || 100;
        
        // Update UI elements
        document.getElementById('salaryCap').textContent = formatSalary(currentSalaryCap);
        document.getElementById('totalRemaining').textContent = formatSalary(currentSalaryCap);
        
        // Recalculate after loading settings
        updateSalaryCalculator();
    } catch (error) {
        console.error('Error loading salary settings:', error);
    }
}

// Calculate total salary used
function calculateTotalSalary() {
    let total = 0;
    const selectedGolfers = [];
    
    console.log('Calculating total salary...');
    
    // Calculate salary from main golfer selections
    const golferSelects = ['golfer1', 'golfer2', 'golfer3', 'golfer4'];
    golferSelects.forEach(selectId => {
        const select = document.getElementById(selectId);
        console.log(`Checking ${selectId}:`, {
            exists: !!select,
            value: select?.value,
            dataSalary: select?.dataset?.salary
        });
        
        if (select && select.value) {
            const salary = parseFloat(select.dataset.salary) || 0;
            console.log(`Adding ${select.value}: $${salary}`);
            total += salary;
            selectedGolfers.push({
                name: select.value,
                salary: salary,
                type: 'main'
            });
        }
    });
    

    
    return {
        total: total,
        golfers: selectedGolfers
    };
}

// Update the salary calculator display
function updateSalaryCalculator() {
    try {
        console.log('🔢 SALARY CALCULATOR: Starting update...');
        const result = calculateTotalSalary();
        console.log('Calculation result:', result);
        const totalUsed = result.total;
        const remaining = currentSalaryCap - totalUsed;
        const percentage = Math.min((totalUsed / currentSalaryCap) * 100, 100);
        console.log('Total used:', totalUsed, 'Remaining:', remaining);
        
        // Update display elements
        const totalUsedElement = document.getElementById('totalUsed');
        const totalRemainingElement = document.getElementById('totalRemaining');
        
        console.log('Found elements:', {
            totalUsed: !!totalUsedElement,
            totalRemaining: !!totalRemainingElement
        });
        
        if (totalUsedElement) {
            totalUsedElement.textContent = formatSalary(totalUsed);
        } else {
            console.error('totalUsed element not found');
        }
        if (totalRemainingElement) {
            totalRemainingElement.textContent = formatSalary(remaining);
        } else {
            console.error('totalRemaining element not found');
        }
    
    // Update hidden form fields for submission
    const totalSalaryHidden = document.getElementById('totalSalaryHidden');
    const salaryBreakdownHidden = document.getElementById('salaryBreakdownHidden');
    
    if (totalSalaryHidden) {
        totalSalaryHidden.value = totalUsed;
    }
    
    if (salaryBreakdownHidden) {
        const breakdown = result.golfers.map(g => `${g.name}: $${formatSalary(g.salary)} (${g.type})`).join(', ');
        salaryBreakdownHidden.value = breakdown;
    }
    
    // Update progress bar
    const progressBar = document.getElementById('budgetProgress');
    if (progressBar) {
        progressBar.style.width = percentage + '%';
        progressBar.setAttribute('aria-valuenow', percentage);
        
        // Update progress bar color based on budget status
        progressBar.className = 'progress-bar';
        if (totalUsed > currentSalaryCap) {
            progressBar.classList.add('bg-danger');
        } else if (totalUsed > currentSalaryCap * 0.9) {
            progressBar.classList.add('bg-warning');
        } else {
            progressBar.classList.add('bg-success');
        }
    } else {
        console.error('budgetProgress element not found');
    }
    
    // Show/hide budget warning
    const budgetWarning = document.getElementById('budgetWarning');
    if (budgetWarning) {
        if (totalUsed > currentSalaryCap) {
            budgetWarning.style.display = 'block';
            budgetWarning.innerHTML = `<i class="fas fa-exclamation-triangle"></i> You're $${formatSalary(totalUsed - currentSalaryCap)} over budget! Please adjust your selections.`;
        } else {
            budgetWarning.style.display = 'none';
        }
    } else {
        console.error('budgetWarning element not found');
    }
    
    // Update submit button state
    updateSubmitButton();
    
    // Check for duplicate selections
    checkForDuplicates(result.golfers);
    
    } catch (error) {
        console.error('Error updating salary calculator:', error);
    }
}

// Update submit button state
function updateSubmitButton() {
    const submitButton = document.querySelector('#pick-submission form button[type="submit"]');
    if (submitButton) {
        const result = calculateTotalSalary();
        const hasAllGolfers = result.golfers.length === 4;
        const isUnderBudget = result.total <= currentSalaryCap;
        const noDuplicates = !hasDuplicateSelections(result.golfers);
        
        // Check if form is administratively disabled
        const isFormAdminDisabled = submitButton.dataset.adminDisabled === 'true';
        
        if (isFormAdminDisabled) {
            // If admin has disabled the form, keep it disabled regardless of validation
            submitButton.disabled = true;
        } else {
            // Enable only if all conditions are met
            submitButton.disabled = !(hasAllGolfers && isUnderBudget && noDuplicates);
        }
        
        // Update button text to show status
        updateSubmitButtonText(hasAllGolfers, isUnderBudget, noDuplicates);
    }
}

// Update submit button text based on validation state
function updateSubmitButtonText(hasAllGolfers, isUnderBudget, noDuplicates) {
    const submitButton = document.querySelector('#pick-submission form button[type="submit"]');
    if (!submitButton) return;
    
    const isFormAdminDisabled = submitButton.dataset.adminDisabled === 'true';
    
    if (isFormAdminDisabled) {
        submitButton.textContent = 'Pick submission is currently closed';
        return;
    }
    
    if (!hasAllGolfers) {
        const result = calculateTotalSalary();
        const remaining = 4 - result.golfers.length;
        submitButton.textContent = `Select ${remaining} more golfer${remaining === 1 ? '' : 's'}`;
    } else if (!noDuplicates) {
        submitButton.textContent = 'Remove duplicate selections';
    } else if (!isUnderBudget) {
        submitButton.textContent = 'Reduce salary to submit';
    } else {
        submitButton.textContent = 'Submit Picks';
    }
}

// Check for duplicate golfer selections
function checkForDuplicates(golfers) {
    const names = golfers.map(g => g.name.toLowerCase());
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    
    // Remove existing duplicate warnings
    document.querySelectorAll('.duplicate-warning').forEach(el => el.remove());
    
    if (duplicates.length > 0) {
        const warningDiv = document.createElement('div');
        warningDiv.className = 'alert alert-danger duplicate-warning mt-2';
        warningDiv.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Duplicate selections found! Each golfer can only be selected once.`;
        
        document.querySelector('.salary-calculator').appendChild(warningDiv);
    }
}

// Check if there are duplicate selections
function hasDuplicateSelections(golfers) {
    const names = golfers.map(g => g.name.toLowerCase());
    return names.length !== new Set(names).size;
}

// Validate form before submission
function validatePicksForm(showMessage) {
    const result = calculateTotalSalary();
    
    // Check if exactly 4 golfers are selected
    if (result.golfers.length !== 4) {
        if (showMessage) {
            showMessage('Please select exactly 4 golfers.', true);
        }
        return false;
    }
    
    // Check if under budget
    if (result.total > currentSalaryCap) {
        if (showMessage) {
            showMessage(`Your total salary ($${formatSalary(result.total)}) exceeds the salary cap ($${formatSalary(currentSalaryCap)}). Please adjust your selections.`, true);
        }
        return false;
    }
    
    // Check for duplicates
    if (hasDuplicateSelections(result.golfers)) {
        if (showMessage) {
            showMessage('You cannot select the same golfer multiple times. Please choose different golfers.', true);
        }
        return false;
    }
    
    return true;
}

// Add validation to form submission
document.addEventListener('DOMContentLoaded', function() {
    const form = document.querySelector('#pick-submission form');
    if (form) {
        form.addEventListener('submit', function(e) {
            if (!validatePicksForm()) {
                e.preventDefault();
                return false;
            }
        });
    }
}); 