// Function to check if form submissions are enabled
function isFormEnabled() {
    return localStorage.getItem('formEnabled') === 'true';
}

// Function to check if Pick Submission tab should be hidden
function isPickSubmissionTabHidden() {
    return localStorage.getItem('hidePickSubmissionTab') === 'true';
}

// Function to update Pick Submission tab visibility
function updatePickSubmissionTabVisibility() {
    const isHidden = isPickSubmissionTabHidden();
    const tabElement = document.getElementById('pick-submission-tab');
    const tabContentElement = document.getElementById('pick-submission');
    
    if (tabElement && tabContentElement) {
        if (isHidden) {
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
function updateRankingsInfo() {
    const rankingsDate = localStorage.getItem('rankingsDate');
    const tournament = localStorage.getItem('rankingsTournament');
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
}

// Function to update submission subtext
function updateSubmissionSubtext() {
    const subtextElement = document.getElementById('submissionSubtextDisplay');
    const subtext = localStorage.getItem('submissionSubtext') || '';
    
    if (subtext) {
        subtextElement.innerHTML = subtext;
        subtextElement.style.display = 'block';
    } else {
        subtextElement.style.display = 'none';
    }
}

// Function to update form elements based on enabled status
function updateFormElements() {
    const formEnabled = isFormEnabled();
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
document.addEventListener('DOMContentLoaded', function() {
    updateFormElements();
    updateRankingsInfo();
    updateSubmissionSubtext();
    updatePickSubmissionTabVisibility();

    // Check for form status changes every 30 seconds
    setInterval(() => {
        updateFormElements();
        updateRankingsInfo();
        updateSubmissionSubtext();
        updatePickSubmissionTabVisibility();
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