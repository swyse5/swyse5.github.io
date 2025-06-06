// Function to check if form is enabled
async function isFormEnabled() {
    try {
        const response = await fetch('/data/settings.json?' + new Date().getTime());
        const settings = await response.json();
        return settings.formEnabled;
    } catch (error) {
        console.error('Error checking form status:', error);
        return false;
    }
}

// Function to check if Pick Submission tab should be shown
async function isPickSubmissionTabVisible() {
    try {
        const response = await fetch('/data/settings.json?' + new Date().getTime());
        const settings = await response.json();
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
        const response = await fetch('/data/settings.json?' + new Date().getTime());
        const settings = await response.json();
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
        const response = await fetch('/data/settings.json?' + new Date().getTime());
        const settings = await response.json();
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
    const formEnabled = await isFormEnabled();
    const formElements = document.querySelectorAll('#pick-submission form select, #pick-submission form input, #pick-submission form button');
    const statusMessage = document.querySelector('#pick-submission .alert-info');

    formElements.forEach(element => {
        element.disabled = !formEnabled;
    });

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

        const formData = new FormData(form);
        const data = {};
        for (let [key, value] of formData.entries()) {
            data[key] = value;
        }
        
        // Add CC
        data._cc = userEmail;

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