// Helper function to get settings (local testing or GitHub)
async function getSettings() {
    try {
        // Check for local testing data first
        const localSettings = localStorage.getItem('admin_local_settings');
        if (localSettings) {
            console.log('Using local testing settings');
            return JSON.parse(localSettings);
        }
        
        // Fall back to GitHub data
        const response = await fetch('/data/settings.json?' + new Date().getTime());
        return await response.json();
    } catch (error) {
        console.error('Error loading settings:', error);
        return {};
    }
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

// Function to check if form is enabled
async function isFormEnabled() {
    try {
        const settings = await getSettings();
        return settings.formEnabled;
    } catch (error) {
        console.error('Error checking form status:', error);
        return false;
    }
}

// Function to check if Pick Submission tab should be shown
async function isPickSubmissionTabVisible() {
    try {
        const settings = await getSettings();
        return settings.hidePickSubmissionTab;
    } catch (error) {
        console.error('Error checking tab visibility:', error);
        return true;
    }
}

// Function to update Pick Submission tab visibility
async function updatePickSubmissionTabVisibility() {
    const isVisible = await isPickSubmissionTabVisible();
    const tabElement = document.getElementById('pick-submission-tab');
    const tabContentElement = document.getElementById('pick-submission');
    
    if (tabElement && tabContentElement) {
        if (!isVisible) {
            tabElement.parentElement.style.display = 'none';
            tabContentElement.classList.remove('show', 'active');
            
            // If the Pick Submission tab was active, activate the next available tab
            if (tabElement.classList.contains('active')) {
                const nextTab = document.querySelector('.nav-tabs .nav-link:not([id="pick-submission-tab"])');
                if (nextTab) {
                    nextTab.click();
                }
            }
        } else {
            tabElement.parentElement.style.display = '';
        }
    }
}

// Function to update rankings information
async function updateRankingsInfo() {
    try {
        const settings = await getSettings();
        const rankingsDate = settings.rankingsDate;
        const tournament = settings.rankingsTournament;
        const rankingsText = document.querySelector('.rankings-update-text');
        
        if (rankingsDate && tournament) {
            const formattedDate = new Date(rankingsDate).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric'
            });
            rankingsText.textContent = `Rankings last updated: ${formattedDate} for the ${tournament}`;
        } else {
            rankingsText.style.display = 'none';
        }
    } catch (error) {
        console.error('Error updating rankings info:', error);
    }
}

// Function to update submission subtext
async function updateSubmissionSubtext() {
    try {
        const settings = await getSettings();
        const submissionSubtext = settings.submissionSubtext;
        const subtextElement = document.getElementById('submissionSubtextDisplay');
        
        if (submissionSubtext && subtextElement) {
            subtextElement.innerHTML = submissionSubtext;
            subtextElement.style.display = 'block';
        } else if (subtextElement) {
            subtextElement.style.display = 'none';
        }
    } catch (error) {
        console.error('Error updating submission subtext:', error);
    }
}

// Function to update form elements based on enabled status
async function updateFormElements() {
    console.log('📝 form-handler.js: updateFormElements called');
    const formEnabled = await isFormEnabled();
    console.log('📝 Form enabled status:', formEnabled);
    
    const formElements = document.querySelectorAll('#pick-submission form select, #pick-submission form input[type="email"]');
    const submitButton = document.querySelector('#pick-submission form button[type="submit"]');
    const statusMessage = document.querySelector('#pick-submission .alert-info');

    formElements.forEach(element => {
        element.disabled = !formEnabled;
    });


    // Handle submit button separately to preserve salary validation
    if (submitButton) {
        if (formEnabled) {
            submitButton.dataset.adminDisabled = 'false';
            // Let salary calculator handle the button state
            if (typeof updateSubmitButton === 'function') {
                updateSubmitButton();
            }
        } else {
            submitButton.disabled = true;
            submitButton.dataset.adminDisabled = 'true';
            submitButton.textContent = 'Pick submission is currently closed';
        }
    }

    if (statusMessage) {
        statusMessage.style.display = formEnabled ? 'none' : 'block';
        statusMessage.textContent = formEnabled ? '' : 'Pick submission is currently closed. Check back soon!';
    }
}

// Initialize form status on page load
document.addEventListener('DOMContentLoaded', async function() {
    await updateFormElements();
    await updateRankingsInfo();
    await updateSubmissionSubtext();
    await updatePickSubmissionTabVisibility();

    // Check for form status changes every 30 seconds
    setInterval(async () => {
        await updateFormElements();
        await updateRankingsInfo();
        await updateSubmissionSubtext();
        await updatePickSubmissionTabVisibility();
    }, 30000);

    const form = document.querySelector('#pick-submission form');
    const messageDiv = document.getElementById('formMessage');
    
    function showMessage(message, isError = false) {
        messageDiv.textContent = message;
        messageDiv.className = `alert ${isError ? 'alert-danger' : 'alert-success'}`;
        messageDiv.style.display = 'block';
        
        // Scroll to message
        messageDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    form.addEventListener('submit', function(e) {
        e.preventDefault();
        
        // Show loading message
        showMessage('Submitting your picks...', false);
        
        // Validate form data
        const userEmail = document.getElementById('userEmail').value;
        if (!userEmail) {
            showMessage('Please enter your email address.', true);
            return;
        }
        
        // Validate salary and golfer requirements
        if (typeof validatePicksForm === 'function') {
            if (!validatePicksForm(showMessage)) {
                // validatePicksForm shows appropriate error messages via showMessage
                return;
            }
        }

        const formData = new FormData(form);
        const data = {};
        for (let [key, value] of formData.entries()) {
            data[key] = value;
        }
        
        // Add CC
        data._cc = userEmail;
        
        // Add total salary calculation
        if (typeof calculateTotalSalary === 'function') {
            const salaryResult = calculateTotalSalary();
            data.totalSalary = salaryResult.total;
            data.salaryBreakdown = salaryResult.golfers.map(g => `${g.name}: $${typeof formatSalary === 'function' ? formatSalary(g.salary) : g.salary} (${g.type})`).join(', ');
        }

        // Log the data being sent (for debugging)
        console.log('Preparing to send form data:', data);

        fetch('https://formspree.io/f/xvgadzdo', {
            method: 'POST',
            mode: 'cors',
            cache: 'no-cache',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(data)
        })
        .then(response => {
            console.log('Response received:', {
                status: response.status,
                statusText: response.statusText,
                headers: Array.from(response.headers.entries())
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('Success response:', data);
            showMessage('Your picks have been submitted successfully! Please check your email (including spam folder) for confirmation.', false);
            form.reset();
        })
        .catch(error => {
            console.error('Detailed error:', {
                message: error.message,
                stack: error.stack,
                error: error
            });
            
            let errorMessage = 'There was an error submitting your picks. ';
            if (error.message.includes('Failed to fetch')) {
                errorMessage += 'Please check your internet connection.';
            } else if (error.message.includes('HTTP error')) {
                errorMessage += 'The server could not process your request.';
            } else {
                errorMessage += 'Please try again or contact the commissioner directly.';
            }
            
            showMessage(errorMessage, true);
        });
    });
}); 