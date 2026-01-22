// Function to format salary with proper decimal places
function formatSalary(salary) {
    // Show cents only if there are non-zero cents
    return salary % 1 === 0 ? salary.toString() : salary.toFixed(2);
}

// Helper function to get golfer salaries (local testing or GitHub)
async function getGolferSalaries() {
    try {
        // Check for local testing data first
        const localRankings = localStorage.getItem('admin_local_rankings');
        if (localRankings) {
            console.log('Using local testing golfer salaries');
            return JSON.parse(localRankings);
        }
        
        // Fall back to GitHub data
        const response = await fetch('/data/rankings.json?' + new Date().getTime());
        return await response.json();
    } catch (error) {
        console.error('Error loading golfer salaries:', error);
        return { golfers: [] };
    }
}

// Function to populate a select element with golfer options
async function populateGolferSelect(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;

    try {
        // Store the currently selected value
        const currentValue = select.value;
        const currentSalary = select.dataset.salary;

        // Get golfer salaries from JSON file (or local testing data)
        const data = await getGolferSalaries();
        const golfers = data.golfers || [];

        // Sort golfers by salary (highest first)
        const sortedGolfers = golfers.sort((a, b) => b.salary - a.salary);

        // Clear existing options
        select.innerHTML = '<option value="" data-salary="0">Choose a golfer...</option>';
        
        // Add golfer options
        sortedGolfers.forEach(golfer => {
            if (golfer.name) {
                // Check if this golfer is already selected elsewhere (excluding current dropdown)
                const isDuplicate = isGolferDuplicateExcluding(golfer.name, selectId);
                
                // Skip adding this golfer if already selected in another dropdown
                if (isDuplicate) {
                    return;
                }
                
                const option = document.createElement('option');
                option.value = golfer.name;
                option.dataset.salary = golfer.salary;
                option.textContent = `${golfer.name} - $${formatSalary(golfer.salary)}`;
                
                select.appendChild(option);
            }
        });

        // Restore the previously selected value if it still exists in the options
        if (currentValue) {
            const exists = Array.from(select.options).some(option => option.value === currentValue);
            if (exists) {
                select.value = currentValue;
                select.dataset.salary = currentSalary;
            }
        }

        // Convert to searchable dropdown if not already done
        convertToSearchableDropdown(selectId, sortedGolfers);
    } catch (error) {
        console.error('Error loading golfer salaries:', error);
        select.innerHTML = '<option value="">Error loading golfers</option>';
    }
}

// Function to convert a regular select into a searchable dropdown
function convertToSearchableDropdown(selectId, golferData) {
    const select = document.getElementById(selectId);
    if (!select || select.dataset.searchable === 'true') return;

    // Mark as converted to prevent duplicate conversions
    select.dataset.searchable = 'true';

    // Create wrapper div
    const wrapper = document.createElement('div');
    wrapper.className = 'searchable-dropdown';
    wrapper.style.position = 'relative';
    
    // Create search input
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = select.className;
    searchInput.placeholder = 'Type to search golfers...';
    searchInput.disabled = select.disabled;
    searchInput.id = selectId + '_search';
    searchInput.autocomplete = 'off';
    searchInput.style.cursor = 'text';
    
    // Create dropdown list
    const dropdownList = document.createElement('div');
    dropdownList.className = 'searchable-dropdown-list';
    dropdownList.style.cssText = `
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: var(--bs-body-bg, #fff);
        border: 1px solid var(--bs-border-color, #dee2e6);
        border-top: none;
        border-radius: 0 0 4px 4px;
        max-height: 50vh;
        overflow-y: auto;
        z-index: 1000;
        display: none;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    `;

    // Hide original select
    select.style.display = 'none';

    // Insert wrapper before select
    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(searchInput);
    wrapper.appendChild(dropdownList);
    wrapper.appendChild(select);

    // Populate dropdown with golfers
    function populateDropdown(golfers, filter = '') {
        dropdownList.innerHTML = '';
        
        const filteredGolfers = golfers.filter(golfer => {
            const displayName = golfer.fullName || golfer.name;
            
            // Filter by search text
            if (!displayName.toLowerCase().includes(filter.toLowerCase())) {
                return false;
            }
            
            // Filter out golfers already selected in other dropdowns
            const isDuplicate = isGolferDuplicateExcluding(displayName, selectId);
            return !isDuplicate;
        });

        if (filteredGolfers.length === 0) {
            const noResults = document.createElement('div');
            noResults.className = 'dropdown-item disabled';
            noResults.style.cssText = 'padding: 8px 12px; color: #6c757d; cursor: default;';
            noResults.textContent = 'No golfers found';
            dropdownList.appendChild(noResults);
        } else {
            filteredGolfers.forEach(golfer => {
                const displayName = golfer.name;
                const item = document.createElement('div');
                item.className = 'dropdown-item';
                
                item.style.cssText = `
                    padding: 8px 12px;
                    cursor: pointer;
                    background: transparent;
                    border: none;
                    width: 100%;
                    text-align: left;
                    color: var(--bs-body-color, #212529);
                `;
                
                item.textContent = `${displayName} - $${formatSalary(golfer.salary)}`;
                item.dataset.value = displayName;
                item.dataset.salary = golfer.salary;
                
                // Hover effects
                item.addEventListener('mouseenter', () => {
                    item.style.backgroundColor = 'var(--bs-primary, #007bff)';
                    item.style.color = 'white';
                });
                item.addEventListener('mouseleave', () => {
                    item.style.backgroundColor = 'transparent';
                    item.style.color = 'var(--bs-body-color, #212529)';
                });
                
                // Click handler
                item.addEventListener('click', () => {
                    searchInput.value = `${displayName} - $${formatSalary(golfer.salary)}`;
                    select.value = displayName;
                    select.dataset.salary = golfer.salary;
                    dropdownList.style.display = 'none';
                    
                    console.log(`Searchable dropdown selected: ${displayName} ($${golfer.salary})`);
                    
                    // Trigger change event on original select
                    const changeEvent = new Event('change', { bubbles: true });
                    select.dispatchEvent(changeEvent);
                });
                
                dropdownList.appendChild(item);
            });
        }
    }

    // Search input event handlers
    searchInput.addEventListener('input', (e) => {
        const filter = e.target.value;
        populateDropdown(golferData, filter);
        dropdownList.style.display = 'block';
        
        // Clear select value if input doesn't match exactly
        const exactMatch = golferData.find(golfer => {
            const displayName = golfer.name;
            return `${displayName} - $${formatSalary(golfer.salary)}` === filter;
        });
        
        if (!exactMatch) {
            select.value = '';
            select.dataset.salary = '0';
            console.log(`Searchable input cleared: ${select.id} (salary reset to $0)`);
            
            // Trigger salary calculator update for cleared selection
            if (typeof updateSalaryCalculator === 'function') {
                updateSalaryCalculator();
            }
        }
    });

    searchInput.addEventListener('focus', () => {
        // Clear the formatted value when focusing to allow easy typing
        if (select.value) {
            searchInput.value = '';
        }
        populateDropdown(golferData, '');
        dropdownList.style.display = 'block';
    });

    searchInput.addEventListener('blur', (e) => {
        // Delay hiding to allow for clicks on dropdown items
        setTimeout(() => {
            if (!wrapper.contains(document.activeElement)) {
                dropdownList.style.display = 'none';
                
                // Restore the formatted value if a golfer was selected
                if (select.value) {
                    const selectedOption = Array.from(select.options).find(option => option.value === select.value);
                    if (selectedOption) {
                        searchInput.value = selectedOption.textContent;
                    }
                } else {
                    searchInput.value = '';
                }
            }
        }, 150);
    });
    
    // Select all text when clicking on the input (makes it easy to replace)
    searchInput.addEventListener('click', () => {
        if (searchInput.value && select.value) {
            searchInput.select();
        }
    });

    // Keyboard navigation
    searchInput.addEventListener('keydown', (e) => {
        const items = dropdownList.querySelectorAll('.dropdown-item:not(.disabled)');
        const activeItem = dropdownList.querySelector('.dropdown-item.active');
        let activeIndex = activeItem ? Array.from(items).indexOf(activeItem) : -1;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (activeItem) activeItem.classList.remove('active');
            activeIndex = (activeIndex + 1) % items.length;
            if (items[activeIndex]) {
                items[activeIndex].classList.add('active');
                items[activeIndex].scrollIntoView({ block: 'nearest' });
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (activeItem) activeItem.classList.remove('active');
            activeIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
            if (items[activeIndex]) {
                items[activeIndex].classList.add('active');
                items[activeIndex].scrollIntoView({ block: 'nearest' });
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeItem) {
                activeItem.click();
            }
        } else if (e.key === 'Escape') {
            dropdownList.style.display = 'none';
            searchInput.blur();
        }
    });

    // Update search input when select value changes programmatically
    const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(select, 'value', {
        set: function(newValue) {
            originalDescriptor.set.call(this, newValue);
            // Only update search input if it doesn't have focus (to allow typing)
            if (document.activeElement !== searchInput) {
                if (newValue) {
                    const selectedOption = Array.from(this.options).find(option => option.value === newValue);
                    if (selectedOption) {
                        searchInput.value = selectedOption.textContent;
                    }
                } else {
                    searchInput.value = '';
                }
            }
        },
        get: function() {
            return originalDescriptor.get.call(this);
        }
    });

    // Set initial value if select already has a value
    if (select.value) {
        const selectedOption = Array.from(select.options).find(option => option.value === select.value);
        if (selectedOption) {
            searchInput.value = selectedOption.textContent;
        }
    }

    // Sync disabled state
    const observer = new MutationObserver(() => {
        searchInput.disabled = select.disabled;
    });
    observer.observe(select, { attributes: true, attributeFilter: ['disabled'] });
}

// Function to handle golfer selection change
function handleGolferChange(selectElement) {
    const selectedOption = selectElement.options[selectElement.selectedIndex];
    if (selectedOption) {
        // Set salary to 0 if no golfer is selected (empty value)
        const salary = selectElement.value ? (selectedOption.dataset.salary || '0') : '0';
        selectElement.dataset.salary = salary;
        
        if (selectElement.value) {
            console.log(`Golfer changed: ${selectElement.id} = ${selectElement.value} ($${salary})`);
        } else {
            console.log(`Golfer removed: ${selectElement.id} (salary reset to $0)`);
        }
        
        // Refresh all other dropdowns to update available options
        refreshOtherDropdowns(selectElement.id);
        
        // Trigger salary calculator update
        if (typeof updateSalaryCalculator === 'function') {
            console.log('📊 Calling updateSalaryCalculator...');
            updateSalaryCalculator();
        } else {
            console.log('⏳ updateSalaryCalculator not ready yet, will retry...');
            // Retry after a short delay to allow other scripts to load
            setTimeout(() => {
                if (typeof updateSalaryCalculator === 'function') {
                    console.log('📊 Retrying updateSalaryCalculator...');
                    updateSalaryCalculator();
                } else {
                    console.error('❌ updateSalaryCalculator function still not found after retry!');
                }
            }, 100);
        }
    }
}

// Refresh other dropdowns when a selection changes
function refreshOtherDropdowns(changedSelectId) {
    const allSelects = ['golfer1', 'golfer2', 'golfer3', 'golfer4'];
    
    allSelects.forEach(selectId => {
        if (selectId !== changedSelectId) {
            populateGolferSelect(selectId);
        }
    });
}

// Initialize golfer selections
document.addEventListener('DOMContentLoaded', function() {
    // Initial population of select elements
    populateGolferSelect('golfer1');
    populateGolferSelect('golfer2');
    populateGolferSelect('golfer3');
    populateGolferSelect('golfer4');

    // Add change event listeners to all golfer selects
    const golferSelects = ['golfer1', 'golfer2', 'golfer3', 'golfer4'];
    golferSelects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) {
            select.addEventListener('change', function() {
                handleGolferChange(this);
            });
        }
    });

    // Set up periodic refresh of golfer lists only if form is not being filled out
    setInterval(() => {
        const form = document.querySelector('#pick-submission form');
        const isFormEnabled = !form.querySelector('select:disabled');
        const isFormEmpty = Array.from(form.querySelectorAll('select')).every(select => !select.value);
        
        // Only refresh if form is disabled or completely empty
        if (!isFormEnabled || isFormEmpty) {
            populateGolferSelect('golfer1');
            populateGolferSelect('golfer2');
            populateGolferSelect('golfer3');
            populateGolferSelect('golfer4');
        }
    }, 30000); // Check for updates every 30 seconds
});

// Check if golfer name is duplicate across all selections, excluding a specific dropdown
function isGolferDuplicateExcluding(name, excludeSelectId) {
    const lowerName = name.toLowerCase();
    
    // Check against main golfer selections (excluding the specified dropdown)
    const mainSelects = ['golfer1', 'golfer2', 'golfer3', 'golfer4'];
    for (const selectId of mainSelects) {
        if (selectId === excludeSelectId) continue; // Skip the dropdown we're updating
        
        const select = document.getElementById(selectId);
        if (select && select.value && select.value.toLowerCase() === lowerName) {
            return true;
        }
    }
    
    return false;
}

// Format salary
function formatSalary(salary) {
    return salary % 1 === 0 ? salary.toString() : salary.toFixed(2);
} 