document.addEventListener('DOMContentLoaded', function() {
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
            mode: 'cors', // Enable CORS
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