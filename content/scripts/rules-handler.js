$(document).ready(function() {
    const RULES_DOC_ID = '2PACX-1vRx2HhsAEdLntWb8h_cBGEHpHizXUxtf6B2Hr3PqTnZDG6dx7zGbPK-HCQQmCOGZ10zDrBuWStSHP5Q';
    const rulesContainer = $('#rules-content');
    
    function fetchRulesContent() {
        // Show loading spinner
        rulesContainer.html(`
            <div class="text-center">
                <div class="spinner-border" role="status">
                    <span class="sr-only">Loading rules...</span>
                </div>
            </div>
        `);

        // Fetch the published Google Doc content
        $.ajax({
            url: `https://docs.google.com/document/d/e/${RULES_DOC_ID}/pub?embedded=true`,
            method: 'GET',
            success: function(response) {
                // Parse the HTML content
                const parser = new DOMParser();
                const doc = parser.parseFromString(response, 'text/html');
                
                // Extract the main content
                const content = doc.querySelector('.doc-content');
                if (content) {
                    // Clean up and style the content
                    const cleanedHtml = cleanAndStyleContent(content);
                    rulesContainer.html(cleanedHtml);
                } else {
                    showError('Could not load rules content.');
                }
            },
            error: function(xhr, status, error) {
                console.error('Error fetching rules:', error);
                showError('Failed to load rules. Please try again later.');
            }
        });
    }

    function cleanAndStyleContent(content) {
        // Create a wrapper div with Bootstrap styling
        const wrapper = document.createElement('div');
        wrapper.className = 'rules-content p-4';
        
        // Add custom styles
        const style = document.createElement('style');
        style.textContent = `
            .rules-content {
                max-width: 800px;
                margin: 0 auto;
                line-height: 1.6;
                color: #333;
            }
            .rules-content h1, .rules-content h2, .rules-content h3 {
                margin-top: 2rem;
                margin-bottom: 1rem;
                font-weight: 600;
            }
            .rules-content p {
                margin-bottom: 1rem;
            }
            .rules-content ul, .rules-content ol {
                margin-bottom: 1rem;
                padding-left: 2rem;
            }
            .rules-content li {
                margin-bottom: 0.5rem;
            }
        `;
        wrapper.appendChild(style);

        // Clean up the content
        const cleanContent = content.cloneNode(true);
        
        // Remove any scripts
        const scripts = cleanContent.getElementsByTagName('script');
        while (scripts.length > 0) {
            scripts[0].parentNode.removeChild(scripts[0]);
        }

        // Remove any iframes
        const iframes = cleanContent.getElementsByTagName('iframe');
        while (iframes.length > 0) {
            iframes[0].parentNode.removeChild(iframes[0]);
        }

        // Add the cleaned content
        wrapper.appendChild(cleanContent);
        
        return wrapper.outerHTML;
    }

    function showError(message) {
        rulesContainer.html(`
            <div class="alert alert-danger" role="alert">
                ${message}
                <button type="button" class="btn btn-link" onclick="location.reload()">Retry</button>
            </div>
        `);
    }

    // Initialize tab handling
    $('#rules-tab').on('shown.bs.tab', function (e) {
        console.log('Rules tab shown');
        fetchRulesContent();
    });

    // If rules tab is active, fetch content immediately
    if ($('#rules-tab').hasClass('active')) {
        console.log('Rules tab is initially active');
        fetchRulesContent();
    }
}); 